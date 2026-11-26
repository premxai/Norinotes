import { createHash } from "node:crypto";
import { companies, eq, type Db } from "@norinote/db";
import { PendingQuestion } from "@norinote/shared";
import { planForm } from "@norinote/answers";
import {
  approveAndSubmit, autopilotStrongFit, createApplyHandler, createFinishHandler, createPrepareHandler, loadApplication, newStrongFits, prepareStrongFitsAhead, saveAnswers, sharedMemoryInputBus,
  staleRuns, STALE_RUN_MS,
  type ApplyDeps, type LiveInputBus,
} from "@norinote/apply";
import { AiUnavailableError } from "@norinote/ai";
import { embedCareerPoints, profileEmbedding } from "@norinote/graph";
import {
  feedHost, fillJobDescription, HostBackedOffError, HostBackoff, maxPollsPerHost, nextBoards, pollBoard, resolveLogoDomains, sweepStaleJobs, type DueBoard,
} from "@norinote/ingest";
import { createResendForwarder, createStubForwarder, handleInboxReceive, smallModel } from "@norinote/inbox";
import { buildShortlist, jobsFittingLanes, loadCurrentSpec, matchNewJobs, understandJob, unspeccedJobsForBoard, unspeccedJobsForUser } from "@norinote/match";
import { JOBS, type Handler, type JobContext, type JobName, type Payload, type QueueAdapter } from "@norinote/queue";
import { boostCompaniesForUser } from "./boost.js";
import { catchUp } from "./catch-up.js";
import { readGraphSource } from "./graph-sources.js";
import type { WorkerConfig } from "./config.js";
import { createDemandCounter } from "./demand.js";
import { actsForPerson } from "./fast-path.js";
import type { LogFields, Logger } from "./log.js";

export type ConsumerDeps = {
  db: Db;
  queue: QueueAdapter;
  log: Logger;
  config: WorkerConfig;
  apply: ApplyDeps;
  /** The person's clicks and keys during a Finish session. Default: the in-process bus. */
  liveInputs?: LiveInputBus;
  /** Replaces the global fetch for board polling (tests). */
  fetch?: typeof fetch;
  now?: () => Date;
};

export type Consumers = {
  /** Enqueues `ingest.poll-board` for the boards that are due (validation of new candidates included). Returns how many were queued. */
  enqueueDueBoards(): Promise<number>;
  /** Enqueues only the validation polls: a candidate's first poll decides whether it becomes active or dead. Returns how many were queued. */
  enqueueValidations(): Promise<number>;
  /** Matches the jobs understood so far right now instead of waiting for the quiet period. */
  flushMatchBatch(): Promise<void>;
  /** One run of the storage sweep (see `sweepStaleJobs`); logs and returns how many jobs it trimmed. A run already going is not doubled. */
  sweepJobs(): Promise<number>;
  /** Ends a running sweep after its current batch and waits for it. */
  stopSweep(): Promise<void>;
  /** Once the AI service works again: redo what was done without it (see catch-up.ts). Logs and returns what it queued. */
  catchUp(): Promise<LogFields>;
  /** One run of `resolveLogoDomains`; logs and returns how many domains it found. A run already going is not doubled. */
  findLogoDomains(): Promise<number>;
  /** Queues again the applications a lost run left in preparing, applying or awaiting_code (see `staleRuns`). Returns how many. */
  recoverStaleRuns(): Promise<number>;
};

/** Ids in a payload, for the one log line per job. Never the payload itself. */
function payloadFields(p: Record<string, unknown>): LogFields {
  const out: LogFields = {};
  for (const k of ["companyId", "jobId", "userId", "applicationId", "messageId", "reason", "trigger"]) if (typeof p[k] === "string") out[k] = p[k];
  if (Array.isArray(p.jobIds)) out.jobs = p.jobIds.length;
  return out;
}

