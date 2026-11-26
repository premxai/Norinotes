import { sql, type SQL } from "drizzle-orm";
import { jobs, lanes } from "@norinote/db";
import { AREA_NAMES, parseLocation } from "./location.js";

/**
 * Lane fit: does a job fit one of the user's lanes by title, location and remote? One definition, written twice on
 * purpose: `laneFitsSql` runs inside Postgres (the shortlist filter) and `laneFitsJob` is its in-memory mirror (used to
 * find which lane matched, for gates and for per-lane minimum fit). A test keeps the two in agreement.
 *
 * Title: word overlap. Lane titles lose seniority and filler words ("Senior", "Staff", "II", "New Grad"), "developer"
 * counts as "engineer", plurals are tolerated, and the job title must contain every remaining word (at least 75% when
 * the lane title has more than two). So the lane "Senior Software Engineer" fits "Software Engineer II, Payments".
 *
 * Location: a lane with no locations fits anywhere, and a remote job fits a lane that accepts remote. Otherwise lane locations
 * are read as places with the location parser (location.ts). A US state ("California", "CA") or a country ("United
 * States", "USA", "US") fits jobs in that state or country. A city fits jobs that name it or one of its other names
 * ("NYC" and "New York", "SF Bay Area" and "San Francisco", both ways) in the state and country the lane names
 * ("Portland, OR" does not fit "Portland, ME"), and jobs in its metro area ("Palo Alto" for San Francisco) in its country.
 * A job with no location text fits only a lane without locations (or a remote lane, when the job is remote).
 *
 * The SQL side of the location check is a broader prefilter: it lets through jobs naming the lane's city in any state and
 * any place inside the lane's state or country, without parsing. Where lanes decide (the shortlist candidates,
 * `matchNewJobs`, stale rows, the gates) the exact `locationFits` runs on what it lets through. Remote jobs limited to
 * another country or region ("Europe Remote") still fit a remote lane here; the gates (`checkGates`) take them out for a
 * user who cannot work there.
 */

export const TITLE_STOP_WORDS = [
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "associate", "entry", "level", "new", "grad", "graduate",
  "early", "career", "the", "of", "and", "for", "a", "an", "in", "to", "i", "ii", "iii", "iv", "v",
] as const;

const STOP = new Set<string>(TITLE_STOP_WORDS);

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

/** Lower case, accents dropped, everything but letters and digits a single space. */
function placeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** First comma-separated part of a lane location, reduced to letters, digits and single spaces. */
export function locationNeedle(laneLocation: string): string {
  return placeText(laneLocation.split(",")[0] ?? "");
}

/** Other names of a city lane's own city, both ways: a lane "NYC" fits "New York, NY" and a lane "New York" fits "NYC". */
export const CITY_SYNONYMS: Record<string, string> = {
  nyc: "new york", "new york city": "new york",
  sf: "san francisco", "sf bay area": "san francisco", "bay area": "san francisco", "san francisco bay area": "san francisco",
};

/** Short forms job feeds use for a lane's city (`NYC - 1211 Ave of the Americas`). Mirrored in `locationFitsSql`. */
export const NEEDLE_ALIASES: Record<string, string> = {
  "new york": "brooklyn|jersey city",
  // A city lane covers its metro area: people in these hubs commute across it, and most postings name the suburb.
  "san francisco": "oakland|berkeley|emeryville|san mateo|burlingame|foster city|redwood city|menlo park|palo alto|mountain view|sunnyvale|santa clara|san jose|cupertino|los gatos|milpitas|fremont",
  "seattle": "bellevue|redmond|kirkland",
  "boston": "cambridge|somerville|waltham",
  "los angeles": "santa monica|culver city|playa vista|venice|pasadena|burbank|el segundo",
};

/** The city's own names (`own`) and its metro (`metro`) for a city lane needle. */
function cityWords(needle: string): { own: string[]; metro: string[] } {
  const city = CITY_SYNONYMS[needle] ?? needle;
  return {
    own: [city, ...Object.keys(CITY_SYNONYMS).filter((s) => CITY_SYNONYMS[s] === city)],
    metro: NEEDLE_ALIASES[city]?.split("|") ?? [],
  };
}

const hasWord = (text: string, word: string) => ` ${text} `.includes(` ${word} `);
const overlaps = (a: readonly string[], b: readonly string[]) => a.length === 0 || b.length === 0 || a.some((x) => b.includes(x));

type Place = { states: string[]; countries: string[] };

/**
 * US states and countries a place text names. What the text writes beside a city wins over the city's own entry in the
 * tables (`Portland, ME` is in Maine, though the tables put Portland in Oregon); a city alone counts as its table entry.
 * `drop` words are removed first (the lane's own city name, so the `Washington` of `Washington, DC` is not the state).
 */
function placeOf(text: string, drop: readonly string[] = []): Place {
  const all = parseLocation(text);
  let rest = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const name of [...all.cities, ...drop]) rest = rest.replace(new RegExp(`(^|[^a-z0-9])${name.replace(/ /g, "[^a-z0-9]+")}(?![a-z0-9])`, "gi"), "$1 ");
  const stated = parseLocation(rest);
  return {
    states: stated.states.length > 0 ? stated.states : all.states,
    countries: stated.countries.length > 0 ? stated.countries : all.countries,
  };
}

