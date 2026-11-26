import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, applyBatches, eq, profiles } from "@norinote/db";
import { placeInGroup } from "@norinote/match/testing";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

describe("the Nori page API", () => {
  let api: Api;
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    api = await makeApi();
    const u = await api.signup("nori-page@example.com");
    cookie = u.cookie;
    userId = u.user.id;
  });
  afterAll(() => api.close());

  it("reads and saves how Nori works for the person", async () => {
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json).toEqual({ settings: { spacingMinutes: 4, minFit: 0.6, aggressiveness: "balanced", skipCompanies: [], dailyLimit: 20 } });
    const put = await api.call("PUT", "/api/nori/settings", { cookie, body: { spacingMinutes: 6, skipCompanies: ["Acme"], dailyLimit: 12 } });
    expect(put.json).toEqual({ settings: { spacingMinutes: 6, minFit: 0.6, aggressiveness: "balanced", skipCompanies: ["Acme"], dailyLimit: 12 } });
    const cautious = await api.call("PUT", "/api/nori/settings", { cookie, body: { aggressiveness: "cautious" } });
    expect(cautious.json.settings).toMatchObject({ aggressiveness: "cautious", spacingMinutes: 6, dailyLimit: 12 });
    const [row] = await api.db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId));
    expect(row!.preferences).toMatchObject({ nori: { aggressiveness: "cautious" } });
    // Saving something else keeps it.
    await api.call("PUT", "/api/nori/settings", { cookie, body: { spacingMinutes: 5 } });
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json.settings.aggressiveness).toBe("cautious");
    expect((await api.call("PUT", "/api/nori/settings", { cookie, body: { aggressiveness: "reckless" } })).status).toBe(400);
    expect((await api.call("PUT", "/api/nori/settings", { cookie, body: { spacingMinutes: 0 } })).status).toBe(400);
    expect((await api.call("PUT", "/api/nori/settings", { cookie, body: { surprise: true } })).status).toBe(400);
  });

  it("starts a batch, prepares its applications, shows it and stops the rest", async () => {
    const one = await seedJob(api.db, { company: "Batch One" });
    const two = await seedJob(api.db, { company: "Batch Two" });
    const res = await api.call("POST", "/api/nori/batches", { cookie, body: { jobIds: [one.job.id, two.job.id] } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ added: 2, skipped: [], batch: { status: "running", counts: { total: 2, preparing: 2 } } });
    expect(api.queuedOf("prepare.application")).toHaveLength(2);
    const batchId = res.json.batch.id as string;

    const list = await api.call("GET", "/api/nori/batches", { cookie });
    expect(list.json.batches[0]).toMatchObject({ id: batchId, status: "running" });
    const detail = await api.call("GET", `/api/nori/batches/${batchId}`, { cookie });
    expect(detail.json.applications.map((a: { company: string }) => a.company).sort()).toEqual(["Batch One", "Batch Two"]);

    const other = await api.signup("nori-other@example.com");
    expect((await api.call("GET", `/api/nori/batches/${batchId}`, { cookie: other.cookie })).status).toBe(404);
    expect((await api.call("POST", `/api/nori/batches/${batchId}/stop`, { cookie: other.cookie })).status).toBe(404);

    const stop = await api.call("POST", `/api/nori/batches/${batchId}/stop`, { cookie });
    expect(stop.json).toEqual({ ok: true, cancelled: 2 });
    expect((await api.call("GET", `/api/nori/batches/${batchId}`, { cookie })).json.batch).toMatchObject({ status: "stopped", counts: { cancelled: 2 } });
  });

  it("a second Apply now within a minute returns the batch it just started instead of starting another", async () => {
    const u = await api.signup("nori-double@example.com");
    for (const company of ["Double A", "Double B", "Double C", "Double D"]) {
      const { job } = await seedJob(api.db, { company });
      await seedShortlist(api.db, u.user.id, job.id, 0.9);
      await placeInGroup(api.db, u.user.id, job.id, "strong");
    }
    const first = await api.call("POST", "/api/nori/batches", { cookie: u.cookie, body: { recommended: true, limit: 2 } });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ added: 2, batch: { counts: { total: 2 } } });
    expect(first.json.reused).toBeUndefined();
    const second = await api.call("POST", "/api/nori/batches", { cookie: u.cookie, body: { recommended: true, limit: 2 } });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ reused: true, added: 2, skipped: [], batch: { id: first.json.batch.id } });
    expect(await api.db.select().from(applyBatches).where(eq(applyBatches.userId, u.user.id))).toHaveLength(1);
  });

  it("Apply now never queues more than today's limit has room for", async () => {
    const u = await api.signup("nori-limit@example.com");
    await api.call("PUT", "/api/nori/settings", { cookie: u.cookie, body: { dailyLimit: 3 } });
    for (const company of ["Sent One", "Sent Two"]) await seedApplication(api.db, u.user.id, (await seedJob(api.db, { company })).job.id, { status: "submitted", approvedAt: new Date(), resumeId: null });
    for (const company of ["Room A", "Room B", "Room C"]) {
      const { job } = await seedJob(api.db, { company });
      await seedShortlist(api.db, u.user.id, job.id, 0.9);
      await placeInGroup(api.db, u.user.id, job.id, "strong");
    }
    const res = await api.call("POST", "/api/nori/batches", { cookie: u.cookie, body: { recommended: true, limit: 10 } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ added: 1, batch: { counts: { total: 1 } } });
    // Used up: nothing is started.
    await seedApplication(api.db, u.user.id, (await seedJob(api.db, { company: "Sent Three" })).job.id, { status: "submitted", approvedAt: new Date(), resumeId: null });
    await api.db.update(applyBatches).set({ createdAt: new Date(Date.now() - 5 * 60_000) }).where(eq(applyBatches.userId, u.user.id));
    expect((await api.call("POST", "/api/nori/batches", { cookie: u.cookie, body: { recommended: true } })).status).toBe(429);
  });

  it("refuses a hard no in a batch the person picked, with a plain reason, and sends the rest whatever their group", async () => {
    const u = await api.signup("nori-hardno@example.com");
    const add = async (company: string, group: "strong" | "stretch" | "hard_no") => {
      const { job } = await seedJob(api.db, { company });
      await seedShortlist(api.db, u.user.id, job.id, 0.85);
      await placeInGroup(api.db, u.user.id, job.id, group);
      return job.id;
    };
    const [strong, stretch, no] = [await add("Picked Strong", "strong"), await add("Picked Stretch", "stretch"), await add("Picked No", "hard_no")];
    const res = await api.call("POST", "/api/nori/batches", { cookie: u.cookie, body: { jobIds: [strong, stretch, no] } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ added: 2, skipped: [{ jobId: no, reason: "not_a_fit", detail: "Missing a must-have: Kubernetes" }] });
  });

  it("lists the apply decisions: what Nori sends, asks about and skips", async () => {
    const u = await api.signup("nori-decisions@example.com");
    const add = async (company: string, title: string, group: "strong" | "stretch" | "hard_no") => {
      const { job } = await seedJob(api.db, { company, title });
      await seedShortlist(api.db, u.user.id, job.id, 0.8);
      await placeInGroup(api.db, u.user.id, job.id, group);
      return job.id;
    };
    const strong = await add("Decide Strong", "Backend Engineer", "strong");
    const ask = await add("Decide Ask", "Platform Engineer", "stretch");
    const no = await add("Decide No", "Data Engineer", "hard_no");
    const res = await api.call("GET", "/api/nori/decisions", { cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ aggressiveness: "balanced", weekUsed: 0, weekLeft: 20 });
    expect(res.json.decisions).toEqual([
      { jobId: strong, title: "Backend Engineer", company: "Decide Strong", group: "strong", action: "send", reasons: expect.any(Array), fit: 0.8 },
      { jobId: ask, title: "Platform Engineer", company: "Decide Ask", group: "stretch", action: "ask", reasons: [expect.any(String)], fit: 0.8 },
      { jobId: no, title: "Data Engineer", company: "Decide No", group: null, action: "skip", reasons: ["Missing a must-have: Kubernetes"], fit: 0.8 },
    ]);
    expect((await api.call("GET", "/api/nori/decisions", {})).status).toBe(401);
  });

  it("refuses a batch nothing can go into, and bad input", async () => {
    expect((await api.call("POST", "/api/nori/batches", { cookie, body: { jobIds: ["00000000-0000-0000-0000-000000000000"] } })).status).toBe(409);
    expect((await api.call("POST", "/api/nori/batches", { cookie, body: { jobIds: [] } })).status).toBe(400);
    expect((await api.call("POST", "/api/nori/batches", { body: { jobIds: [] } })).status).toBe(401);
  });

  it("lists what needs the person, with what each one needs", async () => {
    const q = await seedJob(api.db, { company: "Question Co" });
    const c = await seedJob(api.db, { company: "Captcha Co" });
    const k = await seedJob(api.db, { company: "Code Co" });
    await seedApplication(api.db, userId, q.job.id, { status: "needs_user", resumeId: null, pendingQuestions: [{ id: "q1", text: "Why us?", type: "text", options: [], required: true }] });
    await seedApplication(api.db, userId, c.job.id, { status: "needs_user", resumeId: null, error: "The site showed a captcha. Norinote never solves or bypasses captchas" });
    const coded = await seedApplication(api.db, userId, k.job.id, { status: "needs_user", resumeId: null, receipt: { submitClicked: true, codeMissing: true } });
    const res = await api.call("GET", "/api/nori/needs-you", { cookie });
    const byCompany = Object.fromEntries(res.json.items.map((i: { company: string; needs: string }) => [i.company, i.needs]));
    expect(byCompany).toMatchObject({ "Question Co": "questions", "Captcha Co": "captcha", "Code Co": "code" });
    const [row] = await api.db.select().from(applications).where(eq(applications.id, coded.id));
    expect(row!.status).toBe("needs_user");
  });
});
