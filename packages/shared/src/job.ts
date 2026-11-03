import { z } from "zod";

/** Job systems (applicant tracking systems) a connector exists for or is planned for. */
export const ATS_TYPES = [
  "greenhouse", "lever", "ashby", "smartrecruiters", "workday", "oracle",
  "workable", "recruitee", "teamtailor", "personio", "bamboohr", "breezy", "rippling", "pinpoint", "icims",
] as const;
export const AtsType = z.enum(ATS_TYPES);
export type AtsType = z.infer<typeof AtsType>;

/** A job as the API returns it. Dates are ISO strings on the wire. */
export const Job = z.object({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string().nullable(),
  atsType: AtsType,
  externalId: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  remote: z.boolean(),
  descriptionText: z.string(),
  applyUrl: z.string(),
  postedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  closedAt: z.string().nullable(),
});
export type Job = z.infer<typeof Job>;

export const SENIORITIES = ["intern", "entry", "mid", "senior", "staff", "principal", "manager", "director", "executive", "unknown"] as const;
export const SKILL_LEVELS = ["basic", "working", "advanced", "expert"] as const;
export const SPONSORSHIP = ["yes", "no", "unknown"] as const;
export const REMOTE_RULES = ["remote", "hybrid", "onsite", "unknown"] as const;

/**
 * What a job asks for, extracted once per job by the small model. Optional values are nullable (never missing) so the
 * same schema works as an OpenAI strict JSON schema.
 */
export const JobSpec = z.object({
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  skills: z.array(z.object({
    name: z.string(),
    level: z.enum(SKILL_LEVELS),
    years: z.number().nullable(),
    required: z.boolean(),
  })),
  seniority: z.enum(SENIORITIES),
  roleFamily: z.string(),
  yearsMin: z.number().nullable(),
  location: z.object({
    remote: z.enum(REMOTE_RULES),
    countries: z.array(z.string()),
    cities: z.array(z.string()),
  }),
  citizenshipRequired: z.boolean(),
  clearanceRequired: z.boolean(),
  sponsorship: z.enum(SPONSORSHIP),
  responsibilities: z.array(z.string()),
  /** How much each must-have or nice-to-have matters (0 to 1), keyed by the exact requirement text. */
  requirementWeights: z.record(z.string(), z.number()).default({}),
});
/**
 * The input type, so `requirementWeights` may be left out when building one by hand (it defaults to `{}` when parsed).
 * Anything read from the database should go through `JobSpec.parse`, or use `spec.requirementWeights ?? {}`.
 */
export type JobSpec = z.input<typeof JobSpec>;
