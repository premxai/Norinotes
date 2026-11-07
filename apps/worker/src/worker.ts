import path from "node:path";
import { connect, migrate, type Db, type DbHandle } from "@norinote/db";
import { createBrowserPool, createLiveFrameSink, drainBatches, runSchedules, type ApplyDeps, type BrowserPool, type Preparer } from "@norinote/apply";
import { JOBS } from "@norinote/queue";
import { artifactsRoot, fileStoreFromEnv } from "@norinote/shared/files";
import { setAiLogger } from "@norinote/ai";
import { seedCompanies } from "@norinote/ingest";
import { awaitVerificationWithGmail, createComposioGmail, startInboxRetention } from "@norinote/inbox";
import { createQueue, type QueueAdapter } from "@norinote/queue";
import { closeSharedBrowser } from "@norinote/tailor";
import { loadConfig, type WorkerConfig } from "./config.js";
import { registerConsumers, type Consumers } from "./consumers.js";
import { createLogger, type Logger } from "./log.js";
import { createPreparer } from "./preparer.js";
import { startTelegram } from "./telegram.js";

export type WorkerOptions = {
  config?: WorkerConfig;
  log?: Logger;
  /** Use this database (already migrated); the worker will not connect or close it. Default: connect to DATABASE_URL or PGlite, then migrate. */
  db?: Db;
  /** Use this queue. Default: pg-boss when DATABASE_URL is set, memory otherwise. */
  queue?: QueueAdapter;
  /** Replaces the global fetch for board polling (tests). */
  fetch?: typeof fetch;
  now?: () => Date;
  /** Replaces the warm browser pool (tests). The worker does not close an injected pool. */
  pool?: BrowserPool;
  /** Replaces the tailor + answers Preparer (tests). */
  preparer?: Preparer;
  /** Other apply settings (drivers, loadInputs, codeTimeoutMs ...) for tests. */
  applyOverrides?: Partial<ApplyDeps>;
  /** Default true. Tests turn it off to control polling themselves. */
  scheduler?: boolean;
  /** Default true. Load the board registry into `companies` on start. */
  seed?: boolean;
  /** Default true. Launch the browser at start so the first application does not wait for it. */
  warmUp?: boolean;
};

export type Worker = {
  readonly db: Db;
  readonly queue: QueueAdapter;
  readonly consumers: Consumers;
  /** Stops the timer, flushes pending match batches, lets running jobs finish, closes the pool, the queue and the database. */
  stop(): Promise<void>;
};

