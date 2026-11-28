import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { and, applications, applyBatches, asc, companies, desc, eq, inArray, inboxMessages, jobs, queryRows, resumes, runEvents, shortlist, sql, type Db } from "@norinote/db";
import { applicationInFlight, runLastSeen, RUN_FRESH_MS, approveAndSubmit, approveBeforePrepared, clearSubmitClick, createApplication, dailyCapReached, LiveInput, liveFrameKey, logEvent, markSent, MAX_FINISH_BATCH, retryApplication, saveAnswers, submitMayHaveHappened, transitionApplication, unansweredQuestions, type ApplicationRow, type ApproveResult } from "@norinote/apply";
import { saveAnswer } from "@norinote/answers";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, intParam, notFound, parseBody, uuidParam } from "../http.js";
import { applicationFlow } from "../application-flow.js";
import { brandfetchLogo, companyLogoDomain, toApplication, toJob, toResume, toRunEvent } from "../serialize.js";
import { enqueueRequired, enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

/** `send: true`: Apply is the approval; the application is prepared and goes straight on to the employer's form. */
const Create = z.object({ jobId: z.uuid(), send: z.boolean().optional() });
// A key is the form's own field name, which some employers make their whole consent paragraph
// ("field:By checking this box, you consent to ..."), so it may run to a few hundred characters.
const answerMap = z.record(z.string().min(1).max(2000), z.string().max(5000)).refine((o) => Object.keys(o).length <= 100, "Too many answers");
const Approve = z.object({ answers: answerMap.optional() });
const Answer = z.object({ answers: answerMap });
/** The error an application carries once the person cancelled it. */
export const CANCELLED = "Cancelled by you";
// An emailed verification code as the person typed it: letters, digits, spaces and dashes (some sites print "123 456").
const TypedCode = z.object({ code: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9 -]+$/, "A code has only letters, digits, spaces and dashes") });

const LIST_DESCRIPTION_CHARS = 1200;
/** Finish: which applications with one step left to take in this session (default: the oldest ones). */
const Finish = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_FINISH_BATCH).optional() });

/** The user's own application, or 404 (never reveal that someone else's exists). */
export async function ownedApplication(db: Db, userId: string, id: string): Promise<ApplicationRow> {
  const [row] = await db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).limit(1);
  if (!row) throw notFound("Application not found");
  return row;
}

/** Whether the application's batch is still running (false when it is in none). */
async function batchRunning(db: Db, batchId: string | null): Promise<boolean> {
  if (!batchId) return false;
  const [batch] = await db.select({ status: applyBatches.status }).from(applyBatches).where(eq(applyBatches.id, batchId)).limit(1);
  return batch?.status === "running";
}

/**
 * A user's Apply on a job (the web click, or Telegram): create the application, mark the shortlist row applied, queue the
 * preparation. An existing application is returned as it is (and nudged when stuck in the queue).
 */
export async function startApplication(ctx: Ctx, userId: string, jobId: string): Promise<{ application: ApplicationRow; created: boolean }> {
  const { db } = ctx;
  limitUser(ctx, "apply", userId, 100, 3_600_000, "You are creating applications very quickly. Try again in a few minutes.");
  const res = await createApplication(db, userId, jobId, { now: ctx.now() });
  if (res.created) {
    await db.update(shortlist).set({ status: "applied" }).where(and(eq(shortlist.userId, userId), eq(shortlist.jobId, jobId), eq(shortlist.status, "new")));
    await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: res.application.id });
    return { application: res.application, created: true };
  }
  if (res.reason === "job_not_found") throw notFound("Job not found");
  if (res.reason === "duplicate_recent") {
    throw new HttpError(409, "You already have an application for this role", "Another posting of the same job at this company was queued in the last 30 days.");
  }
  // Already exists: asking again is how a stuck one is nudged (the queue drops the repeat within a minute).
  if (res.application.status === "queued") await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: res.application.id }, { dedupeKey: `prepare:${res.application.id}`, dedupeSeconds: 60 });
  return { application: res.application, created: false };
}

