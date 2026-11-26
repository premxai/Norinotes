import { describe, expect, it } from "vitest";
import { OUTCOME_REASON_PREFIX } from "./outcomes.js";
import { withReason } from "./reasons.js";

describe("withReason", () => {
  const nudge = `${OUTCOME_REASON_PREFIX}5 of 6 data analysis applications led to a reply or interview, against 5 of 12 overall (+0.02 fit)`;

  it("inserts the line and trims to three, keeping Gap lines and dropping other lines from the end", () => {
    expect(withReason(["Strong evidence for A", "Strong evidence for B", "Gap: C"], "Why", 0)).toEqual(["Why", "Strong evidence for A", "Gap: C"]);
    expect(withReason(["Strong evidence for A", "Strong evidence for B", "Gap: C"], nudge, 1)).toEqual(["Strong evidence for A", nudge, "Gap: C"]);
    expect(withReason(["Strong evidence for A", "Gap: B", "Gap: C"], "Why", 0)).toEqual(["Why", "Gap: B", "Gap: C"]);
    expect(withReason(["A"], nudge, 1)).toEqual(["A", nudge]);
    expect(withReason([], nudge, 1)).toEqual([nudge]);
  });

  it("keeps the outcome nudge's reason, which the raw fit is read back from", () => {
    expect(withReason(["Strong evidence for A", nudge, "Gap: C"], "Why", 0)).toEqual(["Why", nudge, "Gap: C"]);
    expect(withReason(["Strong evidence for A", nudge, "Strong evidence for B"], "Why", 0)).toEqual(["Why", "Strong evidence for A", nudge]);
  });
});
