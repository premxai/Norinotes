import type { JobName, Payload, PayloadInput } from "./jobs.js";

export type EnqueueOptions = {
  /** Wait this long before the job may run. */
  delaySeconds?: number;
  /** Higher runs first. */
  priority?: number;
  /** With dedupeSeconds: a second enqueue with the same key inside the window is dropped (enqueue returns null). */
  dedupeKey?: string;
  dedupeSeconds?: number;
  /** Override the queue's retry defaults for this job. */
  retryLimit?: number;
  retryDelaySeconds?: number;
};

export type WorkOptions = {
  /** Jobs of this queue run at once in this process. Default: QUEUE_CONFIG[name].concurrency. */
  concurrency?: number;
};

/** Passed to a handler next to the payload. */
export type JobContext = {
  id: string;
  /** 1 on the first try. */
  attempt: number;
};

/** Throw to retry. Resolve to complete. */
export type Handler<N extends JobName> = (payload: Payload<N>, ctx: JobContext) => Promise<void> | void;

export type QueueKind = "memory" | "pgboss";

/** Same behaviour on both adapters. */
export interface QueueAdapter {
  readonly kind: QueueKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Returns the job id, or null when dropped by dedupe. */
  enqueue<N extends JobName>(name: N, payload: PayloadInput<N>, opts?: EnqueueOptions): Promise<string | null>;
  work<N extends JobName>(name: N, handler: Handler<N>, opts?: WorkOptions): Promise<void>;
  /** Enqueue `payload` on a cron schedule (5 fields, UTC). Calling again with the same name replaces the schedule. */
  schedule<N extends JobName>(name: N, cron: string, payload: PayloadInput<N>): Promise<void>;
}

/** What to start the queue on. A string is a Postgres connection string. */
export type QueueTarget = string | { connectionString?: string; adapter?: QueueKind };