/**
 * Apply with `send: true`: the click is the person's approval. A prepared application goes to the form now; one still
 * being prepared is marked approved, and the worker sends it once it is prepared (see the prepare consumer). Counts
 * against the daily limit like any approval. Nothing changes for one already approved, sent or failed.
 */
export async function sendApplication(ctx: Ctx, userId: string, app: ApplicationRow): Promise<ApplicationRow> {
  if (app.approvedAt || !["queued", "preparing", "prepared", "needs_user"].includes(app.status)) return app;
  if (app.status === "prepared" || app.status === "needs_user") {
    const res = await approveApplication(ctx, app);
    if (!res.ok && res.cap) throw new HttpError(429, `Today's limit of ${res.cap.cap} applications is used up`, "Raise the daily limit in Nori's settings, or try again tomorrow.");
  } else {
    const res = await approveBeforePrepared(ctx.db, app.id, { now: ctx.now(), message: "Apply pressed: Nori sends it as soon as it is prepared", data: { approvedBy: "user", send: true } });
    if (!res.ok) throw new HttpError(429, `Today's limit of ${res.cap.cap} applications is used up`, "Raise the daily limit in Nori's settings, or try again tomorrow.");
  }
  const [row] = await ctx.db.select().from(applications).where(eq(applications.id, app.id)).limit(1);
  return row ?? app;
}

/** The user's approval of a prepared (or parked) application: save any answers, move it to applying, queue the browser step. */
export async function approveApplication(ctx: Ctx, app: ApplicationRow, answers?: Record<string, string>): Promise<ApproveResult> {
  if (answers && Object.keys(answers).length > 0) await saveAnswers(ctx.db, app.id, answers);
  const res = await approveAndSubmit(ctx.db, app.id, { now: ctx.now(), by: "user" });
  if (res.ok && res.started) await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" });
  return res;
}

/**
 * Answers to an application's pending questions (keyed by question id or text), from the web or Telegram: saved on the
 * application, remembered in the answer bank, and a parked application carries on once every required one is answered.
 */
