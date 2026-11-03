import { describe, expect, it } from "vitest";
import type { CareerPoint } from "@norinote/shared";
import { cleanStrength, cleanTitle, degreeField, roleFamily, roleHead, roleNoun, summarySkills } from "./summary.js";

const pt = (id: string, p: Partial<CareerPoint> & Pick<CareerPoint, "kind" | "title">): CareerPoint => ({
  id, org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, ...p,
});

describe("summary naming", () => {
  it("cleans a title to a plain role noun: no course codes, units, levels or parentheses", () => {
    expect(cleanTitle("Teaching Assistant, Data Structures (CS 112)")).toBe("Teaching assistant");
    expect(cleanTitle("Registered Nurse, Telemetry Unit (Charge Nurse)")).toBe("Registered nurse");
    expect(cleanTitle("Software Engineer II")).toBe("Software engineer");
    expect(cleanTitle("OP Labs - Sr. Product Manager, Fintechs & Exchanges")).toBe("Sr. product manager");
  });

  it("reads the target role family from a job title", () => {
    expect(roleFamily("Senior Frontend Software Engineer, Consumer Engineering")).toBe("frontend software engineer");
    expect(roleFamily("Director, Demand Generation")).toBe("demand generation director");
    expect(roleFamily("Data Scientist ll - RiskOS")).toBe("data scientist");
    expect(roleHead("Registered Nurse | Chemo Infusion")).toBe("nurse");
  });

  it("opens with a role the person truthfully is, or their field as a graduate", () => {
    const newGrad = [
      pt("ta", { kind: "role", title: "Teaching Assistant, Data Structures (CS 112)", startDate: "2025-01", endDate: "2026-05" }),
      pt("in", { kind: "role", title: "Software Engineering Intern", startDate: "2025-06", endDate: "2025-08" }),
      pt("ed", { kind: "education", title: "B.S. Computer Science", org: "State University", endDate: "2026" }),
    ];
    expect(roleNoun(newGrad, "Software Engineer, Product")).toBe("Computer science graduate");
    const nurse = [pt("rn", { kind: "role", title: "Registered Nurse, Telemetry Unit (Charge Nurse)", startDate: "2023-03" })];
    expect(roleNoun(nurse, "Registered Nurse | Chemo Infusion")).toBe("Registered nurse");
    expect(degreeField("B.S. in Nursing (BSN)")).toBe("Nursing");
    expect(degreeField("MBA")).toBeNull();
  });

  it("picks summary skills without fields, degrees or duplicates, and cleans a strength into one sentence", () => {
    expect(summarySkills(["BSN", "nursing", "Epic", "BI", "Power BI", "Patient Education", "Telemetry", "ACLS"], "Registered nurse")).toEqual(["Epic", "BI", "Patient Education", "Telemetry"]);
    expect(summarySkills(["Power BI", "BI", "Excel"], "Financial analyst")).toEqual(["Power BI", "Excel"]);
    expect(cleanStrength("Precept new graduate nurses (5 in 2025); led a unit project that reduced falls by 28%.")).toBe("Precept new graduate nurses");
  });
});
