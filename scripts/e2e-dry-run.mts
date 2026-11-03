/**
 * End-to-end dry run: one fictional person (scripts/eval profile devops_sre, "Marcus Johnson") through every piece of
 * Norinote in one process, on a COPY of a collected job index:
 *
 *   1. copy %TEMP%/norinote-eval4 (jobs, specs, embeddings) to a fresh temp folder and use only the copy
 *   2. the real API app (createApp) on that copy with an in-memory queue: sign up, profile, resume upload (graph built by
 *      the model), lanes, inbox address
 *   3. the real worker (startWorker, same db and queue): match.user builds the shortlist
 *   4. prepare.application through the worker for the top Greenhouse/Lever/Ashby row: tailored resume (ATS Standard PDF),
 *      answer plan, pending questions
 *   5. the pending questions answered through the API as the fictional user
 *   6. apply.run through the worker against a LOCAL replay of the live form: the page HTML is fetched once with plain
 *      GETs, stripped of scripts, served on 127.0.0.1 with the fixture suite's widget shim and a stubbed submit route; every
 *      request that is not 127.0.0.1 is aborted in the browser, so no resume upload or data leaves the machine. Run A with
 *      ALLOW_REAL_SUBMIT unset (dry run), run B with it set (the stubbed submit, to exercise the after-submit signals)
 *   7. inbox: signed synthetic verification mail -> awaitVerification; recruiter reply and interview invite -> outcomes
 *   8. a step table with time and model cost, written to docs/eval/e2e-run1.md
 *
 *   npx tsx scripts/e2e-dry-run.mts [--src <pglite dir>] [--out docs/eval/e2e-run1.md] [--keep]
 *
 * Model spend is capped at $0.15 per run (ledger pattern of scripts/eval/lib/spend.ts; the ledger is
 * data/samples/e2e/spend-ledger.json). The OpenAI key comes from .env and is never printed.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { getProvider, setProvider } from "@norinote/ai";
import {
  and, applications, careerPoints, companies, connect, desc, eq, inboxMessages, jobEmbeddings, jobSpecs, jobs, loadDotEnv, migrate,
  outcomes, queryRows, resumes, sql, type Db,
} from "@norinote/db";
import {
  CompanyGate, DRIVERS, ashbyDriver, createBrowserPool, detectDriver, greenhouseDriver, leverDriver, loadApplyInputs, type BrowserPool, type Driver,
} from "@norinote/apply";
import { awaitVerification, signWebhook } from "@norinote/inbox";
import { getJson, fetchWithRetry, USER_AGENT } from "@norinote/ingest";
import { unspeccedJobsForUser } from "@norinote/match";
import { JOBS, MemoryQueue, type Handler, type JobName, type QueueAdapter } from "@norinote/queue";
import type { PendingQuestion } from "@norinote/shared";
import { createApp } from "../apps/api/src/app.js";
import { loadConfig as loadApiConfig } from "../apps/api/src/config.js";
import { startWorker, type Worker } from "../apps/worker/src/worker.js";
import { loadConfig as loadWorkerConfig } from "../apps/worker/src/config.js";
import { createLogger } from "../apps/worker/src/log.js";
import { Ledger, BudgetStopError, instrumentProvider } from "./eval/lib/spend.js";
import { comboOptionsFromGreenhouse, FORMS_DIR } from "../packages/apply/src/test-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
loadDotEnv(path.join(root, ".env"));
delete process.env.ALLOW_REAL_SUBMIT; // only run B sets it, and only while the replay and the network block are in place
process.env.AI_DAILY_TOKEN_BUDGET = "0"; // the ledger below is the budget

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SRC = path.resolve(opt("src", path.join(os.tmpdir(), "norinote-eval4"))!);
const OUT_MD = path.resolve(root, opt("out", "docs/eval/e2e-run1.md")!);
const SAMPLES = path.join(root, "data", "samples", "e2e");
const CAP_USD = 0.15;

// Never touch these: the eval index itself, the coverage collection, the running collection, the dev database.
const FORBIDDEN = [path.join(os.tmpdir(), "norinote-eval4"), path.join(os.tmpdir(), "norinote-cov"), path.join(root, "data", "collect-full"), path.join(root, "data", "pglite")]
  .map((p) => path.resolve(p).toLowerCase());

mkdirSync(SAMPLES, { recursive: true });
const ledgerPath = path.join(SAMPLES, "spend-ledger.json");
rmSync(ledgerPath, { force: true }); // the cap is per run
const ledger = new Ledger(ledgerPath, CAP_USD);
const real = getProvider();
if (real.name !== "openai") throw new Error("OPENAI_API_KEY is not set (or loaded as fake): the dry run needs the real model.");
setProvider(instrumentProvider(real, ledger));

// ---- the fictional person -------------------------------------------------------------------------------------------

type ProfileSpec = { id: string; resume: string; label: string; location: string; lanes: { name: string; titles: string[]; locations: string[]; remote: boolean }[]; workAuthText: string };
const PROFILE = (JSON.parse(readFileSync(path.join(root, "scripts/eval/profiles.json"), "utf8")) as ProfileSpec[]).find((p) => p.id === "devops_sre")!;
const RESUME_FILE = path.join(root, "scripts/eval/resumes", PROFILE.resume);
const PERSON = {
  name: "Marcus Johnson", accountEmail: "marcus.johnson.e2e@norinote.test", password: "e2e fictional person 2026",
  contactEmail: "marcus.johnson@example.com", phone: "(720) 555-0152", github: "https://github.com/mjohnson-sre",
  location: "Denver, CO", city: "Denver", state: "Colorado", country: "United States",
};
const LONG_ANSWER = "I have spent 7 years running Kubernetes platforms on AWS. At Summit Cloud Software I operate a multi-region EKS platform "
  + "with 300+ services at 99.95% availability, wrote the Terraform and ArgoCD pipeline that cut deployment time from 40 minutes to 8, "
  + "and cut AWS spend by $1.1M a year; I would bring the same focus on reliability, automation and cost to this team.";

// ---- step bookkeeping -----------------------------------------------------------------------------------------------

type Step = { n: number; name: string; ok: boolean; ms: number; usd: number; notes: string[] };
const steps: Step[] = [];
const lines: string[] = []; // the report body
const say = (s = "") => { console.log(s); lines.push(s); };

async function step(n: number, name: string, fn: (notes: string[]) => Promise<boolean>): Promise<Step> {
  ledger.phase = `s${n}`;
  const t0 = performance.now();
  const notes: string[] = [];
  say(`\n## Step ${n}: ${name}\n`);
  let ok = false;
  try {
    ok = await fn(notes);
  } catch (err) {
    if (err instanceof BudgetStopError) throw err;
    notes.push(`error: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    console.error(err);
  }
  const s: Step = { n, name, ok, ms: Math.round(performance.now() - t0), usd: ledger.phaseUsd(`s${n}`), notes };
  steps.push(s);
  say(`\n_${ok ? "PASS" : "FAIL"} in ${(s.ms / 1000).toFixed(1)} s, model $${s.usd.toFixed(4)}${notes.length ? `; ${notes.join("; ")}` : ""}_`);
  return s;
}

// ---- in-process API client ------------------------------------------------------------------------------------------

type Reply<T = any> = { status: number; json: T; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
let app: ReturnType<typeof createApp>;
let cookie = "";
async function call<T = any>(method: string, url: string, o: { body?: unknown; form?: FormData; headers?: Record<string, string>; raw?: string } = {}): Promise<Reply<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  let body: string | FormData | undefined;
  if (o.form) body = o.form;
  else if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const res = await app.request(url, { method, headers, body });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as T, headers: res.headers };
}
const expectOk = (r: Reply, what: string) => { if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); return r; };

// ---- the click gate: apply.run waits in the worker until the "click" of step 6 ------------------------------------------

let releaseClick: () => void = () => {};
const clickGate = new Promise<void>((resolve) => { releaseClick = resolve; });
/** The memory queue for the worker, with apply.run held until step 6 (answering a parked application already queues it). */
function gatedQueue(q: MemoryQueue): QueueAdapter {
  return {
    kind: q.kind,
    start: () => q.start(),
    stop: () => q.stop(),
    enqueue: (name, payload, opts) => q.enqueue(name, payload, opts),
    schedule: (name, cron, payload) => q.schedule(name, cron, payload),
    work: async <N extends JobName>(name: N, handler: Handler<N>, opts?: { concurrency?: number }) => {
      const h: Handler<N> = name === JOBS.applyRun ? async (payload, ctx) => { await clickGate; await handler(payload, ctx); } : handler;
      return q.work(name, h, opts);
    },
  };
}

