// Phase 5 QA for dashboard part 4b (dashboard-4b-spec.md section 12): /applications, /applications/:id and /inbox at 11
// sizes in Chromium, Firefox and WebKit, light and dark; the row states, tabs, week strip and day filter; marking an
// outcome and Undo; the summary's small sample; the Inbox's list, pane, phone page, Copy, settings, new mail and the
// switched-off state; axe in both themes; keyboard; budgets; and optionally a real run against a local API.
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-4b.mjs [--base …] [--api …] [--browsers …] [--only …] [--e2e]
// Writes test-results/qa-4b/report.json and screenshots; exits 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-4b");
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
// Wednesday 4 November, 9:00: the week strip runs 2 to 8 November.
const MORNING = new Date("2026-11-04T09:00:00");
const DAY = 86_400_000;

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

const at = (iso) => new Date(iso).toISOString();
const LOGO = (domain) => `https://cdn.brandfetch.io/domain/${domain}/w/128/h/128/fallback/404/type/icon?c=test`;
const job = (id, title, company, location, logo = null) => ({ id, companyName: company, companyLogoUrl: logo, title, location, remote: !location, applyUrl: `https://jobs.example.test/${id}`, postedAt: at("2026-10-20T09:00:00"), descriptionText: `${title} at ${company}.` });
const base = (id, status, extra = {}) => ({ id, jobId: `j-${id}`, status, pendingQuestions: [], receipt: null, error: null, preparedAt: null, approvedAt: null, submittedAt: null, createdAt: at("2026-10-01T10:00:00"), updatedAt: at("2026-11-04T08:00:00"), ...extra });
const sent = (id, day, extra = {}) => base(id, "submitted", { preparedAt: at(`${day}T07:58:00`), approvedAt: at(`${day}T08:00:00`), submittedAt: at(`${day}T08:00:18`), createdAt: at(`${day}T07:50:00`), receipt: { confirmation: `FW-${id.slice(1)}0931`, dryRun: false }, ...extra });
/** Nine applications, one per row state. */
const APPS = () => [
  { app: base("a1", "applying", { createdAt: at("2026-11-04T08:40:00"), approvedAt: at("2026-11-04T08:41:00") }), job: job("j1", "Brand designer", "Lumen", "Brooklyn, NY") },
  { app: base("a2", "needs_user", { createdAt: at("2026-11-04T08:30:00"), pendingQuestions: [{ id: "q1", text: "Can you work from the office 3 days a week?", type: "boolean", options: [], required: true }, { id: "q2", text: "Portfolio link", type: "text", options: [], required: true }] }), job: job("j2", "Interaction designer", "Pallet", null) },
  { app: sent("a3", "2026-11-04", { receipt: { confirmation: "FW-20931", dryRun: true, screenshotPath: "artifacts/a3/filled.png" } }), job: job("j3", "Product designer", "Fernway", "Brooklyn, NY"), outcomes: [] },
  { app: sent("a4", "2026-11-02"), job: job("j4", "UX designer", "Halden Labs", null, LOGO("halden.example.test")), outcomes: [{ id: "o4", kind: "reply", at: at("2026-11-03T10:00:00"), source: "inbox", messageId: "m3" }] },
  { app: sent("a5", "2026-11-02"), job: job("j5", "Design systems designer", "Mirro", "New York, NY", LOGO("mirro.example.test")), outcomes: [{ id: "o5", kind: "interview", at: at("2026-11-04T07:00:00"), source: "inbox", messageId: "m1" }] },
  { app: sent("a6", "2026-11-03"), job: job("j6", "Senior product designer", "Orchard", null), outcomes: [{ id: "o6", kind: "rejection", at: at("2026-11-04T06:30:00"), source: "inbox", messageId: "m4" }] },
  { app: sent("a7", "2026-10-01"), job: job("j7", "Visual designer", "Kestrel", "Austin, TX"), outcomes: [] },
  { app: base("a8", "failed", { createdAt: at("2026-11-03T12:00:00"), error: "The page stopped responding while Nori was uploading your resume." }), job: job("j8", "Content designer", "Tern", null) },
  { app: sent("a9", "2026-10-28"), job: job("j9", "Product designer II", "Wren", "Remote"), outcomes: [{ id: "o9", kind: "offer", at: at("2026-11-02T15:00:00"), source: "manual", messageId: null }] },
];
// The worker's words when no typed code arrived in time (packages/apply EMAIL_CODE_REASON).
const CODE_LATE = "The employer emailed you a verification code and none reached Norinote in time. Retry and type the code in Norinote when asked, or finish on the employer's page.";
/** APPS plus one run waiting for a typed code (a10) and one whose wait ran out (a11). */
const CODE_APPS = () => [
  ...APPS(),
  { app: base("a10", "awaiting_code", { createdAt: at("2026-11-04T08:50:00"), approvedAt: at("2026-11-04T08:51:00") }), job: job("j10", "Service designer", "Larch", "Seattle, WA"), outcomes: [] },
  { app: base("a11", "needs_user", { createdAt: at("2026-11-04T07:50:00"), approvedAt: at("2026-11-04T07:51:00"), error: CODE_LATE }), job: job("j11", "Motion designer", "Bramble", null), outcomes: [] },
];
const MESSAGES = () => [
  { id: "m2", applicationId: "a3", application: { id: "a3", status: "submitted", jobTitle: "Product designer", companyName: "Fernway" }, fromAddress: "no-reply@greenhouse.example.test", fromName: "Fernway via Greenhouse", subject: "Your security code", bodyText: "Copy and paste this code into the security code field on your application: 482913", receivedAt: at("2026-11-04T08:00:05"), kind: "verification_code", code: "482913", verificationLink: null, links: [], attachments: [], spam: false },
  { id: "m1", applicationId: "a5", application: { id: "a5", status: "submitted", jobTitle: "Design systems designer", companyName: "Mirro" }, fromAddress: "talent@mirro.example.test", fromName: "Priya at Mirro", subject: "Interview: Design systems designer", bodyText: "Hi Alex,\n\nThanks for applying. We'd love to talk. Could you do a 30 minute call next week?\n\nPriya", receivedAt: at("2026-11-04T07:00:00"), kind: "interview", code: null, verificationLink: null, links: [], attachments: [{ filename: "interview-guide.pdf", contentType: "application/pdf", size: 84_000 }], spam: false },
  { id: "m4", applicationId: "a6", application: { id: "a6", status: "submitted", jobTitle: "Senior product designer", companyName: "Orchard" }, fromAddress: "jobs@orchard.example.test", fromName: "Orchard", subject: "About your application", bodyText: "Thank you for your interest. We've decided to move forward with other candidates.", receivedAt: at("2026-11-04T06:30:00"), kind: "rejection", code: null, verificationLink: null, links: [], attachments: [], spam: false },
  { id: "m3", applicationId: "a4", application: { id: "a4", status: "submitted", jobTitle: "UX designer", companyName: "Halden Labs" }, fromAddress: "sam@halden.example.test", fromName: "Sam Ortiz", subject: "Re: UX designer", bodyText: "Thanks Alex, we're reviewing and will be in touch.", receivedAt: at("2026-11-03T10:00:00"), kind: "recruiter_reply", code: null, verificationLink: null, links: [], attachments: [], spam: false },
  { id: "m5", applicationId: "a3", application: { id: "a3", status: "submitted", jobTitle: "Product designer", companyName: "Fernway" }, fromAddress: "no-reply@fernway.example.test", fromName: "Fernway", subject: "Confirm your email", bodyText: "Confirm your email to finish your application.", receivedAt: at("2026-11-02T09:00:00"), kind: "confirmation", code: null, verificationLink: "https://fernway.example.test/confirm?t=abc", links: ["https://fernway.example.test/confirm?t=abc"], attachments: [], spam: false },
  { id: "m6", applicationId: null, application: null, fromAddress: "deals@spammy.example.test", fromName: "Career Boost", subject: "You won a free resume review", bodyText: "Click here.", receivedAt: at("2026-11-01T09:00:00"), kind: "other", code: null, verificationLink: "https://spammy.example.test/x", links: [], attachments: [], spam: true },
];

