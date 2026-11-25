import { describe, expect, it, vi } from "vitest";
import { json, routeFetch, withRobots } from "./__fixtures__/helpers.js";
import {
  backoffMs, feedHost, fetchWithRetry, getJson, HostBackoff, MAX_ATTEMPTS, MAX_RETRY_AFTER_MS, parseRetryAfter, RateLimitedError, USER_AGENT,
} from "./http.js";
import { RobotsDisallowedError, RobotsUnavailableError } from "./robots.js";

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
    expect(await getJson("https://x.test/a", { fetch: withRobots(f), sleep: async (ms) => { sleeps.push(ms); } })).toEqual({ ok: 1 });
    expect(sleeps).toEqual([3000]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caps a huge Retry-After at 60 s", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = routeFetch({ "https://x.test/": () => (++n === 1 ? refuse(503, { "retry-after": "86400" }) : json({})) });
    await getJson("https://x.test/a", { fetch: withRobots(f), sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([60_000]);
  });

  it("backs off with jitter when there is no Retry-After, and gives up after 3 attempts", async () => {
    const sleeps: number[] = [];
    const f = routeFetch({ "https://x.test/": () => refuse(503) });
    const err = await getJson("https://x.test/a", { fetch: withRobots(f), random: () => 0.5, sleep: async (ms) => { sleeps.push(ms); } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).attempts).toBe(MAX_ATTEMPTS);
    expect((err as RateLimitedError).host).toBe("x.test");
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1125, 2250]);
  });

  it("does not retry other errors; 404 is null", async () => {
    const f500 = routeFetch({ "https://x.test/": () => new Response("boom", { status: 500 }) });
    await expect(getJson("https://x.test/a", { fetch: withRobots(f500) })).rejects.toThrow(/500/);
    expect(f500).toHaveBeenCalledTimes(1);
    const f404 = routeFetch({});
    expect(await getJson("https://x.test/a", { fetch: withRobots(f404) })).toBeNull();
    expect(f404).toHaveBeenCalledTimes(1);
  });

  it("times out a request that never answers", async () => {
    const hang = vi.fn((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    await expect(fetchWithRetry("https://x.test/slow", {}, { fetch: withRobots(hang), timeoutMs: 20 })).rejects.toThrow(/timed out after 20ms/);
  });
});

describe("robots.txt", () => {
  it("is read once per origin, before the first request, and a disallowed path is never fetched", async () => {
    const f = routeFetch({
      "https://x.test/robots.txt": () => new Response("User-agent: *\nDisallow: /private/\n", { headers: { "content-type": "text/plain" } }),
      "https://x.test/": () => json({ ok: true }),
    });
    expect(await getJson("https://x.test/a", { fetch: f })).toEqual({ ok: true });
    expect(await getJson("https://x.test/b", { fetch: f })).toEqual({ ok: true });
    const err = await getJson("https://x.test/private/c", { fetch: f }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RobotsDisallowedError);
    expect((err as RobotsDisallowedError).reason).toBe("disallowed by robots.txt");
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(["https://x.test/robots.txt", "https://x.test/a", "https://x.test/b"]);
  });

  it("refuses a whole origin whose robots.txt is Disallow: /", async () => {
    const f = routeFetch({ "https://api.sr.test/robots.txt": () => new Response("User-agent: *\nDisallow: /\n") });
    await expect(getJson("https://api.sr.test/v1/companies/x/postings", { fetch: f })).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("spaces requests by Crawl-delay, and refuses a Crawl-delay too long to honour", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const opts = { now: () => clock, sleep: async (ms: number) => { sleeps.push(ms); clock += ms; } };
    const f = routeFetch({ "https://slow.test/robots.txt": () => new Response("User-agent: *\nCrawl-delay: 1\n"), "https://slow.test/": () => json({}) });
    await getJson("https://slow.test/a", { ...opts, fetch: f });
    await getJson("https://slow.test/b", { ...opts, fetch: f });
    await getJson("https://slow.test/c", { ...opts, fetch: f });
    expect(sleeps).toEqual([1000, 1000]);
    const g = routeFetch({ "https://lazy.test/robots.txt": () => new Response("User-agent: *\nCrawl-delay: 120\n") });
    const err = await getJson("https://lazy.test/a", { fetch: g }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "RobotsDisallowedError", reason: "robots.txt crawl-delay too long" });
  });

  it("treats a missing or HTML robots.txt as allowing everything, and an unreadable one (5xx) as a retryable error", async () => {
    const html = routeFetch({ "https://h.test/robots.txt": () => new Response("<html>hi</html>", { headers: { "content-type": "text/html" } }), "https://h.test/": () => json({ ok: 1 }) });
    expect(await getJson("https://h.test/a", { fetch: html })).toEqual({ ok: 1 });
    const down = routeFetch({ "https://d.test/robots.txt": () => new Response("", { status: 500 }), "https://d.test/": () => json({}) });
    await expect(getJson("https://d.test/a", { fetch: down })).rejects.toBeInstanceOf(RobotsUnavailableError);
    expect(down).toHaveBeenCalledTimes(1);
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
