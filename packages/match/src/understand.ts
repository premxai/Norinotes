import { z } from "zod";
import { AiUnavailableError, complete, embed, embeddingModel } from "@norinote/ai";
import { companies, eq, and, gte, jobEmbeddings, jobSpecs, jobs, type Db } from "@norinote/db";
import { JobSpec, REMOTE_RULES, SENIORITIES, SKILL_LEVELS, SPONSORSHIP } from "@norinote/shared";
import { detectRestrictions } from "./clearance.js";
import { heuristicSpec } from "./heuristic-spec.js";
import { DEFAULT_SKILL_MAP, canonicalSkill, skillDisplayName, type SkillMap } from "./skills.js";
import { detectSponsorship } from "./sponsorship.js";

/** Bump when the schema or the prompt changes in a way that should re-understand every job. */
export const SPEC_VERSION = 1;
/**
 * Version marker of a spec written without the model (`model: "heuristic"`). Below SPEC_VERSION on purpose: readers that
 * ask for a current spec do not see it, so the next understand run with a working model replaces it. Matching reads the
 * newest spec of any version, so a heuristic spec is used until then.
 */
export const HEURISTIC_SPEC_VERSION = 0;

/**
 * What is stored in `job_specs.spec`: the shared `JobSpec` plus `requirementWeights`, how much each must-have or
 * nice-to-have matters (0 to 1, keyed by the exact requirement text). The shared contract only has strings for those
 * lists, so the weights ride along as an extra field that readers of plain `JobSpec` simply ignore.
 */
export type StoredJobSpec = JobSpec & { requirementWeights?: Record<string, number> };

const Requirement = z.object({ text: z.string(), weight: z.number() });

/** What the model returns. Strict-mode friendly: every field required, optional values nullable. */
export const JobSpecModelOutput = z.object({
  mustHaves: z.array(Requirement),
  niceToHaves: z.array(Requirement),
  skills: z.array(z.object({
    name: z.string(),
    level: z.enum(SKILL_LEVELS),
    years: z.number().nullable(),
    required: z.boolean(),
  })),
  seniority: z.enum(SENIORITIES),
  roleFamily: z.string(),
  yearsMin: z.number().nullable(),
  location: z.object({
    remote: z.enum(REMOTE_RULES),
    countries: z.array(z.string()),
    cities: z.array(z.string()),
  }),
  citizenshipRequired: z.boolean(),
  clearanceRequired: z.boolean(),
  sponsorship: z.enum(SPONSORSHIP),
  responsibilities: z.array(z.string()),
});
export type JobSpecModelOutput = z.infer<typeof JobSpecModelOutput>;

export const UNDERSTAND_SYSTEM = `You read one job posting and extract what it asks for. Reply with JSON only.

- mustHaves: hard requirements, each a short phrase (for example "3+ years of Python"), with weight 0 to 1 for how central it is (1 = the job cannot be done without it). niceToHaves: preferred or bonus items, same shape, weights usually below 0.5. At most 8 of each.
- skills: concrete technologies and methods named in the posting. level is basic, working, advanced or expert as the posting implies; years is the minimum years asked for that skill or null; required is true for hard requirements.
- seniority: intern, entry, mid, senior, staff, principal, manager, director, executive or unknown.
- roleFamily: a short lower-case label such as "backend engineering", "data science", "product design".
- yearsMin: the minimum years of professional experience overall, or null.
- location: remote is remote, hybrid, onsite or unknown; countries as country names; cities as city names.
- citizenshipRequired: true only if the posting restricts the role to citizens or US persons. clearanceRequired: true only if it requires a government security clearance. Do not guess from the industry.
- sponsorship: "no" only if the posting says it does not sponsor visas, "yes" only if it says it does, otherwise "unknown".
- responsibilities: up to 6 short phrases.
Never invent requirements that the posting does not state.`;

const MAX_DESCRIPTION_CHARS = 8000;
const LEVEL_RANK: Record<string, number> = { basic: 0, working: 1, advanced: 2, expert: 3 };

const clamp01 = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

type JobRow = { title: string; location: string | null; remote: boolean; descriptionText: string; companyName: string | null };

/**
 * Model output made safe and consistent, then corrected by the deterministic detectors. A detector that finds a
 * restriction ("must be a US citizen", "Active TS/SCI") wins over the model; one that finds an explicit "no clearance or
 * citizenship needed" can clear the model's guess; the no-sponsorship wording wins over the model's sponsorship value.
 */
