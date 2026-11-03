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
 *                                   [--out docs/eval/tailor-run4.md] [--json scripts/eval/results/tailor-run4.json]
 *                                   [--compare scripts/eval/results/tailor-run1.json,scripts/eval/results/tailor-run2.json]
 *                                   [--samples senior_frontend,registered_nurse]
 *                                   [--kinds top,middle,adversarial] [--label "run 3b"]
 *
 * The db must be a copy (cp -r $TEMP/norinote-eval3 $TEMP/norinote-tailor-eval); the script refuses the originals. The spend
 * cap is $2.26 in total across runs (run 1 $1, run 2 +$0.40, run 3 +$0.60, run 4 +$0.45) and cannot be raised: every model call is checked against scripts/eval/results/tailor-spend-ledger.json before it
 * is sent. The OpenAI key is read from .env and never printed.
 */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PRICES_USD_PER_MILLION, getProvider, modelFor, setProvider } from "@norinote/ai";
import { and, careerPoints, companies, connect, desc, eq, isNull, jobSpecs, jobs, loadDotEnv, migrate, or, profiles as profilesTable, shortlist, sql, users, type Db } from "@norinote/db";
import { CareerPoint as CareerPointSchema, type CareerPoint } from "@norinote/shared";
import {
  chromiumInstalled, closeSharedBrowser, renderResumePdf, renderResumeText, tailorResume, type ResumeContent, type TailorResult,
} from "@norinote/tailor";
import { BudgetStopError, Ledger, instrumentProvider } from "./lib/spend.js";
import { aliasGroupOf } from "../../packages/tailor/src/aliases.js";
import { pointCorpus } from "../../packages/tailor/src/evidence.js";
import { bannedIn, boilerplateIn, isStrongVerb, openerTense, openingWord, sameVerb, tackedOnPhrases } from "../../packages/tailor/src/phrases.js";
import { baselineContent, certificationLines } from "../../packages/tailor/src/select.js";
import { isCategoryLabel, isDegree, sharesFact } from "../../packages/tailor/src/facts.js";
import { styleStats } from "../../packages/tailor/src/rewrite.js";
import { findTerms, mentionsSkill, numbersIn, tokensOf, wordCount } from "../../packages/tailor/src/text.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const HARD_CAP_USD = 2.26;
const budgetUsd = Math.min(HARD_CAP_USD, Number(opt("budget", String(HARD_CAP_USD))));
const dbDir = path.resolve(opt("db", path.join(os.tmpdir(), "norinote-tailor-eval"))!);
const planOnly = flag("plan");
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const outMd = path.resolve(root, opt("out", "docs/eval/tailor-run4.md")!);
const outJson = path.resolve(root, opt("json", "scripts/eval/results/tailor-run4.json")!);
const comparePaths = opt("compare", "scripts/eval/results/tailor-run1.json,scripts/eval/results/tailor-run2.json,scripts/eval/results/tailor-run3.json")!
  .split(",").filter(Boolean).map((p) => path.resolve(root, p));
const RUN_LABEL = opt("label", "run 4")!;
const SAMPLES = new Set(opt("samples", "senior_frontend,registered_nurse")!.split(",").filter(Boolean));
const samplesDir = path.join(root, "data", "samples");
const EXAMPLE_PROFILES = ["senior_frontend", "data_scientist_ml", "product_manager", "account_executive", "registered_nurse", "new_grad_swe"];
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "gpt-4o";
const FALLBACK_JUDGE = "gpt-4.1-mini";
/** Most a single pair may cost (tailoring plus judge) before it starts; keeps the run well inside the cap. */
const PAIR_RESERVE_USD = 0.025;
const skipJudge = flag("skip-judge");

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

/**
 * The resume header: run.mts created the eval users with only an email, so tailored resumes had no name. Read the name
 * (first line) and phone and LinkedIn (second line) from the fictional resume and store them on the profile copy.
 */
