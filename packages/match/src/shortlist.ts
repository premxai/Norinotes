import { z } from "zod";
import { AiUnavailableError, complete, embed } from "@norinote/ai";
import {
  and, applications, asc, careerPoints, companies, cosineDistance, desc, eq, inArray, isNotNull, isNull, jobEmbeddings, jobSpecs, jobs, lanes, or,
  shortlist, sql, type Db,
} from "@norinote/db";
import { buildRequirements, requirementTexts, scoreFit, type FitMapItem } from "./fit.js";
import { checkGates } from "./gates.js";
import { laneFitsSql, matchingLanes } from "./lanes.js";
import { lexicalOverlap, lexicalProfile, lexicalSimilarity } from "./lexical.js";
import { loadMatchProfile, meanProfileEmbedding, type MatchProfile } from "./profile.js";
import { DEFAULT_SKILL_MAP, type SkillMap } from "./skills.js";
import type { StoredJobSpec } from "./understand.js";

export const SHORTLIST_MAX_AGE_DAYS = 60;
const DAY_MS = 86_400_000;
const EMBED_BATCH = 100;

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export type ExplainOptions = {
  /** How many of the best matches get the one-sentence "why this fits" line. Default 3. */
  top?: number;
};

export type MatchOptions = {
  now: Date;
  /** Max shortlist rows written per run. Default 20. */
  limit?: number;
  skills?: SkillMap;
  /** Embeds requirement texts. Default: `embed` from @norinote/ai (no user, so no budget is charged). */
  embedFn?: EmbedFn;
  /** Off unless given. One small-model call per listed match, charged to the user's budget; failures are ignored. */
  explain?: ExplainOptions;
};

export type BuildShortlistOptions = MatchOptions & {
  /**
   * Mean of the user's top career point embeddings (graph exports `profileEmbedding`). Null when the user has none (the AI
   * service was unavailable): every job is then ranked by skill overlap instead of vector similarity.
   */
  profileEmbedding: number[] | null;
  /** How many vector-ranked jobs get the detailed fit. Default 200. Up to the same number of lexically ranked jobs (spec, no embedding) may be added. */
  candidates?: number;
};

export type ShortlistCandidate = {
  jobId: string;
  fit: number;
  fitMap: FitMapItem[];
  reasons: string[];
  /** Cosine similarity between the profile and the job. */
  similarity: number;
};

export type MatchStats = {
  /** Jobs that came out of the SQL filter and vector rank. */
  considered: number;
  /** Their ids, nearest to the profile first. */
  candidateIds: string[];
  /** Candidates without a stored spec yet (understand has not finished). */
  withoutSpec: number;
  /** Candidates ranked by skill overlap instead of vector similarity (no job embedding, or no profile embedding). */
  lexical: number;
  /** Candidates that passed the gates and were scored. */
  scored: number;
  gated: Array<{ jobId: string; reasons: string[] }>;
  belowMinFit: number;
  /** Rows inserted or refreshed. Dismissed and applied rows are never touched. */
  saved: number;
  items: ShortlistCandidate[];
};

type CandidateJob = {
  jobId: string;
  title: string;
  location: string | null;
  remote: boolean;
  companyName: string | null;
  similarity: number;
  /** True when `similarity` is a skill-overlap stand-in, not a cosine similarity. */
  lexical?: boolean;
};

// ---- shared SQL conditions --------------------------------------------------------------------------------------------

