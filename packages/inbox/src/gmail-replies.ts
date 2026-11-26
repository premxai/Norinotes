/**
 * Employer replies from the person's connected Gmail (docs/inbox.md, "Employer replies"). On a schedule, and only for a
 * connection Composio reports ACTIVE, it asks Gmail for mail from the companies the person applied to and from those jobs'
 * own job systems (naming the company), classifies each message with the rules, and keeps only a trusted reply,
 * interview, rejection, offer or confirmation linked to a submitted application. A kept message is stored as its
 * classification, its link, the subject and a short snippet, and records its outcome through the inbox's own path. Any
 * other mail is read in memory and never written.
 */
import { and, applications, companies, eq, gte, inArray, jobs, profiles, sql, type Db } from "@norinote/db";
import { INBOX_OUTCOME_KINDS, type AtsType } from "@norinote/shared";
import { getGmailConnection, type ComposioGmail, type GmailMessage } from "./gmail.js";
import { fromGeneric } from "./parse.js";
import { storeInbound, type KeepCheck } from "./receive.js";

/** Where each job system's mail comes from (Gmail `from:` also matches subdomains such as us.greenhouse-mail.io). */
export const ATS_MAIL_DOMAINS: Partial<Record<AtsType, string[]>> = {
  greenhouse: ["greenhouse-mail.io", "greenhouse.io"],
  lever: ["hire.lever.co", "lever.co"],
  ashby: ["ashbyhq.com"],
  workday: ["myworkday.com", "myworkdayjobs.com", "myworkdaysite.com"],
  workable: ["workablemail.com", "workable.com"],
  rippling: ["rippling.com", "rippling-ats.com"],
};

/** Applications looked at: submitted within this many days (the inbox's link window). */
export const REPLY_WINDOW_DAYS = 120;
/** Each poll starts this long before the last one began, so mail that reached Gmail late is not missed. */
const OVERLAP_MS = 60 * 60_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const MAX_QUERY = 1500;
const SNIPPET_KEEP = new Set<string>([...INBOX_OUTCOME_KINDS, "confirmation"]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** `acme.com` for careers.acme.com, `acme.co.uk` for jobs.acme.co.uk. Null for an IP, localhost or nonsense. */
export function registrableDomain(hostOrUrl: string): string | null {
  const host = hostOrUrl.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const labels = host.split(".");
  const n = labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-n).join(".");
}

const isAtsDomain = (domain: string) => Object.values(ATS_MAIL_DOMAINS).some((ds) => ds!.some((d) => domain === d || domain.endsWith(`.${d}`)))
  || /(^|\.)(greenhouse|lever|ashbyhq|myworkdayjobs|workable|rippling)\.(io|co|com)$/.test(domain);

export type ReplySource = { companyName: string; companyDomain: string | null; applyUrl: string; atsType: AtsType };

/**
 * The Gmail searches for replies since `since`: mail from each company's own domain (its known domain, or its apply site
 * when that is not a job system), and mail from the job's job system that names the company. Split so that no query
 * passes about 1,500 characters.
 */
