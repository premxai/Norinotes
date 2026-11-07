import { and, applications, desc, eq, getDb, gte, inArray, inboxMessages, isNull, jobs, type Db } from "@norinote/db";
import { atsOfSender } from "./link.js";
import { onInbox } from "./notify.js";
import type { InboxMeta } from "./receive.js";

/** What `awaitVerification` hands back: a code to type, or a link to open, from one stored message. */
export type VerificationResult =
  | { type: "code"; code: string; messageId: string; receivedAt: Date; from: string; source: CodeSource }
  | { type: "link"; link: string; messageId: string; receivedAt: Date; from: string; source: CodeSource };

/** Where the mail came from: the person's connected Gmail, a code they typed in Norinote, or mail sent to their address. */
export type CodeSource = "gmail" | "typed" | "email";
const sourceOf = (externalId: string | null): CodeSource =>
  externalId?.startsWith("gmail:") ? "gmail" : externalId?.startsWith("typed:") ? "typed" : "email";

export type AwaitVerificationArgs = {
  applicationId: string;
  /** Only mail that arrived at or after this moment counts. Pass the time just before the form asked for the code. */
  since: Date;
  /** Give up after this long and resolve null. */
  timeoutMs: number;
  /** Which kinds of verification the caller can use. Default `any` (a code is preferred when both arrived). */
  accept?: "code" | "link" | "any";
  /** Message ids already used (a code is good once). The waiter adds what it returns. */
  exclude?: Set<string>;
  /** Stops waiting early (resolves null). */
  signal?: AbortSignal;
  /** Database. Default: the shared one (`getDb()`). */
  db?: Db;
  /** Database poll interval. Default 1500 ms. In-process stores wake the waiter at once. */
  pollMs?: number;
  /** Test hooks. */
  now?: () => Date;
};

type Row = { id: string; externalId: string | null; code: string | null; links: string[]; meta: unknown; receivedAt: Date; from: string; applicationId: string | null };

function toResult(r: Row, accept: "code" | "link" | "any"): VerificationResult | null {
  const meta = (r.meta ?? {}) as InboxMeta;
  if (meta.spam) return null;
  const source = sourceOf(r.externalId);
  if (r.code && accept !== "link") return { type: "code", code: r.code, messageId: r.id, receivedAt: r.receivedAt, from: r.from, source };
  const link = meta.verificationLink ?? null;
  if (link && accept !== "code") return { type: "link", link, messageId: r.id, receivedAt: r.receivedAt, from: r.from, source };
  return null;
}

/**
 * One look at the table: the newest unused verification for this application since `since`. Linked messages count when
 * their sender may speak for the company (its domain, or the job's ATS). An unlinked message counts only when the job
 * system that sent it is this job's system and this is the user's only application waiting for mail on it, so a code
 * meant for another application, or a stranger's mail, is never typed into a form.
 */
export async function findVerification(db: Db, args: Pick<AwaitVerificationArgs, "applicationId" | "since" | "accept" | "exclude">): Promise<VerificationResult | null> {
  const accept = args.accept ?? "any";
  const [app] = await db.select({ userId: applications.userId, jobId: applications.jobId }).from(applications).where(eq(applications.id, args.applicationId)).limit(1);
  if (!app) return null;
  const cols = { id: inboxMessages.id, externalId: inboxMessages.messageId, code: inboxMessages.code, links: inboxMessages.links, meta: inboxMessages.meta, receivedAt: inboxMessages.receivedAt, from: inboxMessages.fromAddress, applicationId: inboxMessages.applicationId };

  const linked = await db.select(cols).from(inboxMessages)
    .where(and(eq(inboxMessages.applicationId, args.applicationId), eq(inboxMessages.kind, "verification_code"), gte(inboxMessages.receivedAt, args.since)))
    .orderBy(desc(inboxMessages.receivedAt));
  const pick = (rows: Row[], ok: (r: Row) => boolean): VerificationResult | null => {
    // A code beats a link when both arrived.
    const usable = rows.filter((r) => !args.exclude?.has(r.id) && ok(r));
    for (const want of accept === "any" ? (["code", "link"] as const) : [accept]) {
      for (const r of usable) {
        const res = toResult(r, want);
        if (res) return res;
      }
    }
    return null;
  };
  const hit = pick(linked, (r) => (r.meta as InboxMeta).trusted !== false);
  if (hit) return hit;

  const [job] = await db.select({ atsType: jobs.atsType }).from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  if (!job) return null;
  const waiting = await db.select({ id: applications.id, jobId: applications.jobId }).from(applications)
    .where(and(eq(applications.userId, app.userId), inArray(applications.status, ["applying", "awaiting_code"])));
  const others = waiting.filter((w) => w.id !== args.applicationId);
  if (others.length) {
    const otherJobs = await db.select({ atsType: jobs.atsType }).from(jobs).where(inArray(jobs.id, others.map((o) => o.jobId)));
    if (otherJobs.some((j) => j.atsType === job.atsType)) return null;
  }
  const loose = await db.select(cols).from(inboxMessages)
    .where(and(eq(inboxMessages.userId, app.userId), isNull(inboxMessages.applicationId), eq(inboxMessages.kind, "verification_code"), gte(inboxMessages.receivedAt, args.since)))
    .orderBy(desc(inboxMessages.receivedAt));
  return pick(loose, (r) => atsOfSender(r.from) === job.atsType);
}

