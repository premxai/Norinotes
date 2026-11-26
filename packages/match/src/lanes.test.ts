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
    ["ML Engineer", "Machine Learning Engineer"],
    ["Machine Learning Engineer", "Senior ML Engineer"],
    ["Frontend Engineer", "Front-End Engineer"],
    ["Front End Engineer", "Senior Frontend Engineer"],
    ["Full-Stack Engineer", "Fullstack Engineer"],
    ["Data Scientist", "Data Science Manager"],
    ["Data Scientist", "Senior Data Scientists, Ads"],
    ["SWE", "Software Engineer II"],
    ["PM", "Senior Product Manager, Payments"],
    ["SRE", "Site Reliability Engineer"],
    ["QA Engineer", "Quality Assurance Engineer"],
    ["UX Designer", "Senior User Experience Designer"],
    ["AI Engineer", "Artificial Intelligence Engineer"],
    ["Software Engineer", "Software Engineering Manager"],
    ["Machine Learning Engineer", "Senior Software Engineer, Machine Learning"],
  ])("lane %j fits job %j", (lane, job) => expect(titleMatches(lane, job)).toBe(true));

  it.each([
    ["Software Engineer", "Marketing Manager"],
    ["Software Engineer", "Engineering Manager"],
    ["Software Engineer", "Software Sales Representative"],
    ["Data Scientist", "Data Analyst"],
    ["Machine Learning Engineer", "Software Engineer"],
    ["Backend Engineer", "Frontend Engineer"],
    ["Product Manager", "Product Marketing Manager"],
    ["Account Executive", "Executive Assistant to the Account Director"],
    ["PM", "Product Operations Manager"],
    ["Frontend Engineer", "Backend Engineer"],
    ["Data Scientist", "Data Analyst"],
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
    // A city lane covers its metro area: the Bay Area for San Francisco, the Eastside for Seattle.
    expect(locationMatches("San Francisco, CA", "Palo Alto, CA")).toBe(true);
    expect(locationMatches("San Francisco, CA", "Mountain View, California, United States")).toBe(true);
    expect(locationMatches("Seattle, WA", "Bellevue, WA")).toBe(true);
    expect(locationMatches("San Francisco, CA", "San Diego, CA")).toBe(false);
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
    expect(locationMatches("United States", "Austin, Texas")).toBe(true);
    expect(locationMatches("United States", "San Francisco, CA")).toBe(true);
    expect(locationMatches("US", "Remote - Germany")).toBe(false);
    expect(locationMatches("United States", "London, UK")).toBe(false);
  });

  it("reads a lane state or country as an area, not as words", () => {
    expect(locationMatches("California", "San Francisco, CA")).toBe(true);
    expect(locationMatches("California", "Mountain View")).toBe(true);
    expect(locationMatches("CA", "Los Angeles, California")).toBe(true);
    expect(locationMatches("California", "Austin, TX")).toBe(false);
    expect(locationMatches("Oregon", "Portland, ME")).toBe(false);
    expect(locationMatches("Washington", "Seattle, WA")).toBe(true);
    expect(locationMatches("Texas", "Remote - US; Austin, TX")).toBe(true);
  });

  it("treats a city and its other names as the same place, both ways", () => {
    expect(locationMatches("NYC", "New York, NY")).toBe(true);
    expect(locationMatches("New York, NY", "NYC - 1211 Ave of the Americas")).toBe(true);
    expect(locationMatches("SF Bay Area", "San Francisco, CA")).toBe(true);
    expect(locationMatches("Bay Area", "Palo Alto, CA")).toBe(true);
    expect(locationMatches("San Francisco", "SF Bay Area")).toBe(true);
    expect(locationMatches("NYC", "Jersey City, NJ")).toBe(true);
  });

  it("keeps a city lane to the state and country it names", () => {
    expect(locationMatches("Portland, OR", "Portland, ME")).toBe(false);
    expect(locationMatches("Portland, OR", "Portland, Oregon")).toBe(true);
    expect(locationMatches("Portland, ME", "Portland, ME")).toBe(true);
    expect(locationMatches("Washington, DC", "Seattle, Washington")).toBe(false);
    expect(locationMatches("Washington, DC", "Washington, D.C.")).toBe(true);
    expect(locationMatches("Cambridge, MA", "Cambridge, United Kingdom")).toBe(false);
    expect(locationMatches("Cambridge, MA", "Cambridge, MA")).toBe(true);
    expect(locationMatches("Boston, MA", "Cambridge, United Kingdom")).toBe(false);
    expect(locationMatches("Portland, OR", "Portland, ME; Portland, OR")).toBe(true);
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
