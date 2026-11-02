import { and, applications, desc, eq, gte, inboxMessages, isNull, type Db } from "@norinote/db";
import { fromAts, senderBase } from "./link.js";

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
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Implements apply's `CodeWaiter` by polling `inbox_messages`: the newest verification code linked to this application
 * that arrived after the wait began (less the look-back), returned once. A code mail that could not be linked to any
 * application is accepted only when a job system sent it (Greenhouse, Lever, ...) and `hint` (the driver name) matches the
 * sender, so a stranger's mail never gets typed into a form. Returns null on timeout.
 */
export function createCodeWaiter(db: Db, options: CodeWaiterOptions = {}): CodeWaiterLike {
  const interval = options.intervalMs ?? 1000;
  const lookback = options.lookbackMs ?? 2 * 60_000;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  /** Messages already handed out by this waiter: a code is used once. */
  const used = new Set<string>();

  async function findCode(applicationId: string, userId: string, hint: string, since: Date): Promise<{ id: string; code: string } | null> {
    const linked = await db.select({ id: inboxMessages.id, code: inboxMessages.code }).from(inboxMessages)
      .where(and(eq(inboxMessages.applicationId, applicationId), eq(inboxMessages.kind, "verification_code"), gte(inboxMessages.receivedAt, since)))
      .orderBy(desc(inboxMessages.receivedAt));
    for (const r of linked) if (r.code && !used.has(r.id)) return { id: r.id, code: r.code };

    const needle = hint.trim().toLowerCase();
    const loose = await db.select({ id: inboxMessages.id, code: inboxMessages.code, from: inboxMessages.fromAddress }).from(inboxMessages)
      .where(and(eq(inboxMessages.userId, userId), isNull(inboxMessages.applicationId), eq(inboxMessages.kind, "verification_code"), gte(inboxMessages.receivedAt, since)))
      .orderBy(desc(inboxMessages.receivedAt));
    for (const r of loose) {
      if (!r.code || used.has(r.id) || !fromAts(r.from)) continue;
      if (needle && !senderBase(r.from).includes(needle) && !needle.includes(senderBase(r.from).split("-")[0] ?? "")) continue;
      return { id: r.id, code: r.code };
    }
    return null;
  }

  return {
    async waitForCode(applicationId, opts) {
      const started = now().getTime();
      const deadline = started + Math.max(0, opts.timeoutMs);
      const since = new Date(started - lookback);
      const [app] = await db.select({ userId: applications.userId }).from(applications).where(eq(applications.id, applicationId)).limit(1);
      if (!app) return null;
      for (;;) {
        const hit = await findCode(applicationId, app.userId, opts.hint, since);
        if (hit) {
          used.add(hit.id);
          return hit.code;
        }
        const remaining = deadline - now().getTime();
        if (remaining <= 0) return null;
        await sleep(Math.min(interval, remaining));
      }
    },
  };
}
