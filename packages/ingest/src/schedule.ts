import type { AtsType } from "@norinote/shared";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Registry priorities: higher polls first. */
/** `boost`: a user is waiting on the company (see `companies.boost_until`); it counts only until that time. */
export const PRIORITY = { registry: 100, seed: 0, empty: -10, boost: 200 } as const;

/** A board that answers "not found" keeps its jobs open this long before they close. */
export const PROBATION_MS = 3 * DAY;
/** A board with no jobs for this long is disabled. */
export const EMPTY_DISABLE_MS = 14 * DAY;
/** Consecutive failed polls that disable a board. */
export const ERROR_STREAK_LIMIT = 5;
/** Disabled and dead boards are looked at again this often. */
export const RECHECK_MS = 7 * DAY;
/** A board on probation is asked again this often, so three days of "not found" really means three days. */
export const PROBATION_RECHECK_MS = 12 * HOUR;
/** Complete reads that must miss a job before it closes. */
export const MISSING_READS_TO_CLOSE = 2;

/** The soonest a board of this system is polled again, however busy it is (its feed is heavy or strict). */
const MIN_INTERVAL_MS: Partial<Record<AtsType, number>> = {
  workday: 6 * HOUR,
  oracle: 6 * HOUR,
  icims: 6 * HOUR,
  smartrecruiters: 2 * HOUR,
  workable: 3 * HOUR,
};
const DEFAULT_MIN_INTERVAL_MS = 30 * 60_000;

/** Most lanes that count towards the demand boost. */
const DEMAND_CAP = 6;

export type NextPollInput = {
  atsType: AtsType;
  /** Jobs published (or first seen) in the last 7 days. */
  newJobs7d: number;
  /** Enabled lanes (of any user) that match this company's recent jobs. */
  demand?: number;
};

/**
 * How long until a healthy board is read again: `clamp(24h / (1 + new_jobs_7d / 7), 1h, 48h)`, divided by up to 3 for
 * boards that fit many users' lanes, and never shorter than the job system's own minimum.
 */
export function pollIntervalMs({ atsType, newJobs7d, demand = 0 }: NextPollInput): number {
  const base = Math.min(48 * HOUR, Math.max(HOUR, DAY / (1 + Math.max(0, newJobs7d) / 7)));
  const boosted = base / (1 + Math.min(Math.max(0, demand), DEMAND_CAP) / 3);
  return Math.round(Math.max(boosted, MIN_INTERVAL_MS[atsType] ?? DEFAULT_MIN_INTERVAL_MS));
}

/** Wait after the n-th consecutive failure (n >= 1): 30 min, 1 h, 2 h, 4 h, capped at 6 h. */
export function errorRetryMs(errorStreak: number): number {
  return Math.min(6 * HOUR, 30 * 60_000 * 2 ** Math.max(0, errorStreak - 1));
}