// ---- local replay of the live form ----------------------------------------------------------------------------------

type Replay = { origin: string; url: string; server: Server; submits: number; hits: string[]; blocked: Map<string, number> };
let replay: Replay | null = null;

/** Scripts, frames, remote assets, event handlers, nonces and hidden values out; the fixture stylesheet in. */
function sanitizeForReplay(html: string, ats: string): string {
  let h = html;
  h = h.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");
  h = h.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "").replace(/<iframe\b[^>]*>/gi, "");
  h = h.replace(/<(object|embed|template|picture|video|audio)\b[\s\S]*?<\/\1>/gi, "");
  h = h.replace(/<link\b[^>]*>/gi, "").replace(/<(img|source|track)\b[^>]*>/gi, "");
  h = h.replace(/<meta\b(?![^>]*name="?viewport)[^>]*>/gi, "");
  h = h.replace(/\s(on[a-z]+|nonce|integrity|data-sitekey|data-hcaptcha-widget-id)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  h = h.replace(/(<input\b[^>]*\btype="hidden"[^>]*?\svalue=")[^"]*"/gi, '$1"');
  h = h.replace(/url\(\s*['"]?(?!data:)[^)]*\)/g, "none");
  h = h.replace(/<base\b[^>]*>/gi, "");
  const css = ats === "lever" ? `<link rel="stylesheet" href="/css/lever.css"><link rel="stylesheet" href="/css/lever-inline.css">` : `<link rel="stylesheet" href="/css/${ats}.css">`;
  return /<head[^>]*>/i.test(h) ? h.replace(/<head([^>]*)>/i, `<head$1>${css}`) : css + h;
}

async function startReplay(slug: string, html: string, options: Record<string, string[] | boolean>): Promise<Replay> {
  const inject = `<script>window.__fixtureOptions=${JSON.stringify(options).replace(/</g, "\\u003c")};</script><script src="/__shim.js"></script>`;
  const page = html.includes("</body>") ? html.replace("</body>", `${inject}</body>`) : html + inject;
  const state = { submits: 0, hits: [] as string[] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    state.hits.push(`${req.method} ${url.pathname}`);
    try {
      if (url.pathname === "/__submit" && req.method === "POST") { state.submits++; req.resume(); res.writeHead(200, { "content-type": "application/json" }).end("{\"ok\":true}"); return; }
      if (url.pathname === "/__shim.js") { res.writeHead(200, { "content-type": "text/javascript" }).end(readFileSync(path.join(FORMS_DIR, "shim.js"))); return; }
      const css = /^\/css\/([\w.-]+\.css)$/.exec(url.pathname);
      if (css && existsSync(path.join(FORMS_DIR, "css", css[1]!))) { res.writeHead(200, { "content-type": "text/css" }).end(readFileSync(path.join(FORMS_DIR, "css", css[1]!))); return; }
      if (url.pathname === `/e2e/${slug}.html`) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page); return; }
      res.writeHead(404).end("not found");
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin, url: `${origin}/e2e/${slug}.html`, server, hits: state.hits, blocked: new Map(),
    get submits() { return state.submits; },
  } as Replay;
}

/** The driver of the replayed form's job system, for URLs on the local replay server only. */
let replayAts: "greenhouse" | "lever" | "ashby" = "greenhouse";
const REAL_DRIVER = { greenhouse: greenhouseDriver, lever: leverDriver, ashby: ashbyDriver };
const replayDriver: Driver = {
  get name() { return replayAts; },
  detect: (url) => !!replay && url.startsWith(`${replay.origin}/`),
  formUrl: () => null,
  fill: (page, ctx) => REAL_DRIVER[replayAts].fill(page, ctx),
  submit: (page, ctx) => REAL_DRIVER[replayAts].submit(page, ctx),
};

/** The worker's pool, plus (once the replay exists) a route that aborts every request not addressed to 127.0.0.1. */
function guardedPool(base: BrowserPool): BrowserPool {
  return {
    get artifactsDir() { return base.artifactsDir; },
    warmUp: () => base.warmUp(),
    stats: () => base.stats(),
    close: () => base.close(),
    run: (label, fn, opts) => base.run(label, async (page, handle) => {
      if (replay) {
        const r = replay;
        await handle.context.route("**/*", async (route) => {
          let host = "";
          try { host = new URL(route.request().url()).hostname; } catch { /* data: and the like */ }
          if (host === "127.0.0.1") return route.fallback();
          r.blocked.set(host || "(other)", (r.blocked.get(host || "(other)") ?? 0) + 1);
          return route.abort("blockedbyclient").catch(() => {});
        });
      }
      return fn(page, handle);
    }, opts),
  };
}

// ---- answering as the fictional person ------------------------------------------------------------------------------

const DECLINE = /decline|prefer not|don'?t wish|do not wish|not to (say|answer|disclose)|choose not/i;
function pickOption(options: string[], want: string): string {
  const w = want.toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === w);
  if (exact) return exact;
  if (/^(yes|no)$/i.test(want)) {
    const yn = options.find((o) => new RegExp(`^\\s*${want}\\b`, "i").test(o));
    if (yn) return yn;
  }
  if (want === "@decline") return options.find((o) => DECLINE.test(o)) ?? options[options.length - 1]!;
  return options.find((o) => o.toLowerCase().includes(w)) ?? options.find((o) => w.includes(o.toLowerCase())) ?? options[0]!;
}

/** A sensible, consistent answer for the person (legal answers from the eval profile: US citizen, no sponsorship, no clearance). */
function answerFor(q: PendingQuestion): string {
  const t = q.text;
  const rules: [RegExp, string][] = [
    [/sponsor/i, "No"],
    [/authori[sz]ed to work|legally (authori[sz]ed|eligible|able)|eligib\w* to work|right to work/i, "Yes"],
    [/clearance/i, "No"],
    [/citizen/i, "Yes"],
    [/gender|race|ethnic|veteran|disabilit|hispanic|latin|sexual orientation|transgender/i, "@decline"],
    [/pronoun/i, "He/him"],
    [/salary|compensation|pay (range|expectation)|desired pay/i, "$165,000 per year"],
    [/start date|when can you start|available to start|notice period/i, "Two weeks after an offer"],
    // He lives in Denver and lists Seattle and San Francisco in his lanes: he would need to move, and is willing to.
    [/\b(require|need)s?\b.{0,40}relocat|relocation (assistance|package|support)/i, "Yes"],
    [/relocat/i, "Yes"],
    [/hear about|how did you (find|learn|hear)|referr|source/i, "Company careers page"],
    [/linkedin/i, "N/A"],
    [/github|portfolio|website/i, PERSON.github],
    [/how many years|years of (professional |relevant )?experience/i, "7"],
    [/18 years|over 18|at least 18/i, "Yes"],
    [/previously (worked|been employed|applied)|former employee|worked (at|for) .* before/i, "No"],
    [/criminal|convicted|felony/i, "No"],
    [/time ?zone/i, "Mountain Time (Denver, CO)"],
    [/remote|hybrid|on[- ]?site|in[- ]office|commute/i, "Yes"],
    [/located|where (are you|do you) (live|reside|based)|current (city|location)|^location|country of residence|state of residence/i, PERSON.location],
    [/consent|privacy|acknowledge|agree|certify|attest|confirm/i, "Yes"],
    [/kubernetes|terraform|aws|on[- ]call|linux|incident/i, "Yes"],
    [/why|interest|tell us|describe|cover letter|anything else|what excites|motivat/i, LONG_ANSWER],
  ];
  const hit = rules.find(([re]) => re.test(t));
  let value = hit ? hit[1] : q.type === "textarea" ? LONG_ANSWER : q.type === "boolean" ? "Yes" : "N/A";
  if (q.options.length) value = pickOption(q.options, value);
  else if (value === "@decline") value = "Decline to self-identify";
  return value;
}

// ---- main -----------------------------------------------------------------------------------------------------------

const t = { click: 0, ready: 0, clickB: 0, submitted: 0 };
const facts: Record<string, unknown> = {};
let worker: Worker | null = null;
let basePool: BrowserPool | null = null;
let closeDb: (() => Promise<void>) | null = null;
let dbDir = "";
const workerLog: string[] = [];
let exitCode = 0;

async function waitFor<T>(what: string, ms: number, fn: () => Promise<T | null | undefined | false>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  say(`# Norinote end-to-end dry run 1`);
  say(`\nRun at ${new Date().toISOString()} by \`npx tsx scripts/e2e-dry-run.mts\`. Fictional person: ${PERSON.name} (${PROFILE.label}, profile \`${PROFILE.id}\`). Model cap $${CAP_USD.toFixed(2)} per run.`);

  let db!: Db;
  // ---- 1 ----------------------------------------------------------------------------------------------------------
  await step(1, "Database: a fresh copy of the job index", async (notes) => {
    if (!existsSync(SRC)) throw new Error(`source index ${SRC} not found`);
    dbDir = mkdtempSync(path.join(os.tmpdir(), "norinote-e2e-"));
    if (FORBIDDEN.includes(path.resolve(dbDir).toLowerCase())) throw new Error("refusing to use a protected database folder");
    cpSync(SRC, dbDir, { recursive: true });
    const handle = await connect({ pgliteDir: dbDir });
    await migrate(handle);
    db = handle.db;
    closeDb = () => handle.close();
    const [j] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs);
    const [s] = await db.select({ n: sql<number>`count(DISTINCT ${jobSpecs.jobId})::int` }).from(jobSpecs);
    const [e] = await db.select({ n: sql<number>`count(*)::int` }).from(jobEmbeddings);
    say(`Copied \`${path.basename(SRC)}\` to \`${dbDir}\` (the copy only is used): ${j!.n} jobs, ${s!.n} with specs, ${e!.n} with embeddings.`);
    notes.push(`${j!.n} jobs, ${e!.n} embedded`);
    return j!.n > 0 && e!.n > 0;
  });
  if (!db) throw new Error("no database");

  // ---- shared plumbing: API + queue + worker objects -----------------------------------------------------------------
  const queue = new MemoryQueue();
  const secret = randomBytes(32).toString("hex"); // webhook secret for this run only; never printed
  const artifacts = mkdtempSync(path.join(os.tmpdir(), "norinote-e2e-artifacts-"));
  const apiConfig = loadApiConfig({ NODE_ENV: "development", ARTIFACTS_DIR: artifacts, INBOUND_WEBHOOK_SECRET: secret, INBOUND_EMAIL_DOMAIN: "in.norinote.test" });
  const apiLog: string[] = [];
  const enqueued: string[] = [];
  app = createApp({
    db, config: apiConfig,
    // match.user is asked for three times during onboarding (resume, profile, lanes); one run after the last is enough.
    enqueue: (name, payload, opts) => {
      enqueued.push(name);
      const o = name === JOBS.matchUser ? { dedupeKey: `e2e:${(payload as { userId: string }).userId}`, dedupeSeconds: 600, ...opts } : opts;
      return queue.enqueue(name, payload, o);
    },
    mailer: { send: async () => {} },
    log: (l) => apiLog.push(l),
  });

  // ---- 2 ----------------------------------------------------------------------------------------------------------
  let userId = "";
  let inboxAddress = "";
  await step(2, "User through the API: sign up, profile, resume, lanes, graph, inbox address", async (notes) => {
    const signup = expectOk(await call("POST", "/api/auth/signup", { body: { email: PERSON.accountEmail, password: PERSON.password, name: PERSON.name } }), "signup");
    userId = signup.json.user.id;
    const set = signup.headers.getSetCookie().find((l) => l.startsWith(`${apiConfig.cookieName}=`));
    cookie = set?.split(";")[0] ?? "";
    if (!cookie) throw new Error("no session cookie");
    expectOk(await call("PUT", "/api/profile", { body: {
      fullName: PERSON.name, email: PERSON.contactEmail, phone: PERSON.phone, location: PERSON.location, city: PERSON.city, state: PERSON.state, country: PERSON.country,
      github: PERSON.github, workAuth: { authorizedUS: true, needsSponsorship: false, status: "citizen" }, securityClearance: "None (eligible to obtain one)",
      willingToRelocate: true, remotePreference: "ok", heardAbout: "Company careers page", salaryExpectation: { amount: 165000, currency: "USD", period: "year" },
      earliestStartDate: "Two weeks after an offer", over18: true,
      preferences: { titles: PROFILE.lanes[0]!.titles, locations: PROFILE.lanes[0]!.locations, remote: "ok" },
    } }), "profile");
    const form = new FormData();
    form.append("file", new File([readFileSync(RESUME_FILE)], path.basename(RESUME_FILE), { type: "text/plain" }));
    const tr = performance.now();
    const up = expectOk(await call("POST", "/api/profile/resume-file", { form }), "resume upload");
    const resumeMs = Math.round(performance.now() - tr);
    expectOk(await call("PUT", "/api/lanes", { body: PROFILE.lanes.map((l) => ({ ...l, minFit: 0.6, enabled: true })) }), "lanes");
    const graph = expectOk(await call("GET", "/api/graph"), "graph");
    const kinds = await db.select({ kind: careerPoints.kind, n: sql<number>`count(*)::int` }).from(careerPoints).where(eq(careerPoints.userId, userId)).groupBy(careerPoints.kind);
    const byKind = Object.fromEntries(kinds.map((k) => [k.kind, k.n]));
    const certs = await db.select({ title: careerPoints.title }).from(careerPoints).where(and(eq(careerPoints.userId, userId), eq(careerPoints.kind, "certification")));
    const addr = expectOk(await call("GET", "/api/inbox/address"), "inbox address");
    inboxAddress = addr.json.address;
    const nodes = Array.isArray(graph.json?.nodes) ? graph.json.nodes.length : 0;
    say(`- account ${PERSON.accountEmail}, user ${userId.slice(0, 8)}`);
    say(`- resume \`${path.basename(RESUME_FILE)}\` read by ${up.json.usedLLM ? "the model" : "the basic parser"} in ${(resumeMs / 1000).toFixed(1)} s: ${up.json.nodesCreated} nodes; graph view ${nodes} nodes`);
    say(`- career points by kind: ${JSON.stringify(byKind)}; certifications: ${certs.map((c) => c.title).join("; ") || "none"}`);
    say(`- lanes: ${PROFILE.lanes.map((l) => `${l.titles.join(" / ")} in ${l.locations.join(", ")}${l.remote ? " or remote" : ""}`).join(" | ")}`);
    say(`- inbox address: \`${inboxAddress}\``);
    facts.byKind = byKind;
    notes.push(`${Object.values(byKind).reduce((a, b) => a + b, 0)} points, ${byKind.certification ?? 0} certifications`);
    return up.json.usedLLM === true && (byKind.certification ?? 0) > 0 && !!inboxAddress;
  });
  if (!userId) throw new Error("no user");

  // ---- 3 ----------------------------------------------------------------------------------------------------------
  type Row = { jobId: string; fit: number; reasons: string[]; job: { companyName: string; title: string; location: string | null; applyUrl: string } };
  let rows: (Row & { ats: string })[] = [];
  await step(3, "match.user through the worker consumers: the shortlist", async (notes) => {
    const backlog = await unspeccedJobsForUser(db, userId, { now: new Date() });
    say(`- lane-fitting jobs without a spec (understand.job backlog): ${backlog.length}`);
    if (backlog.length > 20) throw new Error(`backlog of ${backlog.length} unspecced jobs would cost more than this run allows`);
    basePool = createBrowserPool({ size: 1, artifactsDir: path.join(artifacts, "pool"), spareContexts: 0 });
    const wcfg = { ...loadWorkerConfig({}), artifactsDir: path.join(artifacts, "worker"), browserPoolSize: 1, explainTop: 3 };
    const tw = performance.now();
    worker = await startWorker({
      db, queue: gatedQueue(queue), config: wcfg, log: createLogger((l) => { workerLog.push(l); if (/"ok":false|"level":"error"/.test(l)) console.log(`[worker] ${l.slice(0, 400)}`); }),
      pool: guardedPool(basePool), seed: false, scheduler: false, warmUp: false,
      applyOverrides: {
        // The browser step opens the local replay, never the live form, and refuses to start before the replay exists.
        loadInputs: async (d, id) => {
          const inputs = await loadApplyInputs(d, id);
          if (!replay) throw new Error("e2e: refusing to open a live application form (no local replay)");
          return { ...inputs, applyUrl: replay.url };
        },
        drivers: [replayDriver, ...DRIVERS],
        companyGate: new CompanyGate(0),
        codeTimeoutMs: 20_000,
      },
    });
    await queue.drain();
    const ms = Math.round(performance.now() - tw);
    const fails = queue.failures();
    if (fails.length) throw new Error(`queue failures: ${fails.map((f) => `${f.name}: ${f.error}`).join(" | ")}`);
    const matchRuns = workerLog.filter((l) => l.includes(`"queue":"${JOBS.matchUser}"`));
    const last = matchRuns.at(-1) ? JSON.parse(matchRuns.at(-1)!) as Record<string, unknown> : {};
    say(`- match.user ran ${matchRuns.length}x in ${(ms / 1000).toFixed(1)} s (considered ${last.considered}, scored ${last.scored}, saved ${last.saved}, lane matches ${last.laneMatches}, widened ${last.widened})`);
    const sl = expectOk(await call("GET", "/api/shortlist?limit=30"), "shortlist");
    const list = sl.json as Row[];
    const atsOf = new Map((await db.select({ id: jobs.id, ats: jobs.atsType }).from(jobs).where(sql`${jobs.id} IN (${sql.join(list.map((r) => sql`${r.jobId}`), sql`, `)})`)).map((r) => [r.id, r.ats]));
    rows = list.map((r) => ({ ...r, ats: atsOf.get(r.jobId) ?? "?" }));
    say(`\nTop 5 of ${rows.length}:\n`);
    say(`| # | fit | company | title | system | reasons |`);
    say(`|---|---|---|---|---|---|`);
    rows.slice(0, 5).forEach((r, i) => say(`| ${i + 1} | ${r.fit.toFixed(3)} | ${r.job.companyName} | ${r.job.title} | ${r.ats} | ${r.reasons.slice(0, 3).join(" / ").replace(/\|/g, "/")} |`));
    notes.push(`${rows.length} rows, top fit ${rows[0]?.fit.toFixed(2) ?? "-"}`);
    return rows.length >= 5;
  });

  // ---- 4 ----------------------------------------------------------------------------------------------------------
  let appId = "";
  let target: (Row & { ats: string }) | undefined;
  let pending: PendingQuestion[] = [];
  await step(4, "prepare.application through the worker: tailored resume, answer plan, pending questions", async (notes) => {
    target = rows.find((r) => ["greenhouse", "lever", "ashby"].includes(r.ats) && ["greenhouse", "lever", "ashby"].includes(detectDriver(r.job.applyUrl)?.name ?? ""));
    if (!target) throw new Error("no Greenhouse, Lever or Ashby row on the shortlist");
    say(`- picked #${rows.indexOf(target) + 1}: ${target.job.companyName}, ${target.job.title} (${target.ats}, fit ${target.fit.toFixed(3)}) ${target.job.applyUrl}`);
    const created = expectOk(await call("POST", "/api/applications", { body: { jobId: target.jobId } }), "create application");
    appId = created.json.id;
    await queue.drain();
    const fails = queue.failures();
    if (fails.length) throw new Error(`queue failures: ${fails.map((f) => `${f.name}: ${f.error}`).join(" | ")}`);
    const detail = expectOk(await call("GET", `/api/applications/${appId}`), "application").json;
    const a = detail.application;
    pending = a.pendingQuestions as PendingQuestion[];
    say(`- status: **${a.status}**${a.error ? ` (${a.error})` : ""}`);
    const [res] = a.resumeId ? await db.select().from(resumes).where(eq(resumes.id, a.resumeId)).limit(1) : [];
    if (res?.pdfPath && existsSync(res.pdfPath)) {
      copyFileSync(res.pdfPath, path.join(SAMPLES, "resume.pdf"));
      say(`- tailored resume (ATS Standard, ${res.pages ?? "?"} page(s)): \`data/samples/e2e/resume.pdf\``);
    } else notes.push("no resume PDF");
    const checks = (res?.atsChecks ?? {}) as { score?: number; tailoring?: { coverage: Record<string, { shown: number; total: number; pct: number | null }>; gaps: { requirement: string; mustHave: boolean; lacking: string[] }[]; costMicros: number; stopReason: string; bullets: { rewritten: boolean; kept?: boolean; reverted: boolean }[]; summary: { source: string; failures: { rule: string; detail: string }[] } } };
    const tr = checks.tailoring;
    if (tr) {
      const c = (k: string) => { const v = tr.coverage[k]; return v ? `${v.shown}/${v.total} (${v.pct === null ? "-" : `${Math.round(v.pct)}%`})` : "-"; };
      say(`- tailoring: supported must-have coverage ${c("before")} -> ${c("after")}; exact spelling ${c("exactBefore")} -> ${c("exactAfter")}; key phrase ${c("phraseBefore")} -> ${c("phraseAfter")}`);
      say(`  bullets rewritten ${tr.bullets.filter((b) => b.rewritten && !b.reverted).length}, kept ${tr.bullets.filter((b) => b.kept).length}, reverted ${tr.bullets.filter((b) => b.reverted).length}; summary from ${tr.summary.source}${tr.summary.failures.length ? ` (${tr.summary.failures.map((f) => `${f.rule}: ${f.detail}`).join("; ")})` : ""}; stop: ${tr.stopReason}; ATS score ${checks.score ?? "-"}; tailoring cost $${(tr.costMicros / 1e6).toFixed(4)}`);
      say(`  gaps (${tr.gaps.length}): ${tr.gaps.slice(0, 8).map((g) => `${g.mustHave ? "[must] " : ""}${g.requirement.slice(0, 70)}${g.lacking.length ? ` (lacks ${g.lacking.join(", ")})` : ""}`).join("; ") || "none"}`);
      facts.coverage = { before: tr.coverage.before, after: tr.coverage.after };
    } else notes.push("no tailoring report");
    const prep = (a.receipt?.prepared ?? null) as null | { schemaSource: string; recipeHit: boolean; fields: number; ready: number; pending: number; skipped: number; sources: Record<string, number>; usage: { smallCalls: number; largeCalls: number; embedCalls: number; costMicros: number }; timings: Record<string, number> };
    if (prep) {
      const s = prep.sources;
      say(`- answer plan (${prep.schemaSource}${prep.recipeHit ? ", recipe hit" : ""}): ${prep.fields} fields, ${prep.ready} ready, ${prep.pending} pending, ${prep.skipped} skipped; by source: profile slots ${(s.profile ?? 0) + (s.eeo ?? 0) + (s.decline ?? 0)}, answers ${s.answers ?? 0}, bank ${s.bank ?? 0}, small model ${s.model ?? 0}, large model ${s.large ?? 0}; calls: ${prep.usage.smallCalls} small, ${prep.usage.largeCalls} large, ${prep.usage.embedCalls} embed; plan ${prep.timings.planMs ?? "-"} ms, schema ${prep.timings.schemaMs ?? "-"} ms`);
    } else notes.push("no prepared receipt");
    say(`- standard and form answers stored: ${Object.keys(a.answers).length}`);
    if (pending.length) {
      say(`- pending questions (${pending.length}):`);
      for (const q of pending) say(`  - \`${q.id}\` ${q.required ? "(required) " : ""}${q.type}: ${q.text.slice(0, 120)}${q.options.length ? ` [${q.options.slice(0, 6).join(" | ")}${q.options.length > 6 ? " ..." : ""}]` : ""}`);
    }
    notes.push(`${a.status}, ${pending.length} pending`);
    return !!res?.pdfPath && !!tr && !!prep && (a.status === "prepared" || a.status === "needs_user");
  });

  // ---- 5 ----------------------------------------------------------------------------------------------------------
  await step(5, "Pending questions answered through the API", async (notes) => {
    if (!appId) throw new Error("no application");
    if (!pending.length) { say("- nothing pending: the application is ready for the click"); notes.push("nothing pending"); return true; }
    const answers: Record<string, string> = {};
    for (const q of pending) answers[q.id] = answerFor(q);
    for (const q of pending) say(`- ${q.text.slice(0, 90)} -> **${answers[q.id]!.slice(0, 120)}${answers[q.id]!.length > 120 ? "..." : ""}**`);
    const r = expectOk(await call("POST", `/api/applications/${appId}/answer`, { body: { answers } }), "answer");
    say(`- API answered: status ${r.json.status}, resumed ${r.json.resumed}`);
    const [row] = await db.select({ status: applications.status, approvedAt: applications.approvedAt }).from(applications).where(eq(applications.id, appId));
    if (row?.status === "applying" && r.json.resumed) {
      say(`- note: answering moved the application straight to \`applying\` and stamped \`approved_at\` (apps/api answerApplication calls approveAndSubmit); apply.run was queued and is held by this script until the click in step 6`);
      notes.push("answering approved the application (reported)");
      facts.answerApproves = true;
    }
    return row?.status === "applying" || row?.status === "prepared";
  });

  // ---- 6 ----------------------------------------------------------------------------------------------------------
  await step(6, "Apply through the worker against a local replay of the live form (nothing sent to the employer)", async (notes) => {
    if (!appId || !target) throw new Error("no application");
    const [job] = await db.select({ externalId: jobs.externalId, applyUrl: jobs.applyUrl, token: companies.atsToken, ats: jobs.atsType }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, target.jobId));
    if (!job) throw new Error("job missing");
    const slug = `${job.ats}-${job.token}-${job.externalId.slice(0, 12)}`.replace(/[^\w.-]+/g, "_");
    const rawPath = path.join(SAMPLES, `${slug}.live.html`);
    let options: Record<string, string[] | boolean> = {};
    let pageUrl: string;
    if (job.ats === "greenhouse") {
      pageUrl = `https://job-boards.greenhouse.io/${job.token}/jobs/${job.externalId}`;
      const qPath = path.join(SAMPLES, `${slug}.gh.json`);
      if (!existsSync(qPath)) {
        const schema = await getJson<Record<string, unknown>>(`https://boards-api.greenhouse.io/v1/boards/${job.token}/jobs/${job.externalId}?questions=true`);
        if (!schema) throw new Error("Greenhouse questions API answered 404");
        for (const k of ["content", "metadata", "ai_disclaimer"]) delete schema[k];
        writeFileSync(qPath, JSON.stringify(schema, null, 1));
      }
      options = comboOptionsFromGreenhouse(JSON.parse(readFileSync(qPath, "utf8")));
    } else if (job.ats === "lever") {
      pageUrl = `${job.applyUrl.replace(/\/(apply)?$/, "")}/apply`;
    } else {
      throw new Error(`${job.ats} renders its form with JavaScript; a plain GET has no form to replay`);
    }
    if (!existsSync(rawPath)) {
      const res = await fetchWithRetry(pageUrl, { headers: { accept: "text/html" } }, { timeoutMs: 20_000 });
      if (!res.ok) throw new Error(`GET ${pageUrl}: ${res.status}`);
      writeFileSync(rawPath, await res.text());
      say(`- fetched the live page once: ${pageUrl} (plain GET, \`${USER_AGENT}\`)`);
    } else say(`- live page already saved by an earlier run: \`${path.relative(root, rawPath)}\` (not fetched again)`);
    const live = readFileSync(rawPath, "utf8");
    const clean = sanitizeForReplay(live, job.ats);
    writeFileSync(path.join(SAMPLES, `${slug}.replay.html`), clean);
    const inputs = (clean.match(/<(input|textarea|select)\b/gi) ?? []).length;
    say(`- saved \`data/samples/e2e/${slug}.live.html\` (${Math.round(live.length / 1024)} KB) and the replay copy (${Math.round(clean.length / 1024)} KB, ${inputs} form controls, scripts and frames removed)`);
    if (inputs < 3) throw new Error("the plain HTML has no application form to replay");
    replayAts = job.ats as typeof replayAts;
    replay = await startReplay(slug, clean, options);
    say(`- replay on ${replay.origin} with the fixture widget shim; submit route stubbed; every non-127.0.0.1 request aborted in the browser`);

    // Run A: the click, dry run (ALLOW_REAL_SUBMIT unset).
    if (process.env.ALLOW_REAL_SUBMIT) throw new Error("ALLOW_REAL_SUBMIT must be unset for run A");
    t.click = Date.now();
    const [before] = await db.select({ status: applications.status }).from(applications).where(eq(applications.id, appId));
    if (before?.status === "prepared") expectOk(await call("POST", `/api/applications/${appId}/approve`, { body: {} }), "approve");
    releaseClick();
    const afterA = await waitFor("run A", 200_000, async () => {
      const [r] = await db.select().from(applications).where(eq(applications.id, appId));
      return r && !["applying", "awaiting_code"].includes(r.status) ? r : null;
    });
    t.ready = Date.now();
    const recA = (afterA.receipt ?? {}) as { dryRun?: boolean; totals?: { fields: number; files: number }; sections?: { name: string; fields: { label: string; value: string }[] }[]; timings?: Record<string, number>; screenshotPath?: string; submitClicked?: boolean };
    const fieldsA = recA.totals?.fields ?? 0;
    const filled = (recA.sections ?? []).flatMap((x) => x.fields);
    const emailOnForm = filled.find((f) => /^e-?mail/i.test(f.label))?.value ?? "";
    facts.emailOnForm = emailOnForm;
    say(`\nRun A (dry run): status **${afterA.status}**${afterA.error ? ` (${afterA.error})` : ""}; click to ready ${((t.ready - t.click) / 1000).toFixed(1)} s (form ready in ${((recA.timings?.readyMs ?? 0) / 1000).toFixed(1)} s: open ${recA.timings?.openMs ?? "-"} ms, discover ${recA.timings?.discoverMs ?? "-"}, files ${recA.timings?.filesMs ?? "-"}, text ${recA.timings?.textMs ?? "-"}, choices ${recA.timings?.choicesMs ?? "-"}, validate ${recA.timings?.validateMs ?? "-"}); ${fieldsA} fields and ${recA.totals?.files ?? 0} file filled; submit clicked: ${recA.submitClicked === true}; stub submits: ${replay.submits}`);
    say(`- filled: ${filled.map((f) => `${f.label.slice(0, 50)} = ${String(f.value).slice(0, 40)}`).join("; ")}`);
    say(`- email on the form: \`${emailOnForm}\`${emailOnForm === inboxAddress ? " (the owned inbox address)" : " (NOT the owned inbox address)"}`);
    if (recA.screenshotPath && existsSync(recA.screenshotPath)) { copyFileSync(recA.screenshotPath, path.join(SAMPLES, "filled-form.png")); say(`- screenshot of the filled form: \`data/samples/e2e/filled-form.png\``); }
    if (afterA.status === "needs_user") say(`- pending after fill: ${JSON.stringify(afterA.pendingQuestions).slice(0, 400)}`);
    const okA = afterA.status === "prepared" && recA.dryRun === true && replay.submits === 0 && recA.submitClicked !== true && fieldsA > 0;

    // Run B: the stubbed submit allowed (only the 127.0.0.1 route receives anything).
    let okB = false;
    if (okA) {
      process.env.ALLOW_REAL_SUBMIT = "true";
      try {
        t.clickB = Date.now();
        expectOk(await call("POST", `/api/applications/${appId}/approve`, { body: {} }), "approve (run B)");
        const afterB = await waitFor("run B", 200_000, async () => {
          const [r] = await db.select().from(applications).where(eq(applications.id, appId));
          return r && !["applying", "awaiting_code"].includes(r.status) ? r : null;
        });
        t.submitted = Date.now();
        const recB = (afterB.receipt ?? {}) as { submitClicked?: boolean; confirmationText?: string; timings?: Record<string, number>; screenshotPath?: string; submit?: unknown; finalUrl?: string };
        const evRows = await queryRows<{ step: string; message: string }>(db, sql`SELECT step, message FROM run_events WHERE application_id = ${appId} AND step IN ('submit', 'submitted', 'submit_unconfirmed') ORDER BY id`);
        say(`\nRun B (stubbed submit): status **${afterB.status}**${afterB.error ? ` (${afterB.error})` : ""}; click to submitted ${((t.submitted - t.clickB) / 1000).toFixed(1)} s (submit ${recB.timings?.submitMs ?? "-"} ms); submit clicked: ${recB.submitClicked === true}; confirmation: "${recB.confirmationText ?? ""}"; stub submits: ${replay.submits}`);
        say(`- run events: ${evRows.map((e) => `${e.step}: ${e.message.slice(0, 80)}`).join(" | ")}`);
        if (recB.screenshotPath && existsSync(recB.screenshotPath)) { copyFileSync(recB.screenshotPath, path.join(SAMPLES, "after-submit.png")); say(`- screenshot after the stubbed submit: \`data/samples/e2e/after-submit.png\``); }
        okB = afterB.status === "submitted" && recB.submitClicked === true && replay.submits === 1;
      } finally {
        delete process.env.ALLOW_REAL_SUBMIT;
      }
    }
    const blocked = [...replay.blocked.entries()].map(([h, n]) => `${h} x${n}`).join(", ") || "none";
    say(`- requests aborted by the 127.0.0.1-only rule: ${blocked}; local server hits: ${[...new Set(replay.hits)].join(", ")}`);
    notes.push(`A ${afterA.status}, B ${okB ? "submitted (stub)" : "not submitted"}`);
    return okA && okB;
  });

  // ---- 7 ----------------------------------------------------------------------------------------------------------
  await step(7, "Inbox: signed verification mail -> awaitVerification; recruiter reply and interview -> outcomes", async (notes) => {
    if (!appId || !target || !inboxAddress) throw new Error("no application or inbox address");
    const company = target.job.companyName;
    const domain = `${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
    const post = async (msg: Record<string, unknown>) => {
      const raw = JSON.stringify(msg);
      const ts = Math.floor(Date.now() / 1000);
      return call("POST", "/api/inbox/webhook/generic", { raw, headers: { "content-type": "application/json", "x-norinote-timestamp": String(ts), "x-norinote-signature": signWebhook(raw, secret, ts) } });
    };
    // A wrong signature must be refused.
    const bad = await call("POST", "/api/inbox/webhook/generic", { raw: "{}", headers: { "content-type": "application/json", "x-norinote-timestamp": String(Math.floor(Date.now() / 1000)), "x-norinote-signature": `v1=${"0".repeat(64)}` } });
    say(`- unsigned/wrong signature: HTTP ${bad.status}`);

    const code = `Q7t${randomBytes(2).toString("hex")}Vx`;
    const since = new Date(Date.now() - 1000);
    const waiting = awaitVerification({ applicationId: appId, since, timeoutMs: 15_000, accept: "code", db, pollMs: 250 });
    const tv = performance.now();
    const v = await post({
      messageId: `<e2e-code-${Date.now()}@us.greenhouse-mail.io>`, from: `${company} via Greenhouse <no-reply@us.greenhouse-mail.io>`, to: inboxAddress,
      subject: `Security code for your application to ${company}`,
      text: `Hi Marcus,\n\nThanks for your interest in the ${target.job.title} role at ${company}.\n\nCopy and paste this code into the first field of your application:\n\n${code}\n\nAfter you enter the code, you can submit your application.\n`,
      date: new Date().toISOString(),
    });
    const got = await waiting;
    const verifyMs = Math.round(performance.now() - tv);
    say(`- verification mail: HTTP ${v.status} ${JSON.stringify(v.json)}; awaitVerification -> ${got ? `${got.type} ${got.type === "code" ? got.code : ""} in ${verifyMs} ms` : "null"} (sent ${code})`);
    const codeOk = v.status === 200 && got?.type === "code" && got.code === code;

    const reply = await post({
      messageId: `<e2e-reply-${Date.now()}@${domain}>`, from: `Jordan Lee <jordan.lee@${domain}>`, to: inboxAddress,
      subject: `Your application for ${target.job.title}`,
      text: `Hi Marcus,\n\nI'm the recruiter for the ${target.job.title} role at ${company}. I read your background and your EKS work stood out. Before we go further, could you tell me your current notice period?\n\nBest,\nJordan Lee, Talent team, ${company}`,
      date: new Date().toISOString(),
    });
    const invite = await post({
      messageId: `<e2e-invite-${Date.now()}@${domain}>`, from: `Jordan Lee <jordan.lee@${domain}>`, to: inboxAddress,
      subject: `Interview invitation: ${target.job.title} at ${company}`,
      text: `Hi Marcus,\n\nThanks for the quick reply. We would like to invite you to an interview with our platform team. Please pick a time that works for you: https://calendly.com/${domain.replace(".com", "")}-recruiting/45min\n\nJordan`,
      date: new Date().toISOString(),
    });
    await queue.drain(); // inbox.receive for each message
    const msgs = await db.select({ kind: inboxMessages.kind, applicationId: inboxMessages.applicationId, code: inboxMessages.code, meta: inboxMessages.meta, subject: inboxMessages.subject })
      .from(inboxMessages).where(eq(inboxMessages.userId, userId)).orderBy(desc(inboxMessages.receivedAt));
    say(`- recruiter reply: HTTP ${reply.status}; interview invite: HTTP ${invite.status}`);
    say(`- inbox (GET /api/inbox shows the same): ${msgs.map((m) => `${m.kind}${m.code ? ` ${m.code}` : ""} -> ${m.applicationId === appId ? "this application" : m.applicationId ?? "unlinked"}${(m.meta as { trusted?: boolean })?.trusted ? " (trusted)" : ""}`).join("; ")}`);
    const summary = expectOk(await call("GET", "/api/outcomes/summary"), "outcomes summary").json;
    const appOutcomes = expectOk(await call("GET", `/api/applications/${appId}/outcomes`), "application outcomes").json;
    const outRows = await db.select({ kind: outcomes.kind, source: outcomes.source }).from(outcomes).where(eq(outcomes.applicationId, appId));
    const o = summary.overall ?? {};
    say(`- outcomes for this application: ${outRows.map((r) => `${r.kind} (${r.source})`).join(", ") || "none"}; GET /api/applications/:id/outcomes -> ${JSON.stringify(appOutcomes).slice(0, 200)}`);
    say(`- GET /api/outcomes/summary overall: applications ${o.applications}, responses ${o.responses}, interviews ${o.interviews}, pending ${o.pending}, smallSample ${o.smallSample}`);
    const linked = msgs.filter((m) => m.applicationId === appId).length;
    notes.push(`code ${codeOk ? "delivered" : "NOT delivered"}, ${linked}/${msgs.length} linked, ${outRows.length} outcomes`);
    return bad.status === 401 && codeOk && linked === msgs.length && outRows.some((r) => r.kind === "reply") && outRows.some((r) => r.kind === "interview") && (o.interviews ?? 0) >= 1;
  });
}