export async function answerApplication(ctx: Ctx, userId: string, app: ApplicationRow, answers: Record<string, string>): Promise<{ ok: true; status: ApplicationRow["status"]; resumed: boolean }> {
  const { db } = ctx;
  const asked = app.pendingQuestions.flatMap((q) => {
    const o = q as { id?: unknown; text?: unknown };
    return typeof o.id === "string" && typeof o.text === "string" ? [{ id: o.id, text: o.text }] : [];
  });
  // Also keep each answer under the question's text. Some forms (Ashby's grouped questions) rename their fields on every
  // load ("field:<form instance>_<question>"), so the next run finds the answer by the question it asks, not the old name.
  const byText: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    const question = asked.find((q) => q.id === key);
    if (question && value.trim() && !(question.text in answers)) byText[question.text] = value;
  }
  await saveAnswers(db, app.id, { ...answers, ...byText });

  // Remember each answer for next time, under the question the form asked.
  for (const [key, value] of Object.entries(answers)) {
    if (!value.trim()) continue;
    const question = asked.find((q) => q.id === key || q.text === key);
    if (!question) continue;
    try {
      await saveAnswer(db, userId, question.text, value.trim(), "user");
    } catch (err) {
      ctx.log(`[api] could not remember an answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A parked application carries on once every required question has an answer. Answering is not approval: one parked
  // before the user's click goes back through prepare and then waits for the click. The person's answers start a fresh
  // set of attempts. When every question is answered and it still cannot go on, the answers are kept and the reply says why.
  let resumed = false;
  let status = app.status;
  let refused: string | null = null;
  if (app.status === "needs_user" && !app.approvedAt) {
    const res = await transitionApplication(db, app.id, "preparing");
    if (res.ok) {
      status = "preparing";
      await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: app.id }, { dedupeKey: `prepare:${app.id}`, dedupeSeconds: 60 });
      resumed = true;
    } else refused = res.reason;
  } else if (app.status === "needs_user") {
    const res = await approveAndSubmit(db, app.id, { now: ctx.now(), by: "user" });
    if (res.ok) {
      status = res.status;
      if (res.started) { await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" }); resumed = true; }
    } else refused = res.reason;
  }
  if (refused) {
    const row = await ownedApplication(db, userId, app.id);
    if (row.status === "needs_user" && unansweredQuestions(row).length === 0) throw new HttpError(409, "Your answers are saved, but this application cannot go on", refused);
  }
  return { ok: true, status, resumed };
}

export function applicationRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const artifacts = ctx.config.artifactsDir;
  const logo = brandfetchLogo(ctx.config.brandfetchClientId);

  async function detail(app: ApplicationRow) {
    const [row] = await db.select({ job: jobs, companyName: companies.name, logoDomain: companyLogoDomain }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, app.jobId)).limit(1);
    if (!row) throw notFound("Job not found");
    const [resume] = app.resumeId ? await db.select().from(resumes).where(and(eq(resumes.id, app.resumeId), eq(resumes.applicationId, app.id))).limit(1) : [];
    const events = await db.select().from(runEvents).where(eq(runEvents.applicationId, app.id)).orderBy(asc(runEvents.ts), asc(runEvents.id)).limit(500);
    return {
      application: toApplication(app, artifacts, { batchRunning: await batchRunning(db, app.batchId) }),
      job: toJob(row.job, { name: row.companyName, logoUrl: logo(row.logoDomain) }),
      resume: resume ? toResume(resume) : null,
      events: events.map(toRunEvent),
    };
  }

  /** What a status change means for the queue: queued and preparing need preparing, applying needs the browser. */
  async function queueFor(app: ApplicationRow): Promise<void> {
    if (app.status === "queued" || app.status === "preparing") await enqueueRequired(ctx, JOBS.prepareApplication, { applicationId: app.id });
    else if (app.status === "applying") await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" });
  }

  // The tracker: where the person's applications went, as Sankey nodes and links. `days` limits it to applications
  // started in that many days (default all).
  r.get("/flow", auth, async (c) => {
    const raw = c.req.query("days");
    const days = raw ? intParam(raw, 0, 1, 3650) : null;
    return c.json(await applicationFlow(db, c.get("user").id, { now: ctx.now(), days }));
  });

  // Overview's activity graph: applications sent per day (submittedAt), the last `days` days (default 182), in `tz`.
  r.get("/activity", auth, async (c) => {
    const days = intParam(c.req.query("days") ?? "182", 182, 1, 730);
    const tz = validTimeZone(c.req.query("tz")) ?? "UTC";
    return c.json(await sentPerDay(db, c.get("user").id, ctx.now(), days, tz));
  });

  r.get("/", auth, async (c) => {
    const rows = await db.select({ app: applications, job: jobs, companyName: companies.name, logoDomain: companyLogoDomain, resume: resumes, batchStatus: applyBatches.status }).from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(resumes, and(eq(resumes.id, applications.resumeId), eq(resumes.applicationId, applications.id)))
      .leftJoin(applyBatches, eq(applyBatches.id, applications.batchId))
      .where(eq(applications.userId, c.get("user").id)).orderBy(desc(applications.createdAt)).limit(200);
    return c.json(rows.map((x) => ({
      application: toApplication(x.app, artifacts, { batchRunning: x.batchStatus === "running" }),
      job: toJob({ ...x.job, descriptionText: x.job.descriptionText.slice(0, LIST_DESCRIPTION_CHARS) }, { name: x.companyName, logoUrl: logo(x.logoDomain) }),
      resume: x.resume ? toResume(x.resume) : null,
    })));
  });

  r.post("/", auth, async (c) => {
    const { jobId, send } = await parseBody(c, Create);
    const userId = c.get("user").id;
    if (send) {
      const cap = await dailyCapReached(db, userId, ctx.now());
      if (cap) throw new HttpError(429, `Today's limit of ${cap.cap} applications is used up`, "Raise the daily limit in Nori's settings, or try again tomorrow.");
    }
    const res = await startApplication(ctx, userId, jobId);
    const app = send ? await sendApplication(ctx, userId, res.application) : res.application;
    return c.json(toApplication(app, artifacts, { batchRunning: await batchRunning(db, app.batchId) }), res.created ? 201 : 200);
  });

  r.get("/:id", auth, async (c) => c.json(await detail(await ownedApplication(db, c.get("user").id, uuidParam(c)))));

  r.post("/:id/approve", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const body = await parseBody(c, Approve);
    const res = await approveApplication(ctx, app, body.answers);
    if (!res.ok && res.cap) throw new HttpError(429, "Today's limit is used up", `Your limit is ${res.cap.cap} applications a day. Raise it in You, or send this one tomorrow.`);
    if (!res.ok) throw new HttpError(409, "This application is not ready to submit", res.reason);
    return c.json({ ok: true, status: res.status, started: res.started });
  });

  r.post("/:id/answer", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const { answers } = await parseBody(c, Answer);
    return c.json(await answerApplication(ctx, user.id, app, answers));
  });

  // The person types the code the employer emailed them while the run is waiting on the page (status awaiting_code). It is
  // stored like an emailed code linked to this application, so the waiting run (awaitVerification) takes it within seconds.
  r.post("/:id/code", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const { code } = await parseBody(c, TypedCode);
    if (app.status !== "awaiting_code") throw new HttpError(409, "This application is not waiting for a code", app.status);
    const at = ctx.now();
    await db.insert(inboxMessages).values({
      userId: user.id, applicationId: app.id, kind: "verification_code", code: code.replace(/[\s-]+/g, ""),
      fromAddress: "you (typed in Norinote)", messageId: `typed:${app.id}:${at.getTime()}`, subject: "Code you typed",
      meta: { typed: true, trusted: true }, receivedAt: at,
    });
    await db.insert(runEvents).values({ applicationId: app.id, step: "code_typed", message: "You typed the verification code", ts: at });
    return c.json({ ok: true });
  });

  // An application Nori clicked submit on and could not confirm is the one case the worker will not resolve on its own:
  // only the person knows whether the employer has it. These two are their answer.
  r.post("/:id/marked-sent", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const res = await markSent(db, app.id, { now: ctx.now() });
    if (!res.ok || !res.application) throw new HttpError(409, "Could not mark this application as sent", res.ok ? "application not found" : res.reason);
    return c.json({ ok: true, status: res.application.status });
  });

  r.post("/:id/not-sent", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const res = await clearSubmitClick(db, app.id, { now: ctx.now() });
    if (!res.ok || !res.application) throw new HttpError(409, "Could not clear the submit mark", res.ok ? "application not found" : res.reason);
    return c.json({ ok: true, status: res.application.status });
  });

  // The person drops an application they no longer want. Only while no browser is on the employer's page (a running
  // or code-waiting run could still submit) and nothing says the employer may already have it: a marked click is the
  // person's to settle first (marked-sent, or not-sent). It becomes failed with "Cancelled by you", and Retry brings it
  // back. A run counts as live while this process holds it or it wrote something in the last two minutes; a run the
  // queue gave up on, or one that crashed, no longer blocks the person for 25 minutes.
  r.post("/:id/cancel", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    if (app.status === "submitted") throw new HttpError(409, "This application was already sent", app.status);
    if (submitMayHaveHappened(app)) throw new HttpError(409, "Nori clicked submit on this one and could not confirm it", "If it did not reach the employer, say so first; then you can cancel or try again.");
    const lastSeen = app.status === "applying" || app.status === "awaiting_code" ? await runLastSeen(db, app.id) : null;
    const live = !!lastSeen && (applicationInFlight(app.id) || ctx.now().getTime() - lastSeen.getTime() < RUN_FRESH_MS);
    if (live) throw new HttpError(409, "Nori is on the employer's page right now; cancel once this run finishes", app.status);
    if (app.status === "failed") return c.json({ ok: true, status: app.status });
    const res = await transitionApplication(db, app.id, "failed", { from: app.status, error: CANCELLED, message: CANCELLED, by: "user" });
    if (!res.ok) throw new HttpError(409, "Could not cancel this application", res.reason);
    return c.json({ ok: true, status: res.application.status });
  });

  // "Watch Nori apply": the latest picture of the employer's page while Nori works on it (about one a second), for the
  // owner only. 404 when there is none (not started, or removed a while after the run). Never cached.
  r.get("/:id/live", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const key = liveFrameKey(app.userId, app.id);
    const local = await readFile(path.join(artifacts, key)).catch(() => null);
    const bytes = local ?? (ctx.files ? await ctx.files.get(key).catch(() => null) : null);
    if (!bytes) throw notFound("No live view for this application right now");
    return c.body(new Uint8Array(bytes), 200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-live-status": app.status });
  });

  // Finish: the person takes the last step (a captcha, a sign-in) of their applications with one step left in Nori's live
  // view. One session for up to 5, oldest first; the worker opens each in turn and hands the wall to the person.
  r.post("/finish", auth, async (c) => {
    const user = c.get("user");
    const { ids } = await parseBody(c, Finish);
    limitUser(ctx, "finish", user.id, 30, 3_600_000, "You started Finish many times in a row. Try again in a few minutes.");
    const rows = await db.select({ id: applications.id }).from(applications)
      .where(and(eq(applications.userId, user.id), eq(applications.status, "ready_to_finish"), ids ? inArray(applications.id, ids) : undefined))
      .orderBy(asc(applications.updatedAt)).limit(MAX_FINISH_BATCH);
    if (!rows.length) throw new HttpError(409, "Nothing is waiting for its last step", "Only applications with one step left can be finished.");
    const applicationIds = rows.map((r) => r.id);
    await enqueueRequired(ctx, JOBS.applyFinish, { userId: user.id, applicationIds }, { dedupeKey: `finish:${user.id}`, dedupeSeconds: 30 });
    for (const id of applicationIds) await logEvent(db, id, "finish_requested", "Finish pressed: Nori opens it in the live view");
    return c.json({ ok: true, applicationIds });
  });

  // The person's click, keys or scroll on the live view while Nori hands them a captcha or a sign-in page. Passed straight
  // to the worker holding the page; never stored or logged (it may be a password). 409 when no hand-off is open.
  r.post("/:id/live/input", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "live-input", user.id, 1200, 60_000, "Too many inputs at once. Slow down a little.");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const input = await parseBody(c, LiveInput);
    if (app.status !== "applying" || !app.receipt?.handoff) throw new HttpError(409, "Nori isn't waiting for you on this application", app.status);
    await ctx.liveInputs.publish(app.id, input);
    return c.json({ ok: true });
  });

  r.post("/:id/retry", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const res = await retryApplication(db, app.id);
    if (!res.ok) throw new HttpError(409, "Nothing to retry on this application", res.reason);
    if (!res.noop) await queueFor(res.application);
    return c.json({ ok: true, status: res.application.status });
  });

  return r;
}

/** An IANA time zone name the runtime knows, else null. */
export function validTimeZone(tz: string | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** The local date (YYYY-MM-DD) of `at` in `tz`. */
const localDate = (at: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** Applications sent per local day for the last `days` days, every day listed (0 when none), oldest first. */
export async function sentPerDay(db: Db, userId: string, now: Date, days: number, tz: string): Promise<{ days: { date: string; sent: number }[]; total: number; timezone: string }> {
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);
  const rows = await queryRows<{ date: string; sent: number }>(db, sql`
    SELECT to_char(${applications.submittedAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date, count(*)::int AS sent
    FROM ${applications}
    WHERE ${applications.userId} = ${userId} AND ${applications.submittedAt} IS NOT NULL AND ${applications.submittedAt} >= ${since.toISOString()}::timestamptz
    GROUP BY 1`);
  const byDate = new Map(rows.map((r) => [r.date, r.sent]));
  const out: { date: string; sent: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(new Date(now.getTime() - i * 86_400_000), tz);
    if (out.at(-1)?.date === date) continue;
    out.push({ date, sent: byDate.get(date) ?? 0 });
  }
  return { days: out, total: out.reduce((n, d) => n + d.sent, 0), timezone: tz };
}
