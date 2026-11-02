import { describe, expect, it } from "vitest";
import { checkGates } from "./gates.js";
import { parseWorkAuth } from "./profile.js";
import { baseSpec, profileOf } from "./test-helpers.js";

const lane = (over: Partial<{ titles: string[]; locations: string[]; remote: boolean }> = {}) =>
  ({ id: "l", name: "Eng", titles: ["Software Engineer"], locations: ["San Francisco, CA"], remote: false, minFit: 0.5, enabled: true, ...over });

describe("parseWorkAuth", () => {
  it("reads the per-country form and normalises country names", () => {
    const wa = parseWorkAuth({ "United States": { authorized: true, needsSponsorship: false, citizenship: "US" }, UK: { authorised: true, requiresSponsorship: true } });
    expect(wa.countries.US).toEqual({ authorized: true, needsSponsorship: false, citizen: true, clearance: null });
    expect(wa.countries.GB).toMatchObject({ authorized: true, needsSponsorship: true, citizen: null });
    expect(wa.primary).toBe("US");
  });

  it("reads the flat form Nori used as the US entry", () => {
    const wa = parseWorkAuth({ authorizedUS: true, needsSponsorship: true, clearance: "secret" });
    expect(wa.countries.US).toEqual({ authorized: true, needsSponsorship: true, citizen: null, clearance: true });
  });

  it("prefers the country of the profile location as primary", () => {
    expect(parseWorkAuth({ US: { authorized: true }, GB: { authorized: true } }, "London, GB").primary).toBe("GB");
  });

  it("survives an empty or missing value", () => {
    expect(parseWorkAuth(null).countries).toEqual({});
    expect(parseWorkAuth({}).primary).toBeNull();
  });
});

describe("checkGates", () => {
  it("passes a plain job for a user who told us nothing", () => {
    expect(checkGates(baseSpec(), profileOf())).toEqual({ ok: true, reasons: [] });
  });

  it("closes the citizenship gate unless the profile says the user is a citizen", () => {
    const spec = baseSpec({ citizenshipRequired: true });
    const no = checkGates(spec, profileOf({ workAuth: { US: { authorized: true, needsSponsorship: false, citizen: false } } }));
    expect(no.ok).toBe(false);
    expect(no.reasons).toEqual(["This role requires US citizenship and you are not a US citizen."]);
    const unknown = checkGates(spec, profileOf());
    expect(unknown.reasons[0]).toMatch(/does not say you are a US citizen/);
    expect(checkGates(spec, profileOf({ workAuth: { US: { citizen: true } } })).ok).toBe(true);
  });

  it("closes the clearance gate unless the user holds or can obtain one", () => {
    const spec = baseSpec({ clearanceRequired: true });
    expect(checkGates(spec, profileOf({ workAuth: { US: { authorized: true, needsSponsorship: true } } })).reasons[0]).toMatch(/security clearance/);
    expect(checkGates(spec, profileOf({ workAuth: { US: { clearance: "secret" } } })).ok).toBe(true);
    expect(checkGates(spec, profileOf({ workAuth: { US: { citizen: true } } })).ok).toBe(true);
  });

  it("blocks 'no sponsorship' jobs for users who need sponsorship, in the job's country", () => {
    const spec = baseSpec({ sponsorship: "no", location: { remote: "onsite", countries: ["United States"], cities: [] } });
    const needs = checkGates(spec, profileOf({ workAuth: { US: { needsSponsorship: true } } }));
    expect(needs.ok).toBe(false);
    expect(needs.reasons[0]).toBe("This role does not offer visa sponsorship and you need it to work in US.");
    expect(checkGates(spec, profileOf({ workAuth: { US: { needsSponsorship: false } } })).ok).toBe(true);
    // Needing sponsorship in the US does not matter for a UK job.
    const uk = baseSpec({ sponsorship: "no", location: { remote: "onsite", countries: ["UK"], cities: [] } });
    expect(checkGates(uk, profileOf({ workAuth: { US: { needsSponsorship: true }, GB: { authorized: true } } })).ok).toBe(true);
    // Sponsorship "yes" or unknown never blocks.
    expect(checkGates(baseSpec({ sponsorship: "yes" }), profileOf({ workAuth: { US: { needsSponsorship: true } } })).ok).toBe(true);
    expect(checkGates(baseSpec({ sponsorship: "unknown" }), profileOf({ workAuth: { US: { needsSponsorship: true } } })).ok).toBe(true);
  });

  it("falls back to the user's main country when the job names none", () => {
    const spec = baseSpec({ sponsorship: "no" });
    expect(checkGates(spec, profileOf({ workAuth: { US: { authorized: false } } })).ok).toBe(false);
  });

  it("compares years with a little slack", () => {
    const profile = profileOf({ experienceYears: 2 });
    expect(checkGates(baseSpec({ yearsMin: 3 }), profile).ok).toBe(true);
    const far = checkGates(baseSpec({ yearsMin: 8 }), profile);
    expect(far.ok).toBe(false);
    expect(far.reasons[0]).toBe("This role asks for 8 years of experience and you have about 2.");
    // Without a number the seniority implies one, with more slack.
    expect(checkGates(baseSpec({ seniority: "senior" }), profile).ok).toBe(true);
    expect(checkGates(baseSpec({ seniority: "director" }), profile).ok).toBe(false);
    // Nothing known about the user's experience: no gate.
    expect(checkGates(baseSpec({ yearsMin: 10 }), profileOf()).ok).toBe(true);
  });

  it("checks location and remote against the lanes", () => {
    const profile = profileOf({ lanes: [lane()] });
    const sf = { title: "Software Engineer", location: "San Francisco, CA", remote: false };
    expect(checkGates(baseSpec(), profile, sf).ok).toBe(true);
    const london = checkGates(baseSpec(), profile, { ...sf, location: "London, UK" });
    expect(london.ok).toBe(false);
    expect(london.reasons[0]).toBe("This role is in London, UK, which none of your lanes cover (and it is not remote).");
    // A remote lane accepts a remote job anywhere.
    expect(checkGates(baseSpec(), profileOf({ lanes: [lane({ remote: true })] }), { ...sf, location: "Remote - Germany", remote: true }).ok).toBe(true);
    // The spec's own location rules are used when no job row is given.
    const spec = baseSpec({ location: { remote: "onsite", countries: [], cities: ["Austin"] } });
    expect(checkGates(spec, profile).ok).toBe(false);
    expect(checkGates(baseSpec(), profile).ok).toBe(true);
  });

  it("reports every reason, not just the first", () => {
    const spec = baseSpec({ citizenshipRequired: true, sponsorship: "no", yearsMin: 9 });
    const r = checkGates(spec, profileOf({ experienceYears: 1, workAuth: { US: { needsSponsorship: true } } }));
    expect(r.reasons).toHaveLength(3);
  });
});
