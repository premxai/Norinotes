import { describe, expect, it } from "vitest";
import { greenhouseFormIsOffsite } from "./schema.js";

const answering = (status: number, location?: string) => (async () => new Response(null, { status, headers: location ? { location } : {} })) as unknown as typeof fetch;

describe("Greenhouse forms kept on the company's own site", () => {
  it("tells an off-site redirect from a hosted form", async () => {
    expect(await greenhouseFormIsOffsite("abnormal", "1", { fetch: answering(302, "https://abnormal.ai/careers/jobs/1?gh_jid=1") })).toBe(true);
    expect(await greenhouseFormIsOffsite("braze", "1", { fetch: answering(200) })).toBe(false);
    expect(await greenhouseFormIsOffsite("x", "1", { fetch: answering(301, "https://job-boards.greenhouse.io/x/jobs/1") })).toBe(false);
    expect(await greenhouseFormIsOffsite("x", "1", { fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBeNull();
  });
});
