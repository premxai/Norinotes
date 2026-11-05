import type { ApplicationStatus } from "@norinote/shared";
import { applications, eq } from "@norinote/db";
import type { Db } from "@norinote/db";
import type { Payload } from "@norinote/queue";
import { defaultUnknownFormHandler, detectDriver, DRIVERS } from "./drivers/index.js";
import { submitAllowed } from "./flow.js";
import { loadApplyInputs, type ApplyInputs } from "./inputs.js";
import { PoolRunError, type BrowserPool, type PoolArtifacts } from "./pool.js";
import { buildReceipt } from "./receipt.js";
import { sharedCompanyGate, type CompanyGate } from "./gate.js";
import { recordStrategies } from "./recipes.js";
import { isTerminal, MAX_ATTEMPTS, submitMayHaveHappened } from "./state.js";
import { approveAndSubmit, loadApplication, logEvent, transitionApplication, type ApplicationRow } from "./store.js";
import type {
  AiBrowserFallback, AwaitVerification, CodeWaiter, Driver, DriverContext, EventLevel, FillResult, NeedsUserKind, Preparer, SubmitResult, UnknownFormHandler,
} from "./types.js";

export type ApplyDeps = {
  pool: BrowserPool;
  /** Tailors the resume and drafts answers (tailor + answers packages, wired by the worker). */
  preparer: Preparer;
  /**
   * Delivers the emailed verification code. Optional: without it (or `verification`) an email-code prompt parks the
   * application as needs_user with the reason. The owned-inbox flow plugs in here later.
   */
  codes?: CodeWaiter;
  /** The owned inbox's awaitVerification({ applicationId, since, timeoutMs }), when wired. Takes precedence over `codes`. */
  verification?: AwaitVerification;
  /** Hook for a future AI browser agent; unset = needs_user (today's behaviour). */
  aiFallback?: AiBrowserFallback;
  /** One application per company at a time, plus a cooldown. Default: the process-wide gate (APPLY_COMPANY_COOLDOWN_MS). */
  companyGate?: CompanyGate;
  /** Longest wait for the company gate before the step is retried later (default 120 s). */
  companyWaitMs?: number;
  /** Fallback for forms no driver recognises. Default: park as needs_user "This form type is not supported yet". */
  unknownForm?: UnknownFormHandler;
  drivers?: readonly Driver[];
  /** Test seam: how the inputs are read. Default: from the database. */
  loadInputs?: (db: Db, applicationId: string) => Promise<ApplyInputs>;
  /** How long to wait for an emailed code (default 90 s). */
  codeTimeoutMs?: number;
  /** Limit for fill + submit, excluding the code wait (default 150 s). */
  runTimeoutMs?: number;
  now?: () => Date;
};

export type WaitingFor = "approval" | "user" | "code" | "concurrent" | "done";

export type StepResult = {
  applicationId: string;
  status: ApplicationStatus | "missing";
  /** This call moved the application to a new status (or finished the dry run back at prepared). */
  advanced: boolean;
  /** Nothing more to do until this happens. */
  waiting?: WaitingFor;
  /** A transient failure: the status is unchanged and calling again retries. The queue handler throws on this. */
  retry?: boolean;
  message?: string;
};

const DEFAULT_CODE_TIMEOUT_MS = 90_000;
const DEFAULT_RUN_TIMEOUT_MS = 150_000;

/** Applications whose browser step is running in this process. Guards against two workers' handlers overlapping on one. */
const inflight = new Set<string>();

const WAITING_AFTER: Partial<Record<ApplicationStatus, WaitingFor>> = { submitted: "done", failed: "done", needs_user: "user", prepared: "approval" };

