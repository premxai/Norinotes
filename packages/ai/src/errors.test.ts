import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiUnavailableError, BudgetExceededError, aiAvailability, classifyProviderError, complete, createFakeProvider, embed, resetAiAvailability,
  setAiLogger, setProvider,
} from "./index.js";
import type { AiProvider } from "./provider.js";

const KEY = "sk-proj-SECRETKEYVALUE1234567890";
const httpError = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${status} Incorrect API key provided: ${KEY}`), { status, ...extra });

/** A provider whose every call throws what `make` returns; counts calls. */
function failing(make: () => unknown): AiProvider & { calls: number } {
  const p = {
    name: "failing", calls: 0,
    async chat() { p.calls++; throw make(); },
    async embed() { p.calls++; throw make(); },
  };
  return p as AiProvider & { calls: number };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-31T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); setProvider(null); setAiLogger(null); resetAiAvailability(); });

describe("classifyProviderError", () => {
  it("sorts provider errors by status and cause", () => {
    expect(classifyProviderError(httpError(401))).toMatchObject({ reason: "auth", status: 401 });
    expect(classifyProviderError(httpError(403))).toMatchObject({ reason: "auth", status: 403 });
    expect(classifyProviderError(httpError(429))).toMatchObject({ reason: "rate_limit", status: 429 });
    expect(classifyProviderError(httpError(429, { code: "insufficient_quota" }))).toMatchObject({ reason: "auth" });
    expect(classifyProviderError(httpError(500))).toMatchObject({ reason: "server", status: 500 });
    expect(classifyProviderError(httpError(503))).toMatchObject({ reason: "server" });
    expect(classifyProviderError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toMatchObject({ reason: "network" });
    expect(classifyProviderError(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" }))).toMatchObject({ reason: "network" });
    expect(classifyProviderError(Object.assign(new Error("x"), { cause: { code: "ENOTFOUND" } }))).toMatchObject({ reason: "network" });
    expect(classifyProviderError(new TypeError("fetch failed"))).toMatchObject({ reason: "network" });
  });

  it("leaves everything else alone, and keeps the vendor's message (the key) out of the typed error", () => {
    expect(classifyProviderError(httpError(400))).toBeNull();
    expect(classifyProviderError(httpError(404))).toBeNull();
    expect(classifyProviderError(new Error("Model refused: no"))).toBeNull();
    expect(classifyProviderError("boom")).toBeNull();
    expect(classifyProviderError(null)).toBeNull();
    const typed = new AiUnavailableError("auth", 401);
    expect(classifyProviderError(typed)).toBe(typed);
    expect(classifyProviderError(httpError(401))!.message).not.toContain(KEY);
  });

  it("is not confused with a spent budget", () => {
    expect(classifyProviderError(new BudgetExceededError("u", 10, 5))).toBeNull();
  });
});

describe("complete() and embed() when the provider is unavailable", () => {
  it("throws AiUnavailableError for a 401 from chat and from embeddings", async () => {
    setProvider(failing(() => httpError(401)));
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    resetAiAvailability();
    await expect(embed(["text"])).rejects.toMatchObject({ name: "AiUnavailableError", reason: "auth" });
  });

  it("stops calling the provider for the cooldown after an auth error, then tries again", async () => {
    const provider = failing(() => httpError(401));
    setProvider(provider);
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls).toBe(1);
    expect(aiAvailability()).toMatchObject({ available: false, reason: "auth" });

    // Thousands of calls in the next minutes never reach the vendor, for chat and embeddings alike.
    for (let i = 0; i < 50; i++) {
      await expect(complete({ system: "s", input: String(i) })).rejects.toBeInstanceOf(AiUnavailableError);
      await expect(embed(["x"])).rejects.toBeInstanceOf(AiUnavailableError);
    }
    expect(provider.calls).toBe(1);

    vi.setSystemTime(new Date("2026-10-31T12:04:59Z"));
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls).toBe(1);

    // After five minutes one call is let through; it fails again and starts a new cooldown.
    vi.setSystemTime(new Date("2026-10-31T12:05:01Z"));
    expect(aiAvailability().available).toBe(true);
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls).toBe(2);
  });

  it("uses a short cooldown for rate limits, server errors and network failures", async () => {
    const provider = failing(() => httpError(429));
    setProvider(provider);
    await expect(complete({ system: "s", input: "i" })).rejects.toMatchObject({ reason: "rate_limit" });
    await expect(complete({ system: "s", input: "i" })).rejects.toMatchObject({ reason: "rate_limit" });
    expect(provider.calls).toBe(1);
    vi.setSystemTime(new Date("2026-10-31T12:00:31Z"));
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(provider.calls).toBe(2);
  });

  it("recovers: the first good call after the cooldown clears it", async () => {
    let healthy = false;
    const fake = createFakeProvider({ chat: () => "ok" });
    const provider: AiProvider = {
      name: "flaky",
      chat: async (req) => { if (!healthy) throw httpError(500); return fake.chat(req); },
      embed: (req) => fake.embed(req),
    };
    setProvider(provider);
    await expect(complete({ system: "s", input: "i" })).rejects.toBeInstanceOf(AiUnavailableError);
    healthy = true;
    vi.setSystemTime(new Date("2026-10-31T12:01:00Z"));
    expect((await complete({ system: "s", input: "i" })).text).toBe("ok");
    expect(aiAvailability().available).toBe(true);
  });

  it("logs once per cooldown, with the reason and never the key", async () => {
    const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
    setAiLogger((event, fields) => lines.push({ event, fields }));
    setProvider(failing(() => httpError(401)));
    for (let i = 0; i < 20; i++) await complete({ system: "s", input: String(i) }).catch(() => undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "ai.unavailable", fields: { reason: "auth", status: 401, cooldownSeconds: 300 } });
    expect(JSON.stringify(lines)).not.toContain(KEY);

    vi.setSystemTime(new Date("2026-10-31T12:06:00Z"));
    await complete({ system: "s", input: "again" }).catch(() => undefined);
    expect(lines).toHaveLength(2);
  });

  it("passes other errors through untouched and starts no cooldown", async () => {
    setProvider(failing(() => httpError(400)));
    await expect(complete({ system: "s", input: "i" })).rejects.toMatchObject({ status: 400 });
    expect(aiAvailability().available).toBe(true);
  });
});
