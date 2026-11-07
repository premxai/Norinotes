// Phase 5 QA for dashboard part 4a (dashboard-4a-spec.md section 15): the shell and /today at 11 sizes in Chromium,
// Firefox and WebKit, light and dark; every live-panel state with the API mocked as a small state machine (the run log
// grows as it's polled); dismiss and Undo; Send all; the guards; polling paused while hidden; axe in both themes;
// keyboard; LCP, CLS and weight; and optionally a real run against a local API (sign up, onboard, land on Today).
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-today.mjs [--base …] [--api …] [--browsers …] [--only …] [--e2e]
// Writes test-results/qa-today/report.json and screenshots; exits 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-today");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1]?.startsWith("--") ? "1" : (process.argv[i + 1] ?? "1")) : fallback;
};
const BASE = arg("base", "http://localhost:3401");
const API = arg("api", "http://localhost:4101");
const E2E = arg("e2e", null);
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = arg("browsers", "chromium,firefox,webkit").split(",");
const ONLY = arg("only", "matrix,flows,axe,keyboard,performance,e2e").split(",");
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
// A fixed morning, so the greeting, the strip and "posted … ago" are the same on every run.
const MORNING = new Date("2026-11-04T09:00:00");

const ALL_SIZES = [
  [360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1366, 640], [1440, 900], [1920, 1080], [2560, 1440], [720, 450],
];

mkdirSync(OUT, { recursive: true });
const results = [];
const fail = (where, what, detail) => results.push({ ok: false, where, what, detail });
const pass = (where, what, detail) => results.push({ ok: true, where, what, detail });
const check = (where, what, ok, detail) => (ok ? pass : fail)(where, what, detail);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the mocked API ---------------------------------------------------------------------------------------------------

const hoursAgo = (h) => new Date(MORNING.getTime() - h * 3_600_000).toISOString();
const job = (id, title, company, location, remote, posted) => ({ id, companyName: company, title, location, remote, applyUrl: `https://jobs.example.test/${id}`, postedAt: hoursAgo(posted), descriptionText: `${title} at ${company}. A small team rebuilding how customers check out. `.repeat(30) });
const ENTRIES = [
  { id: "s2", jobId: "j2", fit: 0.81, reasons: ["Built a design system used by four product teams", "Remote, as you prefer", "A third reason"], status: "new", createdAt: hoursAgo(2), widenedBy: null, locationNames: [], job: job("j2", "UX designer", "Halden Labs", null, true, 26) },
  { id: "s1", jobId: "j1", fit: 0.86, reasons: ["Led research for a checkout redesign, like this role asks", "Figma and design systems: both must-haves covered"], status: "new", createdAt: hoursAgo(2), widenedBy: null, locationNames: [], job: job("j1", "Product designer", "Fernway", "Brooklyn, NY", false, 9) },
  { id: "s3", jobId: "j3", fit: 0.78, reasons: ["Owned a component library end to end", "Hybrid, inside your area"], status: "new", createdAt: hoursAgo(2), widenedBy: null, locationNames: [], job: job("j3", "Design systems designer", "Mirro", "New York, NY", false, 50) },
];
const STEPS = ["Opened the application page", "Filled 9 fields", "Uploaded your tailored resume", "Answered 2 questions from your answer bank", "Submitting"];

/**
 * The API as a state machine. `o.outcome`: sent | needs | wall | failed. `o.entries`, `o.apps` (already existing),
 * `o.signedOut`, `o.onboarding`, `o.unverified`, `o.offline` (the shortlist fails). `o.emailsCode`: after Submit the
 * employer emails a verification code, and the run waits until it's typed (POST /applications/:id/code). The live view
 * (GET /applications/:id/live) sends a frame while the run is on the employer's page and after it; `o.liveDelay`: that
 * many requests 404 first; `o.liveGap`: every third request 404s. `o.countUrls` counts object URLs made and revoked.
 * `o.gmailCode`: a connected Gmail supplies the emailed code by itself. `o.oldJob`: what GET /jobs/<id> sends
 * for a job not on the list (a job, or null for a 404).
 */
