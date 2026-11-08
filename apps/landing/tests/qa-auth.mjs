// Phase 5 QA for sign-in and sign-up (auth-design-spec.md section 16): the size matrix in Chromium, Firefox and WebKit,
// every API answer from section 9 (the API mocked with Playwright routes), Nori's form reactions, axe, keyboard,
// reduced motion, text spacing, LCP, CLS and weight on a throttled phone, and optionally one real end-to-end run.
// Runs against a production build made with the API's URL:
//   NEXT_PUBLIC_API_URL=http://localhost:4100 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-auth.mjs [--base http://localhost:3401] [--api http://localhost:4100] [--browsers chromium,firefox,webkit]
//     [--e2e <api log file>]   also sign up, sign out, sign in and reset for real; the API must run with
//                              WEB_URL=<base> and print its email links to that log (no RESEND_API_KEY)
// Writes test-results/qa-auth/report.json and screenshots; exits 1 if any check fails.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-auth");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3401");
const API = arg("api", "http://localhost:4101");
const E2E_LOG = arg("e2e", null);
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = arg("browsers", "chromium,firefox,webkit").split(",");
// --only flows,axe,… runs just those sections (for working on one); the default is everything.
const ONLY = arg("only", "matrix,flows,axe,keyboard,motion,spacing,performance,e2e").split(",");
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const ALL_SIZES = [
  [360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1366, 640], [1440, 900], [1920, 1080], [2560, 1440], [720, 450],
];
const PAGES = [
  { path: "/signup", sizes: ALL_SIZES },
  { path: "/signin", sizes: ALL_SIZES },
  { path: "/forgot-password", sizes: [[390, 844], [1440, 900]] },
  { path: "/reset-password?token=qa-token-123456", sizes: [[390, 844], [1440, 900]] },
  { path: "/verify-email?token=qa-token-123456", sizes: [[390, 844], [1440, 900]] },
];
const OFFLINE = "Couldn't reach Norinote. Check your connection and try again.";

mkdirSync(OUT, { recursive: true });
const results = [];
const fail = (where, what, detail) => results.push({ ok: false, where, what, detail });
const pass = (where, what, detail) => results.push({ ok: true, where, what, detail });
const check = (where, what, ok, detail) => (ok ? pass : fail)(where, what, detail);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Answers the API's routes from `answers` ({ "POST /auth/login": { status, body } | "abort" }). Unlisted routes: the
 * session is signed out and everything else is ok. Preflights are answered with the CORS headers the API sends.
 */
async function mockApi(context, answers = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const calls = [];
  let signedIn = false;
  await context.route(`${API}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api/, "")}`;
    calls.push({ key, body: req.postData() });
    const fallback = key === "GET /auth/session" ? (signedIn ? { status: 200, body: { user: { id: "u1", email: "qa@example.test" } } } : { status: 401, body: { error: "Not signed in" } }) : key === "GET /onboarding" ? { status: 200, body: { step: "resume" } } : { status: 200, body: { ok: true, user: { id: "u1", email: "qa@example.test" } } };
    const a = answers[key] ?? fallback;
    if (a === "abort") return route.abort("connectionrefused");
    // A successful sign-in or sign-up signs the browser in, as the API's cookie would.
    if ((key === "POST /auth/login" || key === "POST /auth/signup") && a.status < 300) signedIn = true;
    return route.fulfill({ status: a.status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(a.body) });
  });
  return calls;
}

/** Where things are on an auth page, read in the page. */
function layout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const nori = document.querySelector(".nori");
    const seat = [...document.querySelectorAll('[data-nori-seat="auth"]')].find((el) => el.getClientRects().length);
    const imgs = [...document.querySelectorAll("img")].filter((i) => i.currentSrc.includes("/scenes/"));
    const shown = imgs.find((i) => i.getClientRects().length && i.closest("div")?.getClientRects().length && i.offsetParent !== null);
    return {
      vw: innerWidth,
      vh: innerHeight,
      docW: document.documentElement.scrollWidth,
      tucked: !!nori?.classList.contains("is-tucked"),
      nori: box(nori),
      size: nori ? nori.getBoundingClientRect().width : 0,
      seat: seat ? (({ x, y }) => ({ x, y }))(seat.getBoundingClientRect()) : null,
      controls: [...document.querySelectorAll("main input, main button, main a[href], main h1, header a[href], [role=alert]")]
        .filter((el) => el.getClientRects().length && !el.closest(".nori"))
        .map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().slice(0, 30), ...box(el) })),
      firstField: box(document.querySelector("main input")),
      h1: box(document.querySelector("main h1")),
      scene: shown ? { complete: shown.complete, natural: shown.naturalWidth, src: shown.currentSrc.split("/").pop() } : null,
      scenesFetched: performance.getEntriesByType("resource").filter((e) => e.name.includes("/scenes/")).map((e) => e.name.split("/").pop()),
    };
  });
}

