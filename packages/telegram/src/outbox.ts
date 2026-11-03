import { and, channelMessages, eq, isNull, lte, lt, ne, or, sql, type ChannelMessageKind, type Db } from "@norinote/db";
import { TelegramApiError, type BotClient, type InlineKeyboard } from "./client.js";
import { channelForUser, unlinkChat } from "./link.js";
import type { SendQueue } from "./sender.js";
import type { TelegramSettings } from "./settings.js";
import { quietUntil } from "./time.js";

export type Log = (event: string, fields?: Record<string, unknown>) => void;

/** What every sending part needs. */
export type TelegramDeps = {
  db: Db;
  client: BotClient;
  queue: SendQueue;
  /** SESSION_SECRET: signs button callback data. */
  secret: string;
  /** Public web app URL, for Details and Finish links. */
  webUrl: string;
  now?: () => Date;
  log?: Log;
};

/** A message waiting in `channel_messages`: its text (HTML) and buttons, plus whatever the buttons refer to. */
export type MessagePayload = { text: string; keyboard?: InlineKeyboard } & Record<string, unknown>;

export type QueueMessage = {
  /** Set when the buttons must name the row before it exists (questions). */
  id?: string;
  userId: string;
  kind: ChannelMessageKind;
  dedupeKey: string;
  applicationId?: string | null;
  payload: MessagePayload;
  /** Urgent messages go out during quiet hours; the rest wait for them to end. */
  urgent?: boolean;
  settings: Pick<TelegramSettings, "timezone" | "quietHours">;
  now: Date;
};

/** Adds a message to the outbox once per (user, dedupe key). Returns false when it was already there. */
export async function queueMessage(db: Db, m: QueueMessage): Promise<boolean> {
  const notBefore = m.urgent ? null : quietUntil(m.now, m.settings);
  const rows = await db.insert(channelMessages).values({
    ...(m.id ? { id: m.id } : {}),
    userId: m.userId, kind: m.kind, dedupeKey: m.dedupeKey, applicationId: m.applicationId ?? null, payload: m.payload,
    status: "pending", notBefore, createdAt: m.now,
  }).onConflictDoNothing().returning({ id: channelMessages.id });
  return rows.length > 0;
}

/** Records that something was considered and nothing needs sending (a day with no new jobs), so it is not looked at again. */
export async function markSkipped(db: Db, userId: string, kind: ChannelMessageKind, dedupeKey: string, now: Date, reason: string): Promise<void> {
  await db.insert(channelMessages).values({ userId, kind, dedupeKey, status: "skipped", error: reason, createdAt: now }).onConflictDoNothing();
}

export async function hasMessage(db: Db, userId: string, dedupeKey: string): Promise<boolean> {
  const [row] = await db.select({ id: channelMessages.id }).from(channelMessages).where(and(eq(channelMessages.userId, userId), eq(channelMessages.dedupeKey, dedupeKey))).limit(1);
  return !!row;
}

const MAX_ATTEMPTS = 5;

/** Sends due outbox rows (oldest first) through the per-chat queue. Returns how many were sent. */
export async function flushOutbox(deps: TelegramDeps, opts: { limit?: number } = {}): Promise<{ sent: number; failed: number; deferred: number }> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const due = await db.select().from(channelMessages)
    .where(and(eq(channelMessages.status, "pending"), ne(channelMessages.kind, "apply_intent"), or(isNull(channelMessages.notBefore), lte(channelMessages.notBefore, now))))
    .orderBy(channelMessages.createdAt).limit(opts.limit ?? 500);

  const stats = { sent: 0, failed: 0, deferred: 0 };
  // Users in parallel (the queue keeps each chat at its own pace), each user's messages in order.
  const byUser = new Map<string, typeof due>();
  for (const row of due) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  await Promise.all([...byUser.values()].map(async (rows) => { for (const row of rows) await sendRow(row); }));
  return stats;

  async function sendRow(row: (typeof due)[number]): Promise<void> {
    const channel = await channelForUser(db, row.userId);
    if (!channel) {
      await db.update(channelMessages).set({ status: "skipped", error: "not linked" }).where(eq(channelMessages.id, row.id));
      return;
    }
    const p = row.payload as MessagePayload;
    try {
      const msg = await deps.queue.run(channel.chatId, () => deps.client.sendMessage({
        chat_id: channel.chatId, text: p.text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
        ...(p.keyboard && p.keyboard.inline_keyboard.length ? { reply_markup: p.keyboard } : {}),
      }));
      await db.update(channelMessages).set({ status: "sent", chatId: channel.chatId, telegramMessageId: msg.message_id, sentAt: new Date(), attempts: row.attempts + 1, error: null })
        .where(eq(channelMessages.id, row.id));
      stats.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof TelegramApiError && err.chatGone) {
        // Blocked or deleted: nothing will reach this chat again until the user links it anew.
        await unlinkChat(db, channel.chatId);
        await db.update(channelMessages).set({ status: "failed", error: message, attempts: row.attempts + 1 }).where(eq(channelMessages.id, row.id));
        deps.log?.("telegram.unlinked", { userId: row.userId, reason: err.description });
        stats.failed++;
        return;
      }
      const attempts = row.attempts + 1;
      const retryAt = err instanceof TelegramApiError && err.retryAfter ? new Date(now.getTime() + err.retryAfter * 1000) : new Date(now.getTime() + 60_000 * attempts);
      const failed = attempts >= MAX_ATTEMPTS;
      await db.update(channelMessages).set({ status: failed ? "failed" : "pending", attempts, error: message, notBefore: failed ? row.notBefore : retryAt }).where(eq(channelMessages.id, row.id));
      deps.log?.("telegram.send_failed", { userId: row.userId, kind: row.kind, attempts, error: message });
      if (failed) stats.failed++; else stats.deferred++;
    }
  }
}

/** Outbox rows are a log after sending; keep 90 days. */
export async function purgeOldMessages(db: Db, now: Date, days = 90): Promise<number> {
  const gone = await db.delete(channelMessages).where(lt(channelMessages.createdAt, new Date(now.getTime() - days * 86_400_000))).returning({ id: channelMessages.id });
  return gone.length;
}

/** The outbox row behind a message Telegram shows in `chatId` (for replies and button presses). */
export async function messageRow(db: Db, chatId: string, telegramMessageId: number) {
  const [row] = await db.select().from(channelMessages)
    .where(and(eq(channelMessages.chatId, chatId), eq(channelMessages.telegramMessageId, telegramMessageId))).limit(1);
  return row ?? null;
}

export async function updatePayload(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await db.update(channelMessages).set({ payload: sql`${channelMessages.payload} || ${JSON.stringify(patch)}::jsonb` }).where(eq(channelMessages.id, id));
}
