import { and, applications, eq, inArray, inboxAddresses, inboxMessages, outcomes, type Db } from "@norinote/db";
import { INBOX_OUTCOME_KINDS, type InboxKind } from "@norinote/shared";
import { classifyMessage, type Classification } from "./classify.js";
import { atsOfSender, linkApplication, loadCandidates, senderSpeaksFor, type AppCandidate } from "./link.js";
import { settleAmbiguous, type InboxModel } from "./model.js";
import { InboundTooLargeError, normalizeInbound, type AttachmentMeta, type InboundEmail, type InboundPayload } from "./parse.js";
import { htmlToText, parseAddress } from "./text.js";
import { notifyInbox } from "./notify.js";

/** Longest stored body of a message. */
export const INBOX_BODY_MAX = 20_000;
export const INBOX_SUBJECT_MAX = 500;

/** `inbox_messages.meta`: what the inbox learnt about a message. Never the attachment content or the HTML. */
export type InboxMeta = {
  provider?: string;
  /** The sender's display name ("Acme via Greenhouse"), which links ATS mail to a company. */
  fromName?: string;
  attachments?: AttachmentMeta[];
  spam?: boolean;
  spamReason?: string | null;
  /** For kind `verification_code`: verify by typing a code, or by opening a link. */
  verification?: "code" | "link" | null;
  verificationLink?: string | null;
  /** The rules were unsure; the worker asks the small model (`classifiedBy` says who decided). */
  ambiguous?: boolean;
  ambiguity?: string | null;
  classifiedBy?: "rules" | "model" | "fallback";
  /** The sender may speak for the linked application's company (its domain, or the job's ATS). Codes are only used when true. */
  trusted?: boolean;
  link?: { why: string[]; ambiguous: boolean };
  forwardedAt?: string | null;
  forwardError?: string | null;
};

/** What the caller should wake after a message was stored. */
export type Wake = {
  applicationId: string;
  /** `code`: a verification code or link arrived for an application (awaitVerification picks it up). `outcome`: the employer answered. */
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
  verificationLink: string | null;
  /** The worker should ask the model to settle the classification. */
  ambiguous: boolean;
  spam: boolean;
  /** Set when the message counted as an outcome (reply, interview, rejection, offer) for a submitted application. */
  outcome: (typeof INBOX_OUTCOME_KINDS)[number] | null;
  wake: Wake | null;
};

export type ReceiveResult = StoredInbound | { stored: false; reason: "unknown_recipient" | "unreadable" | "too_large" };

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

type Analysis = Classification & { app: AppCandidate | null; linkWhy: string[]; linkAmbiguous: boolean; trusted: boolean };

function analyse(email: Mail, candidates: readonly AppCandidate[], spam: boolean, settled?: Classification): Analysis {
  const scanText = email.html ? `${email.text}\n${htmlToText(email.html)}` : email.text;
  const rules = settled ?? classifyMessage({ from: email.from, subject: email.subject, text: email.text });
  // Links may live only in the HTML part: scan its text rendering too.
  const links = email.html ? classifyMessage({ from: email.from, subject: email.subject, text: scanText }).links : rules.links;
  const magic = rules.magicLink ?? (rules.verification === "link" ? links[0] ?? null : null);
  if (spam) {
    // Spam is kept (nothing is lost) but never linked, never a code, never an outcome.
    return { ...rules, kind: "other", code: null, links, magicLink: null, verification: null, ambiguous: false, ambiguity: null, app: null, linkWhy: [], linkAmbiguous: false, trusted: false };
  }
  const linked = linkApplication(candidates, { ...email, links }, rules.kind);
  const app = linked.app;
  const trusted = !!app && (senderSpeaksFor({ address: email.from, name: email.fromName }, app.companyName, app.companyDomain) || atsOfSender(email.from) === app.atsType);
  return { ...rules, links, magicLink: magic, app, linkWhy: linked.why, linkAmbiguous: linked.ambiguous, trusted };
}

