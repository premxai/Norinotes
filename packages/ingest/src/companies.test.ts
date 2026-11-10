import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { BOARD_REGISTRY } from "./board-registry.js";
import { maxPollsPerHost, nextBoards, seedCompanies } from "./companies.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(companies);
});

const HOUR = 3_600_000;
const now = new Date("2026-10-31T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
const later = (hours: number) => new Date(now.getTime() + hours * HOUR);

describe("seedCompanies", () => {
  it("inserts the whole registry once and is idempotent", async () => {
    const first = await seedCompanies(t.db);
    expect(first).toEqual({ inserted: BOARD_REGISTRY.length, markedBlocked: 0 });
    expect(await t.db.select().from(companies)).toHaveLength(BOARD_REGISTRY.length);
    const second = await seedCompanies(t.db);
    expect(second).toEqual({ inserted: 0, markedBlocked: 0 });
    expect(await t.db.select().from(companies)).toHaveLength(BOARD_REGISTRY.length);
  });

  it("keeps user-added rows and existing poll state, and never renames", async () => {
    const entry = BOARD_REGISTRY[0]!;
    await t.db.insert(companies).values({ atsType: entry.atsType, atsToken: entry.token, name: "My Name", lastPolledAt: ago(1) });
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "my-startup", name: "My Startup" });
    await seedCompanies(t.db);
    const [mine] = await t.db.select().from(companies).where(eq(companies.atsToken, "my-startup"));
    expect(mine?.name).toBe("My Startup");
    const [kept] = await t.db.select().from(companies).where(eq(companies.atsToken, entry.token));
    expect(kept?.name).toBe("My Name");
    expect(kept?.lastPolledAt?.getTime()).toBe(ago(1).getTime());
  });

  it("marks existing blocked-source rows as blocked without deleting them", async () => {
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "jobgether", name: "Jobgether" });
    await t.db.insert(companies).values({ atsType: "ashby", atsToken: "talent-com", name: "Whatever" });
    const res = await seedCompanies(t.db);
    expect(res.markedBlocked).toBe(2);
    const rows = await t.db.select().from(companies).where(eq(companies.blocked, true));
    expect(rows.map((r) => r.atsToken).sort()).toEqual(["jobgether", "talent-com"]);
    expect((await seedCompanies(t.db)).markedBlocked).toBe(0);
  });
});

describe("seedCompanies: registry metadata", () => {
  it("marks curated rows as registry, active, high priority, with a host", async () => {
    await seedCompanies(t.db);
    const rows = await t.db.select().from(companies);
    expect(rows.every((r) => r.discoveredVia === "registry" && r.status === "active" && r.priority === 100 && r.host)).toBe(true);
    expect(rows.find((r) => r.atsType === "greenhouse")?.host).toBe("boards-api.greenhouse.io");
  });

  it("promotes a registry board that was imported earlier as a seed candidate, and leaves other seeds alone", async () => {
    const entry = BOARD_REGISTRY[0]!;
    await t.db.insert(companies).values({ atsType: entry.atsType, atsToken: entry.token, name: entry.name, status: "candidate", discoveredVia: "seed:ats-scrapers", priority: 0 });
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "some-seed", name: "Some Seed", status: "candidate", discoveredVia: "seed:ats-scrapers", priority: 0 });
    await seedCompanies(t.db);
    const [promoted] = await t.db.select().from(companies).where(eq(companies.atsToken, entry.token));
    expect(promoted).toMatchObject({ status: "active", discoveredVia: "registry", priority: 100 });
    const [other] = await t.db.select().from(companies).where(eq(companies.atsToken, "some-seed"));
    expect(other).toMatchObject({ status: "candidate", discoveredVia: "seed:ats-scrapers", priority: 0 });
  });
});

