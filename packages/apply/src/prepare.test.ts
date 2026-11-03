import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, careerPoints, companies, eq, formRecipes, jobs, profiles, runEvents, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  canonicalJobUrl, CompanyGate, createApplication, formFingerprint, greenhouseSchemaFromJson, loadRecipe, parseJobUrl, prepareForm, recordStrategies, saveRecipe,
  type GreenhouseJobJson,
} from "./index.js";
import { detectDriver } from "./drivers/index.js";
import { FORMS_DIR } from "./test-helpers.js";

const ghJson = JSON.parse(readFileSync(path.join(FORMS_DIR, "greenhouse-discord-88407560.gh.json"), "utf8")) as GreenhouseJobJson;

describe("job URLs", () => {
  it("parses each system and folds every link to one canonical URL per posting", () => {
    expect(parseJobUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=12")).toEqual({ ats: "greenhouse", token: "acme", jobId: "12" });
    expect(parseJobUrl("https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b/apply")).toMatchObject({ ats: "lever", token: "leverdemo" });
    expect(parseJobUrl("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/NYC/Engineer_R1")?.ats).toBe("workday");
    const same = [
      "https://boards.greenhouse.io/acme/jobs/12?gh_src=x", "https://job-boards.greenhouse.io/acme/jobs/12#app", "https://boards.greenhouse.io/embed/job_app?for=acme&token=12",
    ].map(canonicalJobUrl);
    expect(new Set(same)).toEqual(new Set(["https://job-boards.greenhouse.io/acme/jobs/12"]));
    expect(canonicalJobUrl("https://jobs.lever.co/Acme/ABC/apply?lever-source=x")).toBe("https://jobs.lever.co/acme/abc");
    expect(canonicalJobUrl("https://careers.acme.com/jobs/42/apply?utm=1")).toBe("https://careers.acme.com/jobs/42");
  });

  it("parks the systems Norinote does not fill with typed stubs", () => {
    expect(detectDriver("https://acme.wd1.myworkdayjobs.com/External/job/X_1")?.name).toBe("workday");
    expect(detectDriver("https://jobs.smartrecruiters.com/Acme/743999-engineer")?.name).toBe("smartrecruiters");
    expect(detectDriver("https://apply.workable.com/acme/j/ABC123/")?.name).toBe("workable");
    expect(detectDriver("https://careers-acme.icims.com/jobs/1234/job")?.name).toBe("icims");
  });
});

describe("Greenhouse schema from the public questions JSON", () => {
  it("lists main, location, demographic and consent fields, without hidden or alternative fields", () => {
    const s = greenhouseSchemaFromJson(ghJson, "discord", "8840756002");
    const keys = s.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["first_name", "last_name", "email", "phone", "resume", "location", "question_38503742002", "4033064002", "gdpr_demographic_data_consent_given"]));
    expect(keys).not.toContain("resume_text");
    expect(keys).not.toContain("latitude");
    expect(s.fields.find((f) => f.key === "question_38503742002")).toMatchObject({ type: "select", required: true, options: ["Yes", "No"] });
    expect(s.fields.find((f) => f.key === "4033069002")).toMatchObject({ type: "multiselect", section: "eeo", required: false });
    expect(s.formUrl).toBe("https://job-boards.greenhouse.io/discord/jobs/8840756002");
  });

  it("fingerprints a form by system, company and sorted labels, types and options", () => {
    const fields = greenhouseSchemaFromJson(ghJson, "discord", "1").fields;
    expect(formFingerprint("greenhouse", "discord", fields)).toBe(formFingerprint("greenhouse", "Discord", [...fields].reverse()));
    expect(formFingerprint("greenhouse", "discord", fields)).not.toBe(formFingerprint("greenhouse", "figma", fields));
    expect(formFingerprint("greenhouse", "discord", fields)).not.toBe(formFingerprint("greenhouse", "discord", fields.slice(1)));
  });
});

describe("company gate", () => {
  it("lets one application per company run at a time, then waits out the cooldown", async () => {
    let now = 0;
    const gate = new CompanyGate(1000, () => now);
    const release = await gate.acquire("acme", 10);
    expect(release).not.toBeNull();
    expect(await gate.acquire("acme", 0)).toBeNull(); // busy
    expect(await gate.acquire("globex", 0)).not.toBeNull(); // another company is independent
    release!();
    expect(gate.blocked("acme")).toBe(true); // cooling down
    now = 1000;
    expect(await gate.acquire("acme", 0)).not.toBeNull();
  });
});

