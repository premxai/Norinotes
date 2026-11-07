import { Hono } from "hono";
import { z } from "zod";
import { and, applications, asc, companies, desc, eq, jobs, resumes, runEvents, shortlist, type Db } from "@norinote/db";
import { approveAndSubmit, createApplication, retryApplication, saveAnswers, transitionApplication, type ApplicationRow, type ApproveResult } from "@norinote/apply";
import { saveAnswer } from "@norinote/answers";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { brandfetchLogo, companyLogoDomain, toApplication, toJob, toResume, toRunEvent } from "../serialize.js";
import { enqueueRequired, enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const Create = z.object({ jobId: z.uuid() });
// A key is the form's own field name, which some employers make their whole consent paragraph
// ("field:By checking this box, you consent to ..."), so it may run to a few hundred characters.
const answerMap = z.record(z.string().min(1).max(2000), z.string().max(5000)).refine((o) => Object.keys(o).length <= 100, "Too many answers");
const Approve = z.object({ answers: answerMap.optional() });
const Answer = z.object({ answers: answerMap });

const LIST_DESCRIPTION_CHARS = 1200;

/** The user's own application, or 404 (never reveal that someone else's exists). */
export async function ownedApplication(db: Db, userId: string, id: string): Promise<ApplicationRow> {
  const [row] = await db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).limit(1);
  if (!row) throw notFound("Application not found");
  return row;
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

/** The user's approval of a prepared (or parked) application: save any answers, move it to applying, queue the browser step. */
export async function approveApplication(ctx: Ctx, app: ApplicationRow, answers?: Record<string, string>): Promise<ApproveResult> {
  if (answers && Object.keys(answers).length > 0) await saveAnswers(ctx.db, app.id, answers);
  const res = await approveAndSubmit(ctx.db, app.id, { now: ctx.now() });
  if (res.ok && res.started) await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" });
  return res;
}

/**
 * Answers to an application's pending questions (keyed by question id or text), from the web or Telegram: saved on the
 * application, remembered in the answer bank, and a parked application carries on once every required one is answered.
 */
export async function answerApplication(ctx: Ctx, userId: string, app: ApplicationRow, answers: Record<string, string>): Promise<{ ok: true; status: ApplicationRow["status"]; resumed: boolean }> {
  const { db } = ctx;
  await saveAnswers(db, app.id, answers);

  // Remember each answer for next time, under the question the form asked.
  const asked = app.pendingQuestions.flatMap((q) => {
    const o = q as { id?: unknown; text?: unknown };
    return typeof o.id === "string" && typeof o.text === "string" ? [{ id: o.id, text: o.text }] : [];
  });
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
  // before the user's click goes back through prepare and then waits for the click.
  let resumed = false;
  let status = app.status;
  if (app.status === "needs_user" && !app.approvedAt) {
    const res = await transitionApplication(db, app.id, "preparing");
    if (res.ok) {
      status = "preparing";
      await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: app.id }, { dedupeKey: `prepare:${app.id}`, dedupeSeconds: 60 });
      resumed = true;
    }
  } else if (app.status === "needs_user") {
    const res = await approveAndSubmit(db, app.id, { now: ctx.now() });
    if (res.ok) {
      status = res.status;
      if (res.started) { await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" }); resumed = true; }
    }
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
      application: toApplication(app, artifacts),
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

  r.get("/", auth, async (c) => {
    const rows = await db.select({ app: applications, job: jobs, companyName: companies.name, logoDomain: companyLogoDomain, resume: resumes }).from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(resumes, and(eq(resumes.id, applications.resumeId), eq(resumes.applicationId, applications.id)))
      .where(eq(applications.userId, c.get("user").id)).orderBy(desc(applications.createdAt)).limit(200);
    return c.json(rows.map((x) => ({
      application: toApplication(x.app, artifacts),
      job: toJob({ ...x.job, descriptionText: x.job.descriptionText.slice(0, LIST_DESCRIPTION_CHARS) }, { name: x.companyName, logoUrl: logo(x.logoDomain) }),
      resume: x.resume ? toResume(x.resume) : null,
    })));
  });

  r.post("/", auth, async (c) => {
    const { jobId } = await parseBody(c, Create);
    const res = await startApplication(ctx, c.get("user").id, jobId);
    return c.json(toApplication(res.application, artifacts), res.created ? 201 : 200);
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

  r.post("/:id/retry", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const res = await retryApplication(db, app.id);
    if (!res.ok) throw new HttpError(409, "Nothing to retry on this application", res.reason);
    if (!res.noop) await queueFor(res.application);
    return c.json({ ok: true, status: res.application.status });
  });

  return r;
}
