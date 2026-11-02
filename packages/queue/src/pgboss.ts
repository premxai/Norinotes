import { PgBoss, type SendOptions } from "pg-boss";
import { QUEUE_CONFIG, JOBS, isJobName, payloadSchemas, type JobName } from "./jobs.js";
import type { EnqueueOptions, Handler, QueueAdapter, WorkOptions } from "./types.js";

/** The slice of PgBoss this adapter uses; lets tests inject a stand-in. */
export type BossLike = Pick<PgBoss, "start" | "stop" | "createQueue" | "send" | "work" | "schedule" | "on">;

export class PgBossQueue implements QueueAdapter {
  readonly kind = "pgboss" as const;
  private boss: BossLike | null = null;

  constructor(
    private readonly connectionString: string,
    private readonly makeBoss: (connectionString: string) => BossLike = (cs) => new PgBoss({ connectionString: cs, application_name: "norinote-queue" } as ConstructorParameters<typeof PgBoss>[0]),
  ) {}

  private get b(): BossLike {
    if (!this.boss) throw new Error("Queue is not started. Call startQueue() first.");
    return this.boss;
  }

  async start(): Promise<void> {
    if (this.boss) return;
    const boss = this.makeBoss(this.connectionString);
    boss.on("error", (err) => console.warn(`[queue] ${err.message}`));
    await boss.start();
    // pg-boss needs every queue created before send or work; createQueue is idempotent.
    for (const name of Object.values(JOBS)) {
      const cfg = QUEUE_CONFIG[name];
      await boss.createQueue(name, {
        retryLimit: cfg.retryLimit, retryDelay: cfg.retryDelaySeconds, retryBackoff: true, expireInSeconds: cfg.expireSeconds,
      });
    }
    this.boss = boss;
  }

  async stop(): Promise<void> {
    const boss = this.boss;
    this.boss = null;
    if (boss) await boss.stop({ graceful: true, timeout: 30_000 });
  }

  async enqueue<N extends JobName>(name: N, payload: unknown, opts: EnqueueOptions = {}): Promise<string | null> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    const data = payloadSchemas[name].parse(payload);
    const o: SendOptions = {};
    if (opts.delaySeconds !== undefined) o.startAfter = opts.delaySeconds;
    if (opts.priority !== undefined) o.priority = opts.priority;
    if (opts.retryLimit !== undefined) o.retryLimit = opts.retryLimit;
    if (opts.retryDelaySeconds !== undefined) o.retryDelay = opts.retryDelaySeconds;
    if (opts.dedupeKey && opts.dedupeSeconds) { o.singletonKey = opts.dedupeKey; o.singletonSeconds = opts.dedupeSeconds; }
    return this.b.send(name, data as object, o);
  }

  async work<N extends JobName>(name: N, handler: Handler<N>, opts: WorkOptions = {}): Promise<void> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    const concurrency = Math.max(1, opts.concurrency ?? QUEUE_CONFIG[name].concurrency);
    // One job per handler call; `concurrency` handlers run at once.
    await this.b.work(name, { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 2 }, async (jobs) => {
      for (const job of jobs) {
        const payload = payloadSchemas[name].parse(job.data);
        await handler(payload as never, { id: job.id, attempt: job.retryCount + 1 });
      }
    });
  }

  async schedule<N extends JobName>(name: N, cron: string, payload: unknown): Promise<void> {
    if (!isJobName(name)) throw new Error(`Unknown queue "${name}"`);
    await this.b.schedule(name, cron, payloadSchemas[name].parse(payload) as object, { tz: "UTC" });
  }
}
