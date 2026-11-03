import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, channelMessages, channels, eq, shortlist } from "@norinote/db";
import { createBotClient, packId, runTelegramTick, SendQueue, signCallback, webhookSecret, type NotifierDeps } from "@norinote/telegram";
import { callbackUpdate, fakeBotApi, textUpdate } from "@norinote/telegram/testing";
import { makeApi, seedJob, seedShortlist, type Api } from "./testkit.js";

const TOKEN = "123:abc";
const fake = fakeBotApi();
let api: Api;
let secret: string;

beforeAll(async () => {
  api = await makeApi({ config: { telegramBotToken: TOKEN, telegramBotUsername: "NorinoteBot" }, telegram: { fetch: fake.fetch, perChatIntervalMs: 0 } });
  secret = webhookSecret(api.config.sessionSecret!, TOKEN);
});
afterAll(() => api.close());

const hook = (update: unknown, token: string | null = secret) =>
  api.call("POST", "/api/channels/telegram/webhook", { body: update, headers: token === null ? {} : { "x-telegram-bot-api-secret-token": token } });

/** Signs up, links `chatId` through the deep-link flow, and returns the session. */
async function linked(email: string, chatId: number) {
  const s = await api.signup(email);
  const res = await api.call("POST", "/api/channels/telegram/link", { cookie: s.cookie, body: {} });
  expect((await hook(textUpdate(chatId, `/start ${res.json.code}`))).status).toBe(200);
  return s;
}

function notifier(now = () => new Date()): NotifierDeps {
  return {
    db: api.db, client: createBotClient({ token: TOKEN, fetch: fake.fetch }), queue: new SendQueue({ perChatIntervalMs: 0, sleep: async () => {} }),
    secret: api.config.sessionSecret!, webUrl: api.config.webUrl, now, enqueueApply: async () => null,
  };
}

const lastAnswer = () => fake.of("answerCallbackQuery").at(-1)!.params as { text?: string };
const lastEdit = () => fake.of("editMessageReplyMarkup").at(-1)!.params as { reply_markup: { inline_keyboard: { text: string; callback_data?: string }[][] } };

describe("webhook", () => {
  it("checks Telegram's secret_token header", async () => {
    expect((await hook(textUpdate(1, "hi"), null)).status).toBe(401);
    expect((await hook(textUpdate(1, "hi"), "wrong")).status).toBe(401);
    expect((await hook(textUpdate(1, "hi"))).status).toBe(200);
  });

  it("answers an unknown chat with a short connect hint and nothing else", async () => {
    fake.clear();
    await hook(textUpdate(9999, "hello"));
    expect(fake.sent()).toHaveLength(1);
    expect(fake.lastSent()!.text).toMatch(/not connected to Norinote/);
  });
});

describe("settings and linking", () => {
  it("returns defaults, saves a valid patch and refuses a bad one", async () => {
    const s = await api.signup("tg-settings@example.com");
    const first = await api.call("GET", "/api/channels/telegram", { cookie: s.cookie });
    expect(first.json).toMatchObject({ configured: true, botUsername: "NorinoteBot", linked: false, linkedAt: null });
    expect(first.json.settings).toMatchObject({ dailyTime: "09:00", timezone: "UTC", count: 5, quietHours: { enabled: true, start: "22:00", end: "08:00" } });

    const put = await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { dailyTime: "07:30", timezone: "Europe/Berlin", count: 3, quietHours: { start: "23:00" }, events: { summary: false } } });
    expect(put.status).toBe(200);
    expect(put.json.settings).toMatchObject({ dailyTime: "07:30", timezone: "Europe/Berlin", count: 3, quietHours: { enabled: true, start: "23:00", end: "08:00" }, events: { summary: false, digest: true } });
    expect((await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { timezone: "Mars/Olympus" } })).status).toBe(400);
    expect((await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { dailyTime: "25:00" } })).status).toBe(400);
    // Kept out of the user-facing profile preferences.
    const me = await api.call("GET", "/api/me", { cookie: s.cookie });
    expect(JSON.stringify(me.json)).not.toContain("Europe/Berlin");
  });

  it("links with a one-time deep link, refuses it again, and unlinks with /stop and DELETE", async () => {
    const s = await api.signup("tg-link@example.com");
    const link = await api.call("POST", "/api/channels/telegram/link", { cookie: s.cookie, body: { timezone: "America/Chicago" } });
    expect(link.status).toBe(200);
    expect(link.json.link).toBe(`https://t.me/NorinoteBot?start=${link.json.code}`);
    expect((await api.call("GET", "/api/channels/telegram", { cookie: s.cookie })).json.settings.timezone).toBe("America/Chicago");

    fake.clear();
    await hook(textUpdate(4242, `/start ${link.json.code}`));
    expect(fake.lastSent()!.text).toContain("Connected");
    expect(fake.lastSent()!.text).toContain("America/Chicago");
    const state = await api.call("GET", "/api/channels/telegram", { cookie: s.cookie });
    expect(state.json.linked).toBe(true);

    await hook(textUpdate(4343, `/start ${link.json.code}`));
    expect(fake.lastSent()!.text).toMatch(/already used/);

    await hook(textUpdate(4242, "/stop"));
    expect(fake.lastSent()!.text).toMatch(/Disconnected/);
    expect((await api.call("GET", "/api/channels/telegram", { cookie: s.cookie })).json.linked).toBe(false);

    const again = await api.call("POST", "/api/channels/telegram/link", { cookie: s.cookie, body: {} });
    await hook(textUpdate(4242, `/start ${again.json.code}`));
    expect((await api.call("DELETE", "/api/channels/telegram", { cookie: s.cookie })).json).toEqual({ ok: true, linked: false });
    expect(await api.db.select().from(channels).where(eq(channels.userId, s.user.id))).toHaveLength(0);
  });
});

