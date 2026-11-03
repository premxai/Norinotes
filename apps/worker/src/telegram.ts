import type { Db } from "@norinote/db";
import { JOBS, type QueueAdapter } from "@norinote/queue";
import { createBotClient, DEV_SESSION_SECRET, SendQueue, startTelegramNotifier } from "@norinote/telegram";
import type { Logger } from "./log.js";

/**
 * Starts the Telegram notifier (daily shortlist, questions, events, Apply taps waiting for preparation) when
 * TELEGRAM_BOT_TOKEN is set. Returns a stop function; a no-op without a token.
 */
export function startTelegram(db: Db, queue: QueueAdapter, log: Logger, env: Record<string, string | undefined> = process.env): () => void {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = env.SESSION_SECRET?.trim() || (env.NODE_ENV === "production" ? undefined : DEV_SESSION_SECRET);
  if (!token || !secret) return () => undefined;
  const webUrl = (env.WEB_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const everyMs = Math.max(5, Number.parseInt(env.TELEGRAM_TICK_SECONDS ?? "", 10) || 30) * 1000;
  return startTelegramNotifier({
    db, client: createBotClient({ token }), queue: new SendQueue(), secret, webUrl,
    enqueueApply: (applicationId) => queue.enqueue(JOBS.applyRun, { applicationId, trigger: "click" }),
    log: (event, fields) => log.info(event, fields),
  }, { everyMs });
}
