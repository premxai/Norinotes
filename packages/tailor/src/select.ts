import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";
import { mentionsSkill, norm, sameSkill, uniq, wordCount } from "./text.js";
import type { ResumeBullet, ResumeContact, ResumeContent } from "./types.js";

/** Weight of one requirement: must-haves count double, scaled by how well the user covers it. */
export const entryWeight = (e: FitMapEntry): number => (e.mustHave ? 2 : 1) * e.score;

/** Most bullets a role may start with, by position (most recent first). The one-page fitter trims from there. */
export const ROLE_BULLET_CAPS = [5, 4, 3, 3] as const;
export const MAX_ROLES = ROLE_BULLET_CAPS.length;
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
const recency = (a: CareerPoint, b: CareerPoint) => endKey(b).localeCompare(endKey(a)) || startKey(b).localeCompare(startKey(a));

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

type Candidate = { bullet: ResumeBullet; covers: string[]; direct: number };

export type RankedRequirement = { requirement: string; mustHave: boolean; weight: number; careerPointIds: string[] };

export type Selection = {
  content: ResumeContent;
  /** Requirement texts each bullet supports, by bullet id. */
  covers: Map<string, string[]>;
  /** Requirements the user covers, heaviest first. */
  topRequirements: RankedRequirement[];
  years: number | null;
};

export type SelectInput = {
  points: CareerPoint[];
  fitMap: FitMapEntry[];
  spec: JobSpec | null;
  contact: ResumeContact & { name: string };
  now?: Date;
};

/**
 * Build the resume from the career points, the way a recruiter would want it for this job: roles by how much of the
 * posting they cover (shown most recent first, as parsers expect), bullets within a role heaviest first, projects only
 * when they cover something, and skills in the order the posting lists them. No text is written here; every bullet is
 * a line of the user's own career points.
 */
