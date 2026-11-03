import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq, inboxMessages, outcomes } from "@norinote/db";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
let ada: { cookie: string; id: string };
let bob: { cookie: string; id: string };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  api = await makeApi();
  const a = await api.signup("outcomes-ada@example.com");
  const b = await api.signup("outcomes-bob@example.com");
  ada = { cookie: a.cookie, id: a.user.id };
  bob = { cookie: b.cookie, id: b.user.id };
});
afterAll(() => api.close());

async function submitted(userId: string, days = 10) {
  const { job } = await seedJob(api.db, { title: "Data Analyst" });
  return seedApplication(api.db, userId, job.id, { status: "submitted", submittedAt: ago(days) });
}

describe("auth", () => {
  it("needs a session for every outcome endpoint", async () => {
    const app = await submitted(ada.id);
    for (const [method, url] of [
      ["GET", `/api/applications/${app.id}/outcomes`], ["POST", `/api/applications/${app.id}/outcomes`],
      ["DELETE", `/api/applications/${app.id}/outcomes?kind=reply`], ["GET", "/api/outcomes/summary"],
    ] as const) {
      expect((await api.call(method, url, method === "POST" ? { body: { kind: "reply" } } : {})).status).toBe(401);
    }
  });

  it("never shows or changes another user's application", async () => {
    const app = await submitted(ada.id);
    const mine = await api.call("POST", `/api/applications/${app.id}/outcomes`, { cookie: ada.cookie, body: { kind: "interview" } });
    expect(mine.status).toBe(201);
    expect((await api.call("GET", `/api/applications/${app.id}/outcomes`, { cookie: bob.cookie })).status).toBe(404);
    expect((await api.call("POST", `/api/applications/${app.id}/outcomes`, { cookie: bob.cookie, body: { kind: "offer" } })).status).toBe(404);
    expect((await api.call("DELETE", `/api/applications/${app.id}/outcomes/${mine.json.outcome.id}`, { cookie: bob.cookie })).status).toBe(404);
    expect((await api.call("DELETE", `/api/applications/${app.id}/outcomes?kind=interview`, { cookie: bob.cookie })).status).toBe(404);
    expect(await api.db.select().from(outcomes).where(eq(outcomes.applicationId, app.id))).toHaveLength(1);
  });
});

describe("manual outcomes", () => {
  it("adds, repeats idempotently, corrects, and refuses what cannot be true", async () => {
    const app = await submitted(ada.id, 40);
    const url = `/api/applications/${app.id}/outcomes`;
    const added = await api.call("POST", url, { cookie: ada.cookie, body: { kind: "rejection", at: ago(2).toISOString() } });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ created: true, state: "rejection", outcome: { kind: "rejection", source: "manual", messageId: null } });
    const again = await api.call("POST", url, { cookie: ada.cookie, body: { kind: "rejection" } });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ created: false, outcome: { id: added.json.outcome.id } });

    // Correct it: it was an interview, not a rejection.
    const del = await api.call("DELETE", `${url}/${added.json.outcome.id}`, { cookie: ada.cookie });
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ ok: true, state: "no_response", outcomes: [] });
    expect((await api.call("DELETE", `${url}/${added.json.outcome.id}`, { cookie: ada.cookie })).status).toBe(404);
    await api.call("POST", url, { cookie: ada.cookie, body: { kind: "interview" } });
    const view = await api.call("GET", url, { cookie: ada.cookie });
    expect(view.json).toMatchObject({ applicationId: app.id, state: "interview", outcomes: [{ kind: "interview" }] });
    const byKind = await api.call("DELETE", `${url}?kind=interview`, { cookie: ada.cookie });
    expect(byKind.json).toMatchObject({ removed: 1, outcomes: [] });

    expect((await api.call("POST", url, { cookie: ada.cookie, body: { kind: "ghosted" } })).status).toBe(400);
    expect((await api.call("POST", url, { cookie: ada.cookie, body: { kind: "reply", at: new Date(Date.now() + 5 * DAY).toISOString() } })).status).toBe(400);
    expect((await api.call("DELETE", `${url}?kind=nope`, { cookie: ada.cookie })).status).toBe(400);
    const { job } = await seedJob(api.db);
    const draft = await seedApplication(api.db, ada.id, job.id, { status: "prepared" });
    expect((await api.call("POST", `/api/applications/${draft.id}/outcomes`, { cookie: ada.cookie, body: { kind: "reply" } })).status).toBe(409);
  });

  it("records outcomes and confirmations from the user's linked inbox mail on read", async () => {
    const app = await submitted(ada.id);
    const at = ago(3);
    await api.db.insert(inboxMessages).values([
      { userId: ada.id, applicationId: app.id, kind: "confirmation", fromAddress: "no-reply@greenhouse.io", messageId: "<c1@x>", meta: { trusted: true }, receivedAt: ago(9) },
      { userId: ada.id, applicationId: app.id, kind: "recruiter_reply", fromAddress: "jo@acme.com", messageId: "<r1@x>", meta: { trusted: true }, receivedAt: at },
      { userId: ada.id, applicationId: null, kind: "rejection", fromAddress: "jo@acme.com", messageId: "<u1@x>", meta: { trusted: true }, receivedAt: at },
    ]);
    const view = await api.call("GET", `/api/applications/${app.id}/outcomes`, { cookie: ada.cookie });
    expect(view.json).toMatchObject({ state: "reply", confirmedAt: expect.any(String), outcomes: [{ kind: "reply", source: "inbox", messageId: expect.any(String) }] });
    const [row] = await api.db.select().from(applications).where(eq(applications.id, app.id));
    expect(row?.confirmedAt).not.toBeNull();
    // The unlinked rejection is ignored: one outcome, the reply.
    expect(await api.db.select().from(outcomes).where(eq(outcomes.applicationId, app.id))).toHaveLength(1);
  });
});