/** Runs `fn`, writes one log line for the job (ok or error, with duration), and rethrows errors so the queue retries. */
function instrument<N extends JobName>(log: Logger, queue: N, fn: (payload: Payload<N>, ctx: JobContext) => Promise<LogFields | void>): Handler<N> {
  return async (payload, ctx) => {
    const started = Date.now();
    const base = { queue, jobId: ctx.id, attempt: ctx.attempt, ...payloadFields(payload as Record<string, unknown>) };
    try {
      const extra = await fn(payload, ctx);
      log.info("job", { ...base, ok: true, ms: Date.now() - started, ...(extra ?? {}) });
    } catch (err) {
      log.error("job", { ...base, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
}

/** At most `limit` tasks at once per key (a host group), the rest wait. The limit is given per call, since it depends on the job system. */
class KeyedLimiter {
  private active = new Map<string, number>();
  private waiting = new Map<string, (() => void)[]>();
  async run<T>(key: string, limit: number, fn: () => Promise<T>): Promise<T> {
    while ((this.active.get(key) ?? 0) >= limit) await new Promise<void>((resolve) => this.waiting.set(key, [...(this.waiting.get(key) ?? []), resolve]));
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      this.active.set(key, (this.active.get(key) ?? 1) - 1);
      this.waiting.get(key)?.shift()?.();
    }
  }
}

const MATCH_CHUNK = 200;
const MATCH_MAX_WAIT_MS = 5_000;
/** Strong fits prepared ahead go before other preparations. */
const STRONG_FIT_PRIORITY = 10;

/**
 * Collects the ids of jobs that were just understood and hands them to `match.new-jobs` in batches: a burst of understood
 * jobs becomes a handful of match runs instead of one per job. The enqueue is deduplicated per minute and batch, so a
 * retried understand job cannot queue the same batch twice.
 */
class MatchBatcher {
  private ids = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;
  constructor(private readonly queue: QueueAdapter, private readonly delayMs: number, private readonly now: () => Date) {}

  add(jobId: string): void {
    this.ids.add(jobId);
    if (this.ids.size >= MATCH_CHUNK) { void this.flush(); return; }
    if (!this.firstAt) this.firstAt = Date.now();
    if (this.timer) clearTimeout(this.timer);
    // Debounce: wait for a quiet moment, but never hold a batch longer than the max wait.
    const wait = Math.max(0, Math.min(this.delayMs, this.firstAt + MATCH_MAX_WAIT_MS - Date.now()));
    this.timer = setTimeout(() => { void this.flush(); }, wait);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.firstAt = 0;
    const all = [...this.ids];
    this.ids = new Set();
    const minute = Math.floor(this.now().getTime() / 60_000);
    for (let i = 0; i < all.length; i += MATCH_CHUNK) {
      const jobIds = all.slice(i, i + MATCH_CHUNK);
      const digest = createHash("sha1").update([...jobIds].sort().join(",")).digest("hex").slice(0, 16);
      await this.queue.enqueue(JOBS.matchNewJobs, { jobIds }, { dedupeKey: `${minute}:${digest}`, dedupeSeconds: 60 });
    }
  }
}

/** One understand.job per job per hour at most, whoever asks (a poll, a lane change). */
const UNDERSTAND_DEDUPE_SECONDS = 3600;

/** Dedupe window for one board in the queue: longer than the scheduler period, so a slow poll is not queued twice. */
const BOARD_DEDUPE_SECONDS = 15 * 60;
/** How long a board waits when its feed host is refusing requests. */
const BACKED_OFF_RETRY_SECONDS = 5 * 60;

/**
 * If an application stopped on questions the form asked, answer what the person's own data answers: the profile and the
 * answers they typed or saved (planForm with ownDataOnly: no model call, no model draft). Nobody reviews these before
 * they are sent, so anything else stays a pending question. When every required one is answered the application goes
 * straight back to applying (the user already clicked). Returns what happened for the log. The attempt counter on the
 * application bounds how often this can repeat.
 */
async function autoAnswerPending(db: Db, applicationId: string): Promise<{ answered: number; resumed: boolean }> {
  const row = await loadApplication(db, applicationId);
  if (!row || row.status !== "needs_user" || !row.approvedAt || row.pendingQuestions.length === 0) return { answered: 0, resumed: false };
  const questions = row.pendingQuestions.flatMap((q) => { const p = PendingQuestion.safeParse(q); return p.success ? [p.data] : []; });
  if (questions.length === 0) return { answered: 0, resumed: false };
  const plan = await planForm(db, {
    userId: row.userId, jobId: row.jobId, explicit: row.answers, ownDataOnly: true,
    fields: questions.map((q) => ({ key: q.id, label: q.text, type: q.type, required: q.required, options: q.options })),
  });
  // Keyed by the question's own id, where the form drivers and unansweredQuestions look.
  const answers: Record<string, string> = {};
  for (const e of plan.entries) if (e.status === "ready" && e.value !== undefined) answers[e.key] = e.value;
  const answered = Object.keys(answers).length;
  if (answered === 0) return { answered: 0, resumed: false };
  await saveAnswers(db, applicationId, answers);
  if (plan.pending.length > 0) return { answered, resumed: false };
  const approved = await approveAndSubmit(db, applicationId);
  return { answered, resumed: approved.ok && approved.started };
}

/** Registers every queue consumer from ARCHITECTURE.md and returns the hooks the scheduler and tests need. */
export async function registerConsumers(deps: ConsumerDeps): Promise<Consumers> {
  const { db, queue, log, config, apply } = deps;
  const now = deps.now ?? (() => new Date());
  const limiter = new KeyedLimiter();
  const demandFor = createDemandCounter(db, now);
  const batcher = new MatchBatcher(queue, config.matchBatchMs, now);
  let backoff = new HostBackoff();

  async function enqueueBoards(due: DueBoard[]): Promise<number> {
    let queued = 0;
    for (const b of due) {
      const id = await queue.enqueue(JOBS.ingestPollBoard, { companyId: b.id }, { dedupeKey: b.id, dedupeSeconds: BOARD_DEDUPE_SECONDS });
      if (id) queued++;
    }
    return queued;
  }

  /** Candidates are validated by their first poll; they get their own budget so a long seed list cannot crowd out the refresh of live boards (or the other way round). */
  async function enqueueValidations(): Promise<number> {
    const due = await nextBoards(db, { now: now(), limit: config.validatePerRun, perHostLimit: config.hostBoardsPerRun, candidates: "only", atsTypes: config.engineAts });
    const queued = await enqueueBoards(due);
    if (due.length) log.info("scheduler.validate", { due: due.length, queued });
    return queued;
  }

  async function enqueueDueBoards(): Promise<number> {
    // A new cycle starts with a clean slate: hosts that refused us last time are tried again.
    backoff = new HostBackoff();
    const due = await nextBoards(db, { now: now(), limit: config.boardsPerRun, perHostLimit: config.hostBoardsPerRun, candidates: "exclude", atsTypes: config.engineAts });
    const queued = await enqueueBoards(due);
    log.info("scheduler", { due: due.length, queued });
    return queued + await enqueueValidations();
  }

  /** Queues understand.job for these jobs (deduplicated). Returns how many were newly queued. */
  async function enqueueUnderstand(jobIds: readonly string[]): Promise<number> {
    let queued = 0;
    for (const jobId of jobIds) {
      const id = await queue.enqueue(JOBS.understandJob, { jobId }, { dedupeKey: jobId, dedupeSeconds: UNDERSTAND_DEDUPE_SECONDS });
      if (id) queued++;
    }
    return queued;
  }

  /** The job of an application gets back what lean storage dropped: its description and its spec (and embedding). */
  async function restoreJob(applicationId: string): Promise<LogFields> {
    const app = await loadApplication(db, applicationId);
    if (!app) return {};
    let described = "n/a";
    try { described = await fillJobDescription(db, app.jobId, { fetch: deps.fetch }); } catch (err) { described = "failed"; log.warn("prepare.describe_failed", { jobId: app.jobId, error: err instanceof Error ? err.message : String(err) }); }
    // Only a spec the model wrote counts: a heuristic one (written while the AI service was down) is read again now.
    if (await loadCurrentSpec(db, app.jobId)) return described === "has_text" ? {} : { described };
    try { await understandJob(db, app.jobId); } catch (err) { log.warn("prepare.understand_failed", { jobId: app.jobId, error: err instanceof Error ? err.message : String(err) }); return { described, understood: false }; }
    return { described, understood: true };
  }

  let sweeping: Promise<number> | null = null;
  const sweepAbort = new AbortController();
  /** Lean storage: blank the text and drop specs and embeddings of jobs that aged out and nobody refers to. */
  function sweepJobs(): Promise<number> {
    return (sweeping ??= (async () => {
      const started = Date.now();
      try {
        const r = await sweepStaleJobs(db, { now: now(), batchSize: config.jobSweepBatch, signal: sweepAbort.signal });
        log.info("jobs.sweep", { ok: true, ms: Date.now() - started, ...r });
        return r.jobs;
      } catch (err) {
        log.error("jobs.sweep", { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
        return 0;
      } finally {
        sweeping = null;
      }
    })());
  }

  let findingLogos: Promise<number> | null = null;
  function findLogoDomains(): Promise<number> {
    return (findingLogos ??= (async () => {
      const started = Date.now();
      try {
        const r = await resolveLogoDomains(db, { now: now(), batchSize: config.logoDomainsBatch });
        log.info("companies.logo-domains", { ok: true, ms: Date.now() - started, ...r });
        return r.found;
      } catch (err) {
        log.error("companies.logo-domains", { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
        return 0;
      } finally {
        findingLogos = null;
      }
    })());
  }

  // ingest.poll-board: one board's feed into `jobs`. A new job is understood (one model call) only when it could be shown
  // to somebody: it fits an enabled lane of some user. The rest wait until a lane that fits them exists (match.user below).
  await queue.work(JOBS.ingestPollBoard, instrument(log, JOBS.ingestPollBoard, async ({ companyId }, ctx) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company || company.blocked) return { skipped: company ? "blocked" : "missing" };
    // Outside the engine scope (a poll queued before the scope was set, or its back-off retry): drop it, do not read it.
    if (config.engineAts.length && !config.engineAts.includes(company.atsType)) return { skipped: "outside_engine" };
    const demand = await demandFor(company.id);
    let result;
    try {
      result = await limiter.run(feedHost(company.atsType, company.atsToken), maxPollsPerHost(company.atsType, config.pollsPerHost), () =>
        pollBoard(db, { atsType: company.atsType, token: company.atsToken }, { now: now(), fetch: deps.fetch, backoff, demand: demand.lanes, matching7d: demand.matching7d }));
    } catch (err) {
      if (err instanceof HostBackedOffError) {
        // The host is refusing us: try this board again later without using up a retry. One retry per board per window:
        // without the key, every waiting poll of a busy host queued its own retry, and they multiplied forever.
        await queue.enqueue(JOBS.ingestPollBoard, { companyId }, { delaySeconds: BACKED_OFF_RETRY_SECONDS, dedupeKey: `backoff:${companyId}`, dedupeSeconds: BACKED_OFF_RETRY_SECONDS });
        return { backedOff: err.host };
      }
      throw err;
    }
    // A retry no longer sees the jobs its failed try stored as new: it also takes the board's fresh jobs nobody has read.
    const fresh = ctx.attempt > 1 ? [...new Set([...result.newJobIds, ...await unspeccedJobsForBoard(db, company.id, { now: now() })])] : result.newJobIds;
    const wanted = await jobsFittingLanes(db, fresh, { now: now(), engineAts: config.engineAts });
    const understand = await enqueueUnderstand(wanted);
    return {
      board: `${company.atsType}/${company.atsToken}`, added: result.added, updated: result.updated, closed: result.closed, total: result.total, trimmed: result.trimmed,
      understand, notWanted: fresh.length - wanted.length, skipped: result.skipped,
      status: result.status, demand: demand.lanes, matching7d: demand.matching7d,
      ...(result.nextPollAt ? { nextPollMinutes: Math.round((result.nextPollAt.getTime() - now().getTime()) / 60_000) } : {}),
      ...(result.previousStatus === "candidate" ? { validated: result.status } : {}),
      ...(result.notModified ? { notModified: true } : {}),
      ...(result.notFound ? { notFound: true } : {}),
      ...(result.complete ? {} : { incomplete: true }),
    };
  }), { concurrency: config.pollConcurrency });

  // understand.job: spec and embedding, once per job; then it joins the next match batch (which is how a user whose lanes
  // just caused a backlog to be read gets those jobs matched as they finish). Rate-limited: at most N at once.
  await queue.work(JOBS.understandJob, instrument(log, JOBS.understandJob, async ({ jobId }) => {
    // List feeds without text (Workday) are read one posting at a time, only now that the job matters. A failed read
    // is not fatal: the job is understood from its title and gets its text the next time.
    let described = "n/a";
    try { described = await fillJobDescription(db, jobId, { fetch: deps.fetch }); } catch (err) { described = "failed"; log.warn("understand.describe_failed", { jobId, error: err instanceof Error ? err.message : String(err) }); }
    const r = await understandJob(db, jobId);
    batcher.add(jobId);
    return { described, skippedModel: r.skipped, embedded: r.embedded, heuristic: r.heuristic, embeddingPending: r.embeddingPending };
  }), { concurrency: config.understandConcurrency });

  // match.new-jobs: which users the new jobs fit. A strong fit (0.8 or more) for someone who asked Nori to act for them
  // (the schedule, or a linked Telegram) is prepared right away, so it can go out within hours of posting.
  await queue.work(JOBS.matchNewJobs, instrument(log, JOBS.matchNewJobs, async ({ jobIds }) => {
    const r = await matchNewJobs(db, jobIds, { now: now(), engineAts: config.engineAts, limit: config.shortlistSize });
    const fits = await newStrongFits(db, jobIds);
    let preparedAhead = 0;
    for (const userId of new Set(fits.map((f) => f.userId))) {
      if (!(await actsForPerson(db, userId))) continue;
      const ahead = await prepareStrongFitsAhead(db, userId, fits, { now: now(), atsTypes: config.batchAts });
      for (const a of ahead.created) await queue.enqueue(JOBS.prepareApplication, { applicationId: a.applicationId }, { priority: STRONG_FIT_PRIORITY });
      preparedAhead += ahead.created.length;
    }
    return { usersEvaluated: r.usersEvaluated, lanePairs: r.lanePairs, fitted: r.pairsFitted, saved: r.saved, strongFits: fits.length, preparedAhead };
  }));

  // match.user: a profile, graph or lanes change: rebuild one user's shortlist. First the jobs that fit the user's lanes and
  // have not been read yet are queued for understanding (the cost is paid only for jobs somebody can be shown); they
  // reach the user through the match batch as each one finishes. Then the shortlist is built from what is understood now.
  // Without the AI service, unembedded points stay for the next run and jobs and points are compared by skill overlap.
  await queue.work(JOBS.matchUser, instrument(log, JOBS.matchUser, async ({ userId }) => {
    const backlog = await unspeccedJobsForUser(db, userId, { now: now(), engineAts: config.engineAts });
    const understandQueued = await enqueueUnderstand(backlog);
    let embedPending = false;
    try {
      await embedCareerPoints(db, userId);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      embedPending = true;
    }
    const vector = await profileEmbedding(db, userId, now());
    const stats = await buildShortlist(db, userId, { now: now(), profileEmbedding: vector, limit: config.shortlistSize, engineAts: config.engineAts, ...(config.engineAts.length ? { widen: false } : {}), ...(config.explainTop > 0 ? { explain: { top: config.explainTop } } : {}) });
    // Poll first the companies whose jobs fit this user's lanes, so a new user's list fills up sooner.
    const boosted = await boostCompaniesForUser(db, userId, now());
    return {
      backlog: backlog.length, understandQueued, ...(embedPending ? { embedPending } : {}), boosted,
      considered: stats.considered, lexical: stats.lexical, scored: stats.scored, saved: stats.saved,
      laneMatches: stats.laneMatches, widened: stats.widened.length, ...(stats.poolUsed ? { poolUsed: true } : {}), ...(stats.temporaryLane ? { temporaryLane: true } : {}),
      ...(stats.considered === 0 && !vector ? { skipped: "no career points or no lane" } : {}),
    };
  }));

  // prepare.application: tailored resume and standard answers, ready before the click. An older job may have been
  // stored without its description, or trimmed by the sweep (it was nobody's until now): read the posting again and
  // understand it first, so tailoring and answers have the job to work from. Neither failing stops the preparation.
  await queue.work(JOBS.prepareApplication, instrument(log, JOBS.prepareApplication, async (payload) => {
    const restored = await restoreJob(payload.applicationId);
    await createPrepareHandler(db, apply)(payload);
    // Apply with send (the person approved before it was prepared): on to the employer's form now, in a batch or not
    // (the batch only sends the ones still waiting for an OK). Only a first preparation: a retried one waits for the
    // person again.
    const after = await loadApplication(db, payload.applicationId);
    if (after?.status === "prepared" && after.approvedAt && after.attempts === 0) {
      const res = await approveAndSubmit(db, after.id);
      if (res.ok && res.started) await queue.enqueue(JOBS.applyRun, { applicationId: after.id, trigger: "click" });
      return restored;
    }
    // Autopilot for strong fits: one Nori prepared ahead goes out now when the person's schedule is on (within the cap).
    if (after?.status === "prepared") {
      const auto = await autopilotStrongFit(db, after.id, { now: now(), atsTypes: config.batchAts });
      if (auto.started) await queue.enqueue(JOBS.applyRun, { applicationId: after.id, trigger: "autopilot" });
      return { ...restored, autopilot: auto.started ? "sent" : (auto.reason ?? "not_started") };
    }
    return restored;
  }));

  // apply.run: the browser step; afterwards, questions the form asked get answered from the person's own data when they can be.
  const applyHandler = createApplyHandler(db, apply);
  await queue.work(JOBS.applyRun, instrument(log, JOBS.applyRun, async (payload) => {
    await applyHandler(payload);
    const auto = await autoAnswerPending(db, payload.applicationId);
    if (auto.resumed) await queue.enqueue(JOBS.applyRun, { applicationId: payload.applicationId, trigger: payload.trigger }, { delaySeconds: 1 });
    const after = await loadApplication(db, payload.applicationId);
    return { status: after?.status ?? "missing", autoAnswered: auto.answered, resumed: auto.resumed };
  }));

  // apply.finish: a Finish session in the live view: the person solves a captcha or signs in, Nori fills and sends.
  const finishHandler = createFinishHandler(db, { ...apply, inputs: deps.liveInputs ?? sharedMemoryInputBus() });
  await queue.work(JOBS.applyFinish, instrument(log, JOBS.applyFinish, async (payload) => {
    await finishHandler(payload);
    return { applications: payload.applicationIds.length };
  }));

  // inbox.receive: a stored inbound message: settle ambiguous ones with the small model, link, record outcomes, forward
  // (stub until an outbound provider is configured). A waiting apply.run is woken through awaitVerification.
  // Inbox mail goes on to the user's own address through Resend when the worker has its key and sender.
  const forwarder = config.resendApiKey && config.mailFrom
    ? createResendForwarder({ apiKey: config.resendApiKey, from: config.mailFrom })
    : createStubForwarder((line) => log.info("inbox.forward", { line }));
  await queue.work(JOBS.inboxReceive, instrument(log, JOBS.inboxReceive, async ({ messageId }) => handleInboxReceive(db, messageId, { model: smallModel, forwarder })));

  // graph.read-source: a source the person named for their career graph (their GitHub, their site); new facts re-run matching.
  await queue.work(JOBS.graphReadSource, instrument(log, JOBS.graphReadSource, async ({ sourceId }) => {
    const res = await readGraphSource(db, sourceId);
    if (res && res.factsAdded > 0) await queue.enqueue(JOBS.matchUser, { userId: res.userId, reason: "graph" });
    return res ? { status: res.status, factsAdded: res.factsAdded, ...(res.error ? { error: res.error } : {}) } : { status: "missing" };
  }));

  /** Lost runs (a deploy or crash mid-run, a queue job out of retries) are queued again; each at most once per window. */
  async function recoverStaleRuns(): Promise<number> {
    let queued = 0;
    for (const run of await staleRuns(db, { now: now() })) {
      const opts = { dedupeKey: `recover:${run.applicationId}`, dedupeSeconds: STALE_RUN_MS / 1000 };
      const id = run.status === "preparing"
        ? await queue.enqueue(JOBS.prepareApplication, { applicationId: run.applicationId }, opts)
        : await queue.enqueue(JOBS.applyRun, { applicationId: run.applicationId, trigger: "autopilot" }, opts);
      if (!id) continue;
      queued++;
      log.warn("apply.recovered", { applicationId: run.applicationId, status: run.status });
    }
    return queued;
  }

  let catchingUp: Promise<LogFields> | null = null;
  /** One run of `catchUp`; logs what it queued. A run already going is not doubled. */
  function runCatchUp(): Promise<LogFields> {
    return (catchingUp ??= (async () => {
      const started = Date.now();
      try {
        const r = await catchUp({ db, queue, now, engineAts: config.engineAts, enqueueUnderstand });
        log.info("ai.catch-up", { ok: true, ms: Date.now() - started, ...r });
        return r;
      } catch (err) {
        log.error("ai.catch-up", { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
        return {};
      } finally {
        catchingUp = null;
      }
    })());
  }

  return { enqueueDueBoards, enqueueValidations, flushMatchBatch: () => batcher.flush(), sweepJobs, findLogoDomains, recoverStaleRuns, catchUp: runCatchUp,
    stopSweep: async () => { sweepAbort.abort(); await sweeping; },
  };
}
