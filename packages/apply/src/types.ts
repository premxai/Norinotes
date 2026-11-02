import type { Page } from "playwright";
import type { PendingQuestion } from "@norinote/shared";

export type { PendingQuestion };

/** Everything a form might ask about the person, assembled from `users`, `profiles` and the application. */
export type ApplicantProfile = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  linkedin?: string;
  website?: string;
  github?: string;
  location?: string;
  /** ISO country of residence when known, e.g. "US". */
  country?: string;
  workAuth: { authorizedUS?: boolean; needsSponsorship?: boolean };
  /** Equal opportunity defaults: gender, race, veteran, disability. Each value may be "decline". */
  eeo?: Record<string, string>;
};

/** A field discovered on a page. `selector` is a CSS selector that resolves to it (or its first radio/checkbox). */
export type FormField = {
  label: string;
  kind: "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "file" | "unknown";
  required: boolean;
  options?: string[];
  selector: string;
};

export type EventLevel = "info" | "warn" | "error";
export type OnEvent = (step: string, message: string, data?: Record<string, unknown>, level?: EventLevel) => void;

/** What a driver needs to fill and submit one application. */
export type DriverContext = {
  applicationId: string;
  applyUrl: string;
  jobTitle?: string;
  companyName?: string;
  profile: ApplicantProfile;
  /** Absolute path of the tailored resume PDF. */
  resumePdfPath: string;
  /** Answers to custom questions, keyed by question id (see `questionId`) or by the question text. */
  answers: Record<string, string>;
  /** When true the driver fills everything and never clicks submit. A real submit also needs ALLOW_REAL_SUBMIT=true. */
  dryRun: boolean;
  /** Called when the site emails a verification code. Resolves with the code, or null on timeout. */
  waitForCode: (hint: string) => Promise<string | null>;
  onEvent: OnEvent;
};

export type FilledField = { label: string; value: string; kind: FormField["kind"] };

/** Why an application needs the person rather than the agent. */
export type NeedsUserKind = "questions" | "captcha" | "blocked" | "account" | "unsupported" | "verification_code" | "other";

export type FillResult = {
  /** `filled`: every required field has a value and the page is ready for submit. */
  status: "filled" | "needs_user" | "failed";
  /** The address the form was found at (after navigating straight to it). */
  formUrl: string | null;
  fields: FilledField[];
  /** Files uploaded, with the form label they went to. */
  files: { label: string; path: string }[];
  /** Required questions the form asked that had no answer. Never guessed. */
  pending: PendingQuestion[];
  needsUser?: { kind: NeedsUserKind; reason: string };
  error?: string;
  durationMs: number;
};

export type SubmitResult = {
  status: "submitted" | "needs_user" | "failed";
  /** The employer may already have the application. It is never re-sent automatically. */
  submitClicked: boolean;
  confirmationText?: string;
  finalUrl?: string;
  /** The site asked for an emailed code at some point. */
  usedCode?: boolean;
  needsUser?: { kind: NeedsUserKind; reason: string };
  error?: string;
  durationMs: number;
};

/** A job-system driver. `fill` opens the form and `submit` sends it, on the same page, in the same run. */
export interface Driver {
  readonly name: "greenhouse" | "lever" | "ashby";
  /** True when this driver handles the URL (decided by host and path, never by the query alone except gh_jid). */
  detect(url: string): boolean;
  /** The application form's own address when it can be derived from the posting URL, else null. */
  formUrl(url: string): string | null;
  /** Navigate to the form, fill it in one pass, upload the resume, collect unknown required questions as pending. */
  fill(page: Page, ctx: DriverContext): Promise<FillResult>;
  /** Click submit (only when allowed), handle the verification code step, read the confirmation. */
  submit(page: Page, ctx: DriverContext): Promise<SubmitResult>;
}

/** Fallback for a form no driver recognises: a future AI browser agent plugs in here. */
export interface UnknownFormHandler {
  handle(page: Page, ctx: DriverContext): Promise<FillResult>;
}

/** Resolves with the emailed verification code for an application, or null when none arrived in time. */
export interface CodeWaiter {
  waitForCode(applicationId: string, opts: { hint: string; timeoutMs: number }): Promise<string | null>;
}

export type PrepareResult =
  | { outcome: "prepared" }
  | { outcome: "needs_user"; reason: string; pending?: PendingQuestion[] }
  | { outcome: "failed"; error: string };

/** Tailors the resume and drafts answers, then reports. Implemented by the worker with the tailor and answers packages. */
export interface Preparer {
  prepare(applicationId: string): Promise<PrepareResult>;
}
