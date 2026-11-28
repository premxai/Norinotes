import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { CompanyGate } from "./gate.js";
import { acquireLock, lockTaken, stampLock, userSendLockKey } from "./locks.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

describe("the company claim shared by every worker", () => {
  it("lets one machine hold a company at a time, and keeps the cooldown after it", async () => {
    let clock = Date.parse("2026-11-28T10:00:00Z");
    const now = () => clock;
    // Two gates over one database: two worker processes.
    const one = new CompanyGate(30_000, now, t.db);
    const two = new CompanyGate(30_000, now, t.db);
    const held = await one.acquire("acme", 0);
    expect(held).toBeTruthy();
    expect(await two.acquire("acme", 0)).toBeNull();
    // Another company is not affected.
    const elsewhere = await two.acquire("other", 0);
    expect(elsewhere).toBeTruthy();
    await elsewhere!();

    await held!();
    // Cooling down, then free.
    expect(await two.acquire("acme", 0)).toBeNull();
    clock += 30_000;
    const again = await two.acquire("acme", 0);
    expect(again).toBeTruthy();
    await again!();
  });

  it("frees a claim nobody released, so a crashed run does not lock a company out", async () => {
    const start = new Date("2026-11-28T11:00:00Z");
    const held = await acquireLock(t.db, "company:crashy", { now: () => start, holdMs: 60_000, cooldownMs: 0 });
    expect(held).toBeTruthy();
    expect(await lockTaken(t.db, "company:crashy", new Date(start.getTime() + 30_000))).toBe(true);
    expect(await lockTaken(t.db, "company:crashy", new Date(start.getTime() + 61_000))).toBe(false);
  });

  it("records when a person's last application started, for every machine to see", async () => {
    const at = new Date("2026-11-28T12:00:00Z");
    const key = userSendLockKey("user-1");
    await stampLock(t.db, key, at, 5 * 60_000);
    expect(await lockTaken(t.db, key, new Date(at.getTime() + 4 * 60_000))).toBe(true);
    expect(await lockTaken(t.db, key, new Date(at.getTime() + 5 * 60_000))).toBe(false);
  });
});