const overlap = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;

async function matrix(browserName, browser) {
  for (const p of PAGES) {
    for (const [w, h] of p.sizes) {
      const where = `${browserName} ${p.path.split("?")[0]} ${w}x${h}`;
      const context = await browser.newContext({ viewport: { width: w, height: h } });
      await mockApi(context, { "POST /auth/verify-email": { status: 200, body: { ok: true } } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(BASE + p.path, { waitUntil: "load" });
      await wait(2500); // Nori loads and sits on the seat
      const L = await layout(page);
      check(where, "no sideways scroll", L.docW <= L.vw + 1, `${L.docW} > ${L.vw}`);
      check(where, "headline in the first screen", !!L.h1 && L.h1.y + L.h1.h <= L.vh, L.h1);
      // Not at 720 × 450 (a 1440 × 900 screen at 200% zoom), where scrolling to the form is expected.
      if (L.firstField && h >= 600) check(where, "first field in the first screen", L.firstField.y + L.firstField.h <= L.vh, L.firstField);
      check(where, "scene loaded", !!L.scene?.complete && L.scene.natural > 0, L.scene);
      // The hidden scene (the column on narrow screens, the band on wide ones) is never fetched.
      const wantBand = w < 1024;
      const wrong = L.scenesFetched.filter((f) => (wantBand ? !/-band-/.test(f) : /-band-/.test(f)));
      check(where, "only the visible scene is fetched", wrong.length === 0, { fetched: L.scenesFetched });
      if (!L.tucked && L.nori) {
        const covered = L.controls.filter((c) => overlap(L.nori, c, 6)).map((c) => c.name);
        check(where, "Nori clear of every field, button, link and heading", covered.length === 0, covered);
        if (L.seat) {
          const dx = Math.abs(L.nori.x + L.nori.w / 2 - L.seat.x);
          const dy = Math.abs(L.nori.y + L.nori.h - (L.seat.y + L.size * 0.04));
          check(where, "Nori sits on the seat", dx < 8 && dy < 8, { dx: Math.round(dx), dy: Math.round(dy) });
        }
      }
      const real = errors.filter((e) => !/favicon|status of 401/i.test(e));
      check(where, "no console errors", real.length === 0, real);
      if (browserName === "chromium") await page.screenshot({ path: join(OUT, `${p.path.split("?")[0].slice(1)}-${w}x${h}.png`) });
      await context.close();
    }
  }
}

/** Opens a page with the given API answers; returns the page and the API calls it made. */
async function open(browser, path, answers = {}, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const calls = await mockApi(context, answers);
  const page = await context.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  await wait(1800);
  return { context, page, calls };
}

/** The row Nori is playing, read from its sprite (production builds have no debug handle). */
const noriRow = (page) =>
  page.evaluate(() => {
    const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
    return sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1] ?? null;
  });
// Inside main: Playwright's selectors also reach Next's route announcer (an empty role="alert" in a shadow root).
const quietly = (what) => (e) => (console.error(`  (${what}: ${String(e.message).split("\n")[0]})`), null);
const alertText = (page) => page.locator("main [role=alert]").first().textContent({ timeout: 4000 }).catch(quietly("alert"));
const h1 = (page) => page.locator("main h1").first().textContent({ timeout: 4000 }).catch(quietly("h1"));
/** Waits for the page's headline to read `text` (a panel replacing a form); true when it does. */
const heading = (page, text) => page.locator("main h1", { hasText: text }).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
/** Waits until the path (not the query) is `path`. */
const landsOn = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 8000 }).then(() => true, () => false);