export function finalizeSpec(model: JobSpecModelOutput, job: Pick<JobRow, "title" | "descriptionText" | "remote">, skills: SkillMap = DEFAULT_SKILL_MAP): StoredJobSpec {
  const weights: Record<string, number> = {};
  const requirements = (list: JobSpecModelOutput["mustHaves"], fallback: number): string[] => {
    const out: string[] = [];
    for (const r of list) {
      const text = clean(r.text);
      if (!text || out.includes(text) || text in weights) continue;
      weights[text] = Math.round(clamp01(r.weight, fallback) * 100) / 100;
      out.push(text);
      if (out.length >= 12) break;
    }
    return out;
  };
  const mustHaves = requirements(model.mustHaves, 1);
  const niceToHaves = requirements(model.niceToHaves, 0.4);

  const bySkill = new Map<string, JobSpec["skills"][number]>();
  for (const s of model.skills) {
    const raw = clean(s.name);
    if (!raw || raw.length > 60) continue;
    const key = canonicalSkill(raw, skills);
    const name = skills.display.has(key) ? skillDisplayName(key, skills) : raw;
    const years = s.years != null && Number.isFinite(s.years) ? Math.min(30, Math.max(0, s.years)) : null;
    const prev = bySkill.get(key);
    if (!prev) bySkill.set(key, { name, level: s.level, years, required: s.required });
    else bySkill.set(key, {
      name: prev.name,
      level: (LEVEL_RANK[s.level] ?? 0) > (LEVEL_RANK[prev.level] ?? 0) ? s.level : prev.level,
      years: prev.years == null ? years : years == null ? prev.years : Math.max(prev.years, years),
      required: prev.required || s.required,
    });
  }

  const description = job.descriptionText ?? "";
  const restrictions = detectRestrictions({ title: job.title, descriptionText: description, extraText: mustHaves });
  const sponsorship = detectSponsorship(description) ?? model.sponsorship;
  const yearsMin = model.yearsMin != null && Number.isFinite(model.yearsMin) ? Math.min(30, Math.max(0, model.yearsMin)) : null;

  return {
    mustHaves,
    niceToHaves,
    skills: [...bySkill.values()].slice(0, 30),
    seniority: model.seniority,
    roleFamily: clean(model.roleFamily).toLowerCase(),
    yearsMin,
    location: {
      remote: model.location.remote === "unknown" && job.remote ? "remote" : model.location.remote,
      countries: model.location.countries.map(clean).filter(Boolean),
      cities: model.location.cities.map(clean).filter(Boolean),
    },
    citizenshipRequired: restrictions.citizenship ? true : restrictions.citizenshipNegated ? false : model.citizenshipRequired,
    clearanceRequired: restrictions.clearance ? true : restrictions.clearanceNegated ? false : model.clearanceRequired,
    sponsorship,
    responsibilities: model.responsibilities.map(clean).filter(Boolean).slice(0, 6),
    requirementWeights: weights,
  };
}

/** Compact text for the job embedding: what the role is, what it needs, a little of the posting itself. */
export function jobEmbeddingText(job: Pick<JobRow, "title" | "location" | "descriptionText" | "companyName">, spec: JobSpec): string {
  const parts = [
    `${job.title}${job.companyName ? ` at ${job.companyName}` : ""}.`,
    spec.roleFamily ? `${spec.roleFamily}${spec.seniority !== "unknown" ? `, ${spec.seniority}` : ""}.` : "",
    spec.skills.length ? `Skills: ${spec.skills.map((s) => s.name).join(", ")}.` : "",
    spec.mustHaves.length ? `Requirements: ${spec.mustHaves.slice(0, 6).join("; ")}.` : "",
    spec.responsibilities.length ? `Responsibilities: ${spec.responsibilities.slice(0, 3).join("; ")}.` : "",
    job.location ? `Location: ${job.location}.` : "",
    clean(job.descriptionText).slice(0, 500),
  ];
  return parts.filter(Boolean).join(" ").slice(0, 2000);
}

export type UnderstandResult = {
  jobId: string;
  skipped: boolean;
  spec: StoredJobSpec;
  /** True when this call wrote the job's embedding. */
  embedded: boolean;
  /** True when the spec is the deterministic one because the AI service was unavailable (it is upgraded on a later run). */
  heuristic: boolean;
  /** True when the job has no embedding after this call because the AI service was unavailable. It is filled in on a later run. */
  embeddingPending: boolean;
};