export function replyQueries(sources: readonly ReplySource[], since: Date): string[] {
  const terms = new Set<string>();
  for (const s of sources) {
    const own = [s.companyDomain, s.applyUrl].map((d) => (d ? registrableDomain(d) : null)).find((d): d is string => !!d && !isAtsDomain(d));
    if (own) terms.add(`from:${own}`);
    const ats = ATS_MAIL_DOMAINS[s.atsType];
    const name = s.companyName.replace(/["\\]/g, "").trim();
    if (ats && name.length >= 2) terms.add(`(from:(${ats.join(" OR ")}) "${name}")`);
  }
  const head = `after:${Math.floor(since.getTime() / 1000)} -in:chats -in:sent -in:drafts`;
  const out: string[] = [];
  let group: string[] = [];
  const flush = () => { if (group.length) out.push(`${head} (${group.join(" OR ")})`); group = []; };
  for (const t of terms) {
    if (group.length && head.length + [...group, t].join(" OR ").length + 3 > MAX_QUERY) flush();
    group.push(t);
  }
  flush();
  return out;
}

/** The kept part of a message: the classification, the link, the subject and this much of the text. */
export const REPLY_SNIPPET_CHARS = 280;

/** What a kept reply must be: a trusted outcome or confirmation, linked to a submitted application, never spam. */
export const keepReply = (c: KeepCheck): boolean => !c.spam && c.trusted && c.applicationStatus === "submitted" && SNIPPET_KEEP.has(c.kind);

type RepliesState = { checkedAt: string };

async function readState(db: Db, userId: string): Promise<RepliesState | null> {
  const [row] = await db.select({ p: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const s = (row?.p as Record<string, unknown> | null)?.gmailReplies as Partial<RepliesState> | undefined;
  return typeof s?.checkedAt === "string" && !Number.isNaN(Date.parse(s.checkedAt)) ? { checkedAt: s.checkedAt } : null;
}

async function writeState(db: Db, userId: string, state: RepliesState): Promise<void> {
  await db.update(profiles).set({ preferences: sql`jsonb_set(coalesce(${profiles.preferences}, '{}'::jsonb), '{gmailReplies}', ${JSON.stringify(state)}::jsonb, true)` })
    .where(eq(profiles.userId, userId));
}

export type PollRepliesResult = { status: "no_connection" | "not_active" | "nothing_applied" | "failed" | "done"; read: number; stored: number; outcomes: number };

/**
 * One poll of one person's Gmail for employer replies. Mail since the last poll (less an hour), or since the oldest
 * submission in the window on the first poll. The poll time is saved only when every search finished, so a failure is
 * retried next time; a message seen twice is stored once (its Gmail id).
 */
export async function pollGmailReplies(args: {
  db: Db; gmail: ComposioGmail; userId: string; now?: Date; log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<PollRepliesResult> {
  const { db, gmail, userId } = args;
  const now = args.now ?? new Date();
  const res: PollRepliesResult = { status: "done", read: 0, stored: 0, outcomes: 0 };
  const conn = await getGmailConnection(db, userId);
  if (!conn) return { ...res, status: "no_connection" };
  const status = await gmail.status(conn.connectedAccountId).catch(() => "UNKNOWN" as const);
  if (status !== "ACTIVE") {
    args.log?.("gmail.replies_not_active", { userId, status });
    return { ...res, status: "not_active" };
  }

  const windowStart = new Date(now.getTime() - REPLY_WINDOW_DAYS * 86_400_000);
  const sent = await db.select({ submittedAt: applications.submittedAt, companyName: companies.name, companyDomain: companies.domain, applyUrl: jobs.applyUrl, atsType: jobs.atsType })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), inArray(applications.status, ["submitted"]), gte(applications.submittedAt, windowStart)));
  if (!sent.length) return { ...res, status: "nothing_applied" };

  const state = await readState(db, userId);
  const firstSubmit = new Date(Math.min(...sent.map((s) => s.submittedAt!.getTime())));
  const since = state ? new Date(Math.max(Date.parse(state.checkedAt) - OVERLAP_MS, firstSubmit.getTime())) : firstSubmit;

  const seen = new Set<string>();
  try {
    for (const query of replyQueries(sent, since)) {
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const got: { messages: GmailMessage[]; nextPageToken: string | null } = gmail.fetchPage
          ? await gmail.fetchPage(userId, query, { max: PAGE_SIZE, pageToken })
          : { messages: await gmail.fetch(userId, query, PAGE_SIZE), nextPageToken: null };
        for (const m of got.messages) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          res.read++;
          const email = fromGeneric({ from: m.from, subject: m.subject, text: m.text, messageId: `gmail:${m.id}`, date: m.receivedAt?.toISOString() });
          const r = await storeInbound(db, { ...email, provider: "generic" }, { now: m.receivedAt ?? now, userId, keep: keepReply, snippet: REPLY_SNIPPET_CHARS });
          if (!r.stored || r.duplicate) continue;
          res.stored++;
          if (r.outcome) res.outcomes++;
        }
        pageToken = got.nextPageToken;
        if (!pageToken) break;
      }
    }
  } catch (err) {
    args.log?.("gmail.replies_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    return { ...res, status: "failed" };
  }
  await writeState(db, userId, { checkedAt: now.toISOString() });
  args.log?.("gmail.replies", { userId, read: res.read, stored: res.stored, outcomes: res.outcomes });
  return res;
}

/** People with a Gmail connection on file. */
async function connectedUsers(db: Db): Promise<string[]> {
  const rows = await db.select({ userId: profiles.userId }).from(profiles)
    .where(sql`${profiles.preferences} -> 'gmail' ->> 'connectedAccountId' IS NOT NULL`);
  return rows.map((r) => r.userId);
}

/**
 * Polls every connected person's Gmail for employer replies now and then every `intervalMs` (default an hour), one
 * person at a time. Returns the stop function. The worker calls this once at start when Composio is configured.
 */
export function startGmailReplyWatcher(db: Db, gmail: ComposioGmail, opts: { intervalMs?: number; log?: (event: string, data: Record<string, unknown>) => void } = {}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const userId of await connectedUsers(db)) await pollGmailReplies({ db, gmail, userId, ...(opts.log ? { log: opts.log } : {}) });
    } catch (err) {
      opts.log?.("gmail.replies_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => { void run(); }, opts.intervalMs ?? 60 * 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
