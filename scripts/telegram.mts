/**
 * Telegram bot helper. See docs/telegram.md.
 *
 *   npx tsx scripts/telegram.mts me              check the token (getMe)
 *   npx tsx scripts/telegram.mts poll            local development: long-poll Telegram and forward each update to the
 *                                                running API's webhook (npm run dev), so no public URL is needed
 *   npx tsx scripts/telegram.mts set-webhook     production: point Telegram at API_URL/api/channels/telegram/webhook
 *   npx tsx scripts/telegram.mts delete-webhook  stop webhook delivery (polling needs this; `poll` does it itself)
 *
 * Reads TELEGRAM_BOT_TOKEN, SESSION_SECRET (outside production a fixed development value is used when unset, the same
 * one the API uses), API_URL (default http://localhost:4000). The webhook secret is derived from both secrets.
 */
import { loadDotEnv } from "@norinote/db";
import { createBotClient, DEV_SESSION_SECRET, webhookSecret, type TgUpdate } from "@norinote/telegram";

loadDotEnv();
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const sessionSecret = process.env.SESSION_SECRET?.trim() || (process.env.NODE_ENV === "production" ? undefined : DEV_SESSION_SECRET);
const apiUrl = (process.env.API_URL?.trim() || `http://localhost:${process.env.PORT?.trim() || "4000"}`).replace(/\/+$/, "");
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
if (!sessionSecret) throw new Error("SESSION_SECRET is not set");

const bot = createBotClient({ token });
const secret = webhookSecret(sessionSecret, token);
const mode = process.argv[2] ?? "poll";
const ALLOWED = ["message", "callback_query"];

async function forward(update: TgUpdate): Promise<void> {
  const res = await fetch(`${apiUrl}/api/channels/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update),
  });
  if (!res.ok) console.warn(`[telegram] API answered ${res.status} for update ${update.update_id}`);
}

if (mode === "me") {
  const me = await bot.getMe();
  console.log(`Bot @${me.username} (id ${me.id}). Set TELEGRAM_BOT_USERNAME=${me.username}`);
} else if (mode === "set-webhook") {
  if (!process.env.API_URL?.startsWith("https://")) throw new Error("API_URL must be the public https URL of the API");
  await bot.setWebhook({ url: `${apiUrl}/api/channels/telegram/webhook`, secret_token: secret, allowed_updates: ALLOWED, max_connections: 20 });
  console.log(`Webhook set to ${apiUrl}/api/channels/telegram/webhook`);
} else if (mode === "delete-webhook") {
  await bot.deleteWebhook();
  console.log("Webhook deleted");
} else if (mode === "poll") {
  // getUpdates does not work while a webhook is set.
  await bot.deleteWebhook();
  console.log(`[telegram] polling; forwarding updates to ${apiUrl}. Ctrl+C to stop.`);
  let offset = 0;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; console.log("[telegram] stopping after this poll"); });
  while (!stopping) {
    try {
      const updates = await bot.getUpdates({ offset, timeout: 25, allowed_updates: ALLOWED });
      for (const u of updates) {
        offset = u.update_id + 1;
        await forward(u).catch((err) => console.warn(`[telegram] could not reach the API: ${err instanceof Error ? err.message : String(err)}`));
      }
    } catch (err) {
      console.warn(`[telegram] getUpdates failed: ${err instanceof Error ? err.message : String(err)}; retrying in 5 s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
} else {
  throw new Error(`Unknown mode ${mode}: use me, poll, set-webhook or delete-webhook`);
}
