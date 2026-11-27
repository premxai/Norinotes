import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq } from "@norinote/db";
import { dailyCapUse, saveSchedule } from "@norinote/apply";
import { makeApi, seedApplication, seedJob, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

/** A prepared application of the user's, ready for the approve click. */
async function prepared(userId: string, extra: Partial<typeof applications.$inferInsert> = {}): Promise<string> {
  const { job } = await seedJob(api.db);
  return (await seedApplication(api.db, userId, job.id, { status: "prepared", preparedAt: new Date(), ...extra })).id;
}

describe("the daily limit", () => {
  it("refuses an approval over the limit, says why, and counts it in agent status", async () => {
    const s = await api.signup("cap-limit@example.com");
    expect((await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { autoApplyDailyCap: 1 } })).status).toBe(200);
    const first = await prepared(s.user.id);
    const second = await prepared(s.user.id);

    expect((await api.call("POST", `/api/applications/${first}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);
    const over = await api.call("POST", `/api/applications/${second}/approve`, { cookie: s.cookie, body: {} });
    expect(over.status).toBe(429);
    expect(JSON.stringify(over.json)).toContain("1 applications a day");
    expect((await api.db.select().from(applications).where(eq(applications.id, second)))[0]).toMatchObject({ status: "prepared", approvedAt: null });
    expect(api.queuedOf("apply.run").some((q) => q.payload.applicationId === second)).toBe(false);
    expect((await api.call("GET", "/api/agent/status", { cookie: s.cookie })).json).toMatchObject({ dailyCap: 1, usedToday: 1 });

    // A double click on the one already approved is still fine.
    expect((await api.call("POST", `/api/applications/${first}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);

    // Raising the limit lets it through.
    await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { autoApplyDailyCap: 2 } });
    expect((await api.call("POST", `/api/applications/${second}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);
  });

  it("does not count approvals from an earlier day, or block one approved before the limit was reached", async () => {
    const s = await api.signup("cap-earlier@example.com");
    await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { autoApplyDailyCap: 1 } });
    await prepared(s.user.id, { status: "submitted", approvedAt: new Date(Date.now() - 2 * 86_400_000) });
    const today = await prepared(s.user.id);
    expect((await api.call("POST", `/api/applications/${today}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);

    // Approved earlier today while it still had questions: it already counted, so finishing it is not refused.
    const parked = await prepared(s.user.id, { status: "needs_user", approvedAt: new Date(Date.now() - 60_000) });
    const res = await api.call("POST", `/api/applications/${parked}/approve`, { cookie: s.cookie, body: {} });
    expect(res.status).not.toBe(429);
  });

  it("uses the default 20 where the person set no limit (0), the same number everywhere", async () => {
    const s = await api.signup("cap-none@example.com");
    expect((await api.call("GET", "/api/agent/status", { cookie: s.cookie })).json).toMatchObject({ dailyCap: 20, usedToday: 0 });
    for (let i = 0; i < 3; i++) {
      const id = await prepared(s.user.id);
      expect((await api.call("POST", `/api/applications/${id}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);
    }
    expect((await api.call("GET", "/api/agent/status", { cookie: s.cookie })).json).toMatchObject({ dailyCap: 20, usedToday: 3 });
    // The Nori page reads the same limit, so a batch cannot use a different number than a click.
    expect((await api.call("GET", "/api/nori/settings", { cookie: s.cookie })).json.settings.dailyLimit).toBe(20);
  });

  it("counts the day in the person's own time zone, not UTC", async () => {
    const s = await api.signup("cap-zone@example.com");
    await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { autoApplyDailyCap: 1 } });
    // 20:00 UTC on the 25th is noon in Los Angeles and 5am on the 26th in Tokyo: one approval, two local days.
    await prepared(s.user.id, { status: "submitted", approvedAt: new Date("2026-11-25T20:00:00Z") });
    // Still the 25th there (3:30pm), so it counts.
    expect(await dailyCapUse(api.db, s.user.id, new Date("2026-11-25T23:30:00Z"))).toEqual({ cap: 1, used: 1 });
    // 09:00 UTC on the 26th is 1am in Los Angeles: their own day began at 08:00 UTC, so it no longer counts. Under the
    // UTC rule it still did until midnight UTC, which for a Pacific person was 4pm.
    expect(await dailyCapUse(api.db, s.user.id, new Date("2026-11-26T09:00:00Z"))).toEqual({ cap: 1, used: 0 });
    // The boundary is the schedule's zone: the same instant is the 26th in Tokyo, whose day began at 15:00 UTC on the 25th.
    await saveSchedule(api.db, s.user.id, { timezone: "Asia/Tokyo" });
    expect(await dailyCapUse(api.db, s.user.id, new Date("2026-11-26T09:00:00Z"))).toEqual({ cap: 1, used: 1 });
  });
});
