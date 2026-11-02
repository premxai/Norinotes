import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFakeProvider, setAiLogger, setProvider } from "@norinote/ai";
import { careerPointEmbeddings, careerPoints, eq } from "@norinote/db";
import { makeApi, RESUME, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => {
  setAiLogger(() => undefined);
  api = await makeApi();
});
afterAll(() => api.close());
afterEach(() => setProvider(null));

const NOTE = "Read with basic parsing; detailed reading will run when the AI service is available.";

/** The vendor rejects the key: a 401 on every chat and embeddings call, as seen in the local smoke run. */
function rejectedKey() {
  const fail = () => Promise.reject(Object.assign(new Error("401 Incorrect API key provided: sk-proj-SECRET"), { status: 401 }));
  setProvider({ name: "rejected-key", chat: fail, embed: fail });
}

const embeddedCount = async (userId: string) => (await api.db.select().from(careerPointEmbeddings).where(eq(careerPointEmbeddings.userId, userId))).length;
const pointCount = async (userId: string) => (await api.db.select().from(careerPoints).where(eq(careerPoints.userId, userId))).length;

describe("resume routes when the AI service rejects our key (401)", () => {
  it("PUT /api/onboarding step resume saves the points and answers 200 with a note, not 500", async () => {
    rejectedKey();
    const { cookie, user } = await api.signup("onboard-401@example.com");
    const res = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "resume", data: { text: RESUME } } });
    expect(res.status).toBe(200);
    expect(res.json.step).toBe("contact");
    expect(res.json.note).toBe(NOTE);
    expect(res.json.resume).toMatchObject({ usedLLM: false });
    expect(res.json.resume.nodesCreated).toBeGreaterThan(0);
    expect(await pointCount(user.id)).toBeGreaterThan(3);
    expect(await embeddedCount(user.id)).toBe(0);
    // The shortlist rebuild is still queued; embedding is retried there.
    expect(api.queuedOf("match.user").some((q) => q.payload.userId === user.id)).toBe(true);
    // The profile still got the contact details from the resume.
    const me = await api.call("GET", "/api/me", { cookie });
    expect(me.json.profile.email).toBe("ada@example.com");
  });

  it("POST /api/profile/resume and /resume-file answer 200 with the same note", async () => {
    rejectedKey();
    const { cookie, user } = await api.signup("paste-401@example.com");
    const res = await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ usedLLM: false, note: NOTE });
    expect(res.json.nodesCreated).toBeGreaterThan(0);
    expect(await embeddedCount(user.id)).toBe(0);

    const form = new FormData();
    form.append("file", new File([RESUME], "resume.txt", { type: "text/plain" }));
    const file = await api.call("POST", "/api/profile/resume-file", { cookie, form });
    expect(file.status).toBe(200);
    expect(file.json.note).toBe(NOTE);
  });

  it("other AI failures (server error, rate limit, network) are not a 500 either", async () => {
    for (const [i, make] of [
      () => Object.assign(new Error("boom"), { status: 503 }),
      () => Object.assign(new Error("slow down"), { status: 429 }),
      () => Object.assign(new Error("socket"), { code: "ECONNRESET" }),
    ].entries()) {
      const fail = () => Promise.reject(make());
      setProvider({ name: "down", chat: fail, embed: fail });
      const { cookie } = await api.signup(`down-${i}@example.com`);
      const res = await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
      expect(res.status).toBe(200);
      expect(res.json.note).toBe(NOTE);
    }
  });

  it("POST /api/graph/facts records the fact with a note instead of failing", async () => {
    rejectedKey();
    const { cookie, user } = await api.signup("fact-401@example.com");
    const res = await api.call("POST", "/api/graph/facts", { cookie, body: { text: "I mentored four interns and cut build times by 40%." } });
    expect(res.status).toBe(200);
    expect(res.json.nodesCreated).toBeGreaterThan(0);
    expect(res.json.note).toMatch(/AI service is available/);
    expect(await pointCount(user.id)).toBe(1);
    expect(api.queuedOf("match.user").some((q) => q.payload.userId === user.id)).toBe(true);
  });

  it("when the AI service works there is no note", async () => {
    setProvider(createFakeProvider());
    const { cookie } = await api.signup("healthy@example.com");
    const res = await api.call("POST", "/api/profile/resume", { cookie, body: { text: RESUME } });
    expect(res.status).toBe(200);
    expect(res.json.note).toBeNull();
    const step = await api.call("PUT", "/api/onboarding", { cookie, body: { step: "resume", data: { text: RESUME } } });
    expect(step.status).toBe(200);
    expect(step.json.note).toBeNull();
  });
});