/** As the API resolves it (`resolveApplication` in packages/match). */
function stateOf(r, now) {
  if (!r.app.submittedAt) return null;
  const kinds = new Set(r.outcomes.map((o) => o.kind));
  if (kinds.has("offer")) return "offer";
  if (kinds.has("interview")) return "interview";
  if (kinds.has("reply")) return "reply";
  if (kinds.has("rejection")) return "rejection";
  return now - Date.parse(r.app.submittedAt) >= 30 * DAY ? "no_response" : "pending";
}
function summaryOf(rows, now, small) {
  const sentRows = rows.filter((r) => r.app.submittedAt);
  const states = sentRows.map((r) => stateOf(r, now));
  const settled = states.filter((s) => s !== "pending").length;
  const responses = sentRows.filter((r) => r.outcomes.length).length;
  const daysTo = sentRows.filter((r) => r.outcomes.length).map((r) => (Math.min(...r.outcomes.map((o) => Date.parse(o.at))) - Date.parse(r.app.submittedAt)) / DAY);
  const isSmall = small ?? settled < 5;
  return {
    overall: {
      key: "all", applications: sentRows.length, settled, pending: sentRows.length - settled, responses,
      interviews: states.filter((s) => s === "interview" || s === "offer").length, rejections: sentRows.filter((r) => r.outcomes.some((o) => o.kind === "rejection")).length,
      offers: states.filter((s) => s === "offer").length, noResponse: states.filter((s) => s === "no_response").length,
      responseRate: isSmall ? null : Math.round((responses / settled) * 1000) / 1000, interviewRate: null, rejectionRate: null,
      medianDaysToFirstReply: daysTo.length < 5 ? null : 2, smallSample: isSmall,
    },
    bySystem: [], byRoleFamily: [], byFitBand: [], byResume: [], minSample: 5, noResponseDays: 30, learning: null,
  };
}

/**
 * `o.apps` (rows), `o.messages`, `o.small` (force the small sample), `o.inboxOff`, `o.offline`, `o.slow` (ms per outcomes call).
 * A typed code (POST /applications/:id/code): `o.code` is "ok" (sent two polls later), "gone" (409: the wait ran
 * out first) or "bad" (the API's 400). `o.startsWaiting`: an applying run starts waiting for a code on its third poll.
 */
