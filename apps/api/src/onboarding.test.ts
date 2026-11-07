import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { careerPoints, eq, inboxAddresses, lanes } from "@norinote/db";
import { makeApi, RESUME, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

describe("resume to career graph", () => {
  it("turns pasted resume text into career points and queues match.user", async () => {
    const { cookie, user } = await api.signup("resume@example.com");
    const res = await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    expect(res.status).toBe(200);
    expect(res.json.nodesCreated).toBeGreaterThan(0);
    expect(res.json.profilePatch.email).toBe("ada@example.com");
    expect(Array.isArray(res.json.nodes)).toBe(true);

    const points = await api.db.select().from(careerPoints).where(eq(careerPoints.userId, user.id));
    expect(points.length).toBeGreaterThan(0);
    expect(points.some((p) => p.kind === "role")).toBe(true);
    expect(api.queuedOf("match.user").some((q) => q.payload.userId === user.id)).toBe(true);

    // The contact details the profile lacked were filled in, and the text is kept.
    const me = await api.call("GET", "/api/me", { cookie });
    expect(me.json.profile.email).toBe("ada@example.com");
    expect(me.json.profile.rawResumeText).toContain("Analytical Engines");
    expect(me.json.user.name).toBe("Ada Lovelace");
  });

  it("reads an uploaded file and refuses a missing or empty one", async () => {
    const { cookie, user } = await api.signup("upload@example.com");
    const form = new FormData();
    form.append("file", new File([RESUME], "resume.txt", { type: "text/plain" }));
    const res = await api.call("POST", "/api/profile/resume-file", { cookie, form });
    expect(res.status).toBe(200);
    expect(res.json.nodesCreated).toBeGreaterThan(0);
    expect((await api.db.select().from(careerPoints).where(eq(careerPoints.userId, user.id))).length).toBeGreaterThan(0);

    expect((await api.call("POST", "/api/profile/resume-file", { cookie, form: new FormData() })).status).toBe(400);
    const empty = new FormData();
    empty.append("file", new File([""], "empty.txt", { type: "text/plain" }));
    expect((await api.call("POST", "/api/profile/resume-file", { cookie, form: empty })).status).toBe(400);
    const junk = new FormData();
    junk.append("file", new File(["short"], "tiny.txt", { type: "text/plain" }));
    expect((await api.call("POST", "/api/profile/resume-file", { cookie, form: junk })).status).toBe(422);
  });

  it("needs a session and a long enough text", async () => {
    expect((await api.call("POST", "/api/profile/resume", { body: { text: RESUME } })).status).toBe(401);
    const { cookie } = await api.signup("short-text@example.com");
    expect((await api.call("POST", "/api/profile/resume", { cookie, body: { text: "too short" } })).status).toBe(400);
  });
});

describe("onboarding steps", () => {
  it("walks the five steps, then creates the first lane and the inbox address", async () => {
    const { cookie, user } = await api.signup("wizard@example.com");
    const start = await api.call("GET", "/api/onboarding", { cookie });
    expect(start.json.step).toBe("resume");
    expect(start.json.profile.fullName).toBe("Ada Lovelace");

    const resume = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "resume", data: {} } });
    expect(resume.json.step).toBe("contact");

    const contact = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "contact", data: { fullName: "Ada King", phone: "+1 415 555 0101", city: "Oakland", state: "CA", country: "US", location: "Oakland, CA", github: "github.com/ada", pronouns: "she/her" } } });
    expect(contact.json.step).toBe("authorization");
    expect(contact.json.profile).toMatchObject({ fullName: "Ada King", phone: "+1 415 555 0101", city: "Oakland", github: "github.com/ada", pronouns: "she/her", location: "Oakland, CA" });

    const auth = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "authorization", data: { workAuth: { authorizedUS: true, status: "visa", visaType: "H-1B", needsSponsorship: true, bogus: 1 }, willingToRelocate: true, remotePreference: "hybrid" } } });
    expect(auth.json.step).toBe("screening");
    expect(auth.json.profile.workAuth).toEqual({ authorizedUS: true, needsSponsorship: true, status: "visa", visaType: "H-1B" });
    expect(auth.json.profile.willingToRelocate).toBe(true);

    const screening = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "screening", data: { heardAbout: "a friend", salaryExpectation: { amount: 150000, currency: "USD", period: "year" }, earliestStartDate: "2 weeks", noticePeriodWeeks: 2, over18: true, securityClearance: "none", eeo: { gender: "decline" }, fullName: "ignored here" } } });
    expect(screening.json.step).toBe("preferences");
    expect(screening.json.profile).toMatchObject({ heardAbout: "a friend", earliestStartDate: "2 weeks", noticePeriodWeeks: 2, over18: true, securityClearance: "none", fullName: "Ada King" });
    expect(screening.json.profile.salaryExpectation).toEqual({ amount: 150000, currency: "USD", period: "year" });

    const before = api.queuedOf("match.user").length;
    const done = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "preferences", data: { preferences: { titles: ["Software Engineer"], locations: ["San Francisco, CA"], remote: "ok", salaryMin: 140000 } } } });
    expect(done.json.step).toBe("done");
    expect(done.json.profile.onboarding.step).toBe("done");
    expect(done.json.profile.onboarding.completedAt).toBeTruthy();
    expect(done.json.profile.preferences).toEqual({ titles: ["Software Engineer"], locations: ["San Francisco, CA"], remote: "ok", salaryMin: 140000 });

    const made = await api.db.select().from(lanes).where(eq(lanes.userId, user.id));
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: "Software Engineer", titles: ["Software Engineer"], locations: ["San Francisco, CA"], remote: true, minFit: 0.45, enabled: true });
    const [addr] = await api.db.select().from(inboxAddresses).where(eq(inboxAddresses.userId, user.id));
    expect(addr?.address).toMatch(/^nori-[a-z0-9]+@inbox\.norinote\.local$/);
    expect(api.queuedOf("match.user").length).toBeGreaterThan(before);
    expect((await api.call("GET", "/api/onboarding", { cookie })).json.step).toBe("done");

    // Saving an earlier step again never moves the wizard backwards, and does not add a second lane.
    expect((await api.call("PUT", "/api/onboarding", { cookie, body: { step: "contact", data: { phone: "555" } } })).json.step).toBe("done");
    expect(await api.db.select().from(lanes).where(eq(lanes.userId, user.id))).toHaveLength(1);
  });

  it("validates the step and the data", async () => {
    const { cookie } = await api.signup("badstep@example.com");
    expect((await api.call("PUT", "/api/onboarding", { cookie, body: { step: "nope", data: {} } })).status).toBe(400);
    expect((await api.call("PUT", "/api/onboarding", { cookie, body: { step: "screening", data: { noticePeriodWeeks: -4 } } })).status).toBe(400);
    expect((await api.call("PUT", "/api/onboarding", { body: { step: "contact", data: {} } })).status).toBe(401);
  });

  it("updates the profile and its daily cap with PUT /api/profile", async () => {
    const { cookie } = await api.signup("profile@example.com");
    const res = await api.call("PUT", "/api/profile", { cookie, body: { autoApplyDailyCap: 5, phone: "  +44 20 7946 0958 ", preferences: { remote: "only" } } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ autoApplyDailyCap: 5, phone: "+44 20 7946 0958", preferences: { remote: "only" } });
    expect((await api.call("PUT", "/api/profile", { cookie, body: { autoApplyDailyCap: 1000 } })).status).toBe(400);
    expect((await api.call("GET", "/api/me", { cookie })).json.profile.autoApplyDailyCap).toBe(5);
  });
});

