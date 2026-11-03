import { describe, expect, it } from "vitest";
import { displaySkill, isCategoryLabel, isDegree, isFillerLine, sharesFact } from "./facts.js";

describe("facts", () => {
  it("finds the same fact in two lines, not just the same number", () => {
    expect(sharesFact("Precept nurses; led a unit project that reduced falls by 28% with hourly rounding", "Led a unit project that reduced patient falls by 28%")).toBe(true);
    expect(sharesFact("Migrated a 200-component Angular 1 app to React", "Built charting in React; handled tables of 1M+ rows")).toBe(false);
    expect(sharesFact("President's Club 2024 and 2025", "Closed $2.1M in 2025 (131% of quota)")).toBe(false);
    expect(sharesFact("Cut AWS spend by $1.1M a year", "Cut pages per week from 14 to 5")).toBe(false);
  });

  it("spots parser filler that says nothing beyond the title and organisation", () => {
    expect(isFillerLine("Provided nursing assistant support at Lakeshore Regional Hospital.", "Nursing Assistant (CNA)", "Lakeshore Regional Hospital")).toBe(true);
    expect(isFillerLine("Cared for post-operative adult patients; wound care and IV therapy", "Registered Nurse", "Lakeshore Regional Hospital")).toBe(false);
    expect(isFillerLine("Booked 25+ qualified meetings per month", "Sales Development Representative", "Beacon")).toBe(false);
  });

  it("knows category labels and degrees from skills, and capitalises lower-case names", () => {
    for (const s of ["Backend and Other Technologies", "Build and Test Tools", "Frontend Frameworks and Libraries", "Patient Care Skills", "Styling and Design Systems"]) {
      expect(isCategoryLabel(s), s).toBe(true);
    }
    for (const s of ["Research and Development", "Design Systems", "Testing Library", "CI/CD"]) expect(isCategoryLabel(s), s).toBe(false);
    expect(isDegree("BSN")).toBe(true);
    expect(isDegree("B.S.")).toBe(true);
    expect(isDegree("Python")).toBe(false);
    expect(displaySkill("nursing")).toBe("Nursing");
    expect(displaySkill("pandas")).toBe("pandas");
    expect(displaySkill("TypeScript")).toBe("TypeScript");
  });
});