async function flows(browser) {
  const W = "chromium flows";
  // Sign-up: checks on submit, focus on the first problem.
  {
    const { context, page, calls } = await open(browser, "/signup");
    await page.click("text=Create account");
    await wait(300);
    const r = await page.evaluate(() => ({ focus: document.activeElement?.id, email: document.getElementById("signup-email-note")?.textContent, invalid: document.getElementById("signup-email").getAttribute("aria-invalid") }));
    check(W, "sign-up: empty submit shows the email error and focuses it", r.focus === "signup-email" && /Enter an email address/.test(r.email ?? "") && r.invalid === "true", r);
    await page.fill("#signup-email", "qa@example.test");
    await page.fill("#signup-password", "short");
    await page.click("text=Create account");
    await wait(300);
    const p = await page.evaluate(() => ({ focus: document.activeElement?.id, note: document.getElementById("signup-password-note")?.textContent }));
    check(W, "sign-up: a short password is caught before the API", p.focus === "signup-password" && p.note === "Use at least 8 characters" && !calls.some((c) => c.key === "POST /auth/signup"), p);
    await context.close();
  }
  for (const [label, answer, expect, link] of [
    ["email taken", { status: 409, body: { error: "An account with this email already exists. Sign in instead." } }, "An account with this email already exists.", "/signin"],
    ["too many tries", { status: 429, body: { error: "Too many accounts created from this address. Try again later." } }, "Too many accounts created from this address. Try again later.", null],
    ["offline", "abort", OFFLINE, null],
  ]) {
    const { context, page } = await open(browser, "/signup", { "POST /auth/signup": answer });
    await page.fill("#signup-email", "qa@example.test");
    await page.fill("#signup-password", "test-pass-123");
    await page.click("text=Create account");
    const text = await alertText(page);
    const href = await page.locator("main [role=alert] a").first().getAttribute("href", { timeout: 1000 }).catch(() => null);
    check(W, `sign-up: ${label}`, text?.trim().startsWith(expect) && href === link && !/Sign in instead\. Sign in instead/.test(text ?? ""), { text, href });
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/signup?plan=pro", { "POST /auth/signup": { status: 201, body: { user: { id: "u1", email: "qa@example.test" } } } });
    check(W, "sign-up: ?plan=pro shows the plan chip", await page.locator("text=Pro selected").isVisible(), null);
    await page.fill("#signup-email", "qa@example.test");
    await page.fill("#signup-password", "test-pass-123");
    await page.click("text=Create account");
    check(W, "sign-up: success opens onboarding", await landsOn(page, "/onboarding"), page.url());
    await context.close();
  }
  // Sign-in: wrong password; then where success goes (onboarding, dashboard, a safe ?next=, never an unsafe one).
  {
    const { context, page } = await open(browser, "/signin", { "POST /auth/login": { status: 401, body: { error: "Incorrect email or password" } } });
    await page.fill("#signin-email", "qa@example.test");
    await page.fill("#signin-password", "wrong-pass");
    await page.click("button[type=submit]");
    check(W, "sign-in: wrong password", (await alertText(page))?.trim() === "Incorrect email or password", null);
    await context.close();
  }
  for (const [label, path, step, dest] of [
    ["onboarding not finished", "/signin", "resume", "/onboarding"],
    ["onboarding done", "/signin", "done", "/overview"],
    ["a safe ?next=", "/signin?next=/privacy", "resume", "/privacy"],
    ["an unsafe ?next=", "/signin?next=//evil.example", "resume", "/onboarding"],
  ]) {
    const { context, page } = await open(browser, path, { "POST /auth/login": { status: 200, body: { user: { id: "u1", email: "qa@example.test" } } }, "GET /onboarding": { status: 200, body: { step } } });
    await page.fill("#signin-email", "qa@example.test");
    await page.fill("#signin-password", "test-pass-123");
    await page.click("button[type=submit]");
    check(W, `sign-in: ${label} goes to ${dest}`, await landsOn(page, dest), page.url());
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/signup", { "GET /auth/session": { status: 200, body: { user: { id: "u1" } } }, "GET /onboarding": { status: 200, body: { step: "done" } } });
    check(W, "signed in already: /signup moves on to the dashboard", await landsOn(page, "/overview"), page.url());
    await context.close();
  }
  // The email carries over between sign-in, sign-up and forgot (client-side navigation).
  {
    const { context, page } = await open(browser, "/signin");
    await page.fill("#signin-email", "carry@example.test");
    await page.click("text=Forgot password?");
    await page.waitForURL("**/forgot-password");
    await wait(500);
    check(W, "the email carries over to forgot password", (await page.inputValue("#forgot-email")) === "carry@example.test", null);
    check(W, "the email is never in the URL", !page.url().includes("carry"), page.url());
    await context.close();
  }
  // Forgot: the same panel for any address.
  {
    const { context, page } = await open(browser, "/forgot-password");
    await page.fill("#forgot-email", "anyone@example.test");
    await page.click("text=Send link");
    check(W, "forgot: the check-your-inbox panel", await heading(page, "Check your inbox"), await h1(page));
    await context.close();
  }
  // Reset: no token, an expired token, then success. The token leaves the address bar.
  {
    const { context, page } = await open(browser, "/reset-password");
    check(W, "reset: no token shows the expired panel", (await h1(page))?.trim() === "This link has expired", null);
    await context.close();
  }
  {
    const { context, page, calls } = await open(browser, "/reset-password?token=qa-token-123456", { "POST /auth/reset-password": { status: 400, body: { error: "This reset link is invalid or has expired. Ask for a new one." } } });
    check(W, "reset: the token is removed from the address bar", !page.url().includes("token"), page.url());
    await page.fill("#reset-password", "new-pass-456");
    await page.click("text=Save password");
    const text = await alertText(page);
    check(W, "reset: an expired token offers a new link", /invalid or has expired/.test(text ?? "") && (await page.locator("main [role=alert] a").getAttribute("href")) === "/forgot-password", text);
    check(W, "reset: the token read from the link is the one sent", calls.some((c) => c.key === "POST /auth/reset-password" && c.body?.includes("qa-token-123456")), calls.map((c) => c.key));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/reset-password?token=qa-token-123456");
    await page.fill("#reset-password", "new-pass-456");
    await page.click("text=Save password");
    check(W, "reset: success ends at sign-in", (await heading(page, "Password changed")) && (await page.locator("main a").first().getAttribute("href")) === "/signin", await h1(page));
    await context.close();
  }
  // Verify: ok, expired, and the token is removed.
  for (const [label, answer, title] of [
    ["ok", { status: 200, body: { ok: true } }, "Email confirmed"],
    ["expired", { status: 400, body: { error: "This confirmation link is invalid or has expired." } }, "This link has expired"],
  ]) {
    const { context, page } = await open(browser, "/verify-email?token=qa-token-123456", { "POST /auth/verify-email": answer });
    check(W, `verify: ${label}`, (await heading(page, title)) && !page.url().includes("token"), { title: await h1(page), url: page.url() });
    await context.close();
  }
  // Show / Hide keeps the caret where it was, and Nori reads along, covers its eyes and peeks.
  {
    const { context, page } = await open(browser, "/signin");
    await page.click("#signin-email");
    await page.keyboard.type("nori@example.test", { delay: 20 });
    await wait(300);
    const reading = await noriRow(page);
    await page.click("#signin-password");
    await page.keyboard.type("abc");
    await wait(700);
    const covering = await noriRow(page);
    await page.click("button[aria-controls=signin-password]");
    await wait(400);
    await page.keyboard.type("def");
    await wait(700);
    const peeking = await noriRow(page);
    await page.click("button[aria-controls=signin-password]");
    await wait(400);
    await page.keyboard.type("ghi");
    check(W, "Show and Hide keep the caret in place", (await page.inputValue("#signin-password")) === "abcdefghi", await page.inputValue("#signin-password"));
    check(W, "Nori reads along, covers its eyes and peeks", reading === "type-along" && /^(cover|covered)$/.test(covering ?? "") && peeking === "peek", { reading, covering, peeking });
    await context.close();
  }
}

