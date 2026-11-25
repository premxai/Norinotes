import { Hono } from "hono";
import { z } from "zod";
import { BlockedSourceError, CompanyInputError, systemName, UnsafeUrlError, type DiscoveredCompany } from "@norinote/ingest";
import { requireUser } from "../auth/session.js";
import { HttpError, parseBody } from "../http.js";
import { limitUser, type AppEnv, type Ctx } from "../types.js";

const AddCompany = z.object({ query: z.string().trim().min(2, "Type a company name or paste its careers page").max(2000) });

/** Companies people ask for: Nori finds the company's public job board and adds it to the shared registry. */
export function companyRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);

  /** True when the worker reads boards of this system now (ENGINE_ATS empty or naming it). */
  const reading = (c: DiscoveredCompany) => ctx.config.engineAts.length === 0 || ctx.config.engineAts.includes(c.atsType);
  const view = (c: DiscoveredCompany) => ({ id: c.id, name: c.name, system: c.atsType, systemName: systemName(c.atsType), reading: reading(c) });

  r.post("/", auth, async (c) => {
    limitUser(ctx, "company-add", c.get("user").id, 10, 3_600_000, "You've asked for a lot of companies. Try again in an hour.");
    const { query } = await parseBody(c, AddCompany);
    let found;
    try {
      found = await ctx.discoverCompany(ctx.db, query);
    } catch (err) {
      if (err instanceof CompanyInputError || err instanceof BlockedSourceError) throw new HttpError(422, err.message);
      if (err instanceof UnsafeUrlError) throw new HttpError(422, "That link can't be used. Paste the company's public careers page, or type its name.");
      ctx.log(`[api] finding a company's board failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new HttpError(503, "Nori couldn't check that company right now. Try again in a moment.");
    }
    if (found.status === "not_found") throw new HttpError(404, found.message);
    if (found.status === "exists") return c.json({ status: "exists", company: view(found.company) });
    return c.json({ status: "added", company: view(found.company), openJobs: found.openJobs }, 201);
  });

  return r;
}
