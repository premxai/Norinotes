/**
 * Outcome learning: a small, explainable, per-user nudge to the shortlist from the user's own replies and silences.
 *
 * - Learns only after `minResolved` (10) applications are resolved (an outcome, or 30 days of silence) within a year.
 * - Per dimension value (role family, seniority, job system, board size) with at least `minGroup` (3) resolved
 *   applications: a smoothed positive-reply rate (reply, interview or offer) against the user's own overall rate, every
 *   application weighted by age (half-life 90 days). A rejection counts against fully, silence half.
 * - Each dimension moves fit by at most 0.02, all together by at most 0.05, in steps of 0.01.
 * - Applied after the gates and the lane minimum have seen the raw fit, so it never admits a job those turned away; it only
 *   reorders and says why in the row's reasons (with the exact fit change).
 *
 * The model is stored in `profiles.preferences.outcomeLearning` and refreshed when older than 6 hours or after the user
 * changes an outcome. See docs/outcomes.md.
 */
import { eq, jobs, companies, inArray, profiles, sql, type Db } from "@norinote/db";
import { seniorityFromTitle } from "./heuristic-spec.js";
import {
  OUTCOME_REASON_PREFIX, boardSizeOf, loadOutcomeHistory, resolveApplication, syncInboxOutcomes, type OutcomeHistoryRow,
} from "./outcomes.js";
import { roleFamilyOf } from "./roles.js";

export const OUTCOME_LEARNING = {
  version: 1,
  minResolved: 10,
  minGroup: 3,
  maxPerDimension: 0.02,
  maxTotal: 0.05,
  halfLifeDays: 90,
  maxAgeDays: 365,
  /** Pseudo-applications at the user's own rate added to every group, so a few lucky replies move little. */
  prior: 2,
  /** Silence counts half as much against a group as a rejection. */
  silenceWeight: 0.5,
  /** Lift (group rate minus overall rate) times this is the dimension's fit change before the cap. */
  scale: 0.1,
  staleMs: 6 * 3_600_000,
} as const;

export const OUTCOME_DIMENSIONS = ["roleFamily", "seniority", "system", "boardSize"] as const;
export type OutcomeDimension = (typeof OUTCOME_DIMENSIONS)[number];

export type OutcomeNudge = {
  dimension: OutcomeDimension;
  value: string;
  /** Unweighted counts inside the window, for the explanation. */
  positive: number;
  resolved: number;
  /** Fit change for jobs with this value, already capped per dimension. */
  delta: number;
};

export type OutcomeLearning = {
  version: number;
  computedAt: string;
  /** Resolved applications in the window. */
  resolved: number;
  /** Of those, how many led to a reply, interview or offer. */
  positive: number;
  /** True once there are enough resolved applications to learn from. */
  active: boolean;
  nudges: OutcomeNudge[];
};

export type JobFeatures = Record<OutcomeDimension, string>;

const DAY_MS = 86_400_000;
const round = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, cap: number) => Math.max(-cap, Math.min(cap, x));

function featuresOfRow(r: OutcomeHistoryRow): JobFeatures {
  return { roleFamily: r.roleFamily, seniority: r.seniority, system: r.system, boardSize: r.boardSize };
}

/** The features a job is nudged on: role family and seniority from the title (the spec's seniority when it has one), system, board size. */
export function jobFeatures(job: { title: string; specSeniority?: string | null; system: string; openJobs?: number | null }): JobFeatures {
  const role = roleFamilyOf(job.title);
  const seniority = job.specSeniority && job.specSeniority !== "unknown" ? job.specSeniority : seniorityFromTitle(job.title) ?? role.seniority;
  return { roleFamily: role.family, seniority, system: job.system, boardSize: boardSizeOf(job.openJobs) };
}

/** Builds the per-user model from the user's submitted applications. Pure. */
export function learnFromOutcomes(history: readonly OutcomeHistoryRow[], now: Date): OutcomeLearning {
  const L = OUTCOME_LEARNING;
  type Item = { f: JobFeatures; w: number; pos: number; neg: number; positive: boolean };
  const items: Item[] = [];
  for (const row of history) {
    const age = (now.getTime() - row.submittedAt.getTime()) / DAY_MS;
    if (age > L.maxAgeDays) continue;
    const r = resolveApplication(row, now);
    if (!r.settled) continue;
    const positive = r.state === "offer" || r.state === "interview" || r.state === "reply";
    const w = Math.pow(0.5, Math.max(0, age) / L.halfLifeDays);
    items.push({ f: featuresOfRow(row), w, positive, pos: positive ? w : 0, neg: positive ? 0 : w * (r.state === "rejection" ? 1 : L.silenceWeight) });
  }
  const positiveCount = items.filter((i) => i.positive).length;
  const model: OutcomeLearning = {
    version: L.version, computedAt: now.toISOString(), resolved: items.length, positive: positiveCount, active: items.length >= L.minResolved, nudges: [],
  };
  if (!model.active) return model;
  const P = items.reduce((n, i) => n + i.pos, 0);
  const N = items.reduce((n, i) => n + i.neg, 0);
  // Nothing positive yet (or nothing negative): every group looks the same, there is no contrast to learn from.
  if (P === 0 || N === 0) return model;
  const base = P / (P + N);
  for (const dimension of OUTCOME_DIMENSIONS) {
    const groups = new Map<string, Item[]>();
    for (const i of items) {
      const v = i.f[dimension];
      if (!v || v === "unknown") continue;
      groups.set(v, [...(groups.get(v) ?? []), i]);
    }
    for (const [value, g] of groups) {
      if (g.length < L.minGroup) continue;
      const p = g.reduce((n, i) => n + i.pos, 0);
      const q = g.reduce((n, i) => n + i.neg, 0);
      const groupRate = (p + L.prior * base) / (p + q + L.prior);
      const delta = Math.round(clamp((groupRate - base) * L.scale, L.maxPerDimension) * 1000) / 1000;
      if (Math.abs(delta) < 0.005) continue;
      model.nudges.push({ dimension, value, positive: g.filter((i) => i.positive).length, resolved: g.length, delta });
    }
  }
  model.nudges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value));
  return model;
}

