import { z } from "zod";
import { AiUnavailableError, complete, embed } from "@norinote/ai";
import {
  and, applications, asc, careerPoints, companies, cosineDistance, desc, eq, freshJobSql, inArray, isNotNull, isNull, jobEmbeddings, jobSpecs, jobs, lanes,
  MAX_JOB_AGE_HOURS, notInArray, or, shortlist, sql, type Db,
} from "@norinote/db";
import { isSkippedCompany } from "@norinote/shared";
import { matchTargetOf, widenedTooFar, type MatchTarget } from "./alignment.js";
import { buildRequirements, relevantYears, requirementTexts, scoreFit, type FitMapItem, type QualityLevel } from "./fit.js";
import { checkGates } from "./gates.js";
import { heuristicSpec } from "./heuristic-spec.js";
import { engineJobSql } from "./engine.js";
import { inlineLanesFitSql, laneFitsSql, locationFitsSql, matchingLanes } from "./lanes.js";
import { lexicalOverlap, lexicalProfile, lexicalSimilarity } from "./lexical.js";
import { applyOutcomeLearning } from "./outcome-learning.js";
import { placeFactor } from "./location.js";
import { loadMatchProfile, meanProfileEmbedding, type MatchProfile } from "./profile.js";
import { rolePool } from "./roles.js";
import { DEFAULT_SKILL_MAP, type SkillMap } from "./skills.js";
import { SPEC_VERSION, type StoredJobSpec } from "./understand.js";
import {
  WIDEN_MIN_FIT, WIDEN_TARGET, loadRemoteExcluded, loadTemporaryLane, widenedReason, wideningPlan, type SimpleLane, type WidenedBy, type WideningStep,
} from "./widen.js";

/** At most this many pages of `candidates` vector-ranked lane jobs are scored before the shortlist widens. */
const LANE_PAGES = 3;
const EMBED_BATCH = 256;
const EMBED_CONCURRENCY = 4;

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
  /**
   * The engine scope (ENGINE_ATS). When set, candidates are the scope's jobs in the person's places (any title, ranked by
   * closeness to their graph and scored on evidence) instead of jobs whose title fits a role; widening is off.
   */
  engineAts?: readonly string[] | null;
};

export type BuildShortlistOptions = MatchOptions & {
  /**
   * Mean of the user's top career point embeddings (graph exports `profileEmbedding`). Null when the user has none (the AI
   * service was unavailable): every job is then ranked by skill overlap instead of vector similarity.
   */
  profileEmbedding: number[] | null;
  /** How many vector-ranked jobs get the detailed fit. Default 200. Up to the same number of lexically ranked jobs (spec, no embedding) may be added. */
  candidates?: number;
  /** Widen the shortlist (adjacent titles, remote, role pool) when the lanes give fewer than 20 candidates. Default true. */
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
  /** How far the spec can be trusted: 1 for a full posting read by the model, down to 0.7 for a job without a description. */
  confidence?: number;
  /** The ranking key: fit x confidence plus a small bonus for fresh postings. */
  rankScore?: number;
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
  /** Length of the posting text (null: unknown). Jobs without one are capped and ranked after described ones. */
  descriptionChars?: number | null;
  /** Posted, else first seen. */
  recency?: Date | null;
};

/** SQL for the columns every candidate query reads besides the basics. */
const descriptionCharsSql = () => sql<number>`length(${jobs.descriptionText})`.mapWith(Number);
const recencySql = () => sql<string>`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`.mapWith((v) => (v == null ? null : new Date(v as string)));

// ---- shared SQL conditions --------------------------------------------------------------------------------------------

/** Open, not blocked, and posted within the last 72 hours (see `freshJobSql`). */
export function openAndFreshSql(now: Date) {
  return and(isNull(jobs.closedAt), eq(companies.blocked, false), freshJobSql(now));
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
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += EMBED_BATCH) batches.push(missing.slice(i, i + EMBED_BATCH));
  // A few batches at a time: one round trip per EMBED_CONCURRENCY batches instead of one per batch.
  for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
    const group = batches.slice(i, i + EMBED_CONCURRENCY);
    let results: number[][][];
    try {
      results = await Promise.all(group.map((b) => embedFn(b)));
    } catch (e) {
      if (e instanceof AiUnavailableError) return out;
      throw e;
    }
    group.forEach((batch, g) => batch.forEach((t, j) => {
      const v = results[g]![j];
      if (!v) return;
      if (vectorCache.size >= VECTOR_CACHE_MAX) vectorCache.clear();
      vectorCache.set(t, v);
      out.set(t, v);
    }));
  }
  return out;
}

