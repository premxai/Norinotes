import { describe, expect, it } from "vitest";
import { parseContact, parseLocation } from "./contact.js";
import { SAMPLE_RESUME } from "./testkit.js";

describe("parseContact", () => {
  it("reads the header of a typical resume", () => {
    expect(parseContact(SAMPLE_RESUME)).toEqual({
      fullName: "Priya Raman", email: "priya.raman@example.com", phone: "(415) 555-0132",
      linkedin: "https://linkedin.com/in/priyaraman", github: "https://github.com/priyaraman", website: null,
      location: "San Francisco, CA", city: "San Francisco", state: "CA", country: "United States",
    });
  });

  it("handles an all-caps name, credentials, a personal site and an international phone", () => {
    const c = parseContact("JOSÉ MARÍA DE LA CRUZ, MBA\nWebsite: https://www.josecruz.dev/ | +44 20 7946 0958 | London, United Kingdom\njose@josecruz.dev\n\nSUMMARY\nEngineer.");
    expect(c.fullName).toBe("José María de la Cruz");
    expect(c.phone).toBe("+44 20 7946 0958");
    expect(c.website).toBe("https://josecruz.dev");
    expect(c.email).toBe("jose@josecruz.dev");
    expect(c.location).toBe("London, United Kingdom");
    expect(c.country).toBe("United Kingdom");
  });

  it("does not mistake date ranges or section headings for a phone number or a name", () => {
    const c = parseContact("EXPERIENCE\nEngineer | Acme | 2019 - 2022\n");
    expect(c.phone).toBeNull();
    expect(c.fullName).toBeNull();
  });

  it("prefers hyperlink targets over visible text and accepts mailto and tel links", () => {
    const c = parseContact("Sam Lee\nreach me\n", [
      { url: "mailto:sam@lee.io" }, { url: "tel:+1-206-555-0100", anchor: "206.555.0100" },
      { url: "https://www.linkedin.com/in/samlee/?utm=1" }, { url: "https://github.com/samlee/some-repo" },
    ]);
    expect(c).toMatchObject({ fullName: "Sam Lee", email: "sam@lee.io", phone: "206.555.0100", linkedin: "https://linkedin.com/in/samlee", github: "https://github.com/samlee" });
  });

  it("reads labelled handles", () => {
    const c = parseContact("Ana Pop\nGitHub: anapop | LinkedIn: in/ana-pop\n");
    expect(c.github).toBe("https://github.com/anapop");
    expect(c.linkedin).toBe("https://linkedin.com/in/ana-pop");
  });

  it("returns nulls for text with no contact details", () => {
    expect(parseContact("")).toEqual({ fullName: null, email: null, phone: null, linkedin: null, github: null, website: null, location: null, city: null, state: null, country: null });
  });

  it("survives pathological input quickly", () => {
    const started = Date.now();
    parseContact(`${"1 ".repeat(30_000)}\n${"a".repeat(100_000)}`);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("parseLocation", () => {
  it.each([
    ["Austin, TX 78701", "Austin, TX", "United States"],
    ["Toronto, ON", "Toronto, ON", "Canada"],
    ["Bengaluru, Karnataka, India", "Bengaluru, Karnataka, India", "India"],
    ["Location: Berlin, Germany", "Berlin, Germany", "Germany"],
  ])("%s", (input, location, country) => {
    expect(parseLocation(input)).toMatchObject({ location, country });
  });
  it("rejects things that are not places", () => {
    expect(parseLocation("Acme, Inc")).toBeNull();
    expect(parseLocation("Python, Go")).toBeNull();
  });
});
