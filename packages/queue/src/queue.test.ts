import { afterEach, describe, expect, it, vi } from "vitest";
import { JOBS, MemoryQueue, PgBossQueue, QUEUE_CONFIG, cronMatches, createQueue, enqueue, payloadSchemas, startQueue, stopQueue, work, type BossLike, type QueueAdapter } from "./index.js";

async function waitUntil(predicate: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The same behaviour is expected from every adapter. pg-boss joins when a real Postgres is provided (never required).
const adapters: [string, () => QueueAdapter][] = [["memory", () => new MemoryQueue()]];
const realUrl = process.env.TEST_DATABASE_URL;
if (realUrl) adapters.push(["pgboss", () => new PgBossQueue(realUrl)]);

describe.each(adapters)("%s adapter: shared behaviour", (_name, make) => {
  let q: QueueAdapter | null = null;
  afterEach(async () => { await q?.stop(); q = null; });
  const start = async () => { q = make(); await q.start(); return q; };

  it("runs a job and passes the validated payload with defaults applied", async () => {
    const queue = await start();
    const seen: unknown[] = [];
    await queue.work(JOBS.matchUser, (p, ctx) => { seen.push({ p, attempt: ctx.attempt }); });
    const id = await queue.enqueue(JOBS.matchUser, { userId: "u1" });
    expect(id).toBeTruthy();
    await waitUntil(() => seen.length === 1);
    expect(seen[0]).toEqual({ p: { userId: "u1", reason: "manual" }, attempt: 1 });
  });

  it("rejects an invalid payload at enqueue", async () => {
    const queue = await start();
    await expect(queue.enqueue(JOBS.applyRun, { applicationId: "a1", trigger: "robot" } as never)).rejects.toThrow();
    await expect(queue.enqueue(JOBS.matchNewJobs, { jobIds: [] })).rejects.toThrow();
  });

  it("retries a failing handler and passes the attempt number", async () => {
    const queue = await start();
    const attempts: number[] = [];
    await queue.work(JOBS.understandJob, (_p, ctx) => {
      attempts.push(ctx.attempt);
      if (ctx.attempt < 3) throw new Error("boom");
    });
    await queue.enqueue(JOBS.understandJob, { jobId: "j1" }, { retryLimit: 3, retryDelaySeconds: 0 });
    await waitUntil(() => attempts.length >= 3);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("drops a duplicate inside the dedupe window", async () => {
    const queue = await start();
    const first = await queue.enqueue(JOBS.matchUser, { userId: "u" }, { dedupeKey: "u", dedupeSeconds: 60 });
    const second = await queue.enqueue(JOBS.matchUser, { userId: "u" }, { dedupeKey: "u", dedupeSeconds: 60 });
    const other = await queue.enqueue(JOBS.matchUser, { userId: "v" }, { dedupeKey: "v", dedupeSeconds: 60 });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(other).toBeTruthy();
  });

  it("holds a delayed job back", async () => {
    const queue = await start();
    const ran: number[] = [];
    await queue.work(JOBS.inboxReceive, () => { ran.push(Date.now()); });
    const t0 = Date.now();
    await queue.enqueue(JOBS.inboxReceive, { messageId: "m" }, { delaySeconds: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(ran).toHaveLength(0);
    await waitUntil(() => ran.length === 1);
    expect(ran[0]! - t0).toBeGreaterThanOrEqual(900);
  });

  it("never runs more handlers at once than the concurrency", async () => {
    const queue = await start();
    let active = 0, peak = 0, done = 0;
    await queue.work(JOBS.prepareApplication, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 60));
      active--; done++;
    }, { concurrency: 2 });
    for (let i = 0; i < 6; i++) await queue.enqueue(JOBS.prepareApplication, { applicationId: `a${i}` });
    await waitUntil(() => done === 6);
    expect(peak).toBe(2);
  });
});

describe("memory adapter specifics", () => {
  it("fails a job for good after its retries and records the error", async () => {
    const q = new MemoryQueue();
    await q.start();
    await q.work(JOBS.ingestPollBoard, () => { throw new Error("feed down"); });
    await q.enqueue(JOBS.ingestPollBoard, { companyId: "c" }, { retryLimit: 1, retryDelaySeconds: 0 });
    await q.drain();
    expect(q.stats(JOBS.ingestPollBoard)).toMatchObject({ failed: 1, queued: 0, active: 0 });
    expect(q.failures()[0]).toMatchObject({ error: "feed down" });
    await q.stop();
  });

  it("runs higher priority first and keeps jobs for a queue until a worker registers", async () => {
    const q = new MemoryQueue();
    await q.start();
    await q.enqueue(JOBS.matchUser, { userId: "low" }, { priority: 0 });
    await q.enqueue(JOBS.matchUser, { userId: "high" }, { priority: 10 });
    const order: string[] = [];
    await q.work(JOBS.matchUser, (p) => { order.push(p.userId); }, { concurrency: 1 });
    await q.drain();
    expect(order).toEqual(["high", "low"]);
    await q.stop();
  });

  it("fires a cron schedule once per matching minute", async () => {
    const q = new MemoryQueue();
    await q.start();
    const seen: string[] = [];
    await q.work(JOBS.ingestPollBoard, (p) => { seen.push(p.companyId); });
    await q.schedule(JOBS.ingestPollBoard, "0 */3 * * *", { companyId: "board" });
    await q.tickSchedules(new Date("2026-10-31T03:00:10Z"));
    await q.tickSchedules(new Date("2026-10-31T03:00:50Z"));
    await q.tickSchedules(new Date("2026-10-31T04:00:00Z"));
    await q.drain();
    expect(seen).toEqual(["board"]);
    await q.stop();
  });

  it("waits for a running handler on stop", async () => {
    const q = new MemoryQueue();
    await q.start();
    let finished = false;
    await q.work(JOBS.inboxReceive, async () => { await new Promise((r) => setTimeout(r, 80)); finished = true; });
    await q.enqueue(JOBS.inboxReceive, { messageId: "m" });
    await new Promise((r) => setTimeout(r, 20));
    await q.stop();
    expect(finished).toBe(true);
  });
});

describe("cron", () => {
  it("matches steps, ranges and lists in UTC", () => {
    expect(cronMatches("*/15 * * * *", new Date("2026-10-31T10:30:00Z"))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date("2026-10-31T10:31:00Z"))).toBe(false);
    expect(cronMatches("0 9-17 * * 1-5", new Date("2026-10-30T12:00:00Z"))).toBe(true); // Friday
    expect(cronMatches("0 9-17 * * 1-5", new Date("2026-10-31T12:00:00Z"))).toBe(false); // Saturday
    expect(cronMatches("5,10 0 1 11 *", new Date("2026-11-01T00:10:00Z"))).toBe(true);
  });
  it("rejects malformed expressions", () => {
    expect(() => cronMatches("* * * *", new Date())).toThrow();
    expect(() => cronMatches("61 * * * *", new Date())).toThrow();
  });
});

describe("queue definitions", () => {
  it("has a payload schema and config for every job name in the architecture", () => {
    expect(Object.values(JOBS).sort()).toEqual(
      ["apply.run", "inbox.receive", "ingest.poll-board", "match.new-jobs", "match.user", "prepare.application", "understand.job"],
    );
    for (const name of Object.values(JOBS)) {
      expect(payloadSchemas[name]).toBeDefined();
      expect(QUEUE_CONFIG[name].retryLimit).toBeGreaterThan(0);
    }
  });
});

describe("shared queue facade", () => {
  afterEach(async () => { await stopQueue(); vi.unstubAllEnvs(); });

  it("uses the in-memory adapter when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const q = await startQueue();
    expect(q.kind).toBe("memory");
    const seen: string[] = [];
    await work(JOBS.matchUser, (p) => { seen.push(p.userId); });
    await enqueue(JOBS.matchUser, { userId: "u9" });
    await waitUntil(() => seen.length === 1);
    expect(await startQueue()).toBe(q);
  });

  it("selects pg-boss when a connection string is given or DATABASE_URL is set", () => {
    expect(createQueue("postgres://u:p@localhost:5432/db").kind).toBe("pgboss");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    expect(createQueue().kind).toBe("pgboss");
    expect(createQueue({ adapter: "memory" }).kind).toBe("memory");
  });

  it("throws a clear error before start", () => {
    expect(() => enqueue(JOBS.matchUser, { userId: "u" })).toThrow(/not started/);
  });
});