/** Open, not blocked, and posted (or first seen) within the last 60 days. */
export function openAndFreshSql(now: Date) {
  const since = new Date(now.getTime() - SHORTLIST_MAX_AGE_DAYS * DAY_MS).toISOString();
  return and(
    isNull(jobs.closedAt),
    eq(companies.blocked, false),
    sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${since}::timestamptz`,
  );
}

/** The user has not already dismissed, applied to, or started an application for this job. */
function notActedOnSql(userId: SqlUser) {
  return and(
    sql`NOT EXISTS (SELECT 1 FROM ${shortlist} WHERE ${shortlist.userId} = ${userId} AND ${shortlist.jobId} = ${jobs.id} AND ${shortlist.status} <> 'new')`,
    sql`NOT EXISTS (SELECT 1 FROM ${applications} WHERE ${applications.userId} = ${userId} AND ${applications.jobId} = ${jobs.id})`,
  );
}
type SqlUser = string | typeof lanes.userId;

// ---- requirement embeddings -------------------------------------------------------------------------------------------

const vectorCache = new Map<string, number[]>();
const VECTOR_CACHE_MAX = 20_000;

/**
 * Embeds each distinct requirement text once (cached across users and runs), in batches. When the AI service is
 * unavailable the vectors found so far are returned: a requirement without one is scored on skills alone.
 */
async function requirementVectors(texts: readonly string[], embedFn: EmbedFn): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const missing: string[] = [];
  for (const t of new Set(texts)) {
    const hit = vectorCache.get(t);
    if (hit) out.set(t, hit);
    else missing.push(t);
  }
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    let vectors: number[][];
    try {
      vectors = await embedFn(batch);
    } catch (e) {
      if (e instanceof AiUnavailableError) return out;
      throw e;
    }
    batch.forEach((t, j) => {
      const v = vectors[j];
      if (!v) return;
      if (vectorCache.size >= VECTOR_CACHE_MAX) vectorCache.clear();
      vectorCache.set(t, v);
      out.set(t, v);
    });
  }
  return out;
}

/** Forget cached requirement embeddings (tests). */
export function clearRequirementVectorCache(): void {
  vectorCache.clear();
}

// ---- detailed fit and save --------------------------------------------------------------------------------------------

async function loadSpecs(db: Db, jobIds: readonly string[]): Promise<Map<string, StoredJobSpec>> {
  const out = new Map<string, StoredJobSpec>();
  if (jobIds.length === 0) return out;
  const rows = await db.select({ jobId: jobSpecs.jobId, version: jobSpecs.version, spec: jobSpecs.spec })
    .from(jobSpecs).where(inArray(jobSpecs.jobId, [...jobIds])).orderBy(asc(jobSpecs.version));
  for (const r of rows) out.set(r.jobId, r.spec as StoredJobSpec); // ascending, so the newest version wins
  return out;
}

const WHY_SYSTEM = "You write one short sentence (at most 25 words) telling a job seeker why a job fits them. Use only the facts given. No hype, no second-guessing, no quotes.";
const Why = z.object({ line: z.string() });

async function explainTop(db: Db, profile: MatchProfile, items: Array<ShortlistCandidate & { title: string; companyName: string | null }>, top: number): Promise<void> {
  const prefix = `The job seeker's evidence:\n${profile.points.slice(0, 12).map((p) => `- ${p.title}${p.org ? ` at ${p.org}` : ""}: ${p.skills.slice(0, 6).join(", ")}`).join("\n")}`;
  for (const item of items.slice(0, top)) {
    const input = `Job: ${item.title}${item.companyName ? ` at ${item.companyName}` : ""}\nFit: ${Math.round(item.fit * 100)}%\n${item.fitMap.slice(0, 6).map((e) => `- ${e.requirement}: ${e.note}`).join("\n")}`;
    try {
      const res = await complete({ tier: "small", system: WHY_SYSTEM, prefix, input, schema: Why, schemaName: "why_fits", strict: true, userId: profile.userId, db, maxOutputTokens: 80 });
      const line = res.output.line.replace(/\s+/g, " ").trim().slice(0, 240);
      if (line && line !== "fake") item.reasons = [line, ...item.reasons].slice(0, 3);
    } catch {
      // Over budget or a model error: the deterministic reasons stand.
      return;
    }
  }
}

export type ShortlistRow = Pick<ShortlistCandidate, "jobId" | "fit" | "fitMap" | "reasons">;

/**
 * Insert rows as `new`, or refresh the fit, fit map and reasons of a row that is still `new`. A dismissed or applied row is
 * never touched, so a rebuild cannot bring back what the user already dealt with. Returns how many rows were written.
 */
export async function saveShortlistRows(db: Db, userId: string, rows: readonly ShortlistRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const saved = await db.insert(shortlist)
    .values(rows.map((r) => ({ userId, jobId: r.jobId, fit: r.fit, fitMap: r.fitMap, reasons: r.reasons, status: "new" as const })))
    .onConflictDoUpdate({
      target: [shortlist.userId, shortlist.jobId],
      set: { fit: sql`excluded.fit`, fitMap: sql`excluded.fit_map`, reasons: sql`excluded.reasons` },
      setWhere: eq(shortlist.status, "new"),
    })
    .returning({ jobId: shortlist.jobId });
  return saved.length;
}

/**
 * Detailed fit for one user over some candidate jobs, then upsert into `shortlist`. Rows that are dismissed or applied
 * are left exactly as they are; rows that are still new are refreshed.
 */
async function fitAndSave(db: Db, profile: MatchProfile, candidates: CandidateJob[], opts: MatchOptions): Promise<MatchStats> {
  const limit = opts.limit ?? 20;
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  const stats: MatchStats = { considered: candidates.length, candidateIds: candidates.map((c) => c.jobId), withoutSpec: 0, lexical: candidates.filter((c) => c.lexical).length, scored: 0, gated: [], belowMinFit: 0, saved: 0, items: [] };
  const specs = await loadSpecs(db, candidates.map((c) => c.jobId));

  const withSpec = candidates.filter((c) => specs.has(c.jobId));
  stats.withoutSpec = candidates.length - withSpec.length;
  const vectors = await requirementVectors(
    withSpec.flatMap((c) => requirementTexts(buildRequirements(specs.get(c.jobId)!, skills))),
    opts.embedFn ?? ((texts) => embed(texts)),
  );

  const scored: Array<ShortlistCandidate & { title: string; companyName: string | null }> = [];
  for (const c of withSpec) {
    const spec = specs.get(c.jobId)!;
    const gate = checkGates(spec, profile, { title: c.title, location: c.location, remote: c.remote });
    if (!gate.ok) { stats.gated.push({ jobId: c.jobId, reasons: gate.reasons }); continue; }
    const fitLanes = matchingLanes(profile.lanes, c);
    const minFit = Math.min(...(fitLanes.length > 0 ? fitLanes : profile.lanes).map((l) => l.minFit), 1);
    const result = scoreFit({
      spec, points: profile.points, vectors, similarity: c.similarity, experienceYears: profile.experienceYears,
      laneName: fitLanes[0]?.name ?? null, now: opts.now, skills,
    });
    stats.scored++;
    if (result.fit < minFit) { stats.belowMinFit++; continue; }
    scored.push({ jobId: c.jobId, fit: result.fit, fitMap: result.fitMap, reasons: result.reasons, similarity: c.similarity, title: c.title, companyName: c.companyName });
  }
  scored.sort((a, b) => b.fit - a.fit || b.similarity - a.similarity);
  const top = scored.slice(0, limit);

  if (opts.explain) await explainTop(db, profile, top, opts.explain.top ?? 3);

  stats.saved = await saveShortlistRows(db, profile.userId, top);
  stats.items = top.map(({ jobId, fit, fitMap, reasons, similarity }) => ({ jobId, fit, fitMap, reasons, similarity }));
  return stats;
}

// ---- buildShortlist ---------------------------------------------------------------------------------------------------

/**
 * Rebuild one user's shortlist.
 *
 * 1. SQL filter: open, posted (else first seen) within 60 days, company not blocked, fits an enabled lane by title and
 *    location or remote, not already dismissed, applied or in progress.
 * 2. Vector rank by cosine distance to the profile embedding on `job_embeddings`, keep `candidates` (200).
 * 3. Detailed fit on those against the user's career points, gates applied, lane `minFit` honoured, best `limit` saved.
 * 4. Optionally, one small-model "why this fits" line for the top few (`explain`).
 *
 * The planner may serve step 2 from the HNSW index or sort the filtered set exactly; for a user whose lanes narrow the
 * field to a few thousand jobs the second is what happens and the order is exact.
 */
export async function buildShortlist(db: Db, userId: string, opts: BuildShortlistOptions): Promise<MatchStats> {
  const profile = await loadMatchProfile(db, userId, opts.now, opts.skills);
  if (profile.lanes.length === 0 || (opts.profileEmbedding === null && profile.points.length === 0)) return emptyStats(0);
  const limit = opts.candidates ?? 200;
  const fitsUser = and(
    openAndFreshSql(opts.now),
    sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${laneFitsSql()})`,
    notActedOnSql(userId),
  );

  let candidates: CandidateJob[] = [];
  if (opts.profileEmbedding) {
    const distance = cosineDistance(jobEmbeddings.embedding, opts.profileEmbedding);
    const rows = await db
      .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, distance })
      .from(jobs)
      .innerJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(fitsUser)
      .orderBy(asc(distance))
      .limit(limit);
    candidates = rows.map((r) => ({ jobId: r.jobId, title: r.title, location: r.location, remote: r.remote, companyName: r.companyName, similarity: 1 - Number(r.distance) }));
  }
  candidates.push(...await lexicalCandidates(db, profile, fitsUser, opts, limit));
  return fitAndSave(db, profile, candidates, opts);
}

/** How many of the newest spec-without-embedding jobs are scored for lexical ranking. */
const LEXICAL_SCAN_LIMIT = 1000;
/** A lexically ranked job needs at least this pseudo-similarity to be a candidate (the same floor matchNewJobs defaults to). */
const LEXICAL_MIN_SIMILARITY = 0.2;

/**
 * Jobs that passed the SQL filter, have a spec but no embedding, ranked by skill overlap with the user's career points.
 * Jobs with an embedding belong to the vector path; a job with neither is not ranked. Jobs that share nothing with the
 * user are left out.
 */
async function lexicalCandidates(db: Db, profile: MatchProfile, fitsUser: ReturnType<typeof and>, opts: MatchOptions, limit: number): Promise<CandidateJob[]> {
  const rows = await db
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .where(and(isNull(jobEmbeddings.jobId), specExistsSql(), fitsUser))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`))
    .limit(LEXICAL_SCAN_LIMIT);
  return (await rankLexically(db, profile, rows, opts.skills ?? DEFAULT_SKILL_MAP, LEXICAL_MIN_SIMILARITY)).slice(0, limit);
}

