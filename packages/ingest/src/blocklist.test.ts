import { describe, expect, it } from "vitest";
import { BLOCKED_SOURCES, isBlockedBoard, isBlockedCompany, normalizeSourceKey } from "./blocklist.js";
import { BOARD_REGISTRY } from "./board-registry.js";
import { EARLY_CAREER_BOARDS } from "./board-registry-early-career.js";
import { SUPPORTED_ATS_TYPES } from "./connectors/index.js";

describe("blocklist matching", () => {
  it("catches aggregators by name or token, in any case and punctuation", () => {
    expect(isBlockedCompany({ name: "Jobgether" })).toBe(true);
    expect(isBlockedCompany({ name: "JOBGETHER" })).toBe(true);
    expect(isBlockedCompany({ token: "jobgether" })).toBe(true);
    expect(isBlockedCompany({ name: "Talent.com" })).toBe(true);
    expect(isBlockedCompany({ token: "talent-com" })).toBe(true);
    expect(isBlockedBoard("lever", "Jobgether")).toBe(true);
    expect(isBlockedBoard("ashby", "jobgether")).toBe(true);
  });

  it("matches exactly, never by substring, so real employers are untouched", () => {
    expect(isBlockedCompany({ name: "Stripe", token: "stripe" })).toBe(false);
    expect(isBlockedCompany({ name: "Jobgether Labs Inc", token: "jobgetherlabs" })).toBe(false);
    expect(isBlockedCompany({ name: "Lensator", token: "lensator" })).toBe(false);
    expect(isBlockedCompany({})).toBe(false);
  });

  it("explains every entry", () => {
    expect(BLOCKED_SOURCES.map((b) => b.name)).toContain("Jobgether");
    for (const b of BLOCKED_SOURCES) {
      expect(b.why.length).toBeGreaterThan(20);
      expect(b.tokens.every((t) => t === normalizeSourceKey(t))).toBe(true);
    }
  });
});

describe("board registry", () => {
  it("is free of blocked sources and duplicates, and only names supported job systems", () => {
    expect(BOARD_REGISTRY.filter((b) => isBlockedCompany({ name: b.name, token: b.token }))).toEqual([]);
    const keys = BOARD_REGISTRY.map((b) => `${b.atsType}:${b.token}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of BOARD_REGISTRY) expect(SUPPORTED_ATS_TYPES).toContain(b.atsType);
  });

  it("includes the early-career boards", () => {
    expect(BOARD_REGISTRY.length).toBeGreaterThan(150);
    for (const e of EARLY_CAREER_BOARDS) expect(BOARD_REGISTRY).toContainEqual(e);
  });
});
