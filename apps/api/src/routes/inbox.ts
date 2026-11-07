import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { and, applications, companies, desc, eq, inboxMessages, jobs } from "@norinote/db";
import {
  assignInboxAddress, ENVELOPE_TO_HEADER, fromGeneric, fromPostmark, getGmailConnection, getInboxAddress, getInboxSettings, INBOUND_MAX_BYTES, INBOUND_PROVIDERS, saveGmailConnection,
  InboundTooLargeError, parseMime, receiveInbound, storeInbound, updateInboxSettings, verifyInboundSecret, verifyProviderRequest,
  type InboundEmail, type InboundPayload, type InboundProvider, type InboxMeta, type ReceiveResult,
} from "@norinote/inbox";
import { JOBS } from "@norinote/queue";
import { requireUser } from "../auth/session.js";
import { HttpError, intParam } from "../http.js";
import { enqueueSoft, type AppEnv, type Ctx } from "../types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Settings = z.object({
  forwardTo: z.string().trim().max(320).nullable().optional(),
  forwardEnabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).nullable().optional(),
}).strict();

type Row = typeof inboxMessages.$inferSelect & { app: { id: string; status: string; jobTitle: string; companyName: string } | null };

function view(m: Row, full: boolean) {
  const meta = (m.meta ?? {}) as InboxMeta;
  return {
    id: m.id, applicationId: m.applicationId, application: m.app, fromAddress: m.fromAddress, fromName: meta.fromName ?? null,
    subject: m.subject, bodyText: m.body, receivedAt: m.receivedAt.toISOString(), kind: m.kind, code: m.code,
    usedAt: m.usedAt ? m.usedAt.toISOString() : null,
    verificationLink: meta.verificationLink ?? null, links: m.links, attachments: meta.attachments ?? [], spam: !!meta.spam,
    ...(full ? { classifiedBy: meta.classifiedBy ?? "rules", forwardedAt: meta.forwardedAt ?? null } : {}),
  };
}

/** Answers a stored or dropped message and queues `inbox.receive` for new ones. */
async function finish(c: Context<AppEnv>, ctx: Ctx, res: ReceiveResult) {
  // 200 for mail we cannot use (unknown recipient, unreadable) so the provider does not retry it forever.
  if (!res.stored) {
    if (res.reason === "too_large") throw new HttpError(413, "Message too large");
    return c.json({ stored: false, reason: res.reason });
  }
  if (!res.duplicate) await enqueueSoft(ctx, JOBS.inboxReceive, { messageId: res.messageId });
  return c.json({ stored: true, duplicate: res.duplicate });
}

