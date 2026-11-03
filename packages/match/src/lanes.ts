import { sql, type SQL } from "drizzle-orm";
import { jobs, lanes } from "@norinote/db";

/**
 * Lane fit: does a job fit one of the user's lanes by title, location and remote? One definition, written twice on
 * purpose: `laneFitsSql` runs inside Postgres (the shortlist filter) and `laneFitsJob` is its in-memory mirror (used to
 * find which lane matched, for gates and for per-lane minimum fit). A test keeps the two in agreement.
 *
 * Title: word overlap. Lane titles lose seniority and filler words ("Senior", "Staff", "II", "New Grad"), "developer"
 * counts as "engineer", plurals are tolerated, and the job title must contain every remaining word (at least 75% when
 * the lane title has more than two). So the lane "Senior Software Engineer" fits "Software Engineer II, Payments".
 *
 * Location: a lane with no locations fits anywhere. Otherwise the job fits when it is remote and the lane accepts remote,
 * or the first part of a lane location ("San Francisco" of "San Francisco, CA") appears as whole words in the job's
 * location. "United States" / "USA" / "US" are interchangeable. A job with no location text fits only a lane without
 * locations (or a remote lane, when the job is remote).
 */

export const TITLE_STOP_WORDS = [
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "associate", "entry", "level", "new", "grad", "graduate",
  "early", "career", "the", "of", "and", "for", "a", "an", "in", "to", "i", "ii", "iii", "iv", "v",
] as const;

const STOP = new Set<string>(TITLE_STOP_WORDS);
const US_ALIASES = ["us", "usa", "u.s.", "united states", "united states of america"];

/** Lower-case, "developer" and "programmer" become "engineer", everything but letters and digits becomes a space. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(?:developer|programmer)s?\b/g, "engineer")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The words of a lane title that must appear in a job title. Falls back to every word when all are filler. */
export function significantTitleWords(laneTitle: string): string[] {
  const words = [...new Set(normalizeTitle(laneTitle).split(" ").filter(Boolean))];
  const kept = words.filter((w) => !STOP.has(w));
  return kept.length > 0 ? kept : words;
}

function neededHits(total: number): number {
  return total <= 2 ? total : Math.ceil(total * 0.75);
}

export function titleMatches(laneTitle: string, jobTitle: string): boolean {
  const words = significantTitleWords(laneTitle);
  if (words.length === 0) return false;
  const jt = normalizeTitle(jobTitle);
  const hits = words.filter((w) => new RegExp(`\\b${w}(?:s|es)?\\b`).test(jt)).length;
  return hits >= neededHits(words.length);
}

