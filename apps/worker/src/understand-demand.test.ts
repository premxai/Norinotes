import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setAiLogger, setProvider, type ChatRequest } from "@norinote/ai";
import { MAX_JOB_AGE_HOURS, careerPoints, companies, eq, graphSources, jobSpecs, jobs, lanes, profiles, shortlist, users, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { BrowserPool } from "@norinote/apply";
import type { JobSpecModelOutput } from "@norinote/match";
import { JOBS, MemoryQueue } from "@norinote/queue";
import { loadConfig, type WorkerConfig } from "./config.js";
import { createLogger, silentLogger } from "./log.js";
import { startWorker, type Worker } from "./worker.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({ ...loadConfig({}), matchBatchMs: 0, explainTop: 0, ...over });
const stubPool = { run: async () => { throw new Error("no browser in this test"); }, warmUp: async () => {}, stats: () => ({}), close: async () => {} } as unknown as BrowserPool;

let t: TestDb;
let worker: Worker | undefined;
beforeAll(async () => {
  setAiLogger(() => undefined);
  t = await createTestDb();
});
afterAll(() => t.close());
afterEach(async () => { await worker?.stop(); worker = undefined; setProvider(null); });

let n = 0;
async function seedUser(db: Db, opts: { points?: boolean } = {}): Promise<string> {
  const [u] = await db.insert(users).values({ email: `d${n++}@example.test`, passwordHash: "x" }).returning();
  await db.insert(profiles).values({ userId: u!.id, location: "Austin, TX", workAuth: { US: { authorized: true, needsSponsorship: false } } });
  if (opts.points !== false) {
    await db.insert(careerPoints).values({
      userId: u!.id, kind: "role", title: "Backend Engineer", org: "Initech", startDate: "2022-01", endDate: null, skills: ["Python", "Kubernetes", "PostgreSQL"],
      text: "Backend Engineer. Built backend APIs in Python on Kubernetes with PostgreSQL.",
    });
  }
  return u!.id;
}

const lane = (db: Db, userId: string, titles: string[], over: Partial<typeof lanes.$inferInsert> = {}) =>
  db.insert(lanes).values({ userId, name: titles[0]!, titles, locations: [], remote: true, minFit: 0.1, ...over });

const modelSpec: JobSpecModelOutput = {
  mustHaves: [{ text: "Python", weight: 0.9 }], niceToHaves: [],
  skills: [{ name: "Python", level: "advanced", years: null, required: true }, { name: "Kubernetes", level: "working", years: null, required: false }],
  seniority: "mid", roleFamily: "backend engineering", yearsMin: null, location: { remote: "remote", countries: ["United States"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [],
};

/** A company first read 30 days ago, with open jobs; each is `[title, hoursAgo]`. */
async function seedBoard(db: Db, token: string, list: Array<[string, number]>): Promise<string[]> {
  const [c] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: token, name: `Co ${token}`, firstReadAt: new Date(NOW.getTime() - 30 * 86_400_000) }).returning();
  const ids: string[] = [];
  for (const [title, hoursAgo] of list) {
    const posted = new Date(NOW.getTime() - hoursAgo * 3_600_000);
    const [j] = await db.insert(jobs).values({
      companyId: c!.id, atsType: "greenhouse", externalId: `${token}-${n++}`, title, location: "Remote - US", remote: true,
      descriptionText: `${title}. Build APIs in Python on Kubernetes.`, applyUrl: `https://example.test/${token}/${n}`, postedAt: posted, firstSeenAt: posted, dedupeKey: `${token}-${n}`,
    }).returning();
    ids.push(j!.id);
  }
  return ids;
}

const specsOf = async (ids: string[]) => {
  const rows = await t.db.select().from(jobSpecs);
  return ids.filter((id) => rows.some((r) => r.jobId === id));
};

async function start(queue: MemoryQueue, over: Partial<WorkerConfig> = {}, extra: Parameters<typeof startWorker>[0] = {}) {
  worker = await startWorker({ db: t.db, queue, config: config(over), log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool: stubPool, ...extra });
  return worker;
}

/** A shortlist row the lanes produced, not the widening ladder. */
const laneRow = (r: { reasons: string[] }) => !r.reasons.some((x) => x.startsWith("widened:"));

describe("understand on demand: after a board poll", () => {
  const feed = (rows: Array<{ id: number; title: string; published: string }>): typeof fetch => (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes("boards-api.greenhouse.io/v1/boards/demand-poll/jobs")) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify({
      jobs: rows.map((r) => ({
        id: r.id, title: r.title, absolute_url: `https://boards.greenhouse.io/demand-poll/jobs/${r.id}`, first_published: r.published,
        location: { name: "Remote - US" }, company_name: "Demand Poll", content: `&lt;p&gt;${r.title}. Python and Kubernetes.&lt;/p&gt;`,
      })),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  it("enqueues understand.job only for new jobs that fit an enabled lane of some user", async () => {
    setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) }));
    await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "demand-poll", name: "Demand Poll" });
    const a = await seedUser(t.db, { points: false });
    await lane(t.db, a, ["Backend Engineer"]);
    const b = await seedUser(t.db, { points: false });
    await lane(t.db, b, ["Data Scientist"], { enabled: false });

    const lines: Array<Record<string, unknown>> = [];
    const queue = new MemoryQueue();
    await start(queue, {}, {
      log: createLogger((l) => lines.push(JSON.parse(l)), () => NOW),
      fetch: feed([
        { id: 1, title: "Backend Engineer", published: "2026-10-30T09:00:00Z" },
        { id: 2, title: "Senior Backend Engineer, Payments", published: "2026-10-30T09:00:00Z" },
        { id: 3, title: "Data Scientist", published: "2026-10-30T09:00:00Z" },
        { id: 4, title: "Marketing Manager", published: "2026-10-30T09:00:00Z" },
        { id: 5, title: "Backend Engineer, Legacy", published: "2026-06-01T09:00:00Z" },
      ]),
    });
    expect(await worker!.consumers.enqueueDueBoards()).toBe(1);
    await queue.drain();

    const all = await t.db.select().from(jobs).where(eq(jobs.atsType, "greenhouse"));
    const mine = all.filter((j) => j.applyUrl.includes("demand-poll"));
    expect(mine).toHaveLength(5);
    const understood = (await t.db.select().from(jobSpecs)).map((r) => r.jobId);
    const titlesUnderstood = mine.filter((j) => understood.includes(j.id)).map((j) => j.title).sort();
    // Fits lane A and is fresh: the two backend jobs. The data scientist only fits a disabled lane, marketing fits none, and
    // the legacy one is older than 7 days.
    expect(titlesUnderstood).toEqual(["Backend Engineer", "Senior Backend Engineer, Payments"]);
    expect(queue.stats(JOBS.understandJob)).toMatchObject({ completed: 2, failed: 0 });
    const poll = lines.find((l) => l.queue === JOBS.ingestPollBoard);
    expect(poll).toMatchObject({ ok: true, added: 5, understand: 2, notWanted: 3, trimmed: 1 });
    // Lean storage: the job nobody can be shown was stored without its description.
    expect(mine.find((j) => j.title === "Backend Engineer, Legacy")?.descriptionText).toBe("");
    expect(mine.find((j) => j.title === "Marketing Manager")?.descriptionText).toContain("Marketing Manager");
  });

  it("enqueues nothing while nobody has a lane", async () => {
    // A fresh database: no lanes at all.
    const own = await createTestDb();
    try {
      await own.db.insert(companies).values({ atsType: "greenhouse", atsToken: "demand-poll", name: "Demand Poll" });
      const queue = new MemoryQueue();
      worker = await startWorker({
        db: own.db, queue, config: config(), log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool: stubPool,
        fetch: feed([{ id: 1, title: "Backend Engineer", published: "2026-10-30T09:00:00Z" }, { id: 2, title: "Data Scientist", published: "2026-10-30T09:00:00Z" }]),
      });
      await worker.consumers.enqueueDueBoards();
      await queue.drain();
      expect(await own.db.select().from(jobs)).toHaveLength(2);
      expect(queue.stats(JOBS.understandJob)).toEqual({ queued: 0, active: 0, completed: 0, failed: 0 });
      expect(await own.db.select().from(jobSpecs)).toHaveLength(0);
    } finally {
      await worker?.stop();
      worker = undefined;
      await own.close();
    }
  });
});

