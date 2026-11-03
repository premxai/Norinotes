/**
 * Resume-tailoring eval. For each fictional profile in scripts/eval/profiles.json, take two jobs from its shortlist in a COPY
 * of the job index (the best match and a middle one), plus three adversarial pairs (a job from another profession), tailor
 * the resume with the real models, and report:
 *   supported must-have coverage before (the resume as written) and after (alias aware, and the posting's exact spelling),
 *   unsupported entities in rewritten text (must be 0), banned phrases, words per bullet, opening-verb diversity,
 *   a judge score (relevance, truthfulness, specificity, natural tone; 1 to 5) from a different model than the writer,
 *   and cost.
 *
 *   npx tsx scripts/eval/tailor.mts [--db <pglite dir>] [--plan] [--only id,id] [--budget 1]
 *                                   [--out docs/eval/tailor-run2.md] [--json scripts/eval/results/tailor-run2.json]
 *                                   [--compare scripts/eval/results/tailor-run1.json]
 *
 * The db must be a copy (cp -r $TEMP/norinote-eval3 $TEMP/norinote-tailor-eval); the script refuses the originals. The spend
 * cap is $1.21 in total across runs (run 1 had $1, run 2 an extra $0.40) and cannot be raised: every model call is checked against scripts/eval/results/tailor-spend-ledger.json before it
 * is sent. The OpenAI key is read from .env and never printed.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PRICES_USD_PER_MILLION, getProvider, modelFor, setProvider } from "@norinote/ai";
import { and, careerPoints, companies, connect, desc, eq, isNull, jobSpecs, jobs, loadDotEnv, migrate, or, shortlist, sql, users, type Db } from "@norinote/db";
import { CareerPoint as CareerPointSchema, type CareerPoint } from "@norinote/shared";
import {
  chromiumInstalled, closeSharedBrowser, renderResumeText, tailorResume, type ResumeContent, type TailorResult,
} from "@norinote/tailor";
import { BudgetStopError, Ledger, instrumentProvider } from "./lib/spend.js";
import { aliasGroupOf } from "../../packages/tailor/src/aliases.js";
import { pointCorpus } from "../../packages/tailor/src/evidence.js";
import { bannedIn, openerTense, openingWord } from "../../packages/tailor/src/phrases.js";
import { styleStats } from "../../packages/tailor/src/rewrite.js";
import { findTerms, mentionsSkill, numbersIn, tokensOf, wordCount } from "../../packages/tailor/src/text.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const HARD_CAP_USD = 1.21;
const budgetUsd = Math.min(HARD_CAP_USD, Number(opt("budget", String(HARD_CAP_USD))));
const dbDir = path.resolve(opt("db", path.join(os.tmpdir(), "norinote-tailor-eval"))!);
const planOnly = flag("plan");
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const outMd = path.resolve(root, opt("out", "docs/eval/tailor-run2.md")!);
const outJson = path.resolve(root, opt("json", "scripts/eval/results/tailor-run2.json")!);
const comparePath = path.resolve(root, opt("compare", "scripts/eval/results/tailor-run1.json")!);
const RUN_LABEL = opt("label", "run 2")!;
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "gpt-4o";
const FALLBACK_JUDGE = "gpt-4.1-mini";
/** Most a single pair may cost (tailoring plus judge) before it starts; keeps the run well inside the cap. */
const PAIR_RESERVE_USD = 0.025;

if (/norinote-(cov|eval3?|eval2)$/.test(path.basename(dbDir))) throw new Error(`Refusing to run on an original index (${path.basename(dbDir)}). Copy it first.`);
process.env.AI_DAILY_TOKEN_BUDGET = "0"; // the ledger is the budget for this run
// gpt-4o is not in the shared price table; list it so the ledger prices the judge correctly (USD per 1M tokens).
PRICES_USD_PER_MILLION["gpt-4o"] ??= { input: 2.5, cachedInput: 1.25, output: 10 };

const ledger = new Ledger(path.join(here, "results", "tailor-spend-ledger.json"), budgetUsd);
if (!planOnly) {
  const real = getProvider();
  if (real.name !== "openai") throw new Error("OPENAI_API_KEY is not set (or loaded as fake): the eval needs the real model.");
  setProvider(instrumentProvider(real, ledger));
}

