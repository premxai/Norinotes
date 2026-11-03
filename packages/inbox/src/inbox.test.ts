import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, applications, companies, eq, inboxAddresses, inboxMessages, jobs, outcomes, users, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { ApplicationStatus } from "@norinote/shared";
import {
  assignInboxAddress, classifyMessage, createCodeWaiter, extractCode, extractLinks, receiveInbound, reprocessMessage, verifyInboundSecret,
} from "./index.js";
import {
  FAKE_REJECTION, GREENHOUSE_CODE, GREENHOUSE_CONFIRMATION, INTERVIEW, LEVER_CODE, LEVER_CONFIRMATION, RECRUITER_REPLY, REJECTION,
  WORKDAY_CONFIRMATION, WORKDAY_VERIFY, genericPayload, postmarkPayload, withTo,
} from "./fixtures.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let n = 0;
async function seedUser(db: Db): Promise<{ userId: string; address: string }> {
  const [u] = await db.insert(users).values({ email: `u${n++}@example.test`, passwordHash: "x" }).returning();
  const address = await assignInboxAddress(db, u!.id, "inbox.example.test");
  return { userId: u!.id, address };
}

async function seedApplication(db: Db, userId: string, company: string, opts: { title?: string; status?: ApplicationStatus; applyUrl?: string } = {}): Promise<string> {
  const [c] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `tok${n++}`, name: company }).returning();
  const [j] = await db.insert(jobs).values({
    companyId: c!.id, atsType: "greenhouse", externalId: `ext${n++}`, title: opts.title ?? "Senior Backend Engineer", location: "Remote", remote: true,
    descriptionText: "", applyUrl: opts.applyUrl ?? "https://boards.greenhouse.io/x/jobs/1", dedupeKey: `k${n++}`,
  }).returning();
  const [a] = await db.insert(applications).values({ userId, jobId: j!.id, status: opts.status ?? "submitted" }).returning();
  return a!.id;
}

describe("extractCode", () => {
  it("reads numeric, split and alphanumeric codes next to the word code", () => {
    expect(extractCode("Your verification code is 482913. It expires soon.")).toBe("482913");
    expect(extractCode("Security code: 1234")).toBe("1234");
    expect(extractCode("Your code is 123-456")).toBe("123456");
    expect(extractCode("482913 is your verification code")).toBe("482913");
    expect(extractCode("Copy and paste this code into the first field of your application:\n\naB3dE9xK\n\nThanks")).toBe("aB3dE9xK");
  });
  it("skips years and returns null when there is nothing", () => {
    expect(extractCode("Your code was sent in 2026. Use 998877 to sign in.")).toBe("998877");
    expect(extractCode("No digits here")).toBeNull();
  });
});

describe("extractLinks", () => {
  it("puts verification links first and drops unsubscribe and image links", () => {
    const links = extractLinks("See https://acme.example/careers, then https://x.test/verify?token=abc. https://x.test/unsubscribe https://x.test/logo.png");
    expect(links).toEqual(["https://x.test/verify?token=abc", "https://acme.example/careers"]);
  });
});

describe("classifyMessage", () => {
  const c = (raw: string, from: string, subject: string) => classifyMessage({ from, subject, text: raw });
  it("recognises the sample mails", () => {
    expect(c("Copy and paste this code into the first field of your application:\n\naB3dE9xK\n", "no-reply@us.greenhouse-mail.io", "Security code for your application to Acme"))
      .toMatchObject({ kind: "verification_code", code: "aB3dE9xK" });
    expect(c("Your verification code is 482913.", "no-reply@hire.lever.co", "Your Initech verification code")).toMatchObject({ kind: "verification_code", code: "482913" });
    expect(c("Please verify your account by clicking the link below:\nhttps://wd5.myworkdaysite.com/x/verify?token=7f3a", "g@myworkday.com", "Verify your email address"))
      .toMatchObject({ kind: "verification_code", code: null, magicLink: "https://wd5.myworkdaysite.com/x/verify?token=7f3a" });
    expect(c("We have received your application. A recruiter will reach out to schedule an interview.", "g@myworkday.com", "Thank you for applying - Data Analyst")).toMatchObject({ kind: "confirmation" });
    expect(c("Unfortunately we have decided not to move forward.", "recruiting@acme.com", "Your application")).toMatchObject({ kind: "rejection" });
    expect(c("We are pleased to offer you the position. Offer letter attached.", "hr@acme.com", "Offer")).toMatchObject({ kind: "offer" });
    expect(c("Could you share your availability this week?", "p@acme.com", "Interview with Acme")).toMatchObject({ kind: "interview" });
    expect(c("I'm on the hiring team and saw your application for the role.", "sam@initech.com", "Quick question")).toMatchObject({ kind: "recruiter_reply" });
    expect(c("Your invoice is ready.", "billing@shop.example", "Invoice 22")).toMatchObject({ kind: "other" });
  });
});

