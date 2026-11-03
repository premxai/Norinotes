import { Hono } from "hono";
import { z } from "zod";
import {
  channelForUser, createLinkToken, deepLink, isTimeZone, loadTelegramSettings, safeEqual, saveTelegramSettings, SettingsPatch,
  unlinkUser, type TgUpdate,
} from "@norinote/telegram";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody } from "../http.js";
import { clientIp, enforce } from "../security.js";
import { createTelegramRuntime, telegramConfigured } from "../telegram.js";
import type { AppEnv, Ctx } from "../types.js";

const LinkBody = z.object({ timezone: z.string().max(64).optional() });

export function channelRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db, config } = ctx;
  const configured = telegramConfigured(ctx);
  const runtime = createTelegramRuntime(ctx);

  async function state(userId: string) {
    const channel = await channelForUser(db, userId);
    return {
      configured,
      botUsername: configured ? config.telegramBotUsername : null,
      linked: !!channel,
      linkedAt: channel ? channel.linkedAt.toISOString() : null,
      settings: await loadTelegramSettings(db, userId),
    };
  }

  r.get("/telegram", auth, async (c) => c.json(await state(c.get("user").id)));

  /** Daily time, time zone, count, quiet hours and which events to send. Any subset. */
  r.put("/telegram", auth, async (c) => {
    const userId = c.get("user").id;
    const patch = await parseBody(c, SettingsPatch);
    await saveTelegramSettings(db, userId, patch);
    return c.json(await state(userId));
  });

  /**
   * A one-time deep link (t.me/<bot>?start=<token>): single use, 15 minutes, stored hashed. The web app may pass the
   * browser's time zone, which becomes the default for the daily message until the user picks one.
   */
  r.post("/telegram/link", auth, async (c) => {
    if (!configured) throw new HttpError(503, "Telegram is not set up on this server yet.");
    const userId = c.get("user").id;
    const body = await parseBody(c, LinkBody);
    if (body.timezone && isTimeZone(body.timezone)) {
      const current = await loadTelegramSettings(db, userId);
      if (current.timezone === "UTC" && body.timezone !== "UTC") await saveTelegramSettings(db, userId, { timezone: body.timezone });
    }
    const { code, expiresAt } = await createLinkToken(db, userId, ctx.now());
    const bot = config.telegramBotUsername;
    return c.json({ code, expiresAt: expiresAt.toISOString(), botUsername: bot, link: bot ? deepLink(bot, code) : null });
  });

  r.delete("/telegram", auth, async (c) => {
    const chatId = await unlinkUser(db, c.get("user").id);
    if (chatId && runtime) {
      // Best effort: tell the chat it is no longer connected.
      await runtime.queue.run(chatId, () => runtime.client.sendMessage({ chat_id: chatId, text: "Disconnected from Norinote. Connect again any time from Settings." }))
        .catch((err) => ctx.log(`[telegram] goodbye message failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return c.json({ ok: true, linked: false });
  });

  /** Telegram's webhook. No session: Telegram proves itself with the secret_token it was given in setWebhook. */
  r.post("/telegram/webhook", async (c) => {
    if (!runtime) throw notFound();
    const given = c.req.header("x-telegram-bot-api-secret-token") ?? "";
    if (!given || !safeEqual(given, runtime.webhookSecret)) {
      enforce(ctx.limiter, `tg-webhook-bad:${clientIp(c, config)}`, 30, 60_000, "Too many requests");
      throw new HttpError(401, "Bad webhook secret");
    }
    let update: TgUpdate;
    try {
      update = (await c.req.json()) as TgUpdate;
    } catch {
      return c.json({ ok: false }, 200);
    }
    if (!update || typeof update !== "object" || typeof update.update_id !== "number") return c.json({ ok: false }, 200);
    // Always 200: Telegram retries anything else, and a failing update must not block the ones after it.
    await runtime.handle(update);
    return c.json({ ok: true });
  });

  return r;
}
