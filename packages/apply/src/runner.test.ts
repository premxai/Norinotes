import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { applications, companies, eq, jobs, resumes, runEvents, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  approveAndSubmit, createApplication, driveApplication, retryApplication, runApplication, saveAnswers, normalizeTitle,
  PoolRunError, type ApplyDeps, type BrowserPool, type Driver, type DriverContext, type FillResult, type SubmitResult,
} from "./index.js";
import type { ApplyInputs } from "./inputs.js";
import { CompanyGate } from "./gate.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

const savedEnv = process.env.ALLOW_REAL_SUBMIT;
beforeEach(() => { delete process.env.ALLOW_REAL_SUBMIT; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOW_REAL_SUBMIT;
  else process.env.ALLOW_REAL_SUBMIT = savedEnv;
});

let seq = 0;
async function seedUser() {
  const [u] = await t.db.insert(users).values({ email: `u${++seq}@example.test`, passwordHash: "x" }).returning();
  return u!;
}
async function seedCompany(name = `Acme ${++seq}`) {
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `tok-${++seq}`, name }).returning();
  return c!;
}
async function seedJob(companyId: string, title = "Senior Software Engineer", extra: Partial<typeof jobs.$inferInsert> = {}) {
  const n = ++seq;
  const [j] = await t.db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: `ext-${n}`, title, applyUrl: `https://boards.greenhouse.io/acme/jobs/${n}`,
    dedupeKey: `k-${n}`, ...extra,
  }).returning();
  return j!;
}
async function seedApp() {
  const user = await seedUser();
  const company = await seedCompany();
  const job = await seedJob(company.id);
  const res = await createApplication(t.db, user.id, job.id);
  if (!res.created) throw new Error("seed failed");
  return { user, company, job, app: res.application };
}
const getApp = async (id: string) => (await t.db.select().from(applications).where(eq(applications.id, id)))[0]!;
const eventSteps = async (id: string) => (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, id)).orderBy(runEvents.id)).map((e) => e.step);

