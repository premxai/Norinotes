import { z } from "zod";
import type { profiles } from "@norinote/db";
import { parseProfileContact, parseProfilePreferences, parseSalaryExpectation, normalizeCountry } from "@norinote/shared";

/**
 * The profile as the web sees it (`Profile` in apps/web/src/lib/types.ts) versus how it is stored (packages/db):
 * contact keys live in `profiles.contact`, work authorisation per country in `profiles.work_auth` (so the match gates read
 * it), and everything the schema has no column for (pronouns, notice period, clearance text, over-18, onboarding progress)
 * in `profiles.preferences` next to the real preferences.
 */

export const ONBOARDING_STEPS = ["resume", "contact", "authorization", "screening", "preferences"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStep = OnboardingStepId | "done";

type ProfileRow = typeof profiles.$inferSelect;
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

/** Keys of `preferences` that are not user-facing preferences. */
const EXTRA_KEYS = ["onboarding", "pronouns", "remotePreference", "noticePeriodWeeks", "securityClearance", "over18", "willingToRelocate", "heardAbout"] as const;

// ---- input ------------------------------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const list = z.array(z.string().trim().min(1).max(200)).max(100);

export const ProfilePatch = z.object({
  fullName: text(200), email: text(320), phone: text(50), location: text(200), city: text(100), state: text(100), country: text(100),
  linkedin: text(300), github: text(300), website: text(300), pronouns: text(50),
  workAuth: z.object({
    authorizedUS: z.boolean().nullable(), needsSponsorship: z.boolean().nullable(),
    status: z.enum(["citizen", "permanent_resident", "visa", "other"]).nullable(),
    visaType: z.string().trim().max(100).nullable(), notes: z.string().max(1000).nullable(),
  }).partial().optional(),
  willingToRelocate: z.boolean().nullable().optional(),
  remotePreference: text(50),
  heardAbout: text(200),
  salaryExpectation: z.preprocess(
    // "No preference" arrives as null or as an object with no amount.
    (v) => (v && typeof v === "object" && (v as { amount?: unknown }).amount == null ? null : v),
    z.object({ amount: z.number().nonnegative(), currency: z.string().trim().max(10).optional(), period: z.enum(["year", "month", "hour"]).optional() }).nullable().optional(),
  ),
  earliestStartDate: text(100),
  noticePeriodWeeks: z.number().int().min(0).max(104).nullable().optional(),
  eeo: z.object({ gender: z.string().max(100), race: z.string().max(100), veteran: z.string().max(100), disability: z.string().max(100) }).partial().optional(),
  securityClearance: text(100),
  over18: z.boolean().nullable().optional(),
  autoApplyDailyCap: z.number().int().min(0).max(100).optional(),
  preferences: z.object({
    titles: list.optional(), locations: list.optional(), remote: z.enum(["only", "ok", "no"]).optional(),
    salaryMin: z.number().nonnegative().optional(), stages: list.optional(), excludeCompanies: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
  }).optional(),
});
export type ProfilePatch = z.output<typeof ProfilePatch>;

/** Which keys each onboarding step may write; anything else in its `data` is ignored. */
export const STEP_KEYS: Record<OnboardingStepId, (keyof ProfilePatch)[]> = {
  resume: [],
  contact: ["fullName", "email", "phone", "location", "city", "state", "country", "linkedin", "github", "website", "pronouns"],
  authorization: ["workAuth", "willingToRelocate", "remotePreference"],
  screening: ["heardAbout", "salaryExpectation", "earliestStartDate", "noticePeriodWeeks", "eeo", "securityClearance", "over18"],
  preferences: ["preferences", "autoApplyDailyCap"],
};

// ---- stored -> web ----------------------------------------------------------------------------------------------------

export function readOnboarding(row: Pick<ProfileRow, "preferences">): { step: OnboardingStep; completedAt: string | null } {
  const o = rec(rec(row.preferences).onboarding);
  const step = o.step === "done" || ONBOARDING_STEPS.includes(o.step as OnboardingStepId) ? (o.step as OnboardingStep) : "resume";
  return { step, completedAt: typeof o.completedAt === "string" ? o.completedAt : null };
}

function workAuthOut(raw: unknown) {
  const us = rec(rec(raw).US);
  const status = typeof us.status === "string" ? us.status : us.citizen === true ? "citizen" : undefined;
  const out: Rec = {
    authorizedUS: typeof us.authorized === "boolean" ? us.authorized : undefined,
    needsSponsorship: typeof us.needsSponsorship === "boolean" ? us.needsSponsorship : undefined,
    status,
    visaType: typeof us.visaType === "string" ? us.visaType : undefined,
    notes: typeof us.notes === "string" ? us.notes : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export function toProfile(row: ProfileRow, accountEmail: string) {
  const contact = parseProfileContact(row.contact);
  const prefs = rec(row.preferences);
  const known = parseProfilePreferences(prefs);
  const salary = parseSalaryExpectation(row.salaryExpectation);
  const userPrefs = Object.fromEntries(Object.entries(prefs).filter(([k]) => !(EXTRA_KEYS as readonly string[]).includes(k)));
  return {
    userId: row.userId,
    fullName: contact.name,
    email: contact.email ?? accountEmail,
    phone: contact.phone,
    linkedin: contact.linkedin,
    website: contact.website,
    location: row.location,
    workAuth: workAuthOut(row.workAuth),
    preferences: userPrefs,
    rawResumeText: row.resumeText,
    autoApplyDailyCap: row.dailyCap,
    updatedAt: row.updatedAt.toISOString(),
    city: contact.city,
    state: contact.state,
    country: contact.country,
    github: contact.github,
    pronouns: typeof prefs.pronouns === "string" ? prefs.pronouns : null,
    willingToRelocate: known.willingToRelocate,
    remotePreference: typeof prefs.remotePreference === "string" ? prefs.remotePreference : null,
    heardAbout: known.heardAbout,
    salaryExpectation: salary.amount === null ? null : { amount: salary.amount, currency: salary.currency ?? undefined, period: salary.period ?? undefined },
    earliestStartDate: row.startDate,
    noticePeriodWeeks: typeof prefs.noticePeriodWeeks === "number" ? prefs.noticePeriodWeeks : null,
    eeo: rec(row.eeo),
    securityClearance: typeof prefs.securityClearance === "string" ? prefs.securityClearance : null,
    over18: typeof prefs.over18 === "boolean" ? prefs.over18 : null,
    onboarding: readOnboarding(row),
  };
}
export type WebProfile = ReturnType<typeof toProfile>;

// ---- web -> stored ----------------------------------------------------------------------------------------------------

const CONTACT_KEYS: [keyof ProfilePatch, string][] = [
  ["fullName", "name"], ["email", "email"], ["phone", "phone"], ["linkedin", "linkedin"], ["github", "github"], ["website", "website"],
  ["city", "city"], ["state", "state"], ["country", "country"],
];

export type ProfileUpdate = Partial<Pick<ProfileRow, "contact" | "location" | "workAuth" | "salaryExpectation" | "startDate" | "eeo" | "preferences" | "dailyCap">>;

/** Merges a validated patch into the stored row. Returns only the columns that change. */
export function buildUpdate(current: ProfileRow, patch: ProfilePatch): ProfileUpdate {
  const out: ProfileUpdate = {};

  // contact: blank or null removes the key
  const contact: Record<string, string> = { ...(rec(current.contact) as Record<string, string>) };
  let contactTouched = false;
  for (const [from, to] of CONTACT_KEYS) {
    const v = patch[from];
    if (v === undefined) continue;
    contactTouched = true;
    if (typeof v === "string" && v.trim()) contact[to] = v.trim();
    else delete contact[to];
  }
  if (contactTouched) out.contact = contact;

  if (patch.location !== undefined) out.location = patch.location?.trim() || null;
  else if (patch.city !== undefined || patch.state !== undefined || patch.country !== undefined) {
    out.location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ") || null;
  }

  const prefs: Rec = { ...rec(current.preferences) };
  let prefsTouched = false;
  const setPref = (k: string, v: unknown) => { prefsTouched = true; if (v === null || v === undefined || v === "") delete prefs[k]; else prefs[k] = v; };
  if (patch.pronouns !== undefined) setPref("pronouns", patch.pronouns);
  if (patch.willingToRelocate !== undefined) setPref("willingToRelocate", patch.willingToRelocate);
  if (patch.remotePreference !== undefined) setPref("remotePreference", patch.remotePreference);
  if (patch.heardAbout !== undefined) setPref("heardAbout", patch.heardAbout);
  if (patch.noticePeriodWeeks !== undefined) setPref("noticePeriodWeeks", patch.noticePeriodWeeks);
  if (patch.securityClearance !== undefined) setPref("securityClearance", patch.securityClearance);
  if (patch.over18 !== undefined) setPref("over18", patch.over18);
  if (patch.preferences) for (const [k, v] of Object.entries(patch.preferences)) if (v !== undefined) { prefsTouched = true; prefs[k] = v; }

  // work authorisation: the web's flat US form into the per-country store
  if (patch.workAuth || patch.securityClearance !== undefined) {
    const raw: Rec = { ...rec(current.workAuth) };
    const us: Rec = { ...rec(raw.US) };
    const w = patch.workAuth ?? {};
    if (w.authorizedUS !== undefined) us.authorized = w.authorizedUS;
    if (w.needsSponsorship !== undefined) us.needsSponsorship = w.needsSponsorship;
    if (w.status !== undefined) { us.status = w.status; if (w.status !== null) us.citizen = w.status === "citizen"; }
    if (w.visaType !== undefined) us.visaType = w.visaType;
    if (w.notes !== undefined) us.notes = w.notes;
    if (patch.securityClearance !== undefined) {
      const c = patch.securityClearance?.trim().toLowerCase() ?? "";
      us.clearance = c === "" ? null : c !== "none" && c !== "no";
    }
    raw[normalizeCountry("US")] = us;
    out.workAuth = raw;
  }

  if (patch.salaryExpectation !== undefined) {
    out.salaryExpectation = patch.salaryExpectation === null ? {} : parseSalaryExpectation(patch.salaryExpectation);
  }
  if (patch.earliestStartDate !== undefined) out.startDate = patch.earliestStartDate?.trim() || null;
  if (patch.eeo) out.eeo = { ...(rec(current.eeo) as Record<string, string>), ...patch.eeo };
  if (patch.autoApplyDailyCap !== undefined) out.dailyCap = patch.autoApplyDailyCap;
  if (prefsTouched) out.preferences = prefs;
  return out;
}

/** The step after saving `step`: never moves backwards. `done` after the last one. */
export function advance(current: OnboardingStep, saved: OnboardingStepId): OnboardingStep {
  const cur = current === "done" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(current);
  const next = Math.max(cur, ONBOARDING_STEPS.indexOf(saved) + 1);
  return next >= ONBOARDING_STEPS.length ? "done" : (ONBOARDING_STEPS[next] as OnboardingStepId);
}

/** A copy of `preferences` with the onboarding progress set. */
export function withOnboarding(prefs: unknown, step: OnboardingStep, now: Date): Rec {
  const previous = readOnboarding({ preferences: rec(prefs) });
  const completedAt = step === "done" ? (previous.completedAt ?? now.toISOString()) : previous.completedAt;
  return { ...rec(prefs), onboarding: { step, ...(completedAt ? { completedAt } : {}) } };
}