function label(n: OutcomeNudge): string {
  switch (n.dimension) {
    case "roleFamily": return `${n.value.replace(/_/g, " ")}`;
    case "seniority": return `${n.value}-level`;
    case "system": return n.value.charAt(0).toUpperCase() + n.value.slice(1);
    case "boardSize": return `${n.value}-company`;
  }
}

/** The total fit change for a job (capped, in steps of 0.01) and the factual reason, or 0 and null. */
export function outcomeNudge(model: OutcomeLearning | null | undefined, features: JobFeatures): { delta: number; reason: string | null } {
  if (!model?.active || model.nudges.length === 0) return { delta: 0, reason: null };
  const hits = model.nudges.filter((n) => features[n.dimension] === n.value);
  const sum = hits.reduce((s, n) => s + n.delta, 0);
  const delta = Math.round(round(clamp(sum, OUTCOME_LEARNING.maxTotal), 0.01) * 100) / 100;
  if (delta === 0) return { delta: 0, reason: null };
  // Explain with the strongest signal pointing the same way as the total.
  const main = hits.filter((n) => Math.sign(n.delta) === Math.sign(delta)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]!;
  const sign = delta > 0 ? "+" : "-";
  const reason = `${OUTCOME_REASON_PREFIX}${main.positive} of ${main.resolved} ${label(main)} applications led to a reply or interview, against ${model.positive} of ${model.resolved} overall (${sign}${Math.abs(delta).toFixed(2)} fit)`;
  return { delta, reason };
}

// ---- storage -----------------------------------------------------------------------------------------------------------

/** Recomputes the user's model from their outcomes (after syncing the inbox) and stores it on the profile. */
export async function refreshOutcomeLearning(db: Db, userId: string, now: Date): Promise<OutcomeLearning> {
  await syncInboxOutcomes(db, { userId });
  const since = new Date(now.getTime() - OUTCOME_LEARNING.maxAgeDays * DAY_MS);
  const model = learnFromOutcomes(await loadOutcomeHistory(db, { userId, since }), now);
  // Only this key: inbox settings and other preferences live next to it.
  await db.update(profiles)
    .set({ preferences: sql`jsonb_set(coalesce(${profiles.preferences}, '{}'::jsonb), '{outcomeLearning}', ${JSON.stringify(model)}::jsonb, true)` })
    .where(eq(profiles.userId, userId));
  return model;
}

/** The stored model when it is fresh, else a refreshed one. */
export async function loadOutcomeLearning(db: Db, userId: string, now: Date): Promise<OutcomeLearning> {
  const [row] = await db.select({ model: sql<unknown>`${profiles.preferences} -> 'outcomeLearning'` }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const m = row?.model as OutcomeLearning | null | undefined;
  const fresh = m && m.version === OUTCOME_LEARNING.version && typeof m.computedAt === "string"
    && Math.abs(now.getTime() - new Date(m.computedAt).getTime()) <= OUTCOME_LEARNING.staleMs;
  return fresh ? m : refreshOutcomeLearning(db, userId, now);
}

// ---- the shortlist hook ------------------------------------------------------------------------------------------------

type Nudgeable = { jobId: string; title: string; fit: number; reasons: string[]; confidence?: number; rankScore?: number };

/**
 * Applies the user's outcome nudge to scored shortlist candidates, in place: fit (and the ranking key) move by at most
 * 0.05 and a reason says why. Call only on candidates that already passed the gates and the lane minimum. Never throws:
 * a failure leaves the candidates as they were.
 */
export async function applyOutcomeLearning(db: Db, userId: string, items: Nudgeable[], specSeniority: (jobId: string) => string | null | undefined, now: Date): Promise<void> {
  if (items.length === 0) return;
  try {
    const model = await loadOutcomeLearning(db, userId, now);
    if (!model.active || model.nudges.length === 0) return;
    const meta = await db.select({ id: jobs.id, system: jobs.atsType, openJobs: companies.lastJobCount }).from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId)).where(inArray(jobs.id, items.map((i) => i.jobId)));
    const byId = new Map(meta.map((m) => [m.id, m]));
    for (const item of items) {
      const m = byId.get(item.jobId);
      if (!m) continue;
      const { delta, reason } = outcomeNudge(model, jobFeatures({ title: item.title, specSeniority: specSeniority(item.jobId), system: m.system, openJobs: m.openJobs }));
      if (!reason) continue;
      const fit = Math.max(0, Math.min(1, Math.round((item.fit + delta) * 1000) / 1000));
      const applied = Math.round((fit - item.fit) * 100) / 100;
      if (applied === 0) continue;
      item.fit = fit;
      if (item.rankScore != null) item.rankScore = Math.round((item.rankScore + applied * (item.confidence ?? 1)) * 10000) / 10000;
      // Second place: an explanation line from the model goes first and the list is cut to three.
      item.reasons.splice(Math.min(1, item.reasons.length), 0, applied === delta ? reason : reason.replace(/\([+-]0\.\d\d fit\)$/, `(${applied > 0 ? "+" : "-"}${Math.abs(applied).toFixed(2)} fit)`));
    }
  } catch {
    // Learning is a nudge, never a reason for a shortlist to fail.
  }
}