/** Forget cached requirement embeddings (tests). */
export function clearRequirementVectorCache(): void {
  vectorCache.clear();
}

// ---- detailed fit and save --------------------------------------------------------------------------------------------

type LoadedSpec = { spec: StoredJobSpec; heuristic: boolean };

async function loadSpecs(db: Db, jobIds: readonly string[]): Promise<Map<string, LoadedSpec>> {
  const out = new Map<string, LoadedSpec>();
  if (jobIds.length === 0) return out;
  const rows = await db.select({ jobId: jobSpecs.jobId, version: jobSpecs.version, spec: jobSpecs.spec, model: jobSpecs.model })
    .from(jobSpecs).where(inArray(jobSpecs.jobId, [...jobIds])).orderBy(asc(jobSpecs.version));
  // Ascending, so the newest version wins. A spec below the current version, or written without a model, is heuristic.
  for (const r of rows) out.set(r.jobId, { spec: r.spec as StoredJobSpec, heuristic: r.model === "heuristic" || r.version < SPEC_VERSION });
  return out;
}

// ---- ranking ----------------------------------------------------------------------------------------------------------

/** At most this much is added to the ranking key of a job posted just now, nothing at the 72-hour limit. */
const RECENCY_BONUS = 0.03;
const RECENCY_HOURS = MAX_JOB_AGE_HOURS;

/** fit x confidence plus a small bonus for fresh postings. */
export function rankScore(fit: number, confidence: number, recency: Date | null | undefined, now: Date): number {
  const age = recency ? Math.max(0, (now.getTime() - recency.getTime()) / 3_600_000) : RECENCY_HOURS;
  return Math.round((fit * confidence + RECENCY_BONUS * Math.max(0, 1 - age / RECENCY_HOURS)) * 10000) / 10000;
}

/** Jobs with a real spec (read by the model from a real posting) come before the rest, whatever their score. */
const wellSpecified = (q: QualityLevel) => q === "full" || q === "thin";

type Rankable = { rankScore?: number; fit: number; similarity: number; quality?: QualityLevel };

