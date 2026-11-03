import { Hono } from "hono";
import { z } from "zod";
import {
  OUTCOME_KINDS, addManualOutcome, listOutcomes, loadOutcomeHistory, refreshOutcomeLearning, removeOutcome, removeOutcomesOfKind, resolveApplication,
  summarizeOutcomes, syncInboxOutcomes, type OutcomeLearning, type OutcomeRow,
} from "@norinote/match";
import { requireUser } from "../auth/session.js";
import { HttpError, iso, notFound, parseBody, uuidParam } from "../http.js";
import type { AppEnv, Ctx } from "../types.js";
import { ownedApplication } from "./applications.js";

const DAY_MS = 86_400_000;
const Add = z.object({ kind: z.enum(OUTCOME_KINDS), at: z.iso.datetime({ offset: true }).optional() });

const toOutcome = (o: OutcomeRow) => ({ id: o.id, kind: o.kind, at: o.at.toISOString(), source: o.source, messageId: o.messageId });

/** The learned nudge in plain terms, for the summary. */
function learningView(m: OutcomeLearning) {
  return {
    active: m.active, resolved: m.resolved, positive: m.positive, needed: 10, computedAt: m.computedAt,
    nudges: m.nudges.map((n) => ({ dimension: n.dimension, value: n.value, positive: n.positive, resolved: n.resolved, delta: n.delta })),
  };
}

/**
 * Outcomes of one application, added or corrected by hand: `/api/applications/:id/outcomes`. Many replies arrive at the
 * user's own mailbox, so the owned inbox cannot see everything.
 */
export function applicationOutcomeRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  async function view(app: Awaited<ReturnType<typeof ownedApplication>>) {
    const list = await listOutcomes(db, app.id);
    const submittedAt = app.submittedAt ?? (app.status === "submitted" ? app.updatedAt : null);
    const state = submittedAt ? resolveApplication({ submittedAt, outcomes: list }, ctx.now()).state : null;
    return { applicationId: app.id, submittedAt: iso(submittedAt), confirmedAt: iso(app.confirmedAt), state, outcomes: list.map(toOutcome) };
  }

  /** Learning reads outcomes: refresh it after a change (a failure must not undo the change). */
  async function relearn(userId: string): Promise<void> {
    try { await refreshOutcomeLearning(db, userId, ctx.now()); } catch (err) { ctx.log(`[api] outcome learning refresh failed: ${err instanceof Error ? err.message : String(err)}`); }
  }

  r.get("/:id/outcomes", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    await syncInboxOutcomes(db, { userId: user.id });
    return c.json(await view(await ownedApplication(db, user.id, app.id)));
  });

  r.post("/:id/outcomes", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const body = await parseBody(c, Add);
    if (app.status !== "submitted" && !app.submittedAt) throw new HttpError(409, "This application has not been submitted yet");
    const now = ctx.now();
    const at = body.at ? new Date(body.at) : now;
    if (at.getTime() > now.getTime() + DAY_MS) throw new HttpError(400, "Invalid request", "at: an outcome cannot be in the future");
    const res = await addManualOutcome(db, app.id, body.kind, at);
    if (res.created) await relearn(user.id);
    return c.json({ outcome: toOutcome(res.outcome), created: res.created, ...await view(app) }, res.created ? 201 : 200);
  });

  /** Remove one outcome (a wrong automatic one, or a mistake). Re-reading its message never brings it back. */
  r.delete("/:id/outcomes/:outcomeId", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const removed = await removeOutcome(db, app.id, uuidParam(c, "outcomeId"), ctx.now());
    if (!removed) throw notFound("Outcome not found");
    await relearn(user.id);
    return c.json({ ok: true, ...await view(app) });
  });

  /** `DELETE /:id/outcomes?kind=rejection`: remove every active outcome of that kind. */
  r.delete("/:id/outcomes", auth, async (c) => {
    const user = c.get("user");
    const app = await ownedApplication(db, user.id, uuidParam(c));
    const kind = z.enum(OUTCOME_KINDS).safeParse(c.req.query("kind"));
    if (!kind.success) throw new HttpError(400, "Invalid request", `kind: one of ${OUTCOME_KINDS.join(", ")}`);
    const removed = await removeOutcomesOfKind(db, app.id, kind.data, ctx.now());
    if (removed > 0) await relearn(user.id);
    return c.json({ ok: true, removed, ...await view(app) });
  });

  return r;
}

/** `/api/outcomes/summary`: the signed-in user's own rates, with small samples shown as counts only. */
export function outcomeRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/summary", auth, async (c) => {
    const userId = c.get("user").id;
    const now = ctx.now();
    await syncInboxOutcomes(db, { userId });
    const summary = summarizeOutcomes(await loadOutcomeHistory(db, { userId }), now);
    let learning: ReturnType<typeof learningView> | null = null;
    try { learning = learningView(await refreshOutcomeLearning(db, userId, now)); } catch { learning = null; }
    return c.json({ ...summary, learning });
  });

  return r;
}