function finalTable() {
  say(`\n## Step 8: summary\n`);
  say(`| step | result | time | model cost | notes |`);
  say(`|---|---|---|---|---|`);
  for (const s of steps) say(`| ${s.n}. ${s.name} | ${s.ok ? "pass" : "FAIL"} | ${(s.ms / 1000).toFixed(1)} s | $${s.usd.toFixed(4)} | ${s.notes.join("; ").replace(/\|/g, "/")} |`);
  const total = ledger.totalUsd();
  const ms = steps.reduce((a, s) => a + s.ms, 0);
  say(`| total | ${steps.every((s) => s.ok) ? "pass" : "FAIL"} | ${(ms / 1000).toFixed(1)} s | $${total.toFixed(4)} | cap $${CAP_USD.toFixed(2)} |`);
  if (t.click && t.ready) say(`\nClick (step 6, run A) to ready: **${((t.ready - t.click) / 1000).toFixed(1)} s**. Click (run B) to stubbed-submitted: **${t.submitted ? `${((t.submitted - t.clickB) / 1000).toFixed(1)} s` : "-"}**.`);
  const byModel = ledger.byPhaseModel().map((e) => `${e.phase} ${e.model}: ${e.calls} calls, $${e.usd.toFixed(4)}`).join("; ");
  say(`\nModel spend by step and model: ${byModel || "none"}.`);
}

try {
  await main();
} catch (err) {
  exitCode = err instanceof BudgetStopError ? 3 : 1;
  say(`\nStopped: ${err instanceof Error ? err.message : String(err)}`);
  if (!(err instanceof BudgetStopError)) console.error(err);
} finally {
  releaseClick();
  finalTable();
  ledger.save();
  mkdirSync(path.dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, lines.join("\n") + "\n");
  writeFileSync(path.join(SAMPLES, "worker.log"), workerLog.join("\n") + "\n");
  console.log(`\nwrote ${path.relative(root, OUT_MD)} (worker log: data/samples/e2e/worker.log)`);
  await (worker as Worker | null)?.stop().catch(() => {});
  await (basePool as BrowserPool | null)?.close().catch(() => {});
  if (replay) await new Promise<void>((resolve) => { replay!.server.closeAllConnections?.(); replay!.server.close(() => resolve()); });
  await (closeDb as (() => Promise<void>) | null)?.().catch(() => {});
  // The copy is scratch; --keep leaves it for inspection.
  if (dbDir && !args.includes("--keep")) rmSync(dbDir, { recursive: true, force: true });
}
process.exit(exitCode);
