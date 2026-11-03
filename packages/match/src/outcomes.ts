/**
 * Outcomes: what happened to each submitted application, recorded from the owned inbox or by the user, and the per-user
 * history the summary and the outcome learning read. See docs/outcomes.md.
 *
 * - The inbox classifies linked mail; `syncInboxOutcomes` turns a trusted, linked rejection, interview, recruiter reply or
 *   offer for a submitted application into one `outcomes` row per message (idempotent), and a confirmation into
 *   `applications.confirmed_at` (a receipt, not an outcome). The inbox writes its own row per application and kind as the
 *   mail arrives; the sync attaches the message id to that row instead of adding a second one.
 * - Users add or remove outcomes by hand (`addManualOutcome`, `removeOutcome`). Removal is soft, so a re-read of the same
 *   message never brings a corrected outcome back.
 * - "No response" is derived, never stored: a submitted application with no outcome 30 days after submission.
 */
import {
  and, applications, asc, companies, eq, inArray, inboxMessages, isNull, jobSpecs, jobs, or, outcomes, resumes, shortlist, sql, type Db,
} from "@norinote/db";
import { INBOX_OUTCOME_KINDS } from "@norinote/shared";
import { roleFamilyOf } from "./roles.js";

export const OUTCOME_KINDS = ["reply", "interview", "rejection", "offer"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

/** Days after submission with no outcome before an application counts as "no response". */
export const NO_RESPONSE_DAYS = 30;
/** Below this many applications (or replies, for the median) a statistic is shown as counts only, never a percentage. */
export const SMALL_SAMPLE = 5;

const DAY_MS = 86_400_000;

/** Inbox kinds (see @norinote/shared INBOX_OUTCOME_KINDS) and the outcome each one records. */
const FROM_INBOX: Record<string, OutcomeKind> = { recruiter_reply: "reply", interview: "interview", rejection: "rejection", offer: "offer" };

/** Submitted, by status or by a submission time (a status may move on later, the submission stands). */
const submittedSql = () => or(eq(applications.status, "submitted"), sql`${applications.submittedAt} IS NOT NULL`);

// ---- recording from the inbox ------------------------------------------------------------------------------------------

export type SyncResult = {
  /** New outcome rows written. */
  recorded: number;
  /** Rows the inbox had already written that now carry their message id. */
  linked: number;
  /** Rows that followed their message to another kind, or were dropped because it is no longer an outcome. */
  corrected: number;
  /** Applications marked confirmed by a confirmation mail. */
  confirmed: number;
  /** Submitted applications whose tailoring version was recorded. */
  stamped: number;
};

type MessageMeta = { spam?: boolean; trusted?: boolean };

/** A message counts only when it is linked, not spam, and from the company or its job system (the inbox's `trusted`). */
const usable = (meta: unknown) => {
  const m = (meta ?? {}) as MessageMeta;
  return m.spam !== true && m.trusted === true;
};

const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

/**
 * Brings `outcomes` and `applications.confirmed_at` in line with the classified inbox. Idempotent; safe to run on every
 * read. Unlinked, spam and untrusted messages are ignored, and so is anything for an application that was never submitted.
 * A row the user removed stays removed.
 */
export async function syncInboxOutcomes(db: Db, opts: { userId?: string; messageIds?: readonly string[] } = {}): Promise<SyncResult> {
  const res: SyncResult = { recorded: 0, linked: 0, corrected: 0, confirmed: 0, stamped: 0 };
  const scope = and(
    opts.userId ? eq(inboxMessages.userId, opts.userId) : undefined,
    opts.messageIds ? (opts.messageIds.length ? inArray(inboxMessages.id, [...opts.messageIds]) : sql`false`) : undefined,
  );

  // New outcome messages: an outcome kind, linked to a submitted application, not yet the source of a row.
  const fresh = await db.select({
    id: inboxMessages.id, applicationId: inboxMessages.applicationId, kind: inboxMessages.kind, receivedAt: inboxMessages.receivedAt, meta: inboxMessages.meta,
  }).from(inboxMessages)
    .innerJoin(applications, and(eq(applications.id, inboxMessages.applicationId), eq(applications.userId, inboxMessages.userId)))
    .where(and(scope, inArray(inboxMessages.kind, [...INBOX_OUTCOME_KINDS]), submittedSql(),
      sql`NOT EXISTS (SELECT 1 FROM ${outcomes} WHERE ${outcomes.messageId} = ${inboxMessages.id})`))
    .orderBy(asc(inboxMessages.receivedAt));
  for (const m of fresh) {
    if (!m.applicationId || !usable(m.meta)) continue;
    const kind = FROM_INBOX[m.kind]!;
    try {
      // The inbox writes one row per application and kind when the mail arrives: give it its message id.
      const [own] = await db.select({ id: outcomes.id }).from(outcomes)
        .where(and(eq(outcomes.applicationId, m.applicationId), eq(outcomes.kind, kind), eq(outcomes.source, "inbox"), isNull(outcomes.messageId)))
        .orderBy(asc(outcomes.at)).limit(1);
      if (own) {
        const done = await db.update(outcomes).set({ messageId: m.id }).where(and(eq(outcomes.id, own.id), isNull(outcomes.messageId))).returning({ id: outcomes.id });
        if (done.length) { res.linked++; continue; }
      }
      const ins = await db.insert(outcomes).values({ applicationId: m.applicationId, kind, at: m.receivedAt, source: "inbox", messageId: m.id })
        .onConflictDoNothing().returning({ id: outcomes.id });
      res.recorded += ins.length;
    } catch (e) {
      // Another sync recorded the same message a moment ago.
      if (!isUniqueViolation(e)) throw e;
    }
  }

  // A message re-read later (the model settled an ambiguous one) may have changed kind: its row follows it.
  const tracked = await db.select({ outcomeId: outcomes.id, kind: outcomes.kind, messageKind: inboxMessages.kind }).from(outcomes)
    .innerJoin(inboxMessages, eq(inboxMessages.id, outcomes.messageId))
    .where(and(scope, eq(outcomes.source, "inbox"), isNull(outcomes.deletedAt)));
  for (const t of tracked) {
    const want = FROM_INBOX[t.messageKind];
    if (want === t.kind) continue;
    if (want) await db.update(outcomes).set({ kind: want }).where(eq(outcomes.id, t.outcomeId));
    else await db.delete(outcomes).where(eq(outcomes.id, t.outcomeId));
    res.corrected++;
  }

  // Confirmations: a receipt, not an outcome.
  const confirmations = await db.select({ id: inboxMessages.id, applicationId: inboxMessages.applicationId, receivedAt: inboxMessages.receivedAt, meta: inboxMessages.meta })
    .from(inboxMessages)
    .innerJoin(applications, and(eq(applications.id, inboxMessages.applicationId), eq(applications.userId, inboxMessages.userId)))
    .where(and(scope, eq(inboxMessages.kind, "confirmation"), isNull(applications.confirmedAt)))
    .orderBy(asc(inboxMessages.receivedAt));
  for (const m of confirmations) {
    if (!m.applicationId || !usable(m.meta)) continue;
    const done = await db.update(applications).set({
      confirmedAt: m.receivedAt,
      receipt: sql`coalesce(${applications.receipt}, '{}'::jsonb) || ${JSON.stringify({ confirmation: { messageId: m.id, at: m.receivedAt.toISOString() } })}::jsonb`,
    }).where(and(eq(applications.id, m.applicationId), isNull(applications.confirmedAt))).returning({ id: applications.id });
    res.confirmed += done.length;
  }

  res.stamped = await stampTailoringVersions(db, opts.userId);
  return res;
}

/** `off`, `v<N>` or `v<N>-selection`, from the resume's stored tailoring report (`resumes.ats_checks.tailoring`). */
const tailoringOfResumeSql = () => sql<string>`(
  SELECT CASE
    WHEN ${resumes.atsChecks} -> 'tailoring' IS NULL OR jsonb_typeof(${resumes.atsChecks} -> 'tailoring') <> 'object' THEN 'off'
    WHEN ${resumes.atsChecks} -> 'tailoring' ->> 'model' IS NULL THEN 'v' || coalesce(${resumes.atsChecks} -> 'tailoring' ->> 'version', '1') || '-selection'
    ELSE 'v' || coalesce(${resumes.atsChecks} -> 'tailoring' ->> 'version', '1')
  END FROM ${resumes} WHERE ${resumes.id} = ${applications.resumeId} AND ${resumes.applicationId} = ${applications.id}
)`;

/**
 * Records, once, which tailoring report version produced each submitted resume (`applications.tailoring_version`), so the
 * summary can compare tailoring on and off, and versions, even after resumes change.
 */
export async function stampTailoringVersions(db: Db, userId?: string): Promise<number> {
  const done = await db.update(applications).set({ tailoringVersion: sql`coalesce(${tailoringOfResumeSql()}, 'off')` })
    .where(and(isNull(applications.tailoringVersion), submittedSql(), userId ? eq(applications.userId, userId) : undefined))
    .returning({ id: applications.id });
  return done.length;
}

// ---- manual outcomes ---------------------------------------------------------------------------------------------------

export type OutcomeRow = { id: string; applicationId: string; kind: OutcomeKind; at: Date; source: "inbox" | "manual"; messageId: string | null };

const outcomeCols = { id: outcomes.id, applicationId: outcomes.applicationId, kind: outcomes.kind, at: outcomes.at, source: outcomes.source, messageId: outcomes.messageId };

/** Active outcomes of one application, oldest first. The caller checks ownership. */
export async function listOutcomes(db: Db, applicationId: string): Promise<OutcomeRow[]> {
  return db.select(outcomeCols).from(outcomes).where(and(eq(outcomes.applicationId, applicationId), isNull(outcomes.deletedAt))).orderBy(asc(outcomes.at), asc(outcomes.id));
}

/**
 * Adds an outcome the user reports (a reply that reached their own mailbox). An active outcome of the same kind already
 * there is returned instead of a second one. The caller checks ownership and that the application was submitted.
 */
export async function addManualOutcome(db: Db, applicationId: string, kind: OutcomeKind, at: Date): Promise<{ outcome: OutcomeRow; created: boolean }> {
  const [same] = await db.select(outcomeCols).from(outcomes)
    .where(and(eq(outcomes.applicationId, applicationId), eq(outcomes.kind, kind), isNull(outcomes.deletedAt))).limit(1);
  if (same) return { outcome: same, created: false };
  const [row] = await db.insert(outcomes).values({ applicationId, kind, at, source: "manual" }).returning(outcomeCols);
  return { outcome: row!, created: true };
}

/** Removes one outcome (soft: a re-read of its message never brings it back). False when there was nothing to remove. */
export async function removeOutcome(db: Db, applicationId: string, outcomeId: string, now: Date): Promise<boolean> {
  const done = await db.update(outcomes).set({ deletedAt: now })
    .where(and(eq(outcomes.id, outcomeId), eq(outcomes.applicationId, applicationId), isNull(outcomes.deletedAt))).returning({ id: outcomes.id });
  return done.length > 0;
}

/** Removes every active outcome of one kind on an application. Returns how many. */
export async function removeOutcomesOfKind(db: Db, applicationId: string, kind: OutcomeKind, now: Date): Promise<number> {
  const done = await db.update(outcomes).set({ deletedAt: now })
    .where(and(eq(outcomes.applicationId, applicationId), eq(outcomes.kind, kind), isNull(outcomes.deletedAt))).returning({ id: outcomes.id });
  return done.length;
}

// ---- the outcome nudge reason (written by outcome-learning.ts, read here for the raw fit) ------------------------------

/** Shortlist reason that carries an outcome nudge. It ends with the exact fit change, e.g. "(+0.03 fit)". */
export const OUTCOME_REASON_PREFIX = "From your replies: ";
const NUDGE_RE = /\(([+-]0\.\d\d) fit\)$/;

/** The fit change an outcome nudge made to a shortlist row (0 when none), so the raw fit can be recovered. */
export function outcomeNudgeOf(reasons: readonly string[] | null | undefined): number {
  for (const r of reasons ?? []) {
    if (!r.startsWith(OUTCOME_REASON_PREFIX)) continue;
    const m = NUDGE_RE.exec(r);
    if (m) return Number(m[1]);
  }
  return 0;
}

// ---- history ------------------------------------------------------------------------------------------------------------

export const FIT_BANDS = ["0.8+", "0.6-0.8", "widened", "under 0.6", "unranked"] as const;
export type FitBand = (typeof FIT_BANDS)[number];

/** The fit band of a shortlist row: widened rows apart, then by raw fit. Applications that never were on a shortlist are `unranked`. */
export function fitBandOf(fit: number | null, widened: boolean): FitBand {
  if (fit == null) return "unranked";
  if (widened) return "widened";
  if (fit >= 0.8) return "0.8+";
  if (fit >= 0.6) return "0.6-0.8";
  return "under 0.6";
}

/** Board size by open postings on the company's board at its last poll: the only company size signal we have. */
export type BoardSize = "small" | "mid-size" | "large" | "unknown";
export function boardSizeOf(openJobs: number | null | undefined): BoardSize {
  if (openJobs == null || openJobs <= 0) return "unknown";
  if (openJobs < 25) return "small";
  if (openJobs < 200) return "mid-size";
  return "large";
}

export type OutcomeHistoryRow = {
  applicationId: string;
  userId: string;
  jobId: string;
  title: string;
  companyName: string;
  /** Job system. */
  system: string;
  roleFamily: string;
  seniority: string;
  boardSize: BoardSize;
  submittedAt: Date;
  confirmedAt: Date | null;
  /** Shortlist fit without any outcome nudge; null when the job never was on the user's shortlist. */
  fit: number | null;
  band: FitBand;
  /** `off`, `v1`, `v1-selection` ... */
  tailoring: string;
  /** Active outcomes, oldest first. */
  outcomes: Array<{ kind: OutcomeKind; at: Date }>;
};

const CHUNK = 1000;

/** Submitted applications with their job, fit band, tailoring version and active outcomes. One user, or all (product report). */
export async function loadOutcomeHistory(db: Db, opts: { userId?: string; since?: Date } = {}): Promise<OutcomeHistoryRow[]> {
  const submittedAtSql = sql<Date>`coalesce(${applications.submittedAt}, ${applications.updatedAt})`.mapWith((v) => new Date(v as string));
  const base = await db.select({
    applicationId: applications.id, userId: applications.userId, jobId: applications.jobId, submittedAt: submittedAtSql, confirmedAt: applications.confirmedAt,
    tailoringVersion: applications.tailoringVersion, tailoringLive: tailoringOfResumeSql(),
    title: jobs.title, system: jobs.atsType, companyName: companies.name, openJobs: companies.lastJobCount, fit: shortlist.fit, reasons: shortlist.reasons,
  }).from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(shortlist, and(eq(shortlist.userId, applications.userId), eq(shortlist.jobId, applications.jobId)))
    .where(and(
      submittedSql(),
      opts.userId ? eq(applications.userId, opts.userId) : undefined,
      opts.since ? sql`coalesce(${applications.submittedAt}, ${applications.updatedAt}) >= ${opts.since.toISOString()}::timestamptz` : undefined,
    ))
    .orderBy(asc(applications.createdAt));
  if (base.length === 0) return [];

  const seniority = new Map<string, string>();
  const byApp = new Map<string, Array<{ kind: OutcomeKind; at: Date }>>();
  const jobIds = [...new Set(base.map((b) => b.jobId))];
  const appIds = base.map((b) => b.applicationId);
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    // Ascending versions: the newest spec wins.
    const specs = await db.select({ jobId: jobSpecs.jobId, seniority: sql<string | null>`${jobSpecs.spec} ->> 'seniority'` }).from(jobSpecs)
      .where(inArray(jobSpecs.jobId, jobIds.slice(i, i + CHUNK))).orderBy(asc(jobSpecs.version));
    for (const s of specs) if (s.seniority) seniority.set(s.jobId, s.seniority);
  }
  for (let i = 0; i < appIds.length; i += CHUNK) {
    const rows = await db.select({ applicationId: outcomes.applicationId, kind: outcomes.kind, at: outcomes.at }).from(outcomes)
      .where(and(inArray(outcomes.applicationId, appIds.slice(i, i + CHUNK)), isNull(outcomes.deletedAt))).orderBy(asc(outcomes.at));
    for (const r of rows) byApp.set(r.applicationId, [...(byApp.get(r.applicationId) ?? []), { kind: r.kind, at: r.at }]);
  }

  return base.map((b) => {
    const role = roleFamilyOf(b.title);
    const specSeniority = seniority.get(b.jobId);
    const widened = (b.reasons ?? []).some((r) => r.startsWith("widened:"));
    const fit = b.fit == null ? null : Math.round((Number(b.fit) - outcomeNudgeOf(b.reasons)) * 1000) / 1000;
    return {
      applicationId: b.applicationId, userId: b.userId, jobId: b.jobId, title: b.title, companyName: b.companyName, system: b.system,
      roleFamily: role.family, seniority: specSeniority && specSeniority !== "unknown" ? specSeniority : role.seniority,
      boardSize: boardSizeOf(b.openJobs), submittedAt: b.submittedAt, confirmedAt: b.confirmedAt,
      fit, band: fitBandOf(fit, widened), tailoring: b.tailoringVersion ?? b.tailoringLive ?? "off",
      outcomes: byApp.get(b.applicationId) ?? [],
    };
  });
}