async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const calls = [];
  const rows = o.apps ?? APPS();
  const messages = o.messages ?? MESSAGES();
  let settings = { forwardTo: null, forwardEnabled: false, retentionDays: null };
  let seq = 0;
  let inflight = 0;
  let maxInflight = 0;
  const now = MORNING.getTime();
  const view = (r) => ({ applicationId: r.app.id, submittedAt: r.app.submittedAt, confirmedAt: null, state: stateOf(r, now), outcomes: r.outcomes });
  // Brandfetch's CDN: Mirro has a logo; anyone else gets its 404 fallback.
  await context.route("https://cdn.brandfetch.io/**", (route) =>
    route.request().url().includes("mirro")
      ? route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") })
      : route.fulfill({ status: 404, body: "" }),
  );
  await context.route(`${API}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api/, "")}`;
    const body = req.postData();
    calls.push({ key, body, at: Date.now() });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) }).catch(() => {});
    const user = { id: "u1", email: "alex@example.test", name: "Alex Rivera", emailVerifiedAt: MORNING.toISOString(), createdAt: MORNING.toISOString() };
    if (key === "GET /auth/session") return reply(200, { user });
    if (key === "GET /onboarding") return reply(200, { step: "done", profile: {} });
    if (key === "GET /me") return reply(200, { user, profile: { fullName: "Alex Rivera" } });
    if (key === "GET /agent/status") return reply(200, { dailyCap: 5, usedToday: 2, liveSubmit: false });
    if (key === "GET /shortlist") return reply(200, []);
    if (key === "GET /applications") return o.offline ? route.abort("connectionrefused") : reply(200, rows.map((r) => ({ application: r.app, job: r.job, resume: null })));
    if (key === "GET /outcomes/summary") return reply(200, summaryOf(rows, now, o.small));
    let m = key.match(/^(GET|POST) \/applications\/([\w-]+)\/outcomes$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[2]);
      if (!r) return reply(404, { error: "Application not found" });
      if (m[1] === "GET") {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await wait(o.slow ?? 60);
        inflight -= 1;
        return reply(200, view(r));
      }
      if (!r.app.submittedAt) return reply(409, { error: "This application has not been submitted yet" });
      const outcome = { id: `n${++seq}`, kind: JSON.parse(body ?? "{}").kind, at: new Date(now).toISOString(), source: "manual", messageId: null };
      r.outcomes = [...r.outcomes, outcome];
      return reply(201, { outcome, created: true, ...view(r) });
    }
    m = key.match(/^DELETE \/applications\/([\w-]+)\/outcomes\/([\w-]+)$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[1]);
      r.outcomes = r.outcomes.filter((x) => x.id !== m[2]);
      return reply(200, { ok: true, ...view(r) });
    }
    m = key.match(/^POST \/applications\/([\w-]+)\/code$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[1]);
      if (o.code === "bad") return reply(400, { error: "A code has only letters, digits, spaces and dashes" });
      if (o.code === "gone") Object.assign(r.app, { status: "needs_user", error: CODE_LATE });
      if (r.app.status !== "awaiting_code") return reply(409, { error: "This application is not waiting for a code", detail: r.app.status });
      r.typed = 1; // the run takes it up a couple of polls later, as the worker would
      return reply(200, { ok: true });
    }
    m = key.match(/^(GET|POST) \/applications\/([\w-]+)(?:\/(approve|answer|retry))?$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[2]);
      if (!r) return reply(404, { error: "Application not found" });
      if (m[3]) return reply(200, { ok: true, status: r.app.status });
      r.polls = (r.polls ?? 0) + 1;
      if (o.startsWaiting && r.app.status === "applying" && r.polls >= 3) r.app.status = "awaiting_code";
      if (r.typed && ++r.typed > 2) Object.assign(r.app, { status: "submitted", submittedAt: new Date(now + 20_000).toISOString(), receipt: { confirmation: "LR-1180", dryRun: false } });
      const events = r.app.approvedAt ? ["Opened the application page", "Filled 9 fields", "Uploaded your tailored resume", "Answered 2 questions from your answer bank", "Submitting", "Code 482 913 arrived; entered it", "Sent"].map((message, i) => ({ id: String(i + 1), ts: r.app.approvedAt, level: "info", step: "run", message })) : [];
      return reply(200, { application: r.app, job: r.job, resume: { changes: [{ before: "Led checkout research", after: "Led research and design for the checkout redesign", reason: "The role asks for end-to-end research" }] }, events });
    }
    if (key === "GET /inbox/address") return reply(200, o.inboxOff ? { address: null, configured: false, settings } : { address: "alex.r@inbox.norinote.test", configured: true, settings });
    if (key === "PUT /inbox/settings") {
      const b = JSON.parse(body ?? "{}");
      settings = { forwardTo: b.forwardTo ?? null, forwardEnabled: !!b.forwardEnabled && !!b.forwardTo, retentionDays: b.retentionDays ?? null };
      return reply(200, { settings });
    }
    if (key === "GET /inbox") return reply(200, messages);
    m = key.match(/^GET \/inbox\/([\w-]+)$/);
    if (m) {
      const x = messages.find((y) => y.id === m[1]);
      return x ? reply(200, { ...x, classifiedBy: "rules", forwardedAt: null }) : reply(404, { error: "Not found" });
    }
    if (key === "POST /auth/logout") return reply(200, { ok: true });
    return reply(200, { ok: true });
  });
  return { calls, rows, maxInflight: () => maxInflight };
}

async function open(browser, path, o = {}, ctx = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctx });
  const mock = await mockApi(context, o);
  if (o.seen) await context.addInitScript((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), o.seen);
  // Every row Nori plays, so a short reaction that's already over still counts.
  await context.addInitScript(() => {
    window.__rows = [];
    setInterval(() => {
      const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
      const row = sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1];
      if (row && window.__rows.at(-1) !== row) window.__rows.push(row);
    }, 100);
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(MORNING);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE + path, { waitUntil: "load" });
  await wait(o.settle ?? 1800);
  return { context, page, errors, ...mock };
}

const landsOn = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 8000 }).then(() => true, () => false);
const noriRow = (page) =>
  page.evaluate(() => {
    const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
    return sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1] ?? null;
  });
const played = (page) => page.evaluate(() => window.__rows ?? []);
const overlap = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
const rowText = (page, title) => page.locator("main ul[aria-label='Applications'] li", { hasText: title }).first().innerText().catch(() => "");

// ---- the size matrix --------------------------------------------------------------------------------------------------

