import { and, channelMessages, eq } from "@norinote/db";
import type { InlineKeyboard, TgCallbackQuery, TgMessage, TgUpdate } from "./client.js";
import { digestKeyboard, type DigestItem } from "./digest.js";
import { clip, esc } from "./format.js";
import { channelForChat, consumeLinkToken, unlinkChat, type LinkedChannel } from "./link.js";
import { messageRow, updatePayload, type TelegramDeps } from "./outbox.js";
import { firstTextGroup, questionsKeyboard, type QuestionsPayload } from "./questions.js";
import { loadTelegramSettings } from "./settings.js";
import { packId, unpackId, verifyCallback } from "./signing.js";

/** What a button or reply does, through the same code paths as the web app. Implemented by the API. */
export type TelegramActions = {
  /** Apply (counts as the user's approval). `message` is shown as the button's toast. */
  apply(userId: string, jobId: string): Promise<{ ok: boolean; message: string }>;
  /** Skip: dismiss the shortlist row. */
  skip(userId: string, jobId: string): Promise<{ ok: boolean; message: string }>;
  /** Answers keyed by pending question id (POST /api/applications/:id/answer). */
  answer(userId: string, applicationId: string, answers: Record<string, string>): Promise<{ ok: boolean; status?: string; resumed?: boolean }>;
};

export type UpdateDeps = TelegramDeps & { actions: TelegramActions };

export const CONNECT_HINT = "This chat is not connected to Norinote. Open Norinote, go to Settings, and tap Connect Telegram.";
const HELP = [
  "Norinote sends your daily shortlist here, asks the questions an application needs, and tells you when something is sent or needs you.",
  "Use the buttons on each message. Reply to a question message to type an answer.",
  "/stop disconnects this chat.",
].join("\n\n");

const LINK_ERRORS = {
  invalid: "That link is not valid. Make a new one in Norinote: Settings, Connect Telegram.",
  expired: "That link has expired (links last 15 minutes). Make a new one in Norinote: Settings, Connect Telegram.",
  used: "That link was already used. Make a new one in Norinote if you want to connect this chat.",
} as const;

/** Failed `/start <token>` attempts per chat in a window, so tokens cannot be guessed by brute force. */
const START_LIMIT = 10;
const START_WINDOW_MS = 10 * 60_000;

