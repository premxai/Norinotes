import { describe, expect, it } from "vitest";
import type { JobSpec } from "@norinote/shared";
import { toRequirements } from "./serialize.js";

const spec = (over: Partial<JobSpec> = {}): JobSpec => ({
  mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "software engineering", yearsMin: null,
  location: { remote: "onsite", countries: ["US"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [], ...over,
});

describe("toRequirements", () => {
  it("names who meets a citizenship restriction", () => {
    expect(toRequirements(spec({ citizenshipRequired: true })).disqualifiers).toEqual(["Requires US citizenship"]);
    expect(toRequirements(spec({ citizenshipRequired: true, citizenshipScope: "citizen" })).disqualifiers).toEqual(["Requires US citizenship"]);
    expect(toRequirements(spec({ citizenshipRequired: true, citizenshipScope: "us_person" })).disqualifiers).toEqual(["Requires US citizenship or permanent residency"]);
    expect(toRequirements(spec({ citizenshipScope: "us_person" })).disqualifiers).toEqual([]);
  });
});