async function matrix(name, browser) {
  const pages = [["/applications", "Product designer"], ["/applications/a5", "Timeline"], ["/inbox", "Priya at Mirro"]];
  const runs = [...ALL_SIZES.map((s) => [s, "light"]), [[390, 844], "dark"], [[1440, 900], "dark"]];
  for (const [path, ready] of pages) {
    for (const [[w, h], scheme] of runs) {
      const where = `${name} ${path} ${w}x${h} ${scheme}`;
      const { context, page, errors } = await open(browser, path, {}, { viewport: { width: w, height: h }, colorScheme: scheme });
      await page.locator("main", { hasText: ready }).waitFor({ timeout: 6000 }).catch(() => {});
      await wait(900);
      const L = await page.evaluate(() => {
        const box = (el) => {
          if (!el || !el.getClientRects().length) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const nori = document.querySelector(".nori");
        const seat = [...document.querySelectorAll("[data-nori-seat]")].find((el) => el.getClientRects().length);
        const h1 = document.querySelector("main h1");
        return {
          vw: innerWidth,
          vh: innerHeight,
          docW: document.documentElement.scrollWidth,
          bg: getComputedStyle(document.querySelector(".app-theme")).backgroundColor,
          tucked: !!nori?.classList.contains("is-tucked"),
          nori: box(nori),
          size: nori ? nori.getBoundingClientRect().width : 0,
          seat: seat ? { name: seat.dataset.noriSeat, ...(({ x, y }) => ({ x, y }))(seat.getBoundingClientRect()) } : null,
          h1: h1 && getComputedStyle(h1).position !== "absolute" ? box(h1) : null,
          srH1: !!h1,
          // What must never sit under Nori: the heading, the tabs and rail, the week strip, the filters and the reading pane's actions.
          fixed: [...document.querySelectorAll("main h1, nav a, nav summary, main [role=group] button, main section[aria-labelledby=week-title] button, main a[href^='/inbox']:not(li a), main article a, main article button")]
            .filter((el) => el.getClientRects().length && !el.closest(".nori"))
            .map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), ...box(el) }))
            .filter((c) => c.y < innerHeight && c.y + c.h > 0),
          path: location.pathname,
        };
      });
      check(where, "no sideways scroll", L.docW <= L.vw + 1, `${L.docW} > ${L.vw}`);
      check(where, "one h1", L.srH1, null);
      if (L.h1) check(where, "the heading in the first screen", L.h1.y + L.h1.h <= L.vh, L.h1);
      check(where, `the ${scheme} theme`, scheme === "dark" ? L.bg === "rgb(15, 26, 21)" : L.bg === "rgb(251, 244, 234)", L.bg);
      if (path === "/inbox") check(where, w >= 1024 ? "from 1024 px the newest message opens" : "below 1024 px the list, no message open", w >= 1024 ? L.path === "/inbox/m2" : L.path === "/inbox", L.path);
      if (!L.tucked && L.nori) {
        const covered = L.fixed.filter((c) => overlap(L.nori, c, 6)).map((c) => c.name);
        check(where, "Nori clear of the heading, navigation, filters and the message's actions", covered.length === 0, covered);
        if (L.seat) {
          const dx = Math.abs(L.nori.x + L.nori.w / 2 - L.seat.x);
          const dy = Math.abs(L.nori.y + L.nori.h - (L.seat.y + L.size * 0.04));
          check(where, `Nori sits on its seat (${L.seat.name})`, dx < 8 && dy < 8 && L.seat.name === (w >= 1024 ? "rail" : "head"), { dx: Math.round(dx), dy: Math.round(dy), seat: L.seat.name });
        }
      }
      const real = errors.filter((e) => !/favicon/i.test(e));
      check(where, "no console errors", real.length === 0, real);
      if (name === "chromium") await page.screenshot({ path: join(OUT, `${path.replace(/\//g, "_").slice(1)}-${w}x${h}-${scheme}.png`), fullPage: w <= 430 || w === 1440 });
      await context.close();
    }
  }
}

// ---- flows ------------------------------------------------------------------------------------------------------------

