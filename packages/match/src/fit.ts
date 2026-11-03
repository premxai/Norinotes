import type { FitMapEntry } from "@norinote/shared";
import type { StoredJobSpec } from "./understand.js";
import { familyYears, seniorityFit, titleAlignment, type MatchTarget, type SeniorityFit } from "./alignment.js";
import { pointInterval, unionYears, type EvidencePoint } from "./profile.js";
import {
  DEFAULT_SKILL_MAP, bestRelation, canonicalSkill, findSkillsInText, skillDisplayName, skillRelation, type SkillMap,
} from "./skills.js";

/**
 * Detailed fit: requirement by requirement against the user's career points.
 *
 * Evidence for a requirement, best first: the same canonical skill on a point (relevance 1), a related skill through the
 * skill groups (0.75 a specific kind of what is asked, 0.5 a sibling, 0.4 the broader field), then embedding similarity
 * between the requirement text and the point (at most 0.85). Strength = relevance x recency x scope, then depth: how many
 * years of relevant work there are against what the posting asks. Requirement scores become coverage and are averaged by
 * the spec's weights; must-haves the user clearly lacks cap the result (a missing must-have cannot be bought back by a long
 * list of nice-to-haves). The result is then scaled by function alignment, seniority in that function and place, and
 * capped by how well the job is described. The scale is documented next to `scoreFit` below.
 */

// How embedding cosine similarity turns into relevance. Below the floor it is noise, at the ceiling it is a clear match.
export const EMBED_FLOOR = 0.25;
export const EMBED_FULL = 0.55;
export const EMBED_CAP = 0.85;
const MAX_REQUIREMENTS = 20;
const DEFAULT_MUST_WEIGHT = 1;
const DEFAULT_NICE_WEIGHT = 0.4;
/** Years the posting implies for a skill level when it names no number. */
const LEVEL_YEARS: Record<string, number> = { basic: 0, working: 1, advanced: 3, expert: 5 };

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

export type Requirement = {
  text: string;
  mustHave: boolean;
  weight: number;
  /** Canonical skill keys the requirement is about; empty for a purely descriptive requirement. */
  skills: string[];
  years: number | null;
};

export type FitEvidence = "exact" | "related" | "semantic" | "words" | "none";

// ---- evidence from words ------------------------------------------------------------------------------------------------
//
// Licences, certifications, degrees and tools outside the skill table ("Current Minnesota RN license", "BLS and ACLS",
// "Graduate of an accredited nursing program") are found by their words: the requirement's significant words (stemmed;
// acronyms count double) against the words of a career point or of the resume itself. Relevance is 0.35 to 0.8: at least
// two words' weight and half the requirement; a matched certification acronym of three or more letters (BLS, ACLS, PMP)
// gives 0.7; a one-word requirement matched in full 0.6; a degree requirement met by an education point 0.75.

const WORD_STOP = new Set(("experience experiences years year ability able strong excellent good great solid deep knowledge skills skill working work " +
  "required require requirements requirement preferred plus must current currently valid minimum least proficiency proficient understanding " +
  "familiarity familiar including include related relevant field environment environments demonstrated proven track record using with within " +
  "across other such also well both high highly level levels based team teams similar role roles hands ideally equivalent combination " +
  "preferably bonus nice have that this from into their your will would should what about more than over under previous prior " +
  "graduate graduated accredited program programs degree degrees school college university diploma bachelor bachelors master masters " +
  "month months hire hired hiring higher obtain obtained able one two three four five six seven eight nine certification certifications " +
  "certified card cards").split(" "));

const EDUCATION_REQUIREMENT = /\b(?:graduate[ds]?|degree|diploma|bachelor'?s?|master'?s?|bsn|msn|bs|ba|ms|phd|accredited|program)\b/i;

/** "nursing" and "nurse" -> "nurs", "licensed" and "license" -> "licens". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) return w.slice(0, -1);
  return w;
}

/** Significant words of a requirement, stemmed and lower case; acronyms (RN, BLS, CPA) are marked with a leading "!". */
const WORDS_CACHE = new Map<string, string[]>();