describe("career graph", () => {
  it("returns nodes per point and per skill with point-to-skill edges", async () => {
    const { cookie } = await api.signup("graph@example.com");
    await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    const g = await api.call("GET", "/api/graph", { cookie });
    expect(g.status).toBe(200);
    const types = new Set(g.json.nodes.map((n: { type: string }) => n.type));
    expect(types.has("role")).toBe(true);
    expect(types.has("skill")).toBe(true);
    expect(g.json.edges.length).toBeGreaterThan(0);
    const ids = new Set(g.json.nodes.map((n: { id: string }) => n.id));
    for (const e of g.json.edges) {
      expect(ids.has(e.src)).toBe(true);
      expect(ids.has(e.dst)).toBe(true);
      expect(e.type).toBe("used");
    }
    for (const n of g.json.nodes) expect(n).toEqual(expect.objectContaining({ id: expect.any(String), label: expect.any(String), props: expect.any(Object) }));
  });

  it("adds a fact, retracts a node, and queues match.user each time", async () => {
    const { cookie, user } = await api.signup("facts@example.com");
    await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    const before = api.queuedOf("match.user").length;
    const fact = await api.call("POST", "/api/graph/facts", { cookie, body: { text: "I led the migration of our billing system to Kubernetes, which cut deploy time by 60%." } });
    expect(fact.status).toBe(200);
    expect(fact.json.nodesCreated).toBeGreaterThan(0);
    expect(api.queuedOf("match.user").length).toBe(before + 1);

    const g = await api.call("GET", "/api/graph", { cookie });
    const fromUser = g.json.nodes.find((n: { source: string }) => n.source === "a fact you added");
    expect(fromUser).toBeTruthy();
    expect((await api.call("DELETE", `/api/graph/nodes/${fromUser.id}`, { cookie })).status).toBe(200);
    expect(api.queuedOf("match.user").length).toBe(before + 2);
    expect((await api.call("DELETE", `/api/graph/nodes/${fromUser.id}`, { cookie })).status).toBe(404);

    const skill = g.json.nodes.find((n: { type: string; label: string }) => n.type === "skill" && /typescript/i.test(n.label));
    expect(skill).toBeTruthy();
    expect((await api.call("DELETE", `/api/graph/nodes/${skill.id}`, { cookie })).status).toBe(200);
    const after = await api.call("GET", "/api/graph", { cookie });
    expect(after.json.nodes.some((n: { label: string }) => /^typescript$/i.test(n.label))).toBe(false);
    expect(user.id).toBeTruthy();
  });

  it("will not delete another user's node", async () => {
    const a = await api.signup("node-a@example.com");
    const b = await api.signup("node-b@example.com");
    await api.call("POST", "/api/profile/resume", { cookie: a.cookie, body: { text: RESUME } });
    const g = await api.call("GET", "/api/graph", { cookie: a.cookie });
    const role = g.json.nodes.find((n: { type: string }) => n.type === "role");
    expect((await api.call("DELETE", `/api/graph/nodes/${role.id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await api.call("GET", "/api/graph", { cookie: a.cookie })).json.nodes.some((n: { id: string }) => n.id === role.id)).toBe(true);
    expect((await api.call("GET", "/api/graph", { cookie: b.cookie })).json).toEqual({ nodes: [], edges: [] });
  });
});
