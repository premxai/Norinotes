import { createHash } from "node:crypto";
import { companies, eq, jobSpecs, type Db } from "@norinote/db";
import { PendingQuestion } from "@norinote/shared";
import { answerQuestions } from "@norinote/answers";
import {
  approveAndSubmit, createApplyHandler, createPrepareHandler, loadApplication, saveAnswers, type ApplyDeps,
} from "@norinote/apply";
import { AiUnavailableError } from "@norinote/ai";
import { embedCareerPoints, profileEmbedding } from "@norinote/graph";
import {
  feedHost, fillJobDescription, HostBackedOffError, HostBackoff, maxPollsPerHost, nextBoards, pollBoard, resolveLogoDomains, sweepStaleJobs, type DueBoard,
} from "@norinote/ingest";
import { createStubForwarder, handleInboxReceive, smallModel } from "@norinote/inbox";
import { buildShortlist, jobsFittingLanes, matchNewJobs, understandJob, unspeccedJobsForUser } from "@norinote/match";
import { JOBS, type Handler, type JobName, type Payload, type QueueAdapter } from "@norinote/queue";
import { boostCompaniesForUser } from "./boost.js";
import type { WorkerConfig } from "./config.js";
import { createDemandCounter } from "./demand.js";
import type { LogFields, Logger } from "./log.js";

export type ConsumerDeps = {
  db: Db;
  queue: QueueAdapter;
  log: Logger;
  config: WorkerConfig;
  apply: ApplyDeps;
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
  /** One run of `resolveLogoDomains`; logs and returns how many domains it found. A run already going is not doubled. */
  findLogoDomains(): Promise<number>;
};

/** Ids in a payload, for the one log line per job. Never the payload itself. */
function payloadFields(p: Record<string, unknown>): LogFields {
  const out: LogFields = {};
  for (const k of ["companyId", "jobId", "userId", "applicationId", "messageId", "reason", "trigger"]) if (typeof p[k] === "string") out[k] = p[k];
  if (Array.isArray(p.jobIds)) out.jobs = p.jobIds.length;
  return out;
}

