/**
 * Matching-quality eval. For each fictional profile: create a user in a COPY of the collected-jobs database, build the career
 * graph from the resume with the real model, set lanes and profile, understand the lane-fitting jobs (capped), build the
 * shortlist with widening on, have an LLM judge score the top 20, and write metrics.
 *
 *   npx tsx scripts/eval/run.mts [--db <pglite dir>] [--cap 250] [--top 20] [--only id,id] [--plan] [--skip-judge]
 *                                [--budget 9] [--out docs/eval/matching-baseline.md] [--json scripts/eval/results/baseline.json]
 *
 * Never point --db at the original collection: copy it first (cp -r /tmp/norinote-cov /tmp/norinote-eval). Spend is tracked in
 * scripts/eval/results/spend-ledger.json across runs and the run stops when the next call would pass --budget (default 9 USD,
 * or EVAL_BUDGET_USD). Reruns are cheap: specs and embeddings stay in the database copy and judgments are cached.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  and, asc, careerPoints, companies, connect, desc, eq, isNull, jobEmbeddings, jobSpecs, jobs, lanes as lanesTable, loadDotEnv, migrate,
  profiles as profilesTable, shortlist, sql, users, type Db,
} from "@norinote/db";
import { fillJobDescription } from "@norinote/ingest";
import { AiUnavailableError, embeddingModel, getProvider, modelFor, setProvider } from "@norinote/ai";
import { buildCareerPoints, embedCareerPoints, profileEmbedding } from "@norinote/graph";
import { SPEC_VERSION, buildShortlist, inlineLanesFitSql, openAndFreshSql, understandJob, widenedByOf, withoutWidenedReasons } from "@norinote/match";
import { BudgetStopError, Ledger, instrumentProvider } from "./lib/spend.js";
import { JUDGE_VERSION, JudgmentCache, judgeJob, type JudgeJob, type JudgeProfile } from "./lib/judge.js";
import { duplicateFlags, overallMetrics, profileMetrics, type ReasonCode } from "./lib/metrics.js";
import { renderReport, type EvalResults } from "./lib/report.js";
import { pool, sleep } from "./lib/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const dbDir = path.resolve(opt("db", path.join(os.tmpdir(), "norinote-eval"))!);
const CAP = Number(opt("cap", "250"));
const TOP = Number(opt("top", "20"));
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const planOnly = flag("plan");
const skipJudge = flag("skip-judge");
const budgetUsd = Number(opt("budget", process.env.EVAL_BUDGET_USD ?? "9"));
const outMd = path.resolve(root, opt("out", "docs/eval/matching-baseline.md")!);
const outJson = path.resolve(root, opt("json", "scripts/eval/results/baseline.json")!);
const UNDERSTAND_CONCURRENCY = Number(opt("understand-concurrency", "6"));
const JUDGE_CONCURRENCY = 4;
const FILL_CONCURRENCY = 3;
const FILL_PAUSE_MS = 250;

if (/norinote-cov\b/.test(dbDir)) throw new Error("Refusing to run on the original collection (norinote-cov). Copy it to norinote-eval first.");
process.env.AI_DAILY_TOKEN_BUDGET = "0"; // the ledger below is the budget for this run

const ledger = new Ledger(path.join(here, "results", "spend-ledger.json"), budgetUsd);
if (!planOnly) {
  const real = getProvider();
  if (real.name !== "openai") throw new Error("OPENAI_API_KEY is not set (or loaded as fake): the eval needs the real model.");
  setProvider(instrumentProvider(real, ledger));
}

// ---- inputs ---------------------------------------------------------------------------------------------------------

type ProfileSpec = {
  id: string; resume: string; label: string; seniority: string; location: string;
  lanes: Array<{ name: string; titles: string[]; locations: string[]; remote: boolean }>;
  workAuth: Record<string, { authorized: boolean | null; needsSponsorship: boolean | null; citizen: boolean | null; clearance: boolean | null }>;
  workAuthText: string;
};
const specs = (JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8")) as ProfileSpec[]).filter((p) => !only || only.includes(p.id));
const resumeOf = (p: ProfileSpec) => readFileSync(path.join(here, "resumes", p.resume), "utf8");

const now = new Date();
const handle = await connect({ pgliteDir: dbDir });
await migrate(handle);
const db: Db = handle.db;
const cache = new JudgmentCache(path.join(here, "cache", "judgments.json"));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${stamp()}] ${m}  ($${ledger.totalUsd().toFixed(3)})`);

// ---- index counts ---------------------------------------------------------------------------------------------------

const hasSpec = sql`EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id} AND ${jobSpecs.version} >= ${SPEC_VERSION})`;
const hasEmbedding = sql`EXISTS (SELECT 1 FROM ${jobEmbeddings} WHERE ${jobEmbeddings.jobId} = ${jobs.id})`;

type IndexCounts = { laneFiltered: number; withText: number; withSpec: number; withEmbedding: number };

/** The lane filter exactly as the shortlist applies it (open, fresh, unblocked, fits a lane), and how much of what passes is indexed. */
async function indexCounts(lanesOfUser: ProfileSpec["lanes"]): Promise<IndexCounts> {
  const [r] = await db.select({
    laneFiltered: sql<number>`count(*)::int`,
    withText: sql<number>`(count(*) FILTER (WHERE ${jobs.descriptionText} <> ''))::int`,
    withSpec: sql<number>`(count(*) FILTER (WHERE ${hasSpec}))::int`,
    withEmbedding: sql<number>`(count(*) FILTER (WHERE ${hasEmbedding}))::int`,
  }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(and(openAndFreshSql(now), inlineLanesFitSql(lanesOfUser)));
  return r!;
}

async function selectForUnderstanding(lanesOfUser: ProfileSpec["lanes"]) {
  return db.select({
    id: jobs.id, ats: jobs.atsType, hasText: sql<boolean>`${jobs.descriptionText} <> ''`, spec: hasSpec.mapWith(Boolean), emb: hasEmbedding.mapWith(Boolean),
  }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(openAndFreshSql(now), inlineLanesFitSql(lanesOfUser)))
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), asc(jobs.id))
    .limit(CAP);
}