/** Connects, migrates, seeds, starts the queue and registers every consumer. Returns once the worker is running. */
export async function startWorker(opts: WorkerOptions = {}): Promise<Worker> {
  const config = opts.config ?? loadConfig();
  const log = opts.log ?? createLogger();
  const now = opts.now ?? (() => new Date());
  // One line per AI cooldown (bad key, outage, rate limit) in the worker's own log format. Never the key.
  setAiLogger((event, fields) => log.warn(event, fields));

  let handle: DbHandle | null = null;
  let db = opts.db;
  if (!db) {
    handle = await connect({ url: config.databaseUrl, pgliteDir: process.env.PGLITE_DIR || path.resolve("data/pglite") });
    await migrate(handle);
    db = handle.db;
  }

  const queue = opts.queue ?? createQueue(config.databaseUrl ? { connectionString: config.databaseUrl } : { adapter: "memory" });
  const pool = opts.pool ?? createBrowserPool({ size: config.browserPoolSize, ...(config.artifactsDir ? { artifactsDir: config.artifactsDir } : {}) });
  const ownsPool = !opts.pool;

  const gmail = config.composioApiKey ? createComposioGmail({ apiKey: config.composioApiKey }) : null;
  const apply: ApplyDeps = {
    pool,
    preparer: opts.preparer ?? createPreparer(db, { artifactsDir: config.artifactsDir, pool }),
    // A code reaches the waiting run from the person's connected Gmail (Composio, read only during the wait), their mail
    // filter, or typed in Norinote (POST /api/applications/:id/code). A link, or no code in time, parks the application.
    verification: (args) => awaitVerificationWithGmail({ ...args, db, gmail, log: (event, data) => log.info(event, data) }),
    codeTimeoutMs: config.codeWaitMs,
    // "Watch Nori apply": the latest picture of the employer's page, for the owner's dashboard (GET /api/applications/:id/live).
    liveFrames: createLiveFrameSink({ root: config.artifactsDir ?? artifactsRoot(), store: fileStoreFromEnv(), log: (line) => log.info("apply.live", { line }) }),
    now,
    ...opts.applyOverrides,
  };

  if (opts.seed !== false) {
    const seeded = await seedCompanies(db);
    log.info("seed", { inserted: seeded.inserted, markedBlocked: seeded.markedBlocked });
  }

  // pg-boss needs to be running before queues can be worked.
  await queue.start();
  const consumers = await registerConsumers({ db, queue, log, config, apply, fetch: opts.fetch, now });

  if (opts.warmUp !== false && ownsPool) {
    // No Chromium installed (or no display libraries) must not stop ingest and matching from running.
    await pool.warmUp().catch((err) => log.warn("pool.warmup_failed", { error: err instanceof Error ? err.message : String(err) }));
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (opts.scheduler !== false) {
    const tick = () => consumers.enqueueDueBoards().catch((err) => log.error("scheduler", { ok: false, error: err instanceof Error ? err.message : String(err) }));
    void tick();
    timer = setInterval(tick, config.scheduleEveryMs);
    timer.unref();
  }

  // Lean job storage: trim jobs that aged out of the 72-hour window and nobody refers to, every JOB_SWEEP_EVERY_MINUTES (60).
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.scheduler !== false && config.jobSweepEveryMs > 0) {
    void consumers.sweepJobs();
    sweepTimer = setInterval(() => { void consumers.sweepJobs(); }, config.jobSweepEveryMs);
    sweepTimer.unref();
  }

  // Job card logos: find visible companies' web domains in their own postings, every LOGO_DOMAINS_EVERY_MINUTES (15).
  let logoTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.scheduler !== false && config.logoDomainsEveryMs > 0) {
    void consumers.findLogoDomains();
    logoTimer = setInterval(() => { void consumers.findLogoDomains(); }, config.logoDomainsEveryMs);
    logoTimer.unref();
  }

  // "Apply for me" batches: start the next application of each running batch when its spacing and the daily limit allow,
  // every BATCH_DRAIN_SECONDS (30). The batch is the person's approval; apply.run does the rest.
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.scheduler !== false && config.batchDrainMs > 0) {
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        // Schedules first: a due one starts a batch of Recommended jobs, prepared now and sent by the drain below.
        for (const run of await runSchedules(db, { now: now(), atsTypes: config.batchAts })) {
          for (const applicationId of run.created) await queue.enqueue(JOBS.prepareApplication, { applicationId });
          log.info("schedule.ran", { userId: run.userId, batchId: run.batchId, created: run.created.length, ...(run.reason ? { reason: run.reason } : {}) });
        }
        for (const step of await drainBatches(db, { now: now() })) {
          await queue.enqueue(JOBS.applyRun, { applicationId: step.applicationId, trigger: "autopilot" });
          log.info("batch.started", { batchId: step.batchId, applicationId: step.applicationId });
        }
      } catch (err) {
        log.warn("batch.drain_failed", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        draining = false;
      }
    };
    drainTimer = setInterval(() => { void drain(); }, config.batchDrainMs);
    drainTimer.unref();
  }

  // Inbox retention: delete messages past INBOX_RETENTION_DAYS (default 90) or the user's own setting, every 6 hours.
  const stopRetention = opts.scheduler !== false ? startInboxRetention(db, { log: (event, fields) => log.info(event, fields) }) : () => undefined;
  // Telegram: daily shortlist, questions and events for linked chats (only with TELEGRAM_BOT_TOKEN). See docs/telegram.md.
  const stopTelegram = opts.scheduler !== false ? startTelegram(db, queue, log) : () => undefined;

  log.info("worker.started", { queue: queue.kind, database: handle ? handle.kind : "injected", poolSize: config.browserPoolSize });

  let stopped: Promise<void> | null = null;
  const stop = () => (stopped ??= (async () => {
    if (timer) clearInterval(timer);
    if (sweepTimer) clearInterval(sweepTimer);
    if (logoTimer) clearInterval(logoTimer);
    if (drainTimer) clearInterval(drainTimer);
    await consumers.stopSweep();
    stopRetention();
    stopTelegram();
    await consumers.flushMatchBatch().catch(() => {});
    await queue.stop();
    if (ownsPool) await pool.close().catch(() => {});
    await closeSharedBrowser().catch(() => {});
    if (handle) await handle.close();
    log.info("worker.stopped");
  })());

  return { db, queue, consumers, stop };
}
