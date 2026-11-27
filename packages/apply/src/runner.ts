import type { ApplicationStatus } from "@norinote/shared";
import { and, applications, asc, desc, eq, inArray, lt, runEvents, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import type { Payload } from "@norinote/queue";
import { defaultUnknownFormHandler, detectDriver, DRIVERS } from "./drivers/index.js";
import { FINISH_ACCOUNT_REASON, FINISH_CAPTCHA_REASON, submitAllowed } from "./flow.js";
import { loadApplyInputs, type ApplyInputs } from "./inputs.js";
import { PoolRunError, type BrowserPool, type PoolArtifacts } from "./pool.js";
import { buildReceipt, type DraftedAnswer } from "./receipt.js";
import { sharedCompanyGate, type CompanyGate } from "./gate.js";
import { recordStrategies } from "./recipes.js";
import { isTerminal, MAX_ATTEMPTS, submitMayHaveHappened } from "./state.js";
import { approveAndSubmit, loadApplication, logEvent, transitionApplication, type ApplicationRow } from "./store.js";
import { JOB_CLOSED_REASON, OPEN_CHECK_FRESH_MS, type StillOpen } from "./still-open.js";
import { startLiveFrames, type LiveFrameSink } from "./live.js";
import { applyLiveInput, type LiveInput, type LiveInputBus } from "./control.js";
import { detectCaptcha } from "./form.js";
import { PASSWORD_SCRIPT, runScript } from "./dom.js";
import type { Page } from "playwright";
import type { RunHandle } from "./pool.js";
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
  /** "Watch Nori apply": receives a viewport JPEG about every `liveFrameMs` while the run is on the page. Unset = none. */
  liveFrames?: LiveFrameSink;
  /** Interval between live frames (default 1000 ms). */
  liveFrameMs?: number;
  /**
   * Is the job still open? Asked before preparing and before the browser step (`checkStillOpen`, wired by the worker).
   * Unset = not checked.
   */
  stillOpen?: (db: Db, jobId: string) => Promise<StillOpen>;
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

const WAITING_AFTER: Partial<Record<ApplicationStatus, WaitingFor>> = { submitted: "done", failed: "done", needs_user: "user", ready_to_finish: "user", prepared: "approval" };

/** Walls only the person can get past, in Nori's live view: the application parks as ready_to_finish, not needs_user. */
const FINISH_REASON: Partial<Record<NeedsUserKind, string>> = { captcha: FINISH_CAPTCHA_REASON, account: FINISH_ACCOUNT_REASON };

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
 *   ready_to_finish -> waits for the person's Finish (a captcha or a sign-in only they can do)
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
    case "ready_to_finish":
      return result(applicationId, "ready_to_finish", { waiting: "user", message: row.error ?? undefined });
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

/** How long a run may leave an application untouched before it counts as lost: apply.run's 20-minute lease, plus a margin. */
export const STALE_RUN_MS = 25 * 60_000;

/** A browser step of this process is on this application right now (Cancel is refused while one is). */
export const applicationInFlight = (applicationId: string): boolean => inflight.has(applicationId);

export type StaleRun = { applicationId: string; status: "preparing" | "applying" | "awaiting_code" };

/**
 * Applications a lost run left behind: a deploy or crash in the middle of one, or a queue job that ran out of retries.
 * Nothing touched them for STALE_RUN_MS and no run of this process has them. The caller queues them again
 * (`prepare.application` for preparing, `apply.run` for the rest), and `runApplication` carries on from where they are;
 * it never clicks submit again when an earlier run may have (see applyStepInner).
 */
export async function staleRuns(db: Db, opts: { now?: Date; olderThanMs?: number; limit?: number } = {}): Promise<StaleRun[]> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.olderThanMs ?? STALE_RUN_MS));
  const rows = await db.select({ applicationId: applications.id, status: applications.status }).from(applications)
    .where(and(inArray(applications.status, ["preparing", "applying", "awaiting_code"]), lt(applications.updatedAt, cutoff)))
    .orderBy(asc(applications.updatedAt)).limit(opts.limit ?? 50);
  return rows.filter((r) => !inflight.has(r.applicationId)) as StaleRun[];
}

// ---------------------------------------------------------------------------------------------------------------------
// preparing
// ---------------------------------------------------------------------------------------------------------------------

/** The run-log step of an open check; its `data.state` is open, closed or unknown. */
export const STILL_OPEN_STEP = "still_open";

/**
 * Before an application is spent (prepared, or sent): is the job still open? A closed job closes the application
 * (`failed`, with the reason); an open one is not asked about again for `OPEN_CHECK_FRESH_MS`; a check that could not
 * tell (network trouble) lets the application go on. Null when the application goes on.
 */
