/**
 * The Nori page (docs/api-contract.md, "Nori"): "Apply for me" batches, what needs the person, and how Nori works for
 * them. The worker sends a batch's applications one at a time (drainBatches); this API starts, shows and stops them.
 */
import { Hono } from "hono";
import { z } from "zod";
import { and, applications, applyBatches, companies, desc, eq, jobs } from "@norinote/db";
import { MAX_BATCH, batchView, getNoriSettings, recentBatches, saveNoriSettings, startBatch, stopBatch } from "@norinote/apply";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { enqueueSoft, type AppEnv, type Ctx } from "../types.js";

const UUID = z.string().uuid();
const Start = z.object({ jobIds: z.array(UUID).min(1).max(MAX_BATCH) });
const Settings = z.object({
  spacingMinutes: z.number().int().min(1).max(60).optional(),
  minFit: z.number().min(0).max(1).optional(),
  skipCompanies: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  dailyLimit: z.number().int().min(1).max(100).optional(),
}).strict();

/** What a parked application needs from the person, for the "Needs you" list. */
function needOf(a: { pendingQuestions: unknown[]; receipt: Record<string, unknown> | null; error: string | null }): "questions" | "code" | "captcha" | "account" | "other" {
  if (a.pendingQuestions.length > 0) return "questions";
  if (a.receipt?.codeMissing === true || /verification code/i.test(a.error ?? "")) return "code";
  if (/captcha/i.test(a.error ?? "")) return "captcha";
  if (/account|sign in|log in|password/i.test(a.error ?? "")) return "account";
  return "other";
}

export function noriRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/settings", auth, async (c) => c.json({ settings: await getNoriSettings(db, c.get("user").id) }));

  r.put("/settings", auth, async (c) => {
    const patch = await parseBody(c, Settings);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return c.json({ settings: await saveNoriSettings(db, c.get("user").id, clean) });
  });

  /** "Apply for me": the jobs the person picked, approved at once. Applications are prepared now and sent by the worker. */
  r.post("/batches", auth, async (c) => {
    const user = c.get("user");
    const { jobIds } = await parseBody(c, Start);
    const res = await startBatch(db, user.id, jobIds, { now: ctx.now(), atsTypes: ctx.config.batchAts });
    for (const a of res.added) if (a.created) await enqueueSoft(ctx, JOBS.prepareApplication, { applicationId: a.applicationId });
    if (!res.batchId) throw new HttpError(409, "None of these jobs can be added to a batch", JSON.stringify(res.skipped.map((s) => s.reason)));
    const [batch] = await db.select().from(applyBatches).where(eq(applyBatches.id, res.batchId)).limit(1);
    return c.json({ batch: await batchView(db, batch!, ctx.now()), added: res.added.length, skipped: res.skipped }, 201);
  });

  r.get("/batches", auth, async (c) => c.json({ batches: await recentBatches(db, c.get("user").id, ctx.now()) }));

  r.get("/batches/:id", auth, async (c) => {
    const user = c.get("user");
    const [batch] = await db.select().from(applyBatches).where(and(eq(applyBatches.id, uuidParam(c)), eq(applyBatches.userId, user.id))).limit(1);
    if (!batch) throw notFound("Batch not found");
    const rows = await db.select({ app: applications, title: jobs.title, company: companies.name })
      .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(applications.batchId, batch.id)).orderBy(applications.createdAt);
    return c.json({
      batch: await batchView(db, batch, ctx.now()),
      applications: rows.map(({ app, title, company }) => ({
        id: app.id, jobId: app.jobId, title, company, status: app.status, error: app.error, updatedAt: app.updatedAt, submittedAt: app.submittedAt,
        ...(app.status === "needs_user" ? { needs: needOf(app) } : {}),
      })),
    });
  });

  r.post("/batches/:id/stop", auth, async (c) => {
    const res = await stopBatch(db, c.get("user").id, uuidParam(c), { now: ctx.now() });
    if (!res.ok) throw notFound("Batch not found");
    return c.json(res);
  });

  /** Everything parked for the person, newest first, with what it needs. */
  r.get("/needs-you", auth, async (c) => {
    const rows = await db.select({ app: applications, title: jobs.title, company: companies.name, applyUrl: jobs.applyUrl })
      .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(applications.userId, c.get("user").id), eq(applications.status, "needs_user")))
      .orderBy(desc(applications.updatedAt)).limit(100);
    return c.json({
      items: rows.map(({ app, title, company, applyUrl }) => ({
        applicationId: app.id, jobId: app.jobId, title, company, applyUrl, needs: needOf(app), reason: app.error,
        questions: app.pendingQuestions.length, batchId: app.batchId, updatedAt: app.updatedAt,
      })),
    });
  });

  return r;
}
