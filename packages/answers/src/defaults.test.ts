import { describe, expect, it } from "vitest";
import { countryCode, countryIn, defaultAnswer, factsFrom, jobCountry, type ProfileRowLike } from "./defaults.js";
import { q } from "./test-fixtures.js";
import { distinctiveTokens, matchOption, sameSpecifics } from "./text.js";
import { fitAnswer } from "./answers.js";

const profile: ProfileRowLike = {
  contact: { name: "Ada Lovelace", phone: "+1 555 0100", email: "ada@example.test", linkedin: "linkedin.com/in/ada", github: "github.com/ada", website: "ada.dev", address1: "12 Main St", city: "Austin", state: "TX", zip: "78701", country: "United States" },
  location: "Austin, TX",
  workAuth: { US: { authorized: true, needsSponsorship: false } },
  salaryExpectation: { amount: 150000, currency: "USD", period: "year" },
  startDate: "2 weeks after an offer",
  eeo: {},
  preferences: { willingToRelocate: true },
};
const facts = factsFrom(profile);
const ctx = { jobCountry: "US" };
const ans = (text: string, type: Parameters<typeof q>[2] = "text", options: string[] = []) => defaultAnswer(q("1", text, type, options), facts, ctx);

describe("profile defaults", () => {
  it("answers work authorisation and sponsorship from the profile, with the right polarity", () => {
    expect(ans("Are you legally authorized to work in the United States?", "boolean")).toBe("Yes");
    expect(ans("Will you now or in the future require visa sponsorship?", "select", ["Yes", "No"])).toBe("No");
    expect(ans("Do you require sponsorship?", "boolean")).toBe("No");
    expect(ans("Are you able to work without sponsorship?", "select", ["Yes, I can work without sponsorship", "No, I need sponsorship"])).toBe("Yes, I can work without sponsorship");
    expect(ans("Are you authorized to work in the US?", "select", ["Yes, I am authorized", "No, I am not authorized"])).toBe("Yes, I am authorized");
  });

  it("does not answer about a country the profile says nothing about", () => {
    expect(ans("Are you legally authorized to work in Canada?", "boolean")).toBeNull();
    const noAuth = factsFrom({ ...profile, workAuth: {} });
    expect(defaultAnswer(q("1", "Do you require sponsorship?", "boolean"), noAuth, ctx)).toBeNull();
  });

  it("reads a flat work authorisation as the home country's", () => {
    const flat = factsFrom({ ...profile, workAuth: { authorized: true, needsSponsorship: true, country: "US" } });
    expect(defaultAnswer(q("1", "Will you require sponsorship?", "boolean"), flat, ctx)).toBe("Yes");
    expect(defaultAnswer(q("1", "Will you require sponsorship to work in Germany?", "boolean"), flat, ctx)).toBeNull();
  });

  it("answers salary as text, as a number when asked for one, and as the range option that holds it", () => {
    expect(ans("What are your salary expectations?")).toBe("150,000 USD per year");
    expect(ans("Desired salary (USD, numbers only)")).toBe("150000");
    expect(ans("Salary expectations", "select", ["$100,000 - $140,000", "$140,000 - $180,000", "$180,000+"])).toBe("$140,000 - $180,000");
    expect(ans("Salary expectations", "select", ["Under $100k", "$200k+"])).toBeNull();
  });

  it("answers start date, relocation, location and links", () => {
    expect(ans("When can you start?")).toBe("2 weeks after an offer");
    expect(ans("Earliest start date", "select", ["Immediately", "2 weeks after an offer", "1 month"])).toBe("2 weeks after an offer");
    expect(ans("Are you willing to relocate?", "select", ["Yes", "No"])).toBe("Yes");
    // Needing relocation is about where the person lives, not willingness (e2e run 1 answered "No" from willingToRelocate=false).
    expect(ans("Do you require relocation to work in a hybrid schedule in our SF office?", "select", ["Yes", "No"])).toBeNull();
    expect(ans("Will you need relocation assistance?", "select", ["Yes", "No"])).toBeNull();
    expect(ans("Are you open to relocation?", "select", ["Yes", "No"])).toBe("Yes");
    expect(ans("Current location")).toBe("Austin, TX");
    expect(ans("City")).toBe("Austin");
    expect(ans("LinkedIn Profile")).toBe("linkedin.com/in/ada");
    expect(ans("GitHub URL")).toBe("github.com/ada");
    expect(ans("Portfolio or personal website")).toBe("ada.dev");
    expect(ans("First name")).toBe("Ada");
    expect(ans("Last name")).toBe("Lovelace");
    expect(ans("Email")).toBe("ada@example.test");
    expect(ans("Country", "select", ["Canada", "United States", "India"])).toBe("United States");
  });

  it("defaults EEO questions to decline and maps to the form's own decline option", () => {
    expect(ans("Gender", "select", ["Male", "Female", "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(ans("Are you a protected veteran?", "select", ["Yes", "No", "Decline to self-identify"])).toBe("Decline to self-identify");
    expect(ans("Race / ethnicity", "text")).toBe("Decline to answer");
    expect(ans("Disability status", "select", ["Yes, I have a disability", "No, I do not", "Prefer not to say"])).toBe("Prefer not to say");
    // No decline option on the form: nothing is invented.
    expect(ans("Gender", "select", ["Male", "Female"])).toBeNull();
  });

  it("uses a stored EEO choice when the user made one, else still declines", () => {
    const f = factsFrom({ ...profile, eeo: { gender: "Female" } });
    expect(defaultAnswer(q("1", "Gender", "select", ["Male", "Female", "Decline"]), f, ctx)).toBe("Female");
    expect(defaultAnswer(q("1", "Veteran status", "select", ["Yes", "No", "Decline"]), f, ctx)).toBe("Decline");
  });

  it("answers how-did-you-hear with a job board and never a recruiter, referral or person", () => {
    expect(ans("How did you hear about us?")).toBe("Job board");
    expect(ans("How did you hear about this job?", "select", ["LinkedIn", "Employee referral", "Recruiter", "Job board", "Other"])).toBe("Job board");
    expect(ans("How did you hear about us?", "select", ["Recruiter Jane Doe", "Employee referral", "LinkedIn", "Other"])).toBe("LinkedIn");
    expect(ans("Where did you first hear about this role?", "select", ["Recruiter", "Employee referral", "Company website"])).toBe("Company website");
    expect(ans("How did you hear about us?", "select", ["Recruiter", "Employee referral"])).toBeNull();
    const withPref = factsFrom({ ...profile, preferences: { heardAbout: "Wellfound" } });
    expect(defaultAnswer(q("1", "How did you hear about us?"), withPref, ctx)).toBe("Wellfound");
  });

  it("never copies address line 1 into line 2", () => {
    expect(ans("Address line 1")).toBe("12 Main St");
    expect(ans("Address line 2")).toBeNull();
    const dup = factsFrom({ ...profile, contact: { ...profile.contact!, address2: "12 Main St" } });
    expect(defaultAnswer(q("1", "Address Line 2"), dup, ctx)).toBeNull();
    const real = factsFrom({ ...profile, contact: { ...profile.contact!, address2: "Apt 4B" } });
    expect(defaultAnswer(q("1", "Address Line 2"), real, ctx)).toBe("Apt 4B");
  });

  it("leaves file uploads, open questions and long prose alone", () => {
    expect(ans("Resume", "file")).toBeNull();
    expect(ans("Why do you want to work here?", "textarea")).toBeNull();
    expect(ans("Describe a time you worked with the platform team and how you handled the email thread afterwards", "textarea")).toBeNull();
  });

  it("builds facts from a bare profile without throwing", () => {
    const f = factsFrom(undefined, "me@example.test");
    expect(f.email).toBe("me@example.test");
    expect(defaultAnswer(q("1", "Email"), f, ctx)).toBe("me@example.test");
    expect(defaultAnswer(q("1", "First name"), f, ctx)).toBeNull();
  });
});

describe("countries", () => {
  it("finds a country in a question and treats 'us' as a pronoun unless written US", () => {
    expect(countryIn("Are you authorized to work in the United States?")).toBe("US");
    expect(countryIn("Authorized to work in the U.S.?")).toBe("US");
    expect(countryIn("Authorized to work in Canada?")).toBe("CA");
    expect(countryIn("Tell us about yourself")).toBeNull();
    expect(countryIn("Work in the US?")).toBe("US");
    expect(countryCode("united states of america")).toBe("US");
    expect(jobCountry({ location: { countries: ["Canada"] } }, "Toronto")).toBe("CA");
    expect(jobCountry(null, "Berlin, Germany")).toBe("DE");
  });
});

describe("option mapping", () => {
  it("maps to exactly one of the given options, never an invented one", () => {
    expect(matchOption("Yes", ["Yes, I am authorized", "No, I am not"])).toBe("Yes, I am authorized");
    expect(matchOption("no", ["Yes", "No"])).toBe("No");
    expect(matchOption("Bachelor's degree", ["Associate", "Bachelors", "Master's"])).toBe("Bachelors");
    expect(matchOption("united states", ["Canada", "United States of America"])).toBe("United States of America");
    expect(matchOption("Job board", ["Job Board", "Referral"])).toBe("Job Board");
    expect(matchOption("Maybe", ["Yes", "No"])).toBeNull();
    expect(matchOption("Purple", ["Red", "Green"])).toBeNull();
    expect(matchOption("anything", [])).toBeNull();
  });

  it("fits answers to the question type", () => {
    expect(fitAnswer(q("1", "x", "select", ["Yes", "No"]), "yes")).toBe("Yes");
    expect(fitAnswer(q("1", "x", "select", ["Yes", "No"]), "Perhaps")).toBeNull();
    expect(fitAnswer(q("1", "x", "boolean"), "No, thanks")).toBe("No");
    expect(fitAnswer(q("1", "x", "boolean"), "Perhaps")).toBeNull();
    expect(fitAnswer(q("1", "x", "multiselect", ["Python", "Go", "Rust"]), "python; rust")).toBe("Python; Rust");
    expect(fitAnswer(q("1", "x", "multiselect", ["Python", "Go", "Rust"]), "python; cobol")).toBeNull();
    expect(fitAnswer(q("1", "x", "text"), "  hello ")).toBe("hello");
    expect(fitAnswer(q("1", "x", "text"), "   ")).toBeNull();
  });
});

describe("specifics guard", () => {
  it("separates questions that differ in a number, a tool or a name", () => {
    expect(sameSpecifics("Do you have 3 years of experience with Kubernetes?", "Do you have 5 years of experience with Kubernetes?")).toBe(false);
    expect(sameSpecifics("Do you have experience with Kubernetes?", "Do you have experience with Docker?")).toBe(false);
    expect(sameSpecifics("Do you have experience with Kubernetes in production?", "Do you have experience with Kubernetes in production environments?")).toBe(true);
    expect(sameSpecifics("Are you authorized to work in the US?", "Are you authorized to work in the United States?")).toBe(true);
    // A form that Capitalises Every Word is not a different question from one in sentence case.
    expect(sameSpecifics("Are You Willing To Relocate For This Role?", "Are you willing to relocate for this role?")).toBe(true);
    expect(distinctiveTokens("Tell us about C++ and Node.js work").has("c++")).toBe(true);
  });
});
