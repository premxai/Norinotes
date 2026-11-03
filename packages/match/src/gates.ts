import type { JobSpec } from "@norinote/shared";
import { familyYears, statedYearsMin } from "./alignment.js";
import { seniorityFromTitle } from "./heuristic-spec.js";
import { locationFits, type JobLike } from "./lanes.js";
import { parseLocation, placeAllowed, placeLabel, type ParsedLocation } from "./location.js";
import { allowedCountries, normalizeCountry, type CountryAuth, type MatchProfile } from "./profile.js";

export type GateResult = { ok: boolean; reasons: string[] };

/** Roughly how many years each seniority asks for when the posting gives no number. */
const SENIORITY_YEARS: Record<string, number> = { senior: 4, staff: 7, principal: 9, manager: 4, director: 8, executive: 10 };

const NO_INFO: CountryAuth = { authorized: null, needsSponsorship: null, citizen: null, clearance: null };

/**
 * What the job asks for in years: the posting's own number, else what the seniority usually implies (the spec's, or the
 * title's when it says more: a "Senior Software Engineer" read as "mid" by the model still asks for about 4).
 */
export function requiredYears(spec: Pick<JobSpec, "yearsMin" | "seniority">, title?: string | null): number | null {
  if (spec.yearsMin != null) return spec.yearsMin;
  const fromSpec = SENIORITY_YEARS[spec.seniority] ?? null;
  const t = title ? seniorityFromTitle(title) : null;
  const fromTitle = t ? (SENIORITY_YEARS[t] ?? null) : null;
  if (fromSpec == null) return fromTitle;
  return fromTitle == null ? fromSpec : Math.max(fromSpec, fromTitle);
}

/** The years gate closes only when the stated minimum is at least this far above the user's relevant years. */
export const HARD_YEARS_GAP = 3;
/** A senior, staff, principal, manager, director or executive title needs at least this many relevant years. */
export const SENIOR_MIN_YEARS = 2;
const SENIOR_TITLES = new Set(["senior", "staff", "principal", "manager", "director", "executive"]);

/** How many years short of a job's minimum the user is allowed to be before the gate closes (kept for callers; the gate uses `HARD_YEARS_GAP`). */
export function yearsSlack(required: number, explicit: boolean): number {
  return explicit ? Math.max(1, required * 0.25) : Math.max(2, required * 0.4);
}

/** Where the job is, from its location text, else from what the spec says about countries and cities. */
export function jobPlace(spec: Pick<JobSpec, "location">, job?: Partial<JobLike>): ParsedLocation {
  const fromText = parseLocation(job?.location ?? null, job?.remote ?? false);
  if (!fromText.unknown) return fromText;
  const fromSpec = parseLocation([...spec.location.cities, ...spec.location.countries].join(" | "), (job?.remote ?? false) || spec.location.remote === "remote");
  return fromSpec.unknown ? fromText : { ...fromSpec, multiple: fromText.multiple || fromSpec.multiple };
}

export type GateOptions = {
  /** Clock for years of experience. Default: now. */
  now?: Date;
};

/**
 * Hard rules a job must pass for this user, in plain sentences. A rule only fails when the profile gives a reason to
 * fail it; missing information passes, except US citizenship and clearance, which fail unless the profile says the user
 * holds them (a form answer must never claim something the profile does not state).
 *
 * Years are counted in the job's function (see `familyYears`) when the job title is known and the user has dated roles,
 * else over the whole career. Location: the lanes must accept the job (text match, or remote with a remote lane), and the
 * job's countries or regions must include one the user can work in (their home country, countries they are authorised
 * in, countries their lanes name): "Europe Remote" or "Remote - Philippines" fails for a US-based user.
 *
 * `job` is optional: without it the location rules use what the job spec says about where the role is.
 */
export function checkGates(spec: JobSpec, profile: MatchProfile, job?: Partial<JobLike>, opts: GateOptions = {}): GateResult {
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

  // Years of experience, in this kind of role when that can be told. Mostly a soft penalty (the seniority part of the fit);
  // the gate closes only for a large gap: a stated minimum at least 3 years above what the user has, or a senior-or-above
  // title for someone with under 2 years. Years the posting only prefers never close it.
  const inFunction = job?.title ? familyYears(profile.points, job.title, opts.now ?? new Date()) : null;
  const years = inFunction ?? profile.experienceYears;
  if (years != null) {
    const scope = inFunction != null && inFunction !== profile.experienceYears ? " in this kind of role" : "";
    const stated = statedYearsMin(spec);
    const titleLevel = job?.title ? seniorityFromTitle(job.title) : null;
    if (stated != null && stated > 0 && stated >= years + HARD_YEARS_GAP) {
      reasons.push(`This role asks for ${stated} years of experience and you have about ${years}${scope}.`);
    } else if (titleLevel && SENIOR_TITLES.has(titleLevel) && years < SENIOR_MIN_YEARS) {
      reasons.push(`This role asks for about ${SENIORITY_YEARS[titleLevel]} years of experience and you have about ${years}${scope}.`);
    }
  }

  // Location and remote against the lanes, then the countries or regions the job is limited to.
  const jobWhere = job?.location != null || job?.remote != null || spec.location.cities.length > 0 || spec.location.countries.length > 0 || spec.location.remote === "remote";
  let laneOk = true;
  if (profile.lanes.length > 0 && jobWhere) {
    const where = {
      location: job?.location ?? ([...spec.location.cities, ...spec.location.countries].join(", ") || null),
      remote: (job?.remote ?? false) || spec.location.remote === "remote",
    };
    if (!profile.lanes.some((l) => locationFits(l, where))) {
      laneOk = false;
      reasons.push(where.location
        ? `This role is in ${where.location}, which none of your lanes cover${where.remote ? "" : " (and it is not remote)"}.`
        : "This role has no location your lanes accept and it is not remote.");
    }
  }
  if (laneOk && jobWhere) {
    const place = jobPlace(spec, job);
    if (!placeAllowed(place, allowedCountries(profile))) {
      reasons.push(`This role is limited to ${placeLabel(place)}${place.remote === "remote" ? " (remote)" : ""}, outside the countries you can work in.`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
