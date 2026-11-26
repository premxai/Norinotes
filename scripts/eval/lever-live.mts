/**
 * Lever readiness: dry-fill a list of fresh public Lever postings with the fictional applicant and measure the fill rate.
 * Prepare (page schema, plan, rule-based fallback without a model key) and fill run for real; the run stops before
 * submit: ALLOW_REAL_SUBMIT is forced off, dryRun is true, and submit is never called. One posting at a time, 2 s apart.
 *
 *   npx tsx scripts/eval/lever-live.mts --targets <targets.json> [--json <out.json>] [--html <dir>]
 *
 * targets.json: [{ company, token, id, title, location, url }], from scripts/eval/lever-targets.mts.
 * Per form: required fields present (discovered with a required mark), required fields filled, and each required field
 * left empty with its cause: asked of the person with a readable label and no profile answer (correctly routed: factual,
 * legal, consent and custom questions are never drafted), or a miss (label not read, profile answer not filled, dropped).
 * --html saves each form's HTML (only the fictional applicant's values) for building sanitized fixtures.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applications, companies, connect, eq, jobs, loadDotEnv, migrate, resumes, type Db } from "@norinote/db";
import { createApplication, createBrowserPool, leverDriver, prepareForm, submitAllowed, type DriverContext, type FillResult } from "@norinote/apply";
import { classifySlot, EEO_SLOTS, LEGAL_SLOTS, questionKind } from "@norinote/answers";
import { seedApplicant, APPLICANT_PROFILE } from "./lib/applicant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
loadDotEnv(path.join(root, ".env"));
delete process.env.ALLOW_REAL_SUBMIT;
process.env.AI_DAILY_TOKEN_BUDGET = "0";
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const targetsFile = opt("targets");
if (!targetsFile) { console.error("Pass --targets <targets.json>"); process.exit(2); }
const outJson = path.resolve(opt("json", path.join(os.tmpdir(), "lever-live.json"))!);
const htmlDir = opt("html");
const onlyIds = opt("ids")?.split(",");

type Target = { company: string; token: string; id: string; title: string; location: string; url: string };
const targets = (JSON.parse(readFileSync(targetsFile, "utf8")) as Target[]).filter((t) => !onlyIds || onlyIds.includes(t.id));
const norm = (s: string) => s.toLowerCase().replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();

/** Slots the fictional applicant's profile answers (contact, links, career facts, work authorisation, salary, start date, relocation, EEO decline). */
const PROFILE_SLOTS = new Set(["first_name", "last_name", "full_name", "email", "phone", "phone_country", "linkedin", "github", "website", "location", "city", "state", "country", "zip",
  "resume", "current_company", "current_title", "school", "degree", "discipline", "work_auth", "sponsorship", "salary", "relocation", "start_date",
  "eeo_gender", "eeo_race", "eeo_hispanic", "eeo_veteran", "eeo_disability"]);
const UNREAD_LABEL = /^(|type your response|select\.*|select an option|choose\.*|enter.*|your answer)$/i;
type Missing = { label: string; kind: string; widget?: string; cause: string; kindOfQuestion: string };

/**
 * Why a required field was left empty. "person" (correctly routed) is a question only the person can answer, asked as a
 * pending question with a readable label: factual, legal or consent questions Norinote never drafts, and custom questions
 * the profile has no answer for. Everything else is a miss of the driver.
 */
function cause(f: { label: string; kind: string }, pendingTexts: Set<string>): string {
  if (UNREAD_LABEL.test(norm(f.label))) return "label not read";
  const slot = classifySlot({ key: f.label, label: f.label, type: f.kind === "select" ? "select" : f.kind === "radio" ? "radio" : f.kind === "checkbox" ? "checkbox" : f.kind === "file" ? "file" : "text", required: true, options: [] });
  if (PROFILE_SLOTS.has(slot)) return `profile answer not filled (${slot})`;
  if (!pendingTexts.has(norm(f.label))) return "dropped (neither filled nor asked)";
  return "person";
}
const kindOfQuestion = (label: string) => {
  const slot = classifySlot({ key: label, label, type: "text", required: true, options: [] });
  return LEGAL_SLOTS.has(slot) || EEO_SLOTS.has(slot) ? slot : questionKind(label);
};

async function ensureJob(db: Db, t: Target): Promise<string> {
  const [co] = await db.insert(companies).values({ atsType: "lever", atsToken: t.token, name: t.company })
    .onConflictDoUpdate({ target: [companies.atsType, companies.atsToken], set: { name: t.company } }).returning();
  const [job] = await db.insert(jobs).values({ companyId: co!.id, atsType: "lever", externalId: t.id, title: t.title, applyUrl: t.url, dedupeKey: `lever-live|${t.id}`, descriptionText: `${t.title} at ${t.company}.` })
    .onConflictDoUpdate({ target: [jobs.atsType, jobs.externalId], set: { applyUrl: t.url } }).returning();
  return job!.id;
}

