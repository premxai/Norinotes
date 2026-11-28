import type { ApplicationStatus } from "@norinote/shared";
import { and, applications, companies, eq, gte, isNull, jobs, ne, or, profiles, runEvents, shortlist, sql, users } from "@norinote/db";
import type { Db } from "@norinote/db";
import { capDayStart, effectiveDailyCap, readTimeZone } from "./day.js";
import { checkTransition, submitMayHaveHappened, transitionPatch, type AppSnapshot, type TransitionOptions } from "./state.js";
import { canonicalJobUrl } from "./schema.js";

export type ApplicationRow = typeof applications.$inferSelect;

export const DUPLICATE_WINDOW_DAYS = 30;

const snapshot = (row: ApplicationRow): AppSnapshot => ({
  status: row.status,
  resumeId: row.resumeId,
  answers: row.answers,
  pendingQuestions: row.pendingQuestions,
  receipt: row.receipt,
  error: row.error,
  attempts: row.attempts,
  approvedAt: row.approvedAt,
});

export async function loadApplication(db: Db, applicationId: string): Promise<ApplicationRow | null> {
  const [row] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  return row ?? null;
}

export type LogOptions = { level?: "info" | "warn" | "error"; data?: Record<string, unknown> | null };

/** Append one line to the application's run log. Every state change and every driver step goes through here. */
export async function logEvent(db: Db, applicationId: string, step: string, message: string, opts: LogOptions = {}): Promise<void> {
  await db.insert(runEvents).values({ applicationId, step, level: opts.level ?? "info", message, data: opts.data ?? null });
}

export type TransitionResult =
  | { ok: true; noop: boolean; application: ApplicationRow }
  | { ok: false; reason: string; application: ApplicationRow | null };

export type StoreTransitionOptions = TransitionOptions & {
  /** Run-log message. Default: "<from> -> <to>". */
  message?: string;
  data?: Record<string, unknown> | null;
  /** Expected current status. The update only applies when the row still has it. */
  from?: ApplicationStatus;
  /** Stamp `approved_at` as part of this move (a user click, or autopilot). */
  approve?: boolean;
};

/**
 * Move an application to a new status if the state machine allows it, with an optimistic update (the row must still be in
 * the status we read), and write the run event. Asking for the status it already has succeeds as a no-op, so retries are safe.
 */
export async function transitionApplication(db: Db, applicationId: string, to: ApplicationStatus, opts: StoreTransitionOptions = {}): Promise<TransitionResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, reason: "application not found", application: null };
  if (opts.from && row.status !== opts.from) {
    if (row.status === to) return { ok: true, noop: true, application: row };
    return { ok: false, reason: `expected ${opts.from} but found ${row.status}`, application: row };
  }
  if (row.status === to) return { ok: true, noop: true, application: row };

  const now = opts.now ?? new Date();
  const snap = snapshot(row);
  if (opts.approve && !snap.approvedAt) snap.approvedAt = now;
  const check = checkTransition(snap, to, opts);
  if (!check.ok) return { ok: false, reason: check.reason, application: row };

  const patch = transitionPatch(snap, to, { ...opts, now });
  const [updated] = await db.update(applications)
    .set({ ...patch, ...(opts.approve && !row.approvedAt ? { approvedAt: now } : {}) })
    .where(and(eq(applications.id, applicationId), eq(applications.status, row.status)))
    .returning();
  if (!updated) return { ok: false, reason: "status changed concurrently", application: await loadApplication(db, applicationId) };

  await logEvent(db, applicationId, `status:${to}`, opts.message ?? `${row.status} -> ${to}`, {
    level: to === "failed" ? "error" : to === "needs_user" ? "warn" : "info",
    data: { from: row.status, to, ...(opts.data ?? {}) },
  });
  return { ok: true, noop: false, application: updated };
}

// ---------------------------------------------------------------------------------------------------------------------
// Creating, approving, retrying
// ---------------------------------------------------------------------------------------------------------------------

/** Lower case, no punctuation or parentheticals, "Sr." -> "senior": so "Sr. Software Engineer (Remote)" matches "Senior Software Engineer". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\bsr\b\.?/g, "senior")
    .replace(/\bjr\b\.?/g, "junior")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const normalizeCompany = (name: string): string => name.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export type CreateApplicationResult =
  | { created: true; application: ApplicationRow }
  /** The user already has an application for this very job. */
  | { created: false; reason: "already_exists"; application: ApplicationRow }
  /** A different posting of the same company and title was applied to within the last 30 days. */
  | { created: false; reason: "duplicate_recent"; application: ApplicationRow }
  | { created: false; reason: "job_not_found"; application: null };

