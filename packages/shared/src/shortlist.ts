import { z } from "zod";

export const SHORTLIST_STATUSES = ["new", "dismissed", "applied"] as const;
export const ShortlistStatus = z.enum(SHORTLIST_STATUSES);
export type ShortlistStatus = z.infer<typeof ShortlistStatus>;

/** Why a person skipped a job (optional). Order is the order the person sees them in. */
export const SKIP_REASONS = ["not_my_kind", "too_senior", "too_junior", "wrong_location", "company", "missing_skills", "other"] as const;
export const SkipReason = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof SkipReason>;
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  not_my_kind: "Not my kind of role",
  too_senior: "Too senior",
  too_junior: "Too junior",
  wrong_location: "Wrong location",
  company: "Company I don't want",
  missing_skills: "Missing skills",
  other: "Other",
};

/** One requirement of a job matched against the user's career points. */
export const FitMapEntry = z.object({
  requirement: z.string(),
  mustHave: z.boolean(),
  /** 0 to 1. */
  score: z.number().min(0).max(1),
  careerPointIds: z.array(z.string()),
});
export type FitMapEntry = z.infer<typeof FitMapEntry>;

export const ShortlistItem = z.object({
  id: z.string(),
  jobId: z.string(),
  /** 0 to 1. */
  fit: z.number().min(0).max(1),
  fitMap: z.array(FitMapEntry),
  /** Short "why this fits" lines. */
  reasons: z.array(z.string()),
  status: ShortlistStatus,
  createdAt: z.string(),
});
export type ShortlistItem = z.infer<typeof ShortlistItem>;
