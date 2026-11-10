/**
 * "Apply for me" batches (the Nori page). The person picks jobs and approves them once; the worker then sends the
 * batch's prepared applications one at a time, `spacingMinutes` apart and within the daily limit, while the person is
 * away. What needs them (a question, a captcha, a code that did not come) is parked and never guessed; Stop cancels
 * whatever has not started. The batch counts as the person's approval for each of its applications.
 */
import { and, applications, applyBatches, asc, companies, desc, eq, freshJobSql, gte, inArray, isNull, jobs, lanes, profiles, shortlist, sql, type Db } from "@norinote/db";
import { isHostedForm, readSkipCompanies } from "@norinote/shared";
import { approveAndSubmit, createApplication, dailyCapUse, normalizeCompany, transitionApplication, type ApplicationRow } from "./store.js";

/** The batch error an application carries when Stop cancelled it (the same words as a single cancel). */
export const BATCH_CANCELLED = "Cancelled by you";
/** At most this many jobs in one batch. */
export const MAX_BATCH = 50;
/** Applications a batch may send a day when the person set no daily limit. */
export const DEFAULT_BATCH_DAILY_LIMIT = 20;

// ---- settings (profiles.preferences.nori; the daily limit is the profile's own `dailyCap`) -------------------------

export type NoriSettings = {
  /** Minutes between two submissions of a batch. */
  spacingMinutes: number;
  /** The fit the "All strong matches" shortcut starts at (0 to 1). */
  minFit: number;
  /** Company names a batch never applies to. */
  skipCompanies: string[];
  /** Applications a day across batches; 0 in the profile means the default. */
  dailyLimit: number;
};

export const DEFAULT_NORI_SETTINGS: Omit<NoriSettings, "dailyLimit"> = { spacingMinutes: 4, minFit: 0.7, skipCompanies: [] };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * How Nori works for the person. `minFit` is THE threshold ("Recommended" and Apply for me): `preferences.nori.minFit`
 * once saved, else the lowest of their enabled roles' (lanes') minFit, else 0.7. Saving it sets every role to it.
 * `skipCompanies` is the one skip list, `preferences.excludeCompanies` (see readSkipCompanies).
 */
export function readNoriSettings(preferences: unknown, dailyCap: number | null | undefined, laneMinFits: readonly number[] = []): NoriSettings {
  const o = rec(rec(preferences).nori);
  const spacing = typeof o.spacingMinutes === "number" && o.spacingMinutes >= 1 && o.spacingMinutes <= 60 ? Math.round(o.spacingMinutes) : DEFAULT_NORI_SETTINGS.spacingMinutes;
  const saved = typeof o.minFit === "number" && o.minFit >= 0 && o.minFit <= 1 ? o.minFit : null;
  const minFit = saved ?? (laneMinFits.length ? Math.min(...laneMinFits) : DEFAULT_NORI_SETTINGS.minFit);
  return { spacingMinutes: spacing, minFit, skipCompanies: readSkipCompanies(preferences), dailyLimit: dailyCap && dailyCap > 0 ? dailyCap : DEFAULT_BATCH_DAILY_LIMIT };
}