/**
 * Queue an application for a job. One per user and job. Also refuses a second posting of the same company and normalised
 * title within 30 days (the same role listed on two boards, or reposted), so the employer never hears from us twice.
 */
export async function createApplication(db: Db, userId: string, jobId: string, opts: { now?: Date } = {}): Promise<CreateApplicationResult> {
  const now = opts.now ?? new Date();
  const [existing] = await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1);
  if (existing) return { created: false, reason: "already_exists", application: existing };

  const [job] = await db.select({ id: jobs.id, title: jobs.title, companyId: jobs.companyId, companyName: companies.name, applyUrl: jobs.applyUrl })
    .from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return { created: false, reason: "job_not_found", application: null };
  // The same posting reached through another job row (another board, a tracking link): one application per URL.
  const canonicalUrl = canonicalJobUrl(job.applyUrl);
  const [sameUrl] = await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.canonicalUrl, canonicalUrl))).limit(1);
  if (sameUrl) return { created: false, reason: "already_exists", application: sameUrl };

  const cutoff = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const recent = await db.select({ app: applications, title: jobs.title, companyId: jobs.companyId, companyName: companies.name })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, cutoff)));
  const title = normalizeTitle(job.title);
  const company = normalizeCompany(job.companyName);
  const duplicate = recent.find((r) =>
    countsAsApplication(r.app) && normalizeTitle(r.title) === title && (r.companyId === job.companyId || normalizeCompany(r.companyName) === company));
  if (duplicate) return { created: false, reason: "duplicate_recent", application: duplicate.app };

  // Two inserts at once: the unique (user, job) and (user, canonical URL) indexes let one through. `onConflictDoNothing`
  // keeps a caller's surrounding transaction usable when it loses that race.
  const [row] = await db.insert(applications).values({ userId, jobId, canonicalUrl, status: "queued", createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
  if (!row) {
    const [again] = await db.select().from(applications).where(and(eq(applications.userId, userId), or(eq(applications.jobId, jobId), eq(applications.canonicalUrl, canonicalUrl)))).limit(1);
    if (again) return { created: false, reason: "already_exists", application: again };
    throw new Error("an application for this job was refused as a duplicate but no existing row was found");
  }
  await logEvent(db, row.id, "created", `Queued ${job.title} at ${job.companyName}`);
  // Whoever started it (Apply, a batch, Telegram), the job leaves the person's recommended list.
  await db.update(shortlist).set({ status: "applied" }).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId), eq(shortlist.status, "new")));
  return { created: true, application: row };
}

/**
 * Whether this application counts as one the employer may have: anything but a failure, and a failure that came after
 * the submit click (the receipt's mark is set). A failed row the person cancelled, or one that never reached the
 * click, does not hold the job or the company.
 */
export function countsAsApplication(row: Pick<ApplicationRow, "status" | "receipt">): boolean {
  return row.status !== "failed" || submitMayHaveHappened({ receipt: row.receipt });
}

export type ApproveResult =
  | { ok: true; status: ApplicationStatus; /** True when this call started the apply step; the caller should enqueue `apply.run`. */ started: boolean }
  | { ok: false; status: ApplicationStatus | null; reason: string; /** Set when today's limit stopped it. */ cap?: DailyCap };

/** The user's daily limit and today's approvals against it. */
export type DailyCap = { cap: number; used: number };

/** The day a daily limit counts in, and how a stored 0 reads: see day.ts. Re-exported here for the callers that use it. */
export { capDayStart, DEFAULT_DAILY_CAP, effectiveDailyCap } from "./day.js";

/**
 * The daily limit (`profiles.daily_cap`, 0 = not set, so `DEFAULT_DAILY_CAP`) and how many applications were approved in
 * the person's own day (their schedule's time zone, see day.ts; an application counts from its approval, by a click,
 * Telegram, autopilot or a batch). `except` leaves one application out.
 */
