import { applications, companies, eq, jobs, profiles, resumes, users } from "@norinote/db";
import type { Db } from "@norinote/db";
import { parseWorkAuthMap } from "@norinote/shared";
import type { ApplicantProfile } from "./types.js";

/** Everything the driver needs, read from the database at the moment the browser step starts. */
export type ApplyInputs = {
  applyUrl: string;
  jobTitle: string;
  companyName: string;
  profile: ApplicantProfile;
  resumePdfPath: string;
  answers: Record<string, string>;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (...vs: unknown[]): string | undefined => {
  for (const v of vs) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return undefined;
};

const COUNTRY_TAIL = /(?:,\s*|\s)(US|USA|U\.S\.A?\.?|United States(?: of America)?)$/i;

/**
 * Build the applicant a form is filled from. Tolerant of the exact keys in `profiles.contact` and `profiles.work_auth`
 * (those are free-form JSON written by the API): it reads the common spellings and leaves the rest undefined, and an
 * undefined value for a required field becomes a pending question rather than a guess.
 */
export function profileFromRows(user: { email: string }, profile: {
  contact: Record<string, string>; location: string | null; workAuth: Record<string, unknown>; eeo: Record<string, string>;
} | null): ApplicantProfile {
  const contact = rec(profile?.contact);
  const full = str(contact.fullName, contact.name, contact.full_name);
  let first = str(contact.firstName, contact.first_name, contact.first);
  let last = str(contact.lastName, contact.last_name, contact.last);
  if (full && (!first || !last)) {
    const parts = full.split(/\s+/);
    first ??= parts[0];
    last ??= parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  }
  const fullName = full ?? [first, last].filter(Boolean).join(" ");
  const location = str(profile?.location, contact.location, contact.city);
  const country = str(contact.country) ?? (location && COUNTRY_TAIL.test(location) ? "US" : undefined);

  const us = parseWorkAuthMap(profile?.workAuth).US;
  return {
    fullName, firstName: first ?? "", lastName: last ?? "",
    email: str(contact.email, user.email) ?? user.email,
    phone: str(contact.phone, contact.mobile),
    linkedin: str(contact.linkedin, contact.linkedIn),
    website: str(contact.website, contact.portfolio, contact.site),
    github: str(contact.github),
    location, country,
    workAuth: {
      authorizedUS: us?.authorized ?? undefined,
      needsSponsorship: us?.needsSponsorship ?? undefined,
    },
    eeo: profile?.eeo ?? {},
  };
}

export class MissingInputError extends Error {}

export async function loadApplyInputs(db: Db, applicationId: string): Promise<ApplyInputs> {
  const [row] = await db.select({
    app: applications, applyUrl: jobs.applyUrl, title: jobs.title, companyName: companies.name,
  }).from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.id, applicationId)).limit(1);
  if (!row) throw new MissingInputError("application, job or company not found");

  const [user] = await db.select().from(users).where(eq(users.id, row.app.userId)).limit(1);
  if (!user) throw new MissingInputError("user not found");
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, row.app.userId)).limit(1);

  if (!row.app.resumeId) throw new MissingInputError("no tailored resume is attached to this application");
  const [resume] = await db.select().from(resumes).where(eq(resumes.id, row.app.resumeId)).limit(1);
  if (!resume?.pdfPath) throw new MissingInputError("the tailored resume has no PDF yet");

  return {
    applyUrl: row.applyUrl,
    jobTitle: row.title,
    companyName: row.companyName,
    profile: profileFromRows(user, profile ?? null),
    resumePdfPath: resume.pdfPath,
    answers: row.app.answers,
  };
}
