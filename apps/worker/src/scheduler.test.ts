import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, eq, jobs, lanes, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { BrowserPool } from "@norinote/apply";
import { CONNECTORS } from "@norinote/ingest";
import { JOBS, MemoryQueue } from "@norinote/queue";
import { loadConfig, type WorkerConfig } from "./config.js";
import { createLogger, silentLogger } from "./log.js";
import { startWorker, type Worker } from "./worker.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const HOUR = 3_600_000;
const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({ ...loadConfig({}), matchBatchMs: 0, explainTop: 0, ...over });
const stubPool = { run: async () => { throw new Error("no browser"); }, warmUp: async () => {}, stats: () => ({}), close: async () => {} } as unknown as BrowserPool;

let t: TestDb;
let worker: Worker | undefined;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
afterEach(async () => { await worker?.stop(); worker = undefined; });

const ghBoard = (token: string, titles: string[]) => ({
  jobs: titles.map((title, i) => ({
    id: i + 1, title, absolute_url: `https://boards.greenhouse.io/${token}/jobs/${i + 1}`, first_published: "2026-10-29T09:00:00Z",
    location: { name: "Remote - US" }, company_name: token, content: `&lt;p&gt;${title}&lt;/p&gt;`,
  })),
});
const greenhouseFetch = (boards: Record<string, string[]>): typeof fetch => (async (input: string | URL | Request) => {
  const url = String(input);
  const m = url.match(/boards\/([^/]+)\/jobs\?content=true$/);
  const titles = m ? boards[m[1]!] : undefined;
  if (!titles) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify(ghBoard(m![1]!, titles)), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function start(queue: MemoryQueue, over: Partial<WorkerConfig>, fetch: typeof globalThis.fetch, extra: Parameters<typeof startWorker>[0] = {}) {
  worker = await startWorker({ db: t.db, queue, config: config(over), log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool: stubPool, fetch, ...extra });
  return worker;
}
const reset = async () => { await t.db.delete(jobs); await t.db.delete(companies); await t.db.delete(lanes); };

describe("scheduler", () => {
  it("validates candidates with their first poll: jobs found -> active, not found -> dead", async () => {
    await reset();
    await t.db.insert(companies).values([
      { atsType: "greenhouse", atsToken: "real", name: "Real", status: "candidate", discoveredVia: "seed:ats-scrapers" },
      { atsType: "greenhouse", atsToken: "ghost", name: "Ghost", status: "candidate", discoveredVia: "seed:ats-scrapers" },
    ]);
    const lines: Array<Record<string, unknown>> = [];
    const queue = new MemoryQueue();
    await start(queue, {}, greenhouseFetch({ real: ["Backend Engineer"] }), { log: createLogger((l) => lines.push(JSON.parse(l)), () => NOW) });
    expect(await worker!.consumers.enqueueValidations()).toBe(2);
    await queue.drain();
    const rows = await t.db.select().from(companies);
    expect(rows.find((r) => r.atsToken === "real")).toMatchObject({ status: "active", lastJobCount: 1 });
    expect(rows.find((r) => r.atsToken === "ghost")).toMatchObject({ status: "dead", notFoundSince: NOW });
    const polls = lines.filter((l) => l.queue === JOBS.ingestPollBoard);
    expect(polls.map((l) => l.validated).sort()).toEqual(["active", "dead"]);
    // validated boards are not due again soon, the dead one only in a week
    expect(await worker!.consumers.enqueueDueBoards()).toBe(0);
  });

  it("gives candidates their own budget, so a long seed list does not crowd out live boards", async () => {
    await reset();
    for (let i = 0; i < 6; i++) await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `seed${i}`, name: `Seed ${i}`, status: "candidate" });
    await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "live", name: "Live", priority: 100 });
    const queue = new MemoryQueue();
    await start(queue, { validatePerRun: 2, boardsPerRun: 1, hostBoardsPerRun: 50 }, greenhouseFetch({}));
    expect(await worker!.consumers.enqueueDueBoards()).toBe(3);
    await queue.drain();
    const dead = await t.db.select().from(companies).where(eq(companies.status, "dead"));
    expect(dead).toHaveLength(2); // two validated (and not found); the other four wait for the next run
  });

  it("queues at most hostBoardsPerRun boards per host group in one run", async () => {
    await reset();
    for (let i = 0; i < 5; i++) await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `g${i}`, name: `G${i}`, host: "boards-api.greenhouse.io", nextPollAt: new Date(NOW.getTime() - i * HOUR) });
    for (let i = 0; i < 3; i++) await t.db.insert(companies).values({ atsType: "lever", atsToken: `l${i}`, name: `L${i}`, host: "api.lever.co" });
    const queue = new MemoryQueue();
    await start(queue, { hostBoardsPerRun: 2 }, greenhouseFetch({}));
    expect(await worker!.consumers.enqueueDueBoards()).toBe(4);
  });

  it("shortens next_poll_at for a board whose jobs fit enabled lanes", async () => {
    await reset();
    const [u] = await t.db.insert(users).values({ email: "demand@example.test", passwordHash: "x" }).returning();
    await t.db.insert(lanes).values({ userId: u!.id, name: "Backend", titles: ["Backend Engineer"], locations: [], remote: true });
    const [wanted] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "wanted", name: "Wanted" }).returning();
    const [plain] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "plain", name: "Plain" }).returning();
    // Both boards already know one job, so demand is visible before the poll.
    await t.db.insert(jobs).values({ companyId: wanted!.id, atsType: "greenhouse", externalId: "x1", title: "Backend Engineer", applyUrl: "https://x.test", dedupeKey: "kw" });
    await t.db.insert(jobs).values({ companyId: plain!.id, atsType: "greenhouse", externalId: "x2", title: "Cook", applyUrl: "https://x.test", dedupeKey: "kp" });
    const queue = new MemoryQueue();
    await start(queue, {}, greenhouseFetch({ wanted: ["Backend Engineer", "Backend Engineer II"], plain: ["Cook", "Cook II"] }));
    await worker!.consumers.enqueueDueBoards();
    await queue.drain();
    const rows = await t.db.select().from(companies);
    const wait = (token: string) => rows.find((r) => r.atsToken === token)!.nextPollAt!.getTime() - NOW.getTime();
    expect(wait("wanted")).toBeLessThan(wait("plain"));
    expect(wait("plain")).toBeGreaterThan(8 * HOUR);
  });

  it("limits polls at once per host group to the job system limit (Workable 2, Workday by cluster)", async () => {
    await reset();
    const make = { workable: (i: number) => `w${i}`, workday: (i: number) => `t${i}|wd5|S` } as const;
    for (const atsType of ["workable", "workday"] as const) {
      for (let i = 0; i < 6; i++) await t.db.insert(companies).values({ atsType, atsToken: make[atsType](i), name: `${atsType}${i}` });
    }
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const originals = { workable: CONNECTORS.workable, workday: CONNECTORS.workday };
    for (const atsType of ["workable", "workday"] as const) {
      CONNECTORS[atsType] = {
        ...originals[atsType], ready: true,
        listJobs: async () => {
          active.set(atsType, (active.get(atsType) ?? 0) + 1);
          peak.set(atsType, Math.max(peak.get(atsType) ?? 0, active.get(atsType)!));
          await new Promise((r) => setTimeout(r, 20));
          active.set(atsType, active.get(atsType)! - 1);
          return { jobs: [], complete: true };
        },
      };
    }
    try {
      const queue = new MemoryQueue();
      await start(queue, { pollConcurrency: 12, hostBoardsPerRun: 50 }, greenhouseFetch({}));
      await worker!.consumers.enqueueDueBoards();
      await queue.drain();
    } finally { Object.assign(CONNECTORS, originals); }
    expect(peak.get("workable")).toBe(2);
    expect(peak.get("workday")).toBeGreaterThan(2);
    expect(peak.get("workday")).toBeLessThanOrEqual(8);
  });
});
