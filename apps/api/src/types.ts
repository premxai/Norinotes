import type { Context } from "hono";
import type { Db } from "@norinote/db";
import type { addJobByUrl } from "@norinote/ingest";
import type { EnqueueOptions, JobName, PayloadInput } from "@norinote/queue";
import type { ApiConfig } from "./config.js";
import { HttpError } from "./http.js";
import type { Mailer } from "./mailer.js";
import { enforce, type RateLimiter } from "./security.js";

export type EnqueueFn = <N extends JobName>(name: N, payload: PayloadInput<N>, opts?: EnqueueOptions) => Promise<string | null>;

/** What `createApp` needs. Tests pass PGlite and a recording queue; `index.ts` passes the real ones. */
export type ApiDeps = {
  db: Db;
  enqueue: EnqueueFn;
  config: ApiConfig;
  mailer?: Mailer;
  now?: () => Date;
  /** Replaces ingest.addJobByUrl (tests: no network). */
  addJob?: typeof addJobByUrl;
  log?: (line: string) => void;
  limiter?: RateLimiter;
};

/** `ApiDeps` with every default filled in; what route modules receive. */
export type Ctx = Required<Omit<ApiDeps, "limiter">> & { limiter: RateLimiter };

export type SessionUser = { id: string; email: string; emailVerifiedAt: Date | null; createdAt: Date };

export type AppEnv = { Variables: { user: SessionUser; sessionId: string } };
export type AppContext = Context<AppEnv>;

/** Queues a job and swallows failure: for follow-up work (rebuild a shortlist) that must not fail the user's request. */
export async function enqueueSoft<N extends JobName>(ctx: Ctx, name: N, payload: PayloadInput<N>, opts?: EnqueueOptions): Promise<string | null> {
  try {
    return await ctx.enqueue(name, payload, opts);
  } catch (err) {
    ctx.log(`[api] could not queue ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Queues a job the request depends on (an approved application must run): a failure is a 503, not silence. */
export async function enqueueRequired<N extends JobName>(ctx: Ctx, name: N, payload: PayloadInput<N>, opts?: EnqueueOptions): Promise<string | null> {
  try {
    return await ctx.enqueue(name, payload, opts);
  } catch (err) {
    ctx.log(`[api] could not queue ${name}: ${err instanceof Error ? err.message : String(err)}`);
    throw new HttpError(503, "Could not queue that right now. Try again in a moment.");
  }
}

/** Per-user rate limit (costly calls). */
export const limitUser = (ctx: Ctx, bucket: string, userId: string, max: number, windowMs: number, message: string) =>
  enforce(ctx.limiter, `${bucket}:${userId}`, max, windowMs, message);
