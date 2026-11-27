/**
 * Strong fits, fast: a new job that fits a person this well (shortlist fit 0.8 or more) is prepared ahead, right after
 * it is matched, so it can be sent within hours of posting instead of waiting for the next scheduled run or a click.
 * Only for people who asked Nori to act for them (the caller decides who: the schedule, or a linked Telegram).
 * Preparing is not sending: an application prepared ahead waits for the person's OK, unless the person turned on the
 * schedule (autopilot) and the apply decision says to send it: then it is sent as soon as it is prepared
 * (`autopilotStrongFit`).
 */
import { and, applications, companies, eq, gte, inArray, jobs, runEvents, shortlist, sql, type Db } from "@norinote/db";
import { decideApplies, type ApplyAction, type ApplyGroup } from "@norinote/match";
import { getNoriSettings, recentlyAppliedCompanies } from "./batch.js";
import { isNoriPaused } from "./pause.js";
import { getSchedule, type NoriSchedule } from "./schedule.js";
import { approveAndSubmit, capDayStart, createApplication, dailyCapUse, loadApplication, logEvent, normalizeCompany } from "./store.js";

/** The fit at which a job counts as a strong fit (the "Strong fit" band). */
export const STRONG_FIT = 0.8;
/** The run-log step that marks an application Nori prepared ahead for a strong fit. */
export const STRONG_FIT_STEP = "strong_fit";
/** The run-log step with autopilot's apply decision for a prepared strong fit (`data`: group, action, reasons). */
export const APPLY_DECISION_STEP = "apply_decision";

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
 * "Apply for me" batch: never a company on the skip list or one applied to in the last 60 days, never a hard no of the
 * apply decision (`not_a_fit`), one job per company, only the job systems Nori sends through (`atsTypes`, empty = all).
 * At most the person's daily limit of strong fits a day
 * is prepared ahead, so a burst of postings cannot run up the AI spend. Returns the applications to queue
 * `prepare.application` for.
 */
export async function prepareStrongFitsAhead(db: Db, userId: string, fits: readonly StrongFit[], opts: { now: Date; atsTypes?: readonly string[] | null }): Promise<PrepareAheadResult> {
  const out: PrepareAheadResult = { created: [], skipped: [] };
  const mine = fits.filter((f) => f.userId === userId);
  if (mine.length === 0) return out;
  // Paused: Nori starts nothing on its own, so nothing is prepared ahead either.
  if (await isNoriPaused(db, userId)) return { created: [], skipped: mine.map((f) => ({ jobId: f.jobId, reason: "paused" })) };
  const settings = await getNoriSettings(db, userId);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(runEvents).innerJoin(applications, eq(applications.id, runEvents.applicationId))
    .where(and(eq(applications.userId, userId), eq(runEvents.step, STRONG_FIT_STEP), gte(applications.createdAt, capDayStart(opts.now))));
  let room = settings.dailyLimit - Number(today?.n ?? 0);
  const skip = new Set(settings.skipCompanies.map(normalizeCompany));
  const recent = await recentlyAppliedCompanies(db, userId, opts.now);
  const hardNo = new Set((await decideApplies(db, userId, { now: opts.now, jobIds: mine.map((f) => f.jobId) })).decisions.filter((d) => d.action === "skip").map((d) => d.jobId));
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
      : hardNo.has(f.jobId) ? "not_a_fit"
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

/** Whether autopilot acts on its own at all: the person turned the schedule on and has not paused it. */
export function autopilotOn(schedule: NoriSchedule): boolean {
  return schedule.enabled && !schedule.paused;
}

/**
 * `reason` when nothing was started: not_waiting, not_strong_fit, autopilot_off, not_found, not_supported, or the apply
 * decision's answer: ask (the person decides: the Telegram strong-fit alert and the dashboard offer Apply/Skip),
 * not_a_fit (a hard no; `detail` says why), daily_limit, weekly_pace or later (held for variety or one per company).
 */
export type AutopilotResult = { started: boolean; reason?: string; detail?: string; group?: ApplyGroup | null };

/**
 * Autopilot for strong fits: a strong fit Nori prepared ahead goes to the employer's form as soon as it is prepared,
 * instead of waiting for the next scheduled run, when the schedule is on and the apply decision (`decideApplies`, with
 * what is left of today's limit as `maxSends`) says `send`: its group is sent without asking at the person's
 * aggressiveness, within the weekly pace, not a hard no (skip list and the 60-day company rule included). Only the job
 * systems Nori sends through. The decision is logged (`apply_decision` run event). When it does not send, the
 * application stays prepared for the person (the Telegram alert offers Apply and Skip, except for a hard no).
 * `started` means the caller must queue `apply.run` (trigger autopilot).
 */
export async function autopilotStrongFit(db: Db, applicationId: string, opts: { now: Date; atsTypes?: readonly string[] | null }): Promise<AutopilotResult> {
  const app = await loadApplication(db, applicationId);
  if (!app || app.status !== "prepared" || app.approvedAt || app.attempts > 0) return { started: false, reason: "not_waiting" };
  const [marked] = await db.select({ data: runEvents.data }).from(runEvents)
    .where(and(eq(runEvents.applicationId, app.id), eq(runEvents.step, STRONG_FIT_STEP))).limit(1);
  if (!marked) return { started: false, reason: "not_strong_fit" };
  if (await isNoriPaused(db, app.userId)) return { started: false, reason: "paused" };
  if (!autopilotOn(await getSchedule(db, app.userId))) return { started: false, reason: "autopilot_off" };

  const [job] = await db.select({ atsType: jobs.atsType }).from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  if (!job) return { started: false, reason: "not_found" };
  if (opts.atsTypes?.length && !opts.atsTypes.includes(job.atsType)) return { started: false, reason: "not_supported" };

  const settings = await getNoriSettings(db, app.userId);
  const room = Math.max(0, settings.dailyLimit - (await dailyCapUse(db, app.userId, opts.now)).used);
  const decided = await decideApplies(db, app.userId, { now: opts.now, jobIds: [app.jobId], maxSends: room });
  const d = decided.decisions[0];
  const action: ApplyAction = d?.action ?? "ask";
  const reasons = d?.reasons ?? ["Not on your list any more"];
  await logEvent(db, app.id, APPLY_DECISION_STEP, `Apply decision: ${action}${d?.group ? ` (${d.group.replace(/_/g, " ")})` : ""}`, { data: { group: d?.group ?? null, action, reasons } });
  if (action === "skip") return { started: false, reason: "not_a_fit", detail: reasons[0], group: null };
  if (action === "ask") return { started: false, reason: "ask", group: d?.group ?? null };
  if (action === "later") return { started: false, reason: room === 0 ? "daily_limit" : decided.weekLeft === 0 ? "weekly_pace" : "later", group: d!.group };

  const res = await approveAndSubmit(db, app.id, { now: opts.now, limit: settings.dailyLimit });
  if (!res.ok) return { started: false, reason: res.cap ? "daily_limit" : res.reason };
  if (res.started) await logEvent(db, app.id, "autopilot", "Autopilot sent this strong fit as soon as it was prepared", { data: { fit: d!.fit, group: d!.group } });
  return { started: res.started, group: d!.group };
}
