import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { fakeEmbedding } from "@norinote/ai";
import { jobsFittingLanes, unspeccedJobsForUser } from "./demand.js";
import { isHostedForm } from "./engine.js";
import { buildShortlist } from "./shortlist.js";
import { NOW, baseSpec, seedCompany, seedJob, seedLane, seedPoint, seedUser } from "./test-helpers.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

const ENGINE = ["greenhouse"];
const hosted = (id: string) => t.db.update(jobs).set({ applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${id.slice(0, 8)}` }).where(eq(jobs.id, id));

describe("the Greenhouse engine scope", () => {
  it("tells a hosted Greenhouse form from an embedded one", () => {
    expect(isHostedForm("greenhouse", "https://job-boards.greenhouse.io/reddit/jobs/1")).toBe(true);
    expect(isHostedForm("greenhouse", "https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
    expect(isHostedForm("greenhouse", "https://seatgeek.com/jobs/8357320?gh_jid=8357320")).toBe(false);
    expect(isHostedForm("ashby", "https://jobs.ashbyhq.com/x/1")).toBe(true);
  });

  it("reads every fresh hosted Greenhouse job, whatever its title, and only those", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Software Engineer"], locations: ["San Francisco, CA"] });
    const companyId = await seedCompany(t.db, { name: "Engine Co" });
    const otherTitle = await seedJob(t.db, { companyId, title: "Data Platform Engineer" });
    await hosted(otherTitle);
    const embedded = await seedJob(t.db, { companyId, title: "Data Platform Engineer II" }); // apply URL on the company site
    const ashby = await seedJob(t.db, { companyId, title: "Data Platform Engineer III" });
    await t.db.update(jobs).set({ atsType: "ashby", applyUrl: "https://jobs.ashbyhq.com/x/1" }).where(eq(jobs.id, ashby));
    const ids = [otherTitle, embedded, ashby];

    expect(await jobsFittingLanes(t.db, ids, { now: NOW, engineAts: ENGINE })).toEqual([otherTitle]);
    // Without the scope, a title that fits no role is not read.
    expect(await jobsFittingLanes(t.db, ids, { now: NOW })).toEqual([]);
    expect(await unspeccedJobsForUser(t.db, userId, { now: NOW, engineAts: ENGINE })).toContain(otherTitle);
    expect(await unspeccedJobsForUser(t.db, userId, { now: NOW, engineAts: ENGINE })).not.toContain(embedded);
  });

  it("matches a person against the scope's jobs in their places, ranked and scored, not only by title", async () => {
    const userId = await seedUser(t.db);
    await seedLane(t.db, userId, { titles: ["Backend Engineer"], locations: ["San Francisco, CA"], minFit: 0 });
    await seedPoint(t.db, userId, { title: "Backend Engineer", org: "Prior Co", start: "2021-01", end: null, text: "Built Python data services on PostgreSQL", skills: ["Python", "PostgreSQL"] });
    const companyId = await seedCompany(t.db, { name: "Scope Co" });
    const spec = baseSpec({ skills: [{ name: "Python", level: "working", years: null, required: true }, { name: "PostgreSQL", level: "working", years: null, required: true }] });
    const fits = await seedJob(t.db, { companyId, title: "Data Platform Engineer", spec, embedText: "python postgresql data services" });
    await hosted(fits);
    const elsewhere = await seedJob(t.db, { companyId, title: "Data Platform Engineer", location: "Berlin, Germany", spec, embedText: "python postgresql data services" });
    await hosted(elsewhere);
    const embedded = await seedJob(t.db, { companyId, title: "Data Platform Engineer", spec, embedText: "python postgresql data services" });

    const stats = await buildShortlist(t.db, userId, { now: NOW, profileEmbedding: fakeEmbedding("python postgresql data services"), engineAts: ENGINE, widen: false, limit: 50 });
    expect(stats.candidateIds).toContain(fits);
    expect(stats.candidateIds).not.toContain(elsewhere);
    expect(stats.candidateIds).not.toContain(embedded);
    // Without the scope, the title has to fit the role.
    const plain = await buildShortlist(t.db, userId, { now: NOW, profileEmbedding: fakeEmbedding("python postgresql data services"), widen: false, limit: 50 });
    expect(plain.candidateIds).not.toContain(fits);
  });
});
