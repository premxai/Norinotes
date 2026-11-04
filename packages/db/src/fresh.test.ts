import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { MAX_JOB_AGE_HOURS, freshJobSql, isFreshJob } from "./fresh.js";
import { companies, jobs } from "./schema.js";
import { createTestDb, type TestDb } from "./testing.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let seq = 0;
async function company(firstReadAt: Date | null): Promise<string> {
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `fresh-${seq++}`, name: "Fresh Co", firstReadAt }).returning();
  return c!.id;
}
async function job(companyId: string, postedAt: Date | null, firstSeenAt: Date): Promise<string> {
  const id = `fresh-job-${seq++}`;
  const [j] = await t.db.insert(jobs).values({
    companyId, atsType: "greenhouse", externalId: id, title: "Engineer", applyUrl: `https://example.test/${id}`, dedupeKey: id, postedAt, firstSeenAt,
  }).returning();
  return j!.id;
}

/** Which of `ids` `freshJobSql(now, hours)` keeps. */
async function fresh(ids: string[], hours?: number, now = NOW): Promise<string[]> {
  const rows = await t.db.select({ id: jobs.id }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(inArray(jobs.id, ids), freshJobSql(now, hours)));
  const kept = new Set(rows.map((r) => r.id));
  return ids.filter((id) => kept.has(id));
}

describe("freshJobSql", () => {
  it("keeps a dated job posted 71 hours ago and drops one posted 73 hours ago, whatever its first sighting", async () => {
    const co = await company(hoursAgo(24 * 30));
    const inside = await job(co, hoursAgo(71), hoursAgo(71));
    const outside = await job(co, hoursAgo(73), hoursAgo(73));
    // Seen only an hour ago, but its feed says it was posted four days ago: the posted date wins.
    const oldPostSeenLate = await job(co, hoursAgo(96), hoursAgo(1));
    expect(await fresh([inside, outside, oldPostSeenLate])).toEqual([inside]);
  });

  it("never counts an undated job first seen on the board's first read: it was already there, of unknown age", async () => {
    const firstRead = hoursAgo(10);
    const co = await company(firstRead);
    const onFirstRead = await job(co, null, firstRead);
    const neverRead = await job(await company(null), null, hoursAgo(5));
    expect(await fresh([onFirstRead, neverRead])).toEqual([]);
  });

  it("counts an undated job first seen on a later read, within 72 hours of that sighting", async () => {
    const co = await company(hoursAgo(24 * 10));
    const recent = await job(co, null, hoursAgo(71));
    const tooLongAgo = await job(co, null, hoursAgo(73));
    expect(await fresh([recent, tooLongAgo])).toEqual([recent]);
  });

  it("narrows to a shorter window and caps `hours` at 72", async () => {
    expect(MAX_JOB_AGE_HOURS).toBe(72);
    const co = await company(hoursAgo(24 * 30));
    const today = await job(co, hoursAgo(5), hoursAgo(5));
    const yesterday = await job(co, hoursAgo(30), hoursAgo(30));
    const undatedToday = await job(co, null, hoursAgo(20));
    const old = await job(co, hoursAgo(100), hoursAgo(100));
    const all = [today, yesterday, undatedToday, old];
    expect(await fresh(all, 24)).toEqual([today, undatedToday]);
    expect(await fresh(all)).toEqual([today, yesterday, undatedToday]);
    // Asking for more than 72 hours gets 72 hours.
    expect(await fresh(all, 24 * 365)).toEqual([today, yesterday, undatedToday]);
  });
});

describe("isFreshJob", () => {
  it("agrees with freshJobSql on dated, undated, first-read and never-read jobs", async () => {
    const firstRead = hoursAgo(24 * 10);
    const cases: { postedAt: Date | null; firstSeenAt: Date; firstReadAt: Date | null }[] = [
      { postedAt: hoursAgo(71), firstSeenAt: hoursAgo(71), firstReadAt: firstRead },
      { postedAt: hoursAgo(73), firstSeenAt: hoursAgo(1), firstReadAt: firstRead },
      { postedAt: null, firstSeenAt: hoursAgo(71), firstReadAt: firstRead },
      { postedAt: null, firstSeenAt: hoursAgo(73), firstReadAt: firstRead },
      { postedAt: null, firstSeenAt: firstRead, firstReadAt: firstRead },
      { postedAt: null, firstSeenAt: hoursAgo(5), firstReadAt: null },
    ];
    const ids: string[] = [];
    for (const c of cases) ids.push(await job(await company(c.firstReadAt), c.postedAt, c.firstSeenAt));
    const kept = new Set(await fresh(ids));
    expect(cases.map((c) => isFreshJob(c, NOW))).toEqual(ids.map((id) => kept.has(id)));
    expect(cases.map((c) => isFreshJob(c, NOW))).toEqual([true, false, true, false, false, false]);
  });
});
