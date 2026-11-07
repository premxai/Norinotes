/** Worker settings read from the environment. Everything has a default, so `npm run dev:worker` works with no setup. */
export type WorkerConfig = {
  /** Postgres connection string. Unset = embedded PGlite and an in-memory queue. */
  databaseUrl: string | undefined;
  /** Resend key and sender (MAIL_FROM, on a domain verified in Resend) for forwarding inbox mail. Both unset = not sent. */
  resendApiKey: string | undefined;
  /** Composio project key: while a run waits for an emailed code, a connected Gmail is read for it. Unset = not read. */
  composioApiKey: string | undefined;
  mailFrom: string | undefined;
  /** Parallel browser pages for apply.run (clamped 1 to 4 by the pool). Default 3. */
  browserPoolSize: number;
  /** How often the scheduler looks for boards that are due, in ms. Default 3 minutes. */
  scheduleEveryMs: number;
  /** Live boards (active, probation, weekly rechecks) enqueued per scheduler run. Default 100. */
  boardsPerRun: number;
  /** New candidates enqueued per scheduler run; each one's first poll validates it. Default 50. */
  validatePerRun: number;
  /** Boards of one host group (a Workday cluster, a job system's feed host) enqueued per run. Default 8. */
  hostBoardsPerRun: number;
  /** Polls at once against one host group when the job system does not say otherwise (Workable is always 2). Default 4. */
  pollsPerHost: number;
  /** ingest.poll-board handlers at once, across all hosts. Default 16. */
  pollConcurrency: number;
  /** understand.job handlers at once (one model call each), so a backlog drains steadily instead of in a burst. Default 4. */
  understandConcurrency: number;
  /** How often running "Apply for me" batches are checked for their next application, in ms. Default 30 s; 0 = off. */
  batchDrainMs: number;
  /** How many jobs a person's daily list (Today) holds at most. Default 50. */
  shortlistSize: number;
  /** How long a run waits on the page for an emailed code (from the person's mail filter, or typed in Norinote). Default 8 min. */
  codeWaitMs: number;
  /** Quiet time before understood jobs are matched as one batch, in ms. Default 5 s. */
  matchBatchMs: number;
  /** One small-model sentence for the best matches of a rebuilt shortlist. Default on. */
  explainTop: number;
  /** How often the storage sweep trims jobs that aged out and nobody refers to, in ms. 0 = off. Default 60 minutes. */
  jobSweepEveryMs: number;
  /** Jobs per sweep batch (one short transaction each). Default 500. */
  jobSweepBatch: number;
  /** How often visible companies' postings are searched for their web domain (job card logos), in ms. 0 = off. Default 15 minutes. */
  logoDomainsEveryMs: number;
  /** Companies searched per run. Default 500. */
  logoDomainsBatch: number;
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
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    composioApiKey: env.COMPOSIO_API_KEY?.trim() || undefined,
    mailFrom: env.MAIL_FROM?.trim() || undefined,
    browserPoolSize: int(env.BROWSER_POOL_SIZE, 3, 1),
    scheduleEveryMs: int(env.SCHEDULE_EVERY_MINUTES, 3, 1) * 60_000,
    boardsPerRun: int(env.BOARDS_PER_RUN, 100, 1),
    validatePerRun: int(env.VALIDATE_PER_RUN, 50, 0),
    hostBoardsPerRun: int(env.HOST_BOARDS_PER_RUN, 8, 1),
    pollsPerHost: int(env.POLLS_PER_HOST, 4, 1),
    pollConcurrency: int(env.POLL_CONCURRENCY, 16, 1),
    understandConcurrency: int(env.UNDERSTAND_CONCURRENCY, 4, 1),
    codeWaitMs: int(env.CODE_WAIT_MINUTES, 8, 1) * 60_000,
    shortlistSize: int(env.SHORTLIST_SIZE, 50, 1),
    batchDrainMs: int(env.BATCH_DRAIN_SECONDS, 30, 0) * 1000,
    matchBatchMs: int(env.MATCH_BATCH_MS, 5000),
    explainTop: int(env.MATCH_EXPLAIN_TOP, 3),
    jobSweepEveryMs: int(env.JOB_SWEEP_EVERY_MINUTES, 60) * 60_000,
    jobSweepBatch: int(env.JOB_SWEEP_BATCH, 500, 1),
    logoDomainsEveryMs: int(env.LOGO_DOMAINS_EVERY_MINUTES, 15) * 60_000,
    logoDomainsBatch: int(env.LOGO_DOMAINS_BATCH, 500, 1),
    artifactsDir: env.ARTIFACTS_DIR?.trim() || undefined,
  };
}
