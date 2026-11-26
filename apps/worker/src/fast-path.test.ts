import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, channels, companies, eq, jobs, resumes, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { saveSchedule, type BrowserPool, type Preparer } from "@norinote/apply";
import { saveTelegramSettings } from "@norinote/telegram";
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
  run: async () => { throw new Error("no browser in this test"); },
  warmUp: async () => {}, close: async () => {},
  stats: () => ({ size: 1, active: 0, waiting: 0, browserLaunched: false, launches: 0 }),
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
async function strongFit(userId: string, fit = 0.9) {
  const [c] = await t.db.insert(companies).values({ name: `Co ${n}`, atsType: "greenhouse", atsToken: `co${n++}` }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `x${n}`, title: "Backend Engineer", applyUrl: `https://job-boards.greenhouse.io/co/jobs/${n}`, dedupeKey: `f${n}` }).returning();
  // No career points: match.new-jobs leaves this row as it is, and only the strong-fit step acts on it.
  await t.db.insert(shortlist).values({ userId, jobId: j!.id, fit, status: "new" });
  return j!.id;
}

describe("fast path: strong fits are prepared right after matching", () => {
  it("prepares a strong fit at once for a person with the schedule or the Telegram alert on, and for nobody else", async () => {
    const queue = new MemoryQueue();
    const worker = await startWorker({ db: t.db, queue, config: { ...loadConfig({}), matchBatchMs: 0, explainTop: 0 }, log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool, preparer });
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
      expect(forJob(strong.schedule)).toMatchObject({ status: "prepared", approvedAt: null });
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

describe("match batch", () => {
  it("waits half a second by default", () => {
    expect(loadConfig({}).matchBatchMs).toBe(500);
  });
});
