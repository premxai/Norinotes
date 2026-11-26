/**
 * Strong fits, fast: a new job that fits a person this well (shortlist fit 0.8 or more) is prepared ahead, right after
 * it is matched, so it can be sent within hours of posting instead of waiting for the next scheduled run or a click.
 * Only for people who asked Nori to act for them (the caller decides who: the schedule, or a linked Telegram).
 * Preparing is not sending: an application prepared ahead waits for the person's OK, unless the person turned on the
 * schedule (autopilot): then it is sent as soon as it is prepared (`autopilotStrongFit`).
 */
import { and, applications, companies, eq, gte, inArray, jobs, ne, runEvents, shortlist, sql, type Db } from "@norinote/db";
import { getNoriSettings, RECENT_COMPANY_DAYS, recentlyAppliedCompanies } from "./batch.js";
import { getSchedule, type NoriSchedule } from "./schedule.js";
import { approveAndSubmit, capDayStart, createApplication, loadApplication, logEvent, normalizeCompany } from "./store.js";

/** The fit at which a job counts as a strong fit (the "Strong fit" band). */
export const STRONG_FIT = 0.8;
/** The run-log step that marks an application Nori prepared ahead for a strong fit. */
export const STRONG_FIT_STEP = "strong_fit";

export type StrongFit = { userId: string; jobId: string; fit: number };

/** Of these jobs, the new shortlist rows at or above STRONG_FIT, per person, best first. */
export async function newStrongFits(db: Db, jobIds: readonly string[]): Promise<StrongFit[]> {
  if (jobIds.length === 0) return [];
  const rows = await db.select({ userId: shortlist.userId, jobId: shortlist.jobId, fit: shortlist.fit }).from(shortlist)
    .where(and(inArray(shortlist.jobId, [...jobIds]), eq(shortlist.status, "new"), gte(shortlist.fit, STRONG_FIT)));
  return rows.sort((a, b) => b.fit - a.fit);
}

export type PrepareAheadResult = { created: Array<{ jobId: string; applicationId: string; fit: number }>; skipped: Array<{ jobId: string; reason: string }> };

/**
 * Creates an application for each of the person's strong fits so the worker can prepare it now. The same rules as an
 * "Apply for me" batch: never a company on the skip list or one applied to in the last 60 days, one job per company, only
 * the job systems Nori sends through (`atsTypes`, empty = all). At most the person's daily limit of strong fits a day
 * is prepared ahead, so a burst of postings cannot run up the AI spend. Returns the applications to queue
 * `prepare.application` for.
 */
