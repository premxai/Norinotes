import { eq, inboxMessages, sql, type Db } from "@norinote/db";
import { getInboxAddress, getInboxSettings } from "./address.js";
import type { InboxMeta } from "./receive.js";

/**
 * One message to pass on to the user's own mailbox. It is sent as a new message from our domain (so SPF, DKIM and DMARC
 * align and it is not junked as a spoof), with the original sender as Reply-To, rather than re-sending the original.
 */
export type ForwardEnvelope = {
  to: string;
  /** The user's Norinote address; the sending domain must be set up for outbound mail. */
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  /** Original Message-ID, for threading in the user's client. */
  inReplyTo: string | null;
};

/** Sends forwarded mail. Wire a real provider (Cloudflare Email Sending, Postmark, SES) here; until then the stub logs. */
export interface Forwarder {
  readonly name: string;
  send(mail: ForwardEnvelope): Promise<void>;
}

/** Sends nothing; records what would have been sent. The default until an outbound provider key is configured. */
export function createStubForwarder(log: (line: string) => void = () => undefined): Forwarder & { sent: ForwardEnvelope[] } {
  const sent: ForwardEnvelope[] = [];
  return {
    name: "stub",
    sent,
    async send(mail) {
      sent.push(mail);
      log(`[inbox] forward (stub, not sent) to=${mail.to.replace(/^(.).*(@.*)$/, "$1***$2")} subject=${JSON.stringify(mail.subject.slice(0, 60))}`);
    },
  };
}

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Sends forwarded mail through Resend. `from` must be on a domain verified in Resend (the inbox subdomain is not), so the
 * message comes from "Norinote inbox" on that domain with the original sender as Reply-To: replying
 * in the user's mail client answers the employer directly. A failed send throws with the status only.
 */
export function createResendForwarder(opts: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Forwarder {
  const doFetch = opts.fetch ?? fetch;
  const address = /<([^>]+)>/.exec(opts.from)?.[1] ?? opts.from;
  return {
    name: "resend",
    async send(mail) {
      const res = await doFetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Norinote inbox <${address}>`, to: [mail.to], reply_to: mail.replyTo, subject: mail.subject, text: mail.text,
          ...(mail.inReplyTo ? { headers: { "In-Reply-To": mail.inReplyTo, References: mail.inReplyTo } } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`Resend refused the forwarded message (HTTP ${res.status})`);
    },
  };
}

export type ForwardResult = { forwarded: boolean; reason?: "disabled" | "spam" | "code" | "already" | "missing" | "failed" };

/**
 * Forwards a stored message to the user's own address when they turned forwarding on. Once per message (the time is kept
 * in `meta.forwardedAt`), never spam. A failed send is recorded in `meta.forwardError` and thrown, so the queue retries.
 */
export async function forwardMessage(db: Db, messageId: string, forwarder: Forwarder, opts: { now?: Date } = {}): Promise<ForwardResult> {
  const [row] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, messageId)).limit(1);
  if (!row) return { forwarded: false, reason: "missing" };
  const meta = (row.meta ?? {}) as InboxMeta;
  if (meta.forwardedAt) return { forwarded: false, reason: "already" };
  if (meta.spam) return { forwarded: false, reason: "spam" };
  // Codes are for Norinote to type in, and they usually arrive through the person's own mail filter: sending one back
  // could match that filter again and loop.
  if (row.kind === "verification_code") return { forwarded: false, reason: "code" };
  const settings = await getInboxSettings(db, row.userId);
  if (!settings.forwardEnabled || !settings.forwardTo) return { forwarded: false, reason: "disabled" };
  const from = await getInboxAddress(db, row.userId);
  if (!from) return { forwarded: false, reason: "disabled" };
  const sender = meta.fromName ? `${meta.fromName} <${row.fromAddress}>` : row.fromAddress;
  const head = [`From: ${sender}`, `Subject: ${row.subject}`, `Received: ${row.receivedAt.toISOString()}`];
  if (row.code) head.push(`Verification code: ${row.code}`);
  if (meta.attachments?.length) head.push(`Attachments (not forwarded): ${meta.attachments.map((a) => a.filename).join(", ")}`);
  try {
    await forwarder.send({
      to: settings.forwardTo, from, replyTo: row.fromAddress, subject: `Fwd: ${row.subject}`.slice(0, 300),
      text: `${head.join("\n")}\n\n${row.body}`, inReplyTo: row.messageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(inboxMessages).set({ meta: sql`${inboxMessages.meta} || ${JSON.stringify({ forwardError: msg.slice(0, 300) })}::jsonb` }).where(eq(inboxMessages.id, messageId));
    throw err;
  }
  const at = (opts.now ?? new Date()).toISOString();
  await db.update(inboxMessages).set({ meta: sql`${inboxMessages.meta} || ${JSON.stringify({ forwardedAt: at, forwardError: null })}::jsonb` }).where(eq(inboxMessages.id, messageId));
  return { forwarded: true };
}
