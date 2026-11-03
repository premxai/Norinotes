import { describe, expect, it } from "vitest";
import { checkGates } from "./gates.js";
import { parseWorkAuth } from "./profile.js";
import { NOW, baseSpec, profileOf } from "./test-helpers.js";

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

  it("closes the years gate only for a large gap (a smaller one is a soft penalty in the fit)", () => {
    const profile = profileOf({ experienceYears: 2 });
    expect(checkGates(baseSpec({ yearsMin: 3 }), profile).ok).toBe(true);
    expect(checkGates(baseSpec({ yearsMin: 4 }), profile).ok).toBe(true);
    const far = checkGates(baseSpec({ yearsMin: 5 }), profile);
    expect(far.ok).toBe(false);
    expect(far.reasons[0]).toBe("This role asks for 5 years of experience and you have about 2.");
    // A spec seniority alone never gates (it used to: a "director" spec closed for 2 years); a senior-or-above title does
    // for someone with under 2 years.
    expect(checkGates(baseSpec({ seniority: "director" }), profile).ok).toBe(true);
    expect(checkGates(baseSpec({ seniority: "senior" }), profile, { title: "Senior Software Engineer" }).ok).toBe(true);
    const junior = profileOf({ experienceYears: 1 });
    expect(checkGates(baseSpec(), junior, { title: "Staff Software Engineer" }).reasons).toEqual(["This role asks for about 7 years of experience and you have about 1."]);
    expect(checkGates(baseSpec(), junior, { title: "Software Engineer" }).ok).toBe(true);
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
    // A remote lane accepts a remote job in a country the user can work in. (It used to accept "Remote - Germany" for a
    // user whose lanes are all in the US: that was the Europe-remote bug.)
    expect(checkGates(baseSpec(), profileOf({ lanes: [lane({ remote: true })] }), { ...sf, location: "Remote - US", remote: true }).ok).toBe(true);
    expect(checkGates(baseSpec(), profileOf({ lanes: [lane({ remote: true })] }), { ...sf, location: "Remote", remote: true }).ok).toBe(true);
    const germany = checkGates(baseSpec(), profileOf({ lanes: [lane({ remote: true })] }), { ...sf, location: "Remote - Germany", remote: true });
    expect(germany.reasons).toEqual(["This role is limited to Germany (remote), outside the countries you can work in."]);
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

describe("checkGates: baseline failures", () => {
  const usLane = (titles: string[]) => lane({ titles, locations: ["Austin, TX", "San Francisco, CA", "New York, NY"], remote: true });
  const contractor = { title: "Business Title IT Dev Senior (Software Engineer) - Contractor", location: "Europe Remote - Parking", remote: true };

  it("keeps the Europe-remote contractor away from every US-based profile it topped", () => {
    const profiles = [
      profileOf({ location: "Austin, TX", lanes: [usLane(["Backend Engineer", "Platform Engineer", "Software Engineer"])] }),
      profileOf({ location: "San Francisco, CA", lanes: [usLane(["Senior Frontend Engineer", "Senior Software Engineer"])] }),
      profileOf({ location: "Denver, CO", lanes: [usLane(["Site Reliability Engineer", "DevOps Engineer"])] }),
      profileOf({ location: "Remote (Philadelphia, PA)", lanes: [usLane(["Frontend Engineer", "Web Developer"])] }),
    ];
    for (const p of profiles) {
      const r = checkGates(baseSpec({ seniority: "senior" }), p, contractor);
      expect(r.ok).toBe(false);
      expect(r.reasons).toContain("This role is limited to Europe (remote), outside the countries you can work in.");
    }
  });

  it.each(["Remote - Philippines", "Brazil", "EMEA", "Remote, UK", "Taiwan - Remote", "State of São Paulo, Brazil"])("closes for a US-based user: %s", (location) => {
    const p = profileOf({ location: "New York, NY", lanes: [lane({ titles: ["Account Executive"], locations: [], remote: true })] });
    expect(checkGates(baseSpec(), p, { title: "Account Executive", location, remote: /remote/i.test(location) }).ok).toBe(false);
  });

  it("lets unrestricted and US remote jobs through, and works the other way round for a UK-based user", () => {
    const us = profileOf({ location: "New York, NY", lanes: [lane({ remote: true })] });
    expect(checkGates(baseSpec(), us, { title: "Software Engineer", location: "Remote", remote: true }).ok).toBe(true);
    expect(checkGates(baseSpec(), us, { title: "Software Engineer", location: "Remote (United States)", remote: true }).ok).toBe(true);
    expect(checkGates(baseSpec(), us, { title: "Software Engineer", location: "US, UK, Canada Remote", remote: true }).ok).toBe(true);
    const uk = profileOf({ location: "London, UK", lanes: [lane({ locations: ["London"], remote: true })] });
    expect(checkGates(baseSpec(), uk, { title: "Software Engineer", location: "Remote - US", remote: true }).ok).toBe(false);
    expect(checkGates(baseSpec(), uk, { title: "Software Engineer", location: "Remote, UK", remote: true }).ok).toBe(true);
    // A country the user is authorised to work in is fine even if it is not home.
    const both = profileOf({ location: "New York, NY", lanes: [lane({ remote: true })], workAuth: { US: { citizen: true }, GB: { authorized: true } } });
    expect(checkGates(baseSpec(), both, { title: "Software Engineer", location: "Remote, UK", remote: true }).ok).toBe(true);
  });

  it("reads where the job is from the spec when the location text says only 'Remote'", () => {
    const p = profileOf({ location: "New York, NY", lanes: [lane({ remote: true })] });
    const mumbai = baseSpec({ location: { remote: "remote", countries: ["India"], cities: ["Mumbai"] } });
    expect(checkGates(mumbai, p, { title: "Senior Graphic Designer", location: "Remote", remote: true }).ok).toBe(false);
  });

  it("counts years in the job's function: a teacher with a bootcamp fails Senior Software Engineer", () => {
    let i = 0;
    const pt = (title: string, startDate: string, endDate: string | null, kind = "role") => ({
      id: `g${i++}`, kind, title, org: null, startDate, endDate, text: "", skills: [], scope: {}, metrics: {}, embedding: null,
    });
    const switcher = profileOf({
      experienceYears: 7.8, lanes: [lane({ titles: ["Frontend Engineer"], locations: [], remote: true })],
      points: [pt("Mathematics Teacher", "2018-08", "2026-06"), pt("Plantwise", "2026-01", null, "project")],
    });
    const senior = checkGates(baseSpec({ seniority: "senior", yearsMin: 5 }), switcher, { title: "Senior Software Engineer", location: null, remote: true }, { now: NOW });
    expect(senior.ok).toBe(false);
    expect(senior.reasons).toEqual(["This role asks for 5 years of experience and you have about 0 in this kind of role."]);
    // Without a number, the title's seniority still asks for about 4 years.
    expect(checkGates(baseSpec({ seniority: "mid" }), switcher, { title: "Senior Frontend Developer", location: null, remote: true }, { now: NOW }).ok).toBe(false);
    expect(checkGates(baseSpec({ seniority: "entry" }), switcher, { title: "Junior Frontend Developer", location: null, remote: true }, { now: NOW }).ok).toBe(true);
    // A job of an unknown family falls back to the whole career.
    expect(checkGates(baseSpec({ yearsMin: 5 }), switcher, { title: "Curriculum Lead", location: null, remote: true }, { now: NOW }).ok).toBe(true);
  });
});
