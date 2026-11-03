import { z } from "zod";
import { AiUnavailableError, BudgetExceededError, complete } from "@norinote/ai";
import type { Db } from "@norinote/db";
import { INBOX_KINDS } from "@norinote/shared";
import type { Classification } from "./classify.js";
import { findCodes } from "./codes.js";

const ModelVerdict = z.object({
  kind: z.enum(INBOX_KINDS),
  /** The code exactly as written in the mail, or null. */
  code: z.string().nullable(),
});

const SYSTEM = `You sort one email that arrived in a job seeker's application inbox.
Kinds: verification_code (the mail carries a one-time code or a link to verify an email address or account for a job application),
confirmation (automatic "we received your application"), recruiter_reply (a person at the company writes about the application),
interview (an invitation to interview or to pick a time), rejection, offer, other (newsletters, receipts, marketing, anything else).
For verification_code, copy the code exactly as it appears in the mail; never invent one. Order numbers, dates, phone numbers,
zip codes, prices and years are never codes. If no code is present, code is null.`;

/** A model that settles an ambiguous classification. Injected so tests and offline runs never reach a provider. */
export type InboxModel = (email: { from: string; subject: string; text: string }, rules: Classification, opts: { userId?: string; db?: Db }) => Promise<{ kind: Classification["kind"]; code: string | null }>;

/** The small model (`AI_SMALL_MODEL`, gpt-4.1-mini by default) through @norinote/ai, charged to the user's budget. */
export const smallModel: InboxModel = async (email, rules, opts) => {
  // Without a key @norinote/ai answers with its deterministic fake, which must never decide a real message.
  const testing = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  if (!testing && !process.env.OPENAI_API_KEY?.trim()) throw new AiUnavailableError("auth", null, 0, "OPENAI_API_KEY is not set");
  const { output } = await complete({
    tier: "small", system: SYSTEM, schema: ModelVerdict, schemaName: "inbox_verdict", strict: true, temperature: 0, maxOutputTokens: 60,
    input: `Rules said: ${rules.kind}${rules.ambiguity ? ` (unsure: ${rules.ambiguity})` : ""}\nFrom: ${email.from}\nSubject: ${email.subject}\n\n${email.text.slice(0, 4000)}`,
    ...(opts.userId && opts.db ? { userId: opts.userId, db: opts.db } : {}),
  });
  return output;
};

/**
 * Settles an ambiguous rule result with the model. Unambiguous results pass through untouched (no call). A code the model
 * names must appear in the mail and be one of the rule candidates' shape, so a model cannot make one up. When the AI
 * service is unavailable or the budget is spent, the message becomes `other` with no code, so a guess is never typed
 * into a form; the message is still stored and shown.
 */
export async function settleAmbiguous(
  email: { from: string; subject: string; text: string }, rules: Classification, model: InboxModel, opts: { userId?: string; db?: Db } = {},
): Promise<Classification & { classifiedBy: "rules" | "model" | "fallback" }> {
  if (!rules.ambiguous) return { ...rules, classifiedBy: "rules" };
  try {
    const v = await model(email, rules, opts);
    const hay = `${email.subject}\n${email.text}`;
    const code = v.kind === "verification_code" && v.code && hay.includes(v.code.trim()) && /^[A-Za-z0-9]{4,10}$/.test(v.code.trim().replace(/[ -]/g, ""))
      ? v.code.trim().replace(/[ -]/g, "")
      : null;
    // The model may only pick a code the rules also saw as a candidate.
    const allowed = new Set(findCodes(hay).candidates.map((c) => c.code));
    const safeCode = code && (allowed.size === 0 || allowed.has(code)) ? code : null;
    const kind = v.kind === "verification_code" && !safeCode && !rules.magicLink ? "other" : v.kind;
    return {
      ...rules, kind, code: kind === "verification_code" ? safeCode : null,
      verification: kind === "verification_code" ? (safeCode ? "code" : "link") : null, ambiguous: false, classifiedBy: "model",
    };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof BudgetExceededError) {
      return { ...rules, kind: "other", code: null, verification: null, classifiedBy: "fallback" };
    }
    throw err;
  }
}
