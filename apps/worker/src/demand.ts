import { and, asc, desc, eq, isNull, jobs, lanes, sql } from "@norinote/db";
import type { Db } from "@norinote/db";

/** Words that say nothing about the role, so a lane title is not held to them. */
const FILLER = new Set(["a", "an", "and", "of", "the", "for", "in", "at", "to", "i", "ii", "iii"]);

const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim().split(" ").filter(Boolean);

/** True when a job title is one of the roles a lane title asks for: every meaningful word of the lane title is in it. */
export function laneTitleMatches(laneTitle: string, jobTitle: string): boolean {
  const need = words(laneTitle).filter((w) => !FILLER.has(w));
  if (need.length === 0) return false;
  const have = new Set(words(jobTitle));
  return need.every((w) => have.has(w));
}

/** How many lanes (each a list of titles) have at least one title that matches at least one of these job titles. */
export function countDemand(laneTitles: readonly (readonly string[])[], jobTitles: readonly string[]): number {
  let n = 0;
  for (const titles of laneTitles) if (titles.some((t) => jobTitles.some((j) => laneTitleMatches(t, j)))) n++;
  return n;
}

const RECENT_JOBS = 100;
const LANE_CACHE_MS = 5 * 60_000;
const WEEK_MS = 7 * 86_400_000;

export type Demand = {
  /** Enabled lanes (of any user) that match the titles of the company's most recent open jobs. */
  lanes: number;
  /** Of those jobs, the ones from the last 7 days (posted, or first seen) whose title matches an enabled lane. */
  matching7d: number;
};

/**
 * Lane demand for a company (see `Demand`), which sets how soon its board is read again. The lanes are read once per
 * five minutes and shared by every board polled in that time, and only titles and dates are read from `jobs`, so this
 * stays cheap. Boards with no jobs yet (a new candidate) have no demand.
 */
export function createDemandCounter(db: Db, now: () => Date): (companyId: string) => Promise<Demand> {
  let cache: { at: number; titles: string[][] } | null = null;
  const laneTitles = async (): Promise<string[][]> => {
    const at = now().getTime();
    if (cache && at - cache.at < LANE_CACHE_MS) return cache.titles;
    const rows = await db.select({ titles: lanes.titles }).from(lanes).where(eq(lanes.enabled, true));
    cache = { at, titles: rows.map((r) => r.titles ?? []).filter((t) => t.length > 0) };
    return cache.titles;
  };
  return async (companyId) => {
    const titles = await laneTitles();
    if (titles.length === 0) return { lanes: 0, matching7d: 0 };
    const recent = await db.select({ title: jobs.title, postedAt: jobs.postedAt, firstSeenAt: jobs.firstSeenAt }).from(jobs)
      .where(and(eq(jobs.companyId, companyId), isNull(jobs.closedAt)))
      .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt), asc(jobs.id))
      .limit(RECENT_JOBS);
    const since = now().getTime() - WEEK_MS;
    const all = titles.flat();
    const matching7d = recent.filter((j) => (j.postedAt ?? j.firstSeenAt).getTime() >= since && all.some((t) => laneTitleMatches(t, j.title))).length;
    return { lanes: countDemand(titles, recent.map((r) => r.title)), matching7d };
  };
}
