import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, eq, inArray, jobs, lanes, profiles, users, careerPoints, shortlist, sql, queryRows, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { BrowserPool } from "@norinote/apply";
import { MemoryQueue, JOBS } from "@norinote/queue";
import { BOOST_HOURS, boostCompanies, companiesFittingLanes } from "./boost.js";
import { loadConfig } from "./config.js";
import { silentLogger } from "./log.js";
import { startWorker, type Worker } from "./worker.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let n = 0;
async function company(db: Db, name: string, over: Partial<typeof companies.$inferInsert> = {}): Promise<string> {
  const [c] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `boost-${n++}`, name, ...over }).returning();
  return c!.id;
}
async function job(db: Db, companyId: string, title: string, over: Partial<typeof jobs.$inferInsert> = {}): Promise<string> {
  const id = `b${n++}`;
  const [j] = await db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: id, title, location: "Austin, TX", remote: false, descriptionText: "", applyUrl: `https://x.test/${id}`,
    postedAt: daysAgo(2), firstSeenAt: daysAgo(2), dedupeKey: id, ...over,
  }).returning();
  return j!.id;
}
async function user(db: Db, location = "Austin, TX"): Promise<string> {
  const [u] = await db.insert(users).values({ email: `boost${n++}@example.test`, passwordHash: "x" }).returning();
  await db.insert(profiles).values({ userId: u!.id, location, workAuth: { US: { authorized: true, needsSponsorship: false } } });
  return u!.id;
}
const state = async (db: Db, ids: string[]) => (await db.select({ id: companies.id, priority: companies.priority, boostUntil: companies.boostUntil, nextPollAt: companies.nextPollAt }).from(companies).where(inArray(companies.id, ids)));

describe("companiesFittingLanes", () => {
  it("returns the companies whose open, fresh jobs fit the lanes, best fit then newest first, at most `limit`", async () => {
    const userId = await user(t.db);
    await t.db.insert(lanes).values({ userId, name: "Backend", titles: ["Backend Engineer"], locations: ["Austin, TX"], remote: false, minFit: 0.2 });
    const strong = await company(t.db, "Strong Fit");
    const newer = await company(t.db, "Newer");
    const older = await company(t.db, "Older");
    const noFit = await company(t.db, "No Fit");
    const closed = await company(t.db, "Closed");
    const blocked = await company(t.db, "Blocked", { blocked: true });
    const stale = await company(t.db, "Stale");
    const strongJob = await job(t.db, strong, "Backend Engineer", { postedAt: daysAgo(20) });
    await job(t.db, newer, "Backend Engineer II", { postedAt: daysAgo(1) });
    await job(t.db, older, "Senior Backend Engineer", { postedAt: daysAgo(10) });
    await job(t.db, noFit, "Marketing Manager");
    await job(t.db, noFit, "Backend Engineer", { location: "Berlin, Germany" });
    await job(t.db, closed, "Backend Engineer", { closedAt: daysAgo(1) });
    await job(t.db, blocked, "Backend Engineer");
    await job(t.db, stale, "Backend Engineer", { postedAt: daysAgo(90), firstSeenAt: daysAgo(90) });
    await t.db.insert(shortlist).values({ userId, jobId: strongJob, fit: 0.9 });

    expect(await companiesFittingLanes(t.db, userId, NOW)).toEqual([strong, newer, older]);
    expect(await companiesFittingLanes(t.db, userId, NOW, 2)).toEqual([strong, newer]);
  });

  it("falls back to a temporary lane from the latest role, and is empty for a user with nothing", async () => {
    const userId = await user(t.db, "Reno, NV");
    await t.db.insert(careerPoints).values({ userId, kind: "role", title: "Pastry Chef at Cafe", startDate: "2021-01", text: "", sourceQuote: "x" });
    const reno = await company(t.db, "Reno Bakery");
    await job(t.db, reno, "Senior Pastry Chef", { location: "Reno, NV" });
    await job(t.db, await company(t.db, "Elsewhere"), "Pastry Chef", { location: "Boston, MA" });
    expect(await companiesFittingLanes(t.db, userId, NOW)).toEqual([reno]);
    expect(await companiesFittingLanes(t.db, await user(t.db), NOW)).toEqual([]);
  });
});