async function ensureContact(p: ProfileSpec, userId: string): Promise<void> {
  const lines = resumeOf(p).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = (lines[0] ?? "").replace(/,.*$/, "").trim();
  const second = lines[1] ?? "";
  const phone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(second)?.[0];
  const linkedin = /linkedin\.com\/in\/[\w-]+/i.exec(second)?.[0];
  const email = /[\w.+-]+@[\w.-]+\.\w+/.exec(second)?.[0];
  const [row] = await db.select({ contact: profilesTable.contact }).from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  const contact = { ...(row?.contact ?? {}), name, ...(phone ? { phone } : {}), ...(linkedin ? { linkedin } : {}), ...(email ? { email } : {}) };
  await db.update(profilesTable).set({ contact }).where(eq(profilesTable.userId, userId));
}

type Pair = { profile: ProfileSpec; userId: string; job: JobRow; kind: "top" | "middle" | "adversarial" };
const pairs: Pair[] = [];
const firstJobOf = new Map<string, JobRow>();
for (const p of JSON.parse(readFileSync(path.join(here, "profiles.json"), "utf8")) as ProfileSpec[]) {
  const uid = await userIdOf(p.id);
  if (!uid) continue;
  if (!planOnly) await ensureContact(p, uid);
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

const kinds = opt("kinds")?.split(",").map((k) => k.trim()).filter(Boolean);
if (kinds) for (let i = pairs.length - 1; i >= 0; i--) if (!kinds.includes(pairs[i]!.kind)) pairs.splice(i, 1);

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

/** One judge per call: the main model, retried once, then the fallback for that call only (run 4 switched for good). */
async function judge(pr: Pair, tailored: string): Promise<Judgment | null> {
  const input = JSON.stringify({ posting: { title: pr.job.title, company: pr.job.company, description: pr.job.description.slice(0, 2500) }, originalResume: resumeOf(pr.profile), tailoredResume: tailored });
  const schema = z.toJSONSchema(JudgeOut, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  for (const judgeModel of [JUDGE_MODEL, JUDGE_MODEL, FALLBACK_JUDGE]) {
    try {
      const res = await getProvider().chat({
        model: judgeModel, temperature: 0, maxOutputTokens: 300,
        messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: input }],
        jsonSchema: { name: "resume_judgment", schema, strict: true },
      });
      return { ...JudgeOut.parse(JSON.parse(res.text)), model: judgeModel };
    } catch (e) {
      if (e instanceof BudgetStopError) throw e;
      console.warn(`judge ${judgeModel} failed (${e instanceof Error ? e.name : "error"})`);
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
  readability: {
    strongOriginal: number; strongKept: number; tackedOn: string[]; boilerplate: string[]; kept: number; summaryShapeOk: boolean;
    repeatedFacts: string[]; junkSkills: string[]; named: boolean;
  };
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
    if (pr.kind === "top" && SAMPLES.has(pr.profile.id) && !renderer) {
      // Before: the career points as the person wrote them (no tailoring, no summary). After: the tailored PDF.
      const { name, ...contact } = { name: r.content.name, ...r.content.contact };
      const certs = certificationLines(points);
      const before: ResumeContent = { ...baselineContent(points, { name, ...contact }), education: r.content.education, ...(certs.length ? { certifications: certs } : {}) };
      mkdirSync(samplesDir, { recursive: true });
      const rendered = await renderResumePdf(before, {});
      writeFileSync(path.join(samplesDir, `tailored-${pr.profile.id}-before.pdf`), rendered.pdf);
      copyFileSync(r.pdfPath, path.join(samplesDir, `tailored-${pr.profile.id}-after.pdf`));
      log(`${pr.profile.id}: wrote sample PDFs to ${path.relative(root, samplesDir)}`);
    }
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
    const verdict = skipJudge ? null : await judge(pr, tailoredText);
    const judgeUsd = ledger.totalUsd() - j0;
    const cov = r.report.coverage;
    const row: Row = {
      profile: pr.profile.id, kind: pr.kind, job: `${pr.job.title} @ ${pr.job.company}`, fit: pr.job.fit,
      coverage: {
        before: cov.before.pct, selected: cov.selected.pct, after: cov.after.pct, exactBefore: cov.exactBefore.pct, exactAfter: cov.exactAfter.pct,
        phraseBefore: cov.phraseBefore?.pct ?? null, phraseAfter: cov.phraseAfter?.pct ?? null, total: cov.after.total,
      },
      readability: (() => {
        const before = new Map(r.changes.filter((c) => c.kind === "bullet" && c.bulletId).map((c) => [c.bulletId!, c.before ?? ""]));
        const originals = finalBullets.map((b) => ({ now: b.text, was: before.get(b.id) ?? b.text }));
        const strong = originals.filter((x) => isStrongVerb(openingWord(x.was)));
        const phrases = r.report.keyPhrases ?? [];
        const sum = content.summary ?? "";
        const summarySentences = sum.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean).length;
        return {
          strongOriginal: strong.length,
          strongKept: strong.filter((x) => sameVerb(openingWord(x.now), openingWord(x.was))).length,
          tackedOn: finalBullets.filter((b) => rewrittenIds.has(b.id)).flatMap((b) => tackedOnPhrases(b.text, phrases).map((p) => `${b.id}: ${p}`)),
          boilerplate: [
            ...finalBullets.filter((b) => rewrittenIds.has(b.id)).flatMap((b) => boilerplateIn(b.text).map((p) => `${b.id}: ${p}`)),
            ...(r.report.summary.source === "model" ? boilerplateIn(sum, { forSummary: true }).map((p) => `summary: ${p}`) : []),
          ],
          kept: r.report.bullets.filter((b) => b.kept).length,
          summaryShapeOk: summarySentences === 2 && wordCount(sum) >= 25 && wordCount(sum) <= 45 && !/[()]/.test(sum),
          repeatedFacts: finalBullets.flatMap((b, i) => finalBullets.slice(i + 1).filter((o) => sharesFact(b.text, o.text)).map((o) => `${b.id} ~ ${o.id}`)),
          junkSkills: content.skills.flatMap((g) => g.items).filter((x) => isCategoryLabel(x) || isDegree(x)),
          named: !!content.name.trim(),
        };
      })(),
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
      examples: r.changes.filter((c) => c.kind === "bullet").slice(0, 3).map((c) => ({ before: c.before ?? "", after: c.after ?? "" })),
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
  strongVerbKept: (() => { const a = rows.reduce((n, r) => n + r.readability.strongOriginal, 0); return a ? Math.round((rows.reduce((n, r) => n + r.readability.strongKept, 0) / a) * 100) : null; })(),
  tackedOn: rows.reduce((n, r) => n + r.readability.tackedOn.length, 0),
  boilerplate: rows.reduce((n, r) => n + r.readability.boilerplate.length, 0),
  noOpKept: rows.reduce((n, r) => n + r.readability.kept, 0),
  summaryShapeOk: rows.length ? Math.round((rows.filter((r) => r.readability.summaryShapeOk).length / rows.length) * 100) : null,
  repeatedFacts: rows.reduce((n, r) => n + r.readability.repeatedFacts.length, 0),
  junkSkills: rows.reduce((n, r) => n + r.readability.junkSkills.length, 0),
  unnamed: rows.filter((r) => !r.readability.named).length,
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
const prevRuns: { label: string; o: Partial<Overall> }[] = [];
comparePaths.forEach((p, i) => {
  const name = /tailor-run(\w+)\.json$/.exec(p)?.[1] ?? String(i + 1);
  try { prevRuns.push({ label: `Run ${name}`, o: (JSON.parse(readFileSync(p, "utf8")) as { overall: Partial<Overall> }).overall }); } catch { /* not there */ }
});
const usd = (n: number | undefined) => (typeof n === "number" ? `$${n.toFixed(4)}` : "n/a");
const runs: { label: string; o: Partial<Overall> }[] = [...prevRuns, { label: `${RUN_LABEL[0]!.toUpperCase()}${RUN_LABEL.slice(1)}`, o: overall }];
const row = (label: string, f: (o: Partial<Overall>) => string) => `| ${label} | ${runs.map((r) => f(r.o)).join(" | ")} |`;
const nm = (v: unknown) => (v === undefined || v === null ? "n/a" : String(v));
const comparison: string[] = prevRuns.length ? [
  ``, `## Compared with earlier runs`, ``, `| Metric | ${runs.map((r) => r.label).join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`,
  row("Supported must-have coverage, as written -> tailored", (o) => `${pct(o.coverageBefore)} -> ${pct(o.coverageAfter)}`),
  row("Same, posting's exact spelling", (o) => `${pct(o.exactBefore)} -> ${pct(o.exactAfter)}`),
  row("Key phrase verbatim, as written -> tailored", (o) => (o.phraseAfter === undefined ? "not measured" : `${pct(o.phraseBefore)} -> ${pct(o.phraseAfter)}`)),
  row("Unsupported entities", (o) => nm(o.unsupported)),
  row("Banned phrases", (o) => nm(o.banned)),
  row("Strong original verbs kept", (o) => (o.strongVerbKept === undefined ? "not measured" : pct(o.strongVerbKept))),
  row("Tacked-on key phrases (must be 0)", (o) => nm(o.tackedOn)),
  row("Job-ad boilerplate fragments (must be 0)", (o) => nm(o.boilerplate)),
  row("No-op rewrites skipped (kept as written)", (o) => nm(o.noOpKept)),
  row("Summaries in shape (2 sentences, 25 to 45 words, no parentheses)", (o) => (o.summaryShapeOk === undefined ? "not measured" : pct(o.summaryShapeOk))),
  row("Facts repeated across bullets / junk skills / resumes without a name", (o) => (o.repeatedFacts === undefined ? "not measured" : `${o.repeatedFacts} / ${o.junkSkills} / ${o.unnamed}`)),
  row("Words per bullet (all / rewritten)", (o) => `${nm(o.wordsPerBullet)} / ${nm(o.wordsPerRewritten)}`),
  row("Bullets rewritten / offered / reverted", (o) => `${nm(o.rewritten)} / ${nm(o.offered)} / ${nm(o.reverted)}`),
  row("Judge relevance / truthfulness / specificity / tone", (o) => (o.judge ? `${o.judge.relevance} / ${o.judge.truthfulness} / ${o.judge.specificity} / ${o.judge.tone}` : "n/a")),
  row("Fabrications the judge listed", (o) => nm(o.judge?.fabrications)),
  row("Pairs", (o) => nm(o.pairs)),
  row("Tailoring cost per resume, mean / max", (o) => `${usd(o.tailorUsdPerResume)} / ${usd(o.tailorUsdMax)}`),
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
  `| Strong original opening verbs kept | ${pct(overall.strongVerbKept)} |`,
  `| Tacked-on key phrases / job-ad boilerplate fragments (both must be 0) | ${overall.tackedOn} / ${overall.boilerplate} |`,
  `| No-op rewrites skipped (kept as written) / offered | ${overall.noOpKept} / ${overall.offered} |`,
  `| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | ${pct(overall.summaryShapeOk)} |`,
  `| Facts repeated across bullets / junk skills (category labels, degrees) / resumes without a name | ${overall.repeatedFacts} / ${overall.junkSkills} / ${overall.unnamed} |`,
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
  ...EXAMPLE_PROFILES.map((id) => rows.find((r) => r.profile === id && r.kind === "top")).filter((r): r is Row => !!r)
    .flatMap((r) => [`**${r.profile}**, ${r.job}`, ``, ...(r.summary ? [`- Summary: ${r.summary}`] : []), ...r.examples.flatMap((e) => [`- Before: ${e.before}`, `  After: ${e.after}`]), ``]),
  ``, `## Readability issues found`, ``,
  ...(rows.some((r) => r.readability.tackedOn.length || r.readability.boilerplate.length)
    ? rows.flatMap((r) => [...r.readability.tackedOn.map((x) => `- ${r.profile} (${r.kind}) tacked on: ${x}`), ...r.readability.boilerplate.map((x) => `- ${r.profile} (${r.kind}) boilerplate: ${x}`)])
    : ["None."]),
];
mkdirSync(path.dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), overall, rows }, null, 2));
mkdirSync(path.dirname(outMd), { recursive: true });
writeFileSync(outMd, md.join("\n") + "\n");
console.log(`wrote ${path.relative(root, outMd)} and ${path.relative(root, outJson)}; spent $${ledger.totalUsd().toFixed(4)}`);
process.exit(exitCode);