async function closedJobStop(db: Db, row: ApplicationRow, deps: ApplyDeps, from: "preparing" | "applying"): Promise<StepResult | null> {
  if (!deps.stillOpen) return null;
  const [last] = await db.select({ ts: runEvents.ts }).from(runEvents)
    .where(and(eq(runEvents.applicationId, row.id), eq(runEvents.step, STILL_OPEN_STEP), sql`${runEvents.data}->>'state' = 'open'`))
    .orderBy(desc(runEvents.ts)).limit(1);
  if (last && Date.now() - last.ts.getTime() < OPEN_CHECK_FRESH_MS) return null;
  const check = await deps.stillOpen(db, row.jobId).catch((err): StillOpen => ({ state: "unknown", why: err instanceof Error ? err.message : String(err) }));
  const said = check.state === "open" ? "The job is still open" : check.state === "closed" ? "The job is closed" : "Could not tell whether the job is still open; going on";
  await logEvent(db, row.id, STILL_OPEN_STEP, `${said} (${check.why})`, { level: check.state === "open" ? "info" : "warn", data: { state: check.state, status: check.status ?? null, before: from === "preparing" ? "prepare" : "submit" } });
  if (check.state !== "closed") return null;
  const r = await transitionApplication(db, row.id, "failed", { from, error: JOB_CLOSED_REASON, message: JOB_CLOSED_REASON, data: { jobClosed: true } });
  return result(row.id, r.ok ? r.application.status : row.status, { advanced: r.ok && !r.noop, waiting: "done", message: JOB_CLOSED_REASON });
}

