// Phase 5 QA for the error pages (error-pages-spec.md section 12): page not found outside the dashboard and under each
// section, something broke outside and inside it (caused for real: the mocked API answers with a malformed body, so a
// page throws), at 11 sizes in Chromium, Firefox and WebKit, light and dark for the shell; HTTP 404s; Try again
// recovering and failing again; focus; that no error text reaches the page; Nori; axe; keyboard; budgets; and the
// failing-to-start page rendered on its own.
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-errors.mjs [--base …] [--api …] [--browsers …] [--only …]
// Writes test-results/qa-errors/report.json and screenshots; exits 1 if any check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-errors");
const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1]?.startsWith("--") ? "1" : (process.argv[i + 1] ?? "1")) : fallback;
};
const BASE = arg("base", "http://localhost:3401");
const API = arg("api", "http://localhost:4101");
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = arg("browsers", "chromium,firefox,webkit").split(",");
const ONLY = arg("only", "status,matrix,flows,axe,keyboard,performance,global").split(",");
const AXE = require.resolve("axe-core/axe.min.js");
const ALL_SIZES = [
  [360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1366, 640], [1440, 900], [1920, 1080], [2560, 1440], [720, 450],
];
// Words a broken page must never show: what the thrown error says.
const LEAKS = /TypeError|undefined|is not a function|Cannot read|stack|digest|at \w+ \(/;

mkdirSync(OUT, { recursive: true });
const results = [];
const fail = (where, what, detail) => results.push({ ok: false, where, what, detail });
const pass = (where, what, detail) => results.push({ ok: true, where, what, detail });
const check = (where, what, ok, detail) => (ok ? pass : fail)(where, what, detail);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A signed-in, onboarded account. `o.badLanes`: the lanes come back without their titles, so onboarding's done page
 * throws (until `fixed()` is called). `o.badInbox`: the inbox comes back as an object, not a list, so the Inbox throws.
 */
async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" };
  let broken = true;
  const user = { id: "u1", email: "alex@example.test", name: "Alex Rivera", emailVerifiedAt: "2026-11-01T09:00:00.000Z", createdAt: "2026-11-01T09:00:00.000Z" };
  await context.route(`${API}/api/**`, (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api/, "")}`;
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) }).catch(() => {});
    if (key === "GET /auth/session") return reply(200, { user });
    if (key === "GET /onboarding") return reply(200, { step: "done", profile: { fullName: "Alex Rivera", preferences: {}, workAuth: {}, eeo: {} } });
    if (key === "GET /me") return reply(200, { user, profile: { fullName: "Alex Rivera" } });
    if (key === "GET /agent/status") return reply(200, { dailyCap: 5, usedToday: 2, liveSubmit: false });
    if (key === "GET /lanes") return reply(200, o.badLanes && broken ? [{ id: "l1", name: "Product design" }] : [{ id: "l1", name: "Product design", titles: ["Product designer"], locations: ["New York, NY"], remote: true, minFit: 0.7, enabled: true }]);
    if (key === "GET /inbox") return reply(200, o.badInbox && broken ? { messages: "not a list" } : []);
    if (key === "GET /inbox/address") return reply(200, { address: "alex@inbox.norinote.test", configured: true, settings: { forwardTo: null, forwardEnabled: false, retentionDays: null } });
    if (key === "GET /graph") return reply(200, { nodes: [], edges: [] });
    if (key === "GET /shortlist" || key === "GET /applications") return reply(200, []);
    return reply(200, {});
  });
  return { fixed: () => (broken = false) };
}

async function open(browser, path, o = {}, ctx = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctx });
  const mock = await mockApi(context, o);
  await context.addInitScript(() => {
    window.__rows = [];
    setInterval(() => {
      const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
      const row = sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1];
      if (row && window.__rows.at(-1) !== row) window.__rows.push(row);
    }, 100);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|404/.test(m.text()) && errors.push(m.text()));
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  await wait(o.settle ?? 1800);
  return { context, page, errors, status: res?.status() ?? 0, ...mock };
}
const h1 = (page) => page.locator("h1").first().innerText().catch(() => "");
const played = (page) => page.evaluate(() => window.__rows ?? []);

// The pages: where, what kind, which mock breaks it, and the heading it shows.
const LOST = "This page isn’t here";
const BROKE = "Something went wrong on this page";
const PAGES = [
  { name: "not found", path: "/nowhere-at-all", h1: LOST, shell: false },
  { name: "not found, dashboard", path: "/today/old", h1: LOST, shell: true },
  { name: "something broke", path: "/onboarding/done", o: { badLanes: true }, h1: BROKE, shell: false },
  { name: "something broke, dashboard", path: "/inbox", o: { badInbox: true }, h1: BROKE, shell: true },
];
// The thrown error is expected on the broken pages; anything else is not.
const realErrors = (errors, p) => errors.filter((e) => !/favicon/i.test(e) && !(p.o && /lane|titles|join|filter|map|not a function|undefined|Cannot read|error boundary|The above error|JSHandle@object/i.test(e)));

// ---- status codes -------------------------------------------------------------------------------------------------------

async function statuses() {
  const where = "http";
  const codes = {};
  for (const path of ["/nowhere-at-all", "/today/old", "/you/settings", "/applications/a1/extra", "/inbox/m1/extra", "/overview", "/settings/search", "/applications/a1"]) {
    const r = await fetch(BASE + path, { redirect: "manual" });
    codes[path] = r.status;
    if (path === "/nowhere-at-all") {
      const html = await r.text();
      check(where, "the 404 is not indexed", /<meta name="robots" content="noindex/.test(html), html.match(/<meta name="robots"[^>]*>/)?.[0]);
      check(where, "the 404's title", html.includes("<title>Page not found · Norinote</title>"), html.match(/<title>[^<]*<\/title>/)?.[0]);
    }
  }
  check(where, "unknown addresses answer 404, outside and under each section", ["/nowhere-at-all", "/today/old", "/you/settings", "/applications/a1/extra", "/inbox/m1/extra"].every((p) => codes[p] === 404), codes);
  check(where, "real pages still answer 200 (static routes win over the catch-alls)", ["/overview", "/settings/search", "/applications/a1"].every((p) => codes[p] === 200), codes);
}

// ---- the size matrix ----------------------------------------------------------------------------------------------------

async function matrix(name, browser) {
  for (const p of PAGES) {
    const runs = [...ALL_SIZES.map((s) => [s, "light"]), ...(p.shell ? [[[390, 844], "dark"], [[1440, 900], "dark"]] : [])];
    for (const [[w, h], scheme] of runs) {
      const where = `${name} ${p.name} ${w}x${h} ${scheme}`;
      const { context, page, errors } = await open(browser, p.path, p.o, { viewport: { width: w, height: h }, colorScheme: scheme });
      await page.locator("h1", { hasText: p.h1 }).waitFor({ timeout: 6000 }).catch(() => {});
      await wait(700);
      const L = await page.evaluate(() => {
        const box = (el) => {
          if (!el || !el.getClientRects().length) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const nori = document.querySelector(".nori");
        const seat = [...document.querySelectorAll("[data-nori-seat]")].find((el) => el.getClientRects().length && el.getBoundingClientRect().width < 4);
        return {
          vw: innerWidth,
          vh: innerHeight,
          docW: document.documentElement.scrollWidth,
          h1s: document.querySelectorAll("h1").length,
          text: document.querySelector("main")?.innerText ?? "",
          bg: getComputedStyle(document.querySelector(".app-theme") ?? document.body).backgroundColor,
          nori: box(nori),
          tucked: !!nori?.classList.contains("is-tucked"),
          size: nori ? nori.getBoundingClientRect().width : 0,
          seat: seat ? { name: seat.dataset.noriSeat, ...(({ x, y }) => ({ x, y }))(seat.getBoundingClientRect()) } : null,
          h1: box(document.querySelector("h1")),
          fixed: [...document.querySelectorAll("h1, main a, main button, nav a")].filter((el) => el.getClientRects().length && !el.closest(".nori")).map((el) => ({ name: (el.textContent || "").trim().slice(0, 30), ...box(el) })).filter((c) => c.y < innerHeight && c.y + c.h > 0),
        };
      });
      check(where, "no sideways scroll", L.docW <= L.vw + 1, `${L.docW} > ${L.vw}`);
      check(where, `one h1: ${p.h1}`, L.h1s === 1 && L.text.includes(p.h1), { h1s: L.h1s, text: L.text.slice(0, 120) });
      if (L.h1) check(where, "the heading in the first screen", L.h1.y + L.h1.h <= L.vh, L.h1);
      check(where, "no error text on the page", !LEAKS.test(L.text), L.text.slice(0, 300));
      if (p.shell) check(where, `the ${scheme} theme`, scheme === "dark" ? L.bg === "rgb(15, 26, 21)" : L.bg === "rgb(251, 244, 234)", L.bg);
      if (!L.tucked && L.nori) {
        const covered = L.fixed.filter((c) => c.x < L.nori.x + L.nori.w - 6 && L.nori.x < c.x + c.w - 6 && c.y < L.nori.y + L.nori.h - 6 && L.nori.y < c.y + c.h - 6).map((c) => c.name);
        check(where, "Nori clear of the heading, buttons and navigation", covered.length === 0, covered);
        if (L.seat) {
          const want = p.shell ? (w >= 1024 ? "rail" : "head") : "error";
          const dx = Math.abs(L.nori.x + L.nori.w / 2 - L.seat.x);
          const dy = Math.abs(L.nori.y + L.nori.h - (L.seat.y + L.size * 0.04));
          check(where, `Nori sits on its seat (${want})`, dx < 8 && dy < 8 && L.seat.name === want, { dx: Math.round(dx), dy: Math.round(dy), seat: L.seat.name });
        }
      } else if (!p.shell) check(where, "Nori is on the page", !!L.nori, null);
      const real = realErrors(errors, p);
      check(where, "no unexpected console errors", real.length === 0, real);
      if (name === "chromium") await page.screenshot({ path: join(OUT, `${p.name.replace(/[ ,]+/g, "-")}-${w}x${h}-${scheme}.png`) });
      await context.close();
    }
  }
}

// ---- flows --------------------------------------------------------------------------------------------------------------

async function flows(browser) {
  const W = "chromium flows";
  {
    const { context, page } = await open(browser, "/nowhere-at-all");
    const links = await page.locator("main a").evaluateAll((as) => as.map((a) => `${a.textContent?.trim()} → ${a.getAttribute("href")}`));
    check(W, "not found: Go to the home page and Open your dashboard", JSON.stringify(links) === JSON.stringify(["Go to the home page → /", "Open your dashboard → /overview"]), links);
    check(W, "a fresh 404 doesn't move focus", (await page.evaluate(() => document.activeElement?.tagName)) !== "H1", null);
    await page.waitForFunction(() => window.__rows.includes("look"), null, { timeout: 5000 }).catch(() => {});
    check(W, "Nori looks around", (await played(page)).includes("look"), await played(page));
    check(W, "Nori says it", await page.getByText("Hmm, nothing here.").first().isVisible().catch(() => false), null);
    check(W, "no landing-page choreography on a 404", !(await page.locator("#hero").count()), null);
    await context.close();
  }
  {
    const { context, page, fixed } = await open(browser, "/onboarding/done", { badLanes: true });
    check(W, "something broke: the full page", (await h1(page)) === BROKE && (await page.locator("main").innerText()).includes("It’s not you."), await h1(page));
    check(W, "focus moves to the heading", (await page.evaluate(() => document.activeElement?.tagName)) === "H1", await page.evaluate(() => document.activeElement?.tagName));
    check(W, "the title", (await page.title()) === "Something went wrong · Norinote", await page.title());
    await page.waitForFunction(() => window.__rows.includes("comfort"), null, { timeout: 6000 }).catch(() => {});
    const rows = await played(page);
    check(W, "Nori: dizzy, then comfort", rows.includes("dizzy") && rows.indexOf("comfort") > rows.indexOf("dizzy"), rows);
    // Still broken: Try again shows the page again, unchanged.
    await page.getByRole("button", { name: "Try again" }).click();
    await wait(1500);
    check(W, "Try again while still broken: the error page again", (await h1(page)) === BROKE, await h1(page));
    // The API answers properly now: Try again recovers.
    fixed();
    await page.getByRole("button", { name: "Try again" }).click();
    const back = await page.locator("main", { hasText: "Product designer" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(W, "Try again once the API answers: the page is back", back && (await h1(page)) !== BROKE, await page.locator("main").innerText().catch(() => ""));
    check(W, "after Try again, the page that came back plays its own reaction", (await played(page)).includes("celebrate"), await played(page));
    await context.close();
  }
  {
    const { context, page, fixed } = await open(browser, "/inbox", { badInbox: true });
    check(W, "something broke in the shell: the rail stays", (await h1(page)) === BROKE && (await page.locator("nav[aria-label=Dashboard] a", { hasText: "Overview" }).first().isVisible()), await h1(page));
    const links = await page.locator("main a").evaluateAll((as) => as.map((a) => `${a.textContent?.trim()} → ${a.getAttribute("href")}`));
    check(W, "in the shell: Go to Overview", links.includes("Go to Overview → /overview"), links);
    fixed();
    await page.getByRole("button", { name: "Try again" }).click();
    const back = await page.locator("main", { hasText: "Nothing here yet" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(W, "in the shell, Try again recovers", back, await page.locator("main").innerText().catch(() => ""));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/you/settings");
    check(W, "an unknown You address: the in-shell 404", (await h1(page)) === LOST && (await page.locator("main a", { hasText: "Go to Overview" }).count()) === 1, await h1(page));
    await page.locator("main a", { hasText: "Go to Overview" }).click();
    check(W, "Go to Overview works", await page.waitForURL((u) => u.pathname === "/overview", { timeout: 6000 }).then(() => true, () => false), page.url());
    await context.close();
  }
}

// ---- accessibility, keyboard, performance ---------------------------------------------------------------------------------

async function axe(browser) {
  for (const p of PAGES) {
    for (const scheme of p.shell ? ["light", "dark"] : ["light"]) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        const where = `chromium ${p.name} ${w}x${h} ${scheme} axe`;
        const { context, page } = await open(browser, p.path, p.o, { viewport: { width: w, height: h }, colorScheme: scheme });
        await page.addScriptTag({ path: AXE });
        const r = await page.evaluate(async () => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
        const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
        check(where, "axe: no violations", v.length === 0, v.length ? v : `${r.passes.length} rules pass`);
        await context.close();
      }
    }
  }
}

async function keyboard(browser) {
  for (const [path, o, order] of [["/nowhere-at-all", {}, ["Skip to content", "Norinote, home", "Go to the home page", "Open your dashboard"]], ["/onboarding/done", { badLanes: true }, ["Try again", "Go to the home page"]]]) {
    const where = `chromium ${path} keyboard`;
    const { context, page } = await open(browser, path, o);
    const stops = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(cs.boxShadow), size: [Math.round(r.width), Math.round(r.height)] };
      }));
    }
    const seen = stops.filter(Boolean);
    let last = -1;
    const inOrder = order.every((n) => {
      const j = seen.findIndex((s, k) => k > last && s.name.startsWith(n));
      if (j < 0) return false;
      last = j;
      return true;
    });
    check(where, `in order: ${order.join(", ")}`, inOrder, seen.map((s) => s.name));
    check(where, "every stop shows the focus ring", seen.every((s) => s.ring), seen.filter((s) => !s.ring).map((s) => s.name));
    check(where, "targets at least 24 px", seen.every((s) => s.size[0] >= 24 && s.size[1] >= 24), seen.filter((s) => s.size[0] < 24 || s.size[1] < 24));
    await context.close();
  }
}

/** Weighs a page in the 4G, 4x CPU conditions at 1.6 s after load, without Nori's strips (they load once a page settles). */
async function weighed(browser, path, o, [w, h, mobile]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  await mockApi(context, o);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await wait(1600);
  const list = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => !e.name.includes("/nori/rows/")).map((e) => [e.name.split("/").pop().split("?")[0], Math.round((e.transferSize || 0) / 1024)]));
  await context.close();
  return { kb: list.reduce((t, x) => t + x[1], 0), names: new Map(list) };
}

async function performance(browser) {
  for (const [path, o] of [["/nowhere-at-all", {}], ["/onboarding/done", { badLanes: true }], ["/today/old", {}]]) {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
      const where = `chromium ${path} ${w}x${h} 4G, 4x CPU`;
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
      await mockApi(context, o);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        window.__lcp = 0;
        window.__cls = 0;
        window.__shifts = [];
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
        window.__brokeAt = 0;
        new MutationObserver(() => {
          if (!window.__brokeAt && document.querySelector("h1")?.textContent?.startsWith("Something went wrong")) window.__brokeAt = performance.now();
        }).observe(document, { subtree: true, childList: true, characterData: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => {
          if (e.hadRecentInput) return;
          window.__cls += e.value;
          window.__shifts.push(`${Math.round(e.startTime)}ms ${e.value.toFixed(3)} ${(e.sources ?? []).map((x) => x.node?.textContent?.trim().slice(0, 24) ?? x.node?.nodeName).join(" | ")}`);
        })).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await wait(800);
      const kb = await page.evaluate(() => Math.round((performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) / 1024));
      const heaviest = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => `${Math.round(e.transferSize / 1024)} KB ${e.name.split("/").pop().slice(0, 40)}`).sort((x, y) => parseInt(y) - parseInt(x)).slice(0, 8));
      await wait(4000);
      const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), shifts: window.__shifts }));
      check(where, "LCP under 2.0 s", r.lcp <= 2000, `${r.lcp} ms`);
      check(where, "CLS under 0.05", r.cls <= 0.05, r.cls <= 0.05 ? r.cls : { cls: r.cls, shifts: r.shifts });
      if (o.badLanes) {
        // What the error page adds: the broken visit against the same page that didn't break, both 1.6 s after load and
        // without Nori's strips. The difference is the error page's code and the fork scene.
        const broken = await weighed(browser, path, o, [w, h, mobile]);
        const fine = await weighed(browser, path, {}, [w, h, mobile]);
        const added = broken.kb - fine.kb;
        const extra = [...broken.names].filter(([n]) => !fine.names.has(n)).map(([n, k]) => `${k} KB ${n.slice(0, 40)}`);
        check(where, "the error page adds under 120 KB to the page that broke (not counting Nori's strips)", added <= 120, { added: `${added} KB`, broken: broken.kb, fine: fine.kb, extra });
      } else check(where, "under 450 KB before the first interaction", kb > 0 && kb <= 450, kb > 0 && kb <= 450 ? `${kb} KB` : { kb, heaviest });
      await context.close();
    }
  }
}

/** Failing to start can't be caused in a working build, so the page is rendered on its own and its HTML checked. */
function globalError() {
  const where = "global-error (rendered on its own)";
  const tsx = require.resolve("tsx/cli");
  const script = join(APP, "tests", "render-global-error.tsx");
  let html = "";
  try {
    html = execFileSync(process.execPath, [tsx, script], { cwd: APP, encoding: "utf8" });
  } catch (e) {
    return fail(where, "it renders", String(e.message).slice(0, 300));
  }
  check(where, "its own document", html.startsWith("<html lang=\"en\">") && html.includes("<body>"), html.slice(0, 80));
  check(where, "the words", ["Norinote couldn’t load", "Check your connection, then try again.", "Try again", "<title>Norinote</title>"].every((t) => html.includes(t)), html.slice(0, 600));
  check(where, "loads nothing: no images, stylesheets, scripts or fonts", !/<img|<link|<script|url\(|@import|@font-face/.test(html), html.match(/<img|<link|<script|url\(|@import|@font-face/g));
  check(where, "the Dawn colours and system fonts", ["#FBF4EA", "#1F2A24", "#55605A", "#2F5D46", "system-ui"].every((t) => html.includes(t)), null);
  check(where, "not indexed", html.includes("<meta name=\"robots\" content=\"noindex\"/>"), html.match(/<meta[^>]*robots[^>]*>/)?.[0]);
}

if (ONLY.includes("status")) await statuses();
if (ONLY.includes("global")) globalError();
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
    if (ONLY.includes("performance")) await performance(browser);
  }
  await browser.close();
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`FAIL ${f.where}: ${f.what}\n     ${JSON.stringify(f.detail)?.slice(0, 400)}`);
for (const p of results.filter((r) => r.ok && r.detail && /LCP|CLS|KB/.test(r.what + r.detail))) console.log(`ok   ${p.where}: ${p.what} (${p.detail})`);
process.exitCode = failed.length ? 1 : 0;