/** Records an outcome for a submitted application when the company (or its ATS) wrote the message. Once per application and kind. */
async function recordOutcome(db: Db, app: AppCandidate | null, kind: InboxKind, from: { address: string; name: string }, at: Date): Promise<StoredInbound["outcome"]> {
  if (!app || app.status !== "submitted") return null;
  if (!(INBOX_OUTCOME_KINDS as readonly string[]).includes(kind)) return null;
  // Anyone can write a company's name in a subject line: a status change needs the company or its job system as sender.
  if (!senderSpeaksFor(from, app.companyName, app.companyDomain)) return null;
  const outcomeKind = kind as (typeof INBOX_OUTCOME_KINDS)[number];
  const [seen] = await db.select({ id: outcomes.id }).from(outcomes).where(and(eq(outcomes.applicationId, app.id), eq(outcomes.kind, OUTCOME_KIND[outcomeKind]))).limit(1);
  if (!seen) await db.insert(outcomes).values({ applicationId: app.id, kind: OUTCOME_KIND[outcomeKind], at });
  return outcomeKind;
}

function wakeFor(a: { applicationId: string | null; kind: InboxKind; code: string | null; link: string | null; trusted: boolean }, outcome: StoredInbound["outcome"]): Wake | null {
  if (!a.applicationId) return null;
  if (a.kind === "verification_code" && (a.code || a.link) && a.trusted) return { applicationId: a.applicationId, reason: "code" };
  if (outcome) return { applicationId: a.applicationId, reason: "outcome" };
  return null;
}

function metaOf(a: Analysis, email: { attachments?: AttachmentMeta[]; provider?: string; spam?: { spam: boolean; reason: string | null } }, classifiedBy: InboxMeta["classifiedBy"]): InboxMeta {
  return {
    ...(email.provider ? { provider: email.provider } : {}),
    ...(email.attachments ? { attachments: email.attachments.slice(0, 20) } : {}),
    ...(email.spam ? { spam: email.spam.spam, spamReason: email.spam.reason } : {}),
    verification: a.kind === "verification_code" ? a.verification : null,
    verificationLink: a.kind === "verification_code" ? a.magicLink : null,
    ambiguous: a.ambiguous, ambiguity: a.ambiguity, classifiedBy, trusted: a.trusted,
    link: { why: a.linkWhy, ambiguous: a.linkAmbiguous },
  };
}

/**
 * Stores one normalised inbound email. Finds the user by recipient address (unknown recipients are dropped, nothing is
 * stored), classifies it with deterministic rules, extracts the code and links, links it to the most likely application,
 * stores it in `inbox_messages` (a repeated Message-ID is stored once), records an outcome, wakes in-process waiters and
 * says what to wake. Fast: no model call; ambiguous results are settled by the `inbox.receive` worker job.
 */
export async function storeInbound(db: Db, email: InboundEmail, opts: { now?: Date; userId?: string } = {}): Promise<ReceiveResult> {
  const now = opts.now ?? new Date();
  // Mail read from the person's own mailbox (connected Gmail) names its owner; mail to an inbox address is resolved.
  const userId = opts.userId ?? await resolveUser(db, email.to);
  if (!userId) return { stored: false, reason: "unknown_recipient" };

  const a = analyse(email, await loadCandidates(db, userId, now), email.spam.spam);
  const meta: InboxMeta = { ...metaOf(a, email, "rules"), ...(email.fromName ? { fromName: email.fromName.slice(0, 200) } : {}) };
  // Arrival time, not the Date header: a code is "fresh" by when it reached us, and headers can be hours off.
  const inserted = await db.insert(inboxMessages).values({
    userId, applicationId: a.app?.id ?? null, kind: a.kind, code: a.code, fromAddress: email.from,
    messageId: email.messageId, links: a.links, subject: email.subject.slice(0, INBOX_SUBJECT_MAX), body: email.text.slice(0, INBOX_BODY_MAX), meta, receivedAt: now,
  }).onConflictDoNothing().returning({ id: inboxMessages.id });

  const row = inserted[0];
  if (!row) {
    const [existing] = email.messageId
      ? await db.select().from(inboxMessages).where(and(eq(inboxMessages.userId, userId), eq(inboxMessages.messageId, email.messageId))).limit(1)
      : [];
    if (!existing) return { stored: false, reason: "unreadable" };
    const m = existing.meta as InboxMeta;
    return {
      stored: true, duplicate: true, messageId: existing.id, userId, applicationId: existing.applicationId, kind: existing.kind, code: existing.code,
      links: existing.links, verificationLink: m.verificationLink ?? null, ambiguous: !!m.ambiguous, spam: !!m.spam, outcome: null, wake: null,
    };
  }
  const outcome = await recordOutcome(db, a.app, a.kind, { address: email.from, name: email.fromName }, now);
  const wake = wakeFor({ applicationId: a.app?.id ?? null, kind: a.kind, code: a.code, link: meta.verificationLink ?? null, trusted: a.trusted }, outcome);
  notifyInbox(userId);
  return {
    stored: true, duplicate: false, messageId: row.id, userId, applicationId: a.app?.id ?? null, kind: a.kind, code: a.code, links: a.links,
    verificationLink: meta.verificationLink ?? null, ambiguous: a.ambiguous, spam: email.spam.spam, outcome, wake,
  };
}

