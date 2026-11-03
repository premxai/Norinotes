import { describe, expect, it } from "vitest";
import { countryOf, parseLocation, placeAllowed, placeFactor, placeLabel } from "./location.js";

const US = new Set(["US"]);
const UK = new Set(["GB"]);

describe("parseLocation", () => {
  it.each([
    // [text, countries, states, regions, remote]
    ["NYC - 1211 Ave of the Americas", ["US"], ["NY"], "unknown"],
    ["California - San Francisco", ["US"], ["CA"], "unknown"],
    ["US-CA-San Francisco", ["US"], ["CA"], "unknown"],
    ["San Francisco, CA", ["US"], ["CA"], "unknown"],
    ["Austin, TX", ["US"], ["TX"], "unknown"],
    ["New York - New York", ["US"], ["NY"], "unknown"],
    ["Washington - Seattle", ["US"], ["WA"], "unknown"],
    ["Menlo Park", ["US"], ["CA"], "unknown"],
    ["New Mexico", ["US"], ["NM"], "unknown"],
    ["Saint Cloud, MN, United States", ["US"], ["MN"], "unknown"],
    ["US PA Home Office", ["US"], ["PA"], "remote"],
    ["Texas - Remote", ["US"], ["TX"], "remote"],
    ["Remote (United States)", ["US"], [], "remote"],
    ["USA (Remote)", ["US"], [], "remote"],
    ["Remote, US", ["US"], [], "remote"],
    ["US-Remote", ["US"], [], "remote"],
    ["Hybrid (New York, New York, US) | Hybrid (New York, NY, US)", ["US"], ["NY"], "hybrid"],
    ["Remote - Philippines", ["PH"], [], "remote"],
    ["Remote, UK", ["GB"], [], "remote"],
    ["Brazil", ["BR"], [], "unknown"],
    ["State of São Paulo, Brazil", ["BR"], [], "unknown"],
    ["Taiwan - Remote", ["TW"], [], "remote"],
    ["Japan - Tokyo - Remote", ["JP"], [], "remote"],
    ["Toronto", ["CA"], [], "unknown"],
    ["London", ["GB"], [], "unknown"],
  ] as Array<[string, string[], string[], string]>)("%s", (text, countries, states, remote) => {
    const p = parseLocation(text);
    expect(new Set(p.countries)).toEqual(new Set(countries));
    expect(new Set(p.states)).toEqual(new Set(states));
    expect(p.remote).toBe(remote);
    expect(p.unknown).toBe(false);
  });

  it("reads supranational regions", () => {
    expect(parseLocation("Europe Remote - Parking")).toMatchObject({ countries: [], regions: ["EU"], remote: "remote" });
    expect(parseLocation("EMEA").regions).toEqual(["EU"]);
    expect(parseLocation("Remote - LATAM").regions).toEqual(["LATAM"]);
    expect(parseLocation("Remote (Worldwide)").regions).toEqual(["GLOBAL"]);
  });

  it("knows several countries in one listing", () => {
    expect(new Set(parseLocation("Zürich, Switzerland | remote, Germany | remote or office, Switzerland").countries)).toEqual(new Set(["CH", "DE"]));
    expect(new Set(parseLocation("US, UK, Canada Remote").countries)).toEqual(new Set(["US", "GB", "CA"]));
    expect(new Set(parseLocation("Indonesia | Singapore | Malaysia | Thailand | Dubai, Dubai, United Arab Emirates").countries)).toEqual(new Set(["ID", "SG", "MY", "TH", "AE"]));
  });

  it("never reads ordinary lower-case words as state or country codes", () => {
    // "or" is not Oregon, "in" is not India or Indiana, "at" is not Austria.
    expect(parseLocation("remote or office, Switzerland").countries).toEqual(["CH"]);
    expect(parseLocation("Work in office at HQ").countries).toEqual([]);
  });

  it("leaves unknown and multi-place text unknown", () => {
    expect(parseLocation("2 Locations")).toMatchObject({ unknown: true, multiple: true, countries: [] });
    expect(parseLocation("Remote")).toMatchObject({ unknown: true, remote: "remote" });
    expect(parseLocation(null)).toMatchObject({ unknown: true, remote: "unknown" });
    expect(parseLocation("Somewhere Nice", true).remote).toBe("remote");
  });

  it("countryOf gives one country or none", () => {
    expect(countryOf("New York, NY")).toBe("US");
    expect(countryOf("Remote (Philadelphia, PA)")).toBe("US");
    expect(countryOf("London, UK")).toBe("GB");
    expect(countryOf("US, UK, Canada Remote")).toBeNull();
    expect(countryOf(null)).toBeNull();
  });
});

describe("placeAllowed", () => {
  it.each([
    "Europe Remote - Parking", "Remote - Philippines", "Brazil", "EMEA", "Remote, UK", "Taiwan - Remote", "South Africa - Remote",
    "Zürich, Switzerland | remote, Germany | remote or office, Switzerland", "Metro Manila, Philippines", "Toronto",
  ])("a US-based user cannot take %j", (text) => expect(placeAllowed(parseLocation(text), US)).toBe(false));

  it.each([
    "Remote", "Remote (United States)", "US, UK, Canada Remote", "California - San Francisco Metro - Remote", "2 Locations",
    "NYC - 1211 Ave of the Americas", "Remote (Worldwide)", "Remote - North America", "Georgia - Remote",
  ])("a US-based user can take %j", (text) => expect(placeAllowed(parseLocation(text), US)).toBe(true));

  it("works the other way round for a UK-based user", () => {
    expect(placeAllowed(parseLocation("Remote - US"), UK)).toBe(false);
    expect(placeAllowed(parseLocation("Europe Remote"), UK)).toBe(true);
    expect(placeAllowed(parseLocation("Remote, UK"), UK)).toBe(true);
    expect(placeAllowed(parseLocation("Remote"), UK)).toBe(true);
  });

  it("allows everything when nothing is known about the user", () => {
    expect(placeAllowed(parseLocation("Remote - Philippines"), new Set())).toBe(true);
  });

  it("labels the place for a gate reason and rates unreadable places a little lower", () => {
    expect(placeLabel(parseLocation("Europe Remote - Parking"))).toBe("Europe");
    expect(placeLabel(parseLocation("Remote - Philippines"))).toBe("Philippines");
    expect(placeLabel(parseLocation("Remote, UK"))).toBe("United Kingdom");
    expect(placeFactor("2 Locations")).toBeLessThan(1);
    expect(placeFactor(null)).toBeLessThan(1);
    expect(placeFactor("Remote")).toBe(1);
    expect(placeFactor("San Francisco, CA")).toBe(1);
  });
});
