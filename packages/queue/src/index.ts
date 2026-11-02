import { MemoryQueue } from "./memory.js";
import { PgBossQueue } from "./pgboss.js";
import type { Handler, EnqueueOptions, QueueAdapter, QueueTarget, WorkOptions } from "./types.js";
import type { JobName, PayloadInput } from "./jobs.js";

export * from "./jobs.js";
export * from "./types.js";
export { MemoryQueue } from "./memory.js";
export type { MemoryStats } from "./memory.js";
export type { BossLike } from "./pgboss.js";
export { PgBossQueue } from "./pgboss.js";
export { cronMatches, parseCron } from "./cron.js";

/**
 * Builds an adapter without starting it or making it the shared one. Postgres (pg-boss) when a connection string is
 * given or DATABASE_URL is set, otherwise the in-memory adapter.
 */
export function createQueue(target?: QueueTarget): QueueAdapter {
  const t = typeof target === "string" ? { connectionString: target } : (target ?? {});
  const connectionString = t.connectionString ?? process.env.DATABASE_URL ?? undefined;
  if (t.adapter === "memory" || !connectionString) return new MemoryQueue();
  return new PgBossQueue(connectionString);
}

let active: QueueAdapter | null = null;

/** Starts the shared queue (see createQueue for how the adapter is chosen) and returns it. Calling it twice returns the running one. */
export async function startQueue(target?: QueueTarget): Promise<QueueAdapter> {
  if (active) return active;
  const q = createQueue(target);
  await q.start();
  active = q;
  return q;
}

export async function stopQueue(): Promise<void> {
  const q = active;
  active = null;
  if (q) await q.stop();
}

/** The shared queue; throws if startQueue() has not run. */
export function getQueue(): QueueAdapter {
  if (!active) throw new Error("Queue is not started. Call startQueue() first.");
  return active;
}

export function enqueue<N extends JobName>(name: N, payload: PayloadInput<N>, opts?: EnqueueOptions): Promise<string | null> {
  return getQueue().enqueue(name, payload, opts);
}

export function work<N extends JobName>(name: N, handler: Handler<N>, opts?: WorkOptions): Promise<void> {
  return getQueue().work(name, handler, opts);
}

export function schedule<N extends JobName>(name: N, cron: string, payload: PayloadInput<N>): Promise<void> {
  return getQueue().schedule(name, cron, payload);
}