describe("boostCompanies", () => {
  it("boosts for a day (stored priority untouched) and makes the company due, leaving blocked companies and other columns alone", async () => {
    const low = await company(t.db, "Low", { priority: 0, nextPollAt: daysAgo(-1) });
    const high = await company(t.db, "High", { priority: 500, nextPollAt: daysAgo(-1) });
    const blocked = await company(t.db, "Blocked", { blocked: true, priority: 0, nextPollAt: daysAgo(-1) });
    const other = await company(t.db, "Other", { priority: 0, nextPollAt: daysAgo(-1) });

    expect(await boostCompanies(t.db, [low, high, blocked], { now: NOW })).toBe(2);
    const rows = await state(t.db, [low, high, blocked, other]);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(low).priority).toBe(0);
    expect(by(low).boostUntil?.toISOString()).toBe(new Date(NOW.getTime() + BOOST_HOURS * 3_600_000).toISOString());
    expect(by(low).nextPollAt?.toISOString()).toBe(NOW.toISOString());
    expect(by(high).priority).toBe(500);
    expect(by(high).nextPollAt?.toISOString()).toBe(NOW.toISOString());
    expect(by(blocked).boostUntil).toBeNull();
    expect(by(other).boostUntil).toBeNull();
    expect(await boostCompanies(t.db, [])).toBe(0);
    // Without a clock it uses the database's own now().
    expect(await boostCompanies(t.db, [other])).toBe(1);
    expect((await state(t.db, [other]))[0]!.nextPollAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("is safe before migration 0003: without the columns it does nothing and does not throw", async () => {
    const old = await createTestDb();
    try {
      const id = await company(old.db, "Old Schema");
      await queryRows(old.db, sql`ALTER TABLE companies DROP COLUMN boost_until`);
      expect(await boostCompanies(old.db, [id], { now: NOW })).toBe(1); // next_poll_at still exists
      await queryRows(old.db, sql`ALTER TABLE companies DROP COLUMN next_poll_at`);
      expect(await boostCompanies(old.db, [id], { now: NOW })).toBe(0);
      expect((await old.db.select({ name: companies.name }).from(companies).where(eq(companies.id, id)).catch(() => [{ name: "Old Schema" }]))[0]!.name).toBe("Old Schema");
      expect(await boostCompanies(old.db, ["not-a-uuid"], { now: NOW })).toBe(0);
    } finally {
      await old.close();
    }
  });
});

describe("match.user boosts the companies a user is waiting on", () => {
  let worker: Worker | undefined;
  afterEach(async () => { await worker?.stop(); });

  it("after a lane change the matching companies are due now, with a boost that lapses", async () => {
    const userId = await user(t.db, "Tulsa, OK");
    await t.db.insert(lanes).values({ userId, name: "Welder", titles: ["Welder"], locations: ["Tulsa, OK"], remote: false, minFit: 0.2 });
    await t.db.insert(careerPoints).values({ userId, kind: "role", title: "Welder", org: "Steelworks", startDate: "2020-01", text: "Welded pipes", skills: [], sourceQuote: "x" });
    const waiting = await company(t.db, "Tulsa Steel", { priority: 0, nextPollAt: daysAgo(-2) });
    const unrelated = await company(t.db, "Unrelated", { priority: 0, nextPollAt: daysAgo(-2) });
    await job(t.db, waiting, "Welder", { location: "Tulsa, OK" });
    await job(t.db, unrelated, "Accountant", { location: "Tulsa, OK" });

    const pool = { artifactsDir: "/tmp/a", run: async () => { throw new Error("no browser"); }, warmUp: async () => {}, stats: () => ({ size: 1, active: 0, waiting: 0, browserLaunched: false, launches: 0 }), close: async () => {} } as unknown as BrowserPool;
    const queue = new MemoryQueue();
    worker = await startWorker({ db: t.db, queue, config: { ...loadConfig({}), matchBatchMs: 0, explainTop: 0 }, log: silentLogger, now: () => NOW, scheduler: false, seed: false, pool });
    await queue.enqueue(JOBS.matchUser, { userId, reason: "lanes" });
    await queue.drain();
    expect(queue.failures()).toEqual([]);

    const rows = await state(t.db, [waiting, unrelated]);
    expect(rows.find((r) => r.id === waiting)!.boostUntil?.getTime()).toBe(NOW.getTime() + BOOST_HOURS * 3_600_000);
    expect(rows.find((r) => r.id === waiting)!.nextPollAt?.toISOString()).toBe(NOW.toISOString());
    expect(rows.find((r) => r.id === unrelated)!.boostUntil).toBeNull();
  });
});
