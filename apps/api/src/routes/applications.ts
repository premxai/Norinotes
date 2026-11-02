import { Hono } from "hono";
import { z } from "zod";
import { and, applications, asc, companies, desc, eq, jobs, resumes, runEvents, shortlist, type Db } from "@norinote/db";
import { approveAndSubmit, createApplication, retryApplication, saveAnswers, type ApplicationRow } from "@norinote/apply";
import { saveAnswer } from "@norinote/answers";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { toApplication, toJob, toResume, toRunEvent } from "../serialize.js";
import { enqueueRequired, enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const Create = z.object({ jobId: z.uuid() });
const answerMap = z.record(z.string().min(1).max(300), z.string().max(5000)).refine((o) => Object.keys(o).length <= 100, "Too many answers");
const Approve = z.object({ answers: answerMap.optional() });
const Answer = z.object({ answers: answerMap });

const LIST_DESCRIPTION_CHARS = 1200;

/** The user's own application, or 404 (never reveal that someone else's exists). */
export async function ownedApplication(db: Db, userId: string, id: string): Promise<ApplicationRow> {
  const [row] = await db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, userId))).limit(1);
  if (!row) throw notFound("Application not found");
  return row;
}

export function applicationRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const artifacts = ctx.config.artifactsDir;

  async function detail(app: ApplicationRow) {
    const [row] = await db.select({ job: jobs, companyName: companies.name }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, app.jobId)).limit(1);
    if (!row) throw notFound("Job not found");
    const [resume] = app.resumeId ? await db.select().from(resumes).where(and(eq(resumes.id, app.resumeId), eq(resumes.applicationId, app.id))).limit(1) : [];
    const events = await db.select().from(runEvents).where(eq(runEvents.applicationId, app.id)).orderBy(asc(runEvents.ts), asc(runEvents.id)).limit(500);
    return {
      application: toApplication(app, artifacts),
      job: toJob(row.job, row.companyName),
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
    const rows = await db.select({ app: applications, job: jobs, companyName: companies.name, resume: resumes }).from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(resumes, and(eq(resumes.id, applications.resumeId), eq(resumes.applicationId, applications.id)))
      .where(eq(applications.userId, c.get("user").id)).orderBy(desc(applications.createdAt)).limit(200);
    return c.json(rows.map((x) => ({
      application: toApplication(x.app, artifacts),
      job: toJob({ ...x.job, descriptionText: x.job.descriptionText.slice(0, LIST_DESCRIPTION_CHARS) }, x.companyName),
      resume: x.resume ? toResume(x.resume) : null,
    })));
  });

  r.post("/", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "apply", user.id, 100, 3_600_000, "You are creating applications very quickly. Try again in a few minutes.");
    const { jobId } = await parseBody(c, Create);
    const res = await createApplication(db, user.id, jobId, { now: ctx.now() });
    if (res.created) {
      await db.update(shortlist).set({ status: "applied" }).where(and(eq(shortlist.userId, user.id), eq(shortlist.jobId, jobId), eq(shortlist.status, "new")));
      await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: res.application.id });
      return c.json(toApplication(res.application, artifacts), 201);
    }
    if (res.reason === "job_not_found") throw notFound("Job not found");
    if (res.reason === "duplicate_recent") {
      throw new HttpError(409, "You already have an application for this role", "Another posting of the same job at this company was queued in the last 30 days.");
    }
    // Already exists: asking again is how a stuck one is nudged (the queue drops the repeat within a minute).
    if (res.application.status === "queued") await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: res.application.id }, { dedupeKey: `prepare:${res.application.id}`, dedupeSeconds: 60 });
    return c.json(toApplication(res.application, artifacts));
  });

  r.get("/:id", auth, async (c) => c.json(await detail(await ownedApplication(db, c.get("user").id, uuidParam(c)))));

  r.post("/:id/approve", auth, async (c) => {
    const app = await ownedApplication(db, c.get("user").id, uuidParam(c));
    const body = await parseBody(c, Approve);
    if (body.answers && Object.keys(body.answers).length > 0) await saveAnswers(db, app.id, body.answers);
    const res = await approveAndSubmit(db, app.id, { now: ctx.now() });
    if (!res.ok) throw new HttpError(409, "This application is not ready to submit", res.reason);
    if (res.started) await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" });
    return c.json({ ok: true, status: res.status, started: res.started });
  });

  r.post("/:id/answer", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const { answers } = await parseBody(c, Answer);
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
        await saveAnswer(db, user.id, question.text, value.trim(), "user");
      } catch (err) {
        ctx.log(`[api] could not remember an answer: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // A parked application carries on once every required question has an answer.
    let resumed = false;
    let status = app.status;
    if (app.status === "needs_user") {
      const res = await approveAndSubmit(db, app.id, { now: ctx.now() });
      if (res.ok) {
        status = res.status;
        if (res.started) { await enqueueRequired(ctx, JOBS.applyRun, { applicationId: app.id, trigger: "click" }); resumed = true; }
      }
    }
    return c.json({ ok: true, status, resumed });
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
