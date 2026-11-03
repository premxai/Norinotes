/**
 * Replays real saved application pages (Greenhouse, Lever, Ashby; packages/apply/src/fixtures/forms) on 127.0.0.1 with
 * the widget shim, so the filler's widget recipes run against real markup: react-select comboboxes, native selects,
 * radio and checkbox groups by label, Ashby yes/no buttons, uploads with the filename chip, location autocomplete.
 * Submit is stubbed by the local server; nothing leaves the machine. Skipped when Chromium is not installed.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ashbyDriver, createBrowserPool, greenhouseDriver, leverDriver, type BrowserPool, type DriverContext } from "./index.js";
import { chromiumInstalled, startFormServer, type FormServer } from "./test-helpers.js";

const run = chromiumInstalled();
const TIMEOUT = 90_000;

describe.skipIf(!run)("saved real forms, replayed locally", () => {
  let tmp: string;
  let resumePath: string;
  let server: FormServer;
  let pool: BrowserPool;
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "norinote-forms-"));
    resumePath = path.join(tmp, "Test_Applicant_Resume.pdf");
    await writeFile(resumePath, "%PDF-1.4\n%%EOF\n");
    server = await startFormServer();
    pool = createBrowserPool({ size: 2, artifactsDir: path.join(tmp, "artifacts"), timeoutMs: 80_000, spareContexts: 1 });
  });
  afterAll(async () => {
    await pool.close();
    await server.close();
    await rm(tmp, { recursive: true, force: true });
  });
  const saved = process.env.ALLOW_REAL_SUBMIT;
  beforeEach(() => { delete process.env.ALLOW_REAL_SUBMIT; });
  afterEach(() => { if (saved === undefined) delete process.env.ALLOW_REAL_SUBMIT; else process.env.ALLOW_REAL_SUBMIT = saved; });

  function ctxFor(id: string, answers: Record<string, string>, over: Partial<DriverContext> = {}) {
    const events: { step: string; message: string; data?: Record<string, unknown> }[] = [];
    const ctx: DriverContext = {
      applicationId: id, applyUrl: `${server.origin}/forms/${id}.html`,
      profile: {
        fullName: "Test Applicant", firstName: "Test", lastName: "Applicant", email: "test.applicant@norinote.test", phone: "+1 415 555 0134",
        linkedin: "https://www.linkedin.com/in/test-applicant-norinote", location: "San Francisco, CA", country: "US",
        workAuth: { authorizedUS: true, needsSponsorship: false }, eeo: {},
      },
      resumePdfPath: resumePath, answers, dryRun: true,
      onEvent: (step, message, data) => { events.push({ step, message, data }); },
      ...over,
    };
    return { ctx, events };
  }

  it("Greenhouse (job-boards, react-select): fills combobox answers by option text, the phone country and location, uploads the resume", async () => {
    const { ctx, events } = ctxFor("greenhouse-discord-88407560", {
      "field:question_38503742002": "Yes", "field:question_38503743002": "Yes", "field:question_38503744002": "No",
      "field:question_38503738002": "I want to build the place people hang out online.", "field:question_38521719002": "A short honest story.",
      "field:4033064002": "I don't wish to answer", "field:4033065002": "I don't wish to answer", "field:4033066002": "I don't wish to answer", "field:4033067002": "I don't wish to answer",
      "field:gdpr_demographic_data_consent_given": "Yes", "field:resume": "@resume",
    });
    const fill = (await pool.run("gh", (page) => greenhouseDriver.fill(page, ctx))).value;
    expect(fill.status, JSON.stringify(fill.needsUser ?? fill.error)).toBe("filled");
    const by = (re: RegExp) => fill.fields.find((f) => re.test(f.label));
    expect(by(/^first name/i)?.value).toBe("Test");
    expect(by(/legally authorized/i)).toMatchObject({ value: "Yes" });
    expect(by(/relocate to the bay area/i)).toMatchObject({ value: "No" });
    expect(by(/^gender$/i)?.value).toBe("I don't wish to answer");
    expect(by(/phone country|^country$/i)?.value).toMatch(/United States/);
    expect(by(/location/i)?.value).toMatch(/San Francisco/);
    expect(fill.files).toEqual([{ label: "Resume/CV", path: resumePath }]);
    expect(fill.strategies).toMatchObject({ "first name": "text", gender: "combobox", "resume cv": "file" });
    expect(fill.timings?.readyMs).toBeGreaterThan(0);
    expect(events.some((e) => e.step === "timing")).toBe(true);
    expect(server.submits).toBe(0);
  }, TIMEOUT);

  it("Lever: native selects and radio groups by label with the decline fallback, checkbox cards, upload first", async () => {
    const { ctx } = ctxFor("lever-leverdemo-ad208490", { "field:org": "Acme Analytics", "field:resume": "@resume" });
    const fill = (await pool.run("lever", (page) => leverDriver.fill(page, ctx))).value;
    expect(fill.status, JSON.stringify(fill.needsUser ?? fill.error)).toBe("filled");
    const by = (re: RegExp) => fill.fields.find((f) => re.test(f.label));
    expect(by(/^full name/i)?.value).toBe("Test Applicant");
    expect(by(/^current company/i)?.value).toBe("Acme Analytics");
    expect(by(/^gender/i)).toMatchObject({ kind: "select", value: "Decline to self-identify" });
    expect(by(/^race/i)).toMatchObject({ kind: "radio", value: "Decline to self-identify" });
    expect(fill.files).toHaveLength(1);
  }, TIMEOUT);

  it("Ashby: yes/no buttons, location autocomplete, required questions without an answer stay pending", async () => {
    const { ctx, events } = ctxFor("ashby-notion-1fc309c8", {
      "field:790b5934-74f5-46f5-897a-675b7f37f2f3": "No", "field:e01a85db-feaa-42b3-a9ad-69b1dcbbab3f": "Yes", "field:_systemfield_resume": "@resume",
    });
    const fill = (await pool.run("ashby", (page) => ashbyDriver.fill(page, ctx))).value;
    const by = (re: RegExp) => fill.fields.find((f) => re.test(f.label));
    expect(by(/sponsor/i)).toMatchObject({ value: "No" });
    expect(by(/^location$/i)?.value).toMatch(/San Francisco/);
    expect(fill.strategies?.["location"]).toBe("location");
    expect(fill.status === "filled" || fill.needsUser?.kind === "questions").toBe(true);
    expect(events.some((e) => e.step === "submit")).toBe(false);
  }, TIMEOUT);

  it("submit (local stub only, ALLOW_REAL_SUBMIT=true): races the confirmation against failure signals", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const { ctx } = ctxFor("lever-leverdemo-ad208490", { "field:org": "Acme Analytics", "field:resume": "@resume" }, { dryRun: false });
    const out = (await pool.run("lever-submit", async (page) => {
      const fill = await leverDriver.fill(page, ctx);
      const submit = await leverDriver.submit(page, ctx);
      return { fill, submit };
    })).value;
    expect(out.fill.status).toBe("filled");
    expect(out.submit).toMatchObject({ status: "submitted", submitClicked: true });
    expect(out.submit.confirmationText).toMatch(/Thank you for applying/);
    expect(server.submits).toBe(1);
  }, TIMEOUT);
});