type PairRow = Omit<CandidateJob, "similarity" | "lexical">;

/** Candidates with a skill-overlap similarity, best first. Those with no overlap, or below `minSimilarity`, are dropped. */
async function rankLexically(db: Db, profile: MatchProfile, rows: readonly PairRow[], skills: SkillMap, minSimilarity: number): Promise<CandidateJob[]> {
  if (rows.length === 0) return [];
  const specs = await loadSpecs(db, rows.map((r) => r.jobId));
  const lp = lexicalProfile(profile.points, skills);
  const out: CandidateJob[] = [];
  for (const r of rows) {
    const spec = specs.get(r.jobId);
    if (!spec) continue;
    const overlap = lexicalOverlap({ title: r.title, spec }, lp, skills);
    const similarity = lexicalSimilarity(overlap);
    if (overlap > 0 && similarity >= minSimilarity) out.push({ ...r, similarity, lexical: true });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}

const specExistsSql = () => sql`EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id})`;

// ---- matchNewJobs -----------------------------------------------------------------------------------------------------

export type MatchNewJobsOptions = MatchOptions & {
  /**
   * A user is only evaluated for a job when profile and job are at least this similar (cosine similarity of embeddings, or
   * the skill-overlap stand-in for jobs or users without embeddings). Default 0.2.
   */
  minSimilarity?: number;
};

export type MatchNewJobsResult = {
  /** Users with at least one enabled lane that fits at least one of the jobs (and career points to compare). */
  usersEvaluated: number;
  /** User-job pairs whose lanes fit. */
  lanePairs: number;
  /** Pairs that were close enough (in embedding space, or by skill overlap) to get the detailed fit. */
  pairsFitted: number;
  saved: number;
  perUser: Record<string, MatchStats>;
};

/**
 * Match freshly understood jobs to the users they might fit, without touching everyone: SQL pairs each job with the
 * users whose enabled lane fits it (and who have career points), the profile embedding must be close to the job's, and
 * only those pairs get the detailed fit. Work grows with the new jobs and the lanes they fit, not with users x jobs.
 *
 * A job with a spec but no embedding, or a user with no embedded points, is compared by skill overlap instead of
 * embeddings (see lexical.ts), so matching still works while the AI service is unavailable, just less precisely.
 */
export async function matchNewJobs(db: Db, jobIds: readonly string[], opts: MatchNewJobsOptions): Promise<MatchNewJobsResult> {
  const result: MatchNewJobsResult = { usersEvaluated: 0, lanePairs: 0, pairsFitted: 0, saved: 0, perUser: {} };
  if (jobIds.length === 0) return result;

  const pairs = await db
    .selectDistinct({ userId: lanes.userId, jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name })
    .from(jobs)
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(lanes, eq(lanes.enabled, true))
    .where(and(
      inArray(jobs.id, [...jobIds]),
      or(isNotNull(jobEmbeddings.jobId), specExistsSql()),
      openAndFreshSql(opts.now),
      laneFitsSql(),
      sql`EXISTS (SELECT 1 FROM ${careerPoints} WHERE ${careerPoints.userId} = ${lanes.userId})`,
      notActedOnSql(lanes.userId),
    ));
  result.lanePairs = pairs.length;

  const byUser = new Map<string, typeof pairs>();
  for (const p of pairs) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);

  const minSimilarity = opts.minSimilarity ?? 0.2;
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  for (const [userId, userPairs] of byUser) {
    const vec = await meanProfileEmbedding(db, userId);
    const profile = await loadMatchProfile(db, userId, opts.now, opts.skills);
    if (!vec && profile.points.length === 0) continue;
    result.usersEvaluated++;

    // Cosine similarity where both sides have an embedding.
    const similarity = new Map<string, number>();
    if (vec) {
      const distance = cosineDistance(jobEmbeddings.embedding, vec);
      const sims = await db.select({ jobId: jobEmbeddings.jobId, distance }).from(jobEmbeddings)
        .where(inArray(jobEmbeddings.jobId, userPairs.map((p) => p.jobId)));
      for (const s of sims) similarity.set(s.jobId, 1 - Number(s.distance));
    }
    const close: CandidateJob[] = userPairs
      .filter((p) => similarity.has(p.jobId))
      .map((p) => ({ jobId: p.jobId, title: p.title, location: p.location, remote: p.remote, companyName: p.companyName, similarity: similarity.get(p.jobId)! }))
      .filter((c) => c.similarity >= minSimilarity);
    // Everything else is compared by skill overlap.
    close.push(...await rankLexically(db, profile, userPairs.filter((p) => !similarity.has(p.jobId)), skills, minSimilarity));

    result.pairsFitted += close.length;
    if (close.length === 0) { result.perUser[userId] = emptyStats(userPairs.length); continue; }
    const stats = await fitAndSave(db, profile, close, opts);
    result.saved += stats.saved;
    result.perUser[userId] = stats;
  }
  return result;
}

function emptyStats(considered: number): MatchStats {
  return { considered, candidateIds: [], withoutSpec: 0, lexical: 0, scored: 0, gated: [], belowMinFit: 0, saved: 0, items: [] };
}
