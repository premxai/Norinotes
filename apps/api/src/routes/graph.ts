import { Hono } from "hono";
import { z } from "zod";
import { and, asc, careerPoints, eq, graphSources, sql } from "@norinote/db";
import { isPrivateAddress } from "@norinote/ingest";
import { addFact, CareerPointPatchError, deleteCareerPoint, getGraph, summarizeSkills, updateCareerPoint } from "@norinote/graph";
import { BudgetExceededError } from "@norinote/ai";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { buildGraphView, skillFromNodeId } from "../graph-view.js";
import { HttpError, notFound, parseBody, uuidParam } from "../http.js";
import { AI_NOTES } from "../resume-ingest.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const Fact = z.object({ text: z.string().trim().min(3, "Tell us a bit more").max(2000) });

const Month = z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Use a year, or a year and month like 2024-05");
/** An edit to one card: only the fields sent change. `statement` is the card's text. */
const NodePatch = z.object({
  title: z.string().trim().min(1, "A card needs a title").max(200).optional(),
  org: z.string().trim().max(200).nullable().optional(),
  statement: z.string().trim().max(2000).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  startDate: Month.nullable().optional(),
  endDate: Month.nullable().optional(),
}).strict().refine((p) => Object.keys(p).length > 0, "Nothing to change");

/** At most this many sources per person. */
export const MAX_GRAPH_SOURCES = 10;

const Source = z.object({
  kind: z.enum(["github", "site", "linkedin"]),
  value: z.string().trim().min(1, "Add a username or a link").max(500),
});

/**
 * A source as stored: a GitHub username (a profile link is accepted and reduced to the name), a public http(s) page, or a
 * linkedin.com/in/ link (kept only: LinkedIn is never fetched). Throws HttpError 400/422 with what to fix.
 */
export function normalizeSource(kind: "github" | "site" | "linkedin", raw: string): string {
  const value = raw.trim();
  if (kind === "github") {
    const name = value.replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(name)) throw new HttpError(400, "That is not a GitHub username");
    return name;
  }
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new HttpError(400, "That is not a valid link"); }
  if (kind === "linkedin") {
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname) || !/^\/in\/[^/]+/i.test(u.pathname)) throw new HttpError(400, "Paste your LinkedIn profile link (linkedin.com/in/...)");
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  }
  if (/(^|\.)(linkedin\.com|github\.com)$/i.test(u.hostname)) throw new HttpError(400, "Add that as a LinkedIn or GitHub source instead");
  // The link's shape only; every address is checked again when the page is read (safeFetch in the worker).
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!/^https?:$/.test(u.protocol) || !host.includes(".") || /(^localhost$|\.(localhost|local|internal|lan|home|corp)$)/.test(host) || isPrivateAddress(host)) {
    throw new HttpError(422, "That address is not a public website");
  }
  u.hash = "";
  return u.toString();
}

const sourceView = (s: typeof graphSources.$inferSelect) => ({
  id: s.id, kind: s.kind, value: s.value, status: s.status, error: s.error, factsAdded: s.factsAdded,
  lastReadAt: s.lastReadAt ? s.lastReadAt.toISOString() : null, createdAt: s.createdAt.toISOString(),
});