// ---- resolution and summary --------------------------------------------------------------------------------------------

export type OutcomeState = "offer" | "interview" | "reply" | "rejection" | "no_response" | "pending";

export type Resolution = {
  /** The best thing that happened: offer > interview > reply > rejection; else no response after 30 days; else pending. */
  state: OutcomeState;
  /** Any outcome at all (a rejection is a response). */
  responded: boolean;
  interviewed: boolean;
  rejected: boolean;
  offered: boolean;
  /** Not pending: it has an outcome or 30 days of silence. Rates are taken over settled applications. */
  settled: boolean;
  daysToFirstReply: number | null;
};

export function resolveApplication(row: Pick<OutcomeHistoryRow, "submittedAt" | "outcomes">, now: Date): Resolution {
  const kinds = new Set(row.outcomes.map((o) => o.kind));
  const offered = kinds.has("offer");
  const interviewed = offered || kinds.has("interview");
  const rejected = kinds.has("rejection");
  const responded = row.outcomes.length > 0;
  const silentDays = (now.getTime() - row.submittedAt.getTime()) / DAY_MS;
  const state: OutcomeState = offered ? "offer" : interviewed ? "interview" : kinds.has("reply") ? "reply" : rejected ? "rejection"
    : silentDays >= NO_RESPONSE_DAYS ? "no_response" : "pending";
  const first = responded ? Math.min(...row.outcomes.map((o) => o.at.getTime())) : null;
  return {
    state, responded, interviewed, rejected, offered, settled: state !== "pending",
    daysToFirstReply: first == null ? null : Math.max(0, Math.round(((first - row.submittedAt.getTime()) / DAY_MS) * 10) / 10),
  };
}