type LanePlace =
  | { kind: "area"; area: string }
  | { kind: "city"; own: string[]; metro: string[]; states: string[]; countries: string[] };

const LANE_PLACES = new Map<string, LanePlace>();

/**
 * What a lane location names. A US state (`California`, `CA`) or a country (`United States`, `USA`, `US`) on its own is
 * an area; anything else is a city (with the state or country written after it: `Portland, OR`, `Cambridge, MA`). A
 * city name wins over a state of the same name (`New York`), and so does a state name followed by a state
 * (`Washington, DC` is the city).
 */
function lanePlace(laneLocation: string): LanePlace {
  const hit = LANE_PLACES.get(laneLocation);
  if (hit) return hit;
  const needle = locationNeedle(laneLocation);
  const rest = laneLocation.split(",").slice(1).join(",").trim();
  const area = AREA_NAMES.names[needle];
  const first = laneLocation.split(",")[0] ?? "";
  const isCity = parseLocation(first).cities.length > 0 || (area?.startsWith("US-") && parseLocation(rest).states.length > 0);
  let place: LanePlace;
  if (area && !isCity) place = { kind: "area", area };
  else {
    const { own, metro } = cityWords(needle);
    place = { kind: "city", own, metro, ...(rest ? placeOf(rest) : placeOf(first)) };
  }
  LANE_PLACES.set(laneLocation, place);
  return place;
}

/**
 * Does the job's location text fit one lane location? The text is read part by part (`;`, `|` and `/` separate places).
 * An area lane fits a part in that state or country. A city lane fits a part that names the city (or one of its other names)
 * in the lane's state and country, when both are known, or a part that names a place of its metro in the lane's country.
 */
export function locationMatches(laneLocation: string, jobLocation: string | null): boolean {
  if (!jobLocation) return false;
  const lane = lanePlace(laneLocation);
  return jobLocation.split(/[;|/]/).some((part) => {
    if (lane.kind === "area") {
      const place = placeOf(part);
      return lane.area.startsWith("US-") ? place.states.includes(lane.area.slice(3)) : place.countries.includes(lane.area);
    }
    const text = placeText(part);
    if (!text) return false;
    const own = lane.own.some((w) => hasWord(text, w));
    const metro = lane.metro.some((w) => hasWord(text, w));
    if (!own && !metro) return false;
    const place = placeOf(part, lane.own);
    return overlaps(lane.countries, place.countries) && (metro || overlaps(lane.states, place.states));
  });
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

/** A constant jsonb literal (our own tables, so inlined: Postgres reads it once per query, not once per row). */
const jsonbLiteral = (value: unknown) => sql.raw(`'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`);
/** Lane needle -> every word of its city and metro, as a regex alternation (see `cityWords`). */
const cityWordsSql = jsonbLiteral(Object.fromEntries([...Object.keys(CITY_SYNONYMS), ...Object.keys(NEEDLE_ALIASES)].map((needle) => {
  const { own, metro } = cityWords(needle);
  return [needle, [...own, ...metro].join("|")];
})));
/** Lane needle -> area id, and area id -> its place names and capitalised codes as regex alternations. */
const areaIdsSql = jsonbLiteral(AREA_NAMES.names);
const areaPatternsSql = jsonbLiteral(Object.fromEntries(Object.entries(AREA_NAMES.areas).map(([id, a]) => [id, { names: a.names.join("|"), codes: a.codes.join("|") }])));

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

const ACCENTED = "áàâãäåéèêëíìîïóòôõöøúùûüçñý";
const PLAIN = "aaaaaaeeeeiiiiooooooouuuucny";

/**
 * True when the lane's location and remote preference accept `jobs`. Broader than `locationMatches` on purpose: a lane
 * location fits when the job's location names its city or metro (any state), or any place inside the US state or country
 * it names. Callers that decide lanes (`buildShortlist`, `matchNewJobs`, `removeStaleRows`, the gates) apply the exact
 * `locationFits` to what this lets through.
 */
export function locationFitsSql(): SQL {
  const text = sql`regexp_replace(translate(lower(${jobs.location}), ${ACCENTED}, ${PLAIN}), '[^a-z0-9]+', ' ', 'g')`;
  const codes = sql`replace(${jobs.location}, '.', '')`;
  return sql`(
    cardinality(${lanes.locations}) = 0
    OR (${lanes.remote} AND ${jobs.remote})
    OR (${jobs.location} IS NOT NULL AND EXISTS (
      SELECT 1
      FROM unnest(${lanes.locations}) AS ll(loc)
      CROSS JOIN LATERAL (SELECT trim(regexp_replace(translate(lower(split_part(ll.loc, ',', 1)), ${ACCENTED}, ${PLAIN}), '[^a-z0-9]+', ' ', 'g')) AS needle) n
      CROSS JOIN LATERAL (SELECT ${areaPatternsSql} -> (${areaIdsSql} ->> n.needle) AS area) a
      WHERE (n.needle <> '' AND ${text} ~ ('\\m(' || coalesce(${cityWordsSql} ->> n.needle, n.needle) || ')\\M'))
        OR (a.area IS NOT NULL AND (
          ${text} ~ ('\\m(' || (a.area ->> 'names') || ')\\M') OR ${codes} ~ ('\\m(' || (a.area ->> 'codes') || ')\\M')
        ))
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
