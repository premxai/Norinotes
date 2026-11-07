import type { Page } from "playwright";
import type { PendingQuestion } from "@norinote/shared";
import type { WidgetStrategy } from "./recipes.js";

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
  /**
   * Called when the site emails a verification code. Resolves with the code, or null on timeout. Absent (the default
   * until the owned inbox is wired): the application is parked as needs_user with the reason.
   */
  waitForCode?: (hint: string) => Promise<string | null>;
  /** Widget strategies remembered by the form recipe cache, by normalised label. */
  strategyHints?: Record<string, WidgetStrategy>;
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
  /** Strategy that filled each field, by normalised label (for the recipe cache). */
  strategies?: Record<string, WidgetStrategy>;
  /** A widget needed its fallback strategy (a stale recipe or selector healed once). */
  healed?: boolean;
  /** Per-step timings in ms: openMs, discoverMs, filesMs, textMs, choicesMs, validateMs, readyMs. */
  timings?: Record<string, number>;
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
  readonly name: DriverName;
  /** True when this driver handles the URL (decided by host and path, never by the query alone except gh_jid). */
  detect(url: string): boolean;
  /** The application form's own address when it can be derived from the posting URL, else null. */
  formUrl(url: string): string | null;
  /** Navigate to the form, fill it in one pass, upload the resume, collect unknown required questions as pending. */
  fill(page: Page, ctx: DriverContext): Promise<FillResult>;
  /** Click submit (only when allowed), handle the verification code step, read the confirmation. */
  submit(page: Page, ctx: DriverContext): Promise<SubmitResult>;
}

export type DriverName = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable" | "icims";

/** Fallback for a form no driver recognises: a future AI browser agent plugs in here. */
export interface UnknownFormHandler {
  handle(page: Page, ctx: DriverContext): Promise<FillResult>;
}

/**
 * Hook for a future AI browser agent (no browser-use or Stagehand dependency today). Called for an unknown job system or
 * when a field failed read-back after one heal. Resolve false (or leave the hook unset) and the application goes to
 * needs_user as it does now.
 */
export interface AiBrowserFallback {
  assist(page: Page, request: { applicationId: string; reason: "unknown_form" | "read_back_failed"; fields: { label: string; reason: string }[] }): Promise<boolean>;
}

/**
 * The owned-inbox verification hook (packages/inbox, later): resolves with the emailed code or link sent since `since`,
 * or null after `timeoutMs`. Plugged into the runner through `ApplyDeps.verification`. Norinote asks for a code; a
 * verification link parks the application as needs_user (opening links automatically is a later decision).
 */
export type AwaitVerification = (args: { applicationId: string; since: Date; timeoutMs: number; accept?: "code" | "link" | "any" }) =>
  Promise<({ type: "code"; code: string } | { type: "link"; link: string }) & { source?: "gmail" | "typed" | "email"; from?: string } | null>;

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
