/** Content of a tailored resume, stored as `resumes.content`. Weights let a stored resume be trimmed again later. */
export type ResumeBullet = {
  id: string;
  text: string;
  /** Career points this bullet is grounded in. */
  careerPointIds: string[];
  /** How much of the posting this bullet covers (sum of the weights of the requirements it supports). Higher stays longer. */
  weight: number;
};

export type ResumeContact = { email?: string; phone?: string; location?: string; linkedin?: string; github?: string; website?: string };

export type ResumeContent = {
  name: string;
  contact: ResumeContact;
  summary?: string;
  experience: { careerPointId: string; title: string; company: string; location?: string; start?: string; end?: string; bullets: ResumeBullet[] }[];
  education: { careerPointId: string; school: string; degree?: string; field?: string; start?: string; end?: string }[];
  skills: { group: string; items: string[] }[];
  projects: { careerPointId: string; name: string; bullets: ResumeBullet[] }[];
  /** Plain lines such as "AWS Certified Developer - Associate". Optional: tailoring does not produce them yet. */
  certifications?: string[];
};

export type ResumeChange = {
  kind: "bullet" | "summary" | "trim";
  /** Original text (null when there was none, as for a first summary). */
  before: string | null;
  /** New text (null when the content was dropped). */
  after: string | null;
  reason: string;
  /** The source career points: a rewritten bullet cites these and the gate checked it against them. */
  careerPointIds: string[];
  /** The resume bullet this change is about (bullet and trim changes). */
  bulletId?: string;
  /** Gate result of the accepted text (rewritten bullets). */
  gate?: { ok: boolean; failures: { rule: string; detail: string }[] };
  /** Model attempts it took (1 first try, 2 after a retry, more after critique revisions). */
  attempts?: number;
};

export type AtsCheck = { id: string; label: string; weight: number; pass: boolean; detail?: string };

export type CoverageScore = { shown: number; total: number; pct: number | null; missing: string[] };

/** What tailoring did and how well the result covers the posting. Stored in `resumes.ats_checks` under `tailoring`. */
export type TailoringReport = {
  version: 1;
  /**
   * Supported must-have coverage: of the must-haves the career points support, how many the resume shows (alias aware),
   * for the resume as written (`before`), after selection (`selected`) and final (`after`); `exact*` counts only the
   * posting's own spelling.
   */
  coverage: {
    before: CoverageScore; selected: CoverageScore; after: CoverageScore; exactBefore: CoverageScore; exactAfter: CoverageScore;
    /** Supported must-haves whose key phrase (the posting's own words, or its exact term spelling) is on the resume verbatim. */
    phraseBefore: CoverageScore; phraseAfter: CoverageScore;
  };
  /** Requirements nothing in the career points supports, and terms missing from partly supported ones. */
  gaps: { requirement: string; mustHave: boolean; lacking: string[]; related: string[] }[];
  /** The posting's key phrases the career points support well enough to carry onto the resume. */
  keyPhrases?: string[];
  /** Per offered bullet: its source points, attempts and gate result; `kept` when a paraphrase added nothing and the original stayed. */
  bullets: { bulletId: string; sourceIds: string[]; rewritten: boolean; attempts: number; reverted: boolean; kept?: boolean; gate: { ok: boolean; failures: { rule: string; detail: string }[] } }[];
  summary: { source: "model" | "facts" | "none"; failures: { rule: string; detail: string }[] };
  rounds: { round: number; gaps: number; fixes: number; accepted: number; coverage: number | null; stop: string | null }[];
  stopReason: string;
  model: string | null;
  calls: { purpose: string; model: string; costMicros: number }[];
  costMicros: number;
  aiUnavailable: boolean;
  error: string | null;
};

export type AtsReport = {
  /** 0 to 100, passed weight over applicable weight. */
  score: number;
  /** Share of the posting's required skills the resume mentions, 0 to 100, or null when the posting lists none. */
  keywordCoverage: number | null;
  checks: AtsCheck[];
  /** The tailoring report, when the resume was tailored (see TailoringReport). */
  tailoring?: TailoringReport;
};

export type Density = "normal" | "compact" | "tight";
export type ResumeTemplate = "ats";
export type PageSize = "letter" | "a4";
export type FontId = "source-sans" | "inter" | "lora" | "garamond" | "tinos";
