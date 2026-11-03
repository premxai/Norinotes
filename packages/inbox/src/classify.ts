import type { InboxKind } from "@norinote/shared";
import { CODE_CONTEXT, findCodes } from "./codes.js";
import { stripTrackingParams } from "./text.js";

export { extractCode, findCodes } from "./codes.js";
export type { CodeCandidate, CodeResult } from "./codes.js";

// ---- links ----------------------------------------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const BORING_LINK = /unsubscribe|opt[-_]?out|privacy|terms|preferences|manage[-_]?(email|subscription)|\.(png|gif|jpe?g|svg|webp|ico)(\?|$)|\/(open|pixel|track|beacon)\b|view[-_]in[-_]browser|mailto:/i;
const MAGIC_LINK = /verify|confirm|activate|magic|token=|\/auth|login|signin|sign-in|reset|validate|\/c\/|click/i;

/** Links in a message, magic and verification links first, de-duplicated, at most 10. Unsubscribe, image and tracking links are dropped. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = stripTrackingParams(m[0].replace(/[.,;:!?]+$/, ""));
    if (BORING_LINK.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  const magic = links.filter((l) => MAGIC_LINK.test(l));
  return [...magic, ...links.filter((l) => !MAGIC_LINK.test(l))].slice(0, 10);
}

/** The verification or confirmation link in a link-verified mail, if one is present. */
export function magicLink(links: readonly string[]): string | null {
  return links.find((l) => /verify|verification|confirm|activate|validate|token=|magic/i.test(l)) ?? null;
}

// ---- kind -----------------------------------------------------------------------------------------------------------

/** The mail asks to verify by link rather than by code (Workday, iCIMS, SmartRecruiters account mails). */
const LINK_VERIFY_CONTEXT = /(verify|confirm|activate|validate)\s+(your\s+)?(email|e-mail|account|address|registration|candidate (account|profile))|confirm your (application|email)|click (on )?(the )?(link|button) below to (verify|confirm|activate|complete)|(complete|finish) (your )?(registration|account (setup|creation))/i;
const OFFER = /\boffer letter\b|\bpleased to offer\b|\bexcited to offer\b|\boffer of employment\b|\bformal offer\b|\bextend(ing)? (you )?an offer\b/i;
const REJECTION = /\bunfortunately\b|\bnot moving forward\b|\bother candidates\b|\bdecided not to\b|\bwill not be (moving|proceeding)\b|\bnot be proceeding\b|\bregret to inform\b|\bposition has been filled\b|\bnot selected\b|\bnot to move forward\b|\bpursue other (candidates|applicants)\b|\bno longer under consideration\b/i;
const INTERVIEW = /\b(invite|invited|like) (you )?to (an? |the )?(interview|chat|call|phone screen|conversation)\b|\bschedule (a|an|your|the) (\w+ )?(call|interview|chat|conversation|screen)\b|\binterview (invitation|invite|availability|slots?|times?|request)\b|\byour availability\b|\bbook (a|your) (time|slot)\b|calendly\.com|goodtime\.io|cal\.com\/|savvycal\.com|\bphone screen\b|\bnext steps?\b[^\n]{0,40}\binterview/i;
const CONFIRMATION = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (applied|submitted)|your application (is|has been) (complete|received|submitted)/i;
const CONFIRMATION_SUBJECT = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted)|we('ve| have) received your application|application confirmation|your application (to|for|with)\b|application received/i;
const NOREPLY = /no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?@|mailer-daemon|automated@|donotreply|newsletter|news@|marketing@|hello@|info@|updates?@/i;
const RECRUITER_HINT = /\b(role|position|opportunity|recruiter|recruiting|talent|hiring|candidate|your (application|background|resume|profile))\b/i;
/** Bulk mail: a newsletter, a digest, a receipt. None of these are about an application. */
/** Footer of any mass mailing; transactional job-system mail has it too, so it only counts when nothing else speaks. */
const BULK_FOOTER = /\bunsubscribe\b|\bview (it )?in (your )?browser\b|\bemail preferences\b/i;
const BULK = /\bissue \d+\b|\bnewsletter\b|\bdigest\b|\border (confirmation|#|number)\b|\breceipt\b|\binvoice\b|\bshipped\b|\btracking number\b/i;

export type Classification = {
  kind: InboxKind;
  code: string | null;
  links: string[];
  magicLink: string | null;
  /** How the mail wants to be verified, when it is a verification mail. Stored as kind `verification_code` either way. */
  verification: "code" | "link" | null;
  /** The rules saw more than one reading (two codes, or a code word without a clear code, or rejection and interview at once). */
  ambiguous: boolean;
  /** Why it was ambiguous, for logs and the model prompt. */
  ambiguity: string | null;
};

type Mail = { from: string; subject: string; text: string };

/**
 * Deterministic classification of one message: a verification code (or a verify-by-link mail), an offer, a rejection, an
 * interview invitation, an automatic confirmation, a human reply, or other. No model is involved; `ambiguous` says when
 * a model could do better.
 */
export function classifyMessage(email: Mail): Classification {
  const hay = `${email.subject}\n${email.text}`;
  const links = extractLinks(email.text);
  const link = magicLink(links);
  const base = { links, magicLink: link };
  const bulk = (BULK.test(hay) && !CODE_CONTEXT.test(email.subject) && !LINK_VERIFY_CONTEXT.test(email.subject))
    || (BULK_FOOTER.test(hay) && !CODE_CONTEXT.test(hay) && !LINK_VERIFY_CONTEXT.test(hay));

  if (CODE_CONTEXT.test(hay) && !bulk) {
    const found = findCodes(hay);
    if (found.code) {
      return { kind: "verification_code", code: found.code, ...base, verification: "code", ambiguous: found.ambiguous, ambiguity: found.ambiguous ? `codes: ${found.candidates.slice(0, 3).map((c) => c.code).join(", ")}` : null };
    }
  }
  if (LINK_VERIFY_CONTEXT.test(hay) && link && !CONFIRMATION_SUBJECT.test(email.subject) && !bulk) {
    return { kind: "verification_code", code: null, ...base, verification: "link", ambiguous: false, ambiguity: null };
  }

  const offer = OFFER.test(hay);
  const rejection = REJECTION.test(hay);
  const interview = INTERVIEW.test(hay);
  // A person writing under a subject like "Your application for X" and asking something is a reply, not a receipt:
  // automatic confirmations come from no-reply senders or say they received the application.
  const personalReply = !NOREPLY.test(email.from) && email.text.includes("?") && !CONFIRMATION.test(hay);
  const kind: InboxKind =
    offer ? "offer"
    : rejection ? "rejection"
    // "Thank you for applying" mails often promise an interview later: the subject decides before the body can.
    : CONFIRMATION_SUBJECT.test(email.subject) && !personalReply ? "confirmation"
    : interview ? "interview"
    : CONFIRMATION.test(hay) ? "confirmation"
    : bulk ? "other"
    : !NOREPLY.test(email.from) && RECRUITER_HINT.test(hay) ? "recruiter_reply"
    : "other";

  // A code word but no code we trust (only numbers that look like something else), or two outcomes in one mail.
  const codeWordNoCode = CODE_CONTEXT.test(email.subject) && !bulk && kind === "other";
  const mixed = rejection && interview && !offer;
  const ambiguity = codeWordNoCode ? "code mentioned but none found" : mixed ? "rejection and interview language" : null;
  return { kind, code: null, ...base, verification: null, ambiguous: ambiguity !== null, ambiguity };
}