/** Runs `fn`, writes one log line for the job (ok or error, with duration), and rethrows errors so the queue retries. */
function instrument<N extends JobName>(log: Logger, queue: N, fn: (payload: Payload<N>) => Promise<LogFields | void>): Handler<N> {
  return async (payload, ctx) => {
    const started = Date.now();
    const base = { queue, jobId: ctx.id, attempt: ctx.attempt, ...payloadFields(payload as Record<string, unknown>) };
    try {
      const extra = await fn(payload);
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
const MATCH_MAX_WAIT_MS = 30_000;

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
 * If an application stopped on questions the form asked, try to answer them from the profile and the answer bank. When
 * every required one is answered the application goes straight back to applying (the user already clicked). Returns what
 * happened for the log. The attempt counter on the application bounds how often this can repeat.
 */
async function autoAnswerPending(db: Db, applicationId: string): Promise<{ answered: number; resumed: boolean }> {
  const row = await loadApplication(db, applicationId);
  if (!row || row.status !== "needs_user" || !row.approvedAt || row.pendingQuestions.length === 0) return { answered: 0, resumed: false };
  const questions = row.pendingQuestions.flatMap((q) => { const p = PendingQuestion.safeParse(q); return p.success ? [p.data] : []; });
  if (questions.length === 0) return { answered: 0, resumed: false };
  const res = await answerQuestions(db, { userId: row.userId, jobId: row.jobId, questions });
  const answered = Object.keys(res.answers).length;
  if (answered === 0) return { answered: 0, resumed: false };
  await saveAnswers(db, applicationId, res.answers);
  if (res.pending.length > 0) return { answered, resumed: false };
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
    const due = await nextBoards(db, { now: now(), limit: config.validatePerRun, perHostLimit: config.hostBoardsPerRun, candidates: "only" });
    const queued = await enqueueBoards(due);
    if (due.length) log.info("scheduler.validate", { due: due.length, queued });
    return queued;
  }

  async function enqueueDueBoards(): Promise<number> {
    // A new cycle starts with a clean slate: hosts that refused us last time are tried again.
    backoff = new HostBackoff();
    const due = await nextBoards(db, { now: now(), limit: config.boardsPerRun, perHostLimit: config.hostBoardsPerRun, candidates: "exclude" });
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
    const [spec] = await db.select({ id: jobSpecs.id }).from(jobSpecs).where(eq(jobSpecs.jobId, app.jobId)).limit(1);
    if (spec) return described === "has_text" ? {} : { described };
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
  await queue.work(JOBS.ingestPollBoard, instrument(log, JOBS.ingestPollBoard, async ({ companyId }) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company || company.blocked) return { skipped: company ? "blocked" : "missing" };
    const demand = await demandFor(company.id);
    let result;
    try {
      result = await limiter.run(feedHost(company.atsType, company.atsToken), maxPollsPerHost(company.atsType, config.pollsPerHost), () =>
        pollBoard(db, { atsType: company.atsType, token: company.atsToken }, { now: now(), fetch: deps.fetch, backoff, demand }));
    } catch (err) {
      if (err instanceof HostBackedOffError) {
        // The host is refusing us: try this board again later without using up a retry.
        await queue.enqueue(JOBS.ingestPollBoard, { companyId }, { delaySeconds: BACKED_OFF_RETRY_SECONDS });
        return { backedOff: err.host };
      }
      throw err;
    }
    const wanted = await jobsFittingLanes(db, result.newJobIds, { now: now() });
    const understand = await enqueueUnderstand(wanted);
    return {
      board: `${company.atsType}/${company.atsToken}`, added: result.added, updated: result.updated, closed: result.closed, total: result.total, trimmed: result.trimmed,
      understand, notWanted: result.newJobIds.length - wanted.length, skipped: result.skipped,
      status: result.status, demand,
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

  // match.new-jobs: which users the new jobs fit.
  await queue.work(JOBS.matchNewJobs, instrument(log, JOBS.matchNewJobs, async ({ jobIds }) => {
    const r = await matchNewJobs(db, jobIds, { now: now() });
    return { usersEvaluated: r.usersEvaluated, lanePairs: r.lanePairs, fitted: r.pairsFitted, saved: r.saved };
  }));

  // match.user: a profile, graph or lanes change: rebuild one user's shortlist. First the jobs that fit the user's lanes and
  // have not been read yet are queued for understanding (the cost is paid only for jobs somebody can be shown); they
  // reach the user through the match batch as each one finishes. Then the shortlist is built from what is understood now.
  // Without the AI service, unembedded points stay for the next run and jobs and points are compared by skill overlap.
  await queue.work(JOBS.matchUser, instrument(log, JOBS.matchUser, async ({ userId }) => {
    const backlog = await unspeccedJobsForUser(db, userId, { now: now() });
    const understandQueued = await enqueueUnderstand(backlog);
    let embedPending = false;
    try {
      await embedCareerPoints(db, userId);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      embedPending = true;
    }
    const vector = await profileEmbedding(db, userId, now());
    const stats = await buildShortlist(db, userId, { now: now(), profileEmbedding: vector, ...(config.explainTop > 0 ? { explain: { top: config.explainTop } } : {}) });
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
    return restored;
  }));

  // apply.run: the browser step; afterwards, questions the form asked get answered from the bank when they can be.
  const applyHandler = createApplyHandler(db, apply);
  await queue.work(JOBS.applyRun, instrument(log, JOBS.applyRun, async (payload) => {
    await applyHandler(payload);
    const auto = await autoAnswerPending(db, payload.applicationId);
    if (auto.resumed) await queue.enqueue(JOBS.applyRun, { applicationId: payload.applicationId, trigger: payload.trigger }, { delaySeconds: 1 });
    const after = await loadApplication(db, payload.applicationId);
    return { status: after?.status ?? "missing", autoAnswered: auto.answered, resumed: auto.resumed };
  }));

  // inbox.receive: a stored inbound message: settle ambiguous ones with the small model, link, record outcomes, forward
  // (stub until an outbound provider is configured). A waiting apply.run is woken through awaitVerification.
  const forwarder = createStubForwarder((line) => log.info("inbox.forward", { line }));
  await queue.work(JOBS.inboxReceive, instrument(log, JOBS.inboxReceive, async ({ messageId }) => handleInboxReceive(db, messageId, { model: smallModel, forwarder })));

  return { enqueueDueBoards, enqueueValidations, flushMatchBatch: () => batcher.flush(), sweepJobs, findLogoDomains,
    stopSweep: async () => { sweepAbort.abort(); await sweeping; },
  };
}