/** First comma-separated part of a lane location, reduced to letters, digits and spaces. */
export function locationNeedle(laneLocation: string): string {
  return (laneLocation.split(",")[0] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

export function locationMatches(laneLocation: string, jobLocation: string | null): boolean {
  if (!jobLocation) return false;
  const loc = jobLocation.toLowerCase();
  const needle = locationNeedle(laneLocation);
  if (needle && new RegExp(`\\b${needle}\\b`).test(loc)) return true;
  if (US_ALIASES.includes(laneLocation.trim().toLowerCase())) return /\b(?:us|usa|united states)\b/.test(loc);
  return false;
}

export type LaneLike = { id?: string; name?: string; titles: string[]; locations: string[]; remote: boolean; minFit?: number; enabled?: boolean };
export type JobLike = { title: string; location: string | null; remote: boolean };

export function locationFits(lane: LaneLike, job: Pick<JobLike, "location" | "remote">): boolean {
  if (lane.locations.length === 0) return true;
  if (lane.remote && job.remote) return true;
  return lane.locations.some((l) => locationMatches(l, job.location));
}

export function laneFitsJob(lane: LaneLike, job: JobLike): boolean {
  return lane.titles.some((t) => titleMatches(t, job.title)) && locationFits(lane, job);
}

/** The enabled lanes a job fits. */
export function matchingLanes<L extends LaneLike>(lanesOfUser: readonly L[], job: JobLike): L[] {
  return lanesOfUser.filter((l) => l.enabled !== false && laneFitsJob(l, job));
}

// ---- SQL mirror --------------------------------------------------------------------------------------------------------

const stopList = sql.join(TITLE_STOP_WORDS.map((w) => sql`${w}`), sql`, `);
const usAliasList = sql.join(US_ALIASES.map((w) => sql`${w}`), sql`, `);

/** SQL for the normalised form of a title expression (see `normalizeTitle`). */
const normTitleSql = (expr: SQL | typeof jobs.title) =>
  sql`regexp_replace(regexp_replace(lower(${expr}), '\\m(developer|programmer)s?\\M', 'engineer', 'g'), '[^a-z0-9]+', ' ', 'g')`;

/**
 * True when some title of `lanes` fits `jobs.title`. Both tables must be in scope of the query that embeds it
 * (the shortlist filter uses a correlated EXISTS over lanes; matchNewJobs cross joins them).
 */
export function titleFitsSql(): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM unnest(${lanes.titles}) AS lt(title)
    CROSS JOIN LATERAL (
      SELECT coalesce(array_agg(DISTINCT w) FILTER (WHERE w NOT IN (${stopList})), array_agg(DISTINCT w)) AS words
      FROM regexp_split_to_table(trim(${normTitleSql(sql`lt.title`)}), ' ') AS w
      WHERE w <> ''
    ) x
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE ${normTitleSql(jobs.title)} ~ ('\\m' || w || '(s|es)?\\M')) AS hits, count(*) AS total
      FROM unnest(x.words) AS w
    ) y
    WHERE y.total > 0 AND y.hits >= CASE WHEN y.total <= 2 THEN y.total ELSE ceil(y.total * 0.75) END
  )`;
}

/** True when the lane's location and remote preference accept `jobs`. */
export function locationFitsSql(): SQL {
  return sql`(
    cardinality(${lanes.locations}) = 0
    OR (${lanes.remote} AND ${jobs.remote})
    OR (${jobs.location} IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(${lanes.locations}) AS ll(loc)
      WHERE (
        regexp_replace(trim(lower(split_part(ll.loc, ',', 1))), '[^a-z0-9 ]', '', 'g') <> ''
        AND lower(${jobs.location}) ~ ('\\m' || regexp_replace(trim(lower(split_part(ll.loc, ',', 1))), '[^a-z0-9 ]', '', 'g') || '\\M')
      ) OR (
        trim(lower(ll.loc)) IN (${usAliasList}) AND lower(${jobs.location}) ~ '\\m(us|usa|united states)\\M'
      )
    ))
  )`;
}

/** `lanes` row fits `jobs` row (title and location). Used with the shortlist filter and the new-jobs join. */
export function laneFitsSql(): SQL {
  return sql`(${titleFitsSql()} AND ${locationFitsSql()})`;
}

// ---- lanes that are not rows ---------------------------------------------------------------------------------------------

const textArraySql = (xs: readonly string[]): SQL =>
  xs.length > 0 ? sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`;

/**
 * True when some lane of `inline` fits `jobs`, for lanes that are not rows of the `lanes` table (a temporary lane derived
 * from career points, the widened lanes of the shortlist ladder). The lanes become a one-off derived table named `lanes`,
 * so the same `laneFitsSql` runs on it. `jobs` must be in scope; nothing else is needed.
 */
export function inlineLanesFitSql(inline: ReadonlyArray<Pick<LaneLike, "titles" | "locations" | "remote">>): SQL {
  if (inline.length === 0) return sql`false`;
  const values = inline.map((l) => sql`(${textArraySql(l.titles)}, ${textArraySql(l.locations)}, ${l.remote}::boolean)`);
  return sql`EXISTS (SELECT 1 FROM (VALUES ${sql.join(values, sql`, `)}) AS ${sql.identifier("lanes")}(titles, locations, remote) WHERE ${laneFitsSql()})`;
}
