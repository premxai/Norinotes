import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { JobSpec } from "@norinote/shared";
import {
  AiOutputError, BudgetExceededError, EMBEDDING_DIMENSIONS, complete, costMicros, createFakeProvider, dailyTokenBudget, embed,
  fakeEmbedding, getProvider, modelFor, setProvider, usageToday,
} from "./index.js";

let t: TestDb;
let userId: string;
beforeAll(async () => {
  t = await createTestDb();
  const [u] = await t.db.insert(users).values({ email: "ai@example.test", passwordHash: "x" }).returning();
  userId = u!.id;
});
afterAll(() => t.close());
afterEach(() => { setProvider(null); vi.unstubAllEnvs(); });

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe("model routing", () => {
  it("defaults to the small and large models from the architecture and honours env overrides", () => {
    expect(modelFor("small", {})).toBe("gpt-4.1-mini");
    expect(modelFor("large", {})).toBe("gpt-4.1");
    expect(modelFor("small", { AI_SMALL_MODEL: "x-mini" })).toBe("x-mini");
    expect(modelFor("large", { AI_LARGE_MODEL: "x-big" })).toBe("x-big");
  });

  it("parses the daily budget: default, explicit, unlimited", () => {
    expect(dailyTokenBudget({})).toBe(300_000);
    expect(dailyTokenBudget({ AI_DAILY_TOKEN_BUDGET: "1000" })).toBe(1000);
    expect(dailyTokenBudget({ AI_DAILY_TOKEN_BUDGET: "0" })).toBeNull();
    expect(dailyTokenBudget({ AI_DAILY_TOKEN_BUDGET: "garbage" })).toBe(300_000);
  });

  it("prices tokens in micro-dollars, discounts cached input and over-reports unknown models", () => {
    // gpt-4.1-mini: $0.40 in, $1.60 out per million tokens = 0.4 and 1.6 micros per token.
    expect(costMicros("gpt-4.1-mini", { promptTokens: 1000, completionTokens: 500 })).toBe(400 + 800);
    expect(costMicros("gpt-4.1-mini", { promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 })).toBe(100);
    expect(costMicros("mystery-model", { promptTokens: 1000, completionTokens: 0 })).toBe(2000);
    expect(costMicros("gpt-4.1-mini", { promptTokens: 1, completionTokens: 0 })).toBe(1);
  });
});

describe("provider selection", () => {
  it("uses the fake provider under test even when a key is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-not-real");
    expect(getProvider().name).toBe("fake");
  });
});

