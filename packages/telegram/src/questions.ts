import { createHash } from "node:crypto";
import { and, applications, channelMessages, eq, gte, type Db } from "@norinote/db";
import { LEGAL_SLOTS, classifySlot, pendingDigest } from "@norinote/answers";
import { PendingQuestion, TERMINAL_APPLICATION_STATUSES } from "@norinote/shared";
import type { InlineButton, InlineKeyboard } from "./client.js";
import { clip, esc, MAX_TEXT, plural } from "./format.js";
import { signCallback } from "./signing.js";

/** One question as the message shows it, and every application question an answer to it is written to. */
export type QuestionGroup = {
  text: string;
  type: PendingQuestion["type"];
  /** Buttons to show. For legal questions only the question's own options, never ones we made up. */
  options: string[];
  /** `choice`: tap an option. `text`: reply with text. `app`: answer in the web app (files, multi-select, long lists). */
  mode: "choice" | "text" | "app";
  legal: boolean;
  required: boolean;
  targets: { applicationId: string; questionId: string }[];
  examples: string[];
};

export type QuestionsPayload = { groups: QuestionGroup[]; answered: number[]; summary: string; approved: boolean };

const MAX_GROUPS = 8;
const MAX_OPTIONS = 10;

/** Questions on work authorisation, sponsorship, salary and the other legal slots of @norinote/answers. */
export function isLegalQuestion(q: { text: string; type: string; options: string[] }): boolean {
  const type = (["text", "textarea", "select", "multiselect", "boolean", "file"].includes(q.type) ? q.type : "text") as "text";
  return LEGAL_SLOTS.has(classifySlot({ key: "", label: q.text, type, required: true, options: q.options }));
}

function modeFor(type: PendingQuestion["type"], options: string[], legal: boolean): { mode: QuestionGroup["mode"]; options: string[] } {
  if (type === "file" || type === "multiselect") return { mode: "app", options: [] };
  if (options.length > MAX_OPTIONS) return { mode: "app", options: [] };
  if (options.length > 0) return { mode: "choice", options };
  // A yes/no box with no option labels: Yes/No are the form's own answers, except on a legal question, where nothing is
  // offered that the form did not list; the person types their answer.
  if (type === "boolean" && !legal) return { mode: "choice", options: ["Yes", "No"] };
  return { mode: "text", options: [] };
}

type Open = { applicationId: string; questionId: string; approved: boolean };

/** Unanswered pending questions of the user's open applications (cheap: no model, no embeddings). */
export async function openQuestions(db: Db, userId: string, since: Date): Promise<Open[]> {
  const rows = await db.select({ id: applications.id, status: applications.status, pending: applications.pendingQuestions, answers: applications.answers, approvedAt: applications.approvedAt })
    .from(applications).where(and(eq(applications.userId, userId), eq(applications.status, "needs_user"), gte(applications.updatedAt, since)));
  const out: Open[] = [];
  for (const r of rows) {
    if (TERMINAL_APPLICATION_STATUSES.includes(r.status)) continue;
    for (const raw of r.pending) {
      const q = PendingQuestion.safeParse(raw);
      if (!q.success) continue;
      if ((r.answers[q.data.id] ?? r.answers[q.data.text] ?? "").trim() !== "") continue;
      out.push({ applicationId: r.id, questionId: q.data.id, approved: !!r.approvedAt });
    }
  }
  return out;
}

/**
 * Application questions already asked in a questions message (last 30 days). They are not asked again when the set of open
 * questions changes, e.g. after one of several is answered: the earlier message still has their buttons.
 */
export async function askedQuestions(db: Db, userId: string, now: Date): Promise<Set<string>> {
  const rows = await db.select({ payload: channelMessages.payload }).from(channelMessages)
    .where(and(eq(channelMessages.userId, userId), eq(channelMessages.kind, "questions"), gte(channelMessages.createdAt, new Date(now.getTime() - 30 * 86_400_000))));
  const out = new Set<string>();
  for (const r of rows) {
    const groups = Array.isArray(r.payload.groups) ? (r.payload.groups as QuestionGroup[]) : [];
    for (const g of groups) for (const t of g.targets ?? []) out.add(`${t.applicationId}:${t.questionId}`);
  }
  return out;
}