export async function dailyCapUse(db: Db, userId: string, now: Date, except?: string): Promise<DailyCap> {
  const [profile] = await db.select({ cap: profiles.dailyCap, preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(applications)
    .where(and(eq(applications.userId, userId), gte(applications.approvedAt, capDayStart(now, readTimeZone(profile?.preferences))), except ? ne(applications.id, except) : undefined));
  return { cap: effectiveDailyCap(profile?.cap), used: used?.n ?? 0 };
}

/**
 * The limit and today's use when one more approval would go over it; null when there is room. `limit` replaces the
 * person's own limit (a batch passes the same one when they set none).
 */
export async function dailyCapReached(db: Db, userId: string, now: Date, except?: string, limit?: number): Promise<DailyCap | null> {
  const use = await dailyCapUse(db, userId, now, except);
  const cap = { cap: limit ?? use.cap, used: use.used };
  return cap.used >= cap.cap ? cap : null;
}

/**
 * Runs `fn` in a transaction that holds the user's row lock, so one user's approvals (a click, Telegram, a batch) and
 * their batches' inserts take turns: each counts today's approvals and stamps its own before the next one counts, and a
 * batch's company checks see the applications another batch just added. `fn` must use the `tx` it gets.
 */
export function withUserLock<T>(db: Db, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    return fn(tx);
  });
}

export type ApproveLaterResult = { ok: true; approved: boolean } | { ok: false; cap: DailyCap };

/**
 * Approval of an application that is not prepared yet (Apply with send, a Telegram tap): stamps `approved_at` so the
 * worker sends it once it is prepared. Counts against the daily limit under the user's lock. `approved` is false when
 * nothing changed (already approved, or no longer queued or preparing).
 */
export async function approveBeforePrepared(db: Db, applicationId: string, opts: { now?: Date; message: string; data?: Record<string, unknown> }): Promise<ApproveLaterResult> {
  const head = await loadApplication(db, applicationId);
  if (!head) return { ok: true, approved: false };
  const now = opts.now ?? new Date();
  return withUserLock(db, head.userId, async (tx) => {
    const row = await loadApplication(tx, applicationId);
    if (!row || row.approvedAt || (row.status !== "queued" && row.status !== "preparing")) return { ok: true, approved: false };
    const cap = await dailyCapReached(tx, row.userId, now, row.id);
    if (cap) return { ok: false, cap };
    const marked = await tx.update(applications).set({ approvedAt: now, updatedAt: now })
      .where(and(eq(applications.id, applicationId), isNull(applications.approvedAt))).returning({ id: applications.id });
    if (!marked.length) return { ok: true, approved: false };
    await logEvent(tx, applicationId, "approved", opts.message, { data: opts.data ?? null });
    return { ok: true, approved: true };
  });
}

/**
 * A user click on a prepared application: approve it and move it to `applying`. Safe to call twice (a double click):
 * the second call finds it already underway and changes nothing. The caller enqueues `apply.run` when `started` is true.
 * A first approval counts against the daily limit; when the limit is used up nothing changes and `cap` says so. One
 * approved earlier (Telegram before it was prepared, or before its questions were answered) has already counted.
 * `by: "user"` when the person answered or clicked: a parked application then starts a fresh set of attempts.
 * `limit` replaces the profile's daily limit (a batch passes its own). The count and the approval happen under the
 * user's lock, so two approvals at once cannot both take the last place.
 */
export async function approveAndSubmit(db: Db, applicationId: string, opts: { now?: Date; by?: "system" | "user"; limit?: number } = {}): Promise<ApproveResult> {
  const head = await loadApplication(db, applicationId);
  if (!head) return { ok: false, status: null, reason: "application not found" };
  return withUserLock(db, head.userId, (tx) => approveLocked(tx, applicationId, opts));
}

async function approveLocked(db: Db, applicationId: string, opts: { now?: Date; by?: "system" | "user"; limit?: number }): Promise<ApproveResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, status: null, reason: "application not found" };
  if (row.status === "applying" || row.status === "awaiting_code" || row.status === "submitted") return { ok: true, status: row.status, started: false };
  if (row.status !== "prepared" && row.status !== "needs_user") return { ok: false, status: row.status, reason: `not ready to submit (${row.status})` };
  // Parked with no question to answer (a captcha, an unsupported form, a code that never came): approving again would
  // only run into the same thing. Retry is the way back once the person has sorted it out.
  if (row.status === "needs_user" && row.pendingQuestions.length === 0) {
    return { ok: false, status: row.status, reason: `nothing to answer here${row.error ? ` (${row.error})` : ""}; use Retry once it is sorted out` };
  }
  if (!row.approvedAt) {
    const cap = await dailyCapReached(db, row.userId, opts.now ?? new Date(), row.id, opts.limit);
    if (cap) return { ok: false, status: row.status, reason: `today's limit of ${cap.cap} applications is used up`, cap };
  }

  const res = await transitionApplication(db, applicationId, "applying", {
    now: opts.now, approve: true, from: row.status, by: opts.by,
    message: row.status === "prepared" ? "Approved by the user; applying" : "Approved; applying with the new answers",
    data: { approvedBy: "user" },
  });
  if (res.ok) return { ok: true, status: res.application.status, started: !res.noop };
  // Needs the user's answers first: remember the approval, wait for the answers.
  if (row.status === "needs_user" && !row.approvedAt) {
    await db.update(applications).set({ approvedAt: opts.now ?? new Date() }).where(eq(applications.id, applicationId));
  }
  return { ok: false, status: res.application?.status ?? row.status, reason: res.reason };
}