async function main() {
  const handle = await connect({ pgliteDir: path.join(os.tmpdir(), `norinote-lever-live-${Date.now()}`) });
  await migrate(handle);
  const db = handle.db;
  const { userId, resumePath } = await seedApplicant(db);
  if (htmlDir) mkdirSync(htmlDir, { recursive: true });
  const pool = createBrowserPool({ size: 1, artifactsDir: path.join(os.tmpdir(), "norinote-lever-live-artifacts"), spareContexts: 1 });
  await pool.warmUp();
  const results: Record<string, unknown>[] = [];
  try {
    for (const t of targets) {
      const jobId = await ensureJob(db, t);
      const app = await createApplication(db, userId, jobId);
      const appId = app.application!.id;
      const [resume] = await db.insert(resumes).values({ applicationId: appId, content: {}, pdfPath: resumePath }).returning();
      await db.update(applications).set({ status: "preparing", resumeId: resume!.id, receipt: null, answers: {}, pendingQuestions: [] }).where(eq(applications.id, appId));
      let row: typeof applications.$inferSelect | undefined;
      let prep: Awaited<ReturnType<typeof prepareForm>> | null = null;
      try {
        prep = await prepareForm(db, appId, { pool });
        [row] = await db.select().from(applications).where(eq(applications.id, appId));
      } catch (err) {
        console.log(`${t.token}/${t.id}: prepare threw ${String(err).slice(0, 200)}`);
      }
      const events: { step: string; message: string; data?: Record<string, unknown> }[] = [];
      const ctx: DriverContext = {
        applicationId: appId, applyUrl: t.url, profile: APPLICANT_PROFILE, resumePdfPath: resumePath, answers: row?.answers ?? {}, dryRun: true,
        onEvent: (step, message, data) => { events.push({ step, message, data }); },
        recordSubmitClick: async () => { throw new Error("live dry runs never submit"); },
      };
      if (submitAllowed(ctx)) throw new Error("refusing: submit would be allowed");
      let fill: FillResult;
      try {
        fill = (await pool.run(`lever-${t.id}`, async (page) => {
          const f = await leverDriver.fill(page, ctx);
          if (htmlDir) {
            const html = await page.locator("form").first().evaluate((el) => el.outerHTML).catch(() => "");
            writeFileSync(path.join(htmlDir, `${t.token}-${t.id.slice(0, 8)}.html`), html);
          }
          return f;
        }, { timeoutMs: 120_000 })).value;
      } catch (err) {
        fill = { status: "failed", formUrl: null, fields: [], files: [], pending: [], error: String(err).slice(0, 300), durationMs: 0 };
      }
      const discovered = (events.find((e) => e.step === "discovered")?.data?.fields ?? []) as { label: string; kind: string; required: boolean; widget?: string }[];
      const filledLabels = new Set([...fill.fields.map((f) => norm(f.label)), ...fill.files.map((f) => norm(f.label))]);
      const required = discovered.filter((f) => f.required);
      const missing = required.filter((f) => !filledLabels.has(norm(f.label)));
      const pendingTexts = new Set(fill.pending.map((p) => norm(p.text)));
      const classified: Missing[] = missing.map((f) => ({ label: f.label, kind: f.kind, widget: f.widget, cause: cause(f, pendingTexts), kindOfQuestion: kindOfQuestion(f.label) }));
      const routed = classified.filter((m) => m.cause === "person");
      const missed = classified.filter((m) => m.cause !== "person");
      const fullyFillable = fill.status !== "failed" && required.length > 0 && missed.length === 0;
      const r = {
        company: t.company, token: t.token, id: t.id, url: t.url,
        prepare: prep ? { outcome: prep.outcome, reason: prep.reason, source: prep.schema?.source, pending: prep.pending.map((p) => p.text) } : null,
        status: fill.status, needsUser: fill.needsUser, error: fill.error,
        requiredPresent: required.length, requiredFilled: required.length - missing.length,
        routed, missed,
        pending: fill.pending.map((p) => p.text), filled: fill.fields.length, values: events.filter((e) => e.step === "field_filled").map((e) => ({ label: String(e.data?.label), value: String(e.data?.value), source: String(e.data?.source) })), files: fill.files.length, fullyFillable,
        problems: events.filter((e) => /error|unresolved|validation|captcha|verification|form_not_found/.test(e.step)).map((e) => `${e.step}: ${e.message.slice(0, 160)}`),
        discovered,
      };
      results.push(r);
      console.log(`${t.token}/${t.id.slice(0, 8)}: ${fill.status}${fill.needsUser ? ` (${fill.needsUser.kind})` : ""}${fill.error ? ` [${fill.error.slice(0, 80)}]` : ""} required ${r.requiredFilled}/${r.requiredPresent}, routed ${routed.length}, missed ${missed.length}${missed.length ? `: ${missed.map((m) => `${m.label.slice(0, 50)} <${m.widget ?? m.kind}> [${m.cause}]`).join(" | ")}` : ""}`);
      await new Promise((res) => setTimeout(res, 2000));
    }
  } finally {
    await pool.close();
    await handle.close();
  }
  const forms = results.length;
  const present = results.reduce((n, r) => n + (r.requiredPresent as number), 0);
  const filled = results.reduce((n, r) => n + (r.requiredFilled as number), 0);
  const routed = results.reduce((n, r) => n + (r.routed as Missing[]).length, 0);
  const causes: Record<string, number> = {};
  for (const r of results) for (const m of r.missed as Missing[]) { const k = m.cause.replace(/ \(.*\)$/, ""); causes[k] = (causes[k] ?? 0) + 1; }
  for (const r of results) if (r.status === "failed") causes[`form failed: ${String(r.error).slice(0, 60)}`] = (causes[`form failed: ${String(r.error).slice(0, 60)}`] ?? 0) + 1;
  const fully = results.filter((r) => r.fullyFillable).length;
  const summary = { forms, requiredPresent: present, requiredFilled: filled, routedToPerson: routed, fillRate: present ? filled / present : 0, handledRate: present ? (filled + routed) / present : 0, fullyFillable: fully, missesByCause: causes };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1));
  console.log(JSON.stringify(summary));
}

main().catch((err) => { console.error(err); process.exit(1); });
