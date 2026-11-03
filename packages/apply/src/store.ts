import type { ApplicationStatus } from "@norinote/shared";
import { and, applications, companies, eq, gte, jobs, or, runEvents } from "@norinote/db";
import type { Db } from "@norinote/db";
import { checkTransition, transitionPatch, type AppSnapshot, type TransitionOptions } from "./state.js";
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
    r.app.status !== "failed" && normalizeTitle(r.title) === title && (r.companyId === job.companyId || normalizeCompany(r.companyName) === company));
  if (duplicate) return { created: false, reason: "duplicate_recent", application: duplicate.app };

  try {
    const [row] = await db.insert(applications).values({ userId, jobId, canonicalUrl, status: "queued", createdAt: now, updatedAt: now }).returning();
    await logEvent(db, row!.id, "created", `Queued ${job.title} at ${job.companyName}`);
    return { created: true, application: row! };
  } catch (err) {
    // Two clicks at once: the unique (user, job) and (user, canonical URL) indexes let one through.
    const [again] = await db.select().from(applications).where(and(eq(applications.userId, userId), or(eq(applications.jobId, jobId), eq(applications.canonicalUrl, canonicalUrl)))).limit(1);
    if (again) return { created: false, reason: "already_exists", application: again };
    throw err;
  }
}

export type ApproveResult =
  | { ok: true; status: ApplicationStatus; /** True when this call started the apply step; the caller should enqueue `apply.run`. */ started: boolean }
  | { ok: false; status: ApplicationStatus | null; reason: string };

/**
 * A user click on a prepared application: approve it and move it to `applying`. Safe to call twice (a double click):
 * the second call finds it already underway and changes nothing. The caller enqueues `apply.run` when `started` is true.
 */
export async function approveAndSubmit(db: Db, applicationId: string, opts: { now?: Date } = {}): Promise<ApproveResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, status: null, reason: "application not found" };
  if (row.status === "applying" || row.status === "awaiting_code" || row.status === "submitted") return { ok: true, status: row.status, started: false };
  if (row.status !== "prepared" && row.status !== "needs_user") return { ok: false, status: row.status, reason: `not ready to submit (${row.status})` };

  const res = await transitionApplication(db, applicationId, "applying", {
    now: opts.now, approve: true, from: row.status,
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

/** The user asks to try again: a failed application goes back to the queue, a parked one resumes. */
export async function retryApplication(db: Db, applicationId: string): Promise<TransitionResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return { ok: false, reason: "application not found", application: null };
  if (row.status === "failed") return transitionApplication(db, applicationId, "queued", { by: "user", message: "Retry requested by the user" });
  if (row.status === "needs_user") {
    const to = row.resumeId && row.approvedAt ? "applying" : "preparing";
    return transitionApplication(db, applicationId, to, { by: "user", message: "Resumed by the user" });
  }
  return { ok: false, reason: `nothing to retry in ${row.status}`, application: row };
}
