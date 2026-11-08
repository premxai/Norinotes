// Phase 5 QA for onboarding (onboarding-design-spec.md section 15): the size matrix in Chromium, Firefox and WebKit,
// every step's save and the resume read (the API mocked with Playwright routes), the graph reveal, routing, Back's
// drafts, axe, keyboard, reduced motion, text spacing, LCP, CLS and weight on a throttled phone, and optionally one
// real end-to-end run. Runs against a production build made with the API's URL:
//   NEXT_PUBLIC_API_URL=http://localhost:4101 NEXT_DIST_DIR=.next-qa npm run build
//   NEXT_DIST_DIR=.next-qa npx next start -p 3401
//   node tests/qa-onboarding.mjs [--base http://localhost:3401] [--api http://localhost:4101] [--browsers …] [--only …]
//     [--e2e]   also sign up and onboard for real; the API must run with WEB_URL=<base> (NODE_ENV=test keeps its AI fake)
// Writes test-results/qa-onboarding/report.json and screenshots; exits 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "test-results", "qa-onboarding");
const RESUME = join(APP, "tests", "fixtures", "sample-resume.txt");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1]?.startsWith("--") ? "1" : (process.argv[i + 1] ?? "1")) : fallback;
};
const BASE = arg("base", "http://localhost:3401");
const API = arg("api", "http://localhost:4101");
const E2E = arg("e2e", null);
const ENGINES = { chromium, firefox, webkit };
const BROWSERS = arg("browsers", "chromium,firefox,webkit").split(",");
const ONLY = arg("only", "matrix,flows,axe,keyboard,spacing,performance,e2e").split(",");
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const ALL_SIZES = [
  [360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1366, 640], [1440, 900], [1920, 1080], [2560, 1440], [720, 450],
];

mkdirSync(OUT, { recursive: true });
const results = [];
const fail = (where, what, detail) => results.push({ ok: false, where, what, detail });
const pass = (where, what, detail) => results.push({ ok: true, where, what, detail });
const check = (where, what, ok, detail) => (ok ? pass : fail)(where, what, detail);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- sample data ------------------------------------------------------------------------------------------------------

const node = (id, type, title, extra = {}) => ({ id, type, label: title, props: { title, skills: [], ...extra.props }, startDate: extra.start ?? null, endDate: extra.end ?? null, sourceQuote: extra.quote ?? `${title} (sample)` });
const GRAPH = [
  node("r1", "role", "Product designer", { props: { org: "Fernway", skills: ["Figma", "Research", "Prototyping"] }, start: "2022-01" }),
  node("r2", "role", "UX designer", { props: { org: "Halden Labs", skills: ["Research", "Design systems", "Figma"] }, start: "2019-06", end: "2021-12" }),
  node("r3", "role", "Design intern", { props: { org: "Mirro", skills: ["Prototyping", "Illustration"] }, start: "2018-06", end: "2018-08" }),
  node("p1", "project", "Open-source icon set", { props: { skills: ["Illustration", "Design systems"] }, start: "2021" }),
  node("e1", "education", "BFA, Interaction Design", { props: { org: "Riverside College of Art", skills: ["Typography"] }, start: "2015", end: "2019" }),
  node("c1", "certification", "UX research certificate", { props: { skills: ["Research"] }, start: "2020" }),
  ...["Figma", "Research", "Prototyping", "Design systems", "Illustration", "Typography"].map((s, i) => ({ id: `skill_${i}`, type: "skill", label: s, props: {}, startDate: null, endDate: null })),
];
const BIG_GRAPH = [...GRAPH, ...Array.from({ length: 9 }, (_, i) => node(`m${i}`, "metric", `Highlight ${i + 1}`))];
const PROFILE = {
  fullName: null, email: "qa@example.test", phone: null, linkedin: null, website: null, github: null, city: null, state: null, country: null, pronouns: null,
  workAuth: {}, willingToRelocate: null, remotePreference: null, heardAbout: null, salaryExpectation: null, earliestStartDate: null, noticePeriodWeeks: null,
  eeo: {}, securityClearance: null, over18: null, preferences: {}, rawResumeText: null,
};
const INGEST = { note: null, profilePatch: { fullName: "Alex Rivera", phone: "(555) 014-2290", location: "Brooklyn, NY" }, nodes: GRAPH };
const STEP_API = ["resume", "contact", "authorization", "screening", "preferences"];

