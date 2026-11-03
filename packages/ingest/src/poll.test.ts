import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import ghBoard from "./__fixtures__/greenhouse-board.json";
import { json, noSleep, routeFetch } from "./__fixtures__/helpers.js";
import leverBoard from "./__fixtures__/lever-board.json";
import { CONNECTORS } from "./connectors/index.js";
import { BlockedByHostError } from "./connectors/workday.js";
import { dedupeKey } from "./dedupe.js";
import { HostBackoff, RateLimitedError } from "./http.js";
import { HostBackedOffError, pollBoard } from "./poll.js";
import type { Connector, ListResult, NormalizedJob } from "./types.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(companies);
});

const GH = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const HOUR = 3_600_000;
const t1 = new Date("2026-10-31T10:00:00Z");
const t2 = new Date("2026-10-31T13:00:00Z");
const t3 = new Date("2026-10-31T16:00:00Z");
const t4 = new Date("2026-10-31T19:00:00Z");
const t5 = new Date("2026-10-31T22:00:00Z");
const board = { atsType: "greenhouse", token: "acme" } as const;
const ghFetch = (body: unknown) => routeFetch({ [GH]: () => json(body) });
const withJobs = (...ids: number[]) => ({ jobs: ghBoard.jobs.filter((j) => ids.includes(j.id)) });

async function allJobs() {
  return t.db.select().from(jobs).orderBy(jobs.externalId);
}
const company = async () => (await t.db.select().from(companies))[0]!;

/** Replace one connector for the duration of `fn`. */
async function withConnector<T>(atsType: keyof typeof CONNECTORS, stub: Partial<Connector>, fn: () => Promise<T>): Promise<T> {
  const original = CONNECTORS[atsType];
  CONNECTORS[atsType] = { ...original, ...stub } as Connector;
  try { return await fn(); } finally { CONNECTORS[atsType] = original; }
}
const feedJob = (externalId: string, over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  atsType: "greenhouse", externalId, companyName: "Acme", companyToken: "acme", title: `Job ${externalId}`, location: null, remote: false,
  descriptionText: "text", applyUrl: `https://x.test/${externalId}`, postedAt: null, ...over,
});
const serving = (read: () => ListResult): Partial<Connector> => ({ ready: true, listJobs: async () => read() });

