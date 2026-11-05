// QA for Privacy and Terms (legal-pages-spec.md section 10): status and metadata, the parser's refusals, the texts'
// facts against the code, every section and table row rendered, the contents list, links, tables and cards, zoom,
// print, Nori, axe, keyboard and budgets, in Chromium, Firefox and WebKit.
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-legal.mjs [--base …] [--browsers …] [--only …]
// Writes test-results/qa-legal/report.json and screenshots; exits 1 if any check fails.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "..", "..");
const OUT = join(APP, "test-results", "qa-legal");
const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? "1") : fallback;
};
const BASE = arg("base", "http://localhost:3401");
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = arg("browsers", "chromium,firefox,webkit").split(",");
const ONLY = arg("only", "status,parser,facts,matrix,links,print,nori,axe,keyboard,performance").split(",");
const AXE = require.resolve("axe-core/axe.min.js");
const PAGES = ["privacy", "terms"];

mkdirSync(OUT, { recursive: true });
const results = [];
const check = (where, what, ok, detail) => results.push({ ok: !!ok, where, what, detail });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The parser on the real texts and on broken copies (tests/check-legal.ts, run with tsx). */
const parsed = JSON.parse(execFileSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "tests", "check-legal.ts")], { cwd: APP, encoding: "utf8" }));
const text = Object.fromEntries(PAGES.map((n) => [n, readFileSync(join(APP, "content", "legal", `${n}.md`), "utf8").replace(/\s+/g, " ")]));

