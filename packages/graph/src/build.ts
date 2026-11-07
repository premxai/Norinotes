import { z } from "zod";
import type { Db } from "@norinote/db";
import { AiUnavailableError, BudgetExceededError, complete } from "@norinote/ai";
import type { CareerPoint } from "@norinote/shared";
import { catalogCertifications, certificationIds, issuersIn } from "./certifications.js";
import { parseContact, type Contact } from "./contact.js";
import { embedCareerPoints } from "./embeddings.js";
import { certificationSections, heuristicPoints, type DraftPoint, type PointKind } from "./heuristic.js";
import { findSkills, normalizeSkills } from "./skills.js";
import { insertUserPoints, replaceResumePoints } from "./store.js";
import { extractMetrics, extractScope, normalizeDate, type Metric } from "./text.js";

// ---- model contract -------------------------------------------------------------------------------------------------

const Scope = z.object({
  team_size: z.number().nullable(),
  users: z.number().nullable(),
  budget: z.string().nullable(),
  ownership: z.string().nullable(),
});

const ModelMetric = z.object({ value: z.number(), unit: z.string().nullable(), measures: z.string() });

const ModelPoint = z.object({
  title: z.string(),
  org: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  text: z.string(),
  skills: z.array(z.string()),
  scope: Scope,
  metrics: z.array(ModelMetric),
  source_quote: z.string(),
});

export const ResumeGraphSchema = z.object({
  roles: z.array(ModelPoint),
  projects: z.array(ModelPoint),
  achievements: z.array(ModelPoint),
  education: z.array(ModelPoint),
  certifications: z.array(ModelPoint),
  skills: z.array(ModelPoint),
});
type ModelPointT = z.infer<typeof ModelPoint>;

const FactPoint = ModelPoint.omit({ source_quote: true }).extend({ kind: z.enum(["role", "project", "achievement", "education", "skill", "certification"]) });
export const FactSchema = z.object({ points: z.array(FactPoint) });

/** Stable instructions: identical on every call so the vendor's prompt cache applies. */
const RESUME_SYSTEM = `You turn a resume into a career graph for a job-matching system. Return JSON only.

Groups:
- roles: each job or internship held (title, employer, dates). text = what they did, in the resume's own words, condensed.
- projects: named projects (personal, open source, academic, or inside a job).
- achievements: single bullets that state a concrete result (a number, a launch, an award). One per bullet.
- education: degrees and the schools that granted them. Not licences or certifications.
- certifications: every licence, professional certification and clinical card the resume states: RN, LPN or NP licences (with the state), BLS, ACLS, PALS, TNCC, CPR, PMP, CPA, CFA, AWS, Google Cloud or Azure certifications, CKA, CKAD, Security+, CISSP, Scrum or CSM, SHRM, Six Sigma, and the like. One point per credential, also when several share a line ("BLS; ACLS; PALS" is three points). A job title is not a licence: list "Registered Nurse" here only where the resume gives it as a licence or credential.
- skills: skill lists, one point per category line ("Languages: ..."). title = the category.

Rules for every point:
- Use only what the resume says. Never invent employers, dates, numbers, tools or claims.
- source_quote: copy the exact resume line (or the header line for a role) the point came from, character for character.
- start and end: "YYYY-MM" or "YYYY"; end is null when the role is current ("Present").
- certifications: title = the credential with its state when stated ("Registered Nurse (RN), Minnesota", "Basic Life Support (BLS)", "AWS Certified Solutions Architect - Associate"); org = the issuer only when the resume names it ("AHA" is "American Heart Association"), else null; start = the issue date when stated, else null; end = the expiry date when stated ("active through 2027", "expires 06/2026"), also when it has passed, else null; text = the resume line the credential is on; skills = its canonical short names (BLS, ACLS, RN, PMP, CKA) plus the platform it names (AWS, Kubernetes); scope null and metrics empty. A credential still being pursued ("candidate", "in progress") is listed as such in the title.
- skills: canonical names of technologies and competencies named in or clearly implied by the point (Kubernetes, not k8s; JavaScript, not JS). No soft-skill filler.
- scope: team_size, users (how many people use or were served), budget (as written, e.g. "$2M"), ownership ("lead", "owner", "contributor") when stated; otherwise null.
- metrics: every number that proves impact, with value, unit ("%", "USD", "x", "users", "ms"...) and measures (a few words: what the number measures).
- Keep roles and achievements separate: a role summarises the job; an achievement is one quantified bullet.`;