async function prepareStep(db: Db, row: ApplicationRow, deps: ApplyDeps): Promise<StepResult> {
  const id = row.id;
  const closed = await closedJobStop(db, row, deps, "preparing");
  if (closed) return closed;
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

/** The receipt as it is now with `patch` on top, for a move that sets the receipt: what was prepared stays. */
async function receiptWith(db: Db, applicationId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await loadApplication(db, applicationId);
  return { ...(row?.receipt ?? {}), ...patch };
}

/**
 * The browser try that just broke will be tried again, so it counts as an attempt now. Only a move into applying used to
 * count, and the queue's own retries never make one, so the limit was never reached.
 */
async function countRetry(db: Db, row: ApplicationRow): Promise<void> {
  await db.update(applications).set({ attempts: row.attempts + 1, updatedAt: new Date() })
    .where(and(eq(applications.id, row.id), eq(applications.status, "applying")));
}

/** A Finish session's page: every application in it runs on this one page, and walls are handed to the person. */
type Session = { page: Page; handle: RunHandle; handoff: (applicationId: string, kind: "captcha" | "account") => Promise<boolean> };

async function applyStep(db: Db, row: ApplicationRow, deps: ApplyDeps, session?: Session): Promise<StepResult> {
  const id = row.id;
  if (inflight.has(id)) return result(id, "applying", { waiting: "concurrent" });
  inflight.add(id);
  try {
    return await applyStepInner(db, row, deps, session);
  } finally {
    inflight.delete(id);
  }
}

async function applyStepInner(db: Db, row: ApplicationRow, deps: ApplyDeps, session?: Session): Promise<StepResult> {
  const id = row.id;
  const done = (to: ApplicationStatus, r: Awaited<ReturnType<typeof transitionApplication>>, extra: Partial<StepResult> = {}) =>
    result(id, r.ok ? r.application.status : to, { advanced: r.ok && !r.noop, waiting: WAITING_AFTER[to], ...extra, ...(r.ok ? {} : { message: r.reason }) });

  // A worker that died after clicking submit left the marker in the receipt: never click again on its own.
  if (submitMayHaveHappened(row)) {
    const reason = "Submit was already clicked on an earlier run, so Norinote will not send it again. Check the employer's site or your email.";
    return done("needs_user", await transitionApplication(db, id, "needs_user", { from: "applying", error: reason, message: reason }));
  }

  const closed = await closedJobStop(db, row, deps, "applying");
  if (closed) return closed;

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
    }).catch(() => {});
  };

  // The click is the one step that cannot be undone: it is stored, and the write confirmed, before the driver clicks.
  // A code that went missing, or a captcha that held the form, on an earlier run says nothing about this click, so their
  // marks go.
  const recordSubmitClick = async () => {
    await flush();
    const [marked] = await db.update(applications)
      .set({ receipt: sql`coalesce(${applications.receipt}, '{}'::jsonb) || '{"submitClicked":true,"awaitingCode":false,"codeMissing":false,"captchaHeld":false}'::jsonb`, updatedAt: new Date() })
      .where(and(eq(applications.id, id), eq(applications.status, "applying")))
      .returning({ id: applications.id });
    if (!marked) throw new Error("Could not record the submit click, so submit was not clicked");
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
    recordSubmitClick,
    ...(inputs.strategyHints ? { strategyHints: inputs.strategyHints } : {}),
    ...(session ? { handoff: async (kind: "captcha" | "account") => { await flush(); return session.handoff(id, kind); } } : {}),
    ...(deps.codes || deps.verification ? {
      waitForCode: async (hint: string) => {
        await flush();
        const since = now();
        await transitionApplication(db, id, "awaiting_code", { from: "applying", receipt: await receiptWith(db, id, { submitClicked: true, awaitingCode: true }), message: "Waiting for the emailed verification code" });
        const timeoutMs = deps.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
        let code: string | null = null;
        let found = "Code received";
        if (deps.verification) {
          const got = await deps.verification({ applicationId: id, since, timeoutMs, accept: "code" }).catch(() => null);
          code = got?.type === "code" ? got.code : null;
          if (code) found = codeFoundMessage(got?.source, got?.from);
        } else if (deps.codes) {
          code = await deps.codes.waitForCode(id, { hint, timeoutMs });
        }
        // The message says where the code came from, never the code itself.
        await transitionApplication(db, id, "applying", { from: "awaiting_code", receipt: await receiptWith(db, id, { submitClicked: true, awaitingCode: false }), message: code ? found : "No code arrived" });
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
    const watched = async (page: Page, handle: RunHandle): Promise<BrowserOutcome> => {
      const sink = deps.liveFrames;
      const stopLive = sink ? startLiveFrames(page, (jpeg) => sink({ applicationId: id, userId: row.userId, jpeg }), deps.liveFrameMs ?? (session ? 500 : 1000)) : null;
      try {
        return await onPage(page, handle);
      } finally {
        await stopLive?.();
      }
    };
    const run = session
      ? { value: await watched(session.page, session.handle), artifacts: {} }
      : await deps.pool.run(id, watched, { timeoutMs: (deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) + (deps.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS), owner: row.userId });
    outcome = run.value;
    artifacts = run.artifacts;
    async function onPage(page: Parameters<Parameters<BrowserPool["run"]>[1]>[0], handle: Parameters<Parameters<BrowserPool["run"]>[1]>[1]): Promise<BrowserOutcome> {
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
    }
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
      await countRetry(db, latest);
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
  // The stored mark wins over what the driver reported: a click that threw half way may still have gone through.
  const clickRecorded = submitMayHaveHappened(latest);
  const prepared = latest.receipt?.prepared;
  const receiptFor = (extra: Partial<Parameters<typeof buildReceipt>[0]> = {}): Record<string, unknown> => ({
    ...(buildReceipt({ driver: driverName, dryRun, fill, submit, screenshotPath: outcome.screenshotPath, ...artifactPaths(artifacts), drafted: (prepared as { drafted?: DraftedAnswer[] } | undefined)?.drafted, now: now(), ...extra }) as unknown as Record<string, unknown>),
    ...(clickRecorded ? { submitClicked: true } : {}),
    ...(prepared ? { prepared } : {}),
    ...(fill.timings ? { timings: { ...fill.timings, ...(submit ? { submitMs: submit.durationMs } : {}) } } : {}),
  });

  // Filling stopped at a captcha or a sign-in with every answer in hand: one step left, for the person in the live view.
  const finishReason = fill.status === "needs_user" && fill.pending.length === 0 && fill.needsUser ? FINISH_REASON[fill.needsUser.kind] : undefined;
  if (finishReason) {
    return done("ready_to_finish", await transitionApplication(db, id, "ready_to_finish", {
      from: "applying", error: finishReason, receipt: receiptFor(), message: finishReason, data: { kind: fill.needsUser!.kind },
    }));
  }
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
  // The click met a captcha challenge: the challenge holds the form until it is solved, so nothing was sent yet.
  if (submit.status === "needs_user" && submit.needsUser?.kind === "captcha") {
    return done("ready_to_finish", await transitionApplication(db, id, "ready_to_finish", {
      from: "applying", error: FINISH_CAPTCHA_REASON, receipt: { ...receiptFor(), captchaHeld: true }, message: FINISH_CAPTCHA_REASON, data: { kind: "captcha", afterSubmit: true },
    }));
  }
  if (submit.status === "needs_user") {
    const reason = submit.needsUser?.reason ?? "Needs your input";
    // After the click the site asked for an emailed code and none came: it never took the application, so a retry is safe.
    const codeMissing = submit.submitClicked && submit.needsUser?.kind === "verification_code";
    return done("needs_user", await transitionApplication(db, id, "needs_user", {
      from: "applying", error: reason, pendingQuestions: [], receipt: { ...receiptFor(), ...(codeMissing ? { codeMissing: true } : {}) }, message: reason, data: { kind: submit.needsUser?.kind ?? "other" },
    }));
  }
  // Submit failed. Before the click it is safe to try again; after, it is not.
  const error = submit.error ?? "Submit failed";
  if (!submit.submitClicked && clickRecorded) {
    const after = `The run stopped at the submit click (${error}). The employer may have the application: check before trying again.`;
    return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error: after, receipt: receiptFor(), message: after }));
  }
  if (!submit.submitClicked && latest.attempts < MAX_ATTEMPTS) {
    await logEvent(db, id, "apply_retry", `Submit failed before the click, will retry: ${error}`, { level: "warn" });
    await countRetry(db, latest);
    return result(id, "applying", { retry: true, message: error });
  }
  return done("failed", await transitionApplication(db, id, "failed", { from: "applying", error, receipt: receiptFor(), message: error }));
}

