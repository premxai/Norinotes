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
  education: { careerPointId: string; school: string; degree?: string; start?: string; end?: string }[];
  skills: { group: string; items: string[] }[];
  projects: { careerPointId: string; name: string; bullets: ResumeBullet[] }[];
};

export type ResumeChange = {
  kind: "bullet" | "summary" | "trim";
  /** Original text (null when there was none, as for a first summary). */
  before: string | null;
  /** New text (null when the content was dropped). */
  after: string | null;
  reason: string;
  careerPointIds: string[];
};

export type AtsCheck = { id: string; label: string; weight: number; pass: boolean; detail?: string };
export type AtsReport = {
  /** 0 to 100, passed weight over applicable weight. */
  score: number;
  /** Share of the posting's required skills the resume mentions, 0 to 100, or null when the posting lists none. */
  keywordCoverage: number | null;
  checks: AtsCheck[];
};

export type Density = "normal" | "compact" | "tight";
export type ResumeTemplate = "ats";
export type PageSize = "letter" | "a4";
export type FontId = "source-sans" | "inter" | "lora" | "garamond" | "tinos";
