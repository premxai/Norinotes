import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { jobSpecs } from "@norinote/db";
import { jobsFittingLanes, unspeccedJobsForUser } from "./demand.js";
import { NOW, baseSpec, daysAgo, hoursAgo, seedCompany, seedJob, seedLane, seedUser } from "./test-helpers.js";
import { HEURISTIC_SPEC_VERSION } from "./understand.js";

let t: TestDb;
let companyId: string;
beforeAll(async () => {
  t = await createTestDb();
  companyId = await seedCompany(t.db);
});
afterAll(() => t.close());

describe("jobsFittingLanes", () => {
  it("keeps open, fresh, unblocked jobs that fit an enabled lane of any user, and nothing else", async () => {
    const a = await seedUser(t.db);
    await seedLane(t.db, a, { titles: ["Quokka Engineer"], locations: ["San Francisco, CA"] });
    const b = await seedUser(t.db);
    await seedLane(t.db, b, { titles: ["Quokka Analyst"], locations: [], enabled: false });
    const blocked = await seedCompany(t.db, { blocked: true });
    const justRead = await seedCompany(t.db, { firstReadAt: hoursAgo(10) });

    const fits = await seedJob(t.db, { companyId, title: "Senior Quokka Engineer" });
    const noPostedDate = await seedJob(t.db, { companyId, title: "Quokka Engineer", postedAt: null, firstSeenAt: hoursAgo(30) });
    const wrongTitle = await seedJob(t.db, { companyId, title: "Quokka Chef" });
    const disabledLane = await seedJob(t.db, { companyId, title: "Quokka Analyst" });
    const wrongCity = await seedJob(t.db, { companyId, title: "Quokka Engineer", location: "London, UK" });
    const stale = await seedJob(t.db, { companyId, title: "Quokka Engineer", postedAt: hoursAgo(73), firstSeenAt: hoursAgo(73) });
    // Undated and seen on the board's first read: of unknown age, so never fresh.
    const onFirstRead = await seedJob(t.db, { companyId: justRead, title: "Quokka Engineer", postedAt: null, firstSeenAt: hoursAgo(10) });
    const closed = await seedJob(t.db, { companyId, title: "Quokka Engineer", closedAt: daysAgo(1) });
    const blockedJob = await seedJob(t.db, { companyId: blocked, title: "Quokka Engineer" });

    const all = [fits, noPostedDate, wrongTitle, disabledLane, wrongCity, stale, onFirstRead, closed, blockedJob];
    expect(await jobsFittingLanes(t.db, all, { now: NOW })).toEqual([fits, noPostedDate]);
    expect(await jobsFittingLanes(t.db, [], { now: NOW })).toEqual([]);
    // Restricted to one user's lanes.
    expect(await jobsFittingLanes(t.db, all, { now: NOW, userId: b })).toEqual([]);
    expect(await jobsFittingLanes(t.db, all, { now: NOW, userId: a })).toEqual([fits, noPostedDate]);
  });
});

describe("unspeccedJobsForUser", () => {
  it("lists the user's lane-fitting jobs without a current spec, newest first, and skips understood ones", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Numbat Engineer"], locations: [] });
    const older = await seedJob(t.db, { companyId, title: "Numbat Engineer", postedAt: hoursAgo(60) });
    const newer = await seedJob(t.db, { companyId, title: "Senior Numbat Engineer", postedAt: hoursAgo(6) });
    const heuristic = await seedJob(t.db, { companyId, title: "Numbat Engineer, Heuristic", postedAt: hoursAgo(30) });
    await t.db.insert(jobSpecs).values({ jobId: heuristic, version: HEURISTIC_SPEC_VERSION, spec: baseSpec(), model: "heuristic" });
    await seedJob(t.db, { companyId, title: "Numbat Engineer, Understood", spec: baseSpec() });
    await seedJob(t.db, { companyId, title: "Numbat Cook" });
    await seedJob(t.db, { companyId, title: "Numbat Engineer", postedAt: hoursAgo(80), firstSeenAt: hoursAgo(80) });

    // A heuristic spec does not count as understood, so the model gets to read that job once it is available.
    expect(await unspeccedJobsForUser(t.db, userId, { now: NOW })).toEqual([newer, heuristic, older]);
    expect(await unspeccedJobsForUser(t.db, userId, { now: NOW, limit: 2 })).toEqual([newer, heuristic]);
  });

  it("is empty for a user with no enabled lane", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Numbat Engineer"], enabled: false });
    expect(await unspeccedJobsForUser(t.db, userId, { now: NOW })).toEqual([]);
  });
});
