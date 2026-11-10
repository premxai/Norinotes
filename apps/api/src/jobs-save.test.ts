import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, jobSpecs, jobs } from "@norinote/db";
import { makeApi, seedApplication, seedJob, type Api } from "./testkit.js";

let api: Api;
let cookie: string;
beforeAll(async () => {
  api = await makeApi();
  cookie = (await api.signup("jobs-save@example.com")).cookie;
});
afterAll(() => api.close());

type Item = { job: { id: string; title: string; saved?: boolean }; saved: boolean };
const ids = (items: Item[]) => items.map((i) => i.job.id);

describe("the Jobs page: saving, location filters, what you'll do", () => {
  it("saves and unsaves a job, and lists saved ones newest first whatever their age", async () => {
    const fresh = await seedJob(api.db, { title: "Platform Engineer" });
    const old = await seedJob(api.db, { title: "Old Engineer", hoursAgo: 24 * 10 });
    expect((await api.call("POST", `/api/jobs/${fresh.job.id}/save`, { cookie })).json).toEqual({ saved: true });
    expect((await api.call("POST", `/api/jobs/${old.job.id}/save`, { cookie })).json).toEqual({ saved: true });
    // Saving twice is fine.
    expect((await api.call("POST", `/api/jobs/${old.job.id}/save`, { cookie })).status).toBe(200);
    expect((await api.call("POST", "/api/jobs/00000000-0000-0000-0000-000000000000/save", { cookie })).status).toBe(404);

    const saved = (await api.call("GET", "/api/jobs?view=saved", { cookie })).json as Item[];
    expect(ids(saved)).toEqual([old.job.id, fresh.job.id]);
    expect(saved.every((i) => i.saved)).toBe(true);
    expect(ids((await api.call("GET", "/api/jobs?view=saved&q=platform", { cookie })).json)).toEqual([fresh.job.id]);

    // A bookmark does not put an old job in the other lists; the flag shows on the ones that are there.
    const all = (await api.call("GET", "/api/jobs?view=new&lanes=false&group=false&limit=200", { cookie })).json as Item[];
    expect(ids(all)).not.toContain(old.job.id);
    expect(all.find((i) => i.job.id === fresh.job.id)?.saved).toBe(true);
    expect((await api.call("GET", `/api/jobs/${fresh.job.id}`, { cookie })).json.job.saved).toBe(true);

    expect((await api.call("DELETE", `/api/jobs/${fresh.job.id}/save`, { cookie })).json).toEqual({ saved: false });
    expect(ids((await api.call("GET", "/api/jobs?view=saved", { cookie })).json)).toEqual([old.job.id]);
    expect((await api.call("GET", `/api/jobs/${fresh.job.id}`, { cookie })).json.job.saved).toBe(false);
    expect((await api.call("POST", `/api/jobs/${fresh.job.id}/save`)).status).toBe(401);
  });

  it("lists the jobs the person applied to, newest application first, whatever their age", async () => {
    const { cookie: c2, user } = await api.signup("jobs-applied@example.com");
    const older = await seedJob(api.db, { title: "Applied Long Ago", hoursAgo: 24 * 20 });
    const newer = await seedJob(api.db, { title: "Applied Recently" });
    await seedJob(api.db, { title: "Never Applied" });
    await seedApplication(api.db, user.id, older.job.id, { createdAt: new Date(Date.now() - 86_400_000) });
    await seedApplication(api.db, user.id, newer.job.id, { status: "submitted" });
    const items = (await api.call("GET", "/api/jobs?view=applied", { cookie: c2 })).json as (Item & { applicationStatus: string })[];
    expect(ids(items)).toEqual([newer.job.id, older.job.id]);
    expect(items[0]!.applicationStatus).toBe("submitted");
  });

  it("filters by location and remote, and lists common locations", async () => {
    const austin = await seedJob(api.db, { title: "Austin Engineer", location: "Austin, TX", remote: false });
    const remote = await seedJob(api.db, { title: "Remote Engineer", location: "Remote - US", remote: true });
    const list = async (qs: string) => ids((await api.call("GET", `/api/jobs?view=new&lanes=false&group=false&limit=200&${qs}`, { cookie })).json);
    const inAustin = await list("location=austin");
    expect(inAustin).toContain(austin.job.id);
    expect(inAustin).not.toContain(remote.job.id);
    const remoteOnly = await list("remote=true");
    expect(remoteOnly).toContain(remote.job.id);
    expect(remoteOnly).not.toContain(austin.job.id);
    const { locations } = (await api.call("GET", "/api/jobs/locations", { cookie })).json as { locations: { name: string; count: number }[] };
    expect(locations).toEqual(expect.arrayContaining([{ name: "Austin, TX", count: expect.any(Number) }]));
  });

  it("returns the full list of what the job involves", async () => {
    const { job } = await seedJob(api.db, { title: "Spec Engineer" });
    await api.db.insert(jobSpecs).values({
      jobId: job.id, version: 1, model: "test",
      spec: {
        mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "backend engineering", yearsMin: null,
        location: { remote: "unknown", countries: [], cities: [] }, citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown",
        responsibilities: ["Build APIs", "Own the data model", "Mentor engineers"], requirementWeights: {},
      },
    });
    const res = (await api.call("GET", `/api/jobs/${job.id}`, { cookie })).json;
    expect(res.job.requirements.responsibilities).toEqual(["Build APIs", "Own the data model", "Mentor engineers"]);
    expect(res.job.requirements.summary).toBe("Build APIs Own the data model");
  });

  it("shows only hosted Greenhouse jobs when the engine scope is Greenhouse", async () => {
    const scoped = await makeApi({ config: { engineAts: ["greenhouse"] } });
    try {
      const { cookie } = await scoped.signup("engine-list@example.com");
      const hostedJob = await seedJob(scoped.db, { title: "Scoped Engineer" });
      await scoped.db.update(jobs).set({ applyUrl: "https://job-boards.greenhouse.io/x/jobs/1" }).where(eq(jobs.id, hostedJob.job.id));
      const embedded = await seedJob(scoped.db, { title: "Embedded Engineer" });
      await scoped.db.update(jobs).set({ applyUrl: "https://company.example/careers?gh_jid=2" }).where(eq(jobs.id, embedded.job.id));
      const other = await seedJob(scoped.db, { title: "Ashby Engineer" });
      await scoped.db.update(jobs).set({ atsType: "ashby", applyUrl: "https://jobs.ashbyhq.com/x/3" }).where(eq(jobs.id, other.job.id));
      const listed = ids((await scoped.call("GET", "/api/jobs?view=new&lanes=false&group=false&limit=200", { cookie })).json);
      expect(listed).toContain(hostedJob.job.id);
      expect(listed).not.toContain(embedded.job.id);
      expect(listed).not.toContain(other.job.id);
      expect((await scoped.call("GET", "/api/jobs/summary", { cookie })).json.open).toBe(1);
    } finally {
      await scoped.close();
    }
  });
});