const artifactPaths = (a: PoolArtifacts): { screenshotPath?: string; tracePath?: string } => ({
  ...(a.screenshotPath ? { screenshotPath: a.screenshotPath } : {}),
  ...(a.tracePath ? { tracePath: a.tracePath } : {}),
});

// ---------------------------------------------------------------------------------------------------------------------
// Finish: the person does the last step in the live view
// ---------------------------------------------------------------------------------------------------------------------

/** Applications one Finish session takes, one after another on one page. */
export const MAX_FINISH_BATCH = 5;
const DEFAULT_HANDOFF_MS = 10 * 60_000;

export type FinishDeps = ApplyDeps & {
  /** Where the person's clicks and keys arrive from (POST /api/applications/:id/live/input). */
  inputs: LiveInputBus;
  /** How long Nori waits for the person at one wall (default 10 minutes). */
  handoffTimeoutMs?: number;
  /** How often Nori looks whether the wall is gone (default 1 s). */
  handoffPollMs?: number;
};

/** Opens (or with null, closes) the hand-off on the receipt, merged in place like the submit click. */
const setHandoff = (db: Db, applicationId: string, handoff: { kind: string; since: string } | null) =>
  db.update(applications)
    .set({ receipt: sql`coalesce(${applications.receipt}, '{}'::jsonb) || jsonb_build_object('handoff', ${JSON.stringify(handoff)}::jsonb)`, updatedAt: new Date() })
    .where(eq(applications.id, applicationId));

const wallCleared = async (page: Page, kind: "captcha" | "account"): Promise<boolean> =>
  kind === "captcha" ? (await detectCaptcha(page)) === null : !(await runScript<boolean>(page, PASSWORD_SCRIPT).catch(() => true));

/**
 * Hands one wall to the person: the receipt says so (the dashboard makes the live view clickable), their inputs are played
 * on the page, and Nori looks every `handoffPollMs` whether the wall is gone (twice in a row, or once after the person
 * says done). Resolves false when they stop, the wait runs out, or the page is gone. Inputs are never logged or stored.
 */
