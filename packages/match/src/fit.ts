import type { FitMapEntry } from "@norinote/shared";
import type { StoredJobSpec } from "./understand.js";
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
 * years of relevant work there are against what the posting asks. Requirement scores are averaged by the spec's weights;
 * must-haves cap the result (a missing must-have cannot be bought back by a long list of nice-to-haves).
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

export type FitEvidence = "exact" | "related" | "semantic" | "none";

/** The shared `FitMapEntry` plus the extra fields tailoring and the UI can use. */
export type FitMapItem = FitMapEntry & { weight: number; evidence: FitEvidence; note: string };

export type FitResult = {
  /** 0 to 1. */
  fit: number;
  fitMap: FitMapItem[];
  reasons: string[];
  /** Weighted requirement score before capping and penalties. */
  requirementScore: number;
  /** True when a weak must-have lowered the score. */
  capped: boolean;
};

export function similarityToRelevance(sim: number): number {
  return clamp((sim - EMBED_FLOOR) / (EMBED_FULL - EMBED_FLOOR)) * EMBED_CAP;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Requirements of a spec: must-haves, nice-to-haves, and listed skills that no requirement text already names. */
export function buildRequirements(spec: StoredJobSpec, skills: SkillMap = DEFAULT_SKILL_MAP): Requirement[] {
  const weights = spec.requirementWeights ?? {};
  const specYears = new Map(spec.skills.map((s) => [canonicalSkill(s.name, skills), s.years ?? LEVEL_YEARS[s.level] ?? null] as const));
  const out: Requirement[] = [];
  const named = new Set<string>();
  const add = (text: string, mustHave: boolean, fallbackWeight: number) => {
    const found = findSkillsInText(text, skills);
    const parsed = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i.exec(text);
    const years = parsed ? Number(parsed[1]) : (found.length === 1 ? (specYears.get(found[0]!) ?? null) : null);
    for (const f of found) named.add(f);
    out.push({ text, mustHave, weight: clamp(weights[text] ?? fallbackWeight), skills: found, years: years && years > 0 ? years : null });
  };
  for (const t of spec.mustHaves) add(t, true, DEFAULT_MUST_WEIGHT);
  for (const t of spec.niceToHaves) add(t, false, DEFAULT_NICE_WEIGHT);
  for (const s of spec.skills) {
    const key = canonicalSkill(s.name, skills);
    if (named.has(key)) continue;
    named.add(key);
    const years = s.years ?? LEVEL_YEARS[s.level] ?? null;
    out.push({
      text: skillDisplayName(key, skills), mustHave: s.required, weight: s.required ? 0.8 : 0.3, skills: [key], years: years && years > 0 ? years : null,
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
  if (relation === 0 && semantic === 0) return { point: p, relevance: 0, via: "none", viaSkill: null };
  if (relation >= semantic) return { point: p, relevance: relation, via: relation === 1 ? "exact" : "related", viaSkill };
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
  const depth = req.years != null && req.years > 0 ? 0.55 + 0.45 * Math.min(1, yearsOfEvidence / req.years) : 1;
  return { score: clamp(bestStrength * depth), best, yearsOfEvidence };
}

function noteFor(req: Requirement, s: RequirementScore): string {
  if (!s.best) return "No matching experience found.";
  const years = s.yearsOfEvidence >= 0.5 ? `, about ${round(s.yearsOfEvidence, 1)} years` : "";
  const m = s.best;
  if (m.via === "exact") return `${req.text}: ${where(m.point)}${years}.`;
  if (m.via === "related") return `${req.text}: related skill ${m.viaSkill ? skillDisplayName(m.viaSkill) : "found"} in ${where(m.point)}${years}.`;
  return `${req.text}: similar experience in ${where(m.point)}${years}.`;
}

export type ScoreFitArgs = {
  spec: StoredJobSpec;
  points: readonly EvidencePoint[];
  /** Requirement text to its embedding; a requirement without one is scored on skills alone. */
  vectors?: ReadonlyMap<string, number[]>;
  /** Cosine similarity of the user's profile embedding and the job embedding, if known. */
  similarity?: number | null;
  /** The user's years of experience, for a small penalty when they fall a little short of the posting. */
  experienceYears?: number | null;
  /** Name of the lane the job matched, used for a fallback reason. */
  laneName?: string | null;
  now: Date;
  skills?: SkillMap;
};

/** Profile similarity (0.15 floor, 0.5 full) as a 0 to 1 score. */
export function similarityScore(sim: number | null | undefined): number {
  return sim == null ? 0 : clamp((sim - 0.15) / (0.5 - 0.15));
}

export function scoreFit(args: ScoreFitArgs): FitResult {
  const skills = args.skills ?? DEFAULT_SKILL_MAP;
  const reqs = buildRequirements(args.spec, skills);
  const simScore = similarityScore(args.similarity);
  // A no-evidence profile (no career points) scores zero on every requirement, which is the honest answer.
  const rows = reqs.map((req) => {
    const s = scoreRequirement(req, args.points, args.vectors?.get(req.text), { now: args.now, skills });
    const entry: FitMapItem = {
      requirement: req.text,
      mustHave: req.mustHave,
      score: round(s.score),
      careerPointIds: s.best ? [s.best.point.id] : [],
      weight: req.weight,
      evidence: s.best ? s.best.via : "none",
      note: noteFor(req, s),
    };
    return { req, s, entry };
  });

  const sumWeights = rows.reduce((n, r) => n + r.req.weight, 0);
  const requirementScore = sumWeights > 0 ? rows.reduce((n, r) => n + r.req.weight * r.s.score, 0) / sumWeights : 0;

  // Must-haves cap the score: the weakest one (scaled by how central it is) sets a ceiling between 0.3 and 1.
  let worstMust = 1;
  for (const r of rows) if (r.req.mustHave) worstMust = Math.min(worstMust, 1 - Math.min(1, r.req.weight) * (1 - r.s.score));
  const cap = 0.3 + 0.7 * worstMust;

  let fit: number;
  let capped = false;
  if (rows.length === 0) {
    fit = 0.8 * simScore;
  } else {
    const blended = 0.9 * requirementScore + 0.1 * simScore;
    capped = blended > cap;
    fit = Math.min(blended, cap);
  }

  const yearsAsked = args.spec.yearsMin;
  if (yearsAsked != null && yearsAsked > 0 && args.experienceYears != null && args.experienceYears < yearsAsked) {
    fit *= 1 - Math.min(0.3, 0.08 * (yearsAsked - args.experienceYears));
  }

  const fitMap = rows.map((r) => r.entry).sort((a, b) => Number(b.mustHave) - Number(a.mustHave) || b.weight - a.weight);
  return { fit: round(clamp(fit)), fitMap, reasons: reasonsFor(fitMap, args, simScore), requirementScore: round(requirementScore), capped };
}

function reasonsFor(fitMap: readonly FitMapItem[], args: ScoreFitArgs, simScore: number): string[] {
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
  const gap = fitMap.filter((e) => e.mustHave && e.score < 0.4).sort((a, b) => b.weight - a.weight)[0];
  if (gap) reasons.push(`Gap: ${gap.requirement}`);
  if (reasons.length < 2 && args.laneName) reasons.push(`Fits your ${args.laneName} lane`);
  if (reasons.length < 2 && args.similarity != null && simScore > 0) reasons.push(`Close to your overall profile (similarity ${Math.round(args.similarity * 100)}%)`);
  if (reasons.length === 0) reasons.push("Little direct evidence in your history yet");
  return reasons.slice(0, 3);
}
