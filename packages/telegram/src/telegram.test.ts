import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, authTokens, channelMessages, channels, companies, eq, jobs, shortlist, users, type Db } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { createBotClient, TelegramApiError } from "./client.js";
import { consumeLinkToken, createLinkToken, channelForChat } from "./link.js";
import { runTelegramTick, recordApplyIntent, type NotifierDeps } from "./notifier.js";
import { SendQueue } from "./sender.js";
import { saveTelegramSettings } from "./settings.js";
import { packId, signCallback, unpackId, verifyCallback, webhookSecret } from "./signing.js";
import { fakeBotApi, type FakeBotApi } from "./testing.js";
import { localClock, quietUntil } from "./time.js";
import { isLegalQuestion } from "./questions.js";

let t: TestDb;
let db: Db;
beforeAll(async () => { t = await createTestDb(); db = t.db; });
afterAll(() => t.close());

let seq = 0;
async function user(email = `u${++seq}@example.com`) {
  const [u] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
  return u!;
}
/** A job posted at `postedAt` (default: the real current time, so it is fresh for tests on the real clock). */
async function job(o: { title?: string; company?: string; closed?: boolean; postedAt?: Date } = {}) {
  seq++;
  const [co] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `tok${seq}`, name: o.company ?? `Company ${seq}` }).returning();
  const [j] = await db.insert(jobs).values({
    companyId: co!.id, atsType: "greenhouse", externalId: `e${seq}`, title: o.title ?? `Engineer ${seq}`, location: "Remote - US", remote: true,
    applyUrl: `https://boards.greenhouse.io/tok${seq}/jobs/${seq}`, dedupeKey: `k${seq}`, closedAt: o.closed ? new Date() : null,
    postedAt: o.postedAt ?? new Date(),
  }).returning();
  return j!;
}
async function link(userId: string, chatId: string, at = new Date("2026-01-01T00:00:00Z")) {
  await db.insert(channels).values({ userId, kind: "telegram", address: chatId, createdAt: at });
}

function deps(fake: FakeBotApi, now: () => Date, extra: Partial<NotifierDeps> = {}): NotifierDeps {
  return {
    db, client: createBotClient({ token: "123:abc", fetch: fake.fetch }), queue: new SendQueue({ perChatIntervalMs: 0, sleep: async () => {} }),
    secret: "test-secret", webUrl: "https://app.test", now, enqueueApply: async () => null, ...extra,
  };
}