async function axe(browser) {
  const runs = [
    ["/signup", null], ["/signin", null], ["/forgot-password", null], ["/reset-password?token=qa-token-123456", null], ["/verify-email?token=qa-token-123456", null],
    ["/signup", "error"],
  ];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const [path, state] of runs) {
      const where = `chromium ${path.split("?")[0]}${state ? ` (${state})` : ""} ${w}x${h} axe`;
      const { context, page } = await open(browser, path, { "POST /auth/signup": { status: 409, body: { error: "An account with this email already exists. Sign in instead." } } }, { viewport: { width: w, height: h } });
      if (state === "error") {
        await page.fill("#signup-email", "qa@example.test");
        await page.fill("#signup-password", "short");
        await page.click("text=Create account");
        await wait(300);
        await page.fill("#signup-password", "test-pass-123");
        await page.click("text=Create account");
        await wait(800);
      }
      await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(async () => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
      const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
      check(where, "axe: no violations", v.length === 0, v.length ? v : `${r.passes.length} rules pass, ${r.incomplete.length} need a person`);
      await context.close();
    }
  }
}

async function keyboard(browser) {
  const stopInfo = () => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      name: (el.getAttribute("aria-label") || el.id || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 32),
      ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(cs.boxShadow),
      size: [Math.round(r.width), Math.round(r.height)],
    };
  };
  for (const path of ["/signup", "/signin"]) {
    const where = `chromium ${path} 1440x900 keyboard`;
    const prefix = path.slice(1);
    const { context, page } = await open(browser, path);
    // From 1024 px the email field has focus on arrival (auth spec section 11).
    check(where, "the email field has focus on arrival", (await page.evaluate(() => document.activeElement?.id)) === `${prefix}-email`, await page.evaluate(() => document.activeElement?.id));
    // Back to the start: the switch link, the logo, then the skip link.
    const back = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab");
      back.push(await page.evaluate(stopInfo));
    }
    check(where, "before the form: the switch link, the logo, the skip link", back.map((b) => b?.name).join(" < ") === `${path === "/signup" ? "Sign in" : "Create an account"} < Norinote, home < Skip to content`, back.map((b) => b?.name));
    const forward = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      forward.push(await page.evaluate(stopInfo));
    }
    const order = forward.filter(Boolean).map((s) => s.name);
    const want = path === "/signup" ? ["signup-email", "Show password", "Create account"] : ["signin-email", "Forgot password?", "signin-password", "Show password", "Sign in"];
    const idx = want.map((n) => order.indexOf(n));
    check(where, "fields, Show and the button in order", idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), order);
    const seen = [...back, ...forward].filter(Boolean);
    const noRing = seen.filter((s) => !s.ring);
    check(where, "every stop shows the focus ring", noRing.length === 0, [...new Set(noRing.map((s) => s.name))]);
    // Links inside a sentence (Terms, Privacy) are exempt from 2.5.8; everything else is at least 24 px.
    const small = seen.filter((s) => (s.size[0] < 24 || s.size[1] < 24) && !/^(Terms|Privacy)$/.test(s.name));
    check(where, "targets at least 24 px (WCAG 2.5.8)", small.length === 0, small);
    await context.close();
  }
}

