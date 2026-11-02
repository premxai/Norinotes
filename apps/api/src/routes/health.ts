import { Hono } from "hono";
import { sql } from "@norinote/db";
import type { AppEnv, Ctx } from "../types.js";

export function healthRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return c.json({ ok: true, time: ctx.now().toISOString() });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  return r;
}