describe("complete()", () => {
  const Verdict = z.object({ fits: z.boolean(), score: z.number().min(0).max(1), why: z.string(), tags: z.array(z.string()) });

  it("returns typed structured output from the fake provider without a user (no accounting)", async () => {
    const r = await complete({ tier: "small", system: "Judge fit.", input: "Job: Engineer", schema: Verdict });
    expect(r.output).toEqual({ fits: false, score: 0, why: "fake", tags: [] });
    expect(r.model).toBe("gpt-4.1-mini");
    expect(r.usage.promptTokens).toBeGreaterThan(0);
  });

  it("can produce a shared JobSpec from its schema alone", async () => {
    const r = await complete({ system: "Extract the spec.", input: "text", schema: JobSpec, strict: true });
    expect(JobSpec.safeParse(r.output).success).toBe(true);
  });

  it("orders messages system, then stable prefix, then the variable input, and sends a stable cache key", async () => {
    const fake = createFakeProvider();
    setProvider(fake);
    await complete({ system: "SYS", prefix: "PROFILE", input: "JOB 1" });
    await complete({ system: "SYS", prefix: "PROFILE", input: "JOB 2" });
    expect(fake.calls[0]!.messages).toEqual([
      { role: "system", content: "SYS" }, { role: "user", content: "PROFILE" }, { role: "user", content: "JOB 1" },
    ]);
    expect(fake.calls[0]!.cacheKey).toBe(fake.calls[1]!.cacheKey);
    expect(fake.calls[0]!.cacheKey?.startsWith("small:")).toBe(true);
  });

  it("routes the large tier to the large model", async () => {
    const fake = createFakeProvider();
    setProvider(fake);
    const r = await complete({ tier: "large", system: "s", input: "i" });
    expect(r.model).toBe("gpt-4.1");
    expect(fake.calls[0]!.model).toBe("gpt-4.1");
  });

  it("sends the JSON schema and throws AiOutputError for invalid output", async () => {
    const fake = createFakeProvider({ chat: () => ({ fits: "yes" }) });
    setProvider(fake);
    await expect(complete({ system: "s", input: "i", schema: Verdict, schemaName: "verdict" })).rejects.toBeInstanceOf(AiOutputError);
    expect(fake.calls[0]!.jsonSchema?.name).toBe("verdict");
    expect(fake.calls[0]!.jsonSchema?.schema).toMatchObject({ type: "object", required: expect.arrayContaining(["fits", "score"]) });
    expect(fake.calls[0]!.jsonSchema?.schema).not.toHaveProperty("$schema");
  });

  it("accounts tokens and cost to the user in llm_usage", async () => {
    const before = await usageToday(t.db, userId);
    const fake = createFakeProvider({ chat: () => "ok" });
    setProvider(fake);
    const r = await complete({ system: "a".repeat(400), input: "b".repeat(400), userId, db: t.db });
    const after = await usageToday(t.db, userId);
    expect(after.calls).toBe(before.calls + 1);
    expect(after.promptTokens - before.promptTokens).toBe(r.usage.promptTokens);
    expect(after.completionTokens - before.completionTokens).toBe(r.usage.completionTokens);
    expect(after.costMicros - before.costMicros).toBe(r.usage.costMicros);
    expect(r.usage.costMicros).toBeGreaterThan(0);
  });

  it("refuses a call once the user's daily budget is used and records nothing for the refused call", async () => {
    const [u] = await t.db.insert(users).values({ email: "budget@example.test", passwordHash: "x" }).returning();
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "150");
    setProvider(createFakeProvider({ chat: () => "ok" }));
    // ~200 prompt tokens in one call: allowed (the check is before the call), then the next is refused.
    await complete({ system: "a".repeat(400), input: "b".repeat(400), userId: u!.id, db: t.db });
    const used = await usageToday(t.db, u!.id);
    expect(used.totalTokens).toBeGreaterThanOrEqual(150);
    await expect(complete({ system: "s", input: "i", userId: u!.id, db: t.db })).rejects.toBeInstanceOf(BudgetExceededError);
    expect((await usageToday(t.db, u!.id)).calls).toBe(1);
  });

  it("does not limit a user when the budget is 0 (unlimited)", async () => {
    const [u] = await t.db.insert(users).values({ email: "free@example.test", passwordHash: "x" }).returning();
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "0");
    for (let i = 0; i < 3; i++) await complete({ system: "a".repeat(4000), input: "b", userId: u!.id, db: t.db });
    expect((await usageToday(t.db, u!.id)).calls).toBe(3);
  });
});

describe("embed()", () => {
  it("returns one 1536-dimension unit vector per text, deterministically", async () => {
    const [a, b] = await embed(["senior typescript engineer", "senior typescript engineer"]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(a).toEqual(b);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 6);
    expect(await embed([])).toEqual([]);
  });

  it("ranks texts that share words closer than unrelated texts", () => {
    const query = fakeEmbedding("backend engineer typescript postgres");
    const near = fakeEmbedding("typescript backend engineer working on postgres");
    const far = fakeEmbedding("registered nurse pediatric ward");
    expect(cosine(query, near)).toBeGreaterThan(cosine(query, far) + 0.3);
  });

  it("charges the user's usage when userId is given", async () => {
    const before = await usageToday(t.db, userId);
    await embed(["one text", "another text"], { userId, db: t.db });
    const after = await usageToday(t.db, userId);
    expect(after.promptTokens).toBeGreaterThan(before.promptTokens);
    expect(after.completionTokens).toBe(before.completionTokens);
    expect(after.calls).toBe(before.calls + 1);
  });
});
