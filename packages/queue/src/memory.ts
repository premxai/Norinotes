import { randomUUID } from "node:crypto";
import { cronMatches, parseCron, type ParsedCron } from "./cron.js";
import { QUEUE_CONFIG, isJobName, payloadSchemas, type JobName } from "./jobs.js";
import type { EnqueueOptions, Handler, JobContext, QueueAdapter, WorkOptions } from "./types.js";

type MemJob = {
  id: string;
  name: JobName;
  data: unknown;
  state: "queued" | "active" | "completed" | "failed";
  /** Completed attempts so far. */
  attempts: number;
  retryLimit: number;
  retryDelayMs: number;
  priority: number;
  startAfter: number;
  seq: number;
  error?: string;
};

type Registration = { handler: Handler<JobName>; concurrency: number; active: number };

export type MemoryStats = { queued: number; active: number; completed: number; failed: number };

/**
 * In-process queue with the same behaviour as the pg-boss adapter: retries with exponential backoff, delayed jobs,
 * priority, dedupe windows, per-queue concurrency, cron schedules. For unit tests and local runs without Postgres.
 * Nothing survives a restart.
 */
export class MemoryQueue implements QueueAdapter {
  readonly kind = "memory" as const;
  private jobs: MemJob[] = [];
  private workers = new Map<JobName, Registration>();
  private dedupe = new Map<string, number>();
  private schedules = new Map<JobName, { cron: ParsedCron; payload: unknown; lastMinute: number }>();
  private wakeups = new Map<JobName, ReturnType<typeof setTimeout>>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private waiters: (() => void)[] = [];
  private started = false;
  private seq = 0;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Check schedules every 15 s; each cron minute fires once.
    this.scheduleTimer = setInterval(() => this.tickSchedules(), 15_000);
    this.scheduleTimer.unref();
    for (const name of this.workers.keys()) this.pump(name);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
    for (const t of this.wakeups.values()) clearTimeout(t);
    this.wakeups.clear();
    // Let running handlers finish, as pg-boss does on a graceful stop.
    await this.waitFor(() => !this.jobs.some((j) => j.state === "active"));
  }

  async enqueue<N extends JobName>(name: N, payload: unknown, opts: EnqueueOptions = {}): Promise<string | null> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    const data = payloadSchemas[name].parse(payload);
    const now = Date.now();
    if (opts.dedupeKey && opts.dedupeSeconds) {
      const key = `${name}:${opts.dedupeKey}`;
      const until = this.dedupe.get(key);
      if (until !== undefined && until > now) return null;
      this.dedupe.set(key, now + opts.dedupeSeconds * 1000);
    }
    const cfg = QUEUE_CONFIG[name];
    const job: MemJob = {
      id: randomUUID(), name, data, state: "queued", attempts: 0,
      retryLimit: opts.retryLimit ?? cfg.retryLimit,
      retryDelayMs: (opts.retryDelaySeconds ?? cfg.retryDelaySeconds) * 1000,
      priority: opts.priority ?? 0,
      startAfter: now + (opts.delaySeconds ?? 0) * 1000,
      seq: this.seq++,
    };
    this.jobs.push(job);
    this.pump(name);
    return job.id;
  }

  async work<N extends JobName>(name: N, handler: Handler<N>, opts: WorkOptions = {}): Promise<void> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    const concurrency = Math.max(1, opts.concurrency ?? QUEUE_CONFIG[name].concurrency);
    this.workers.set(name, { handler: handler as unknown as Handler<JobName>, concurrency, active: 0 });
    this.pump(name);
  }

  async schedule<N extends JobName>(name: N, cron: string, payload: unknown): Promise<void> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    this.schedules.set(name, { cron: parseCron(cron), payload: payloadSchemas[name].parse(payload), lastMinute: -1 });
  }

  /** Enqueues every schedule whose cron matches `now` (once per minute). Runs on a timer; tests call it with a chosen time. */
  async tickSchedules(now: Date = new Date()): Promise<void> {
    const minute = Math.floor(now.getTime() / 60_000);
    for (const [name, s] of this.schedules) {
      if (s.lastMinute === minute || !cronMatches(s.cron, now)) continue;
      s.lastMinute = minute;
      await this.enqueue(name, s.payload);
    }
  }

  /** Counts per state for one queue (or all). */
  stats(name?: JobName): MemoryStats {
    const out: MemoryStats = { queued: 0, active: 0, completed: 0, failed: 0 };
    for (const j of this.jobs) if (!name || j.name === name) out[j.state]++;
    return out;
  }

  /** Resolves when no job is queued (including delayed and retrying) or active on a queue that has a worker. Tests only. */
  async drain(): Promise<void> {
    await this.waitFor(() => !this.jobs.some((j) => (j.state === "active" || j.state === "queued") && this.workers.has(j.name)));
  }

  /** Error messages of jobs that ran out of retries. */
  failures(name?: JobName): { id: string; name: JobName; error: string }[] {
    return this.jobs.filter((j) => j.state === "failed" && (!name || j.name === name)).map((j) => ({ id: j.id, name: j.name, error: j.error ?? "" }));
  }

  private waitFor(done: () => boolean): Promise<void> {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => { if (done()) resolve(); else this.waiters.push(check); };
      this.waiters.push(check);
    });
  }

  private notify() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Starts as many ready jobs of this queue as its concurrency allows; sets a timer for the next delayed one. */
  private pump(name: JobName): void {
    const reg = this.workers.get(name);
    if (!reg || !this.started) { this.notify(); return; }
    while (reg.active < reg.concurrency) {
      const now = Date.now();
      const ready = this.jobs
        .filter((j) => j.name === name && j.state === "queued" && j.startAfter <= now)
        .sort((a, b) => b.priority - a.priority || a.seq - b.seq)[0];
      if (!ready) break;
      ready.state = "active";
      reg.active++;
      void this.run(ready, reg);
    }
    const next = this.jobs.filter((j) => j.name === name && j.state === "queued").map((j) => j.startAfter).sort((a, b) => a - b)[0];
    const old = this.wakeups.get(name);
    if (old) clearTimeout(old);
    this.wakeups.delete(name);
    if (next !== undefined && next > Date.now()) {
      const t = setTimeout(() => this.pump(name), next - Date.now());
      t.unref();
      this.wakeups.set(name, t);
    }
    this.notify();
  }

  private async run(job: MemJob, reg: Registration): Promise<void> {
    const ctx: JobContext = { id: job.id, attempt: job.attempts + 1 };
    try {
      await reg.handler(job.data as never, ctx);
      job.state = "completed";
    } catch (err) {
      job.attempts++;
      job.error = err instanceof Error ? err.message : String(err);
      if (job.attempts <= job.retryLimit) {
        job.state = "queued";
        // Exponential backoff: delay, 2x, 4x, ...
        job.startAfter = Date.now() + job.retryDelayMs * 2 ** (job.attempts - 1);
      } else {
        job.state = "failed";
      }
    } finally {
      reg.active--;
      this.pump(job.name);
    }
  }
}
