import { Hono } from "hono";
import { z } from "zod";
import { eq, lanes, profiles, sql } from "@norinote/db";
import { parseContact } from "@norinote/graph";
import { assignInboxAddress } from "@norinote/inbox";
import { JOBS } from "@norinote/queue";
import { ensureProfile, requireUser } from "../auth/session.js";
import { parseBody, parseWith } from "../http.js";
import {
  advance, buildUpdate, ONBOARDING_STEPS, ProfilePatch, readOnboarding, STEP_KEYS, toProfile, withOnboarding, type OnboardingStepId,
} from "../profile-model.js";
import { ingestResume, type IngestResult } from "../resume-ingest.js";
import { enqueueSoft, limitUser, type AppEnv, type Ctx } from "../types.js";

const Body = z.object({ step: z.enum(ONBOARDING_STEPS), data: z.record(z.string(), z.unknown()).default({}) });
const ResumeData = z.object({ text: z.string().min(20, "Paste the full resume text").max(200_000).optional() });

export function onboardingRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/", auth, async (c) => {
    const user = c.get("user");
    const row = await ensureProfile(db, user.id);
    return c.json({ step: readOnboarding(row).step, profile: toProfile(row, user.email) });
  });

  r.put("/", auth, async (c) => {
    const user = c.get("user");
    const { step, data } = await parseBody(c, Body);
    const current = await ensureProfile(db, user.id);

    let resume: IngestResult | null = null;
    if (step === "resume") {
      const { text } = parseWith(ResumeData, data);
      if (text) {
        limitUser(ctx, "resume", user.id, 20, 3_600_000, "Too many resume uploads. Try again in an hour.");
        resume = await ingestResume(ctx, user.id, text.trim(), parseContact(text));
      }
    }

    // Unknown keys are dropped by the schema; keys that belong to another step are dropped here.
    const patch = parseWith(ProfilePatch, data);
    const allowed = new Set<string>(STEP_KEYS[step as OnboardingStepId]);
    const scoped = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k))) as typeof patch;

    const fresh = await ensureProfile(db, user.id);
    const update = buildUpdate(fresh, scoped);
    const before = readOnboarding(current).step;
    const next = advance(readOnboarding(fresh).step, step);
    const [row] = await db.update(profiles)
      .set({ ...update, preferences: withOnboarding(update.preferences ?? fresh.preferences, next, ctx.now()), updatedAt: ctx.now() })
      .where(eq(profiles.userId, user.id)).returning();
    const saved = row ?? fresh;

    if (next === "done" && before !== "done") await finishOnboarding(ctx, user.id, saved);
    else if (scoped.workAuth || scoped.securityClearance !== undefined) await enqueueSoft(ctx, JOBS.matchUser, { userId: user.id, reason: "profile" });
    return c.json({ step: next, profile: toProfile(saved, user.email), note: resume?.note ?? null, resume });
  });

  return r;
}

/** The last step is saved: the first lane from the preferences, the owned inbox address, and a first shortlist run. */
async function finishOnboarding(ctx: Ctx, userId: string, profile: typeof profiles.$inferSelect): Promise<void> {
  const { db } = ctx;
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const titles = Array.isArray(prefs.titles) ? prefs.titles.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  if (titles.length > 0) {
    const locations = Array.isArray(prefs.locations) ? prefs.locations.filter((l): l is string => typeof l === "string") : [];
    const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(lanes).where(eq(lanes.userId, userId));
    if ((existing?.n ?? 0) === 0) {
      await db.insert(lanes).values({ userId, name: (titles[0] ?? "My lane").slice(0, 100), titles, locations, remote: prefs.remote !== "no", minFit: 0.6, enabled: true });
    }
  }
  if (ctx.config.inboundEmailDomain) {
    try {
      await assignInboxAddress(db, userId, ctx.config.inboundEmailDomain);
    } catch (err) {
      ctx.log(`[api] could not assign an inbox address: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await enqueueSoft(ctx, JOBS.matchUser, { userId, reason: "lanes" });
}
