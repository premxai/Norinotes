import { and, careerPoints, eq, profiles, type Db } from "@norinote/db";
import type { LaneLike } from "./lanes.js";
import { dateToYear, pointInterval, type EvidencePoint } from "./profile.js";
import { adjacentTitles, mainFamilyOf, type RoleFamily } from "./roles.js";

/**
 * The widening ladder ("never empty"). When a user's lanes give fewer than `WIDEN_TARGET` shortlist candidates, the
 * shortlist widens step by step, each step keeping everything the earlier ones allowed:
 *
 *  1. `adjacent_titles`  the lane titles plus neighbours in the same family (Frontend Engineer -> Software Engineer, UI Engineer)
 *  2. `remote`           remote jobs for those titles, when the user did not say "no remote"
 *  3. `older`            jobs up to 90 days old instead of 60
 *  4. `role_pool`        the role-family pool for the user's main family and metro (see `rolePool`)
 *
 * Gates (citizenship, clearance, sponsorship, years, location scope), blocked companies and jobs the user already
 * dismissed or applied to are never widened; only what the lanes asked for is. Every widened candidate gets the same fit
 * as a lane match and must clear `WIDEN_MIN_FIT`, in every step including `older`; lane jobs that failed the gates or
 * their lane minimum are not brought back under a widened label. Within a step the best candidates win: the fit already
 * prefers the same family and seniority band, and jobs with a real spec come first.
 */

export const WIDENED_BY = ["adjacent_titles", "remote", "older", "role_pool"] as const;
export type WidenedBy = (typeof WIDENED_BY)[number];

/** Fewer shortlist candidates than this from the lanes triggers the ladder, and the ladder fills up to it. */
export const WIDEN_TARGET = 20;
export const OLDER_MAX_AGE_DAYS = 90;
/**
 * Widened rows are scored with the same fit as lane matches and must reach this (or the user's own lane minimum, when that
 * is lower): a stretch, not noise. See the fit scale in fit.ts.
 */
export const WIDEN_MIN_FIT = 0.45;

/** Stored in `shortlist.reasons` next to the human sentences; the API strips it and reports `widenedBy` instead. */
export const WIDENED_REASON_PREFIX = "widened:";
export const widenedReason = (by: WidenedBy): string => `${WIDENED_REASON_PREFIX}${by}`;

export function widenedByOf(reasons: readonly string[] | null | undefined): WidenedBy | null {
  for (const r of reasons ?? []) {
    if (!r.startsWith(WIDENED_REASON_PREFIX)) continue;
    const by = r.slice(WIDENED_REASON_PREFIX.length);
    if ((WIDENED_BY as readonly string[]).includes(by)) return by as WidenedBy;
  }
  return null;
}

export const withoutWidenedReasons = (reasons: readonly string[]): string[] => reasons.filter((r) => !r.startsWith(WIDENED_REASON_PREFIX));

// ---- temporary lane ---------------------------------------------------------------------------------------------------

export type TemporaryLane = LaneLike & { id: string; name: string; minFit: number; enabled: true; temporary: true };

/** "Senior Frontend Engineer at Acme" -> "Senior Frontend Engineer". */
function cleanRoleTitle(title: string): string {
  return title.replace(/\s+(?:at|@)\s+.*$/i, "").replace(/\s*[|]\s*.*$/, "").replace(/\s+/g, " ").trim();
}

type TempPoint = Pick<EvidencePoint, "kind" | "title" | "startDate" | "endDate" | "scope">;

