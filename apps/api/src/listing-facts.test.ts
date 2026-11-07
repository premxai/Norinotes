import { describe, expect, it } from "vitest";
import { parseEmploymentType, parsePay, parseWorkplace } from "./listing-facts.js";

describe("pay the listing states", () => {
  it("reads ranges, units and periods", () => {
    expect(parsePay("The base salary range is $150,000 - $200,000 per year.")).toEqual({ min: 150000, max: 200000, currency: "USD", period: "year" });
    expect(parsePay("Compensation: $150K – $185K + equity")).toEqual({ min: 150000, max: 185000, currency: "USD", period: "year" });
    expect(parsePay("Pay: $60 - $80 per hour")).toEqual({ min: 60, max: 80, currency: "USD", period: "hour" });
    expect(parsePay("USD 120,000 to 150,000 annually")).toEqual({ min: 120000, max: 150000, currency: "USD", period: "year" });
    expect(parsePay("We pay $45/hr")).toEqual({ min: 45, max: 45, currency: "USD", period: "hour" });
    expect(parsePay("Salary: €70.000 - €90.000")).toMatchObject({ currency: "EUR" });
  });

  it("never guesses", () => {
    expect(parsePay("Competitive salary and great benefits")).toBeNull();
    expect(parsePay("We raised $50M - $100M in funding")).toBeNull();
    expect(parsePay("A $500 home office stipend")).toBeNull();
    expect(parsePay(null)).toBeNull();
  });
});

describe("kind of job and workplace", () => {
  it("reads them from the title and listing, else null", () => {
    expect(parseEmploymentType("Software Engineer Intern", "")).toBe("internship");
    expect(parseEmploymentType("Contract Data Engineer", "")).toBe("contract");
    expect(parseEmploymentType("Engineer", "This is a full-time role.")).toBe("full_time");
    expect(parseEmploymentType("Engineer", "Build things.")).toBeNull();
    expect(parseWorkplace("New York, NY (Hybrid)", false, "")).toBe("hybrid");
    expect(parseWorkplace("Remote - US", true, "")).toBe("remote");
    expect(parseWorkplace("Austin, TX", false, "You will work on-site in our office.")).toBe("onsite");
    expect(parseWorkplace("Austin, TX", false, "Build things.")).toBeNull();
  });
});