describe("pollBoard", () => {
  it("adds new jobs, creates the company row and reports newJobIds", async () => {
    const res = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    expect(res).toMatchObject({ added: 3, updated: 0, closed: 0, total: 3, skipped: null, complete: true, notFound: false, notModified: false });
    const rows = await allJobs();
    expect(rows).toHaveLength(3);
    expect(res.newJobIds.sort()).toEqual(rows.map((r) => r.id).sort());

    const c = await company();
    expect(c).toMatchObject({ atsType: "greenhouse", atsToken: "acme", name: "Acme Robotics", blocked: false, status: "active", errorStreak: 0, lastJobCount: 3 });
    expect(c.lastPolledAt?.getTime()).toBe(t1.getTime());
    expect(c.lastSuccessAt?.getTime()).toBe(t1.getTime());
    expect(c.nextPollAt?.getTime()).toBe(res.nextPollAt?.getTime());

    const first = rows.find((r) => r.externalId === "4001");
    expect(first).toMatchObject({
      companyId: c.id, title: "Senior Frontend Engineer", location: "Remote - US", remote: true, closedAt: null, missingReads: 0,
      applyUrl: "https://boards.greenhouse.io/acme/jobs/4001",
    });
    expect(first?.descriptionText).toContain("Build UI with React & TypeScript.");
    expect(first?.descriptionText).not.toContain("<");
    expect(first?.firstSeenAt.getTime()).toBe(t1.getTime());
    expect(first?.lastSeenAt.getTime()).toBe(t1.getTime());
    expect(first?.postedAt?.toISOString()).toBe("2025-02-10T14:00:00.000Z");
    expect(first?.dedupeKey).toBe("acme robotics|senior frontend engineer|remote us");
  });

  it("uses an existing company row's name and records the poll time", async () => {
    await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "acme", name: "Acme (seeded)" });
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    const rows = await t.db.select().from(companies);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Acme (seeded)");
    expect(rows[0]?.lastPolledAt?.getTime()).toBe(t1.getTime());
    // dedupe_key uses the job's own company name from the feed
    expect((await allJobs())[0]?.dedupeKey).toBe(dedupeKey({ companyName: "Acme Robotics", title: "Senior Frontend Engineer", location: "Remote - US" }));
  });

  it("updates known jobs without duplicating, keeping first_seen_at and moving last_seen_at", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    const before = await allJobs();
    const edited = { jobs: ghBoard.jobs.map((j) => (j.id === 4002 ? { ...j, title: "Senior Data Engineer", content: "&lt;p&gt;New text&lt;/p&gt;" } : j)) };
    const res = await pollBoard(t.db, board, { now: t2, fetch: ghFetch(edited) });
    expect(res).toMatchObject({ added: 0, updated: 3, closed: 0, total: 3, newJobIds: [] });
    const after = await allJobs();
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    const changed = after.find((r) => r.externalId === "4002");
    expect(changed).toMatchObject({ title: "Senior Data Engineer", descriptionText: "New text" });
    expect(changed?.firstSeenAt.getTime()).toBe(t1.getTime());
    expect(changed?.lastSeenAt.getTime()).toBe(t2.getTime());
    expect(changed?.dedupeKey).toBe("acme|senior data engineer|new york ny");
  });

  it("keeps posted_at when a later feed has no date, and fills it when one appears", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    const nodates = { jobs: ghBoard.jobs.map(({ first_published: _a, updated_at: _b, ...rest }) => rest) };
    await pollBoard(t.db, board, { now: t2, fetch: ghFetch(nodates) });
    const rows = await allJobs();
    expect(rows.find((r) => r.externalId === "4001")?.postedAt?.toISOString()).toBe("2025-02-10T14:00:00.000Z");
    expect(rows.find((r) => r.externalId === "4003")?.postedAt).toBeNull();
    await pollBoard(t.db, board, { now: t3, fetch: ghFetch(ghBoard) });
    expect((await allJobs()).find((r) => r.externalId === "4002")?.postedAt?.toISOString()).toBe("2025-03-02T15:00:00.000Z");
  });

  it("does not wipe a stored description when a later list read has none (Workday lists carry no text)", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    const textless = { jobs: ghBoard.jobs.map((j) => ({ ...j, content: "" })) };
    await pollBoard(t.db, board, { now: t2, fetch: ghFetch(textless) });
    expect((await allJobs()).find((r) => r.externalId === "4001")?.descriptionText).toContain("Build UI with React");
  });

  describe("closing jobs", () => {
    it("closes a job only after two complete reads in a row miss it, reopens it if it returns, and never touches other boards", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      await pollBoard(t.db, { atsType: "lever", token: "globex" }, { now: t1, fetch: routeFetch({ "https://api.lever.co/v0/postings/globex": () => json(leverBoard) }) });

      // first miss: counted, nothing closed
      const first = await pollBoard(t.db, board, { now: t2, fetch: ghFetch(withJobs(4001)) });
      expect(first).toMatchObject({ added: 0, updated: 1, closed: 0, total: 1, complete: true });
      expect((await allJobs()).filter((r) => r.closedAt)).toHaveLength(0);
      expect((await allJobs()).filter((r) => r.missingReads === 1).map((r) => r.externalId).sort()).toEqual(["4002", "4003"]);

      // second miss: closed
      const second = await pollBoard(t.db, board, { now: t3, fetch: ghFetch(withJobs(4001)) });
      expect(second).toMatchObject({ closed: 2, total: 1 });
      const rows = await allJobs();
      expect(rows.filter((r) => r.closedAt).map((r) => r.externalId).sort()).toEqual(["4002", "4003"]);
      expect(rows.find((r) => r.externalId === "4002")?.closedAt?.getTime()).toBe(t3.getTime());
      expect(rows.filter((r) => r.atsType === "lever").every((r) => r.closedAt === null && r.missingReads === 0)).toBe(true);

      // closing is not repeated
      expect((await pollBoard(t.db, board, { now: t4, fetch: ghFetch(withJobs(4001)) })).closed).toBe(0);

      // a returning job reopens and is an update, not a new job
      const back = await pollBoard(t.db, board, { now: t5, fetch: ghFetch(withJobs(4001, 4002)) });
      expect(back).toMatchObject({ added: 0, updated: 2, closed: 0, newJobIds: [] });
      expect((await allJobs()).find((r) => r.externalId === "4002")).toMatchObject({ closedAt: null, missingReads: 0 });
    });

    it("resets the miss counter when a job is seen again, so misses must be consecutive", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      await pollBoard(t.db, board, { now: t2, fetch: ghFetch(withJobs(4001, 4002)) }); // 4003 missed once
      await pollBoard(t.db, board, { now: t3, fetch: ghFetch(ghBoard) }); // seen again
      expect((await allJobs()).find((r) => r.externalId === "4003")?.missingReads).toBe(0);
      await pollBoard(t.db, board, { now: t4, fetch: ghFetch(withJobs(4001, 4002)) }); // missed once again
      expect((await allJobs()).filter((r) => r.closedAt)).toHaveLength(0);
    });

    it("never closes or counts anything on an incomplete read, and keeps no validator from it", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      await withConnector("greenhouse", serving(() => ({ jobs: [feedJob("4001")], complete: false, etag: "\"partial\"" })), async () => {
        for (const at of [t2, t3, t4]) {
          expect(await pollBoard(t.db, board, { now: at })).toMatchObject({ closed: 0, complete: false });
        }
      });
      const rows = await allJobs();
      expect(rows.every((r) => r.closedAt === null && r.missingReads === 0)).toBe(true);
      expect(await company()).toMatchObject({ etag: null, status: "active" });
    });

    it("does not treat an empty complete read as proof on the first miss", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      const res = await pollBoard(t.db, board, { now: t2, fetch: ghFetch({ jobs: [] }) });
      expect(res).toMatchObject({ total: 0, closed: 0 });
      expect((await allJobs()).every((r) => r.closedAt === null && r.missingReads === 1)).toBe(true);
    });
  });

  describe("board gone (not found)", () => {
    it("goes on probation and closes jobs only after 3 days of not-found answers", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      const gone = routeFetch({});
      const at = (hours: number) => new Date(t1.getTime() + hours * HOUR);

      const first = await pollBoard(t.db, board, { now: at(1), fetch: gone });
      expect(first).toMatchObject({ notFound: true, closed: 0, status: "probation", previousStatus: "active" });
      let c = await company();
      expect(c.notFoundSince?.getTime()).toBe(at(1).getTime());
      expect(c.nextPollAt?.getTime()).toBe(at(13).getTime());
      expect((await allJobs()).every((r) => r.closedAt === null)).toBe(true);

      // 71 hours after the first not-found answer: still open
      expect((await pollBoard(t.db, board, { now: at(72), fetch: gone })).closed).toBe(0);
      expect((await allJobs()).every((r) => r.closedAt === null)).toBe(true);

      // 72 hours after: closed, board is dead and rechecked weekly
      const last = await pollBoard(t.db, board, { now: at(73), fetch: gone });
      expect(last).toMatchObject({ closed: 3, status: "dead" });
      c = await company();
      expect(c).toMatchObject({ status: "dead", lastJobCount: 0, statusReason: "board not found" });
      expect(c.nextPollAt?.getTime()).toBe(at(73 + 168).getTime());
      expect((await allJobs()).every((r) => r.closedAt !== null)).toBe(true);
    });

    it("ends probation when the board comes back", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      await pollBoard(t.db, board, { now: t2, fetch: routeFetch({}) });
      const back = await pollBoard(t.db, board, { now: t3, fetch: ghFetch(ghBoard) });
      expect(back).toMatchObject({ status: "active", previousStatus: "probation", closed: 0 });
      expect(await company()).toMatchObject({ status: "active", notFoundSince: null, statusReason: null });
    });

    it("an incomplete notFound (Workday, Oracle) is still not found", async () => {
      await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "acme", name: "Acme" });
      await withConnector("greenhouse", serving(() => ({ jobs: [], complete: false, notFound: true })), async () => {
        expect(await pollBoard(t.db, board, { now: t1 })).toMatchObject({ notFound: true, status: "probation" });
      });
    });
  });

  describe("conditional requests", () => {
    it("sends If-None-Match and answers a 304 without touching a single job", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: routeFetch({ [GH]: () => json(ghBoard, 200, { etag: "\"v1\"" }) }) });
      let c = await company();
      expect(c.etag).toBe("\"v1\"");
      const before = await allJobs();

      const seen: Array<string | null> = [];
      const second = routeFetch({ [GH]: (_u, init) => { seen.push(new Headers(init?.headers).get("if-none-match")); return new Response(null, { status: 304, headers: { etag: "\"v1\"" } }); } });
      const res = await pollBoard(t.db, board, { now: t2, fetch: second });
      expect(seen).toEqual(["\"v1\""]);
      expect(res).toMatchObject({ notModified: true, added: 0, updated: 0, closed: 0, newJobIds: [], status: "active" });
      expect(await allJobs()).toEqual(before);
      c = await company();
      expect(c.lastSuccessAt?.getTime()).toBe(t2.getTime());
      expect(c.nextPollAt?.getTime()).toBe(res.nextPollAt?.getTime());
      expect(c).toMatchObject({ etag: "\"v1\"", lastJobCount: 3, errorStreak: 0 });
    });

    it("reads a board in full again after it was disabled (no stale validator)", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: routeFetch({ [GH]: () => json(ghBoard, 200, { etag: "\"v1\"" }) }) });
      await t.db.update(companies).set({ status: "disabled" });
      const seen: Array<string | null> = [];
      await pollBoard(t.db, board, { now: t2, fetch: routeFetch({ [GH]: (_u, init) => { seen.push(new Headers(init?.headers).get("if-none-match")); return json(ghBoard); } }) });
      expect(seen).toEqual([null]);
      expect((await company()).status).toBe("active");
    });
  });

  describe("registry state", () => {
    const candidate = (token = "acme", over: Partial<typeof companies.$inferInsert> = {}) =>
      t.db.insert(companies).values({ atsType: "greenhouse", atsToken: token, name: token, status: "candidate", discoveredVia: "seed:ats-scrapers", ...over });

    it("validates a candidate: jobs found makes it active", async () => {
      await candidate();
      const res = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      expect(res).toMatchObject({ previousStatus: "candidate", status: "active" });
      expect(await company()).toMatchObject({ status: "active", priority: 0, lastJobCount: 3 });
    });

    it("validates a candidate: an empty feed makes it active at low priority, and jobs later restore it", async () => {
      await candidate();
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch({ jobs: [] }) });
      let c = await company();
      expect(c).toMatchObject({ status: "active", priority: -10, lastJobCount: 0 });
      expect(c.emptySince?.getTime()).toBe(t1.getTime());
      await pollBoard(t.db, board, { now: t2, fetch: ghFetch(ghBoard) });
      c = await company();
      expect(c).toMatchObject({ status: "active", priority: 0, emptySince: null });
    });

    it("validates a candidate: not found makes it dead, with a weekly recheck", async () => {
      await candidate();
      const res = await pollBoard(t.db, board, { now: t1, fetch: routeFetch({}) });
      expect(res).toMatchObject({ previousStatus: "candidate", status: "dead", notFound: true });
      const c = await company();
      expect(c.nextPollAt?.getTime()).toBe(t1.getTime() + 168 * HOUR);
    });

    it("does not lower the priority of a curated board that is empty", async () => {
      await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "acme", name: "Acme", priority: 100 });
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch({ jobs: [] }) });
      expect((await company()).priority).toBe(100);
    });

    it("disables a board that has had no jobs for 14 days, and brings it back when jobs appear", async () => {
      await candidate();
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch({ jobs: [] }) });
      await pollBoard(t.db, board, { now: new Date(t1.getTime() + 13 * 24 * HOUR), fetch: ghFetch({ jobs: [] }) });
      expect((await company()).status).toBe("active");
      const at14 = new Date(t1.getTime() + 14 * 24 * HOUR);
      await pollBoard(t.db, board, { now: at14, fetch: ghFetch({ jobs: [] }) });
      let c = await company();
      expect(c).toMatchObject({ status: "disabled", statusReason: "no jobs for 14 days" });
      expect(c.nextPollAt?.getTime()).toBe(at14.getTime() + 168 * HOUR);
      await pollBoard(t.db, board, { now: new Date(at14.getTime() + 168 * HOUR), fetch: ghFetch(ghBoard) });
      c = await company();
      expect(c).toMatchObject({ status: "active", emptySince: null, statusReason: null });
    });

    it("counts errors once per backoff window, backs off, and disables the board on the fifth in a row", async () => {
      await candidate("acme", { status: "active" });
      const boom = routeFetch({ [GH]: () => new Response("boom", { status: 500 }) });
      const fail = (at: Date) => expect(pollBoard(t.db, board, { now: at, fetch: boom })).rejects.toThrow(/500/);

      await fail(t1);
      let c = await company();
      expect(c).toMatchObject({ errorStreak: 1, status: "active" });
      expect(c.nextPollAt?.getTime()).toBe(t1.getTime() + 30 * 60_000);
      // the queue's quick retry of the same failure is not a second error
      await fail(new Date(t1.getTime() + 60_000));
      expect((await company()).errorStreak).toBe(1);

      let at = new Date(t1.getTime() + 31 * 60_000);
      await fail(at);
      expect((await company()).errorStreak).toBe(2);
      for (const streak of [3, 4]) {
        at = new Date((await company()).nextPollAt!.getTime() + 1000);
        await fail(at);
        expect((await company()).errorStreak).toBe(streak);
      }
      expect((await company()).status).toBe("active");
      at = new Date((await company()).nextPollAt!.getTime() + 1000);
      await fail(at);
      c = await company();
      expect(c).toMatchObject({ errorStreak: 5, status: "disabled", statusReason: "5 failed polls in a row" });
      expect(c.nextPollAt?.getTime()).toBe(at.getTime() + 168 * HOUR);
      expect(c.lastPolledAt).toBeNull();

      // a good read clears the streak
      await pollBoard(t.db, board, { now: new Date(at.getTime() + 168 * HOUR), fetch: ghFetch(ghBoard) });
      expect(await company()).toMatchObject({ errorStreak: 0, status: "active", statusReason: null });
    });

    it("drops an expired boost on the next successful poll and keeps a running one", async () => {
      await candidate("acme", { status: "active", boostUntil: new Date(t1.getTime() - HOUR) });
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
      expect((await company()).boostUntil).toBeNull();
      await t.db.update(companies).set({ boostUntil: new Date(t2.getTime() + HOUR) });
      await pollBoard(t.db, board, { now: t2, fetch: ghFetch(ghBoard) });
      expect((await company()).boostUntil?.getTime()).toBe(t2.getTime() + HOUR);
    });

    it("does not hold rate limiting against the board", async () => {
      await candidate("acme", { status: "active" });
      const limited = routeFetch({ [GH]: () => new Response("", { status: 429 }) });
      await expect(pollBoard(t.db, board, { now: t1, fetch: limited, http: noSleep })).rejects.toBeInstanceOf(RateLimitedError);
      expect(await company()).toMatchObject({ errorStreak: 0, nextPollAt: null });
    });

    it("sets next_poll_at from new jobs in the last 7 days, and lane demand shortens it", async () => {
      const recent = { jobs: ghBoard.jobs.map((j) => ({ ...j, first_published: "2026-10-30T10:00:00Z" })) };
      const quiet = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(recent) });
      expect(await company()).toMatchObject({ newJobs7d: 3 });
      // 24h / (1 + 3/7) = 16.8h
      expect(quiet.nextPollAt!.getTime() - t1.getTime()).toBe(Math.round(24 * HOUR / (1 + 3 / 7)));
      const wanted = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(recent), demand: 3 });
      expect(wanted.nextPollAt!.getTime() - t1.getTime()).toBe(Math.round(24 * HOUR / (1 + 3 / 7) / 2));
    });

    it("counts a job as new by its posting date, not by the day it was first seen", async () => {
      await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) }); // fixture jobs were posted in early 2025
      expect(await company()).toMatchObject({ newJobs7d: 1 }); // only the job without a date counts (first seen now)
    });
  });

  it("reports only the genuinely new jobs", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(withJobs(4001, 4002)) });
    const res = await pollBoard(t.db, board, { now: t2, fetch: ghFetch(ghBoard) });
    expect(res).toMatchObject({ added: 1, updated: 2, total: 3 });
    const [row] = await t.db.select().from(jobs).where(and(eq(jobs.externalId, "4003")));
    expect(res.newJobIds).toEqual([row?.id]);
  });

  it("skips blocked boards without any request", async () => {
    const f = routeFetch({});
    expect(await pollBoard(t.db, { atsType: "lever", token: "jobgether" }, { now: t1, fetch: f })).toMatchObject({ skipped: "blocked", added: 0, total: 0, newJobIds: [] });
    await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "sneaky", name: "Sneaky", blocked: true });
    expect((await pollBoard(t.db, { atsType: "greenhouse", token: "sneaky" }, { now: t1, fetch: f })).skipped).toBe("blocked");
    expect(f).not.toHaveBeenCalled();
    expect(await t.db.select().from(jobs)).toHaveLength(0);
    expect((await t.db.select().from(companies).where(eq(companies.atsToken, "jobgether")))).toHaveLength(0);
  });

  it("drops postings that name a blocked aggregator inside a board", async () => {
    const feed = { jobs: [...withJobs(4001).jobs, { ...ghBoard.jobs[1]!, id: 9001, company_name: "Jobgether" }] };
    const res = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(feed) });
    expect(res).toMatchObject({ added: 1, total: 1 });
  });

  it("strips NUL characters that Postgres text cannot store", async () => {
    const feed = { jobs: [{ ...ghBoard.jobs[0]!, title: "Eng\u0000ineer", content: "&lt;p&gt;a\u0000b&lt;/p&gt;" }] };
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(feed) });
    expect((await allJobs())[0]).toMatchObject({ title: "Engineer", descriptionText: "ab" });
  });

  it("backs a host off after repeated rate limiting, and a failing feed does not count as a poll", async () => {
    const limited = routeFetch({ [GH]: () => new Response("", { status: 429 }) });
    const backoff = new HostBackoff(2);
    const opts = { now: t1, fetch: limited, http: noSleep, backoff };
    await expect(pollBoard(t.db, board, opts)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(pollBoard(t.db, board, opts)).rejects.toBeInstanceOf(RateLimitedError);
    const calls = limited.mock.calls.length;
    await expect(pollBoard(t.db, board, opts)).rejects.toBeInstanceOf(HostBackedOffError);
    expect(limited.mock.calls.length).toBe(calls);
    expect(backoff.isBackedOff("boards-api.greenhouse.io")).toBe(true);

    await expect(pollBoard(t.db, board, { now: t1, fetch: routeFetch({ [GH]: () => new Response("boom", { status: 500 }) }) })).rejects.toThrow(/500/);
    const rows = await t.db.select().from(companies);
    expect(rows.every((c) => c.lastPolledAt === null)).toBe(true);
  });

  it("disables a board whose host answers 401/403, without retries, and rechecks it in a week", async () => {
    const wd = { atsType: "workday", token: "acme|wd5|External" } as const;
    await t.db.insert(companies).values({ atsType: "workday", atsToken: wd.token, name: "Acme", status: "active" });
    const f = routeFetch({ "https://": () => new Response("", { status: 403 }) });
    await expect(pollBoard(t.db, wd, { now: t1, fetch: f })).rejects.toBeInstanceOf(BlockedByHostError);
    const c = await company();
    expect(c).toMatchObject({ status: "disabled", statusReason: "blocked by host (403)", errorStreak: 0 });
    expect(c.nextPollAt?.getTime()).toBe(t1.getTime() + 168 * HOUR);
  });

  it("uses the registry name for systems whose feed has no company name", async () => {
    const wd = { atsType: "workday", token: "acme|wd5|External" } as const;
    await t.db.insert(companies).values({ atsType: "workday", atsToken: wd.token, name: "Initech Systems" });
    const job = feedJob("R-1", { atsType: "workday", companyToken: wd.token, title: "Engineer" });
    await withConnector("workday", serving(() => ({ jobs: [job], complete: true })), () => pollBoard(t.db, wd, { now: t1 }));
    expect((await t.db.select().from(jobs))[0]?.dedupeKey).toBe(dedupeKey({ companyName: "Initech Systems", title: "Engineer", location: null }));
  });
});
