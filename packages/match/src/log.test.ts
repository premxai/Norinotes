import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, BudgetExceededError } from "@norinote/ai";
import { warnSwallowed } from "./log.js";

afterEach(() => vi.restoreAllMocks());

describe("warnSwallowed", () => {
  it("logs one JSON warn line with the error class and code, never its message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSwallowed("match.explain_failed", new TypeError("cannot read 'fit' of Jane Doe's row"));
    warnSwallowed("match.outcome_learning_failed", Object.assign(new Error("Failed query: params: jane@example.com"), { cause: { code: "22P02" } }));
    expect(warn).toHaveBeenCalledTimes(2);
    const [first, second] = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(first).toMatchObject({ level: "warn", event: "match.explain_failed", error: "TypeError" });
    expect(second).toMatchObject({ level: "warn", event: "match.outcome_learning_failed", error: "Error", code: "22P02" });
    for (const c of warn.mock.calls) expect(String(c[0])).not.toMatch(/Jane|jane@example\.com/);
  });

  it("stays quiet for the expected ones: over budget and the AI service unavailable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnSwallowed("match.explain_failed", new BudgetExceededError("u", 10, 5));
    warnSwallowed("match.explain_failed", new AiUnavailableError("auth", 401));
    expect(warn).not.toHaveBeenCalled();
  });
});
