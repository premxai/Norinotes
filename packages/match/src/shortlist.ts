import { z } from "zod";
import { AiUnavailableError, complete, embed } from "@norinote/ai";
import {
  and, applications, asc, careerPoints, companies, cosineDistance, desc, eq, inArray, isNotNull, isNull, jobEmbeddings, jobSpecs, jobs, lanes, notInArray, or,
  shortlist, sql, type Db,
} from "@norinote/db";
import { buildRequirements, requirementTexts, scoreFit, type FitMapItem } from "./fit.js";
import { checkGates } from "./gates.js";
import { heuristicSpec } from "./heuristic-spec.js";
import { inlineLanesFitSql, laneFitsSql, matchingLanes } from "./lanes.js";
import { lexicalOverlap, lexicalProfile, lexicalSimilarity } from "./lexical.js";
import { loadMatchProfile, meanProfileEmbedding, type MatchProfile } from "./profile.js";
import { rolePool } from "./roles.js";
import { DEFAULT_SKILL_MAP, type SkillMap } from "./skills.js";
import type { StoredJobSpec } from "./understand.js";
import {
  WIDEN_TARGET, loadRemoteExcluded, loadTemporaryLane, widenedReason, wideningPlan, type SimpleLane, type WidenedBy, type WideningStep,
} from "./widen.js";

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
  /** Widen the shortlist (adjacent titles, remote, older, role pool) when the lanes give fewer than 20 candidates. Default true. */
  widen?: boolean;
};

export type ShortlistCandidate = {
  jobId: string;
  fit: number;
  fitMap: FitMapItem[];
  reasons: string[];
  /** Cosine similarity between the profile and the job. */
  similarity: number;
  /** Set when the job is here because the shortlist was widened (it does not fit the user's lanes as written). */
  widenedBy?: WidenedBy | null;
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
  /** Shortlist candidates the lanes themselves produced (after gates and minimum fit), before any widening. */
  laneMatches: number;
  /** The jobs added by widening, in ladder order. */
  widened: Array<{ jobId: string; by: WidenedBy }>;
  /** True when the role-family pool contributed. */
  poolUsed: boolean;
  /** True when the user had no lane and one was derived from their career points. */
  temporaryLane: boolean;
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
  /** Widening only: the posting text (for a heuristic spec when the job has none) and whether similarity is still to be computed by skill overlap. */
  description?: string;
  rankLexically?: boolean;
};

// ---- shared SQL conditions --------------------------------------------------------------------------------------------

