import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq } from "@norinote/db";
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

  it("has no limit at 0", async () => {
    const s = await api.signup("cap-none@example.com");
    for (let i = 0; i < 3; i++) {
      const id = await prepared(s.user.id);
      expect((await api.call("POST", `/api/applications/${id}/approve`, { cookie: s.cookie, body: {} })).status).toBe(200);
    }
    expect((await api.call("GET", "/api/agent/status", { cookie: s.cookie })).json).toMatchObject({ dailyCap: 0, usedToday: 3 });
  });
});