describe("GET /api/outcomes/summary", () => {
  it("is the user's own, labels small samples, and breaks down by fit band and resume", async () => {
    const fresh = await api.signup("outcomes-carol@example.com");
    const empty = await api.call("GET", "/api/outcomes/summary", { cookie: fresh.cookie });
    expect(empty.status).toBe(200);
    expect(empty.json).toMatchObject({ overall: { applications: 0, responseRate: null, smallSample: true }, minSample: 5, noResponseDays: 30, learning: { active: false, needed: 10 } });

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { job } = await seedJob(api.db, { title: "Data Analyst" });
      await seedShortlist(api.db, fresh.user.id, job.id, 0.85, { status: "applied" });
      ids.push((await seedApplication(api.db, fresh.user.id, job.id, { status: "submitted", submittedAt: ago(45) })).id);
    }
    await api.call("POST", `/api/applications/${ids[0]}/outcomes`, { cookie: fresh.cookie, body: { kind: "interview", at: ago(40).toISOString() } });
    const small = await api.call("GET", "/api/outcomes/summary", { cookie: fresh.cookie });
    expect(small.json.overall).toMatchObject({ applications: 3, settled: 3, responses: 1, interviews: 1, noResponse: 2, responseRate: null, interviewRate: null, smallSample: true });
    expect(small.json.byFitBand).toMatchObject([{ key: "0.8+", applications: 3 }]);
    expect(small.json.byResume).toMatchObject([{ key: "off", applications: 3 }]);
    expect(small.json.bySystem).toMatchObject([{ key: "greenhouse" }]);

    for (let i = 0; i < 3; i++) await submitted(fresh.user.id, 50);
    const enough = await api.call("GET", "/api/outcomes/summary", { cookie: fresh.cookie });
    expect(enough.json.overall).toMatchObject({ applications: 6, settled: 6, smallSample: false });
    expect(enough.json.overall.responseRate).toBeCloseTo(1 / 6, 3);
    expect(enough.json.byFitBand.map((g: { key: string }) => g.key)).toEqual(["0.8+", "unranked"]);

    // Ada's and Bob's applications are not in Carol's numbers, and Carol's are not in Bob's.
    const bobs = await api.call("GET", "/api/outcomes/summary", { cookie: bob.cookie });
    expect(bobs.json.overall.applications).toBe(0);
  });
});
