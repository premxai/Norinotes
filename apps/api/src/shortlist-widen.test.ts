import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, lanes, profiles, eq } from "@norinote/db";
import { makeApi, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

type Item = { jobId: string; reasons: string[]; widenedBy: string | null; job: { title: string } };
type Meta = { total: number; widened: string[]; lanesMatched: number; poolUsed: boolean };

describe("GET /api/shortlist/meta and widenedBy", () => {
  it("needs a session, and an empty shortlist is zero everywhere", async () => {
    expect((await api.call("GET", "/api/shortlist/meta")).status).toBe(401);
    const u = await api.signup("meta-empty@example.com");
    expect((await api.call<Meta>("GET", "/api/shortlist/meta", { cookie: u.cookie })).json).toEqual({ total: 0, widened: [], lanesMatched: 0, poolUsed: false });
  });

  it("counts roles, lists the widening steps used in ladder order, and keeps the array response for compatibility", async () => {
    const u = await api.signup("meta-widened@example.com");
    const mk = async (title: string, fit: number, reasons: string[]) => {
      const { job } = await seedJob(api.db, { title });
      await seedShortlist(api.db, u.user.id, job.id, fit, { reasons });
      return job.id;
    };
    const a = await mk("Frontend Engineer", 0.5, ["Fits at 50%"]);
    const pool = await mk("Site Reliability Engineer", 0.9, ["Fits at 90%", "widened:role_pool"]);
    const adj = await mk("Software Engineer", 0.8, ["Fits at 80%", "widened:adjacent_titles"]);
    const adj2 = await mk("UI Engineer", 0.7, ["widened:adjacent_titles"]);

    const list = await api.call<Item[]>("GET", "/api/shortlist", { cookie: u.cookie });
    expect(Array.isArray(list.json)).toBe(true);
    // Jobs the lanes fit come first even with a lower fit, then the widened ones best first.
    expect(list.json.map((i) => i.jobId)).toEqual([a, pool, adj, adj2]);
    expect(list.json.map((i) => i.widenedBy)).toEqual([null, "role_pool", "adjacent_titles", "adjacent_titles"]);
    for (const i of list.json) expect(i.reasons.some((r) => r.startsWith("widened:"))).toBe(false);
    expect(list.json[1]!.reasons).toEqual(["Fits at 90%"]);

    const meta = await api.call<Meta>("GET", "/api/shortlist/meta", { cookie: u.cookie });
    expect(meta.status).toBe(200);
    expect(meta.json).toEqual({ total: 4, widened: ["adjacent_titles", "role_pool"], lanesMatched: 1, poolUsed: true });
  });

  it("ignores dismissed and closed rows, and exposes widenedBy on a job’s match", async () => {
    const u = await api.signup("meta-dismiss@example.com");
    const { job } = await seedJob(api.db, { title: "Warehouse Associate" });
    await seedShortlist(api.db, u.user.id, job.id, 0.6, { reasons: ["Fits at 60%", "widened:remote"] });
    const { job: gone } = await seedJob(api.db, { title: "Warehouse Associate II", closed: true });
    await seedShortlist(api.db, u.user.id, gone.id, 0.9, { reasons: ["widened:older"] });
    expect((await api.call<Meta>("GET", "/api/shortlist/meta", { cookie: u.cookie })).json).toEqual({ total: 1, widened: ["remote"], lanesMatched: 0, poolUsed: false });

    const detail = await api.call("GET", `/api/jobs/${job.id}`, { cookie: u.cookie });
    expect(detail.json.match).toMatchObject({ widenedBy: "remote", explanation: { reasons: ["Fits at 60%"] } });

    await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie: u.cookie });
    expect((await api.call<Meta>("GET", "/api/shortlist/meta", { cookie: u.cookie })).json.total).toBe(0);
  });
});

describe("jobs Best match for a user with no lanes", () => {
  it("uses a temporary lane from the latest role and location, and keeps shortlist jobs on the page", async () => {
    const u = await api.signup("temp-lane@example.com");
    await api.db.update(profiles).set({ location: "Austin, TX" }).where(eq(profiles.userId, u.user.id));
    await api.db.insert(careerPoints).values([
      { userId: u.user.id, kind: "role", title: "Designer at Old Co", startDate: "2015-01", endDate: "2018-01", text: "", sourceQuote: "x" },
      { userId: u.user.id, kind: "role", title: "Senior Backend Engineer at Acme", startDate: "2019-01", text: "", sourceQuote: "x" },
    ]);
    const fits = await seedJob(api.db, { title: "Backend Engineer II", location: "Austin, TX", remote: false });
    const remote = await seedJob(api.db, { title: "Staff Backend Engineer", location: "Remote - US", remote: true });
    const wrongPlace = await seedJob(api.db, { title: "Backend Engineer", location: "Berlin, Germany", remote: false });
    const wrongRole = await seedJob(api.db, { title: "Marketing Manager", location: "Austin, TX", remote: false });
    const widened = await seedJob(api.db, { title: "Site Reliability Engineer", location: "Berlin, Germany", remote: false });
    await seedShortlist(api.db, u.user.id, widened.job.id, 0.4, { reasons: ["widened:role_pool"] });

    expect(await api.db.select().from(lanes).where(eq(lanes.userId, u.user.id))).toEqual([]);
    const best = await api.call<Array<{ job: { id: string }; match: { widenedBy: string | null } | null }>>("GET", "/api/jobs?view=best", { cookie: u.cookie });
    const ids = best.json.map((r) => r.job.id);
    expect(ids).toEqual(expect.arrayContaining([fits.job.id, remote.job.id, widened.job.id]));
    expect(ids).not.toContain(wrongPlace.job.id);
    expect(ids).not.toContain(wrongRole.job.id);
    expect(best.json.find((r) => r.job.id === widened.job.id)!.match?.widenedBy).toBe("role_pool");

    const summary = await api.call("GET", "/api/jobs/summary", { cookie: u.cookie });
    expect(summary.json).toMatchObject({ hasLanes: false, fitsLanes: 2 });
  });

  it("is unfiltered, as before, for a user with neither lanes nor roles", async () => {
    const u = await api.signup("temp-none@example.com");
    const { job } = await seedJob(api.db, { title: "Chef" });
    const best = await api.call<Array<{ job: { id: string } }>>("GET", "/api/jobs?view=best", { cookie: u.cookie });
    expect(best.json.map((r) => r.job.id)).toContain(job.id);
  });
});