async function handOffToPerson(db: Db, page: Page, applicationId: string, kind: "captcha" | "account", deps: FinishDeps): Promise<boolean> {
  const timeoutMs = deps.handoffTimeoutMs ?? DEFAULT_HANDOFF_MS;
  const pollMs = deps.handoffPollMs ?? 1000;
  const inbox: LiveInput[] = [];
  let wake: (() => void) | null = null;
  const off = await deps.inputs.subscribe(applicationId, (input) => { inbox.push(input); wake?.(); });
  await setHandoff(db, applicationId, { kind, since: (deps.now ?? (() => new Date()))().toISOString() });
  await logEvent(db, applicationId, "handoff", kind === "captcha"
    ? "Your turn: solve the captcha in the live view. Nori carries on once it's gone."
    : "Your turn: sign in in the live view. Nori fills the form once you're in. Nori never stores your password.", { data: { kind } });
  let outcome: "done" | "cancelled" | "timeout" = "timeout";
  try {
    const deadline = Date.now() + timeoutMs;
    let lastLook = 0;
    let clearLooks = 0;
    while (Date.now() < deadline && !page.isClosed()) {
      let checkNow = false;
      while (inbox.length) {
        const input = inbox.shift()!;
        if (input.kind === "cancel") outcome = "cancelled";
        else if (input.kind === "done") checkNow = true;
        else await applyLiveInput(page, input).catch(() => {});
      }
      if (outcome === "cancelled") break;
      if (checkNow || Date.now() - lastLook >= pollMs) {
        lastLook = Date.now();
        clearLooks = (await wallCleared(page, kind).catch(() => false)) ? clearLooks + 1 : 0;
        if (clearLooks >= 2 || (checkNow && clearLooks >= 1)) { outcome = "done"; break; }
      }
      await new Promise<void>((resolve) => { wake = resolve; setTimeout(resolve, Math.max(50, pollMs - (Date.now() - lastLook))); });
      wake = null;
    }
  } finally {
    await off();
    await setHandoff(db, applicationId, null);
  }
  await logEvent(db, applicationId, "handoff_done", outcome === "done" ? "Thanks, Nori takes it from here"
    : outcome === "cancelled" ? "You stopped the live view" : `Nobody took the step in ${Math.round(timeoutMs / 60_000)} minutes`, { data: { kind, outcome } });
  return outcome === "done";
}

/**
 * A Finish session: the person's applications with one step left, one after another on one fresh browser context. Each is
 * filled again from its recipe and answers; at the captcha or sign-in Nori hands the page to the person in the live view,
 * waits until it is done, then submits. A sign-in carries over to the next application in the session; the context, and
 * with it every sign-in, is thrown away at the end. Nothing in the session is traced or kept as a failure screenshot.
 * An application the person did not get past goes back to ready_to_finish.
 */
export async function finishApplications(db: Db, userId: string, applicationIds: string[], deps: FinishDeps): Promise<StepResult[]> {
  const ids = [...new Set(applicationIds)].slice(0, MAX_FINISH_BATCH);
  const results: StepResult[] = [];
  const perApp = (deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) + (deps.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS) + (deps.handoffTimeoutMs ?? DEFAULT_HANDOFF_MS);
  const backToFinish = async (id: string, why: string) => {
    const r = await transitionApplication(db, id, "ready_to_finish", { from: "applying", error: `${why} Press Finish to try again.`, message: why });
    return result(id, r.ok ? r.application.status : "applying", { advanced: r.ok && !r.noop, waiting: "user", message: why });
  };
  let current: string | null = null;
  try {
    await deps.pool.run(`finish-${userId}`, async (page, handle) => {
      const session: Session = { page, handle, handoff: (id, kind) => handOffToPerson(db, page, id, kind, deps) };
      for (const id of ids) {
        const row = await loadApplication(db, id);
        if (!row || row.userId !== userId || row.status !== "ready_to_finish") {
          results.push(result(id, row?.userId === userId ? row.status : "missing", { message: "not waiting for its last step" }));
          continue;
        }
        const moved = await transitionApplication(db, id, "applying", { from: "ready_to_finish", by: "user", message: "Finish pressed: Nori fills it again and hands you the last step" });
        if (!moved.ok) { results.push(result(id, row.status, { message: moved.reason })); continue; }
        current = id;
        const step = await applyStep(db, moved.application, deps, session);
        current = null;
        // A try that broke is not retried in the background, where nobody could take the step: it waits for Finish.
        results.push(step.retry && step.status === "applying" ? await backToFinish(id, `The run broke (${step.message ?? "unknown error"}).`) : step);
      }
    }, { personal: true, owner: userId, timeoutMs: perApp * Math.max(1, ids.length) });
  } catch (err) {
    if (current) results.push(await backToFinish(current, `The live view stopped (${err instanceof Error ? err.message : String(err)}).`));
  }
  return results;
}

/** Handler for `apply.finish`: one Finish session for the person's chosen applications. */
export function createFinishHandler(db: Db, deps: FinishDeps): (payload: Payload<"apply.finish">) => Promise<void> {
  return async (payload) => { await finishApplications(db, payload.userId, payload.applicationIds, deps); };
}

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

/** The run log line for a code that arrived: where it came from (and who sent it), never the code. */
export function codeFoundMessage(source: "gmail" | "typed" | "email" | undefined, from: string | undefined): string {
  const sender = from?.match(/<([^>]+)>/)?.[1] ?? from?.trim();
  const by = sender ? ` (from ${sender})` : "";
  if (source === "gmail") return `Found the code in your Gmail${by}; entering it`;
  if (source === "typed") return "Using the code you typed";
  return `Code received by email${by}; entering it`;
}
