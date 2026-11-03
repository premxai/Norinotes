import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";
import { canonicalTerm } from "./aliases.js";
import { containsPhrase, keyPhraseOf, softOf, SOFT_BEHAVIOURS } from "./key-phrases.js";
import { verbLemma } from "./phrases.js";
import { findTerms, mentionsName, mentionsSkill, norm } from "./text.js";
import type { CoverageScore, ResumeContent } from "./types.js";

/**
 * The evidence index: for each requirement of the job, the career points that support it. A requirement that names
 * terms (skills, tools, licences: anything in the alias table, or a skill the spec lists) is supported only by a point
 * that names one of those terms, exactly or through an alias. A purely descriptive requirement ("own services end to
 * end") is supported by shared words, by the fit map that matching computed, or by embedding similarity when vectors
 * are available. A soft requirement (ownership, end-to-end, startup pace, stakeholder work...) is supported only by a
 * point that shows the behaviour (key-phrases.ts). No support means a gap: reported, never filled.
 */

export type RequirementTerm = { key: string; jobString: string };

export type Requirement = {
  id: string;
  text: string;
  mustHave: boolean;
  /** 0 to 1, how much the posting cares (the spec's requirement weights, else must 1, nice 0.4, listed skill 0.8 or 0.3). */
  weight: number;
  kind: "must" | "nice" | "skill" | "fit";
  terms: RequirementTerm[];
  /** The posting's own key phrase for a descriptive requirement ("production services", "end-to-end"); null for term ones. */
  keyPhrase: string | null;
  /** The soft behaviour the requirement is about (key in SOFT_BEHAVIOURS), or null. */
  soft: string | null;
};

export type EvidenceVia = "exact" | "alias" | "words" | "behaviour" | "fitmap" | "semantic";
export type EvidenceHit = { pointId: string; via: EvidenceVia; score: number; terms: string[] };

export type EvidenceEntry = Requirement & {
  support: EvidenceHit[];
  supported: boolean;
  /** Term keys some career point names. */
  supportedTerms: string[];
  /** Term keys no career point names: the gate rejects them, the report lists them. */
  lackedTerms: string[];
  /** Points with related but not sufficient evidence (a fit-map or semantic match to a term the user lacks). */
  related: string[];
  /**
   * The evidence is strong enough to carry the posting's own wording onto the resume: a term match, shared words, the
   * behaviour itself, or a fit-map or semantic match of 0.6 or more.
   */
  mirror: boolean;
};

export type EvidenceIndex = {
  entries: EvidenceEntry[];
  gaps: EvidenceEntry[];
  byPoint: Map<string, EvidenceEntry[]>;
  /** Every term the job names, highest priority first, with the job's spelling. */
  jobTerms: RequirementTerm[];
  /** Job terms that some career point names. */
  supportedJobTerms: RequirementTerm[];
  /** Job terms no career point names. */
  lackedJobTerms: RequirementTerm[];
};

/** Cosine similarity between a requirement text and a career point, or null when either has no vector. */
export type SimilarityFn = (requirementText: string, pointId: string) => number | null;

export const SEMANTIC_MIN = 0.45;
/** Fit-map or semantic evidence at least this strong may carry the posting's key phrase. */
export const MIRROR_MIN = 0.6;
export const FITMAP_MIN = 0.35;
const MAX_REQUIREMENTS = 30;

const WORD_STOP = new Set(("experience experiences years year ability able strong excellent good great solid deep knowledge skills skill working work " +
  "required require requirements requirement preferred plus must current currently valid minimum least proficiency proficient understanding " +
  "familiarity familiar including include related relevant field environment environments demonstrated proven track record using with within " +
  "across other such also well both high highly level levels based team teams similar role roles hands ideally equivalent combination " +
  "preferably bonus nice have that this from into their your will would should what about more than over under and the for our you " +
  "who can are etc any all new").split(" "));

