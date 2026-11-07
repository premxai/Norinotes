import { describe, expect, it } from "vitest";
import { pickLocation } from "./fill.js";

describe("picking a location suggestion", () => {
  it("matches the city and the spelled-out state, never a look-alike", () => {
    const texts = ["San Francisco, California, United States", "San Francisco de Macorís, Duarte, Dominican Republic", "South San Francisco, California, United States", "San Francisco, Cebu, Philippines"];
    expect(pickLocation(texts, "San Francisco, CA, United States")).toBe(0);
    expect(pickLocation(texts, "San Francisco, Cebu")).toBe(3);
    expect(pickLocation(["Austin, Texas, United States"], "San Francisco, CA")).toBe(-1);
  });
});
