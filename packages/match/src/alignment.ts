import type { JobSpec } from "@norinote/shared";
import { seniorityFromTitle } from "./heuristic-spec.js";
import { significantTitleWords, titleMatches } from "./lanes.js";
import { pointInterval, unionYears, type EvidencePoint } from "./profile.js";
import { roleFamilyOf, type RoleClass, type RoleFamily } from "./roles.js";

/**
 * Function and level: is this the kind of job the user does, at the level they do it?
 *
 * - `titleAlignment` compares the job title with what the user is looking for (lane titles) and what they have been
 *   doing (their latest role titles), through `roleFamilyOf`. The same title is 1, the same family and specialty about
 *   0.9, a neighbouring specialty 0.45 to 0.8, a neighbouring family 0.25 to 0.6, and a different family 0.1, however
 *   many skills overlap (a Salesforce "Solution Engineer" is not a marketing job, a graphic designer is not a product designer).
 * - `familyYears` counts years of experience in the job's function from role points: roles of the same family count in
 *   full, roles in a neighbouring family at half, other roles not at all. A former teacher with a frontend bootcamp has
 *   about zero years of software experience.
 * - `seniorityFit` compares the job's level (title, spec seniority, years asked) with the user's level in that function
 *   and penalises both directions, more when the job is above the user.
 */

export type MatchTarget = {
  /** Titles from the user's enabled lanes: what they are looking for. */
  laneTitles: string[];
  /** The user's latest role titles, most recent first (at most 2). */
  roleTitles: string[];
};

const ROLE_TITLE_WEIGHT = 0.95;
const DIFFERENT_FAMILY = 0.1;

/** "Senior Frontend Engineer at Acme" -> "Senior Frontend Engineer". */
const cleanRole = (title: string) => title.replace(/\s+(?:at|@)\s+.*$/i, "").replace(/\s*[|]\s*.*$/, "").trim();

