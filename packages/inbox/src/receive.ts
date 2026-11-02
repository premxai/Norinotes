import { and, applications, eq, inArray, inboxAddresses, inboxMessages, outcomes, type Db } from "@norinote/db";
import { INBOX_OUTCOME_KINDS, type InboxKind } from "@norinote/shared";
import { classifyMessage } from "./classify.js";
import { loadCandidates, pickApplication, senderSpeaksFor, type AppCandidate } from "./link.js";
import { normalizeInbound, type InboundEmail, type InboundPayload } from "./parse.js";
import { htmlToText, parseAddress } from "./text.js";

/** Longest stored body of a message. */
export const INBOX_BODY_MAX = 20_000;

/** What the caller should wake after a message was stored. */
export type Wake = {
  applicationId: string;
  /** `code`: an `apply.run` waiting in `awaiting_code` can continue (its waiter polls the database). `outcome`: the employer answered. */
  reason: "code" | "outcome";
};

export type StoredInbound = {
  stored: true;
  /** The same Message-ID arrived before (a webhook retry): nothing new was written. */
  duplicate: boolean;
  /** `inbox_messages.id`. Hand it to the `inbox.receive` queue. */
  messageId: string;
  userId: string;
  applicationId: string | null;
  kind: InboxKind;
  code: string | null;
  links: string[];
  /** Set when the message counted as an outcome (reply, interview, rejection, offer) for a submitted application. */
  outcome: (typeof INBOX_OUTCOME_KINDS)[number] | null;
  wake: Wake | null;
};

export type ReceiveResult = StoredInbound | { stored: false; reason: "unknown_recipient" | "unreadable" };

const OUTCOME_KIND: Record<(typeof INBOX_OUTCOME_KINDS)[number], "reply" | "interview" | "rejection" | "offer"> = {
  recruiter_reply: "reply", interview: "interview", rejection: "rejection", offer: "offer",
};

/** `nori-abc+tag@x.io` also reaches `nori-abc@x.io`. */
function addressVariants(addresses: readonly string[]): string[] {
  const out = new Set<string>();
  for (const a of addresses) {
    const address = a.trim().toLowerCase();
    if (!address.includes("@")) continue;
    out.add(address);
    const [local = "", domain = ""] = address.split("@");
    if (local.includes("+")) out.add(`${local.split("+")[0]}@${domain}`);
  }
  return [...out];
}

/** The user an inbound message is for: the first recipient that is one of our addresses. */
async function resolveUser(db: Db, recipients: readonly string[]): Promise<string | null> {
  const variants = addressVariants(recipients);
  if (variants.length === 0) return null;
  const rows = await db.select({ userId: inboxAddresses.userId, address: inboxAddresses.address }).from(inboxAddresses).where(inArray(inboxAddresses.address, variants));
  for (const v of variants) {
    const hit = rows.find((r) => r.address === v);
    if (hit) return hit.userId;
  }
  return null;
}

type Mail = { from: string; fromName: string; subject: string; text: string; html?: string | null };

function analyse(email: Mail, candidates: readonly AppCandidate[]) {
  const c = classifyMessage({ from: email.from, subject: email.subject, text: email.text });
  // Links may live only in the HTML part: scan its text rendering too.
  const links = email.html ? classifyMessage({ from: email.from, subject: email.subject, text: `${email.text}\n${htmlToText(email.html)}` }).links : c.links;
  const app = pickApplication(candidates, email, c.kind);
  return { ...c, links, app };
}

/** Records an outcome for a submitted application when the company (or its ATS) wrote the message. Once per application and kind. */
async function recordOutcome(db: Db, app: AppCandidate | null, kind: InboxKind, from: { address: string; name: string }, at: Date): Promise<StoredInbound["outcome"]> {
  if (!app || app.status !== "submitted") return null;
  if (!(INBOX_OUTCOME_KINDS as readonly string[]).includes(kind)) return null;
  // Anyone can write a company's name in a subject line: a status change needs the company or its job system as sender.
  if (!senderSpeaksFor(from, app.companyName)) return null;
  const outcomeKind = kind as (typeof INBOX_OUTCOME_KINDS)[number];
  const [seen] = await db.select({ id: outcomes.id }).from(outcomes).where(and(eq(outcomes.applicationId, app.id), eq(outcomes.kind, OUTCOME_KIND[outcomeKind]))).limit(1);
  if (!seen) await db.insert(outcomes).values({ applicationId: app.id, kind: OUTCOME_KIND[outcomeKind], at });
  return outcomeKind;
}