async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const calls = [];
  const apps = new Map();
  const entries = o.entries ?? ENTRIES;
  let seq = 0;
  const add = (jobId, status = "queued") => {
    const id = `a${++seq}`;
    const j = entries.find((e) => e.jobId === jobId)?.job ?? ENTRIES[0].job;
    apps.set(id, { app: { id, jobId, status, pendingQuestions: [], receipt: null, error: null, preparedAt: null, approvedAt: null, submittedAt: null, createdAt: MORNING.toISOString(), updatedAt: MORNING.toISOString() }, job: j, events: [], polls: 0, step: 0 });
    return apps.get(id);
  };
  for (const [jobId, status, error] of o.apps ?? []) Object.assign(add(jobId, status).app, error ? { error } : {});
  const event = (a, message, level = "info") => a.events.push({ id: String(a.events.length + 1), ts: MORNING.toISOString(), level, step: message === "Submitting" ? "submit" : message.startsWith("The employer emailed") ? "verification" : "run", message });
  /** One poll moves it on, the way the worker would. */
  const advance = (a) => {
    a.polls += 1;
    const s = a.app.status;
    if (s === "queued") {
      a.app.status = "preparing";
      event(a, "Tailoring your resume");
    } else if (s === "preparing") {
      Object.assign(a.app, { status: "prepared", preparedAt: MORNING.toISOString() });
      event(a, "Reading the application form");
    }
    if (s === "applying") {
      event(a, STEPS[a.step] ?? "Working");
      a.step += 1;
      if (a.step === 2 && o.outcome === "needs" && !a.answered) Object.assign(a.app, { status: "needs_user", pendingQuestions: [{ id: "q1", text: "Can you work from the Brooklyn office 3 days a week?", type: "boolean", options: [], required: true }, { id: "q2", text: "Portfolio link", type: "text", options: [], required: true }] });
      else if (a.step === 2 && o.outcome === "wall") Object.assign(a.app, { status: "needs_user", pendingQuestions: [], error: "This site asked for a captcha." });
      else if (a.step === 3 && o.outcome === "failed" && !a.retried) Object.assign(a.app, { status: "failed", error: "The page stopped responding while Nori was uploading your resume." });
      else if (a.step >= STEPS.length) {
        a.app.status = o.emailsCode ? "awaiting_code" : "sent";
        if (o.emailsCode) event(a, "The employer emailed a verification code");
      }
    }
    if (a.app.status === "sent" || (s === "awaiting_code" && (a.typed || o.gmailCode))) {
      if (a.typed) event(a, "Using the code you typed");
      else if (s === "awaiting_code") event(a, "Found the code in your Gmail (from no-reply@us.greenhouse-mail.io); entering it");
      Object.assign(a.app, { status: "submitted", submittedAt: new Date(Date.parse(a.app.approvedAt ?? MORNING.toISOString()) + 18_000).toISOString(), receipt: { confirmation: "FW-20931" } });
    }
  };
  await context.route(`${API}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api/, "")}`;
    const body = req.postData();
    calls.push({ key, body, at: Date.now() });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) });
    if (o.signedOut && key !== "POST /auth/logout") return reply(401, { error: "Not signed in" });
    const user = { id: "u1", email: "alex@example.test", name: "Alex Rivera", emailVerifiedAt: o.unverified ? null : MORNING.toISOString(), createdAt: MORNING.toISOString() };
    if (key === "GET /auth/session") return reply(200, { user });
    if (key === "GET /onboarding") return reply(200, { step: o.onboarding ?? "done", profile: {} });
    if (key === "GET /me") return reply(200, { user, profile: { fullName: "Alex Rivera" } });
    if (key === "GET /agent/status") return reply(200, { dailyCap: o.cap ?? 0, usedToday: 2, liveSubmit: false });
    if (key === "GET /shortlist") return o.offline ? route.abort("connectionrefused") : reply(200, entries);
    if (key === "GET /shortlist/meta") return reply(200, { total: entries.length, widened: o.widened ? ["role_pool"] : [], lanesMatched: 3, poolUsed: false });
    if (/^POST \/shortlist\/.+\/dismiss$/.test(key)) return reply(200, { ok: true });
    if (/^GET \/jobs\//.test(key)) {
      const listed = entries.find((e) => key.endsWith(`/${e.jobId}`))?.job;
      if (!listed && "oldJob" in o) return o.oldJob ? reply(200, o.oldJob) : reply(404, { error: "Job not found" });
      return reply(200, listed ?? ENTRIES[0].job);
    }
    if (key === "GET /applications") return reply(200, [...apps.values()].reverse().map((a) => ({ application: a.app, job: a.job, resume: null })));
    if (key === "POST /applications") return reply(201, add(JSON.parse(body ?? "{}").jobId).app);
    const live = key.match(/^GET \/applications\/(a\d+)\/live$/);
    if (live) {
      const a = apps.get(live[1]);
      const running = !!a && ["applying", "awaiting_code"].includes(a.app.status);
      if (a) a.livePolls = (a.livePolls ?? 0) + 1;
      if (running) a.ran = true;
      const shown = !!a && (running || a.ran) && a.livePolls > (o.liveDelay ?? 0) && !(o.liveGap && a.livePolls % 3 === 0);
      if (!shown) return reply(404, { error: "No live view" });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png", "cache-control": "no-store" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
    }
    const typed = key.match(/^POST \/applications\/(a\d+)\/code$/);
    if (typed) {
      const a = apps.get(typed[1]);
      if (a?.app.status !== "awaiting_code") return reply(409, { error: "This application is not waiting for a code" });
      a.typed = true;
      return reply(200, { ok: true });
    }
    const m = key.match(/^(GET|POST) \/applications\/(a\d+)(?:\/(approve|answer|retry))?$/);
    if (m) {
      const a = apps.get(m[2]);
      if (!a) return reply(404, { error: "Application not found" });
      if (m[3] === "approve") Object.assign(a.app, { status: "applying", approvedAt: MORNING.toISOString() });
      else if (m[3] === "answer") {
        a.answered = true;
        Object.assign(a.app, { status: "applying", pendingQuestions: [] });
      } else if (m[3] === "retry") {
        Object.assign(a, { retried: true, step: 0 });
        Object.assign(a.app, { status: "applying", error: null });
      }
      else advance(a);
      if (m[3]) return reply(200, { ok: true, status: a.app.status });
      return reply(200, { application: a.app, job: a.job, resume: { changes: [{ before: "Led checkout research", after: "Led research and design for the checkout redesign", reason: "The role asks for end-to-end research" }] }, events: a.events });
    }
    if (key === "POST /auth/logout" || key === "POST /auth/resend-verification") return reply(200, { ok: true });
    return reply(200, { ok: true });
  });
  return { calls, apps };
}

