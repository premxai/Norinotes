import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";
import { acronymPair, aliasGroupOf } from "./aliases.js";
import { buildEvidence, bulletSupports, pointCorpus, type EvidenceEntry, type EvidenceIndex, type RequirementTerm } from "./evidence.js";
import { mentionsSkill, norm, numbersIn, sameSkill, uniq, wordCount } from "./text.js";
import { displaySkill, isCategoryLabel, isDegree, isFillerLine, sharesFact } from "./facts.js";
import type { ResumeBullet, ResumeContact, ResumeContent } from "./types.js";

/** Weight of one fit-map requirement: must-haves count double, scaled by how well the user covers it. */
export const entryWeight = (e: FitMapEntry): number => (e.mustHave ? 2 : 1) * e.score;

/** Bullets for the latest role and for recent or relevant ones; older roles get fewer. The one-page fitter trims from there. */
export const RECENT_BULLETS = { min: 3, max: 5 } as const;
export const OLDER_BULLETS = { min: 1, max: 2 } as const;
/** A role that ended within this many years counts as recent. */
export const RECENT_YEARS = 3;
/** A role covering at least this share of the best role's coverage counts as relevant. */
export const RELEVANT_SHARE = 0.75;
/** Kept for callers that read it: the most bullets a role may start with, by position. */
export const ROLE_BULLET_CAPS = [5, 5, 5, 5] as const;
export const MAX_ROLES = 4;
export const MAX_PROJECTS = 2;
export const MAX_PROJECT_BULLETS = 2;
export const MAX_SKILLS = 20;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Lines of a career point's text as bullets: one per line, or per sentence when the text is one long paragraph. */
export function splitBullets(text: string): string[] {
  const lines = text.split(/\r?\n+/).map((l) => l.replace(/^[\s•*\-–—▪◦·]+/, "").trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const one = lines[0] ?? "";
  if (one.length <= 240) return one ? [one] : [];
  const sentences = one.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length && wordCount(s) < 6) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

/** Sortable "YYYY-MM" from "YYYY" or "YYYY-MM"; a missing end date means current. */
function monthKey(d: string | null | undefined, fallback: string): string {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec((d ?? "").trim());
  if (!m) return fallback;
  return `${m[1]}-${(m[2] ?? (fallback.endsWith("99") ? "12" : "01")).padStart(2, "0")}`;
}
const endKey = (p: CareerPoint) => monthKey(p.endDate, "9999-99");
const startKey = (p: CareerPoint) => monthKey(p.startDate, "0000-00");
export const recency = (a: CareerPoint, b: CareerPoint) => endKey(b).localeCompare(endKey(a)) || startKey(b).localeCompare(startKey(a));

const monthIndex = (key: string, now: Date): number => {
  if (key.startsWith("9999")) return now.getFullYear() * 12 + now.getMonth();
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
};

/** Whole years of work covered by the dated roles, overlaps counted once. Null when no role carries a date. */
export function yearsOfExperience(points: CareerPoint[], now = new Date()): number | null {
  const spans = points.filter((p) => p.kind === "role" && p.startDate).map((p) => [monthIndex(startKey(p), now), monthIndex(endKey(p), now)] as const)
    .filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return null;
  let total = 0;
  let [curS, curE] = spans[0]!;
  for (const [s, e] of spans.slice(1)) {
    if (s <= curE) curE = Math.max(curE, e);
    else { total += curE - curS; curS = s; curE = e; }
  }
  total += curE - curS;
  return Math.floor(total / 12);
}

/** True when the role has no end date (or ends this month or later). */
export function isCurrent(p: Pick<CareerPoint, "endDate">, now = new Date()): boolean {
  if (!p.endDate || /present|current/i.test(p.endDate)) return true;
  const k = monthKey(p.endDate, "9999-99");
  return monthIndex(k, now) >= now.getFullYear() * 12 + now.getMonth();
}

/** The year a role starts and ends (null end: current). */
export function roleYears(p: Pick<CareerPoint, "startDate" | "endDate">): { start: number | null; end: number | null } {
  const y = (d: string | null | undefined) => { const m = /^(\d{4})/.exec((d ?? "").trim()); return m ? Number(m[1]) : null; };
  return { start: y(p.startDate), end: p.endDate && !/present|current/i.test(p.endDate) ? y(p.endDate) : null };
}

type Candidate = { bullet: ResumeBullet; covers: string[]; order: number };

export type RankedRequirement = { requirement: string; mustHave: boolean; weight: number; careerPointIds: string[] };

export type Selection = {
  content: ResumeContent;
  /** Requirement texts each bullet supports, by bullet id. */
  covers: Map<string, string[]>;
  /** Requirements the user covers, heaviest first. */
  topRequirements: RankedRequirement[];
  /**
   * Whole years in the target function, from the person's own role dates (roles sharing a title word with the job title,
   * or with the latest role when there is no job title), rounded down. Null when below 2: the summary then gives no years.
   */
  years: number | null;
  evidence: EvidenceIndex;
  /** The supported must-have each of the latest role's first bullets leads with (each a different one), by bullet id. */
  focus: Map<string, string>;
  /** Source text each bullet may draw from (its own line plus its point's title, org and dates), by bullet id. */
  sources: Map<string, string>;
  /** Container point (role or project) of each bullet, by bullet id. */
  containers: Map<string, CareerPoint>;
};

export type SelectInput = {
  points: CareerPoint[];
  fitMap: FitMapEntry[];
  spec: JobSpec | null;
  contact: ResumeContact & { name: string };
  now?: Date;
  /** Built from spec, fit map and points when not given. */
  evidence?: EvidenceIndex;
  /** The job's title: years for the summary count roles in its function. */
  jobTitle?: string;
};

/** The most recent roles that show all their bullets (up to 5) when the page has room. */
export const FULL_ROLES = 2;

/** The minimum years a summary may state; fewer are left out. */
export const MIN_SUMMARY_YEARS = 2;
/** The latest role's first bullets that each address a different supported must-have. */
export const DISTINCT_TOP_BULLETS = 3;

/** Weight of one requirement for ordering: must-haves double. */
const reqWeight = (e: EvidenceEntry) => (e.mustHave ? 2 : 1) * e.weight;

/**
 * Build the resume from the career points, the way a recruiter would want it for this job. Deterministic, no text is
 * written here: every bullet is a line of the user's own career points.
 * - Bullets are weighted by the requirements their own text supports (must-haves double), so the best-supported
 *   must-haves come first within each role; a bullet with a number gets a small bonus.
 * - Roles: the latest always, the rest by how much of the posting they cover; shown most recent first. The latest role
 *   and recent or relevant ones get 3 to 5 bullets, older ones 1 to 2.
 * - Skills: every skill the job names that the user really has first, in the job's spelling, then the rest.
 */
export function selectContent(input: SelectInput): Selection {
  const { points, spec } = input;
  const now = input.now ?? new Date();
  const evidence = input.evidence ?? buildEvidence({ spec, fitMap: input.fitMap, points });
  const containersMap = new Map<string, CareerPoint>();
  const sources = new Map<string, string>();

  const roles = points.filter((p) => p.kind === "role").sort(recency);
  const projects = points.filter((p) => p.kind === "project");
  const containers = [...roles, ...projects];

  // An achievement belongs to the role (or project) at the same organisation; with several, the one whose dates contain it.
  const parentOf = (a: CareerPoint): CareerPoint | null => {
    if (!a.org) return null;
    const org = norm(a.org);
    const same = containers.filter((c) => (c.org && norm(c.org) === org) || norm(c.title) === org);
    if (same.length <= 1) return same[0] ?? null;
    const at = startKey(a) !== "0000-00" ? startKey(a) : endKey(a);
    return same.find((c) => startKey(c) <= at && at <= endKey(c)) ?? [...same].sort(recency)[0] ?? null;
  };
  const achievementsOf = new Map<string, CareerPoint[]>();
  for (const a of points.filter((p) => p.kind === "achievement")) {
    const parent = parentOf(a);
    if (parent) achievementsOf.set(parent.id, [...(achievementsOf.get(parent.id) ?? []), a]);
  }

  const header = (p: CareerPoint) => [p.title, p.org ?? "", [p.startDate, p.endDate ?? (p.kind === "role" ? "present" : "")].filter(Boolean).join(" to ")].filter(Boolean).join("\n");
  const weigh = (text: string, ids: string[]) => {
    const sup = bulletSupports(evidence, text, ids);
    return { covers: sup.map((e) => e.text), weight: round3(sup.reduce((n, e) => n + reqWeight(e), 0) + (numbersIn(text).length ? 0.05 : 0)) };
  };

  // Every bullet a container could show, heaviest first; equal weights keep the written order.
  const candidatesOf = (c: CareerPoint): Candidate[] => {
    const lines = splitBullets(c.text);
    // A line that says nothing beyond the role's own title and organisation is parser filler, not the person's words.
    const kept = lines.map((text, i) => ({ text, i })).filter((x) => !(c.kind === "role" && isFillerLine(x.text, c.title, c.org)));
    const out: Candidate[] = kept.map(({ text, i }) => {
      const id = `${c.id}#${i}`;
      const { covers, weight } = weigh(text, [c.id]);
      // A one-line point owns its skills list too; a line of a longer point only owns its own words.
      sources.set(id, [text, header(c), lines.length === 1 && c.skills.length ? c.skills.join(", ") : ""].filter(Boolean).join("\n"));
      containersMap.set(id, c);
      return { bullet: { id, text, careerPointIds: [c.id], weight }, covers, order: i };
    });
    for (const a of achievementsOf.get(c.id) ?? []) {
      const text = a.text.trim() || a.title.trim();
      if (!text) continue;
      const { covers, weight } = weigh(text, [a.id, c.id]);
      sources.set(a.id, [pointCorpus(a), header(c)].join("\n"));
      containersMap.set(a.id, c);
      out.push({ bullet: { id: a.id, text, careerPointIds: [a.id, c.id], weight }, covers, order: out.length });
    }
    return out.sort((x, y) => y.bullet.weight - x.bullet.weight || x.order - y.order);
  };

  // The posting coverage of a container: each requirement counted once, by what its own text and bullets support.
  const coverage = (c: CareerPoint, cands: Candidate[]): number => {
    const reqs = new Set(cands.flatMap((x) => x.covers));
    return round3(evidence.entries.filter((e) => reqs.has(e.text)).reduce((n, e) => n + reqWeight(e), 0));
  };

  const covers = new Map<string, string[]>();
  // The same line can reach the resume twice (a role line and an achievement or project with the same words): show it once.
  // A fact (a number with the words around it) shown in one bullet is not shown again in another.
  const shown = new Set<string>();
  const shownTexts: string[] = [];
  const take = (cands: Candidate[], n: number): ResumeBullet[] => {
    const chosen: Candidate[] = [];
    for (const c of cands) {
      if (chosen.length >= n) break;
      const k = norm(c.bullet.text);
      if (shown.has(k) || shownTexts.some((t) => sharesFact(c.bullet.text, t))) continue;
      shown.add(k);
      shownTexts.push(c.bullet.text);
      chosen.push(c);
    }
    for (const c of chosen) covers.set(c.bullet.id, c.covers);
    return chosen.map((c) => c.bullet);
  };

  // Roles: the most recent always; the rest by coverage. Shown most recent first.
  const scoredRoles = roles.map((r) => { const cands = candidatesOf(r); return { r, cands, cov: coverage(r, cands) }; });
  const latest = scoredRoles[0];
  const rest = scoredRoles.slice(1).sort((a, b) => b.cov - a.cov || recency(a.r, b.r));
  const pickedRoles = [...(latest ? [latest] : []), ...rest.slice(0, MAX_ROLES - 1)].sort((a, b) => recency(a.r, b.r));
  const maxCov = Math.max(0, ...scoredRoles.map((x) => x.cov));
  const nowYear = now.getFullYear();
  const byText = new Map(evidence.entries.map((e) => [e.text, e]));
  let focus = new Map<string, string>();
  const experience = pickedRoles.map(({ r, cands, cov }, i) => {
    const ended = roleYears(r).end;
    const recent = i === 0 || isCurrent(r, now) || (ended !== null && nowYear - ended <= RECENT_YEARS);
    const relevant = cov > 0 && cov >= RELEVANT_SHARE * maxCov;
    // The two most recent roles show every bullet the person has (up to 5), most relevant first; the one-page fitter
    // trims only when the page is full. Older roles follow the relevance rule.
    const n = i < FULL_ROLES ? Math.min(RECENT_BULLETS.max, cands.length) : bulletCount(cands.map((c) => c.bullet.weight), recent || relevant);
    let ordered = cands;
    if (i === 0) ({ ordered, focus } = distinctFirst(cands, byText));
    return {
      careerPointId: r.id, title: r.title, company: r.org ?? r.title,
      ...(r.startDate ? { start: r.startDate } : {}), ...(r.endDate ? { end: r.endDate } : {}),
      bullets: take(ordered, n),
    };
  });

  // Projects: only those that cover something (the best three when the resume has no work history yet).
  const scoredProjects = projects.map((p) => { const cands = candidatesOf(p); return { p, cands, cov: coverage(p, cands) }; })
    .sort((a, b) => b.cov - a.cov || recency(a.p, b.p));
  const chosenProjects = (experience.length === 0 ? scoredProjects.slice(0, 3) : scoredProjects.filter((x) => x.cov > 0).slice(0, MAX_PROJECTS));
  const projectSection = chosenProjects.map(({ p, cands }) => ({ careerPointId: p.id, name: p.title, bullets: take(cands, MAX_PROJECT_BULLETS) })).filter((p) => p.bullets.length > 0);

  const education = points.filter((p) => p.kind === "education").sort(recency).slice(0, 2).map((p) => ({
    careerPointId: p.id, school: p.org ?? p.title, ...(p.org ? { degree: p.title } : {}),
    ...(p.startDate ? { start: p.startDate } : {}), ...(p.endDate ? { end: p.endDate } : {}),
  }));

  const { name, ...contact } = input.contact;
  const jobTerms = evidence.jobTerms.length ? evidence.jobTerms : (spec?.skills ?? []).map((s) => ({ key: norm(s.name), jobString: s.name }));
  const certifications = certificationLines(points);
  const content: ResumeContent = {
    name, contact, experience, education, projects: projectSection,
    skills: orderSkills(points, jobTerms.map((t) => t.jobString)),
    ...(certifications.length ? { certifications } : {}),
  };

  const ranked: RankedRequirement[] = evidence.entries.filter((e) => e.supported)
    .map((e) => ({ requirement: e.text, mustHave: e.mustHave, weight: round3(reqWeight(e) * (e.support[0]?.score ?? 1)), careerPointIds: e.support.map((s) => s.pointId) }))
    .sort((a, b) => b.weight - a.weight);
  const years = targetYears(roles, input.jobTitle ?? null, now);
  return { content, covers, topRequirements: ranked, years, evidence, sources, containers: containersMap, focus };
}

/**
 * Years for the summary: roles in the target function (sharing a title word with the job title, or with the latest role
 * when there is no job title), from their own dates, rounded down; null when that is under 2 or no role is in the
 * function. Earlier analyst, assistant or barista years never become "9 years in product".
 */
export function targetYears(roles: CareerPoint[], jobTitle: string | null, now = new Date()): number | null {
  const sorted = [...roles].filter((r) => r.kind === "role").sort(recency);
  const fn = functionWords(jobTitle ?? sorted[0]?.title ?? "");
  if (fn.size === 0) return null;
  const inFunction = sorted.filter((r) => [...functionWords(r.title)].some((w) => fn.has(w)));
  const years = yearsOfExperience(inFunction, now);
  return years !== null && years >= MIN_SUMMARY_YEARS ? years : null;
}

/**
 * Order a role's bullets so the first ones each address a different supported must-have, heaviest first; the rest
 * follow by weight. Returns the order and the must-have each leading bullet is about.
 */
export function distinctFirst<C extends { bullet: ResumeBullet; covers: string[] }>(cands: C[], byText: Map<string, EvidenceEntry>, k = DISTINCT_TOP_BULLETS): { ordered: C[]; focus: Map<string, string> } {
  const rest = [...cands];
  const out: C[] = [];
  const used = new Set<string>();
  const focus = new Map<string, string>();
  while (out.length < k && rest.length > 0) {
    let best = -1, bestW = 0, bestReq = "";
    rest.forEach((c, idx) => {
      for (const t of c.covers) {
        const e = byText.get(t);
        if (!e?.mustHave || used.has(t)) continue;
        const w = reqWeight(e);
        if (w > bestW + 1e-9) { bestW = w; best = idx; bestReq = t; }
      }
    });
    if (best < 0) break;
    const [c] = rest.splice(best, 1);
    out.push(c!);
    used.add(bestReq);
    focus.set(c!.bullet.id, bestReq);
  }
  return { ordered: [...out, ...rest], focus };
}

const FUNCTION_STOP = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "director", "manager", "head", "chief", "intern",
  "associate", "assistant", "the", "and", "for", "unit", "team", "full", "time", "part", "contract", "ii", "iii", "iv", "from", "with", "away",
  "into", "our", "new", "remote", "hybrid", "onsite"]);

