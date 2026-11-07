/**
 * Reading emailed verification codes from the person's own Gmail through Composio (docs/inbox.md, "Connected Gmail").
 *
 * The person connects Gmail once (Composio's managed Google app, read-only). While an application run waits for a code,
 * `watchGmailForCodes` asks Gmail for new mail that looks like a code, every few seconds, and stores each one through the
 * same path as forwarded mail (`storeInbound`): it is classified, linked to the application by its sender, and wakes the
 * waiting run. Only a verification code that can belong to the waiting application is kept (linked to it, or sent by a
 * job system); any other mail is never stored. Nothing is read outside a code wait.
 *
 * Composio is called over its REST API (v3.1) with `fetch`, so there is no SDK dependency.
 */
import { applications, eq, inboxMessages, profiles, sql, type Db } from "@norinote/db";
import { classifyMessage } from "./classify.js";
import { atsOfSender } from "./link.js";
import { fromGeneric } from "./parse.js";
import { storeInbound } from "./receive.js";
import { awaitVerification, type AwaitVerificationArgs, type VerificationResult } from "./waiter.js";

const COMPOSIO_URL = "https://backend.composio.dev";
const FETCH_TOOL = "GMAIL_FETCH_EMAILS";

export type GmailConnectionStatus = "INITIATED" | "INITIALIZING" | "ACTIVE" | "INACTIVE" | "FAILED" | "EXPIRED" | "REVOKED" | "UNKNOWN";

/** One message as Gmail (through Composio) hands it over, reduced to what code reading needs. */
export type GmailMessage = { id: string; from: string; subject: string; text: string; receivedAt: Date | null };

export interface ComposioGmail {
  /** Starts a Gmail connection for this user; the person opens `url` and approves read-only access. */
  connect(userId: string): Promise<{ url: string; connectedAccountId: string | null }>;
  status(connectedAccountId: string): Promise<GmailConnectionStatus>;
  disconnect(connectedAccountId: string): Promise<void>;
  /** Recent messages matching a Gmail search query, newest first. */
  fetch(userId: string, query: string, max?: number): Promise<GmailMessage[]>;
}

