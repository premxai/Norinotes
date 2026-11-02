import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "./__fixtures__/helpers.js";
import {
  backoffMs, feedHost, fetchWithRetry, getJson, HostBackoff, MAX_ATTEMPTS, MAX_RETRY_AFTER_MS, parseRetryAfter, RateLimitedError, USER_AGENT,
} from "./http.js";

const refuse = (status: number, headers: Record<string, string> = {}) => new Response("slow down", { status, headers });

describe("parseRetryAfter", () => {
  it("reads seconds and dates, caps at 60 s, and ignores junk", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0.5")).toBe(500);
    expect(parseRetryAfter("600")).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter(new Date(1_000).toUTCString(), 4000)).toBe(0);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("backoffMs", () => {
  it("doubles with a quarter of jitter", () => {
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(2, () => 0)).toBe(2000);
    expect(backoffMs(3, () => 0)).toBe(4000);
    expect(backoffMs(1, () => 1)).toBe(1250);
  });
});

describe("polite requests", () => {
  it("sends the Norinote user agent", async () => {
    const f = routeFetch({ "https://x.test/": () => json({ ok: true }) });
    await getJson("https://x.test/a", { fetch: f });
    const headers = (f.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toBe("NorinoteJobAgent/1.0 (+https://norinote.xyz)");
  });

  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = routeFetch({ "https://x.test/": () => (++n === 1 ? refuse(429, { "retry-after": "3" }) : json({ ok: 1 })) });
    expect(await getJson("https://x.test/a", { fetch: f, sleep: async (ms) => { sleeps.push(ms); } })).toEqual({ ok: 1 });
    expect(sleeps).toEqual([3000]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caps a huge Retry-After at 60 s", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = routeFetch({ "https://x.test/": () => (++n === 1 ? refuse(503, { "retry-after": "86400" }) : json({})) });
    await getJson("https://x.test/a", { fetch: f, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([60_000]);
  });

  it("backs off with jitter when there is no Retry-After, and gives up after 3 attempts", async () => {
    const sleeps: number[] = [];
    const f = routeFetch({ "https://x.test/": () => refuse(503) });
    const err = await getJson("https://x.test/a", { fetch: f, random: () => 0.5, sleep: async (ms) => { sleeps.push(ms); } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).attempts).toBe(MAX_ATTEMPTS);
    expect((err as RateLimitedError).host).toBe("x.test");
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1125, 2250]);
  });

  it("does not retry other errors; 404 is null", async () => {
    const f500 = routeFetch({ "https://x.test/": () => new Response("boom", { status: 500 }) });
    await expect(getJson("https://x.test/a", { fetch: f500 })).rejects.toThrow(/500/);
    expect(f500).toHaveBeenCalledTimes(1);
    const f404 = routeFetch({});
    expect(await getJson("https://x.test/a", { fetch: f404 })).toBeNull();
    expect(f404).toHaveBeenCalledTimes(1);
  });

  it("times out a request that never answers", async () => {
    const hang = vi.fn((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    await expect(fetchWithRetry("https://x.test/slow", {}, { fetch: hang, timeoutMs: 20 })).rejects.toThrow(/timed out after 20ms/);
  });
});

describe("HostBackoff", () => {
  it("backs a host off after two strikes in a row and a success resets the streak", () => {
    const b = new HostBackoff();
    expect(b.rateLimited("a")).toBe(false);
    b.ok("a");
    expect(b.rateLimited("a")).toBe(false);
    expect(b.rateLimited("a")).toBe(true);
    expect(b.isBackedOff("a")).toBe(true);
    expect(b.isBackedOff("b")).toBe(false);
    expect(b.rateLimited("a")).toBe(false);
    expect(b.backedOffHosts).toEqual(["a"]);
  });

  it("maps job systems to their feed host", () => {
    expect(feedHost("greenhouse")).toBe("boards-api.greenhouse.io");
    expect(feedHost("lever")).toBe("api.lever.co");
    expect(feedHost("workday")).toBe("workday");
  });
});