describe("understand on demand: a lane change reads the backlog", () => {
  it("match.user queues understand.job for unspecced jobs that fit the user's lanes, then the batch match shortlists them", async () => {
    setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) }));
    const [fitA, fitB, stale, other] = await seedBoard(t.db, "backlog", [["Zebra Engineer", 30], ["Senior Zebra Engineer", 50], ["Zebra Engineer", MAX_JOB_AGE_HOURS + 8], ["Marketing Zebra", 30]]);
    const userId = await seedUser(t.db);
    const queue = new MemoryQueue();
    await start(queue);

    // No lane yet: nothing to read for this user.
    await queue.enqueue(JOBS.matchUser, { userId, reason: "profile" });
    await queue.drain();
    expect(queue.stats(JOBS.understandJob).completed).toBe(0);

    // The user creates a lane: the jobs it fits are queued for understanding, the others are not.
    await lane(t.db, userId, ["Zebra Engineer"]);
    await queue.enqueue(JOBS.matchUser, { userId, reason: "lanes" });
    await queue.drain();
    expect(queue.stats(JOBS.understandJob)).toMatchObject({ completed: 2, failed: 0 });
    expect((await specsOf([fitA!, fitB!, stale!, other!])).sort()).toEqual([fitA!, fitB!].sort());

    // Understood jobs reach the user through the match batch.
    await worker!.consumers.flushMatchBatch();
    await queue.drain();
    expect(queue.stats(JOBS.matchNewJobs)).toMatchObject({ failed: 0 });
    // The two jobs the lane fits; jobs other tests left in the shared index may be added by widening and are labelled as such.
    expect((await t.db.select().from(shortlist).where(eq(shortlist.userId, userId))).filter(laneRow).map((r) => r.jobId).sort()).toEqual([fitA!, fitB!].sort());

    // Asking again reads nothing twice: both jobs have specs.
    await queue.enqueue(JOBS.matchUser, { userId, reason: "manual" });
    await queue.drain();
    expect(queue.stats(JOBS.understandJob).completed).toBe(2);
    expect(queue.failures()).toEqual([]);
  });

  it("a backlog of 12 jobs drains with at most 4 understand.job handlers at once", async () => {
    const fake = createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) });
    let inFlight = 0;
    let maxInFlight = 0;
    setProvider({
      name: "slow",
      chat: async (req: ChatRequest) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return fake.chat(req);
      },
      embed: (req) => fake.embed(req),
    });
    const ids = await seedBoard(t.db, "burst", Array.from({ length: 12 }, (_, i): [string, number] => [`Walrus Engineer ${i}`, 24]));
    const userId = await seedUser(t.db, { points: false });
    await lane(t.db, userId, ["Walrus Engineer"]);
    const queue = new MemoryQueue();
    await start(queue);
    expect(worker!.queue.kind).toBe("memory");
    await queue.enqueue(JOBS.matchUser, { userId, reason: "lanes" });
    await queue.drain();
    expect(queue.stats(JOBS.understandJob)).toMatchObject({ completed: 12, failed: 0 });
    expect((await specsOf(ids)).length).toBe(12);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("a run waits 8 minutes for an emailed or typed code unless CODE_WAIT_MINUTES says otherwise", () => {
    expect(loadConfig({}).codeWaitMs).toBe(8 * 60_000);
    expect(loadConfig({ CODE_WAIT_MINUTES: "3" }).codeWaitMs).toBe(3 * 60_000);
  });

  it("understand concurrency comes from UNDERSTAND_CONCURRENCY and defaults to 4", () => {
    expect(loadConfig({}).understandConcurrency).toBe(4);
    expect(loadConfig({ UNDERSTAND_CONCURRENCY: "2" }).understandConcurrency).toBe(2);
    expect(loadConfig({ UNDERSTAND_CONCURRENCY: "0" }).understandConcurrency).toBe(4);
  });
});