const result = (applicationId: string, status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult =>
  ({ applicationId, status, advanced: false, ...extra });

/**
 * Advance one application by one step and report. Safe to call again at any point (a retry after a crash, a duplicate
 * queue message): each step checks the current status first, moves it with an optimistic update, and does nothing when
 * the work is already done.
 *
 *   queued          -> preparing
 *   preparing       -> prepared | needs_user | failed         (runs the Preparer)
 *   prepared        -> waits for the user's click             (approveAndSubmit moves it to applying)
 *   applying        -> submitted | needs_user | failed | prepared (dry run)   (runs the browser)
 *   awaiting_code   -> applying again if the waiting page is gone
 *   needs_user      -> applying / preparing once the questions are answered
 */
export async function runApplication(db: Db, applicationId: string, deps: ApplyDeps): Promise<StepResult> {
  const row = await loadApplication(db, applicationId);
  if (!row) return result(applicationId, "missing", { waiting: "done", message: "application not found" });

  switch (row.status) {
    case "queued": {
      const r = await transitionApplication(db, applicationId, "preparing", { from: "queued" });
      return result(applicationId, r.ok ? r.application.status : row.status, { advanced: r.ok && !r.noop });
    }
    case "preparing":
      return prepareStep(db, row, deps);
    case "prepared":
      return result(applicationId, "prepared", { waiting: "approval" });
    case "applying":
      return applyStep(db, row, deps);
    case "awaiting_code": {
      if (inflight.has(applicationId)) return result(applicationId, "awaiting_code", { waiting: "code" });
      // The run that was waiting is gone (restart): the page with the code box went with it. The site has not accepted
      // the application without the code, so starting over is safe.
      const r = await transitionApplication(db, applicationId, "applying", { from: "awaiting_code", message: "The page waiting for the code was lost; starting the form again" });
      return result(applicationId, r.ok ? r.application.status : row.status, { advanced: r.ok && !r.noop, ...(r.ok ? {} : { message: r.reason }) });
    }
    case "needs_user": {
      // Parked with questions: resume when they are answered. Parked without any (captcha, blocked site, unsupported form,
      // missing code): nothing the user can type, so only an explicit retryApplication moves it.
      if (row.pendingQuestions.length === 0) return result(applicationId, "needs_user", { waiting: "user", message: row.error ?? undefined });
      const to = row.resumeId && row.approvedAt ? "applying" : "preparing";
      const r = await transitionApplication(db, applicationId, to, { from: "needs_user", message: "The user answered; resuming" });
      if (r.ok) return result(applicationId, r.application.status, { advanced: !r.noop });
      return result(applicationId, "needs_user", { waiting: "user", message: r.reason });
    }
    case "submitted":
    case "failed":
      return result(applicationId, row.status, { waiting: "done" });
  }
}

/** Calls `runApplication` until the application needs something from outside (a click, an answer, a code) or finishes. */
export async function driveApplication(db: Db, applicationId: string, deps: ApplyDeps, opts: { maxSteps?: number } = {}): Promise<StepResult> {
  let last = await runApplication(db, applicationId, deps);
  for (let i = 1; i < (opts.maxSteps ?? 8) && last.advanced && !last.waiting && !last.retry && last.status !== "missing" && !isTerminal(last.status); i++) {
    last = await runApplication(db, applicationId, deps);
  }
  return last;
}

// ---------------------------------------------------------------------------------------------------------------------
// preparing
// ---------------------------------------------------------------------------------------------------------------------

async function prepareStep(db: Db, row: ApplicationRow, deps: ApplyDeps): Promise<StepResult> {
  const id = row.id;
  let outcome;
  try {
    outcome = await deps.preparer.prepare(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(db, id, "prepare_error", `Preparing failed, will retry: ${message}`, { level: "warn" });
    return result(id, "preparing", { retry: true, message });
  }
  if (outcome.outcome === "needs_user") {
    const r = await transitionApplication(db, id, "needs_user", { from: "preparing", error: outcome.reason, pendingQuestions: outcome.pending ?? [], message: outcome.reason });
    return result(id, r.ok ? r.application.status : row.status, { advanced: r.ok && !r.noop, waiting: "user" });
  }
  if (outcome.outcome === "failed") {
    const r = await transitionApplication(db, id, "failed", { from: "preparing", error: outcome.error, message: outcome.error });
    return result(id, r.ok ? r.application.status : row.status, { advanced: r.ok && !r.noop, waiting: "done" });
  }
  const r = await transitionApplication(db, id, "prepared", { from: "preparing", message: "Resume and answers are ready" });
  if (r.ok) return result(id, "prepared", { advanced: !r.noop, waiting: "approval" });
  const failed = await transitionApplication(db, id, "failed", { from: "preparing", error: `Preparation ended without a usable resume: ${r.reason}` });
  return result(id, failed.ok ? failed.application.status : row.status, { advanced: failed.ok && !failed.noop, waiting: "done", message: r.reason });
}

// ---------------------------------------------------------------------------------------------------------------------
// applying
// ---------------------------------------------------------------------------------------------------------------------

type BrowserOutcome = { fill: FillResult; submit?: SubmitResult; screenshotPath?: string; driverName: string };

async function mergeReceipt(db: Db, applicationId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await loadApplication(db, applicationId);
  if (!row) return;
  await db.update(applications).set({ receipt: { ...(row.receipt ?? {}), ...patch }, updatedAt: new Date() }).where(eq(applications.id, applicationId));
}

async function applyStep(db: Db, row: ApplicationRow, deps: ApplyDeps): Promise<StepResult> {
  const id = row.id;
  if (inflight.has(id)) return result(id, "applying", { waiting: "concurrent" });
  inflight.add(id);
  try {
    return await applyStepInner(db, row, deps);
  } finally {
    inflight.delete(id);
  }
}

async function applyStepInner(db: Db, row: ApplicationRow, deps: ApplyDeps): Promise<StepResult> {
  const id = row.id;
  const done = (to: ApplicationStatus, r: Awaited<ReturnType<typeof transitionApplication>>, extra: Partial<StepResult> = {}) =>
    result(id, r.ok ? r.application.status : to, { advanced: r.ok && !r.noop, waiting: WAITING_AFTER[to], ...extra, ...(r.ok ? {} : { message: r.reason }) });

  // A worker that died after clicking submit left the marker in the receipt: never click again on its own.
  if (submitMayHaveHappened(row)) {
    const reason = "Submit was already clicked on an earlier run, so Norinote will not send it again. Check the employer's site or your email.";
    return done("needs_user", await transitionApplication(db, id, "needs_user", { from: "applying", error: reason, message: reason }));
  }

  let inputs: ApplyInputs;
  try {
    inputs = await (deps.loadInputs ?? loadApplyInputs)(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error: `Cannot apply: ${message}`, message: `Cannot apply: ${message}` }));
  }

  const drivers = deps.drivers ?? DRIVERS;
  const driver = detectDriver(inputs.applyUrl, drivers);
  const unknownForm = deps.unknownForm ?? defaultUnknownFormHandler;
  // Real submission only when ALLOW_REAL_SUBMIT is exactly "true" (checked again by the driver before the click).
  const dryRun = process.env.ALLOW_REAL_SUBMIT !== "true";
  const driverName = driver?.name ?? "unknown";
  const now = deps.now ?? (() => new Date());

  // Driver events arrive synchronously; write them in order and wait for them before moving on.
  let events: Promise<unknown> = Promise.resolve();
  const flush = () => events;
  const onEvent: DriverContext["onEvent"] = (step, message, data, level?: EventLevel) => {
    events = events.then(async () => {
      await logEvent(db, id, step, message, { level: level ?? "info", data: data ?? null });
      // The click is the one step that cannot be undone: remember it before anything else can fail.
      if (step === "submit") await mergeReceipt(db, id, { submitClicked: true, awaitingCode: false });
    }).catch(() => {});
  };

  const ctx: DriverContext = {
    applicationId: id,
    applyUrl: inputs.applyUrl,
    jobTitle: inputs.jobTitle,
    companyName: inputs.companyName,
    profile: inputs.profile,
    resumePdfPath: inputs.resumePdfPath,
    answers: inputs.answers,
    dryRun,
    onEvent,
    ...(inputs.strategyHints ? { strategyHints: inputs.strategyHints } : {}),
    ...(deps.codes || deps.verification ? {
      waitForCode: async (hint: string) => {
        await flush();
        const since = now();
        await transitionApplication(db, id, "awaiting_code", { from: "applying", receipt: { submitClicked: true, awaitingCode: true }, message: "Waiting for the emailed verification code" });
        const timeoutMs = deps.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
        let code: string | null = null;
        if (deps.verification) {
          const got = await deps.verification({ applicationId: id, since, timeoutMs, accept: "code" }).catch(() => null);
          code = got?.type === "code" ? got.code : null;
        } else if (deps.codes) {
          code = await deps.codes.waitForCode(id, { hint, timeoutMs });
        }
        await transitionApplication(db, id, "applying", { from: "awaiting_code", receipt: { submitClicked: true, awaitingCode: false }, message: code ? "Code received" : "No code arrived" });
        return code;
      },
    } : {}),
  };
  await logEvent(db, id, "apply_start", `Applying through ${driverName}${dryRun ? " (dry run)" : ""}`, { data: { url: inputs.applyUrl, attempt: row.attempts, dryRun } });

  // One application per company at a time, and a cooldown between two.
  const gate = deps.companyGate ?? sharedCompanyGate();
  const release = await gate.acquire(inputs.companyKey ?? inputs.companyName, deps.companyWaitMs ?? 120_000);
  if (!release) {
    await logEvent(db, id, "company_busy", "Another application to this company is running or cooling down; will retry", { level: "warn" });
    return result(id, "applying", { retry: true, message: "company busy" });
  }

  let outcome: BrowserOutcome;
  let artifacts: PoolArtifacts = {};
  try {
    const run = await deps.pool.run(id, async (page, handle) => {
      let fill = driver ? await driver.fill(page, ctx) : await unknownForm.handle(page, ctx);
      // A future AI browser agent may take over an unknown form or fields that failed read-back; unset, nothing changes.
      if (deps.aiFallback && fill.status === "needs_user" && (fill.needsUser?.kind === "unsupported" || (fill.needsUser?.kind === "questions" && fill.pending.length > 0 && !driver))) {
        const helped = await deps.aiFallback.assist(page, { applicationId: id, reason: driver ? "read_back_failed" : "unknown_form", fields: fill.pending.map((p) => ({ label: p.text, reason: "pending" })) }).catch(() => false);
        if (helped) ctx.onEvent("ai_fallback", "The AI browser fallback reported success; re-reading the form");
        if (helped && driver) fill = await driver.fill(page, ctx);
      }
      if (fill.status === "failed" || (fill.needsUser && fill.needsUser.kind !== "questions")) handle.keepArtifacts();
      if (fill.status !== "filled") return { fill, driverName } satisfies BrowserOutcome;

      const screenshotPath = await handle.screenshot("filled");
      if (!driver || !submitAllowed(ctx)) return { fill, screenshotPath, driverName } satisfies BrowserOutcome;

      const submit = await driver.submit(page, ctx);
      if (submit.status === "failed") handle.keepArtifacts();
      const after = await handle.screenshot(submit.status === "submitted" ? "submitted" : "after-submit");
      return { fill, submit, screenshotPath: after ?? screenshotPath, driverName } satisfies BrowserOutcome;
    }, { timeoutMs: (deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) + (deps.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS), owner: row.userId });
    outcome = run.value;
    artifacts = run.artifacts;
  } catch (err) {
    release();
    await flush();
    artifacts = err instanceof PoolRunError ? err.artifacts : {};
    const message = err instanceof Error ? err.message : String(err);
    const latest = (await loadApplication(db, id)) ?? row;
    const emptyFill: FillResult = { status: "failed", formUrl: null, fields: [], files: [], pending: [], durationMs: 0 };
    const receipt = { ...(latest.receipt ?? {}), ...buildReceipt({ driver: driverName, dryRun, fill: emptyFill, ...artifactPaths(artifacts), now: now() }),
      submitClicked: submitMayHaveHappened(latest) || latest.receipt?.submitClicked === true } as Record<string, unknown>;
    if (receipt.submitClicked) {
      const error = `The run broke after submit was clicked (${message}). The employer may have the application: check before trying again.`;
      return done("failed", await transitionApplication(db, id, "failed", { from: latest.status === "awaiting_code" ? "awaiting_code" : "applying", error, receipt, message: error }));
    }
    if (latest.attempts < MAX_ATTEMPTS && !(err instanceof PoolRunError && err.timedOut && latest.attempts >= 2)) {
      await logEvent(db, id, "apply_retry", `Browser step failed, will retry (attempt ${latest.attempts} of ${MAX_ATTEMPTS}): ${message}`, { level: "warn", data: { ...artifacts } });
      return result(id, "applying", { retry: true, message });
    }
    return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error: message, receipt, message: `Failed after ${latest.attempts} attempts: ${message}` }));
  }
  release();
  await flush();

  const { fill, submit } = outcome;
  if (inputs.fingerprint && fill.strategies && Object.keys(fill.strategies).length) {
    await recordStrategies(db, inputs.fingerprint, fill.strategies, fill.healed === true).catch(() => {});
  }
  const latest = (await loadApplication(db, id)) ?? row;
  const prepared = latest.receipt?.prepared;
  const receiptFor = (extra: Partial<Parameters<typeof buildReceipt>[0]> = {}): Record<string, unknown> => ({
    ...(buildReceipt({ driver: driverName, dryRun, fill, submit, screenshotPath: outcome.screenshotPath, ...artifactPaths(artifacts), now: now(), ...extra }) as unknown as Record<string, unknown>),
    ...(prepared ? { prepared } : {}),
    ...(fill.timings ? { timings: { ...fill.timings, ...(submit ? { submitMs: submit.durationMs } : {}) } } : {}),
  });

  // Filling stopped: something is for the person.
  if (fill.status === "needs_user") {
    const reason = fill.needsUser?.reason ?? "Needs your input";
    return done("needs_user", await transitionApplication(db, id, "needs_user", {
      from: "applying", error: reason, pendingQuestions: fill.pending, receipt: receiptFor(), message: reason,
      data: { kind: (fill.needsUser?.kind ?? "other") satisfies NeedsUserKind, pending: fill.pending.map((p) => p.text) },
    }));
  }
  if (fill.status === "failed") {
    const error = fill.error ?? "The form could not be filled";
    return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error, receipt: receiptFor(), message: error }));
  }

  // Filled, and not allowed (or not asked) to submit: dry run.
  if (!submit) {
    return done("prepared", await transitionApplication(db, id, "prepared", {
      from: "applying", receipt: receiptFor({ dryRun: true }), message: "Dry run: the form is filled; stopped before submit", data: { dryRun: true },
    }));
  }

  if (submit.status === "submitted") {
    return done("submitted", await transitionApplication(db, id, "submitted", {
      from: "applying", receipt: receiptFor(), message: submit.confirmationText ?? "Submitted", data: { confirmed: Boolean(submit.confirmationText) },
    }));
  }
  if (submit.status === "needs_user") {
    const reason = submit.needsUser?.reason ?? "Needs your input";
    return done("needs_user", await transitionApplication(db, id, "needs_user", {
      from: "applying", error: reason, pendingQuestions: [], receipt: receiptFor(), message: reason, data: { kind: submit.needsUser?.kind ?? "other" },
    }));
  }
  // Submit failed. Before the click it is safe to try again; after, it is not.
  const error = submit.error ?? "Submit failed";
  if (!submit.submitClicked && latest.attempts < MAX_ATTEMPTS) {
    await logEvent(db, id, "apply_retry", `Submit failed before the click, will retry: ${error}`, { level: "warn" });
    return result(id, "applying", { retry: true, message: error });
  }
  return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error, receipt: receiptFor(), message: error }));
}

