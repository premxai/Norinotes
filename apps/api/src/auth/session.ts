import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { and, authTokens, eq, gt, isNull, lt, profiles, sessions, sql, users, type Db } from "@norinote/db";
import { parseProfileContact } from "@norinote/shared";
import { HttpError } from "../http.js";
import type { AppEnv, Ctx } from "../types.js";
import { randomToken, sha256 } from "./password.js";

const DAY_MS = 86_400_000;
/** `lastSeenAt` is refreshed (and the session extended) at most this often. */
const TOUCH_AFTER_MS = 60 * 60_000;

export function setSessionCookie(ctx: Ctx, c: Context, token: string): void {
  setCookie(c, ctx.config.cookieName, token, {
    httpOnly: true, sameSite: "Lax", secure: ctx.config.secureCookies, path: "/", maxAge: ctx.config.sessionDays * 86_400,
  });
}

export function clearSessionCookie(ctx: Ctx, c: Context): void {
  deleteCookie(c, ctx.config.cookieName, { path: "/", secure: ctx.config.secureCookies });
}

/** Opens a session and returns the cookie token. Only its SHA-256 is stored. */
export async function createSession(ctx: Ctx, userId: string, userAgent: string | undefined): Promise<string> {
  const token = randomToken(32);
  const now = ctx.now();
  await ctx.db.insert(sessions).values({
    id: sha256(token), userId, userAgent: userAgent?.slice(0, 300) ?? null, createdAt: now, lastSeenAt: now,
    expiresAt: new Date(now.getTime() + ctx.config.sessionDays * DAY_MS),
  });
  // Expired sessions are swept as people sign in, so the table does not grow without bound.
  await ctx.db.delete(sessions).where(lt(sessions.expiresAt, now));
  return token;
}

/** Requires a valid session cookie. Sets `user` and `sessionId` on the context, otherwise 401. */
export function requireUser(ctx: Ctx): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, ctx.config.cookieName);
    if (!token) throw new HttpError(401, "Not signed in");
    const now = ctx.now();
    const id = sha256(token);
    const [row] = await ctx.db.select({
      sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt, userId: users.id, email: users.email,
      emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt,
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now))).limit(1);
    if (!row) throw new HttpError(401, "Not signed in");
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
      await ctx.db.update(sessions).set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ctx.config.sessionDays * DAY_MS) }).where(eq(sessions.id, id));
    }
    c.set("user", { id: row.userId, email: row.email, emailVerifiedAt: row.emailVerifiedAt, createdAt: row.createdAt });
    c.set("sessionId", row.sessionId);
    await next();
  };
}

export type TokenKind = "email_verification" | "password_reset";

/** Creates a one-time token for the email and returns it. Only its SHA-256 is stored. Older unused ones of the kind are dropped. */
export async function issueToken(ctx: Ctx, userId: string, kind: TokenKind, ttlMs: number): Promise<string> {
  const token = randomToken(32);
  await ctx.db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await ctx.db.insert(authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(ctx.now().getTime() + ttlMs) });
  return token;
}

/** Uses a token once (atomically). Returns the user id, or null when unknown, expired or already used. */
export async function consumeToken(ctx: Ctx, kind: TokenKind, token: string): Promise<string | null> {
  const now = ctx.now();
  const [row] = await ctx.db.update(authTokens).set({ usedAt: now })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

/** The profile row, created empty when the account has none yet. */
export async function ensureProfile(db: Db, userId: string): Promise<typeof profiles.$inferSelect> {
  await db.insert(profiles).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!row) throw new Error("profile missing after insert");
  return row;
}

/** The name shown for the account: the profile's contact name. */
export async function accountName(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ contact: profiles.contact }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row ? parseProfileContact(row.contact).name : null;
}

/** Ends every session of the user except `keep`. Returns how many were ended. */
export async function revokeSessions(db: Db, userId: string, keep?: string): Promise<number> {
  const gone = await db.delete(sessions)
    .where(keep ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keep}`) : eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return gone.length;
}
