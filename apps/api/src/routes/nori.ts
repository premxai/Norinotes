/**
 * The Nori page (docs/api-contract.md, "Nori"): "Apply for me" batches, what needs the person, and how Nori works for
 * them. The worker sends a batch's applications one at a time (drainBatches); this API starts, shows and stops them.
 */
import { Hono } from "hono";
import { z } from "zod";
import { and, applications, applyBatches, companies, desc, eq, jobs } from "@norinote/db";
import { MAX_BATCH, WEEKDAYS, batchView, getNoriSettings, getSchedule, nextRunOn, recentBatches, recommendedJobIds, saveNoriSettings, saveSchedule, startBatch, stopBatch, type NoriSchedule } from "@norinote/apply";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { chatHistory, chatTurn, undoChatAction } from "../nori-chat.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const UUID = z.string().uuid();
/** Either the jobs the person picked, or `recommended: true` (the server picks Recommended jobs, up to `limit`). */
const Start = z.union([
  z.object({ jobIds: z.array(UUID).min(1).max(MAX_BATCH) }).strict(),
  z.object({ recommended: z.literal(true), limit: z.number().int().min(1).max(MAX_BATCH).optional() }).strict(),
]);
const Settings = z.object({
  spacingMinutes: z.number().int().min(1).max(60).optional(),
  minFit: z.number().min(0).max(1).optional(),
  skipCompanies: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
  dailyLimit: z.number().int().min(1).max(100).optional(),
}).strict();

/** What a parked application needs from the person, for the "Needs you" list. */
function needOf(a: { pendingQuestions: unknown[]; receipt: Record<string, unknown> | null; error: string | null }): "questions" | "code" | "captcha" | "account" | "offsite" | "other" {
  if (a.pendingQuestions.length > 0) return "questions";
  if (/own careers site/i.test(a.error ?? "")) return "offsite";
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
    const userId = c.get("user").id;
    const settings = await saveNoriSettings(db, userId, clean);
    // The threshold is every role's minFit, and skipped companies leave the shortlist: both change the matches.
    if (patch.minFit !== undefined || patch.skipCompanies !== undefined) await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "profile" });
    return c.json({ settings });
  });

  /** "Apply for me": the jobs the person picked, approved at once. Applications are prepared now and sent by the worker. */
  r.post("/batches", auth, async (c) => {
    const user = c.get("user");
    const body = await parseBody(c, Start);
    const jobIds = "jobIds" in body ? body.jobIds : await recommendedJobIds(db, user.id, { now: ctx.now(), limit: body.limit ?? 10, atsTypes: ctx.config.batchAts });
    if (jobIds.length === 0) throw new HttpError(409, "No Recommended jobs to send right now", "Nori sends new matches at or above your threshold that you haven't applied to.");
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

  // ---- the schedule (autopilot) ----
  const Schedule = z.object({
    enabled: z.boolean().optional(),
    days: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day").max(7).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour").optional(),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone").optional(),
    paused: z.boolean().optional(),
  }).strict();
  const scheduleView = (s: NoriSchedule) => ({ ...s, days: [...new Set(s.days)], nextRunOn: nextRunOn(s, ctx.now()) });

  r.get("/schedule", auth, async (c) => c.json({ schedule: scheduleView(await getSchedule(db, c.get("user").id)) }));

  r.put("/schedule", auth, async (c) => {
    const patch = await parseBody(c, Schedule);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return c.json({ schedule: scheduleView(await saveSchedule(db, c.get("user").id, clean)) });
  });

  // ---- the chat ----
  const Chat = z.object({ message: z.string().trim().min(1, "Say something to Nori").max(2000) }).strict();
  const chatDeps = (userId: string) => ({
    now: ctx.now(), atsTypes: ctx.config.batchAts,
    enqueuePrepare: (applicationId: string) => enqueueSoft(ctx, JOBS.prepareApplication, { applicationId }),
    enqueueMatch: () => enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "profile" }),
  });

  r.get("/chat", auth, async (c) => {
    const raw = c.req.query("before");
    const before = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : undefined;
    return c.json({ messages: await chatHistory(db, c.get("user").id, { before, limit: 50 }) });
  });

  r.post("/chat", auth, async (c) => {
    const userId = c.get("user").id;
    limitUser(ctx, "nori-chat", userId, 60, 3_600_000, "You're talking to Nori very fast. Try again in a few minutes.");
    const { message } = await parseBody(c, Chat);
    return c.json(await chatTurn(db, userId, message, chatDeps(userId)));
  });

  r.post("/chat/undo/:undoId", auth, async (c) => {
    const userId = c.get("user").id;
    const res = await undoChatAction(db, userId, uuidParam(c, "undoId"), chatDeps(userId));
    if (!res.ok && res.summary === "Nothing to undo") throw notFound("Nothing to undo");
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
