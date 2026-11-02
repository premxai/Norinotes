import { describe, expect, it } from "vitest";
import { laneFitsJob, locationMatches, matchingLanes, significantTitleWords, titleMatches } from "./lanes.js";

describe("title matching", () => {
  it("drops seniority and filler from the lane title", () => {
    expect(significantTitleWords("Senior Software Engineer II")).toEqual(["software", "engineer"]);
    expect(significantTitleWords("New Grad Software Developer")).toEqual(["software", "engineer"]);
    // All filler: keep the words rather than match everything.
    expect(significantTitleWords("Senior")).toEqual(["senior"]);
  });

  it.each([
    ["Software Engineer", "Software Engineer II, Payments"],
    ["Senior Software Engineer", "Software Engineer"],
    ["Software Engineer", "Staff Software Developer"],
    ["Software Engineer", "Senior Software Engineers (Backend)"],
    ["Backend Engineer", "Sr. Backend Engineer - Remote"],
    ["Data Scientist", "Senior Data Scientist, Growth"],
    ["Machine Learning Engineer", "Machine Learning Research Engineer"],
    ["Product Designer", "Product Designer (Contract)"],
  ])("lane %j fits job %j", (lane, job) => expect(titleMatches(lane, job)).toBe(true));

  it.each([
    ["Software Engineer", "Marketing Manager"],
    ["Software Engineer", "Engineering Manager"],
    ["Software Engineer", "Software Sales Representative"],
    ["Data Scientist", "Data Analyst"],
    ["Machine Learning Engineer", "Software Engineer"],
    ["Backend Engineer", "Frontend Engineer"],
  ])("lane %j does not fit job %j", (lane, job) => expect(titleMatches(lane, job)).toBe(false));

  it("tolerates one missing word in a long lane title", () => {
    expect(titleMatches("Senior Staff Machine Learning Platform Engineer", "Machine Learning Engineer")).toBe(true);
    expect(titleMatches("Machine Learning Platform Engineer", "Platform Engineer")).toBe(false);
    expect(titleMatches("Machine Learning Platform Engineer", "Machine Learning Platform Engineer")).toBe(true);
    expect(titleMatches("Applied Machine Learning Research Engineer", "Machine Learning Research Engineer")).toBe(true);
  });
});

describe("location matching", () => {
  it("matches the first part of a lane location as whole words", () => {
    expect(locationMatches("San Francisco, CA", "San Francisco Bay Area")).toBe(true);
    expect(locationMatches("San Francisco, CA", "South San Francisco, CA")).toBe(true);
    expect(locationMatches("New York, NY", "New York City")).toBe(true);
    expect(locationMatches("Austin, TX", "Austin, Texas")).toBe(true);
    expect(locationMatches("CA", "Canada")).toBe(false);
    expect(locationMatches("Rome", "Jerome, AZ")).toBe(false);
    expect(locationMatches("Austin, TX", null)).toBe(false);
  });

  it("treats United States, USA and US as the same place", () => {
    expect(locationMatches("United States", "Remote - US")).toBe(true);
    expect(locationMatches("USA", "Chicago, United States")).toBe(true);
    expect(locationMatches("US", "Austin, USA")).toBe(true);
    expect(locationMatches("United States", "Austin, Texas")).toBe(false);
  });
});

describe("lane fit", () => {
  const lane = { id: "l", name: "Eng", titles: ["Software Engineer"], locations: ["San Francisco, CA"], remote: true, minFit: 0.5, enabled: true };
  const job = (title: string, location: string | null, remote = false) => ({ title, location, remote });

  it("needs a title match and a location or remote match", () => {
    expect(laneFitsJob(lane, job("Software Engineer", "San Francisco, CA"))).toBe(true);
    expect(laneFitsJob(lane, job("Software Engineer", "Berlin", true))).toBe(true);
    expect(laneFitsJob(lane, job("Software Engineer", "Berlin", false))).toBe(false);
    expect(laneFitsJob(lane, job("Marketing Manager", "San Francisco, CA"))).toBe(false);
    expect(laneFitsJob({ ...lane, remote: false }, job("Software Engineer", "Berlin", true))).toBe(false);
  });

  it("a lane with no locations fits anywhere; a job with no location needs one of those", () => {
    expect(laneFitsJob({ ...lane, locations: [] }, job("Software Engineer", "Tokyo"))).toBe(true);
    expect(laneFitsJob(lane, job("Software Engineer", null))).toBe(false);
  });

  it("matchingLanes skips disabled lanes", () => {
    const lanes = [lane, { ...lane, id: "off", enabled: false }, { ...lane, id: "other", titles: ["Nurse"] }];
    expect(matchingLanes(lanes, job("Software Engineer", "San Francisco, CA")).map((l) => l.id)).toEqual(["l"]);
  });
});