async function open(browser, path, o = {}, ctx = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctx });
  const mock = await mockApi(context, o);
  if (o.countUrls)
    await context.addInitScript(() => {
      window.__urls = { made: 0, revoked: 0 };
      const make = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (b) => (window.__urls.made++, make(b));
      URL.revokeObjectURL = (u) => (window.__urls.revoked++, revoke(u));
    });
  const page = await context.newPage();
  await page.clock.setFixedTime(MORNING);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE + path, { waitUntil: "load" });
  await wait(o.settle ?? 1800);
  return { context, page, errors, ...mock };
}

const landsOn = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 8000 }).then(() => true, () => false);
const panelText = (page) => page.locator("[data-live-panel]").innerText().catch(() => "");
const waitPanel = (page, text, ms = 10000) => page.locator("[data-live-panel]", { hasText: text }).waitFor({ timeout: ms }).then(() => true, () => false);
const noriRow = (page) =>
  page.evaluate(() => {
    const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
    return sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1] ?? null;
  });
const overlap = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;

// ---- the size matrix --------------------------------------------------------------------------------------------------

async function matrix(name, browser) {
  const runs = [...ALL_SIZES.map((s) => [s, "light"]), [[390, 844], "dark"], [[1440, 900], "dark"]];
  for (const [[w, h], scheme] of runs) {
    const where = `${name} /today ${w}x${h} ${scheme}`;
    const { context, page, errors } = await open(browser, "/today", { cap: 5 }, { viewport: { width: w, height: h }, colorScheme: scheme });
    await page.locator("main li button", { hasText: "Product designer" }).first().waitFor({ timeout: 6000 }).catch(() => {});
    await wait(900);
    const L = await page.evaluate(() => {
      const box = (el) => {
        if (!el || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const nori = document.querySelector(".nori");
      const seat = [...document.querySelectorAll('[data-nori-seat="rail"], [data-nori-seat="strip"]')].find((el) => el.getClientRects().length);
      const strip = [...document.querySelectorAll("main img")].find((i) => i.getClientRects().length && i.closest("div")?.offsetParent !== null);
      const tabs = [...document.querySelectorAll('nav[aria-label="Dashboard"]')].map((n) => (n.getClientRects().length ? getComputedStyle(n).position : null));
      return {
        vw: innerWidth,
        vh: innerHeight,
        docW: document.documentElement.scrollWidth,
        bg: getComputedStyle(document.querySelector(".app-theme")).backgroundColor,
        tucked: !!nori?.classList.contains("is-tucked"),
        nori: box(nori),
        size: nori ? nori.getBoundingClientRect().width : 0,
        seat: seat ? { name: seat.dataset.noriSeat, ...(({ x, y }) => ({ x, y }))(seat.getBoundingClientRect()) } : null,
        h1: box(document.querySelector("main h1")),
        controls: [...document.querySelectorAll("main button, main a[href], main h1, nav a, nav summary")]
          .filter((el) => el.getClientRects().length && !el.closest(".nori"))
          .map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), ...box(el) }))
          .filter((c) => c.y < innerHeight && c.y + c.h > 0),
        strip: strip ? { complete: strip.complete, natural: strip.naturalWidth, src: strip.currentSrc.split("/").pop() } : null,
        scenes: performance.getEntriesByType("resource").filter((e) => e.name.includes("/scenes/")).map((e) => e.name.split("/").pop()),
        tabs,
      };
    });
    check(where, "no sideways scroll", L.docW <= L.vw + 1, `${L.docW} > ${L.vw}`);
    check(where, "greeting in the first screen", !!L.h1 && L.h1.y + L.h1.h <= L.vh, L.h1);
    check(where, `the ${scheme} theme`, scheme === "dark" ? L.bg === "rgb(15, 26, 21)" : L.bg === "rgb(251, 244, 234)", L.bg);
    check(where, "the strip loaded", !!L.strip?.complete && L.strip.natural > 0, L.strip);
    const wrongStrip = L.scenes.filter((f) => (scheme === "dark" ? f.startsWith("footer") : f.startsWith("night")));
    check(where, "only this theme's strip is fetched", wrongStrip.length === 0, L.scenes);
    check(where, w < 768 ? "bottom tabs on phones" : "the rail from 768 px", w < 768 ? L.tabs.includes("fixed") : L.tabs.includes("sticky"), L.tabs);
    if (!L.tucked && L.nori) {
      const covered = L.controls.filter((c) => overlap(L.nori, c, 6)).map((c) => c.name);
      check(where, "Nori clear of every button, link and heading", covered.length === 0, covered);
      if (L.seat) {
        const dx = Math.abs(L.nori.x + L.nori.w / 2 - L.seat.x);
        const dy = Math.abs(L.nori.y + L.nori.h - (L.seat.y + L.size * 0.04));
        check(where, `Nori sits on its seat (${L.seat.name})`, dx < 8 && dy < 8 && L.seat.name === (w >= 1024 ? "rail" : "strip"), { dx: Math.round(dx), dy: Math.round(dy), seat: L.seat.name });
      }
    }
    const real = errors.filter((e) => !/favicon/i.test(e));
    check(where, "no console errors", real.length === 0, real);
    if (name === "chromium") await page.screenshot({ path: join(OUT, `today-${w}x${h}-${scheme}.png`) });
    await context.close();
  }
}