const FACT_SYSTEM = `You turn one free-text fact a person tells about their own career into one or more career points. Return JSON only.

- Use only what the person wrote. Never add employers, dates, numbers, tools or claims they did not state.
- One point per distinct thing (a role, a project, a result, a degree, a skill group). Most facts are one point.
- kind is role, project, achievement, education, skill or certification (a licence, professional certification or clinical card; start = issued, end = expiry when stated, org = issuer only when stated).
- title: a short noun phrase. text: the fact, tidied, in the first person dropped ("Led a team of 5" not "I led a team of 5").
- start and end: "YYYY-MM" or "YYYY", null when not stated; end null when it is current.
- skills: canonical technology and competency names (Kubernetes, not k8s). scope: team_size, users, budget, ownership when stated, else null.
- metrics: every stated number with value, unit and measures.`;

const MAX_RESUME_CHARS = 30_000;
const MAX_POINTS = 80;
const MAX_FACT_CHARS = 2_000;

// ---- normalising model output ---------------------------------------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[•·●▪■◦‣▸►○∙]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(squash(s).split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1));

function scopeOf(s: z.infer<typeof Scope>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.team_size !== null) out.teamSize = s.team_size;
  if (s.users !== null) out.users = s.users;
  if (s.budget) out.budget = s.budget;
  if (s.ownership) out.ownership = s.ownership;
  return out;
}

const cleanMetrics = (ms: Metric[]): Metric[] =>
  ms.filter((m) => Number.isFinite(m.value) && m.measures.trim()).map((m) => ({ value: m.value, unit: m.unit?.trim() || null, measures: m.measures.trim().slice(0, 120) })).slice(0, 8);

function toDraft(kind: PointKind, p: ModelPointT | z.infer<typeof FactPoint>, quote: string | null): DraftPoint | null {
  const title = p.title.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return {
    kind,
    title: title.slice(0, 200),
    org: p.org?.trim() || null,
    startDate: normalizeDate(p.start),
    endDate: normalizeDate(p.end),
    text: p.text.trim() || title,
    skills: normalizeSkills(p.skills),
    scope: scopeOf(p.scope),
    metrics: cleanMetrics(p.metrics),
    sourceQuote: quote,
  };
}

/**
 * Checks a model point against the resume. A quote found in the resume is kept as it is; a paraphrased one is replaced
 * by the resume line it most resembles; a point whose quote resembles nothing is dropped as invented.
 */
function verifiedQuote(quote: string, fullSquashed: string, lines: { raw: string; tokens: Set<string> }[]): string | null {
  const q = squash(quote);
  if (!q) return null;
  if (fullSquashed.includes(q)) return quote.trim();
  const qt = tokens(quote);
  if (!qt.size) return null;
  let best: { raw: string; score: number } | null = null;
  for (const l of lines) {
    let hit = 0;
    for (const t of qt) if (l.tokens.has(t)) hit++;
    const score = hit / qt.size;
    if (!best || score > best.score) best = { raw: l.raw, score };
  }
  return best && best.score >= 0.6 ? best.raw : null;
}

/**
 * A certification must not claim more than the resume states: the issuer has to be named in the text (or be the full name
 * of an abbreviation it uses, "AHA"), and a date has to be a year the text shows. Anything else is dropped to null.
 */
function groundCertification(d: DraftPoint, fullSquashed: string, resumeText: string): DraftPoint {
  const stated = (year: string | null) => (year && new RegExp(`\\b${year.slice(0, 4)}\\b`).test(resumeText) ? year : null);
  const org = d.org && (fullSquashed.includes(squash(d.org)) || issuersIn(resumeText).includes(d.org)) ? d.org : null;
  return { ...d, org, startDate: stated(d.startDate), endDate: stated(d.endDate) };
}