/** Latest role titles first: current roles before ended ones, then by end and start date. */
export function recentRoleTitles(points: readonly Pick<EvidencePoint, "kind" | "title" | "startDate" | "endDate">[], now: Date, n = 2): string[] {
  const roles = points
    .filter((p) => p.kind === "role" && cleanRole(p.title))
    .map((p) => ({ p, iv: pointInterval(p, now) }))
    .sort((a, b) => (b.iv?.[1] ?? -Infinity) - (a.iv?.[1] ?? -Infinity) || (b.iv?.[0] ?? -Infinity) - (a.iv?.[0] ?? -Infinity));
  const out: string[] = [];
  for (const { p } of roles) {
    const t = cleanRole(p.title);
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

export function matchTargetOf(profile: { lanes: ReadonlyArray<{ titles: readonly string[] }>; points: readonly EvidencePoint[] }, now: Date): MatchTarget {
  const laneTitles: string[] = [];
  for (const l of profile.lanes) for (const t of l.titles) if (!laneTitles.some((x) => x.toLowerCase() === t.toLowerCase())) laneTitles.push(t);
  return { laneTitles, roleTitles: recentRoleTitles(profile.points, now) };
}

// ---- family relations ---------------------------------------------------------------------------------------------------

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Software subfamilies next to each other; anything else in software is 0.55. */
const SOFTWARE_PAIRS: Record<string, number> = {
  [pairKey("full_stack", "frontend")]: 0.8, [pairKey("full_stack", "backend")]: 0.8, [pairKey("backend", "infrastructure")]: 0.7,
  [pairKey("backend", "data_ml")]: 0.6, [pairKey("frontend", "mobile")]: 0.6, [pairKey("infrastructure", "security")]: 0.6,
  [pairKey("full_stack", "mobile")]: 0.6,
};
/** A general title ("Software Engineer") against a specialised one. */
const SOFTWARE_GENERAL: Record<string, number> = { frontend: 0.85, backend: 0.85, full_stack: 0.85, mobile: 0.7, infrastructure: 0.7, data_ml: 0.7, security: 0.65, quality: 0.5, enterprise: 0.45, general: 0.9 };

const DESIGN_PAIRS: Record<string, number> = {
  [pairKey("ux", "visual")]: 0.45, [pairKey("visual", "graphic")]: 0.75, [pairKey("ux", "graphic")]: 0.2, [pairKey("ux", "instructional")]: 0.15,
  [pairKey("visual", "instructional")]: 0.2, [pairKey("graphic", "instructional")]: 0.2,
};
const DATA_PAIRS: Record<string, number> = { [pairKey("science", "analyst")]: 0.55 };
/** Healthcare specialties are different licensed jobs; nursing and care support sit next to each other. */
const HEALTH_PAIRS: Record<string, number> = { [pairKey("nursing", "care_support")]: 0.5, [pairKey("therapy", "behavioral")]: 0.4 };

/** Families next to each other (symmetric). Keys may name a software subfamily as `software_engineering:<sub>`. */
const FAMILY_PAIRS: Record<string, number> = {
  [pairKey("data_analysis:science", "software_engineering:data_ml")]: 0.65,
  [pairKey("data_analysis:general", "software_engineering:data_ml")]: 0.5,
  [pairKey("data_analysis:analyst", "software_engineering:data_ml")]: 0.35,
  [pairKey("data_analysis", "software_engineering")]: 0.25,
  [pairKey("design", "software_engineering:frontend")]: 0.3,
  [pairKey("product", "design")]: 0.25,
  [pairKey("product", "operations")]: 0.3,
  [pairKey("product", "data_analysis")]: 0.25,
  [pairKey("product", "marketing")]: 0.2,
  [pairKey("sales", "customer_success")]: 0.45,
  [pairKey("sales", "marketing")]: 0.3,
  [pairKey("customer_success", "software_engineering")]: 0.25,
  [pairKey("customer_success", "operations")]: 0.3,
  [pairKey("finance", "data_analysis")]: 0.4,
  [pairKey("finance", "operations")]: 0.25,
  [pairKey("operations", "people")]: 0.25,
  [pairKey("education", "people")]: 0.3,
  [pairKey("education", "design:instructional")]: 0.5,
};

/**
 * How close two classified titles are as kinds of work, 0 to 1. Null when either family is unknown, or both are "other"
 * (a known job outside the families, such as civil and mechanical engineering): the caller then compares title words.
 */
export function familyRelation(a: RoleClass, b: RoleClass): number | null {
  if (a.family === "unknown" || b.family === "unknown") return null;
  if (a.family === "other" && b.family === "other") return null;
  if (a.family === b.family) {
    if (a.family === "software_engineering") {
      const x = a.subfamily ?? "general", y = b.subfamily ?? "general";
      if (x === y) return 0.9;
      if (x === "general" || y === "general") return SOFTWARE_GENERAL[x === "general" ? y : x] ?? 0.7;
      if (x === "enterprise" || y === "enterprise") return 0.35;
      if (x === "quality" || y === "quality") return 0.4;
      return SOFTWARE_PAIRS[pairKey(x, y)] ?? 0.55;
    }
    const x = a.specialty ?? "general", y = b.specialty ?? "general";
    if (x === y) return 0.9;
    if (x === "general" || y === "general") return 0.8;
    if (a.family === "healthcare") return HEALTH_PAIRS[pairKey(x, y)] ?? 0.3;
    const table = a.family === "design" ? DESIGN_PAIRS : DATA_PAIRS;
    return table[pairKey(x, y)] ?? 0.5;
  }
  const keysOf = (c: RoleClass) => {
    const sub = c.family === "software_engineering" ? c.subfamily : c.specialty;
    return sub ? [`${c.family}:${sub}`, c.family] : [c.family];
  };
  let best: number | null = null;
  for (const ka of keysOf(a)) for (const kb of keysOf(b)) {
    const v = FAMILY_PAIRS[pairKey(ka, kb)];
    if (v != null && (best == null || v > best)) best = v;
  }
  return best ?? DIFFERENT_FAMILY;
}

const sharedWords = (a: string, b: string) => {
  const wb = new Set(significantTitleWords(b));
  return significantTitleWords(a).filter((w) => wb.has(w)).length;
};

/**
 * One wanted title against the job title, 0 to 1. `specialties` are the software subfamilies the user's other titles name
 * (frontend, backend...): a generic wanted title ("Senior Software Engineer") then stands for those, so a frontend
 * engineer's "Software Engineer" lane does not make a backend job a perfect match.
 */
export function titlePairScore(wanted: string, jobTitle: string, specialties: ReadonlySet<string> = new Set()): number {
  const w = roleFamilyOf(wanted);
  const j = roleFamilyOf(jobTitle);
  const rel = familyRelation(w, j);
  const sameWords = titleMatches(wanted, jobTitle);
  if (rel != null) {
    const generic = w.family === "software_engineering" && (w.subfamily ?? "general") === "general";
    const specific = j.family === "software_engineering" && j.subfamily != null && j.subfamily !== "general";
    if (generic && specific && specialties.size > 0 && !specialties.has(j.subfamily!)) {
      let best = 0;
      for (const s of specialties) best = Math.max(best, familyRelation({ ...w, subfamily: s as RoleClass["subfamily"] }, j) ?? 0);
      return best;
    }
    // The words match and the families agree: the job is what was asked for. Words alone do not override families
    // ("Product Manager" is in "Product Marketing Manager", which is marketing).
    if (sameWords && w.family === j.family) return 1;
    return rel;
  }
  // A family is unknown: no different-family penalty. Title words decide, from 0.5 (none shared) to 1 (the lane title fits).
  if (sameWords) return 1;
  const words = significantTitleWords(wanted);
  const share = words.length > 0 ? sharedWords(wanted, jobTitle) / words.length : 0;
  return 0.5 + 0.4 * share;
}

/** Best agreement of the job title with the user's lane titles (weight 1) and latest role titles (weight 0.95); null without a target. */
export function titleAlignment(jobTitle: string, target: MatchTarget | null | undefined): number | null {
  if (!target || (target.laneTitles.length === 0 && target.roleTitles.length === 0)) return null;
  const specialties = new Set<string>();
  for (const t of [...target.laneTitles, ...target.roleTitles]) {
    const c = roleFamilyOf(t);
    if (c.family === "software_engineering" && c.subfamily && c.subfamily !== "general") specialties.add(c.subfamily);
  }
  let best = 0;
  for (const t of target.laneTitles) best = Math.max(best, titlePairScore(t, jobTitle, specialties));
  for (const t of target.roleTitles) best = Math.max(best, ROLE_TITLE_WEIGHT * titlePairScore(t, jobTitle, specialties));
  return Math.round(best * 1000) / 1000;
}

// ---- years in the function ----------------------------------------------------------------------------------------------

type RolePoint = Pick<EvidencePoint, "kind" | "title" | "startDate" | "endDate"> & { skills?: readonly string[] };

/** Weight of a role's years for a job: same family 1; the data and ML cluster, or a close family (0.6+), 0.9; a neighbour (0.4+) 0.5. */
function yearsWeight(c: RoleClass, job: RoleClass, roleTitle: string, jobTitle: string): number {
  const rel = familyRelation(c, job);
  if (rel == null) return sharedWords(roleTitle, jobTitle) > 0 ? 1 : 0;
  if (c.family === job.family) return 1;
  const dataCluster = (x: RoleClass) => x.family === "data_analysis" || (x.family === "software_engineering" && x.subfamily === "data_ml");
  if (dataCluster(c) && dataCluster(job)) return 0.9;
  if (rel >= 0.6) return 0.9;
  if (rel >= 0.4) return 0.5;
  return 0;
}

/** Families where projects show real, if partial, experience (a bootcamp capstone, a thesis project). */
const PROJECT_FAMILIES = new Set<RoleFamily>(["software_engineering", "data_analysis", "design"]);
/** Early career: under this many relevant years, projects count. */
const EARLY_CAREER_YEARS = 2;
const PROJECT_WEIGHT = 0.5;
const PROJECT_MAX_YEARS = 1;

/**
 * Years of experience in the job's function, from role points: roles of the same family in full; the data and ML cluster
 * (data scientist, ML engineer, data analyst, research scientist) and other close families at 0.9; neighbouring families
 * at 0.5; anything else not at all. A role whose title cannot be classified counts when it shares a title word with the
 * job. Internships and co-ops are roles and count for their length. Early in a career (under 2 relevant years), projects
 * with skills count at half their length, at most one year, for software, data and design jobs.
 * Null when the user has no dated roles or projects, or the job's own family is unknown and nothing shares a word with it
 * (the caller then uses total experience).
 */
export function familyYears(points: readonly RolePoint[], jobTitle: string, now: Date): number | null {
  const dated = points.map((p) => ({ p, iv: pointInterval(p, now) })).filter((r): r is { p: RolePoint; iv: [number, number] } => r.iv !== null);
  const roles = dated.filter((r) => r.p.kind === "role");
  const projects = dated.filter((r) => r.p.kind === "project" && (r.p.skills?.length ?? 1) > 0);
  if (roles.length === 0 && projects.length === 0) return null;
  const job = roleFamilyOf(jobTitle);
  const tiers: Record<string, Array<[number, number]>> = { "1": [], "0.9": [], "0.5": [] };
  for (const { p, iv } of roles) {
    const title = cleanRole(p.title);
    const w = yearsWeight(roleFamilyOf(title), job, title, jobTitle);
    if (w > 0) tiers[String(w)]!.push(iv);
  }
  if ((job.family === "unknown" || job.family === "other") && tiers["1"]!.length === 0 && tiers["0.9"]!.length === 0) return null;
  const u1 = unionYears(tiers["1"]!);
  const u09 = unionYears([...tiers["1"]!, ...tiers["0.9"]!]);
  const uAll = unionYears([...tiers["1"]!, ...tiers["0.9"]!, ...tiers["0.5"]!]);
  let years = u1 + 0.9 * (u09 - u1) + 0.5 * (uAll - u09);
  if (years < EARLY_CAREER_YEARS && PROJECT_FAMILIES.has(job.family) && projects.length > 0) {
    years += Math.min(PROJECT_MAX_YEARS, PROJECT_WEIGHT * unionYears(projects.map((r) => r.iv)));
  }
  return Math.round(years * 10) / 10;
}

const YEARS_TEXT = /\b\d{1,2}\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)\b/i;
const PREFERRED_TEXT = /\b(?:preferred|preferably|ideally|nice to have|a plus|bonus|desired|desirable)\b/i;

/**
 * The posting's minimum years when it is a requirement. Null when the posting gives none, or when its requirement texts
 * name years only as preferred ("5+ years preferred", or years only among the nice-to-haves).
 */
export function statedYearsMin(spec: Pick<JobSpec, "yearsMin" | "mustHaves" | "niceToHaves">): number | null {
  if (spec.yearsMin == null) return null;
  const requiredYearsText = spec.mustHaves.some((t) => YEARS_TEXT.test(t) && !PREFERRED_TEXT.test(t));
  const preferredYearsText = spec.niceToHaves.some((t) => YEARS_TEXT.test(t)) || spec.mustHaves.some((t) => YEARS_TEXT.test(t) && PREFERRED_TEXT.test(t));
  return !requiredYearsText && preferredYearsText ? null : spec.yearsMin;
}

// ---- seniority ----------------------------------------------------------------------------------------------------------

/** Levels on one scale: 0 intern, 1 entry, 2 mid, 3 senior, 4 staff, 5 principal. */
const TITLE_BAND: Record<string, [number, number]> = {
  intern: [0, 0.5], entry: [1, 1.5], mid: [2, 2.5], senior: [3, 3.5], staff: [4, 4.5], principal: [5, 6],
  manager: [3, 4], director: [4.5, 5.5], executive: [5.5, 6],
};
/** What a spec seniority means when the title says nothing: wider, a "Software Engineer" spans mid to senior. */
const SPEC_BAND: Record<string, [number, number]> = {
  // A title that states no level is open upward: a staff "Registered Nurse" posting the model calls "entry" (new graduates
  // welcome) is also the job an experienced nurse applies for. A stated level in the title ("Junior", "Intern") is not.
  intern: [0, 0.5], entry: [1, 3.5], mid: [1.75, 3.5], senior: [2.75, 4], staff: [3.75, 4.75], principal: [4.75, 6],
  manager: [3, 4.25], director: [4.5, 5.5], executive: [5.5, 6], unknown: [1, 4],
};

/** Years of experience to a level: 0 -> 1 (entry), 2 -> 2, 6 -> 3, 9 -> 4, 13 and more -> 5. */
export function levelFromYears(years: number): number {
  const knots: Array<[number, number]> = [[0, 1], [2, 2], [6, 3], [9, 4], [13, 5]];
  if (years <= 0) return 1;
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!;
    const [x0, y0] = knots[i - 1]!;
    if (years <= x1) return y0 + ((years - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 5;
}

/** The job's level band from its title, else its spec seniority, raised to what its minimum years imply. */
type LevelSpec = Pick<JobSpec, "seniority" | "yearsMin"> & Partial<Pick<JobSpec, "mustHaves" | "niceToHaves">>;

/** The job's level band from its title, else its spec seniority, raised to what its minimum years imply (half a level less when the years are only preferred). */
export function jobLevelBand(jobTitle: string | null | undefined, spec: LevelSpec): [number, number] {
  const fromTitle = jobTitle ? seniorityFromTitle(jobTitle) : null;
  let [lo, hi] = fromTitle ? TITLE_BAND[fromTitle]! : (SPEC_BAND[spec.seniority] ?? SPEC_BAND.unknown!);
  if (spec.yearsMin != null && spec.yearsMin > 0) {
    const stated = statedYearsMin({ yearsMin: spec.yearsMin, mustHaves: spec.mustHaves ?? [], niceToHaves: spec.niceToHaves ?? [] });
    lo = Math.max(lo, levelFromYears(spec.yearsMin) - (stated == null ? 0.5 : 0));
    hi = Math.max(hi, lo);
  }
  return [lo, hi];
}

export type SeniorityFit = {
  /** 0 to 1, 1 when the user's level is inside the job's band. */
  score: number;
  /** "above" when the job is more senior than the user, "below" when the user is overqualified. */
  direction: "above" | "below" | null;
  userLevel: number | null;
  band: [number, number];
};

/**
 * 1 inside the band (with a quarter level of slack above and half a level below), then down by 0.35 per level the job is
 * above the user and by 0.3 per level the user is above the job. Unknown user experience scores 1.
 */
export function seniorityFit(jobTitle: string | null | undefined, spec: LevelSpec, userYears: number | null | undefined): SeniorityFit {
  const band = jobLevelBand(jobTitle, spec);
  if (userYears == null) return { score: 1, direction: null, userLevel: null, band };
  const u = levelFromYears(userYears);
  const above = Math.max(0, band[0] - u - 0.25);
  const below = Math.max(0, u - band[1] - 0.5);
  const score = Math.min(1, Math.max(0.05, 1 - 0.35 * above - 0.3 * below));
  return { score: Math.round(score * 1000) / 1000, direction: above > 0 ? "above" : below > 0 ? "below" : null, userLevel: Math.round(u * 100) / 100, band };
}

export type { RoleFamily };

// ---- widening limits ----------------------------------------------------------------------------------------------------

/** "designer" and "design", "marketing" and "marketer" share a stem. */
const coreStem = (w: string) => w.replace(/(?:ers|er|ing|s)$/, "") || w;

/** Title words that name a kind of position rather than a function: sharing one does not make two roles the same work. */
const GENERIC_ROLE_WORDS = new Set([
  "engineer", "engineering", "manager", "management", "specialist", "lead", "representative", "associate", "coordinator", "director",
  "head", "analyst", "consultant", "officer", "partner", "assistant", "administrator", "executive", "team", "member", "intern",
  "internship", "remote", "hybrid", "contract", "contractor", "part", "time", "full", "job", "role", "us", "usa", "global",
]);

/**
 * Why a widened candidate is too far from the user to show, or null. Widened rows are stricter than lane rows: a job whose
 * stated or title level is more than one step above the user's level in that function is skipped, and so is a job of a
 * different family unless its title shares a core role word (not "engineer" or "manager") with the user's titles.
 */
export function widenedTooFar(jobTitle: string, spec: LevelSpec, target: MatchTarget, userYears: number | null): string | null {
  if (userYears != null) {
    const [lo] = jobLevelBand(jobTitle, spec);
    if (lo - levelFromYears(userYears) > 1) return "too_senior";
  }
  const job = roleFamilyOf(jobTitle);
  const titles = [...target.laneTitles, ...target.roleTitles];
  if (titles.length === 0 || job.family === "unknown") return null;
  const families = titles.map((t) => roleFamilyOf(t).family);
  if (families.includes(job.family) || families.includes("unknown")) return null;
  const core = (t: string) => significantTitleWords(t).filter((w) => !GENERIC_ROLE_WORDS.has(w)).map(coreStem);
  const mine = new Set(titles.flatMap(core));
  return core(jobTitle).some((w) => mine.has(w)) ? null : "other_function";
}