function pointLocation(scope: Record<string, unknown>): string | null {
  for (const k of ["location", "city"]) {
    const v = scope[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * A lane for a user who has none yet: the title of their most recent role (a current role counts as most recent), in their
 * profile location (else the location on that role), remote accepted. Null without a role title.
 */
export function deriveTemporaryLane(points: readonly TempPoint[], profileLocation: string | null, now: Date): TemporaryLane | null {
  const roles = points.filter((p) => p.kind === "role" && cleanRoleTitle(p.title) !== "");
  if (roles.length === 0) return null;
  const key = (p: TempPoint): [number, number] => {
    const iv = pointInterval(p, now);
    return [iv ? iv[1] : -Infinity, dateToYear(p.startDate, now) ?? -Infinity];
  };
  const latest = [...roles].sort((a, b) => {
    const [ae, as] = key(a);
    const [be, bs] = key(b);
    return be - ae || bs - as;
  })[0]!;
  const title = cleanRoleTitle(latest.title);
  const where = profileLocation?.trim() || pointLocation(latest.scope);
  return { id: "temporary", name: title.slice(0, 100), titles: [title], locations: where ? [where] : [], remote: true, minFit: 0.5, enabled: true, temporary: true };
}

/** `deriveTemporaryLane` for a stored user: reads the profile location and the role points (no embeddings). */
export async function loadTemporaryLane(db: Db, userId: string, now: Date): Promise<TemporaryLane | null> {
  const [profile] = await db.select({ location: profiles.location }).from(profiles).where(eq(profiles.userId, userId));
  const points = await db
    .select({ kind: careerPoints.kind, title: careerPoints.title, startDate: careerPoints.startDate, endDate: careerPoints.endDate, scope: careerPoints.scope })
    .from(careerPoints).where(and(eq(careerPoints.userId, userId), eq(careerPoints.kind, "role")));
  return deriveTemporaryLane(points, profile?.location ?? null, now);
}

/** True when the user said they do not want remote jobs (`profiles.preferences.remote === "no"`). */
export async function loadRemoteExcluded(db: Db, userId: string): Promise<boolean> {
  const [profile] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId));
  return ((profile?.preferences ?? {}) as Record<string, unknown>).remote === "no";
}

// ---- the plan ---------------------------------------------------------------------------------------------------------

export type SimpleLane = Pick<LaneLike, "titles" | "locations" | "remote">;

export type WideningStep = {
  by: WidenedBy;
  /** The lanes jobs must fit in this step (and that the location gate is checked against). Not used by `role_pool`. */
  lanes: SimpleLane[];
  maxAgeDays: number;
  /** Only for `role_pool`. */
  pool?: { family: RoleFamily; metro: string | null; remote: boolean };
};

const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

/**
 * The ladder for these lanes, in order. A step that would change nothing is left out (a lane that already accepts remote
 * has no remote step, a title with no neighbours has no adjacent step). `extraTitles` (the user's latest role) help name
 * the main family when the lane titles do not.
 */
export function wideningPlan(base: readonly SimpleLane[], opts: { remoteExcluded: boolean; extraTitles?: readonly string[] }): WideningStep[] {
  const plan: WideningStep[] = [];
  let current: SimpleLane[] = base.map((l) => ({ titles: [...l.titles], locations: [...l.locations], remote: l.remote }));

  const widenedTitles = current.map((l) => ({ ...l, titles: dedupe([...l.titles, ...l.titles.flatMap(adjacentTitles)]) }));
  if (widenedTitles.some((l, i) => l.titles.length > current[i]!.titles.length)) {
    current = widenedTitles;
    plan.push({ by: "adjacent_titles", lanes: current, maxAgeDays: 60 });
  }

  if (!opts.remoteExcluded && current.some((l) => !l.remote && l.locations.length > 0)) {
    current = current.map((l) => ({ ...l, remote: true }));
    plan.push({ by: "remote", lanes: current, maxAgeDays: 60 });
  }

  plan.push({ by: "older", lanes: current, maxAgeDays: OLDER_MAX_AGE_DAYS });

  const family = mainFamilyOf([...base.flatMap((l) => l.titles), ...(opts.extraTitles ?? [])]);
  if (family !== "other") {
    const metro = base.flatMap((l) => l.locations).find((l) => l.trim() !== "") ?? null;
    plan.push({ by: "role_pool", lanes: [], maxAgeDays: 60, pool: { family, metro, remote: !opts.remoteExcluded } });
  }
  return plan;
}