/** Significant words of a requirement, lower case; acronyms are marked with a leading "!" and count double. */
export function requirementWords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+#&]*/g)) {
    const w = m[0];
    const lower = w.toLowerCase();
    if (/^[A-Z][A-Z0-9+#&]{1,5}$/.test(w) && !WORD_STOP.has(lower)) out.push(`!${lower}`);
    else if (lower.length >= 4 && !WORD_STOP.has(lower)) out.push(lower);
  }
  return [...new Set(out)];
}

/** "closed" ~ "close", "built" ~ "building", "services" ~ "service" (the verb lemma works for these nouns too). */
const stem = (w: string) => verbLemma(w);

/** Share (0 to 1) of the requirement's word weight found in the text, and the matched weight. */
export function wordShare(words: readonly string[], text: string): { share: number; matched: number } {
  if (words.length === 0) return { share: 0, matched: 0 };
  const have = new Set(text.toLowerCase().split(/[^a-z0-9+#&]+/).filter(Boolean).map(stem));
  let total = 0, matched = 0;
  for (const w of words) {
    const acronym = w.startsWith("!");
    const weight = acronym ? 2 : 1;
    total += weight;
    if (have.has(stem(acronym ? w.slice(1) : w))) matched += weight;
  }
  return { share: matched / total, matched };
}

/** All the text of a career point that evidence may come from. */
export function pointCorpus(p: CareerPoint): string {
  return [
    p.title, p.org ?? "", p.text, p.skills.join(", "), p.sourceQuote ?? "",
    ...Object.entries(p.metrics ?? {}).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
    ...Object.entries(p.scope ?? {}).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
  ].filter(Boolean).join("\n");
}

/** Requirements of a job: must-haves, nice-to-haves, then listed skills no requirement already names; fit-map rows otherwise. */
export function buildRequirements(spec: JobSpec | null, fitMap: readonly FitMapEntry[] = []): Requirement[] {
  const out: Requirement[] = [];
  const named = new Set<string>();
  const weights = spec?.requirementWeights ?? {};
  const add = (text: string, mustHave: boolean, kind: Requirement["kind"], weight: number, extraTerm?: string) => {
    const t = text.trim();
    if (!t || out.some((r) => norm(r.text) === norm(t))) return;
    const terms: RequirementTerm[] = findTerms(t).map((f) => ({ key: f.key, jobString: f.as.trim() }));
    if (extraTerm && !terms.some((x) => x.key === canonicalTerm(extraTerm))) terms.unshift({ key: canonicalTerm(extraTerm), jobString: extraTerm.trim() });
    // A fit-map row that only repeats a skill the spec already named (match lists skills under their own display name).
    if (kind === "fit" && terms.length > 0 && terms.every((x) => named.has(x.key))) return;
    for (const x of terms) named.add(x.key);
    const soft = terms.length === 0 ? softOf(t) : null;
    out.push({
      id: `r${out.length + 1}`, text: t, mustHave, weight: Math.max(0, Math.min(1, weight)), kind, terms,
      keyPhrase: terms.length === 0 ? keyPhraseOf(t, soft) : null, soft: soft?.key ?? null,
    });
  };
  if (spec) {
    for (const t of spec.mustHaves) add(t, true, "must", weights[t] ?? 1);
    for (const t of spec.niceToHaves) add(t, false, "nice", weights[t] ?? 0.4);
    for (const s of spec.skills) {
      if (named.has(canonicalTerm(s.name))) continue;
      add(s.name, s.required, "skill", s.required ? 0.8 : 0.3, s.name);
    }
  }
  for (const e of fitMap) add(e.requirement, e.mustHave, "fit", e.mustHave ? 1 : 0.4);
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.mustHave) - Number(a.r.mustHave) || b.r.weight - a.r.weight || a.i - b.i)
    .slice(0, MAX_REQUIREMENTS)
    .map((x) => x.r);
}

export type BuildEvidenceInput = {
  spec: JobSpec | null;
  fitMap: readonly FitMapEntry[];
  points: readonly CareerPoint[];
  similarity?: SimilarityFn | null;
};

export function buildEvidence(input: BuildEvidenceInput): EvidenceIndex {
  const reqs = buildRequirements(input.spec, input.fitMap);
  const corpora = input.points.map((p) => ({ p, text: pointCorpus(p) }));
  const fitByText = new Map(input.fitMap.map((e) => [norm(e.requirement), e]));

  const entries: EvidenceEntry[] = reqs.map((r) => {
    const support: EvidenceHit[] = [];
    const related = new Set<string>();
    const supportedTerms = new Set<string>();
    const fit = fitByText.get(norm(r.text));
    const fitIds = fit && fit.score >= FITMAP_MIN ? fit.careerPointIds : [];
    const words = r.terms.length === 0 ? requirementWords(r.text) : [];
    const soft = r.soft ? SOFT_BEHAVIOURS.find((b) => b.key === r.soft)! : null;
    for (const { p, text } of corpora) {
      if (soft) {
        // A soft requirement counts only where a point shows the behaviour; similar words are not enough.
        if (soft.evidence.test(text)) support.push({ pointId: p.id, via: "behaviour", score: 0.8, terms: [] });
        else if (fitIds.includes(p.id)) related.add(p.id);
        continue;
      }
      if (r.terms.length > 0) {
        const hit = r.terms.filter((t) => mentionsSkill(text, t.jobString) || mentionsSkill(text, t.key));
        if (hit.length > 0) {
          for (const t of hit) supportedTerms.add(t.key);
          const exact = hit.every((t) => mentionsName(text, t.jobString));
          support.push({ pointId: p.id, via: exact ? "exact" : "alias", score: hit.length / r.terms.length, terms: hit.map((t) => t.key) });
          continue;
        }
        if (fitIds.includes(p.id)) related.add(p.id);
        const sim = input.similarity?.(r.text, p.id);
        if (sim != null && sim >= SEMANTIC_MIN) related.add(p.id);
        continue;
      }
      const ws = wordShare(words, text);
      if (ws.matched >= 2 && ws.share >= 0.5) { support.push({ pointId: p.id, via: "words", score: 0.35 + 0.45 * ws.share, terms: [] }); continue; }
      if (fitIds.includes(p.id)) { support.push({ pointId: p.id, via: "fitmap", score: fit!.score, terms: [] }); continue; }
      const sim = input.similarity?.(r.text, p.id);
      if (sim != null && sim >= SEMANTIC_MIN) support.push({ pointId: p.id, via: "semantic", score: Math.min(0.85, sim), terms: [] });
    }
    support.sort((a, b) => b.score - a.score);
    const lacked = r.terms.map((t) => t.key).filter((k) => !supportedTerms.has(k));
    const mirror = support.some((s) => s.via === "exact" || s.via === "alias" || s.via === "words" || s.via === "behaviour" || s.score >= MIRROR_MIN);
    return {
      ...r, support, supported: support.length > 0, supportedTerms: [...supportedTerms], lackedTerms: [...new Set(lacked)],
      related: [...related].filter((id) => !support.some((s) => s.pointId === id)), mirror,
    };
  });

  const byPoint = new Map<string, EvidenceEntry[]>();
  for (const e of entries) for (const s of e.support) byPoint.set(s.pointId, [...(byPoint.get(s.pointId) ?? []), e]);

  // Job terms by priority: terms of heavier requirements first (the entries are already sorted that way).
  const jobTerms: RequirementTerm[] = [];
  for (const e of entries) for (const t of e.terms) if (!jobTerms.some((x) => x.key === t.key)) jobTerms.push(t);
  const supportedKeys = new Set(entries.flatMap((e) => e.supportedTerms));
  return {
    entries,
    gaps: entries.filter((e) => !e.supported),
    byPoint,
    jobTerms,
    supportedJobTerms: jobTerms.filter((t) => supportedKeys.has(t.key)),
    lackedJobTerms: jobTerms.filter((t) => !supportedKeys.has(t.key)),
  };
}

// ---- coverage -----------------------------------------------------------------------------------------------------------

/** "alias": any spelling of a term; "exact": the posting's spelling; "phrase": the posting's key phrase word for word. */
export type CoverageMode = "alias" | "exact" | "phrase";

/** All the words a reader (or a parser) sees, without the name and contact block. */
export function resumeText(c: ResumeContent): string {
  return [
    c.summary ?? "",
    ...c.skills.flatMap((g) => g.items),
    ...c.experience.flatMap((r) => [r.title, ...r.bullets.map((b) => b.text)]),
    ...c.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...c.education.flatMap((e) => [e.degree ?? "", e.field ?? ""]),
    ...(c.certifications ?? []),
  ].filter(Boolean).join("\n");
}

/**
 * Whether a supported requirement shows in a text. A requirement with terms shows when every term the user has is named
 * (any alias in "alias" mode, the job's own spelling in "exact" mode); a descriptive one when at least half of its
 * significant words appear.
 */
export function requirementShown(e: EvidenceEntry, text: string, mode: CoverageMode = "alias"): boolean {
  if (e.supportedTerms.length > 0) {
    return e.supportedTerms.every((k) => {
      const t = e.terms.find((x) => x.key === k)!;
      return mode === "alias" ? mentionsSkill(text, t.jobString) || mentionsSkill(text, k) : mentionsName(text, t.jobString);
    });
  }
  if (mode === "phrase") return e.keyPhrase ? containsPhrase(text, e.keyPhrase) : false;
  if (e.soft) {
    const b = SOFT_BEHAVIOURS.find((x) => x.key === e.soft)!;
    return b.evidence.test(text) || (e.keyPhrase ? containsPhrase(text, e.keyPhrase) : false);
  }
  const words = requirementWords(e.text);
  if (words.length === 0) return false;
  return wordShare(words, text).share >= 0.5;
}

export type { CoverageScore };

/** Share of the supported must-haves (all supported requirements when the job lists no must-haves) the resume shows. */
export function coverageScore(index: EvidenceIndex, content: ResumeContent, mode: CoverageMode = "alias"): CoverageScore {
  const supported = index.entries.filter((e) => e.supported);
  const musts = supported.filter((e) => e.mustHave);
  const pool = musts.length > 0 ? musts : supported;
  const text = resumeText(content);
  const missing = pool.filter((e) => !requirementShown(e, text, mode)).map((e) => e.text);
  const total = pool.length;
  return { shown: total - missing.length, total, pct: total ? Math.round(((total - missing.length) / total) * 100) : null, missing };
}

/**
 * The requirements a bullet supports: a term requirement when the bullet's text names one of its supported terms; a
 * descriptive one when one of the bullet's points supports it and (for word evidence) the bullet itself shares its words.
 */
export function bulletSupports(index: EvidenceIndex, text: string, pointIds: readonly string[]): EvidenceEntry[] {
  return index.entries.filter((e) => {
    if (!e.supported) return false;
    if (e.terms.length > 0) {
      return e.supportedTerms.some((k) => { const t = e.terms.find((x) => x.key === k)!; return mentionsSkill(text, t.jobString) || mentionsSkill(text, k); });
    }
    const hit = e.support.find((s) => pointIds.includes(s.pointId));
    if (!hit) return false;
    // A soft requirement belongs to the line that shows the behaviour, not to every line of the role.
    if (e.soft) return SOFT_BEHAVIOURS.find((x) => x.key === e.soft)!.evidence.test(text);
    if (hit.via !== "words") return true;
    const ws = wordShare(requirementWords(e.text), text);
    return ws.matched >= 1 && ws.share >= 0.34;
  });
}