function wakeFor(applicationId: string | null, kind: InboxKind, code: string | null, outcome: StoredInbound["outcome"]): Wake | null {
  if (!applicationId) return null;
  if (kind === "verification_code" && code) return { applicationId, reason: "code" };
  if (outcome) return { applicationId, reason: "outcome" };
  return null;
}

/**
 * Takes one inbound email from the webhook: a raw MIME message, Postmark's inbound JSON, or a generic
 * `{ from, to, subject, text, html }`. Finds the user by recipient address (unknown recipients are dropped, nothing is
 * stored), classifies it with deterministic rules, extracts the code and links, links it to the most likely application,
 * stores it in `inbox_messages` (a repeated Message-ID is stored once) and says what to wake.
 */
export async function receiveInbound(db: Db, payload: InboundPayload, opts: { now?: Date } = {}): Promise<ReceiveResult> {
  const now = opts.now ?? new Date();
  let email: InboundEmail;
  try {
    email = await normalizeInbound(payload);
  } catch {
    return { stored: false, reason: "unreadable" };
  }
  const userId = await resolveUser(db, email.to);
  if (!userId) return { stored: false, reason: "unknown_recipient" };

  const a = analyse(email, await loadCandidates(db, userId, now));
  // Arrival time, not the Date header: a code is "fresh" by when it reached us, and headers can be hours off.
  const inserted = await db.insert(inboxMessages).values({
    userId, applicationId: a.app?.id ?? null, kind: a.kind, code: a.code, fromAddress: email.from, messageId: email.messageId,
    links: a.links, subject: email.subject.slice(0, 500), body: email.text.slice(0, INBOX_BODY_MAX), receivedAt: now,
  }).onConflictDoNothing().returning({ id: inboxMessages.id });

  const row = inserted[0];
  if (!row) {
    const [existing] = email.messageId
      ? await db.select().from(inboxMessages).where(and(eq(inboxMessages.userId, userId), eq(inboxMessages.messageId, email.messageId))).limit(1)
      : [];
    if (!existing) return { stored: false, reason: "unreadable" };
    return { stored: true, duplicate: true, messageId: existing.id, userId, applicationId: existing.applicationId, kind: existing.kind, code: existing.code, links: existing.links, outcome: null, wake: null };
  }
  const outcome = await recordOutcome(db, a.app, a.kind, { address: email.from, name: email.fromName }, now);
  return {
    stored: true, duplicate: false, messageId: row.id, userId, applicationId: a.app?.id ?? null, kind: a.kind, code: a.code,
    links: a.links, outcome, wake: wakeFor(a.app?.id ?? null, a.kind, a.code, outcome),
  };
}

/**
 * Re-reads a stored message (the `inbox.receive` queue job): classifies it again, relinks it (the application may have
 * been created or submitted since the mail arrived), makes sure the outcome is recorded, and says what to wake. Safe to
 * repeat.
 */
export async function reprocessMessage(db: Db, messageId: string): Promise<ReceiveResult> {
  const [row] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, messageId)).limit(1);
  if (!row) return { stored: false, reason: "unreadable" };
  const from = parseAddress(row.fromAddress);
  const mail: Mail = { from: from.address || row.fromAddress, fromName: from.name, subject: row.subject, text: row.body };
  const a = analyse(mail, await loadCandidates(db, row.userId, new Date()));
  // A later look must not lose what the first one found (a code, a link, an application).
  const applicationId = a.app?.id ?? row.applicationId;
  const links = a.links.length ? a.links : row.links;
  await db.update(inboxMessages).set({ kind: a.kind, code: a.code ?? row.code, links, applicationId }).where(eq(inboxMessages.id, messageId));
  const app = a.app ?? (applicationId ? (await loadCandidates(db, row.userId, new Date())).find((c) => c.id === applicationId) ?? null : null);
  const outcome = await recordOutcome(db, app, a.kind, { address: mail.from, name: mail.fromName }, row.receivedAt);
  const code = a.code ?? row.code;
  return { stored: true, duplicate: true, messageId, userId: row.userId, applicationId, kind: a.kind, code, links, outcome, wake: wakeFor(applicationId, a.kind, code, outcome) };
}

/** Applications of this user that are waiting on mail (applying or awaiting a code). */
export async function waitingApplications(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: applications.id }).from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.status, ["applying", "awaiting_code"])));
  return rows.map((r) => r.id);
}
