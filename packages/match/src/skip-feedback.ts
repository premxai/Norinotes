/**
 * Skip feedback: the reasons a person gives when they skip jobs, turned into a small, explainable, reversible penalty.
 *
 * - "Not my kind of role" groups skips by role family (with the software subfamily or the specialty when there is one),
 *   "Too senior" and "Too junior" by level, "Wrong location" by the one city (or, without a city, the one state) the job
 *   names. "Company I don't want" goes to the skip list instead (the API adds it); "Missing skills" and "Other" are only stored.
 * - A group counts only after `minSkips` (2) skips within `windowDays` (90): one tap never reshapes the list.
 * - Each active effect moves the fit of a matching job down by `penalty` (0.05), all together by at most `maxTotal` (0.1).
 *   It runs after the gates and the lane minimum have seen the raw fit, so it never removes a row or admits one, and never
 *   overrides a gate; it reorders, and the row says why ("You skipped 3 ... (-0.05 fit)").
 * - The person can remove an effect: `clearSkipEffect` stores the time in `profiles.preferences.skipFeedback.cleared`, and
 *   skips from before it no longer count for that effect (new skips can bring it back).
 */
import { and, eq, gte, inArray, jobs, profiles, shortlist, sql, type Db } from "@norinote/db";
import { parseLocation, type SkipReason } from "@norinote/shared";
import { seniorityFromTitle } from "./heuristic-spec.js";
import { warnSwallowed } from "./log.js";
import { withReason } from "./reasons.js";
import { roleFamilyOf } from "./roles.js";

export const SKIP_FEEDBACK = { minSkips: 2, windowDays: 90, penalty: 0.05, maxTotal: 0.1 } as const;

/** Shortlist reason that carries a skip penalty. It ends with the exact fit change, e.g. "(-0.05 fit)". */
export const SKIP_REASON_PREFIX = "You skipped ";

/** The reasons that feed the matcher. */
export const MATCHER_SKIP_REASONS = ["not_my_kind", "too_senior", "too_junior", "wrong_location"] as const satisfies readonly SkipReason[];

export type SkipEffectKind = "role" | "level_above" | "level_below" | "city" | "state";

export type SkipEffect = {
  /** Stable id for removing it: role:<family>[.<sub>], level_above, level_below, city:<name>, state:<code>. */
  id: string;
  kind: SkipEffectKind;
  reason: SkipReason;
  /** The role key, level, city or state code it applies to. */
  value: string;
  /** Plain words for the person: "frontend software engineering roles", "senior level and above", "Austin, TX". */
  label: string;
  /** Skips behind it, inside the window and after the last time the person removed it. */
  skips: number;
  /** Fit change for a matching job. */
  delta: number;
};

/** One job as the feedback sees it. */
export type SkipJob = { title: string; seniority?: string | null; location: string | null; remote: boolean };

export type SkipSignal = SkipJob & { reason: SkipReason; at: Date };

const DAY_MS = 86_400_000;
const LEVEL_RANK: Record<string, number> = { intern: 0, entry: 1, mid: 2, senior: 3, staff: 4, manager: 4, principal: 5, director: 5, executive: 6 };

function levelOf(job: SkipJob): string | null {
  const s = job.seniority && job.seniority !== "unknown" ? job.seniority : seniorityFromTitle(job.title);
  return s && s in LEVEL_RANK ? s : null;
}

/** Role family, refined by the software subfamily or the specialty; null when the title cannot be classified. */
function roleOf(title: string): { kind: "role"; value: string; label: string } | null {
  const r = roleFamilyOf(title);
  if (r.family === "unknown") return null;
  const sub = r.subfamily ?? r.specialty;
  const words = (s: string) => s.replace(/_/g, " ");
  return sub && sub !== "general"
    ? { kind: "role", value: `${r.family}.${sub}`, label: `${words(sub)} ${words(r.family)} roles` }
    : { kind: "role", value: r.family, label: `${words(r.family)} roles` };
}

/** The one city (or, without a city, the one state) a job names; null when it names none or several. */
function placeOf(job: SkipJob): { kind: "city" | "state"; value: string; label: string } | null {
  const p = parseLocation(job.location, job.remote);
  const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  if (p.cities.length === 1) return { kind: "city", value: p.cities[0]!, label: `${title(p.cities[0]!)}${p.states.length === 1 ? `, ${p.states[0]}` : ""}` };
  if (p.cities.length === 0 && p.states.length === 1) return { kind: "state", value: p.states[0]!, label: p.states[0]! };
  return null;
}

