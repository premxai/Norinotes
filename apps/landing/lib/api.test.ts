import { afterEach, describe, expect, it, vi } from "vitest";
import { SKIP_REASON_LABELS as SHARED_SKIP_REASON_LABELS } from "@norinote/shared";

const load = async (apiUrl: string | undefined) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  return import("./api");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a request that gets no answer", () => {
  it("names the local API, since locally that is the API or its WEB_URL, not the connection", async () => {
    const { api } = await load(undefined);
    const r = await api.session();
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(!r.ok && r.error).toBe("Couldn't reach the API at http://localhost:4000. Check that it's running and that its WEB_URL is this site's address.");
  });

  it("asks the person to check their connection against a deployed API", async () => {
    const { api, OFFLINE } = await load("https://api.norinote.xyz");
    const r = await api.session();
    expect(!r.ok && r.error).toBe(OFFLINE);
  });
});

describe("skip reasons", () => {
  it("are the API's, in the same order", async () => {
    const { SKIP_REASON_LABELS } = await load(undefined);
    expect(Object.entries(SKIP_REASON_LABELS)).toEqual(Object.entries(SHARED_SKIP_REASON_LABELS));
  });

  it("go with the skip only when there is one", async () => {
    const { api } = await load(undefined);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, reason: null, addedToSkipList: false })));
    vi.stubGlobal("fetch", fetch);
    await api.dismiss("job-1", "too_senior");
    await api.dismiss("job-1");
    expect(fetch.mock.calls.map(([url, init]) => [String(url), init.body])).toEqual([
      ["http://localhost:4000/api/shortlist/job-1/dismiss", JSON.stringify({ reason: "too_senior" })],
      ["http://localhost:4000/api/shortlist/job-1/dismiss", JSON.stringify({})],
    ]);
  });
});