describe("pg-boss adapter wiring (stand-in for PgBoss, no database)", () => {
  function fakeBoss() {
    const calls: { fn: string; args: unknown[] }[] = [];
    let workHandler: ((jobs: unknown[]) => Promise<void>) | undefined;
    const rec = (fn: string, ret?: unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret; };
    const boss = {
      on: (...args: unknown[]) => { calls.push({ fn: "on", args }); return boss; },
      start: rec("start", undefined),
      stop: rec("stop"),
      createQueue: rec("createQueue"),
      send: rec("send", "job-1"),
      schedule: rec("schedule"),
      work: async (...args: unknown[]) => { calls.push({ fn: "work", args }); workHandler = args[2] as typeof workHandler; return "w1"; },
    } as unknown as BossLike;
    return { boss, calls, run: (jobs: unknown[]) => workHandler!(jobs) };
  }

  it("creates every queue with retry config on start and maps enqueue options", async () => {
    const f = fakeBoss();
    const q = new PgBossQueue("postgres://x", () => f.boss);
    await q.start();
    const created = f.calls.filter((c) => c.fn === "createQueue").map((c) => c.args[0]);
    expect(created.sort()).toEqual(Object.values(JOBS).sort());
    expect(f.calls.find((c) => c.fn === "createQueue" && c.args[0] === JOBS.applyRun)!.args[1]).toMatchObject({ retryLimit: 1, retryBackoff: true, expireInSeconds: 1200 });

    const id = await q.enqueue(JOBS.applyRun, { applicationId: "a", trigger: "click" }, { delaySeconds: 5, priority: 2, dedupeKey: "a", dedupeSeconds: 30 });
    expect(id).toBe("job-1");
    const send = f.calls.find((c) => c.fn === "send")!;
    expect(send.args[0]).toBe("apply.run");
    expect(send.args[1]).toEqual({ applicationId: "a", trigger: "click" });
    expect(send.args[2]).toEqual({ startAfter: 5, priority: 2, singletonKey: "a", singletonSeconds: 30 });
  });

  it("registers workers with local concurrency and hands handlers a validated payload", async () => {
    const f = fakeBoss();
    const q = new PgBossQueue("postgres://x", () => f.boss);
    await q.start();
    const seen: unknown[] = [];
    await q.work(JOBS.matchUser, (p, ctx) => { seen.push([p, ctx]); }, { concurrency: 5 });
    const w = f.calls.find((c) => c.fn === "work")!;
    expect(w.args[0]).toBe("match.user");
    expect(w.args[1]).toMatchObject({ batchSize: 1, localConcurrency: 5 });
    await f.run([{ id: "j", data: { userId: "u" }, retryCount: 2 }]);
    expect(seen).toEqual([[{ userId: "u", reason: "manual" }, { id: "j", attempt: 3 }]]);
    await expect(f.run([{ id: "j", data: { nope: 1 }, retryCount: 0 }])).rejects.toThrow();
  });

  it("schedules in UTC, requires start, and stops gracefully", async () => {
    const f = fakeBoss();
    const q = new PgBossQueue("postgres://x", () => f.boss);
    await expect(q.enqueue(JOBS.matchUser, { userId: "u" })).rejects.toThrow(/not started/);
    await q.start();
    await q.schedule(JOBS.ingestPollBoard, "0 */3 * * *", { companyId: "c" });
    expect(f.calls.find((c) => c.fn === "schedule")!.args).toEqual(["ingest.poll-board", "0 */3 * * *", { companyId: "c" }, { tz: "UTC" }]);
    await q.stop();
    expect(f.calls.some((c) => c.fn === "stop")).toBe(true);
  });
});
