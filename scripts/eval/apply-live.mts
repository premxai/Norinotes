/**
 * Live dry runs of auto-apply against a few PUBLIC postings (at most 3 per Greenhouse, Lever and Ashby), with the clearly
 * fictional applicant ("Test Applicant", test.applicant@norinote.test). Prepare (schema, recipe, plan) and fill run for
 * real; the run stops before submit: ALLOW_REAL_SUBMIT is forced off, dryRun is true, and submit is never called. A
 * screenshot of each filled form goes to data/samples/apply/. A captcha challenge is recorded, never touched.
 *
 *   npx tsx scripts/eval/apply-live.mts [--only greenhouse,lever,ashby] [--json scripts/eval/results/apply-live-run1.json]
 *
 * Model calls share the apply spend ledger (cap $0.30 for everything). The eval database (recipes, bank) is reused.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider, setProvider } from "@norinote/ai";
import { applications, companies, connect, eq, jobs, loadDotEnv, migrate, resumes, type Db } from "@norinote/db";
import {
  ashbyDriver, createApplication, createBrowserPool, detectCaptcha, greenhouseDriver, leverDriver, prepareForm, submitAllowed,
  type DriverContext, type FillResult,
} from "@norinote/apply";
import { Ledger, instrumentProvider } from "./lib/spend.js";
import { seedApplicant, APPLICANT_PROFILE } from "./lib/applicant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));
delete process.env.ALLOW_REAL_SUBMIT; // never a real submission from this script
process.env.AI_DAILY_TOKEN_BUDGET = "0";
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PICK_ONLY = opt("ids")?.split(",");
const ONLY = new Set((opt("only", "greenhouse,lever,ashby") ?? "").split(","));
const outJson = path.resolve(root, opt("json", "scripts/eval/results/apply-live-run1.json")!);
const samples = path.join(root, "data", "samples", "apply");
const ledger = new Ledger(path.join(here, "results", "apply-spend-ledger.json"), 0.30);
const real = getProvider();
if (real.name === "openai") { setProvider(instrumentProvider(real, ledger)); ledger.phase = "live"; }

type Target = { ats: "greenhouse" | "lever" | "ashby"; company: string; jobId: string; url: string; title: string; id: string };
const manifest = JSON.parse(readFileSync(path.join(root, "packages/apply/src/fixtures/forms/manifest.json"), "utf8")) as Target[];
const PICK: Record<Target["ats"], string[]> = {
  greenhouse: ["greenhouse-discord-88407560", "greenhouse-gitlab-86382320", "greenhouse-reddit-8153017"],
  // Lever's own demo postings first.
  lever: ["lever-leverdemo-ad208490", "lever-leverdemo-7e10ea46", "lever-zoox-e8a190f0"],
  ashby: ["ashby-ramp-34413f8d", "ashby-notion-1fc309c8", "ashby-linear-d3bc1ced"],
};
const DRIVER = { greenhouse: greenhouseDriver, lever: leverDriver, ashby: ashbyDriver };

async function ensureJob(db: Db, t: Target): Promise<string> {
  const name = t.company.replace(/^\w/, (c) => c.toUpperCase());
  const [co] = await db.insert(companies).values({ atsType: t.ats, atsToken: t.company, name }).onConflictDoUpdate({ target: [companies.atsType, companies.atsToken], set: { name } }).returning();
  const [job] = await db.insert(jobs).values({ companyId: co!.id, atsType: t.ats, externalId: t.jobId, title: t.title, applyUrl: t.url.replace(/\/(apply|application)$/, ""), dedupeKey: `eval|${t.id}`, descriptionText: `${t.title} at ${name}.` })
    .onConflictDoUpdate({ target: [jobs.atsType, jobs.externalId], set: { applyUrl: t.url.replace(/\/(apply|application)$/, "") } }).returning();
  return job!.id;
}

async function main() {
  const handle = await connect({ pgliteDir: path.join(os.tmpdir(), "norinote-apply-eval") });
  await migrate(handle);
  const db = handle.db;
  const { userId, resumePath } = await seedApplicant(db);
  mkdirSync(samples, { recursive: true });
  const pool = createBrowserPool({ size: 1, artifactsDir: path.join(os.tmpdir(), "norinote-apply-live-artifacts"), spareContexts: 1 });
  await pool.warmUp();
  const results: Record<string, unknown>[] = [];
  try {
    for (const ats of ["greenhouse", "lever", "ashby"] as const) {
      if (!ONLY.has(ats)) continue;
      for (const id of PICK[ats].filter((x) => !PICK_ONLY || PICK_ONLY.includes(x))) {
        const t = manifest.find((m) => m.id === id);
        if (!t) continue;
        const jobId = await ensureJob(db, t);
        const app = await createApplication(db, userId, jobId);
        const appId = app.application!.id;
        // A fresh state for this run; the tailored resume stands in as the placeholder PDF.
        const [resume] = await db.insert(resumes).values({ applicationId: appId, content: {}, pdfPath: resumePath }).returning();
        await db.update(applications).set({ status: "preparing", resumeId: resume!.id, receipt: null, answers: {}, pendingQuestions: [] }).where(eq(applications.id, appId));
        const before = ledger.totalUsd();
        const tp = Date.now();
        const prep = await prepareForm(db, appId, { pool });
        const prepareMs = Date.now() - tp;
        const [row] = await db.select().from(applications).where(eq(applications.id, appId));
        const events: { step: string; message: string; data?: Record<string, unknown> }[] = [];
        const ctx: DriverContext = {
          applicationId: appId, applyUrl: t.url, profile: APPLICANT_PROFILE, resumePdfPath: resumePath, answers: row!.answers, dryRun: true,
          onEvent: (step, message, data) => { events.push({ step, message, data }); },
        };
        if (submitAllowed(ctx)) throw new Error("refusing: submit would be allowed");
        const tf = Date.now();
        const run = await pool.run(`live-${id}`, async (page, h) => {
          const fill: FillResult = await DRIVER[ats].fill(page, ctx);
          const frames = page.frames().map((f) => f.url()).filter((u) => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(u)).map((u) => u.replace(/[?&]k=[^&]+/, "&k=…").slice(0, 110));
          const challenge = await detectCaptcha(page);
          const shot = path.join(samples, `${id}.png`);
          await page.screenshot({ path: shot, fullPage: true, timeout: 15_000 }).catch(() => {});
          h.keepArtifacts();
          return { fill, frames, challenge, shot };
        }, { timeoutMs: 120_000 });
        const fillMs = Date.now() - tf;
        const { fill, frames, challenge, shot } = run.value;
        const r = {
          id, url: t.url, prepare: { outcome: prep.outcome, reason: prep.reason, source: prep.schema?.source, recipeHit: prep.recipeHit, pending: prep.pending.map((p) => p.text), ms: prepareMs },
          fill: { status: fill.status, needsUser: fill.needsUser, filled: fill.fields.length, files: fill.files.length, pending: fill.pending.map((p) => p.text), timings: fill.timings, ms: fillMs },
          captcha: { challenge, frames }, costUsd: ledger.totalUsd() - before, screenshot: path.relative(root, shot), trace: run.artifacts.tracePath,
          submitClicked: events.some((e) => e.step === "submit"),
          problems: events.filter((e) => /field_error|validation|captcha|verification/.test(e.step)).map((e) => e.message.slice(0, 200)),
          slowest: events.filter((e) => e.step === "field_filled" && typeof e.data?.ms === "number").sort((a, b) => Number(b.data!.ms) - Number(a.data!.ms)).slice(0, 4).map((e) => `${String(e.data!.label).slice(0, 40)}: ${e.data!.ms} ms (${e.data!.strategy})`),
        };
        results.push(r);
        console.log(`${id}: prepare ${prep.outcome} ${(prepareMs / 1000).toFixed(1)} s (${prep.schema?.source ?? "-"}${prep.recipeHit ? ", recipe hit" : ""}), fill ${fill.status} ${fill.fields.length} fields, ready ${((fill.timings?.readyMs ?? fillMs) / 1000).toFixed(1)} s, captcha challenge: ${challenge ?? "none"} (frames: ${frames.length}), $${r.costUsd.toFixed(4)}`);
        if (fill.needsUser) console.log(`    needs_user ${fill.needsUser.kind}: ${fill.needsUser.reason}`);
        for (const pr of r.problems) console.log(`    problem: ${pr}`);
        console.log(`    timings: ${JSON.stringify(fill.timings)} slowest: ${r.slowest.join("; ")}`);
        if (fill.pending.length) console.log(`    pending: ${fill.pending.map((p) => p.text.slice(0, 60)).join(" | ")}`);
        await new Promise((res) => setTimeout(res, 2000)); // polite gap between sites
      }
    }
  } finally {
    await pool.close();
    await handle.close();
  }
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify({ at: new Date().toISOString(), results, ledgerUsd: ledger.totalUsd() }, null, 1));
  console.log(`ledger total: $${ledger.totalUsd().toFixed(4)} of $0.30`);
}

main().catch((err) => { console.error(err); process.exit(1); });
