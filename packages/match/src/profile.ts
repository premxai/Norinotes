import { and, asc, careerPointEmbeddings, careerPoints, desc, eq, lanes, profiles, sql, type Db } from "@norinote/db";
import { normalizeCountry, parseWorkAuthMap, type CountryAuth } from "@norinote/shared";
import { canonicalSkills, type SkillMap, DEFAULT_SKILL_MAP } from "./skills.js";
import type { LaneLike } from "./lanes.js";

// ---- work authorisation ---------------------------------------------------------------------------------------------

/** What the user told us about working in one country (the shared, pinned shape). `null` means they did not say. */
export type { CountryAuth };

export type WorkAuth = {
  /** Keyed by ISO-like country code ("US", "GB", "CA") after normalisation. */
  countries: Record<string, CountryAuth>;
  /** The country the user mostly applies in: the profile location's country, else "US", else the first listed. */
  primary: string | null;
};

export { normalizeCountry };

/**
 * Reads `profiles.work_auth` through the shared parser (per-country form and the legacy flat form), then picks the
 * country the user mostly applies in.
 */
export function parseWorkAuth(raw: Record<string, unknown> | null | undefined, profileLocation?: string | null): WorkAuth {
  const countries = parseWorkAuthMap(raw);
  const located = profileLocation ? Object.keys(countries).find((c) => new RegExp(`\\b${c}\\b`, "i").test(profileLocation)) : undefined;
  const primary = located ?? (countries.US ? "US" : (Object.keys(countries)[0] ?? null));
  return { countries, primary };
}

// ---- career points ----------------------------------------------------------------------------------------------------

export type EvidencePoint = {
  id: string;
  kind: string;
  title: string;
  org: string | null;
  startDate: string | null;
  endDate: string | null;
  text: string;
  /** Canonical keys. */
  skills: string[];
  scope: Record<string, unknown>;
  metrics: Record<string, unknown>;
  embedding: number[] | null;
};

export type MatchProfile = {
  userId: string;
  location: string | null;
  workAuth: WorkAuth;
  /** Enabled lanes only. */
  lanes: Array<LaneLike & { id: string; name: string; minFit: number }>;
  /** Years of paid experience from role points; null when there are no career points at all. */
  experienceYears: number | null;
  points: EvidencePoint[];
};

/** `YYYY` or `YYYY-MM` to a fractional year. `end` of null means "now". */
export function dateToYear(d: string | null, now: Date): number | null {
  if (d == null || d === "") return null;
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(d.trim());
  if (!m) return /present|current|now/i.test(d) ? now.getUTCFullYear() + now.getUTCMonth() / 12 : null;
  return Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0);
}

/** `[start, end]` in fractional years, or null when the point has no usable start. A missing end means still going. */
export function pointInterval(p: Pick<EvidencePoint, "startDate" | "endDate">, now: Date): [number, number] | null {
  const nowYear = now.getUTCFullYear() + now.getUTCMonth() / 12;
  const start = dateToYear(p.startDate, now);
  const rawEnd = dateToYear(p.endDate, now);
  if (start == null && rawEnd == null) return null;
  const s = start ?? (rawEnd as number);
  // A year-only end date means the end of that year.
  const e = rawEnd == null ? nowYear : (p.endDate && /^\d{4}$/.test(p.endDate.trim()) ? rawEnd + 1 : rawEnd + 1 / 12);
  return [s, Math.min(Math.max(e, s), nowYear)];
}

/** Total length of the union of intervals, in years. Overlapping jobs are counted once. */
export function unionYears(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = NaN;
  let curEnd = NaN;
  for (const [s, e] of sorted) {
    if (Number.isNaN(curStart)) { curStart = s; curEnd = e; continue; }
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else { total += curEnd - curStart; curStart = s; curEnd = e; }
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total;
}

export function experienceYearsOf(points: readonly EvidencePoint[], now: Date): number | null {
  if (points.length === 0) return null;
  const roles = points.filter((p) => p.kind === "role").map((p) => pointInterval(p, now)).filter((i): i is [number, number] => i !== null);
  return Math.round(unionYears(roles) * 10) / 10;
}

/** Loads one user's profile facts the matcher needs: work authorisation, enabled lanes, career points with embeddings. */
export async function loadMatchProfile(db: Db, userId: string, now: Date, skills: SkillMap = DEFAULT_SKILL_MAP): Promise<MatchProfile> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const laneRows = await db.select().from(lanes).where(and(eq(lanes.userId, userId), eq(lanes.enabled, true))).orderBy(asc(lanes.createdAt));
  const pointRows = await db
    .select({ p: careerPoints, embedding: careerPointEmbeddings.embedding })
    .from(careerPoints)
    .leftJoin(careerPointEmbeddings, eq(careerPointEmbeddings.careerPointId, careerPoints.id))
    .where(eq(careerPoints.userId, userId));
  const points: EvidencePoint[] = pointRows.map(({ p, embedding }) => ({
    id: p.id, kind: p.kind, title: p.title, org: p.org, startDate: p.startDate, endDate: p.endDate, text: p.text,
    skills: canonicalSkills(p.skills, skills), scope: p.scope, metrics: p.metrics, embedding: embedding ?? null,
  }));
  return {
    userId,
    location: profile?.location ?? null,
    workAuth: parseWorkAuth(profile?.workAuth, profile?.location),
    lanes: laneRows.map((l) => ({ id: l.id, name: l.name, titles: l.titles, locations: l.locations, remote: l.remote, minFit: l.minFit, enabled: true })),
    experienceYears: experienceYearsOf(points, now),
    points,
  };
}

// ---- profile embedding ------------------------------------------------------------------------------------------------

/** Unit-length mean of vectors; null when there are none. */
export function meanVector(vectors: readonly number[][]): number[] | null {
  const first = vectors[0];
  if (!first) return null;
  const sum = new Array<number>(first.length).fill(0);
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i]! += v[i] ?? 0;
  const norm = Math.hypot(...sum);
  return norm === 0 ? null : sum.map((x) => x / norm);
}

/**
 * Mean of a user's most recent career point embeddings (current roles first). Used by matchNewJobs, which has no profile
 * embedding passed in; buildShortlist takes the caller's instead (the graph package exports `profileEmbedding`).
 */
export async function meanProfileEmbedding(db: Db, userId: string, top = 30): Promise<number[] | null> {
  const rows = await db
    .select({ embedding: careerPointEmbeddings.embedding })
    .from(careerPointEmbeddings)
    .innerJoin(careerPoints, eq(careerPoints.id, careerPointEmbeddings.careerPointId))
    .where(eq(careerPointEmbeddings.userId, userId))
    .orderBy(sql`(${careerPoints.endDate} IS NULL) DESC`, sql`${careerPoints.endDate} DESC NULLS LAST`, desc(careerPoints.createdAt))
    .limit(top);
  return meanVector(rows.map((r) => r.embedding));
}
