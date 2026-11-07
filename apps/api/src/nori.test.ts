import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq } from "@norinote/db";
import { makeApi, seedApplication, seedJob, type Api } from "./testkit.js";

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
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json).toEqual({ settings: { spacingMinutes: 4, minFit: 0.7, skipCompanies: [], dailyLimit: 20 } });
    const put = await api.call("PUT", "/api/nori/settings", { cookie, body: { spacingMinutes: 6, skipCompanies: ["Acme"], dailyLimit: 12 } });
    expect(put.json).toEqual({ settings: { spacingMinutes: 6, minFit: 0.7, skipCompanies: ["Acme"], dailyLimit: 12 } });
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
