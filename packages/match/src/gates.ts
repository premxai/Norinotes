import type { JobSpec } from "@norinote/shared";
import { locationFits, type JobLike } from "./lanes.js";
import { normalizeCountry, type CountryAuth, type MatchProfile } from "./profile.js";

export type GateResult = { ok: boolean; reasons: string[] };

/** Roughly how many years each seniority asks for when the posting gives no number. */
const SENIORITY_YEARS: Record<string, number> = { senior: 4, staff: 7, principal: 9, manager: 4, director: 8, executive: 10 };

const NO_INFO: CountryAuth = { authorized: null, needsSponsorship: null, citizen: null, clearance: null };

/** What the job asks for in years: the posting's own number, else what the seniority usually implies. */
export function requiredYears(spec: Pick<JobSpec, "yearsMin" | "seniority">): number | null {
  if (spec.yearsMin != null) return spec.yearsMin;
  return SENIORITY_YEARS[spec.seniority] ?? null;
}

/** How many years short of a job's minimum the user is allowed to be before the gate closes. */
export function yearsSlack(required: number, explicit: boolean): number {
  return explicit ? Math.max(1, required * 0.25) : Math.max(2, required * 0.4);
}

/**
 * Hard rules a job must pass for this user, in plain sentences. A rule only fails when the profile gives a reason to
 * fail it; missing information passes, except US citizenship and clearance, which fail unless the profile says the user
 * holds them (a form answer must never claim something the profile does not state).
 *
 * `job` is optional: without it the location rules use what the job spec says about where the role is.
 */
export function checkGates(spec: JobSpec, profile: MatchProfile, job?: Partial<JobLike>): GateResult {
  const reasons: string[] = [];
  const us = profile.workAuth.countries.US ?? NO_INFO;

  // Citizenship and clearance. The detector is US specific, so this is checked against the user's US status.
  if (spec.citizenshipRequired && us.citizen !== true) {
    reasons.push(us.citizen === false
      ? "This role requires US citizenship and you are not a US citizen."
      : "This role requires US citizenship and your profile does not say you are a US citizen.");
  }
  if (spec.clearanceRequired && us.clearance !== true && us.citizen !== true) {
    reasons.push("This role requires a government security clearance and your profile does not show that you hold one or are eligible for one.");
  }

  // Sponsorship: the job says no, the user needs it. Checked in the job's countries, else the user's main country.
  if (spec.sponsorship === "no") {
    const jobCountries = spec.location.countries.map(normalizeCountry);
    const known = jobCountries.filter((c) => profile.workAuth.countries[c]);
    const relevant = known.length > 0 ? known : (jobCountries.length === 0 && profile.workAuth.primary ? [profile.workAuth.primary] : []);
    for (const c of relevant) {
      const auth = profile.workAuth.countries[c] ?? NO_INFO;
      if (auth.needsSponsorship === true || auth.authorized === false) {
        reasons.push(`This role does not offer visa sponsorship and you need it to work in ${c}.`);
        break;
      }
    }
  }

  // Years of experience.
  const needed = requiredYears(spec);
  if (needed != null && needed > 0 && profile.experienceYears != null) {
    const slack = yearsSlack(needed, spec.yearsMin != null);
    if (profile.experienceYears + slack < needed) {
      reasons.push(`This role asks for ${spec.yearsMin != null ? "" : "about "}${needed} years of experience and you have about ${profile.experienceYears}.`);
    }
  }

  // Location and remote against the user's lanes.
  const jobWhere = job?.location != null || job?.remote != null || spec.location.cities.length > 0 || spec.location.countries.length > 0 || spec.location.remote === "remote";
  if (profile.lanes.length > 0 && jobWhere) {
    const where = {
      location: job?.location ?? ([...spec.location.cities, ...spec.location.countries].join(", ") || null),
      remote: (job?.remote ?? false) || spec.location.remote === "remote",
    };
    if (!profile.lanes.some((l) => locationFits(l, where))) {
      reasons.push(where.location
        ? `This role is in ${where.location}, which none of your lanes cover${where.remote ? "" : " (and it is not remote)"}.`
        : "This role has no location your lanes accept and it is not remote.");
    }
  }

  return { ok: reasons.length === 0, reasons };
}