export function selectContent(input: SelectInput): Selection {
  const { points, spec } = input;
  const now = input.now ?? new Date();
  const fit = input.fitMap.filter((e) => e.score > 0);
  const byPoint = new Map<string, FitMapEntry[]>();
  for (const e of fit) for (const id of e.careerPointIds) byPoint.set(id, [...(byPoint.get(id) ?? []), e]);
  const sumW = (es: FitMapEntry[]) => es.reduce((n, e) => n + entryWeight(e), 0);

  const specSkills = spec?.skills ?? [];
  const bonus = (text: string): number => specSkills.reduce((n, s) => n + (mentionsSkill(text, s.name) ? (s.required ? 0.3 : 0.15) : 0), 0);

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

  // Every bullet a container could show, with its weight.
  const candidatesOf = (c: CareerPoint): Candidate[] => {
    const own = byPoint.get(c.id) ?? [];
    const out: Candidate[] = splitBullets(c.text).map((text, i) => {
      const direct = 0.6 * sumW(own);
      return { bullet: { id: `${c.id}#${i}`, text, careerPointIds: [c.id], weight: round3(direct + bonus(text)) }, covers: own.map((e) => e.requirement), direct };
    });
    for (const a of achievementsOf.get(c.id) ?? []) {
      const text = a.text.trim() || a.title.trim();
      if (!text) continue;
      const aEntries = byPoint.get(a.id) ?? [];
      const direct = sumW(aEntries) + 0.5 * sumW(own.filter((e) => !e.careerPointIds.includes(a.id)));
      out.push({ bullet: { id: a.id, text, careerPointIds: [a.id, c.id], weight: round3(direct + bonus(text)) }, covers: aEntries.map((e) => e.requirement), direct });
    }
    // Heaviest first; equal weights keep the order they were written in.
    return out.map((cand, i) => ({ cand, i })).sort((x, y) => y.cand.bullet.weight - x.cand.bullet.weight || x.i - y.i).map((x) => x.cand);
  };

  // The posting coverage of a container: each requirement counted once, however many of its bullets support it.
  const coverage = (c: CareerPoint, cands: Candidate[]): number => {
    const ids = new Set([c.id, ...cands.flatMap((x) => x.bullet.careerPointIds)]);
    return sumW(fit.filter((e) => e.careerPointIds.some((id) => ids.has(id))));
  };

  const covers = new Map<string, string[]>();
  const take = (cands: Candidate[], n: number): ResumeBullet[] => {
    const chosen = cands.slice(0, n);
    for (const c of chosen) covers.set(c.bullet.id, c.covers);
    return chosen.map((c) => c.bullet);
  };

  // Roles: the most recent always; the rest by coverage. Shown most recent first.
  const scoredRoles = roles.map((r) => { const cands = candidatesOf(r); return { r, cands, cov: coverage(r, cands) }; });
  const latest = scoredRoles[0];
  const rest = scoredRoles.slice(1).sort((a, b) => b.cov - a.cov || recency(a.r, b.r));
  const pickedRoles = [...(latest ? [latest] : []), ...rest.slice(0, MAX_ROLES - 1)].sort((a, b) => recency(a.r, b.r));
  const experience = pickedRoles.map(({ r, cands }, i) => ({
    careerPointId: r.id, title: r.title, company: r.org ?? r.title,
    ...(r.startDate ? { start: r.startDate } : {}), ...(r.endDate ? { end: r.endDate } : {}),
    bullets: take(cands, ROLE_BULLET_CAPS[i] ?? 3),
  }));

  // Projects: only those that cover something (all of the best three when the resume has no work history yet).
  const scoredProjects = projects.map((p) => { const cands = candidatesOf(p); return { p, cands, cov: coverage(p, cands) }; })
    .sort((a, b) => b.cov - a.cov || recency(a.p, b.p));
  const chosenProjects = (experience.length === 0 ? scoredProjects.slice(0, 3) : scoredProjects.filter((x) => x.cov > 0).slice(0, MAX_PROJECTS));
  const projectSection = chosenProjects.map(({ p, cands }) => ({ careerPointId: p.id, name: p.title, bullets: take(cands, MAX_PROJECT_BULLETS) })).filter((p) => p.bullets.length > 0);

  const education = points.filter((p) => p.kind === "education").sort(recency).slice(0, 2).map((p) => ({
    careerPointId: p.id, school: p.org ?? p.title, ...(p.org ? { degree: p.title } : {}),
    ...(p.startDate ? { start: p.startDate } : {}), ...(p.endDate ? { end: p.endDate } : {}),
  }));

  const { name, ...contact } = input.contact;
  const content: ResumeContent = {
    name, contact, experience, education, projects: projectSection,
    skills: orderSkills(points, specSkills.map((s) => s.name)),
  };

  const ranked: RankedRequirement[] = fit.map((e) => ({ requirement: e.requirement, mustHave: e.mustHave, weight: round3(entryWeight(e)), careerPointIds: e.careerPointIds }))
    .sort((a, b) => b.weight - a.weight);
  // Years count only work that covers something the posting asks for (all work when nothing does), so a summary never
  // stretches a career-changer's barista years into "10 years of engineering".
  const relevant = scoredRoles.filter((x) => x.cov > 0).map((x) => x.r);
  const years = yearsOfExperience(relevant.length ? relevant : roles, now);
  return { content, covers, topRequirements: ranked, years };
}

/** The user's skills, those the posting lists first and in its order, then the rest by how many career points use them. */
export function orderSkills(points: CareerPoint[], specOrder: string[]): ResumeContent["skills"] {
  const count = new Map<string, { name: string; n: number }>();
  const add = (name: string) => {
    const k = norm(name);
    if (!k) return;
    const cur = count.get(k);
    if (cur) cur.n++; else count.set(k, { name: name.trim(), n: 1 });
  };
  for (const p of points) {
    if (p.kind === "skill") add(p.title);
    for (const s of p.skills) add(s);
  }
  const all = [...count.values()];
  const matched: string[] = [];
  for (const want of specOrder) {
    const hit = all.find((s) => sameSkill(s.name, want));
    if (hit && !matched.some((m) => sameSkill(m, hit.name))) matched.push(hit.name);
  }
  const others = all.filter((s) => !matched.some((m) => sameSkill(m, s.name))).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((s) => s.name);
  const room = Math.max(0, MAX_SKILLS - matched.length);
  const groups: ResumeContent["skills"] = [];
  if (matched.length) groups.push({ group: "Core", items: uniq(matched).slice(0, MAX_SKILLS) });
  if (others.length && room > 0) groups.push({ group: matched.length ? "Additional" : "Skills", items: others.slice(0, room) });
  return groups;
}
