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
/** A stored resume as GET /applications/:id sends it (`toResume`): one line changed for the job. */
const RESUME = (appId) => ({
  id: `r-${appId}`, applicationId: appId, pages: 1, atsChecks: [], createdAt: at("2026-11-04T07:58:00"),
  content: { name: "Alex Rivera", contact: { email: "alex@example.test", location: "Brooklyn, NY" }, experience: [{ title: "Product designer", company: "Fernway", location: null, start: "2022", end: null, bullets: [{ id: "b1", text: "Led research and design for the checkout redesign" }, { id: "b2", text: "Built the design system in Figma" }] }], education: [], skills: [{ group: "Tools", items: ["Figma", "Prototyping"] }], projects: [] },
  changes: [{ bulletId: "b1", kind: "rewrite", before: "Led checkout research", after: "Led research and design for the checkout redesign", reason: "The role asks for end-to-end research", nodeIds: [] }],
});
// The worker's words when no typed code arrived in time (packages/apply EMAIL_CODE_REASON).
const CODE_LATE = "The employer emailed you a verification code and none reached Norinote in time. Retry and type the code in Norinote when asked, or finish on the employer's page.";
/** APPS plus one run waiting for a typed code (a10), one whose wait ran out (a11) and one the person cancelled (a12). */
const CODE_APPS = () => [
  ...APPS(),
  { app: base("a10", "awaiting_code", { createdAt: at("2026-11-04T08:50:00"), approvedAt: at("2026-11-04T08:51:00") }), job: job("j10", "Service designer", "Larch", "Seattle, WA"), outcomes: [] },
  { app: base("a11", "needs_user", { createdAt: at("2026-11-04T07:50:00"), approvedAt: at("2026-11-04T07:51:00"), error: CODE_LATE, receipt: { codeMissing: true } }), job: job("j11", "Motion designer", "Bramble", null), outcomes: [] },
  { app: base("a12", "failed", { createdAt: at("2026-11-04T07:40:00"), error: "Cancelled by you" }), job: job("j12", "Packaging designer", "Fennel", "Portland, OR"), outcomes: [] },
];
// Where applications went (GET /applications/flow): 24 started, 15 sent, 4 interviews, 1 offer.
const node = (id, label, count, stage) => ({ id, label, count, stage });
const FLOW = {
  since: at("2026-09-28T09:00:00"),
  total: 24,
  nodes: [
    node("started", "Started", 24, 0),
    node("sent", "Sent", 15, 1), node("needs_you", "Needs you", 3, 1), node("in_progress", "In progress", 2, 1), node("cancelled", "Cancelled", 1, 1), node("failed", "Didn't go through", 3, 1),
    node("interview", "Interview", 4, 2), node("replied", "Replied", 3, 2), node("rejected", "Rejected", 4, 2), node("waiting", "No reply yet", 3, 2), node("silent", "No reply", 1, 2),
    node("offer", "Offer", 1, 3), node("rejected_after_interview", "Rejected", 1, 3), node("interviewing", "Still interviewing", 2, 3),
  ],
  links: [
    ["started", "sent", 15], ["started", "needs_you", 3], ["started", "in_progress", 2], ["started", "cancelled", 1], ["started", "failed", 3],
    ["sent", "interview", 4], ["sent", "replied", 3], ["sent", "rejected", 4], ["sent", "waiting", 3], ["sent", "silent", 1],
    ["interview", "offer", 1], ["interview", "rejected_after_interview", 1], ["interview", "interviewing", 2],
  ].map(([source, target, value]) => ({ source, target, value })),
};
const FLOW_SMALL = { since: at("2026-11-01T09:00:00"), total: 3, nodes: [node("started", "Started", 3, 0), node("sent", "Sent", 2, 1), node("needs_you", "Needs you", 1, 1), node("replied", "Replied", 1, 2), node("waiting", "No reply yet", 1, 2)], links: [{ source: "started", target: "sent", value: 2 }, { source: "started", target: "needs_you", value: 1 }, { source: "sent", target: "replied", value: 1 }, { source: "sent", target: "waiting", value: 1 }] };
const FLOW_EMPTY = { since: null, total: 0, nodes: [], links: [] };
// The Nori page ("Apply for me"): matches to pick from, a running batch, what needs the person, settings.
const MATCH = (id, title, company, fit, atsType = "greenhouse") => ({ id: `s-${id}`, jobId: id, fit, reasons: ["Sample reason"], status: "new", createdAt: at("2026-11-04T07:00:00"), widenedBy: null, locationNames: [], job: { ...job(id, title, company, "New York, NY"), atsType } });
// Four on Greenhouse and one on Lever, which "Apply for me" doesn't list yet.
const MATCHES = () => [MATCH("m1", "Product designer", "Fernway", 0.86), MATCH("m2", "UX designer", "Halden Labs", 0.81), MATCH("m3", "Design systems designer", "Mirro", 0.72), MATCH("m4", "Visual designer", "Kestrel", 0.64), MATCH("m5", "Motion designer", "Bramble", 0.9, "lever")];
const BATCH = (status = "running") => ({ id: "b1", status, createdAt: at("2026-11-04T08:30:00"), finishedAt: null, lastStartedAt: at("2026-11-04T08:58:00"), counts: { total: 10, sent: 4, working: 1, preparing: 2, ready: 2, needsYou: 1, cancelled: 0, failed: 0 }, waitingFor: "spacing", nextAt: at("2026-11-04T09:12:00") });
const NEEDS = () => [
  { applicationId: "a2", jobId: "j-a2", title: "Interaction designer", company: "Pallet", applyUrl: "https://jobs.example.test/j2", needs: "questions", reason: null, questions: 2, batchId: "b1", updatedAt: at("2026-11-04T08:40:00") },
  { applicationId: "a8", jobId: "j-a8", title: "Content designer", company: "Tern", applyUrl: "https://jobs.example.test/j8", needs: "captcha", reason: "The site showed a captcha.", questions: 0, batchId: "b1", updatedAt: at("2026-11-04T08:20:00") },
];
// The Nori page (v2): the conversation so far, the roles (one switched off) and the schedule.
const CHAT = () => [
  { id: "c1", role: "user", text: "Add Brand designer as a role", actions: [], createdAt: at("2026-11-03T18:00:00") },
  { id: "c2", role: "nori", text: "Added Brand designer. I'll look for it from the next search.", actions: [{ kind: "add_role", summary: 'Added the role "Brand designer"', undoId: "u-old" }], createdAt: at("2026-11-03T18:00:01") },
];
const LANE = (id, name, enabled = true) => ({ id, name, titles: [name], locations: [], remote: true, minFit: 0.7, enabled });
const LANES = () => [LANE("l1", "Product designer"), LANE("l2", "Brand designer"), LANE("l3", "Illustrator", false)];
const SCHEDULE = (on = true) => ({ enabled: on, days: ["mon", "tue", "wed", "thu", "fri"], time: "09:00", timezone: "America/New_York", paused: false, lastRunOn: null, nextRunOn: on ? "2026-11-05" : null });
// The Jobs page: GET /jobs rows (job, match, applicationStatus), the counts, and one job's detail.
const MATCH_OF = (id, score, reasons) => ({ jobId: id, score, explanation: { matched: [{ requirement: "Figma", label: "Figma, 4 years at Fernway", required: true }, { requirement: "Design systems", label: "Built Fernway's design system", required: true }], missing: [{ requirement: "Motion design", required: true }, { requirement: "Webflow", required: false }], reasons }, widenedBy: null, computedAt: at("2026-11-04T07:00:00") });
// `stated`: what the listing states (pay, employmentType, workplace); null when it doesn't, as the API sends it.
const LISTING = (id, title, company, location, fit, extra = {}, stated = {}) => ({
  job: { ...job(id, title, company, location, company === "Mirro" ? LOGO("mirro.example.test") : null), postedAt: at("2026-11-04T07:00:00"), firstSeenAt: at("2026-11-04T07:10:00"), atsType: "greenhouse", pay: null, employmentType: null, workplace: null, ...stated },
  match: fit === null ? null : MATCH_OF(id, fit, [`Your ${title.toLowerCase()} work at Fernway`, "You list Figma and research"]),
  applicationStatus: null,
  ...extra,
});
const LISTINGS = () => [
  LISTING("jb1", "Senior product designer", "Mirro", "New York, NY", 0.84, { locations: 3, locationNames: ["New York, NY", "Boston, MA", "Austin, TX"] }, { employmentType: "full_time", workplace: "hybrid" }),
  LISTING("jb2", "UX designer", "Halden Labs", null, 0.78, {}, { pay: { min: 120000, max: 150000, currency: "USD", period: "year" }, employmentType: "full_time", workplace: "remote" }),
  LISTING("jb3", "Design systems designer", "Lumen", "Brooklyn, NY", 0.71),
  LISTING("jb4", "Visual designer", "Kestrel", "Austin, TX", null),
  LISTING("jb5", "Product designer", "Fernway", "Brooklyn, NY", 0.66, { applicationStatus: "submitted" }),
];
const JOB_DETAIL = (l) => ({
  job: { ...l.job, descriptionText: `${l.job.title} at ${l.job.companyName}. You'll shape how people plan their week.

We work in small teams.`, requirements: { skills: [{ name: "Figma", required: true }], seniority: "senior", roleFamily: "design", mustHaves: ["Figma", "Design systems", "Motion design"], niceToHaves: ["Webflow"], disqualifiers: l.job.id === "jb3" ? ["Requires US citizenship"] : [], summary: "Lead research for the planner. Ship the new onboarding." },
    company: { name: l.job.companyName, website: l.job.companyName === "Mirro" ? "https://mirro.example.test" : null, logoUrl: l.job.companyLogoUrl, size: null, about: null } },
  match: l.match,
});
// GET /jobs/:id/preview (Review): Mirro's form is read ahead of time; the others say why not.
const PREVIEW = (id) =>
  id === "jb1"
    ? { available: true, ats: "greenhouse", questions: [
        { key: "resume", label: "Resume/CV", type: "file", required: true, status: "ready", answer: "Your tailored resume", source: "profile" },
        { key: "q_auth", label: "Are you legally authorized to work in the US?", type: "boolean", required: true, status: "ready", answer: "Yes", source: "profile" },
        { key: "q_start", label: "Earliest start date?", type: "text", required: true, status: "ask", answer: null, source: null },
        { key: "q_ref", label: "How did you hear about us?", type: "text", required: false, status: "skip", answer: null, source: null },
      ], counts: { total: 4, ready: 2, ask: 1, skip: 1 } }
    : { available: false, ats: "lever", reason: "Nori reads this form when you press Apply and asks you anything it can't answer before sending." };