async function flows(browser) {
  const W = "chromium flows";
  // The list: each state's chip and line, newest first.
  {
    const { context, page, calls, maxInflight } = await open(browser, "/applications", { slow: 300 }, {});
    await page.locator("main [role=group] button", { hasText: "Replied" }).locator("span").waitFor({ timeout: 8000 }).catch(() => {});
    const expected = [
      ["Brand designer", "Applying", "Applying now"],
      ["Interaction designer", "Needs you", "Nori needs 2 answers"],
      ["Product designer · Fernway", "Waiting", "Sent 4 Nov"],
      ["UX designer", "Reply", "Replied in 1 day"],
      ["Design systems designer", "Interview", "Interview invitation, 2 days after sending"],
      ["Senior product designer", "Rejected", "Rejected after 1 day"],
      ["Visual designer", "No response", "Sent 1 Oct · no answer in 30 days"],
      ["Content designer", "Didn't go through", "Nothing was sent"],
      ["Product designer II", "Offer", "An offer, 5 days after sending"],
    ];
    for (const [title, chip, line] of expected) {
      const t = await rowText(page, title);
      check(W, `row ${title}: ${chip}, "${line}"`, t.includes(chip) && t.includes(line), t);
    }
    const logos = await page.evaluate(() =>
      [...document.querySelectorAll("main ul[aria-label='Applications'] li a")].map((a) => {
        const el = a.firstElementChild?.firstElementChild;
        const r = el?.getBoundingClientRect();
        return { tag: el?.tagName.toLowerCase(), text: el?.textContent ?? "", w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0), loaded: el?.tagName === "IMG" ? el.complete && el.naturalWidth > 0 : null, lazy: el?.getAttribute("loading"), alt: el?.getAttribute("alt") };
      }),
    );
    const mirro = logos[4];
    const halden = logos[3];
    check(W, "a logo from the CDN: a lazy <img>, alt empty", mirro?.tag === "img" && mirro.loaded && mirro.lazy === "lazy" && mirro.alt === "", mirro);
    check(W, "the CDN's 404: the letter tile instead", halden?.tag === "span" && halden.text === "H", halden);
    check(W, "no logo: the letter tile", logos[0]?.tag === "span" && logos[0].text === "L", logos[0]);
    check(W, "logo and tile are the same size", logos.every((l) => l.w === logos[0].w && l.h === logos[0].h && l.w === 40), logos.map((l) => `${l.tag} ${l.w}x${l.h}`));
    const order = await page.locator("main ul[aria-label='Applications'] li").count();
    check(W, "all nine rows", order === 9, order);
    check(W, "outcomes fetched for each sent application, at most 6 at once", calls.filter((c) => /^GET \/applications\/a\d\/outcomes$/.test(c.key)).length === 6 && maxInflight() <= 6, { calls: calls.filter((c) => c.key.endsWith("/outcomes")).length, max: maxInflight() });
    const text = await page.locator("main").innerText();
    check(W, "the numbers", text.includes("6 sent · 4 replies · 2 interviews · 1 offer") && text.includes("Response rate 80%"), text.slice(0, 400));
    const tabs = await page.locator("main [role=group][aria-label=Show] button").allInnerTexts();
    check(W, "tabs with counts", tabs.map((t) => t.replace(/\s+/g, "")).join("|") === "All9|Inprogress2|Sent1|Replied3|Closed3", tabs);
    await page.locator("main [role=group][aria-label=Show] button", { hasText: "Replied" }).click();
    const replied = await page.locator("main ul[aria-label='Applications'] li").allInnerTexts();
    check(W, "Replied shows reply, interview and offer", replied.length === 3 && replied.every((r) => /Reply|Interview|Offer/.test(r)), replied);
    check(W, "the tab is kept in the URL", page.url().endsWith("?show=replied"), page.url());
    await page.reload({ waitUntil: "load" });
    await wait(1500);
    check(W, "and survives a reload", (await page.locator("main [role=group][aria-label=Show] button[aria-pressed=true]").innerText()).startsWith("Replied"), null);
    await context.close();
  }
  // The week strip: marks, today, the day filter, weeks.
  {
    const { context, page } = await open(browser, "/applications");
    const days = page.locator("section[aria-labelledby=week-title] [role=group] button");
    check(W, "seven days, Monday first", (await days.count()) === 7 && (await days.first().innerText()).startsWith("Mon"), await days.first().innerText());
    const wed = await days.nth(2).innerText();
    check(W, "Wednesday 4 November: what happened, for screen readers, and today", /November: 1 sent, 1 interview, 1 rejection, today/.test(wed), wed);
    check(W, "Monday 2 November: two sent and an offer", /2 sent, 1 offer/.test(await days.nth(0).innerText()), await days.nth(0).innerText());
    check(W, "days after today can't be chosen", (await days.nth(3).isDisabled()) && !(await days.nth(2).isDisabled()), null);
    check(W, "this week has no next week", await page.getByRole("button", { name: "Next week" }).isDisabled(), null);
    await days.nth(2).click();
    const shown = await page.locator("main ul[aria-label='Applications'] li").allInnerTexts();
    check(W, "a day filters the list to what happened that day", shown.length === 3 && ["Fernway", "Mirro", "Orchard"].every((c) => shown.some((s) => s.includes(c))), shown);
    check(W, "the day is pressed", (await days.nth(2).getAttribute("aria-pressed")) === "true", null);
    await page.getByRole("button", { name: /^Clear Wed 4 Nov/ }).click();
    check(W, "Clear brings everything back", (await page.locator("main ul[aria-label='Applications'] li").count()) === 9, null);
    await page.getByRole("button", { name: "Previous week" }).click();
    check(W, "the previous week", (await page.locator("#week-title").innerText()).startsWith("Last week") && (await days.nth(2).innerText()).includes("October"), await page.locator("#week-title").innerText());
    await context.close();
  }
  // Fewer than 5 settled: counts only.
  {
    const { context, page } = await open(browser, "/applications", { small: true });
    check(W, "small sample: counts and the note, no rates", (await page.locator("main").innerText()).includes("Rates show once 5 applications have had an answer or 30 days.") && !(await page.locator("main").innerText()).includes("Response rate"), null);
    await context.close();
  }
  // Empty and offline.
  for (const [label, o, text] of [["empty: Nothing sent yet, Go to Today", { apps: [] }, "Nothing sent yet"], ["offline: can't reach Norinote", { offline: true }, "Couldn’t reach Norinote"]]) {
    const { context, page } = await open(browser, "/applications", o);
    check(W, label, await page.locator("main", { hasText: text }).isVisible(), null);
    if (o.apps) check(W, "Go to Today links to /today", (await page.locator("main a", { hasText: "Go to Today" }).getAttribute("href")) === "/today", null);
    await context.close();
  }
  // A row opens its page; the page's header, timeline, resume and receipt.
  {
    const { context, page } = await open(browser, "/applications");
    await page.locator("main ul[aria-label='Applications'] a", { hasText: "Design systems designer" }).click();
    check(W, "a row opens /applications/:id", await landsOn(page, "/applications/a5"), page.url());
    await page.locator("main", { hasText: "Timeline" }).waitFor({ timeout: 6000 }).catch(() => {});
    await wait(800);
    check(W, "the header: title, chip, Open the job posting", (await page.locator("main h1").innerText()) === "Design systems designer" && (await page.locator("main a", { hasText: "Open the job posting" }).getAttribute("href")) === "https://jobs.example.test/j5" && (await page.locator("main").innerText()).includes("Interview"), null);
    const entries = await page.locator("ol[aria-label^='What happened'] > li").allInnerTexts();
    check(W, "the timeline, newest first: the interview from the inbox, sent, what Nori did, created", /^Interview/.test(entries[0] ?? "") && entries[0].includes("From Nori's inbox · Interview: Design systems designer") && entries.some((e) => e.startsWith("Sent")) && entries.at(-1)?.startsWith("Created from Today"), entries);
    check(W, "the interview links to its message", (await page.locator("ol[aria-label^='What happened'] a", { hasText: "Interview" }).first().getAttribute("href")) === "/inbox/m1", null);
    check(W, "the run log's last 5 lines, the rest folded", (await page.locator("text=Show everything Nori did").count()) === 1, null);
    check(W, "the resume sent", (await page.locator("main").innerText()).includes("1 line changed for this job"), null);
    await context.close();
  }
  // Marking by hand, Undo, the receipt.
  {
    const { context, page, calls } = await open(browser, "/applications/a3");
    const text = await page.locator("main").innerText();
    check(W, "the receipt: confirmation, time, practice run, screenshot", text.includes("Confirmation FW-20931 · sent in 18 s") && text.includes("A practice run: nothing reached the employer.") && (await page.locator("main a", { hasText: "See the screenshot" }).getAttribute("href")) === `${API}/api/artifacts/a3/filled.png`, text.slice(0, 600));
    await page.locator("main section[aria-labelledby=mark-title] button", { hasText: "Interview" }).click();
    await wait(500);
    const posted = calls.find((c) => c.key === "POST /applications/a3/outcomes");
    check(W, "Interview is sent to the API", JSON.parse(posted?.body ?? "{}").kind === "interview", posted);
    const first = await page.locator("ol[aria-label^='What happened'] > li").first().innerText();
    check(W, "it's at the top of the timeline, marked by you, with Undo", first.startsWith("Interview") && first.includes("Marked by you") && first.includes("Undo"), first);
    check(W, "the chip follows", (await page.locator("main > div").first().innerText()).includes("Interview"), null);
    check(W, "it's announced", (await page.locator("main p[role=status]").innerText()) === "Marked as interview. Undo is available.", await page.locator("main p[role=status]").innerText());
    await wait(400);
    check(W, "Nori celebrates", (await noriRow(page)) === "celebrate", await noriRow(page));
    await page.locator("ol[aria-label^='What happened'] button", { hasText: "Undo" }).click();
    await wait(500);
    check(W, "Undo removes it", calls.some((c) => /^DELETE \/applications\/a3\/outcomes\/n\d$/.test(c.key)) && !(await page.locator("ol[aria-label^='What happened'] > li").first().innerText()).startsWith("Interview"), null);
    check(W, "and the chip goes back to Waiting", (await page.locator("main > div").first().innerText()).includes("Waiting"), null);
    await context.close();
  }
  // Still in progress: the live panel's content; not sent, so nothing to mark.
  {
    const { context, page } = await open(browser, "/applications/a2");
    check(W, "needs you: the questions on the page", (await page.locator("main").innerText()).includes("Nori needs 2 answers to finish this one."), null);
    check(W, "not sent yet: no What happened?", (await page.locator("#mark-title").count()) === 0, null);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a-missing");
    check(W, "not found", (await page.locator("main h1").innerText()).startsWith("That application isn"), await page.locator("main h1").innerText());
    await context.close();
  }
  // The Inbox: newest open, the code, Copy, filters, new mail.
  {
    const { context, page } = await open(browser, "/inbox", { seen: { "norinote-inbox-seen-at": at("2026-11-04T06:45:00") } }, { permissions: ["clipboard-read", "clipboard-write"] });
    check(W, "from 1024 px the newest message opens", await landsOn(page, "/inbox/m2"), page.url());
    await wait(600);
    const pane = await page.locator("main article").innerText();
    check(W, "the code, large, with Copy and 'already entered'", pane.includes("482913") && pane.includes("Nori already entered it."), pane);
    check(W, "Nori catches the code", ["catch", "hold"].includes(await noriRow(page)), await noriRow(page));
    await page.getByRole("button", { name: "Copy the code" }).click();
    await wait(200);
    check(W, "Copy copies and says Copied", (await page.evaluate(() => navigator.clipboard.readText())) === "482913" && (await page.locator("main article button", { hasText: "Copied" }).count()) === 1, null);
    const items = await page.locator("ul[aria-label=Messages] li").allInnerTexts();
    check(W, "six messages, newest first, with their kind and application", items.length === 6 && items[0].includes("Code") && items[0].includes("Product designer · Fernway") && items[1].includes("Interview"), items);
    const newOnes = await page.locator("ul[aria-label=Messages] li .sr-only", { hasText: "new" }).count();
    check(W, "new since the last visit: one (the open code is read)", newOnes === 1 && items[1].includes("Priya"), newOnes);
    await page.locator("ul[aria-label=Messages] a", { hasText: "Priya at Mirro" }).click();
    check(W, "a message opens in the pane and the URL follows", await landsOn(page, "/inbox/m1"), page.url());
    await wait(400);
    const p2 = await page.locator("main article").innerText();
    check(W, "the interview: body, attachment, Open the application", p2.includes("We'd love to talk") && p2.includes("interview-guide.pdf · 82 KB") && (await page.locator("main article a", { hasText: "Open the application" }).getAttribute("href")) === "/applications/a5", p2);
    check(W, "Nori checks the mail", (await noriRow(page)) === "check-mail", { now: await noriRow(page), played: await played(page) });
    await page.goBack();
    check(W, "Back goes to the previous message", await landsOn(page, "/inbox/m2"), page.url());
    await page.locator("main [role=group] button", { hasText: "Replies" }).click();
    check(W, "Replies: interview, rejection, reply", (await page.locator("ul[aria-label=Messages] li").count()) === 3, null);
    await page.locator("main [role=group] button", { hasText: "Codes" }).click();
    check(W, "Codes: the code", (await page.locator("ul[aria-label=Messages] li").count()) === 1, null);
    await page.locator("main [role=group] button", { hasText: "All" }).click();
    await page.locator("ul[aria-label=Messages] a", { hasText: "Career Boost" }).click();
    await wait(500);
    const spam = await page.locator("main article").innerText();
    check(W, "spam: marked, and its link isn't offered", spam.includes("Marked as spam") && (await page.locator("main article a", { hasText: "Confirm with the employer" }).count()) === 0, spam);
    await page.locator("ul[aria-label=Messages] a", { hasText: "Confirm your email" }).click();
    await wait(500);
    check(W, "a verification link as a button", (await page.locator("main article a", { hasText: "Confirm with the employer" }).getAttribute("href")) === "https://fernway.example.test/confirm?t=abc", null);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await wait(200);
    check(W, "Copy the address", (await page.evaluate(() => navigator.clipboard.readText())) === "alex.r@inbox.norinote.test", null);
    await context.close();
  }
  // Settings.
  {
    const { context, page, calls } = await open(browser, "/inbox");
    const sum = page.locator("main details summary");
    check(W, "settings folded, with a summary", (await sum.innerText()).includes("Not forwarding · kept 90 days"), await sum.innerText());
    await sum.click();
    await page.locator("label", { hasText: "Forward a copy to my email" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    check(W, "forwarding needs an address", (await page.locator("main details").innerText()).includes("Add the email to forward to.") && !calls.some((c) => c.key === "PUT /inbox/settings"), null);
    await page.fill("#forward-to", "alex@example.test");
    await page.selectOption("#keep-for", "30");
    await page.getByRole("button", { name: "Save" }).click();
    await wait(400);
    const put = JSON.parse(calls.find((c) => c.key === "PUT /inbox/settings")?.body ?? "{}");
    check(W, "Save sends the settings", put.forwardEnabled === true && put.forwardTo === "alex@example.test" && put.retentionDays === 30, put);
    check(W, "and the summary follows", (await sum.innerText()).includes("Forwarding to alex@example.test · kept 30 days"), await sum.innerText());
    await context.close();
  }
  // Phones: the list, then the message on its own page.
  {
    const { context, page } = await open(browser, "/inbox", {}, { viewport: { width: 390, height: 844 } });
    check(W, "phones: the list, no pane", (await page.locator("ul[aria-label=Messages]").isVisible()) && !(await page.locator("main article").isVisible()), null);
    await page.locator("ul[aria-label=Messages] a", { hasText: "Priya at Mirro" }).click();
    await landsOn(page, "/inbox/m1");
    await wait(500);
    check(W, "phones: the message on its own page, the list hidden", (await page.locator("main article").isVisible()) && !(await page.locator("ul[aria-label=Messages]").isVisible()), null);
    check(W, "phones: focus on the subject", (await page.evaluate(() => document.activeElement?.id)) === "message-title", await page.evaluate(() => document.activeElement?.id));
    await page.locator("main a", { hasText: "‹ Inbox" }).click();
    check(W, "phones: ‹ Inbox goes back to the list", await landsOn(page, "/inbox"), page.url());
    await context.close();
  }
  for (const [label, o, text] of [["inbox switched off", { inboxOff: true }, "inbox isn’t switched on yet"], ["inbox empty", { messages: [] }, "Nothing here yet"]]) {
    const { context, page } = await open(browser, "/inbox", o);
    check(W, label, await page.locator("main", { hasText: text }).isVisible(), null);
    await context.close();
  }
  // Nori on Applications: the most important outcome since the last visit, once; nothing on a first visit.
  {
    const { context, page } = await open(browser, "/applications", { seen: { "norinote-last-seen-outcomes": at("2026-11-03T00:00:00") } });
    await wait(600);
    check(W, "since the last visit: an interview and a rejection, so Nori celebrates", (await played(page)).includes("celebrate"), await played(page));
    const stored = await page.evaluate(() => localStorage.getItem("norinote-last-seen-outcomes"));
    check(W, "the last visit moves on", stored === at("2026-11-04T07:00:00"), stored);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications");
    await wait(600);
    check(W, "a first visit stays quiet", !(await played(page)).includes("celebrate"), await played(page));
    await context.close();
  }
  // A verification code emailed to the person's own address: they type it while the run waits (awaiting_code).
  {
    const { context, page, calls, errors } = await open(browser, "/applications/a10", { apps: CODE_APPS() });
    const box = page.locator("main form", { hasText: "The employer just emailed you a verification code" });
    const input = page.locator("#code-a10");
    const first = await page.locator("main section").first().evaluate((el) => el.firstElementChild?.firstElementChild?.tagName ?? el.firstElementChild?.tagName).catch(() => null);
    check(W, "code: the box leads the page's status card", (await box.isVisible()) && first === "FORM", first);
    check(W, "code: the field has the focus", (await page.evaluate(() => document.activeElement?.id)) === "code-a10", await page.evaluate(() => document.activeElement?.id));
    check(W, "code: labelled, one-time-code, text keyboard", (await page.getByLabel("Type it here and Nori will finish the application").count()) === 1 && (await input.getAttribute("autocomplete")) === "one-time-code" && (await input.getAttribute("inputmode")) === "text", null);
    check(W, "code: says the wait is about 8 minutes", (await box.innerText()).includes("about 8 minutes"), null);
    const posts = () => calls.filter((c) => c.key === "POST /applications/a10/code");
    await page.getByRole("button", { name: "Send code" }).click();
    check(W, "code: empty is caught before sending", (await box.innerText()).includes("Type the code from the email") && posts().length === 0 && (await input.getAttribute("aria-invalid")) === "true", null);
    await input.fill("48#2");
    await page.getByRole("button", { name: "Send code" }).click();
    check(W, "code: a malformed code is caught before sending", (await box.innerText()).includes("3 to 20 letters or digits") && posts().length === 0, null);
    await input.fill("482 913");
    await page.keyboard.press("Enter");
    const got = await page.getByRole("status").filter({ hasText: "Got it, finishing your application" }).waitFor({ timeout: 4000 }).then(() => true, () => false);
    check(W, "code: sent as typed, then Got it", got && posts().length === 1 && JSON.parse(posts()[0].body).code === "482 913", posts());
    const done = await page.locator("#mark-title").waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(W, "code: the page moves on once the run sends it", done && !(await box.count()), null);
    check(W, "code: no errors", errors.length === 0, errors);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a10", { apps: CODE_APPS(), code: "bad" });
    await page.locator("#code-a10").fill("ABC-123");
    await page.getByRole("button", { name: "Send code" }).click();
    await wait(400);
    const err = await page.locator("#code-a10-error").innerText().catch(() => "");
    check(W, "code: the API's 400 shows under the field", err.includes("only letters, digits, spaces and dashes") && (await page.evaluate(() => document.activeElement?.id)) === "code-a10", err);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a10", { apps: CODE_APPS(), code: "gone" });
    await page.locator("#code-a10").fill("482913");
    await page.getByRole("button", { name: "Send code" }).click();
    const late = await page.locator("main", { hasText: "No code reached Nori in time" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    const text = await page.locator("main").innerText();
    check(W, "code: 409 refreshes and shows where it is now", late && !(await page.locator("#code-a10").count()) && text.includes("not waiting for a code"), text.slice(0, 400));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a1", { apps: CODE_APPS(), startsWaiting: true });
    const shown = await page.locator("#code-a1").waitFor({ timeout: 10000 }).then(() => true, () => false);
    check(W, "code: the box appears without a reload when the run starts waiting", shown, null);
    await context.close();
  }
  {
    const { context, page, calls } = await open(browser, "/applications/a11", { apps: CODE_APPS() });
    const text = await page.locator("main").innerText();
    check(W, "code ran out: Try again, not the captcha wording", text.includes("No code reached Nori in time") && !text.includes("Nori never gets around those"), text.slice(0, 400));
    await page.getByRole("button", { name: "Try again" }).click();
    await wait(400);
    check(W, "code ran out: Try again asks for a retry", calls.some((c) => c.key === "POST /applications/a11/retry"), null);
    check(W, "code ran out: the employer's page is a way out", (await page.getByRole("link", { name: "Finish on the employer’s page" }).getAttribute("href")) === "https://jobs.example.test/j11", null);
    await context.close();
  }
}

// ---- accessibility, keyboard, performance -----------------------------------------------------------------------------

async function axe(browser) {
  const states = [["/applications", {}], ["/applications/a3", {}], ["/applications/a2", {}], ["/applications/a10", { apps: CODE_APPS() }], ["/applications/a11", { apps: CODE_APPS() }], ["/inbox", {}], ["/inbox/m1", {}], ["/inbox", { inboxOff: true }]];
  for (const scheme of ["light", "dark"]) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const [path, o] of states) {
        const where = `chromium ${path}${o.inboxOff ? " (off)" : ""} ${w}x${h} ${scheme} axe`;
        const { context, page } = await open(browser, path, o, { viewport: { width: w, height: h }, colorScheme: scheme });
        if (path === "/inbox" && !o.inboxOff) await page.locator("main details summary").click();
        await wait(600);
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
  for (const [path, count, order] of [["/applications", 30, ["Applications", "Previous week", "All", "Brand designer"]], ["/inbox", 24, ["Inbox", "Copy", "Settings", "All", "Fernway via Greenhouse", "Copy the code"]]]) {
    const where = `chromium ${path} 1440x900 keyboard`;
    const { context, page } = await open(browser, path);
    const stops = [];
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          // The name as a screen reader hears it: without what's aria-hidden (the logo's letter tile).
          const copy = el.cloneNode(true);
          copy.querySelectorAll?.("[aria-hidden=true]").forEach((n) => n.remove());
          return { name: (el.getAttribute("aria-label") || copy.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40), ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(cs.boxShadow), size: [Math.round(r.width), Math.round(r.height)] };
        }),
      );
    }
    const seen = stops.filter(Boolean);
    check(where, "skip link first", seen[0]?.name === "Skip to content", seen[0]);
    const idx = order.map((n) => seen.findIndex((s) => s.name.startsWith(n)));
    check(where, `in order: ${order.join(", ")}`, idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])), seen.map((s) => s.name));
    check(where, "every stop shows the focus ring", seen.every((s) => s.ring), seen.filter((s) => !s.ring).map((s) => s.name));
    check(where, "targets at least 24 px", seen.every((s) => s.size[0] >= 24 && s.size[1] >= 24), seen.filter((s) => s.size[0] < 24 || s.size[1] < 24));
    await context.close();
  }
}

