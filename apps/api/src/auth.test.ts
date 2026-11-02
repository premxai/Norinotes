import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sessions, users } from "@norinote/db";
import { makeApi, type Api } from "./testkit.js";
import { cookieOf } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

const tokenIn = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)?.[1] ?? "");

describe("signup, session, logout, login", () => {
  it("creates an account, sets an httpOnly lax cookie and answers /session", async () => {
    const res = await api.call("POST", "/api/auth/signup", { body: { email: "Grace@Example.com ", password: "hopper-1906-cobol", name: "Grace Hopper" } });
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({ email: "grace@example.com", name: "Grace Hopper", emailVerifiedAt: null });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("norinote_session="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
    const cookie = cookieOf(res.headers)!;

    const session = await api.call("GET", "/api/auth/session", { cookie });
    expect(session.status).toBe(200);
    expect(session.json.user.email).toBe("grace@example.com");

    expect((await api.call("GET", "/api/auth/session")).status).toBe(401);
    expect((await api.call("GET", "/api/auth/session", { cookie: "norinote_session=nope" })).status).toBe(401);
  });

  it("never stores the cookie token or the password in clear", async () => {
    const { cookie } = await api.signup("clear@example.com", "plain-text-password");
    const token = cookie.split("=")[1]!;
    const stored = await api.db.select({ id: sessions.id }).from(sessions);
    expect(stored.map((s) => s.id)).not.toContain(token);
    const [u] = await api.db.select().from(users).where(eq(users.email, "clear@example.com"));
    expect(u!.passwordHash).toMatch(/^scrypt\$/);
    expect(u!.passwordHash).not.toContain("plain-text-password");
  });

  it("marks the cookie Secure in production", async () => {
    const prod = await makeApi({ config: { secureCookies: true, production: true } });
    const res = await prod.call("POST", "/api/auth/signup", { body: { email: "p@example.com", password: "long enough pw" } });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("norinote_session="))).toMatch(/Secure/);
    await prod.close();
  });

  it("rejects a duplicate email, a bad email and a short password", async () => {
    await api.signup("dup@example.com");
    expect((await api.call("POST", "/api/auth/signup", { body: { email: "dup@example.com", password: "another-password" } })).status).toBe(409);
    expect((await api.call("POST", "/api/auth/signup", { body: { email: "not-an-email", password: "another-password" } })).status).toBe(400);
    const short = await api.call("POST", "/api/auth/signup", { body: { email: "short@example.com", password: "abc" } });
    expect(short.status).toBe(400);
    expect(short.json.error).toBe("Invalid request");
  });

  it("logs out (the cookie stops working) and logs back in", async () => {
    const { cookie, password } = await api.signup("loop@example.com");
    const out = await api.call("POST", "/api/auth/logout", { cookie });
    expect(out.status).toBe(200);
    expect((await api.call("GET", "/api/auth/session", { cookie })).status).toBe(401);

    const bad = await api.call("POST", "/api/auth/login", { body: { email: "loop@example.com", password: "wrong-password" } });
    expect(bad.status).toBe(401);
    expect(bad.json.error).toBe("Incorrect email or password");
    expect((await api.call("POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "wrong-password" } })).json.error).toBe("Incorrect email or password");

    const good = await api.call("POST", "/api/auth/login", { body: { email: "LOOP@example.com", password } });
    expect(good.status).toBe(200);
    expect((await api.call("GET", "/api/auth/session", { cookie: cookieOf(good.headers)! })).status).toBe(200);
  });
});

describe("email verification and password reset", () => {
  it("verifies the email once with the emailed link", async () => {
    const before = api.mails.length;
    const { cookie } = await api.signup("verify@example.com");
    const mail = api.mails.slice(before).find((m) => m.to === "verify@example.com")!;
    expect(mail.text).toContain(`${api.config.webUrl}/verify-email?token=`);
    const token = tokenIn(mail.text);
    expect((await api.call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(200);
    expect((await api.call("GET", "/api/auth/session", { cookie })).json.user.emailVerifiedAt).toBeTruthy();
    expect((await api.call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(400);
    expect((await api.call("POST", "/api/auth/resend-verification", { cookie, body: {} })).json).toEqual({ ok: true, verified: true });
  });

  it("resets a password with a one-time token and ends every session", async () => {
    const { cookie } = await api.signup("reset@example.com", "old-password-1");
    const before = api.mails.length;
    const asked = await api.call("POST", "/api/auth/forgot-password", { body: { email: "reset@example.com" } });
    expect(asked.json).toEqual({ ok: true });
    const mail = api.mails.slice(before).find((m) => m.subject.includes("Reset"))!;
    const token = tokenIn(mail.text);

    expect((await api.call("POST", "/api/auth/reset-password", { body: { token: "x".repeat(40), password: "new-password-2" } })).status).toBe(400);
    expect((await api.call("POST", "/api/auth/reset-password", { body: { token, password: "new-password-2" } })).status).toBe(200);
    expect((await api.call("POST", "/api/auth/reset-password", { body: { token, password: "new-password-3" } })).status).toBe(400);

    expect((await api.call("GET", "/api/auth/session", { cookie })).status).toBe(401);
    expect((await api.call("POST", "/api/auth/login", { body: { email: "reset@example.com", password: "old-password-1" } })).status).toBe(401);
    expect((await api.call("POST", "/api/auth/login", { body: { email: "reset@example.com", password: "new-password-2" } })).status).toBe(200);
  });

  it("answers forgot-password the same for an unknown address and sends nothing", async () => {
    const before = api.mails.length;
    const res = await api.call("POST", "/api/auth/forgot-password", { body: { email: "ghost@example.com" } });
    expect(res.json).toEqual({ ok: true });
    expect(api.mails.length).toBe(before);
  });
});

describe("sessions, password change, account deletion", () => {
  it("lists sessions, revokes one and all the others", async () => {
    const a = await api.signup("multi@example.com");
    const second = await api.call("POST", "/api/auth/login", { body: { email: "multi@example.com", password: a.password }, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15" } });
    const secondCookie = cookieOf(second.headers)!;
    const third = await api.call("POST", "/api/auth/login", { body: { email: "multi@example.com", password: a.password } });
    const thirdCookie = cookieOf(third.headers)!;

    const list = await api.call("GET", "/api/auth/sessions", { cookie: a.cookie });
    expect(list.json).toHaveLength(3);
    expect(list.json.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.json.some((s: { device: string }) => s.device === "Safari on macOS")).toBe(true);

    const other = list.json.find((s: { current: boolean }) => !s.current);
    expect((await api.call("DELETE", `/api/auth/sessions/${other.id}`, { cookie: a.cookie })).status).toBe(200);
    expect((await api.call("DELETE", `/api/auth/sessions/${other.id}`, { cookie: a.cookie })).status).toBe(404);

    const revoked = await api.call("POST", "/api/auth/sessions/revoke-others", { cookie: a.cookie, body: {} });
    expect(revoked.json.revoked).toBe(1);
    expect((await api.call("GET", "/api/auth/session", { cookie: a.cookie })).status).toBe(200);
    expect((await api.call("GET", "/api/auth/session", { cookie: secondCookie })).status).toBe(401);
    expect((await api.call("GET", "/api/auth/session", { cookie: thirdCookie })).status).toBe(401);
    const remaining = await api.call("GET", "/api/auth/sessions", { cookie: a.cookie });
    expect(remaining.json).toHaveLength(1);
  });

  it("cannot revoke another user's session", async () => {
    const a = await api.signup("own-a@example.com");
    const b = await api.signup("own-b@example.com");
    const bSessions = await api.call("GET", "/api/auth/sessions", { cookie: b.cookie });
    const res = await api.call("DELETE", `/api/auth/sessions/${bSessions.json[0].id}`, { cookie: a.cookie });
    expect(res.status).toBe(404);
    expect((await api.call("GET", "/api/auth/session", { cookie: b.cookie })).status).toBe(200);
  });

  it("changes the password after checking the current one", async () => {
    const { cookie } = await api.signup("change@example.com", "first-password-1");
    expect((await api.call("POST", "/api/auth/change-password", { cookie, body: { current: "wrong-one-here", next: "second-password-2" } })).status).toBe(403);
    expect((await api.call("POST", "/api/auth/change-password", { cookie, body: { current: "first-password-1", next: "second-password-2" } })).status).toBe(200);
    expect((await api.call("POST", "/api/auth/login", { body: { email: "change@example.com", password: "second-password-2" } })).status).toBe(200);
  });

  it("deletes the account only when the email is confirmed", async () => {
    const { cookie, user } = await api.signup("bye@example.com");
    expect((await api.call("DELETE", "/api/auth/account", { cookie, body: { confirm: "someone@else.com" } })).status).toBe(400);
    expect((await api.call("DELETE", "/api/auth/account", { cookie, body: { confirm: "Bye@Example.com" } })).status).toBe(200);
    expect((await api.call("GET", "/api/auth/session", { cookie })).status).toBe(401);
    expect(await api.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
  });
});

describe("rate limits", () => {
  it("blocks repeated login attempts for one account", async () => {
    const fresh = await makeApi();
    await fresh.signup("limit@example.com");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await fresh.call("POST", "/api/auth/login", { body: { email: "limit@example.com", password: "wrong-password" } })).status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
    const blocked = await fresh.call("POST", "/api/auth/login", { body: { email: "limit@example.com", password: "wrong-password" } });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.json.error).toMatch(/Too many/);
    await fresh.close();
  });

  it("limits signups per address and password resets per email", async () => {
    const fresh = await makeApi();
    for (let i = 0; i < 8; i++) expect((await fresh.call("POST", "/api/auth/signup", { body: { email: `s${i}@example.com`, password: "long enough pw" } })).status).toBe(201);
    expect((await fresh.call("POST", "/api/auth/signup", { body: { email: "s9@example.com", password: "long enough pw" } })).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await fresh.call("POST", "/api/auth/forgot-password", { body: { email: "s1@example.com" } })).status).toBe(200);
    expect((await fresh.call("POST", "/api/auth/forgot-password", { body: { email: "s1@example.com" } })).status).toBe(429);
    await fresh.close();
  });
});

describe("request guards", () => {
  it("answers errors as { error } and refuses a foreign Origin on writes", async () => {
    const res = await api.call("POST", "/api/auth/login", { body: { email: "x@example.com", password: "whatever-1" }, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: "Request origin not allowed" });
    const ok = await api.call("POST", "/api/auth/login", { body: { email: "x@example.com", password: "whatever-1" }, headers: { origin: api.config.webUrl } });
    expect(ok.status).toBe(401);
    const bad = await api.app.request("/api/auth/login", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("Request body is not valid JSON");
    expect((await api.call("GET", "/api/nothing-here")).json).toEqual({ error: "Not found" });
  });

  it("allows credentialed CORS for the web origin only", async () => {
    const pre = await api.app.request("/api/auth/session", { method: "OPTIONS", headers: { origin: api.config.webUrl, "access-control-request-method": "GET" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe(api.config.webUrl);
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
    const other = await api.app.request("/api/auth/session", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("serves the health check without a session", async () => {
    const res = await api.call("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
  });
});
