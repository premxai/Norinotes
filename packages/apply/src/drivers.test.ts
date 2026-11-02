import { describe, expect, it } from "vitest";
import { ashbyFormUrl, defaultUnknownFormHandler, detectDriver, greenhouseFormUrl, leverFormUrl, UNSUPPORTED_FORM_REASON } from "./drivers/index.js";
import { classifyField, cleanLabel, eeoValue, foreignWorkCountry, phoneCountryValue, questionId } from "./form.js";
import type { DriverContext } from "./types.js";

const ID = "5f1c2a3b-0000-4000-8000-123456789abc";

describe("driver detection by URL", () => {
  it("routes Greenhouse boards, new job-boards, EU and gh_jid links", () => {
    expect(detectDriver("https://boards.greenhouse.io/acme/jobs/123")?.name).toBe("greenhouse");
    expect(detectDriver("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")?.name).toBe("greenhouse");
    expect(detectDriver("https://boards.eu.greenhouse.io/acme/jobs/123")?.name).toBe("greenhouse");
    expect(detectDriver("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")?.name).toBe("greenhouse");
    expect(detectDriver("https://acme.com/careers?gh_jid=123")?.name).toBe("greenhouse");
    expect(detectDriver("https://boards.greenhouse.io/acme")).toBeNull(); // a board index is not a posting
  });

  it("routes Lever and Ashby postings, and decides by host, not by path", () => {
    expect(detectDriver(`https://jobs.lever.co/acme/${ID}`)?.name).toBe("lever");
    expect(detectDriver(`https://jobs.eu.lever.co/acme/${ID}/apply`)?.name).toBe("lever");
    expect(detectDriver(`https://jobs.ashbyhq.com/acme/${ID}`)?.name).toBe("ashby");
    expect(detectDriver("https://jobs.lever.co/acme")).toBeNull();
    expect(detectDriver("https://jobs.ashbyhq.com/acme")).toBeNull();
    expect(detectDriver(`https://evil.example/jobs.lever.co/acme/${ID}`)).toBeNull();
  });

  it("returns null for anything else", () => {
    expect(detectDriver("https://acme.com/careers/42")).toBeNull();
    expect(detectDriver("https://jobs.smartrecruiters.com/Acme/743999-engineer")).toBeNull();
    expect(detectDriver("mailto:jobs@acme.com")).toBeNull();
    expect(detectDriver("not a url")).toBeNull();
  });
});

describe("straight to the form", () => {
  it("derives each system's form address from the posting", () => {
    expect(greenhouseFormUrl("https://boards.greenhouse.io/acme/jobs/4012345?gh_src=x")).toBe("https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345");
    expect(greenhouseFormUrl("https://job-boards.greenhouse.io/acme/jobs/9")).toBe("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=9");
    expect(greenhouseFormUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=9")).toBe("https://boards.greenhouse.io/embed/job_app?for=acme&token=9");
    expect(greenhouseFormUrl("https://acme.com/careers?gh_jid=1")).toBeNull();
    expect(leverFormUrl(`https://jobs.lever.co/acme/${ID}`)).toBe(`https://jobs.lever.co/acme/${ID}/apply`);
    expect(leverFormUrl(`https://jobs.lever.co/acme/${ID}/apply?lever-source=X#y`)).toBe(`https://jobs.lever.co/acme/${ID}/apply?lever-source=X`);
    expect(ashbyFormUrl(`https://jobs.ashbyhq.com/acme/${ID}`)).toBe(`https://jobs.ashbyhq.com/acme/${ID}/application`);
    expect(ashbyFormUrl(`https://jobs.ashbyhq.com/acme/${ID}/application`)).toBe(`https://jobs.ashbyhq.com/acme/${ID}/application`);
    expect(leverFormUrl("https://example.com/acme/1")).toBeNull();
  });
});

describe("unknown forms", () => {
  it("default handler parks the application as needs_user", async () => {
    const events: string[] = [];
    const ctx = { applyUrl: "https://acme.com/x", onEvent: (_s: string, m: string) => { events.push(m); } } as unknown as DriverContext;
    const r = await defaultUnknownFormHandler.handle({} as never, ctx);
    expect(r.status).toBe("needs_user");
    expect(r.needsUser).toEqual({ kind: "unsupported", reason: "This form type is not supported yet" });
    expect(UNSUPPORTED_FORM_REASON).toBe("This form type is not supported yet");
    expect(events).toEqual(["This form type is not supported yet"]);
  });
});

describe("field classification and labels", () => {
  const c = (label: string) => classifyField({ label, kind: "text" });
  it("classifies labels", () => {
    expect(c("First Name")).toBe("first_name");
    expect(c("Resume/CV")).toBe("resume");
    expect(c("Will you require visa sponsorship?")).toBe("sponsorship");
    expect(c("Are you legally authorized to work in the United States?")).toBe("work_auth");
    expect(c("Location (City)")).toBe("location");
    expect(c("Gender")).toBe("gender");
    expect(c("Are you a protected veteran?")).toBe("veteran");
    expect(c("Do you have a disability?")).toBe("disability");
    expect(c("Are you Hispanic/Latino?")).toBe("hispanic");
    expect(c("Race")).toBe("race");
    expect(c("Why do you want to work here?")).toBe("custom");
  });

  it("cleans decorated labels", () => {
    expect(cleanLabel("Full name✱")).toBe("Full name");
    expect(cleanLabel("Email address *")).toBe("Email address");
    expect(cleanLabel("RaceHispanic or LatinoWhite", ["Hispanic or Latino", "White"])).toBe("Race");
  });

  it("makes stable question ids", () => {
    expect(questionId("Why do you want to work here? *")).toBe("why-do-you-want-to-work-here");
    expect(questionId("  ")).toBe("question");
  });

  it("derives the phone country and refuses to answer foreign work-authorisation questions from US data", () => {
    const p = { fullName: "A B", firstName: "A", lastName: "B", email: "a@b.c", workAuth: {} };
    expect(phoneCountryValue({ ...p, phone: "+1 415 555 0100" })).toBe("United States");
    expect(phoneCountryValue({ ...p, phone: "+44 20 7946 0000" })).toBe("United Kingdom");
    expect(phoneCountryValue({ ...p, phone: "415 555 0100" })).toBeUndefined();
    expect(foreignWorkCountry("Are you authorized to work in the UK?")).toBe("UK");
    expect(foreignWorkCountry("Are you authorized to work in the United States?")).toBeNull();
  });

  it("turns an equal-opportunity default of decline into the form's own decline option", () => {
    const profile = { fullName: "A B", firstName: "A", lastName: "B", email: "a@b.c", workAuth: {}, eeo: { gender: "decline", veteran: "I am not a veteran" } };
    expect(eeoValue("gender", profile, ["Male", "Female", "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(eeoValue("gender", profile, ["Male", "Female"])).toBeUndefined();
    expect(eeoValue("veteran", profile, undefined)).toBe("I am not a veteran");
    expect(eeoValue("race", profile, ["Asian"])).toBeUndefined();
  });
});
