import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeCompany, normalizeText } from "./dedupe.js";

describe("dedupeKey", () => {
  const base = { companyName: "Acme, Inc.", title: "Senior Engineer (Platform)", location: "New York, NY" };

  it("is stable across case, punctuation, accents and legal suffixes", () => {
    const key = dedupeKey(base);
    expect(key).toBe("acme|senior engineer platform|new york ny");
    expect(dedupeKey({ companyName: "ACME INC", title: "senior engineer - platform", location: "new york,  ny" })).toBe(key);
    expect(dedupeKey({ companyName: "Acme", title: "Senior Engineer (Platform)", location: "New York NY" })).toBe(key);
    expect(dedupeKey({ companyName: "Café Ltd", title: "Chef", location: null })).toBe("cafe|chef|");
  });

  it("is deterministic", () => {
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base }));
  });

  it("separates different roles, companies and places", () => {
    const key = dedupeKey(base);
    expect(dedupeKey({ ...base, title: "Staff Engineer (Platform)" })).not.toBe(key);
    expect(dedupeKey({ ...base, location: "Remote" })).not.toBe(key);
    expect(dedupeKey({ ...base, companyName: "Globex" })).not.toBe(key);
  });

  it("normalises pieces", () => {
    expect(normalizeText("R&D / Ops")).toBe("r and d ops");
    expect(normalizeCompany("Foo Corp Inc")).toBe("foo");
    expect(normalizeCompany("Inc")).toBe("inc");
  });
});
