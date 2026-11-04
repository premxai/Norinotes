import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerBank, applications, careerPoints, eq, jobs, resumes, runEvents, shortlist } from "@norinote/db";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
let cookie: string;
let userId: string;

beforeAll(async () => {
  api = await makeApi();
  const s = await api.signup("apps@example.com");
  cookie = s.cookie;
  userId = s.user.id;
});
afterAll(() => api.close());

const setStatus = (id: string, patch: Partial<typeof applications.$inferInsert>) => api.db.update(applications).set(patch).where(eq(applications.id, id));
const QUESTION = (id: string, text: string, required = true) => ({ id, text, type: "text", options: [], required });

describe("shortlist", () => {
  it("is empty, and queues match.user once only for a user who has career points", async () => {
    const fresh = await api.signup("sl-empty@example.com");
    expect((await api.call("GET", "/api/shortlist", { cookie: fresh.cookie })).json).toEqual([]);
    expect(api.queuedOf("match.user").some((q) => q.payload.userId === fresh.user.id)).toBe(false);

    await api.db.insert(careerPoints).values({ userId: fresh.user.id, kind: "role", title: "Engineer", text: "Built things", sourceQuote: "Engineer" });
    await api.call("GET", "/api/shortlist", { cookie: fresh.cookie });
    await api.call("GET", "/api/shortlist", { cookie: fresh.cookie });
    expect(api.queuedOf("match.user").filter((q) => q.payload.userId === fresh.user.id)).toHaveLength(1);
  });

  it("lists new rows best fit first, joined with the job, and dismisses", async () => {
    const a = await seedJob(api.db, { title: "Backend Engineer", company: "Alpha", location: "Austin, TX", remote: false });
    const b = await seedJob(api.db, { title: "Platform Engineer", company: "Beta" });
    const c = await seedJob(api.db, { title: "Data Engineer", company: "Gamma" });
    const closed = await seedJob(api.db, { title: "Closed Engineer", company: "Delta", closed: true });
    await seedShortlist(api.db, userId, a.job.id, 0.7);
    await seedShortlist(api.db, userId, b.job.id, 0.93);
    await seedShortlist(api.db, userId, c.job.id, 0.5, { status: "dismissed" });
    await seedShortlist(api.db, userId, closed.job.id, 0.99);

    const list = await api.call("GET", "/api/shortlist", { cookie });
    expect(list.status).toBe(200);
    expect(list.json.map((r: { job: { companyName: string } }) => r.job.companyName)).toEqual(["Beta", "Alpha"]);
    expect(list.json[1]).toEqual({
      id: expect.any(String), jobId: a.job.id, fit: 0.7, reasons: ["Fits at 70%"], status: "new", createdAt: expect.any(String), widenedBy: null,
      locations: 1, locationNames: ["Austin, TX"],
      job: { id: a.job.id, companyName: "Alpha", companyLogoUrl: null, title: "Backend Engineer", location: "Austin, TX", remote: false, applyUrl: a.job.applyUrl, postedAt: expect.any(String) },
    });

    expect((await api.call("POST", `/api/shortlist/${b.job.id}/dismiss`, { cookie })).status).toBe(200);
    expect((await api.call("POST", `/api/shortlist/${b.job.id}/dismiss`, { cookie })).status).toBe(200);
    expect((await api.call("GET", "/api/shortlist", { cookie })).json.map((r: { job: { companyName: string } }) => r.job.companyName)).toEqual(["Alpha"]);
    const [row] = await api.db.select().from(shortlist).where(eq(shortlist.jobId, b.job.id));
    expect(row?.status).toBe("dismissed");
    expect((await api.call("POST", `/api/shortlist/${(await seedJob(api.db)).job.id}/dismiss`, { cookie })).status).toBe(404);
    expect((await api.call("POST", "/api/shortlist/nope/dismiss", { cookie })).status).toBe(404);
  });

  it("shows a role posted in several cities once, and dismissing it dismisses every city", async () => {
    const u = await api.signup("sl-group@example.com");
    const a = await seedJob(api.db, { title: "Frontend Engineer", company: "Echo", location: "New York, NY" });
    const sibling = (location: string) => api.db.insert(jobs).values({
      ...a.job, id: undefined, externalId: `${a.job.externalId}-${location}`, location, dedupeKey: `${a.job.dedupeKey}-${location}`,
    }).returning().then(([j]) => j!);
    const sf = await sibling("San Francisco, CA");
    const remote = await sibling("Remote - US");
    const other = await seedJob(api.db, { title: "Backend Engineer", company: "Foxtrot" });
    await seedShortlist(api.db, u.user.id, a.job.id, 0.8);
    await seedShortlist(api.db, u.user.id, sf.id, 0.75);
    await seedShortlist(api.db, u.user.id, remote.id, 0.7);
    await seedShortlist(api.db, u.user.id, other.job.id, 0.6);

    const list = (await api.call("GET", "/api/shortlist", { cookie: u.cookie })).json as { jobId: string; locations: number; locationNames: string[]; job: { companyName: string } }[];
    expect(list.map((r) => r.job.companyName)).toEqual(["Echo", "Foxtrot"]);
    expect(list[0]).toMatchObject({ jobId: a.job.id, locations: 3, locationNames: ["New York, NY", "San Francisco, CA", "Remote - US"] });

    expect((await api.call("POST", `/api/shortlist/${a.job.id}/dismiss`, { cookie: u.cookie })).status).toBe(200);
    expect((await api.call("GET", "/api/shortlist", { cookie: u.cookie })).json.map((r: { job: { companyName: string } }) => r.job.companyName)).toEqual(["Foxtrot"]);
  });

  it("never dismisses or shows another user's rows", async () => {
    const other = await api.signup("sl-other@example.com");
    const { job } = await seedJob(api.db, { company: "Private Co" });
    await seedShortlist(api.db, other.user.id, job.id, 0.8);
    expect((await api.call("POST", `/api/shortlist/${job.id}/dismiss`, { cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/shortlist", { cookie })).json.some((r: { jobId: string }) => r.jobId === job.id)).toBe(false);
    const [row] = await api.db.select().from(shortlist).where(eq(shortlist.jobId, job.id));
    expect(row?.status).toBe("new");
  });
});

describe("applications", () => {
  it("creates an application, queues prepare.application and marks the shortlist row applied", async () => {
    const { job } = await seedJob(api.db, { title: "Staff Engineer", company: "Create Co" });
    await seedShortlist(api.db, userId, job.id, 0.8);
    const res = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      jobId: job.id, status: "queued", resumeId: null, answers: {}, pendingQuestions: [], receipt: null, error: null, attempts: 0,
      preparedAt: null, approvedAt: null, submittedAt: null,
    });
    expect(res.json.createdAt).toBeTruthy();
    expect(res.json.updatedAt).toBeTruthy();
    expect(api.queuedOf("prepare.application").at(-1)?.payload).toEqual({ applicationId: res.json.id });
    const [sl] = await api.db.select().from(shortlist).where(eq(shortlist.jobId, job.id));
    expect(sl?.status).toBe("applied");

    // Asking again returns the same application.
    const again = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id } });
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(res.json.id);
  });

  it("validates the job and refuses a second posting of the same role", async () => {
    expect((await api.call("POST", "/api/applications", { cookie, body: { jobId: "nope" } })).status).toBe(400);
    expect((await api.call("POST", "/api/applications", { cookie, body: { jobId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
    expect((await api.call("POST", "/api/applications", { body: { jobId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(401);

    const first = await seedJob(api.db, { title: "Twin Engineer", company: "Twin Co", location: "Berlin" });
    const second = await seedJob(api.db, { title: "Twin Engineer", company: "Twin Co", location: "Madrid" });
    await api.db.update(jobs).set({ companyId: first.company.id }).where(eq(jobs.id, second.job.id));
    expect((await api.call("POST", "/api/applications", { cookie, body: { jobId: first.job.id } })).status).toBe(201);
    const dup = await api.call("POST", "/api/applications", { cookie, body: { jobId: second.job.id } });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toMatch(/already have an application/);
  });

  it("lists applications and returns the detail with events, job and tailored resume", async () => {
    const { job } = await seedJob(api.db, { title: "Resume Engineer", company: "Resume Co" });
    const created = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id } });
    const id = created.json.id as string;

    const [resume] = await api.db.insert(resumes).values({
      applicationId: id, pages: 1, pdfPath: null,
      content: {
        name: "Ada Lovelace", contact: { email: "ada@example.com" }, summary: "Engineer.",
        experience: [{ careerPointId: "cp1", title: "Engineer", company: "Acme", bullets: [{ id: "b1", text: "Built a thing in TypeScript", careerPointIds: ["cp1"], weight: 1 }] }],
        education: [{ careerPointId: "cp2", school: "UCL", degree: "BSc" }], skills: [{ group: "Languages", items: ["TypeScript"] }], projects: [],
      },
      changes: [{ kind: "bullet", before: "Built a thing", after: "Built a thing in TypeScript", reason: "Posting vocabulary", careerPointIds: ["cp1"] }],
      atsChecks: { score: 90, keywordCoverage: 80, checks: [{ id: "one-page", label: "One page", weight: 1, pass: true }] },
    }).returning();
    await setStatus(id, { resumeId: resume!.id, status: "prepared", preparedAt: new Date() });
    await api.db.insert(runEvents).values({ applicationId: id, step: "status:prepared", message: "Prepared" });

    const list = await api.call("GET", "/api/applications", { cookie });
    const item = list.json.find((x: { application: { id: string } }) => x.application.id === id);
    expect(item.job).toMatchObject({ id: job.id, companyName: "Resume Co" });
    expect(item.resume.id).toBe(resume!.id);

    const detail = await api.call("GET", `/api/applications/${id}`, { cookie });
    expect(detail.status).toBe(200);
    expect(detail.json.application.status).toBe("prepared");
    expect(detail.json.job.title).toBe("Resume Engineer");
    expect(detail.json.events.map((e: { step: string }) => e.step)).toEqual(expect.arrayContaining(["created", "status:prepared"]));
    expect(detail.json.events[0]).toEqual(expect.objectContaining({ id: expect.any(String), applicationId: id, ts: expect.any(String), level: "info", message: expect.any(String) }));
    expect(detail.json.resume.content.experience[0].bullets[0]).toEqual({ id: "b1", text: "Built a thing in TypeScript", nodeIds: ["cp1"] });
    expect(detail.json.resume.changes[0]).toMatchObject({ bulletId: "b1", before: "Built a thing", after: "Built a thing in TypeScript", nodeIds: ["cp1"] });
    expect(detail.json.resume.atsChecks).toEqual([{ id: "one-page", label: "One page", pass: true, weight: 1 }]);
  });

  it("approves a prepared application once and queues apply.run", async () => {
    const { job } = await seedJob(api.db, { company: "Approve Co" });
    const created = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id } });
    const id = created.json.id as string;
    const early = await api.call("POST", `/api/applications/${id}/approve`, { cookie, body: {} });
    expect(early.status).toBe(409);
    expect(api.queuedOf("apply.run").some((q) => q.payload.applicationId === id)).toBe(false);

    await setStatus(id, { status: "prepared", preparedAt: new Date() });
    const ok = await api.call("POST", `/api/applications/${id}/approve`, { cookie, body: { answers: { "q-extra": "Yes, happy to relocate" } } });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ ok: true, status: "applying", started: true });
    expect(api.queuedOf("apply.run").filter((q) => q.payload.applicationId === id)).toEqual([{ name: "apply.run", payload: { applicationId: id, trigger: "click" } }]);
    const [row] = await api.db.select().from(applications).where(eq(applications.id, id));
    expect(row?.status).toBe("applying");
    expect(row?.approvedAt).toBeTruthy();
    expect(row?.answers).toMatchObject({ "q-extra": "Yes, happy to relocate" });

    // A double click does not run it twice.
    const twice = await api.call("POST", `/api/applications/${id}/approve`, { cookie, body: {} });
    expect(twice.status).toBe(200);
    expect(twice.json.started).toBe(false);
    expect(api.queuedOf("apply.run").filter((q) => q.payload.applicationId === id)).toHaveLength(1);
  });

  it("saves answers, remembers them, and resumes once every required question is answered", async () => {
    const { job } = await seedJob(api.db, { company: "Answer Co" });
    const app = await seedApplication(api.db, userId, job.id, {
      status: "needs_user", approvedAt: new Date(), preparedAt: new Date(), resumeId: null,
      pendingQuestions: [QUESTION("q-why", "Why do you want to work here?"), QUESTION("q-visa", "Do you need a visa?"), QUESTION("q-opt", "Anything else?", false)],
    });

    const partial = await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: { answers: { "q-why": "I like the product." } } });
    expect(partial.status).toBe(200);
    expect(partial.json).toMatchObject({ ok: true, status: "needs_user", resumed: false });
    expect(api.queuedOf("apply.run").some((q) => q.payload.applicationId === app.id)).toBe(false);

    const full = await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: { answers: { "q-visa": "No" } } });
    expect(full.json).toMatchObject({ status: "applying", resumed: true });
    expect(api.queuedOf("apply.run").filter((q) => q.payload.applicationId === app.id)).toHaveLength(1);
    const [row] = await api.db.select().from(applications).where(eq(applications.id, app.id));
    expect(row?.status).toBe("applying");
    expect(row?.answers).toMatchObject({ "q-why": "I like the product.", "q-visa": "No" });

    const bank = await api.db.select({ q: answerBank.questionText, a: answerBank.answer, s: answerBank.source }).from(answerBank).where(eq(answerBank.userId, userId));
    expect(bank).toEqual(expect.arrayContaining([{ q: "Why do you want to work here?", a: "I like the product.", s: "user" }, { q: "Do you need a visa?", a: "No", s: "user" }]));

    expect((await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: { answers: {} } })).status).toBe(200);
    expect((await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: {} })).status).toBe(400);
  });

  it("does not submit an application parked before the click: answering sends it back through prepare", async () => {
    const { job } = await seedJob(api.db, { company: "Unclicked Co" });
    const app = await seedApplication(api.db, userId, job.id, {
      status: "needs_user", approvedAt: null, preparedAt: null, resumeId: null,
      pendingQuestions: [QUESTION("q-why", "Why do you want to work here?"), QUESTION("q-visa", "Do you need a visa?")],
    });

    const partial = await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: { answers: { "q-why": "I like the product." } } });
    expect(partial.json).toMatchObject({ status: "needs_user", resumed: false });

    const full = await api.call("POST", `/api/applications/${app.id}/answer`, { cookie, body: { answers: { "q-visa": "No" } } });
    expect(full.json).toMatchObject({ status: "preparing", resumed: true });
    expect(api.queuedOf("apply.run").some((q) => q.payload.applicationId === app.id)).toBe(false);
    expect(api.queuedOf("prepare.application").some((q) => q.payload.applicationId === app.id)).toBe(true);
    const [row] = await api.db.select().from(applications).where(eq(applications.id, app.id));
    expect(row?.status).toBe("preparing");
    expect(row?.approvedAt).toBeNull();
  });

  it("retries a failed application back into the queue", async () => {
    const { job } = await seedJob(api.db, { company: "Retry Co" });
    const app = await seedApplication(api.db, userId, job.id, { status: "failed", error: "Browser step failed" });
    const before = api.queuedOf("prepare.application").length;
    const res = await api.call("POST", `/api/applications/${app.id}/retry`, { cookie });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("queued");
    expect(api.queuedOf("prepare.application").length).toBe(before + 1);
    expect(api.queuedOf("prepare.application").at(-1)?.payload).toEqual({ applicationId: app.id });
    expect((await api.call("POST", `/api/applications/${app.id}/retry`, { cookie })).status).toBe(409);
  });
});

