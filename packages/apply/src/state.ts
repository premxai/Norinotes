/**
 * The application state machine, as pure functions: which moves are legal, what blocks them, what a move changes.
 * Nothing here touches the database or a browser. `store.ts` applies these moves with an optimistic update and logs a
 * run event for each one.
 *
 *   queued -> preparing -> prepared -> applying -> awaiting_code -> submitted | needs_user | failed
 *
 * Also legal: awaiting_code -> applying (the code arrived, or the waiting page was lost), needs_user -> applying (the
 * person answered), applying -> prepared (a dry run filled the form and stopped before submit), failed -> queued (the
 * person asked to retry).
 */
import type { ApplicationStatus } from "@norinote/shared";
import { TERMINAL_APPLICATION_STATUSES } from "@norinote/shared";

/** Real attempts at the browser step before an application is parked as failed. */
export const MAX_ATTEMPTS = 3;

export const TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  queued: ["preparing", "failed"],
  preparing: ["prepared", "needs_user", "failed"],
  prepared: ["applying", "failed"],
  applying: ["awaiting_code", "submitted", "needs_user", "failed", "prepared"],
  awaiting_code: ["applying", "submitted", "needs_user", "failed"],
  needs_user: ["preparing", "applying", "failed"],
  submitted: [],
  failed: ["queued"],
};

/** The part of an application row the state machine looks at. */
export type AppSnapshot = {
  status: ApplicationStatus;
  resumeId: string | null;
  answers: Record<string, string>;
  pendingQuestions: unknown[];
  receipt: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  approvedAt: Date | null;
};

export type TransitionOptions = {
  now?: Date;
  /** Who asks. Moves out of `failed` are only for the person. Default "system". */
  by?: "system" | "user";
  /** Reason for `needs_user` / `failed`; stored in `error`. Cleared on moves forward. */
  error?: string | null;
  receipt?: Record<string, unknown> | null;
  pendingQuestions?: unknown[];
  resumeId?: string | null;
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export const isTerminal = (status: ApplicationStatus): boolean => TERMINAL_APPLICATION_STATUSES.includes(status);

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const questionKey = (q: unknown): string[] => {
  if (!q || typeof q !== "object") return [];
  const o = q as { id?: unknown; text?: unknown };
  return [typeof o.id === "string" ? o.id : "", typeof o.text === "string" ? o.text : ""].filter(Boolean);
};

/** Required pending questions that still have no answer (looked up by id, then by text). */
export function unansweredQuestions(app: Pick<AppSnapshot, "pendingQuestions" | "answers">): unknown[] {
  return app.pendingQuestions.filter((q) => {
    if ((q as { required?: unknown }).required === false) return false;
    return !questionKey(q).some((k) => (app.answers[k] ?? "").trim() !== "");
  });
}

/**
 * Whether the employer may already have this application, which rules out sending it again on its own. A submit that
 * stopped on an emailed code that never arrived (`codeMissing`) did not go through: the site holds the application
 * until the code is entered, so starting again is safe.
 */
export function submitMayHaveHappened(app: Pick<AppSnapshot, "receipt">): boolean {
  return app.receipt?.submitClicked === true && app.receipt?.awaitingCode !== true && app.receipt?.codeMissing !== true;
}

/** Legal move? Returns the reason when not. */
export function checkTransition(app: AppSnapshot, to: ApplicationStatus, opts: TransitionOptions = {}): TransitionCheck {
  const from = app.status;
  const no = (reason: string): TransitionCheck => ({ ok: false, reason });
  if (from === to) return no(`already ${to}`);
  if (!canTransition(from, to)) return no(`cannot go from ${from} to ${to}`);

  switch (to) {
    case "prepared":
      if (from === "preparing" && !app.resumeId) return no("no resume has been prepared");
      if (from === "applying" && !(opts.receipt ?? app.receipt)?.dryRun) return no("only a dry run returns to prepared");
      return { ok: true };
    case "applying":
      if (!app.approvedAt) return no("not approved: a prepared application needs the user's click (or autopilot)");
      if (from === "needs_user") {
        const open = unansweredQuestions(app);
        if (open.length) return no(`${open.length} required question(s) still unanswered`);
      }
      if (from !== "awaiting_code" && app.attempts >= MAX_ATTEMPTS) return no(`attempt limit of ${MAX_ATTEMPTS} reached`);
      if (submitMayHaveHappened(app)) return no("submit was already clicked; sending it again could create a duplicate");
      return { ok: true };
    case "queued":
      if (opts.by !== "user") return no("only the user can retry a failed application");
      if (submitMayHaveHappened(app)) return no("submit was already clicked; check the employer's site before retrying");
      return { ok: true };
    case "preparing":
      if (from === "needs_user") {
        const open = unansweredQuestions(app);
        if (open.length) return no(`${open.length} required question(s) still unanswered`);
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** Columns a legal move changes. Pure; the caller applies it. */
export function transitionPatch(app: AppSnapshot, to: ApplicationStatus, opts: TransitionOptions = {}): Partial<{
  status: ApplicationStatus; error: string | null; receipt: Record<string, unknown> | null; pendingQuestions: unknown[];
  resumeId: string | null; attempts: number; preparedAt: Date | null; submittedAt: Date | null; updatedAt: Date;
}> {
  const now = opts.now ?? new Date();
  const patch: ReturnType<typeof transitionPatch> = { status: to, updatedAt: now };
  if (opts.receipt !== undefined) patch.receipt = opts.receipt;
  if (opts.pendingQuestions !== undefined) patch.pendingQuestions = opts.pendingQuestions;
  if (opts.resumeId !== undefined) patch.resumeId = opts.resumeId;
  switch (to) {
    case "queued":
      patch.error = null;
      patch.attempts = 0;
      patch.pendingQuestions = [];
      break;
    case "preparing":
      patch.error = null;
      if (app.status === "needs_user") patch.pendingQuestions = [];
      break;
    case "prepared":
      patch.error = null;
      if (app.status === "preparing") patch.preparedAt = now;
      // A dry run returns here; the next click starts a fresh set of attempts.
      if (app.status === "applying") patch.attempts = 0;
      break;
    case "applying":
      patch.error = null;
      if (app.status !== "awaiting_code") patch.attempts = app.attempts + 1;
      if (app.status === "needs_user") patch.pendingQuestions = [];
      break;
    case "awaiting_code":
      patch.error = null;
      break;
    case "submitted":
      patch.error = null;
      patch.pendingQuestions = [];
      patch.submittedAt = now;
      break;
    case "needs_user":
    case "failed":
      patch.error = opts.error ?? app.error ?? (to === "failed" ? "Failed" : "Needs your input");
      break;
  }
  return patch;
}
