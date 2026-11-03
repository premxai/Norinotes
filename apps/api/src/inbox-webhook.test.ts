import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inboxMessages } from "@norinote/db";
import { signWebhook } from "@norinote/inbox";
import { makeApi, seedApplication, seedJob, type Api } from "./testkit.js";

let api: Api;
let a: { cookie: string; user: { id: string } };
let b: { cookie: string; user: { id: string } };
let address: string;

beforeAll(async () => {
  api = await makeApi();
  a = await api.signup("inbox-a@example.com");
  b = await api.signup("inbox-b@example.com");
});
afterAll(() => api.close());

const SECRET = "hook-secret";

async function post(provider: string, body: string, o: { contentType?: string; sign?: boolean | number; headers?: Record<string, string> } = {}) {
  const ts = typeof o.sign === "number" ? o.sign : Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": o.contentType ?? "message/rfc822", ...(o.headers ?? {}) };
  if (o.sign !== false) {
    headers["x-norinote-timestamp"] = String(ts);
    headers["x-norinote-signature"] = signWebhook(body, SECRET, ts);
  }
  const res = await api.app.request(`/api/inbox/webhook/${provider}`, { method: "POST", headers, body });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const greenhouseCode = (to: string, id: string, company = "Acme 1") =>
  `From: ${company} via Greenhouse <no-reply@us.greenhouse-mail.io>\r\nTo: Ada <someone-else@example.com>\r\nSubject: Security code for your application to ${company}\r\nMessage-ID: <${id}@greenhouse-mail.io>\r\nContent-Type: text/plain\r\n\r\nCopy and paste this code into the security code field:\r\n\r\n482913\r\n`;

describe("address and settings", () => {
  it("creates a stable address on first read and keeps forwarding settings", async () => {
    const first = await api.call("GET", "/api/inbox/address", { cookie: a.cookie });
    expect(first.status).toBe(200);
    expect(first.json.address).toMatch(/^nori-[a-hj-km-np-z2-9]{10}@inbox\.norinote\.local$/);
    expect(first.json).toMatchObject({ configured: true, settings: { forwardTo: null, forwardEnabled: false, retentionDays: null } });
    address = first.json.address;
    expect((await api.call("GET", "/api/inbox/address", { cookie: a.cookie })).json.address).toBe(address);
    expect((await api.call("GET", "/api/inbox/address", { cookie: b.cookie })).json.address).not.toBe(address);
    expect((await api.call("GET", "/api/inbox/address")).status).toBe(401);

    const put = await api.call("PUT", "/api/inbox/settings", { cookie: a.cookie, body: { forwardTo: "ada@example.com", forwardEnabled: true, retentionDays: 30 } });
    expect(put.json).toEqual({ settings: { forwardTo: "ada@example.com", forwardEnabled: true, retentionDays: 30 } });
    expect((await api.call("PUT", "/api/inbox/settings", { cookie: a.cookie, body: { forwardTo: address } })).status).toBe(400);
    expect((await api.call("PUT", "/api/inbox/settings", { cookie: a.cookie, body: { retentionDays: 0 } })).status).toBe(400);
    expect((await api.call("PUT", "/api/inbox/settings", { cookie: a.cookie, body: { nonsense: 1 } })).status).toBe(400);
    // The settings live in the profile but do not leak into the profile's user-facing fields as anything else.
    expect((await api.call("GET", "/api/inbox/address", { cookie: a.cookie })).json.settings.forwardTo).toBe("ada@example.com");
  });
});

describe("POST /api/inbox/webhook/:provider", () => {
  it("accepts raw MIME from our Cloudflare Worker by the envelope recipient, links it and queues inbox.receive", async () => {
    const { job, company } = await seedJob(api.db, { company: "Acme 1" });
    const app = await seedApplication(api.db, a.user.id, job.id, { status: "awaiting_code" });
    const res = await post("cloudflare", greenhouseCode(address, "cf-1", company.name), { headers: { "x-norinote-envelope-to": address } });
    expect(res).toEqual({ status: 200, json: { stored: true, duplicate: false } });
    const [row] = await api.db.select().from(inboxMessages).where(eq(inboxMessages.messageId, "<cf-1@greenhouse-mail.io>"));
    expect(row).toMatchObject({ userId: a.user.id, applicationId: app.id, kind: "verification_code", code: "482913" });
    expect(row!.meta).toMatchObject({ provider: "cloudflare", trusted: true });
    expect(api.queuedOf("inbox.receive")).toContainEqual({ name: "inbox.receive", payload: { messageId: row!.id } });

    const again = await post("cloudflare", greenhouseCode(address, "cf-1", company.name), { headers: { "x-norinote-envelope-to": address } });
    expect(again.json).toEqual({ stored: true, duplicate: true });
  });

  it("refuses a missing, wrong or stale signature, and an unknown provider", async () => {
    const body = greenhouseCode(address, "cf-bad");
    expect((await post("cloudflare", body, { sign: false })).status).toBe(401);
    expect((await post("cloudflare", body, { headers: { "x-norinote-signature": "v1=" + "0".repeat(64) }, sign: false })).status).toBe(401);
    expect((await post("raw", body, { sign: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const tampered = await api.app.request("/api/inbox/webhook/raw", {
      method: "POST", body: `${body}x`,
      headers: { "content-type": "message/rfc822", "x-norinote-timestamp": String(Math.floor(Date.now() / 1000)), "x-norinote-signature": signWebhook(body, SECRET, Math.floor(Date.now() / 1000)) },
    });
    expect(tampered.status).toBe(401);
    expect((await post("sendgrid", body)).status).toBe(404);
    const unset = await makeApi({ config: { inboundWebhookSecret: undefined } });
    const r = await unset.app.request("/api/inbox/webhook/raw", { method: "POST", body, headers: { "x-norinote-timestamp": "1", "x-norinote-signature": "v1=00" } });
    expect(r.status).toBe(401);
    await unset.close();
    expect(await api.db.select().from(inboxMessages).where(eq(inboxMessages.messageId, "<cf-bad@greenhouse-mail.io>"))).toHaveLength(0);
  });

  it("accepts signed generic JSON and Postmark JSON with basic auth; drops unknown recipients with a 200", async () => {
    const generic = JSON.stringify({ from: "Recruiter <sam@initech.com>", to: address, subject: "Your application", text: "I'm on the hiring team and saw your application for the role.", messageId: "gen-1" });
    expect(await post("generic", generic, { contentType: "application/json" })).toEqual({ status: 200, json: { stored: true, duplicate: false } });

    const postmark = JSON.stringify({
      FromFull: { Email: "no-reply@hire.lever.co", Name: "Initech" }, OriginalRecipient: address, ToFull: [{ Email: address }], Subject: "Thanks for applying to Initech",
      MessageID: "pm-1", TextBody: "We received your application.", Attachments: [{ Name: "cv.pdf", ContentType: "application/pdf", ContentLength: 1234, Content: "JVBER" }],
      Headers: [{ Name: "X-Spam-Status", Value: "No" }],
    });
    const basic = `Basic ${Buffer.from(`inbound:${SECRET}`).toString("base64")}`;
    const pm = await post("postmark", postmark, { contentType: "application/json", sign: false, headers: { authorization: basic } });
    expect(pm).toEqual({ status: 200, json: { stored: true, duplicate: false } });
    expect((await post("postmark", postmark, { contentType: "application/json", sign: false })).status).toBe(401);

    const unknown = await post("generic", JSON.stringify({ from: "x@y.co", to: "nobody@inbox.norinote.local", subject: "hi", text: "hi" }), { contentType: "application/json" });
    expect(unknown).toEqual({ status: 200, json: { stored: false, reason: "unknown_recipient" } });
    expect((await post("generic", "not json", { contentType: "application/json" })).status).toBe(400);
  });

  it("refuses an oversized body", async () => {
    const big = "x".repeat(26 * 1024 * 1024);
    const res = await api.app.request("/api/inbox/webhook/raw", { method: "POST", body: big, headers: { "content-type": "message/rfc822" } });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/inbox and /api/inbox/:id", () => {
  it("lists the user's mail newest first with the linked application, and shows one message to its owner only", async () => {
    const list = await api.call("GET", "/api/inbox", { cookie: a.cookie });
    expect(list.status).toBe(200);
    const times = list.json.map((m: { receivedAt: string }) => m.receivedAt);
    expect([...times].sort().reverse()).toEqual(times);
    const code = list.json.find((m: { code: string | null }) => m.code === "482913");
    expect(code).toMatchObject({ kind: "verification_code", application: { status: "awaiting_code", companyName: "Acme 1", jobTitle: "Software Engineer" }, fromName: "Acme 1 via Greenhouse" });
    const pm = list.json.find((m: { subject: string }) => m.subject === "Thanks for applying to Initech");
    expect(pm).toMatchObject({ kind: "confirmation", attachments: [{ filename: "cv.pdf", contentType: "application/pdf", size: 1234 }], spam: false });
    expect(JSON.stringify(pm)).not.toContain("JVBER");

    const one = await api.call("GET", `/api/inbox/${code.id}`, { cookie: a.cookie });
    expect(one.status).toBe(200);
    expect(one.json).toMatchObject({ id: code.id, code: "482913", classifiedBy: "rules", forwardedAt: null });
    expect((await api.call("GET", `/api/inbox/${code.id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/inbox/not-an-id", { cookie: a.cookie })).status).toBe(404);
    expect((await api.call("GET", `/api/inbox/${code.id}`)).status).toBe(401);
    expect((await api.call("GET", "/api/inbox", { cookie: b.cookie })).json).toEqual([]);
  });
});