export function graphRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/", auth, async (c) => {
    const g = await getGraph(db, c.get("user").id, ctx.now());
    return c.json(buildGraphView(g.points, g.skills));
  });

  r.post("/facts", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "fact", user.id, 60, 3_600_000, "Too many facts added. Try again later.");
    const body = await parseBody(c, Fact);
    let added;
    try {
      added = await addFact(db, user.id, body.text);
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new HttpError(429, "Today's AI allowance is used up. Try again tomorrow.");
      throw err;
    }
    await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "graph" });
    const { points } = added;
    const skills = new Set(points.flatMap((p) => p.skills.map((s) => s.toLowerCase())));
    return c.json({
      nodesCreated: points.filter((p) => p.kind !== "skill").length + skills.size,
      note: added.aiUnavailable ? AI_NOTES.fact : null,
    });
  });

  /** Edit a card in place (not a skill: skills change through the cards that name them). Re-runs matching. */
  r.patch("/nodes/:id", auth, async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (skillFromNodeId(id)) throw new HttpError(422, "A skill changes through the cards that name it");
    limitUser(ctx, "graph-edit", user.id, 120, 3_600_000, "Too many edits. Try again later.");
    const { statement, ...rest } = await parseBody(c, NodePatch);
    let point;
    try {
      point = await updateCareerPoint(db, user.id, id, { ...rest, ...(statement !== undefined ? { text: statement } : {}) });
    } catch (err) {
      if (err instanceof CareerPointPatchError) throw new HttpError(400, err.message);
      throw err;
    }
    if (!point) throw notFound("That fact was not found");
    await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "graph" });
    const node = buildGraphView([point], summarizeSkills([point], ctx.now())).nodes.find((n) => n.id === point.id) ?? null;
    return c.json({ node });
  });

  r.delete("/nodes/:id", auth, async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const skill = skillFromNodeId(id);
    let removed: boolean;
    if (skill) {
      // A skill node is not stored on its own: retracting it takes the skill off every point that names it.
      const touched = await db.update(careerPoints)
        .set({ skills: sql`array(select s from unnest(${careerPoints.skills}) as s where lower(s) <> ${skill})` })
        .where(and(eq(careerPoints.userId, user.id), sql`exists (select 1 from unnest(${careerPoints.skills}) as s where lower(s) = ${skill})`))
        .returning({ id: careerPoints.id });
      removed = touched.length > 0;
    } else removed = await deleteCareerPoint(db, user.id, id);
    if (!removed) throw notFound("That fact was not found");
    await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "graph" });
    return c.json({ ok: true });
  });

  // ---- sources the person names: their GitHub, their own site, their LinkedIn link (kept, never read) ----------------

  const listSources = (userId: string) => db.select().from(graphSources).where(eq(graphSources.userId, userId)).orderBy(asc(graphSources.createdAt));

  r.get("/sources", auth, async (c) => c.json({ sources: (await listSources(c.get("user").id)).map(sourceView) }));

  r.post("/sources", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "graph-source", user.id, 30, 3_600_000, "Too many sources added. Try again later.");
    const body = await parseBody(c, Source);
    const value = normalizeSource(body.kind, body.value);
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(graphSources).where(eq(graphSources.userId, user.id));
    const [existing] = await db.select().from(graphSources).where(and(eq(graphSources.userId, user.id), eq(graphSources.kind, body.kind), eq(graphSources.value, value))).limit(1);
    if (existing) return c.json({ source: sourceView(existing) });
    if ((n?.n ?? 0) >= MAX_GRAPH_SOURCES) throw new HttpError(409, `Up to ${MAX_GRAPH_SOURCES} sources`, "Remove one to add another.");
    const [row] = await db.insert(graphSources).values({ userId: user.id, kind: body.kind, value, status: body.kind === "linkedin" ? "done" : "pending", createdAt: ctx.now() }).returning();
    if (body.kind !== "linkedin") await enqueueSoft(ctx, JOBS.graphReadSource, { sourceId: row!.id });
    return c.json({ source: sourceView(row!) }, 201);
  });

  r.post("/sources/:id/refresh", auth, async (c) => {
    const user = c.get("user");
    limitUser(ctx, "graph-source-refresh", user.id, 20, 3_600_000, "Too many refreshes. Try again later.");
    const [row] = await db.select().from(graphSources).where(and(eq(graphSources.id, uuidParam(c)), eq(graphSources.userId, user.id))).limit(1);
    if (!row) throw notFound("Source not found");
    if (row.kind === "linkedin") return c.json({ source: sourceView(row) });
    const [updated] = await db.update(graphSources).set({ status: "pending", error: null }).where(eq(graphSources.id, row.id)).returning();
    await enqueueSoft(ctx, JOBS.graphReadSource, { sourceId: row.id }, { dedupeKey: `graph-source:${row.id}`, dedupeSeconds: 30 });
    return c.json({ source: sourceView(updated!) });
  });

  /** Removes the source and every fact read from it; matching runs again without them. */
  r.delete("/sources/:id", auth, async (c) => {
    const user = c.get("user");
    const id = uuidParam(c);
    const removed = await db.transaction(async (tx) => {
      const facts = await tx.delete(careerPoints).where(and(eq(careerPoints.userId, user.id), eq(careerPoints.graphSourceId, id))).returning({ id: careerPoints.id });
      const gone = await tx.delete(graphSources).where(and(eq(graphSources.id, id), eq(graphSources.userId, user.id))).returning({ id: graphSources.id });
      return gone.length ? facts.length : null;
    });
    if (removed === null) throw notFound("Source not found");
    if (removed > 0) await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "graph" });
    return c.json({ ok: true, factsRemoved: removed });
  });

  return r;
}
