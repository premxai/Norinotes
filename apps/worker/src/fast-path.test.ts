import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, channels, companies, eq, jobs, resumes, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { Page } from "playwright";
import { saveSchedule, type BrowserPool, type Driver, type FillResult, type Preparer } from "@norinote/apply";
import { placeInGroup, type DECISION_FIT_MAPS } from "@norinote/match/testing";
import { saveTelegramSettings, strongFitEvents } from "@norinote/telegram";
import { MemoryQueue, JOBS } from "@norinote/queue";
import { loadConfig } from "./config.js";
import { silentLogger } from "./log.js";
import { startWorker } from "./worker.js";

const NOW = new Date("2026-11-26T18:00:00Z");
let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

const pool: BrowserPool = {
  artifactsDir: "/tmp/artifacts",
  async run(_label, fn) {
    const value = await fn({} as Page, { context: {} as never, keepArtifacts: () => {}, screenshot: async (tag) => `/tmp/artifacts/${tag}.png` });
    return { value, artifacts: {} };
  },
  warmUp: async () => {}, close: async () => {},
  stats: () => ({ size: 1, active: 0, waiting: 0, browserLaunched: true, launches: 1 }),
};
const filled: FillResult = {
  status: "filled", formUrl: "https://x.test/form", durationMs: 10, pending: [],
  fields: [{ label: "First Name", value: "Ada", kind: "text" }], files: [{ label: "Resume/CV", path: "/tmp/resume.pdf" }],
};
const driver: Driver = {
  name: "greenhouse", detect: () => true, formUrl: () => null,
  fill: async () => filled,
  submit: async () => { throw new Error("a dry run must never submit"); },
};
const prepared: string[] = [];
const preparer: Preparer = {
  async prepare(applicationId) {
    prepared.push(applicationId);
    const [r] = await t.db.insert(resumes).values({ applicationId, content: {}, pdfPath: "/tmp/resume.pdf" }).returning();
    await t.db.update(applications).set({ resumeId: r!.id }).where(eq(applications.id, applicationId));
    return { outcome: "prepared" };
  },
};

let n = 0;
async function person(optIn: "schedule" | "telegram" | "telegram-alert-off" | "paused" | "none") {
  const [u] = await t.db.insert(users).values({ email: `fast${n++}@example.test`, passwordHash: "x" }).returning();
  if (optIn === "schedule" || optIn === "paused") await saveSchedule(t.db, u!.id, { enabled: true, paused: optIn === "paused" });
  if (optIn === "telegram" || optIn === "telegram-alert-off") await t.db.insert(channels).values({ userId: u!.id, kind: "telegram", address: `chat${n}` });
  if (optIn === "telegram-alert-off") await saveTelegramSettings(t.db, u!.id, { events: { strongFit: false } });
  return u!.id;
}
async function strongFit(userId: string, fit = 0.9, group: keyof typeof DECISION_FIT_MAPS = "strong") {
  const [c] = await t.db.insert(companies).values({ name: `Co ${n}`, atsType: "greenhouse", atsToken: `co${n++}` }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `x${n}`, title: "Backend Engineer", applyUrl: `https://job-boards.greenhouse.io/co/jobs/${n}`, dedupeKey: `f${n}` }).returning();
  // No career points: match.new-jobs leaves this row as it is, and only the strong-fit step acts on it.
  await t.db.insert(shortlist).values({ userId, jobId: j!.id, fit, status: "new" });
  await placeInGroup(t.db, userId, j!.id, group);
  return j!.id;
}

describe("fast path: strong fits are prepared right after matching, and autopilot sends them", () => {
  it("prepares a strong fit at once for a person with the schedule or the Telegram alert on, and for nobody else", async () => {
    const queue = new MemoryQueue();
    const worker = await startWorker({ db: t.db, queue, config: { ...loadConfig({}), matchBatchMs: 0, explainTop: 0 }, log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool, preparer, applyOverrides: { drivers: [driver] } });
    try {
      const people = { schedule: await person("schedule"), telegram: await person("telegram"), alertOff: await person("telegram-alert-off"), paused: await person("paused"), none: await person("none") };
      const strong = {
        schedule: await strongFit(people.schedule), telegram: await strongFit(people.telegram), alertOff: await strongFit(people.alertOff),
        paused: await strongFit(people.paused), none: await strongFit(people.none),
      };
      const plausible = await strongFit(people.schedule, 0.75);
      await queue.enqueue(JOBS.matchNewJobs, { jobIds: [...Object.values(strong), plausible] });
      await queue.drain();
      expect(queue.failures()).toEqual([]);

      const apps = await t.db.select().from(applications);
      const forJob = (jobId: string) => apps.find((a) => a.jobId === jobId);
      // Schedule on: autopilot sends it as soon as it is prepared. Telegram only: it waits for the person's OK.
      // (A dry run here: the form is filled and the run stops before submit, back at prepared with a dry-run receipt.)
      expect(forJob(strong.schedule)!.approvedAt).toEqual(NOW);
      expect(forJob(strong.schedule)!.receipt).toMatchObject({ dryRun: true });
      expect(queue.stats(JOBS.applyRun)).toMatchObject({ completed: 1, failed: 0 });
      expect(forJob(strong.telegram)).toMatchObject({ status: "prepared", approvedAt: null });
      expect(forJob(strong.alertOff)).toBeUndefined();
      expect(forJob(strong.paused)).toBeUndefined();
      expect(forJob(strong.none)).toBeUndefined();
      expect(forJob(plausible)).toBeUndefined();
      expect(prepared.sort()).toEqual([forJob(strong.schedule)!.id, forJob(strong.telegram)!.id].sort());
      expect(queue.stats(JOBS.prepareApplication)).toMatchObject({ completed: 2, failed: 0 });
    } finally {
      await worker.stop();
    }
  });
});

describe("fast path: autopilot sends only what the apply decision sends", () => {
  it("sends a prepared strong fit on balanced, and asks about a prepared stretch through the strong-fit alert instead of sending it", async () => {
    const queue = new MemoryQueue();
    const worker = await startWorker({ db: t.db, queue, config: { ...loadConfig({}), matchBatchMs: 0, explainTop: 0 }, log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool, preparer, applyOverrides: { drivers: [driver] } });
    try {
      const userId = await person("schedule");
      const strong = await strongFit(userId);
      const stretch = await strongFit(userId, 0.85, "stretch");
      await queue.enqueue(JOBS.matchNewJobs, { jobIds: [strong, stretch] });
      await queue.drain();
      expect(queue.failures()).toEqual([]);

      const apps = await t.db.select().from(applications).where(eq(applications.userId, userId));
      const forJob = (jobId: string) => apps.find((a) => a.jobId === jobId)!;
      expect(forJob(strong).approvedAt).toEqual(NOW);
      expect(forJob(stretch)).toMatchObject({ status: "prepared", approvedAt: null });
      const alerts = await strongFitEvents(t.db, userId, new Date(0), { webUrl: "https://app.test", secret: "s" });
      expect(alerts.map((a) => a.applicationId)).toEqual([forJob(stretch).id]);
      expect(alerts[0]!.payload.text).toMatch(/^<b>Your call<\/b>: Backend Engineer at Co /);
      expect(JSON.stringify(alerts[0]!.payload.keyboard)).toContain("Skip");
    } finally {
      await worker.stop();
    }
  });
});

describe("match batch", () => {
  it("waits half a second by default", () => {
    expect(loadConfig({}).matchBatchMs).toBe(500);
  });
});
