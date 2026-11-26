import { describe, expect, it } from "vitest";
import { classifySlot, slotValue, careerFacts, factsFrom, type PlanField } from "./index.js";
import type { SlotField } from "./slots.js";

/* Legal questions answer only the fact they ask for. A nearby fact is not that fact: the expected salary is not salary
   history, the answer for future sponsorship is not past sponsorship, a work authorisation is not a visa or a
   citizenship, and willingness to relocate is not the ability to be in an office. Everything else is the person's. */

const facts = factsFrom({
  contact: { name: "Ada Lovelace", city: "Austin", state: "TX", country: "United States" },
  location: "Austin, TX",
  workAuth: { US: { authorized: true, needsSponsorship: false } },
  salaryExpectation: { amount: 150000, currency: "USD", period: "year" },
  preferences: { willingToRelocate: false },
});
const career = careerFacts([]);
const ctx = { jobCountry: "US" };
const f = (label: string, type: SlotField["type"] = "select", options: string[] = ["Yes", "No"]): PlanField => ({ key: "q", label, type, options, required: true });
const value = (field: PlanField) => slotValue(classifySlot(field), field, facts, career, ctx);

describe("legal slots: only the fact they ask for", () => {
  it("leaves citizenship to the person when the profile states no status", () => {
    expect(value(f("Are you a U.S. citizen?"))).toMatchObject({ status: "pending" });
    expect(value(f("Are you a permanent resident or green card holder?"))).toMatchObject({ status: "pending" });
  });

  it("says nothing about salary history from the expected salary", () => {
    expect(value(f("What is your current salary?", "text", []))).toMatchObject({ status: "pending", reason: "Your profile has no salary history" });
    expect(value(f("What was your previous salary?", "text", []))).toMatchObject({ status: "pending" });
    expect(value(f("Please share your salary history", "text", []))).toMatchObject({ status: "pending" });
    // The expectation is a fact the profile holds, and the question asks for it.
    expect(value(f("What are your salary expectations?", "text", []))).toMatchObject({ status: "ready", value: "150,000 USD per year" });
  });

  it("leaves visa details and past sponsorship to the person", () => {
    expect(value(f("What visa status do you currently hold?", "text", []))).toMatchObject({ status: "pending", reason: "Your profile has no visa details" });
    expect(value(f("Do you have a valid visa to work in the US?"))).toMatchObject({ status: "pending" });
    expect(value(f("Have you ever been sponsored for an H-1B visa in the past?"))).toMatchObject({ status: "pending", reason: "Your profile has no past sponsorship" });
    // The question about now or the future is the one the profile answers.
    expect(value(f("Do you now or will you in the future require sponsorship?"))).toMatchObject({ status: "ready", value: "No" });
  });

  it("leaves office attendance to the person, and answers willingness to move", () => {
    expect(value(f("Are you willing to work from our NYC office 3 days a week or relocate?"))).toMatchObject({ status: "pending" });
    expect(value(f("Are you open to working onsite in Chicago or relocating there?"))).toMatchObject({ status: "pending" });
    expect(value(f("Are you willing to relocate to New York?"))).toMatchObject({ status: "ready", value: "No" });
  });

  it("still answers work authorisation, which the profile does hold", () => {
    expect(value(f("Are you legally authorized to work in the US?"))).toMatchObject({ status: "ready", value: "Yes" });
  });
});
