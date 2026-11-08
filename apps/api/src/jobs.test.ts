import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, jobs } from "@norinote/db";
import { JobNotFoundError, UnsupportedJobUrlError } from "@norinote/ingest";
import { makeApi, seedJob, seedShortlist, seedApplication, type Api } from "./testkit.js";

let api: Api;
let cookie: string;
let userId: string;
const lane = (over: Record<string, unknown> = {}) => ({ name: "Engineer", titles: ["Software Engineer"], locations: [], remote: true, minFit: 0.6, enabled: true, ...over });

beforeAll(async () => {
  api = await makeApi({
    addJob: async (db, url) => {
      if (url.includes("closed")) throw new JobNotFoundError(url);
      if (url.includes("unknown")) throw new UnsupportedJobUrlError("That link is not a job posting we can read.");
      const { job } = await seedJob(db, { title: "Backend Engineer", company: "Linked Co" });
      return { job, created: !url.includes("again") };
    },
  });
  const s = await api.signup("jobs@example.com");
  cookie = s.cookie;
  userId = s.user.id;
});
afterAll(() => api.close());

describe("lanes", () => {
  it("returns an empty list, saves the whole array and keeps ids stable", async () => {
    expect((await api.call("GET", "/api/lanes", { cookie })).json).toEqual([]);
    const before = api.queuedOf("match.user").length;
    const saved = await api.call("PUT", "/api/lanes", { cookie, body: [lane(), lane({ name: "Data", titles: ["Data Engineer"], locations: ["New York"], remote: false, minFit: 0.7, enabled: false })] });
    expect(saved.status).toBe(200);
    expect(saved.json.map((l: { name: string }) => l.name)).toEqual(["Engineer", "Data"]);
    expect(saved.json[1]).toMatchObject({ titles: ["Data Engineer"], locations: ["New York"], remote: false, minFit: 0.7, enabled: false });
    expect(saved.json[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.queuedOf("match.user").length).toBe(before + 1);
    expect(api.queuedOf("match.user").at(-1)?.payload).toMatchObject({ userId, reason: "lanes" });

    const keep = saved.json[0];
    const again = await api.call("PUT", "/api/lanes", { cookie, body: [{ ...keep, name: "Engineers" }, lane({ id: "new-1", name: "Third" })] });
    expect(again.json.map((l: { name: string }) => l.name)).toEqual(["Engineers", "Third"]);
    expect(again.json[0].id).toBe(keep.id);
    expect((await api.call("GET", "/api/lanes", { cookie })).json).toEqual(again.json);
  });

  it("validates lanes and never touches another user's lane", async () => {
    expect((await api.call("PUT", "/api/lanes", { cookie, body: [{ ...lane(), minFit: 3 }] })).status).toBe(400);
    expect((await api.call("PUT", "/api/lanes", { cookie, body: [{ ...lane(), name: "" }] })).status).toBe(400);
    expect((await api.call("PUT", "/api/lanes", { cookie, body: { not: "an array" } })).status).toBe(400);
    expect((await api.call("PUT", "/api/lanes", { body: [] })).status).toBe(401);

    const other = await api.signup("lanes-other@example.com");
    const theirs = await api.call("PUT", "/api/lanes", { cookie: other.cookie, body: [lane({ name: "Theirs" })] });
    const hijack = await api.call("PUT", "/api/lanes", { cookie, body: [{ ...lane({ name: "Hijack" }), id: theirs.json[0].id }] });
    expect(hijack.json).toHaveLength(1);
    expect(hijack.json[0].id).not.toBe(theirs.json[0].id);
    expect((await api.call("GET", "/api/lanes", { cookie: other.cookie })).json[0].name).toBe("Theirs");

    await api.call("PUT", "/api/lanes", { cookie, body: [lane()] });
  });
});

describe("jobs list", () => {
  it("defaults to best-first, fitting a lane, open and fresh, with the match joined", async () => {
    const strong = await seedJob(api.db, { title: "Senior Software Engineer", company: "Strong Co", hoursAgo: 60 });
    const weak = await seedJob(api.db, { title: "Software Engineer II", company: "Weak Co", hoursAgo: 30 });
    const unmatched = await seedJob(api.db, { title: "Software Engineer", company: "Plain Co", hoursAgo: 40 });
    const wrongTitle = await seedJob(api.db, { title: "Chef de Cuisine", company: "Kitchen Co", hoursAgo: 30 });
    const old = await seedJob(api.db, { title: "Software Engineer", company: "Old Co", hoursAgo: 73 });
    const closed = await seedJob(api.db, { title: "Software Engineer", company: "Closed Co", hoursAgo: 40, closed: true });
    await seedShortlist(api.db, userId, strong.job.id, 0.91, { fitMap: [
      { requirement: "TypeScript", mustHave: true, score: 0.9, careerPointIds: ["p1"], note: "Built dashboards", evidence: "exact" },
      { requirement: "Kubernetes", mustHave: false, score: 0.1, careerPointIds: [], note: "", evidence: "none" },
    ] });
    await seedShortlist(api.db, userId, weak.job.id, 0.62);

    const res = await api.call("GET", "/api/jobs", { cookie });
    expect(res.status).toBe(200);
    const titles = res.json.map((r: { job: { companyName: string } }) => r.job.companyName);
    expect(titles.slice(0, 2)).toEqual(["Strong Co", "Weak Co"]);
    // Best match is the person's matches; a job that fits a role but isn't scored yet shows in the role-filtered list.
    expect(titles).not.toContain("Plain Co");
    const inRoles = (await api.call("GET", "/api/jobs?view=new&lanes=true&limit=200", { cookie })).json.map((r: { job: { companyName: string } }) => r.job.companyName);
    expect(inRoles).toContain("Plain Co");
    for (const gone of [wrongTitle, old, closed]) expect(titles).not.toContain(gone.company.name);
    expect(unmatched.job.id).toBeTruthy();

    const first = res.json[0];
    expect(first.job).toMatchObject({ id: strong.job.id, companyName: "Strong Co", title: "Senior Software Engineer", remote: true });
    expect(typeof first.job.companyName).toBe("string");
    expect(first.match.score).toBe(0.91);
    expect(first.match.explanation.matched).toEqual([{ requirement: "TypeScript", nodeId: "p1", label: "Built dashboards", required: true }]);
    expect(first.match.explanation.missing).toEqual([{ requirement: "Kubernetes", required: false }]);
    expect(first.match.explanation.reasons).toHaveLength(1);
    const rolesList = (await api.call("GET", "/api/jobs?view=new&lanes=true&limit=200", { cookie })).json as { job: { companyName: string }; match: unknown }[];
    expect(rolesList.find((r) => r.job.companyName === "Plain Co")!.match).toBeNull();
  });

  it("honours view, sort, lanes, maxAgeHours, status and limit, and never lists a job older than 72 hours", async () => {
    const all = await api.call("GET", "/api/jobs?lanes=false&view=new", { cookie });
    expect(all.json.some((r: { job: { title: string } }) => r.job.title === "Chef de Cuisine")).toBe(true);
    const dates = all.json.map((r: { job: { postedAt: string } }) => r.job.postedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(all.json.some((r: { job: { companyName: string } }) => r.job.companyName === "Old Co")).toBe(false);

    const names = (rows: Array<{ job: { companyName: string } }>) => rows.map((r) => r.job.companyName);
    const lastDay = await api.call("GET", "/api/jobs?lanes=false&view=new&maxAgeHours=36", { cookie });
    expect(names(lastDay.json)).toContain("Weak Co");
    expect(names(lastDay.json)).not.toContain("Plain Co");
    expect(names(lastDay.json)).not.toContain("Strong Co");
    const withClosed = await api.call("GET", "/api/jobs?lanes=false&view=new&status=all", { cookie });
    expect(names(withClosed.json)).toContain("Closed Co");
    expect(names(withClosed.json)).not.toContain("Old Co");
    // Nothing older than 72 hours can be asked for.
    expect((await api.call("GET", "/api/jobs?lanes=false&maxAgeHours=73", { cookie })).status).toBe(400);
    expect((await api.call("GET", "/api/jobs?lanes=false&maxAgeHours=0", { cookie })).status).toBe(400);
    expect((await api.call("GET", "/api/jobs?lanes=false&maxAgeDays=0", { cookie })).json.some((r: { job: { companyName: string } }) => r.job.companyName === "Old Co")).toBe(false);

    expect((await api.call("GET", "/api/jobs?limit=2&lanes=false", { cookie })).json).toHaveLength(2);
    const newSort = await api.call("GET", "/api/jobs?view=best&sort=new", { cookie });
    expect(newSort.json[0].job.companyName).not.toBe("Strong Co");

    const fresh = await seedJob(api.db, { title: "Software Engineer", company: "Today Co", hoursAgo: 5 });
    const today = await api.call("GET", "/api/jobs?view=today", { cookie });
    expect(today.json.map((r: { job: { id: string } }) => r.job.id)).toEqual([fresh.job.id]);

    const found = await api.call("GET", "/api/jobs?lanes=false&q=chef", { cookie });
    expect(found.json.map((r: { job: { title: string } }) => r.job.title)).toEqual(["Chef de Cuisine"]);
    expect((await api.call("GET", "/api/jobs?view=sideways", { cookie })).status).toBe(400);
    expect((await api.call("GET", "/api/jobs?limit=0", { cookie })).status).toBe(400);
    expect((await api.call("GET", "/api/jobs")).status).toBe(401);
  });

  it("hides postings that need US citizenship or a clearance when asked", async () => {
    const cleared = await seedJob(api.db, { title: "Software Engineer", company: "Defense Co", description: "You must be a US citizen and hold an active Secret clearance." });
    const shown = await api.call("GET", "/api/jobs?lanes=false&view=new", { cookie });
    expect(shown.json.some((r: { job: { id: string } }) => r.job.id === cleared.job.id)).toBe(true);
    const hidden = await api.call("GET", "/api/jobs?lanes=false&view=new&clearance=hide", { cookie });
    expect(hidden.json.some((r: { job: { id: string } }) => r.job.id === cleared.job.id)).toBe(false);
    expect(hidden.json.length).toBeGreaterThan(3);
  });

  it("groups one posting open in several places into one row", async () => {
    const co = await seedJob(api.db, { title: "Platform Engineer", company: "Many Places", location: "Berlin, Germany", remote: false });
    for (const location of ["London, UK", "Paris, France", "Berlin, Germany"]) {
      const { job } = await seedJob(api.db, { title: "Platform Engineer", company: `x-${location}`, location, remote: false });
      await api.db.update(jobs).set({ companyId: co.company.id }).where(eq(jobs.id, job.id));
    }
    const grouped = await api.call("GET", "/api/jobs?lanes=false&view=new&q=platform", { cookie });
    expect(grouped.json).toHaveLength(1);
    expect(grouped.json[0].locations).toBe(4);
    expect(grouped.json[0].locationNames.sort()).toEqual(["Berlin, Germany", "London, UK", "Paris, France"]);
    const flat = await api.call("GET", "/api/jobs?lanes=false&view=new&q=platform&group=false", { cookie });
    expect(flat.json).toHaveLength(4);
    expect(flat.json[0].locations).toBeUndefined();
  });

  it("annotates the user's application status", async () => {
    const { job } = await seedJob(api.db, { title: "Software Engineer", company: "Applied Co" });
    await seedApplication(api.db, userId, job.id, { status: "submitted" });
    const res = await api.call("GET", "/api/jobs?view=new&lanes=false&q=applied", { cookie });
    expect(res.json[0].applicationStatus).toBe("submitted");
  });
});

describe("summary, detail and add by link", () => {
  it("counts open jobs posted in the last 72 hours, and those from the last 24 hours as new today", async () => {
    const res = await api.call("GET", "/api/jobs/summary", { cookie });
    expect(res.status).toBe(200);
    expect(res.json.hasLanes).toBe(true);
    expect(res.json.open).toBeGreaterThan(5);
    expect(res.json.newToday).toBeGreaterThanOrEqual(1);
    expect(res.json.newToday).toBeLessThan(res.json.open);
    expect(res.json).not.toHaveProperty("newThisWeek");
    expect(res.json.fitsLanes).toBeGreaterThan(0);
    expect(res.json.fitsLanes).toBeLessThanOrEqual(res.json.open);
    const bare = await api.signup("summary-bare@example.com");
    expect((await api.call("GET", "/api/jobs/summary", { cookie: bare.cookie })).json).toMatchObject({ hasLanes: false, fitsLanes: 0 });
  });

  it("returns a job with its match, and 404 for unknown ids", async () => {
    const { job } = await seedJob(api.db, { title: "Software Engineer", company: "Detail Co" });
    await seedShortlist(api.db, userId, job.id, 0.7);
    const res = await api.call("GET", `/api/jobs/${job.id}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.json.job.id).toBe(job.id);
    expect(res.json.job.descriptionText).toContain("TypeScript");
    expect(res.json.job.requirements).toBeNull();
    expect(res.json.match.score).toBe(0.7);
    expect((await api.call("GET", "/api/jobs/00000000-0000-4000-8000-000000000000", { cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/jobs/not-a-uuid", { cookie })).status).toBe(404);
  });

  it("adds a job from a link and queues understand.job only when it is new", async () => {
    const before = api.queuedOf("understand.job").length;
    const res = await api.call("POST", "/api/jobs/url", { cookie, body: { url: "https://boards.greenhouse.io/x/jobs/1" } });
    expect(res.status).toBe(201);
    expect(res.json.job).toMatchObject({ title: "Backend Engineer", companyName: "Linked Co" });
    expect(api.queuedOf("understand.job").at(-1)?.payload.jobId).toBe(res.json.job.id);
    expect(api.queuedOf("understand.job").length).toBe(before + 1);

    expect((await api.call("POST", "/api/jobs/url", { cookie, body: { url: "https://boards.greenhouse.io/x/jobs/again" } })).status).toBe(200);
    expect(api.queuedOf("understand.job").length).toBe(before + 1);
    expect((await api.call("POST", "/api/jobs/url", { cookie, body: { url: "https://x.example/closed" } })).status).toBe(404);
    const unsupported = await api.call("POST", "/api/jobs/url", { cookie, body: { url: "https://x.example/unknown" } });
    expect(unsupported.status).toBe(422);
    expect(unsupported.json.error).toMatch(/not a job posting/);
    expect((await api.call("POST", "/api/jobs/url", { cookie, body: {} })).status).toBe(400);
  });
});

describe("jobs the user added by link", () => {
  let linkApi: Api;
  beforeAll(async () => {
    // An old posting (40 days) that fits none of the user's lanes.
    linkApi = await makeApi({ addJob: async (db) => ({ job: (await seedJob(db, { title: "Pastry Chef", company: "Old Bakery", hoursAgo: 40 * 24 })).job, created: true }) });
  });
  afterAll(() => linkApi.close());

  it("always show for that user, whatever their age or lane fit, and for no one else", async () => {
    const me = await linkApi.signup("paster@example.com");
    const other = await linkApi.signup("other@example.com");
    for (const s of [me, other]) await linkApi.call("PUT", "/api/lanes", { cookie: s.cookie, body: [lane()] });
    await seedJob(linkApi.db, { title: "Software Engineer", company: "Fresh Co" });

    const added = await linkApi.call("POST", "/api/jobs/url", { cookie: me.cookie, body: { url: "https://boards.greenhouse.io/oldbakery/jobs/1" } });
    expect(added.status).toBe(201);
    const id = added.json.job.id;
    const ids = async (cookie: string, query: string) => (await linkApi.call("GET", `/api/jobs?${query}`, { cookie })).json.map((r: { job: { id: string } }) => r.job.id);

    // Best match is the person's scored matches only; a job added by link shows in every other list.
    expect(await ids(me.cookie, "view=best")).not.toContain(id);
    expect(await ids(me.cookie, "view=new")).toContain(id);
    expect(await ids(me.cookie, "view=new&lanes=true")).toContain(id);
    expect(await ids(me.cookie, "view=today")).toContain(id); // added in the last 24 hours
    expect(await ids(other.cookie, "view=best")).not.toContain(id);
    expect(await ids(other.cookie, "view=new&lanes=false")).not.toContain(id);
  });
});