export type OutcomeStats = {
  key: string;
  /** Submitted applications. */
  applications: number;
  /** With an outcome or 30 days of silence; the denominator of every rate. */
  settled: number;
  /** Submitted under 30 days ago with no outcome yet. */
  pending: number;
  responses: number;
  interviews: number;
  rejections: number;
  offers: number;
  noResponse: number;
  /** Null when fewer than 5 applications are settled (counts only). */
  responseRate: number | null;
  interviewRate: number | null;
  rejectionRate: number | null;
  /** Null when fewer than 5 applications got a reply. */
  medianDaysToFirstReply: number | null;
  /** Fewer than 5 settled applications: read the counts, not a rate. */
  smallSample: boolean;
};

export type OutcomeSummary = {
  overall: OutcomeStats;
  bySystem: OutcomeStats[];
  byRoleFamily: OutcomeStats[];
  byFitBand: OutcomeStats[];
  /** Tailoring off, or the tailoring report version that produced the resume. */
  byResume: OutcomeStats[];
  minSample: number;
  noResponseDays: number;
};

const rate = (n: number, d: number) => Math.round((n / d) * 1000) / 1000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

export function statsOf(key: string, rows: ReadonlyArray<{ r: Resolution }>): OutcomeStats {
  const settled = rows.filter((x) => x.r.settled);
  const count = (f: (r: Resolution) => boolean) => rows.filter((x) => f(x.r)).length;
  const responses = count((r) => r.responded);
  const interviews = count((r) => r.interviewed);
  const rejections = count((r) => r.rejected);
  const small = settled.length < SMALL_SAMPLE;
  const days = rows.flatMap((x) => (x.r.daysToFirstReply == null ? [] : [x.r.daysToFirstReply]));
  return {
    key, applications: rows.length, settled: settled.length, pending: rows.length - settled.length,
    responses, interviews, rejections, offers: count((r) => r.offered), noResponse: count((r) => r.state === "no_response"),
    // Responses can only come from settled applications (an outcome settles one), so settled is the honest denominator.
    responseRate: small ? null : rate(responses, settled.length),
    interviewRate: small ? null : rate(interviews, settled.length),
    rejectionRate: small ? null : rate(rejections, settled.length),
    medianDaysToFirstReply: days.length < SMALL_SAMPLE ? null : median(days),
    smallSample: small,
  };
}

function groupBy(rows: ReadonlyArray<{ row: OutcomeHistoryRow; r: Resolution }>, keyOf: (row: OutcomeHistoryRow) => string, order?: readonly string[]): OutcomeStats[] {
  const groups = new Map<string, Array<{ r: Resolution }>>();
  for (const x of rows) {
    const k = keyOf(x.row);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const out = [...groups].map(([k, g]) => statsOf(k, g));
  return order
    ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    : out.sort((a, b) => b.applications - a.applications || a.key.localeCompare(b.key));
}

/** Response, interview and rejection rates and the median days to a first reply, overall and by system, role family, fit band and resume. */
export function summarizeOutcomes(history: readonly OutcomeHistoryRow[], now: Date): OutcomeSummary {
  const rows = history.map((row) => ({ row, r: resolveApplication(row, now) }));
  return {
    overall: statsOf("all", rows),
    bySystem: groupBy(rows, (h) => h.system),
    byRoleFamily: groupBy(rows, (h) => h.roleFamily),
    byFitBand: groupBy(rows, (h) => h.band, FIT_BANDS),
    byResume: groupBy(rows, (h) => h.tailoring),
    minSample: SMALL_SAMPLE,
    noResponseDays: NO_RESPONSE_DAYS,
  };
}
