import { Hono } from "hono";
import { sql } from "@norinote/db";
import type { AppEnv, Ctx } from "../types.js";

/** Jobs read in the last hour; when at least this many and nearly all came from the rule-based fallback, the AI is down. */
const MIN_RECENT_SPECS = 5;
const RULE_BASED_SHARE_DOWN = 0.8;

export function healthRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  // The platform's check (it restarts machines that fail it): the database only.
  r.get("/", async (c) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return c.json({ ok: true, time: ctx.now().toISOString() });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  // For an uptime monitor: is the worker reading jobs with the AI, or only with the rule-based fallback (an expired key,
  // no credit)? Read from what the worker wrote in the last hour, so it is true across processes. 503 when down.
  r.get("/ai", async (c) => {
    const since = new Date(ctx.now().getTime() - 3_600_000).toISOString();
    const res = (await ctx.db.execute(sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE version = 0)::int AS rule_based
      FROM job_specs WHERE created_at >= ${since}::timestamptz`)) as unknown as { rows?: Array<{ total: number; rule_based: number }> } & Array<{ total: number; rule_based: number }>;
    const row = (res.rows ?? res)[0] ?? { total: 0, rule_based: 0 };
    const down = row.total >= MIN_RECENT_SPECS && row.rule_based / row.total >= RULE_BASED_SHARE_DOWN;
    return c.json({ ok: !down, recentSpecs: row.total, ruleBased: row.rule_based, time: ctx.now().toISOString() }, down ? 503 : 200);
  });
  return r;
}
