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

export type ForwardResult = { forwarded: boolean; reason?: "disabled" | "spam" | "already" | "missing" | "failed" };

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
