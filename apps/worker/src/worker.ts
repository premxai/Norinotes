import path from "node:path";
import { connect, migrate, type Db, type DbHandle } from "@norinote/db";
import { createBrowserPool, type ApplyDeps, type BrowserPool, type Preparer } from "@norinote/apply";
import { setAiLogger } from "@norinote/ai";
import { seedCompanies } from "@norinote/ingest";
import { createCodeWaiter } from "@norinote/inbox";
import { createQueue, type QueueAdapter } from "@norinote/queue";
import { closeSharedBrowser } from "@norinote/tailor";
import { loadConfig, type WorkerConfig } from "./config.js";
import { registerConsumers, type Consumers } from "./consumers.js";
import { createLogger, type Logger } from "./log.js";
import { createPreparer } from "./preparer.js";

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

  const apply: ApplyDeps = {
    pool,
    preparer: opts.preparer ?? createPreparer(db, { artifactsDir: config.artifactsDir }),
    codes: createCodeWaiter(db),
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

  log.info("worker.started", { queue: queue.kind, database: handle ? handle.kind : "injected", poolSize: config.browserPoolSize });

  let stopped: Promise<void> | null = null;
  const stop = () => (stopped ??= (async () => {
    if (timer) clearInterval(timer);
    await consumers.flushMatchBatch().catch(() => {});
    await queue.stop();
    if (ownsPool) await pool.close().catch(() => {});
    await closeSharedBrowser().catch(() => {});
    if (handle) await handle.close();
    log.info("worker.stopped");
  })());

  return { db, queue, consumers, stop };
}
