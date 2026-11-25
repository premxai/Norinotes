import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jobSpecs } from "@norinote/db";
import { makeApi, seedJob, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

const spec: typeof jobSpecs.$inferInsert["spec"] = { mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "x", yearsMin: null, location: { remote: "unknown", countries: [], cities: [] }, citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [], requirementWeights: {} };

describe("GET /api/health/ai: is the AI reading jobs?", () => {
  it("is ok with no recent job reading, and 503 once recent jobs are read only by the rule-based fallback", async () => {
    expect((await api.call("GET", "/api/health/ai")).status).toBe(200);
    for (let i = 0; i < 6; i++) {
      const { job } = await seedJob(api.db, { title: `Fallback ${i}` });
      await api.db.insert(jobSpecs).values({ jobId: job.id, version: 0, model: "heuristic", spec });
    }
    const down = await api.call("GET", "/api/health/ai");
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ ok: false, recentSpecs: 6, ruleBased: 6 });
    // The plain health check (used by the platform to restart machines) is not affected.
    expect((await api.call("GET", "/api/health")).status).toBe(200);
  });

  it("is 503 at once when no OPENAI_API_KEY is set outside tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const res = await api.call("GET", "/api/health/ai");
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ ok: false, configured: false });
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await api.call("GET", "/api/health/ai")).json).toMatchObject({ configured: true });
  });
});
