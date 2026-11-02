import { z } from "zod";

/** Every queue Norinote runs, from ARCHITECTURE.md. The values are the pg-boss queue names. */
export const JOBS = {
  ingestPollBoard: "ingest.poll-board",
  understandJob: "understand.job",
  matchNewJobs: "match.new-jobs",
  matchUser: "match.user",
  prepareApplication: "prepare.application",
  applyRun: "apply.run",
  inboxReceive: "inbox.receive",
} as const;

export type JobKey = keyof typeof JOBS;
export type JobName = (typeof JOBS)[JobKey];

const id = z.string().min(1);

/** Payload of each queue. Validated on enqueue and again before a handler runs. */
export const payloadSchemas = {
  /** Fetch one board, upsert jobs, close missing ones, enqueue understand.job for new jobs. */
  "ingest.poll-board": z.object({ companyId: id }),
  /** Extract the job spec with the small model, write the embedding. */
  "understand.job": z.object({ jobId: id }),
  /** Find users whose lanes and embeddings fit these new jobs. */
  "match.new-jobs": z.object({ jobIds: z.array(id).min(1) }),
  /** Rebuild one user's shortlist from the stored index. */
  "match.user": z.object({ userId: id, reason: z.enum(["profile", "graph", "lanes", "manual"]).default("manual") }),
  /** Tailor the resume, draft answers, mark the application prepared. */
  "prepare.application": z.object({ applicationId: id }),
  /** Fill and submit. A user click counts as approval; autopilot runs inside the daily cap. */
  "apply.run": z.object({ applicationId: id, trigger: z.enum(["click", "autopilot"]) }),
  /** An inbound email was stored; parse it and wake a waiting apply.run. */
  "inbox.receive": z.object({ messageId: id }),
} satisfies Record<JobName, z.ZodType>;

/** What a caller passes to enqueue (defaults not yet applied). */
export type PayloadInput<N extends JobName> = z.input<(typeof payloadSchemas)[N]>;
/** What a handler receives (defaults applied). */
export type Payload<N extends JobName> = z.output<(typeof payloadSchemas)[N]>;

/** Defaults per queue. Workers are idempotent, so every queue retries with backoff. */
export type QueueConfig = {
  retryLimit: number;
  retryDelaySeconds: number;
  /** A job still active after this long is considered lost and retried. */
  expireSeconds: number;
  /** Default parallelism of work() on this queue. */
  concurrency: number;
};

export const QUEUE_CONFIG: Record<JobName, QueueConfig> = {
  "ingest.poll-board": { retryLimit: 2, retryDelaySeconds: 60, expireSeconds: 10 * 60, concurrency: 4 },
  "understand.job": { retryLimit: 3, retryDelaySeconds: 30, expireSeconds: 5 * 60, concurrency: 8 },
  "match.new-jobs": { retryLimit: 3, retryDelaySeconds: 30, expireSeconds: 10 * 60, concurrency: 2 },
  "match.user": { retryLimit: 3, retryDelaySeconds: 30, expireSeconds: 10 * 60, concurrency: 2 },
  "prepare.application": { retryLimit: 3, retryDelaySeconds: 30, expireSeconds: 5 * 60, concurrency: 4 },
  // Applying drives a real browser and can wait for a verification email, so it gets the longest lease and few retries.
  "apply.run": { retryLimit: 1, retryDelaySeconds: 120, expireSeconds: 20 * 60, concurrency: 3 },
  "inbox.receive": { retryLimit: 5, retryDelaySeconds: 10, expireSeconds: 2 * 60, concurrency: 4 },
};

export function isJobName(name: string): name is JobName {
  return Object.prototype.hasOwnProperty.call(payloadSchemas, name);
}