/** Well-specified first, then by ranking key, fit and similarity. */
export function byRank(a: Rankable, b: Rankable): number {
  const qa = a.quality ? Number(wellSpecified(a.quality)) : 1;
  const qb = b.quality ? Number(wellSpecified(b.quality)) : 1;
  return qb - qa || (b.rankScore ?? b.fit) - (a.rankScore ?? a.fit) || b.fit - a.fit || b.similarity - a.similarity;
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

type ScoredItem = ShortlistCandidate & { title: string; companyName: string | null; quality?: QualityLevel; recency?: Date | null };

type ScoreOptions = {
  /** The profile the gates run against when the lanes in force differ from `profile.lanes` (temporary and widened lanes). */
  gateProfile?: MatchProfile;
  /**
   * Widening: instead of the lane minimum, a candidate must clear the widening floor (`WIDEN_MIN_FIT`, or a lower lane
   * minimum the user chose). A candidate that fits the user's own lanes and is fresh enough to be a lane match still needs
   * the lane minimum: widening never re-admits a lane job under a lower bar. Gates still apply.
   */
  widened?: boolean;
  /** Widening: a job without a stored spec is read with the heuristic spec in memory, and candidates flagged `rankLexically` get a skill-overlap similarity. */
  heuristic?: boolean;
};

type ScoreResult = {
  scored: ScoredItem[]; withoutSpec: number; gated: Array<{ jobId: string; reasons: string[] }>; belowMinFit: number; scoredCount: number;
  /** Candidates that were scored but fell below the bar: widening must not bring them back. */
  belowMinFitIds: string[];
};

/** Gates, then the detailed fit, for each candidate. Nothing is saved. Sorted well-specified first, then by `rankScore`. */
async function scoreCandidates(db: Db, profile: MatchProfile, candidates: CandidateJob[], opts: MatchOptions, so: ScoreOptions = {}): Promise<ScoreResult> {
  const skills = opts.skills ?? DEFAULT_SKILL_MAP;
  const gateProfile = so.gateProfile ?? profile;
  const target: MatchTarget = matchTargetOf(profile, opts.now);
  const stored = await loadSpecs(db, candidates.map((c) => c.jobId));
  const specs = new Map<string, LoadedSpec>();
  for (const c of candidates) {
    const spec = stored.get(c.jobId)
      ?? (so.heuristic ? { spec: heuristicSpec({ title: c.title, descriptionText: c.description ?? "", location: c.location, remote: c.remote }, skills), heuristic: true } : undefined);
    if (spec) specs.set(c.jobId, spec);
  }
  const out: ScoreResult = { scored: [], withoutSpec: 0, gated: [], belowMinFit: 0, scoredCount: 0, belowMinFitIds: [] };
  const withSpec = candidates.filter((c) => specs.has(c.jobId));
  out.withoutSpec = candidates.length - withSpec.length;
  // Gates first: requirement texts are embedded only for jobs that can reach the shortlist.
  const passed: CandidateJob[] = [];
  for (const c of withSpec) {
    if (profile.skipCompanies && isSkippedCompany(profile.skipCompanies, c.companyName)) { out.gated.push({ jobId: c.jobId, reasons: ["A company you skip"] }); continue; }
    const gate = checkGates(specs.get(c.jobId)!.spec, gateProfile, { title: c.title, location: c.location, remote: c.remote }, { now: opts.now });
    if (gate.ok) passed.push(c);
    else out.gated.push({ jobId: c.jobId, reasons: gate.reasons });
  }
  const vectors = await requirementVectors(
    passed.flatMap((c) => requirementTexts(buildRequirements(specs.get(c.jobId)!.spec, skills))),
    opts.embedFn ?? ((texts) => embed(texts)),
  );
  const lp = passed.some((c) => c.rankLexically) ? lexicalProfile(profile.points, skills) : null;
  const laneFloor = Math.min(...profile.lanes.map((l) => l.minFit), 1);
  const widenFloor = Math.min(WIDEN_MIN_FIT, laneFloor);
  const freshSince = opts.now.getTime() - MAX_JOB_AGE_HOURS * 3_600_000;

  for (const c of passed) {
    const { spec, heuristic } = specs.get(c.jobId)!;
    const fitLanes = matchingLanes(gateProfile.lanes, c);
    let minFit: number;
    if (so.widened) {
      const ownLanes = matchingLanes(profile.lanes, c);
      const laneJob = ownLanes.length > 0 && (c.recency == null || c.recency.getTime() >= freshSince);
      minFit = laneJob ? Math.min(...ownLanes.map((l) => l.minFit)) : widenFloor;
      // Widened rows only: nothing more than one level above the user, nothing from another function without a shared core word.
      if (!laneJob && widenedTooFar(c.title, spec, target, relevantYears(profile.points, c.title, opts.now, profile.experienceYears))) {
        out.belowMinFit++;
        out.belowMinFitIds.push(c.jobId);
        continue;
      }
    } else {
      minFit = Math.min(...(fitLanes.length > 0 ? fitLanes : gateProfile.lanes).map((l) => l.minFit), 1);
    }
    const similarity = c.rankLexically && lp ? lexicalSimilarity(lexicalOverlap({ title: c.title, spec }, lp, skills)) : c.similarity;
    const descriptionChars = c.descriptionChars ?? (c.description != null ? c.description.length : null);
    const result = scoreFit({
      spec, points: profile.points, vectors, similarity, experienceYears: profile.experienceYears,
      laneName: fitLanes[0]?.name ?? null, now: opts.now, skills,
      jobTitle: c.title, target, quality: { heuristic, descriptionChars }, placeFactor: placeFactor(c.location, c.remote), resumeText: profile.resumeText,
    });
    out.scoredCount++;
    if (result.fit < minFit) { out.belowMinFit++; out.belowMinFitIds.push(c.jobId); continue; }
    out.scored.push({
      jobId: c.jobId, fit: result.fit, fitMap: result.fitMap, reasons: result.reasons, similarity, title: c.title, companyName: c.companyName,
      confidence: result.confidence, quality: result.components.quality, recency: c.recency ?? null,
      rankScore: rankScore(result.fit, result.confidence, c.recency, opts.now),
    });
  }
  // Outcome learning (outcome-learning.ts): a capped per-user nudge from the user's replies, after the gates and the lane minimum.
  await applyOutcomeLearning(db, profile.userId, out.scored, (jobId) => specs.get(jobId)?.spec.seniority, opts.now);
  out.scored.sort(byRank);
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
  stats.items = top.map(({ jobId, fit, fitMap, reasons, similarity, confidence, rankScore }) => ({ jobId, fit, fitMap, reasons, similarity, confidence, rankScore }));
  return stats;
}

// ---- buildShortlist ---------------------------------------------------------------------------------------------------

/**
 * Rebuild one user's shortlist.
 *
 * 1. SQL filter: open, posted within 72 hours (`freshJobSql`), company not blocked, fits an enabled lane by title and
 *    location or remote, not already dismissed, applied or in progress. A user with no lane yet gets a temporary one from
 *    their most recent role and their location.
 * 2. Vector rank by cosine distance to the profile embedding on `job_embeddings`, keep `candidates` (200); when fewer than
 *    `limit` of those pass, score the next pages (up to 3) before widening.
 * 3. Detailed fit on those against the user's career points, gates applied, lane `minFit` honoured, best `limit` saved.
 * 4. Fewer than 20 shortlist candidates: widen (see widen.ts): adjacent titles, remote, the role-family pool (never older jobs).
 *    Widened candidates get the same fit and must clear `WIDEN_MIN_FIT`; lane jobs that failed the gates or the lane
 *    minimum are never brought back. Each widened row carries a `widened:<step>` reason. Rows widened by an earlier run
 *    and not chosen now are removed.
 * Order: lane matches first, then widened rows; within each, jobs with a real spec (read by the model from a posting)
 * before the rest, then by `rankScore` (fit x confidence plus a small bonus for fresh postings).
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
  const engine = engineJobSql(opts.engineAts);
  // Engine scope: the person's places decide, not title words; closeness to their graph ranks and evidence scores.
  const laneFilter = temporary
    ? inlineLanesFitSql(profile.lanes)
    : sql`EXISTS (SELECT 1 FROM ${lanes} WHERE ${lanes.userId} = ${userId} AND ${lanes.enabled} AND ${engine ? locationFitsSql() : laneFitsSql()})`;
  const fitsUser = and(openAndFreshSql(opts.now), laneFilter, engine, notActedOnSql(userId));

  const vectorPage = async (offset: number): Promise<CandidateJob[]> => {
    if (!opts.profileEmbedding) return [];
    const distance = cosineDistance(jobEmbeddings.embedding, opts.profileEmbedding);
    const rows = await db
      .select({
        jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, distance,
        descriptionChars: descriptionCharsSql(), recency: recencySql(),
      })
      .from(jobs)
      .innerJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(fitsUser)
      .orderBy(asc(distance), jobs.id)
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      jobId: r.jobId, title: r.title, location: r.location, remote: r.remote, companyName: r.companyName, similarity: 1 - Number(r.distance),
      descriptionChars: r.descriptionChars, recency: r.recency,
    }));
  };
  const maxRows = opts.limit ?? 20;
  let page = await vectorPage(0);
  const candidates: CandidateJob[] = [...page, ...await lexicalCandidates(db, profile, fitsUser, opts, limit)];
  const base = await scoreCandidates(db, profile, candidates, opts);
  // Many lane jobs but most of a full page rejected (a new grad among senior roles): read the next pages before widening.
  const mostlyRejected = (r: ScoreResult, n: number) => r.gated.length + r.belowMinFit >= n / 2;
  let last: ScoreResult = base;
  let lastN = candidates.length;
  for (let pages = 1; base.scored.length < maxRows && page.length === limit && mostlyRejected(last, lastN) && pages < LANE_PAGES; pages++) {
    page = await vectorPage(pages * limit);
    if (page.length === 0) break;
    candidates.push(...page);
    const more = await scoreCandidates(db, profile, page, opts);
    last = more;
    lastN = page.length;
    base.scored = [...base.scored, ...more.scored].sort(byRank);
    base.gated.push(...more.gated);
    base.belowMinFitIds.push(...more.belowMinFitIds);
    base.belowMinFit += more.belowMinFit;
    base.withoutSpec += more.withoutSpec;
    base.scoredCount += more.scoredCount;
  }

  const stats = newStats(candidates);
  stats.temporaryLane = temporary;
  stats.withoutSpec = base.withoutSpec;
  stats.scored = base.scoredCount;
  stats.gated = base.gated;
  stats.belowMinFit = base.belowMinFit;
  const items: ScoredItem[] = base.scored.slice(0, maxRows);
  stats.laneMatches = items.length;

  const widenedItems: Array<ScoredItem & { widenedBy: WidenedBy }> = [];
  const target = Math.min(WIDEN_TARGET, maxRows);
  if (opts.widen !== false && items.length < target) {
    // Everything the lanes already produced, gated out or scored below the lane minimum stays out of the widened list.
    const seen = new Set<string>([...items.map((i) => i.jobId), ...base.gated.map((g) => g.jobId), ...base.belowMinFitIds]);
    widenedItems.push(...await widenShortlist(db, userId, profile, opts, {
      seen, have: items.length, target, roleKeys: new Set(items.map((i) => roleKey(i.companyName, i.title))), gated: stats.gated,
    }));
  }
  // Lane matches first, then widened rows, each in rank order (`stats.widened` keeps the ladder order).
  const all: ScoredItem[] = [...items, ...[...widenedItems].sort(byRank)];
  if (opts.explain) await explainTop(db, profile, all, opts.explain.top ?? 3);
  for (const w of widenedItems) w.reasons = [...w.reasons, widenedReason(w.widenedBy)];

  stats.saved = await saveShortlistRows(db, userId, all);
  await removeStaleWidened(db, userId, all.map((i) => i.jobId));
  stats.widened = widenedItems.map((w) => ({ jobId: w.jobId, by: w.widenedBy }));
  stats.poolUsed = widenedItems.some((w) => w.widenedBy === "role_pool");
  stats.items = all.map((i) => ({
    jobId: i.jobId, fit: i.fit, fitMap: i.fitMap, reasons: i.reasons, similarity: i.similarity,
    widenedBy: (i as { widenedBy?: WidenedBy }).widenedBy ?? null, confidence: i.confidence, rankScore: i.rankScore,
  }));
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
 * with the same fit (a job without a spec is read with the heuristic spec), drops those below the widening floor and keeps
 * the best few (well-specified first, then by rank score) that bring the list up to the target.
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
    const r = await scoreCandidates(db, profile, candidates, opts, { gateProfile, widened: true, heuristic: true });
    for (const g of r.gated) { st.seen.add(g.jobId); st.gated.push(g); }
    for (const id of r.belowMinFitIds) st.seen.add(id);
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
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, description: sql<string>`left(${jobs.descriptionText}, 12000)`, distance, descriptionChars: descriptionCharsSql(), recency: recencySql() })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .where(and(
      openAndFreshSql(opts.now), inlineLanesFitSql(step.lanes), notActedOnSql(userId),
      seen.size > 0 ? notInArray(jobs.id, [...seen]) : undefined,
    ))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), jobs.id)
    .limit(WIDEN_SCAN);
  return rows.map(widenCandidate);
}

/** The role-family pool for the user's main family and metro, minus what was already considered or acted on. */
async function poolCandidates(db: Db, userId: string, step: WideningStep, opts: BuildShortlistOptions, seen: ReadonlySet<string>): Promise<CandidateJob[]> {
  const pool = step.pool!;
  const members = await rolePool(db, { family: pool.family, metro: pool.metro, remote: pool.remote, limit: WIDEN_POOL_SIZE, now: opts.now });
  const ids = members.map((m) => m.jobId).filter((id) => !seen.has(id));
  if (ids.length === 0) return [];
  const distance = opts.profileEmbedding ? cosineDistance(jobEmbeddings.embedding, opts.profileEmbedding) : sql<null>`null`;
  // Same filters as the pool plus the user's own: the pool is shared and cached, so it may hold a job closed or acted on since.
  const rows = await db
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, description: sql<string>`left(${jobs.descriptionText}, 12000)`, distance, descriptionChars: descriptionCharsSql(), recency: recencySql() })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .where(and(inArray(jobs.id, ids.slice(0, WIDEN_POOL_SIZE)), openAndFreshSql(opts.now), notActedOnSql(userId)));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0)).slice(0, WIDEN_SCAN).map(widenCandidate);
}

