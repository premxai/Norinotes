import { significantTitleWords } from "./lanes.js";
import type { EvidencePoint } from "./profile.js";
import { DEFAULT_SKILL_MAP, bestRelation, canonicalSkill, canonicalSkills, findSkillsInText, type SkillMap } from "./skills.js";
import type { StoredJobSpec } from "./understand.js";

/**
 * Ranking without vectors. When a job has a spec but no embedding (the AI service was unavailable when it was understood),
 * or the user has no embedded career points, similarity comes from skill overlap instead of cosine distance: how much of
 * what the job asks for (skills, and skills named in its must-haves) the user's career points cover, through the same
 * skill relations the detailed fit uses, plus a little for shared title words.
 *
 * The overlap is mapped onto the same scale the detailed fit expects of a cosine similarity (0.15 is noise, 0.5 is a clear
 * match), so one threshold and one blend serve both. Less precise than vectors, but it needs no AI at all.
 */

/** Pseudo cosine similarity for an overlap of 0 (floor) and 1 (full): the range `similarityScore` in fit.ts spreads over 0..1. */
export const LEXICAL_SIM_FLOOR = 0.15;
export const LEXICAL_SIM_SPAN = 0.35;

export const lexicalSimilarity = (overlap: number): number => LEXICAL_SIM_FLOOR + LEXICAL_SIM_SPAN * Math.min(1, Math.max(0, overlap));

/** Canonical skills the user's career points name or describe. */
export function userSkillSet(points: readonly Pick<EvidencePoint, "skills" | "title" | "text">[], skills: SkillMap = DEFAULT_SKILL_MAP): Set<string> {
  const out = new Set<string>();
  for (const p of points) {
    for (const s of canonicalSkills(p.skills, skills)) out.add(s);
    for (const s of findSkillsInText(`${p.title} ${p.text}`, skills)) out.add(s);
  }
  return out;
}

/** Title words of the user's career points (roles and projects), for the small title component. */
export function userTitleWords(points: readonly Pick<EvidencePoint, "title">[]): Set<string> {
  const out = new Set<string>();
  for (const p of points) for (const w of significantTitleWords(p.title)) out.add(w);
  return out;
}

export type LexicalProfile = { skills: Set<string>; titleWords: Set<string> };

export function lexicalProfile(points: readonly EvidencePoint[], skills: SkillMap = DEFAULT_SKILL_MAP): LexicalProfile {
  return { skills: userSkillSet(points, skills), titleWords: userTitleWords(points) };
}

/** 0 to 1: the share of the job's weighted skills the user covers, blended with title-word overlap. 0 when the job names nothing. */
export function lexicalOverlap(job: { title: string; spec: StoredJobSpec }, profile: LexicalProfile, skills: SkillMap = DEFAULT_SKILL_MAP): number {
  const wanted = new Map<string, number>();
  for (const s of job.spec.skills) {
    const k = canonicalSkill(s.name, skills);
    wanted.set(k, Math.max(wanted.get(k) ?? 0, s.required ? 1 : 0.5));
  }
  for (const text of job.spec.mustHaves) for (const k of findSkillsInText(text, skills)) wanted.set(k, 1);

  const titleWords = significantTitleWords(job.title);
  const titleOverlap = titleWords.length === 0 ? 0 : titleWords.filter((w) => profile.titleWords.has(w)).length / titleWords.length;
  if (wanted.size === 0) return 0.6 * titleOverlap;

  const have = [...profile.skills];
  let total = 0;
  let covered = 0;
  for (const [want, weight] of wanted) {
    total += weight;
    covered += weight * (profile.skills.has(want) ? 1 : bestRelation(want, have, skills));
  }
  return 0.85 * (covered / total) + 0.15 * titleOverlap;
}