/** Open, not blocked, and posted (or first seen) within the last 60 days (or `maxAgeDays`). */
export function openAndFreshSql(now: Date, maxAgeDays: number = SHORTLIST_MAX_AGE_DAYS) {
  const since = new Date(now.getTime() - maxAgeDays * DAY_MS).toISOString();
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

type ScoredItem = ShortlistCandidate & { title: string; companyName: string | null };

type ScoreOptions = {
  /** The profile the gates run against when the lanes in force differ from `profile.lanes` (temporary and widened lanes). */
  gateProfile?: MatchProfile;
  /** Widening: no lane minimum fit (the ladder fills the list up to a target). Gates still apply. */
  ignoreMinFit?: boolean;
  /** Widening: a job without a stored spec is read with the heuristic spec in memory, and candidates flagged `rankLexically` get a skill-overlap similarity. */
  heuristic?: boolean;
};

type ScoreResult = { scored: ScoredItem[]; withoutSpec: number; gated: Array<{ jobId: string; reasons: string[] }>; belowMinFit: number; scoredCount: number };

/** Gates, then the detailed fit, for each candidate. Nothing is saved. */
async function scoreCandidates(db: Db, profile: MatchProfile, candidates: CandidateJob[], opts: MatchOptions, so: ScoreOptions = {}): Promise<ScoreResult> {
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  const gateProfile = so.gateProfile ?? profile;
  const stored = await loadSpecs(db, candidates.map((c) => c.jobId));
  const specs = new Map<string, StoredJobSpec>();
  for (const c of candidates) {
    const spec = stored.get(c.jobId) ?? (so.heuristic ? heuristicSpec({ title: c.title, descriptionText: c.description ?? "", location: c.location, remote: c.remote }, skills) : undefined);
    if (spec) specs.set(c.jobId, spec);
  }
  const out: ScoreResult = { scored: [], withoutSpec: 0, gated: [], belowMinFit: 0, scoredCount: 0 };
  const withSpec = candidates.filter((c) => specs.has(c.jobId));
  out.withoutSpec = candidates.length - withSpec.length;
  const vectors = await requirementVectors(
    withSpec.flatMap((c) => requirementTexts(buildRequirements(specs.get(c.jobId)!, skills))),
    opts.embedFn ?? ((texts) => embed(texts)),
  );
  const lp = withSpec.some((c) => c.rankLexically) ? lexicalProfile(profile.points, skills) : null;

  for (const c of withSpec) {
    const spec = specs.get(c.jobId)!;
    const gate = checkGates(spec, gateProfile, { title: c.title, location: c.location, remote: c.remote });
    if (!gate.ok) { out.gated.push({ jobId: c.jobId, reasons: gate.reasons }); continue; }
    const fitLanes = matchingLanes(gateProfile.lanes, c);
    const minFit = so.ignoreMinFit ? 0 : Math.min(...(fitLanes.length > 0 ? fitLanes : gateProfile.lanes).map((l) => l.minFit), 1);
    const similarity = c.rankLexically && lp ? lexicalSimilarity(lexicalOverlap({ title: c.title, spec }, lp, skills)) : c.similarity;
    const result = scoreFit({
      spec, points: profile.points, vectors, similarity, experienceYears: profile.experienceYears,
      laneName: fitLanes[0]?.name ?? null, now: opts.now, skills,
    });
    out.scoredCount++;
    if (result.fit < minFit) { out.belowMinFit++; continue; }
    out.scored.push({ jobId: c.jobId, fit: result.fit, fitMap: result.fitMap, reasons: result.reasons, similarity, title: c.title, companyName: c.companyName });
  }
  out.scored.sort((a, b) => b.fit - a.fit || b.similarity - a.similarity);
  return out;
}

function newStats(candidates: CandidateJob[]): MatchStats {
  return {
    considered: candidates.length, candidateIds: candidates.map((c) => c.jobId), withoutSpec: 0, lexical: candidates.filter((c) => c.lexical).length, scored: 0,
    gated: [], belowMinFit: 0, saved: 0, items: [], laneMatches: 0, widened: [], poolUsed: false, temporaryLane: false,
  };
}

/**
 * Detailed fit for one user over some candidate jobs, then upsert into `shortlist`. Rows that are dismissed or applied
 * are left exactly as they are; rows that are still new are refreshed.
 */
async function fitAndSave(db: Db, profile: MatchProfile, candidates: CandidateJob[], opts: MatchOptions): Promise<MatchStats> {
  const limit = opts.limit ?? 20;
  const stats = newStats(candidates);
  const r = await scoreCandidates(db, profile, candidates, opts);
  stats.withoutSpec = r.withoutSpec;
  stats.scored = r.scoredCount;
  stats.gated = r.gated;
  stats.belowMinFit = r.belowMinFit;
  const top = r.scored.slice(0, limit);
  stats.laneMatches = top.length;

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
 *    location or remote, not already dismissed, applied or in progress. A user with no lane yet gets a temporary one from
 *    their most recent role and their location.
 * 2. Vector rank by cosine distance to the profile embedding on `job_embeddings`, keep `candidates` (200).
 * 3. Detailed fit on those against the user's career points, gates applied, lane `minFit` honoured, best `limit` saved.
 * 4. Fewer than 20 shortlist candidates: widen (see widen.ts): adjacent titles, remote, up to 90 days, the role-family pool.
 *    Each widened row carries a `widened:<step>` reason. Rows widened by an earlier run and not chosen now are removed.
 * 5. Optionally, one small-model "why this fits" line for the top few (`explain`).
 *
 * The planner may serve step 2 from the HNSW index or sort the filtered set exactly; for a user whose lanes narrow the
 * field to a few thousand jobs the second is what happens and the order is exact.
 */
export async function buildShortlist(db: Db, userId: string, opts: BuildShortlistOptions): Promise<MatchStats> {
  const loaded = await loadMatchProfile(db, userId, opts.now, opts.skills);
  let temporary = false;
  let profile = loaded;
  if (loaded.lanes.length === 0) {
    const lane = await loadTemporaryLane(db, userId, opts.now);
    if (lane) { temporary = true; profile = { ...loaded, lanes: [lane] }; }
  }
  if (profile.lanes.length === 0 || (opts.profileEmbedding === null && profile.points.length === 0)) return emptyStats(0);
  const limit = opts.candidates ?? 200;
  const laneFilter = temporary
    ? inlineLanesFitSql(profile.lanes)
    : sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${laneFitsSql()})`;
  const fitsUser = and(openAndFreshSql(opts.now), laneFilter, notActedOnSql(userId));

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

  const stats = newStats(candidates);
  stats.temporaryLane = temporary;
  const base = await scoreCandidates(db, profile, candidates, opts);
  stats.withoutSpec = base.withoutSpec;
  stats.scored = base.scoredCount;
  stats.gated = base.gated;
  stats.belowMinFit = base.belowMinFit;
  const maxRows = opts.limit ?? 20;
  const items: ScoredItem[] = base.scored.slice(0, maxRows);
  stats.laneMatches = items.length;

  const widenedItems: Array<ScoredItem & { widenedBy: WidenedBy }> = [];
  const target = Math.min(WIDEN_TARGET, maxRows);
  if (opts.widen !== false && items.length < target) {
    const seen = new Set<string>([...items.map((i) => i.jobId), ...base.gated.map((g) => g.jobId)]);
    widenedItems.push(...await widenShortlist(db, userId, profile, opts, {
      seen, have: items.length, target, roleKeys: new Set(items.map((i) => roleKey(i.companyName, i.title))), gated: stats.gated,
    }));
  }
  const all: ScoredItem[] = [...items, ...widenedItems];
  if (opts.explain) await explainTop(db, profile, all, opts.explain.top ?? 3);
  for (const w of widenedItems) w.reasons = [...w.reasons, widenedReason(w.widenedBy)];

  stats.saved = await saveShortlistRows(db, userId, all);
  await removeStaleWidened(db, userId, all.map((i) => i.jobId));
  stats.widened = widenedItems.map((w) => ({ jobId: w.jobId, by: w.widenedBy }));
  stats.poolUsed = widenedItems.some((w) => w.widenedBy === "role_pool");
  stats.items = all.map((i) => ({ jobId: i.jobId, fit: i.fit, fitMap: i.fitMap, reasons: i.reasons, similarity: i.similarity, widenedBy: (i as { widenedBy?: WidenedBy }).widenedBy ?? null }));
  return stats;
}

// ---- the widening ladder ----------------------------------------------------------------------------------------------

/** Per step: how many candidate jobs are read and scored. */
const WIDEN_SCAN = 150;
/** Pool jobs requested per step; the pool is cached for an hour, so the size costs one query per hour and key. */
const WIDEN_POOL_SIZE = 300;

const roleKey = (company: string | null, title: string) => `${(company ?? "").toLowerCase().trim()}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

type WidenState = { seen: Set<string>; have: number; target: number; roleKeys: Set<string>; gated: Array<{ jobId: string; reasons: string[] }> };

/**
 * Walks the ladder until `target` shortlist candidates exist. Each step reads more jobs than the one before it
 * allowed (never ones the user dismissed, applied to or that were already considered), runs the same gates, scores them
 * (a job without a spec is read with the heuristic spec) and keeps the best few that bring the list up to the target.
 * The same company and role posted in several places counts once.
 */
async function widenShortlist(db: Db, userId: string, profile: MatchProfile, opts: BuildShortlistOptions, st: WidenState): Promise<Array<ScoredItem & { widenedBy: WidenedBy }>> {
  const out: Array<ScoredItem & { widenedBy: WidenedBy }> = [];
  const remoteExcluded = await loadRemoteExcluded(db, userId);
  const lastRole = [...profile.points].filter((p) => p.kind === "role").sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999") || (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
  const plan = wideningPlan(profile.lanes, { remoteExcluded, extraTitles: lastRole ? [lastRole.title] : [] });

  for (const step of plan) {
    const need = st.target - st.have - out.length;
    if (need <= 0) break;
    const candidates = step.pool
      ? await poolCandidates(db, userId, step, opts, st.seen)
      : await laneCandidates(db, userId, step, opts, st.seen);
    if (candidates.length === 0) continue;

    const gateLanes: SimpleLane[] = step.pool ? [{ titles: [], locations: step.pool.metro ? [step.pool.metro] : [], remote: step.pool.remote }] : step.lanes;
    const gateProfile: MatchProfile = { ...profile, lanes: gateLanes.map((l, i) => ({ id: `widen-${i}`, name: profile.lanes[0]?.name ?? "widened", minFit: 0, ...l, enabled: true })) };
    const r = await scoreCandidates(db, profile, candidates, opts, { gateProfile, ignoreMinFit: true, heuristic: true });
    for (const g of r.gated) { st.seen.add(g.jobId); st.gated.push(g); }
    for (const s of r.scored) {
      if (out.length + st.have >= st.target) break;
      const key = roleKey(s.companyName, s.title);
      if (st.roleKeys.has(key)) continue;
      st.roleKeys.add(key);
      st.seen.add(s.jobId);
      out.push({ ...s, widenedBy: step.by });
    }
  }
  return out;
}

/** Jobs that fit the step's lanes within its age limit, newest first, with a similarity where an embedding exists. */
async function laneCandidates(db: Db, userId: string, step: WideningStep, opts: BuildShortlistOptions, seen: ReadonlySet<string>): Promise<CandidateJob[]> {
  const distance = opts.profileEmbedding ? cosineDistance(jobEmbeddings.embedding, opts.profileEmbedding) : sql<null>`null`;
  const rows = await db
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, description: sql<string>`left(${jobs.descriptionText}, 12000)`, distance })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .where(and(
      openAndFreshSql(opts.now, step.maxAgeDays), inlineLanesFitSql(step.lanes), notActedOnSql(userId),
      seen.size > 0 ? notInArray(jobs.id, [...seen]) : undefined,
    ))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), jobs.id)
    .limit(WIDEN_SCAN);
  return rows.map(widenCandidate);
}