describe("assignInboxAddress", () => {
  it("gives each user one random, stable address", async () => {
    const a = await seedUser(t.db);
    const b = await seedUser(t.db);
    expect(a.address).toMatch(/^nori-[a-z0-9]{10}@inbox\.example\.test$/);
    expect(await assignInboxAddress(t.db, a.userId, "inbox.example.test")).toBe(a.address);
    expect(b.address).not.toBe(a.address);
    const rows = await t.db.select().from(inboxAddresses).where(eq(inboxAddresses.userId, a.userId));
    expect(rows).toHaveLength(1);
  });
  it("is safe when called twice at once and rejects a bad domain", async () => {
    const [u] = await t.db.insert(users).values({ email: `race${n++}@example.test`, passwordHash: "x" }).returning();
    const [x, y] = await Promise.all([assignInboxAddress(t.db, u!.id, "inbox.example.test"), assignInboxAddress(t.db, u!.id, "inbox.example.test")]);
    expect(x).toBe(y);
    await expect(assignInboxAddress(t.db, u!.id, "not a domain")).rejects.toThrow(/Invalid/);
  });
});

describe("receiveInbound: raw MIME", () => {
  it("stores a Greenhouse code mail, links it to the application waiting for it and says to wake it", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Acme Robotics", { status: "awaiting_code" });
    await seedApplication(t.db, userId, "Globex Corporation", { status: "awaiting_code" });
    const r = await receiveInbound(t.db, withTo(GREENHOUSE_CODE, address));
    expect(r).toMatchObject({ stored: true, duplicate: false, userId, applicationId: appId, kind: "verification_code", code: "aB3dE9xK", wake: { applicationId: appId, reason: "code" } });
    if (!r.stored) throw new Error("not stored");
    const [row] = await t.db.select().from(inboxMessages).where(eq(inboxMessages.id, r.messageId));
    expect(row).toMatchObject({ userId, applicationId: appId, kind: "verification_code", code: "aB3dE9xK", fromAddress: "no-reply@us.greenhouse-mail.io", messageId: "<gh-code-1@us.greenhouse-mail.io>" });
    expect(row?.subject).toContain("Security code");
  });

  it("stores a Workday verify-by-link mail with its magic link and no code", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Globex Corporation", { status: "applying" });
    const r = await receiveInbound(t.db, withTo(WORKDAY_VERIFY, address));
    expect(r).toMatchObject({ stored: true, kind: "verification_code", code: null, applicationId: appId });
    if (!r.stored) throw new Error("not stored");
    expect(r.links[0]).toBe("https://wd5.myworkdaysite.com/en-US/globex/verify?token=7f3a9c1e&email=nori-test");
    expect(r.links.some((l) => l.includes("unsubscribe"))).toBe(false);
    expect(r.verificationLink).toBe("https://wd5.myworkdaysite.com/en-US/globex/verify?token=7f3a9c1e&email=nori-test");
    // The ATS display name names the company, so the waiting application is woken with the link.
    expect(r.wake).toEqual({ applicationId: appId, reason: "code" });
  });

  it("links confirmations to the right application for Greenhouse (HTML), Workday and Lever, without waking anything", async () => {
    const { userId, address } = await seedUser(t.db);
    const acme = await seedApplication(t.db, userId, "Acme Robotics");
    const globex = await seedApplication(t.db, userId, "Globex Corporation", { title: "Data Analyst" });
    const initech = await seedApplication(t.db, userId, "Initech", { title: "Platform Engineer" });
    const gh = await receiveInbound(t.db, withTo(GREENHOUSE_CONFIRMATION, address));
    const wd = await receiveInbound(t.db, withTo(WORKDAY_CONFIRMATION, address));
    const lv = await receiveInbound(t.db, withTo(LEVER_CONFIRMATION, address));
    expect(gh).toMatchObject({ stored: true, kind: "confirmation", applicationId: acme, wake: null, outcome: null });
    expect(wd).toMatchObject({ stored: true, kind: "confirmation", applicationId: globex });
    expect(lv).toMatchObject({ stored: true, kind: "confirmation", applicationId: initech });
  });

  it("reads a Lever code mail and links it by the ATS display name", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Initech", { status: "awaiting_code" });
    const r = await receiveInbound(t.db, withTo(LEVER_CODE, address));
    expect(r).toMatchObject({ stored: true, kind: "verification_code", code: "482913", applicationId: appId, wake: { reason: "code" } });
  });

  it("records an outcome for replies the company itself sent, and ignores look-alikes", async () => {
    const { userId, address } = await seedUser(t.db);
    const acme = await seedApplication(t.db, userId, "Acme Robotics");
    const initech = await seedApplication(t.db, userId, "Initech", { title: "Platform Engineer" });

    const fake = await receiveInbound(t.db, withTo(FAKE_REJECTION, address));
    expect(fake).toMatchObject({ stored: true, kind: "rejection", applicationId: acme, outcome: null, wake: null });
    expect(await t.db.select().from(outcomes).where(eq(outcomes.applicationId, acme))).toHaveLength(0);

    const rejection = await receiveInbound(t.db, withTo(REJECTION, address));
    expect(rejection).toMatchObject({ stored: true, kind: "rejection", applicationId: acme, outcome: "rejection", wake: { applicationId: acme, reason: "outcome" } });
    const interview = await receiveInbound(t.db, withTo(INTERVIEW, address));
    expect(interview).toMatchObject({ stored: true, kind: "interview", applicationId: acme, outcome: "interview" });
    const reply = await receiveInbound(t.db, withTo(RECRUITER_REPLY, address));
    expect(reply).toMatchObject({ stored: true, kind: "recruiter_reply", applicationId: initech, outcome: "recruiter_reply" });
    expect((await t.db.select().from(outcomes).where(eq(outcomes.applicationId, acme))).map((o) => o.kind).sort()).toEqual(["interview", "rejection"]);
    expect((await t.db.select().from(outcomes).where(eq(outcomes.applicationId, initech))).map((o) => o.kind)).toEqual(["reply"]);
  });

  it("drops mail for an unknown recipient and stores a retried Message-ID once", async () => {
    const { userId, address } = await seedUser(t.db);
    expect(await receiveInbound(t.db, withTo(LEVER_CODE, "nobody@inbox.example.test"))).toEqual({ stored: false, reason: "unknown_recipient" });
    const first = await receiveInbound(t.db, withTo(LEVER_CONFIRMATION, address));
    const again = await receiveInbound(t.db, withTo(LEVER_CONFIRMATION, address));
    expect(first).toMatchObject({ stored: true, duplicate: false });
    expect(again).toMatchObject({ stored: true, duplicate: true });
    if (!first.stored || !again.stored) throw new Error("not stored");
    expect(again.messageId).toBe(first.messageId);
    expect(await t.db.select().from(inboxMessages).where(and(eq(inboxMessages.userId, userId), eq(inboxMessages.messageId, "<lever-confirm-1@hire.lever.co>")))).toHaveLength(1);
  });
});

