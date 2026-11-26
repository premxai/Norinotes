import { describe, expect, it } from "vitest";
import { targetFamilyOf } from "./target-families.js";

describe("targetFamilyOf", () => {
  it("sorts titles into the families discovery scores", () => {
    expect(targetFamilyOf("Machine Learning Engineer")).toBe("ai_ml");
    expect(targetFamilyOf("Research Scientist, LLM")).toBe("ai_ml");
    expect(targetFamilyOf("Senior Data Engineer")).toBe("data");
    expect(targetFamilyOf("Data Analyst")).toBe("data");
    expect(targetFamilyOf("Senior Product Manager")).toBe("product");
    expect(targetFamilyOf("Backend Engineer")).toBe("software");
    expect(targetFamilyOf("Product Designer")).toBe("design");
  });
  it("leaves everything else out", () => {
    expect(targetFamilyOf("Account Executive")).toBeNull();
    expect(targetFamilyOf("Registered Nurse")).toBeNull();
    expect(targetFamilyOf("Graphic Designer")).toBeNull();
    expect(targetFamilyOf("Mechanical Engineer")).toBeNull();
  });
});
