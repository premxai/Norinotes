import { createHash, randomInt } from "node:crypto";
import { and, authTokens, channels, eq, isNull, ne, type Db } from "@norinote/db";

/** A link token lives 15 minutes and works once. Only its SHA-256 is stored (in `auth_tokens`, kind `telegram_link`). */
export const LINK_TTL_MS = 15 * 60_000;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 16;
const LINK_KIND = "telegram_link" as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type LinkToken = { code: string; expiresAt: Date };

/** A fresh one-time token for `/start <token>`; any earlier unused token of the user stops working. */
export async function createLinkToken(db: Db, userId: string, now: Date = new Date()): Promise<LinkToken> {
  const code = Array.from({ length: TOKEN_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  await db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, LINK_KIND), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, kind: LINK_KIND, tokenHash: sha256(code), expiresAt, createdAt: now });
  return { code, expiresAt };
}

export const deepLink = (botUsername: string, code: string) => `https://t.me/${botUsername}?start=${code}`;

export type LinkResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * `/start <token>` from `chatId`: checks the token (single use, unexpired), marks it used and links the chat to its user.
 * A user has one Telegram chat; a chat belongs to one user (linking it again moves it).
 */
export async function consumeLinkToken(db: Db, code: string, chatId: string, now: Date = new Date()): Promise<LinkResult> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{6,64}$/.test(clean)) return { ok: false, reason: "invalid" };
  const [row] = await db.select().from(authTokens).where(and(eq(authTokens.tokenHash, sha256(clean)), eq(authTokens.kind, LINK_KIND))).limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  // Two taps at once: only one update finds the row unused.
  const claimed = await db.update(authTokens).set({ usedAt: now }).where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt))).returning({ id: authTokens.id });
  if (claimed.length === 0) return { ok: false, reason: "used" };
  await db.delete(channels).where(and(eq(channels.kind, "telegram"), eq(channels.address, chatId), ne(channels.userId, row.userId)));
  await db.insert(channels).values({ userId: row.userId, kind: "telegram", address: chatId, createdAt: now })
    .onConflictDoUpdate({ target: [channels.userId, channels.kind], set: { address: chatId, createdAt: now } });
  return { ok: true, userId: row.userId };
}

export type LinkedChannel = { userId: string; chatId: string; linkedAt: Date };

export async function channelForChat(db: Db, chatId: string): Promise<LinkedChannel | null> {
  const [row] = await db.select().from(channels).where(and(eq(channels.kind, "telegram"), eq(channels.address, chatId))).limit(1);
  return row ? { userId: row.userId, chatId: row.address, linkedAt: row.createdAt } : null;
}

export async function channelForUser(db: Db, userId: string): Promise<LinkedChannel | null> {
  const [row] = await db.select().from(channels).where(and(eq(channels.kind, "telegram"), eq(channels.userId, userId))).limit(1);
  return row ? { userId: row.userId, chatId: row.address, linkedAt: row.createdAt } : null;
}

/** Removes the user's Telegram link. Returns the chat it was linked to, if any. */
export async function unlinkUser(db: Db, userId: string): Promise<string | null> {
  const gone = await db.delete(channels).where(and(eq(channels.kind, "telegram"), eq(channels.userId, userId))).returning({ address: channels.address });
  return gone[0]?.address ?? null;
}

export async function unlinkChat(db: Db, chatId: string): Promise<boolean> {
  const gone = await db.delete(channels).where(and(eq(channels.kind, "telegram"), eq(channels.address, chatId))).returning({ id: channels.id });
  return gone.length > 0;
}
