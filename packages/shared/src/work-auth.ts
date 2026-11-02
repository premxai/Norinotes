import { z } from "zod";

/**
 * What the user told us about working in one country. `null` means they did not say. This is the pinned shape of
 * `profiles.work_auth`: `{ US: { authorized, needsSponsorship, citizen, clearance } }`, one entry per ISO-like country
 * code. The US is the main case (most job gates are US ones).
 */
export const CountryAuth = z.object({
  authorized: z.boolean().nullable().default(null),
  needsSponsorship: z.boolean().nullable().default(null),
  citizen: z.boolean().nullable().default(null),
  clearance: z.boolean().nullable().default(null),
});
export type CountryAuth = z.infer<typeof CountryAuth>;

export const WorkAuthByCountry = z.record(z.string(), CountryAuth);
export type WorkAuthByCountry = z.infer<typeof WorkAuthByCountry>;

export const EMPTY_COUNTRY_AUTH: CountryAuth = { authorized: null, needsSponsorship: null, citizen: null, clearance: null };

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

function readCountry(o: Rec, code: string): CountryAuth {
  const citizenship = pick(o, "citizen", "isCitizen", "citizenship");
  return CountryAuth.parse({
    authorized: bool(pick(o, "authorized", "authorised", "workAuthorized", "authorizedToWork", "authorisedToWork")),
    needsSponsorship: bool(pick(o, "needsSponsorship", "requiresSponsorship", "sponsorshipRequired", "needs_sponsorship", "sponsorship")),
    // `citizenship: "US"` or `["US", "CA"]` also counts when it names this country.
    citizen: Array.isArray(citizenship) ? citizenship.some((c) => typeof c === "string" && normalizeCountry(c) === code)
      : typeof citizenship === "string" && bool(citizenship) === null ? normalizeCountry(citizenship) === code
      : bool(citizenship),
    clearance: clearanceOf(pick(o, "clearance", "hasClearance", "securityClearance")),
  });
}

/**
 * Reads `profiles.work_auth` into the pinned per-country shape. Accepts the per-country form
 * (`{ US: { authorized, needsSponsorship, citizen, clearance } }`, country names or codes as keys, "yes"/"no" strings
 * allowed) and the legacy flat form Nori used (`{ authorizedUS, needsSponsorship, usCitizen, clearance }`), which
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
    countries[home] = {
      authorized: us.authorized ?? bool(pick(flat, "authorizedUS", "authorisedUS", "usAuthorized", "authorized", "authorised")),
      needsSponsorship: us.needsSponsorship ?? bool(pick(flat, "needsSponsorship", "requiresSponsorship", "sponsorshipRequired", "sponsorship")),
      citizen: us.citizen ?? bool(pick(flat, "usCitizen", "isUsCitizen", "citizen", "isCitizen")),
      clearance: us.clearance ?? clearanceOf(pick(flat, "clearance", "hasClearance", "securityClearance")),
    };
  }
  return countries;
}