async function performance(browser) {
  for (const path of ["/applications", "/inbox"]) {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
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
        new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window.__lcp = e.startTime), (window.__lcpEl = e.element ? e.element.tagName.toLowerCase() : null)))).observe({ type: "largest-contentful-paint", buffered: true });
        window.__shifts = [];
        new PerformanceObserver((l) => l.getEntries().forEach((e) => {
          if (e.hadRecentInput) return;
          window.__cls += e.value;
          window.__shifts.push(`${e.value.toFixed(3)} ${(e.sources ?? []).map((x) => x.node?.textContent?.trim().slice(0, 24) ?? x.node?.nodeName).join(" | ")}`);
        })).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await wait(800);
      const kb = await page.evaluate(() => Math.round((performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) / 1024));
      const heaviest = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => `${Math.round(e.transferSize / 1024)} KB ${e.name.split("/").pop().slice(0, 40)}`).sort((x, y) => parseInt(y) - parseInt(x)).slice(0, 10));
      const mono = await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /mono/i.test(e.name) && e.name.includes("woff")));
      await wait(4000);
      const r = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), el: window.__lcpEl, cls: Number(window.__cls.toFixed(3)), shifts: window.__shifts }));
      check(where, "LCP under 2.0 s", r.lcp <= 2000, `${r.lcp} ms (${r.el})`);
      check(where, "CLS under 0.05", r.cls <= 0.05, r.cls <= 0.05 ? r.cls : { cls: r.cls, shifts: r.shifts });
      check(where, "under 450 KB before the first interaction", kb > 0 && kb <= 450, kb > 0 && kb <= 450 ? `${kb} KB` : { kb, heaviest });
      if (path === "/applications") check(where, "no Geist Mono on the first screen", !mono, null);
      await context.close();
    }
  }
}