export async function prepareStrongFitsAhead(db: Db, userId: string, fits: readonly StrongFit[], opts: { now: Date; atsTypes?: readonly string[] | null }): Promise<PrepareAheadResult> {
  const out: PrepareAheadResult = { created: [], skipped: [] };
  const mine = fits.filter((f) => f.userId === userId);
  if (mine.length === 0) return out;
  const settings = await getNoriSettings(db, userId);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(runEvents).innerJoin(applications, eq(applications.id, runEvents.applicationId))
    .where(and(eq(applications.userId, userId), eq(runEvents.step, STRONG_FIT_STEP), gte(applications.createdAt, capDayStart(opts.now))));
  let room = settings.dailyLimit - Number(today?.n ?? 0);
  const skip = new Set(settings.skipCompanies.map(normalizeCompany));
  const recent = await recentlyAppliedCompanies(db, userId, opts.now);
  const rows = await db.select({ id: jobs.id, companyId: jobs.companyId, companyName: companies.name, atsType: jobs.atsType }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId)).where(inArray(jobs.id, mine.map((f) => f.jobId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const f of mine) {
    const job = byId.get(f.jobId);
    const reason = !job ? "not_found"
      : opts.atsTypes?.length && !opts.atsTypes.includes(job.atsType) ? "not_supported"
      : skip.has(normalizeCompany(job.companyName)) ? "skipped_company"
      : recent.blocks(job.companyId, job.id) ? "applied_recently"
      : seen.has(job.companyId) ? "same_company"
      : room <= 0 ? "daily_limit"
      : null;
    if (reason) { out.skipped.push({ jobId: f.jobId, reason }); continue; }
    seen.add(job!.companyId);
    const res = await createApplication(db, userId, f.jobId, { now: opts.now });
    if (!res.created) { out.skipped.push({ jobId: f.jobId, reason: res.reason }); continue; }
    room--;
    await logEvent(db, res.application.id, STRONG_FIT_STEP, `Strong fit (${Math.round(f.fit * 100)}%): Nori prepares it right away`, { data: { fit: f.fit } });
    out.created.push({ jobId: f.jobId, applicationId: res.application.id, fit: f.fit });
  }
  return out;
}

/**
 * Whether autopilot sends a prepared strong fit on its own: only when the person turned the schedule on and has not
 * paused it. The one place this is decided, so the apply decision policy (PRE-31) can replace it.
 */
export function autopilotSendsStrongFit(s: { schedule: NoriSchedule; fit: number | null }): boolean {
  return s.schedule.enabled && !s.schedule.paused && s.fit !== null && s.fit >= STRONG_FIT;
}

export type AutopilotResult = { started: boolean; reason?: string };

/**
 * Autopilot for strong fits: a strong fit Nori prepared ahead goes to the employer's form as soon as it is prepared,
 * instead of waiting for the next scheduled run, when `autopilotSendsStrongFit` says so. Within the same limits as a
 * scheduled batch: the daily limit (counted and stamped atomically by `approveAndSubmit` under the person's lock), no
 * company on the skip list or applied to in the last 60 days, only the job systems Nori sends through. When it does not
 * send, the application stays prepared for the person (and the Telegram alert offers Apply). `started` means the caller
 * must queue `apply.run` (trigger autopilot).
 */
export async function autopilotStrongFit(db: Db, applicationId: string, opts: { now: Date; atsTypes?: readonly string[] | null }): Promise<AutopilotResult> {
  const app = await loadApplication(db, applicationId);
  if (!app || app.status !== "prepared" || app.approvedAt || app.attempts > 0) return { started: false, reason: "not_waiting" };
  const [marked] = await db.select({ data: runEvents.data }).from(runEvents)
    .where(and(eq(runEvents.applicationId, app.id), eq(runEvents.step, STRONG_FIT_STEP))).limit(1);
  if (!marked) return { started: false, reason: "not_strong_fit" };
  const [row] = await db.select({ fit: shortlist.fit }).from(shortlist).where(and(eq(shortlist.userId, app.userId), eq(shortlist.jobId, app.jobId))).limit(1);
  if (!autopilotSendsStrongFit({ schedule: await getSchedule(db, app.userId), fit: row?.fit ?? null })) return { started: false, reason: "autopilot_off" };

  const [job] = await db.select({ companyId: jobs.companyId, companyName: companies.name, atsType: jobs.atsType }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, app.jobId)).limit(1);
  if (!job) return { started: false, reason: "not_found" };
  if (opts.atsTypes?.length && !opts.atsTypes.includes(job.atsType)) return { started: false, reason: "not_supported" };
  const settings = await getNoriSettings(db, app.userId);
  if (settings.skipCompanies.map(normalizeCompany).includes(normalizeCompany(job.companyName))) return { started: false, reason: "skipped_company" };
  // Another application at this company in the cooldown window (this one counts itself, so it is left out).
  const since = new Date(opts.now.getTime() - RECENT_COMPANY_DAYS * 86_400_000);
  const [other] = await db.select({ id: applications.id }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, app.userId), eq(jobs.companyId, job.companyId), ne(applications.id, app.id), gte(applications.createdAt, since), ne(applications.status, "failed"))).limit(1);
  if (other) return { started: false, reason: "applied_recently" };

  const res = await approveAndSubmit(db, app.id, { now: opts.now, limit: settings.dailyLimit });
  if (!res.ok) return { started: false, reason: res.cap ? "daily_limit" : res.reason };
  if (res.started) await logEvent(db, app.id, "autopilot", "Autopilot sent this strong fit as soon as it was prepared", { data: { fit: row?.fit ?? null } });
  return { started: res.started };
}
