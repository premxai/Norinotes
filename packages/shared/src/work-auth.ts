import { z } from "zod";

/**
 * What the user told us about working in one country. `null` means they did not say. This is the pinned shape of
 * `profiles.work_auth`: `{ US: { authorized, needsSponsorship, citizen, permanentResident, clearance } }`, one entry per
 * ISO-like country code. The US is the main case (most job gates are US ones). `permanentResident` is true for citizens
 * too: it answers "may this person work here without any visa" (in the US, "U.S. person" under ITAR/EAR).
 */
export const CountryAuth = z.object({
  authorized: z.boolean().nullable().default(null),
  needsSponsorship: z.boolean().nullable().default(null),
  citizen: z.boolean().nullable().default(null),
  permanentResident: z.boolean().nullable().default(null),
  clearance: z.boolean().nullable().default(null),
});
export type CountryAuth = z.infer<typeof CountryAuth>;

export const WorkAuthByCountry = z.record(z.string(), CountryAuth);
export type WorkAuthByCountry = z.infer<typeof WorkAuthByCountry>;

export const EMPTY_COUNTRY_AUTH: CountryAuth = { authorized: null, needsSponsorship: null, citizen: null, permanentResident: null, clearance: null };

const COUNTRY_ALIASES: Record<string, string> = {
  us: "US", usa: "US", "u.s.": "US", "u.s.a.": "US", "united states": "US", "united states of america": "US", america: "US",
  uk: "GB", gb: "GB", "u.k.": "GB", "united kingdom": "GB", "great britain": "GB", england: "GB",
  ca: "CA", canada: "CA", de: "DE", germany: "DE", in: "IN", india: "IN", au: "AU", australia: "AU",
  ie: "IE", ireland: "IE", nl: "NL", netherlands: "NL", fr: "FR", france: "FR", sg: "SG", singapore: "SG",
};

/** "United States" -> "US". Unknown names are upper-cased. */
export function normalizeCountry(raw: string): string {
  const k = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[k] ?? raw.trim().toUpperCase();
}

type Rec = Record<string, unknown>;

/** true/false from a boolean or "yes"/"no"/"true"/"false"; anything else is "not said". */
function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(yes|true|y)$/i.test(v.trim())) return true;
    if (/^(no|false|n)$/i.test(v.trim())) return false;
  }
  return null;
}

const pick = (o: Rec, ...keys: string[]): unknown => {
  for (const k of keys) if (k in o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/** A clearance level ("secret") means the user holds one; "none" and blanks do not. */
function clearanceOf(v: unknown): boolean | null {
  if (typeof v === "string") {
    const b = bool(v);
    if (b !== null) return b;
    return v.trim() !== "" && v.trim().toLowerCase() !== "none";
  }
  return bool(v);
}

/**
 * The onboarding status ("citizen", "permanent_resident", "visa", "other") as citizen and permanent-resident flags.
 * "other" (and anything unknown) says nothing about permanent residence.
 */
function statusFlags(v: unknown): { citizen: boolean | null; permanentResident: boolean | null } {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (s === "citizen") return { citizen: true, permanentResident: true };
  if (s === "permanent_resident" || s === "green_card" || s === "lawful_permanent_resident") return { citizen: false, permanentResident: true };
  if (s === "visa") return { citizen: false, permanentResident: false };
  if (s === "other") return { citizen: false, permanentResident: null };
  return { citizen: null, permanentResident: null };
}

/** The explicit flags win over the status; a citizen always counts as a permanent resident. */
function residency(citizen: boolean | null, permanentResident: boolean | null, status: unknown): Pick<CountryAuth, "citizen" | "permanentResident"> {
  const fromStatus = statusFlags(status);
  const c = citizen ?? fromStatus.citizen;
  return { citizen: c, permanentResident: c === true ? true : (permanentResident ?? fromStatus.permanentResident) };
}

const PERMANENT_RESIDENT_KEYS = ["permanentResident", "isPermanentResident", "lawfulPermanentResident", "greenCard", "hasGreenCard"];

function readCountry(o: Rec, code: string): CountryAuth {
  const citizenship = pick(o, "citizen", "isCitizen", "citizenship");
  // `citizenship: "US"` or `["US", "CA"]` also counts when it names this country.
  const citizen = Array.isArray(citizenship) ? citizenship.some((c) => typeof c === "string" && normalizeCountry(c) === code)
    : typeof citizenship === "string" && bool(citizenship) === null ? normalizeCountry(citizenship) === code
    : bool(citizenship);
  return CountryAuth.parse({
    authorized: bool(pick(o, "authorized", "authorised", "workAuthorized", "authorizedToWork", "authorisedToWork")),
    needsSponsorship: bool(pick(o, "needsSponsorship", "requiresSponsorship", "sponsorshipRequired", "needs_sponsorship", "sponsorship")),
    ...residency(citizen, bool(pick(o, ...PERMANENT_RESIDENT_KEYS)), pick(o, "status", "workStatus")),
    clearance: clearanceOf(pick(o, "clearance", "hasClearance", "securityClearance")),
  });
}

/**
 * Reads `profiles.work_auth` into the pinned per-country shape. Accepts the per-country form
 * (`{ US: { authorized, needsSponsorship, citizen, permanentResident, clearance, status } }`, country names or codes as keys,
 * "yes"/"no" strings allowed; `status` is the onboarding choice: citizen, permanent_resident, visa or other) and the legacy
 * flat form (`{ authorizedUS, needsSponsorship, usCitizen, status, clearance }`), which
 * describes the home country (`flat.country` if present, else `homeCountry`, default the US). Never throws: unreadable values become `null`.
 */
export function parseWorkAuthMap(raw: unknown, homeCountry = "US"): WorkAuthByCountry {
  const countries: WorkAuthByCountry = {};
  const flat: Rec = {};
  const input: Rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Rec) : {};
  for (const [k, v] of Object.entries(input)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const code = normalizeCountry(k);
      countries[code] = readCountry(v as Rec, code);
    } else flat[k] = v;
  }
  if (Object.keys(flat).length > 0) {
    const home = typeof flat.country === "string" && flat.country.trim() ? normalizeCountry(flat.country) : normalizeCountry(homeCountry);
    const us = countries[home] ?? EMPTY_COUNTRY_AUTH;
    const flatResidency = residency(bool(pick(flat, "usCitizen", "isUsCitizen", "citizen", "isCitizen")), bool(pick(flat, ...PERMANENT_RESIDENT_KEYS)), pick(flat, "status", "workStatus"));
    const citizen = us.citizen ?? flatResidency.citizen;
    countries[home] = {
      authorized: us.authorized ?? bool(pick(flat, "authorizedUS", "authorisedUS", "usAuthorized", "authorized", "authorised")),
      needsSponsorship: us.needsSponsorship ?? bool(pick(flat, "needsSponsorship", "requiresSponsorship", "sponsorshipRequired", "sponsorship")),
      citizen,
      permanentResident: citizen === true ? true : (us.permanentResident ?? flatResidency.permanentResident),
      clearance: us.clearance ?? clearanceOf(pick(flat, "clearance", "hasClearance", "securityClearance")),
    };
  }
  return countries;
}
