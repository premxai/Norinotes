import { z } from "zod";

/**
 * queued -> preparing -> prepared -> applying -> awaiting_code -> submitted | needs_user | failed
 * (awaiting_code returns to applying when the code arrives; needs_user returns to applying once the user answers.)
 */
export const APPLICATION_STATUSES = ["queued", "preparing", "prepared", "applying", "awaiting_code", "submitted", "needs_user", "failed"] as const;
export const ApplicationStatus = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

/** Statuses an application never leaves on its own. */
export const TERMINAL_APPLICATION_STATUSES: readonly ApplicationStatus[] = ["submitted", "failed"];

/** A question the form asked that the answer bank could not answer. */
export const PendingQuestion = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(["text", "textarea", "select", "multiselect", "boolean", "file"]),
  options: z.array(z.string()),
  required: z.boolean(),
});
export type PendingQuestion = z.infer<typeof PendingQuestion>;

export const Application = z.object({
  id: z.string(),
  jobId: z.string(),
  status: ApplicationStatus,
  resumeId: z.string().nullable(),
  /** Question id (or text) to the answer that will be entered. */
  answers: z.record(z.string(), z.string()),
  pendingQuestions: z.array(PendingQuestion),
  /** Proof of submission: confirmation text, screenshot path, final URL. */
  receipt: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  preparedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type Application = z.infer<typeof Application>;

export const RUN_EVENT_LEVELS = ["info", "warn", "error"] as const;
export const RunEvent = z.object({
  applicationId: z.string(),
  ts: z.string(),
  step: z.string(),
  level: z.enum(RUN_EVENT_LEVELS),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ANSWER_SOURCES = ["default", "user", "model"] as const;
/** An entry in the answer bank. */
export const Answer = z.object({
  id: z.string(),
  questionText: z.string(),
  answer: z.string(),
  source: z.enum(ANSWER_SOURCES),
  lastUsedAt: z.string().nullable(),
});
export type Answer = z.infer<typeof Answer>;