async function reducedMotion(browser) {
  const where = "chromium /signin 1440x900 reduced motion";
  const { context, page } = await open(browser, "/signin", {}, { reducedMotion: "reduce" });
  const r = await page.evaluate(() => ({
    nori: getComputedStyle(document.querySelector(".nori")).transitionDuration,
    scene: [...document.querySelectorAll(".scene-in")].map((el) => getComputedStyle(el).animationDuration),
  }));
  check(where, "Nori moves without gliding", /^(0s|1e-05s|0\.00001s)/.test(r.nori), r.nori);
  check(where, "the scene appears without fading", r.scene.every((d) => /^(0s|1e-05s|0\.00001s)/.test(d)), r.scene);
  await context.close();
}

async function textSpacing(browser) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const path of ["/signup", "/signin"]) {
      const where = `chromium ${path} ${w}x${h} text spacing`;
      const { context, page } = await open(browser, path, {}, { viewport: { width: w, height: h } });
      await page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}" });
      await wait(500);
      const r = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        vw: innerWidth,
        clipped: [...document.querySelectorAll("a, button, h1, p, label")]
          .filter((el) => el.getClientRects().length && !el.closest(".nori, .sr-only") && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible")
          .map((el) => (el.textContent || "").trim().slice(0, 40)),
      }));
      check(where, "no sideways scroll with text spacing", r.docW <= r.vw + 1, `${r.docW} > ${r.vw}`);
      check(where, "no clipped text with text spacing", r.clipped.length === 0, r.clipped);
      await context.close();
    }
  }
}