describe("daily shortlist buttons", () => {
  it("Apply queues the application as approved, Skip dismisses, Details links to the app; a forged button does nothing", async () => {
    const s = await linked("tg-digest@example.com", 5001);
    await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { dailyTime: "00:00", quietHours: { enabled: false }, events: { summary: false } } });
    const a = await seedJob(api.db, { title: "Staff Engineer", company: "Acme" });
    const b = await seedJob(api.db, { title: "Backend Engineer", company: "Beta" });
    await seedShortlist(api.db, s.user.id, a.job.id, 0.88);
    await seedShortlist(api.db, s.user.id, b.job.id, 0.7);

    fake.clear();
    await runTelegramTick(notifier());
    const digest = fake.lastSent()!;
    expect(digest.text).toContain("Staff Engineer");
    const kb = digest.reply_markup!.inline_keyboard!;
    expect(kb[0]![2]!.url).toBe(`${api.config.webUrl}/jobs?job=${a.job.id}`);
    const [row] = await api.db.select().from(channelMessages).where(eq(channelMessages.dedupeKey, `digest:${new Date().toISOString().slice(0, 10)}`));
    const messageId = row!.telegramMessageId!;

    // Someone else's chat pressing this user's button: nothing happens.
    await linked("tg-other@example.com", 5002);
    await hook(callbackUpdate(5002, messageId, kb[0]![0]!.callback_data!));
    expect(lastAnswer().text).toBeUndefined();
    // A tampered signature: nothing happens either.
    await hook(callbackUpdate(5001, messageId, `${kb[0]![0]!.callback_data!.slice(0, -2)}xx`));
    expect(lastAnswer().text).toBeUndefined();
    expect(await api.db.select().from(applications).where(eq(applications.userId, s.user.id))).toHaveLength(0);

    await hook(callbackUpdate(5001, messageId, kb[0]![0]!.callback_data!));
    expect(lastAnswer().text).toMatch(/Preparing Staff Engineer at Acme/);
    const [app] = await api.db.select().from(applications).where(eq(applications.userId, s.user.id));
    expect(app!.approvedAt).not.toBeNull();
    expect(api.queuedOf("prepare.application").some((q) => q.payload.applicationId === app!.id)).toBe(true);
    const intents = await api.db.select().from(channelMessages).where(eq(channelMessages.dedupeKey, `apply:${app!.id}`));
    expect(intents[0]!.status).toBe("pending");
    expect(lastEdit().reply_markup.inline_keyboard.map((r) => r[0]!.text)).toEqual(["Apply 2"]);

    await hook(callbackUpdate(5001, messageId, kb[1]![1]!.callback_data!));
    expect(lastAnswer().text).toBe("Skipped.");
    const [sl] = await api.db.select().from(shortlist).where(eq(shortlist.jobId, b.job.id));
    expect(sl!.status).toBe("dismissed");
    expect(lastEdit().reply_markup.inline_keyboard).toEqual([]);

    // Apply on a job whose application is already prepared approves it and starts the browser step, as the web click does.
    const c = await seedJob(api.db, { title: "Platform Engineer", company: "Gamma" });
    await api.db.insert(applications).values({ userId: s.user.id, jobId: c.job.id, status: "prepared" });
    await hook(callbackUpdate(5001, 1, signCallback(api.config.sessionSecret!, s.user.id, "a", [packId(c.job.id)])));
    expect(lastAnswer().text).toMatch(/Applying to Platform Engineer/);
    expect(api.queuedOf("apply.run").length).toBeGreaterThan(0);
  });
});

