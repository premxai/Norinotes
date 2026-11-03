/**
 * Prepare an application's form before the click (`prepare.application`): read the form schema, look the form up in the
 * recipe cache, build the answer plan (profile slots, answer bank, at most one small and one large model call), store
 * the answers on the application and the classifications in the cache. Required questions nobody can answer come back as
 * pending, so the person answers them (batched with every other pending question) before the click, not after.
 */
import { planForm, type FormPlan, type Slot } from "@norinote/answers";
import { applications, companies, eq, jobs, type Db } from "@norinote/db";
import type { PendingQuestion } from "@norinote/shared";
import { detectDriver } from "./drivers/index.js";
import { WORKDAY_REASON, NOT_YET_REASON } from "./drivers/stubs.js";
import { discoverFields, PREFERRED_FORM_SELECTORS } from "./form.js";
import type { BrowserPool } from "./pool.js";
import { labelKey, loadRecipe, saveRecipe, touchRecipe, type RecipeField } from "./recipes.js";
import { fetchGreenhouseSchema, formFingerprint, parseJobUrl, schemaFieldsFromDom, type FormSchema } from "./schema.js";
import { loadApplication, logEvent, saveAnswers } from "./store.js";

export type PrepareFormDeps = {
  /** Warm browser pool, for forms read from the page (Lever, Ashby, Greenhouse when its API fails). */
  pool?: BrowserPool;
  fetch?: typeof fetch;
  /** No model calls (tests, budget exhausted). */
  noModel?: boolean;
};

export type PrepareFormResult = {
  outcome: "prepared" | "needs_user" | "failed";
  reason?: string;
  pending: PendingQuestion[];
  schema?: FormSchema;
  plan?: FormPlan;
  fingerprint?: string;
  recipeHit?: boolean;
  timings: Record<string, number>;
};


/** Read a form from the page without filling anything. */
export async function readFormFromPage(pool: BrowserPool, url: string, label: string): Promise<ReturnType<typeof schemaFieldsFromDom>> {
  const run = await pool.run(`read-${label}`, async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("input:not([type=hidden]), textarea").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
    const deny = page.getByRole("button", { name: /^(deny|decline|reject( all)?)$/i }).first();
    if (await deny.isVisible().catch(() => false)) await deny.click({ timeout: 2000 }).catch(() => {});
    const preferred = [".ashby-application-form-container", ...PREFERRED_FORM_SELECTORS, "form.application--form"];
    return discoverFields(page, preferred, { comboOptions: true });
  }, { timeoutMs: 60_000 });
  return schemaFieldsFromDom(run.value);
}

/** Read the schema for an apply URL: Greenhouse's public API, else the page itself. Null when no form could be read. */
export async function loadFormSchema(applyUrl: string, deps: PrepareFormDeps): Promise<FormSchema | null> {
  const parsed = parseJobUrl(applyUrl);
  const driver = detectDriver(applyUrl);
  if (parsed?.ats === "greenhouse" && parsed.token) {
    const api = await fetchGreenhouseSchema(parsed.token, parsed.jobId, deps.fetch ? { fetch: deps.fetch } : {}).catch(() => null);
    if (api && api.fields.length) return api;
  }
  if (!deps.pool || !driver) return null;
  const formUrl = driver.formUrl(applyUrl) ?? applyUrl;
  const fields = await readFormFromPage(deps.pool, formUrl, parsed?.ats ?? "form");
  if (!fields.length) return null;
  return { ats: parsed?.ats ?? "unknown", companyToken: parsed?.token ?? new URL(applyUrl).hostname, jobId: parsed?.jobId ?? "", formUrl, source: "dom", fields };
}