describe("receiveInbound: provider JSON", () => {
  it("accepts a Postmark inbound payload", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Initech", { status: "awaiting_code" });
    const r = await receiveInbound(t.db, postmarkPayload(address));
    expect(r).toMatchObject({ stored: true, userId, kind: "verification_code", code: "731942", applicationId: appId, wake: { reason: "code" } });
  });

  it("accepts a generic payload, also by plus-address and with a raw wrapper", async () => {
    const { userId, address } = await seedUser(t.db);
    const [local, domain] = address.split("@");
    const plus = `${local}+greenhouse@${domain}`;
    expect(await receiveInbound(t.db, genericPayload(plus))).toMatchObject({ stored: true, userId, kind: "verification_code", code: "905511" });
    const wrapped = await receiveInbound(t.db, { raw: withTo(LEVER_CONFIRMATION, address) });
    expect(wrapped).toMatchObject({ stored: true, userId, kind: "confirmation" });
    expect(await receiveInbound(t.db, { nonsense: true })).toEqual({ stored: false, reason: "unreadable" });
  });
});

describe("reprocessMessage", () => {
  it("links a message to an application created after it arrived, and is safe to repeat", async () => {
    const { userId, address } = await seedUser(t.db);
    const first = await receiveInbound(t.db, withTo(REJECTION, address));
    if (!first.stored) throw new Error("not stored");
    expect(first.applicationId).toBeNull();
    const appId = await seedApplication(t.db, userId, "Acme Robotics");
    const again = await reprocessMessage(t.db, first.messageId);
    expect(again).toMatchObject({ stored: true, applicationId: appId, kind: "rejection", outcome: "rejection", wake: { applicationId: appId, reason: "outcome" } });
    const third = await reprocessMessage(t.db, first.messageId);
    expect(third).toMatchObject({ applicationId: appId, outcome: "rejection" });
    expect(await t.db.select().from(outcomes).where(eq(outcomes.applicationId, appId))).toHaveLength(1);
    expect(await reprocessMessage(t.db, "00000000-0000-4000-8000-000000000000")).toEqual({ stored: false, reason: "unreadable" });
  });
});