/**
 * Waits for the verification code or link an employer's job system emails during an application, and resolves with it,
 * or with null after `timeoutMs` (or when `signal` aborts). It polls `inbox_messages` (works across processes: the API
 * stores, the worker waits) and is woken at once by a store in the same process. The returned message id is added to
 * `exclude`, so passing the same set to a retry never returns the same code twice.
 *
 *   const v = await awaitVerification({ applicationId, since: clickedAt, timeoutMs: 120_000 });
 *   if (v?.type === "code") await page.fill(codeInput, v.code);
 *   else if (v?.type === "link") await page.goto(v.link);
 */
export async function awaitVerification(args: AwaitVerificationArgs): Promise<VerificationResult | null> {
  const db = args.db ?? (await getDb());
  const now = args.now ?? (() => new Date());
  const pollMs = Math.max(10, args.pollMs ?? 1500);
  const deadline = now().getTime() + Math.max(0, args.timeoutMs);
  const [app] = await db.select({ userId: applications.userId }).from(applications).where(eq(applications.id, args.applicationId)).limit(1);
  if (!app || args.signal?.aborted) return null;

  let wake: (() => void) | null = null;
  const unsubscribe = onInbox(app.userId, () => wake?.());
  const onAbort = () => wake?.();
  args.signal?.addEventListener("abort", onAbort);
  try {
    for (;;) {
      const hit = await findVerification(db, args);
      if (hit) {
        args.exclude?.add(hit.messageId);
        return hit;
      }
      const remaining = deadline - now().getTime();
      if (remaining <= 0 || args.signal?.aborted) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wake = null; resolve(); }, Math.min(pollMs, remaining));
        wake = () => { clearTimeout(timer); wake = null; resolve(); };
      });
      if (args.signal?.aborted) return null;
    }
  } finally {
    unsubscribe();
    args.signal?.removeEventListener("abort", onAbort);
  }
}

/** The same shape as `CodeWaiter` in @norinote/apply (inbox does not import apply). */
export interface CodeWaiterLike {
  waitForCode(applicationId: string, opts: { hint: string; timeoutMs: number }): Promise<string | null>;
}

export type CodeWaiterOptions = {
  /** How often the database is polled. Default 1 s. */
  intervalMs?: number;
  /** How far before the wait began a code may have arrived (the site often mails it the moment the button is clicked). Default 2 min. */
  lookbackMs?: number;
  now?: () => Date;
};

/**
 * apply's current `CodeWaiter` on top of `awaitVerification`: codes only, each used once, `since` = now less the look-back.
 * `hint` (the driver name) is no longer needed: the job's own ATS decides which unlinked mail may be used.
 */
export function createCodeWaiter(db: Db, options: CodeWaiterOptions = {}): CodeWaiterLike {
  const used = new Set<string>();
  const now = options.now ?? (() => new Date());
  return {
    async waitForCode(applicationId, opts) {
      const since = new Date(now().getTime() - (options.lookbackMs ?? 2 * 60_000));
      const v = await awaitVerification({ db, applicationId, since, timeoutMs: opts.timeoutMs, accept: "code", exclude: used, pollMs: options.intervalMs ?? 1000, now });
      return v?.type === "code" ? v.code : null;
    },
  };
}
