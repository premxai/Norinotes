import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { BOARD_REGISTRY } from "./board-registry.js";
import { dueBoards, seedCompanies } from "./companies.js";

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

describe("dueBoards", () => {
  const add = (token: string, lastPolledAt: Date | null, extra: Partial<typeof companies.$inferInsert> = {}) =>
    t.db.insert(companies).values({ atsType: "greenhouse", atsToken: token, name: token, lastPolledAt, ...extra });

  it("returns never-polled boards first, then the oldest poll, skipping fresh and blocked ones", async () => {
    await add("old", ago(10));
    await add("oldest", ago(50));
    await add("fresh", ago(1));
    await add("edge", ago(3));
    await add("never", null);
    await add("blocked-never", null, { blocked: true });
    const due = await dueBoards(t.db, { now, every: 3 * HOUR, limit: 10 });
    expect(due.map((d) => d.token)).toEqual(["never", "oldest", "old", "edge"]);
    expect(due[0]).toMatchObject({ atsType: "greenhouse", name: "never", lastPolledAt: null });
  });

  it("honours the limit and defaults to every 3 hours", async () => {
    await add("a", ago(5));
    await add("b", ago(9));
    await add("c", ago(2));
    expect((await dueBoards(t.db, { now, limit: 1 })).map((d) => d.token)).toEqual(["b"]);
    expect((await dueBoards(t.db, { now })).map((d) => d.token)).toEqual(["b", "a"]);
  });

  it("skips job systems without a working connector and blocklisted rows that were never flagged", async () => {
    await t.db.insert(companies).values({ atsType: "workday", atsToken: "tenant|wd5|site", name: "Workday Co" });
    await t.db.insert(companies).values({ atsType: "lever", atsToken: "jobgether", name: "Jobgether" });
    await add("real", null);
    expect((await dueBoards(t.db, { now })).map((d) => d.token)).toEqual(["real"]);
  });
});
