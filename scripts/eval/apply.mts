/**
 * Auto-apply eval. For every saved application page in packages/apply/src/fixtures/forms (Greenhouse, Lever, Ashby; see
 * apply-fixtures.mts), with a fictional applicant ("Test Applicant", an @norinote.test address):
 *   1. read the form schema (Greenhouse: the saved public questions JSON; Lever and Ashby: the page, read without filling),
 *   2. build the answer plan (profile slots, answer bank, at most one small and one large model call per form),
 *   3. replay the fill on the local copy (served from 127.0.0.1 with a widget shim; submit stubbed, never clicked),
 * and compare against the hand-labelled field map in forms/expected.json. Prints and writes the metrics: field (slot)
 * accuracy, discovery accuracy, unknown-field rate, fill read-back rate, time to ready, model cost.
 *
 *   npx tsx scripts/eval/apply.mts [--model] [--only id,id] [--draft] [--out docs/eval/apply-run1.md] [--json scripts/eval/results/apply-run1.json]
 *
 * --model uses the real models (OPENAI_API_KEY from .env, never printed), every call checked against the spend ledger
 * scripts/eval/results/apply-spend-ledger.json; the cap is $0.30 for all apply eval and live dry-run spend and cannot be
 * raised. Without --model the plan runs with noModel (what would go to a model becomes pending).
 * --live runs the live dry runs instead (scripts/eval/apply-live.mts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider, setProvider } from "@norinote/ai";
import { planForm, type FormPlan, type Slot } from "@norinote/answers";
import { companies, connect, jobs, loadDotEnv, migrate, type Db } from "@norinote/db";
import {
  ashbyDriver, createBrowserPool, discoverFields, greenhouseDriver, greenhouseSchemaFromJson, leverDriver, schemaFieldsFromDom, formFingerprint,
  loadRecipe, saveRecipe, labelKey, type Driver, type DriverContext, type FillResult, type SchemaField, type GreenhouseJobJson,
} from "@norinote/apply";
import { Ledger, instrumentProvider } from "./lib/spend.js";
import { seedApplicant, APPLICANT_PROFILE } from "./lib/applicant.js";
import { startFormServer, formFixtures, FORMS_DIR, type FormFixture } from "../../packages/apply/src/test-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
export const HARD_CAP_USD = 0.30;
const useModel = flag("model");
const only = opt("only")?.split(",").filter(Boolean);
const outMd = path.resolve(root, opt("out", "docs/eval/apply-run1.md")!);
const outJson = path.resolve(root, opt("json", "scripts/eval/results/apply-run1.json")!);
const dbDir = path.resolve(opt("db", path.join(os.tmpdir(), "norinote-apply-eval"))!);

process.env.AI_DAILY_TOKEN_BUDGET = "0"; // the ledger is the budget
delete process.env.ALLOW_REAL_SUBMIT; // replay never submits
const ledger = new Ledger(path.join(here, "results", "apply-spend-ledger.json"), HARD_CAP_USD);
if (useModel) {
  const real = getProvider();
  if (real.name !== "openai") throw new Error("OPENAI_API_KEY is not set: --model needs the real model.");
  setProvider(instrumentProvider(real, ledger));
  ledger.phase = "eval";
}

type Expected = Record<string, Record<string, { slot: Slot; required?: boolean; label?: string }>>;
const expectedPath = path.join(FORMS_DIR, "expected.json");
const expected: Expected = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) as Expected : {};

const DRIVER: Record<FormFixture["ats"], Driver> = { greenhouse: greenhouseDriver, lever: leverDriver, ashby: ashbyDriver };
const PREFERRED = [".ashby-application-form-container", "form#application-form", "#application_form", "#application-form", "form.application--form"];

type Row = {
  id: string; ats: string; fields: number; required: number;
  slotCorrect: number; slotTotal: number; slotMisses: string[];
  discovered: number; discoveryExpected: number; requiredFlagCorrect: number;
  ready: number; pendingRequired: number; skipped: number;
  filled: number; fillTargets: number; fillMisses: string[];
  readyMs: number; planMs: number; costMicros: number; smallCalls: number; largeCalls: number;
  sources: Record<string, number>; recipeHit: boolean; status: string; needsUser?: string;
  modelAnswers: { label: string; source: string; value: string }[]; pending: { label: string; reason: string }[];
};

async function main() {
  const fixtures = (await formFixtures()).filter((f) => !only || only.includes(f.id));
  if (!fixtures.length) throw new Error("No fixtures: run scripts/eval/apply-fixtures.mts first.");
  mkdirSync(dbDir, { recursive: true });
  const handle = await connect({ pgliteDir: dbDir });
  await migrate(handle);
  const db = handle.db;
  const { userId, resumePath } = await seedApplicant(db);
  const server = await startFormServer();
  const pool = createBrowserPool({ size: 2, artifactsDir: path.join(os.tmpdir(), "norinote-apply-eval-artifacts"), spareContexts: 1 });
  await pool.warmUp();
  const rows: Row[] = [];
  const draft: Expected = {};

  try {
    for (const fx of fixtures) {
      const localUrl = `${server.origin}/forms/${fx.id}.html`;
      const jobId = await ensureJob(db, fx);
      // 1. schema
      let fields: SchemaField[];
      let domFields: { key?: string | null; label: string; required: boolean }[] = [];
      const gh = path.join(FORMS_DIR, `${fx.id}.gh.json`);
      const read = await pool.run(`read-${fx.id}`, async (page) => {
        await page.goto(localUrl, { waitUntil: "domcontentloaded" });
        return discoverFields(page, PREFERRED, { comboOptions: true });
      });
      domFields = read.value;
      if (fx.ats === "greenhouse" && existsSync(gh)) fields = greenhouseSchemaFromJson(JSON.parse(readFileSync(gh, "utf8")) as GreenhouseJobJson, fx.company, fx.jobId).fields;
      else fields = schemaFieldsFromDom(read.value);

      // 2. plan (recipe hints as production does)
      const fingerprint = formFingerprint(fx.ats, fx.company, fields);
      const recipe = await loadRecipe(db, fingerprint);
      const hints = new Map((recipe?.fields ?? []).map((f) => [`${f.labelKey}|${f.type}`, f.slot]));
      const before = ledger.totalUsd();
      let plan: FormPlan;
      try {
        plan = await planForm(db, { userId, jobId, noModel: !useModel, fields: fields.map((f) => ({ ...f, slotHint: hints.get(`${labelKey(f.label)}|${f.type}`) ?? null })) });
      } catch (err) {
        console.log(`${fx.id}: plan failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      await saveRecipe(db, { fingerprint, ats: fx.ats, companyToken: fx.company, fields: fields.map((f) => ({ labelKey: labelKey(f.label), label: f.label, type: f.type, slot: (plan.learned[labelKey(f.label)] ?? plan.entries.find((e) => e.key === f.key)?.slot ?? "custom") as Slot })) });
      const costMicros = Math.round((ledger.totalUsd() - before) * 1_000_000) || plan.usage.costMicros;

      // 3. replay the fill on the local copy, dry run
      const events: { step: string; data?: Record<string, unknown> }[] = [];
      const ctx: DriverContext = {
        applicationId: fx.id, applyUrl: localUrl, profile: APPLICANT_PROFILE, resumePdfPath: resumePath, answers: plan.answers, dryRun: true,
        onEvent: (step, _m, data) => { events.push({ step, data }); },
      };
      const fill = (await pool.run(`fill-${fx.id}`, (page) => DRIVER[fx.ats].fill(page, ctx), { timeoutMs: 90_000 })).value as FillResult;

      // metrics
      const exp = expected[fx.id] ?? {};
      draft[fx.id] = Object.fromEntries(plan.entries.map((e) => [e.key, { slot: e.slot, required: e.required, label: e.label.slice(0, 90) }]));
      let slotCorrect = 0;
      const slotMisses: string[] = [];
      for (const [key, want] of Object.entries(exp)) {
        const got = plan.entries.find((e) => e.key === key);
        if (got && got.slot === want.slot) slotCorrect++;
        else slotMisses.push(`${key}: want ${want.slot}, got ${got?.slot ?? "missing"}`);
      }
      // Discovery: every schema field the page must show (Greenhouse: the API's list; others: the labelled map).
      const wantKeys = fx.ats === "greenhouse" ? fields.filter((f) => !/^gdpr_processing/.test(f.key)).map((f) => ({ key: f.key, required: f.required, label: f.label })) : Object.keys(exp).map((k) => ({ key: k, required: exp[k]!.required ?? false, label: k }));
      let discovered = 0, requiredFlagCorrect = 0;
      for (const w of wantKeys) {
        const d = domFields.find((x) => x.key === w.key || (w.key === "location" && /location/i.test(x.label)) || labelKey(x.label) === labelKey(w.label));
        if (d) { discovered++; if (d.required === w.required) requiredFlagCorrect++; }
      }
      const filledLabels = new Set(fill.fields.map((f) => labelKey(f.label)));
      // Fields the saved page does not show (Greenhouse reveals Race only after the Hispanic/Latino answer) cannot be replayed.
      const onPage = (e: { key: string; label: string }) => domFields.some((x) => x.key === e.key || labelKey(x.label) === labelKey(e.label) || (e.key === "location" && /location/i.test(x.label)));
      const targets = plan.entries.filter((e) => e.status === "ready" && onPage(e));
      const fillMisses = targets.filter((e) => !filledLabels.has(labelKey(e.label)) && !fill.fields.some((f) => labelKey(f.label).startsWith(labelKey(e.label).slice(0, 25))))
        .map((e) => `${e.label.slice(0, 50)} (${e.type})`);
      const timing = events.filter((e) => e.step === "timing").at(-1)?.data as { readyMs?: number } | undefined;
      const sources: Record<string, number> = {};
      for (const e of plan.entries) if (e.source) sources[e.source] = (sources[e.source] ?? 0) + 1;
      const row: Row = {
        id: fx.id, ats: fx.ats, fields: plan.entries.length, required: plan.entries.filter((e) => e.required).length,
        slotCorrect, slotTotal: Object.keys(exp).length, slotMisses,
        discovered, discoveryExpected: wantKeys.length, requiredFlagCorrect,
        ready: targets.length, pendingRequired: plan.pending.length, skipped: plan.entries.filter((e) => e.status === "skip").length,
        filled: targets.length - fillMisses.length, fillTargets: targets.length, fillMisses,
        readyMs: timing?.readyMs ?? fill.durationMs, planMs: plan.timings.totalMs ?? 0, costMicros, smallCalls: plan.usage.smallCalls, largeCalls: plan.usage.largeCalls,
        sources, recipeHit: !!recipe, status: fill.status,
        modelAnswers: plan.entries.filter((e) => e.source === "model" || e.source === "large").map((e) => ({ label: e.label, source: e.source!, value: e.value ?? "" })),
        pending: plan.entries.filter((e) => e.status === "pending").map((e) => ({ label: e.label, reason: e.reason ?? "" })), ...(fill.needsUser ? { needsUser: fill.needsUser.kind } : {}),
      };
      rows.push(row);
      console.log(`${fx.id}: slots ${slotCorrect}/${row.slotTotal}, found ${discovered}/${wantKeys.length}, pending ${row.pendingRequired}/${row.required} required, filled ${row.filled}/${row.fillTargets}, ready ${(row.readyMs / 1000).toFixed(1)} s, $${(costMicros / 1e6).toFixed(4)}${recipe ? " (recipe hit)" : ""}`);
      for (const m of slotMisses) console.log(`    slot miss  ${m}`);
      for (const m of fillMisses) console.log(`    fill miss  ${m}`);
    }
  } finally {
    await pool.close();
    await server.close();
    await handle.close();
  }

  if (flag("draft")) writeFileSync(path.join(FORMS_DIR, "expected.draft.json"), JSON.stringify(draft, null, 1));
  const summary = summarise(rows);
  console.log("\n" + summary.text);
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify({ at: new Date().toISOString(), model: useModel, rows, summary: summary.numbers, ledgerUsd: ledger.totalUsd() }, null, 1));
  if (!flag("no-md")) writeFileSync(outMd + ".metrics.txt", summary.text);
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");

function summarise(rows: Row[]) {
  const sum = (f: (r: Row) => number, rs = rows) => rs.reduce((s, r) => s + f(r), 0);
  const by = (ats: string) => rows.filter((r) => r.ats === ats);
  const lines = ["system      forms  slot acc   discovery  req-flag   unknown(req)  fill read-back  ready p50  cost/form"];
  const numbers: Record<string, unknown> = {};
  for (const ats of ["greenhouse", "lever", "ashby", "all"]) {
    const rs = ats === "all" ? rows : by(ats);
    if (!rs.length) continue;
    const ready = rs.map((r) => r.readyMs).sort((a, b) => a - b);
    const p50 = ready[Math.floor(ready.length / 2)] ?? 0;
    const cost = sum((r) => r.costMicros, rs) / rs.length / 1e6;
    numbers[ats] = {
      forms: rs.length, slotAccuracy: sum((r) => r.slotCorrect, rs) / Math.max(1, sum((r) => r.slotTotal, rs)),
      discovery: sum((r) => r.discovered, rs) / Math.max(1, sum((r) => r.discoveryExpected, rs)),
      requiredFlag: sum((r) => r.requiredFlagCorrect, rs) / Math.max(1, sum((r) => r.discovered, rs)),
      unknownRequiredRate: sum((r) => r.pendingRequired, rs) / Math.max(1, sum((r) => r.required, rs)),
      fillReadBack: sum((r) => r.filled, rs) / Math.max(1, sum((r) => r.fillTargets, rs)),
      readyP50Ms: p50, costPerFormUsd: cost, maxCostUsd: Math.max(...rs.map((r) => r.costMicros)) / 1e6,
    };
    lines.push(`${ats.padEnd(11)} ${String(rs.length).padStart(5)}  ${pct(sum((r) => r.slotCorrect, rs), sum((r) => r.slotTotal, rs)).padStart(8)}  ${pct(sum((r) => r.discovered, rs), sum((r) => r.discoveryExpected, rs)).padStart(9)}  ${pct(sum((r) => r.requiredFlagCorrect, rs), sum((r) => r.discovered, rs)).padStart(8)}  ${pct(sum((r) => r.pendingRequired, rs), sum((r) => r.required, rs)).padStart(12)}  ${pct(sum((r) => r.filled, rs), sum((r) => r.fillTargets, rs)).padStart(14)}  ${(p50 / 1000).toFixed(1).padStart(7)} s  $${cost.toFixed(4)}`);
  }
  lines.push(`ledger total (all apply eval and live spend): $${ledger.totalUsd().toFixed(4)} of $${HARD_CAP_USD.toFixed(2)}`);
  return { text: lines.join("\n"), numbers };
}

async function ensureJob(db: Db, fx: FormFixture): Promise<string> {
  const [co] = await db.insert(companies).values({ atsType: fx.ats, atsToken: fx.company, name: fx.company.replace(/^\w/, (c) => c.toUpperCase()) })
    .onConflictDoUpdate({ target: [companies.atsType, companies.atsToken], set: { name: fx.company.replace(/^\w/, (c) => c.toUpperCase()) } }).returning();
  const [job] = await db.insert(jobs).values({
    companyId: co!.id, atsType: fx.ats, externalId: fx.jobId, title: fx.title, applyUrl: fx.url, dedupeKey: `eval|${fx.id}`,
    descriptionText: `${fx.title} at ${co!.name}.`,
  }).onConflictDoUpdate({ target: [jobs.atsType, jobs.externalId], set: { title: fx.title } }).returning();
  return job!.id;
}

main().catch((err) => { console.error(err); process.exit(1); });
