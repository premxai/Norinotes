import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import ghBoard from "./__fixtures__/greenhouse-board.json";
import { json, noSleep, routeFetch } from "./__fixtures__/helpers.js";
import leverBoard from "./__fixtures__/lever-board.json";
import { dedupeKey } from "./dedupe.js";
import { HostBackoff, RateLimitedError } from "./http.js";
import { HostBackedOffError, pollBoard } from "./poll.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(companies);
});

const GH = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const t1 = new Date("2026-10-31T10:00:00Z");
const t2 = new Date("2026-10-31T13:00:00Z");
const t3 = new Date("2026-10-31T16:00:00Z");
const board = { atsType: "greenhouse", token: "acme" } as const;
const ghFetch = (body: unknown) => routeFetch({ [GH]: () => json(body) });
const withJobs = (...ids: number[]) => ({ jobs: ghBoard.jobs.filter((j) => ids.includes(j.id)) });

async function allJobs() {
  return t.db.select().from(jobs).orderBy(jobs.externalId);
}

describe("pollBoard", () => {
  it("adds new jobs, creates the company row and reports newJobIds", async () => {
    const res = await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    expect(res).toMatchObject({ added: 3, updated: 0, closed: 0, total: 3, skipped: null });
    const rows = await allJobs();
    expect(rows).toHaveLength(3);
    expect(res.newJobIds.sort()).toEqual(rows.map((r) => r.id).sort());

    const [company] = await t.db.select().from(companies);
    expect(company).toMatchObject({ atsType: "greenhouse", atsToken: "acme", name: "Acme Robotics", blocked: false });
    expect(company?.lastPolledAt?.getTime()).toBe(t1.getTime());

    const first = rows.find((r) => r.externalId === "4001");
    expect(first).toMatchObject({
      companyId: company?.id, title: "Senior Frontend Engineer", location: "Remote - US", remote: true, closedAt: null,
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

  it("closes jobs that leave the feed, reopens them if they return, and never touches other boards", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    await pollBoard(t.db, { atsType: "lever", token: "globex" }, { now: t1, fetch: routeFetch({ "https://api.lever.co/v0/postings/globex": () => json(leverBoard) }) });

    const res = await pollBoard(t.db, board, { now: t2, fetch: ghFetch(withJobs(4001)) });
    expect(res).toMatchObject({ added: 0, updated: 1, closed: 2, total: 1 });
    const rows = await allJobs();
    const closedIds = rows.filter((r) => r.closedAt).map((r) => r.externalId);
    expect(closedIds.sort()).toEqual(["4002", "4003"]);
    expect(rows.find((r) => r.externalId === "4002")?.closedAt?.getTime()).toBe(t2.getTime());
    expect(rows.filter((r) => r.atsType === "lever").every((r) => r.closedAt === null)).toBe(true);

    // closing is not repeated
    expect((await pollBoard(t.db, board, { now: t3, fetch: ghFetch(withJobs(4001)) })).closed).toBe(0);

    // a returning job reopens and is an update, not a new job
    const back = await pollBoard(t.db, board, { now: t3, fetch: ghFetch(withJobs(4001, 4002)) });
    expect(back).toMatchObject({ added: 0, updated: 2, closed: 0, newJobIds: [] });
    expect((await allJobs()).find((r) => r.externalId === "4002")?.closedAt).toBeNull();
  });

  it("closes everything when the board disappears (404), and still records the poll", async () => {
    await pollBoard(t.db, board, { now: t1, fetch: ghFetch(ghBoard) });
    const res = await pollBoard(t.db, board, { now: t2, fetch: routeFetch({}) });
    expect(res).toMatchObject({ added: 0, updated: 0, closed: 3, total: 0 });
    const [company] = await t.db.select().from(companies);
    expect(company?.lastPolledAt?.getTime()).toBe(t2.getTime());
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

  it("leaves the board due when the feed fails, and backs a host off after repeated rate limiting", async () => {
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

  it("rejects job systems whose connector is not implemented", async () => {
    await expect(pollBoard(t.db, { atsType: "workday", token: "x|wd5|site" }, { now: t1 })).rejects.toThrow(/not implemented/);
  });
});
