import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq, sessions, users } from "@norinote/db";
import { profiles } from "@norinote/db";
import { clearSessionCookie, accountName, consumeToken, createSession, issueToken, requireUser, revokeSessions, setSessionCookie } from "../auth/session.js";
import { dummyPasswordHash, hashPassword, sha256, verifyPassword } from "../auth/password.js";
import { HttpError, iso, parseBody } from "../http.js";
import { resetEmail, verificationEmail } from "../mailer.js";
import { clientIp, enforce } from "../security.js";
import type { AppEnv, Ctx, SessionUser } from "../types.js";
import { accountFiles, deleteAccountFiles } from "./files.js";

const HOUR = 3_600_000;
const email = z.string().trim().toLowerCase().max(320).pipe(z.email());
const password = z.string().min(8, "Use at least 8 characters").max(200);

const Signup = z.object({ email, password, name: z.string().trim().max(200).optional() });
const Login = z.object({ email, password: z.string().min(1).max(200) });
const Forgot = z.object({ email });
const Reset = z.object({ token: z.string().min(10).max(200), password });
const Verify = z.object({ token: z.string().min(10).max(200) });
const Change = z.object({ current: z.string().min(1).max(200), next: password });
const Delete = z.object({ confirm: z.string().max(320) });

export function userView(user: SessionUser, name: string | null) {
  return { id: user.id, email: user.email, name, emailVerifiedAt: iso(user.emailVerifiedAt), createdAt: user.createdAt.toISOString() };
}

/** "Chrome on Windows" from a user agent, for the session list. */
export function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\/|opera/i.test(ua) ? "Opera" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : null;
  const os = /windows/i.test(ua) ? "Windows" : /iphone|ipad|ios/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os|macintosh/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