const MESSAGES = () => [
  { id: "m2", applicationId: "a3", application: { id: "a3", status: "submitted", jobTitle: "Product designer", companyName: "Fernway" }, fromAddress: "no-reply@greenhouse.example.test", fromName: "Fernway via Greenhouse", subject: "Your security code", bodyText: "Copy and paste this code into the security code field on your application: 482913", receivedAt: at("2026-11-04T08:00:05"), kind: "verification_code", code: "482913", verificationLink: null, links: [], attachments: [], spam: false, usedAt: at("2026-11-04T08:00:20") },
  { id: "m1", applicationId: "a5", application: { id: "a5", status: "submitted", jobTitle: "Design systems designer", companyName: "Mirro" }, fromAddress: "talent@mirro.example.test", fromName: "Priya at Mirro", subject: "Interview: Design systems designer", bodyText: "Hi Alex,\n\nThanks for applying. We'd love to talk. Could you do a 30 minute call next week?\n\nPriya", receivedAt: at("2026-11-04T07:00:00"), kind: "interview", code: null, verificationLink: null, links: [], attachments: [{ filename: "interview-guide.pdf", contentType: "application/pdf", size: 84_000 }], spam: false, usedAt: null },
  { id: "m4", applicationId: "a6", application: { id: "a6", status: "submitted", jobTitle: "Senior product designer", companyName: "Orchard" }, fromAddress: "jobs@orchard.example.test", fromName: "Orchard", subject: "About your application", bodyText: "Thank you for your interest. We've decided to move forward with other candidates.", receivedAt: at("2026-11-04T06:30:00"), kind: "rejection", code: null, verificationLink: null, links: [], attachments: [], spam: false, usedAt: null },
  { id: "m3", applicationId: "a4", application: { id: "a4", status: "submitted", jobTitle: "UX designer", companyName: "Halden Labs" }, fromAddress: "sam@halden.example.test", fromName: "Sam Ortiz", subject: "Re: UX designer", bodyText: "Thanks Alex, we're reviewing and will be in touch.", receivedAt: at("2026-11-03T10:00:00"), kind: "recruiter_reply", code: null, verificationLink: null, links: [], attachments: [], spam: false, usedAt: null },
  { id: "m5", applicationId: "a3", application: { id: "a3", status: "submitted", jobTitle: "Product designer", companyName: "Fernway" }, fromAddress: "no-reply@fernway.example.test", fromName: "Fernway", subject: "Confirm your email", bodyText: "Confirm your email to finish your application.", receivedAt: at("2026-11-02T09:00:00"), kind: "confirmation", code: null, verificationLink: "https://fernway.example.test/confirm?t=abc", links: ["https://fernway.example.test/confirm?t=abc"], attachments: [], spam: false, usedAt: null },
  { id: "m6", applicationId: null, application: null, fromAddress: "deals@spammy.example.test", fromName: "Career Boost", subject: "You won a free resume review", bodyText: "Click here.", receivedAt: at("2026-11-01T09:00:00"), kind: "other", code: null, verificationLink: "https://spammy.example.test/x", links: [], attachments: [], spam: true, usedAt: null },
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
 * Cancel (POST /applications/:id/cancel) follows the API: 409 on the employer's page or once sent; `o.cancelLate` makes
 * the run reach the employer's page just before the request lands. `o.flow`: what GET /applications/flow sends (FLOW).
 * The Nori page: `o.chat` (the conversation), `o.lanes`, `o.schedule`, `o.budget` (the chat's AI budget is used up: the
 * reply says so and changes nothing), `o.batches`, `o.needs`, `o.gmail`, `o.batchRefused` (POST /nori/batches 409),
 * `o.skipReason` (why the last picked job is skipped; same_company).
 */
async function mockApi(context, o = {}) {
  const cors = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const calls = [];
  const rows = o.apps ?? APPS();
  const messages = o.messages ?? MESSAGES();
  let settings = { forwardTo: null, forwardEnabled: false, retentionDays: null };
  const nori = { settings: { spacingMinutes: 4, minFit: 0.7, skipCompanies: ["Initech"], dailyLimit: 20 }, batches: o.batches ?? [BATCH(), { ...BATCH("done"), id: "b0", createdAt: at("2026-11-02T08:30:00"), waitingFor: null, nextAt: null, counts: { total: 5, sent: 4, working: 0, preparing: 0, ready: 0, needsYou: 0, cancelled: 1, failed: 0 } }], needs: o.needs ?? NEEDS(), gmail: o.gmail ?? { available: true, connected: false, status: null }, chat: o.chat ?? CHAT(), lanes: o.lanes ?? LANES(), schedule: o.schedule ?? SCHEDULE(), undo: {}, undone: new Set() };
  let seq = 0;
  let m0;
  const listings = o.listings ?? LISTINGS();
  const jobSaves = new Set(o.jobSaves ?? ["jb4"]);
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
    calls.push({ key, body, at: Date.now(), search: url.search });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(json) }).catch(() => {});
    const user = { id: "u1", email: "alex@example.test", name: "Alex Rivera", emailVerifiedAt: MORNING.toISOString(), createdAt: MORNING.toISOString() };
    if (key === "GET /auth/session") return reply(200, { user });
    if (key === "GET /onboarding") return reply(200, { step: "done", profile: {} });
    if (key === "GET /me") return reply(200, { user, profile: { fullName: "Alex Rivera" } });
    if (key === "GET /agent/status") return reply(200, { dailyCap: 5, usedToday: 2, liveSubmit: false });
    if (key === "GET /shortlist") return reply(200, o.shortlist ?? []);
    if (key === "GET /jobs/summary") return reply(200, { open: 1248, newToday: 310, fitsLanes: 42, hasLanes: true });
    if (key === "GET /jobs/locations") return reply(200, { locations: [{ name: "New York, NY", count: 212 }, { name: "Austin, TX", count: 64 }, { name: "Brooklyn, NY", count: 31 }] });
    if (key === "GET /jobs") {
      if (o.jobsOffline) return route.abort("connectionrefused");
      const p = url.searchParams;
      const needle = (p.get("q") ?? "").toLowerCase();
      const where = (p.get("location") ?? "").toLowerCase();
      const list = listings
        .filter((l) => (p.get("view") !== "best" || l.match) && (p.get("view") !== "saved" || jobSaves.has(l.job.id)) && (!p.get("minScore") || (l.match?.score ?? 0) >= Number(p.get("minScore"))))
        .filter((l) => (!needle || `${l.job.title} ${l.job.companyName}`.toLowerCase().includes(needle)) && (!where || (l.job.location ?? "").toLowerCase().includes(where)) && (p.get("remote") !== "true" || l.job.remote))
        .map((l) => ({ ...l, saved: jobSaves.has(l.job.id) }));
      return reply(200, p.get("view") === "best" ? list.sort((a, b) => b.match.score - a.match.score) : list);
    }
    m0 = key.match(/^(POST|DELETE) \/jobs\/([\w-]+)\/save$/);
    if (m0) {
      if (m0[1] === "POST") jobSaves.add(m0[2]);
      else jobSaves.delete(m0[2]);
      return reply(200, { saved: m0[1] === "POST" });
    }
    const previewOf = key.match(/^GET \/jobs\/([\w-]+)\/preview$/)?.[1];
    if (previewOf) return listings.some((x) => x.job.id === previewOf) ? reply(200, PREVIEW(previewOf)) : reply(404, { error: "Job not found" });
    const jobId = key.match(/^GET \/jobs\/([\w-]+)$/)?.[1];
    if (jobId) {
      const l = listings.find((x) => x.job.id === jobId);
      if (!l) return reply(404, { error: "Job not found" });
      const d = JOB_DETAIL(l);
      return reply(200, { ...d, job: { ...d.job, saved: jobSaves.has(jobId) } });
    }
    if (key === "POST /applications") {
      const jid = JSON.parse(body ?? "{}").jobId;
      const l = listings.find((x) => x.job.id === jid);
      const r = { app: base(`a${20 + ++seq}`, "queued", { jobId: jid, createdAt: MORNING.toISOString() }), job: l?.job ?? job(jid, "Job", "Company", null), outcomes: [] };
      rows.unshift(r);
      return reply(201, r.app);
    }
    if (key === "GET /nori/settings") return reply(200, { settings: nori.settings });
    if (key === "PUT /nori/settings") return (nori.settings = { ...nori.settings, ...JSON.parse(body ?? "{}") }), reply(200, { settings: nori.settings });
    if (key === "GET /nori/batches") return reply(200, { batches: nori.batches });
    const batchId = key.match(/^GET \/nori\/batches\/(b\d+)$/)?.[1];
    if (batchId && batchId !== "b1") return reply(200, { batch: nori.batches.find((b) => b.id === batchId), applications: [{ id: "a4", jobId: "j-a4", title: "UX designer", company: "Halden Labs", status: "submitted", error: null, submittedAt: at("2026-11-02T08:40:00") }] });
    if (key === "GET /nori/batches/b1") return reply(200, { batch: nori.batches.find((b) => b.id === "b1") ?? BATCH(), applications: [{ id: "a1", jobId: "j-a1", title: "Brand designer", company: "Lumen", status: "applying", error: null, submittedAt: null }, { id: "a3", jobId: "j-a3", title: "Product designer", company: "Fernway", status: "submitted", error: null, submittedAt: at("2026-11-04T08:00:18") }] });
    if (key === "POST /nori/batches/b1/stop") return (nori.batches = nori.batches.map((b) => (b.id === "b1" ? { ...b, status: "stopped" } : b))), reply(200, { ok: true });
    if (key === "POST /nori/batches" && JSON.parse(body ?? "{}").recommended) {
      if (o.batchRefused) return reply(409, { error: "No Recommended jobs to send right now", detail: "Nori sends new matches at or above your threshold that you haven't applied to." });
      nori.batches = [{ ...BATCH(), id: "b2", counts: { total: 3, sent: 0, working: 0, preparing: 3, ready: 0, needsYou: 0, cancelled: 0, failed: 0 }, waitingFor: "preparing", nextAt: null }, ...nori.batches];
      return reply(201, { batch: nori.batches[0], added: 3, skipped: [] });
    }
    if (key === "GET /lanes") return reply(200, nori.lanes);
    if (key === "GET /nori/schedule") return reply(200, { schedule: nori.schedule });
    if (key === "GET /nori/chat") return reply(200, { messages: url.searchParams.get("before") ? [] : nori.chat });
    if (key === "POST /nori/chat") {
      // A few phrases stand in for the model: a daily cap and Apply now, each listed and undoable.
      const text = JSON.parse(body ?? "{}").message ?? "";
      const mine = { id: `c${100 + ++seq}`, role: "user", text, actions: [], createdAt: MORNING.toISOString() };
      const cap = text.match(/daily cap to (\d+)/i);
      let say = "Sure.";
      let actions = [];
      if (o.budget) say = "I've used today's AI budget for chatting. Everything else keeps working; we can talk again tomorrow.";
      else if (cap) {
        actions = [{ kind: "set_daily_limit", summary: `Daily limit set to ${cap[1]} (was ${nori.settings.dailyLimit})`, undoId: "u-cap" }];
        nori.undo["u-cap"] = { dailyLimit: nori.settings.dailyLimit };
        nori.settings = { ...nori.settings, dailyLimit: Number(cap[1]) };
        say = `I'll send at most ${cap[1]} a day.`;
      } else if (/apply now/i.test(text)) {
        nori.batches = [{ ...BATCH(), id: "b3", counts: { total: 3, sent: 0, working: 0, preparing: 3, ready: 0, needsYou: 0, cancelled: 0, failed: 0 }, waitingFor: "preparing", nextAt: null }, ...nori.batches];
        actions = [{ kind: "apply_now", summary: "Started Apply for me with 3 Recommended jobs", undoId: "u-apply" }];
        say = "Started applying to 3 Recommended jobs. Watch them in Applications.";
      }
      const said = { id: `c${100 + ++seq}`, role: "nori", text: say, actions, createdAt: new Date(MORNING.getTime() + 1000).toISOString() };
      nori.chat = [...nori.chat, mine, said];
      return reply(200, { message: mine, reply: said });
    }
    const undoId = key.match(/^POST \/nori\/chat\/undo\/([\w-]+)$/)?.[1];
    if (undoId) {
      if (undoId === "u-old" || nori.undone.has(undoId)) return reply(200, { ok: false, summary: "Already undone" });
      if (!["u-cap", "u-apply"].includes(undoId)) return reply(404, { error: "Not found" });
      nori.undone.add(undoId);
      if (undoId === "u-cap") return (nori.settings = { ...nori.settings, ...nori.undo["u-cap"] }), reply(200, { ok: true, summary: `Daily limit back to ${nori.settings.dailyLimit}` });
      nori.batches = nori.batches.map((b) => (b.id === "b3" ? { ...b, status: "stopped" } : b));
      return reply(200, { ok: true, summary: "Stopped that batch (3 not sent)" });
    }
    if (key === "POST /nori/batches") {
      const ids = JSON.parse(body ?? "{}").jobIds ?? [];
      if (o.batchRefused) return reply(409, { error: "None of these jobs can be added to a batch" });
      nori.batches = [{ ...BATCH(), id: "b2", counts: { total: ids.length - 1, sent: 0, working: 0, preparing: ids.length - 1, ready: 0, needsYou: 0, cancelled: 0, failed: 0 }, waitingFor: "preparing", nextAt: null }, ...nori.batches];
      return reply(201, { batch: nori.batches[0], added: ids.length - 1, skipped: [{ jobId: ids.at(-1), reason: o.skipReason ?? "same_company" }] });
    }
    if (key === "GET /nori/needs-you") return reply(200, { items: nori.needs });
    if (key === "GET /inbox/gmail") return reply(200, nori.gmail);
    if (key === "POST /inbox/gmail/connect") return reply(200, { url: "https://accounts.example.test/oauth?state=x" });
    if (key === "DELETE /inbox/gmail") return (nori.gmail = { ...nori.gmail, connected: false, status: null }), reply(200, { ok: true });
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
    if (key === "GET /applications/flow") return reply(200, o.flow ?? FLOW);
    m = key.match(/^GET \/applications\/([\w-]+)\/live$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[1]);
      if (!r || !["applying", "awaiting_code"].includes(r.app.status)) return reply(404, { error: "No live view" });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png", "cache-control": "no-store" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
    }
    m = key.match(/^POST \/applications\/([\w-]+)\/cancel$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[1]);
      if (o.cancelLate) r.app.status = "applying";
      if (["applying", "awaiting_code", "submitted"].includes(r.app.status)) return reply(409, { error: "Nori is already on the employer's page, so it can't be cancelled now", detail: r.app.status });
      if (r.app.status !== "failed") Object.assign(r.app, { status: "failed", error: "Cancelled by you" });
      return reply(200, { ok: true, status: "failed" });
    }
    m = key.match(/^POST \/applications\/([\w-]+)\/code$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[1]);
      if (o.code === "bad") return reply(400, { error: "A code has only letters, digits, spaces and dashes" });
      if (o.code === "gone") Object.assign(r.app, { status: "needs_user", error: CODE_LATE, receipt: { codeMissing: true } });
      if (r.app.status !== "awaiting_code") return reply(409, { error: "This application is not waiting for a code", detail: r.app.status });
      r.typed = 1; // the run takes it up a couple of polls later, as the worker would
      return reply(200, { ok: true });
    }
    m = key.match(/^(GET|POST) \/applications\/([\w-]+)(?:\/(approve|answer|retry))?$/);
    if (m) {
      const r = rows.find((x) => x.app.id === m[2]);
      if (!r) return reply(404, { error: "Application not found" });
      if (m[3] === "answer" && o.answerGoesLive) Object.assign(r.app, { status: "applying", pendingQuestions: [], approvedAt: r.app.approvedAt ?? MORNING.toISOString() });
      if (m[3]) return reply(200, { ok: true, status: r.app.status });
      r.polls = (r.polls ?? 0) + 1;
      if (o.advance && r.app.status === "preparing") Object.assign(r.app, { status: "applying", preparedAt: MORNING.toISOString() });
      if (o.startsWaiting && r.app.status === "applying" && r.polls >= 3) r.app.status = "awaiting_code";
      if (r.typed && ++r.typed > 2) Object.assign(r.app, { status: "submitted", submittedAt: new Date(now + 20_000).toISOString(), receipt: { confirmation: "LR-1180", dryRun: false } });
      const events = r.app.approvedAt ? ["Opened the application page", "Filled 9 fields", "Uploaded your tailored resume", "Answered 2 questions from your answer bank", "Submitting", "Code 482 913 arrived; entered it", "Sent"].map((message, i) => ({ id: String(i + 1), ts: r.app.approvedAt, level: "info", step: "run", message })) : [];
      return reply(200, { application: r.app, job: r.job, resume: ["queued", "preparing"].includes(r.app.status) ? null : RESUME(r.app.id), events });
    }
    if (key.startsWith("GET /artifacts/")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
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
  return { calls, rows, jobSaves, maxInflight: () => maxInflight };
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
  const pages = [["/applications", "Product designer"], ["/applications/a5", "What happened?"], ["/inbox", "Priya at Mirro"]];
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
  // Applications v2: the list beside the open application; a chip per row; tabs All, In progress, Applied, Closed.
  {
    const { context, page } = await open(browser, "/applications");
    await page.locator("main ul[aria-label='Applications'] li").first().waitFor({ timeout: 8000 }).catch(() => {});
    const expected = [["Lumen", "Applying"], ["Pallet", "Needs help"], ["Fernway", "Applied"], ["Halden Labs", "Applied"], ["Mirro", "Applied"], ["Orchard", "Applied"], ["Kestrel", "Applied"], ["Tern", "Didn't go through"], ["Wren", "Applied"]];
    for (const [company, chip] of expected) {
      const t = await rowText(page, company);
      check(W, `apps: row ${company} has the chip ${chip}`, t.includes(chip), t);
    }
    const logos = await page.evaluate(() =>
      [...document.querySelectorAll("main ul[aria-label='Applications'] li a")].map((a) => {
        const el = a.firstElementChild;
        const r = el?.getBoundingClientRect();
        return { tag: el?.tagName.toLowerCase(), text: el?.textContent ?? "", w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0), loaded: el?.tagName === "IMG" ? el.complete && el.naturalWidth > 0 : null, lazy: el?.getAttribute("loading"), alt: el?.getAttribute("alt") };
      }),
    );
    check(W, "apps: a logo from the CDN: a lazy <img>, alt empty", logos[4]?.tag === "img" && logos[4].loaded && logos[4].lazy === "lazy" && logos[4].alt === "", logos[4]);
    check(W, "apps: the CDN's 404 or no logo: the letter tile", logos[3]?.tag === "span" && logos[3].text === "H" && logos[0]?.tag === "span" && logos[0].text === "L", [logos[3], logos[0]]);
    check(W, "apps: all nine rows", logos.length === 9, logos.length);
    const tabs = await page.locator("main [role=group][aria-label=Show] button").allInnerTexts();
    check(W, "apps: tabs with counts", tabs.map((t) => t.replace(/\s+/g, "")).join("|") === "All9|Inprogress2|Applied6|Closed1", tabs);
    check(W, "apps: from 1024 px the first one is open beside the list, the address unchanged", (await page.locator("main h2").first().innerText()) === "Brand designer" && new URL(page.url()).pathname === "/applications" && (await page.locator("main ul[aria-label='Applications'] a[aria-current=true]").innerText()).includes("Brand designer"), page.url());
    await page.locator("main [role=group][aria-label=Show] button", { hasText: "Applied" }).click();
    const applied = await page.locator("main ul[aria-label='Applications'] li").allInnerTexts();
    check(W, "apps: Applied shows the six sent", applied.length === 6 && applied.every((r) => r.includes("Applied")), applied);
    check(W, "apps: the tab is kept in the URL", page.url().endsWith("?show=applied"), page.url());
    await page.reload({ waitUntil: "load" });
    await wait(1500);
    check(W, "apps: and survives a reload", (await page.locator("main [role=group][aria-label=Show] button[aria-pressed=true]").innerText()).startsWith("Applied"), null);
    await page.locator("main [role=group][aria-label=Show] button", { hasText: "All" }).click();
    await page.getByLabel("Search applications").fill("mirro");
    const found = await page.locator("main ul[aria-label='Applications'] li").allInnerTexts();
    check(W, "apps: search by title or company", found.length === 1 && found[0].includes("Design systems designer"), found);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications?show=replied");
    check(W, "apps: an older ?show=replied link lands on Applied", (await page.locator("main [role=group][aria-label=Show] button[aria-pressed=true]").innerText().catch(() => "")).startsWith("Applied"), null);
    await context.close();
  }
  // Empty and offline.
  for (const [label, o, text] of [["apps: empty: Nothing sent yet, Find jobs", { apps: [] }, "Nothing sent yet"], ["apps: offline: can't reach Norinote", { offline: true }, "Couldn’t reach Norinote"]]) {
    const { context, page } = await open(browser, "/applications", o);
    check(W, label, await page.locator("main", { hasText: text }).isVisible(), null);
    if (o.apps) check(W, "apps: Find jobs links to /jobs", (await page.locator("main a", { hasText: "Find jobs" }).getAttribute("href")) === "/jobs", null);
    await context.close();
  }
  // A row opens beside the list and the address follows; Back goes back.
  {
    const { context, page } = await open(browser, "/applications");
    await page.locator("main ul[aria-label='Applications'] a", { hasText: "Design systems designer" }).click();
    check(W, "apps: a row opens /applications/:id beside the list", (await landsOn(page, "/applications/a5")) && (await page.locator("main ul[aria-label='Applications']").isVisible()), page.url());
    await page.locator("main h2", { hasText: "Design systems designer" }).waitFor({ timeout: 6000 }).catch(() => {});
    check(W, "apps: its header: title, company and place", (await page.locator("main h2").first().innerText()) === "Design systems designer" && (await page.locator("#dtab-panel").locator("..").innerText()).includes("Mirro · New York, NY"), null);
    await page.goBack();
    check(W, "apps: Back returns to /applications", await landsOn(page, "/applications"), page.url());
    await context.close();
  }
  // Applied: the resume that was sent, the screenshot, What happened? with Undo, Job details.
  {
    const { context, page, calls } = await open(browser, "/applications/a3");
    const panel = page.locator("#dtab-panel");
    await panel.locator("text=The resume that was sent").waitFor({ timeout: 6000 }).catch(() => {});
    const text = await panel.innerText();
    check(W, "applied: sent, how fast, the confirmation and a practice run", text.includes("Sent 4 Nov in 18 seconds") && text.includes("Confirmation FW-20931") && text.includes("A practice run: nothing reached the employer."), text.slice(0, 400));
    await panel.getByRole("button", { name: /The resume that was sent/ }).click();
    const resume = await panel.innerText();
    check(W, "applied: the resume that was sent opens the Resume tab, its changed line highlighted", (await page.locator("#dtab-resume").getAttribute("aria-selected")) === "true" && resume.includes("Tailored for Fernway · 1 line changed (highlighted)") && (await panel.locator("mark").first().innerText()) === "Led research and design for the checkout redesign" && resume.includes("Alex Rivera"), resume.slice(0, 400));
    check(W, "applied: Download PDF is the resume's PDF", (await panel.getByRole("link", { name: /Download PDF/ }).getAttribute("href")) === `${API}/api/resumes/r-a3.pdf`, null);
    await page.locator("#dtab-app").click();
    await panel.getByRole("button", { name: /The application screenshot/ }).click();
    const shot = await panel.locator('img[src^="blob:"]').waitFor({ timeout: 5000 }).then(() => true, () => false);
    check(W, "applied: the screenshot after Submit shows in place, fetched with the session", shot && calls.some((c) => c.key === "GET /artifacts/a3/filled.png"), null);
    await panel.getByRole("button", { name: "‹ Back" }).click();
    await panel.locator("section[aria-labelledby=mark-title] button", { hasText: "Interview" }).click();
    await wait(500);
    const posted = calls.find((c) => c.key === "POST /applications/a3/outcomes");
    check(W, "applied: Interview is sent to the API", JSON.parse(posted?.body ?? "{}").kind === "interview", posted);
    const marked = await panel.locator("ul[aria-label^='What came of it'] li").first().innerText().catch(() => "");
    check(W, "applied: it's listed, marked by you, with Undo", marked.startsWith("Interview") && marked.includes("Marked by you") && marked.includes("Undo"), marked);
    check(W, "applied: it's announced", (await panel.locator("p[role=status]").innerText()) === "Marked as interview. Undo is available.", null);
    await wait(400);
    check(W, "applied: Nori celebrates", (await noriRow(page)) === "celebrate", await noriRow(page));
    await panel.getByRole("button", { name: "Undo" }).click();
    await wait(500);
    check(W, "applied: Undo removes it", calls.some((c) => /^DELETE \/applications\/a3\/outcomes\/n\d$/.test(c.key)) && (await panel.locator("ul[aria-label^='What came of it'] li").count()) === 0, null);
    await page.locator("#dtab-job").click();
    check(W, "applied: Job details: the listing and Open the job posting", (await panel.innerText()).includes("Product designer at Fernway.") && (await panel.getByRole("link", { name: /Open the job posting/ }).getAttribute("href")) === "https://jobs.example.test/j3", null);
    await context.close();
  }
  // Optimizing resume, then live: no resume until it's ready, then Watch Nori apply and the Resume tab.
  {
    const apps = [{ app: base("a13", "preparing", { createdAt: at("2026-11-04T08:55:00"), approvedAt: at("2026-11-04T08:55:00") }), job: job("j13", "Research designer", "Quill", "Denver, CO"), outcomes: [] }, ...APPS()];
    // `advance` is read on each poll: the resume is "ready" (and the run starts) once the test sets it.
    const opts = { apps, advance: false };
    const { context, page, errors } = await open(browser, "/applications/a13", opts);
    const panel = page.locator("#dtab-panel");
    const opt = await panel.innerText().catch(() => "");
    check(W, "optimizing: Optimizing your resume, and what comes next", opt.includes("Optimizing your resume for Quill") && opt.includes("kept in the Resume tab, and Nori starts the application"), opt.slice(0, 300));
    check(W, "optimizing: the chip, and no resume yet", (await rowText(page, "Quill")).includes("Optimizing resume") && (await page.locator("#dtab-resume").getAttribute("aria-disabled")) === "true" && (await panel.locator("article").count()) === 0, null);
    await page.locator("#dtab-resume").click({ force: true });
    check(W, "optimizing: the Resume tab can't open yet", (await page.locator("#dtab-app").getAttribute("aria-selected")) === "true", null);
    opts.advance = true;
    const live = await panel.locator("figcaption", { hasText: "Watch Nori apply" }).waitFor({ timeout: 12000 }).then(() => true, () => false);
    check(W, "optimizing: then live, without a reload", live, (await panel.innerText()).slice(0, 300));
    check(W, "optimizing: and the Resume tab opens once the resume exists", (await page.locator("#dtab-resume").getAttribute("aria-disabled")) === null, null);
    check(W, "optimizing: no errors", errors.length === 0, errors);
    await context.close();
  }
  // Needs help: its questions as a form; answering sends it on, back to live.
  {
    const { context, page, calls } = await open(browser, "/applications/a2", { answerGoesLive: true });
    const panel = page.locator("#dtab-panel");
    check(W, "needs help: the chip and the questions", (await rowText(page, "Pallet")).includes("Needs help") && (await panel.innerText()).includes("Nori needs 2 answers to finish this one."), null);
    await panel.locator("label", { hasText: "Yes" }).first().click();
    await page.locator("#answer-q2").fill("alex.design");
    await panel.getByRole("button", { name: "Send answers" }).click();
    await wait(500);
    const sent = JSON.parse(calls.find((c) => c.key === "POST /applications/a2/answer")?.body ?? "{}");
    check(W, "needs help: the answers are sent", sent.answers?.q1 === "Yes" && sent.answers?.q2 === "alex.design", sent);
    const live = await panel.locator("figcaption", { hasText: "Watch Nori apply" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(W, "needs help: then back to live", live && !(await panel.innerText()).includes("Send answers"), null);
    await context.close();
  }
  // Didn't go through: why, and Try again.
  {
    const { context, page, calls } = await open(browser, "/applications/a8");
    const text = await page.locator("#dtab-panel").innerText();
    check(W, "didn't go through: the reason and Nothing was sent", text.includes("The page stopped responding while Nori was uploading your resume.") && text.includes("Nothing was sent."), text.slice(0, 300));
    await page.locator("#dtab-panel").getByRole("button", { name: "Try again" }).click();
    await wait(400);
    check(W, "didn't go through: Try again asks for a retry", calls.some((c) => c.key === "POST /applications/a8/retry"), null);
    await context.close();
  }
  // Phones: the list, then the application on its own screen, and back.
  {
    const { context, page } = await open(browser, "/applications", {}, { viewport: { width: 390, height: 844 } });
    check(W, "apps phones: the list, nothing open", (await page.locator("main ul[aria-label='Applications']").isVisible()) && !(await page.locator("#dtab-panel").count()), null);
    await page.locator("main ul[aria-label='Applications'] a", { hasText: "Design systems designer" }).click();
    await landsOn(page, "/applications/a5");
    await wait(500);
    check(W, "apps phones: the application on its own screen, the list hidden", (await page.locator("#dtab-panel").isVisible()) && !(await page.locator("main ul[aria-label='Applications']").isVisible()), null);
    check(W, "apps phones: focus on its title", (await page.evaluate(() => document.activeElement?.textContent)) === "Design systems designer", await page.evaluate(() => document.activeElement?.textContent));
    await page.locator("main button", { hasText: "Applications" }).click();
    check(W, "apps phones: back to the list", (await landsOn(page, "/applications")) && (await page.locator("main ul[aria-label='Applications']").isVisible()), page.url());
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a-missing");
    check(W, "apps: not found", (await page.locator("main h2", { hasText: "That application isn" }).count()) === 1, await page.locator("main").innerText());
    await context.close();
  }
  // The Inbox: newest open, the code, Copy, filters, new mail.
  {
    const { context, page } = await open(browser, "/inbox", { seen: { "norinote-inbox-seen-at": at("2026-11-04T06:45:00") } }, { permissions: ["clipboard-read", "clipboard-write"] });
    check(W, "from 1024 px the newest message opens", await landsOn(page, "/inbox/m2"), page.url());
    await wait(600);
    const pane = await page.locator("main article").innerText();
    check(W, "the code, large, with Copy, and when and for which application Nori used it (usedAt)", pane.includes("482913") && pane.includes("Nori entered it today at 08:00 to finish Product designer at Fernway."), pane);
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
    check(W, "the interview: body, attachment, the linked application opens in Applications", p2.includes("We'd love to talk") && p2.includes("interview-guide.pdf · 82 KB") && p2.includes("Linked application") && (await page.locator("main article a", { hasText: "Open in Applications" }).getAttribute("href")) === "/applications/a5", p2);
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
  // A code Nori never used says so; the linked application opens in Applications.
  {
    const unused = { ...MESSAGES()[0], id: "m9", usedAt: null };
    const { context, page } = await open(browser, "/inbox/m9", { messages: [unused] });
    await wait(400);
    const pane = await page.locator("main article").innerText();
    check(W, "a code Nori didn't use says so", pane.includes("Nori didn’t use this code. Copy it if you need it.") && !pane.includes("Nori entered it"), pane);
    await page.locator("main article a", { hasText: "Open in Applications" }).click();
    check(W, "the linked application opens in Applications", await landsOn(page, "/applications/a3"), page.url());
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
  // Nori (v2): the chat with Nori beside its setup card. Every change Nori makes is listed under its reply with Undo
  // (Stop for Apply now), and the card reads everything again after each one. Needs you, the live run, Gmail, Telegram
  // and the batch history live elsewhere now.
  {
    const { context, page, calls, errors } = await open(browser, "/nori");
    const main = () => page.locator("main").innerText();
    const card = page.locator("aside", { has: page.locator("#setup-title") });
    const log = page.getByRole("log");
    check(W, "nori: in the nav, and current", (await page.locator('nav[aria-label="Dashboard"] a[aria-current="page"]', { hasText: "Nori" }).count()) >= 1, null);
    const history = await log.innerText();
    check(W, "nori: the conversation so far, with what Nori changed under its reply", history.includes("Add Brand designer as a role") && history.includes('Added the role "Brand designer"') && (await log.getByRole("button", { name: 'Undo: Added the role "Brand designer"' }).count()) === 1, history.slice(0, 300));
    const roles = await card.getByRole("list", { name: "Your roles" }).locator("li").allInnerTexts();
    check(W, "nori: the card's roles are the switched-on ones", roles.join(",") === "Product designer,Brand designer", roles);
    const c = await card.innerText();
    check(W, "nori: the daily cap with what went out today", c.includes("20 a day") && c.includes("2 sent today"), c.slice(0, 400));
    const asked = calls.find((x) => x.key === "GET /jobs");
    const q = new URLSearchParams(asked?.search ?? "");
    check(W, "nori: the threshold and how many are Recommended (GET /jobs at minScore)", c.includes("70 or above") && c.includes("3 Recommended now") && q.get("view") === "best" && q.get("minScore") === "0.7", { search: asked?.search });
    check(W, "nori: the schedule, as the API has it", c.includes("Weekdays at 9:00 am") && c.includes("Next: Thu 5 Nov"), c);
    check(W, "nori: a running batch shows on the card with Stop", c.includes("Applying now: 4 of 10 sent") && (await card.getByRole("button", { name: "Stop" }).count()) === 1, null);
    const chips = await page.getByRole("list", { name: "Quick asks" }).locator("button").allInnerTexts();
    check(W, "nori: quick asks under the chat", chips.join(",") === "Apply now,Set a daily cap,Add a role,Pause the schedule", chips);
    const text = await main();
    check(W, "nori: no Greenhouse badge, and none of the old page's parts", !/Greenhouse/.test(text) && !/Needs you|Connect Gmail|Telegram|History|How Nori works/.test(text), null);
    // Set a daily cap: the chip starts the sentence, the person finishes it; the card follows, and Undo puts it back.
    await page.getByRole("button", { name: "Set a daily cap" }).click();
    const box = page.getByLabel("Message Nori");
    check(W, "nori: Set a daily cap starts the message", (await box.inputValue()) === "Set my daily cap to ", await box.inputValue());
    const before = calls.filter((x) => x.key === "GET /nori/settings").length;
    await box.press("End");
    await box.pressSequentially("15");
    await box.press("Enter");
    await log.getByText("Daily limit set to 15 (was 20)").waitFor({ timeout: 5000 }).catch(() => {});
    await wait(500);
    const sent = JSON.parse(calls.find((x) => x.key === "POST /nori/chat")?.body ?? "{}");
    check(W, "nori: the message goes to POST /nori/chat", sent.message === "Set my daily cap to 15", sent);
    check(W, "nori: the reply lists the change, and the card refreshes", (await log.innerText()).includes("Daily limit set to 15 (was 20)") && (await card.innerText()).includes("15 a day") && calls.filter((x) => x.key === "GET /nori/settings").length > before, null);
    await log.getByRole("button", { name: "Undo: Daily limit set to 15 (was 20)" }).click();
    await log.getByText("Daily limit back to 20").waitFor({ timeout: 5000 }).catch(() => {});
    await wait(500);
    check(W, "nori: Undo puts it back, on the chat and the card", calls.some((x) => x.key === "POST /nori/chat/undo/u-cap") && (await log.innerText()).includes("Daily limit back to 20") && (await card.innerText()).includes("20 a day"), null);
    await log.getByRole("button", { name: 'Undo: Added the role "Brand designer"' }).click();
    await wait(500);
    check(W, "nori: undoing twice says so", (await log.innerText()).includes("Already undone"), null);
    check(W, "nori: no errors", errors.filter((e) => !/404/.test(e)).length === 0, errors);
    await context.close();
  }
  {
    const { context, page, calls } = await open(browser, "/nori", { chat: [], batches: [], schedule: SCHEDULE(false) });
    const card = page.locator("aside", { has: page.locator("#setup-title") });
    const log = page.getByRole("log");
    check(W, "nori: a first visit, Nori says what it can do", (await log.innerText()).includes("Ask me which roles I look for"), null);
    check(W, "nori: schedule off reads plainly", (await card.innerText()).includes("Off. Nori only applies when you say so."), null);
    await page.getByRole("button", { name: "Schedule it" }).click();
    check(W, "nori: Schedule it starts the message", (await page.getByLabel("Message Nori").inputValue()) === "Apply every weekday at 9:00", null);
    await page.getByLabel("Message Nori").fill("");
    // Apply now from the chat: listed with Stop, which stops that batch.
    await page.getByRole("list", { name: "Quick asks" }).getByRole("button", { name: "Apply now" }).click();
    const stopChat = log.getByRole("button", { name: "Stop: Started Apply for me with 3 Recommended jobs" });
    const listed = await stopChat.waitFor({ timeout: 5000 }).then(() => true, () => false);
    await wait(500);
    check(W, "nori: Apply now from the chat, its Stop, and the card shows the batch", listed && (await card.innerText()).includes("Applying now: 0 of 3 sent"), await card.innerText());
    await stopChat.click();
    await log.getByText("Stopped that batch (3 not sent)").waitFor({ timeout: 5000 }).catch(() => {});
    await wait(500);
    check(W, "nori: Stop stops it, and the card offers Apply now again", calls.some((x) => x.key === "POST /nori/chat/undo/u-apply") && (await card.getByRole("button", { name: "Apply now" }).count()) === 1, null);
    // Apply now on the card asks once, then sends Recommended jobs (up to the Recommended count and the cap).
    await card.getByRole("button", { name: "Apply now" }).click();
    const ask = await card.getByRole("group", { name: /Nori sends up to 3 Recommended jobs in your name/ }).isVisible();
    check(W, "nori: the card's Apply now asks once first", ask && !calls.some((x) => x.key === "POST /nori/batches"), null);
    await card.getByRole("button", { name: "Yes, apply now" }).click();
    await wait(600);
    const body = JSON.parse(calls.find((x) => x.key === "POST /nori/batches")?.body ?? "{}");
    check(W, "nori: Apply now is POST /nori/batches { recommended: true }", body.recommended === true && body.limit === 3 && (await card.innerText()).includes("Started: 3 applications"), body);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/nori", { batches: [], batchRefused: true, budget: true });
    const card = page.locator("aside", { has: page.locator("#setup-title") });
    await card.getByRole("button", { name: "Apply now" }).click();
    await card.getByRole("button", { name: "Yes, apply now" }).click();
    await wait(500);
    check(W, "nori: Apply now with nothing Recommended (409) says so", (await card.innerText()).includes("No Recommended jobs to send right now."), null);
    await page.getByLabel("Message Nori").fill("Set my daily cap to 9");
    await page.getByRole("button", { name: "Send" }).click();
    await wait(600);
    const text = await page.locator("main").innerText();
    check(W, "nori: the AI budget used up is said plainly, and nothing changed", text.includes("used today's AI budget") && text.includes("Today’s AI budget for chatting is used up") && (await card.innerText()).includes("20 a day"), null);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/nori", {}, { viewport: { width: 390, height: 844 } });
    const tabs = await page.locator('nav[aria-label="Dashboard"]').last().locator("a").allInnerTexts();
    const fit = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > vw + 0.5).slice(0, 6).map((el) => `${el.tagName}.${String(el.className).slice(0, 50)} ${Math.round(el.getBoundingClientRect().right)}`);
      return over.length ? { width: document.documentElement.scrollWidth, over } : document.documentElement.scrollWidth;
    });
    const more = await page.locator('nav[aria-label="Dashboard"]').last().getByRole("button", { name: "More" }).isVisible();
    check(W, "nori: phones have four tabs and More, and no sideways scroll", tabs.map((t) => t.trim()).join(",") === "Overview,Jobs,Applications,Nori" && more && fit <= 390, { tabs, more, fit });
    const fold = page.getByRole("button", { name: /^Setup/ });
    const folded = (await fold.getAttribute("aria-expanded")) === "false" && !(await page.locator("#setup-body").isVisible());
    const above = await page.evaluate(() => document.querySelector("main aside")?.getBoundingClientRect().top < document.querySelector('[role="log"]')?.getBoundingClientRect().top);
    check(W, "nori: on phones the setup is folded above the chat, with a summary", folded && above && (await fold.innerText()).includes("2 roles · 20 a day · 70+ · Weekdays"), await fold.innerText());
    await fold.click();
    check(W, "nori: the setup opens", await page.locator("#setup-body").isVisible(), null);
    await context.close();
  }
  // Jobs: search, tabs and the list beside the picked job (the user's Jobs boards), on the API's real fields only.
  {
    const { context, page, calls, errors } = await open(browser, "/jobs");
    const nav = await page.locator('nav[aria-label="Dashboard"]').first().locator("a").allTextContents();
    const order = nav.map((t) => t.trim().replace(/\d+$/, "")).filter((t) => /^(Overview|Jobs|Applications)$/.test(t));
    check(W, "jobs: in the nav between Overview and Applications, and current", order.join(",") === "Overview,Jobs,Applications" && (await page.locator('nav[aria-label="Dashboard"] a[aria-current="page"]', { hasText: "Jobs" }).count()) >= 1, nav);
    const main = page.locator("main");
    const listCount = () => main.locator('section[role="tabpanel"] p[aria-live]').first().textContent();
    check(W, "jobs: the title and the line under it", (await main.locator("h1").textContent()) === "Jobs" && (await main.innerText()).includes("Discover and apply to roles that fit your goals."), null);
    const count = await listCount();
    check(W, "jobs: All counts the open postings from GET /jobs/summary", count === "1,248 open postings · newest 5 shown", count);
    const first = calls.find((c) => c.key === "GET /jobs");
    check(W, "jobs: All asks for every open job, newest first", !!first && new URLSearchParams(first.search).get("view") === "new" && new URLSearchParams(first.search).get("lanes") === "false", first?.search);
    const rowsList = main.locator('ul[aria-label="Jobs"] > li');
    check(W, "jobs: five rows, the first tinted and open beside the list", (await rowsList.count()) === 5 && (await rowsList.first().locator("button").getAttribute("aria-current")) === "true" && (await main.locator("article h2").textContent()) === "Senior product designer", await rowsList.count());
    const row1 = await rowsList.first().innerText();
    check(W, "jobs: a row has its fit, place, other places and when", row1.includes("Fit 0.84") && row1.includes("New York, NY") && row1.includes("and 2 more") && row1.includes("2h ago"), row1);
    check(W, "jobs: a row tags the job type and workplace the listing states, and no pay when it states none", row1.includes("Full-time") && row1.includes("Hybrid") && !/\$\d|\/ year/.test(row1), row1);
    const row2 = await rowsList.nth(1).innerText();
    check(W, "jobs: a row shows the pay its listing states, and Remote once", row2.includes("$120k – $150k / year") && row2.match(/Remote/g)?.length === 1, row2);
    check(W, "jobs: a sent application shows as Sent in its row", (await rowsList.nth(4).innerText()).includes("Sent"), await rowsList.nth(4).innerText());
    const box = { list: await main.locator('section[role="tabpanel"]').boundingBox(), job: await main.locator('section[aria-label="The job"]').boundingBox() };
    check(W, "jobs: at 1440 the job sits right of the list", !!box.list && !!box.job && box.job.x > box.list.x + box.list.width && Math.abs(box.job.y - box.list.y) < 4, box);
    const article = await main.locator("article").innerText();
    check(W, "jobs: the job's description, what you'll do and why it matches", article.includes("plan their week") && article.includes("Lead research for the planner") && article.includes("Your senior product designer work at Fernway"), article.slice(0, 400));
    check(W, "jobs: Save is there beside Apply, not pressed", (await main.locator("article").getByRole("button", { name: "Save", exact: true }).getAttribute("aria-pressed")) === "false" && (await main.locator("article").getByRole("button", { name: "Apply to Senior product designer at Mirro" }).count()) === 1, null);
    const dtabs = (await main.locator('article [role="tablist"] [role="tab"]').allTextContents()).map((t) => t.trim());
    check(W, "jobs: the job's tabs are Overview, Company, Insights and Review", dtabs.join(",") === "Overview,Company,Insights,Review", dtabs);
    check(W, "jobs: nothing made up (no Offering when the listing states no pay)", !/Offering|\/ year|\$\d/.test(article) && article.includes("Full-time") && article.includes("Hybrid"), article.slice(0, 300));
    const sticky = await main.locator('section[aria-label="The job"]').evaluate((el) => getComputedStyle(el).position);
    check(W, "jobs: side by side, the job's panel (and its Apply) stays put while the page scrolls", sticky === "sticky", sticky);
    check(W, "jobs: Review's form isn't read until its tab is opened", !calls.some((c) => /\/preview$/.test(c.key)), null);
    await main.getByRole("tab", { name: "Company" }).click();
    const companyTab = (await main.locator('article [role="tabpanel"]').innerText()).replace(/\s+/g, " ");
    check(W, "jobs: Company names the employer and links its website, nothing invented about it", companyTab.includes("Mirro") && (await main.locator('article [role="tabpanel"] a', { hasText: "mirro.example.test" }).getAttribute("href")) === "https://mirro.example.test" && !/employees|Founded/.test(companyTab), companyTab);
    await main.getByRole("tab", { name: "Review" }).click();
    await main.locator('article ul[aria-label="The form’s questions"]').waitFor({ timeout: 5000 }).catch(() => {});
    const review = (await main.locator('article [role="tabpanel"]').innerText()).replace(/\s+/g, " ");
    check(W, "jobs: Review reads the form (GET /jobs/:id/preview) and lists what Nori would send", calls.some((c) => c.key === "GET /jobs/jb1/preview") && review.includes("2 of 4 questions Nori can answer from what it knows; it would ask you 1") && review.includes("Your tailored resume") && review.includes("Yes · from your profile") && review.includes("Earliest start date?") && review.includes("Nori will ask you") && review.includes("Optional, left empty"), review.slice(0, 400));
    check(W, "jobs: no Greenhouse-only badge on Review", !/Greenhouse/i.test(review), null);
    await main.getByRole("tab", { name: "Insights" }).click();
    const insights = (await main.locator('article [role="tabpanel"]').innerText()).replace(/\s+/g, " ");
    check(W, "jobs: Insights shows the fit, must-haves covered and the form", insights.includes("0.84 match with your profile") && insights.includes("2 of 3 must-haves you cover") && insights.includes("Greenhouse application form") && insights.includes("Motion design (must-have)"), insights.slice(0, 300));
    await rowsList.nth(1).locator("button").click();
    await wait(500);
    check(W, "jobs: picking a row opens it beside the list and puts it in the address", (await main.locator("article h2").textContent()) === "UX designer" && new URL(page.url()).searchParams.get("job") === "jb2" && (await rowsList.nth(1).locator("button").getAttribute("aria-current")) === "true", page.url());
    const offering = (await main.locator("article").innerText()).replace(/\s+/g, " ");
    check(W, "jobs: a job whose listing states pay shows it as Offering", offering.includes("Offering $120k – $150k / year") && offering.includes("Full-time"), offering.slice(0, 300));
    await main.getByRole("button", { name: "Apply to UX designer at Halden Labs" }).click();
    const panelUp = await page.locator("[data-live-panel]").waitFor({ timeout: 5000 }).then(() => true, () => false);
    const posted = JSON.parse(calls.find((c) => c.key === "POST /applications")?.body ?? "{}");
    check(W, "jobs: Apply now starts the application and opens the live panel", posted.jobId === "jb2" && panelUp, posted);
    await page.keyboard.press("Escape");
    await wait(1500);
    const chip = await main.locator('article [role="status"]').first().textContent().catch(() => "");
    check(W, "jobs: then the job shows how it's going instead of Apply", chip === "Getting it ready" && (await main.getByRole("button", { name: /^Apply to/ }).count()) === 0, chip);
    const search = page.locator('main input[type="search"]');
    await search.fill("mirro");
    await wait(900);
    const searched = calls.filter((c) => c.key === "GET /jobs").map((c) => new URLSearchParams(c.search).get("q"));
    check(W, "jobs: search asks the API once, after typing stops", searched.filter((x) => x === "mirro").length === 1 && (await rowsList.count()) === 1, searched);
    await search.fill("zzz");
    await wait(900);
    check(W, "jobs: a search with nothing says so", (await main.innerText()).includes("No open jobs match “zzz”."), null);
    await search.fill("");
    await wait(900);
    await main.getByRole("tab", { name: "All" }).focus();
    await page.keyboard.press("ArrowRight");
    await wait(900);
    const best = calls.findLast((c) => c.key === "GET /jobs");
    check(W, "jobs: arrow keys move to Recommended, which asks for best fit on your searches", (await main.getByRole("tab", { name: "Recommended" }).getAttribute("aria-selected")) === "true" && new URLSearchParams(best.search).get("view") === "best" && new URLSearchParams(best.search).get("lanes") === "true", best.search);
    check(W, "jobs: Recommended counts what fits", (await listCount()) === "4 that fit your searches", await listCount());
    await main.getByRole("tab", { name: "Saved" }).click();
    await wait(700);
    check(W, "jobs: Saved lists the jobs you saved", (await listCount()) === "1 saved" && (await rowsList.first().innerText()).includes("Visual designer") && new URLSearchParams(calls.findLast((c) => c.key === "GET /jobs").search).get("view") === "saved", await listCount());
    const saveBtn = main.locator("article").getByRole("button", { name: "Saved", exact: true });
    await saveBtn.click();
    await wait(800);
    check(W, "jobs: Saved again takes it off (DELETE), and the Saved tab empties", calls.some((c) => c.key === "DELETE /jobs/jb4/save") && (await main.innerText()).includes("Nothing saved yet. Save a job to keep it here."), calls.filter((c) => /save$/.test(c.key)).map((c) => c.key));
    await main.getByRole("tab", { name: "All" }).click();
    await wait(700);
    const saveIt = main.locator("article").getByRole("button", { name: "Save", exact: true });
    await saveIt.click();
    await wait(300);
    check(W, "jobs: Save bookmarks the open job (POST) and shows it pressed", calls.some((c) => c.key === "POST /jobs/jb1/save") && (await main.locator("article").getByRole("button", { name: "Saved", exact: true }).getAttribute("aria-pressed")) === "true", null);
    await main.getByLabel("Where").selectOption("Austin, TX");
    await wait(700);
    const loc = calls.findLast((c) => c.key === "GET /jobs");
    check(W, "jobs: the place picker lists the common places and asks for one", new URLSearchParams(loc.search).get("location") === "Austin, TX" && (await rowsList.count()) === 1 && (await main.getByLabel("Where").locator("option").count()) === 5, loc.search);
    await main.getByLabel("Where").selectOption("remote");
    await wait(700);
    check(W, "jobs: Remote asks for remote jobs only", new URLSearchParams(calls.findLast((c) => c.key === "GET /jobs").search).get("remote") === "true" && (await rowsList.count()) === 1, null);
    await main.getByLabel("Where").selectOption("");
    await main.getByRole("tab", { name: "Applied" }).click();
    await wait(600);
    check(W, "jobs: Applied lists the jobs you applied to (GET /applications), one row each", (await listCount()) === "10 applied" && (await rowsList.count()) === 10, await listCount());
    await main.getByRole("tab", { name: "All" }).click();
    await main.getByRole("button", { name: "Filters" }).click();
    await main.getByLabel("24 hours").check();
    await wait(700);
    const day = calls.findLast((c) => c.key === "GET /jobs");
    check(W, "jobs: the 24 hours filter asks for it and counts as one filter on", new URLSearchParams(day.search).get("maxAgeHours") === "24" && (await main.getByRole("button", { name: /Filters/ }).innerText()).includes("1"), day.search);
    await main.getByLabel("Hide jobs that need US citizenship or a security clearance").check();
    await wait(700);
    check(W, "jobs: hiding citizenship and clearance jobs asks the API to", new URLSearchParams(calls.findLast((c) => c.key === "GET /jobs").search).get("clearance") === "hide", null);
    check(W, "jobs: no errors", errors.length === 0, errors);
    await context.close();
  }
  {
    // On a phone the list comes first and a job is its own screen with Back, Apply pinned above the tabs.
    const { context, page } = await open(browser, "/jobs", {}, { viewport: { width: 390, height: 844 } });
    const main = page.locator("main");
    const rowsList = main.locator('ul[aria-label="Jobs"] > li');
    check(W, "jobs: phones show the list first, no job open", (await rowsList.count()) === 5 && (await main.locator("article").count()) === 0, null);
    await rowsList.nth(2).locator("button").click();
    await wait(500);
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    check(W, "jobs: a phone opens the job on its own screen, its title focused", (await main.locator('ul[aria-label="Jobs"]').count()) === 0 && focused === "Design systems designer" && (await main.locator("h1").textContent()) === "Jobs", focused);
    check(W, "jobs: a requirement that rules people out is said up front", (await main.locator("article").innerText()).includes("Heads up: Requires US citizenship."), null);
    const apply = await main.getByRole("button", { name: /^Apply to/ }).boundingBox();
    const tabs = await page.locator('nav[aria-label="Dashboard"]').last().boundingBox();
    check(W, "jobs: Apply stays pinned just above the tabs", !!apply && !!tabs && apply.y + apply.height <= tabs.y && tabs.y - (apply.y + apply.height) < 40, { apply, tabs });
    await main.getByRole("button", { name: "Back to jobs" }).click();
    await wait(600);
    check(W, "jobs: Back returns to the list and to the row you opened", (await rowsList.count()) === 5 && !new URL(page.url()).searchParams.get("job") && (await page.evaluate(() => document.activeElement?.getAttribute("data-job"))) === "jb3", page.url());
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/jobs?job=jb4", {}, { viewport: { width: 360, height: 640 } });
    const fit = await page.evaluate(() => document.documentElement.scrollWidth);
    const links = page.locator('nav[aria-label="Dashboard"]').last().locator("a");
    const tabs = await links.allInnerTexts();
    const fits = await links.evaluateAll((els) => els.every((a) => [...a.childNodes].every((n) => n.nodeType !== 3 || (() => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); const box = a.getBoundingClientRect(); return b.left >= box.left - 0.5 && b.right <= box.right + 0.5; })())));
    check(W, "jobs: a link opens that job; at 360 the four tabs' labels fit and nothing scrolls sideways", (await page.locator("main article h2").textContent()) === "Visual designer" && fit <= 360 && fits && tabs.length === 4, { fit, tabs, fits });
    await page.locator("main").getByRole("tab", { name: "Insights" }).click();
    check(W, "jobs: a job Nori hasn't scored says so instead of a fit", (await page.locator("main article").innerText()).includes("Nori hasn’t scored this job"), null);
    await page.locator("main").getByRole("tab", { name: "Review" }).click();
    await page.locator("main article").getByText("Nori reads this form when you press Apply").waitFor({ timeout: 5000 }).catch(() => {});
    const why = await page.locator("main article").innerText();
    const wide360 = await page.evaluate(() => document.documentElement.scrollWidth);
    check(W, "jobs: a form Nori can't read ahead says why (the API's reason), at 360 without sideways scroll", why.includes("Nori reads this form when you press Apply and asks you anything it can't answer before sending.") && wide360 <= 360, wide360);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/jobs", { jobsOffline: true });
    check(W, "jobs: offline says so, with Try again", (await page.locator("main").innerText()).includes("Couldn’t reach Norinote") && (await page.getByRole("button", { name: "Try again" }).count()) === 1, null);
    await context.close();
  }
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const res = await page.goto(`${BASE}/jobs/nope`);
    check(W, "jobs: an address under /jobs is a real 404", res?.status() === 404, res?.status());
    await context.close();
  }
  // Tracker: where applications went, as a Sankey with the headline numbers, a period switch and links into Applications.
  {
    const { context, page, calls, errors } = await open(browser, "/tracker");
    const nav = await page.locator('nav[aria-label="Dashboard"]').first().locator("a").allTextContents();
    const order = nav.map((t) => t.trim()).filter((t) => /^(Applications|Tracker|Inbox)/.test(t)).map((t) => t.replace(/\d+$/, ""));
    check(W, "tracker: in the nav between Applications and Inbox, and current", order.join(",") === "Applications,Tracker,Inbox" && (await page.locator('nav[aria-label="Dashboard"] a[aria-current="page"]', { hasText: "Tracker" }).count()) >= 1, nav);
    const stats = await page.locator("main dl > div").allInnerTexts();
    check(W, "tracker: Sent 15, Replies 3, Interviews 4, Offers 1, response rate 47%", stats.map((t) => t.replace(/\s+/g, " ")).join(" | ") === "Sent 15 | Replies 3 | Interviews 4 | Offers 1 | Response rate 47%", stats);
    // v2 plan section 4: plain, no header art; the period switch beside the title from 1024 px.
    const head = await page.evaluate(() => {
      const h1 = document.querySelector("main h1")?.getBoundingClientRect();
      const g = document.querySelector("main [role=group][aria-label=Period]")?.getBoundingClientRect();
      return { imgs: document.querySelectorAll("main img, main picture").length, beside: !!h1 && !!g && g.left > h1.right && g.top < h1.bottom + 40, h1: h1 && [h1.left, h1.right, h1.top, h1.bottom].map(Math.round), group: g && [g.left, g.right, g.top, g.bottom].map(Math.round) };
    });
    check(W, "tracker: plain (no header image), the period switch beside the title", head.imgs === 0 && head.beside, head);
    const nodes = page.locator("main svg a");
    check(W, "tracker: every node is a link with its count", (await nodes.count()) === 14 && (await nodes.first().getAttribute("aria-label")).startsWith("24 Started."), await nodes.count());
    check(W, "tracker: one band per link", (await page.locator("main svg g[aria-hidden] path").count()) === FLOW.links.length, null);
    const h = async (label) => Number(await page.locator(`main svg a[aria-label^="${label}."] rect`).getAttribute("height"));
    const ratio = (await h("15 Sent")) / (await h("3 Needs you"));
    check(W, "tracker: node heights follow the counts", Math.abs(ratio - 5) < 0.25, ratio);
    const table = await page.locator("main table.sr-only tbody tr").count();
    check(W, "tracker: a table of the links for screen readers", table === FLOW.links.length && (await page.locator("main table.sr-only caption").textContent()).includes("24 applications"), table);
    check(W, "tracker: all time, since the first", (await page.locator("#flow-title").textContent()).includes("since 28 Sept") || (await page.locator("#flow-title").textContent()).includes("since 28 Sep"), await page.locator("#flow-title").textContent());
    await page.getByRole("button", { name: "7 days" }).click();
    await wait(600);
    check(W, "tracker: the period switch asks for 7 days", calls.some((c) => c.key === "GET /applications/flow" && c.search === "?days=7") && (await page.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")) === "true" && (await page.locator("#flow-title").textContent()).includes("in the last 7 days"), calls.filter((c) => c.key === "GET /applications/flow").map((c) => c.search));
    await page.getByRole("button", { name: "All", exact: true }).focus();
    let reached = null;
    for (let i = 0; i < 4 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => (document.activeElement?.closest("svg") ? document.activeElement.getAttribute("aria-label") : null));
    }
    check(W, "tracker: the nodes take keyboard focus", !!reached && /^\d+ Started\./.test(reached), reached);
    await page.locator('main svg a[aria-label*=" Interview."]').click();
    const landed = await page.waitForURL((u) => u.pathname === "/applications" && u.searchParams.get("show") === "replied", { timeout: 8000 }).then(() => true, () => false);
    check(W, "tracker: a node opens its applications (Interview, in Replied)", landed, page.url());
    check(W, "tracker: no errors", errors.length === 0, errors);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/tracker", { flow: FLOW_SMALL });
    const text = await page.locator("main").innerText();
    check(W, "tracker: a few applications still draw, and say it fills in", text.includes("This fills in as more go out") && (await page.locator("main svg a").count()) === 5 && text.replace(/\s+/g, " ").includes("Answered 1 of 2"), text.slice(0, 300));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/tracker", { flow: FLOW_EMPTY });
    check(W, "tracker: empty", (await page.locator("main").innerText()).includes("Your applications will flow here once Nori sends a few.") && (await page.locator("main svg").count()) === 0, null);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/tracker", {}, { viewport: { width: 390, height: 844 } });
    const fit = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, region: (() => { const r = document.querySelector('main [role="region"]'); return r ? r.scrollWidth > r.clientWidth : null; })() }));
    check(W, "tracker: phones keep the page still and scroll the chart", fit.page <= 390 && fit.region === true, fit);
    // v2: Tracker is under More on phones; More shows as current, and opening it shows Tracker as the current page.
    const moreBtn = page.locator('nav[aria-label="Dashboard"]').last().getByRole("button", { name: "More" });
    const moreCurrent = (await moreBtn.getAttribute("aria-current")) === "page";
    await moreBtn.click();
    const tracker = page.locator("#more-sections").getByRole("link", { name: "Tracker" });
    check(W, "tracker: phones reach Tracker under More, marked current", moreCurrent && (await tracker.isVisible()) && (await tracker.getAttribute("aria-current")) === "page", null);
    await page.keyboard.press("Escape");
    check(W, "tracker: Escape closes More and puts focus back on it", (await page.locator("#more-sections").count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "More", null);
    await context.close();
  }
  // Watch Nori apply on the application's page: the live frame beside the run log, and the stage bar.
  {
    const { context, page, errors } = await open(browser, "/applications/a1");
    const shown = await page.locator('main figure img[src^="blob:"]').waitFor({ timeout: 6000 }).then(() => true, () => false);
    check(W, "live: the application's page shows Watch Nori apply", shown && (await page.locator("main figcaption", { hasText: "Watch Nori apply" }).count()) === 1, null);
    const fig = await page.locator("main figure").boundingBox({ timeout: 3000 }).catch(() => null);
    const log = await page.locator('main ol[aria-label^="What Nori has done"]').boundingBox({ timeout: 3000 }).catch(() => null);
    check(W, "live: the run log sits under the frame, beside the list", !!fig && !!log && log.y >= fig.y + fig.height - 2, { fig, log });
    check(W, "live: the stage bar is at Filling the form", (await page.locator('main ol[aria-label="Where the run is"] [aria-current="step"]').textContent().catch(() => "")).includes("Filling the form"), null);
    check(W, "live: no errors", errors.length === 0, errors);
    await context.close();
  }
  {
    const { context, page, calls } = await open(browser, "/applications/a11", { apps: CODE_APPS() });
    await wait(1500);
    check(W, "live: after a run it asks once for the last frame, and shows none when it's gone", calls.filter((c) => c.key === "GET /applications/a11/live").length === 1 && (await page.locator("main figure").count()) === 0, calls.filter((c) => /live/.test(c.key)).length);
    await context.close();
  }
  // Cancel: a quiet action until the run is on the employer's page, confirmed in place; then Cancelled, not a failure.
  {
    const { context, page, calls, errors } = await open(browser, "/applications/a2", { apps: CODE_APPS() });
    const cancel = page.getByRole("button", { name: "Cancel application" });
    check(W, "cancel: offered while it needs you", await cancel.isVisible(), null);
    await cancel.click();
    const ask = page.getByRole("group", { name: "Stop this application? Nori won’t send it. You can try again later." });
    check(W, "cancel: asks first, focus on Stop it", (await ask.isVisible()) && (await page.evaluate(() => document.activeElement?.textContent)) === "Stop it", await page.evaluate(() => document.activeElement?.textContent));
    await ask.getByRole("button", { name: "Keep it" }).click();
    check(W, "cancel: Keep it changes nothing", !calls.some((c) => c.key.endsWith("/cancel")) && (await cancel.isVisible()), null);
    await cancel.click();
    await page.getByRole("button", { name: "Stop it" }).click();
    const done = await page.locator("main", { hasText: "You cancelled this application" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    const text = await page.locator("#dtab-panel").locator("..").innerText();
    check(W, "cancel: sent, then shown as cancelled", done && calls.some((c) => c.key === "POST /applications/a2/cancel") && !text.includes("Didn't go through") && !text.includes("Something went wrong"), text.slice(0, 500));
    check(W, "cancel: the chip says Cancelled, and the action is gone", text.includes("Cancelled") && !(await cancel.count()), null);
    await page.getByRole("button", { name: "Try again" }).click();
    await wait(400);
    check(W, "cancel: Try again asks for a retry", calls.some((c) => c.key === "POST /applications/a2/retry"), null);
    check(W, "cancel: no errors", errors.length === 0, errors);
    await context.close();
  }
  for (const [label, path] of [["applying", "/applications/a1"], ["waiting for a code", "/applications/a10"], ["sent", "/applications/a3"]]) {
    const { context, page } = await open(browser, path, { apps: CODE_APPS() });
    check(W, `cancel: not offered while ${label}`, (await page.getByRole("button", { name: "Cancel application" }).count()) === 0, null);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications/a2", { apps: CODE_APPS(), cancelLate: true });
    await page.getByRole("button", { name: "Cancel application" }).click();
    await page.getByRole("button", { name: "Stop it" }).click();
    const said = await page.locator("main", { hasText: "can't be cancelled now" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    check(W, "cancel: a 409 says why, and the page shows where it is now", said && (await page.locator("main").innerText()).includes("Applying"), null);
    await context.close();
  }
  {
    const { context, page } = await open(browser, "/applications", { apps: CODE_APPS() });
    const t = await rowText(page, "Packaging designer");
    check(W, "cancel: the list says Cancelled", t.includes("Cancelled") && !t.includes("Didn't go through"), t);
    await context.close();
  }
  // A verification code emailed to the person's own address: they type it while the run waits (awaiting_code).
  {
    const { context, page, calls, errors } = await open(browser, "/applications/a10", { apps: CODE_APPS() });
    const box = page.locator("main form", { hasText: "The employer just emailed you a verification code" });
    const input = page.locator("#code-a10");
    const first = await page.locator("#dtab-panel").evaluate((el) => el.firstElementChild?.firstElementChild?.tagName).catch(() => null);
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
  const states = [["/applications", {}], ["/applications/a3", {}], ["/applications/a2", {}], ["/applications/a10", { apps: CODE_APPS() }], ["/applications/a11", { apps: CODE_APPS() }], ["/inbox", {}], ["/inbox/m1", {}], ["/inbox", { inboxOff: true }], ["/tracker", {}], ["/tracker", { flow: FLOW_EMPTY }], ["/nori", { shortlist: MATCHES() }], ["/jobs", {}], ["/jobs?job=jb3", {}]];
  for (const scheme of ["light", "dark"]) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const [path, o] of states) {
        const where = `chromium ${path}${o.inboxOff ? " (off)" : ""}${o.flow ? " (empty)" : ""} ${w}x${h} ${scheme} axe`;
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
  for (const [path, count, order] of [["/applications", 30, ["Applications", "All", "Search applications", "Brand designer"]], ["/inbox", 24, ["Inbox", "Copy", "Settings ·", "All", "Fernway via Greenhouse", "Copy the code"]]]) {
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