type ProfileSpec = { id: string; resume: string; label: string; seniority: string; lanes: Array<{ titles: string[] }> };
const profiles = (JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8")) as ProfileSpec[]).filter((p) => !only || only.includes(p.id));
const resumeOf = (p: ProfileSpec) => readFileSync(path.join(here, "resumes", p.resume), "utf8");

/** Adversarial pairs: the person against a job from another profession (their first shortlist job). */
const ADVERSARIAL: Array<{ person: string; jobFrom: string }> = [
  { person: "registered_nurse", jobFrom: "backend_platform_mid" },
  { person: "financial_analyst", jobFrom: "product_designer" },
  { person: "senior_frontend", jobFrom: "registered_nurse" },
];

const handle = await connect({ pgliteDir: dbDir });
await migrate(handle);
const db: Db = handle.db;
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${stamp()}] ${m}  ($${ledger.totalUsd().toFixed(4)})`);

// ---- pairs ----------------------------------------------------------------------------------------------------------

type JobRow = { jobId: string; title: string; company: string; description: string; fit: number };

async function userIdOf(profileId: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, `eval+${profileId}@norinote.test`)).limit(1);
  return u?.id ?? null;
}

async function shortlistJobs(userId: string): Promise<JobRow[]> {
  const rows = await db.select({ jobId: shortlist.jobId, fit: shortlist.fit, title: jobs.title, company: companies.name, description: jobs.descriptionText })
    .from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(shortlist.userId, userId), isNull(jobs.closedAt))).orderBy(desc(shortlist.fit));
  return rows.filter((r) => r.description.length > 400);
}

/** Jobs whose title matches one of the profile's lane titles and that have a spec: for a profile with no shortlist rows. */
async function laneJobs(p: ProfileSpec): Promise<JobRow[]> {
  const titles = [...new Set(p.lanes.flatMap((l) => l.titles))];
  if (titles.length === 0) return [];
  const rows = await db.select({ jobId: jobs.id, title: jobs.title, company: companies.name, description: jobs.descriptionText })
    .from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(isNull(jobs.closedAt), or(...titles.map((t) => sql`${jobs.title} ILIKE ${`%${t}%`}`)), sql`EXISTS (SELECT 1 FROM ${jobSpecs} WHERE ${jobSpecs.jobId} = ${jobs.id})`))
    .orderBy(desc(jobs.firstSeenAt)).limit(20);
  return rows.filter((r) => r.description.length > 400).map((r) => ({ ...r, fit: 0 }));
}

type Pair = { profile: ProfileSpec; userId: string; job: JobRow; kind: "top" | "middle" | "adversarial" };
const pairs: Pair[] = [];
const firstJobOf = new Map<string, JobRow>();
for (const p of JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8")) as ProfileSpec[]) {
  const uid = await userIdOf(p.id);
  if (!uid) continue;
  let js = await shortlistJobs(uid);
  if (js.length === 0) js = await laneJobs(p);
  if (js[0]) firstJobOf.set(p.id, js[0]);
  if (!profiles.some((x) => x.id === p.id)) continue;
  if (js.length === 0) { console.warn(`${p.id}: no shortlist jobs with a description`); continue; }
  pairs.push({ profile: p, userId: uid, job: js[0]!, kind: "top" });
  if (js.length > 1) pairs.push({ profile: p, userId: uid, job: js[Math.min(js.length - 1, Math.max(1, Math.floor(js.length / 2)))]!, kind: "middle" });
}
for (const a of ADVERSARIAL) {
  const p = profiles.find((x) => x.id === a.person);
  const job = firstJobOf.get(a.jobFrom);
  const uid = p ? await userIdOf(p.id) : null;
  if (p && job && uid) pairs.push({ profile: p, userId: uid, job, kind: "adversarial" });
}

if (planOnly) {
  for (const pr of pairs) console.log(`${pr.profile.id.padEnd(26)} ${pr.kind.padEnd(12)} fit=${pr.job.fit.toFixed(2)}  ${pr.job.title} @ ${pr.job.company}`);
  console.log(`${pairs.length} pairs; spent so far $${ledger.totalUsd().toFixed(4)} of $${budgetUsd}`);
  await handle.close();
  process.exit(0);
}

// ---- independent checks ---------------------------------------------------------------------------------------------

async function pointsOf(userId: string): Promise<CareerPoint[]> {
  const rows = await db.select().from(careerPoints).where(eq(careerPoints.userId, userId));
  return rows.map((r) => CareerPointSchema.parse({ id: r.id, kind: r.kind, title: r.title, org: r.org, startDate: r.startDate, endDate: r.endDate, text: r.text, skills: r.skills, scope: r.scope, metrics: r.metrics, sourceQuote: r.sourceQuote }));
}

const SAFE_CAPS = new Set(["api", "apis", "ui", "ux", "us", "kpi", "kpis", "qa", "the", "and", "a", "an", "of", "for", "to", "in", "on", "with", "by"]);

/**
 * Entities in `text` that the source does not contain: numbers, alias-table terms, other employers of the person, and
 * capitalised words mid-sentence. Written separately from the gate (it reads the whole cited points, not the bullet line).
 */
function unsupportedEntities(text: string, source: string, orgs: string[], extraNumbers: string[] = []): string[] {
  const out: string[] = [];
  const nums = new Set([...numbersIn(source), ...extraNumbers]);
  for (const n of numbersIn(text)) if (!nums.has(n)) out.push(`number ${n}`);
  for (const t of findTerms(text)) if (!mentionsSkill(source, t.as) && !mentionsSkill(source, t.key)) out.push(`term ${t.as}`);
  for (const o of orgs) if (o.length >= 3 && text.toLowerCase().includes(o.toLowerCase()) && !source.toLowerCase().includes(o.toLowerCase())) out.push(`employer ${o}`);
  const srcTokens = new Set(tokensOf(source));
  for (const m of text.matchAll(/(?<![A-Za-z0-9$])[A-Za-z][A-Za-z0-9+#.&'-]*/g)) {
    const w = m[0].replace(/[.'&-]+$/, "");
    if (!/^[A-Z]/.test(w)) continue;
    const before = text.slice(0, m.index).trimEnd();
    if (before === "" || /[.!?:;(]$/.test(before)) continue;
    const lw = w.toLowerCase();
    if (SAFE_CAPS.has(lw) || srcTokens.has(lw) || srcTokens.has(lw.replace(/s$/, "")) || mentionsSkill(source, w) || aliasGroupOf(w)) continue;
    out.push(`name ${w}`);
  }
  return [...new Set(out)];
}

// ---- judge ----------------------------------------------------------------------------------------------------------

const JudgeOut = z.object({
  relevance: z.number(), truthfulness: z.number(), specificity: z.number(), tone: z.number(),
  fabrications: z.array(z.string()), comment: z.string(),
});
type Judgment = z.infer<typeof JudgeOut> & { model: string };

const JUDGE_SYSTEM = `You are a strict senior recruiter and resume reviewer. You get a job posting, the candidate's ORIGINAL resume, and a TAILORED resume generated for that posting. Score the tailored resume from 1 to 5 on each:
- relevance: how strongly it matches the posting (its wording, the most relevant experience first, skills the posting names) using only what the candidate really has.
- truthfulness: 5 = every claim is supported by the original resume; 1 = clear fabrication (a skill, tool, employer, number, scope or seniority the original does not show). Rephrasing and reordering are fine.
- specificity: concrete systems, tools, numbers and outcomes rather than generic statements.
- tone: reads like a strong human-written resume, not keyword stuffing or AI boilerplate.
List every fabrication you find (empty list when none). comment: one sentence. Reply as JSON.`;

let judgeModel = JUDGE_MODEL;
async function judge(pr: Pair, tailored: string): Promise<Judgment | null> {
  const input = JSON.stringify({ posting: { title: pr.job.title, company: pr.job.company, description: pr.job.description.slice(0, 3000) }, originalResume: resumeOf(pr.profile), tailoredResume: tailored });
  const schema = z.toJSONSchema(JudgeOut, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await getProvider().chat({
        model: judgeModel, temperature: 0, maxOutputTokens: 300,
        messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: input }],
        jsonSchema: { name: "resume_judgment", schema, strict: true },
      });
      return { ...JudgeOut.parse(JSON.parse(res.text)), model: judgeModel };
    } catch (e) {
      if (e instanceof BudgetStopError) throw e;
      if (judgeModel !== FALLBACK_JUDGE) { console.warn(`judge ${judgeModel} failed (${e instanceof Error ? e.name : "error"}); falling back to ${FALLBACK_JUDGE}`); judgeModel = FALLBACK_JUDGE; continue; }
      console.warn(`judge failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      return null;
    }
  }
  return null;
}