describe("nextBoards", () => {
  const add = (token: string, over: Partial<typeof companies.$inferInsert> = {}) =>
    t.db.insert(companies).values({ atsType: "greenhouse", atsToken: token, name: token, ...over });
  const tokens = async (opts: Partial<Parameters<typeof nextBoards>[1]> = {}) => (await nextBoards(t.db, { now, limit: 50, ...opts })).map((b) => b.token);

  it("orders by priority, then by how long a board has been due (never-polled first)", async () => {
    await add("old", { nextPollAt: ago(10) });
    await add("oldest", { nextPollAt: ago(50) });
    await add("never");
    await add("curated", { priority: 100, nextPollAt: ago(1) });
    await add("empty", { priority: -10, nextPollAt: ago(80) });
    await add("later", { nextPollAt: later(1) });
    expect(await tokens()).toEqual(["curated", "never", "oldest", "old", "empty"]);
    const [first] = await nextBoards(t.db, { now, limit: 1 });
    expect(first).toMatchObject({ token: "curated", atsType: "greenhouse", status: "active", priority: 100, host: "boards-api.greenhouse.io" });
  });

  it("reads only the engine scope's job systems when one is set", async () => {
    await add("gh-board");
    await add("ashby-board", { atsType: "ashby" });
    expect(await tokens({ atsTypes: ["greenhouse"] })).toEqual(["gh-board"]);
    expect(new Set(await tokens())).toEqual(new Set(["gh-board", "ashby-board"]));
  });

  it("polls a boosted company first only while boost_until lies in the future", async () => {
    await add("curated", { priority: 100, nextPollAt: ago(1) });
    await add("boosted", { priority: 0, nextPollAt: ago(1), boostUntil: later(5) });
    await add("lapsed", { priority: 0, nextPollAt: ago(50), boostUntil: ago(1) });
    expect(await tokens()).toEqual(["boosted", "curated", "lapsed"]);
    const [first] = await nextBoards(t.db, { now, limit: 1 });
    expect(first?.priority).toBe(200);
  });

  it("includes a board exactly when its time has come", async () => {
    await add("edge", { nextPollAt: now });
    expect(await tokens()).toEqual(["edge"]);
  });

  it("skips blocked boards and boards of blocklisted names", async () => {
    await add("blocked-never", { blocked: true });
    await add("jobgether", { atsType: "lever" });
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "fine", name: "Fine" });
    const got = await tokens();
    expect(got).toContain("fine");
    expect(got).not.toContain("blocked-never");
    expect(got).not.toContain("jobgether");
  });

  it("returns dead and disabled boards only for their weekly recheck, and probation boards like active ones", async () => {
    await add("dead-waiting", { status: "dead", nextPollAt: later(5) });
    await add("dead-due", { status: "dead", nextPollAt: ago(1) });
    await add("dead-unscheduled", { status: "dead" });
    await add("disabled-due", { status: "disabled", nextPollAt: ago(2) });
    await add("probation", { status: "probation", nextPollAt: ago(3) });
    expect(await tokens()).toEqual(["probation", "disabled-due", "dead-due"]);
  });

  it("splits candidates (validation) from live boards", async () => {
    await add("seed", { status: "candidate" });
    await add("live", { nextPollAt: ago(1) });
    expect(await tokens({ candidates: "only" })).toEqual(["seed"]);
    expect(await tokens({ candidates: "exclude" })).toEqual(["live"]);
    expect((await tokens()).sort()).toEqual(["live", "seed"]);
  });

  it("caps boards per host group so one system cannot fill a run, but keeps the best of each", async () => {
    for (let i = 0; i < 5; i++) await add(`gh${i}`, { host: "boards-api.greenhouse.io", nextPollAt: ago(10 - i) });
    for (let i = 0; i < 5; i++) await t.db.insert(companies).values({ atsType: "lever", atsToken: `lv${i}`, name: `lv${i}`, nextPollAt: ago(20 - i) });
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "lv-curated", name: "lv-curated", priority: 100, nextPollAt: ago(1) });
    // Workday boards group by cluster: two on wd5, one on wd1
    await t.db.insert(companies).values([
      { atsType: "workday", atsToken: "a|wd5|S", name: "A", host: "wd5.myworkdayjobs.com" },
      { atsType: "workday", atsToken: "b|wd5|S", name: "B", host: "wd5.myworkdayjobs.com" },
      { atsType: "workday", atsToken: "c|wd1|S", name: "C", host: "wd1.myworkdayjobs.com" },
    ]);
    const got = await nextBoards(t.db, { now, limit: 50, perHostLimit: 2 });
    const byHost = new Map<string, string[]>();
    for (const b of got) byHost.set(b.host, [...(byHost.get(b.host) ?? []), b.token]);
    expect(byHost.get("boards-api.greenhouse.io")).toEqual(["gh0", "gh1"]);
    expect(byHost.get("api.lever.co")).toEqual(["lv-curated", "lv0"]);
    expect(byHost.get("wd5.myworkdayjobs.com")).toHaveLength(2);
    expect(byHost.get("wd1.myworkdayjobs.com")).toEqual(["c|wd1|S"]);
    expect((await nextBoards(t.db, { now, limit: 3, perHostLimit: 2 }))).toHaveLength(3);
  });

  it("treats rows without a host as one group per job system", async () => {
    for (let i = 0; i < 4; i++) await add(`nohost${i}`);
    expect(await tokens({ perHostLimit: 3 })).toHaveLength(3);
  });
});

describe("maxPollsPerHost", () => {
  it("is 2 for Workable, the connector's own limit when it declares one, else the default", () => {
    expect(maxPollsPerHost("workable")).toBe(2);
    expect(maxPollsPerHost("workable", 10)).toBe(2);
    expect(maxPollsPerHost("lever")).toBe(2);
    expect(maxPollsPerHost("greenhouse")).toBe(4);
    expect(maxPollsPerHost("ashby", 1)).toBe(4);
  });
});