// ---- flows ------------------------------------------------------------------------------------------------------------

async function flows(browser) {
  const W = "chromium flows";
  // Today: greeting, day line, order, reasons, posted.
  {
    const { context, page } = await open(browser, "/today", { cap: 5 });
    const text = await page.locator("main").innerText();
    check(W, "greeting by time of day and name", (await page.locator("main h1").textContent()) === "Good morning, Alex", await page.locator("main h1").textContent());
    check(W, "the day line", text.includes("3 for today · 2 of 5 sent today"), text.slice(0, 200));
    // The title button's own text, without its screen-reader fit.
    const titles = await page.locator("main ul > li > button").evaluateAll((els) => els.map((el) => el.firstChild?.textContent ?? ""));
    check(W, "cards by fit, highest first", titles.join(",") === "Product designer,UX designer,Design systems designer", titles);
    // The card's shape: three across at 1440, one row of equal cards whose rules and Apply buttons line up.
    const boxes = await page.locator("main ul > li").evaluateAll((els) =>
      els.map((li) => {
        const r = li.getBoundingClientRect();
        const rule = li.lastElementChild.getBoundingClientRect();
        return { top: Math.round(r.top), h: Math.round(r.height), rule: Math.round(rule.top), apply: Math.round(li.querySelector("button[aria-label^='Apply to']")?.getBoundingClientRect().top ?? -1) };
      }),
    );
    check(W, "three cards in one row at 1440, the same height", boxes.length === 3 && new Set(boxes.map((b) => b.top)).size === 1 && new Set(boxes.map((b) => b.h)).size === 1, boxes);
    check(W, "their rules and Apply buttons line up", new Set(boxes.map((b) => b.rule)).size === 1 && new Set(boxes.map((b) => b.apply)).size === 1, boxes);
    const foot = await page.locator("main ul > li").evaluateAll((els) => els.map((li) => li.lastElementChild.firstElementChild.innerText.replace(/\s*\n\s*/g, " / ")));
    check(W, "the fit and place under the rule", foot.join("|") === "Fit 0.86 / Brooklyn, NY|Fit 0.81 / Remote|Fit 0.78 / New York, NY", foot);
    check(W, "no tags the listings don't support", (await page.locator("main ul[aria-label=Tags]").count()) === 0, null);
    check(W, "two reasons per card", (await page.locator("main li").nth(1).locator("p.flex").count()) === 2, null);
    check(W, "posted … ago", text.includes("posted 9 hours ago") && text.includes("posted 1 day ago"), null);
    await context.close();
  }
  // A cancelled application's card says Cancelled, not that it failed.
  {
    const { context, page } = await open(browser, "/today", { apps: [["j1", "failed", "Cancelled by you"]] });
    const card = await page.locator("main ul > li", { hasText: "Product designer" }).innerText();
    check(W, "a cancelled application's card says Cancelled", card.includes("Cancelled") && !card.includes("Didn't go through") && card.includes("Watch"), card);
    await context.close();
  }
  // Tags: Remote beside a named place, and a role from widening the search.
  {
    const entries = [{ ...ENTRIES[1], job: { ...ENTRIES[1].job, remote: true } }, { ...ENTRIES[2], widenedBy: "role_pool" }];
    const { context, page } = await open(browser, "/today", { entries });
    const tags = await page.locator("main ul[aria-label=Tags]").evaluateAll((els) => els.map((el) => el.innerText.replace(/\n/g, ",")));
    check(W, "tags: Remote with a place, Similar role when widened", tags.join("|") === "Remote|Similar role", tags);
    await context.close();
  }
  // Not for me: hidden at once, Undo within 5 s cancels; after 5 s the API is told.
  {
    const { context, page, calls } = await open(browser, "/today");
    await page.locator("main li", { hasText: "Product designer" }).getByRole("button", { name: "Not for me" }).click();
    check(W, "Not for me hides the card", (await page.locator("main li", { hasText: "Product designer" }).count()) === 0, null);
    await page.getByRole("button", { name: "Undo" }).click();
    await wait(5600);
    check(W, "Undo brings it back and nothing is sent", (await page.locator("main li", { hasText: "Product designer" }).count()) === 1 && !calls.some((c) => c.key.includes("/dismiss")), null);
    await page.locator("main li", { hasText: "UX designer" }).getByRole("button", { name: "Not for me" }).click();
    await wait(5600);
    check(W, "the dismissal is sent once Undo has had its 5 s", calls.some((c) => c.key === "POST /shortlist/j2/dismiss"), calls.map((c) => c.key).filter((k) => k.includes("dismiss")));
    await context.close();
  }
  // A card opens the job; Esc closes and focus returns.
  {
    const { context, page } = await open(browser, "/today");
    const opener = page.locator("main li button", { hasText: "Product designer" }).first();
    await opener.click();
    await waitPanel(page, "Read more");
    check(W, "the job view: reasons, description, Read more, Apply", (await panelText(page)).includes("Led research for a checkout redesign") && (await page.locator("[data-live-panel] button", { hasText: "Apply" }).count()) === 1, null);
    check(W, "focus moves to the panel's title", (await page.evaluate(() => document.activeElement?.id)) === "panel-title", null);
    await page.keyboard.press("Escape");
    await wait(300);
    check(W, "Esc closes it and focus returns to the card", (await page.locator("[data-live-panel]").count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Product designer"), null);
    await context.close();
  }
  // Apply: getting ready, ready for your OK, Send it, the run log, the code, sent.
  {
    const { context, page, calls } = await open(browser, "/today", { emailsCode: true });
    await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
    check(W, "Apply creates the application", calls.some((c) => c.key === "POST /applications" && c.body?.includes("j1")), null);
    check(W, "getting it ready", await waitPanel(page, "Getting it ready", 4000), await panelText(page));
    check(W, "ready for your OK, with the tailored resume", await waitPanel(page, "Ready to send"), await panelText(page));
    // nori-pet's `prepared` reaction: Nori reads the application over.
    check(W, "Nori reads it over (prepared)", (await noriRow(page)) === "read", await noriRow(page));
    check(W, "nothing is sent before Send it", !calls.some((c) => c.key.endsWith("/approve")), null);
    await page.locator("[data-live-panel]").getByRole("button", { name: "Send it" }).click();
    await waitPanel(page, "Filled 9 fields");
    check(W, "the run log grows as it applies", (await page.locator("[data-live-panel] ol li").count()) >= 3, await panelText(page));
    check(W, "the employer emails a code: the box asks for it", await waitPanel(page, "The employer just emailed you a verification code"), await panelText(page));
    await page.locator("[data-live-panel] input[autocomplete=one-time-code]").fill("482913");
    await page.locator("[data-live-panel]").getByRole("button", { name: "Send code" }).click();
    check(W, "the typed code goes to the API", calls.some((c) => /^POST \/applications\/a\d+\/code$/.test(c.key) && JSON.parse(c.body).code === "482913"), null);
    check(W, "sent, with the time and the confirmation", (await waitPanel(page, "Sent in 18 seconds")) && (await panelText(page)).includes("FW-20931"), await panelText(page));
    check(W, "the card follows: Sent and Watch", await page.locator("main li", { hasText: "Product designer" }).locator("text=Sent").first().waitFor({ timeout: 8000 }).then(() => true, () => false), null);
    await context.close();
  }
  // Watch Nori apply: the stage bar, the employer's page as live frames (fetched as blobs: the CSP allows no API images),
  // the run log newest first, and the last frame kept after the run.
  {
    const { context, page, calls, errors } = await open(browser, "/today", { liveDelay: 2, liveGap: true, countUrls: true });
    const panel = page.locator("[data-live-panel]");
    const lives = () => calls.filter((c) => /^GET \/applications\/a\d+\/live$/.test(c.key)).length;
    await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
    await waitPanel(page, "Ready to send");
    check(W, "live: nothing is fetched before the run", lives() === 0, lives());
    await panel.getByRole("button", { name: "Send it" }).click();
    check(W, "live: Opening the employer's page… before the first frame", await waitPanel(page, "Opening the employer’s page…", 4000), await panelText(page));
    const frame = panel.locator('img[src^="blob:"]');
    check(W, "live: frames arrive as blob images", await frame.waitFor({ timeout: 8000 }).then(() => true, () => false), lives());
    const box = await panel.locator("figure div").first().boundingBox();
    check(W, "live: the frame is 16:10", !!box && Math.abs(box.width / box.height - 1.6) < 0.02, box);
    const seen = [];
    for (let i = 0; i < 10; i++) {
      seen.push(await frame.count());
      await wait(300);
    }
    check(W, "live: a 404 keeps the last good frame", seen.every((n) => n === 1) && lives() >= 4, { seen, lives: lives() });
    const current = await panel.locator('ol[aria-label="Where the run is"] [aria-current="step"]').textContent().catch(() => "");
    check(W, "live: the stage bar says where it is", /Filling the form|Submitting/.test(current), current);
    const STEPS_SEEN = ["Opened the application page", "Filled 9 fields", "Uploaded your tailored resume", "Answered 2 questions from your answer bank", "Submitting"];
    const log = (await panel.locator('ol[aria-label^="What Nori has done"] li').allTextContents()).map((t) => STEPS_SEEN.findIndex((s) => t.includes(s))).filter((i) => i >= 0);
    check(W, "live: the run log is newest first", log.length >= 2 && log.every((v, i) => i === 0 || v < log[i - 1]), log);
    check(W, "live: sent", await waitPanel(page, "Sent in 18 seconds", 15000), await panelText(page));
    await wait(600);
    const before = lives();
    await wait(3200);
    check(W, "live: polling stops once it's sent", lives() - before <= 1, { before, after: lives() });
    check(W, "live: the last frame stays after the run", (await frame.count()) === 1 && (await panelText(page)).includes("The employer’s page when the run ended"), null);
    const stages = await panel.locator('ol[aria-label="Where the run is"] li').allTextContents();
    check(W, "live: every stage done once sent", stages.at(-1)?.includes("Sent") && (await panel.locator('ol[aria-label="Where the run is"] [aria-current]').count()) === 0, stages);
    const urls = await page.evaluate(() => window.__urls);
    check(W, "live: each old frame's object URL is revoked", urls.made >= 3 && urls.made - urls.revoked <= 1, urls);
    check(W, "live: no CSP or other errors", errors.filter((e) => !/404/.test(e)).length === 0, errors);
    await context.close();
  }
  // The demo moment: the code comes from the person's Gmail, and the stage bar and run log say so.
  {
    const { context, page } = await open(browser, "/today", { emailsCode: true, gmailCode: true });
    const panel = page.locator("[data-live-panel]");
    await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
    await waitPanel(page, "Ready to send");
    await panel.getByRole("button", { name: "Send it" }).click();
    check(W, "gmail code: sent without typing it", await waitPanel(page, "Sent in 18 seconds", 20000), await panelText(page));
    const chip = await panel.locator('ol[aria-label="Where the run is"] li', { hasText: "Waiting for code" }).innerText({ timeout: 5000 }).catch(() => "");
    check(W, "gmail code: the stage bar says Code from your Gmail", chip.includes("Code from your Gmail"), chip);
    const line = panel.locator('ol[aria-label^="What Nori has done"] li', { hasText: "Found the code in your Gmail" });
    check(W, "gmail code: its log line stands out, and shows no code", (await line.count()) === 1 && /bg-accent-tint/.test((await line.getAttribute("class")) ?? "") && !/\d{6}/.test(await line.innerText()), await line.innerText().catch(() => null));
    await context.close();
  }
  for (const [outcome, label] of [["needs", "needs you"], ["wall", "a wall"], ["failed", "a failure"]]) {
    const { context, page, calls } = await open(browser, "/today", { outcome });
    await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
    await waitPanel(page, "Send it");
    await page.locator("[data-live-panel]").getByRole("button", { name: "Send it" }).click();
    if (outcome === "needs") {
      check(W, "needs you: the questions as a form", await waitPanel(page, "Nori needs 2 answers"), await panelText(page));
      await page.locator("[data-live-panel]").getByRole("button", { name: "Send answers" }).click();
      check(W, "needs you: required answers are checked", (await page.locator("[data-live-panel] >> text=Answer this one to carry on").count()) === 2, null);
      await page.locator("[data-live-panel] label", { hasText: "Yes" }).click();
      await page.locator("#answer-q2").fill("alexrivera.design");
      await page.locator("[data-live-panel]").getByRole("button", { name: "Send answers" }).click();
      await wait(400);
      const sent = JSON.parse(calls.find((c) => c.key.endsWith("/answer"))?.body ?? "{}");
      check(W, "needs you: the answers are sent and it carries on", sent.answers?.q1 === "Yes" && sent.answers.q2 === "alexrivera.design" && (await waitPanel(page, "Sent in")), sent);
    } else if (outcome === "wall") {
      check(W, "a wall: what happened and a way to finish it", (await waitPanel(page, "never gets around those")) && (await page.locator("[data-live-panel] a", { hasText: "Open the application page" }).getAttribute("href")) === "https://jobs.example.test/j1", await panelText(page));
    } else {
      check(W, "a failure: in words, with Try again", await waitPanel(page, "stopped responding"), await panelText(page));
      await page.locator("[data-live-panel]").getByRole("button", { name: "Try again" }).click();
      check(W, "Try again retries and it goes through", calls.some((c) => c.key.endsWith("/retry")) && (await waitPanel(page, "Sent in", 15000)), null);
    }
    void label;
    await context.close();
  }
  // Send all: one application per card, the panel steps through them.
  {
    const { context, page, calls } = await open(browser, "/today");
    await page.getByRole("button", { name: "Send all 3" }).click();
    await waitPanel(page, "1 of 3");
    check(W, "Send all creates one per card and stacks them", calls.filter((c) => c.key === "POST /applications").length === 3 && (await panelText(page)).includes("1 of 3"), null);
    await page.getByRole("button", { name: "Next application" }).click();
    check(W, "the switcher moves to the next", await waitPanel(page, "2 of 3"), null);
    await context.close();
  }
  // Needs you, the banner, sign-out, the theme.
  {
    const { context, page, calls } = await open(browser, "/today", { apps: [["j1", "prepared"]], unverified: true });
    check(W, "a waiting application shows Nori needs you", await page.locator("main button", { hasText: "Nori needs you" }).isVisible(), null);
    await page.locator("main button", { hasText: "Nori needs you" }).click();
    check(W, "Nori needs you opens it", await waitPanel(page, "Ready to send"), null);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Send it again" }).click();
    await wait(300);
    check(W, "the email banner resends", calls.some((c) => c.key === "POST /auth/resend-verification") && (await page.locator("text=Sent. Check your inbox.").isVisible()), null);
    await page.locator('nav[aria-label="Dashboard"] summary').first().click();
    await page.locator("label", { hasText: "Dark" }).first().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    const early = await page.evaluate(() => document.documentElement.getAttribute("data-app-theme"));
    check(W, "the theme choice is kept and set before the page draws", early === "dark", early);
    await wait(1500);
    await page.locator('nav[aria-label="Dashboard"] summary').first().click();
    await page.getByRole("button", { name: "Sign out" }).first().click();
    check(W, "sign out", (await landsOn(page, "/")) && calls.some((c) => c.key === "POST /auth/logout"), page.url());
    await context.close();
  }
  // Guards, empty and offline.
  for (const [label, o, test] of [
    ["signed out goes to sign-in", { signedOut: true }, async (page) => landsOn(page, "/signin")],
    ["onboarding not finished goes to onboarding", { onboarding: "contact" }, async (page) => landsOn(page, "/onboarding/contact")],
    ["/dashboard opens Today", {}, async (page) => (await page.goto(`${BASE}/dashboard`), landsOn(page, "/today"))],
    ["the first morning", { entries: [] }, async (page) => page.locator("text=Nori is still finding your first jobs").isVisible()],
    ["can't reach Norinote", { offline: true }, async (page) => page.locator("text=Couldn’t reach Norinote").isVisible()],
  ]) {
    const { context, page } = await open(browser, "/today", o);
    check(W, label, await test(page), page.url());
    await context.close();
  }
  // Telegram's Details links (/today?job=<jobId>) and the old dashboard's addresses (next.config.ts redirects).
  const OLD = job("j9", "Brand designer", "Quill & Co", "Austin, TX", false, 80);
  for (const [label, path, o, test] of [
    ["?job= opens that job's panel", "/today?job=j3", {}, async (page) => (await waitPanel(page, "Design systems designer")) && (await panelText(page)).startsWith("Job")],
    ["?job= opens its application when there is one", "/today?job=j1", { apps: [["j1", "prepared"]] }, async (page) => (await waitPanel(page, "Product designer")) && (await panelText(page)).startsWith("Application")],
    ["?job= leaves the address", "/today?job=j3", {}, async (page) => (await waitPanel(page, "Design systems designer")) && new URL(page.url()).search === ""],
    ["?job= not on today's list: a note with the posting", "/today?job=j9", { oldJob: OLD }, async (page) => {
      const note = page.getByRole("status").filter({ hasText: "isn’t on today’s list any more" });
      const ok = (await note.innerText().catch(() => "")).includes("Brand designer at Quill & Co") && (await note.getByRole("link", { name: "See the posting" }).getAttribute("href")) === OLD.applyUrl;
      await note.getByRole("button", { name: "Close this note" }).click();
      return ok && !(await page.locator("[data-live-panel]").count()) && (await note.count()) === 0 && (await page.locator("main li").count()) === 3;
    }],
    ["?job= unknown: a plain note", "/today?job=nope", { oldJob: null }, async (page) => page.getByRole("status").filter({ hasText: "That job isn’t on today’s list any more." }).isVisible()],
    ["signed out keeps ?job= through sign-in", "/today?job=j3", { signedOut: true }, async (page) => (await landsOn(page, "/signin")) && new URL(page.url()).searchParams.get("next") === "/today?job=j3"],
    ["/jobs?job= opens Today with that job", "/jobs?job=j3", {}, async (page) => (await landsOn(page, "/today")) && (await waitPanel(page, "Design systems designer"))],
    ["/login goes to sign-in", "/login", { signedOut: true }, async (page) => landsOn(page, "/signin")],
    ["/profile goes to You", "/profile", {}, async (page) => landsOn(page, "/you")],
    ["/settings goes to You", "/settings", {}, async (page) => landsOn(page, "/you")],
    ["/graph goes to You", "/graph", {}, async (page) => landsOn(page, "/you")],
    ["/resume/<id> goes to Applications", "/resume/r1", {}, async (page) => landsOn(page, "/applications")],
  ]) {
    const { context, page, errors } = await open(browser, path, o);
    check(W, label, await test(page), page.url());
    // Only where the page is Today: this file's API mock doesn't serve the You and Applications pages' data.
    if (/^\/(today|jobs)(\?|$)/.test(path)) check(W, `${label}: no errors`, errors.filter((e) => !/401|404/.test(e)).length === 0, errors);
    await context.close();
  }
  // Polling stops while the tab is hidden, and picks up on return.
  {
    const { context, page, calls } = await open(browser, "/today");
    await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
    await wait(1000);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const before = calls.filter((c) => /^GET \/applications\/a/.test(c.key)).length;
    await wait(5000);
    const during = calls.filter((c) => /^GET \/applications\/a/.test(c.key)).length;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait(1200);
    const after = calls.filter((c) => /^GET \/applications\/a/.test(c.key)).length;
    check(W, "polling pauses while hidden and resumes on return", during - before <= 1 && after > during, { before, during, after });
    await context.close();
  }
  // Phones: the panel is a modal sheet that keeps Tab inside.
  {
    const { context, page } = await open(browser, "/today", {}, { viewport: { width: 390, height: 844 } });
    await page.locator("main li button", { hasText: "Product designer" }).first().click();
    await waitPanel(page, "Read more");
    const inside = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      inside.push(await page.evaluate(() => !!document.activeElement?.closest("[data-live-panel]")));
    }
    check(W, "phones: Tab stays inside the sheet", inside.every(Boolean), inside);
    await context.close();
  }
}

// ---- accessibility, keyboard, performance -----------------------------------------------------------------------------

async function axe(browser) {
  const states = [["today", {}], ["job", {}], ["prepared", { apps: [["j1", "prepared"]] }], ["needs you", { outcome: "needs" }]];
  for (const scheme of ["light", "dark"]) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const [state, o] of states) {
        const where = `chromium /today (${state}) ${w}x${h} ${scheme} axe`;
        const { context, page } = await open(browser, "/today", o, { viewport: { width: w, height: h }, colorScheme: scheme });
        if (state === "job") await page.locator("main li button", { hasText: "Product designer" }).first().click();
        if (state === "prepared") await page.locator("main button", { hasText: "Nori needs you" }).click();
        if (state === "needs you") {
          await page.getByRole("button", { name: "Apply to Product designer at Fernway" }).click();
          await waitPanel(page, "Send it");
          await page.locator("[data-live-panel]").getByRole("button", { name: "Send it" }).click();
          await waitPanel(page, "Nori needs 2 answers");
        }
        await wait(800);
        await page.addScriptTag({ path: AXE });
        const r = await page.evaluate(async () => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
        const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
        check(where, "axe: no violations", v.length === 0, v.length ? v : `${r.passes.length} rules pass, ${r.incomplete.length} need a person`);
        await context.close();
      }
    }
  }
}