export function inboxRoutes(ctx: Ctx): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const auth = requireUser(ctx);
  const { db } = ctx;

  /**
   * Provider webhook, no session. `cloudflare` and `raw`: raw MIME signed with HMAC (our Email Worker). `generic`: JSON
   * signed the same way. `postmark`: Postmark's inbound JSON with the secret as basic auth.
   */
  r.post("/webhook/:provider", async (c) => {
    const provider = c.req.param("provider") as InboundProvider;
    if (!(INBOUND_PROVIDERS as readonly string[]).includes(provider)) throw new HttpError(404, "Unknown inbound provider");
    const body = new Uint8Array(await c.req.arrayBuffer());
    const check = verifyProviderRequest(provider, body, (name) => c.req.header(name), ctx.config.inboundWebhookSecret, ctx.now());
    if (!check.ok) throw new HttpError(401, "Unauthorized");
    if (body.byteLength > INBOUND_MAX_BYTES) throw new HttpError(413, "Message too large");

    let email: InboundEmail;
    try {
      if (provider === "cloudflare" || provider === "raw") {
        const envelopeTo = (c.req.header(ENVELOPE_TO_HEADER) ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
        email = await parseMime(body, { envelopeTo, provider });
      } else {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
        const o = parsed as Record<string, unknown>;
        email = provider === "postmark" ? fromPostmark(o, body.byteLength) : fromGeneric(o, body.byteLength);
      }
    } catch (err) {
      if (err instanceof InboundTooLargeError) throw new HttpError(413, "Message too large");
      throw new HttpError(400, "Unreadable message");
    }
    return finish(c, ctx, await storeInbound(db, email, { now: ctx.now() }));
  });

  /** The user's inbound address (created on first call) and their forwarding and retention settings. */
  r.get("/address", auth, async (c) => {
    const userId = c.get("user").id;
    const domain = ctx.config.inboundEmailDomain;
    const address = domain ? await assignInboxAddress(db, userId, domain) : await getInboxAddress(db, userId);
    return c.json({ address, configured: !!domain, settings: await getInboxSettings(db, userId) });
  });

  // ---- connected Gmail (Composio): emailed codes are read from the person's own mailbox while a run waits ----------
  /** Whether Gmail can be connected here, and whether this person has. */
  r.get("/gmail", auth, async (c) => {
    const userId = c.get("user").id;
    const conn = await getGmailConnection(db, userId);
    if (!ctx.gmail || !conn) return c.json({ available: !!ctx.gmail, connected: false, status: null });
    const status = await ctx.gmail.status(conn.connectedAccountId).catch(() => "UNKNOWN" as const);
    if (status === "ACTIVE" && !conn.activeAt) await saveGmailConnection(db, userId, { ...conn, activeAt: ctx.now().toISOString() });
    return c.json({ available: true, connected: status === "ACTIVE", status });
  });

  /** Starts a connection: the person opens `url` and approves read-only Gmail access. */
  r.post("/gmail/connect", auth, async (c) => {
    if (!ctx.gmail) throw new HttpError(503, "Connecting Gmail is not set up on this server");
    const userId = c.get("user").id;
    try {
      const link = await ctx.gmail.connect(userId);
      if (link.connectedAccountId) await saveGmailConnection(db, userId, { connectedAccountId: link.connectedAccountId, startedAt: ctx.now().toISOString(), activeAt: null });
      return c.json({ url: link.url });
    } catch (err) {
      ctx.log(`[api] gmail connect failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new HttpError(503, "Could not start the Gmail connection. Try again in a moment.");
    }
  });

  r.delete("/gmail", auth, async (c) => {
    const userId = c.get("user").id;
    const conn = await getGmailConnection(db, userId);
    if (conn && ctx.gmail) await ctx.gmail.disconnect(conn.connectedAccountId).catch((err: unknown) => ctx.log(`[api] gmail disconnect failed: ${err instanceof Error ? err.message : String(err)}`));
    await saveGmailConnection(db, userId, null);
    return c.json({ ok: true });
  });

  r.put("/settings", auth, async (c) => {
    const parsed = Settings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid inbox settings");
    try {
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
      const settings = await updateInboxSettings(db, c.get("user").id, patch, { ...(ctx.config.inboundEmailDomain ? { inboundDomain: ctx.config.inboundEmailDomain } : {}) });
      return c.json({ settings });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "Invalid inbox settings");
    }
  });

  const select = () => db.select({
    m: inboxMessages, appId: applications.id, appStatus: applications.status, jobTitle: jobs.title, companyName: companies.name,
  }).from(inboxMessages)
    .leftJoin(applications, eq(applications.id, inboxMessages.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId));
  const toRow = (x: { m: typeof inboxMessages.$inferSelect; appId: string | null; appStatus: string | null; jobTitle: string | null; companyName: string | null }): Row => ({
    ...x.m, app: x.appId ? { id: x.appId, status: x.appStatus ?? "", jobTitle: x.jobTitle ?? "", companyName: x.companyName ?? "" } : null,
  });

  /** The user's messages, newest first, with the linked application. */
  r.get("/", auth, async (c) => {
    const rows = await select().where(eq(inboxMessages.userId, c.get("user").id))
      .orderBy(desc(inboxMessages.receivedAt)).limit(intParam(c.req.query("limit"), 100, 1, 200));
    return c.json(rows.map((x) => view(toRow(x), false)));
  });

  r.get("/:id", auth, async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) throw new HttpError(404, "Not found");
    const [x] = await select().where(and(eq(inboxMessages.id, id), eq(inboxMessages.userId, c.get("user").id))).limit(1);
    if (!x) throw new HttpError(404, "Not found");
    return c.json(view(toRow(x), true));
  });

  return r;
}

/**
 * The older provider webhook (`POST /api/inbound/email`), kept for existing setups: any supported shape, guessed, checked
 * against the shared secret (header, Bearer or basic auth). New setups use `/api/inbox/webhook/:provider`.
 */
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
    return finish(c, ctx, await receiveInbound(db, payload, { now: ctx.now() }));
  });

  return r;
}
