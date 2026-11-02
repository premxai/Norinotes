import { describe, expect, it } from "vitest";
import { detectRestrictions, needsUsCitizenshipOrClearance } from "./clearance.js";
import { detectSponsorship } from "./sponsorship.js";

const job = (descriptionText: string, title = "Software Engineer", extraText?: string[]) => ({ title, descriptionText, extraText });

describe("needsUsCitizenshipOrClearance", () => {
  it.each([
    "Applicants must be a U.S. citizen.",
    "Must be a US citizen or permanent resident.",
    "U.S. citizenship is required for this role.",
    "This position requires US citizenship.",
    "Candidates must be a citizen of the United States.",
    "Only United States citizens will be considered.",
    "Active TS/SCI clearance required.",
    "Must hold an active Top Secret clearance.",
    "Ability to obtain and maintain a Secret clearance.",
    "A security clearance is required for this position.",
    "Candidates must be eligible for a DoD clearance.",
    "Current DoD Secret clearance",
    "Must be able to pass a polygraph examination.",
    "This role is subject to ITAR; applicants must be U.S. persons.",
    "Due to export control regulations, candidates must be a U.S. person as defined by 22 CFR 120.62.",
    "Must be an eligible U.S. person under export control laws.",
    "Position requires an active Secret (U.S.) security clearance.",
  ])("flags: %s", (text) => {
    expect(needsUsCitizenshipOrClearance(job(text))).toBe(true);
  });

  it("flags a clearance in the title", () => {
    expect(needsUsCitizenshipOrClearance(job("Build embedded software.", "Cleared Embedded Engineer"))).toBe(true);
    expect(needsUsCitizenshipOrClearance(job("Build things.", "Systems Engineer (TS/SCI)"))).toBe(true);
  });

  it("flags a restriction found only in the extracted requirements", () => {
    expect(needsUsCitizenshipOrClearance(job("Great team.", "Engineer", ["Active Secret clearance"]))).toBe(true);
    expect(needsUsCitizenshipOrClearance(job("Great team.", "Engineer", ["Requires US citizenship"]))).toBe(true);
  });

  it("finds the restriction after a U.S. abbreviation without splitting the sentence on its periods", () => {
    expect(needsUsCitizenshipOrClearance(job("We build rockets. Candidates must be U.S. citizens. Benefits include lunch."))).toBe(true);
  });

  it.each([
    "We do not require a security clearance.",
    "No clearance required.",
    "Security clearance is not required.",
    "U.S. citizenship is not required; we sponsor visas.",
    "We welcome citizens of any country.",
    "Open to candidates regardless of citizenship.",
    "Non-US citizens are welcome to apply and we sponsor H-1B visas.",
    "A security clearance is a plus.",
    "TS/SCI clearance preferred.",
    "Active Secret clearance is nice to have.",
    "You must be authorized to work in the United States.",
    "We provide visa sponsorship for qualified candidates.",
    "Our US persons-friendly culture.",
    "Handle customs clearance for inbound freight.",
    "Clearance sale event planning and merchandising.",
    "Experience with secret sauce recipes and Sci-Fi book clubs.",
    "Our customers include citizens across the United States.",
    "Join us at the American Cancer Society fundraiser.",
    "",
  ])("does not flag: %s", (text) => {
    expect(needsUsCitizenshipOrClearance(job(text))).toBe(false);
  });

  it("does not let a negated sentence hide a separate requirement", () => {
    expect(needsUsCitizenshipOrClearance(job("We do not require a degree. Must be a U.S. citizen."))).toBe(true);
    expect(needsUsCitizenshipOrClearance(job("TS/SCI preferred. US citizenship required."))).toBe(true);
  });

  it("treats missing description and requirements as empty", () => {
    expect(needsUsCitizenshipOrClearance({ title: "Designer", descriptionText: undefined })).toBe(false);
  });
});

describe("detectRestrictions", () => {
  it("tells citizenship from clearance", () => {
    expect(detectRestrictions(job("Candidates must be U.S. citizens."))).toMatchObject({ citizenship: true, clearance: false });
    expect(detectRestrictions(job("Active TS/SCI clearance required."))).toMatchObject({ citizenship: false, clearance: true });
    expect(detectRestrictions(job("Must be a US citizen able to obtain a Secret clearance."))).toMatchObject({ citizenship: true, clearance: true });
    expect(detectRestrictions(job("Subject to ITAR export controls; U.S. persons only."))).toMatchObject({ citizenship: true });
  });

  it("reports an explicit \"none needed\" only when nothing restricts", () => {
    expect(detectRestrictions(job("We do not require a security clearance."))).toMatchObject({ citizenship: false, clearance: false, clearanceNegated: true, citizenshipNegated: false });
    expect(detectRestrictions(job("We do not require a degree. Must be a U.S. citizen."))).toMatchObject({ citizenship: true, citizenshipNegated: false, clearanceNegated: false });
    expect(detectRestrictions(job("Citizens of any country may apply. No clearance required."))).toMatchObject({ citizenshipNegated: true, clearanceNegated: true });
    expect(detectRestrictions(job("Build things."))).toMatchObject({ citizenshipNegated: false, clearanceNegated: false });
  });
});

describe("detectSponsorship", () => {
  it.each([
    "We are unable to provide visa sponsorship.",
    "Sponsorship is not available for this position.",
    "Candidates must be authorized to work without sponsorship.",
    "We cannot sponsor work visas at this time.",
    "No visa sponsorship.",
  ])("says no: %s", (t) => expect(detectSponsorship(t)).toBe("no"));

  it.each([
    "We sponsor visas for the right candidates.",
    "Visa sponsorship is available.",
    "H-1B sponsorship available for qualified candidates.",
  ])("says yes: %s", (t) => expect(detectSponsorship(t)).toBe("yes"));

  it.each(["", "Great benefits and a friendly team.", "Sponsors of our events include...", "We can sponsor visas but cannot sponsor green cards. No sponsorship for contractors."])(
    "is silent or contradictory: %s",
    (t) => expect(detectSponsorship(t)).toBeNull(),
  );
});