async function statuses() {
  for (const n of PAGES) {
    const where = `/${n}`;
    const res = await fetch(`${BASE}/${n}`);
    const html = await res.text();
    check(where, "200", res.status === 200, res.status);
    check(where, "title", html.includes(`<title>${parsed.docs[n].title} · Norinote</title>`), html.match(/<title>[^<]*/)?.[0]);
    check(where, "canonical", new RegExp(`<link rel="canonical" href="[^"]*/${n}"`).test(html), html.match(/<link rel="canonical"[^>]*>/)?.[0]);
    check(where, "indexable (no robots noindex)", !/<meta name="robots"[^>]*noindex/.test(html), html.match(/<meta name="robots"[^>]*>/)?.[0]);
    check(where, "a description", /<meta name="description" content="[^"]{40,}"/.test(html), html.match(/<meta name="description"[^>]*>/)?.[0]);
    // The page's text, without its scripts (React's payload is full of "[[").
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");
    check(where, "no unsettled [[…]] text", !visible.includes("[["), visible.match(/.{0,40}\[\[.{0,40}/)?.[0]);
  }
  const manifest = join(APP, ".next-qa", "prerender-manifest.json");
  const routes = existsSync(manifest) ? Object.keys(JSON.parse(readFileSync(manifest, "utf8")).routes) : [];
  check("build", "both pages prerendered", PAGES.every((n) => routes.includes(`/${n}`)), routes.filter((r) => /privacy|terms/.test(r)));
}

function parser() {
  const b = parsed.broken;
  check("parser", "unsettled text fails a production build", /unsettled text \[\[a gap\]\]/.test(b.unsettledInProduction ?? ""), b.unsettledInProduction);
  check("parser", "unsettled text is allowed in development (shown as a mark)", b.unsettledInDevelopment === null, b.unsettledInDevelopment);
  for (const k of ["subheading", "numberedList", "gapInNumbers", "badLink", "badDate"]) check("parser", `refuses: ${k}, naming file and line`, /^content\/legal\/privacy\.md:\d+: /.test(b[k] ?? ""), b[k]);
}

/** What the texts say, against the code that makes it true. Reads the source; changes nothing. */
function facts() {
  const src = (p) => readFileSync(join(REPO, p), "utf8");
  const sessionDays = src("apps/api/src/config.ts").match(/sessionDays:\s*(\d+)/)?.[1];
  check("facts", `session length: ${sessionDays} days in the API, the same in the privacy text`, sessionDays && text.privacy.includes(`| ${sessionDays} days, or until you sign out |`), sessionDays);
  const retention = src("packages/inbox/src/retention.ts");
  const days = retention.match(/else (\d+)/)?.[1];
  check("facts", `inbox kept ${days} days by default, as the text says`, days && text.privacy.includes(`${days} days by default`), days);
  const range = src("apps/api/src/routes/inbox.ts").match(/retentionDays: z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)/);
  check("facts", `retention setting ${range?.[1]} to ${range?.[2]} days, as the text says`, range && text.privacy.includes(`you can choose ${range[1]} to ${range[2]}`), range?.slice(1));
  const drivers = ["greenhouse", "lever", "ashby"].filter((d) => existsSync(join(REPO, "packages", "apply", "src", "drivers", `${d}.ts`)));
  check("facts", "Greenhouse, Lever and Ashby: the drivers packages/apply has", drivers.length === 3 && text.terms.includes("Greenhouse, Lever and Ashby"), drivers);
  check("facts", "passwords: scrypt, as the text says", /scrypt\(/.test(src("apps/api/src/auth/password.ts")) && text.privacy.includes("scrypt"), null);
  check("facts", "the session cookie is httpOnly, as the text says", /httpOnly: true/.test(src("apps/api/src/auth/session.ts")) && text.privacy.includes("can't be read by scripts"), null);
  const auth = src("apps/api/src/routes/auth.ts");
  check("facts", "deleting the account deletes its files too", /deleteAccountFiles\(/.test(auth) && text.privacy.includes("including your stored resumes and the screenshots of your applications"), null);
}

async function open(browser, path, ctx = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctx });
  await context.addInitScript(() => {
    window.__rows = [];
    setInterval(() => {
      const rows = [...document.querySelectorAll(".nori *")].map((el) => el.style?.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1]).filter(Boolean);
      const row = rows.at(-1);
      if (row && window.__rows.at(-1) !== row) window.__rows.push(row);
    }, 100);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  return { context, page, errors };
}

const SIZES = [[320, 640], [390, 844], [768, 1024], [1024, 768], [1440, 900], [720, 450]];

async function matrix(engine, browser) {
  for (const n of PAGES) {
    for (const [w, h] of SIZES) {
      const where = `${engine} /${n} ${w}x${h}`;
      const { context, page, errors } = await open(browser, `/${n}`, { viewport: { width: w, height: h } });
      await wait(600);
      const r = await page.evaluate(() => {
        const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        return {
          h1: [...document.querySelectorAll("h1")].map((x) => x.textContent),
          ids: [...document.querySelectorAll("main section > h2[id]")].map((x) => x.id).filter((id) => id !== "in-short"),
          toc: [...document.querySelectorAll('nav[aria-labelledby="on-this-page"] a')].map((a) => a.getAttribute("href")),
          sideways: document.documentElement.scrollWidth > innerWidth,
          tables: [...document.querySelectorAll(".legal-table")].map(visible),
          cards: [...document.querySelectorAll(".legal-cards")].map(visible),
          rows: [...document.querySelectorAll(".legal-table tbody th")].map((x) => x.textContent.trim().slice(0, 30)),
          cardRows: [...document.querySelectorAll(".legal-cards > li")].length,
          navLinks: [...document.querySelectorAll('header nav[aria-label="Main"] a')].map((a) => a.getAttribute("href")),
          date: document.querySelector("time")?.getAttribute("datetime"),
        };
      });
      const doc = parsed.docs[n];
      check(where, "one h1, the title", r.h1.length === 1 && r.h1[0] === doc.title, r.h1);
      check(where, "every section, with its id", JSON.stringify(r.ids) === JSON.stringify(doc.ids), r.ids);
      check(where, "the contents list links each section", JSON.stringify(r.toc) === JSON.stringify(doc.ids.map((i) => `#${i}`)), r.toc);
      check(where, "no sideways page scroll", !r.sideways, null);
      const wide = w >= 768;
      check(where, wide ? "tables, not cards" : "cards, not tables", r.tables.every((v) => v === wide) && r.cards.every((v) => v === !wide), { tables: r.tables, cards: r.cards });
      check(where, "every table row rendered (as a row and as a card)", r.rows.length === doc.rows.length && r.cardRows === doc.rows.length, { rows: r.rows.length, cards: r.cardRows, want: doc.rows.length });
      check(where, "the date", r.date === doc.updated, r.date);
      check(where, "the nav's section links go to the home page", r.navLinks.every((l) => l.startsWith("/#")), r.navLinks);
      check(where, "no errors in the console", errors.length === 0, errors.slice(0, 3));
      if ((w === 390 || w === 1440) && engine === "chromium") await page.screenshot({ path: join(OUT, `${n}-${w}.png`) });
      await context.close();
    }
  }
}

async function links(engine, browser) {
  for (const n of PAGES) {
    const where = `${engine} /${n} links`;
    const { context, page } = await open(browser, `/${n}`);
    const id = parsed.docs[n].ids[2];
    await page.locator(`nav[aria-labelledby="on-this-page"] a[href="#${id}"]`).click();
    await wait(500);
    const r = await page.evaluate((id) => ({ top: Math.round(document.getElementById(id).getBoundingClientRect().top), hash: location.hash }), id);
    check(where, "a contents link brings its heading below the nav", r.hash === `#${id}` && r.top >= 64 && r.top < 220, r);
    // Following a fragment moves the focus starting point: the next Tab lands after the heading.
    await page.keyboard.press("Tab");
    const after = await page.evaluate((id) => {
      const el = document.activeElement;
      return !!el && el !== document.body && !!(document.getElementById(id).compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, id);
    check(where, "the next Tab lands after that heading", after, null);
    if (engine === "chromium") {
      const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll("main a")].map((a) => a.getAttribute("href")))]);
      const internal = hrefs.filter((h) => h.startsWith("/"));
      const statuses = await Promise.all(internal.map(async (h) => [h, (await fetch(`${BASE}${h.split("#")[0] || "/"}`)).status]));
      check(where, "in-site links answer 200", statuses.every(([, s]) => s === 200), statuses);
      const mails = hrefs.filter((h) => h.startsWith("mailto:"));
      check(where, "email addresses are mailto links", mails.length > 0 && mails.every((m) => /^mailto:[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(m)), mails);
      check(where, "no other kinds of link", hrefs.every((h) => /^(\/|#|mailto:|https:\/\/)/.test(h)), hrefs);
    }
    await context.close();
  }
}

async function print(browser) {
  for (const n of PAGES) {
    for (const w of [390, 1440]) {
      const where = `chromium /${n} ${w} print`;
      const { context, page } = await open(browser, `/${n}`, { viewport: { width: w, height: 900 } });
      await wait(2500);
      await page.emulateMedia({ media: "print" });
      const r = await page.evaluate(() => {
        const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
        return { nav: shown("header.fixed"), footer: shown("footer"), nori: shown(".nori"), toc: shown('nav[aria-labelledby="on-this-page"]'), tables: [...document.querySelectorAll(".legal-table")].every((el) => el.getClientRects().length > 0), cards: shown(".legal-cards"), h1: shown("h1") };
      });
      check(where, "the text alone: no nav, footer, Nori or contents", r.h1 && !r.nav && !r.footer && !r.nori && !r.toc, r);
      check(where, "tables as tables, never cards", r.tables && !r.cards, r);
      if (w === 390 && n === "privacy") await page.pdf({ path: join(OUT, "privacy.pdf") }).catch(() => {});
      await context.close();
    }
  }
}

async function nori(engine, browser) {
  for (const n of PAGES) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const where = `${engine} /${n} ${w}x${h} Nori`;
      const { context, page } = await open(browser, `/${n}`, { viewport: { width: w, height: h } });
      await wait(4500);
      const r = await page.evaluate(() => {
        const seat = document.querySelector('[data-nori-seat="legal"]').getBoundingClientRect();
        const title = document.querySelector("h1").getBoundingClientRect();
        const nori = document.querySelector(".nori")?.getBoundingClientRect();
        return {
          rows: window.__rows,
          bubble: !!document.querySelector(".nori .is-in"),
          near: nori ? Math.abs(nori.left + nori.width / 2 - seat.left) < 40 && Math.abs(nori.bottom - seat.top) < 40 : false,
          clear: nori ? nori.left >= title.right - 4 || nori.top >= title.bottom : false,
          nori: nori && [Math.round(nori.left), Math.round(nori.top), Math.round(nori.width)],
          seat: [Math.round(seat.left), Math.round(seat.top)],
        };
      });
      check(where, "seated beside the title", r.near, r);
      check(where, "not over the title", r.clear, r);
      check(where, "reading (read, still going)", r.rows.at(-1) === "read", r.rows);
      check(where, "never a bubble", !r.bubble, null);
      await context.close();
    }
  }
  if (engine !== "chromium") return;
  const where = "chromium /privacy reduced motion";
  const { context, page } = await open(browser, "/privacy", { reducedMotion: "reduce" });
  await wait(4500);
  const frames = [];
  for (let i = 0; i < 6; i++) {
    frames.push(await page.evaluate(() => [...document.querySelectorAll(".nori *")].map((el) => `${el.style?.backgroundImage}|${el.style?.backgroundPosition}`).filter((s) => s.includes("rows/")).join(";")));
    await wait(300);
  }
  check(where, "Nori holds still", new Set(frames).size === 1 && frames[0].includes("read"), [...new Set(frames)].map((f) => f.slice(0, 120)));
  await context.close();
}

async function axe(browser) {
  for (const n of PAGES) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const where = `chromium /${n} ${w}x${h} axe`;
      const { context, page } = await open(browser, `/${n}`, { viewport: { width: w, height: h } });
      await wait(2500);
      await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(async () => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
      const v = r.violations.map((x) => ({ id: x.id, help: x.help, nodes: x.nodes.slice(0, 4).map((nd) => nd.target.join(" ")) }));
      check(where, "axe: no violations", v.length === 0, v.length ? v : `${r.passes.length} rules pass`);
      const outline = await page.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4")].map((x) => `${x.tagName} ${x.textContent.trim().slice(0, 24)}`));
      const want = ["H1 " + parsed.docs[n].title, "H2 In short", "H2 On this page"];
      check(where, "outline: the title, In short, On this page, then each section as an h2", want.every((t, i) => outline[i] === t) && outline.slice(3).every((t) => /^H2 \d+\. /.test(t)), outline);
      await context.close();
    }
  }
}

async function keyboard(browser) {
  const where = "chromium /privacy keyboard";
  const { context, page } = await open(browser, "/privacy");
  const stops = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(cs.boxShadow) };
    }));
  }
  const seen = stops.filter(Boolean);
  const order = ["Skip to content", "Norinote, home", "How it works", "Pricing", "FAQ", "Sign in", "Get started", "Who we are", "What we collect and why"];
  let last = -1;
  const inOrder = order.every((nm) => {
    const j = seen.findIndex((s, k) => k > last && s.name.startsWith(nm));
    if (j < 0) return false;
    last = j;
    return true;
  });
  check(where, `in order: ${order.join(", ")}`, inOrder, seen.map((s) => s.name));
  check(where, "every stop shows the focus ring", seen.every((s) => s.ring), seen.filter((s) => !s.ring).map((s) => s.name));
  await context.close();
}