/** Merge answers the user gave (question id or text -> answer) into the application. */
export async function saveAnswers(db: Db, applicationId: string, answers: Record<string, string>): Promise<ApplicationRow | null> {
  const row = await loadApplication(db, applicationId);
  if (!row) return null;
  const merged = { ...row.answers, ...answers };
  const [updated] = await db.update(applications).set({ answers: merged, updatedAt: new Date() }).where(eq(applications.id, applicationId)).returning();
  await logEvent(db, applicationId, "answers", `Saved ${Object.keys(answers).length} answer(s)`, { data: { questions: Object.keys(answers) } });
  return updated ?? null;
}

/**
 * The person says an application reached the employer after all (Nori clicked submit and could not confirm it, or they
 * finished it themselves on the employer's site). Only their own word moves it: the worker never does.
 */
export async function markSent(db: Db, applicationId: string, opts: { now?: Date } = {}): Promise<TransitionResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, reason: "application not found", application: null };
  const now = opts.now ?? new Date();
  return transitionApplication(db, applicationId, "submitted", {
    by: "user", now, from: row.status,
    receipt: { ...(row.receipt ?? {}), markedSent: true, markedSentAt: now.toISOString() },
    message: "You marked it as sent",
  });
}

/**
 * The person says it did not reach the employer: the submit-click mark goes, so Retry may send it again and Cancel is
 * allowed. Only a parked application with a marked click can be cleared, and only by the person.
 */
export async function clearSubmitClick(db: Db, applicationId: string, opts: { now?: Date } = {}): Promise<{ ok: boolean; reason?: string; application: ApplicationRow | null }> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, reason: "application not found", application: null };
  if (row.status !== "needs_user" && row.status !== "failed") return { ok: false, reason: `this application is ${row.status}`, application: row };
  if (!submitMayHaveHappened(row)) return { ok: false, reason: "no submit click is marked on this application", application: row };
  const now = opts.now ?? new Date();
  const { submitClicked: _clicked, awaitingCode: _code, codeMissing: _missing, captchaHeld: _held, ...rest } = (row.receipt ?? {}) as Record<string, unknown>;
  const [updated] = await db.update(applications)
    .set({ receipt: { ...rest, clickClearedAt: now.toISOString() }, updatedAt: now })
    .where(and(eq(applications.id, applicationId), eq(applications.status, row.status)))
    .returning();
  if (!updated) return { ok: false, reason: "status changed concurrently", application: await loadApplication(db, applicationId) };
  await logEvent(db, applicationId, "click_cleared", "You said it did not go through; the submit mark is cleared", { level: "warn", data: { from: row.status } });
  return { ok: true, application: updated };
}

/** The user asks to try again: a failed application goes back to the queue, a parked one resumes. */
export async function retryApplication(db: Db, applicationId: string): Promise<TransitionResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, reason: "application not found", application: null };
  // The employer may already have it: say which first (markSent, or clearSubmitClick), then Retry can send it again.
  if (submitMayHaveHappened(row)) return { ok: false, reason: "submit was already clicked; say whether it reached the employer first", application: row };
  if (row.status === "failed") return transitionApplication(db, applicationId, "queued", { by: "user", message: "Retry requested by the user" });
  if (row.status === "needs_user") {
    const to = row.resumeId && row.approvedAt ? "applying" : "preparing";
    return transitionApplication(db, applicationId, to, { by: "user", message: "Resumed by the user" });
  }
  // One step left, tried again without the live view: a captcha is not always shown twice.
  if (row.status === "ready_to_finish") return transitionApplication(db, applicationId, "applying", { by: "user", message: "Tried again by the user" });
  return { ok: false, reason: `nothing to retry in ${row.status}`, application: row };
}