/**
 * Takes one inbound email in any supported shape (raw MIME, Postmark JSON, generic JSON), normalises it and stores it.
 * See `storeInbound`.
 */
export async function receiveInbound(db: Db, payload: InboundPayload, opts: { now?: Date } = {}): Promise<ReceiveResult> {
  let email: InboundEmail;
  try {
    email = await normalizeInbound(payload);
  } catch (err) {
    return { stored: false, reason: err instanceof InboundTooLargeError ? "too_large" : "unreadable" };
  }
  return storeInbound(db, email, opts);
}

export type ReprocessOptions = {
  /** Settles an ambiguous rule result (the small model in the worker). Without it the rules stand. */
  model?: InboxModel;
};

/**
 * Re-reads a stored message (the `inbox.receive` queue job): classifies it again (asking the model when the rules are
 * unsure and a model is given), relinks it (the application may have been created or submitted since the mail arrived),
 * makes sure the outcome is recorded, and says what to wake. Safe to repeat; spam stays spam.
 */
export async function reprocessMessage(db: Db, messageId: string, opts: ReprocessOptions = {}): Promise<ReceiveResult> {
  const [row] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, messageId)).limit(1);
  if (!row) return { stored: false, reason: "unreadable" };
  const prior = (row.meta ?? {}) as InboxMeta;
  const from = parseAddress(row.fromAddress);
  const mail: Mail = { from: from.address || row.fromAddress, fromName: prior.fromName ?? from.name, subject: row.subject, text: row.body };
  const rules = classifyMessage(mail);
  let settled: Classification | undefined;
  let classifiedBy: InboxMeta["classifiedBy"] = "rules";
  if (prior.classifiedBy === "model" || prior.classifiedBy === "fallback") {
    // Already decided once: keep that decision instead of paying for it again.
    settled = { ...rules, kind: row.kind, code: row.code, ambiguous: false, verification: prior.verification ?? null };
    classifiedBy = prior.classifiedBy;
  } else if (rules.ambiguous && opts.model && !prior.spam) {
    const s = await settleAmbiguous(mail, rules, opts.model, { userId: row.userId, db });
    settled = s;
    classifiedBy = s.classifiedBy;
  }
  const a = analyse(mail, await loadCandidates(db, row.userId, new Date()), !!prior.spam, settled);
  // A later look must not lose what the first one found (a link, an application).
  const applicationId = a.app?.id ?? row.applicationId;
  const links = a.links.length ? a.links : row.links;
  const code = classifiedBy === "rules" ? a.code ?? row.code : a.code;
  const app = a.app ?? (applicationId ? (await loadCandidates(db, row.userId, new Date())).find((c) => c.id === applicationId) ?? null : null);
  const trusted = a.trusted || (!!app && !a.app && !!prior.trusted);
  const meta: InboxMeta = { ...prior, ...metaOf({ ...a, trusted, code }, { }, classifiedBy), ...(prior.provider ? { provider: prior.provider } : {}) };
  await db.update(inboxMessages).set({ kind: a.kind, code: a.kind === "verification_code" ? code : null, links, applicationId, meta }).where(eq(inboxMessages.id, messageId));
  const outcome = await recordOutcome(db, app, a.kind, { address: mail.from, name: mail.fromName }, row.receivedAt);
  const finalCode = a.kind === "verification_code" ? code : null;
  notifyInbox(row.userId);
  return {
    stored: true, duplicate: true, messageId, userId: row.userId, applicationId, kind: a.kind, code: finalCode, links,
    verificationLink: meta.verificationLink ?? null, ambiguous: false, spam: !!prior.spam, outcome,
    wake: wakeFor({ applicationId, kind: a.kind, code: finalCode, link: meta.verificationLink ?? null, trusted }, outcome),
  };
}

/** Applications of this user that are waiting on mail (applying or awaiting a code). */
export async function waitingApplications(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: applications.id }).from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.status, ["applying", "awaiting_code"])));
  return rows.map((r) => r.id);
}
