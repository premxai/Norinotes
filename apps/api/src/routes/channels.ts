import { Hono } from "hono";
import { and, authTokens, channels, eq, isNull } from "@norinote/db";
import { requireUser } from "../auth/session.js";
import { randomInt } from "node:crypto";
import { sha256 } from "../auth/password.js";
import { HttpError } from "../http.js";
import type { AppEnv, Ctx } from "../types.js";

const CODE_TTL_MS = 15 * 60_000;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Kind of the `auth_tokens` row that holds a pending Telegram link code (the bot looks it up by hash). */
const LINK_KIND = "telegram_link" as unknown as "email_verification";

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export function channelRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db, config } = ctx;
  const configured = !!config.telegramBotToken;

  r.get("/telegram", auth, async (c) => {
    const [row] = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.userId, c.get("user").id), eq(channels.kind, "telegram"))).limit(1);
    return c.json({ configured, botUsername: configured ? config.telegramBotUsername : null, linked: !!row });
  });

  /** A short-lived one-time code the user sends to the bot. Only its hash is stored. */
  r.post("/telegram/link", auth, async (c) => {
    if (!configured) throw new HttpError(503, "Telegram is not set up on this server yet.");
    const userId = c.get("user").id;
    const code = newCode();
    const expiresAt = new Date(ctx.now().getTime() + CODE_TTL_MS);
    await db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, LINK_KIND), isNull(authTokens.usedAt)));
    await db.insert(authTokens).values({ userId, kind: LINK_KIND, tokenHash: sha256(code), expiresAt });
    const bot = config.telegramBotUsername;
    return c.json({ code, expiresAt: expiresAt.toISOString(), botUsername: bot, link: bot ? `https://t.me/${bot}?start=${code}` : null });
  });

  return r;
}
