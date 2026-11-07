/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applications, companies, jobs, shortlist, type Db } from "@norinote/db";
import { createTestDb } from "@norinote/db/testing";
import { MemoryQueue, type JobName } from "@norinote/queue";
import { createApp } from "./app.js";
import { loadConfig, type ApiConfig } from "./config.js";
import type { Mail } from "./mailer.js";
import type { ApiDeps } from "./types.js";

export type Called = { name: JobName; payload: Record<string, unknown> };
export type Reply<T = any> = { status: number; json: T; headers: Headers };
type Opts = { body?: unknown; cookie?: string; headers?: Record<string, string>; form?: FormData };

/** The API on an in-memory PGlite, a MemoryQueue that records what was enqueued, and a mailer that records mail. */
export async function makeApi(over: { config?: Partial<ApiConfig>; addJob?: ApiDeps["addJob"]; now?: () => Date; telegram?: ApiDeps["telegram"]; files?: ApiDeps["files"]; gmail?: ApiDeps["gmail"]; previewFetch?: ApiDeps["previewFetch"] } = {}) {
  const t = await createTestDb();
  const queue = new MemoryQueue();
  const queued: Called[] = [];
  const mails: Mail[] = [];
  const artifactsDir = mkdtempSync(path.join(os.tmpdir(), "norinote-api-test-"));
  const config: ApiConfig = { ...{ ...loadConfig({ NODE_ENV: "test", ARTIFACTS_DIR: artifactsDir, INBOUND_WEBHOOK_SECRET: "hook-secret" }), trustProxy: true }, ...over.config };
  const app = createApp({
    db: t.db,
    config,
    enqueue: async (name, payload, opts) => {
      const id = await queue.enqueue(name, payload, opts);
      if (id) queued.push({ name, payload: payload as Record<string, unknown> });
      return id;
    },
    mailer: { send: async (m) => { mails.push(m); } },
    log: () => undefined,
    files: over.files ?? null,
    gmail: over.gmail ?? null,
    ...(over.previewFetch ? { previewFetch: over.previewFetch } : {}),
    ...(over.addJob ? { addJob: over.addJob } : {}),
    ...(over.now ? { now: over.now } : {}),
    ...(over.telegram ? { telegram: over.telegram } : {}),
  });

  async function call<T = any>(method: string, url: string, o: Opts = {}): Promise<Reply<T>> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.cookie) headers.cookie = o.cookie;
    let body: string | FormData | undefined;
    if (o.form) body = o.form;
    else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
    const res = await app.request(url, { method, headers, body });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json: json as T, headers: res.headers };
  }

  /** Creates an account and returns the session cookie to send with later calls. */
  async function signup(email = "ada@example.com", password = "correct horse battery", name = "Ada Lovelace") {
    ipSeq += 1;
    const res = await call("POST", "/api/auth/signup", { body: { email, password, name }, headers: { "x-forwarded-for": `10.1.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` } });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.json)}`);
    const cookie = cookieOf(res.headers);
    if (!cookie) throw new Error("no session cookie");
    return { cookie, user: res.json.user as { id: string; email: string; name: string | null }, password };
  }

  return {
    app, db: t.db as Db, config, queued, mails, artifactsDir, call, signup,
    queuedOf: (name: JobName) => queued.filter((q) => q.name === name),
    async close() {
      await queue.stop();
      await t.close();
      rmSync(artifactsDir, { recursive: true, force: true });
    },
  };
}
export type Api = Awaited<ReturnType<typeof makeApi>>;

/** `name=value` of the session cookie from a response, ready for a Cookie header. */
export function cookieOf(headers: Headers, name = "norinote_session"): string | null {
  for (const line of headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) {
      const pair = line.split(";")[0] ?? "";
      return pair === `${name}=` ? null : pair;
    }
  }
  return null;
}

let seq = 0;
let ipSeq = 0;
/**
 * A company and one open job posted `hoursAgo` hours ago (default 30: inside the 72-hour window, outside "today"). The
 * board was first read 30 days ago, so the job also counts when a test clears its posted date.
 */
export async function seedJob(db: Db, o: { title?: string; company?: string; location?: string | null; remote?: boolean; hoursAgo?: number; description?: string; closed?: boolean } = {}) {
  seq += 1;
  const company = o.company ?? `Acme ${seq}`;
  const [co] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `tok-${seq}-${Math.random().toString(36).slice(2, 8)}`, name: company, firstReadAt: new Date(Date.now() - 30 * 86_400_000) }).returning();
  const posted = new Date(Date.now() - (o.hoursAgo ?? 30) * 3_600_000);
  const [job] = await db.insert(jobs).values({
    companyId: co!.id, atsType: "greenhouse", externalId: `ext-${seq}-${Math.random().toString(36).slice(2, 8)}`, title: o.title ?? "Software Engineer",
    location: o.location === undefined ? "Remote - US" : o.location, remote: o.remote ?? true, descriptionText: o.description ?? "Build things with TypeScript.",
    applyUrl: `https://boards.greenhouse.io/${co!.atsToken}/jobs/${seq}`, postedAt: posted, firstSeenAt: posted, lastSeenAt: new Date(), closedAt: o.closed ? new Date() : null,
    dedupeKey: `${company}|${o.title ?? "se"}|${o.location ?? ""}|${seq}`.toLowerCase(),
  }).returning();
  return { job: job!, company: co! };
}

export async function seedShortlist(db: Db, userId: string, jobId: string, fit: number, extra: Partial<typeof shortlist.$inferInsert> = {}) {
  const [row] = await db.insert(shortlist).values({ userId, jobId, fit, fitMap: [], reasons: [`Fits at ${Math.round(fit * 100)}%`], status: "new", ...extra }).returning();
  return row!;
}

export async function seedApplication(db: Db, userId: string, jobId: string, extra: Partial<typeof applications.$inferInsert> = {}) {
  const [row] = await db.insert(applications).values({ userId, jobId, status: "prepared", ...extra }).returning();
  return row!;
}

export const RESUME = `Ada Lovelace
ada@example.com | +1 415 555 0100 | San Francisco, CA
linkedin.com/in/adalovelace | github.com/ada

EXPERIENCE
Senior Software Engineer, Analytical Engines Inc. | Jan 2020 - Present
- Built a TypeScript and React dashboard used by 4,000 customers, cutting support tickets by 35%.
- Led a team of 5 engineers migrating PostgreSQL workloads to AWS.
Software Engineer, Difference Co | Jun 2016 - Dec 2019
- Wrote Python services that processed 2 million events per day.

EDUCATION
BSc Mathematics, University of London, 2016

SKILLS
Languages: TypeScript, Python, SQL
Tools: React, PostgreSQL, AWS, Docker
`;