async function keyboard(browser) {
  const where = "chromium /today 1440x900 keyboard";
  const { context, page } = await open(browser, "/today");
  const stops = [];
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(cs.boxShadow), size: [Math.round(r.width), Math.round(r.height)] };
      }),
    );
  }
  const seen = stops.filter(Boolean);
  check(where, "skip link first", seen[0]?.name === "Skip to content", seen[0]);
  check(where, "the rail, then the cards", seen.findIndex((s) => s.name.startsWith("Today")) < seen.findIndex((s) => s.name.startsWith("Apply to")), seen.map((s) => s.name));
  check(where, "every stop shows the focus ring", seen.every((s) => s.ring), seen.filter((s) => !s.ring).map((s) => s.name));
  check(where, "targets at least 24 px", seen.every((s) => s.size[0] >= 24 && s.size[1] >= 24), seen.filter((s) => s.size[0] < 24 || s.size[1] < 24));
  await context.close();
}

async function performance(browser) {
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const where = `chromium /today ${w}x${h} 4G, 4x CPU`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    await mockApi(context);
    const page = await context.newPage();
    // No fixed clock here: Playwright's clock also fakes the page's performance timeline, which reads as 0 KB.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__lcp = 0;
      window.__lcpEl = null;
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window.__lcp = e.startTime), (window.__lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.url ? ` ${e.url.split("/").pop()}` : ""}` : null)))).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${BASE}/today`, { waitUntil: "load" });
    await wait(800);
    const kb = await page.evaluate(() => Math.round((performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) / 1024));
    await wait(4000);
    const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), el: window.__lcpEl, cls: Number(window.__cls.toFixed(3)) }));
    check(where, "LCP under 2.0 s", r.lcp <= 2000, `${r.lcp} ms (${r.el})`);
    check(where, "CLS under 0.05", r.cls <= 0.05, r.cls);
    check(where, "under 450 KB before the first interaction", kb > 0 && kb <= 450, `${kb} KB`);
    await context.close();
  }
}

