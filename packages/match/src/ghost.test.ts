import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeEmbedding } from "@norinote/ai";
import { eq, jobs, shortlist } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { GHOST_FIT_PENALTY, ghostRepostCounts, ghostRepostsOf, isGhost } from "./ghost.js";
import { rawFitOf } from "./outcomes.js";
import { buildShortlist, clearRequirementVectorCache } from "./shortlist.js";
import { NOW, baseSpec, daysAgo, hoursAgo, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(() => clearRequirementVectorCache());

/** Earlier postings of the same job that closed, first seen `days` ago each. */
async function reposts(companyId: string, title: string, days: number[]) {
  for (const d of days) await seedJob(t.db, { companyId, title, firstSeenAt: daysAgo(d), postedAt: daysAgo(d), closedAt: daysAgo(d - 5) });
}

describe("ghost jobs", () => {
  it("flags a posting at the third repost within 60 days, and not before", async () => {
    const companyId = await seedCompany(t.db);
    await reposts(companyId, "Data Engineer", [50, 30]);
    const second = await seedJob(t.db, { companyId, title: "Data Engineer", firstSeenAt: hoursAgo(10) });
    expect(await ghostRepostsOf(t.db, second)).toBe(2);
    expect(isGhost(2)).toBe(false);

    await t.db.update(jobs).set({ closedAt: hoursAgo(5) }).where(eq(jobs.id, second));
    const third = await seedJob(t.db, { companyId, title: "data engineer ", firstSeenAt: hoursAgo(2) });
    expect(await ghostRepostsOf(t.db, third)).toBe(3);
    expect(isGhost(3)).toBe(true);
  });

  it("counts only closed postings of the same company and title, first seen in the 60 days before", async () => {
    const companyId = await seedCompany(t.db);
    const other = await seedCompany(t.db);
    await reposts(companyId, "Product Designer", [70, 65]);
    await reposts(companyId, "Senior Product Designer", [40]);
    await reposts(other, "Product Designer", [40]);
    await seedJob(t.db, { companyId, title: "Product Designer", firstSeenAt: daysAgo(20) });
    await seedJob(t.db, { companyId, title: "Product Designer", firstSeenAt: daysAgo(10), location: "New York, NY" });
    const job = await seedJob(t.db, { companyId, title: "Product Designer", firstSeenAt: hoursAgo(3) });
    await reposts(companyId, "Product Designer", [0.05]);
    expect(await ghostRepostsOf(t.db, job)).toBe(0);
    expect(await ghostRepostCounts(t.db, [job])).toEqual(new Map());
  });

  it("ranks a ghost a little lower on the shortlist and says why", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Ghostly Engineer"], locations: [], minFit: 0.3 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", org: "Acme", start: "2020-01", skills: ["TypeScript", "Postgres"], text: "built typescript services on postgresql" });
    const spec = baseSpec({ mustHaves: ["TypeScript"] });
    const embedText = "ghostly engineer typescript postgresql services backend";
    const ghostCo = await seedCompany(t.db, { name: "Haunted" });
    await reposts(ghostCo, "Ghostly Engineer", [55, 35, 15]);
    const ghost = await seedJob(t.db, { companyId: ghostCo, title: "Ghostly Engineer", spec, embedText });
    const twin = await seedJob(t.db, { companyId: await seedCompany(t.db, { name: "Plain" }), title: "Ghostly Engineer", spec, embedText });

    const stats = await buildShortlist(t.db, userId, { profileEmbedding: fakeEmbedding("typescript postgresql backend services"), now: NOW, widen: false });
    expect(stats.items.map((i) => i.jobId)).toEqual([twin, ghost]);
    const rows = new Map((await t.db.select().from(shortlist).where(eq(shortlist.userId, userId))).map((r) => [r.jobId, r]));
    const g = rows.get(ghost)!;
    const p = rows.get(twin)!;
    expect(g.reasons).toContain("Reposted 3 times in 60 days");
    expect(p.reasons.some((r) => r.startsWith("Reposted"))).toBe(false);
    expect(g.fit).toBeCloseTo(p.fit - GHOST_FIT_PENALTY, 3);
    expect(rawFitOf(g.fit, g.reasons)).toBeCloseTo(p.fit, 3);
  });
});