async function loadJob(db: Db, jobId: string): Promise<JobRow> {
  const [row] = await db
    .select({ title: jobs.title, location: jobs.location, remote: jobs.remote, descriptionText: jobs.descriptionText, companyName: companies.name })
    .from(jobs)
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.id, jobId));
  if (!row) throw new Error(`Job ${jobId} not found`);
  return row;
}

/** The newest stored spec at or above the current version, or null. */
export async function loadCurrentSpec(db: Db, jobId: string): Promise<StoredJobSpec | null> {
  const [row] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs)
    .where(and(eq(jobSpecs.jobId, jobId), gte(jobSpecs.version, SPEC_VERSION)))
    .orderBy(jobSpecs.version).limit(1);
  return row ? (row.spec as StoredJobSpec) : null;
}

/** One small-model call: the spec, checked against the shared contract and stored as the current version. */
async function understandWithModel(db: Db, jobId: string, job: JobRow, skills: SkillMap): Promise<StoredJobSpec> {
  const header = [
    `Title: ${job.title}`,
    job.companyName ? `Company: ${job.companyName}` : "",
    `Location: ${job.location ?? "not stated"}${job.remote ? " (remote)" : ""}`,
  ].filter(Boolean).join("\n");
  const posting = `${header}\n\n${job.descriptionText.slice(0, MAX_DESCRIPTION_CHARS)}`;
  const res = await complete({ tier: "small", system: UNDERSTAND_SYSTEM, input: posting, schema: JobSpecModelOutput, schemaName: "job_spec", strict: true });
  const spec = finalizeSpec(res.output, job, skills);
  const parsed = JobSpec.safeParse(spec);
  if (!parsed.success) throw new Error(`Job spec for ${jobId} broke the shared contract: ${parsed.error.message}`);
  await db.insert(jobSpecs).values({ jobId, version: SPEC_VERSION, spec, model: res.model }).onConflictDoNothing();
  // A concurrent worker may have written first; its spec is the one every reader will see.
  return (await loadCurrentSpec(db, jobId)) ?? spec;
}

/**
 * Understand one job, once: a single small-model call extracts the spec into `job_specs`, then a compact job text is
 * embedded into `job_embeddings`. Safe to call again: a job with a current spec makes no model call, and a missing
 * embedding is filled in from the stored spec.
 *
 * When the AI service is unavailable (`AiUnavailableError`) the job is not failed: a deterministic spec is stored with
 * `model: "heuristic"` and `HEURISTIC_SPEC_VERSION`, and the embedding is left for a later run. Calling again once the
 * service is back replaces the heuristic spec with the model's.
 */
export async function understandJob(db: Db, jobId: string, opts: { skills?: SkillMap } = {}): Promise<UnderstandResult> {
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  const job = await loadJob(db, jobId);
  const existing = await loadCurrentSpec(db, jobId);
  let spec = existing;
  let heuristic = false;

  if (!spec) {
    try {
      spec = await understandWithModel(db, jobId, job, skills);
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      spec = await heuristicSpecFor(db, jobId, job, skills);
      heuristic = true;
    }
  }

  const [hasEmbedding] = await db.select({ jobId: jobEmbeddings.jobId }).from(jobEmbeddings).where(eq(jobEmbeddings.jobId, jobId));
  let embedded = false;
  let embeddingPending = false;
  if (!hasEmbedding) {
    try {
      const [vector] = await embed([jobEmbeddingText(job, spec)]);
      if (!vector) throw new Error(`No embedding returned for job ${jobId}`);
      await db.insert(jobEmbeddings).values({ jobId, embedding: vector, model: embeddingModel() }).onConflictDoNothing();
      embedded = true;
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      embeddingPending = true;
    }
  }
  return { jobId, skipped: existing !== null, spec, embedded, heuristic, embeddingPending };
}

/** The job's stored heuristic spec, or a new one written now. */
async function heuristicSpecFor(db: Db, jobId: string, job: JobRow, skills: SkillMap): Promise<StoredJobSpec> {
  const [stored] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs)
    .where(and(eq(jobSpecs.jobId, jobId), eq(jobSpecs.version, HEURISTIC_SPEC_VERSION)));
  if (stored) return stored.spec as StoredJobSpec;
  const spec = heuristicSpec(job, skills);
  const parsed = JobSpec.safeParse(spec);
  if (!parsed.success) throw new Error(`Heuristic job spec for ${jobId} broke the shared contract: ${parsed.error.message}`);
  await db.insert(jobSpecs).values({ jobId, version: HEURISTIC_SPEC_VERSION, spec, model: "heuristic" }).onConflictDoNothing();
  return spec;
}
