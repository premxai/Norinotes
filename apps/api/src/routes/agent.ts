import { Hono } from "hono";
import { and, applications, companies, desc, eq, gte, inArray, jobs, outcomes, profiles, runEvents, shortlist, sql } from "@norinote/db";
import { requireUser } from "../auth/session.js";
import { intParam } from "../http.js";
import type { AppEnv, Ctx } from "../types.js";

type Kind = "discovered" | "scored" | "queued" | "skipped" | "prepared" | "approved" | "submitted" | "needs_user" | "reply" | "interview";
type Activity = {
  id: string; ts: string; kind: Kind; applicationId: string | null; jobId: string | null; message: string;
  data?: { job?: { title: string; companyName: string }; reasons?: string[]; count?: number; dryRun?: boolean };
};

/** Run-log steps (packages/apply) that are worth a line in the activity feed. */
const STEP_KIND: Record<string, Kind> = {
  created: "queued", "status:prepared": "prepared", "status:applying": "approved", "status:submitted": "submitted", "status:needs_user": "needs_user",
};

export function agentRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/status", auth, async (c) => {
    const userId = c.get("user").id;
    const now = ctx.now();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [profile] = await db.select({ cap: profiles.dailyCap }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    // An application counts against today's cap from the moment it is approved (a click or autopilot).
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.userId, userId), gte(applications.approvedAt, dayStart)));
    return c.json({
      dailyCap: profile?.cap ?? 0,
      usedToday: used?.n ?? 0,
      liveSubmit: ctx.config.allowRealSubmit,
      lastTickAt: null,
      nextTickAt: null,
    });
  });

  /** What the agent did for this user, newest first: derived from the run log, the shortlist and the outcomes. */
  r.get("/activity", auth, async (c) => {
    const userId = c.get("user").id;
    const limit = intParam(c.req.query("limit"), 50, 1, 200);
    const out: Activity[] = [];

    const events = await db.select({
      id: runEvents.id, ts: runEvents.ts, step: runEvents.step, message: runEvents.message, data: runEvents.data,
      applicationId: applications.id, jobId: jobs.id, title: jobs.title, companyName: companies.name, receipt: applications.receipt,
    }).from(runEvents)
      .innerJoin(applications, eq(applications.id, runEvents.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(applications.userId, userId), inArray(runEvents.step, Object.keys(STEP_KIND))))
      .orderBy(desc(runEvents.ts)).limit(limit * 2);
    for (const e of events) {
      const kind = STEP_KIND[e.step];
      if (!kind) continue;
      // "status:applying" is "approved" only when someone approved it (the run log records who).
      if (kind === "approved" && !(e.data && typeof e.data.approvedBy === "string")) continue;
      const dryRun = kind === "submitted" && e.receipt?.dryRun === true;
      const label = `${e.title} at ${e.companyName}`;
      const message = kind === "queued" ? `Queued ${label}` : kind === "prepared" ? `Prepared the resume and answers for ${label}` : kind === "approved" ? `Approved ${label}` : kind === "submitted" ? `${dryRun ? "Filled the form for" : "Submitted"} ${label}${dryRun ? " (dry run, not sent)" : ""}` : e.message;
      out.push({ id: `run-${e.id}`, ts: e.ts.toISOString(), kind, applicationId: e.applicationId, jobId: e.jobId, message, data: { job: { title: e.title, companyName: e.companyName }, ...(dryRun ? { dryRun } : {}) } });
    }

    const scored = await db.select({
      id: shortlist.id, createdAt: shortlist.createdAt, fit: shortlist.fit, reasons: shortlist.reasons, status: shortlist.status,
      jobId: jobs.id, title: jobs.title, companyName: companies.name,
    }).from(shortlist).innerJoin(jobs, eq(jobs.id, shortlist.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(shortlist.userId, userId)).orderBy(desc(shortlist.createdAt)).limit(limit);
    for (const s of scored) {
      const job = { title: s.title, companyName: s.companyName };
      // The shortlist keeps no time for a dismissal, so a skip is dated by when the job was scored.
      if (s.status === "dismissed") out.push({ id: `skip-${s.id}`, ts: s.createdAt.toISOString(), kind: "skipped", applicationId: null, jobId: s.jobId, message: `You skipped ${s.title} at ${s.companyName}`, data: { job } });
      else out.push({ id: `fit-${s.id}`, ts: s.createdAt.toISOString(), kind: "scored", applicationId: null, jobId: s.jobId, message: `${s.title} at ${s.companyName} fits you ${Math.round(s.fit * 100)}%`, data: { job, reasons: s.reasons } });
    }

    const replies = await db.select({
      id: outcomes.id, at: outcomes.at, kind: outcomes.kind, applicationId: applications.id, jobId: jobs.id, title: jobs.title, companyName: companies.name,
    }).from(outcomes).innerJoin(applications, eq(applications.id, outcomes.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(applications.userId, userId)).orderBy(desc(outcomes.at)).limit(limit);
    for (const o of replies) {
      const label = `${o.title} at ${o.companyName}`;
      const message = o.kind === "interview" ? `Interview request from ${label}` : o.kind === "offer" ? `Offer from ${label}` : o.kind === "rejection" ? `${o.companyName} declined ${o.title}` : `${o.companyName} replied about ${o.title}`;
      out.push({ id: `out-${o.id}`, ts: o.at.toISOString(), kind: o.kind === "interview" ? "interview" : "reply", applicationId: o.applicationId, jobId: o.jobId, message, data: { job: { title: o.title, companyName: o.companyName } } });
    }

    out.sort((a, b) => b.ts.localeCompare(a.ts) || a.id.localeCompare(b.id));
    return c.json(out.slice(0, limit));
  });

  return r;
}