describe("the worker while the AI service rejects our key", () => {
  it("fails no job: jobs get heuristic specs, points stay unembedded, and the shortlist still fills by skill overlap", async () => {
    const fail = () => Promise.reject(Object.assign(new Error("401 Incorrect API key provided: sk-proj-SECRET"), { status: 401 }));
    setProvider({ name: "rejected-key", chat: fail, embed: fail });
    const ids = await seedBoard(t.db, "noai", [["Yak Engineer", 24], ["Yak Engineer, Platform", 40], ["Yak Marketing", 24]]);
    const userId = await seedUser(t.db);
    await lane(t.db, userId, ["Yak Engineer"]);
    const queue = new MemoryQueue();
    await start(queue);

    await queue.enqueue(JOBS.matchUser, { userId, reason: "lanes" });
    await queue.drain();
    await worker!.consumers.flushMatchBatch();
    await queue.drain();

    expect(queue.failures()).toEqual([]);
    const specs = await t.db.select().from(jobSpecs);
    const mine = specs.filter((s) => ids.includes(s.jobId));
    expect(mine).toHaveLength(2);
    expect(mine.every((s) => s.model === "heuristic" && s.version === 0)).toBe(true);
    const rows = await t.db.select().from(shortlist).where(eq(shortlist.userId, userId));
    expect(rows.filter(laneRow).map((r) => r.jobId).sort()).toEqual([ids[0]!, ids[1]!].sort());
  });
});

