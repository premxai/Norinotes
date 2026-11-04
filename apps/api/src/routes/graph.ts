import { Hono } from "hono";
import { z } from "zod";
import { and, careerPoints, eq, sql } from "@norinote/db";
import { addFact, CareerPointPatchError, deleteCareerPoint, getGraph, summarizeSkills, updateCareerPoint } from "@norinote/graph";
import { BudgetExceededError } from "@norinote/ai";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { buildGraphView, skillFromNodeId } from "../graph-view.js";
import { HttpError, notFound, parseBody } from "../http.js";
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

  return r;
}
