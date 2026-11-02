import { z } from "zod";

/** Pinned shapes of the free-form jsonb columns on `profiles`. Parsers never throw: unreadable values become null. */

const text = z.string().nullable().default(null);

/** `profiles.contact`: how the user is reached and where they live. Stored as strings; a missing key means not given. */
export const ProfileContact = z.object({
  name: text, email: text, phone: text, linkedin: text, github: text, website: text,
  address1: text, address2: text, city: text, state: text, zip: text, country: text,
});
export type ProfileContact = z.infer<typeof ProfileContact>;

/** `profiles.salary_expectation`. `amount` is in whole units of `currency` per `period` (year, month, hour). */
export const SalaryExpectation = z.object({
  amount: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
});
export type SalaryExpectation = z.infer<typeof SalaryExpectation>;

/** `profiles.preferences`: free-form, but these two keys are read by the answer bank. Other keys are kept as they are. */
export const ProfilePreferences = z.looseObject({
  willingToRelocate: z.boolean().nullable().default(null),
  heardAbout: z.string().nullable().default(null),
});
export type ProfilePreferences = z.infer<typeof ProfilePreferences>;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (...vs: unknown[]): string | null => {
  for (const v of vs) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
};

/** Accepts the pinned keys plus the spellings older data used (`fullName`, `mobile`, `linkedIn`, `portfolio`, `zipCode`). */
export function parseProfileContact(raw: unknown): ProfileContact {
  const o = rec(raw);
  const first = str(o.firstName, o.first_name);
  const last = str(o.lastName, o.last_name);
  return ProfileContact.parse({
    name: str(o.name, o.fullName, o.full_name) ?? (first || last ? [first, last].filter(Boolean).join(" ") : null),
    email: str(o.email), phone: str(o.phone, o.mobile), linkedin: str(o.linkedin, o.linkedIn),
    github: str(o.github), website: str(o.website, o.portfolio, o.site),
    address1: str(o.address1, o.address, o.street), address2: str(o.address2), city: str(o.city),
    state: str(o.state, o.region), zip: str(o.zip, o.zipCode, o.postalCode, o.postal_code), country: str(o.country),
  });
}

export function parseSalaryExpectation(raw: unknown): SalaryExpectation {
  const o = rec(raw);
  const n = typeof o.amount === "number" ? o.amount : typeof o.amount === "string" ? Number(o.amount.replace(/[$,\s]/g, "")) : NaN;
  return SalaryExpectation.parse({
    amount: Number.isFinite(n) ? n : null,
    currency: str(o.currency)?.toUpperCase() ?? null,
    period: str(o.period)?.toLowerCase() ?? null,
  });
}

export function parseProfilePreferences(raw: unknown): ProfilePreferences {
  const o = rec(raw);
  const relocate = o.willingToRelocate ?? o.relocate ?? o.openToRelocation;
  const relocateBool = typeof relocate === "boolean" ? relocate : typeof relocate === "string" ? (/^(yes|true)$/i.test(relocate.trim()) ? true : /^(no|false)$/i.test(relocate.trim()) ? false : null) : null;
  return ProfilePreferences.parse({ ...o, willingToRelocate: relocateBool, heardAbout: str(o.heardAbout) });
}
