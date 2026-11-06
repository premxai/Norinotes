/**
 * Smoke test of a deployed Norinote: the site, the API and the wiring between them, with one throwaway account that is
 * deleted at the end. No model calls, no applications, nothing collected. Run it against the real names once deployed
 * (docs/deploy.md, step 6).
 *
 *   npx tsx scripts/smoke.mts --site https://norinote.xyz --api https://api.norinote.xyz
 *     [--old-dashboard https://jobs.norinote.xyz] [--email delivered+smoke@resend.dev]
 *
 * The account's verification email goes to Resend's test address by default, so it reaches no one. Exit code 1 when any
 * check fails.
 */

type Check = { name: string; ok: boolean; detail?: string };

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const origin = (u: string | undefined, name: string): string => {
  if (!u) { console.error(`--${name} is required`); process.exit(2); }
  return new URL(u).origin;
};

const SITE = origin(arg("site"), "site");
const API = origin(arg("api"), "api");
const OLD = arg("old-dashboard") ? new URL(arg("old-dashboard")!).origin : null;
const EMAIL = arg("email") ?? `delivered+smoke${Date.now()}@resend.dev`;
const PASSWORD = `smoke-${crypto.randomUUID()}`;

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, ...(detail ? { detail } : {}) }); };
const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });

async function site(): Promise<void> {
  for (const path of ["/", "/signin", "/signup", "/privacy", "/terms"]) {
    const res = await get(`${SITE}${path}`);
    check(`site ${path} answers 200`, res.status === 200, String(res.status));
  }
  const home = await get(`${SITE}/`);
  const csp = home.headers.get("content-security-policy") ?? "";
  const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) ?? "";
  check("site CSP lets the browser call the API", connect.split(/\s+/).includes(API), connect || "no connect-src");
  check("site CSP allows Brandfetch logos", /img-src[^;]*https:\/\/cdn\.brandfetch\.io/.test(csp));
  check("site CSP upgrades insecure requests", SITE.startsWith("http://") || csp.includes("upgrade-insecure-requests"));
  const dash = await get(`${SITE}/dashboard`);
  check("site /dashboard redirects to /today", dash.status >= 300 && dash.status < 400 && (dash.headers.get("location") ?? "").endsWith("/today"), `${dash.status} ${dash.headers.get("location") ?? ""}`);
  const missing = await get(`${SITE}/no-such-page-${Date.now()}`);
  check("site unknown page answers 404", missing.status === 404, String(missing.status));
}

async function api(): Promise<void> {
  const health = await get(`${API}/api/health`);
  const body = (await health.json().catch(() => null)) as { ok?: boolean } | null;
  check("API health", health.status === 200 && body?.ok === true, String(health.status));

  const pre = await get(`${API}/api/graph/nodes/x`, { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "PATCH", "access-control-request-headers": "content-type" } });
  const methods = (pre.headers.get("access-control-allow-methods") ?? "").split(",").map((m) => m.trim());
  check("API CORS allows the site with credentials", pre.headers.get("access-control-allow-origin") === SITE && pre.headers.get("access-control-allow-credentials") === "true");
  check("API CORS allows every method the app uses", ["GET", "POST", "PUT", "PATCH", "DELETE"].every((m) => methods.includes(m)), methods.join(","));
  const evil = await get(`${API}/api/auth/session`, { headers: { origin: "https://evil.example" } });
  check("API CORS refuses other sites", evil.headers.get("access-control-allow-origin") !== "https://evil.example");
}

async function account(): Promise<void> {
  const json = { "content-type": "application/json", origin: SITE };
  const signup = await get(`${API}/api/auth/signup`, { method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Smoke Test" }) });
  check("sign-up works", signup.status === 201, `${signup.status} ${signup.status >= 400 ? await signup.text() : ""}`.trim());
  if (signup.status !== 201) return;
  const setCookie = signup.headers.get("set-cookie") ?? "";
  // Secure only over https: a local API on http sets the cookie without it.
  const secure = API.startsWith("http://") || /;\s*secure/i.test(setCookie);
  check("session cookie is HttpOnly, Secure and SameSite=Lax", /httponly/i.test(setCookie) && secure && /samesite=lax/i.test(setCookie), setCookie.replace(/=[^;]+/, "=…"));
  const cookie = setCookie.split(";")[0] ?? "";
  const authed = { cookie, origin: SITE };

  try {
    const session = await get(`${API}/api/auth/session`, { headers: authed });
    const s = (await session.json().catch(() => null)) as { user?: { email?: string } } | null;
    check("the session cookie signs the account in", session.status === 200 && s?.user?.email === EMAIL.toLowerCase(), String(session.status));

    for (const path of ["/api/me", "/api/onboarding", "/api/agent/status", "/api/shortlist", "/api/applications", "/api/inbox"]) {
      const res = await get(`${API}${path}`, { headers: authed });
      check(`${path} answers 200`, res.status === 200, String(res.status));
    }
    const summary = await get(`${API}/api/jobs/summary`, { headers: authed });
    const sum = (await summary.json().catch(() => null)) as { open?: number } | null;
    check("jobs are collected (last 72 hours)", summary.status === 200 && (sum?.open ?? 0) > 0, `${summary.status}, ${sum?.open ?? "?"} open`);

    const inbox = await get(`${API}/api/inbox/address`, { headers: authed });
    const ib = (await inbox.json().catch(() => null)) as { address?: string; configured?: boolean } | null;
    check("inbox addresses are configured", inbox.status === 200 && ib?.configured === true && !!ib.address, `${inbox.status} ${ib?.address ?? ""}`.trim());
    const tg = await get(`${API}/api/channels/telegram`, { headers: authed });
    const t = (await tg.json().catch(() => null)) as { configured?: boolean; botUsername?: string | null } | null;
    check("Telegram is configured", tg.status === 200 && t?.configured === true && !!t.botUsername, `${tg.status} ${t?.botUsername ?? ""}`.trim());
  } finally {
    const del = await get(`${API}/api/auth/account`, { method: "DELETE", headers: { ...json, cookie }, body: JSON.stringify({ confirm: EMAIL }) });
    check("the throwaway account is deleted", del.status === 200, String(del.status));
    const after = await get(`${API}/api/auth/session`, { headers: authed });
    check("its session no longer works", after.status === 401, String(after.status));
  }
}

async function oldDashboard(): Promise<void> {
  if (!OLD) return;
  const res = await get(`${OLD}/applications/smoke`);
  const to = res.headers.get("location") ?? "";
  check("the old dashboard address redirects to the site, keeping the path", res.status >= 300 && res.status < 400 && to.startsWith(SITE) && to.includes("/applications/smoke"), `${res.status} ${to}`);
}

for (const step of [site, api, account, oldDashboard]) {
  try {
    await step();
  } catch (err) {
    check(`${step.name} ran`, false, err instanceof Error ? err.message : String(err));
  }
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.name.padEnd(width)}  ${c.ok ? "" : (c.detail ?? "")}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