/** The role-family pool for the user's main family and metro, minus what was already considered or acted on. */
async function poolCandidates(db: Db, userId: string, step: WideningStep, opts: BuildShortlistOptions, seen: ReadonlySet<string>): Promise<CandidateJob[]> {
  const pool = step.pool!;
  const members = await rolePool(db, { family: pool.family, metro: pool.metro, remote: pool.remote, limit: WIDEN_POOL_SIZE, now: opts.now, maxAgeDays: step.maxAgeDays });
  const ids = members.map((m) => m.jobId).filter((id) => !seen.has(id));
  if (ids.length === 0) return [];
  const distance = opts.profileEmbedding ? cosineDistance(jobEmbeddings.embedding, opts.profileEmbedding) : sql<null>`null`;
  // Same filters as the pool plus the user's own: the pool is shared and cached, so it may hold a job closed or acted on since.
  const rows = await db
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, description: sql<string>`left(${jobs.descriptionText}, 12000)`, distance })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .where(and(inArray(jobs.id, ids.slice(0, WIDEN_POOL_SIZE)), openAndFreshSql(opts.now, step.maxAgeDays), notActedOnSql(userId)));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0)).slice(0, WIDEN_SCAN).map(widenCandidate);
}

function widenCandidate(r: { jobId: string; title: string; location: string | null; remote: boolean; companyName: string | null; description: string; distance: unknown }): CandidateJob {
  const hasVector = r.distance !== null && r.distance !== undefined;
  return {
    jobId: r.jobId, title: r.title, location: r.location, remote: r.remote, companyName: r.companyName, description: r.description,
    similarity: hasVector ? 1 - Number(r.distance) : 0, ...(hasVector ? {} : { rankLexically: true }),
  };
}

/** Widened rows from an earlier run that this run did not choose again: the lanes may match by now, or the jobs are gone. */
async function removeStaleWidened(db: Db, userId: string, keepJobIds: readonly string[]): Promise<void> {
  await db.delete(shortlist).where(and(
    eq(shortlist.userId, userId),
    eq(shortlist.status, "new"),
    sql`EXISTS (SELECT 1 FROM unnest(${shortlist.reasons}) AS r WHERE r LIKE 'widened:%')`,
    keepJobIds.length > 0 ? notInArray(shortlist.jobId, [...keepJobIds]) : undefined,
  ));
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
  return { considered, candidateIds: [], withoutSpec: 0, lexical: 0, scored: 0, gated: [], belowMinFit: 0, saved: 0, items: [], laneMatches: 0, widened: [], poolUsed: false, temporaryLane: false };
}