/** A real run (no mocks): sign up, onboard, then Applications and the Inbox as a new account sees them. */
async function endToEnd(browser) {
  const W = "chromium end to end";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  await page.fill("#signup-email", `apps-${Date.now()}@example.test`);
  await page.fill("#signup-password", "first-pass-123");
  await page.click("text=Create account");
  await landsOn(page, "/onboarding/resume");
  const steps = await page.evaluate(async (api) => {
    const put = (step, data) => fetch(`${api}/api/onboarding`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, data }) }).then((r) => r.status);
    await fetch(`${api}/api/profile/resume`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Alex Rivera\nProduct Designer, Fernway, 2022 to now. Figma, research, prototyping, design systems." }) });
    return [await put("resume", {}), await put("contact", { fullName: "Alex Rivera" }), await put("authorization", { workAuth: { authorizedUS: true, needsSponsorship: false } }), await put("screening", { over18: true }), await put("preferences", { preferences: { titles: ["Product designer"] } })];
  }, API);
  check(W, "onboarding through the API", steps.every((s) => s === 200), steps);
  await page.goto(`${BASE}/applications`, { waitUntil: "load" });
  check(W, "a new account's Applications: Nothing sent yet", await page.locator("main", { hasText: "Nothing sent yet" }).waitFor({ timeout: 10000 }).then(() => true, () => false), await page.locator("main").innerText());
  const summary = await page.evaluate(async (api) => (await fetch(`${api}/api/outcomes/summary`, { credentials: "include" })).json(), API);
  check(W, "the real summary: no applications, a small sample", summary.overall?.applications === 0 && summary.overall.smallSample === true, summary.overall);
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  const addr = await page.evaluate(async (api) => (await fetch(`${api}/api/inbox/address`, { credentials: "include" })).json(), API);
  const expect = addr.configured ? "Nothing here yet" : "inbox isn’t switched on yet";
  check(W, `the real Inbox (${addr.configured ? "configured" : "no inbound domain"})`, await page.locator("main", { hasText: expect }).waitFor({ timeout: 10000 }).then(() => true, () => false), await page.locator("main").innerText());
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