/** Significant words of a job title ("Senior Product Manager" -> product; "Registered Nurse, Telemetry" -> registered, nurse, telemetry). */
export function functionWords(title: string): Set<string> {
  return new Set((title.toLowerCase().match(/[a-z][a-z+#.-]*/g) ?? []).map((w) => w.replace(/[.-]+$/, "")).filter((w) => w.length >= 3 && !FUNCTION_STOP.has(w)));
}

/**
 * How many bullets a role shows. Recent or relevant: every supporting bullet up to 5, at least 3 when it has them.
 * Older: 1, or 2 when the second also supports something.
 */
export function bulletCount(weights: readonly number[], recentOrRelevant: boolean): number {
  const supporting = weights.filter((w) => w > 0.05).length;
  if (recentOrRelevant) return Math.min(weights.length, Math.max(RECENT_BULLETS.min, Math.min(RECENT_BULLETS.max, supporting)));
  return Math.min(weights.length, supporting >= 2 ? OLDER_BULLETS.max : OLDER_BULLETS.min);
}

/** Alias groups that are job titles or too generic to list as a skill. */
const NOT_A_SKILL = new Set(["api", "cross-functional", "registered nurse", "licensed practical nurse", "certified nursing assistant", "nurse practitioner",
  "account executive", "sales development representative", "business development representative", "charge nurse", "patient care"]);

/** How a job's term is listed: the job's spelling, with the long form or acronym once when the user writes it the other way. */
function skillLabel(jobString: string, userName: string | null): string {
  if (!userName || norm(userName) === norm(jobString)) return jobString;
  const pair = acronymPair(jobString);
  if (!pair) return jobString;
  const isAcr = (s: string) => norm(s) === norm(pair.acronym);
  const isLong = (s: string) => norm(s) === norm(pair.long);
  if (isAcr(jobString) && isLong(userName)) return `${userName} (${jobString})`;
  if (isLong(jobString) && isAcr(userName)) return `${jobString} (${userName})`;
  return jobString;
}

/**
 * The user's skills: every skill the job names that the user's career points really show (skills lists or text), in the
 * job's order and spelling, then the rest of the user's skills by how many points use them.
 */
export function orderSkills(points: CareerPoint[], jobOrder: string[]): ResumeContent["skills"] {
  const count = new Map<string, { name: string; n: number }>();
  const add = (name: string) => {
    const k = norm(name);
    if (!k || k.length > 60) return;
    const cur = count.get(k);
    if (cur) cur.n++; else count.set(k, { name: name.trim(), n: 1 });
  };
  for (const p of points) {
    if (p.kind === "skill") add(p.title);
    for (const s of p.skills) add(s);
  }
  // Category headings parsed as skills ("Build and Test Tools") and degrees ("BSN") are not skills.
  for (const [k, v] of count) if (isCategoryLabel(v.name) || isDegree(v.name)) count.delete(k);
  const all = [...count.values()];
  const corpus = points.map((p) => [p.title, p.text, p.skills.join(", ")].join("\n")).join("\n");
  const matched: { label: string; covers: string[] }[] = [];
  const isMatched = (name: string) => matched.some((m) => m.covers.some((c) => sameSkill(c, name)));
  for (const want of jobOrder) {
    const g = aliasGroupOf(want);
    if (g && NOT_A_SKILL.has(g.key)) continue;
    if (isMatched(want)) continue;
    const own = all.find((s) => sameSkill(s.name, want));
    if (!own && !mentionsSkill(corpus, want)) continue;
    if (isCategoryLabel(want) || isDegree(want)) continue;
    matched.push({ label: displaySkill(skillLabel(want, own?.name ?? null)), covers: [want, ...(own ? [own.name] : [])] });
  }
  const others = all.filter((s) => !isMatched(s.name)).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((s) => displaySkill(s.name));
  const core = uniq(matched.map((m) => m.label)).slice(0, MAX_SKILLS);
  const room = Math.max(0, MAX_SKILLS - core.length);
  const groups: ResumeContent["skills"] = [];
  if (core.length) groups.push({ group: "Core", items: core });
  if (others.length && room > 0) groups.push({ group: core.length ? "Additional" : "Skills", items: uniq(others).slice(0, room) });
  return groups;
}

/**
 * The resume as the user wrote it, untailored: the latest roles in date order with their lines as written, and the user's
 * own skills list. The "before" side of the coverage report.
 */
export function baselineContent(points: CareerPoint[], contact: ResumeContact & { name: string }): ResumeContent {
  const roles = points.filter((p) => p.kind === "role").sort(recency).slice(0, MAX_ROLES);
  const { name, ...rest } = contact;
  const skills = uniq(points.flatMap((p) => (p.kind === "skill" ? [p.title, ...p.skills] : p.skills))).slice(0, MAX_SKILLS);
  return {
    name, contact: rest,
    experience: roles.map((r, i) => ({
      careerPointId: r.id, title: r.title, company: r.org ?? r.title,
      bullets: splitBullets(r.text).filter((l) => !isFillerLine(l, r.title, r.org)).slice(0, i === 0 ? RECENT_BULLETS.max : RECENT_BULLETS.min)
        .map((text, j) => ({ id: `${r.id}#${j}`, text, careerPointIds: [r.id], weight: 0 })),
    })),
    education: [], projects: [],
    skills: skills.length ? [{ group: "Skills", items: skills }] : [],
  };
}

export type { RequirementTerm };

/**
 * Licences and certifications (career points of kind "certification": title such as "Registered Nurse (RN), Minnesota",
 * org the issuer, dates) as lines for the Certifications section: "Title, Issuer, 2020 to 2027".
 */
export function certificationLines(points: readonly CareerPoint[]): string[] {
  const year = (d: string | null | undefined) => /^(\d{4})/.exec((d ?? "").trim())?.[1] ?? null;
  return points.filter((p) => (p.kind as string) === "certification").sort(recency).map((p) => {
    const from = year(p.startDate), to = year(p.endDate);
    const dates = from && to ? (from === to ? from : `${from} to ${to}`) : from ? `since ${from}` : to ? `valid through ${to}` : "";
    return [p.title.trim(), p.org?.trim() && !p.title.includes(p.org.trim()) ? p.org.trim() : "", dates].filter(Boolean).join(", ");
  }).filter(Boolean);
}
