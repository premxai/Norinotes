import { Hono } from "hono";
import { z } from "zod";
import { and, companies, desc, eq, jobSpecs, jobs, shortlist } from "@norinote/db";
import { BlockedSourceError, JobNotFoundError, UnsafeUrlError, UnsupportedJobUrlError, addJobByUrl } from "@norinote/ingest";
import { JOBS } from "@norinote/queue";
import { JobSpec } from "@norinote/shared";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, parseWith, uuidParam } from "../http.js";
import { jobsSummary, listJobs, type JobListParams } from "../jobs-query.js";
import { toJob, toMatch } from "../serialize.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const flag = (dflt: boolean) => z.enum(["true", "false", "1", "0"]).optional().transform((v) => (v === undefined ? dflt : v === "true" || v === "1"));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const Query = z.object({
  view: z.enum(["best", "new", "today"]).default("best"),
  sort: z.enum(["best", "new"]).optional(),
  lanes: z.enum(["true", "false", "1", "0"]).optional(),
  group: flag(true),
  maxAgeDays: int(0, 365).default(60),
  clearance: z.enum(["hide", "show"]).default("show"),
  limit: int(1, 200).default(50),
  q: z.string().trim().max(100).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  status: z.enum(["open", "all"]).default("open"),
});

const AddUrl = z.object({ url: z.string().trim().min(4, "Paste the link of a job posting").max(2000) });

export function jobRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const addJob = ctx.addJob ?? addJobByUrl;

  r.get("/", auth, async (c) => {
    const q = parseWith(Query, c.req.query());
    const params: JobListParams = {
      view: q.view,
      sort: q.sort ?? (q.view === "best" ? "best" : "new"),
      lanes: q.lanes === undefined ? q.view === "best" : q.lanes === "true" || q.lanes === "1",
      maxAgeDays: q.maxAgeDays, clearance: q.clearance, limit: q.limit, q: q.q || undefined, minScore: q.minScore, status: q.status, group: q.group,
    };
    return c.json(await listJobs(db, c.get("user").id, params, ctx.now()));
  });

  r.get("/summary", auth, async (c) => c.json(await jobsSummary(db, c.get("user").id, ctx.now())));

  r.post("/url", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "job-url", user.id, 30, 3_600_000, "Too many links added. Try again in an hour.");
    const { url } = await parseBody(c, AddUrl);
    let added;
    try {
      added = await addJob(db, url, { now: ctx.now() });
    } catch (err) {
      if (err instanceof JobNotFoundError) throw new HttpError(404, err.message);
      if (err instanceof UnsupportedJobUrlError || err instanceof BlockedSourceError) throw new HttpError(422, err.message);
      if (err instanceof UnsafeUrlError) throw new HttpError(422, "That link cannot be used. Paste the public link of a job posting.");
      ctx.log(`[api] adding a job by url failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new HttpError(503, "We could not read that posting right now. Try again in a moment.");
    }
    if (added.created) await enqueueSoft(ctx, JOBS.understandJob, { jobId: added.job.id }, { dedupeKey: added.job.id, dedupeSeconds: 3600 });
    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, added.job.companyId)).limit(1);
    return c.json({ job: toJob(added.job, company?.name ?? null) }, added.created ? 201 : 200);
  });

  r.get("/:id", auth, async (c) => {
    const id = uuidParam(c);
    const userId = c.get("user").id;
    const [row] = await db.select({ job: jobs, companyName: companies.name }).from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, id)).limit(1);
    if (!row) throw notFound("Job not found");
    const [spec] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs).where(eq(jobSpecs.jobId, id)).orderBy(desc(jobSpecs.version)).limit(1);
    const [fit] = await db.select().from(shortlist).where(and(eq(shortlist.jobId, id), eq(shortlist.userId, userId))).limit(1);
    const parsedSpec = spec ? JobSpec.safeParse(spec.spec) : null;
    return c.json({
      job: toJob(row.job, row.companyName, parsedSpec?.success ? parsedSpec.data : null),
      match: fit ? toMatch(id, { fit: fit.fit, fitMap: fit.fitMap, reasons: fit.reasons, createdAt: fit.createdAt }) : null,
    });
  });

  return r;
}
