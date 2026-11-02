/** Worker settings read from the environment. Everything has a default, so `npm run dev:worker` works with no setup. */
export type WorkerConfig = {
  /** Postgres connection string. Unset = embedded PGlite and an in-memory queue. */
  databaseUrl: string | undefined;
  /** Parallel browser pages for apply.run (clamped 1 to 4 by the pool). Default 3. */
  browserPoolSize: number;
  /** How often the scheduler looks for boards that are due, in ms. Default 10 minutes. */
  scheduleEveryMs: number;
  /** Boards enqueued per scheduler run. Default 50. */
  boardsPerRun: number;
  /** Polls at once against one job system's feed host. Default 2. */
  pollsPerHost: number;
  /** understand.job handlers at once (one model call each), so a backlog drains steadily instead of in a burst. Default 4. */
  understandConcurrency: number;
  /** Quiet time before understood jobs are matched as one batch, in ms. Default 5 s. */
  matchBatchMs: number;
  /** One small-model sentence for the best matches of a rebuilt shortlist. Default on. */
  explainTop: number;
  /** Where screenshots and resumes go. Unset = the packages' own defaults. */
  artifactsDir: string | undefined;
};

const int = (v: string | undefined, fallback: number, min = 0): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return {
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    browserPoolSize: int(env.BROWSER_POOL_SIZE, 3, 1),
    scheduleEveryMs: int(env.SCHEDULE_EVERY_MINUTES, 10, 1) * 60_000,
    boardsPerRun: int(env.BOARDS_PER_RUN, 50, 1),
    pollsPerHost: int(env.POLLS_PER_HOST, 2, 1),
    understandConcurrency: int(env.UNDERSTAND_CONCURRENCY, 4, 1),
    matchBatchMs: int(env.MATCH_BATCH_MS, 5000),
    explainTop: int(env.MATCH_EXPLAIN_TOP, 3),
    artifactsDir: env.ARTIFACTS_DIR?.trim() || undefined,
  };
}