describe("once the AI service is back", () => {
  it("the catch-up pass has the model read jobs that only have a heuristic spec, and the batch match scores them", async () => {
    setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) }));
    const [job] = await seedBoard(t.db, "upgrade", [["Okapi Engineer", 10]]);
    await t.db.insert(jobSpecs).values({
      jobId: job!, version: 0, model: "heuristic", createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
      spec: { mustHaves: [], niceToHaves: [], skills: [], seniority: "unknown", roleFamily: "", yearsMin: null, location: { remote: "remote", countries: [], cities: [] }, citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [] },
    });
    const userId = await seedUser(t.db);
    await lane(t.db, userId, ["Okapi Engineer"]);
    const queue = new MemoryQueue();
    await start(queue);

    await worker!.consumers.catchUp();
    await queue.drain();
    const specs = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, job!));
    expect(specs.map((s) => s.version).sort()).toEqual([0, 1]);
    await worker!.consumers.flushMatchBatch();
    await queue.drain();
    expect(queue.failures()).toEqual([]);
    expect((await t.db.select().from(shortlist).where(eq(shortlist.userId, userId))).map((r) => r.jobId)).toEqual([job!]);
  });

  it("reads a resume the basic parser read again, and retries a site read that failed over a day ago", async () => {
    setProvider(createFakeProvider());
    const userId = await seedUser(t.db, { points: false });
    await t.db.update(profiles).set({ resumeText: "Ada Lovelace\n\nEXPERIENCE\nSenior Software Engineer, Analytical Engines Inc. | Jan 2020 - Present\n- Wrote Python services that processed 2 million events per day.\n", preferences: { resumeReadBasic: true, heardAbout: "a friend" } })
      .where(eq(profiles.userId, userId));
    const day = 86_400_000;
    const [old] = await t.db.insert(graphSources).values({ userId, kind: "site", value: "https://ada.example", status: "failed", error: "AI down", lastReadAt: new Date(NOW.getTime() - 2 * day), createdAt: new Date(NOW.getTime() - 2 * day) }).returning();
    await t.db.insert(graphSources).values({ userId, kind: "github", value: "ada", status: "failed", error: "x", lastReadAt: new Date(NOW.getTime() - 3_600_000), createdAt: new Date(NOW.getTime() - 2 * day) });
    await t.db.insert(graphSources).values({ userId, kind: "site", value: "https://old.example", status: "failed", error: "x", lastReadAt: new Date(NOW.getTime() - 2 * day), createdAt: new Date(NOW.getTime() - 10 * day) });
    const queue = new MemoryQueue();
    await start(queue);

    const r = await worker!.consumers.catchUp();
    expect(r).toMatchObject({ resumes: 1, sourcesQueued: 1 });
    const [p] = await t.db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p!.preferences).toEqual({ heardAbout: "a friend" });
    expect((await t.db.select().from(careerPoints).where(eq(careerPoints.userId, userId))).length).toBeGreaterThan(0);
    expect(queue.stats(JOBS.matchUser).queued + queue.stats(JOBS.matchUser).active + queue.stats(JOBS.matchUser).completed).toBeGreaterThan(0);
    expect(queue.stats(JOBS.graphReadSource).queued + queue.stats(JOBS.graphReadSource).active + queue.stats(JOBS.graphReadSource).completed + queue.stats(JOBS.graphReadSource).failed).toBe(1);
    expect(old).toBeTruthy();
  });
});