/** The active effects from a person's skips. Pure. `cleared` maps an effect id to when the person last removed it. */
export function skipEffectsOf(signals: readonly SkipSignal[], cleared: Readonly<Record<string, string>>, now: Date): SkipEffect[] {
  const F = SKIP_FEEDBACK;
  const since = now.getTime() - F.windowDays * DAY_MS;
  const counts = (id: string, s: SkipSignal) => s.at.getTime() >= since && !(cleared[id] && s.at.getTime() <= new Date(cleared[id]).getTime());
  const out: SkipEffect[] = [];

  const groups = new Map<string, Omit<SkipEffect, "delta">>();
  for (const s of signals) {
    const key = s.reason === "not_my_kind" ? roleOf(s.title) : s.reason === "wrong_location" ? placeOf(s) : null;
    if (!key) continue;
    const id = `${key.kind}:${key.value}`;
    if (!counts(id, s)) continue;
    const g = groups.get(id) ?? { id, ...key, reason: s.reason, skips: 0 };
    g.skips++;
    groups.set(id, g);
  }
  for (const g of groups.values()) if (g.skips >= F.minSkips) out.push({ ...g, delta: -F.penalty });

  // Levels: the second-highest level skipped as too senior is the floor (the smaller effect), and the reverse for too junior.
  for (const [reason, kind] of [["too_senior", "level_above"], ["too_junior", "level_below"]] as const) {
    const above = kind === "level_above";
    const levels = signals.filter((s) => s.reason === reason && counts(kind, s)).map(levelOf).filter((l): l is string => l !== null);
    if (levels.length < F.minSkips) continue;
    const value = [...levels].sort((a, b) => (above ? LEVEL_RANK[b]! - LEVEL_RANK[a]! : LEVEL_RANK[a]! - LEVEL_RANK[b]!))[F.minSkips - 1]!;
    const skips = levels.filter((l) => (above ? LEVEL_RANK[l]! >= LEVEL_RANK[value]! : LEVEL_RANK[l]! <= LEVEL_RANK[value]!)).length;
    out.push({ id: kind, kind, reason, value, label: `${value} level and ${above ? "above" : "below"}`, skips, delta: -F.penalty });
  }
  return out.sort((a, b) => b.skips - a.skips || a.id.localeCompare(b.id));
}

function applies(e: SkipEffect, job: SkipJob): boolean {
  switch (e.kind) {
    case "role": return roleOf(job.title)?.value === e.value;
    case "city": return parseLocation(job.location, job.remote).cities.includes(e.value);
    case "state": return parseLocation(job.location, job.remote).states.includes(e.value);
    case "level_above":
    case "level_below": {
      const l = levelOf(job);
      if (!l) return false;
      return e.kind === "level_above" ? LEVEL_RANK[l]! >= LEVEL_RANK[e.value]! : LEVEL_RANK[l]! <= LEVEL_RANK[e.value]!;
    }
  }
}

function because(e: SkipEffect): string {
  switch (e.kind) {
    case "role": return `${e.skips} ${e.label.replace(/ roles$/, "")} jobs as not your kind of role`;
    case "level_above": return `${e.skips} jobs at ${e.value} level or above as too senior`;
    case "level_below": return `${e.skips} jobs at ${e.value} level or below as too junior`;
    case "city":
    case "state": return `${e.skips} jobs in ${e.label} for the location`;
  }
}

/** The total fit change for a job (capped) and the reason, naming the effect with the most skips, or 0 and null. */
export function skipPenalty(effects: readonly SkipEffect[], job: SkipJob): { delta: number; reason: string | null } {
  const hits = effects.filter((e) => applies(e, job));
  if (hits.length === 0) return { delta: 0, reason: null };
  const delta = Math.round(Math.max(-SKIP_FEEDBACK.maxTotal, hits.reduce((s, e) => s + e.delta, 0)) * 100) / 100;
  return { delta, reason: `${SKIP_REASON_PREFIX}${because(hits[0]!)} (${delta.toFixed(2)} fit)` };
}

