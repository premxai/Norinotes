import type { InboxKind } from "@norinote/shared";

// ---- verification codes ---------------------------------------------------------------------------------------------

/** The mail is about a code: "verification code", "your code is", "paste this code". */
const CODE_CONTEXT = /(verification|security|one[- ]time|confirmation|access|login|log[- ]in|sign[- ]?in|authentication|auth)\s*(code|pin)\b|\byour code\b|\benter (the|this|your) code|\bpaste this code|\bcopy and paste this code|\bpasscode\b|\bone[- ]time (password|passcode)\b|\bOTP\b/i;
/** The mail asks to verify by link rather than by code (Workday, Ashby account mails). */
const LINK_VERIFY_CONTEXT = /(verify|confirm|activate)\s+(your\s+)?(email|e-mail|account|address|registration)|confirm your (application|email)|click (the )?(link|button) below to (verify|confirm|activate)/i;

const looksLikeYear = (d: string) => /^(19|20)\d{2}$/.test(d);
const hasLetterAndDigit = (s: string) => /[A-Za-z]/.test(s) && /\d/.test(s);
const mixedCase = (s: string) => /[a-z]/.test(s) && /[A-Z]/.test(s);

/**
 * The code in a verification mail, or null. Numeric codes of 4 to 8 digits (also written "123 456" or "123-456"), and the
 * 6 to 10 character alphanumeric codes some job systems use (Greenhouse: "Copy and paste this code ...: aB3dE9xK").
 * Digits next to the word "code" win; years and bare numbers elsewhere in the mail are only a last resort, and only
 * when the mail is plainly about a code.
 */
export function extractCode(text: string): string | null {
  const near: RegExp[] = [
    /\b(?:verification|security|one[- ]time|confirmation|access|login|authentication|auth)\s*(?:code|pin)\b[^\d\n]{0,40}?\b(\d{4,8})\b/i,
    /\byour (?:\w+\s+){0,2}code\b[^\d\n]{0,30}?\b(\d{4,8})\b/i,
    /\b(\d{4,8})\b[^\n\d]{0,25}\b(?:is|as)\b[^\n\d]{0,25}\b(?:your|the)\b[^\n\d]{0,25}\bcode\b/i,
    /\bcode\b[^\d\n]{0,40}?\b(\d{4,8})\b/i,
  ];
  for (const re of near) {
    // A year next to the word "code" ("code was sent in 2026") is not a code.
    for (const m of text.matchAll(new RegExp(re.source, re.flags + "g"))) if (m[1] && !looksLikeYear(m[1])) return m[1];
  }
  const split = /\bcode\b[^\d\n]{0,40}?\b(\d{3})[- ](\d{3})\b/i.exec(text);
  if (split) return `${split[1]}${split[2]}`;

  // Alphanumeric: "...this code ...: \n\n aB3dE9xK" or "code: aB3dE9xK" or "code is aB3dE9xK".
  const alnum: RegExp[] = [
    /\bcode\b[^\n]{0,120}?:[ \t]*\n+[ \t]*([A-Za-z0-9]{6,10})[ \t]*(?:\n|$)/i,
    /\bcode\b\s*(?::|is)\s*([A-Za-z0-9]{6,10})\b/i,
  ];
  for (const re of alnum) {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))) {
      const c = m[1] ?? "";
      if (hasLetterAndDigit(c) || (mixedCase(c) && c.length >= 8)) return c;
    }
  }

  // A line that is only digits.
  const lone = /^[ \t]*(\d{4,8})[ \t]*$/m.exec(text);
  if (lone?.[1] && !looksLikeYear(lone[1])) return lone[1];
  const all = [...text.matchAll(/\b\d{4,8}\b/g)].map((m) => m[0]);
  return all.find((d) => !looksLikeYear(d)) ?? null;
}

// ---- links ----------------------------------------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const BORING_LINK = /unsubscribe|opt[-_]?out|privacy|terms|preferences|manage[-_]?(email|subscription)|\.(png|gif|jpe?g|svg|webp|ico)(\?|$)|\/(open|pixel|track|beacon)\b|view[-_]in[-_]browser|mailto:/i;
const MAGIC_LINK = /verify|confirm|activate|magic|token=|\/auth|login|signin|sign-in|reset|validate|\/c\/|click/i;

/** Links in a message, magic and verification links first, de-duplicated, at most 10. Unsubscribe and image links are dropped. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (BORING_LINK.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  const magic = links.filter((l) => MAGIC_LINK.test(l));
  return [...magic, ...links.filter((l) => !MAGIC_LINK.test(l))].slice(0, 10);
}

/** The verification or confirmation link in a link-verified mail, if one is present. */
export function magicLink(links: readonly string[]): string | null {
  return links.find((l) => /verify|confirm|activate|validate|token=/i.test(l)) ?? null;
}

// ---- kind -----------------------------------------------------------------------------------------------------------

const OFFER = /\boffer letter\b|\bpleased to offer\b|\bexcited to offer\b|\boffer of employment\b|\bformal offer\b|\bextend(ing)? (you )?an offer\b/i;
const REJECTION = /\bunfortunately\b|\bnot moving forward\b|\bother candidates\b|\bdecided not to\b|\bwill not be (moving|proceeding)\b|\bnot be proceeding\b|\bregret to inform\b|\bposition has been filled\b|\bnot selected\b|\bnot to move forward\b/i;
const INTERVIEW = /\b(invite|invited|like) (you )?to (an? |the )?(interview|chat|call|phone screen)\b|\bschedule (a|an|your|the) (\w+ )?(call|interview|chat|conversation|screen)\b|\binterview (invitation|invite|availability|slots?|times?)\b|\byour availability\b|\bbook (a|your) (time|slot)\b|calendly\.com|goodtime\.io|\bphone screen\b/i;
const CONFIRMATION = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (applied|submitted)/i;
const CONFIRMATION_SUBJECT = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted)|we('ve| have) received your application|application confirmation|your application (to|for|with)\b/i;
const NOREPLY = /no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?@|mailer-daemon|automated@|donotreply/i;
const RECRUITER_HINT = /\b(role|position|opportunity|recruiter|recruiting|talent|hiring|candidate|team)\b/i;

export type Classification = { kind: InboxKind; code: string | null; links: string[]; magicLink: string | null };

/**
 * Deterministic classification of one message: a verification code (or a verify-by-link mail), an offer, a rejection, an
 * interview invitation, an automatic confirmation, a human reply, or other. No model is involved.
 */
export function classifyMessage(email: { from: string; subject: string; text: string }): Classification {
  const hay = `${email.subject}\n${email.text}`;
  const links = extractLinks(email.text);
  const base = { links, magicLink: magicLink(links) };

  if (CODE_CONTEXT.test(hay)) {
    const code = extractCode(hay);
    if (code) return { kind: "verification_code", code, ...base };
  }
  if (LINK_VERIFY_CONTEXT.test(hay) && base.magicLink && !CONFIRMATION_SUBJECT.test(email.subject)) return { kind: "verification_code", code: null, ...base };

  const kind: InboxKind =
    OFFER.test(hay) ? "offer"
    : REJECTION.test(hay) ? "rejection"
    // "Thank you for applying" mails often promise an interview later: the subject decides before the body can.
    : CONFIRMATION_SUBJECT.test(email.subject) ? "confirmation"
    : INTERVIEW.test(hay) ? "interview"
    : CONFIRMATION.test(hay) ? "confirmation"
    : !NOREPLY.test(email.from) && RECRUITER_HINT.test(hay) ? "recruiter_reply"
    : "other";
  return { kind, code: null, ...base };
}