describe("a retried poll", () => {
  /** Refuses the first understand.job enqueue, as a database hiccup after the jobs were stored would. */
  class FlakyQueue extends MemoryQueue {
    failed = false;
    override async enqueue(...args: Parameters<MemoryQueue["enqueue"]>): ReturnType<MemoryQueue["enqueue"]> {
      if (args[0] === JOBS.understandJob && !this.failed) { this.failed = true; throw new Error("connection reset"); }
      return super.enqueue(...args);
    }
  }

  it("still queues understanding for the jobs the failed try stored", async () => {
    setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) }));
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "retry-poll", name: "Retry Poll" }).returning();
    const userId = await seedUser(t.db, { points: false });
    await lane(t.db, userId, ["Tapir Engineer"]);
    const fetchFeed = (async (input: string | URL | Request) => {
      if (!String(input).includes("boards-api.greenhouse.io/v1/boards/retry-poll/jobs")) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({
        jobs: [7101, 7102].map((id) => ({
          id, title: `Tapir Engineer ${id}`, absolute_url: `https://boards.greenhouse.io/retry-poll/jobs/${id}`, first_published: "2026-10-30T09:00:00Z",
          location: { name: "Remote - US" }, company_name: "Retry Poll", content: "&lt;p&gt;Tapir Engineer. Python.&lt;/p&gt;",
        })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const queue = new FlakyQueue();
    await start(queue, {}, { fetch: fetchFeed });

    await queue.enqueue(JOBS.ingestPollBoard, { companyId: c!.id }, { retryDelaySeconds: 0 });
    await queue.drain();
    expect(queue.failed).toBe(true);
    const mine = await t.db.select().from(jobs).where(eq(jobs.companyId, c!.id));
    expect(mine).toHaveLength(2);
    expect((await specsOf(mine.map((j) => j.id))).length).toBe(2);
  });
});

describe("stopping the worker", () => {
  it("still hands jobs understood during the shutdown wait to match.new-jobs", async () => {
    const fake = createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? modelSpec : undefined) });
    let started = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setProvider({ name: "slow", chat: async (req: ChatRequest) => { started = true; await gate; return fake.chat(req); }, embed: (req) => fake.embed(req) });
    const [job] = await seedBoard(t.db, "shutdown", [["Ibex Engineer", 5]]);
    const queue = new MemoryQueue();
    // A long batch window: only the shutdown can hand the job on.
    const w = await start(queue, { matchBatchMs: 600_000 });
    await queue.enqueue(JOBS.understandJob, { jobId: job! });
    while (!started) await new Promise((r) => setTimeout(r, 5));

    const stopping = w.stop();
    release();
    await stopping;
    worker = undefined;
    expect(queue.stats(JOBS.matchNewJobs).queued).toBe(1);
  });
});