/** Auth spec section 13: LCP under 2.0 s on 4G with a 4x slower CPU, CLS under 0.05, under 450 KB first. */
async function performance(browser) {
  for (const [path, w, h, mobile] of [["/signup", 390, 844, true], ["/signin", 390, 844, true], ["/signup", 1440, 900, false]]) {
    const where = `chromium ${path} ${w}x${h} 4G, 4x CPU`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    await mockApi(context);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__lcp = 0;
      window.__lcpEl = null;
      window.__cls = 0;
      new PerformanceObserver((l) =>
        l.getEntries().forEach((e) => {
          window.__lcp = e.startTime;
          window.__lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.url ? ` ${e.url.split("/").pop()}` : ""}` : null;
        }),
      ).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE + path, { waitUntil: "load" });
    await wait(800);
    const kb = await page.evaluate(() => Math.round((performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) / 1024));
    await wait(4000);
    const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), el: window.__lcpEl, cls: Number(window.__cls.toFixed(3)) }));
    check(where, "LCP under 2.0 s", r.lcp <= 2000, `${r.lcp} ms (${r.el})`);
    check(where, "CLS under 0.05", r.cls <= 0.05, r.cls);
    // 450 KB in auth spec section 13. /signup is allowed 455: the shared stylesheet grew with the v2 dashboard, putting it
    // 2 KB over on phones, and the user accepted that on 2026-11-07.
    const budget = path === "/signup" ? 455 : 450;
    check(where, `under ${budget} KB before the first interaction`, kb <= budget, `${kb} KB`);
    await context.close();
  }
}

/** One real run against a local API (no mocks): sign up, sign out, sign in, forgot and reset with the emailed link. */
async function endToEnd(browser) {
  const W = "chromium end to end";
  if (!existsSync(E2E_LOG)) return fail(W, "API log readable", E2E_LOG);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const email = `qa-${Date.now()}@example.test`;
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", "first-pass-123");
  await page.click("text=Create account");
  check(W, "sign up, then onboarding", await landsOn(page, "/onboarding"), page.url());
  await page.evaluate((api) => fetch(`${api}/api/auth/logout`, { method: "POST", credentials: "include" }), API);
  await page.goto(`${BASE}/forgot-password`, { waitUntil: "load" });
  await page.fill("#forgot-email", email);
  await page.click("text=Send link");
  await page.locator("text=Check your inbox").waitFor({ timeout: 6000 }).catch(() => {});
  await wait(800);
  const link = [...readFileSync(E2E_LOG, "utf8").matchAll(/https?:\/\/\S+\/reset-password\?token=[\w%-]+/g)].at(-1)?.[0];
  check(W, "the API emailed a reset link", !!link, null);
  if (link) {
    await page.goto(link, { waitUntil: "load" });
    await wait(1000);
    await page.fill("#reset-password", "second-pass-456");
    await page.click("text=Save password");
    check(W, "reset the password", await heading(page, "Password changed"), await h1(page));
  }
  await page.goto(`${BASE}/signin`, { waitUntil: "load" });
  await page.fill("#signin-email", email);
  await page.fill("#signin-password", "second-pass-456");
  await page.click("button[type=submit]");
  check(W, "sign in with the new password", await landsOn(page, "/onboarding"), page.url());
  await context.close();
}

for (const name of BROWSERS) {
  let browser;
  try {
    browser = await ENGINES[name].launch(name === "chromium" ? { channel: "chromium" } : {});
  } catch (e) {
    fail(name, "browser launches", String(e.message).split("\n")[0]);
    continue;
  }
  if (ONLY.includes("matrix")) await matrix(name, browser);
  if (name === "chromium") {
    if (ONLY.includes("flows")) await flows(browser);
    if (ONLY.includes("axe")) await axe(browser);
    if (ONLY.includes("keyboard")) await keyboard(browser);
    if (ONLY.includes("motion")) await reducedMotion(browser);
    if (ONLY.includes("spacing")) await textSpacing(browser);
    if (ONLY.includes("performance")) await performance(browser);
    if (E2E_LOG && ONLY.includes("e2e")) await endToEnd(browser);
  }
  await browser.close();
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`FAIL ${f.where}: ${f.what}\n     ${JSON.stringify(f.detail)?.slice(0, 400)}`);
for (const p of results.filter((r) => r.ok && r.detail && /LCP|CLS|KB|axe/.test(r.what + r.detail))) console.log(`ok   ${p.where}: ${p.what} (${p.detail})`);
process.exitCode = failed.length ? 1 : 0;
