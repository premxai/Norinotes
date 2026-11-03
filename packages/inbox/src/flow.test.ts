import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiUnavailableError, createFakeProvider, setProvider } from "@norinote/ai";
import { applications, companies, eq, inboxMessages, jobs, profiles, users, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { ApplicationStatus, AtsType } from "@norinote/shared";
import {
  assignInboxAddress, awaitVerification, classifyMessage, createStubForwarder, forwardMessage, getInboxSettings, handleInboxReceive,
  linkApplication, purgeExpiredInbox, receiveInbound, settleAmbiguous, signWebhook, smallModel, updateInboxSettings, verifyProviderRequest,
  verifyWebhookSignature, type AppCandidate, type InboxModel,
} from "./index.js";
import { ASHBY_CONFIRMATION, CALENDLY_INTERVIEW, GREENHOUSE_CODE_HTML, NEWSLETTER, ORDER_RECEIPT, WORKDAY_ACCOUNT, genericPayload, withTo } from "./fixtures.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
afterEach(() => setProvider(null));

let n = 0;
async function seedUser(db: Db): Promise<{ userId: string; address: string }> {
  const [u] = await db.insert(users).values({ email: `f${n++}@example.test`, passwordHash: "x" }).returning();
  await db.insert(profiles).values({ userId: u!.id });
  return { userId: u!.id, address: await assignInboxAddress(db, u!.id, "inbox.example.test") };
}

async function seedApp(db: Db, userId: string, company: string, o: { ats?: AtsType; token?: string; title?: string; status?: ApplicationStatus; externalId?: string; domain?: string } = {}): Promise<string> {
  const [c] = await db.insert(companies).values({ atsType: o.ats ?? "greenhouse", atsToken: `${o.token ?? "tok"}-${n++}`, name: company, domain: o.domain ?? null }).returning();
  const [j] = await db.insert(jobs).values({
    companyId: c!.id, atsType: o.ats ?? "greenhouse", externalId: o.externalId ?? `ext${n++}`, title: o.title ?? "Staff Engineer", location: "Remote", remote: true,
    descriptionText: "", applyUrl: `https://boards.greenhouse.io/${c!.atsToken}/jobs/1`, dedupeKey: `k${n++}`,
  }).returning();
  const [a] = await db.insert(applications).values({ userId, jobId: j!.id, status: o.status ?? "submitted" }).returning();
  return a!.id;
}

// ---- signatures -------------------------------------------------------------------------------------------------------

describe("webhook signatures", () => {
  const secret = "whsec-test-0123456789";
  const now = new Date("2026-11-02T12:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = "From: a@b.co\r\nTo: x@inbox.example.test\r\n\r\nhi";

  it("accepts our HMAC, also for bytes and during a secret rotation", () => {
    const sig = signWebhook(body, secret, ts);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(body, { signature: sig, timestamp: String(ts) }, secret, now)).toEqual({ ok: true });
    expect(verifyWebhookSignature(new TextEncoder().encode(body), { signature: sig, timestamp: String(ts) }, secret, now)).toEqual({ ok: true });
    const rotated = `${signWebhook(body, "old-secret", ts)}, ${sig}`;
    expect(verifyWebhookSignature(body, { signature: rotated, timestamp: String(ts) }, secret, now)).toEqual({ ok: true });
  });

  it("refuses a changed body, a wrong secret, an old timestamp, missing headers and an unset secret", () => {
    const sig = signWebhook(body, secret, ts);
    expect(verifyWebhookSignature(`${body}!`, { signature: sig, timestamp: String(ts) }, secret, now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature(body, { signature: signWebhook(body, "nope", ts), timestamp: String(ts) }, secret, now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature(body, { signature: signWebhook(body, secret, ts - 600), timestamp: String(ts - 600) }, secret, now)).toEqual({ ok: false, reason: "stale" });
    expect(verifyWebhookSignature(body, { signature: null, timestamp: String(ts) }, secret, now)).toEqual({ ok: false, reason: "missing" });
    expect(verifyWebhookSignature(body, { signature: sig, timestamp: String(ts) }, "", now)).toEqual({ ok: false, reason: "no_secret" });
    expect(verifyWebhookSignature(body, { signature: "v1=zz", timestamp: String(ts) }, secret, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("checks Postmark by basic auth and the others by HMAC", () => {
    const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
    const basic = `Basic ${Buffer.from(`inbound:${secret}`).toString("base64")}`;
    expect(verifyProviderRequest("postmark", "{}", headers({ authorization: basic }), secret, now)).toEqual({ ok: true });
    expect(verifyProviderRequest("postmark", "{}", headers({ authorization: "Basic eDp5" }), secret, now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyProviderRequest("cloudflare", body, headers({ "x-norinote-signature": signWebhook(body, secret, ts), "x-norinote-timestamp": String(ts) }), secret, now)).toEqual({ ok: true });
    // The basic-auth secret alone is not enough for an HMAC provider.
    expect(verifyProviderRequest("generic", body, headers({ authorization: basic }), secret, now)).toEqual({ ok: false, reason: "missing" });
  });
});

// ---- linking ----------------------------------------------------------------------------------------------------------

describe("linking", () => {
  const cand = (o: Partial<AppCandidate>): AppCandidate => ({
    id: o.id ?? `a${n++}`, status: "submitted", companyName: "Acme", companyDomain: null, atsType: "greenhouse", atsToken: "acme", title: "Engineer",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1", externalId: "1", updatedAt: new Date("2026-10-01"), ...o,
  });

  it("uses the job reference, the careers domain and the board link", () => {
    const a = cand({ id: "ref", companyName: "Globex", externalId: "R-1204", atsType: "workday", atsToken: "globex" });
    const b = cand({ id: "other", companyName: "Globex", externalId: "R-9999", atsType: "workday", atsToken: "globex" });
    expect(linkApplication([a, b], { from: "no-reply@myworkday.com", fromName: "Careers", subject: "Thank you for applying - Analyst (R-1204)", text: "" }, "confirmation"))
      .toMatchObject({ app: { id: "ref" }, ambiguous: false });
    const d = cand({ id: "dom", companyName: "Initrode Holdings", companyDomain: "initrode-careers.com" });
    expect(linkApplication([d], { from: "talent@initrode-careers.com", fromName: "", subject: "Hello", text: "About your application" }, "recruiter_reply").app?.id).toBe("dom");
    const e = cand({ id: "board", companyName: "Pied Piper", atsToken: "piedpiper" });
    expect(linkApplication([e, cand({ companyName: "Hooli", atsToken: "hooli" })], { from: "x@greenhouse-mail.io", fromName: "Greenhouse", subject: "Update", text: "See https://boards.greenhouse.io/piedpiper/jobs/42" }, "other").app?.id).toBe("board");
  });

  it("prefers the application waiting for a code, then the most recent", () => {
    const old = cand({ id: "old", status: "submitted", updatedAt: new Date("2026-09-01") });
    const waiting = cand({ id: "waiting", status: "awaiting_code", updatedAt: new Date("2026-08-01") });
    const mail = { from: "no-reply@greenhouse-mail.io", fromName: "Acme via Greenhouse", subject: "Security code", text: "Your security code is 123456" };
    expect(linkApplication([old, waiting], mail, "verification_code").app?.id).toBe("waiting");
    expect(linkApplication([old, waiting], { ...mail, subject: "Thanks for applying" }, "confirmation").app?.id).toBe("old");
  });

  it("leaves a code unlinked when two waiting applications fit equally, and says so", () => {
    const x = cand({ id: "x", status: "awaiting_code", title: "Backend Engineer" });
    const y = cand({ id: "y", status: "awaiting_code", title: "Data Engineer" });
    const r = linkApplication([x, y], { from: "no-reply@greenhouse-mail.io", fromName: "Acme", subject: "Security code for your application to Acme", text: "Your security code is 123456" }, "verification_code");
    expect(r).toMatchObject({ app: null, ambiguous: true });
    // The job title breaks the tie.
    expect(linkApplication([x, y], { from: "no-reply@greenhouse-mail.io", fromName: "Acme", subject: "Security code: Data Engineer at Acme", text: "Your security code is 123456" }, "verification_code").app?.id).toBe("y");
    // A confirmation is still linked (to the newest), but flagged.
    expect(linkApplication([x, y], { from: "no-reply@greenhouse-mail.io", fromName: "Acme", subject: "Thanks for applying to Acme", text: "" }, "confirmation")).toMatchObject({ ambiguous: true });
  });

  it("links a code mail that names no company to the only waiting application on that ATS", () => {
    const gh = cand({ id: "gh", companyName: "Zeta", status: "awaiting_code" });
    const lever = cand({ id: "lv", companyName: "Eta", status: "awaiting_code", atsType: "lever" });
    const mail = { from: "no-reply@us.greenhouse-mail.io", fromName: "Greenhouse", subject: "Your security code", text: "Your security code is 445566" };
    expect(linkApplication([gh, lever], mail, "verification_code").app?.id).toBe("gh");
    expect(linkApplication([gh, cand({ id: "gh2", companyName: "Theta", status: "applying" })], mail, "verification_code")).toMatchObject({ app: null, ambiguous: true });
  });
});

// ---- storing ----------------------------------------------------------------------------------------------------------

describe("storing the fixture mails", () => {
  it("links each fixture, keeps attachment metadata only and never reads a newsletter or receipt as a code", async () => {
    const { userId, address } = await seedUser(t.db);
    const pied = await seedApp(t.db, userId, "Pied Piper", { status: "awaiting_code", title: "Staff Engineer" });
    const hooli = await seedApp(t.db, userId, "Hooli", { ats: "ashby", token: "hooli", title: "Product Designer" });
    const umbrella = await seedApp(t.db, userId, "Umbrella Corporation", { ats: "workday", token: "umbrella", status: "applying" });

    expect(await receiveInbound(t.db, withTo(GREENHOUSE_CODE_HTML, address))).toMatchObject({ stored: true, applicationId: pied, kind: "verification_code", code: "Xk7Pq2Lm", wake: { applicationId: pied, reason: "code" } });
    const ashby = await receiveInbound(t.db, withTo(ASHBY_CONFIRMATION, address));
    expect(ashby).toMatchObject({ stored: true, applicationId: hooli, kind: "confirmation" });
    if (!ashby.stored) throw new Error("not stored");
    const [row] = await t.db.select().from(inboxMessages).where(eq(inboxMessages.id, ashby.messageId));
    expect(row!.meta).toMatchObject({ attachments: [{ filename: "Ada_Lovelace_Resume.pdf", contentType: "application/pdf" }], fromName: "Hooli Recruiting" });
    expect(row!.body).not.toContain("JVBERi0");
    expect(await receiveInbound(t.db, withTo(WORKDAY_ACCOUNT, address))).toMatchObject({ applicationId: umbrella, kind: "verification_code", code: null, verificationLink: expect.stringContaining("/activate/") });
    expect(await receiveInbound(t.db, withTo(CALENDLY_INTERVIEW, address))).toMatchObject({ applicationId: hooli, kind: "interview", outcome: "interview" });
    expect(await receiveInbound(t.db, withTo(NEWSLETTER, address))).toMatchObject({ kind: "other", code: null, applicationId: null });
    expect(await receiveInbound(t.db, withTo(ORDER_RECEIPT, address))).toMatchObject({ kind: "other", code: null, applicationId: null });
  });

  it("keeps spam but never uses it", async () => {
    const { userId, address } = await seedUser(t.db);
    await seedApp(t.db, userId, "Acme", { status: "awaiting_code" });
    const r = await receiveInbound(t.db, genericPayload(address, { from: "Acme via Greenhouse <no-reply@greenhouse-mail.io>", subject: "Acme security code", text: "Your security code is 778899.", spam: true, messageId: "spam-1" }));
    expect(r).toMatchObject({ stored: true, spam: true, kind: "other", code: null, applicationId: null, wake: null });
    const forged = `From: Acme <hr@acme.com>\r\nTo: ${address}\r\nSubject: Acme security code\r\nMessage-ID: <forged@x>\r\nAuthentication-Results: mx; spf=fail; dkim=none; dmarc=fail\r\n\r\nYour security code is 112233.`;
    expect(await receiveInbound(t.db, forged)).toMatchObject({ stored: true, spam: true, code: null });
  });

  it("refuses an oversized message", async () => {
    expect(await receiveInbound(t.db, "x".repeat(15 * 1024 * 1024 + 1))).toEqual({ stored: false, reason: "too_large" });
  });
});

// ---- the model fallback -----------------------------------------------------------------------------------------------

describe("settling ambiguous mail", () => {
  const mail = { from: "no-reply@greenhouse-mail.io", subject: "Your verification code", text: "Your code is 123456 or your backup code is 654321." };

  it("does not call the model for a clear mail", async () => {
    let calls = 0;
    const model: InboxModel = async () => { calls++; return { kind: "other", code: null }; };
    const clear = classifyMessage({ ...mail, text: "Your code is 123456." });
    expect(await settleAmbiguous(mail, clear, model)).toMatchObject({ code: "123456", classifiedBy: "rules" });
    expect(calls).toBe(0);
  });

  it("takes the model's pick, but only a code that is in the mail", async () => {
    const rules = classifyMessage(mail);
    expect(rules.ambiguous).toBe(true);
    expect(await settleAmbiguous(mail, rules, async () => ({ kind: "verification_code", code: "654321" }))).toMatchObject({ kind: "verification_code", code: "654321", classifiedBy: "model" });
    expect(await settleAmbiguous(mail, rules, async () => ({ kind: "verification_code", code: "999999" }))).toMatchObject({ kind: "other", code: null });
  });

  it("falls back to other when the AI service is unavailable", async () => {
    const rules = classifyMessage(mail);
    const down: InboxModel = async () => { throw new AiUnavailableError("network"); };
    expect(await settleAmbiguous(mail, rules, down)).toMatchObject({ kind: "other", code: null, classifiedBy: "fallback" });
  });

  it("runs the small model through @norinote/ai (fake provider, no network) in the inbox.receive job", async () => {
    const { userId, address } = await seedUser(t.db);
    const app = await seedApp(t.db, userId, "Acme", { status: "awaiting_code" });
    const fake = createFakeProvider({ chat: () => ({ kind: "verification_code", code: "654321" }) });
    setProvider(fake);
    const stored = await receiveInbound(t.db, genericPayload(address, { ...mail, from: "Acme <no-reply@greenhouse-mail.io>", messageId: "amb-1" }));
    expect(stored).toMatchObject({ stored: true, ambiguous: true, code: "123456" });
    if (!stored.stored) throw new Error("not stored");
    expect(await handleInboxReceive(t.db, stored.messageId, { model: smallModel })).toMatchObject({ kind: "verification_code", linked: true, wake: "code" });
    expect(fake.calls).toHaveLength(1);
    const [row] = await t.db.select().from(inboxMessages).where(eq(inboxMessages.id, stored.messageId));
    expect(row).toMatchObject({ code: "654321", applicationId: app, meta: expect.objectContaining({ classifiedBy: "model" }) });
    // Repeating the job does not pay again.
    await handleInboxReceive(t.db, stored.messageId, { model: smallModel });
    expect(fake.calls).toHaveLength(1);
  });
});

// ---- awaitVerification ------------------------------------------------------------------------------------------------

describe("awaitVerification", () => {
  it("resolves with a code that arrives while it waits, and with a link", async () => {
    const { userId, address } = await seedUser(t.db);
    const app = await seedApp(t.db, userId, "Pied Piper", { status: "awaiting_code" });
    const since = new Date();
    const pending = awaitVerification({ db: t.db, applicationId: app, since, timeoutMs: 5000, pollMs: 5000 });
    // Stored in this process, so the waiter wakes at once instead of after its 5 s poll.
    setTimeout(() => { void receiveInbound(t.db, withTo(GREENHOUSE_CODE_HTML, address)); }, 30);
    const started = Date.now();
    expect(await pending).toMatchObject({ type: "code", code: "Xk7Pq2Lm", from: "no-reply@us.greenhouse-mail.io" });
    expect(Date.now() - started).toBeLessThan(3000);

    const wd = await seedApp(t.db, userId, "Umbrella Corporation", { ats: "workday", token: "umbrella", status: "applying" });
    await receiveInbound(t.db, withTo(WORKDAY_ACCOUNT, address));
    expect(await awaitVerification({ db: t.db, applicationId: wd, since, timeoutMs: 100, pollMs: 20 })).toMatchObject({ type: "link", link: expect.stringContaining("/activate/") });
    expect(await awaitVerification({ db: t.db, applicationId: wd, since, timeoutMs: 50, pollMs: 20, accept: "code" })).toBeNull();
  });

  it("times out with null, ignores mail from before `since`, uses a code once and stops on abort", async () => {
    const { userId, address } = await seedUser(t.db);
    const app = await seedApp(t.db, userId, "Pied Piper", { status: "awaiting_code" });
    await receiveInbound(t.db, withTo(GREENHOUSE_CODE_HTML, address), { now: new Date(Date.now() - 10 * 60_000) });
    const started = Date.now();
    expect(await awaitVerification({ db: t.db, applicationId: app, since: new Date(Date.now() - 60_000), timeoutMs: 120, pollMs: 20 })).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);

    const used = new Set<string>();
    await receiveInbound(t.db, genericPayload(address, { from: "Pied Piper <no-reply@greenhouse-mail.io>", subject: "Security code", text: "Your security code is 246810.", messageId: "fresh-1" }));
    const since = new Date(Date.now() - 60_000);
    expect(await awaitVerification({ db: t.db, applicationId: app, since, timeoutMs: 100, pollMs: 20, exclude: used })).toMatchObject({ code: "246810" });
    expect(await awaitVerification({ db: t.db, applicationId: app, since, timeoutMs: 60, pollMs: 20, exclude: used })).toBeNull();

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    expect(await awaitVerification({ db: t.db, applicationId: app, since: new Date(), timeoutMs: 10_000, pollMs: 5000, signal: ctrl.signal })).toBeNull();
    expect(await awaitVerification({ db: t.db, applicationId: "00000000-0000-4000-8000-000000000000", since, timeoutMs: 10 })).toBeNull();
  });

  it("never hands one application's code to another, or an untrusted sender's code", async () => {
    const { userId, address } = await seedUser(t.db);
    const a = await seedApp(t.db, userId, "Alpha", { status: "awaiting_code" });
    const b = await seedApp(t.db, userId, "Beta", { status: "awaiting_code" });
    const since = new Date(Date.now() - 1000);
    // Greenhouse, names no company, two Greenhouse applications waiting: unlinked, and neither may take it.
    await receiveInbound(t.db, genericPayload(address, { from: "no-reply@us.greenhouse-mail.io", subject: "Security code", text: "Your security code is 135790.", messageId: "amb-link" }));
    expect(await awaitVerification({ db: t.db, applicationId: a, since, timeoutMs: 50, pollMs: 20 })).toBeNull();
    expect(await awaitVerification({ db: t.db, applicationId: b, since, timeoutMs: 50, pollMs: 20 })).toBeNull();
    // Someone who only knows the company name.
    await receiveInbound(t.db, genericPayload(address, { from: "hr@alpha-careers-example.net", subject: "Alpha security code", text: "Your Alpha security code is 864200.", messageId: "spoof" }));
    expect(await awaitVerification({ db: t.db, applicationId: a, since, timeoutMs: 50, pollMs: 20 })).toBeNull();
  });
});

// ---- settings, forwarding, retention ------------------------------------------------------------------------------------

describe("settings, forwarding and retention", () => {
  it("stores forwarding settings in the profile and forwards once through the stub, never spam", async () => {
    const { userId, address } = await seedUser(t.db);
    expect(await getInboxSettings(t.db, userId)).toEqual({ forwardTo: null, forwardEnabled: false, retentionDays: null });
    await expect(updateInboxSettings(t.db, userId, { forwardTo: "not-an-email" })).rejects.toThrow(/valid email/);
    await expect(updateInboxSettings(t.db, userId, { forwardTo: address }, { inboundDomain: "inbox.example.test" })).rejects.toThrow(/Norinote inbox/);
    expect(await updateInboxSettings(t.db, userId, { forwardTo: "Ada@Example.com", forwardEnabled: true, retentionDays: 30 })).toEqual({ forwardTo: "ada@example.com", forwardEnabled: true, retentionDays: 30 });
    const [p] = await t.db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p!.preferences).toMatchObject({ inbox: { forwardTo: "ada@example.com", forwardEnabled: true, retentionDays: 30 } });

    const fwd = createStubForwarder();
    const r = await receiveInbound(t.db, withTo(CALENDLY_INTERVIEW, address));
    if (!r.stored) throw new Error("not stored");
    expect(await forwardMessage(t.db, r.messageId, fwd)).toEqual({ forwarded: true });
    expect(await forwardMessage(t.db, r.messageId, fwd)).toEqual({ forwarded: false, reason: "already" });
    expect(fwd.sent).toHaveLength(1);
    expect(fwd.sent[0]).toMatchObject({ to: "ada@example.com", from: address, replyTo: "jordan.park@hooli.com", subject: "Fwd: Next steps - Product Designer at Hooli" });
    const spam = await receiveInbound(t.db, genericPayload(address, { from: "x@spam.example", subject: "Win", text: "Win", spam: true, messageId: "sp-2" }));
    if (!spam.stored) throw new Error("not stored");
    expect(await forwardMessage(t.db, spam.messageId, fwd)).toEqual({ forwarded: false, reason: "spam" });
    await updateInboxSettings(t.db, userId, { forwardEnabled: false });
    const later = await receiveInbound(t.db, withTo(NEWSLETTER, address));
    if (!later.stored) throw new Error("not stored");
    expect(await forwardMessage(t.db, later.messageId, fwd)).toEqual({ forwarded: false, reason: "disabled" });
  });

  it("deletes messages past the default or the user's own retention", async () => {
    const db = await createTestDb();
    try {
      const a = await seedUser(db.db);
      const b = await seedUser(db.db);
      await updateInboxSettings(db.db, b.userId, { retentionDays: 7 });
      const now = new Date("2026-11-02T00:00:00Z");
      const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
      for (const [u, days, id] of [[a, 89, "a89"], [a, 91, "a91"], [b, 6, "b6"], [b, 8, "b8"]] as const) {
        await receiveInbound(db.db, genericPayload(u.address, { messageId: id, subject: id, text: "hello" }), { now: at(days) });
      }
      expect(await purgeExpiredInbox(db.db, { now, defaultDays: 90 })).toBe(2);
      expect((await db.db.select({ s: inboxMessages.subject }).from(inboxMessages)).map((r) => r.s).sort()).toEqual(["a89", "b6"]);
      expect(await purgeExpiredInbox(db.db, { now, defaultDays: 90 })).toBe(0);
    } finally {
      await db.close();
    }
  });
});
