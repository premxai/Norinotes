import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, lanes, notInArray } from "@norinote/db";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { isUuid, parseBody } from "../http.js";
import { enqueueSoft, type AppEnv, type Ctx } from "../types.js";

const words = z.array(z.string().trim().min(1).max(120)).max(20);
/** The shared `Lane`, except that a new lane has no (or a temporary) id. */
const LaneInput = z.object({
  id: z.string().nullish(),
  name: z.string().trim().min(1, "Name the lane").max(100),
  titles: words,
  locations: words,
  remote: z.boolean(),
  minFit: z.number().min(0).max(1),
  enabled: z.boolean(),
});
const Body = z.array(LaneInput).max(20, "Up to 20 lanes");

type LaneRow = typeof lanes.$inferSelect;
const view = (l: LaneRow) => ({ id: l.id, name: l.name, titles: l.titles, locations: l.locations, remote: l.remote, minFit: l.minFit, enabled: l.enabled });

export function laneRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  const list = (userId: string) => db.select().from(lanes).where(eq(lanes.userId, userId)).orderBy(asc(lanes.createdAt), asc(lanes.id));

  r.get("/", auth, async (c) => c.json((await list(c.get("user").id)).map(view)));

  r.put("/", auth, async (c) => {
    const userId = c.get("user").id;
    const input = await parseBody(c, Body);
    const base = ctx.now().getTime();
    await db.transaction(async (tx) => {
      const owned = new Set((await tx.select({ id: lanes.id }).from(lanes).where(eq(lanes.userId, userId))).map((l) => l.id));
      const keep: string[] = [];
      for (const [i, l] of input.entries()) {
        const values = { name: l.name, titles: l.titles, locations: l.locations, remote: l.remote, minFit: l.minFit, enabled: l.enabled };
        // An id that is not one of this user's lanes (temporary "new-..." ids, someone else's) is a new lane.
        if (l.id && isUuid(l.id) && owned.has(l.id)) {
          await tx.update(lanes).set(values).where(and(eq(lanes.id, l.id), eq(lanes.userId, userId)));
          keep.push(l.id);
        } else {
          // Spaced createdAt keeps the order of the array.
          const [row] = await tx.insert(lanes).values({ ...values, userId, createdAt: new Date(base + i) }).returning({ id: lanes.id });
          if (row) keep.push(row.id);
        }
      }
      await tx.delete(lanes).where(keep.length ? and(eq(lanes.userId, userId), notInArray(lanes.id, keep)) : eq(lanes.userId, userId));
    });
    await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "lanes" });
    return c.json((await list(userId)).map(view));
  });

  return r;
}