const artifactPaths = (a: PoolArtifacts): { screenshotPath?: string; tracePath?: string } => ({
  ...(a.screenshotPath ? { screenshotPath: a.screenshotPath } : {}),
  ...(a.tracePath ? { tracePath: a.tracePath } : {}),
});

// ---------------------------------------------------------------------------------------------------------------------
// Queue handlers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Handler for `apply.run`: a click or autopilot approves a prepared application (idempotent), then the browser step runs.
 * Throws on a transient failure so the queue retries with backoff. Autopilot's daily cap is checked by whoever enqueues.
 */
export function createApplyHandler(db: Db, deps: ApplyDeps): (payload: Payload<"apply.run">) => Promise<void> {
  return async (payload) => {
    const approved = await approveAndSubmit(db, payload.applicationId);
    if (!approved.ok) await logEvent(db, payload.applicationId, "apply_run", `Not started (${payload.trigger}): ${approved.reason}`, { level: "warn" });
    const last = await driveApplication(db, payload.applicationId, deps);
    if (last.retry) throw new Error(last.message ?? "apply step failed; retrying");
  };
}

/** Handler for `prepare.application`: runs the Preparer and stops at `prepared` (or `needs_user`). */
export function createPrepareHandler(db: Db, deps: ApplyDeps): (payload: Payload<"prepare.application">) => Promise<void> {
  return async (payload) => {
    const last = await driveApplication(db, payload.applicationId, deps);
    if (last.retry) throw new Error(last.message ?? "prepare step failed; retrying");
  };
}
