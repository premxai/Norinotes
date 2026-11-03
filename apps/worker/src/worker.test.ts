import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { createFakeProvider, setProvider } from "@norinote/ai";
import { applications, careerPoints, companies, eq, inboxMessages, jobSpecs, jobs, lanes, profiles, resumes, runEvents, shortlist, users, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { BrowserPool, Driver, FillResult, Preparer } from "@norinote/apply";
import { embedCareerPoints } from "@norinote/graph";
import { assignInboxAddress, receiveInbound } from "@norinote/inbox";
import type { JobSpecModelOutput } from "@norinote/match";
import { MemoryQueue, JOBS } from "@norinote/queue";
import { loadConfig, type WorkerConfig } from "./config.js";
import { silentLogger } from "./log.js";
import { startWorker, type Worker } from "./worker.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({ ...loadConfig({}), matchBatchMs: 0, explainTop: 0, ...over });

let t: TestDb;
let savedSubmit: string | undefined;
beforeAll(async () => {
  t = await createTestDb();
  savedSubmit = process.env.ALLOW_REAL_SUBMIT;
  delete process.env.ALLOW_REAL_SUBMIT; // every apply in these tests is a dry run
});
afterAll(async () => {
  if (savedSubmit !== undefined) process.env.ALLOW_REAL_SUBMIT = savedSubmit;
  await t.close();
});
afterEach(() => setProvider(null));

let n = 0;
async function seedUser(db: Db, opts: { workAuth?: Record<string, unknown> } = {}): Promise<string> {
  const [u] = await db.insert(users).values({ email: `w${n++}@example.test`, passwordHash: "x" }).returning();
  await db.insert(profiles).values({
    userId: u!.id, location: "Austin, TX", contact: { name: "Ada Lovelace", email: "ada@example.test" },
    workAuth: opts.workAuth ?? { US: { authorized: true, needsSponsorship: false } },
  });
  return u!.id;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ingest -> understand -> match
// ---------------------------------------------------------------------------------------------------------------------

const BOARD_URL = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const feed = {
  jobs: [
    {
      id: 9001, title: "Backend Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/9001", first_published: "2026-10-30T09:00:00Z",
      location: { name: "Remote - US" }, company_name: "Acme Robotics",
      content: "&lt;p&gt;Backend Engineer. Build backend APIs in Python on Kubernetes with PostgreSQL. Own services end to end.&lt;/p&gt;",
    },
    {
      id: 9002, title: "Marketing Manager", absolute_url: "https://boards.greenhouse.io/acme/jobs/9002", first_published: "2026-10-30T09:00:00Z",
      location: { name: "Remote - US" }, company_name: "Acme Robotics",
      content: "&lt;p&gt;Marketing Manager. Plan campaigns and run events.&lt;/p&gt;",
    },
  ],
};
const mockFetch = (calls: string[]): typeof fetch => (async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  if (url === BOARD_URL) return new Response(JSON.stringify(feed), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const specFor = (over: Partial<JobSpecModelOutput> = {}): JobSpecModelOutput => ({
  mustHaves: [{ text: "Python", weight: 0.9 }, { text: "Kubernetes", weight: 0.6 }], niceToHaves: [{ text: "PostgreSQL", weight: 0.3 }],
  skills: [
    { name: "Python", level: "advanced", years: null, required: true },
    { name: "Kubernetes", level: "working", years: null, required: true },
    { name: "PostgreSQL", level: "working", years: null, required: false },
  ],
  seniority: "mid", roleFamily: "backend engineering", yearsMin: null,
  location: { remote: "remote", countries: ["United States"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: ["Build APIs"], ...over,
});

describe("worker: poll, understand, match", () => {
  let worker: Worker;
  let queue: MemoryQueue;
  const fetched: string[] = [];

  beforeEach(() => {
    fetched.length = 0;
    setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? specFor() : undefined) }));
  });
  afterEach(async () => { await worker?.stop(); });

  it("polls a due board, understands its jobs, and the batched match puts the right one on the shortlist", async () => {
    const [company] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "acme", name: "Acme Robotics" }).returning();
    const userId = await seedUser(t.db);
    await t.db.insert(lanes).values({ userId, name: "Backend", titles: ["Backend Engineer"], locations: [], remote: true, minFit: 0.2 });
    await t.db.insert(careerPoints).values({
      userId, kind: "role", title: "Backend Engineer", org: "Initech", startDate: "2022-01", endDate: null, skills: ["Python", "Kubernetes", "PostgreSQL"],
      text: "Backend Engineer. Built backend APIs in Python on Kubernetes with PostgreSQL. Owned services end to end.",
    });
    await embedCareerPoints(t.db, userId);

    queue = new MemoryQueue();
    worker = await startWorker({ db: t.db, queue, config: config(), log: silentLogger, fetch: mockFetch(fetched), now: () => NOW, scheduler: false, seed: false, pool: stubPool().pool });

    // The scheduler finds the board once; asking again while it is queued adds nothing.
    expect(await worker.consumers.enqueueDueBoards()).toBe(1);
    expect(await worker.consumers.enqueueDueBoards()).toBe(0);
    await queue.drain();
    expect(fetched).toEqual([BOARD_URL]);

    const rows = await t.db.select().from(jobs).where(eq(jobs.companyId, company!.id));
    expect(rows.map((j) => j.title).sort()).toEqual(["Backend Engineer", "Marketing Manager"]);
    // Only the job that fits a lane is read by the model; the marketing job waits until somebody's lane fits it.
    const backendJob = rows.find((j) => j.title === "Backend Engineer")!;
    expect((await t.db.select().from(jobSpecs)).map((r) => r.jobId)).toEqual([backendJob.id]);
    expect(queue.stats(JOBS.understandJob)).toMatchObject({ completed: 1, failed: 0 });

    // The understood job waits for the batch window, then one match.new-jobs run covers it.
    expect(queue.stats(JOBS.matchNewJobs).completed).toBe(0);
    await worker.consumers.flushMatchBatch();
    await queue.drain();
    expect(queue.stats(JOBS.matchNewJobs)).toMatchObject({ completed: 1, failed: 0 });

    const list = await t.db.select({ jobId: shortlist.jobId, fit: shortlist.fit, status: shortlist.status }).from(shortlist).where(eq(shortlist.userId, userId));
    const backend = rows.find((j) => j.title === "Backend Engineer")!;
    expect(list.map((r) => r.jobId)).toEqual([backend.id]);
    expect(list[0]).toMatchObject({ status: "new" });
    expect(list[0]!.fit).toBeGreaterThan(0.2);
    expect(queue.failures()).toEqual([]);

    // The board was just polled, so it is not due again for hours.
    expect(await worker.consumers.enqueueDueBoards()).toBe(0);
  });

  it("match.user rebuilds a shortlist from the stored index", async () => {
    const userId = await seedUser(t.db);
    await t.db.insert(lanes).values({ userId, name: "Backend", titles: ["Backend Engineer"], locations: [], remote: true, minFit: 0.2 });
    await t.db.insert(careerPoints).values({
      userId, kind: "role", title: "Backend Engineer", org: "Initech", startDate: "2022-01", endDate: null, skills: ["Python", "Kubernetes", "PostgreSQL"],
      text: "Backend Engineer. Built backend APIs in Python on Kubernetes with PostgreSQL. Owned services end to end.",
    });
    queue = new MemoryQueue();
    worker = await startWorker({ db: t.db, queue, config: config(), log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool: stubPool().pool });
    await queue.enqueue(JOBS.matchUser, { userId, reason: "graph" });
    await queue.drain();
    expect(queue.failures()).toEqual([]);
    // Jobs from the previous test are in the database, so the rebuild finds the backend job.
    const list = await t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
    expect(list.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Prepare and apply
// ---------------------------------------------------------------------------------------------------------------------

function stubPool() {
  const state = { runs: 0 };
  const pool: BrowserPool = {
    artifactsDir: "/tmp/artifacts",
    async run(_label, fn) {
      state.runs++;
      const value = await fn({} as Page, { context: {} as never, keepArtifacts: () => {}, screenshot: async (tag) => `/tmp/artifacts/${tag}.png` });
      return { value, artifacts: {} };
    },
    warmUp: async () => {},
    stats: () => ({ size: 3, active: 0, waiting: 0, browserLaunched: true, launches: 1 }),
    close: async () => {},
  };
  return { pool, state };
}

const filled = (): FillResult => ({
  status: "filled", formUrl: "https://x.test/form", durationMs: 10, pending: [],
  fields: [{ label: "First Name", value: "Ada", kind: "text" }], files: [{ label: "Resume/CV", path: "/tmp/resume.pdf" }],
});

function stubDriver(fill: (answers: Record<string, string>, call: number) => FillResult) {
  const calls: Array<Record<string, string>> = [];
  const driver: Driver = {
    name: "greenhouse",
    detect: () => true,
    formUrl: () => null,
    async fill(_page, ctx) { calls.push({ ...ctx.answers }); return fill(ctx.answers, calls.length); },
    async submit() { throw new Error("a dry run must never submit"); },
  };
  return { driver, calls };
}

/** Writes a resume row the way the real Preparer does (tailor sets `resume_id`), then reports prepared. */
function stubPreparer(db: Db): Preparer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async prepare(applicationId) {
      calls.push(applicationId);
      const [r] = await db.insert(resumes).values({ applicationId, content: {}, pdfPath: "/tmp/resume.pdf" }).returning();
      await db.update(applications).set({ resumeId: r!.id }).where(eq(applications.id, applicationId));
      return { outcome: "prepared" };
    },
  };
}

async function seedApplication(db: Db, userId: string, title = "Backend Engineer"): Promise<string> {
  const [c] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `apply${n++}`, name: "Acme Robotics" }).returning();
  const [j] = await db.insert(jobs).values({
    companyId: c!.id, atsType: "greenhouse", externalId: `e${n++}`, title, location: "Remote", remote: true, descriptionText: "", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", dedupeKey: `d${n++}`,
  }).returning();
  const [a] = await db.insert(applications).values({ userId, jobId: j!.id, status: "queued" }).returning();
  return a!.id;
}

const statusOf = async (db: Db, id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0]!;

describe("worker: prepare and apply", () => {
  let worker: Worker;
  let queue: MemoryQueue;
  afterEach(async () => { await worker?.stop(); });

  async function boot(driver: Driver, preparer: Preparer) {
    queue = new MemoryQueue();
    const pool = stubPool();
    worker = await startWorker({
      db: t.db, queue, config: config(), log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool: pool.pool, preparer,
      applyOverrides: { drivers: [driver] },
    });
    return pool;
  }

  it("prepares a queued application with the Preparer, then a click runs a dry-run apply on the pool", async () => {
    const userId = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId);
    const { driver, calls } = stubDriver(() => filled());
    const preparer = stubPreparer(t.db);
    const pool = await boot(driver, preparer);

    await queue.enqueue(JOBS.prepareApplication, { applicationId: appId });
    await queue.drain();
    expect(preparer.calls).toEqual([appId]);
    expect(await statusOf(t.db, appId)).toMatchObject({ status: "prepared" });
    expect(pool.state.runs).toBe(0); // nothing touches the browser before the click

    await queue.enqueue(JOBS.applyRun, { applicationId: appId, trigger: "click" });
    await queue.drain();
    expect(queue.failures()).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(pool.state.runs).toBe(1);
    const after = await statusOf(t.db, appId);
    // Dry run: the form was filled and the run stopped before submit, back at prepared with a receipt that says so.
    expect(after).toMatchObject({ status: "prepared" });
    expect(after.approvedAt).not.toBeNull();
    expect(after.submittedAt).toBeNull();
    expect(after.receipt).toMatchObject({ dryRun: true });
    const events = (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, appId))).map((e) => e.step);
    expect(events).toContain("apply_start");
  });

  it("answers the questions a form asked from the profile and resumes by itself", async () => {
    const userId = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Platform Engineer");
    const ask = { id: "how-did-you-hear-about-us", text: "How did you hear about us?", type: "text" as const, options: [], required: true };
    const { driver, calls } = stubDriver((answers) => (answers[ask.id]
      ? filled()
      : { status: "needs_user", formUrl: null, fields: [], files: [], pending: [ask], needsUser: { kind: "questions", reason: "One question needs an answer" }, durationMs: 5 }));
    await boot(driver, stubPreparer(t.db));

    await queue.enqueue(JOBS.prepareApplication, { applicationId: appId });
    await queue.drain();
    await queue.enqueue(JOBS.applyRun, { applicationId: appId, trigger: "click" });
    await queue.drain();

    expect(queue.failures()).toEqual([]);
    // First pass asked, the worker answered from the profile defaults, the second pass had the answer.
    expect(calls).toHaveLength(2);
    expect(calls[1]![ask.id]).toBeTruthy();
    expect(await statusOf(t.db, appId)).toMatchObject({ status: "prepared" });
  });

  it("leaves a question it cannot answer for the user", async () => {
    const userId = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Data Engineer");
    const ask = { id: "favourite-sorting-algorithm", text: "What is your favourite sorting algorithm?", type: "select" as const, options: ["Quick", "Merge"], required: true };
    const { driver, calls } = stubDriver(() => ({ status: "needs_user", formUrl: null, fields: [], files: [], pending: [ask], needsUser: { kind: "questions", reason: "One question needs an answer" }, durationMs: 5 }));
    await boot(driver, stubPreparer(t.db));
    await queue.enqueue(JOBS.prepareApplication, { applicationId: appId });
    await queue.drain();
    await queue.enqueue(JOBS.applyRun, { applicationId: appId, trigger: "click" });
    await queue.drain();
    expect(calls).toHaveLength(1);
    expect(await statusOf(t.db, appId)).toMatchObject({ status: "needs_user" });
  });
});

