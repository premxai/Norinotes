import { describe, expect, it } from "vitest";
import { PRICES_USD_PER_MILLION, createFakeProvider } from "@norinote/ai";
import { BudgetStopError, Ledger, estimateChatUsd, instrumentProvider } from "./spend.js";
import { duplicateFlags, ndcgAt, overallMetrics, precisionAt, precisionOfReturned, profileMetrics, reasonShares, type RankedJudgment } from "./metrics.js";

const j = (rank: number, score: number, extra: Partial<RankedJudgment> = {}): RankedJudgment => ({
  rank, score, reason: score >= 4 ? "good_fit" : "wrong_function", widenedBy: null, duplicate: false, ...extra,
});

describe("ranking metrics", () => {
  it("precision divides by k even for a short list, and by the returned size when asked", () => {
    expect(precisionAt([5, 4, 3, 1], 10)).toBeCloseTo(0.2);
    expect(precisionAt([5, 4, 3, 1], 4)).toBeCloseTo(0.5);
    expect(precisionOfReturned([5, 4, 3, 1], 10)).toBeCloseTo(0.5);
    expect(precisionOfReturned([], 10)).toBeNull();
  });

  it("nDCG is 1 for a perfectly ordered list, lower when the best item is last, null when nothing is worth anything", () => {
    expect(ndcgAt([5, 4, 3, 2, 1], 20)).toBeCloseTo(1);
    const worse = ndcgAt([1, 2, 3, 4, 5], 20)!;
    expect(worse).toBeLessThan(0.8);
    expect(worse).toBeGreaterThan(0);
    expect(ndcgAt([1, 1, 1], 20)).toBeNull();
    expect(ndcgAt([], 20)).toBeNull();
  });

  it("reason shares sum to one", () => {
    const s = reasonShares([{ reason: "good_fit" }, { reason: "good_fit" }, { reason: "wrong_function" }, { reason: "location_mismatch" }]);
    expect(s.good_fit).toBeCloseTo(0.5);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("flags the second listing of the same company and title, ignoring case, punctuation and location", () => {
    expect(duplicateFlags([
      { company: "Acme", title: "Account Executive" },
      { company: "acme", title: "Account  Executive!" },
      { company: "Acme", title: "Account Executive II" },
      { company: "Other", title: "Account Executive" },
    ])).toEqual([false, true, false, false]);
  });

  it("splits lane and widened items and counts duplicates as misses in the dedup variants", () => {
    const m = profileMetrics([
      j(1, 5), j(2, 4, { duplicate: true }), j(3, 2, { widenedBy: "adjacent_titles" }), j(4, 4, { widenedBy: "role_pool" }),
    ]);
    expect(m.size).toBe(4);
    expect(m.p10).toBeCloseTo(0.3);
    expect(m.p10Dedup).toBeCloseTo(0.2);
    expect(m.duplicates).toBe(1);
    expect(m.widened.count).toBe(2);
    expect(m.widened.meanScore).toBe(3);
    expect(m.widened.hitRate).toBe(0.5);
    expect(m.lane.count).toBe(2);
    expect(m.widened.byStep.role_pool).toEqual({ count: 1, meanScore: 4 });
  });

  it("overall averages per profile and pools the reasons", () => {
    const a = [j(1, 5), j(2, 5)];
    const b = [j(1, 1)];
    const o = overallMetrics([{ metrics: profileMetrics(a), items: a }, { metrics: profileMetrics(b), items: b }]);
    expect(o.p10).toBeCloseTo((0.2 + 0) / 2);
    expect(o.judged).toBe(3);
    expect(o.meanScorePooled).toBeCloseTo(11 / 3);
    expect(o.meanScoreMacro).toBeCloseTo((5 + 1) / 2);
    expect(o.reasonShares.wrong_function).toBeCloseTo(1 / 3);
  });
});

describe("spend ledger", () => {
  it("records tokens per phase and model with the price table", () => {
    const ledger = new Ledger(null, 10);
    ledger.phase = "judge";
    ledger.record("gpt-4.1", { promptTokens: 1_000_000, completionTokens: 100_000 });
    const p = PRICES_USD_PER_MILLION["gpt-4.1"]!;
    expect(ledger.totalUsd()).toBeCloseTo(p.input + 0.1 * p.output);
    expect(ledger.phaseUsd("judge")).toBeCloseTo(ledger.totalUsd());
    expect(ledger.phaseUsd("resume")).toBe(0);
  });

  it("refuses a call that would pass the cap, before the vendor is called", async () => {
    const ledger = new Ledger(null, 0.001);
    let called = 0;
    const fake = createFakeProvider();
    const provider = instrumentProvider({ ...fake, name: "fake", chat: async (r) => { called++; return fake.chat(r); }, embed: (r) => fake.embed(r) }, ledger);
    const req = { model: "gpt-4.1", messages: [{ role: "user" as const, content: "x".repeat(30_000) }], temperature: 0 };
    expect(estimateChatUsd(req)).toBeGreaterThan(0.001);
    await expect(provider.chat(req)).rejects.toBeInstanceOf(BudgetStopError);
    expect(called).toBe(0);
  });

  it("lets a call through under the cap and adds it to the total", async () => {
    const ledger = new Ledger(null, 5);
    const provider = instrumentProvider(createFakeProvider(), ledger);
    const res = await provider.embed({ model: "text-embedding-3-small", texts: ["hello"] });
    expect(res.vectors).toHaveLength(1);
    expect(ledger.byPhaseModel()).toHaveLength(1);
  });
});