describe("createCodeWaiter", () => {
  it("returns a code that arrives while it polls, and uses each code once", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Initech", { status: "awaiting_code" });
    const waiter = createCodeWaiter(t.db, { intervalMs: 10 });
    const pending = waiter.waitForCode(appId, { hint: "lever", timeoutMs: 5000 });
    setTimeout(() => { void receiveInbound(t.db, withTo(LEVER_CODE, address)); }, 60);
    expect(await pending).toBe("482913");
    // The same mail is not handed out again; a newer one is.
    expect(await waiter.waitForCode(appId, { hint: "lever", timeoutMs: 50 })).toBeNull();
    await receiveInbound(t.db, postmarkPayload(address, { MessageID: "pm-newer", TextBody: "Your verification code is 111222." }));
    expect(await waiter.waitForCode(appId, { hint: "lever", timeoutMs: 1000 })).toBe("111222");
  });

  it("times out with null, and never returns another application's code or a stale one", async () => {
    const { userId, address } = await seedUser(t.db);
    const mine = await seedApplication(t.db, userId, "Acme Robotics", { status: "awaiting_code" });
    await seedApplication(t.db, userId, "Initech", { status: "awaiting_code" });
    await receiveInbound(t.db, withTo(LEVER_CODE, address)); // belongs to Initech
    const waiter = createCodeWaiter(t.db, { intervalMs: 10 });
    expect(await waiter.waitForCode(mine, { hint: "greenhouse", timeoutMs: 80 })).toBeNull();

    // A code that arrived long before the wait is stale.
    const old = new Date(Date.now() - 60 * 60_000);
    await receiveInbound(t.db, withTo(GREENHOUSE_CODE, address), { now: old });
    expect(await waiter.waitForCode(mine, { hint: "greenhouse", timeoutMs: 50 })).toBeNull();
    expect(await waiter.waitForCode("00000000-0000-4000-8000-000000000000", { hint: "x", timeoutMs: 10 })).toBeNull();
  });

  it("accepts an unlinked code only from the job's own system", async () => {
    const { userId, address } = await seedUser(t.db);
    const appId = await seedApplication(t.db, userId, "Hooli", { status: "awaiting_code" });
    const waiter = createCodeWaiter(t.db, { intervalMs: 10 });
    // A stranger's code mail is never used.
    await receiveInbound(t.db, genericPayload(address, { from: "x@random-example.net", text: "Your security code is 123987.", messageId: "unlinked-2", subject: "Security code" }));
    expect(await waiter.waitForCode(appId, { hint: "greenhouse", timeoutMs: 50 })).toBeNull();
    // Not naming the company, but sent by Greenhouse, and Hooli's job is on Greenhouse: linked as the only waiting one.
    await receiveInbound(t.db, genericPayload(address, { from: "Jobs <no-reply@us.greenhouse-mail.io>", text: "Your security code is 664422.", messageId: "unlinked-1", subject: "Security code" }));
    expect(await waiter.waitForCode(appId, { hint: "greenhouse", timeoutMs: 200 })).toBe("664422");
  });
});

describe("verifyInboundSecret", () => {
  it("accepts the bare secret, Bearer and basic auth, and rejects everything else", () => {
    const basic = `Basic ${Buffer.from("postmark:s3cret-value").toString("base64")}`;
    expect(verifyInboundSecret("s3cret-value", "s3cret-value")).toBe(true);
    expect(verifyInboundSecret("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(verifyInboundSecret(basic, "s3cret-value")).toBe(true);
    expect(verifyInboundSecret("wrong", "s3cret-value")).toBe(false);
    expect(verifyInboundSecret("s3cret-value ", "s3cret-valuf")).toBe(false);
    expect(verifyInboundSecret(null, "s3cret-value")).toBe(false);
    expect(verifyInboundSecret("anything", "")).toBe(false);
    expect(verifyInboundSecret("", "")).toBe(false);
    expect(verifyInboundSecret("anything", undefined)).toBe(false);
  });
});