describe("worker: inbox and lifecycle", () => {
  it("inbox.receive reprocesses a stored message and an unknown id does not crash the queue", async () => {
    const userId = await seedUser(t.db);
    const address = await assignInboxAddress(t.db, userId, "inbox.example.test");
    const stored = await receiveInbound(t.db, { from: "no-reply@us.greenhouse-mail.io", to: address, subject: "Security code", text: "Your security code is 664422.", messageId: "w-1" });
    if (!stored.stored) throw new Error("not stored");
    const queue = new MemoryQueue();
    const worker = await startWorker({ db: t.db, queue, config: config(), log: silentLogger, scheduler: false, seed: false, pool: stubPool().pool });
    await queue.enqueue(JOBS.inboxReceive, { messageId: stored.messageId });
    await queue.enqueue(JOBS.inboxReceive, { messageId: "00000000-0000-4000-8000-000000000000" });
    await queue.drain();
    expect(queue.failures()).toEqual([]);
    expect((await t.db.select().from(inboxMessages).where(eq(inboxMessages.id, stored.messageId)))[0]).toMatchObject({ kind: "verification_code", code: "664422" });
    await worker.stop();
    await worker.stop(); // stopping twice is harmless
  });

  it("seeds the board registry and starts without a browser", async () => {
    const db = (await createTestDb());
    try {
      const queue = new MemoryQueue();
      const pool = stubPool().pool;
      const worker = await startWorker({ db: db.db, queue, config: config(), log: silentLogger, scheduler: false, pool });
      expect((await db.db.select().from(companies)).length).toBeGreaterThan(50);
      await worker.stop();
    } finally {
      await db.close();
    }
  });
});

describe("config", () => {
  it("reads sizes from the environment and falls back to defaults", () => {
    expect(loadConfig({})).toMatchObject({ browserPoolSize: 3, scheduleEveryMs: 180_000, pollsPerHost: 4, hostBoardsPerRun: 8, validatePerRun: 50, databaseUrl: undefined });
    expect(loadConfig({ BROWSER_POOL_SIZE: "4", DATABASE_URL: "postgres://x", SCHEDULE_EVERY_MINUTES: "5" })).toMatchObject({ browserPoolSize: 4, scheduleEveryMs: 300_000, databaseUrl: "postgres://x" });
    expect(loadConfig({ BROWSER_POOL_SIZE: "nope" }).browserPoolSize).toBe(3);
  });
});