async function sendVerification(ctx: Ctx, userId: string, to: string): Promise<void> {
  try {
    const token = await issueToken(ctx, userId, "email_verification", 3 * 24 * HOUR);
    await ctx.mailer.send({ to, ...verificationEmail(`${ctx.config.landingUrl ?? ctx.config.webUrl}/verify-email?token=${encodeURIComponent(token)}`) });
  } catch (err) {
    ctx.log(`[api] could not send verification email: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function authRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.post("/signup", async (c) => {
    enforce(ctx.limiter, `signup:${clientIp(c, ctx.config)}`, 8, HOUR, "Too many accounts created from this address. Try again later.");
    const body = await parseBody(c, Signup);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    const passwordHash = await hashPassword(body.password);
    let created: typeof users.$inferSelect | undefined;
    try {
      [created] = await db.insert(users).values({ email: body.email, passwordHash, createdAt: ctx.now() }).returning();
    } catch {
      // Two signups with the same address at once: the unique index let one through.
      throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    }
    if (!created) throw new Error("user insert returned nothing");
    await db.insert(profiles).values({ userId: created.id, contact: body.name ? { name: body.name } : {} }).onConflictDoNothing();
    const token = await createSession(ctx, created.id, c.req.header("user-agent"));
    setSessionCookie(ctx, c, token);
    await sendVerification(ctx, created.id, created.email);
    return c.json({ user: userView({ id: created.id, email: created.email, emailVerifiedAt: null, createdAt: created.createdAt }, body.name ?? null) }, 201);
  });

  r.post("/login", async (c) => {
    const ip = clientIp(c, ctx.config);
    enforce(ctx.limiter, `login:ip:${ip}`, 20, 15 * 60_000, "Too many sign-in attempts. Wait a few minutes and try again.");
    const body = await parseBody(c, Login);
    enforce(ctx.limiter, `login:email:${body.email}`, 8, 15 * 60_000, "Too many sign-in attempts for this account. Wait a few minutes and try again.");
    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    // Same work whether or not the account exists, so timing does not reveal it.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok) throw new HttpError(401, "Incorrect email or password");
    const token = await createSession(ctx, user.id, c.req.header("user-agent"));
    setSessionCookie(ctx, c, token);
    return c.json({ user: userView(user, await accountName(db, user.id)) });
  });

  r.post("/logout", async (c) => {
    const token = getCookie(c, ctx.config.cookieName);
    if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
    clearSessionCookie(ctx, c);
    return c.json({ ok: true });
  });

  r.get("/session", auth, async (c) => {
    const user = c.get("user");
    return c.json({ user: userView(user, await accountName(db, user.id)) });
  });

  r.post("/forgot-password", async (c) => {
    enforce(ctx.limiter, `password:ip:${clientIp(c, ctx.config)}`, 10, HOUR, "Too many password requests. Try again in an hour.");
    const body = await parseBody(c, Forgot);
    enforce(ctx.limiter, `password:email:${body.email}`, 3, HOUR, "Too many password requests for this address. Try again in an hour.");
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, body.email)).limit(1);
    if (user) {
      try {
        const token = await issueToken(ctx, user.id, "password_reset", HOUR);
        await ctx.mailer.send({ to: user.email, ...resetEmail(`${ctx.config.landingUrl ?? ctx.config.webUrl}/reset-password?token=${encodeURIComponent(token)}`) });
      } catch (err) {
        ctx.log(`[api] could not send reset email: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // The same answer for every address, so this cannot be used to find out who has an account.
    return c.json({ ok: true });
  });

  r.post("/reset-password", async (c) => {
    enforce(ctx.limiter, `reset:ip:${clientIp(c, ctx.config)}`, 20, HOUR, "Too many attempts. Try again in an hour.");
    const body = await parseBody(c, Reset);
    const userId = await consumeToken(ctx, "password_reset", body.token);
    if (!userId) throw new HttpError(400, "This reset link is invalid or has expired. Ask for a new one.");
    await db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, userId));
    await revokeSessions(db, userId);
    return c.json({ ok: true });
  });

  r.post("/verify-email", async (c) => {
    enforce(ctx.limiter, `verify:ip:${clientIp(c, ctx.config)}`, 30, HOUR, "Too many attempts. Try again later.");
    const body = await parseBody(c, Verify);
    const userId = await consumeToken(ctx, "email_verification", body.token);
    if (!userId) throw new HttpError(400, "This confirmation link is invalid or has expired. Request a new one from your account.");
    await db.update(users).set({ emailVerifiedAt: ctx.now() }).where(eq(users.id, userId));
    return c.json({ ok: true });
  });

  r.post("/resend-verification", auth, async (c) => {
    const user = c.get("user");
    if (user.emailVerifiedAt) return c.json({ ok: true, verified: true });
    enforce(ctx.limiter, `password:email:${user.email}`, 3, HOUR, "Too many requests. Try again in an hour.");
    await sendVerification(ctx, user.id, user.email);
    return c.json({ ok: true, verified: false });
  });

  r.post("/change-password", auth, async (c) => {
    const user = c.get("user");
    enforce(ctx.limiter, `password:user:${user.id}`, 10, HOUR, "Too many attempts. Try again in an hour.");
    const body = await parseBody(c, Change);
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!(await verifyPassword(body.current, row?.hash))) throw new HttpError(403, "Your current password is not right");
    await db.update(users).set({ passwordHash: await hashPassword(body.next) }).where(eq(users.id, user.id));
    await revokeSessions(db, user.id, c.get("sessionId"));
    return c.json({ ok: true });
  });

  r.get("/sessions", auth, async (c) => {
    const user = c.get("user");
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(sessions.createdAt);
    const current = c.get("sessionId");
    return c.json(rows.map((s) => ({
      id: s.id, current: s.id === current, device: deviceName(s.userAgent), createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString(),
    })));
  });

  r.post("/sessions/revoke-others", auth, async (c) => {
    const revoked = await revokeSessions(db, c.get("user").id, c.get("sessionId"));
    return c.json({ revoked });
  });

  r.delete("/sessions/:id", auth, async (c) => {
    const gone = await db.delete(sessions).where(and(eq(sessions.id, c.req.param("id")), eq(sessions.userId, c.get("user").id))).returning({ id: sessions.id });
    if (gone.length === 0) throw new HttpError(404, "Session not found");
    if (gone[0]?.id === c.get("sessionId")) clearSessionCookie(ctx, c);
    return c.json({ ok: true });
  });

  r.delete("/account", auth, async (c) => {
    const user = c.get("user");
    const body = await parseBody(c, Delete);
    if (body.confirm.trim().toLowerCase() !== user.email) throw new HttpError(400, "Type your account email to confirm");
    // The files go too: screenshots and traces of filled-in forms, and resumes. Their paths are read before the rows go.
    const files = await accountFiles(db, user.id, ctx.config.artifactsDir);
    // Every table that holds the user's data cascades from users.
    await db.delete(users).where(eq(users.id, user.id));
    await deleteAccountFiles(ctx, user.id, files);
    clearSessionCookie(ctx, c);
    return c.json({ ok: true });
  });

  return r;
}
