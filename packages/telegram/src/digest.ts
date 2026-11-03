import { and, applications, channelMessages, companies, desc, eq, gte, isNull, jobs, shortlist, sql, type Db } from "@norinote/db";
import type { InlineButton, InlineKeyboard } from "./client.js";
import { clip, esc, fitBand, MAX_TEXT } from "./format.js";
import { packId, signCallback } from "./signing.js";

export type DigestItem = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  fit: number;
  band: string;
  /** The one-line "why this fits". */
  why: string | null;
};

/** Reasons the matcher adds for its own bookkeeping, not for people. */
const internalReason = (r: string) => r.startsWith("widened:");
const normTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const roleKey = (company: string, title: string) => `${company.toLowerCase().trim()}|${normTitle(title)}`;

/** Days a job, once sent in a daily shortlist, is not sent again. */
const RESEND_AFTER_DAYS = 60;

/**
 * The top `count` new shortlist rows for the daily message: status new, job open, company not blocked, no application yet,
 * never sent in an earlier daily message. Same order as the web shortlist (lane matches before widened rows, then best fit),
 * and one entry per company and role.
 */
export async function selectDigest(db: Db, userId: string, count: number, now: Date): Promise<DigestItem[]> {
  const earlier = await db.select({ payload: channelMessages.payload }).from(channelMessages)
    .where(and(eq(channelMessages.userId, userId), eq(channelMessages.kind, "digest"), gte(channelMessages.createdAt, new Date(now.getTime() - RESEND_AFTER_DAYS * 86_400_000))));
  const sent = new Set(earlier.flatMap((r) => (Array.isArray(r.payload.jobIds) ? (r.payload.jobIds as string[]) : [])));

  const rows = await db.select({
    jobId: shortlist.jobId, fit: shortlist.fit, reasons: shortlist.reasons, title: jobs.title, location: jobs.location, remote: jobs.remote, company: companies.name,
  }).from(shortlist)
    .innerJoin(jobs, eq(jobs.id, shortlist.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(applications, and(eq(applications.userId, shortlist.userId), eq(applications.jobId, shortlist.jobId)))
    .where(and(eq(shortlist.userId, userId), eq(shortlist.status, "new"), isNull(jobs.closedAt), eq(companies.blocked, false), isNull(applications.id)))
    .orderBy(sql`(EXISTS (SELECT 1 FROM unnest(${shortlist.reasons}) AS r WHERE r LIKE 'widened:%')) asc`, desc(shortlist.fit), desc(shortlist.createdAt))
    .limit(Math.max(40, count * 8));

  const seen = new Set<string>();
  const out: DigestItem[] = [];
  for (const r of rows) {
    const key = roleKey(r.company, r.title);
    if (seen.has(key)) continue;
    seen.add(key);
    if (sent.has(r.jobId)) continue;
    out.push({
      jobId: r.jobId, title: r.title, company: r.company, location: r.location, remote: r.remote, fit: r.fit, band: fitBand(r.fit),
      why: r.reasons.find((x) => !internalReason(x) && x.trim() !== "") ?? null,
    });
    if (out.length >= count) break;
  }
  return out;
}

export const jobLink = (webUrl: string, jobId: string) => `${webUrl}/jobs?job=${jobId}`;

export function digestText(items: DigestItem[]): string {
  const lines = [`<b>Your shortlist for today</b> (${items.length} new)`, ""];
  items.forEach((it, i) => {
    const where = [it.location, it.remote && !/remote/i.test(it.location ?? "") ? "Remote" : null].filter(Boolean).join(" · ");
    lines.push(`${i + 1}. <b>${esc(clip(it.title, 90))}</b> at ${esc(clip(it.company, 60))}`);
    lines.push(`${where ? `${esc(clip(where, 80))} · ` : ""}${it.band}`);
    if (it.why) lines.push(`<i>${esc(clip(it.why, 160))}</i>`);
    lines.push("");
  });
  lines.push("Apply sends it with your prepared resume and answers. Skip hides the job.");
  return lines.join("\n").slice(0, MAX_TEXT);
}

/** Buttons for the jobs not yet applied to or skipped: one row per job. */
export function digestKeyboard(items: DigestItem[], handled: readonly string[], o: { secret: string; userId: string; webUrl: string }): InlineKeyboard {
  const rows: InlineButton[][] = [];
  items.forEach((it, i) => {
    if (handled.includes(it.jobId)) return;
    const id = packId(it.jobId);
    rows.push([
      { text: `Apply ${i + 1}`, callback_data: signCallback(o.secret, o.userId, "a", [id]) },
      { text: `Skip ${i + 1}`, callback_data: signCallback(o.secret, o.userId, "s", [id]) },
      { text: `Details ${i + 1}`, url: jobLink(o.webUrl, it.jobId) },
    ]);
  });
  return { inline_keyboard: rows };
}
