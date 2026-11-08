// QA for dashboard v2's Overview (/overview, docs/dashboard-v2-plan.md section 1), with the API mocked (sample data, tests
// only): the greeting, four Recommended cards (three below 1280 px, a sideways row on phones) with View all, Apply opening
// the live panel, the applications graph (182 days, the total, a square a day), the empty states, and no page overflow.
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa-overview npx next build
//   NEXT_DIST_DIR=.next-qa-overview npx next start -p 3431
//   node tests/qa-overview.mjs [--base http://localhost:3431] [--api http://localhost:4101]
// Writes test-results/qa-overview/report.json and screenshots; exits 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-overview");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const BASE = arg("base", "http://localhost:3431");
const API = arg("api", "http://localhost:4101");
// A fixed Wednesday morning, so the greeting, the date line and the graph are the same on every run.
const MORNING = new Date("2026-11-04T09:00:00-05:00"); // in the browser's zone, America/New_York

mkdirSync(OUT, { recursive: true });
const results = [];
const check = (where, what, ok, detail) => results.push({ ok: !!ok, where, what, detail });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the mocked API (sample data) -------------------------------------------------------------------------------------

const hoursAgo = (h) => new Date(MORNING.getTime() - h * 3_600_000).toISOString();
const item = (id, title, company, location, remote, posted, score) => ({
  job: { id, companyName: company, companyLogoUrl: null, title, location, remote, applyUrl: `https://jobs.example.test/${id}`, postedAt: hoursAgo(posted) },
  match: { jobId: id, score, explanation: { matched: [], missing: [], reasons: [] }, widenedBy: null, computedAt: hoursAgo(1) },
  applicationStatus: null,
  saved: false,
});
const JOBS = [
  item("j1", "Product designer, checkout and payments across web and mobile", "Fernway", "Brooklyn, NY", false, 2, 0.86),
  item("j2", "UX designer", "Halden Labs", null, true, 5, 0.81),
  item("j3", "Design systems designer", "Mirro", "New York, NY", false, 26, 0.78),
  item("j4", "Senior product designer", "Quillby", "Austin, TX", false, 50, 0.74),
  item("j5", "Interaction designer", "Tamsin", "Remote", true, 60, 0.7),
];
/** 182 local days ending on MORNING's date, oldest first, with a few sent on some weekdays. */
function activity(empty) {
  const days = [];
  for (let i = 181; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 10, 4 - i)); // MORNING's local date, whatever zone node runs in
    const date = d.toISOString().slice(0, 10);
    const sent = empty || i > 120 || d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0 : [0, 1, 2, 0, 3, 5, 1][i % 7];
    days.push({ date, sent });
  }
  return { days, total: days.reduce((n, d) => n + d.sent, 0), timezone: "UTC" };
}

async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const calls = [];
  const apps = new Map();
  const jobs = o.jobs ?? JOBS;
  const act = activity(o.emptyActivity);
  await context.route(`${API}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api/, "")}`;
    calls.push({ key, search: url.search, body: req.postData() });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) });
    const user = { id: "u1", email: "alex@example.test", name: "Alex Rivera", emailVerifiedAt: MORNING.toISOString(), createdAt: MORNING.toISOString() };
    if (key === "GET /auth/session") return reply(200, { user });
    if (key === "GET /onboarding") return reply(200, { step: "done", profile: {} });
    if (key === "GET /me") return reply(200, { user, profile: { fullName: "Alex Rivera" } });
    if (key === "GET /agent/status") return reply(200, { dailyCap: 0, usedToday: 0, liveSubmit: false });
    if (key === "GET /shortlist") return reply(200, []);
    if (key === "GET /jobs") return o.offline ? route.abort("connectionrefused") : reply(200, jobs);
    if (key === "GET /applications/activity") return reply(200, act);
    if (key === "GET /applications") return reply(200, [...apps.values()].map((a) => ({ application: a, job: jobs.find((j) => j.job.id === a.jobId)?.job, resume: null })));
    if (key === "POST /applications") {
      const jobId = JSON.parse(req.postData() ?? "{}").jobId;
      const id = `a${apps.size + 1}`;
      apps.set(id, { id, jobId, status: "preparing", pendingQuestions: [], receipt: null, error: null, preparedAt: null, approvedAt: null, submittedAt: null, createdAt: MORNING.toISOString(), updatedAt: MORNING.toISOString() });
      return reply(201, apps.get(id));
    }
    const one = key.match(/^GET \/applications\/(a\d+)$/);
    if (one && apps.has(one[1])) {
      const a = apps.get(one[1]);
      return reply(200, { application: a, job: jobs.find((j) => j.job.id === a.jobId)?.job, resume: null, events: [] });
    }
    if (/\/live$/.test(key)) return reply(404, { error: "No live view" });
    return reply(200, { ok: true });
  });
  return { calls };
}

