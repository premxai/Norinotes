import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import ghJob from "./__fixtures__/greenhouse-job.json";
import { json, publicLookup, routeFetch } from "./__fixtures__/helpers.js";
import leverBoard from "./__fixtures__/lever-board.json";
import { addJobByUrl, JobNotFoundError, UnsupportedJobUrlError } from "./add-job.js";
import { BlockedSourceError } from "./blocklist.js";
import { UnsafeUrlError } from "./ssrf.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(companies);
});

const now = new Date("2026-10-31T10:00:00Z");
const opts = (fetch: typeof globalThis.fetch) => ({ now, fetch, lookup: publicLookup });
const GH_ONE = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4001";

describe("addJobByUrl", () => {
  it("detects Greenhouse, stores the job and creates the company row", async () => {
    const f = routeFetch({ [GH_ONE]: () => json(ghJob) });
    const res = await addJobByUrl(t.db, "https://boards.greenhouse.io/acme/jobs/4001?gh_src=abc", opts(f));
    expect(res.created).toBe(true);
    expect(res.job).toMatchObject({
      atsType: "greenhouse", externalId: "4001", title: "Senior Frontend Engineer", remote: true, closedAt: null,
      descriptionText: "Build UI.", dedupeKey: "acme robotics|senior frontend engineer|remote us",
    });
    expect(res.job.firstSeenAt.getTime()).toBe(now.getTime());
    const [company] = await t.db.select().from(companies);
    expect(company).toMatchObject({ atsType: "greenhouse", atsToken: "acme", name: "Acme Robotics", id: res.job.companyId });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("handles the Greenhouse embedded-form link and a scheme-less link", async () => {
    const f = routeFetch({ [GH_ONE]: () => json(ghJob) });
    const a = await addJobByUrl(t.db, "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001", opts(f));
    const b = await addJobByUrl(t.db, "boards.greenhouse.io/acme/jobs/4001", opts(f));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("is idempotent: a second paste refreshes and reopens rather than duplicating", async () => {
    const f = routeFetch({ "https://api.lever.co/v0/postings/globex/11111111-aaaa": () => json(leverBoard[0]) });
    const url = "https://jobs.lever.co/globex/11111111-aaaa-bbbb-cccc-222222222222";
    const lf = routeFetch({ "https://api.lever.co/v0/postings/globex/11111111-aaaa-bbbb-cccc-222222222222": () => json(leverBoard[0]) });
    const first = await addJobByUrl(t.db, url, opts(lf));
    expect(first.created).toBe(true);
    await t.db.update(jobs).set({ closedAt: now }).where(eq(jobs.id, first.job.id));
    const second = await addJobByUrl(t.db, url, { ...opts(lf), now: new Date("2026-11-01T00:00:00Z") });
    expect(second).toMatchObject({ created: false });
    expect(second.job.closedAt).toBeNull();
    expect(second.job.firstSeenAt.getTime()).toBe(now.getTime());
    expect(await t.db.select().from(jobs)).toHaveLength(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects unsupported hosts with a clear error and makes no request", async () => {
    const f = routeFetch({});
    const err = await addJobByUrl(t.db, "https://www.example.com/careers/engineer", opts(f)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedJobUrlError);
    expect((err as Error).message).toMatch(/www\.example\.com is not a job system/);
    await expect(addJobByUrl(t.db, "https://myworkday.example.com/job/1", opts(f))).rejects.toBeInstanceOf(UnsupportedJobUrlError);
    await expect(addJobByUrl(t.db, "   ", opts(f))).rejects.toBeInstanceOf(UnsupportedJobUrlError);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a company board link that has no job in it", async () => {
    const f = routeFetch({});
    await expect(addJobByUrl(t.db, "https://jobs.lever.co/globex", opts(f))).rejects.toThrow(/board, not a single posting/);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses internal addresses (SSRF) before anything else, even on a supported-looking path", async () => {
    const f = routeFetch({});
    for (const url of [
      "http://localhost:3000/jobs.lever.co/acme/1", "http://127.0.0.1/boards.greenhouse.io/acme/jobs/1",
      "http://169.254.169.254/latest/meta-data/", "http://10.0.0.7/x", "file:///etc/passwd",
    ]) {
      await expect(addJobByUrl(t.db, url, opts(f)), url).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    await expect(addJobByUrl(t.db, "https://jobs.lever.co/globex/1", { now, fetch: f, lookup: async () => ["192.168.0.5"] })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(f).not.toHaveBeenCalled();
    expect(await t.db.select().from(jobs)).toHaveLength(0);
  });

  it("refuses reposting aggregators", async () => {
    const f = routeFetch({});
    await expect(addJobByUrl(t.db, "https://jobs.lever.co/jobgether/abc-123", opts(f))).rejects.toBeInstanceOf(BlockedSourceError);
    expect(f).not.toHaveBeenCalled();
  });

  it("says so when the posting no longer exists", async () => {
    const f = routeFetch({});
    await expect(addJobByUrl(t.db, "https://boards.greenhouse.io/acme/jobs/999", opts(f))).rejects.toBeInstanceOf(JobNotFoundError);
    expect(await t.db.select().from(jobs)).toHaveLength(0);
  });
});