describe("pending questions", () => {
  it("asks legal choice questions with only their own options, takes taps and text replies through the answer path", async () => {
    const s = await linked("tg-questions@example.com", 6001);
    await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { quietHours: { enabled: false }, events: { digest: false, summary: false } } });
    const j = await seedJob(api.db, { title: "Data Engineer", company: "Delta" });
    const [app] = await api.db.insert(applications).values({
      userId: s.user.id, jobId: j.job.id, status: "needs_user", approvedAt: new Date(), error: "2 questions need your answer",
      pendingQuestions: [
        { id: "q_sponsor", text: "Will you now or in the future require visa sponsorship?", type: "select", options: ["Yes, I will", "No, I will not"], required: true },
        { id: "q_why", text: "Why do you want to work at Delta?", type: "textarea", options: [], required: true },
      ],
    }).returning();

    fake.clear();
    await runTelegramTick(notifier());
    const q = fake.lastSent()!;
    expect(q.text).toContain("visa sponsorship");
    const buttons = q.reply_markup!.inline_keyboard!.flat();
    // Groups come in the answers package's order; find the sponsorship one by its options.
    const n = buttons.find((b) => b.text.endsWith(": Yes, I will"))!.text.split(":")[0]!;
    const w = n === "1" ? "2" : "1";
    expect(buttons.filter((b) => b.text.startsWith(`${n}:`)).map((b) => b.text)).toEqual([`${n}: Yes, I will`, `${n}: No, I will not`]);
    expect(buttons.map((b) => b.text)).toContain(`Type answer ${w}`);
    const [row] = await api.db.select().from(channelMessages).where(eq(channelMessages.kind, "questions"));
    const messageId = row!.telegramMessageId!;

    await hook(callbackUpdate(6001, messageId, buttons.find((b) => b.text === `${n}: No, I will not`)!.callback_data!));
    expect(lastAnswer().text).toMatch(/Saved: No, I will not/);
    let [after] = await api.db.select().from(applications).where(eq(applications.id, app!.id));
    expect(after!.answers.q_sponsor).toBe("No, I will not");
    expect(after!.status).toBe("needs_user");
    expect(lastEdit().reply_markup.inline_keyboard.flat().map((b) => b.text)).toEqual([`Type answer ${w}`]);

    // The other question is still open on the same message: the next tick does not ask it again.
    const before = fake.sent().length;
    await runTelegramTick(notifier());
    expect(fake.sent()).toHaveLength(before);

    await hook(callbackUpdate(6001, messageId, buttons.find((b) => b.text === `Type answer ${w}`)!.callback_data!));
    const prompt = fake.lastSent()!;
    expect(prompt.reply_markup!.force_reply).toBe(true);
    const promptRow = (await api.db.select().from(channelMessages).where(eq(channelMessages.kind, "prompt")))[0]!;

    await hook(textUpdate(6001, "Your data platform work is exactly what I have built for five years.", { replyTo: promptRow.telegramMessageId! }));
    [after] = await api.db.select().from(applications).where(eq(applications.id, app!.id));
    expect(after!.answers.q_why).toMatch(/data platform work/);
    expect(after!.status).toBe("applying");
    expect(api.queuedOf("apply.run").some((x) => x.payload.applicationId === app!.id)).toBe(true);
    expect(fake.lastSent()!.text).toContain(`Saved answer ${w}. An application carried on`);

    // A second set: replying to the questions message itself answers its first text question.
    const k = await seedJob(api.db, { title: "ML Engineer", company: "Epsilon" });
    const [app2] = await api.db.insert(applications).values({
      userId: s.user.id, jobId: k.job.id, status: "needs_user", pendingQuestions: [{ id: "q_note", text: "Anything else we should know?", type: "text", options: [], required: true }],
    }).returning();
    await runTelegramTick(notifier());
    const rows = await api.db.select().from(channelMessages).where(eq(channelMessages.kind, "questions"));
    const second = rows.find((r) => r.id !== row!.id)!;
    await hook(textUpdate(6001, "Available from January.", { replyTo: second.telegramMessageId! }));
    const [done2] = await api.db.select().from(applications).where(eq(applications.id, app2!.id));
    expect(done2!.answers.q_note).toBe("Available from January.");
  });

  it("does not offer Yes/No on a legal yes/no question that lists no options", async () => {
    const s = await linked("tg-legal@example.com", 6101);
    await api.call("PUT", "/api/channels/telegram", { cookie: s.cookie, body: { quietHours: { enabled: false }, events: { digest: false, summary: false } } });
    const j = await seedJob(api.db);
    await api.db.insert(applications).values({
      userId: s.user.id, jobId: j.job.id, status: "needs_user",
      pendingQuestions: [{ id: "q_auth", text: "Are you legally authorized to work in the United States?", type: "boolean", options: [], required: true }],
    });
    fake.clear();
    await runTelegramTick(notifier());
    const texts = fake.lastSent()!.reply_markup!.inline_keyboard!.flat().map((b) => b.text);
    expect(texts).toEqual(["Type answer 1"]);
  });
});