/** Stable key of a set of open questions: a new message goes out only when the set changes. */
export const questionsKey = (open: Open[]) =>
  createHash("sha1").update(open.map((o) => `${o.applicationId}:${o.questionId}`).sort().join("|")).digest("hex").slice(0, 16);

/**
 * The open questions batched by @norinote/answers (`pendingDigest`: same question across applications asked once), with
 * answered ones left out. Null when nothing is open.
 */
export async function buildQuestions(db: Db, userId: string, open: Open[]): Promise<QuestionsPayload | null> {
  if (open.length === 0) return null;
  const openSet = new Set(open.map((o) => `${o.applicationId}:${o.questionId}`));
  const digest = await pendingDigest(db, userId);
  const groups: QuestionGroup[] = [];
  for (const g of digest.groups) {
    const targets = g.questions.filter((t) => openSet.has(`${t.applicationId}:${t.questionId}`));
    if (targets.length === 0) continue;
    const legal = isLegalQuestion({ text: g.question, type: g.type, options: g.options });
    const { mode, options } = modeFor(g.type, g.options, legal);
    groups.push({ text: g.question, type: g.type, options, mode, legal, required: g.required, targets, examples: g.examples });
    if (groups.length >= MAX_GROUPS) break;
  }
  if (groups.length === 0) return null;
  const apps = new Set(groups.flatMap((g) => g.targets.map((t) => t.applicationId)));
  const approvedApps = new Set(open.filter((o) => o.approved).map((o) => o.applicationId));
  return {
    groups, answered: [],
    summary: `${plural(groups.length, "question")} ${groups.length === 1 ? "blocks" : "block"} ${plural(apps.size, "application")}`,
    approved: [...apps].some((a) => approvedApps.has(a)),
  };
}

export function questionsText(p: QuestionsPayload, webUrl: string): string {
  const lines = [`<b>${esc(p.summary)}</b>`, ""];
  p.groups.forEach((g, i) => {
    lines.push(`${i + 1}. ${esc(clip(g.text, 300))}${g.required ? "" : " (optional)"}`);
    if (g.examples.length) lines.push(`<i>${esc(clip(g.examples.join("; "), 140))}</i>`);
    if (g.mode === "text") lines.push("Reply to this message to answer, or tap Type answer.");
    if (g.mode === "app") lines.push(`Answer in the app: ${esc(`${webUrl}/applications/${g.targets[0]!.applicationId}`)}`);
    lines.push("");
  });
  lines.push("Your answers are saved for next time, as in the app.");
  return lines.join("\n").slice(0, MAX_TEXT);
}

/** Buttons for the groups not answered yet. Option buttons carry the group and option index; the payload has the values. */
export function questionsKeyboard(p: QuestionsPayload, o: { secret: string; userId: string; messageId: string; webUrl: string }): InlineKeyboard {
  const rows: InlineButton[][] = [];
  p.groups.forEach((g, gi) => {
    if (p.answered.includes(gi)) return;
    if (g.mode === "choice") {
      let row: InlineButton[] = [];
      g.options.forEach((opt, oi) => {
        row.push({ text: `${gi + 1}: ${clip(opt, 40)}`, callback_data: signCallback(o.secret, o.userId, "c", [o.messageId, gi, oi]) });
        if (row.length === 2) { rows.push(row); row = []; }
      });
      if (row.length) rows.push(row);
    } else if (g.mode === "text") {
      rows.push([{ text: `Type answer ${gi + 1}`, callback_data: signCallback(o.secret, o.userId, "t", [o.messageId, gi]) }]);
    } else {
      rows.push([{ text: `Answer ${gi + 1} in the app`, url: `${o.webUrl}/applications/${g.targets[0]!.applicationId}` }]);
    }
  });
  return { inline_keyboard: rows };
}

/** The first group answered by replying with text (a reply to the questions message itself). */
export const firstTextGroup = (p: QuestionsPayload): number => p.groups.findIndex((g, i) => g.mode === "text" && !p.answered.includes(i));