describe("recipes and prepareForm (database)", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  async function seed(tag: string, applyUrl: string) {
    const [u] = await t.db.insert(users).values({ email: `${tag}@example.test`, passwordHash: "x" }).returning();
    await t.db.insert(profiles).values({
      userId: u!.id, contact: { name: "Test Applicant", phone: "+1 415 555 0134", linkedin: "https://linkedin.com/in/test" }, location: "San Francisco, CA",
      workAuth: { US: { authorized: true, needsSponsorship: false } }, eeo: {}, preferences: {},
    });
    await t.db.insert(careerPoints).values({ userId: u!.id, kind: "role", title: "Software Engineer", org: "Globex", startDate: "2020-01", text: "Built APIs in Go." });
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `discord-${tag}`, name: "Discord" }).returning();
    const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `x-${tag}`, title: "Engineer", applyUrl, dedupeKey: `k-${tag}` }).returning();
    const created = await createApplication(t.db, u!.id, j!.id);
    if (!created.created) throw new Error("seed");
    return { userId: u!.id, jobId: j!.id, companyId: c!.id, appId: created.application.id };
  }

  it("one application per user and canonical URL, whichever job row it came from", async () => {
    const a = await seed("canon", "https://boards.greenhouse.io/discord/jobs/8840756002?gh_src=a");
    const [c2] = await t.db.insert(jobs).values({ companyId: a.companyId, atsType: "greenhouse", externalId: "x-canon-2", title: "Engineer (repost)", applyUrl: "https://job-boards.greenhouse.io/discord/jobs/8840756002", dedupeKey: "k-canon-2" }).returning();
    const again = await createApplication(t.db, a.userId, c2!.id);
    expect(again).toMatchObject({ created: false, reason: "already_exists", application: { id: a.appId } });
  });

  it("stores slot mappings and strategies, never values", async () => {
    await saveRecipe(t.db, { fingerprint: "fp1", ats: "greenhouse", companyToken: "acme", fields: [
      { labelKey: "first name", label: "First Name", type: "text", slot: "first_name", value: "Ada" } as never,
    ] });
    await recordStrategies(t.db, "fp1", { "first name": "text" }, true);
    const r = await loadRecipe(t.db, "fp1");
    expect(r?.fields).toEqual([{ labelKey: "first name", label: "First Name", type: "text", slot: "first_name", strategy: "text" }]);
    expect(r).toMatchObject({ heals: 1 });
    const [row] = await t.db.select().from(formRecipes).where(eq(formRecipes.fingerprint, "fp1"));
    expect(JSON.stringify(row!.fields)).not.toContain("Ada");
  });

  it("prepares a Greenhouse form from its public schema: answers by field key, pending questions, recipe, timings", async () => {
    const s = await seed("prep", "https://job-boards.greenhouse.io/discord/jobs/8840756002");
    const fetchStub = (async (url: string) => {
      expect(String(url)).toBe("https://boards-api.greenhouse.io/v1/boards/discord/jobs/8840756002?questions=true");
      return new Response(JSON.stringify(ghJson), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const r = await prepareForm(t.db, s.appId, { fetch: fetchStub, noModel: true });
    expect(r.outcome).toBe("needs_user");
    expect(r.schema?.source).toBe("api");
    const [app] = await t.db.select().from(applications).where(eq(applications.id, s.appId));
    expect(app!.answers).toMatchObject({ "field:first_name": "Test", "field:last_name": "Applicant", "field:question_38503742002": "Yes", "field:4033064002": "I don't wish to answer", "field:resume": "@resume" });
    const pendingIds = r.pending.map((p) => p.id);
    expect(pendingIds).toEqual(expect.arrayContaining(["field:question_38503738002", "field:gdpr_demographic_data_consent_given"]));
    expect(pendingIds.every((id) => id.startsWith("field:"))).toBe(true);
    expect((app!.receipt as { prepared: { fingerprint: string; recipeHit: boolean } }).prepared).toMatchObject({ fingerprint: r.fingerprint, recipeHit: false });
    expect((await loadRecipe(t.db, r.fingerprint!))?.fields.find((f) => f.labelKey === "first name")?.slot).toBe("first_name");
    const steps = (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, s.appId))).map((e) => e.step);
    expect(steps).toContain("prepare_form");

    // Second application to the same form: a recipe hit.
    const s2 = await seed("prep2", "https://job-boards.greenhouse.io/discord/jobs/8840756002");
    await t.db.update(companies).set({ atsToken: "discord-prep2" }).where(eq(companies.id, s2.companyId));
    const r2 = await prepareForm(t.db, s2.appId, { fetch: fetchStub, noModel: true });
    expect(r2.recipeHit).toBe(true);
  });

  it("parks Workday at prepare time with the reason, without touching the browser", async () => {
    const s = await seed("wd", "https://acme.wd1.myworkdayjobs.com/External/job/NYC/Engineer_R1");
    const r = await prepareForm(t.db, s.appId, {});
    expect(r).toMatchObject({ outcome: "needs_user", pending: [] });
    expect(r.reason).toMatch(/account/);
  });
});