export async function getNoriSettings(db: Db, userId: string): Promise<NoriSettings> {
  const [row] = await db.select({ preferences: profiles.preferences, cap: profiles.dailyCap }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const laneFits = (await db.select({ minFit: lanes.minFit }).from(lanes).where(and(eq(lanes.userId, userId), eq(lanes.enabled, true)))).map((l) => l.minFit);
  return readNoriSettings(row?.preferences, row?.cap, laneFits);
}

/** Saves the patch. A new threshold is set on every role too; the skip list goes to `preferences.excludeCompanies`. */
export async function saveNoriSettings(db: Db, userId: string, patch: Partial<NoriSettings>): Promise<NoriSettings> {
  const current = await getNoriSettings(db, userId);
  const next = { ...current, ...patch };
  const nori = { spacingMinutes: next.spacingMinutes, minFit: next.minFit };
  const json = JSON.stringify(nori);
  const skip = patch.skipCompanies !== undefined ? JSON.stringify(readSkipCompanies({ excludeCompanies: patch.skipCompanies })) : null;
  const values = { userId, preferences: { nori, ...(skip ? { excludeCompanies: JSON.parse(skip) as string[] } : {}) }, ...(patch.dailyLimit !== undefined ? { dailyCap: patch.dailyLimit } : {}) };
  await db.insert(profiles).values(values).onConflictDoUpdate({
    target: profiles.userId,
    set: {
      preferences: skip
        ? sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('nori', ${json}::jsonb, 'excludeCompanies', ${skip}::jsonb)`
        : sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('nori', ${json}::jsonb)`,
      ...(patch.dailyLimit !== undefined ? { dailyCap: patch.dailyLimit } : {}),
    },
  });
  if (patch.minFit !== undefined) await db.update(lanes).set({ minFit: patch.minFit }).where(eq(lanes.userId, userId));
  return getNoriSettings(db, userId);
}

// ---- starting a batch ---------------------------------------------------------------------------------------------

export type BatchSkip = { jobId: string; reason: "not_found" | "not_supported" | "embedded_form" | "applied_recently" | "skipped_company" | "same_company" | "already_applied" | "duplicate_recent" };

/** A company the person applied to within this many days is not sent another application by a batch. */
export const RECENT_COMPANY_DAYS = 60;

/**
 * Companies the person has an application with (any status but failed) in the last RECENT_COMPANY_DAYS, with the jobs
 * those applications are for. Another job at such a company is skipped; the same job is not (an unsent application of
 * it is taken over, a sent one is reported as already applied).
 */
async function recentlyAppliedCompanies(db: Db, userId: string, now: Date): Promise<{ blocks: (companyId: string, jobId: string) => boolean }> {
  const since = new Date(now.getTime() - RECENT_COMPANY_DAYS * 86_400_000);
  const rows = await db.select({ companyId: jobs.companyId, jobId: jobs.id }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, since), sql`${applications.status} <> 'failed'`));
  const byCompany = new Map<string, Set<string>>();
  for (const r of rows) byCompany.set(r.companyId, (byCompany.get(r.companyId) ?? new Set()).add(r.jobId));
  return { blocks: (companyId, jobId) => { const js = byCompany.get(companyId); return !!js && !js.has(jobId); } };
}
export type StartBatchResult = { batchId: string | null; added: Array<{ jobId: string; applicationId: string; created: boolean }>; skipped: BatchSkip[] };

/**
 * Creates the batch and an application per job (or adopts the person's own unsent one), at most one per company and
 * never for a skipped company. The caller queues `prepare.application` for each `created` one.
 */