async function performance(browser) {
  for (const n of PAGES) {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
      const where = `chromium /${n} ${w}x${h} 4G, 4x CPU`;
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        window.__lcp = 0;
        window.__cls = 0;
        new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(`${BASE}/${n}`, { waitUntil: "load" });
      await wait(800);
      const kb = await page.evaluate(() => Math.round((performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) / 1024));
      const heaviest = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => `${Math.round(e.transferSize / 1024)} KB ${e.name.split("/").pop().slice(0, 40)}`).sort((x, y) => parseInt(y) - parseInt(x)).slice(0, 8));
      await wait(4000);
      const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)) }));
      check(where, "under 450 KB before the first interaction", kb > 0 && kb <= 450, kb <= 450 ? `${kb} KB` : { kb, heaviest });
      check(where, "LCP under 1.5 s", r.lcp > 0 && r.lcp <= 1500, `${r.lcp} ms`);
      check(where, "CLS under 0.05", r.cls <= 0.05, r.cls);
      await context.close();
    }
  }
}

if (ONLY.includes("status")) await statuses();
if (ONLY.includes("parser")) parser();
if (ONLY.includes("facts")) facts();
for (const name of BROWSERS) {
  let browser;
  try {
    browser = await ENGINES[name].launch(name === "chromium" ? { channel: "chromium" } : {});
  } catch (e) {
    check(name, "browser launches", false, String(e.message).split("\n")[0]);
    continue;
  }
  if (ONLY.includes("matrix")) await matrix(name, browser);
  if (ONLY.includes("links")) await links(name, browser);
  if (ONLY.includes("nori")) await nori(name, browser);
  if (name === "chromium") {
    if (ONLY.includes("print")) await print(browser);
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
