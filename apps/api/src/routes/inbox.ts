import { Hono } from "hono";
import { desc, eq, inboxMessages } from "@norinote/db";
import { receiveInbound, verifyInboundSecret, type InboundPayload } from "@norinote/inbox";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, intParam } from "../http.js";
import { enqueueSoft, type AppEnv, type Ctx } from "../types.js";

export function inboxRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  r.get("/", auth, async (c) => {
    const rows = await db.select().from(inboxMessages).where(eq(inboxMessages.userId, c.get("user").id))
      .orderBy(desc(inboxMessages.receivedAt)).limit(intParam(c.req.query("limit"), 100, 1, 200));
    return c.json(rows.map((m) => ({
      id: m.id, applicationId: m.applicationId, fromAddress: m.fromAddress, subject: m.subject, bodyText: m.body,
      receivedAt: m.receivedAt.toISOString(), kind: m.kind, code: m.code,
    })));
  });

  return r;
}

/** The email provider's webhook. No session: it is checked against the shared secret instead. */
export function inboundRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = ctx;

  r.post("/email", async (c) => {
    const header = c.req.header("x-webhook-secret") ?? c.req.header("authorization");
    if (!verifyInboundSecret(header, ctx.config.inboundWebhookSecret)) throw new HttpError(401, "Unauthorized");

    let payload: InboundPayload;
    if ((c.req.header("content-type") ?? "").includes("json")) {
      let parsed: unknown;
      try { parsed = await c.req.json(); } catch { throw new HttpError(400, "Body is not valid JSON"); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Expected a JSON object");
      payload = parsed as Record<string, unknown>;
    } else {
      payload = await c.req.text();
    }

    const res = await receiveInbound(db, payload, { now: ctx.now() });
    // Answer 200 for mail we cannot use (unknown recipient, unreadable) so the provider does not retry it forever.
    if (!res.stored) return c.json({ stored: false, reason: res.reason });
    if (!res.duplicate) await enqueueSoft(ctx, JOBS.inboxReceive, { messageId: res.messageId });
    return c.json({ stored: true, duplicate: res.duplicate });
  });

  return r;
}