const PENALTY_RE = /\((-0\.\d\d) fit\)$/;

/** The fit change a skip penalty made to a shortlist row (0 when none), so the raw fit can be recovered. */
export function skipPenaltyOf(reasons: readonly string[] | null | undefined): number {
  for (const r of reasons ?? []) {
    if (!r.startsWith(SKIP_REASON_PREFIX)) continue;
    const m = PENALTY_RE.exec(r);
    if (m) return Number(m[1]);
  }
  return 0;
}

// ---- storage -----------------------------------------------------------------------------------------------------------

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function loadCleared(db: Db, userId: string): Promise<Record<string, string>> {
  const [row] = await db.select({ cleared: sql<unknown>`${profiles.preferences} -> 'skipFeedback' -> 'cleared'` }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return Object.fromEntries(Object.entries(rec(row?.cleared)).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** The person's active skip effects, from their dismissed rows with a matcher reason inside the window. */
export async function loadSkipEffects(db: Db, userId: string, now: Date): Promise<SkipEffect[]> {
  const rows = await db.select({
    reason: shortlist.skipReason, at: shortlist.dismissedAt, title: jobs.title, location: jobs.location, remote: jobs.remote,
    seniority: sql<string | null>`(SELECT js.spec ->> 'seniority' FROM job_specs js WHERE js.job_id = ${jobs.id} ORDER BY js.version DESC LIMIT 1)`,
  }).from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).where(and(
    eq(shortlist.userId, userId), eq(shortlist.status, "dismissed"), inArray(shortlist.skipReason, [...MATCHER_SKIP_REASONS]),
    gte(shortlist.dismissedAt, new Date(now.getTime() - SKIP_FEEDBACK.windowDays * DAY_MS)),
  ));
  return skipEffectsOf(rows.map((r) => ({ ...r, reason: r.reason!, at: r.at! })), await loadCleared(db, userId), now);
}

/** Removes an active effect: skips up to now stop counting for it. False when no such effect is active. */
export async function clearSkipEffect(db: Db, userId: string, id: string, now: Date): Promise<boolean> {
  const effects = await loadSkipEffects(db, userId, now);
  if (!effects.some((e) => e.id === id)) return false;
  const cleared = { ...await loadCleared(db, userId), [id]: now.toISOString() };
  await db.update(profiles)
    .set({ preferences: sql`jsonb_set(coalesce(${profiles.preferences}, '{}'::jsonb), '{skipFeedback}', ${JSON.stringify({ cleared })}::jsonb, true)` })
    .where(eq(profiles.userId, userId));
  return true;
}

// ---- the shortlist hook ------------------------------------------------------------------------------------------------

type Penalizable = { jobId: string; fit: number; reasons: string[]; confidence?: number; rankScore?: number };

/**
 * Applies the person's skip effects to scored shortlist candidates, in place: fit (and the ranking key) move down by at
 * most 0.1 and a reason says why. Call only on candidates that already passed the gates and the lane minimum. Never throws:
 * a failure leaves the candidates as they were.
 */
export async function applySkipFeedback(db: Db, userId: string, items: Penalizable[], jobOf: (jobId: string) => SkipJob | undefined, now: Date): Promise<void> {
  if (items.length === 0) return;
  try {
    const effects = await loadSkipEffects(db, userId, now);
    if (effects.length === 0) return;
    for (const item of items) {
      const job = jobOf(item.jobId);
      if (!job) continue;
      const { delta, reason } = skipPenalty(effects, job);
      if (!reason) continue;
      const fit = Math.max(0, Math.round((item.fit + delta) * 1000) / 1000);
      const applied = Math.round((fit - item.fit) * 100) / 100;
      if (applied === 0) continue;
      item.fit = fit;
      if (item.rankScore != null) item.rankScore = Math.round((item.rankScore + applied * (item.confidence ?? 1)) * 10000) / 10000;
      // Second place, as the outcome nudge: a model's explanation line goes first. Gap lines and this line are kept when trimmed.
      item.reasons = withReason(item.reasons, applied === delta ? reason : reason.replace(PENALTY_RE, `(${applied.toFixed(2)} fit)`), 1);
    }
  } catch (err) {
    // Feedback is a nudge, never a reason for a shortlist to fail.
    warnSwallowed("match.skip_feedback_failed", err);
  }
}