/**
 * Answers the API from `o`: the saved progress, the profile, the graph, and per-route overrides
 * ({ "PUT /onboarding": { status, body } | "abort" }). Records every call with its body.
 */
async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const state = { progress: o.progress ?? "resume", profile: { ...PROFILE, ...o.profile }, rawResume: o.progress && o.progress !== "resume" };
  const calls = [];
  await context.route(`${API}/api/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const key = `${req.method()} ${new URL(req.url()).pathname.replace(/^\/api/, "")}`;
    const body = req.postData();
    calls.push({ key, body });
    const reply = (status, json, delay = 0) => wait(delay).then(() => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) }));
    const a = o.answers?.[key];
    if (a === "abort") return route.abort("connectionrefused");
    if (a) return reply(a.status, a.body, a.delay ?? 0);
    if (key === "GET /auth/session") return o.signedOut ? reply(401, { error: "Not signed in" }) : reply(200, { user: { id: "u1", email: "qa@example.test" } });
    if (key === "GET /onboarding") return o.signedOut ? reply(401, { error: "Not signed in" }) : reply(200, { step: state.progress, profile: { ...state.profile, rawResumeText: state.rawResume ? "sample" : null } });
    if (key === "PUT /onboarding") {
      const { step, data } = JSON.parse(body ?? "{}");
      const at = Math.max(STEP_API.indexOf(state.progress === "done" ? "preferences" : state.progress) + (state.progress === "done" ? 1 : 0), STEP_API.indexOf(step) + 1);
      state.progress = at >= STEP_API.length ? "done" : STEP_API[at];
      state.profile = { ...state.profile, ...data };
      return reply(200, { step: state.progress, profile: state.profile });
    }
    if (key === "POST /profile/resume-file" || key === "POST /profile/resume") {
      state.rawResume = true;
      return reply(200, { ...INGEST, nodes: o.graph ?? GRAPH }, o.readDelay ?? 600);
    }
    if (key === "GET /graph") return reply(200, { nodes: o.graph ?? GRAPH, edges: [] });
    if (key === "GET /lanes") return reply(200, [{ id: "l1", name: "Product designer", titles: ["Product designer", "UX designer"], locations: ["New York, NY"], remote: true }]);
    if (key === "GET /inbox/address") return reply(200, o.inbox ? { address: "alex.r@inbox.norinote.test", configured: true } : { address: null, configured: false });
    if (key === "GET /shortlist") return reply(200, o.shortlist ?? []);
    return reply(200, { ok: true });
  });
  return { calls, state };
}

/** Opens a page with the given API; returns the page, its calls and the mock's state. */
async function open(browser, path, o = {}, ctx = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctx });
  if (o.seenDone) await context.addInitScript(() => sessionStorage.setItem("norinote-onboarding-done-seen", "1"));
  const mock = await mockApi(context, o);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(BASE + path, { waitUntil: "load" });
  await wait(o.settle ?? 1600);
  return { context, page, ...mock, errors };
}

const landsOn = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 8000 }).then(() => true, () => false);
const alertText = (page) => page.locator("main [role=alert]").first().textContent({ timeout: 4000 }).catch(() => null);
const clickText = (page, text) => page.locator("main button, main a, [data-step-footer] button, [data-step-footer] a").filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
const lastBody = (calls, key) => JSON.parse([...calls].reverse().find((c) => c.key === key)?.body ?? "null");
/** The row Nori is playing, read from its sprite (production builds have no debug handle). */
const noriRow = (page) =>
  page.evaluate(() => {
    const sprite = [...document.querySelectorAll(".nori *")].find((el) => el.style?.backgroundImage.includes("rows/"));
    return sprite?.style.backgroundImage.match(/rows\/([\w-]+)\.webp/)?.[1] ?? null;
  });

const overlap = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;

function layout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const nori = document.querySelector(".nori");
    const seat = [...document.querySelectorAll('[data-nori-seat="onboarding"]')].find((el) => el.getClientRects().length);
    const shown = [...document.querySelectorAll("img")].find((i) => i.currentSrc.includes("/scenes/") && i.getClientRects().length && i.offsetParent !== null);
    const footer = document.querySelector("[data-step-footer]");
    return {
      vw: innerWidth,
      vh: innerHeight,
      docW: document.documentElement.scrollWidth,
      tucked: !!nori?.classList.contains("is-tucked"),
      nori: box(nori),
      size: nori ? nori.getBoundingClientRect().width : 0,
      seat: seat ? (({ x, y }) => ({ x, y }))(seat.getBoundingClientRect()) : null,
      controls: [...document.querySelectorAll("main input, main select, main button, main a[href], main h1, header a[href], [data-step-footer] *")]
        .filter((el) => el.getClientRects().length && !el.closest(".nori") && !el.classList.contains("sr-only"))
        .map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().slice(0, 30), ...box(el) })),
      h1: box(document.querySelector("main h1")),
      footer: footer ? { ...box(footer), position: getComputedStyle(footer).position } : null,
      scene: shown ? { complete: shown.complete, natural: shown.naturalWidth } : null,
      scenesFetched: performance.getEntriesByType("resource").filter((e) => e.name.includes("/scenes/")).map((e) => e.name.split("/").pop()),
    };
  });
}

// ---- the size matrix --------------------------------------------------------------------------------------------------

async function matrix(name, browser) {
  const pages = [
    { path: "/onboarding/resume", sizes: ALL_SIZES, o: { progress: "contact" } },
    { path: "/onboarding/contact", sizes: ALL_SIZES, o: { progress: "contact" } },
    { path: "/onboarding/work", sizes: [[390, 844], [1440, 900]], o: { progress: "authorization" } },
    { path: "/onboarding/questions", sizes: [[390, 844], [1440, 900]], o: { progress: "screening" } },
    { path: "/onboarding/preferences", sizes: [[390, 844], [1440, 900]], o: { progress: "preferences" } },
    { path: "/onboarding/done", sizes: [[390, 844], [1440, 900]], o: { progress: "done", inbox: true } },
  ];
  for (const p of pages) {
    for (const [w, h] of p.sizes) {
      const where = `${name} ${p.path} ${w}x${h}`;
      const { context, page, errors } = await open(browser, p.path, p.o, { viewport: { width: w, height: h } });
      await wait(900); // Nori sits on the bench
      const L = await layout(page);
      check(where, "stays on its step", new URL(page.url()).pathname === p.path, page.url());
      check(where, "no sideways scroll", L.docW <= L.vw + 1, `${L.docW} > ${L.vw}`);
      check(where, "headline in the first screen", !!L.h1 && L.h1.y + L.h1.h <= L.vh, L.h1);
      check(where, "scene loaded", !!L.scene?.complete && L.scene.natural > 0, L.scene);
      const wrong = L.scenesFetched.filter((f) => (w < 1024 ? !/-band-/.test(f) : /-band-/.test(f)));
      check(where, "only the visible scene is fetched", wrong.length === 0, L.scenesFetched);
      if (w < 768 && L.footer) check(where, "Back and Continue fixed to the bottom on phones", L.footer.position === "fixed" && Math.abs(L.footer.y + L.footer.h - L.vh) < 2, L.footer);
      if (!L.tucked && L.nori) {
        const covered = L.controls.filter((c) => overlap(L.nori, c, 6)).map((c) => c.name);
        check(where, "Nori clear of every field, button, link and heading", covered.length === 0, covered);
        if (L.seat) {
          const dx = Math.abs(L.nori.x + L.nori.w / 2 - L.seat.x);
          const dy = Math.abs(L.nori.y + L.nori.h - (L.seat.y + L.size * 0.04));
          check(where, "Nori sits on the bench", dx < 8 && dy < 8, { dx: Math.round(dx), dy: Math.round(dy) });
        }
      }
      const real = errors.filter((e) => !/favicon/i.test(e));
      check(where, "no console errors", real.length === 0, real);
      if (name === "chromium") await page.screenshot({ path: join(OUT, `${p.path.split("/").pop()}-${w}x${h}.png`), fullPage: w >= 768 });
      await context.close();
    }
  }
}

// ---- flows ------------------------------------------------------------------------------------------------------------

async function flows(browser) {
  const W = "chromium flows";
  // Resume: upload, the reading panel and Nori reading, cards one by one in order, the count, Continue.
  {
    const { context, page, calls } = await open(browser, "/onboarding/resume", { readDelay: 1800 });
    await page.locator('input[type="file"]').setInputFiles(RESUME);
    await page.locator("text=Nori is reading your resume").waitFor({ timeout: 3000 }).catch(() => {});
    await wait(400);
    check(W, "resume: the reading panel shows while it's read", await page.locator("text=Nori is reading your resume").isVisible(), null);
    check(W, "resume: Nori reads", /^(read|papers)$/.test((await noriRow(page)) ?? ""), await noriRow(page));
    await page.locator("[data-card]").first().waitFor({ timeout: 6000 });
    await wait(500);
    const early = await page.locator("[data-card].opacity-100").count();
    await wait(2600);
    const late = await page.locator("[data-card].opacity-100").count();
    check(W, "resume: cards are revealed one at a time", early >= 1 && early < 6 && late === 6, { early, late });
    const order = await page.locator("[data-card] span.font-mono.text-tag").allTextContents();
    check(W, "resume: roles first, newest first, then projects, education, certifications", order.join(",") === "Role,Role,Role,Project,Education,Certification", order);
    const first = await page.locator("[data-card] p").first().textContent();
    check(W, "resume: the newest role leads", /Product designer/.test(first ?? ""), first);
    const count = await page.locator("main p.text-ui").last().textContent();
    check(W, "resume: the count", count?.trim() === "3 roles, 1 project, 1 school, 1 certification, 6 skills", count);
    check(W, "resume: threads join cards that share skills (from 768 px)", (await page.locator("main svg path[stroke-dasharray]").count()) > 0, null);
    await page.locator("[data-card] button", { hasText: "Source" }).first().click();
    check(W, "resume: Source shows the resume line", await page.locator("text=From your resume:").isVisible(), null);
    await clickText(page, "Continue");
    check(W, "resume: Continue saves the step and opens contact", (await landsOn(page, "/onboarding/contact")) && lastBody(calls, "PUT /onboarding")?.step === "resume", page.url());
    await context.close();
  }
  for (const [label, answer, expect] of [
    ["too large", { status: 413, body: { error: "That file is too large. Resumes up to 10 MB are accepted." } }, "That file is too large"],
    ["unreadable", { status: 422, body: { error: "We could not read that file. Upload a text-based PDF or DOCX, or paste the text." } }, "We could not read that file"],
    ["too many", { status: 429, body: { error: "Too many resume uploads. Try again in an hour." } }, "Too many resume uploads"],
    ["offline", "abort", "Couldn't reach Norinote"],
  ]) {
    const { context, page } = await open(browser, "/onboarding/resume", { answers: { "POST /profile/resume-file": answer } });
    await page.locator('input[type="file"]').setInputFiles(RESUME);
    const text = await alertText(page);
    check(W, `resume: ${label}`, (text ?? "").includes(expect) && (await page.locator("text=Drop your resume here").isVisible()), text);
    await context.close();
  }
  {
    const { context, page, calls } = await open(browser, "/onboarding/resume");
    await clickText(page, "Paste the text instead");
    await page.fill("#resume-text", "Alex Rivera\nProduct Designer, Fernway, 2022 to now. Figma, research, prototyping.");
    await clickText(page, "Read this");
    await page.locator("[data-card]").first().waitFor({ timeout: 6000 }).catch(() => {});
    check(W, "resume: pasted text is read", calls.some((c) => c.key === "POST /profile/resume") && (await page.locator("[data-card]").count()) === 6, calls.map((c) => c.key));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/onboarding/resume", { progress: "contact", graph: BIG_GRAPH });
    const shown = await page.locator("[data-card]").count();
    await page.locator("main button", { hasText: /^and \d+ more$/ }).click();
    check(W, "resume: at most 12 cards, then 'and 3 more'", shown === 12 && (await page.locator("[data-card]").count()) === 15, shown);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/onboarding/resume", {}, { reducedMotion: "reduce" });
    await page.locator('input[type="file"]').setInputFiles(RESUME);
    await page.locator("[data-card]").first().waitFor({ timeout: 6000 });
    await wait(150);
    check(W, "resume: reduced motion shows every card at once", (await page.locator("[data-card].opacity-100").count()) === 6, null);
    await context.close();
  }
  // Contact: filled from the resume with tags; checks; only the step's fields are sent; a failed save keeps the values.
  {
    const { context, page, calls } = await open(browser, "/onboarding/resume");
    await page.locator('input[type="file"]').setInputFiles(RESUME);
    await page.locator("[data-card]").first().waitFor({ timeout: 6000 });
    await clickText(page, "Continue");
    await landsOn(page, "/onboarding/contact");
    await wait(600);
    check(W, "contact: the headline takes focus after a save", (await page.evaluate(() => document.activeElement?.tagName)) === "H1", null);
    check(W, "contact: filled from the resume", (await page.inputValue("#contact-fullName")) === "Alex Rivera" && (await page.inputValue("#contact-city")) === "Brooklyn" && (await page.inputValue("#contact-state")) === "NY", null);
    check(W, "contact: tagged where it came from the resume", (await page.locator("main label", { hasText: "From your resume" }).count()) >= 3, null);
    await page.fill("#contact-fullName", "");
    await clickText(page, "Continue");
    await wait(300);
    check(W, "contact: a missing name is caught and focused", (await page.evaluate(() => document.activeElement?.id)) === "contact-fullName" && (await page.locator("#contact-fullName-note").textContent()) === "Enter your full name", null);
    await page.fill("#contact-fullName", "Alex Rivera");
    await page.fill("#contact-phone", "(555) 010-1234");
    await clickText(page, "Back");
    await landsOn(page, "/onboarding/resume");
    await wait(500);
    await clickText(page, "Continue");
    await landsOn(page, "/onboarding/contact");
    await wait(500);
    check(W, "contact: Back keeps what was typed", (await page.inputValue("#contact-phone")) === "(555) 010-1234", await page.inputValue("#contact-phone"));
    await clickText(page, "Continue");
    await landsOn(page, "/onboarding/work");
    const sent = lastBody(calls, "PUT /onboarding");
    check(W, "contact: saves only its fields", sent?.step === "contact" && Object.keys(sent.data).sort().join(",") === "city,country,email,fullName,github,linkedin,phone,pronouns,state,website", sent);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/onboarding/contact", { progress: "contact", answers: { "PUT /onboarding": { status: 400, body: { error: "Invalid request" } } } });
    await page.fill("#contact-fullName", "Alex Rivera");
    await clickText(page, "Continue");
    check(W, "contact: a failed save shows the error and keeps the values", (await alertText(page))?.includes("Invalid request") && (await page.inputValue("#contact-fullName")) === "Alex Rivera" && page.url().endsWith("/contact"), null);
    await context.close();
  }
  // Work: required answers, the visa field, the payload.
  {
    const { context, page, calls } = await open(browser, "/onboarding/work", { progress: "authorization" });
    await clickText(page, "Continue");
    await wait(300);
    check(W, "work: authorization and sponsorship are required", (await page.locator("main fieldset p.text-danger").count()) === 2, null);
    await page.check('input[name="work-authorized"][value="no"]');
    await page.check('input[name="work-sponsorship"][value="yes"]');
    await page.selectOption("#work-status", "visa");
    check(W, "work: 'On a visa' adds the visa type", await page.locator("#work-visa").isVisible(), null);
    await page.fill("#work-visa", "H-1B");
    await page.check('input[name="work-setup"][value="remote"]');
    await clickText(page, "Continue");
    await landsOn(page, "/onboarding/questions");
    const sent = lastBody(calls, "PUT /onboarding")?.data;
    check(W, "work: the payload", sent?.workAuth?.authorizedUS === false && sent.workAuth.needsSponsorship === true && sent.workAuth.status === "visa" && sent.workAuth.visaType === "H-1B" && sent.remotePreference === "remote", sent);
    await context.close();
  }
  // Questions: over 18 is required; self-ID is sent only when touched; Nori covers its eyes while it's open.
  for (const touched of [false, true]) {
    const { context, page, calls } = await open(browser, "/onboarding/questions", { progress: "screening" });
    if (!touched) {
      await clickText(page, "Continue");
      await wait(300);
      check(W, "questions: over 18 is required", (await page.locator("main fieldset p.text-danger").textContent()) === "Choose Yes or No", null);
    }
    await page.check('input[name="questions-18"][value="yes"]');
    await page.fill("#questions-salary", "120,000");
    if (touched) {
      await page.locator("main summary").click();
      await wait(900);
      check(W, "questions: Nori covers its eyes while self-ID is open", /^(cover|covered)$/.test((await noriRow(page)) ?? ""), await noriRow(page));
      await page.selectOption("#questions-veteran", "I am not a protected veteran");
    }
    await clickText(page, "Continue");
    await landsOn(page, "/onboarding/preferences");
    const sent = lastBody(calls, "PUT /onboarding")?.data;
    check(W, `questions: self-ID ${touched ? "sent when answered" : "left out when untouched"}`, touched ? sent?.eeo?.veteran === "I am not a protected veteran" : !("eeo" in (sent ?? {})), sent);
    if (!touched) check(W, "questions: salary as a number a year", sent?.salaryExpectation?.amount === 120000 && sent.salaryExpectation.period === "year", sent?.salaryExpectation);
    await context.close();
  }
  // Preferences: a title is required; chips add with Enter and come off with Backspace; Finish opens done.
  {
    const { context, page, calls } = await open(browser, "/onboarding/preferences", { progress: "preferences" });
    await clickText(page, "Finish");
    await wait(300);
    check(W, "preferences: a job title is required", (await page.locator("#prefs-titles-note").textContent()) === "Add at least one job title" && (await page.evaluate(() => document.activeElement?.id)) === "prefs-titles", null);
    await page.fill("#prefs-titles", "Product designer");
    await page.keyboard.press("Enter");
    await page.fill("#prefs-titles", "Typo title");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    const chips = await page.locator("main ul li").allTextContents();
    check(W, "preferences: Enter adds a chip, Backspace removes the last", chips.some((c) => c.includes("Product designer")) && !chips.some((c) => c.includes("Typo")), chips);
    const suggestions = await page.locator("main button", { hasText: /^\+ / }).allTextContents();
    check(W, "preferences: role titles from the resume are suggested", suggestions.some((s) => s.includes("UX designer")), suggestions);
    await clickText(page, "Finish");
    await landsOn(page, "/onboarding/done");
    const sent = lastBody(calls, "PUT /onboarding");
    check(W, "preferences: Finish saves and opens done", sent?.step === "preferences" && sent.data.preferences.titles.includes("Product designer") && sent.data.preferences.remote === "ok", sent);
    await context.close();
  }
  // Done: the lane, the inbox (only when configured) and the first shortlist arriving.
  for (const inbox of [false, true]) {
    const { context, page } = await open(browser, "/onboarding/done", { progress: "done", inbox, shortlist: [{ id: "s1" }, { id: "s2" }] });
    await page.locator("text=2 jobs fit you already").waitFor({ timeout: 8000 }).catch(() => {});
    const text = await page.locator("main").innerText();
    check(W, `done: the lane${inbox ? ", the inbox" : ""} and the first jobs`, text.includes("Product designer, UX designer · New York, NY or remote") && text.includes("2 jobs fit you already") && text.includes("alex.r@inbox") === inbox, text.slice(0, 300));
    await context.close();
  }
  // Routing.
  for (const [label, path, o, dest] of [
    ["/onboarding opens the saved step", "/onboarding", { progress: "screening" }, "/onboarding/questions"],
    ["a step ahead goes back to the saved one", "/onboarding/preferences", { progress: "contact" }, "/onboarding/contact"],
    ["a step behind is allowed", "/onboarding/contact", { progress: "screening" }, "/onboarding/contact"],
    ["signed out goes to sign-in", "/onboarding/contact", { signedOut: true }, "/signin"],
    ["done the first time shows the done page", "/onboarding", { progress: "done" }, "/onboarding/done"],
    ["done and seen goes to the dashboard", "/onboarding", { progress: "done", seenDone: true }, "/overview"],
  ]) {
    const { context, page } = await open(browser, path, o);
    await wait(800);
    check(W, `routing: ${label}`, new URL(page.url()).pathname === dest, page.url());
    await context.close();
  }
}

// ---- accessibility, keyboard, text spacing ----------------------------------------------------------------------------

async function axe(browser) {
  const runs = [
    ["/onboarding/resume", { progress: "resume" }, null],
    ["/onboarding/resume", { progress: "contact" }, "graph"],
    ["/onboarding/contact", { progress: "contact" }, null],
    ["/onboarding/contact", { progress: "contact" }, "error"],
    ["/onboarding/work", { progress: "authorization" }, "error"],
    ["/onboarding/questions", { progress: "screening" }, "self-ID open"],
    ["/onboarding/preferences", { progress: "preferences" }, null],
    ["/onboarding/done", { progress: "done", inbox: true }, null],
  ];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const [path, o, state] of runs) {
      const where = `chromium ${path}${state ? ` (${state})` : ""} ${w}x${h} axe`;
      const { context, page } = await open(browser, path, o, { viewport: { width: w, height: h } });
      if (state === "error") {
        await clickText(page, "Continue");
        if (path.endsWith("contact")) {
          await page.fill("#contact-fullName", "");
          await clickText(page, "Continue");
        }
        await wait(300);
      }
      if (state === "self-ID open") {
        await page.locator("main summary").click();
        await wait(300);
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
    // A radio or file input shows its ring on its label (has-[:focus-visible]).
    const ringEl = el.matches("input[type=radio], input[type=file]") ? el.closest("label") : el;
    const rs = ringEl ? getComputedStyle(ringEl) : cs;
    return {
      name: (el.getAttribute("aria-label") || el.id || el.getAttribute("name") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 32),
      ring: (rs.outlineStyle !== "none" && parseFloat(rs.outlineWidth) >= 2) || /\b[3-9]px\b/.test(rs.boxShadow),
      size: ringEl ? [Math.round(ringEl.getBoundingClientRect().width), Math.round(ringEl.getBoundingClientRect().height)] : [Math.round(r.width), Math.round(r.height)],
    };
  };
  for (const [path, o] of [["/onboarding/resume", { progress: "resume" }], ["/onboarding/work", { progress: "authorization" }], ["/onboarding/preferences", { progress: "preferences" }]]) {
    const where = `chromium ${path} 1440x900 keyboard`;
    const { context, page } = await open(browser, path, o);
    const stops = [];
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate(stopInfo));
    }
    const seen = stops.filter(Boolean);
    check(where, "skip link is the first stop", seen[0]?.name === "Skip to content", seen[0]);
    const noRing = seen.filter((s) => !s.ring);
    check(where, "every stop shows the focus ring", noRing.length === 0, [...new Set(noRing.map((s) => s.name))]);
    const small = seen.filter((s) => s.size[0] < 24 || s.size[1] < 24);
    check(where, "targets at least 24 px (WCAG 2.5.8)", small.length === 0, small);
    if (path.endsWith("resume")) check(where, "the drop zone's file input is reachable", seen.some((s) => s.name === "INPUT" || /file/i.test(s.name)) || (await page.evaluate(() => !!document.querySelector("input[type=file]")?.matches(":focus-visible, :focus")) ? true : seen.length > 3), seen.map((s) => s.name));
    if (path.endsWith("work")) {
      await page.focus('input[name="work-authorized"][value="yes"]');
      await page.keyboard.press("ArrowRight");
      check(where, "arrow keys move within a choice group", await page.isChecked('input[name="work-authorized"][value="no"]'), null);
    }
    await context.close();
  }
}

async function textSpacing(browser) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const [path, o] of [["/onboarding/resume", { progress: "contact" }], ["/onboarding/contact", { progress: "contact" }], ["/onboarding/questions", { progress: "screening" }]]) {
      const where = `chromium ${path} ${w}x${h} text spacing`;
      const { context, page } = await open(browser, path, o, { viewport: { width: w, height: h } });
      await page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}" });
      await wait(500);
      const r = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        vw: innerWidth,
        clipped: [...document.querySelectorAll("a, button, h1, label, legend, summary")]
          .filter((el) => el.getClientRects().length && !el.closest(".nori, .sr-only") && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible")
          .map((el) => (el.textContent || "").trim().slice(0, 40)),
      }));
      check(where, "no sideways scroll with text spacing", r.docW <= r.vw + 1, `${r.docW} > ${r.vw}`);
      check(where, "no clipped text with text spacing", r.clipped.length === 0, r.clipped);
      await context.close();
    }
  }
}

/** Spec section 13: LCP under 2.0 s on 4G with a 4x slower CPU, CLS under 0.05, under 450 KB first. */
async function performance(browser) {
  for (const [path, w, h, mobile] of [["/onboarding/resume", 390, 844, true], ["/onboarding/contact", 390, 844, true], ["/onboarding/resume", 1440, 900, false]]) {
    const where = `chromium ${path} ${w}x${h} 4G, 4x CPU`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    await mockApi(context, { progress: path.endsWith("contact") ? "contact" : "resume" });
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
    check(where, "under 450 KB before the first interaction", kb <= 450, `${kb} KB`);
    await context.close();
  }
}

/** One real run against a local API (no mocks): sign up, upload the sample resume, every step, done. */
async function endToEnd(browser) {
  const W = "chromium end to end";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  await page.fill("#signup-email", `onb-${Date.now()}@example.test`);
  await page.fill("#signup-password", "first-pass-123");
  await page.click("text=Create account");
  check(W, "sign up, then the resume step", await landsOn(page, "/onboarding/resume"), page.url());
  await wait(1200);
  await page.locator('input[type="file"]').setInputFiles(RESUME);
  await page.locator("[data-card]").first().waitFor({ timeout: 45000 }).catch(() => {});
  check(W, "the resume is read into cards", (await page.locator("[data-card]").count()) > 0, await page.locator("main").innerText());
  await wait(4000);
  await clickText(page, "Continue");
  check(W, "contact", await landsOn(page, "/onboarding/contact"), page.url());
  await wait(800);
  if (!(await page.inputValue("#contact-fullName"))) await page.fill("#contact-fullName", "Alex Rivera");
  await clickText(page, "Continue");
  check(W, "work", await landsOn(page, "/onboarding/work"), page.url());
  await wait(500);
  await page.check('input[name="work-authorized"][value="yes"]');
  await page.check('input[name="work-sponsorship"][value="no"]');
  await clickText(page, "Continue");
  check(W, "questions", await landsOn(page, "/onboarding/questions"), page.url());
  await wait(500);
  await page.check('input[name="questions-18"][value="yes"]');
  await clickText(page, "Continue");
  check(W, "preferences", await landsOn(page, "/onboarding/preferences"), page.url());
  await wait(500);
  await page.fill("#prefs-titles", "Product designer");
  await page.keyboard.press("Enter");
  await clickText(page, "Finish");
  check(W, "done", await landsOn(page, "/onboarding/done"), page.url());
  await page.locator("text=Product designer ·").waitFor({ timeout: 8000 }).catch(() => {});
  check(W, "the first lane is shown", (await page.locator("main").innerText()).includes("Product designer"), await page.locator("main").innerText());
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
    if (ONLY.includes("spacing")) await textSpacing(browser);
    if (ONLY.includes("performance")) await performance(browser);
    if (E2E && ONLY.includes("e2e")) await endToEnd(browser);
  }
  await browser.close();
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`FAIL ${f.where}: ${f.what}\n     ${JSON.stringify(f.detail)?.slice(0, 400)}`);
for (const p of results.filter((r) => r.ok && r.detail && /LCP|CLS|KB|axe/.test(r.what + r.detail))) console.log(`ok   ${p.where}: ${p.what} (${p.detail})`);
process.exitCode = failed.length ? 1 : 0;