export class ComposioError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function dateOf(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(str(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(str(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Decodes Gmail's base64url body parts, preferring text/plain. */
function payloadText(payload: unknown): string {
  const parts: Record<string, unknown>[] = [];
  const walk = (p: unknown) => { const o = rec(p); parts.push(o); for (const c of Array.isArray(o.parts) ? o.parts : []) walk(c); };
  walk(payload);
  const decode = (o: Record<string, unknown>) => {
    const data = str(rec(o.body).data);
    return data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";
  };
  const plain = parts.find((p) => str(p.mimeType).startsWith("text/plain") && str(rec(p.body).data));
  if (plain) return decode(plain);
  const html = parts.find((p) => str(p.mimeType).startsWith("text/html") && str(rec(p.body).data));
  return html ? decode(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * Reads the messages out of a GMAIL_FETCH_EMAILS result. The documented output is only `data`, so this accepts the shapes
 * seen in practice: `data.messages[]` with `messageId`/`id`, `sender`/`from`, `subject`, `messageText`/`snippet`/payload,
 * `messageTimestamp`/`internalDate`, or Gmail's own `payload.headers`.
 */
export function readGmailMessages(result: unknown): GmailMessage[] {
  const top = rec(result);
  let data: unknown = top.data ?? top;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return []; } }
  const d = rec(data);
  const list = Array.isArray(data) ? data : Array.isArray(d.messages) ? d.messages : Array.isArray(rec(d.response_data).messages) ? rec(d.response_data).messages : [];
  const out: GmailMessage[] = [];
  for (const raw of list as unknown[]) {
    const m = rec(raw);
    const headers = Array.isArray(rec(m.payload).headers) ? (rec(m.payload).headers as unknown[]).map(rec) : [];
    const header = (name: string) => str(headers.find((h) => str(h.name).toLowerCase() === name)?.value);
    const id = str(m.messageId) || str(m.id) || str(m.message_id);
    if (!id) continue;
    out.push({
      id,
      from: str(m.sender) || str(m.from) || header("from"),
      subject: str(m.subject) || header("subject"),
      text: str(m.messageText) || str(m.text) || str(rec(m.preview).body) || payloadText(m.payload) || str(m.snippet),
      receivedAt: dateOf(m.messageTimestamp ?? m.internalDate ?? m.date ?? header("date")),
    });
  }
  return out;
}

/** Composio over its REST API. `apiKey` is the project key (dashboard, Settings, API keys). */
export function createComposioGmail(opts: { apiKey: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }): ComposioGmail {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? COMPOSIO_URL).replace(/\/$/, "");
  async function call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { "x-api-key": opts.apiKey, "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ComposioError(`Composio ${method} ${path.split("?")[0]} failed (HTTP ${res.status})`, res.status);
    try { return rec(JSON.parse(text)); } catch { return {}; }
  }
  return {
    async connect(userId) {
      const session = await call("POST", "/api/v3.1/tool_router/session", { user_id: userId });
      const sessionId = str(session.session_id) || str(session.id);
      if (!sessionId) throw new ComposioError("Composio did not return a session", 502);
      const link = await call("POST", `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/link`, { toolkit: "gmail" });
      const url = str(link.redirect_url) || str(link.redirectUrl);
      if (!url) throw new ComposioError("Composio did not return a connect link", 502);
      return { url, connectedAccountId: str(link.connected_account_id) || str(link.connectedAccountId) || null };
    },
    async status(id) {
      const a = await call("GET", `/api/v3.1/connected_accounts/${encodeURIComponent(id)}`);
      const s = str(a.status).toUpperCase();
      return (["INITIATED", "INITIALIZING", "ACTIVE", "INACTIVE", "FAILED", "EXPIRED", "REVOKED"].includes(s) ? s : "UNKNOWN") as GmailConnectionStatus;
    },
    async disconnect(id) {
      await call("DELETE", `/api/v3.1/connected_accounts/${encodeURIComponent(id)}`);
    },
    async fetch(userId, query, max = 10) {
      const r = await call("POST", `/api/v3.1/tools/execute/${FETCH_TOOL}`, {
        user_id: userId, version: "latest",
        arguments: { query, max_results: max, verbose: true, include_payload: true },
      });
      if (r.successful === false) throw new ComposioError(`Gmail fetch failed: ${str(r.error).slice(0, 200)}`, 502);
      return readGmailMessages(r);
    },
  };
}

// ---- the person's connection, kept in profiles.preferences.gmail -----------------------------------------------------

export type GmailConnection = { connectedAccountId: string; startedAt: string; activeAt: string | null };

export async function getGmailConnection(db: Db, userId: string): Promise<GmailConnection | null> {
  const [row] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const g = rec(rec(row?.preferences).gmail);
  return str(g.connectedAccountId) ? { connectedAccountId: str(g.connectedAccountId), startedAt: str(g.startedAt), activeAt: str(g.activeAt) || null } : null;
}

export async function saveGmailConnection(db: Db, userId: string, value: GmailConnection | null): Promise<void> {
  const json = JSON.stringify(value);
  await db.insert(profiles).values({ userId, preferences: { gmail: value } })
    .onConflictDoUpdate({ target: profiles.userId, set: { preferences: sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('gmail', ${json}::jsonb)` } });
}

// ---- reading codes while a run waits -----------------------------------------------------------------------------------

/** Gmail search for code mail since `since` (a minute earlier, for clock skew). Narrow on purpose: codes only. */
export function codeQuery(since: Date): string {
  const after = Math.floor(since.getTime() / 1000) - 60;
  return `after:${after} -in:chats ("code" OR "verification" OR "verify" OR "passcode" OR "one-time" OR "security")`;
}

export type WatchGmailArgs = {
  db: Db;
  gmail: ComposioGmail;
  userId: string;
  since: Date;
  signal: AbortSignal;
  /** Poll interval. Default 5 s. */
  intervalMs?: number;
  now?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
};

/**
 * Polls the person's Gmail for code mail until `signal` aborts, storing each verification-code message once through
 * `storeInbound` (with the person as recipient), which links it to the waiting application and wakes the run. Any other
 * mail it sees is dropped without being stored. Errors are logged and polling goes on; a waiting run also accepts a code
 * typed in Norinote, so a Gmail hiccup never blocks it.
 */
export async function watchGmailForCodes(args: WatchGmailArgs): Promise<{ stored: number }> {
  const seen = new Set<string>();
  const now = args.now ?? (() => new Date());
  const interval = Math.max(500, args.intervalMs ?? 5000);
  let stored = 0;
  while (!args.signal.aborted) {
    try {
      for (const m of await args.gmail.fetch(args.userId, codeQuery(args.since), 10)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (classifyMessage({ from: m.from, subject: m.subject, text: m.text }).kind !== "verification_code") continue;
        const email = fromGeneric({ from: m.from, subject: m.subject, text: m.text, messageId: `gmail:${m.id}`, date: m.receivedAt?.toISOString() });
        const r = await storeInbound(args.db, { ...email, provider: "generic" }, { now: now(), userId: args.userId });
        if (!r.stored || r.duplicate) continue;
        // Keep only a code that can belong to the waiting application: linked to it, or sent by a job system (the
        // waiter's own check). A code from anything else (a bank, a login alert) is the person's business: drop it.
        if (!r.applicationId && !atsOfSender(m.from)) {
          await args.db.delete(inboxMessages).where(eq(inboxMessages.id, r.messageId));
          continue;
        }
        stored++;
        args.log?.("gmail.code", { userId: args.userId, linked: !!r.applicationId });
      }
    } catch (err) {
      args.log?.("gmail.fetch_failed", { userId: args.userId, error: err instanceof Error ? err.message : String(err) });
    }
    if (args.signal.aborted) break;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, interval);
      args.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  return { stored };
}

/**
 * `awaitVerification` that also reads the person's connected Gmail while it waits: the waiter takes whichever code comes
 * first (Gmail, their mail filter, or typed in Norinote). Without a Composio client or a connection it is the plain waiter.
 */
export async function awaitVerificationWithGmail(
  args: AwaitVerificationArgs & { db: Db; gmail: ComposioGmail | null; intervalMs?: number; log?: WatchGmailArgs["log"] },
): Promise<VerificationResult | null> {
  const { gmail, intervalMs, log, ...wait } = args;
  const [app] = gmail ? await args.db.select({ userId: applications.userId }).from(applications).where(eq(applications.id, args.applicationId)).limit(1) : [];
  const conn = app ? await getGmailConnection(args.db, app.userId) : null;
  if (!gmail || !app || !conn) return awaitVerification(wait);
  const stop = new AbortController();
  const watching = watchGmailForCodes({ db: args.db, gmail, userId: app.userId, since: args.since, signal: stop.signal, ...(intervalMs ? { intervalMs } : {}), ...(log ? { log } : {}), ...(args.now ? { now: args.now } : {}) });
  try {
    return await awaitVerification(wait);
  } finally {
    stop.abort();
    await watching.catch(() => undefined);
  }
}