describe("createApplication", () => {
  it("queues one application per user and job, and logs it", async () => {
    const { app } = await seedApp();
    expect(app.status).toBe("queued");
    expect(await eventSteps(app.id)).toEqual(["created"]);
  });

  it("returns the existing application for the same job instead of a second one", async () => {
    const { user, job, app } = await seedApp();
    const again = await createApplication(t.db, user.id, job.id);
    expect(again).toMatchObject({ created: false, reason: "already_exists", application: { id: app.id } });
  });

  it("refuses the same company and normalised title within 30 days, even for a different posting", async () => {
    const user = await seedUser();
    const company = await seedCompany("Globex Inc.");
    const first = await seedJob(company.id, "Sr. Software Engineer (Remote)", { location: "Remote" });
    const second = await seedJob(company.id, "Senior Software Engineer", { location: "Austin" });
    const created = await createApplication(t.db, user.id, first.id);
    expect(created.created).toBe(true);
    const dup = await createApplication(t.db, user.id, second.id);
    expect(dup).toMatchObject({ created: false, reason: "duplicate_recent", application: { jobId: first.id } });

    // The same role listed under a second company record with the same name counts too.
    const sameName = await seedCompany("Globex");
    const third = await seedJob(sameName.id, "Senior Software Engineer");
    expect(await createApplication(t.db, user.id, third.id)).toMatchObject({ created: false, reason: "duplicate_recent" });
  });

  it("allows it again after 30 days, for another title, another company, another user, and after a failure", async () => {
    const user = await seedUser();
    const company = await seedCompany();
    const old = await seedJob(company.id, "Data Engineer");
    const longAgo = new Date(Date.now() - 31 * 86_400_000);
    expect((await createApplication(t.db, user.id, old.id, { now: longAgo })).created).toBe(true);
    const repost = await seedJob(company.id, "Data Engineer");
    expect((await createApplication(t.db, user.id, repost.id)).created).toBe(true);

    const other = await seedJob(company.id, "Platform Engineer");
    expect((await createApplication(t.db, user.id, other.id)).created).toBe(true);

    const elsewhere = await seedJob((await seedCompany()).id, "Platform Engineer");
    expect((await createApplication(t.db, user.id, elsewhere.id)).created).toBe(true);

    const someoneElse = await seedUser();
    const sameJob = await seedJob(company.id, "Platform Engineer");
    expect((await createApplication(t.db, someoneElse.id, sameJob.id)).created).toBe(true);

    // A failed application never reached the employer, so another posting of the role may be tried.
    const failedUser = await seedUser();
    const j1 = await seedJob(company.id, "Support Engineer");
    const r1 = await createApplication(t.db, failedUser.id, j1.id);
    if (!r1.created) throw new Error("setup");
    await t.db.update(applications).set({ status: "failed" }).where(eq(applications.id, r1.application.id));
    const j2 = await seedJob(company.id, "Support Engineer");
    expect((await createApplication(t.db, failedUser.id, j2.id)).created).toBe(true);
  });

  it("reports an unknown job", async () => {
    const user = await seedUser();
    expect(await createApplication(t.db, user.id, "00000000-0000-4000-8000-000000000000")).toMatchObject({ created: false, reason: "job_not_found" });
  });

  it("normalises titles", () => {
    expect(normalizeTitle("Sr. Software Engineer (Remote) - US")).toBe(normalizeTitle("Senior Software Engineer - US"));
    expect(normalizeTitle("Software Engineer, Backend")).toBe("software engineer backend");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fakes: no browser, no network. The real-browser path is covered in greenhouse.e2e.test.ts.
// ---------------------------------------------------------------------------------------------------------------------

type Calls = { fill: DriverContext[]; submit: DriverContext[] };

function fakeDriver(over: { fill?: (ctx: DriverContext) => Promise<FillResult> | FillResult; submit?: (ctx: DriverContext) => Promise<SubmitResult> | SubmitResult; detect?: (u: string) => boolean } = {}) {
  const calls: Calls = { fill: [], submit: [] };
  const driver: Driver = {
    name: "greenhouse",
    detect: over.detect ?? (() => true),
    formUrl: () => null,
    async fill(_page, ctx) {
      calls.fill.push(ctx);
      return over.fill ? over.fill(ctx) : filled();
    },
    async submit(_page, ctx) {
      calls.submit.push(ctx);
      return over.submit ? over.submit(ctx) : submitted();
    },
  };
  return { driver, calls };
}

const filled = (): FillResult => ({
  status: "filled", formUrl: "https://x.test/form", durationMs: 100, pending: [],
  fields: [{ label: "First Name", value: "Ada", kind: "text" }, { label: "Resume/CV", value: "resume.pdf", kind: "file" }],
  files: [{ label: "Resume/CV", path: "/tmp/resume.pdf" }],
});
const submitted = (): SubmitResult => ({ status: "submitted", submitClicked: true, confirmationText: "Thank you for applying.", durationMs: 50 });

function fakePool(opts: { fail?: () => Error | null } = {}) {
  const state = { runs: 0, kept: 0, active: 0, maxActive: 0 };
  const pool: BrowserPool = {
    artifactsDir: "/tmp/artifacts",
    async run(_label, fn) {
      state.runs++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        const err = opts.fail?.();
        if (err) throw new PoolRunError(err.message, { screenshotPath: "/tmp/artifacts/fail.png", tracePath: "/tmp/artifacts/fail.zip" }, false, err);
        const value = await fn({} as Page, { context: {} as never, keepArtifacts: () => { state.kept++; }, screenshot: async (tag) => `/tmp/artifacts/${tag}.png` });
        return { value, artifacts: {} };
      } finally {
        state.active--;
      }
    },
    warmUp: async () => {},
    stats: () => ({ size: 3, active: state.active, waiting: 0, browserLaunched: true, launches: 1 }),
    close: async () => {},
  };
  return { pool, state };
}

const inputs = (over: Partial<ApplyInputs> = {}): ApplyInputs => ({
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1", jobTitle: "Engineer", companyName: "Acme", resumePdfPath: "/tmp/resume.pdf", answers: {},
  profile: { fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", workAuth: {} }, ...over,
});

/** Preparer that writes a resume row the way the real one will, then reports. */
function fakePreparer(script: Array<"prepared" | "throw" | "needs_user" | "failed" | "no_resume"> = ["prepared"]) {
  const calls: string[] = [];
  return {
    calls,
    async prepare(applicationId: string) {
      calls.push(applicationId);
      const step = script[Math.min(calls.length - 1, script.length - 1)]!;
      if (step === "throw") throw new Error("model unavailable");
      if (step === "needs_user") return { outcome: "needs_user" as const, reason: "One answer is missing", pending: [{ id: "why", text: "Why us?", type: "textarea" as const, options: [], required: true }] };
      if (step === "failed") return { outcome: "failed" as const, error: "Could not tailor" };
      if (step === "prepared") {
        const [r] = await t.db.insert(resumes).values({ applicationId, content: {}, pdfPath: "/tmp/resume.pdf" }).returning();
        await t.db.update(applications).set({ resumeId: r!.id }).where(eq(applications.id, applicationId));
      }
      return { outcome: "prepared" as const };
    },
  };
}

function deps(over: Partial<ApplyDeps> & { driver?: Driver } = {}): ApplyDeps & { preparer: ReturnType<typeof fakePreparer> } {
  const preparer = (over.preparer as ReturnType<typeof fakePreparer> | undefined) ?? fakePreparer();
  return {
    pool: fakePool().pool,
    codes: { waitForCode: async () => null },
    companyGate: new CompanyGate(0),
    drivers: [over.driver ?? fakeDriver().driver],
    loadInputs: async () => inputs(),
    ...over,
    preparer,
  };
}

async function prepared(d = deps()) {
  const seeded = await seedApp();
  const step = await driveApplication(t.db, seeded.app.id, d);
  expect(step).toMatchObject({ status: "prepared", waiting: "approval" });
  return { ...seeded, d };
}

describe("preparing", () => {
  it("queued -> preparing -> prepared, one step per call, and logs each", async () => {
    const d = deps();
    const { app } = await seedApp();
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "preparing", advanced: true });
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "prepared", advanced: true, waiting: "approval" });
    const row = await getApp(app.id);
    expect(row.status).toBe("prepared");
    expect(row.preparedAt).toBeInstanceOf(Date);
    expect(await eventSteps(app.id)).toEqual(["created", "status:preparing", "status:prepared"]);
  });

  it("is idempotent: calling again at prepared changes nothing and does not run the preparer again", async () => {
    const { app, d } = await prepared();
    const before = await eventSteps(app.id);
    for (let i = 0; i < 3; i++) expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "prepared", advanced: false, waiting: "approval" });
    expect(await eventSteps(app.id)).toEqual(before);
    expect(d.preparer.calls).toHaveLength(1);
  });

  it("retries after the preparer throws, without moving the status", async () => {
    const d = deps({ preparer: fakePreparer(["throw", "prepared"]) as never });
    const { app } = await seedApp();
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "preparing" });
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "preparing", retry: true, advanced: false });
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "prepared", advanced: true });
  });

  it("parks as needs_user with the pending questions, then resumes preparing once they are answered", async () => {
    const d = deps({ preparer: fakePreparer(["needs_user", "prepared"]) as never });
    const { app } = await seedApp();
    const parked = await driveApplication(t.db, app.id, d);
    expect(parked).toMatchObject({ status: "needs_user", waiting: "user" });
    expect((await getApp(app.id)).pendingQuestions).toHaveLength(1);
    // Still unanswered: nothing moves.
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user", advanced: false, waiting: "user" });
    await saveAnswers(t.db, app.id, { why: "Because robots" });
    expect(await driveApplication(t.db, app.id, d)).toMatchObject({ status: "prepared" });
  });

  it("fails when the preparer fails, or finishes without a resume", async () => {
    const a = await seedApp();
    expect(await driveApplication(t.db, a.app.id, deps({ preparer: fakePreparer(["failed"]) as never }))).toMatchObject({ status: "failed", waiting: "done" });
    expect((await getApp(a.app.id)).error).toBe("Could not tailor");
    const b = await seedApp();
    expect(await driveApplication(t.db, b.app.id, deps({ preparer: fakePreparer(["no_resume"]) as never }))).toMatchObject({ status: "failed" });
    expect((await getApp(b.app.id)).error).toMatch(/without a usable resume/);
  });
});