/** A real run (no mocks): sign up, onboard through the API, then Today. Without a worker, the first morning shows. */
async function endToEnd(browser) {
  const W = "chromium end to end";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  await page.fill("#signup-email", `today-${Date.now()}@example.test`);
  await page.fill("#signup-password", "first-pass-123");
  await page.click("text=Create account");
  await landsOn(page, "/onboarding/resume");
  const steps = await page.evaluate(async (api) => {
    const put = (step, data) => fetch(`${api}/api/onboarding`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, data }) }).then((r) => r.status);
    await fetch(`${api}/api/profile/resume`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Alex Rivera\nProduct Designer, Fernway, 2022 to now. Figma, research, prototyping, design systems." }) });
    return [await put("resume", {}), await put("contact", { fullName: "Alex Rivera" }), await put("authorization", { workAuth: { authorizedUS: true, needsSponsorship: false } }), await put("screening", { over18: true }), await put("preferences", { preferences: { titles: ["Product designer"] } })];
  }, API);
  check(W, "onboarding through the API", steps.every((s) => s === 200), steps);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  check(W, "/dashboard opens Today", await landsOn(page, "/today"), page.url());
  await page.locator("main h1", { hasText: "Alex" }).waitFor({ timeout: 10000 }).catch(() => {});
  const text = await page.locator("main").innerText();
  check(W, "Today greets by name and shows the first morning", /Good (morning|afternoon|evening), Alex/.test(text) && /still finding your first jobs|for today/.test(text), text.slice(0, 200));
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
    if (ONLY.includes("performance")) await performance(browser);
    if (E2E && ONLY.includes("e2e")) await endToEnd(browser);
  }
  await browser.close();
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`FAIL ${f.where}: ${f.what}\n     ${JSON.stringify(f.detail)?.slice(0, 400)}`);
for (const p of results.filter((r) => r.ok && r.detail && /LCP|CLS|KB/.test(r.what + r.detail))) console.log(`ok   ${p.where}: ${p.what} (${p.detail})`);
process.exitCode = failed.length ? 1 : 0;
