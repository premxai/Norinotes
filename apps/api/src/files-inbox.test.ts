import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, channels, eq, inboxMessages, outcomes, profiles, resumes, runEvents } from "@norinote/db";
import { assignInboxAddress } from "@norinote/inbox";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
let a: { cookie: string; user: { id: string } };
let b: { cookie: string; user: { id: string } };

beforeAll(async () => {
  api = await makeApi();
  a = await api.signup("files-a@example.com");
  b = await api.signup("files-b@example.com");
});
afterAll(() => api.close());

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const write = (rel: string, data: Buffer | string = PNG) => {
  const file = path.join(api.artifactsDir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
};

describe("resumes", () => {
  it("serves the JSON and streams the PDF to the owner only", async () => {
    const { job } = await seedJob(api.db);
    const app = await seedApplication(api.db, a.user.id, job.id);
    const pdf = write(`resumes/${a.user.id}/r1.pdf`, "%PDF-1.4 fake");
    const [resume] = await api.db.insert(resumes).values({ applicationId: app.id, content: { name: "Ada" }, pdfPath: pdf, pages: 1 }).returning();

    const json = await api.call("GET", `/api/resumes/${resume!.id}`, { cookie: a.cookie });
    expect(json.status).toBe(200);
    expect(json.json).toMatchObject({ id: resume!.id, applicationId: app.id, pages: 1, changes: [], atsChecks: [] });

    const res = await api.app.request(`/api/resumes/${resume!.id}.pdf`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4 fake");

    expect((await api.call("GET", `/api/resumes/${resume!.id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await api.call("GET", `/api/resumes/${resume!.id}.pdf`, { cookie: b.cookie })).status).toBe(404);
    expect((await api.call("GET", `/api/resumes/${resume!.id}.pdf`)).status).toBe(401);
    expect((await api.call("GET", "/api/resumes/not-an-id", { cookie: a.cookie })).status).toBe(404);
  });

  it("serves a PDF from object storage when this machine does not have it, and deletes it with the account", async () => {
    const stored = new Map<string, Uint8Array>();
    const files = {
      async put(key: string, body: Uint8Array) { stored.set(key, body); },
      async get(key: string) { return stored.get(key) ?? null; },
      async deletePrefix(prefix: string) { let n = 0; for (const k of [...stored.keys()]) if (k.startsWith(prefix)) { stored.delete(k); n++; } return n; },
    };
    const remote = await makeApi({ files });
    const c = await remote.signup("files-c@example.com");
    const { job } = await seedJob(remote.db);
    const app = await seedApplication(remote.db, c.user.id, job.id);
    // Made by the worker on another machine: recorded under the same ARTIFACTS_DIR, present only in storage.
    const pdfPath = path.join(remote.artifactsDir, "resumes", c.user.id, "r9.pdf");
    stored.set(`resumes/${c.user.id}/r9.pdf`, new TextEncoder().encode("%PDF-1.4 stored"));
    const [resume] = await remote.db.insert(resumes).values({ applicationId: app.id, content: { name: "Ada" }, pdfPath, pages: 1 }).returning();

    const res = await remote.app.request(`/api/resumes/${resume!.id}.pdf`, { headers: { cookie: c.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4 stored");

    expect((await remote.call("DELETE", "/api/auth/account", { cookie: c.cookie, body: { confirm: "files-c@example.com" } })).status).toBe(200);
    expect(stored.size).toBe(0);
    await remote.close();
  });

  it("does not serve a PDF that is recorded outside the artifacts directory", async () => {
    const { job } = await seedJob(api.db);
    const app = await seedApplication(api.db, a.user.id, job.id);
    const outside = path.join(os.tmpdir(), `norinote-outside-${Date.now()}.pdf`);
    writeFileSync(outside, "%PDF-1.4 secret");
    const [resume] = await api.db.insert(resumes).values({ applicationId: app.id, content: { name: "Ada" }, pdfPath: outside }).returning();
    expect((await api.call("GET", `/api/resumes/${resume!.id}.pdf`, { cookie: a.cookie })).status).toBe(404);
  });
});

describe("artifacts", () => {
  it("serves a receipt screenshot to the owner of the application only", async () => {
    const { job } = await seedJob(api.db);
    const shot = write("shots/receipt-1.png");
    const app = await seedApplication(api.db, a.user.id, job.id, { status: "submitted", receipt: { screenshotPath: shot, confirmationText: "Thanks" } });

    const res = await api.app.request("/api/artifacts/shots/receipt-1.png", { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);

    expect((await api.call("GET", "/api/artifacts/shots/receipt-1.png", { cookie: b.cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/artifacts/shots/receipt-1.png")).status).toBe(401);

    // The web builds /api/artifacts/<rest> from this path.
    const detail = await api.call("GET", `/api/applications/${app.id}`, { cookie: a.cookie });
    expect(detail.json.application.receipt.screenshotPath).toBe("artifacts/shots/receipt-1.png");
  });

  it("refuses files nobody recorded, and every path traversal", async () => {
    write("shots/unrecorded.png");
    expect((await api.call("GET", "/api/artifacts/shots/unrecorded.png", { cookie: a.cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/artifacts/shots/missing.png", { cookie: a.cookie })).status).toBe(404);

    const secret = path.join(path.dirname(api.artifactsDir), "norinote-secret.txt");
    writeFileSync(secret, "top secret");
    const { job } = await seedJob(api.db);
    // Even a receipt that points at a file outside the directory must not open it.
    await seedApplication(api.db, a.user.id, job.id, { status: "submitted", receipt: { screenshotPath: secret } });
    const name = path.basename(secret);
    for (const url of [
      `/api/artifacts/..%2F${name}`, `/api/artifacts/%2e%2e%2f${name}`, `/api/artifacts/%252e%252e%252f${name}`,
      `/api/artifacts/shots/..%2F..%2F${name}`, `/api/artifacts/..%5C${name}`, `/api/artifacts/${encodeURIComponent(secret)}`,
      `/api/artifacts/%2Fetc%2Fpasswd`, "/api/artifacts/", "/api/artifacts/shots/%00.png", "/api/artifacts/shots//x.png",
    ]) {
      const res = await api.app.request(url, { headers: { cookie: a.cookie } });
      expect(res.status, url).toBe(404);
      expect(await res.text(), url).not.toContain("top secret");
    }
  });
});

describe("inbound email webhook", () => {
  let address: string;
  const mail = (over: Record<string, unknown> = {}) => ({ from: "jobs@greenhouse.io", to: address, subject: "Your verification code", text: "Your security code is 482913.", ...over });

  beforeAll(async () => { address = await assignInboxAddress(api.db, a.user.id, "inbox.norinote.local"); });

  it("rejects a missing or wrong secret and stores nothing", async () => {
    expect((await api.call("POST", "/api/inbound/email", { body: mail() })).status).toBe(401);
    expect((await api.call("POST", "/api/inbound/email", { body: mail(), headers: { "x-webhook-secret": "nope" } })).status).toBe(401);
    expect(await api.db.select().from(inboxMessages)).toHaveLength(0);
    const unset = await makeApi({ config: { inboundWebhookSecret: undefined } });
    expect((await unset.call("POST", "/api/inbound/email", { body: mail(), headers: { "x-webhook-secret": "" } })).status).toBe(401);
    await unset.close();
  });

  it("stores a message, queues inbox.receive once and shows it in the inbox", async () => {
    const res = await api.call("POST", "/api/inbound/email", { body: mail({ messageId: "<m1@greenhouse.io>" }), headers: { "x-webhook-secret": "hook-secret" } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ stored: true, duplicate: false });
    const [row] = await api.db.select().from(inboxMessages).where(eq(inboxMessages.userId, a.user.id));
    expect(row).toMatchObject({ code: "482913", kind: "verification_code", fromAddress: "jobs@greenhouse.io" });
    expect(api.queuedOf("inbox.receive")).toEqual([{ name: "inbox.receive", payload: { messageId: row!.id } }]);

    const again = await api.call("POST", "/api/inbound/email", { body: mail({ messageId: "<m1@greenhouse.io>" }), headers: { authorization: "Bearer hook-secret" } });
    expect(again.json).toEqual({ stored: true, duplicate: true });
    expect(api.queuedOf("inbox.receive")).toHaveLength(1);

    const inbox = await api.call("GET", "/api/inbox", { cookie: a.cookie });
    expect(inbox.json).toHaveLength(1);
    expect(inbox.json[0]).toEqual({
      id: row!.id, applicationId: null, fromAddress: "jobs@greenhouse.io", subject: "Your verification code", bodyText: "Your security code is 482913.",
      receivedAt: expect.any(String), kind: "verification_code", code: "482913",
      application: null, fromName: null, verificationLink: null, links: [], attachments: [], spam: false,
    });
    expect((await api.call("GET", "/api/inbox", { cookie: b.cookie })).json).toEqual([]);
    expect((await api.call("GET", "/api/inbox")).status).toBe(401);
  });

  it("accepts the secret as basic auth, and drops mail for unknown recipients with a 200", async () => {
    const basic = `Basic ${Buffer.from("hook:hook-secret").toString("base64")}`;
    const unknown = await api.call("POST", "/api/inbound/email", { body: mail({ to: "nobody@inbox.norinote.local" }), headers: { authorization: basic } });
    expect(unknown.status).toBe(200);
    expect(unknown.json).toEqual({ stored: false, reason: "unknown_recipient" });
    const raw = await api.app.request("/api/inbound/email", { method: "POST", headers: { authorization: basic, "content-type": "message/rfc822" }, body: `From: Recruiter <r@acme.com>\r\nTo: ${address}\r\nSubject: Hello\r\nMessage-ID: <raw1@acme.com>\r\n\r\nWe would love to talk.` });
    expect(raw.status).toBe(200);
    expect(((await raw.json()) as { stored: boolean }).stored).toBe(true);
  });
});

describe("telegram", () => {
  it("reports it is not configured and refuses to make a code", async () => {
    expect((await api.call("GET", "/api/channels/telegram", { cookie: a.cookie })).json).toMatchObject({ configured: false, botUsername: null, linked: false });
    expect((await api.call("POST", "/api/channels/telegram/link", { cookie: a.cookie, body: {} })).status).toBe(503);
  });

  it("makes a short-lived link code when a bot is configured", async () => {
    const bot = await makeApi({ config: { telegramBotToken: "123:abc", telegramBotUsername: "NorinoteBot" } });
    const s = await bot.signup("tg@example.com");
    const res = await bot.call("POST", "/api/channels/telegram/link", { cookie: s.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(res.json.code).toMatch(/^[A-Z2-9]{16}$/);
    expect(res.json.botUsername).toBe("NorinoteBot");
    expect(res.json.link).toBe(`https://t.me/NorinoteBot?start=${res.json.code}`);
    const ttl = new Date(res.json.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(5 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    const again = await bot.call("POST", "/api/channels/telegram/link", { cookie: s.cookie, body: {} });
    expect(again.json.code).not.toBe(res.json.code);

    expect((await bot.call("GET", "/api/channels/telegram", { cookie: s.cookie })).json).toMatchObject({ configured: true, botUsername: "NorinoteBot", linked: false });
    await bot.db.insert(channels).values({ userId: s.user.id, kind: "telegram", address: "42" });
    expect((await bot.call("GET", "/api/channels/telegram", { cookie: s.cookie })).json.linked).toBe(true);
    await bot.close();
  });
});

describe("agent", () => {
  it("reports the daily cap, today's use and whether real submits are on", async () => {
    await api.call("PUT", "/api/profile", { cookie: a.cookie, body: { autoApplyDailyCap: 4 } });
    const { job } = await seedJob(api.db);
    await seedApplication(api.db, a.user.id, job.id, { status: "applying", approvedAt: new Date() });
    const { job: older } = await seedJob(api.db);
    await seedApplication(api.db, a.user.id, older.id, { status: "submitted", approvedAt: new Date(Date.now() - 3 * 86_400_000) });

    const res = await api.call("GET", "/api/agent/status", { cookie: a.cookie });
    expect(res.json).toMatchObject({ dailyCap: 4, usedToday: 1, liveSubmit: false });
    const live = await makeApi({ config: { allowRealSubmit: true } });
    const s = await live.signup("live@example.com");
    expect((await live.call("GET", "/api/agent/status", { cookie: s.cookie })).json).toMatchObject({ dailyCap: 0, usedToday: 0, liveSubmit: true });
    await live.close();
    expect((await api.call("GET", "/api/agent/status")).status).toBe(401);
    expect(await api.db.select().from(profiles).where(eq(profiles.userId, a.user.id))).toHaveLength(1);
  });

  it("derives activity from the run log, the shortlist and the outcomes, newest first", async () => {
    const c = await api.signup("activity@example.com");
    const { job } = await seedJob(api.db, { title: "Activity Engineer", company: "Active Co" });
    const { job: scoredJob } = await seedJob(api.db, { title: "Scored Engineer", company: "Scored Co" });
    const { job: skippedJob } = await seedJob(api.db, { title: "Skipped Engineer", company: "Skipped Co" });
    const app = await seedApplication(api.db, c.user.id, job.id, { status: "submitted", receipt: { dryRun: true } });
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    await api.db.insert(runEvents).values([
      { applicationId: app.id, step: "created", message: "Queued", ts: t(50) },
      { applicationId: app.id, step: "status:prepared", message: "Prepared", ts: t(40) },
      { applicationId: app.id, step: "status:applying", message: "Approved", data: { approvedBy: "user" }, ts: t(30) },
      { applicationId: app.id, step: "apply_start", message: "Applying through greenhouse", ts: t(29) },
      { applicationId: app.id, step: "status:submitted", message: "Submitted", ts: t(20) },
    ]);
    await api.db.insert(outcomes).values([{ applicationId: app.id, kind: "interview", at: t(5) }, { applicationId: app.id, kind: "rejection", at: t(10) }]);
    await seedShortlist(api.db, c.user.id, scoredJob.id, 0.88);
    await seedShortlist(api.db, c.user.id, skippedJob.id, 0.61, { status: "dismissed" });

    const res = await api.call("GET", "/api/agent/activity", { cookie: c.cookie });
    expect(res.status).toBe(200);
    const kinds = res.json.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["queued", "prepared", "approved", "submitted", "interview", "reply", "scored", "skipped"]));
    expect(kinds).not.toContain("apply_start");
    const times = res.json.map((e: { ts: string }) => e.ts);
    expect([...times].sort().reverse()).toEqual(times);
    const submitted = res.json.find((e: { kind: string }) => e.kind === "submitted");
    expect(submitted.data).toMatchObject({ dryRun: true, job: { title: "Activity Engineer", companyName: "Active Co" } });
    expect(submitted.applicationId).toBe(app.id);
    const scored = res.json.find((e: { kind: string }) => e.kind === "scored");
    expect(scored.message).toBe("Scored Engineer at Scored Co fits you 88%");
    expect(scored.data.reasons).toEqual(["Fits at 88%"]);
    expect((await api.call("GET", "/api/agent/activity?limit=3", { cookie: c.cookie })).json).toHaveLength(3);

    // Another user sees none of it.
    expect((await api.call("GET", "/api/agent/activity", { cookie: b.cookie })).json).toEqual([]);
    expect(await api.db.select().from(applications).where(eq(applications.userId, c.user.id))).toHaveLength(1);
  });
});