async function open(browser, o = {}, size = [1440, 900]) {
  const mobile = size[0] < 768;
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, isMobile: mobile, hasTouch: mobile, timezoneId: "America/New_York" });
  const mock = await mockApi(context, o);
  const page = await context.newPage();
  await page.clock.setFixedTime(MORNING);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${BASE}/overview`, { waitUntil: "load" });
  await page.locator("main h1", { hasText: "Alex" }).waitFor({ timeout: 10000 }).catch(() => {});
  await wait(o.settle ?? 1200);
  return { context, page, errors, ...mock };
}

const visibleCards = (page) => page.locator("[data-overview-cards] > li").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length);
const pageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const browser = await chromium.launch({ channel: "chromium" }).catch(() => chromium.launch());

// Desktop: the whole page.
{
  const W = "1440";
  const { context, page, errors, calls } = await open(browser);
  const h1 = await page.locator("main h1").innerText().catch(() => "");
  check(W, "greets by first name for the time of day", h1 === "Good morning, Alex", h1);
  check(W, "the date line", await page.getByText("Wednesday, 4 November").isVisible().catch(() => false));
  // The header art: the morning hills in light theme (the night version is display:none), decorative, behind the words.
  const art = await page.evaluate(() => {
    const band = document.querySelector('section[aria-labelledby="hello"]');
    const shown = [...(band?.querySelectorAll("img") ?? [])].filter((i) => getComputedStyle(i.closest("[aria-hidden]") ?? i).display !== "none");
    return { shown: shown.map((i) => i.currentSrc || i.src).map((u) => u.replace(/^.*\/scenes\//, "")), alt: shown.every((i) => i.alt === "") };
  });
  check(W, "the header band shows the morning hills, decorative", art.shown.length === 1 && art.shown[0].startsWith("overview-dawn") && art.alt, art);
  check(W, "four Recommended cards at 1440", (await visibleCards(page)) === 4, await visibleCards(page));
  const titles = await page.locator("[data-overview-cards] h3").allInnerTexts();
  check(W, "best fit first, as the API sends them", titles[0]?.startsWith("Product designer") && titles[3] === "Senior product designer", titles);
  check(W, "the card shows the match", await page.locator("[data-overview-cards] li").first().getByText("86% match").isVisible());
  const box = await page.locator("[data-overview-cards] article").first().boundingBox();
  check(W, "the cards are square", box && Math.abs(box.width - box.height) <= 2, box);
  check(W, "View all goes to Jobs", (await page.getByRole("link", { name: "View all" }).getAttribute("href")) === "/jobs");
  const actCall = calls.find((c) => c.key === "GET /applications/activity");
  check(W, "asks for 182 days in the browser's zone", actCall && /days=182/.test(actCall.search) && /tz=America%2FNew_York/.test(actCall.search), actCall?.search);
  const cells = await page.locator("[data-activity-grid] [data-sent]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-sent"))));
  const expected = activity(false);
  check(W, "a square for each of the 182 days", cells.length === 182, cells.length);
  check(W, "the squares carry the API's counts", JSON.stringify(cells) === JSON.stringify(expected.days.map((d) => d.sent)));
  const total = await page.locator("[data-activity-total]").innerText().catch(() => "");
  check(W, "the total is the API's", total === `${expected.total} sent in the last 6 months`, total);
  // Wednesday 4 November is the last square: the fourth row (Mon, Tue, Wed …) of the last column.
  const last = await page.locator("[data-activity-grid] [data-sent]").last().boundingBox();
  const firstMon = await page.locator("[data-activity-grid] > span").first().boundingBox();
  check(W, "rows are weekdays, Monday on top", last && firstMon && Math.round((last.y - firstMon.y) / (last.height + 4)) === 2, { last, firstMon });
  const shades = await page.locator("[data-activity-grid] [data-sent]").evaluateAll((els) => new Set(els.map((e) => getComputedStyle(e).backgroundColor)).size);
  check(W, "darker the more were sent (several shades)", shades >= 4, shades);
  await page.locator("[data-activity-grid] [data-sent]").last().click();
  check(W, "picking a day names it", await page.getByText("Wed 4 Nov:").isVisible().catch(() => false));
  check(W, "month labels", (await page.getByText("Oct", { exact: true }).count()) === 1 && (await page.getByText("Nov", { exact: true }).count()) === 1);
  check(W, "no page overflow", (await pageOverflow(page)) <= 0, await pageOverflow(page));
  await page.screenshot({ path: join(OUT, "overview-1440.png"), fullPage: true });

  // Apply: the existing flow (POST /applications, then the live panel), and the card takes the status chip.
  await page.getByRole("button", { name: /^Apply to Product designer/ }).click();
  const panelOpened = await page.locator("[data-live-panel]").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const post = calls.find((c) => c.key === "POST /applications");
  check(W, "Apply sends the job", post && JSON.parse(post.body).jobId === "j1", post?.body);
  check(W, "Apply opens the live panel", panelOpened);
  await wait(1500);
  const chip = await page.locator("[data-overview-cards] li").first().innerText();
  check(W, "the card shows the application's status", !/\bApply\b/.test(chip.split("\n").at(-1) ?? "") && (await page.locator("[data-overview-cards] li").first().getByRole("button", { name: /^Apply/ }).count()) === 0 && /Getting it ready|Optimizing|Applying/.test(chip), chip);
  await page.screenshot({ path: join(OUT, "overview-1440-applied.png") });
  check(W, "no console errors", errors.length === 0, errors);
  await context.close();
}

// Below 1280 px: three cards.
for (const w of [1024, 1200]) {
  const { context, page } = await open(browser, {}, [w, 800]);
  check(String(w), "three Recommended cards below 1280 px", (await visibleCards(page)) === 3, await visibleCards(page));
  check(String(w), "no page overflow", (await pageOverflow(page)) <= 0, await pageOverflow(page));
  await context.close();
}
{
  const { context, page } = await open(browser, {}, [1280, 800]);
  check("1280", "four Recommended cards from 1280 px", (await visibleCards(page)) === 4, await visibleCards(page));
  await context.close();
}

// Phones: a sideways row of cards, the graph scrolled to today, nothing wider than the screen.
for (const size of [[390, 844], [360, 640]]) {
  const W = String(size[0]);
  const { context, page, errors } = await open(browser, {}, size);
  const row = await page.locator("[data-overview-cards]").evaluate((el) => ({ scroll: el.scrollWidth > el.clientWidth, overflowX: getComputedStyle(el).overflowX }));
  check(W, "the cards scroll sideways", row.scroll && row.overflowX === "auto", row);
  const graph = await page.locator("[data-activity-grid]").evaluate((el) => {
    const s = el.parentElement.parentElement;
    return { max: s.scrollWidth - s.clientWidth, at: s.scrollLeft };
  });
  check(W, "the graph starts at today (scrolled to its end)", graph.max > 0 && graph.at >= graph.max - 1, graph);
  check(W, "no page overflow", (await pageOverflow(page)) <= 0, await pageOverflow(page));
  const h1 = await page.locator("main h1").boundingBox();
  check(W, "the greeting fits", h1 && h1.x >= 0 && h1.x + h1.width <= size[0], h1);
  check(W, "no console errors", errors.length === 0, errors);
  await page.screenshot({ path: join(OUT, `overview-${W}.png`), fullPage: true });
  await context.close();
}

// Empty and offline.
{
  const { context, page } = await open(browser, { jobs: [], emptyActivity: true });
  check("empty", "no Recommended jobs says so", await page.getByText("No recommended jobs right now").isVisible().catch(() => false));
  check("empty", "a zero total is shown as zero", (await page.locator("[data-activity-total]").innerText().catch(() => "")) === "0 sent in the last 6 months");
  check("empty", "the empty graph explains itself", await page.getByText(/Nothing sent yet/).isVisible().catch(() => false));
  await page.screenshot({ path: join(OUT, "overview-empty.png"), fullPage: true });
  await context.close();
}
{
  const { context, page } = await open(browser, { offline: true }, [1440, 900]);
  check("offline", "the cards say Norinote couldn't be reached", await page.getByText("Couldn’t reach Norinote").isVisible().catch(() => false));
  await context.close();
}

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`FAIL ${f.where}: ${f.what}\n     ${JSON.stringify(f.detail)?.slice(0, 400)}`);
process.exitCode = failed.length ? 1 : 0;