export async function prepareForm(db: Db, applicationId: string, deps: PrepareFormDeps = {}): Promise<PrepareFormResult> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const row = await loadApplication(db, applicationId);
  if (!row) return { outcome: "failed", reason: "application not found", pending: [], timings };
  const [job] = await db.select({ applyUrl: jobs.applyUrl, company: companies.name }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, row.jobId)).limit(1);
  if (!job) return { outcome: "failed", reason: "job not found", pending: [], timings };

  const driver = detectDriver(job.applyUrl);
  if (driver?.name === "workday") return { outcome: "needs_user", reason: WORKDAY_REASON, pending: [], timings };
  if (driver && ["smartrecruiters", "workable", "icims"].includes(driver.name)) {
    return { outcome: "needs_user", reason: NOT_YET_REASON(driver.name === "icims" ? "iCIMS" : driver.name === "smartrecruiters" ? "SmartRecruiters" : "Workable"), pending: [], timings };
  }
  if (!driver) return { outcome: "needs_user", reason: "This form type is not supported yet: open the posting and apply yourself.", pending: [], timings };

  let schema: FormSchema | null = null;
  try {
    schema = await loadFormSchema(job.applyUrl, deps);
  } catch (err) {
    await logEvent(db, applicationId, "prepare_form_warn", `Could not read the form ahead of time: ${err instanceof Error ? err.message : String(err)}`, { level: "warn" });
  }
  timings.schemaMs = Date.now() - t0;
  if (!schema) {
    // The form is read again at the click; prepared answers for the standard questions still apply.
    await logEvent(db, applicationId, "prepare_form", "Form schema not available ahead of time; it will be read at the click", { level: "warn", data: { timings } });
    return { outcome: "prepared", pending: [], timings };
  }

  const fingerprint = formFingerprint(schema.ats, schema.companyToken, schema.fields);
  const recipe = await loadRecipe(db, fingerprint);
  // Keyed by label and type: two fields may share a label ("Phone" and the SMS consent under it).
  const hints = new Map<string, Slot>((recipe?.fields ?? []).map((f) => [`${f.labelKey}|${f.type}`, f.slot]));
  const plan = await planForm(db, {
    userId: row.userId, jobId: row.jobId, explicit: row.answers, noModel: deps.noModel,
    fields: schema.fields.map((f) => ({ ...f, slotHint: hints.get(`${labelKey(f.label)}|${f.type}`) ?? null })),
  });
  timings.planMs = plan.timings.totalMs ?? 0;

  // Answers keyed field:<key>; the person's own answers already on the application always win.
  const fresh: Record<string, string> = {};
  for (const [k, v] of Object.entries(plan.answers)) if (row.answers[k] === undefined) fresh[k] = v;
  if (Object.keys(fresh).length) await saveAnswers(db, applicationId, fresh);

  const fields: RecipeField[] = schema.fields.map((f) => ({ labelKey: labelKey(f.label), label: f.label, type: f.type, slot: (plan.learned[labelKey(f.label)] ?? plan.entries.find((e) => e.key === f.key)?.slot ?? "custom") as Slot }));
  if (recipe) await touchRecipe(db, fingerprint);
  if (!recipe || fields.some((f) => !hints.has(`${f.labelKey}|${f.type}`))) await saveRecipe(db, { fingerprint, ats: schema.ats, companyToken: schema.companyToken, fields });

  const counts = { fields: plan.entries.length, ready: plan.entries.filter((e) => e.status === "ready").length, pending: plan.pending.length, skipped: plan.entries.filter((e) => e.status === "skip").length };
  const sources: Record<string, number> = {};
  for (const e of plan.entries) if (e.source) sources[e.source] = (sources[e.source] ?? 0) + 1;
  timings.totalMs = Date.now() - t0;
  const prepared = { fingerprint, ats: schema.ats, schemaSource: schema.source, recipeHit: !!recipe, ...counts, sources, usage: plan.usage, timings, at: new Date().toISOString() };
  const latest = await loadApplication(db, applicationId);
  await db.update(applications).set({ receipt: { ...(latest?.receipt ?? {}), prepared }, updatedAt: new Date() }).where(eq(applications.id, applicationId));
  await logEvent(db, applicationId, "prepare_form", `Form read (${schema.source}${recipe ? ", recipe hit" : ""}): ${counts.ready} of ${counts.fields} fields ready, ${counts.pending} pending`, { data: prepared });

  if (plan.pending.length) {
    const n = plan.pending.length;
    return { outcome: "needs_user", reason: `The form asks ${n} question${n === 1 ? "" : "s"} only you can answer.`, pending: plan.pending, schema, plan, fingerprint, recipeHit: !!recipe, timings };
  }
  return { outcome: "prepared", pending: [], schema, plan, fingerprint, recipeHit: !!recipe, timings };
}
