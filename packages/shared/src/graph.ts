import { z } from "zod";

/** `certification`: a licence, professional certification or clinical card; `startDate` is issued, `endDate` is expiry. */
export const CAREER_POINT_KINDS = ["role", "project", "achievement", "education", "skill", "certification"] as const;
export const CareerPointKind = z.enum(CAREER_POINT_KINDS);
export type CareerPointKind = z.infer<typeof CareerPointKind>;

/** One fact in a user's career graph. `startDate` and `endDate` are `YYYY` or `YYYY-MM`; a missing end means current. */
export const CareerPoint = z.object({
  id: z.string(),
  kind: CareerPointKind,
  title: z.string(),
  org: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  text: z.string(),
  skills: z.array(z.string()),
  /** How big it was: team size, users, budget, ownership. */
  scope: z.record(z.string(), z.unknown()),
  /** Numbers that prove impact. */
  metrics: z.record(z.string(), z.unknown()),
  /** The exact words in the resume this point came from, so nothing is invented. */
  sourceQuote: z.string().nullable(),
  /**
   * `resume` points are replaced on every resume upload; `user` facts are never touched; `github` and `site` facts come
   * from a source the person named and are replaced when it is read again.
   */
  source: z.enum(["resume", "user", "github", "site"]).default("resume"),
  /** The repo or page a github/site fact came from. */
  sourceRef: z.string().nullable().optional(),
});
/** The input type, so `source` may be left out when building one by hand (it defaults to `resume` when parsed). */
export type CareerPoint = z.input<typeof CareerPoint>;

/** A lane is one kind of job the user wants. A job fits when its title matches and (its location matches or, if `remote`, it is remote). */
export const Lane = z.object({
  id: z.string(),
  name: z.string(),
  titles: z.array(z.string()),
  locations: z.array(z.string()),
  remote: z.boolean(),
  minFit: z.number().min(0).max(1),
  enabled: z.boolean(),
});
export type Lane = z.infer<typeof Lane>;