/** Model output to drafts: quotes verified, skills canonical, dates normalised, duplicates dropped. */
export function draftsFromModel(out: z.infer<typeof ResumeGraphSchema>, resumeText: string): DraftPoint[] {
  const fullSquashed = squash(resumeText);
  const lines = resumeText.split("\n").map((l) => l.trim()).filter(Boolean).map((raw) => ({ raw, tokens: tokens(raw) }));
  const groups: [PointKind, ModelPointT[]][] = [
    ["role", out.roles], ["project", out.projects], ["achievement", out.achievements], ["education", out.education],
    ["certification", out.certifications], ["skill", out.skills],
  ];
  const seen = new Set<string>();
  const drafts: DraftPoint[] = [];
  for (const [kind, list] of groups) {
    for (const p of list) {
      const quote = verifiedQuote(p.source_quote, fullSquashed, lines);
      if (!quote) continue;
      const made = toDraft(kind, p, quote);
      if (!made) continue;
      const d = kind === "certification" ? groundCertification(made, fullSquashed, resumeText) : made;
      const key = `${kind}|${squash(d.title)}|${squash(d.org ?? "")}|${d.startDate ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drafts.push(d);
    }
  }
  // A model reply with nothing usable stays empty so the caller falls back to the heuristic parser.
  return (drafts.length ? withCertificationBackfill(drafts, resumeText) : drafts).slice(0, MAX_POINTS);
}

/**
 * The model sometimes skips a credential in a long list. The resume's named licences and certifications (the same finder
 * the fallback parser uses, so only what the text states) that the model's certification points do not cover are added
 * before the skills.
 */
function withCertificationBackfill(drafts: DraftPoint[], resumeText: string): DraftPoint[] {
  const covered = new Set(drafts.filter((d) => d.kind === "certification").flatMap((d) => certificationIds(`${d.title}; ${d.skills.join(", ")}`)));
  const missing = catalogCertifications(certificationSections(resumeText)).filter((c) => !covered.has(c.id)).map((c) => c.draft);
  if (!missing.length) return drafts;
  const at = drafts.findIndex((d) => d.kind === "skill");
  return at < 0 ? [...drafts, ...missing] : [...drafts.slice(0, at), ...missing, ...drafts.slice(at)];
}

// ---- public API -----------------------------------------------------------------------------------------------------

export type BuildResult = {
  /** The user's resume-sourced points after the rebuild (user-added facts are not listed here). */
  points: CareerPoint[];
  /** "model" when the model's output was valid, "heuristic" when the fallback parser was used, "none" when nothing could be read (nothing was changed). */
  source: "model" | "heuristic" | "none";
  contact: Contact;
  /** True when every point has an embedding. False when embedding failed: the points are saved and `embedCareerPoints` picks them up on its next run. */
  embedded: boolean;
  /** True when the AI service could not be used (bad key, outage, rate limit): the fallback parser read the text, or embedding was left for later. */
  aiUnavailable: boolean;
};

export type FactResult = {
  points: CareerPoint[];
  /** "model" when the model structured the fact, "heuristic" when it was recorded from the user's own words. */
  source: "model" | "heuristic";
  embedded: boolean;
  aiUnavailable: boolean;
};

/**
 * Embeds the given points, but a failure of the AI service does not fail the caller: the points stay saved without
 * embeddings and `embedCareerPoints` embeds them on its next run. A spent budget still throws.
 */
async function embedQuietly(db: Db, userId: string, ids: string[]): Promise<{ embedded: boolean; aiUnavailable: boolean }> {
  try {
    await embedCareerPoints(db, userId, ids);
    return { embedded: true, aiUnavailable: false };
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    return { embedded: false, aiUnavailable: e instanceof AiUnavailableError };
  }
}

/**
 * Turns resume text into career points: one small-model call, then the user's previous resume-sourced points are replaced
 * in one transaction (facts the user added stay) and the new points are embedded. If the model's output is invalid or
 * empty, or the AI service is unavailable (`AiUnavailableError`), the deterministic parser is used instead and the points
 * are saved without embeddings when embedding fails too. A spent daily budget is not hidden by the fallback: it throws.
 */
export async function buildCareerPoints(db: Db, userId: string, text: string): Promise<BuildResult> {
  const resume = text.replace(/\r\n?/g, "\n").trim();
  if (!resume) throw new Error("Resume text is empty");
  const contact = parseContact(resume);

  let drafts: DraftPoint[] = [];
  let source: BuildResult["source"] = "model";
  let aiUnavailable = false;
  try {
    const res = await complete({
      tier: "small",
      system: RESUME_SYSTEM,
      input: `Resume:\n\n${resume.slice(0, MAX_RESUME_CHARS)}`,
      schema: ResumeGraphSchema,
      schemaName: "career_graph",
      strict: true,
      userId,
      db,
    });
    drafts = draftsFromModel(res.output, resume);
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    aiUnavailable = e instanceof AiUnavailableError;
    drafts = [];
  }
  if (!drafts.length) {
    drafts = heuristicPoints(resume).slice(0, MAX_POINTS);
    source = "heuristic";
  }
  if (!drafts.length) return { points: [], source: "none", contact, embedded: false, aiUnavailable };

  const points = await replaceResumePoints(db, userId, drafts);
  const emb = await embedQuietly(db, userId, points.map((p) => p.id));
  return { points, source, contact, embedded: emb.embedded, aiUnavailable: aiUnavailable || emb.aiUnavailable };
}

/**
 * Turns one free-text fact into career points (source: user) and embeds them. Without the AI service the fact is recorded
 * from the user's own words (`source: "heuristic"`) and left unembedded for later.
 */
export async function addFact(db: Db, userId: string, text: string): Promise<FactResult> {
  const fact = text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_CHARS);
  if (!fact) throw new Error("Fact is empty");
  let drafts: DraftPoint[] = [];
  let source: FactResult["source"] = "model";
  let aiUnavailable = false;
  try {
    const res = await complete({
      tier: "small", system: FACT_SYSTEM, input: `Fact:\n${fact}`, schema: FactSchema, schemaName: "career_fact", strict: true, userId, db,
    });
    drafts = res.output.points.map((p) => toDraft(p.kind, p, fact)).filter((d): d is DraftPoint => d !== null).slice(0, 6);
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e;
    aiUnavailable = e instanceof AiUnavailableError;
  }
  if (!drafts.length) { drafts = [factFallback(fact)]; source = "heuristic"; }
  const points = await insertUserPoints(db, userId, drafts);
  const emb = await embedQuietly(db, userId, points.map((p) => p.id));
  return { points, source, embedded: emb.embedded, aiUnavailable: aiUnavailable || emb.aiUnavailable };
}

/**
 * Career points from other text the person pointed Nori at (their own website), read the way a resume is: the model's
 * points are kept only when their quotes are in the text, so nothing is invented. Throws when the AI service cannot be
 * used (AiUnavailableError, BudgetExceededError); there is no basic parser for free-form pages.
 */
export async function draftsFromText(db: Db, userId: string, text: string): Promise<DraftPoint[]> {
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) return [];
  const res = await complete({
    tier: "small", system: RESUME_SYSTEM, input: `Resume (the text of the person's own website):\n\n${body.slice(0, MAX_RESUME_CHARS)}`,
    schema: ResumeGraphSchema, schemaName: "career_graph", strict: true, userId, db,
  });
  return draftsFromModel(res.output, body).filter((d) => d.kind !== "skill" || d.skills.length > 0).slice(0, MAX_POINTS);
}

/** One achievement point straight from the user's words when the model could not structure the fact. */
function factFallback(fact: string): DraftPoint {
  const first = fact.split(/(?<=[.!?])\s/)[0] ?? fact;
  return {
    kind: "achievement",
    title: first.length > 80 ? `${first.slice(0, 77).trimEnd()}...` : first.replace(/[.!?]$/, ""),
    org: null, startDate: null, endDate: null, text: fact,
    skills: findSkills(fact), scope: extractScope(fact), metrics: extractMetrics(fact), sourceQuote: fact,
  };
}
