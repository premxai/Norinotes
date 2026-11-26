import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, profiles, shortlist } from "@norinote/db";
import { makeApi, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

const rowOf = async (userId: string, jobId: string) =>
  (await api.db.select().from(shortlist).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId))))[0]!;

describe("POST /api/shortlist/:jobId/dismiss with a reason", () => {
  it("stays reason-less by default, rejects unknown reasons, and records a reason given after the skip", async () => {
    const u = await api.signup("skip-plain@example.com");
    const { job } = await seedJob(api.db, { title: "Backend Engineer" });
    await seedShortlist(api.db, u.user.id, job.id, 0.7);
    expect((await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie, body: { reason: "boring" } })).status).toBe(400);
    expect((await rowOf(u.user.id, job.id)).status).toBe("new");

    const plain = await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie });
    expect(plain.json).toEqual({ ok: true, reason: null, addedToSkipList: false });
    const row = await rowOf(u.user.id, job.id);
    expect(row).toMatchObject({ status: "dismissed", skipReason: null });
    expect(row.dismissedAt).toBeInstanceOf(Date);

    const later = await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie, body: { reason: "missing_skills" } });
    expect(later.json).toEqual({ ok: true, reason: "missing_skills", addedToSkipList: false });
    expect((await rowOf(u.user.id, job.id)).skipReason).toBe("missing_skills");

    // An applied job is left alone.
    const { job: applied } = await seedJob(api.db, { title: "Applied Engineer" });
    await seedShortlist(api.db, u.user.id, applied.id, 0.8, { status: "applied" });
    expect((await api.call("POST", `/api/shortlist/${applied.id}/dismiss`, { cookie: u.cookie, body: { reason: "too_senior" } })).json).toEqual({ ok: true, reason: null, addedToSkipList: false });
    expect(await rowOf(u.user.id, applied.id)).toMatchObject({ status: "applied", skipReason: null });
  });

  it("Company I don't want adds the company to the skip list, and its other jobs leave the list", async () => {
    const u = await api.signup("skip-company@example.com");
    const { job, company } = await seedJob(api.db, { title: "Data Analyst", company: "Skipco Inc" });
    const { job: other } = await seedJob(api.db, { title: "Data Engineer", company: "Skipco" });
    await seedShortlist(api.db, u.user.id, job.id, 0.7);
    await seedShortlist(api.db, u.user.id, other.id, 0.6);
    const res = await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie, body: { reason: "company" } });
    expect(res.json).toEqual({ ok: true, reason: "company", addedToSkipList: true });
    const [p] = await api.db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, u.user.id));
    expect((p!.preferences as { excludeCompanies: string[] }).excludeCompanies).toEqual([company.name]);
    expect((await api.call("GET", "/api/shortlist", { cookie: u.cookie })).json).toEqual([]);
    // Undo is the skip list itself (PUT /api/profile).
    await api.call("PUT", "/api/profile", { cookie: u.cookie, body: { preferences: { excludeCompanies: [] } } });
    expect((await api.call<{ jobId: string }[]>("GET", "/api/shortlist", { cookie: u.cookie })).json.map((i) => i.jobId)).toEqual([other.id]);
  });
});

describe("GET and DELETE /api/shortlist/skip-effects", () => {
  it("needs a session", async () => {
    expect((await api.call("GET", "/api/shortlist/skip-effects")).status).toBe(401);
    expect((await api.call("DELETE", "/api/shortlist/skip-effects/level_above")).status).toBe(401);
  });

  it("lists an effect after two skips of the same kind, rematches, and removes it on request", async () => {
    const u = await api.signup("skip-effects@example.com");
    const skip = async (title: string) => {
      const { job } = await seedJob(api.db, { title });
      await seedShortlist(api.db, u.user.id, job.id, 0.7);
      return api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie, body: { reason: "too_senior" } });
    };
    const matches = () => api.queuedOf("match.user").filter((q) => q.payload.userId === u.user.id).length;

    await skip("Staff Software Engineer");
    expect((await api.call("GET", "/api/shortlist/skip-effects", { cookie: u.cookie })).json).toEqual([]);
    expect(matches()).toBe(0);

    await skip("Principal Software Engineer");
    const effects = await api.call("GET", "/api/shortlist/skip-effects", { cookie: u.cookie });
    expect(effects.json).toEqual([{ id: "level_above", kind: "level_above", reason: "too_senior", label: "staff level and above", skips: 2, delta: -0.05 }]);
    expect(matches()).toBe(1);

    expect((await api.call("DELETE", "/api/shortlist/skip-effects/role%3Asales", { cookie: u.cookie })).status).toBe(404);
    expect((await api.call("DELETE", "/api/shortlist/skip-effects/level_above", { cookie: u.cookie })).json).toEqual({ ok: true });
    expect((await api.call("GET", "/api/shortlist/skip-effects", { cookie: u.cookie })).json).toEqual([]);
    expect(matches()).toBe(2);
  });
});
