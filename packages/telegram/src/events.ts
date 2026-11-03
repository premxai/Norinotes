import { and, applications, companies, eq, gte, inArray, inboxMessages, jobs, shortlist, sql, type Db } from "@norinote/db";
import type { InlineKeyboard } from "./client.js";
import { clip, esc, plural } from "./format.js";
import type { MessagePayload } from "./outbox.js";

/** A message to queue: what `queueMessage` needs besides the user and the settings. */
export type EventMessage = { kind: "submitted" | "needs_user" | "inbox" | "summary"; dedupeKey: string; applicationId: string | null; payload: MessagePayload; urgent: boolean };

const appLink = (webUrl: string, id: string) => `${webUrl}/applications/${id}`;
const button = (text: string, url: string): InlineKeyboard => ({ inline_keyboard: [[{ text, url }]] });
const shortHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

async function appRows(db: Db, userId: string, status: "submitted" | "needs_user", since: Date) {
  const col = status === "submitted" ? applications.submittedAt : applications.updatedAt;
  return db.select({ app: applications, title: jobs.title, company: companies.name, applyUrl: jobs.applyUrl })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), eq(applications.status, status), gte(col, since))).limit(50);
}

/** Applications submitted since `since`: the job and a link to the receipt. */
export async function submittedEvents(db: Db, userId: string, since: Date, webUrl: string): Promise<EventMessage[]> {
  return (await appRows(db, userId, "submitted", since)).map(({ app, title, company }) => {
    const confirmation = typeof app.receipt?.confirmationText === "string" ? app.receipt.confirmationText : null;
    const text = [
      `<b>Submitted</b>: ${esc(clip(title, 90))} at ${esc(clip(company, 60))}`,
      confirmation ? `The site said: <i>${esc(clip(confirmation, 200))}</i>` : "The receipt has the form as it was sent.",
    ].join("\n");
    return { kind: "submitted", dedupeKey: `submitted:${app.id}`, applicationId: app.id, payload: { text, keyboard: button("Receipt", appLink(webUrl, app.id)) }, urgent: false };
  });
}

/**
 * Applications parked for something only the person can do (a captcha, an emailed code that did not arrive, a Workday
 * account), with a link to finish. Parked on questions is the questions message instead.
 */
export async function needsUserEvents(db: Db, userId: string, since: Date, webUrl: string): Promise<EventMessage[]> {
  const out: EventMessage[] = [];
  for (const { app, title, company, applyUrl } of await appRows(db, userId, "needs_user", since)) {
    if (app.pendingQuestions.length > 0) continue;
    const reason = app.error ?? "Norinote needs you to finish this application.";
    const text = [`<b>Needs you</b>: ${esc(clip(title, 90))} at ${esc(clip(company, 60))}`, esc(clip(reason, 400))].join("\n");
    out.push({
      kind: "needs_user", dedupeKey: `needs_user:${app.id}:${app.attempts}:${shortHash(reason)}`, applicationId: app.id,
      payload: { text, keyboard: { inline_keyboard: [[{ text: "Finish in Norinote", url: appLink(webUrl, app.id) }, { text: "Open the posting", url: applyUrl }]] } },
      urgent: !!app.approvedAt,
    });
  }
  return out;
}

const INBOX_KINDS = ["interview", "recruiter_reply", "offer"] as const;
const INBOX_LABEL: Record<(typeof INBOX_KINDS)[number], string> = { interview: "Interview invite", recruiter_reply: "Recruiter reply", offer: "Offer" };

/** Interview invitations, recruiter replies and offers that reached the owned inbox since `since` (never spam). */
export async function inboxEvents(db: Db, userId: string, since: Date, webUrl: string): Promise<EventMessage[]> {
  const rows = await db.select({ m: inboxMessages, title: jobs.title, company: companies.name }).from(inboxMessages)
    .leftJoin(applications, eq(applications.id, inboxMessages.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(inboxMessages.userId, userId), inArray(inboxMessages.kind, [...INBOX_KINDS]), gte(inboxMessages.receivedAt, since))).limit(50);
  const out: EventMessage[] = [];
  for (const { m, title, company } of rows) {
    if (m.meta.spam === true) continue;
    const name = typeof m.meta.fromName === "string" && m.meta.fromName.trim() ? `${m.meta.fromName.trim()} <${m.fromAddress}>` : m.fromAddress;
    const lines = [
      `<b>${INBOX_LABEL[m.kind as (typeof INBOX_KINDS)[number]]}</b>${title && company ? ` about ${esc(clip(title, 80))} at ${esc(clip(company, 60))}` : ""}`,
      `From: ${esc(clip(name, 120))}`,
      `Subject: ${esc(clip(m.subject || "(no subject)", 160))}`,
    ];
    const snippet = clip(m.body, 220);
    if (snippet) lines.push(`<i>${esc(snippet)}</i>`);
    out.push({ kind: "inbox", dedupeKey: `inbox:${m.id}`, applicationId: m.applicationId, payload: { text: lines.join("\n"), keyboard: button("Open in Norinote", `${webUrl}/inbox`) }, urgent: false });
  }
  return out;
}

/** One line about the day (local day start to now); null when nothing happened. */
export async function summaryEvent(db: Db, userId: string, dayStart: Date, date: string, webUrl: string): Promise<EventMessage | null> {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const [submitted, waiting, replies, found] = await Promise.all([
    count(db.select({ n }).from(applications).where(and(eq(applications.userId, userId), eq(applications.status, "submitted"), gte(applications.submittedAt, dayStart)))),
    count(db.select({ n }).from(applications).where(and(eq(applications.userId, userId), eq(applications.status, "needs_user")))),
    count(db.select({ n }).from(inboxMessages).where(and(eq(inboxMessages.userId, userId), inArray(inboxMessages.kind, [...INBOX_KINDS]), gte(inboxMessages.receivedAt, dayStart)))),
    count(db.select({ n }).from(shortlist).where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), gte(shortlist.createdAt, dayStart)))),
  ]);
  if (submitted + replies + found === 0 && waiting === 0) return null;
  const parts = [
    submitted ? `${plural(submitted, "application")} submitted` : null,
    replies ? `${plural(replies, "reply", "replies")} from employers` : null,
    found ? `${plural(found, "new match", "new matches")}` : null,
    waiting ? `${plural(waiting, "application")} waiting on you` : null,
  ].filter(Boolean);
  return {
    kind: "summary", dedupeKey: `summary:${date}`, applicationId: null, urgent: false,
    payload: { text: `<b>Today</b>: ${esc(parts.join(", "))}.`, keyboard: button("Open Norinote", `${webUrl}/dashboard`) },
  };
}
