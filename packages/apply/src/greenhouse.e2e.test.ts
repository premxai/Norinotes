/**
 * End to end against a LOCAL static copy of a Greenhouse application form (src/fixtures/greenhouse-form.html), served
 * from 127.0.0.1 by the test. No real site, no real submission. Skipped when Chromium is not installed.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applications, companies, eq, jobs, resumes, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  approveAndSubmit, createApplication, createBrowserPool, greenhouseDriver, runApplication, type BrowserPool, type Driver, type DriverContext,
} from "./index.js";
import { chromiumInstalled, startFixtureServer, type FixtureServer } from "./test-helpers.js";
import { CompanyGate } from "./gate.js";

const run = chromiumInstalled();
const TIMEOUT = 90_000;

const CAPTCHA_PAGE = `<html><body><form id="application_form">
  <label for="first_name">First Name</label><input id="first_name" type="text" required>
  <label for="email">Email</label><input id="email" type="email" required>
  <iframe src="/recaptcha/api2/anchor?size=normal" width="304" height="78"></iframe>
  <button type="button">Submit Application</button></form></body></html>`;

describe.skipIf(!run)("Greenhouse driver on the local fixture form", () => {
  let tmp: string;
  let resumePath: string;
  let server: FixtureServer;
  let pool: BrowserPool;
  let t: TestDb;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "norinote-gh-"));
    resumePath = path.join(tmp, "resume.pdf");
    await writeFile(resumePath, "%PDF-1.4\n% test resume\n%%EOF\n");
    server = await startFixtureServer({
      "/captcha": CAPTCHA_PAGE,
      "/recaptcha/api2/anchor": "<html><body>I am not a robot</body></html>",
    });
    pool = createBrowserPool({ size: 2, artifactsDir: path.join(tmp, "artifacts"), timeoutMs: 80_000 });
    t = await createTestDb();
  });
  afterAll(async () => {
    await pool.close();
    await server.close();
    await t.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const savedEnv = process.env.ALLOW_REAL_SUBMIT;
  beforeEach(() => { delete process.env.ALLOW_REAL_SUBMIT; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ALLOW_REAL_SUBMIT;
    else process.env.ALLOW_REAL_SUBMIT = savedEnv;
  });

  const FORM = () => `${server.origin}/greenhouse-form.html`;
  const ANSWERS = {
    "why-do-you-want-to-work-here": "I love building robots that ship.",
    "how-did-you-hear-about-us": "LinkedIn",
    "which-office-would-you-like-to-work-from": "remote",
    "i-acknowledge-that-the-information-i-have-provided-is-accurate": "Yes",
  };

  function ctxFor(over: Partial<DriverContext> = {}) {
    const events: { step: string; message: string }[] = [];
    const ctx: DriverContext = {
      applicationId: "app-1",
      applyUrl: FORM(),
      profile: {
        fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 415 555 0100",
        linkedin: "https://linkedin.com/in/ada", website: "https://ada.dev", location: "San Francisco, CA", country: "US",
        workAuth: { authorizedUS: true, needsSponsorship: false },
      },
      resumePdfPath: resumePath,
      answers: ANSWERS,
      dryRun: true,
      waitForCode: async () => null,
      onEvent: (step, message) => { events.push({ step, message }); },
      ...over,
    };
    return { ctx, events };
  }

  /** Run a function on a fresh pool page. */
  const withPage = <T,>(fn: (page: Page) => Promise<T>) => pool.run("gh-e2e", (page) => fn(page), { timeoutMs: 80_000 }).then((r) => r.value);

  it("dry run: fills every field in one pass, uploads the resume, and does not click submit", async () => {
    const { ctx, events } = ctxFor();
    const out = await withPage(async (page) => {
      const fill = await greenhouseDriver.fill(page, ctx);
      const resumeShown = await page.locator("#resume_filename").textContent();
      const office = await page.locator("#question_office_value").inputValue();
      const confirmationBefore = await page.locator("#application_confirmation").count();
      // Even asked to, the driver refuses to submit without ALLOW_REAL_SUBMIT=true.
      const submit = await greenhouseDriver.submit(page, { ...ctx, dryRun: false });
      return {
        fill, submit, resumeShown, office, confirmationBefore,
        confirmationAfter: await page.locator("#application_confirmation").count(),
        errorsAfter: await page.locator("#form_errors").textContent(),
        formStillThere: await page.locator("#application_form").count(),
      };
    });

    const { fill } = out;
    expect(fill.status, JSON.stringify(fill.needsUser ?? fill.error)).toBe("filled");
    expect(fill.pending).toEqual([]);
    const by = (re: RegExp) => fill.fields.find((f) => re.test(f.label));
    expect(by(/first name/i)?.value).toBe("Ada");
    expect(by(/last name/i)?.value).toBe("Lovelace");
    expect(by(/^email/i)?.value).toBe("ada@example.com");
    expect(by(/^phone$/i)?.value).toBe("+1 415 555 0100");
    expect(by(/phone country code/i)?.value).toBe("United States +1");
    expect(by(/^country$/i)?.value).toBe("United States");
    expect(by(/location/i)?.value).toBe("San Francisco, California, United States");
    expect(by(/^website$/i)?.value).toBe("https://ada.dev");
    expect(by(/authorized to work/i)).toMatchObject({ kind: "select", value: "Yes" });
    expect(by(/sponsorship/i)).toMatchObject({ kind: "radio", value: "No" });
    expect(by(/which office/i)).toMatchObject({ kind: "select", value: "Remote (US)" });
    expect(by(/hear about us/i)).toMatchObject({ kind: "select", value: "LinkedIn" });
    expect(by(/acknowledge/i)).toMatchObject({ kind: "checkbox", value: "Yes" });
    expect(by(/why do you want/i)?.value).toBe("I love building robots that ship.");
    expect(by(/github|twitter|leave this blank/i)).toBeUndefined(); // optional and unknown, or the honeypot: untouched

    // Resume uploaded, to the form's file input.
    expect(by(/resume/i)).toMatchObject({ kind: "file", value: "resume.pdf" });
    expect(fill.files).toEqual([{ label: "Resume/CV", path: resumePath }]);
    expect(out.resumeShown).toBe("resume.pdf");
    expect(out.office).toBe("Remote (US)");

    // Submit was not clicked, and the driver refused when asked.
    expect(out.submit).toMatchObject({ status: "failed", submitClicked: false });
    expect(out.submit.error).toMatch(/ALLOW_REAL_SUBMIT/);
    expect(out.confirmationBefore).toBe(0);
    expect(out.confirmationAfter).toBe(0);
    expect(out.errorsAfter).toBe(""); // the page's own submit handler never ran
    expect(out.formStillThere).toBe(1);
    expect(events.some((e) => e.step === "submit")).toBe(false);
    expect(events.some((e) => e.step === "field_warn")).toBe(false);
  }, TIMEOUT);

  it("collects unknown required questions as pending instead of guessing", async () => {
    const { ctx, events } = ctxFor({ answers: {} });
    const fill = await withPage((page) => greenhouseDriver.fill(page, ctx));
    expect(fill.status).toBe("needs_user");
    expect(fill.needsUser).toMatchObject({ kind: "questions" });
    // Pending ids are field:<name or id>, so the person's answer lands exactly where the filler looks.
    expect(fill.pending.map((p) => p.text).sort()).toEqual([
      "How did you hear about us?",
      "I acknowledge that the information I have provided is accurate.",
      "Which office would you like to work from?",
      "Why do you want to work here?",
    ]);
    expect(fill.pending.every((p) => p.id.startsWith("field:"))).toBe(true);
    const hear = fill.pending.find((p) => p.text === "How did you hear about us?")!;
    expect(hear).toMatchObject({ type: "select", required: true });
    expect(hear.options).toEqual(expect.arrayContaining(["LinkedIn", "Employee referral", "Company website", "Other"]));
    expect(fill.pending.find((p) => p.text === "Why do you want to work here?")).toMatchObject({ type: "textarea", text: "Why do you want to work here?" });
    expect(fill.pending.find((p) => /acknowledge/i.test(p.text))).toMatchObject({ type: "boolean" });
    expect(fill.pending.find((p) => /which office/i.test(p.text))?.options).toEqual(["San Francisco", "New York", "Remote (US)"]);
    // What it did know was still filled.
    expect(fill.fields.find((f) => /first name/i.test(f.label))?.value).toBe("Ada");
    expect(events.filter((e) => e.step === "field_pending")).toHaveLength(4);
  }, TIMEOUT);

  it("accepts answers by question text as well as by id, and picks the exact option", async () => {
    const { ctx } = ctxFor({
      answers: {
        "Why do you want to work here?": "Robots.", "How did you hear about us?": "employee referral",
        "Which office would you like to work from?": "New York", "I acknowledge that the information I have provided is accurate.": "yes",
      },
    });
    const fill = await withPage((page) => greenhouseDriver.fill(page, ctx));
    expect(fill.status).toBe("filled");
    expect(fill.fields.find((f) => /hear about us/i.test(f.label))?.value).toBe("Employee referral");
    expect(fill.fields.find((f) => /which office/i.test(f.label))?.value).toBe("New York");
  }, TIMEOUT);

  it("stops at a captcha with the reason, and never tries to get past it", async () => {
    const { ctx, events } = ctxFor({ applyUrl: `${server.origin}/captcha`, answers: {} });
    const fill = await withPage((page) => greenhouseDriver.fill(page, ctx));
    expect(fill.status).toBe("needs_user");
    expect(fill.needsUser?.kind).toBe("captcha");
    expect(fill.needsUser?.reason).toMatch(/never solves or bypasses captchas/);
    expect(events.some((e) => e.step === "captcha")).toBe(true);
  }, TIMEOUT);

  it("submits only with dryRun false AND ALLOW_REAL_SUBMIT=true (against the local fixture)", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const { ctx, events } = ctxFor({ dryRun: false });
    const out = await withPage(async (page) => {
      const fill = await greenhouseDriver.fill(page, ctx);
      const submit = await greenhouseDriver.submit(page, ctx);
      return { fill, submit };
    });
    expect(out.fill.status).toBe("filled");
    expect(out.submit).toMatchObject({ status: "submitted", submitClicked: true });
    expect(out.submit.confirmationText).toMatch(/Thank you for applying/);
    expect(events.some((e) => e.step === "submit")).toBe(true);

    // The flag alone is not enough: a dry run never clicks.
    const dry = ctxFor({ dryRun: true });
    const refused = await withPage(async (page) => {
      await greenhouseDriver.fill(page, dry.ctx);
      return greenhouseDriver.submit(page, dry.ctx);
    });
    expect(refused).toMatchObject({ status: "failed", submitClicked: false });
    expect(dry.events.some((e) => e.step === "submit")).toBe(false);
  }, TIMEOUT);

  it("fails with a clear error when the page has no form, keeping a screenshot and trace via the pool", async () => {
    const plain = await startFixtureServer({ "/plain": "<html><body><h1>Careers</h1><p>Nothing to apply to.</p></body></html>" });
    try {
      const { ctx } = ctxFor({ applyUrl: `${plain.origin}/plain` });
      const r = await pool.run("no-form", async (page, handle) => {
        const fill = await greenhouseDriver.fill(page, ctx);
        if (fill.status === "failed") handle.keepArtifacts();
        return fill;
      }, { timeoutMs: 80_000 });
      expect(r.value).toMatchObject({ status: "failed", error: "No application form fields found" });
      expect(r.artifacts.screenshotPath && existsSync(r.artifacts.screenshotPath)).toBe(true);
      expect(r.artifacts.tracePath && existsSync(r.artifacts.tracePath)).toBe(true);
    } finally {
      await plain.close();
    }
  }, TIMEOUT);

  // The whole path: database, state machine, real pool, real driver, receipt.
  describe("through runApplication", () => {
    // A Greenhouse driver that claims the local fixture URL.
    const localGreenhouse: Driver = { ...greenhouseDriver, detect: () => true };

    async function seedApplication(answers: Record<string, string>) {
      const [user] = await t.db.insert(users).values({ email: `e2e-${Math.random()}@example.test`, passwordHash: "x" }).returning();
      const [company] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `e2e-${Math.random()}`, name: "Acme Robotics" }).returning();
      const [job] = await t.db.insert(jobs).values({
        companyId: company!.id, atsType: "greenhouse", externalId: `e2e-${Math.random()}`, title: "Senior Software Engineer",
        applyUrl: FORM(), dedupeKey: `e2e-${Math.random()}`,
      }).returning();
      const created = await createApplication(t.db, user!.id, job!.id);
      if (!created.created) throw new Error("seed");
      const id = created.application.id;
      const [resume] = await t.db.insert(resumes).values({ applicationId: id, content: {}, pdfPath: resumePath }).returning();
      await t.db.update(applications).set({ status: "prepared", resumeId: resume!.id, preparedAt: new Date(), answers }).where(eq(applications.id, id));
      return id;
    }

    const deps = () => ({
      pool,
      preparer: { prepare: async () => ({ outcome: "prepared" as const }) },
      codes: { waitForCode: async () => null },
      companyGate: new CompanyGate(0),
      drivers: [localGreenhouse],
      loadInputs: async (_db: unknown, applicationId: string) => ({
        applyUrl: FORM(), jobTitle: "Senior Software Engineer", companyName: "Acme Robotics", resumePdfPath: resumePath,
        answers: (await t.db.select().from(applications).where(eq(applications.id, applicationId)))[0]!.answers,
        profile: ctxFor().ctx.profile,
      }),
    });

    it("dry run: prepared -> applying -> prepared with a grouped dry-run receipt", async () => {
      const id = await seedApplication(ANSWERS);
      expect(await approveAndSubmit(t.db, id)).toMatchObject({ ok: true, started: true });
      const step = await runApplication(t.db, id, deps());
      expect(step).toMatchObject({ status: "prepared", advanced: true });
      const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
      const receipt = row!.receipt as { dryRun: boolean; submitted: boolean; totals: { fields: number; files: number }; files: { name: string }[]; screenshotPath?: string; sections: { name: string; count: number; fields: { label: string; value: string; choice: boolean }[] }[]; durationMs: number };
      expect(receipt).toMatchObject({ dryRun: true, submitted: false, totals: { files: 1 }, files: [{ name: "resume.pdf" }] });
      expect(receipt.totals.fields).toBeGreaterThanOrEqual(14);
      expect(receipt.screenshotPath && existsSync(receipt.screenshotPath)).toBe(true);
      expect(receipt.durationMs).toBeGreaterThan(0);
      const sections = Object.fromEntries(receipt.sections.map((s) => [s.name, s]));
      expect(sections["Personal information"]!.count).toBeGreaterThanOrEqual(7);
      expect(sections["Experience"]!.fields.map((f) => f.value)).toContain("resume.pdf");
      expect(sections["Education"]!.count).toBe(0);
      expect(sections["Disclosures"]!.count).toBe(0);
      const sponsorship = sections["Questions"]!.fields.find((f) => /sponsorship/i.test(f.label));
      expect(sponsorship).toMatchObject({ value: "No", choice: true });
    }, TIMEOUT);

    it("pending questions: needs_user with the questions, nothing submitted", async () => {
      const id = await seedApplication({});
      await approveAndSubmit(t.db, id);
      const step = await runApplication(t.db, id, deps());
      expect(step).toMatchObject({ status: "needs_user", waiting: "user" });
      const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
      expect((row!.pendingQuestions as { text: string }[]).map((q) => q.text)).toContain("Why do you want to work here?");
      expect(row!.submittedAt).toBeNull();
    }, TIMEOUT);

    it("real submit (local fixture only): submitted with the confirmation text in the receipt", async () => {
      process.env.ALLOW_REAL_SUBMIT = "true";
      const id = await seedApplication(ANSWERS);
      await approveAndSubmit(t.db, id);
      const step = await runApplication(t.db, id, deps());
      expect(step).toMatchObject({ status: "submitted", waiting: "done" });
      const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
      expect(row!.receipt).toMatchObject({ submitted: true, dryRun: false, submitClicked: true });
      expect((row!.receipt as { confirmationText: string }).confirmationText).toMatch(/Thank you for applying/);
      expect(row!.submittedAt).toBeInstanceOf(Date);
    }, TIMEOUT);
  });
});