if (planOnly) {
  console.log(`plan only (no AI calls). db=${dbDir} cap=${CAP}`);
  let total = 0;
  for (const p of specs) {
    const c = await indexCounts(p.lanes);
    const sel = await selectForUnderstanding(p.lanes);
    const need = sel.filter((s) => !s.spec || !s.emb).length;
    const fills = sel.filter((s) => !s.hasText && (s.ats === "workday" || s.ats === "oracle")).length;
    total += need;
    console.log(`${p.id.padEnd(22)} laneFit=${String(c.laneFiltered).padStart(5)} withText=${String(c.withText).padStart(5)} spec=${String(c.withSpec).padStart(4)} emb=${String(c.withEmbedding).padStart(4)} selected=${sel.length} toUnderstand=${need} toFill=${fills}`);
  }
  console.log(`upper bound of understand calls (before sharing between profiles): ${total}`);
  await handle.close();
  process.exit(0);
}

// ---- per-profile phases ---------------------------------------------------------------------------------------------

type ProfileResult = EvalResults["profiles"][number];
type Prepared = { spec: ProfileSpec; userId: string; resumeText: string; resume: ProfileResult["resume"]; index: ProfileResult["index"]; usd: Record<string, number> };

async function createUser(p: ProfileSpec): Promise<string> {
  const email = `eval+${p.id}@norinote.test`;
  await db.delete(users).where(eq(users.email, email)); // cascades: profile, lanes, career points, shortlist
  const [u] = await db.insert(users).values({ email, passwordHash: "eval-not-a-login" }).returning({ id: users.id });
  const userId = u!.id;
  await db.insert(profilesTable).values({
    userId, location: p.location, workAuth: p.workAuth, contact: { email }, resumeText: resumeOf(p), preferences: { remote: p.lanes.some((l) => l.remote) ? "ok" : "no" },
  });
  await db.insert(lanesTable).values(p.lanes.map((l) => ({ userId, name: l.name, titles: l.titles, locations: l.locations, remote: l.remote })));
  return userId;
}

