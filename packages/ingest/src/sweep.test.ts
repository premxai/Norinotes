import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applications, companies, EMBEDDING_DIMENSIONS, eq, jobEmbeddings, jobSpecs, jobs, savedJobs, shortlist, users,
} from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { JobSpec } from "@norinote/shared";
import { sweepStaleJobs } from "./sweep.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(companies);
  await t.db.delete(users);
});

const NOW = new Date("2026-10-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let n = 0;

async function company(firstReadAt: Date | null = hoursAgo(24 * 30)): Promise<string> {
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `sweep-${n++}`, name: "Sweep Co", firstReadAt }).returning();
  return c!.id;
}

/** A job with text, a spec and an embedding, as an understood job has. */
async function job(companyId: string, postedAt: Date | null, opts: { firstSeenAt?: Date; text?: string } = {}): Promise<string> {
  const id = `sweep-job-${n++}`;
  const [j] = await t.db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: id, title: "Engineer", descriptionText: opts.text ?? "A long description.",
    applyUrl: `https://example.test/${id}`, dedupeKey: id, postedAt, firstSeenAt: opts.firstSeenAt ?? postedAt ?? hoursAgo(1),
  }).returning();
  await t.db.insert(jobSpecs).values({ jobId: j!.id, version: 1, spec: {} as JobSpec, model: "test" });
  await t.db.insert(jobEmbeddings).values({ jobId: j!.id, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.01), model: "test" });
  return j!.id;
}

async function user(): Promise<string> {
  const [u] = await t.db.insert(users).values({ email: `sweep${n++}@example.test`, passwordHash: "x" }).returning();
  return u!.id;
}

/** What each job still has: [text, spec, embedding]. */
async function state(id: string): Promise<[boolean, boolean, boolean]> {
  const [row] = await t.db.select({ text: jobs.descriptionText }).from(jobs).where(eq(jobs.id, id));
  if (!row) throw new Error("job row deleted");
  const specs = await t.db.select().from(jobSpecs).where(eq(jobSpecs.jobId, id));
  const vectors = await t.db.select().from(jobEmbeddings).where(eq(jobEmbeddings.jobId, id));
  return [row.text !== "", specs.length > 0, vectors.length > 0];
}

const FULL: [boolean, boolean, boolean] = [true, true, true];
const BARE: [boolean, boolean, boolean] = [false, false, false];

describe("sweepStaleJobs", () => {
  it("trims jobs out of the 72-hour window that nobody refers to, and keeps fresh and referenced ones whole", async () => {
    const co = await company();
    const firstRead = hoursAgo(24 * 30);
    const ids = {
      fresh: await job(co, hoursAgo(2)),
      stale: await job(co, hoursAgo(100)),
      undatedFirstRead: await job(co, null, { firstSeenAt: firstRead }),
      undatedLater: await job(co, null, { firstSeenAt: hoursAgo(10) }),
      insideGrace: await job(co, hoursAgo(75)),
      saved: await job(co, hoursAgo(100)),
      applied: await job(co, hoursAgo(100)),
      shortlisted: await job(co, hoursAgo(100)),
      dismissed: await job(co, hoursAgo(100)),
      // Undated on a board that was never read: never fresh, like an undated job of a first read.
      neverRead: await job(await company(null), null, { firstSeenAt: hoursAgo(10) }),
    };
    const u = await user();
    await t.db.insert(savedJobs).values({ userId: u, jobId: ids.saved });
    await t.db.insert(applications).values({ userId: u, jobId: ids.applied, status: "submitted" });
    await t.db.insert(shortlist).values({ userId: u, jobId: ids.shortlisted, fit: 0.8 });
    await t.db.insert(shortlist).values({ userId: u, jobId: ids.dismissed, fit: 0.7, status: "dismissed" });
    const before = (await t.db.select().from(jobs)).length;

    const res = await sweepStaleJobs(t.db, { now: NOW });
    expect(res).toEqual({ jobs: 3, descriptions: 3, specs: 3, embeddings: 3, batches: 1, more: false });
    for (const gone of [ids.stale, ids.undatedFirstRead, ids.neverRead]) expect(await state(gone)).toEqual(BARE);
    for (const keep of [ids.fresh, ids.undatedLater, ids.insideGrace, ids.saved, ids.applied, ids.shortlisted, ids.dismissed]) {
      expect(await state(keep)).toEqual(FULL);
    }
    // Rows are never deleted: the collector still knows these jobs.
    expect(await t.db.select().from(jobs)).toHaveLength(before);
    // Without the grace period the 75-hour job goes too.
    expect(await sweepStaleJobs(t.db, { now: NOW, graceHours: 0 })).toMatchObject({ jobs: 1 });
    expect(await state(ids.insideGrace)).toEqual(BARE);
  });

  it("drops the spec and embedding of a job that had no text to blank (a Workday list row)", async () => {
    const id = await job(await company(), hoursAgo(100), { text: "" });
    expect(await sweepStaleJobs(t.db, { now: NOW })).toEqual({ jobs: 1, descriptions: 0, specs: 1, embeddings: 1, batches: 1, more: false });
    expect(await state(id)).toEqual(BARE);
  });

  it("works in small batches, stops at maxBatches, and a second run finds nothing", async () => {
    const co = await company();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await job(co, hoursAgo(100 + i)));

    expect(await sweepStaleJobs(t.db, { now: NOW, batchSize: 2, maxBatches: 1 })).toMatchObject({ jobs: 2, batches: 1, more: true });
    expect(await sweepStaleJobs(t.db, { now: NOW, batchSize: 2 })).toEqual({ jobs: 3, descriptions: 3, specs: 3, embeddings: 3, batches: 2, more: false });
    expect(await sweepStaleJobs(t.db, { now: NOW, batchSize: 2 })).toEqual({ jobs: 0, descriptions: 0, specs: 0, embeddings: 0, batches: 0, more: false });
    for (const id of ids) expect(await state(id)).toEqual(BARE);
  });

  it("stops between batches when asked to", async () => {
    const co = await company();
    for (let i = 0; i < 3; i++) await job(co, hoursAgo(100));
    const stop = new AbortController();
    stop.abort();
    expect(await sweepStaleJobs(t.db, { now: NOW, batchSize: 1, signal: stop.signal })).toMatchObject({ jobs: 0, more: true });
  });
});