describe("callback signing", () => {
  const uid = "6f1c2a6e-9a9b-4f61-9a43-1f5a8f0c9e11";
  it("round-trips, fits in 64 bytes, and rejects forged or foreign data", () => {
    const jobId = "0d3c3a3e-1b2b-4c4d-8e8f-9a0b1c2d3e4f";
    expect(unpackId(packId(jobId))).toBe(jobId);
    const data = signCallback("k", uid, "c", [packId(jobId), 7, 9]);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(verifyCallback("k", uid, data)).toEqual({ op: "c", args: [packId(jobId), "7", "9"] });
    expect(verifyCallback("k", "someone-else", data)).toBeNull();
    expect(verifyCallback("other-key", uid, data)).toBeNull();
    expect(verifyCallback("k", uid, data.replace(".7.", ".8."))).toBeNull();
    expect(verifyCallback("k", uid, "a.xyz")).toBeNull();
    expect(webhookSecret("s", "t")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("send queue", () => {
  it("waits Telegram's retry_after on a 429 and then sends", async () => {
    const fake = fakeBotApi();
    const sleeps: number[] = [];
    const q = new SendQueue({ sleep: async (ms) => { sleeps.push(ms); } });
    const client = createBotClient({ token: "1:a", fetch: fake.fetch });
    fake.failNext("sendMessage", 429, "Too Many Requests: retry after 3", 3);
    const msg = await q.run(42, () => client.sendMessage({ chat_id: 42, text: "hi" }));
    expect(msg.message_id).toBeGreaterThan(0);
    expect(fake.of("sendMessage")).toHaveLength(2);
    expect(sleeps).toContain(3000);
  });

  it("gives up after the retries and spaces messages to one chat", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const q = new SendQueue({ maxRetries: 1, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    const err = new TelegramApiError("sendMessage", 429, 429, "Too Many Requests", 1);
    await expect(q.run(1, async () => { throw err; })).rejects.toBe(err);
    sleeps.length = 0;
    await q.run(2, async () => "a");
    clock += 100;
    await q.run(2, async () => "b");
    expect(sleeps).toEqual([900]);
  });
});

describe("time and quiet hours", () => {
  it("reads the local clock and holds messages until quiet hours end", () => {
    const s = { timezone: "America/New_York", quietHours: { enabled: true, start: "22:00", end: "08:00" } };
    // 03:30 UTC on 2 November is 22:30 in New York (EST).
    const night = new Date("2026-11-02T03:30:00Z");
    expect(localClock(night, s.timezone)).toEqual({ date: "2026-11-01", minutes: 22 * 60 + 30 });
    expect(quietUntil(night, s)?.toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(quietUntil(new Date("2026-11-02T15:00:00Z"), s)).toBeNull();
    expect(quietUntil(night, { ...s, quietHours: { ...s.quietHours, enabled: false } })).toBeNull();
  });
});

describe("linking", () => {
  it("links with a valid token once, refuses a reused or expired one, and moves a chat to its new owner", async () => {
    const a = await user();
    const now = new Date("2026-11-02T10:00:00Z");
    const { code, expiresAt } = await createLinkToken(db, a.id, now);
    expect(code).toMatch(/^[A-Z2-9]{16}$/);
    expect(expiresAt.getTime() - now.getTime()).toBe(15 * 60_000);
    const [stored] = await db.select().from(authTokens).where(eq(authTokens.userId, a.id));
    expect(stored!.tokenHash).not.toContain(code);

    expect(await consumeLinkToken(db, code, "555", now)).toEqual({ ok: true, userId: a.id });
    expect((await channelForChat(db, "555"))?.userId).toBe(a.id);
    expect(await consumeLinkToken(db, code, "555", now)).toEqual({ ok: false, reason: "used" });
    expect(await consumeLinkToken(db, "NOPE2345NOPE2345", "555", now)).toEqual({ ok: false, reason: "invalid" });

    const old = await createLinkToken(db, a.id, now);
    expect(await consumeLinkToken(db, old.code, "556", new Date(now.getTime() + 16 * 60_000))).toEqual({ ok: false, reason: "expired" });

    const b = await user();
    const tb = await createLinkToken(db, b.id, now);
    expect((await consumeLinkToken(db, tb.code, "555", now)).ok).toBe(true);
    expect((await channelForChat(db, "555"))?.userId).toBe(b.id);
    expect(await db.select().from(channels).where(eq(channels.userId, a.id))).toHaveLength(0);
  });
});

describe("daily shortlist", () => {
  it("sends the top new rows once, at the user's local time, and nothing on a day with nothing new", async () => {
    const u = await user();
    await link(u.id, "7001");
    // No daily summary: later tests tick on the real clock, and an evening summary to this chat would take their messages.
    await saveTelegramSettings(db, u.id, { timezone: "Asia/Kolkata", dailyTime: "09:00", count: 2, quietHours: { enabled: false }, events: { summary: false } });
    // Posted within 72 hours of every tick below.
    const postedAt = new Date("2026-11-01T12:00:00Z");
    const best = await job({ title: "Staff Engineer", company: "Acme", postedAt });
    const second = await job({ title: "Backend Engineer", company: "Beta", postedAt });
    const third = await job({ title: "Data Engineer", company: "Gamma", postedAt });
    const widened = await job({ title: "Wide Role", postedAt });
    const closed = await job({ closed: true, postedAt });
    const applied = await job({ postedAt });
    const skipped = await job({ postedAt });
    const stale = await job({ title: "Stale Role", postedAt: new Date("2026-10-29T12:00:00Z") });
    await db.insert(shortlist).values([
      { userId: u.id, jobId: best.id, fit: 0.86, reasons: ["Six years of TypeScript match the core stack"] },
      { userId: u.id, jobId: second.id, fit: 0.7, reasons: ["Postgres and AWS"] },
      { userId: u.id, jobId: third.id, fit: 0.62, reasons: [] },
      { userId: u.id, jobId: widened.id, fit: 0.95, reasons: ["widened:title", "Similar role"] },
      { userId: u.id, jobId: closed.id, fit: 0.99, reasons: [] },
      { userId: u.id, jobId: applied.id, fit: 0.98, reasons: [], status: "applied" },
      { userId: u.id, jobId: skipped.id, fit: 0.97, reasons: [], status: "dismissed" },
      { userId: u.id, jobId: stale.id, fit: 0.99, reasons: [] },
    ]);
    const fake = fakeBotApi();
    let now = new Date("2026-11-02T03:00:00Z"); // 08:30 in Kolkata
    await runTelegramTick(deps(fake, () => now));
    expect(fake.sent()).toHaveLength(0);

    now = new Date("2026-11-02T03:31:00Z"); // 09:01
    await runTelegramTick(deps(fake, () => now));
    const msgs = fake.sent();
    expect(msgs).toHaveLength(1);
    expect(String(msgs[0]!.chat_id)).toBe("7001");
    const text = msgs[0]!.text;
    expect(text.indexOf("Staff Engineer")).toBeLessThan(text.indexOf("Backend Engineer"));
    expect(text).toContain("Strong fit");
    expect(text).toContain("Six years of TypeScript");
    expect(text).not.toContain("Data Engineer");
    expect(text).not.toContain("Wide Role");
    // Posted more than 72 hours before the tick: never sent, however good the fit.
    expect(text).not.toContain("Stale Role");
    const kb = msgs[0]!.reply_markup!.inline_keyboard!;
    expect(kb).toHaveLength(2);
    expect(kb[0]!.map((b) => b.text)).toEqual(["Apply 1", "Skip 1", "Details 1"]);
    expect(kb[0]![2]!.url).toBe(`https://app.test/jobs?job=${best.id}`);

    await runTelegramTick(deps(fake, () => new Date("2026-11-02T05:00:00Z")));
    expect(fake.sent()).toHaveLength(1);

    // Next day: the rows already sent are not sent again; the next best one is.
    await runTelegramTick(deps(fake, () => new Date("2026-11-03T04:00:00Z")));
    expect(fake.sent()).toHaveLength(2);
    expect(fake.lastSent()!.text).toContain("Data Engineer");
    expect(fake.lastSent()!.text).not.toContain("Staff Engineer");

    // A user with nothing new gets nothing, and the day is recorded as looked at.
    const empty = await user();
    await link(empty.id, "7002");
    await runTelegramTick(deps(fake, () => new Date("2026-11-03T10:00:00Z")));
    expect(fake.sent().filter((m) => String(m.chat_id) === "7002")).toHaveLength(0);
    const rows = await db.select().from(channelMessages).where(eq(channelMessages.userId, empty.id));
    expect(rows.find((r) => r.dedupeKey === "digest:2026-11-03")?.status).toBe("skipped");
  });
});

describe("events and quiet hours", () => {
  it("holds a submitted message through quiet hours and sends it after", async () => {
    const u = await user();
    await link(u.id, "7101");
    await saveTelegramSettings(db, u.id, { timezone: "Europe/London", events: { digest: false, summary: false } });
    const j = await job({ title: "Platform Engineer", company: "Delta" });
    const night = new Date("2026-11-02T23:30:00Z");
    await db.insert(applications).values({ userId: u.id, jobId: j.id, status: "submitted", submittedAt: night, receipt: { confirmationText: "Thanks for applying" } });
    const fake = fakeBotApi();
    await runTelegramTick(deps(fake, () => night));
    expect(fake.sent()).toHaveLength(0);
    const [row] = await db.select().from(channelMessages).where(eq(channelMessages.userId, u.id));
    expect(row!.notBefore?.toISOString()).toBe("2026-11-03T08:00:00.000Z");

    await runTelegramTick(deps(fake, () => new Date("2026-11-03T08:01:00Z")));
    expect(fake.sent()).toHaveLength(1);
    expect(fake.lastSent()!.text).toContain("Platform Engineer");
    expect(fake.lastSent()!.text).toContain("Thanks for applying");
    expect(fake.lastSent()!.reply_markup!.inline_keyboard![0]![0]!.text).toBe("Receipt");
  });

  it("unlinks a chat that blocked the bot", async () => {
    const u = await user();
    await link(u.id, "7201");
    await saveTelegramSettings(db, u.id, { quietHours: { enabled: false }, events: { digest: false, summary: false } });
    const j = await job();
    await db.insert(applications).values({ userId: u.id, jobId: j.id, status: "needs_user", error: "The site showed a captcha.", approvedAt: new Date() });
    const fake = fakeBotApi();
    fake.failNext("sendMessage", 403, "Forbidden: bot was blocked by the user");
    await runTelegramTick(deps(fake, () => new Date()));
    expect(await channelForChat(db, "7201")).toBeNull();
  });
});

describe("apply intents", () => {
  it("starts an application approved from Telegram once it is prepared", async () => {
    const u = await user();
    const j = await job();
    const [app] = await db.insert(applications).values({ userId: u.id, jobId: j.id, status: "preparing", approvedAt: new Date() }).returning();
    await recordApplyIntent(db, u.id, app!.id, new Date());
    const started: string[] = [];
    const fake = fakeBotApi();
    const d = deps(fake, () => new Date(), { enqueueApply: async (id) => { started.push(id); } });
    await runTelegramTick(d);
    expect(started).toEqual([]);
    await db.update(applications).set({ status: "prepared" }).where(eq(applications.id, app!.id));
    await runTelegramTick(d);
    expect(started).toEqual([app!.id]);
    const [after] = await db.select().from(applications).where(eq(applications.id, app!.id));
    expect(after!.status).toBe("applying");
    await runTelegramTick(d);
    expect(started).toHaveLength(1);
  });
});

describe("legal questions", () => {
  it("recognises work authorisation, sponsorship and salary", () => {
    expect(isLegalQuestion({ text: "Will you now or in the future require visa sponsorship?", type: "select", options: ["Yes", "No"] })).toBe(true);
    expect(isLegalQuestion({ text: "Are you legally authorized to work in the United States?", type: "boolean", options: [] })).toBe(true);
    expect(isLegalQuestion({ text: "What are your salary expectations?", type: "text", options: [] })).toBe(true);
    expect(isLegalQuestion({ text: "Which team interests you most?", type: "select", options: ["Infra", "Product"] })).toBe(false);
  });
});

