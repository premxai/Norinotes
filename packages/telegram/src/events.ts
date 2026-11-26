import { and, applications, companies, eq, gte, inArray, inboxMessages, isNull, jobs, runEvents, shortlist, sql, type Db } from "@norinote/db";
import { STRONG_FIT_STEP } from "@norinote/apply";
import type { InlineKeyboard } from "./client.js";
import { jobLink } from "./digest.js";
import { clip, esc, plural } from "./format.js";
import type { MessagePayload } from "./outbox.js";
import { packId, signCallback } from "./signing.js";

/** A message to queue: what `queueMessage` needs besides the user and the settings. */
export type EventMessage = { kind: "submitted" | "needs_user" | "inbox" | "summary" | "strong_fit"; dedupeKey: string; applicationId: string | null; payload: MessagePayload; urgent: boolean };

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

/**
 * Applications with one step left (status ready_to_finish): filled, stopped at a captcha or a sign-in only the person can
 * do. One message for all of them, "3 applications need one tap", sent again only when a new one joins the set. Urgent
 * when any of them was approved, like the other walls.
 */
export async function finishEvents(db: Db, userId: string, since: Date, webUrl: string): Promise<EventMessage[]> {
  const rows = await db.select({ app: applications, title: jobs.title, company: companies.name })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), eq(applications.status, "ready_to_finish"))).limit(50);
  if (!rows.some(({ app }) => app.updatedAt >= since)) return [];
  const n = rows.length;
  const list = rows.slice(0, 5).map(({ title, company }) => `• ${esc(clip(title, 70))} at ${esc(clip(company, 50))}`);
  if (n > 5) list.push(`and ${n - 5} more`);
  const text = [
    `<b>${plural(n, "application")} need${n === 1 ? "s" : ""} one tap</b>`,
    `Nori filled ${n === 1 ? "it" : "them"}, and the site wants a captcha or a sign-in only you can do. Press Finish, do that step in Nori's live view, and Nori sends ${n === 1 ? "it" : "them"}.`,
    ...list,
  ].join("\n");
  const ids = rows.map(({ app }) => app.id).sort().join(",");
  return [{
    kind: "needs_user", dedupeKey: `finish:${shortHash(ids)}`, applicationId: n === 1 ? rows[0]!.app.id : null, urgent: rows.some(({ app }) => !!app.approvedAt),
    payload: { text, keyboard: button("Finish in Norinote", n === 1 ? appLink(webUrl, rows[0]!.app.id) : `${webUrl}/applications?show=in-progress`) },
  }];
}

/**
 * Applications waiting on the page for the code the employer just emailed the person: type it in Norinote before the
 * wait runs out. Urgent, once per wait.
 */
export async function codeNeededEvents(db: Db, userId: string, since: Date, webUrl: string): Promise<EventMessage[]> {
  const rows = await db.select({ app: applications, title: jobs.title, company: companies.name })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), eq(applications.status, "awaiting_code"), gte(applications.updatedAt, since))).limit(20);
  return rows.map(({ app, title, company }) => ({
    kind: "needs_user", dedupeKey: `code:${app.id}:${app.attempts}:${app.updatedAt.getTime()}`, applicationId: app.id, urgent: true,
    payload: {
      text: [`<b>Type your code</b>: ${esc(clip(title, 90))} at ${esc(clip(company, 60))}`, "The employer just emailed you a verification code. Type it in Norinote in the next few minutes and Nori finishes the application."].join("\n"),
      keyboard: button("Type the code", appLink(webUrl, app.id)),
    },
  }));
}

/**
 * New strong fits Nori prepared ahead (run event `strong_fit`) since `since`, still waiting for the person's OK: one
 * message each, with Apply (sends it now, within today's limit), Skip and Details. Not urgent, so quiet hours hold it.
 */
export async function strongFitEvents(db: Db, userId: string, since: Date, o: { webUrl: string; secret: string }): Promise<EventMessage[]> {
  const rows = await db.select({ app: applications, title: jobs.title, company: companies.name, location: jobs.location, remote: jobs.remote, fit: shortlist.fit, reasons: shortlist.reasons })
    .from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(shortlist, and(eq(shortlist.userId, applications.userId), eq(shortlist.jobId, applications.jobId)))
    .where(and(
      eq(applications.userId, userId), eq(applications.status, "prepared"), isNull(applications.approvedAt), gte(applications.preparedAt, since),
      sql`exists (select 1 from ${runEvents} where ${runEvents.applicationId} = ${applications.id} and ${runEvents.step} = ${STRONG_FIT_STEP})`,
    )).limit(20);
  return rows.map(({ app, title, company, location, remote, fit, reasons }) => {
    const where = [location, remote && !/remote/i.test(location ?? "") ? "Remote" : null].filter(Boolean).join(" · ");
    const why = (reasons ?? []).find((r) => !r.startsWith("widened:") && r.trim() !== "");
    const text = [
      `<b>Strong fit</b>: ${esc(clip(title, 90))} at ${esc(clip(company, 60))}`,
      [where ? esc(clip(where, 80)) : null, fit != null ? `${Math.round(fit * 100)}% fit` : null].filter(Boolean).join(" · "),
      ...(why ? [`<i>${esc(clip(why, 160))}</i>`] : []),
      "Nori has your resume and answers ready. Apply sends it now; early applicants hear back more often.",
    ].filter((l) => l !== "").join("\n");
    const id = packId(app.jobId);
    const keyboard: InlineKeyboard = { inline_keyboard: [[
      { text: "Apply", callback_data: signCallback(o.secret, userId, "a", [id]) },
      { text: "Skip", callback_data: signCallback(o.secret, userId, "s", [id]) },
      { text: "Details", url: jobLink(o.webUrl, app.jobId) },
    ]] };
    return { kind: "strong_fit", dedupeKey: `strong_fit:${app.id}`, applicationId: app.id, payload: { text, keyboard }, urgent: false };
  });
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
    count(db.select({ n }).from(applications).where(and(eq(applications.userId, userId), inArray(applications.status, ["needs_user", "ready_to_finish"])))),
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
    payload: { text: `<b>Today</b>: ${esc(parts.join(", "))}.`, keyboard: button("Open Norinote", `${webUrl}/today`) },
  };
}