/** Handles one update from the webhook or the polling runner. Never throws for a bad update; errors are logged. */
export function createUpdateHandler(deps: UpdateDeps): (update: TgUpdate) => Promise<void> {
  const failures = new Map<string, { n: number; resetAt: number }>();
  const now = () => (deps.now ?? (() => new Date()))();
  const say = (chatId: number | string, text: string, extra: { reply_markup?: InlineKeyboard | { force_reply: true; input_field_placeholder?: string } } = {}) =>
    deps.queue.run(chatId, () => deps.client.sendMessage({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }));
  const toast = (q: TgCallbackQuery, text?: string) =>
    deps.client.answerCallbackQuery({ callback_query_id: q.id, ...(text ? { text: clip(text, 190) } : {}) }).catch((err) => deps.log?.("telegram.callback_answer_failed", { error: String(err) }));
  const setKeyboard = async (chatId: number, messageId: number, keyboard: InlineKeyboard) => {
    try {
      await deps.queue.run(chatId, () => deps.client.editMessageReplyMarkup({ chat_id: chatId, message_id: messageId, reply_markup: keyboard }));
    } catch (err) {
      // "message is not modified" and edits of old messages are harmless.
      deps.log?.("telegram.edit_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };

  function limited(chatId: string): boolean {
    const t = Date.now();
    const f = failures.get(chatId);
    return !!f && f.resetAt > t && f.n >= START_LIMIT;
  }
  function fail(chatId: string): void {
    const t = Date.now();
    const f = failures.get(chatId);
    if (!f || f.resetAt <= t) failures.set(chatId, { n: 1, resetAt: t + START_WINDOW_MS });
    else f.n++;
  }

  async function onMessage(m: TgMessage): Promise<void> {
    if (m.chat.type !== "private") return;
    const chatId = String(m.chat.id);
    const text = (m.text ?? "").trim();
    const command = /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s.exec(text);
    const name = command?.[1]?.toLowerCase();
    const arg = command?.[2]?.trim() ?? "";

    if (name === "start" && arg) {
      if (limited(chatId)) { await say(chatId, "Too many attempts. Wait a few minutes, then use a new link from Norinote."); return; }
      const res = await consumeLinkToken(deps.db, arg, chatId, now());
      if (!res.ok) { fail(chatId); await say(chatId, LINK_ERRORS[res.reason]); return; }
      const s = await loadTelegramSettings(deps.db, res.userId);
      await say(chatId, `<b>Connected.</b> Your daily shortlist comes at ${s.dailyTime} (${esc(s.timezone)}); quiet hours ${s.quietHours.enabled ? `${s.quietHours.start} to ${s.quietHours.end}` : "off"}. Change this in Norinote: Settings, Telegram.\n\n/stop disconnects this chat.`);
      return;
    }

    const channel = await channelForChat(deps.db, chatId);
    if (!channel) { await say(chatId, CONNECT_HINT); return; }

    if (name === "stop") {
      await unlinkChat(deps.db, chatId);
      await say(chatId, "Disconnected. Norinote will not message this chat again. Connect again any time from Settings in Norinote.");
      return;
    }
    if (name === "start") { await say(chatId, "This chat is connected to Norinote. Your daily shortlist and updates come here."); return; }
    if (name === "help" || name) { await say(chatId, HELP); return; }
    if (m.reply_to_message && text) { await onReply(channel, m, text); return; }
    await say(chatId, HELP);
  }

  /** A text reply to a questions message (its first text question) or to a "type your answer" prompt. */
  async function onReply(channel: LinkedChannel, m: TgMessage, text: string): Promise<void> {
    const replied = await messageRow(deps.db, channel.chatId, m.reply_to_message!.message_id);
    let parent = replied;
    let group = -1;
    if (replied?.kind === "prompt") {
      const p = replied.payload as { parentId?: string; group?: number };
      const [row] = p.parentId ? await deps.db.select().from(channelMessages).where(eq(channelMessages.id, p.parentId)).limit(1) : [];
      parent = row ?? null;
      group = typeof p.group === "number" ? p.group : -1;
    } else if (replied?.kind === "questions") {
      group = firstTextGroup(replied.payload as unknown as QuestionsPayload);
    }
    if (!parent || parent.kind !== "questions" || parent.userId !== channel.userId || group < 0) {
      await say(channel.chatId, "I could not tell which question that answers. Reply to a question message, or tap Type answer.");
      return;
    }
    const payload = parent.payload as unknown as QuestionsPayload;
    const g = payload.groups[group];
    if (!g || g.mode !== "text") { await say(channel.chatId, "That question takes one of the buttons."); return; }
    if (payload.answered.includes(group)) { await say(channel.chatId, "That question is already answered."); return; }
    const value = text.slice(0, 5000);
    const result = await answerGroup(channel, parent.id, payload, group, value);
    await say(channel.chatId, `Saved answer ${group + 1}.${result}`);
    if (parent.chatId && parent.telegramMessageId) await setKeyboard(Number(parent.chatId), parent.telegramMessageId, keyboardFor(channel, parent.id, { ...payload, answered: [...payload.answered, group] }));
  }

  const keyboardFor = (channel: LinkedChannel, rowId: string, p: QuestionsPayload) =>
    questionsKeyboard(p, { secret: deps.secret, userId: channel.userId, webUrl: deps.webUrl, messageId: packId(rowId) });

  /** Writes one answer to every application question of the group, through the API's answer path. */
  async function answerGroup(channel: LinkedChannel, rowId: string, p: QuestionsPayload, group: number, value: string): Promise<string> {
    const g = p.groups[group]!;
    let resumed = 0;
    for (const t of g.targets) {
      const r = await deps.actions.answer(channel.userId, t.applicationId, { [t.questionId]: value });
      if (r.resumed) resumed++;
    }
    await updatePayload(deps.db, rowId, { answered: [...p.answered, group] });
    return resumed ? ` ${resumed === 1 ? "An application" : `${resumed} applications`} carried on.` : "";
  }

  async function onCallback(q: TgCallbackQuery): Promise<void> {
    const msg = q.message;
    if (!msg || !q.data) { await toast(q); return; }
    const channel = await channelForChat(deps.db, String(msg.chat.id));
    if (!channel) { await toast(q, CONNECT_HINT); return; }
    const cb = verifyCallback(deps.secret, channel.userId, q.data);
    // Forged, or made for another user's chat: the button does nothing.
    if (!cb) { await toast(q); return; }

    if (cb.op === "a" || cb.op === "s") {
      const jobId = unpackId(cb.args[0] ?? "");
      if (!jobId) { await toast(q); return; }
      const res = cb.op === "a" ? await deps.actions.apply(channel.userId, jobId) : await deps.actions.skip(channel.userId, jobId);
      await toast(q, res.message);
      if (!res.ok) return;
      const row = await messageRow(deps.db, channel.chatId, msg.message_id);
      if (row && row.kind === "digest" && row.userId === channel.userId) {
        const p = row.payload as { items?: DigestItem[]; handled?: string[] };
        const handled = [...new Set([...(p.handled ?? []), jobId])];
        await updatePayload(deps.db, row.id, { handled });
        await setKeyboard(msg.chat.id, msg.message_id, digestKeyboard(p.items ?? [], handled, { secret: deps.secret, userId: channel.userId, webUrl: deps.webUrl }));
      } else if (msg.reply_markup) {
        await setKeyboard(msg.chat.id, msg.message_id, { inline_keyboard: msg.reply_markup.inline_keyboard.filter((r) => !r.some((b) => "callback_data" in b && b.callback_data === q.data)) });
      }
      return;
    }

    // c / t: a questions message, which must be this user's.
    const rowId = unpackId(cb.args[0] ?? "");
    const group = Number(cb.args[1]);
    const [row] = rowId ? await deps.db.select().from(channelMessages).where(and(eq(channelMessages.id, rowId), eq(channelMessages.userId, channel.userId))).limit(1) : [];
    if (!row || row.kind !== "questions" || !Number.isInteger(group)) { await toast(q); return; }
    const p = row.payload as unknown as QuestionsPayload;
    const g = p.groups[group];
    if (!g) { await toast(q); return; }
    if (p.answered.includes(group)) { await toast(q, "Already answered."); return; }

    if (cb.op === "c") {
      const option = g.mode === "choice" ? g.options[Number(cb.args[2])] : undefined;
      if (option === undefined) { await toast(q); return; }
      const result = await answerGroup(channel, row.id, p, group, option);
      await toast(q, `Saved: ${option}.${result}`);
      await setKeyboard(msg.chat.id, msg.message_id, keyboardFor(channel, row.id, { ...p, answered: [...p.answered, group] }));
      return;
    }

    // t: ask for the text with a reply prompt; the reply comes back as a message.
    if (g.mode !== "text") { await toast(q); return; }
    await toast(q, "Reply to the next message with your answer.");
    const prompt = await say(channel.chatId, `<b>${group + 1}.</b> ${esc(clip(g.text, 600))}\nReply to this message with your answer.`, { reply_markup: { force_reply: true, input_field_placeholder: "Your answer" } });
    const at = now();
    await deps.db.insert(channelMessages).values({
      userId: channel.userId, kind: "prompt", dedupeKey: `prompt:${row.id}:${group}:${prompt.message_id}`, status: "sent", chatId: channel.chatId,
      telegramMessageId: prompt.message_id, payload: { parentId: row.id, group, text: g.text }, createdAt: at, sentAt: at,
    }).onConflictDoNothing();
  }

  return async (update: TgUpdate) => {
    try {
      if (update.callback_query) await onCallback(update.callback_query);
      else if (update.message) await onMessage(update.message);
    } catch (err) {
      deps.log?.("telegram.update_failed", { updateId: update.update_id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