async function prepareProfile(p: ProfileSpec): Promise<Prepared> {
  const usd: Record<string, number> = {};
  const lap = (phase: string, before: number) => { usd[phase] = (usd[phase] ?? 0) + ledger.totalUsd() - before; };

  // 1. user, resume to career graph (real model), embeddings
  ledger.phase = "resume";
  let t = ledger.totalUsd();
  const userId = await createUser(p);
  const resumeText = resumeOf(p);
  const built = await buildCareerPoints(db, userId, resumeText);
  ledger.assertRoom(0); // buildCareerPoints swallows errors; make sure a budget stop was not one of them
  if (built.source !== "model") throw new Error(`${p.id}: resume was read by the "${built.source}" parser, not the model (aiUnavailable=${built.aiUnavailable})`);
  const emb = await embedCareerPoints(db, userId);
  const pts = await db.select({ kind: careerPoints.kind }).from(careerPoints).where(eq(careerPoints.userId, userId));
  const resume = { source: built.source, points: pts.length, byKind: Object.fromEntries([...new Set(pts.map((x) => x.kind))].map((k) => [k, pts.filter((x) => x.kind === k).length])), embeddedNow: emb.embedded };
  lap("resume", t);

  // 2. lane filter counts, then fill and understand the newest CAP lane-fitting jobs
  const before = await indexCounts(p.lanes);
  const selected = await selectForUnderstanding(p.lanes);
  const toFill = selected.filter((s) => !s.hasText && (s.ats === "workday" || s.ats === "oracle"));
  const fill: Record<string, number> = { filled: 0, has_text: 0, unsupported: 0, gone: 0, missing: 0, error: 0 };
  ledger.phase = "fill";
  if (toFill.length > 0) {
    log(`${p.id}: reading ${toFill.length} Workday/Oracle postings (concurrency ${FILL_CONCURRENCY})`);
    await pool(toFill, FILL_CONCURRENCY, async (s) => {
      try { fill[await fillJobDescription(db, s.id)]!++; } catch { fill.error!++; }
      await sleep(FILL_PAUSE_MS);
    });
  }

  ledger.phase = "understand";
  t = ledger.totalUsd();
  const todo = selected.filter((s) => !s.spec || !s.emb).map((s) => s.id);
  let understood = 0, failed = 0, heuristicRetries = 0;
  log(`${p.id}: ${before.laneFiltered} jobs pass the lane filter; understanding ${todo.length} of the newest ${selected.length}`);
  for (let round = 0; round < 4 && todo.length > 0; round++) {
    const retry: string[] = [];
    await pool(todo, UNDERSTAND_CONCURRENCY, async (id) => {
      try {
        const r = await understandJob(db, id);
        if (r.heuristic || r.embeddingPending) retry.push(id); else understood++;
      } catch (e) {
        if (e instanceof BudgetStopError) throw e;
        if (e instanceof AiUnavailableError) { retry.push(id); return; }
        failed++;
        console.warn(`understand failed for ${id}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      }
    });
    todo.length = 0;
    todo.push(...retry);
    if (retry.length > 0) { heuristicRetries += retry.length; log(`${p.id}: ${retry.length} jobs fell back (AI unavailable); waiting 35 s`); await sleep(35_000); }
  }
  lap("understand", t);
  const after = await indexCounts(p.lanes);
  const afterSel = await selectForUnderstanding(p.lanes);
  const index = {
    laneFiltered: before.laneFiltered, laneFilteredWithText: before.withText,
    specBefore: before.withSpec, embeddingBefore: before.withEmbedding,
    selected: selected.length, selectedNeededWork: selected.filter((s) => !s.spec || !s.emb).length,
    descriptionReads: fill, understoodNow: understood, understandFailed: failed + todo.length, fellBackToHeuristic: heuristicRetries,
    understood: after.withSpec, embedded: after.withEmbedding, laneFilteredWithTextAfter: after.withText,
    selectedUnderstood: afterSel.filter((s) => s.spec).length, selectedEmbedded: afterSel.filter((s) => s.emb).length,
  };
  return { spec: p, userId, resumeText, resume, index, usd };
}

type Item = {
  rank: number; jobId: string; title: string; company: string | null; location: string | null; remote: boolean; applyUrl: string; postedAt: string | null;
  fit: number; widenedBy: string | null; reasons: string[]; description: string;
};

async function shortlistFor(pr: Prepared) {
  ledger.phase = "shortlist";
  const t = ledger.totalUsd();
  const pe = await profileEmbedding(db, pr.userId, now);
  const t0 = performance.now();
  const stats = await buildShortlist(db, pr.userId, { now, profileEmbedding: pe, widen: true, limit: TOP });
  const ms = Math.round(performance.now() - t0);
  const widenedOrder = sql`(EXISTS (SELECT 1 FROM unnest(${shortlist.reasons}) AS r WHERE r LIKE 'widened:%')) asc`;
  // The order the API serves: lane matches first, then widened rows, each best fit first.
  const rows = await db.select({
    jobId: shortlist.jobId, fit: shortlist.fit, reasons: shortlist.reasons, title: jobs.title, location: jobs.location, remote: jobs.remote, applyUrl: jobs.applyUrl,
    postedAt: jobs.postedAt, description: jobs.descriptionText, company: companies.name,
  }).from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(shortlist.userId, pr.userId), eq(shortlist.status, "new"), isNull(jobs.closedAt)))
    .orderBy(widenedOrder, desc(shortlist.fit), desc(shortlist.createdAt)).limit(TOP);
  const items: Item[] = rows.map((r, i) => ({
    rank: i + 1, jobId: r.jobId, title: r.title, company: r.company, location: r.location, remote: r.remote, applyUrl: r.applyUrl,
    postedAt: r.postedAt ? r.postedAt.toISOString() : null, fit: r.fit, widenedBy: widenedByOf(r.reasons), reasons: withoutWidenedReasons(r.reasons).slice(0, 2), description: r.description,
  }));
  const byStep: Record<string, number> = {};
  for (const w of stats.widened) byStep[w.by] = (byStep[w.by] ?? 0) + 1;
  const gatedReasons: Record<string, number> = {};
  for (const g of stats.gated) for (const reason of g.reasons) { const k = reason.replace(/\d+(\.\d+)?/g, "N").replace(/in [A-Za-z ,.]+, which/, "in X, which").slice(0, 70); gatedReasons[k] = (gatedReasons[k] ?? 0) + 1; }
  const lap = ledger.totalUsd() - t;
  return {
    items, usdShortlist: lap,
    stats: {
      ms, considered: stats.considered, withoutSpec: stats.withoutSpec, lexical: stats.lexical, scored: stats.scored, gated: stats.gated.length, gatedReasons,
      belowMinFit: stats.belowMinFit, laneMatches: stats.laneMatches, widenedCount: stats.widened.length, widenedByStep: byStep, poolUsed: stats.poolUsed,
      temporaryLane: stats.temporaryLane, saved: stats.saved,
    },
  };
}

async function judgeProfile(pr: Prepared, items: Item[]) {
  const profile: JudgeProfile = {
    id: pr.spec.id, resumeText: pr.resumeText, label: pr.spec.label, seniority: pr.spec.seniority, location: pr.spec.location,
    lanes: pr.spec.lanes.map((l) => ({ titles: l.titles, locations: l.locations, remote: l.remote })), workAuthText: pr.spec.workAuthText,
  };
  ledger.phase = "judge";
  const dups = duplicateFlags(items.map((i) => ({ company: i.company, title: i.title })));
  const out: Array<Item & { score: number; reason: ReasonCode; sentence: string; duplicate: boolean; judgeReason: ReasonCode; cached: boolean }> = [];
  const judged = await pool(items, JUDGE_CONCURRENCY, async (it) => {
    const job: JudgeJob = { id: it.jobId, title: it.title, company: it.company, location: it.location, remote: it.remote, description: it.description, postedAt: it.postedAt };
    return judgeJob(profile, job, cache);
  });
  items.forEach((it, i) => {
    const { judgment, cached } = judged[i]!;
    out.push({ ...it, score: judgment.score, judgeReason: judgment.reason, reason: dups[i] ? "duplicate" : judgment.reason, sentence: judgment.sentence, duplicate: dups[i]!, cached });
  });
  cache.save();
  return out;
}

// ---- main -----------------------------------------------------------------------------------------------------------

let exitCode = 0;
try {
  log(`db=${dbDir}  cap=${CAP}  budget=$${budgetUsd}  already spent=$${ledger.totalUsd().toFixed(3)}  judge=${modelFor("large")} small=${modelFor("small")} embed=${embeddingModel()}`);

  // Pass A: every user and the understanding of their lane-fitting jobs, so all shortlists are built against the same index.
  const prepared: Prepared[] = [];
  for (const p of specs) prepared.push(await prepareProfile(p));
  log(`index ready; spent on resumes $${ledger.phaseUsd("resume").toFixed(3)}, understanding $${ledger.phaseUsd("understand").toFixed(3)}`);

  // Pass B: shortlists (timed one at a time), then judging.
  const results = [];
  for (const pr of prepared) {
    const s = await shortlistFor(pr);
    log(`${pr.spec.id}: shortlist ${s.items.length} rows in ${s.stats.ms} ms (lane ${s.stats.laneMatches}, widened ${s.stats.widenedCount})`);
    let judged: Awaited<ReturnType<typeof judgeProfile>> = [];
    let usdJudge = 0;
    if (!skipJudge) {
      const t = ledger.totalUsd();
      judged = await judgeProfile(pr, s.items);
      usdJudge = ledger.totalUsd() - t;
    }
    const ranked = judged.map((j) => ({ rank: j.rank, score: j.score, reason: j.reason, widenedBy: j.widenedBy, duplicate: j.duplicate }));
    const metrics = profileMetrics(ranked);
    const usd = { ...pr.usd, shortlist: s.usdShortlist, judge: usdJudge };
    const total = Object.values(usd).reduce((a, b) => a + b, 0);
    results.push({
      id: pr.spec.id, label: pr.spec.label, seniority: pr.spec.seniority, lanes: pr.spec.lanes, workAuth: pr.spec.workAuthText,
      resume: pr.resume, index: pr.index, shortlist: s.stats, metrics, usd: { ...usd, total },
      items: judged.map(({ description: _d, ...rest }) => rest),
    });
    if (judged.length > 0) log(`${pr.spec.id}: P@10 ${metrics.p10.toFixed(2)} P@20 ${metrics.p20.toFixed(2)} mean ${metrics.meanScore?.toFixed(2)} (${judged.filter((j) => !j.cached).length} new judgments)`);
  }

  const overall = overallMetrics(results.map((r) => ({ metrics: r.metrics, items: r.items.map((i) => ({ rank: i.rank, score: i.score, reason: i.reason, widenedBy: i.widenedBy, duplicate: i.duplicate })) })));
  const out: EvalResults & { profiles: Array<{ lanes: ProfileSpec["lanes"] }> } = {
    generatedAt: new Date().toISOString(),
    config: {
      db: path.basename(dbDir), cap: CAP, top: TOP, judgeVersion: JUDGE_VERSION, judgeModel: modelFor("large"), smallModel: modelFor("small"), embeddingModel: embeddingModel(),
      now: now.toISOString(),
    },
    overall,
    profiles: results,
    spend: { totalUsd: ledger.totalUsd(), capUsd: budgetUsd, byPhaseModel: ledger.byPhaseModel() },
  };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(out, null, 2));
  mkdirSync(path.dirname(outMd), { recursive: true });
  writeFileSync(outMd, renderReport(out));
  log(`wrote ${path.relative(root, outJson)} and ${path.relative(root, outMd)}`);
} catch (e) {
  if (e instanceof BudgetStopError) { console.error(`\n${e.message}`); exitCode = 3; }
  else { console.error(e); exitCode = 1; }
} finally {
  cache.save();
  ledger.save();
  await handle.close();
}
process.exit(exitCode);