type WidenRow = {
  jobId: string; title: string; location: string | null; remote: boolean; companyName: string | null; description: string; distance: unknown;
  descriptionChars: number | null; recency: Date | null;
};

function widenCandidate(r: WidenRow): CandidateJob {
  const hasVector = r.distance !== null && r.distance !== undefined;
  return {
    jobId: r.jobId, title: r.title, location: r.location, remote: r.remote, companyName: r.companyName, description: r.description,
    descriptionChars: r.descriptionChars, recency: r.recency,
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
    .select({ jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name, descriptionChars: descriptionCharsSql(), recency: recencySql() })
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
    const spec = specs.get(r.jobId)?.spec;
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
    .selectDistinct({
      userId: lanes.userId, jobId: jobs.id, title: jobs.title, location: jobs.location, remote: jobs.remote, companyName: companies.name,
      descriptionChars: descriptionCharsSql(), recency: recencySql(),
    })
    .from(jobs)
    .leftJoin(jobEmbeddings, eq(jobEmbeddings.jobId, jobs.id))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .innerJoin(lanes, eq(lanes.enabled, true))
    .where(and(
      inArray(jobs.id, [...jobIds]),
      or(isNotNull(jobEmbeddings.jobId), specExistsSql()),
      openAndFreshSql(opts.now),
      engineJobSql(opts.engineAts) ? and(engineJobSql(opts.engineAts), locationFitsSql()) : laneFitsSql(),
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
      .map((p) => ({
        jobId: p.jobId, title: p.title, location: p.location, remote: p.remote, companyName: p.companyName, similarity: similarity.get(p.jobId)!,
        descriptionChars: p.descriptionChars, recency: p.recency,
      }))
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