// ---- run ------------------------------------------------------------------------------------------------------------

type Row = {
  profile: string; kind: Pair["kind"]; job: string; fit: number;
  coverage: {
    before: number | null; selected: number | null; after: number | null; exactBefore: number | null; exactAfter: number | null;
    phraseBefore: number | null; phraseAfter: number | null; total: number;
  };
  presentOpeners: number; yearsOnSkills: number;
  gaps: string[]; missing: string[]; rewritten: number; offered: number; reverted: number; rounds: number; stopReason: string;
  unsupported: string[]; banned: string[]; wordsPerBullet: number; wordsPerRewritten: number | null; verbDiversity: number; repeatedOpeners: number;
  summarySource: string; judge: Judgment | null; tailorUsd: number; judgeUsd: number; error: string | null;
  examples: { before: string; after: string }[]; summary: string | null;
};

const artifacts = mkdtempSync(path.join(os.tmpdir(), "norinote-tailor-pdf-"));
const renderer = chromiumInstalled() ? undefined : (async (html: string) => Buffer.from(`<< /Type /Page >> ${html.length}`));
const rows: Row[] = [];
let exitCode = 0;
try {
  log(`db=${path.basename(dbDir)} pairs=${pairs.length} cap=$${budgetUsd} writer=${modelFor("large")} critic=${modelFor("small")} judge=${JUDGE_MODEL} renderer=${renderer ? "fake" : "chromium"}`);
  for (const pr of pairs) {
    ledger.assertRoom(PAIR_RESERVE_USD);
    ledger.phase = "tailor";
    const t0 = ledger.totalUsd();
    let r: TailorResult;
    try {
      r = await tailorResume(db, { userId: pr.userId, jobId: pr.job.jobId, artifactsDir: artifacts, ...(renderer ? { renderer } : {}) });
    } catch (e) {
      if (e instanceof BudgetStopError) throw e;
      console.error(`${pr.profile.id}: tailoring failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const tailorUsd = ledger.totalUsd() - t0;
    const points = await pointsOf(pr.userId);
    const byId = new Map(points.map((p) => [p.id, p]));
    const orgs = [...new Set(points.flatMap((p) => (p.org ? [p.org] : [])))];
    const content: ResumeContent = r.content;
    const finalBullets = [...content.experience.flatMap((e) => e.bullets), ...content.projects.flatMap((p) => p.bullets)];
    const rewrittenIds = new Set(r.changes.filter((c) => c.kind === "bullet" && c.after).map((c) => c.bulletId));
    const unsupported: string[] = [];
    for (const b of finalBullets.filter((x) => rewrittenIds.has(x.id))) {
      const src = b.careerPointIds.map((id) => byId.get(id)).filter(Boolean).map((p) => pointCorpus(p!)).join("\n");
      for (const u of unsupportedEntities(b.text, src, orgs)) unsupported.push(`${b.id}: ${u}`);
    }
    if (r.report.summary.source === "model" && content.summary) {
      const corpus = points.map(pointCorpus).join("\n");
      for (const u of unsupportedEntities(content.summary, corpus, orgs, Array.from({ length: 41 }, (_, i) => String(i)))) unsupported.push(`summary: ${u}`);
    }
    const stats = styleStats(content);
    const rewrittenTexts = finalBullets.filter((b) => rewrittenIds.has(b.id)).map((b) => b.text);
    const openers = finalBullets.map((b) => openingWord(b.text));
    const tailoredText = renderResumeText(content);
    ledger.phase = "judge";
    const j0 = ledger.totalUsd();
    const verdict = await judge(pr, tailoredText);
    const judgeUsd = ledger.totalUsd() - j0;
    const cov = r.report.coverage;
    const row: Row = {
      profile: pr.profile.id, kind: pr.kind, job: `${pr.job.title} @ ${pr.job.company}`, fit: pr.job.fit,
      coverage: {
        before: cov.before.pct, selected: cov.selected.pct, after: cov.after.pct, exactBefore: cov.exactBefore.pct, exactAfter: cov.exactAfter.pct,
        phraseBefore: cov.phraseBefore?.pct ?? null, phraseAfter: cov.phraseAfter?.pct ?? null, total: cov.after.total,
      },
      presentOpeners: finalBullets.filter((b) => openerTense(b.text) === "present").length,
      yearsOnSkills: /\b\d+\+?\s+years?(?:\s+of)?(?:\s+[a-z-]+)?\s+(?:experience\s+)?(?:in|with|using)\s+[A-Z]/.test(content.summary ?? "") ? 1 : 0,
      missing: cov.after.missing,
      gaps: r.report.gaps.filter((g) => g.mustHave).map((g) => g.lacking.length && g.lacking.length < 4 ? `${g.requirement} (lacks ${g.lacking.join(", ")})` : g.requirement),
      rewritten: rewrittenIds.size, offered: r.report.bullets.length, reverted: r.report.bullets.filter((b) => b.reverted).length,
      rounds: r.report.rounds.length, stopReason: r.report.stopReason,
      unsupported, banned: [...finalBullets.map((b) => b.text), content.summary ?? ""].flatMap((t) => bannedIn(t)),
      wordsPerBullet: stats.meanWords,
      wordsPerRewritten: rewrittenTexts.length ? Math.round((rewrittenTexts.reduce((n, t) => n + wordCount(t), 0) / rewrittenTexts.length) * 10) / 10 : null,
      verbDiversity: stats.verbDiversity, repeatedOpeners: openers.length - new Set(openers).size,
      summarySource: r.report.summary.source, judge: verdict, tailorUsd, judgeUsd, error: r.modelError,
      examples: r.changes.filter((c) => c.kind === "bullet").slice(0, 2).map((c) => ({ before: c.before ?? "", after: c.after ?? "" })),
      summary: content.summary ?? null,
    };
    rows.push(row);
    log(`${pr.profile.id} ${pr.kind}: coverage ${row.coverage.before}% -> ${row.coverage.after}% (exact ${row.coverage.exactBefore}% -> ${row.coverage.exactAfter}%), rewritten ${row.rewritten}/${row.offered}, unsupported ${unsupported.length}, judge ${verdict ? `${verdict.relevance}/${verdict.truthfulness}/${verdict.specificity}/${verdict.tone}` : "n/a"}, $${tailorUsd.toFixed(4)}`);
  }
} catch (e) {
  if (e instanceof BudgetStopError) { console.error(`\n${e.message}`); exitCode = 3; }
  else { console.error(e); exitCode = 1; }
} finally {
  ledger.save();
  await closeSharedBrowser().catch(() => undefined);
  await handle.close();
}

// ---- report ---------------------------------------------------------------------------------------------------------

const mean = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
const fair = rows.filter((r) => r.kind !== "adversarial");
const adv = rows.filter((r) => r.kind === "adversarial");
const overall = {
  pairs: rows.length,
  coverageBefore: mean(fair.map((r) => r.coverage.before)), coverageSelected: mean(fair.map((r) => r.coverage.selected)), coverageAfter: mean(fair.map((r) => r.coverage.after)),
  exactBefore: mean(fair.map((r) => r.coverage.exactBefore)), exactAfter: mean(fair.map((r) => r.coverage.exactAfter)),
  phraseBefore: mean(fair.map((r) => r.coverage.phraseBefore)), phraseAfter: mean(fair.map((r) => r.coverage.phraseAfter)),
  presentOpeners: rows.reduce((n, r) => n + r.presentOpeners, 0), yearsOnSkills: rows.reduce((n, r) => n + r.yearsOnSkills, 0),
  unsupported: rows.reduce((n, r) => n + r.unsupported.length, 0),
  banned: rows.reduce((n, r) => n + r.banned.length, 0),
  wordsPerBullet: mean(rows.map((r) => r.wordsPerBullet)), wordsPerRewritten: mean(rows.map((r) => r.wordsPerRewritten)),
  verbDiversity: mean(rows.map((r) => r.verbDiversity)),
  rewritten: rows.reduce((n, r) => n + r.rewritten, 0), offered: rows.reduce((n, r) => n + r.offered, 0), reverted: rows.reduce((n, r) => n + r.reverted, 0),
  judge: {
    model: rows.find((r) => r.judge)?.judge?.model ?? null,
    relevance: mean(rows.map((r) => r.judge?.relevance)), truthfulness: mean(rows.map((r) => r.judge?.truthfulness)),
    specificity: mean(rows.map((r) => r.judge?.specificity)), tone: mean(rows.map((r) => r.judge?.tone)),
    fabrications: rows.reduce((n, r) => n + (r.judge?.fabrications.length ?? 0), 0),
  },
  tailorUsdPerResume: rows.length ? rows.reduce((n, r) => n + r.tailorUsd, 0) / rows.length : 0,
  tailorUsdMax: Math.max(0, ...rows.map((r) => r.tailorUsd)),
  totalUsd: ledger.totalUsd(),
};

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n}%`);
type Overall = typeof overall;
let prev: Partial<Overall> | null = null;
try { prev = (JSON.parse(readFileSync(comparePath, "utf8")) as { overall: Partial<Overall> }).overall; } catch { prev = null; }
const cmp = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`;
const usd = (n: number | undefined) => (typeof n === "number" ? `$${n.toFixed(4)}` : "n/a");
const comparison: string[] = prev ? [
  ``, `## Compared with run 1`, ``, `| Metric | Run 1 | ${RUN_LABEL[0]!.toUpperCase()}${RUN_LABEL.slice(1)} |`, `|---|---|---|`,
  cmp("Supported must-have coverage, as written -> tailored", `${pct(prev.coverageBefore)} -> ${pct(prev.coverageAfter)}`, `${pct(overall.coverageBefore)} -> ${pct(overall.coverageAfter)}`),
  cmp("Same, posting's exact spelling", `${pct(prev.exactBefore)} -> ${pct(prev.exactAfter)}`, `${pct(overall.exactBefore)} -> ${pct(overall.exactAfter)}`),
  cmp("Key phrase verbatim, as written -> tailored", "not measured", `${pct(overall.phraseBefore)} -> ${pct(overall.phraseAfter)}`),
  cmp("Unsupported entities", String(prev.unsupported ?? "n/a"), String(overall.unsupported)),
  cmp("Banned phrases", String(prev.banned ?? "n/a"), String(overall.banned)),
  cmp("Words per bullet (all / rewritten)", `${prev.wordsPerBullet ?? "n/a"} / ${prev.wordsPerRewritten ?? "n/a"}`, `${overall.wordsPerBullet} / ${overall.wordsPerRewritten}`),
  cmp("Bullets rewritten / offered / reverted", `${prev.rewritten ?? "n/a"} / ${prev.offered ?? "n/a"} / ${prev.reverted ?? "n/a"}`, `${overall.rewritten} / ${overall.offered} / ${overall.reverted}`),
  cmp("Judge relevance / truthfulness / specificity / tone", prev.judge ? `${prev.judge.relevance} / ${prev.judge.truthfulness} / ${prev.judge.specificity} / ${prev.judge.tone}` : "n/a",
    `${overall.judge.relevance} / ${overall.judge.truthfulness} / ${overall.judge.specificity} / ${overall.judge.tone}`),
  cmp("Fabrications the judge listed", String(prev.judge?.fabrications ?? "n/a"), String(overall.judge.fabrications)),
  cmp("Tailoring cost per resume, mean / max", `${usd(prev.tailorUsdPerResume)} / ${usd(prev.tailorUsdMax)}`, `${usd(overall.tailorUsdPerResume)} / ${usd(overall.tailorUsdMax)}`),
] : [];
const md: string[] = [
  `# Tailoring eval, ${RUN_LABEL}`, ``,
  `Generated ${new Date().toISOString()} by \`npx tsx scripts/eval/tailor.mts\` on a copy of the run-3 job index. Writer ${modelFor("large")} (rewrite, retry, revise), critic ${modelFor("small")}, judge ${overall.judge.model ?? JUDGE_MODEL}. Cap $${budgetUsd}, spent $${overall.totalUsd.toFixed(3)} in total (all runs of this eval, ledger \`scripts/eval/results/tailor-spend-ledger.json\`).`, ``,
  `Pairs: ${rows.length} (${fair.length} shortlist pairs: each profile's best match and a middle one; ${adv.length} adversarial: a job from another profession).`, ``,
  `## Summary`, ``,
  `| Metric | Value |`, `|---|---|`,
  `| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | ${pct(overall.coverageBefore)} -> ${pct(overall.coverageSelected)} -> ${pct(overall.coverageAfter)} |`,
  `| Same, counting only the posting's exact spelling | ${pct(overall.exactBefore)} -> ${pct(overall.exactAfter)} |`,
  `| Supported must-haves whose key phrase appears verbatim, as written -> tailored | ${pct(overall.phraseBefore)} -> ${pct(overall.phraseAfter)} |`,
  `| Bullets opening in the present tense / summaries attaching years to a skill | ${overall.presentOpeners} / ${overall.yearsOnSkills} |`,
  `| Unsupported entities in rewritten bullets and model summaries (must be 0) | ${overall.unsupported} |`,
  `| Banned phrases on the final resumes | ${overall.banned} |`,
  `| Words per bullet, all final bullets / rewritten ones | ${overall.wordsPerBullet} / ${overall.wordsPerRewritten} |`,
  `| Opening-verb diversity (unique openers / bullets) | ${overall.verbDiversity} |`,
  `| Bullets rewritten / offered / reverted after two failures | ${overall.rewritten} / ${overall.offered} / ${overall.reverted} |`,
  `| Judge (1 to 5): relevance, truthfulness, specificity, tone | ${overall.judge.relevance}, ${overall.judge.truthfulness}, ${overall.judge.specificity}, ${overall.judge.tone} |`,
  `| Fabrications the judge listed | ${overall.judge.fabrications} |`,
  `| Tailoring cost per resume, mean / max | $${overall.tailorUsdPerResume.toFixed(4)} / $${overall.tailorUsdMax.toFixed(4)} |`,
  ...comparison,
  ``, `## Pairs`, ``,
  `| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |`, `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.profile} | ${r.kind} | ${r.job.replace(/\|/g, "/").slice(0, 60)} | ${pct(r.coverage.before)} -> ${pct(r.coverage.after)} (${pct(r.coverage.exactBefore)} -> ${pct(r.coverage.exactAfter)}) of ${r.coverage.total} | ${pct(r.coverage.phraseBefore)} -> ${pct(r.coverage.phraseAfter)} | ${r.rewritten}/${r.offered}${r.reverted ? `, ${r.reverted} reverted` : ""} | ${r.unsupported.length} | ${r.judge ? `${r.judge.relevance}/${r.judge.truthfulness}/${r.judge.specificity}/${r.judge.tone}` : "n/a"} | $${r.tailorUsd.toFixed(4)} |`),
  ``, `## Supported must-haves still not shown after tailoring`, ``,
  ...(fair.some((r) => r.missing.length) ? fair.filter((r) => r.missing.length).map((r) => `- ${r.profile} (${r.kind}): ${r.missing.join("; ")}`) : ["None."]),
  ``, `## Adversarial pairs: gaps reported, nothing filled`, ``,
  ...adv.flatMap((r) => [`- **${r.profile}** for ${r.job}: ${r.rewritten} bullets rewritten, ${r.unsupported.length} unsupported entities. Must-have gaps: ${r.gaps.slice(0, 6).join("; ") || "none"}.${r.judge ? ` Judge: ${r.judge.comment}` : ""}`]),
  ``, `## Judge notes and fabrications`, ``,
  ...rows.filter((r) => r.judge).map((r) => `- ${r.profile} (${r.kind}): ${r.judge!.comment}${r.judge!.fabrications.length ? ` Fabrications listed: ${r.judge!.fabrications.join("; ")}` : ""}`),
  ``, `## Unsupported entities found by the independent check`, ``,
  ...(rows.some((r) => r.unsupported.length) ? rows.flatMap((r) => r.unsupported.map((u) => `- ${r.profile} (${r.kind}) ${u}`)) : ["None."]),
  ``, `## Examples`, ``,
  ...rows.filter((r) => r.kind === "top").slice(0, 6).flatMap((r) => [`**${r.profile}**, ${r.job}`, ``, ...(r.summary ? [`- Summary: ${r.summary}`] : []), ...r.examples.flatMap((e) => [`- Before: ${e.before}`, `  After: ${e.after}`]), ``]),
];
mkdirSync(path.dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), overall, rows }, null, 2));
mkdirSync(path.dirname(outMd), { recursive: true });
writeFileSync(outMd, md.join("\n") + "\n");
console.log(`wrote ${path.relative(root, outMd)} and ${path.relative(root, outJson)}; spent $${ledger.totalUsd().toFixed(4)}`);
process.exit(exitCode);
