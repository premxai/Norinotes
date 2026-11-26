import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, profiles } from "@norinote/db";
import { makeApi, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

describe("attestations on the profile", () => {
  it("stores one answer per kind, reads them back, and forgets one on null", async () => {
    const s = await api.signup("attest@example.com");
    const before = await api.call("GET", "/api/me", { cookie: s.cookie });
    expect(before.json.profile.attestations).toMatchObject({ privacy: null, background_check: null, arbitration: null });

    const put = await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { attestations: { privacy: true, arbitration: false } } });
    expect(put.status).toBe(200);
    expect(put.json.attestations).toMatchObject({ privacy: true, arbitration: false, background_check: null });
    expect(put.json.preferences.attestations).toBeUndefined();

    await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { attestations: { privacy: null, accuracy: true } } });
    const [row] = await api.db.select().from(profiles).where(eq(profiles.userId, s.user.id));
    expect((row!.preferences as { attestations: unknown }).attestations).toEqual({ arbitration: false, accuracy: true });

    expect((await api.call("PUT", "/api/profile", { cookie: s.cookie, body: { attestations: { privacy: "yes" } } })).status).toBe(400);
  });
});