export function requirementWords(text: string): string[] {
  const hit = WORDS_CACHE.get(text);
  if (hit) return hit;
  if (WORDS_CACHE.size > 20_000) WORDS_CACHE.clear();
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+#&]*/g)) {
    const w = m[0];
    const lower = w.toLowerCase();
    if (WORD_STOP.has(lower)) continue;
    if (/^[A-Z][A-Z0-9+#&]{1,5}$/.test(w)) out.push(`!${lower}`);
    else if (lower.length >= 4) out.push(stem(lower));
  }
  const words = [...new Set(out)];
  WORDS_CACHE.set(text, words);
  return words;
}

const POINT_WORDS = new WeakMap<EvidencePoint, Set<string>>();
function pointWords(p: EvidencePoint): Set<string> {
  let set = POINT_WORDS.get(p);
  if (!set) {
    set = new Set();
    for (const w of `${p.title} ${p.org ?? ""} ${p.text} ${p.skills.join(" ")}`.toLowerCase().split(/[^a-z0-9+#&]+/)) {
      if (!w) continue;
      set.add(w);
      set.add(stem(w));
    }
    POINT_WORDS.set(p, set);
  }
  return set;
}

/** 0 when the point's words do not cover the requirement, else 0.35 to 0.8 (see above). */
export function wordRelevance(words: readonly string[], p: EvidencePoint, text = ""): number {
  const education = EDUCATION_REQUIREMENT.test(text) && p.kind === "education";
  if (words.length === 0) return education ? 0.7 : 0;
  const have = pointWords(p);
  let total = 0, matched = 0, certification = false;
  for (const w of words) {
    const acronym = w.startsWith("!");
    const word = acronym ? w.slice(1) : w;
    const weight = acronym ? 2 : 1;
    total += weight;
    if (have.has(word)) {
      matched += weight;
      if (acronym && word.length >= 3) certification = true;
    }
  }
  const share = matched / total;
  let rel = matched >= 2 && share >= 0.5 ? 0.35 + 0.45 * share : 0;
  if (certification) rel = Math.max(rel, 0.7);
  if (words.length === 1 && matched > 0) rel = Math.max(rel, 0.6);
  if (education && matched > 0) rel = Math.max(rel, 0.75);
  return rel;
}

/** Id of the stand-in point for the resume text: evidence by words only, never listed as a career point. */
export const RESUME_POINT_ID = "resume";

/** The resume text as a word-evidence point (licences and certifications the career points may have missed). */
export function resumePoint(text: string | null | undefined): EvidencePoint | null {
  if (!text || !text.trim()) return null;
  return { id: RESUME_POINT_ID, kind: "resume", title: "your resume", org: null, startDate: null, endDate: null, text: text.slice(0, 20_000), skills: [], scope: {}, metrics: {}, embedding: null };
}

/** The shared `FitMapEntry` plus the extra fields tailoring and the UI can use. */
export type FitMapItem = FitMapEntry & { weight: number; evidence: FitEvidence; note: string };

export type FitResult = {
  /** 0 to 1. */
  fit: number;
  fitMap: FitMapItem[];
  reasons: string[];
  /** Weighted requirement score before capping and penalties. */
  requirementScore: number;
  /** True when a must-have the user clearly lacks capped the score. */
  capped: boolean;
  /** How much the spec can be trusted (1 full posting read by the model, down to 0.7 for no description): used for ranking. */
  confidence: number;
  components: FitComponents;
};

export function similarityToRelevance(sim: number): number {
  return clamp((sim - EMBED_FLOOR) / (EMBED_FULL - EMBED_FLOOR)) * EMBED_CAP;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const POST_HIRE = /\b(?:within\s+(?:\d+|one|two|three|four|five|six|nine|twelve|eighteen|twenty-four)\s*(?:days?|weeks?|months?|years?|yrs?)\b|(?:or|to|and|will|must)\s+obtain|obtain\w*\s+(?:a\s+|an\s+)?\S+(?:\s+\S+){0,6}\s+within|willing(?:ness)?\s+to\s+(?:obtain|get|earn)|upon\s+hire|after\s+hire)/i;

/** True when a skill the spec lists is already a requirement text: by its name, or by its acronym ("Basic Life Support (BLS)"). */
function namedInTexts(name: string, texts: readonly string[]): boolean {
  const lower = name.toLowerCase().trim();
  const acronym = /\(([A-Za-z]{2,6})\)/.exec(name)?.[1]?.toLowerCase() ?? (/^[A-Z]{2,6}$/.test(name.trim()) ? lower : null);
  const acronymRe = acronym ? new RegExp(`\\b${acronym}\\b`) : null;
  return texts.some((t) => (lower.length >= 4 && t.includes(lower)) || (acronymRe != null && acronymRe.test(t)));
}

/** Requirements of a spec: must-haves, nice-to-haves, and listed skills that no requirement text already names. */
export function buildRequirements(spec: StoredJobSpec, skills: SkillMap = DEFAULT_SKILL_MAP): Requirement[] {
  const weights = spec.requirementWeights ?? {};
  const specYears = new Map(spec.skills.map((s) => [canonicalSkill(s.name, skills), s.years ?? LEVEL_YEARS[s.level] ?? null] as const));
  const out: Requirement[] = [];
  const named = new Set<string>();
  const add = (text: string, mustHave: boolean, fallbackWeight: number) => {
    const found = findSkillsInText(text, skills);
    // A certificate or degree the hire may obtain later ("ACLS within 6 months of hire") is not a must-have today.
    const postHire = POST_HIRE.test(text);
    const parsed = postHire ? null : /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i.exec(text);
    const years = parsed ? Number(parsed[1]) : (found.length === 1 && !postHire ? (specYears.get(found[0]!) ?? null) : null);
    for (const f of found) named.add(f);
    const weight = clamp(weights[text] ?? fallbackWeight);
    out.push({
      text, mustHave: mustHave && !postHire, weight: postHire ? Math.min(weight, DEFAULT_NICE_WEIGHT) : weight, skills: found, years: years && years > 0 ? years : null,
    });
  };
  for (const t of spec.mustHaves) add(t, true, DEFAULT_MUST_WEIGHT);
  for (const t of spec.niceToHaves) add(t, false, DEFAULT_NICE_WEIGHT);
  const texts = [...spec.mustHaves, ...spec.niceToHaves].map((t) => t.toLowerCase());
  for (const s of spec.skills) {
    const key = canonicalSkill(s.name, skills);
    if (named.has(key) || namedInTexts(s.name, texts)) continue;
    named.add(key);
    const years = s.years ?? LEVEL_YEARS[s.level] ?? null;
    out.push({
      // Known skills by their canonical name; others as the posting wrote them, so acronyms (BLS, ACLS) stay recognisable.
      text: skills.display.has(key) ? skillDisplayName(key, skills) : s.name.trim(), mustHave: s.required, weight: s.required ? 0.8 : 0.3, skills: [key], years: years && years > 0 ? years : null,
    });
  }
  // Keep the heaviest when a posting is very long: must-haves first, then by weight.
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.mustHave) - Number(a.r.mustHave) || b.r.weight - a.r.weight || a.i - b.i)
    .slice(0, MAX_REQUIREMENTS)
    .map((x) => x.r);
}

/** Texts that need an embedding to score this spec (one per requirement). */
export function requirementTexts(reqs: readonly Requirement[]): string[] {
  return reqs.map((r) => r.text);
}

/** 1 for a current or recent point, down to 0.65 for work that ended a decade ago; 0.85 when there are no dates. */
export function recencyFactor(p: Pick<EvidencePoint, "startDate" | "endDate">, now: Date): number {
  const iv = pointInterval(p, now);
  if (!iv) return 0.85;
  const nowYear = now.getUTCFullYear() + now.getUTCMonth() / 12;
  return clamp(1 - 0.07 * Math.max(0, nowYear - iv[1]), 0.65, 1);
}

/** 0.92 for a bare mention up to 1.0 for a point that states team size, users, ownership or numbers. */
export function scopeFactor(p: Pick<EvidencePoint, "scope" | "metrics">): number {
  const signals = Object.keys(p.scope ?? {}).length + Object.keys(p.metrics ?? {}).length;
  return 0.92 + 0.08 * Math.min(1, signals / 3);
}

type PointMatch = { point: EvidencePoint; relevance: number; via: FitEvidence; viaSkill: string | null };

function matchPoint(req: Requirement, p: EvidencePoint, vector: number[] | undefined, skills: SkillMap): PointMatch {
  let relation = 0;
  let viaSkill: string | null = null;
  for (const want of req.skills) {
    const r = bestRelation(want, p.skills, skills);
    if (r > relation) {
      relation = r;
      viaSkill = r === 1 ? want : (p.skills.find((h) => skillRelation(want, h, skills) === r) ?? null);
    }
  }
  const semantic = vector && p.embedding ? similarityToRelevance(cosine(vector, p.embedding)) : 0;
  const byWords = relation < 1 ? wordRelevance(requirementWords(req.text), p, req.text) : 0;
  if (relation === 0 && semantic === 0 && byWords === 0) return { point: p, relevance: 0, via: "none", viaSkill: null };
  if (relation >= semantic && relation >= byWords) return { point: p, relevance: relation, via: relation === 1 ? "exact" : "related", viaSkill };
  if (byWords > semantic) return { point: p, relevance: byWords, via: "words", viaSkill: null };
  return { point: p, relevance: semantic, via: "semantic", viaSkill: null };
}

const where = (p: EvidencePoint) => `${p.title}${p.org ? ` at ${p.org}` : ""}`;

export type ScoreRequirementOptions = { now: Date; skills?: SkillMap };

export type RequirementScore = { score: number; best: PointMatch | null; yearsOfEvidence: number };

/** Strength of the best evidence for one requirement (0 when there is none). */
export function scoreRequirement(req: Requirement, points: readonly EvidencePoint[], vector: number[] | undefined, opts: ScoreRequirementOptions): RequirementScore {
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  let best: PointMatch | null = null;
  let bestStrength = 0;
  const relevant: PointMatch[] = [];
  for (const p of points) {
    const m = matchPoint(req, p, vector, skills);
    if (m.relevance <= 0) continue;
    if (m.relevance >= 0.5) relevant.push(m);
    const strength = m.relevance * recencyFactor(p, opts.now) * scopeFactor(p);
    if (strength > bestStrength) { bestStrength = strength; best = m; }
  }
  if (!best) return { score: 0, best: null, yearsOfEvidence: 0 };

  const intervals = relevant.map((m) => pointInterval(m.point, opts.now)).filter((i): i is [number, number] => i !== null);
  const statedYears = relevant.map((m) => Number(m.point.scope.years ?? m.point.metrics.years)).filter((n) => Number.isFinite(n) && n > 0);
  const yearsOfEvidence = Math.max(unionYears(intervals), ...statedYears, 0);
  // Licences and certifications found by their words have no length to measure.
  const depth = req.years != null && req.years > 0 && best.via !== "words" ? 0.55 + 0.45 * Math.min(1, yearsOfEvidence / req.years) : 1;
  return { score: clamp(bestStrength * depth), best, yearsOfEvidence };
}

function noteFor(req: Requirement, s: RequirementScore): string {
  if (!s.best) return "No matching experience found.";
  const years = s.yearsOfEvidence >= 0.5 ? `, about ${round(s.yearsOfEvidence, 1)} years` : "";
  const m = s.best;
  if (m.via === "exact") return `${req.text}: ${where(m.point)}${years}.`;
  if (m.via === "words") return `${req.text}: ${where(m.point)}${years}.`;
  if (m.via === "related") return `${req.text}: related skill ${m.viaSkill ? skillDisplayName(m.viaSkill) : "found"} in ${where(m.point)}${years}.`;
  return `${req.text}: similar experience in ${where(m.point)}${years}.`;
}

// ---- the fit scale ----------------------------------------------------------------------------------------------------
//
// scoreFit returns a fit between 0 and 1 on a fixed scale:
//   0.80 to 0.95  strong: the right kind of role at the right level, must-haves clearly evidenced
//   0.60 to 0.80  plausible: right function, most must-haves evidenced, a gap or a level step away
//   0.45 to 0.60  stretch: an adjacent role or level, or real gaps (widened rows must clear 0.45)
//   0.30 to 0.45  weak
//   below 0.30    irrelevant: another function, or a must-have the user clearly lacks
// The default lane minimum (`DEFAULT_MIN_FIT`, the lanes table default) is 0.6: plausible and better.
//
// fit = min(core, mustHaveCap) x functionAlignment x seniority x place, then capped by spec quality, where
//   core = 0.75 x requirement coverage + 0.25 x profile similarity (coverage alone when no similarity is known)
//   coverage = weighted coverage of the must-haves (nice-to-haves only when there are none), shrunk toward 0.5 when the
//              spec names few requirements, plus or minus 0.05 for the nice-to-haves
//   mustHaveCap = 0.3 + 0.7 x (1 - weight x lack) of the weakest clearly lacking must-have
// A requirement's evidence strength (0 to 1) becomes coverage linearly between 0.15 (nothing) and 0.8 (fully covered).
// Jobs without a description, or read only by the heuristic spec, are capped (0.65 and 0.75) and carry a confidence
// below 1 that the shortlist uses to rank them after well-specified jobs.

export const DEFAULT_MIN_FIT = 0.6;
const COVERAGE_FLOOR = 0.15;
const COVERAGE_FULL = 0.8;
/** Below this coverage a must-have counts as clearly lacking and starts to cap the score. */
const LACKING = 0.35;
/** Pseudo-weight of a 0.5 prior: few requirements cannot prove a near-perfect fit. */
const EVIDENCE_PRIOR = 0.6;
const NICE_SWING = 0.1;
const CORE_SIMILARITY_WEIGHT = 0.25;
/** A different function multiplies the fit by at most this much more than nothing. */
const DIFFERENT_FAMILY_FLOOR = 0.1;

/** Evidence strength (0 to 1) to how much of the requirement it covers. */
export function coverageOf(strength: number): number {
  return clamp((strength - COVERAGE_FLOOR) / (COVERAGE_FULL - COVERAGE_FLOOR));
}

export type SpecQuality = {
  /** True when the spec is the deterministic heuristic one (no model read the posting). */
  heuristic: boolean;
  /** Length of the posting text; null when unknown (treated as a full posting). */
  descriptionChars: number | null;
};

export type QualityLevel = "full" | "thin" | "heuristic" | "no_description";

/** Fit ceiling and ranking confidence for a spec of this quality. */
export function qualityOf(q: SpecQuality | null | undefined): { level: QualityLevel; cap: number; confidence: number } {
  if (!q) return { level: "full", cap: 1, confidence: 1 };
  const chars = q.descriptionChars;
  if (chars != null && chars < 200) return { level: "no_description", cap: 0.65, confidence: 0.7 };
  if (q.heuristic) return { level: "heuristic", cap: 0.75, confidence: 0.8 };
  if (chars != null && chars < 600) return { level: "thin", cap: 0.85, confidence: 0.9 };
  return { level: "full", cap: 1, confidence: 1 };
}

export type ScoreFitArgs = {
  spec: StoredJobSpec;
  points: readonly EvidencePoint[];
  /** Requirement text to its embedding; a requirement without one is scored on skills alone. */
  vectors?: ReadonlyMap<string, number[]>;
  /** Cosine similarity of the user's profile embedding and the job embedding, if known. */
  similarity?: number | null;
  /** The user's total years of experience: the level used when years in the job's function cannot be worked out. */
  experienceYears?: number | null;
  /** Name of the lane the job matched, used for a fallback reason. */
  laneName?: string | null;
  now: Date;
  skills?: SkillMap;
  /** The job title: function alignment, years in that function, and the level the title states. */
  jobTitle?: string | null;
  /** What the user is looking for and has been doing. Without it, function alignment is neutral. */
  target?: MatchTarget | null;
  /** How well the job is described. Without it the spec counts as a full one. */
  quality?: SpecQuality | null;
  /** 1 when the job's place is clearly acceptable, a little lower when it cannot be read ("2 Locations"). Default 1. */
  placeFactor?: number | null;
  /** The user's resume text, searched by words for requirements the career points do not show (licences, certifications). */
  resumeText?: string | null;
};

export type FitComponents = {
  coverage: number;
  similarity: number;
  cap: number;
  /** Null when there was no target to compare with. */
  alignment: number | null;
  seniority: number;
  /** Years in the job's function used for the level (null: unknown). */
  functionYears: number | null;
  place: number;
  quality: QualityLevel;
};

/** Profile similarity (0.15 floor, 0.5 full) as a 0 to 1 score. */
export function similarityScore(sim: number | null | undefined): number {
  return sim == null ? 0 : clamp((sim - 0.15) / (0.5 - 0.15));
}

/** Years of experience in the job's function when it can be worked out, else total experience. */
export function relevantYears(points: readonly EvidencePoint[], jobTitle: string | null | undefined, now: Date, total: number | null | undefined): number | null {
  const fromFamily = jobTitle ? familyYears(points, jobTitle, now) : null;
  return fromFamily ?? total ?? null;
}

export function scoreFit(args: ScoreFitArgs): FitResult {
  const skills = args.skills ?? DEFAULT_SKILL_MAP;
  const reqs = buildRequirements(args.spec, skills);
  const simScore = similarityScore(args.similarity);
  // A no-evidence profile (no career points) scores zero on every requirement, which is the honest answer.
  // The resume text joins as a word-only evidence point: licences and certifications the career points may have missed.
  const resume = resumePoint(args.resumeText);
  const evidence = resume ? [...args.points, resume] : args.points;
  const rows = reqs.map((req) => {
    const s = scoreRequirement(req, evidence, args.vectors?.get(req.text), { now: args.now, skills });
    const entry: FitMapItem = {
      requirement: req.text,
      mustHave: req.mustHave,
      score: round(s.score),
      careerPointIds: s.best && s.best.point.id !== RESUME_POINT_ID ? [s.best.point.id] : [],
      weight: req.weight,
      evidence: s.best ? s.best.via : "none",
      note: noteFor(req, s),
    };
    return { req, s, cov: coverageOf(s.score), entry };
  });

  // Informational: the plain weighted mean of requirement strengths.
  const sumWeights = rows.reduce((n, r) => n + r.req.weight, 0);
  const requirementScore = sumWeights > 0 ? rows.reduce((n, r) => n + r.req.weight * r.s.score, 0) / sumWeights : 0;

  const weighted = (xs: typeof rows): number | null => {
    const w = xs.reduce((n, r) => n + r.req.weight, 0);
    return w > 0 ? xs.reduce((n, r) => n + r.req.weight * r.cov, 0) / w : null;
  };
  const musts = rows.filter((r) => r.req.mustHave);
  const mustCoverage = weighted(musts);
  const niceCoverage = weighted(rows.filter((r) => !r.req.mustHave));

  let coverage = 0;
  let cap = 1;
  let core: number;
  if (rows.length === 0) {
    core = 0.8 * simScore;
  } else {
    const base = mustCoverage ?? niceCoverage ?? 0;
    // Few requirements cannot prove a near-perfect fit: pull high coverage toward 0.5 by a small pseudo-weight.
    const shrunk = Math.min(base, (base * sumWeights + 0.5 * EVIDENCE_PRIOR) / (sumWeights + EVIDENCE_PRIOR));
    const nice = mustCoverage != null && niceCoverage != null ? NICE_SWING * (niceCoverage - 0.5) : 0;
    coverage = clamp(shrunk + nice);
    core = args.similarity == null ? coverage : (1 - CORE_SIMILARITY_WEIGHT) * coverage + CORE_SIMILARITY_WEIGHT * simScore;
    // Must-haves the user clearly lacks cap the score (scaled by how central each one is).
    // The weakest one sets the ceiling, so several partly evidenced must-haves do not compound.
    let keep = 1;
    for (const r of musts) if (r.cov < LACKING) keep = Math.min(keep, 1 - Math.min(1, r.req.weight) * (1 - r.cov / LACKING));
    cap = 0.3 + 0.7 * keep;
  }
  const capped = cap < 1;
  let fit = Math.min(core, cap);

  const alignment = args.jobTitle ? titleAlignment(args.jobTitle, args.target) : null;
  if (alignment != null) fit *= Math.max(DIFFERENT_FAMILY_FLOOR, alignment);
  const functionYears = relevantYears(args.points, args.jobTitle, args.now, args.experienceYears);
  const level = seniorityFit(args.jobTitle, args.spec, functionYears);
  fit *= level.score;
  const place = clamp(args.placeFactor ?? 1);
  fit *= place;
  const quality = qualityOf(args.quality);
  fit = Math.min(fit, quality.cap);

  const fitMap = rows.map((r) => r.entry).sort((a, b) => Number(b.mustHave) - Number(a.mustHave) || b.weight - a.weight);
  const components: FitComponents = {
    coverage: round(coverage), similarity: round(simScore), cap: round(cap), alignment, seniority: level.score, functionYears, place, quality: quality.level,
  };
  return {
    fit: round(clamp(fit)), fitMap, reasons: reasonsFor(fitMap, args, simScore, alignment, level, functionYears),
    requirementScore: round(requirementScore), capped, confidence: quality.confidence, components,
  };
}

function reasonsFor(fitMap: readonly FitMapItem[], args: ScoreFitArgs, simScore: number, alignment: number | null, level: SeniorityFit, years: number | null): string[] {
  const reasons: string[] = [];
  const pointById = new Map(args.points.map((p) => [p.id, p]));
  const strong = fitMap
    .filter((e) => e.score >= 0.6 && e.careerPointIds[0])
    .sort((a, b) => b.weight * b.score - a.weight * a.score)
    .slice(0, 2);
  for (const e of strong) {
    const p = pointById.get(e.careerPointIds[0]!);
    reasons.push(`Strong evidence for ${e.requirement}${p ? `: ${where(p)}` : ""}`);
  }
  const gaps: string[] = [];
  const gap = fitMap.filter((e) => e.mustHave && e.score < 0.4).sort((a, b) => b.weight - a.weight)[0];
  if (gap) gaps.push(`Gap: ${gap.requirement}`);
  if (alignment != null && alignment < 0.5) gaps.push("Gap: a different kind of role from the ones you are looking for");
  if (level.direction === "above" && level.score < 0.85) {
    gaps.push(`Gap: asks for more seniority than your ${years != null ? `${round(years, 1)} years` : "experience"} in this kind of role`);
  } else if (level.direction === "below" && level.score < 0.85) {
    gaps.push("Gap: more junior than your experience");
  }
  // Keep room for the most important gaps.
  if (gaps.length > 1 && reasons.length > 1) reasons.length = 1;
  reasons.push(...gaps);
  if (reasons.length < 2 && args.laneName) reasons.push(`Fits your ${args.laneName} lane`);
  if (reasons.length < 2 && args.similarity != null && simScore > 0) reasons.push(`Close to your overall profile (similarity ${Math.round(args.similarity * 100)}%)`);
  if (reasons.length === 0) reasons.push("Little direct evidence in your history yet");
  return reasons.slice(0, 3);
}