describe("approveAndSubmit", () => {
  it("a click on a prepared application approves it and starts applying, once", async () => {
    const { app } = await prepared();
    const first = await approveAndSubmit(t.db, app.id);
    expect(first).toEqual({ ok: true, status: "applying", started: true });
    const row = await getApp(app.id);
    expect(row.status).toBe("applying");
    expect(row.approvedAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(1);
    // Double click.
    expect(await approveAndSubmit(t.db, app.id)).toEqual({ ok: true, status: "applying", started: false });
    expect((await getApp(app.id)).attempts).toBe(1);
  });

  it("refuses before the application is prepared", async () => {
    const { app } = await seedApp();
    expect(await approveAndSubmit(t.db, app.id)).toMatchObject({ ok: false, status: "queued" });
    expect(await approveAndSubmit(t.db, "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, status: null });
  });
});

describe("applying", () => {
  it("dry run (ALLOW_REAL_SUBMIT unset): fills, never submits, records a dry-run receipt and returns to prepared", async () => {
    const { driver, calls } = fakeDriver();
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    const step = await runApplication(t.db, app.id, d);
    expect(step).toMatchObject({ status: "prepared", advanced: true, waiting: "approval" });
    expect(calls.fill).toHaveLength(1);
    expect(calls.fill[0]!.dryRun).toBe(true);
    expect(calls.submit).toHaveLength(0);
    const row = await getApp(app.id);
    expect(row.submittedAt).toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.receipt).toMatchObject({ dryRun: true, submitted: false, submitClicked: false, driver: "greenhouse", screenshotPath: "/tmp/artifacts/filled.png" });
    expect((row.receipt as { summary: string }).summary).toContain("Dry run, not submitted");
    const steps = await eventSteps(app.id);
    expect(steps).toContain("apply_start");
    expect(steps.at(-1)).toBe("status:prepared");
    // The user can click again for another dry run.
    expect(await approveAndSubmit(t.db, app.id)).toMatchObject({ ok: true, started: true });
  });

  it("with ALLOW_REAL_SUBMIT=true it submits, stores the receipt, and a repeat call does nothing", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const { driver, calls } = fakeDriver();
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "submitted", advanced: true, waiting: "done" });
    const row = await getApp(app.id);
    expect(row.submittedAt).toBeInstanceOf(Date);
    expect(row.receipt).toMatchObject({ dryRun: false, submitted: true, submitClicked: true, confirmationText: "Thank you for applying." });
    expect(calls.fill[0]!.dryRun).toBe(false);

    for (let i = 0; i < 2; i++) expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "submitted", advanced: false, waiting: "done" });
    expect(calls.fill).toHaveLength(1);
    expect(calls.submit).toHaveLength(1);
    expect(await approveAndSubmit(t.db, app.id)).toEqual({ ok: true, status: "submitted", started: false });
  });

  it("parks with the pending questions when the form asks something unknown, then resumes with the answers", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const question = { id: "why-do-you-want-to-work-here", text: "Why do you want to work here?", type: "textarea" as const, options: [], required: true };
    const { driver, calls } = fakeDriver({
      fill: (ctx) => Object.keys(ctx.answers).length
        ? filled()
        : { ...filled(), status: "needs_user", pending: [question], needsUser: { kind: "questions", reason: "The form asks 1 required question Norinote has no answer for." } },
    });
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user", waiting: "user" });
    let row = await getApp(app.id);
    expect(row.pendingQuestions).toEqual([question]);
    expect(row.error).toMatch(/1 required question/);
    expect(calls.submit).toHaveLength(0);

    // Not answered yet: no browser run.
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user", advanced: false });
    expect(calls.fill).toHaveLength(1);

    await saveAnswers(t.db, app.id, { [question.id]: "I love robots." });
    d.loadInputs = async (db, id) => inputs({ answers: (await getApp(id)).answers });
    expect(await driveApplication(t.db, app.id, d)).toMatchObject({ status: "submitted" });
    expect(calls.fill[1]!.answers).toEqual({ [question.id]: "I love robots." });
    row = await getApp(app.id);
    expect(row.pendingQuestions).toEqual([]);
  });

  it("stops with needs_user and the reason on a captcha, never submitting", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const reason = "A captcha is on the form. Norinote never solves or bypasses captchas: open the posting and apply yourself.";
    const { driver, calls } = fakeDriver({ fill: () => ({ ...filled(), status: "needs_user", needsUser: { kind: "captcha", reason } }) });
    const pool = fakePool();
    const { app, d } = await prepared(deps({ driver, pool: pool.pool }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user", waiting: "user" });
    const row = await getApp(app.id);
    expect(row.error).toBe(reason);
    expect(row.pendingQuestions).toEqual([]);
    expect(calls.submit).toHaveLength(0);
    expect(pool.state.kept).toBe(1); // screenshot and trace kept for the person to look at
    // No questions to answer, so it stays parked until the user retries.
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user", advanced: false });
    // An explicit retry from the user resumes it.
    expect(await retryApplication(t.db, app.id)).toMatchObject({ ok: true });
    expect((await getApp(app.id)).status).toBe("applying");
  });

  it("an unknown form type goes to the fallback handler, which parks it as needs_user", async () => {
    const { driver } = fakeDriver({ detect: () => false });
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user" });
    expect((await getApp(app.id)).error).toBe("This form type is not supported yet");
  });

  it("a plugged-in UnknownFormHandler is used for unrecognised forms", async () => {
    const { driver } = fakeDriver({ detect: () => false });
    const handle = vi.fn(async (): Promise<FillResult> => ({ ...filled(), status: "needs_user", needsUser: { kind: "other", reason: "Agent could not finish" } }));
    const { app, d } = await prepared(deps({ driver, unknownForm: { handle } }));
    await approveAndSubmit(t.db, app.id);
    await runApplication(t.db, app.id, d);
    expect(handle).toHaveBeenCalledTimes(1);
    expect((await getApp(app.id)).error).toBe("Agent could not finish");
  });

  it("waits for the emailed code: awaiting_code, then back to applying, then submitted", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const { driver } = fakeDriver({
      submit: async (ctx) => {
        ctx.onEvent("submit", "Clicking Submit");
        const code = await ctx.waitForCode!("greenhouse");
        return code ? { ...submitted(), usedCode: true } : { status: "needs_user", submitClicked: true, durationMs: 1, needsUser: { kind: "verification_code", reason: "No code" } };
      },
    });
    const waits: string[] = [];
    const { app, d } = await prepared(deps({ driver, codes: { waitForCode: async (id, o) => { waits.push(`${id}:${o.hint}:${o.timeoutMs}`); return "123456"; } }, codeTimeoutMs: 5000 }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "submitted" });
    expect(waits).toEqual([`${app.id}:greenhouse:5000`]);
    const steps = await eventSteps(app.id);
    expect(steps).toEqual(expect.arrayContaining(["status:awaiting_code", "status:applying", "submit", "status:submitted"]));
    expect(steps.indexOf("status:awaiting_code")).toBeGreaterThan(steps.indexOf("submit"));
    expect(steps.indexOf("status:submitted")).toBeGreaterThan(steps.indexOf("status:awaiting_code"));
  });

  it("no code in time: needs_user, never re-sent on its own, and the person may start it again", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const { driver, calls } = fakeDriver({
      submit: async (ctx) => {
        ctx.onEvent("submit", "Clicking Submit");
        await ctx.waitForCode!("greenhouse");
        return { status: "needs_user", submitClicked: true, durationMs: 1, needsUser: { kind: "verification_code", reason: "The site emailed a verification code and none arrived in time." } };
      },
    });
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user" });
    const row = await getApp(app.id);
    // The site never took it without the code: the receipt says so, and a retry by the person is allowed.
    expect(row.receipt).toMatchObject({ submitClicked: true, codeMissing: true });
    expect(calls.submit).toHaveLength(1);
    const retry = await retryApplication(t.db, app.id);
    expect(retry).toMatchObject({ ok: true });
  });

  it("a worker that died in awaiting_code starts the form again instead of waiting forever", async () => {
    const { app, d } = await prepared();
    await approveAndSubmit(t.db, app.id);
    await t.db.update(applications).set({ status: "awaiting_code", receipt: { submitClicked: true, awaitingCode: true } }).where(eq(applications.id, app.id));
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "applying", advanced: true });
  });

  it("retries a browser failure before the click, and gives up as failed after the attempt limit", async () => {
    const pool = fakePool({ fail: () => new Error("net::ERR_TIMED_OUT") });
    const { app, d } = await prepared(deps({ pool: pool.pool }));
    await approveAndSubmit(t.db, app.id); // attempt 1
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "applying", retry: true, advanced: false });
    await t.db.update(applications).set({ attempts: 2 }).where(eq(applications.id, app.id));
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "applying", retry: true });
    await t.db.update(applications).set({ attempts: 3 }).where(eq(applications.id, app.id));
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "failed", waiting: "done" });
    const row = await getApp(app.id);
    expect(row.error).toBe("net::ERR_TIMED_OUT");
    expect(row.receipt).toMatchObject({ screenshotPath: "/tmp/artifacts/fail.png", tracePath: "/tmp/artifacts/fail.zip" });
  });

  it("a crash after the submit click is failed with the click recorded, never retried", async () => {
    process.env.ALLOW_REAL_SUBMIT = "true";
    const pool = fakePool();
    const { driver } = fakeDriver({
      submit: async (ctx) => {
        ctx.onEvent("submit", "Clicking Submit");
        throw new PoolRunError("browser crashed", { screenshotPath: "/tmp/artifacts/crash.png" }, false, new Error("x"));
      },
    });
    const { app, d } = await prepared(deps({ driver, pool: pool.pool }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "failed" });
    const row = await getApp(app.id);
    expect(row.error).toMatch(/after submit was clicked/);
    expect(row.receipt).toMatchObject({ submitClicked: true });
  });

  it("a restart in applying with a recorded click does not click again", async () => {
    const { driver, calls } = fakeDriver();
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    await t.db.update(applications).set({ receipt: { submitClicked: true } }).where(eq(applications.id, app.id));
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "needs_user" });
    expect(calls.fill).toHaveLength(0);
  });

  it("fails clearly when the resume or inputs are missing", async () => {
    const { app, d } = await prepared(deps({ loadInputs: async () => { throw new Error("the tailored resume has no PDF yet"); } }));
    await approveAndSubmit(t.db, app.id);
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "failed" });
    expect((await getApp(app.id)).error).toBe("Cannot apply: the tailored resume has no PDF yet");
  });

  it("never runs the browser twice at once for one application", async () => {
    const release: { go: () => void } = { go: () => {} };
    const gate = new Promise<void>((r) => { release.go = r; });
    const { driver, calls } = fakeDriver({ fill: async () => { await gate; return filled(); } });
    const { app, d } = await prepared(deps({ driver }));
    await approveAndSubmit(t.db, app.id);
    const first = runApplication(t.db, app.id, d);
    await vi.waitFor(() => expect(calls.fill).toHaveLength(1));
    expect(await runApplication(t.db, app.id, d)).toMatchObject({ status: "applying", advanced: false, waiting: "concurrent" });
    release.go();
    expect(await first).toMatchObject({ status: "prepared" });
    expect(calls.fill).toHaveLength(1);
  });
});

describe("retryApplication", () => {
  it("puts a failed application back in the queue for the user, and resets its attempts", async () => {
    const a = await seedApp();
    await driveApplication(t.db, a.app.id, deps({ preparer: fakePreparer(["failed"]) as never }));
    const r = await retryApplication(t.db, a.app.id);
    expect(r).toMatchObject({ ok: true });
    expect((await getApp(a.app.id)).status).toBe("queued");
    expect(await retryApplication(t.db, a.app.id)).toMatchObject({ ok: false }); // queued: nothing to retry
  });
});