export async function startBatch(db: Db, userId: string, jobIds: readonly string[], opts: { now?: Date; atsTypes?: readonly string[] | null } = {}): Promise<StartBatchResult> {
  const now = opts.now ?? new Date();
  const ids = [...new Set(jobIds)].slice(0, MAX_BATCH);
  const settings = await getNoriSettings(db, userId);
  const skipSet = new Set(settings.skipCompanies.map(normalizeCompany));
  const rows = ids.length
    ? await db.select({ id: jobs.id, companyId: jobs.companyId, companyName: companies.name, atsType: jobs.atsType, applyUrl: jobs.applyUrl }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(inArray(jobs.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const recent = await recentlyAppliedCompanies(db, userId, now);
  const skipped: BatchSkip[] = [];
  const picked: string[] = [];
  const companiesSeen = new Set<string>();
  for (const id of ids) {
    const job = byId.get(id);
    if (!job) { skipped.push({ jobId: id, reason: "not_found" }); continue; }
    // Job systems Nori sends batches through (BATCH_ATS); others stay for the person to apply to one at a time.
    if (opts.atsTypes?.length && !opts.atsTypes.includes(job.atsType)) { skipped.push({ jobId: id, reason: "not_supported" }); continue; }
    // A Greenhouse posting kept on the company's own site is an embedded form: Nori never fills those.
    if (!isHostedForm(job.atsType, job.applyUrl)) { skipped.push({ jobId: id, reason: "embedded_form" }); continue; }
    if (recent.blocks(job.companyId, job.id)) { skipped.push({ jobId: id, reason: "applied_recently" }); continue; }
    if (skipSet.has(normalizeCompany(job.companyName))) { skipped.push({ jobId: id, reason: "skipped_company" }); continue; }
    if (companiesSeen.has(job.companyId)) { skipped.push({ jobId: id, reason: "same_company" }); continue; }
    companiesSeen.add(job.companyId);
    picked.push(id);
  }
  if (picked.length === 0) return { batchId: null, added: [], skipped };

  const [batch] = await db.insert(applyBatches).values({ userId, status: "running", total: 0, createdAt: now }).returning();
  const added: StartBatchResult["added"] = [];
  for (const jobId of picked) {
    const res = await createApplication(db, userId, jobId, { now });
    const app: ApplicationRow | null = res.application;
    if (res.created) {
      added.push({ jobId, applicationId: app!.id, created: true });
    } else if (app && app.userId === userId && !app.approvedAt && !app.batchId && ["queued", "preparing", "prepared", "needs_user"].includes(app.status)) {
      // The person's own application that was never sent: the batch takes it on.
      added.push({ jobId, applicationId: app.id, created: false });
    } else {
      skipped.push({ jobId, reason: res.created ? "already_applied" : res.reason === "duplicate_recent" ? "duplicate_recent" : "already_applied" });
      continue;
    }
    await db.update(applications).set({ batchId: batch!.id }).where(eq(applications.id, added.at(-1)!.applicationId));
  }
  if (added.length === 0) {
    await db.delete(applyBatches).where(eq(applyBatches.id, batch!.id));
    return { batchId: null, added, skipped };
  }
  await db.update(applyBatches).set({ total: added.length }).where(eq(applyBatches.id, batch!.id));
  return { batchId: batch!.id, added, skipped };
}

// ---- sending: one application per batch at a time, spaced, within the daily limit -----------------------------------

const IN_FLIGHT = ["applying", "awaiting_code"] as const;
const NOT_STARTED = ["queued", "preparing", "prepared"] as const;

export type DrainStep = { batchId: string; applicationId: string };

/**
 * One pass over running batches. For each: when nothing of the batch is on an employer's page and `spacingMinutes`
 * passed since the last start, approve the oldest prepared application (the batch is the approval) if the daily limit
 * allows. Returns the applications the caller must queue `apply.run` for. A batch with nothing left to send is done.
 */
export async function drainBatches(db: Db, opts: { now?: Date } = {}): Promise<DrainStep[]> {
  const now = opts.now ?? new Date();
  // A finished batch carries on when one of its parked applications comes back (the person answered its questions):
  // it is unsent, unapproved and being prepared again. Its summary is sent again when it finishes.
  await db.update(applyBatches).set({ status: "running", finishedAt: null, notifiedAt: null }).where(and(
    eq(applyBatches.status, "done"),
    sql`exists (select 1 from ${applications} where ${applications.batchId} = ${applyBatches.id} and ${applications.approvedAt} is null and ${applications.status} in ('queued', 'preparing', 'prepared'))`,
  ));
  const running = await db.select().from(applyBatches).where(eq(applyBatches.status, "running")).orderBy(asc(applyBatches.createdAt));
  const out: DrainStep[] = [];
  const startedFor = new Set<string>();
  for (const batch of running) {
    const apps = await db.select({ id: applications.id, status: applications.status, approvedAt: applications.approvedAt, createdAt: applications.createdAt })
      .from(applications).where(eq(applications.batchId, batch.id)).orderBy(asc(applications.createdAt));
    const inFlight = apps.some((a) => (IN_FLIGHT as readonly string[]).includes(a.status));
    const waiting = apps.filter((a) => (NOT_STARTED as readonly string[]).includes(a.status) && !a.approvedAt);
    if (!inFlight && waiting.length === 0) {
      await db.update(applyBatches).set({ status: "done", finishedAt: now }).where(and(eq(applyBatches.id, batch.id), eq(applyBatches.status, "running")));
      continue;
    }
    if (inFlight || startedFor.has(batch.userId)) continue;
    const settings = await getNoriSettings(db, batch.userId);
    if (batch.lastStartedAt && now.getTime() - batch.lastStartedAt.getTime() < settings.spacingMinutes * 60_000) continue;
    const next = waiting.find((a) => a.status === "prepared");
    if (!next) continue;
    const use = await dailyCapUse(db, batch.userId, now);
    if (use.used >= settings.dailyLimit) continue;
    const res = await approveAndSubmit(db, next.id, { now });
    if (res.ok && res.started) {
      await db.update(applyBatches).set({ lastStartedAt: now }).where(eq(applyBatches.id, batch.id));
      out.push({ batchId: batch.id, applicationId: next.id });
      startedFor.add(batch.userId);
    }
  }
  return out;
}

/** Stops a batch: whatever has not started (not approved, not on a page, not sent) is cancelled. Sent ones stay sent. */
export async function stopBatch(db: Db, userId: string, batchId: string, opts: { now?: Date } = {}): Promise<{ ok: boolean; cancelled: number }> {
  const now = opts.now ?? new Date();
  const [batch] = await db.select().from(applyBatches).where(and(eq(applyBatches.id, batchId), eq(applyBatches.userId, userId))).limit(1);
  if (!batch) return { ok: false, cancelled: 0 };
  const apps = await db.select().from(applications).where(and(eq(applications.batchId, batchId), isNull(applications.approvedAt)));
  let cancelled = 0;
  for (const a of apps) {
    if (!["queued", "preparing", "prepared", "needs_user"].includes(a.status)) continue;
    const r = await transitionApplication(db, a.id, "failed", { from: a.status, error: BATCH_CANCELLED, message: "Stopped with the rest of the batch", by: "user", now });
    if (r.ok) cancelled++;
  }
  if (batch.status === "running") await db.update(applyBatches).set({ status: "stopped", finishedAt: now }).where(eq(applyBatches.id, batchId));
  return { ok: true, cancelled };
}

// ---- reading -----------------------------------------------------------------------------------------------------------

export type BatchCounts = { total: number; sent: number; working: number; preparing: number; ready: number; needsYou: number; cancelled: number; failed: number };

export function countBatch(apps: ReadonlyArray<Pick<ApplicationRow, "status" | "error">>): BatchCounts {
  const c: BatchCounts = { total: apps.length, sent: 0, working: 0, preparing: 0, ready: 0, needsYou: 0, cancelled: 0, failed: 0 };
  for (const a of apps) {
    if (a.status === "submitted") c.sent++;
    else if (a.status === "applying" || a.status === "awaiting_code") c.working++;
    else if (a.status === "queued" || a.status === "preparing") c.preparing++;
    else if (a.status === "prepared") c.ready++;
    else if (a.status === "needs_user") c.needsYou++;
    else if (a.status === "failed") { if (a.error === BATCH_CANCELLED) c.cancelled++; else c.failed++; }
  }
  return c;
}

export type BatchView = {
  id: string; status: "running" | "stopped" | "done"; createdAt: Date; finishedAt: Date | null; lastStartedAt: Date | null;
  counts: BatchCounts;
  /** Why a running batch is not sending right now, when it is not. */
  waitingFor: "spacing" | "daily_limit" | "preparing" | "you" | null;
  nextAt: Date | null;
};

export async function batchView(db: Db, batch: typeof applyBatches.$inferSelect, now: Date): Promise<BatchView> {
  const apps = await db.select().from(applications).where(eq(applications.batchId, batch.id));
  const counts = countBatch(apps);
  let waitingFor: BatchView["waitingFor"] = null;
  let nextAt: Date | null = null;
  if (batch.status === "running" && counts.working === 0) {
    const settings = await getNoriSettings(db, batch.userId);
    const spacingEnds = batch.lastStartedAt ? new Date(batch.lastStartedAt.getTime() + settings.spacingMinutes * 60_000) : null;
    if (counts.ready > 0) {
      const use = await dailyCapUse(db, batch.userId, now);
      if (use.used >= settings.dailyLimit) waitingFor = "daily_limit";
      else if (spacingEnds && spacingEnds > now) { waitingFor = "spacing"; nextAt = spacingEnds; }
    } else if (counts.preparing > 0) waitingFor = "preparing";
    else if (counts.needsYou > 0) waitingFor = "you";
  }
  return { id: batch.id, status: batch.status, createdAt: batch.createdAt, finishedAt: batch.finishedAt, lastStartedAt: batch.lastStartedAt, counts, waitingFor, nextAt };
}

export async function recentBatches(db: Db, userId: string, now: Date, limit = 10): Promise<BatchView[]> {
  const rows = await db.select().from(applyBatches).where(eq(applyBatches.userId, userId)).orderBy(desc(applyBatches.createdAt)).limit(limit);
  return Promise.all(rows.map((b) => batchView(db, b, now)));
}

/** Batches that finished since `since` and were not summarised yet (for Telegram). Marks them summarised. */
export async function takeFinishedBatches(db: Db, userId: string): Promise<Array<{ id: string; counts: BatchCounts; status: "stopped" | "done" }>> {
  const rows = await db.select().from(applyBatches)
    .where(and(eq(applyBatches.userId, userId), inArray(applyBatches.status, ["stopped", "done"]), isNull(applyBatches.notifiedAt)));
  const out: Array<{ id: string; counts: BatchCounts; status: "stopped" | "done" }> = [];
  for (const b of rows) {
    const apps = await db.select().from(applications).where(eq(applications.batchId, b.id));
    out.push({ id: b.id, counts: countBatch(apps), status: b.status as "stopped" | "done" });
    await db.update(applyBatches).set({ notifiedAt: new Date() }).where(eq(applyBatches.id, b.id));
  }
  return out;
}

/**
 * "Apply now" from Recommended: the person's new matches at or above their threshold, open and posted in the last 72
 * hours, best fit first, one per company, not applied to, not on the skip list, on the allowed job systems. At most
 * `limit` job ids, for startBatch.
 */
export async function recommendedJobIds(db: Db, userId: string, opts: { now?: Date; limit?: number; atsTypes?: readonly string[] | null } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const settings = await getNoriSettings(db, userId);
  const skip = new Set(settings.skipCompanies.map(normalizeCompany));
  const recent = await recentlyAppliedCompanies(db, userId, now);
  const rows = await db.select({ jobId: shortlist.jobId, companyId: jobs.companyId, companyName: companies.name, atsType: jobs.atsType, applyUrl: jobs.applyUrl })
    .from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(applications, and(eq(applications.jobId, shortlist.jobId), eq(applications.userId, userId)))
    .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), gte(shortlist.fit, settings.minFit), isNull(jobs.closedAt),
      eq(companies.blocked, false), isNull(applications.id), freshJobSql(now)))
    .orderBy(desc(shortlist.fit)).limit(200);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (out.length >= Math.min(opts.limit ?? 10, MAX_BATCH)) break;
    if (opts.atsTypes?.length && !opts.atsTypes.includes(r.atsType)) continue;
    if (!isHostedForm(r.atsType, r.applyUrl) || recent.blocks(r.companyId, r.jobId)) continue;
    if (skip.has(normalizeCompany(r.companyName)) || seen.has(r.companyId)) continue;
    seen.add(r.companyId);
    out.push(r.jobId);
  }
  return out;
}
