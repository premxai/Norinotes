import { Hono } from "hono";
import { z } from "zod";
import { and, companies, desc, eq, jobBookmarks, jobSpecs, jobs, savedJobs, shortlist } from "@norinote/db";
import { BlockedSourceError, JobNotFoundError, UnsafeUrlError, UnsupportedJobUrlError, addJobByUrl } from "@norinote/ingest";
import { JOBS } from "@norinote/queue";
import { JobSpec } from "@norinote/shared";
import { requireUser } from "../auth/session.js";
import { HttpError, notFound, parseBody, parseWith, uuidParam } from "../http.js";
import { jobPreview } from "../job-preview.js";
import { jobLocations, jobsSummary, listJobs, type JobListParams } from "../jobs-query.js";
import { brandfetchLogo, companyLogoDomain, toJob, toMatch } from "../serialize.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const flag = (dflt: boolean) => z.enum(["true", "false", "1", "0"]).optional().transform((v) => (v === undefined ? dflt : v === "true" || v === "1"));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const Query = z.object({
  view: z.enum(["best", "new", "today", "saved", "applied"]).default("best"),
  sort: z.enum(["best", "new"]).optional(),
  lanes: z.enum(["true", "false", "1", "0"]).optional(),
  group: flag(true),
  /** Posted within this many hours: 1 to 72 (nothing older than 72 hours is ever listed). */
  maxAgeHours: int(1, 72).default(72),
  clearance: z.enum(["hide", "show"]).default("show"),
  limit: int(1, 200).default(50),
  q: z.string().trim().max(100).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  status: z.enum(["open", "all"]).default("open"),
  location: z.string().trim().max(100).optional(),
  remote: flag(false),
});

const SUMMARY_TTL_MS = 5 * 60_000;

const AddUrl = z.object({ url: z.string().trim().min(4, "Paste the link of a job posting").max(2000) });

export function jobRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;
  const logo = brandfetchLogo(ctx.config.brandfetchClientId);
  const addJob = ctx.addJob ?? addJobByUrl;

  r.get("/", auth, async (c) => {
    const q = parseWith(Query, c.req.query());
    const params: JobListParams = {
      view: q.view,
      sort: q.sort ?? (q.view === "best" ? "best" : "new"),
      lanes: q.lanes === undefined ? q.view === "best" : q.lanes === "true" || q.lanes === "1",
      maxAgeHours: q.maxAgeHours, clearance: q.clearance, limit: q.limit, q: q.q || undefined, minScore: q.minScore, status: q.status,
      group: q.view === "saved" || q.view === "applied" ? false : q.group, location: q.location || undefined, remote: q.remote,
    };
    return c.json(await listJobs(db, c.get("user").id, params, ctx.now(), logo));
  });

  // The counts read ~100k rows; they change slowly, so each person's are kept for a few minutes.
  const summaries = new Map<string, { at: number; value: Awaited<ReturnType<typeof jobsSummary>> }>();
  r.get("/summary", auth, async (c) => {
    const userId = c.get("user").id;
    const at = ctx.now().getTime();
    const hit = summaries.get(userId);
    if (hit && at - hit.at < SUMMARY_TTL_MS) return c.json(hit.value);
    const value = await jobsSummary(db, userId, ctx.now());
    if (summaries.size > 5000) summaries.clear();
    summaries.set(userId, { at, value });
    return c.json(value);
  });

  r.get("/locations", auth, async (c) => c.json({ locations: await jobLocations(db, ctx.now()) }));

  /** The Review tab: the form's questions, which Nori can answer and which it would ask. Read only, no AI. */
  r.get("/:id/preview", auth, async (c) => {
    const userId = c.get("user").id;
    limitUser(ctx, "job-preview", userId, 120, 3_600_000, "Too many previews. Try again in a few minutes.");
    const preview = await jobPreview(db, userId, uuidParam(c), { fetch: ctx.previewFetch });
    if (!preview) throw notFound("Job not found");
    return c.json(preview);
  });

  /** The Save button: bookmarks a job for the Saved tab (it does not add it to the other lists). */
  r.post("/:id/save", auth, async (c) => {
    const id = uuidParam(c);
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!job) throw notFound("Job not found");
    await db.insert(jobBookmarks).values({ userId: c.get("user").id, jobId: id, createdAt: ctx.now() }).onConflictDoNothing();
    return c.json({ saved: true });
  });

  r.delete("/:id/save", auth, async (c) => {
    await db.delete(jobBookmarks).where(and(eq(jobBookmarks.userId, c.get("user").id), eq(jobBookmarks.jobId, uuidParam(c))));
    return c.json({ saved: false });
  });

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
    // The user picked this job: it shows for them whatever its age (see savedJobs).
    await db.insert(savedJobs).values({ userId: user.id, jobId: added.job.id }).onConflictDoNothing();
    if (added.created) await enqueueSoft(ctx, JOBS.understandJob, { jobId: added.job.id }, { dedupeKey: added.job.id, dedupeSeconds: 3600 });
    const [company] = await db.select({ name: companies.name, logoDomain: companyLogoDomain }).from(companies).where(eq(companies.id, added.job.companyId)).limit(1);
    return c.json({ job: toJob(added.job, { name: company?.name ?? null, logoUrl: logo(company?.logoDomain) }) }, added.created ? 201 : 200);
  });

  r.get("/:id", auth, async (c) => {
    const id = uuidParam(c);
    const userId = c.get("user").id;
    const [row] = await db.select({ job: jobs, companyName: companies.name, logoDomain: companyLogoDomain }).from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, id)).limit(1);
    if (!row) throw notFound("Job not found");
    const [spec] = await db.select({ spec: jobSpecs.spec }).from(jobSpecs).where(eq(jobSpecs.jobId, id)).orderBy(desc(jobSpecs.version)).limit(1);
    const [fit] = await db.select().from(shortlist).where(and(eq(shortlist.jobId, id), eq(shortlist.userId, userId))).limit(1);
    const parsedSpec = spec ? JobSpec.safeParse(spec.spec) : null;
    const [bookmark] = await db.select({ at: jobBookmarks.createdAt }).from(jobBookmarks).where(and(eq(jobBookmarks.userId, userId), eq(jobBookmarks.jobId, id))).limit(1);
    return c.json({
      job: {
        ...toJob(row.job, { name: row.companyName, logoUrl: logo(row.logoDomain) }, parsedSpec?.success ? parsedSpec.data : null), saved: !!bookmark,
        // What is known of the employer. Size and about are not collected yet: they stay null.
        company: { name: row.companyName, website: row.logoDomain ? `https://${row.logoDomain}` : null, logoUrl: logo(row.logoDomain), size: null, about: null },
      },
      match: fit ? toMatch(id, { fit: fit.fit, fitMap: fit.fitMap, reasons: fit.reasons, createdAt: fit.createdAt }) : null,
    });
  });

  return r;
}
