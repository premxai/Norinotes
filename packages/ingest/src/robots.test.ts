import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows } from "./robots.js";

const AGENT = "norinotejobagent";

describe("parseRobots", () => {
  it("reads the * group, longest rule wins, Allow wins a tie", () => {
    const r = parseRobots("User-agent: *\nDisallow: /embed/\nAllow: /embed/ok\nDisallow: /a$\n", AGENT);
    expect(robotsAllows(r, "/v1/boards/acme/jobs")).toBe(true);
    expect(robotsAllows(r, "/embed/job_app?for=acme")).toBe(false);
    expect(robotsAllows(r, "/embed/ok/1")).toBe(true);
    expect(robotsAllows(r, "/a")).toBe(false);
    expect(robotsAllows(r, "/ab")).toBe(true);
  });

  it("prefers a group naming our agent over *, and reads Crawl-delay", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: NorinoteJobAgent\nAllow: /\nCrawl-delay: 2\n", AGENT);
    expect(robotsAllows(r, "/anything")).toBe(true);
    expect(r.delayMs).toBe(2000);
  });

  it("disallows everything for Disallow: / (SmartRecruiters' robots.txt), and an empty Disallow allows all", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /\n", AGENT), "/v1/companies/x/postings")).toBe(false);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:\n", AGENT), "/x")).toBe(true);
    expect(robotsAllows(parseRobots("", AGENT), "/x")).toBe(true);
  });
});