describe("ownership", () => {
  it("answers 404 for every route on another user's application", async () => {
    const other = await api.signup("owner-b@example.com");
    const { job } = await seedJob(api.db, { company: "Theirs Co" });
    const theirs = await seedApplication(api.db, other.user.id, job.id, { status: "needs_user", approvedAt: new Date(), pendingQuestions: [QUESTION("q1", "Why?")] });

    expect((await api.call("GET", `/api/applications/${theirs.id}`, { cookie })).status).toBe(404);
    for (const [path, body] of [["approve", {}], ["answer", { answers: { q1: "mine" } }], ["retry", {}]] as const) {
      expect((await api.call("POST", `/api/applications/${theirs.id}/${path}`, { cookie, body })).status).toBe(404);
    }
    const [row] = await api.db.select().from(applications).where(eq(applications.id, theirs.id));
    expect(row?.status).toBe("needs_user");
    expect(row?.answers).toEqual({});
    expect(api.queuedOf("apply.run").some((q) => q.payload.applicationId === theirs.id)).toBe(false);

    expect((await api.call("GET", "/api/applications", { cookie })).json.some((x: { application: { id: string } }) => x.application.id === theirs.id)).toBe(false);
    expect((await api.call("GET", `/api/applications/${theirs.id}`, { cookie: other.cookie })).status).toBe(200);
    expect((await api.call("GET", "/api/applications/not-a-uuid", { cookie })).status).toBe(404);
  });
});
