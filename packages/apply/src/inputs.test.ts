import { describe, expect, it } from "vitest";
import { profileFromRows } from "./inputs.js";

describe("profileFromRows", () => {
  it("builds the applicant from the free-form contact and work-auth JSON", () => {
    const p = profileFromRows({ email: "login@example.test" }, {
      contact: { name: "Ada Lovelace", phone: "+1 415 555 0100", linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada" },
      location: "San Francisco, CA, USA",
      workAuth: { US: { authorized: "yes", needsSponsorship: false } },
      eeo: { gender: "decline" },
    });
    expect(p).toMatchObject({
      fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "login@example.test", phone: "+1 415 555 0100",
      location: "San Francisco, CA, USA", country: "US", workAuth: { authorizedUS: true, needsSponsorship: false }, eeo: { gender: "decline" },
    });
  });

  it("falls back to the login email, accepts flat work-auth keys, and leaves unknowns undefined", () => {
    const p = profileFromRows({ email: "login@example.test" }, {
      contact: { firstName: "Grace", lastName: "Hopper", email: "grace@navy.test" }, location: null,
      workAuth: { authorizedUS: true, needsSponsorship: "no" }, eeo: {},
    });
    expect(p).toMatchObject({ fullName: "Grace Hopper", email: "grace@navy.test", workAuth: { authorizedUS: true, needsSponsorship: false } });
    expect(p.country).toBeUndefined();
    expect(p.phone).toBeUndefined();
    const none = profileFromRows({ email: "x@y.test" }, null);
    expect(none).toMatchObject({ email: "x@y.test", fullName: "", workAuth: {} });
  });
});
