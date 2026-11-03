/**
 * Verification-code extraction, deterministic. The approach OTP autofill uses (iOS/Android security-code detection, the
 * better OTP-extractor libraries): find the code words, collect code-shaped tokens near them, throw away tokens whose own
 * context says they are something else (a date, a phone number, a zip code, an order or requisition number, money, a
 * year), and pick the closest. Two different strong candidates make the result ambiguous, which is when the caller may
 * ask the small model.
 */

/** Words that announce a code. */
const KEYWORD = /\b(?:verification|verify|security|one[- ]?time|passcode|otp|pin|code|confirmation code|access code|login code|sign[- ]?in code|authentication)\b/gi;
/** The mail is about a code at all: without one of these no code is read. */
export const CODE_CONTEXT = /(verification|security|one[- ]time|confirmation|access|login|log[- ]in|sign[- ]?in|authentication|auth|temporary)\s*(code|pin|passcode)\b|\byour (\w+\s+)?code\b|\benter (the|this|your|following) code|\b(copy|paste)( and paste)? (this|the) code|\bpasscode\b|\bone[- ]time (password|passcode|pin)\b|\bOTP\b|\bcode (is|below)\b/i;
/** Code words that mean something else: promo codes, zip codes, area codes. */
const FALSE_CODE = /\b(promo(tion(al)?)?|discount|coupon|gift|referral|voucher|zip|postal|area|country|dress|source|tracking|reference|ref|product|item|sku|offer|sale)\s*code\b/i;
/** Right before a token: it is an identifier, not a code. */
const ID_BEFORE = /(order|invoice|receipt|ref(erence)?|ticket|case|account|acct|confirmation number|requisition|req|job( id)?|id|no\.?|number|#|item|sku|tracking|transaction|txn|po|member|customer|policy|claim|serial|model|flight|booking|room|suite|ste\.?|unit|apt\.?|box|route|exp(ires)?|valid|card|ending( in)?|x{2,}|\*{2,})\s*[:#.-]?\s*$/i;
const MONEY_BEFORE = /[$€£¥]\s*$|\b(usd|eur|gbp|total|subtotal|amount|price|paid|charged|balance)\b[^\n]{0,6}$/i;
const PHONE_AROUND = /(\+\d{1,3}[\s.-]?)?(\(\d{3}\)|\b\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;
const DATE_LIKE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi;
/** "CA 94107", "New York, NY 10001-1234". */
const ZIP = /\b[A-Z]{2}\s+(\d{5})(-\d{4})?\b/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+|[\w.+-]+@[\w-]+\.[\w.-]+/gi;

const isYear = (s: string) => /^(19|20)\d{2}$/.test(s);
const hasLetterAndDigit = (s: string) => /[A-Za-z]/.test(s) && /\d/.test(s);
const mixedCase = (s: string) => /[a-z]/.test(s) && /[A-Z]/.test(s);

export type CodeCandidate = { code: string; score: number; index: number };
export type CodeResult = {
  code: string | null;
  /** Two different plausible codes, close in score: a rule cannot tell which one is meant. */
  ambiguous: boolean;
  candidates: CodeCandidate[];
};

/** Blanks out spans that must never be read as codes, keeping offsets stable. */
function mask(text: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return text.replace(URL_RE, blank).replace(PHONE_AROUND, blank).replace(DATE_LIKE, blank).replace(ZIP, blank)
    .replace(/\b\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?/gi, blank)
    .replace(/\b\d+(\.\d+)?\s?(%|percent|px|kb|mb|gb|usd|eur|minutes?|mins?|hours?|days?|seconds?)\b/gi, blank);
}

function keywordPositions(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(KEYWORD)) {
    const around = text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 2);
    if (FALSE_CODE.test(around)) continue;
    // "code of conduct", "code review", "security clearance", "PIN number" on a card: the word, not a code.
    if (/^\s+(of|review|base|snippet|editor|school|camp|clearance|guard|team|deposit|number|social|question)\b/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 14))) continue;
    out.push(m.index + m[0].length / 2);
  }
  return out;
}

/**
 * Every plausible code in `text` with a score (higher is likelier), best first, and the pick. Only call it on a message
 * that `CODE_CONTEXT` says is about a code; on others it still answers, but conservatively.
 */
export function findCodes(raw: string): CodeResult {
  const text = mask(raw);
  const keys = keywordPositions(text);
  if (keys.length === 0) return { code: null, ambiguous: false, candidates: [] };
  const candidates: CodeCandidate[] = [];

  const consider = (code: string, index: number, length: number, kind: "digits" | "split" | "alnum") => {
    const before = text.slice(Math.max(0, index - 30), index);
    const after = text.slice(index + length, index + length + 12);
    if (ID_BEFORE.test(before) || MONEY_BEFORE.test(before)) return;
    if (/\b(promo(tion(al)?)?|discount|coupon|gift|referral|voucher)\s*(code)?\s*[:#]?\s*$/i.test(before)) return;
    // Part of a bigger token: "R-1204", "1204-B", "v2.3.1234", a sentence-final "No. 4471".
    if (/[A-Za-z0-9][-_/.]$/.test(before) || /^[-_/][A-Za-z0-9]/.test(after) || /^\.\d/.test(after)) return;
    if (/^\s?(%|st\b|nd\b|rd\b|th\b|am\b|pm\b)/i.test(after)) return;
    if (kind === "digits" && isYear(code)) return;
    const center = index + length / 2;
    const distance = Math.min(...keys.map((k) => Math.abs(k - center)));
    if (distance > 220) return;
    let score = 100 - distance / 2;
    const line = text.slice(text.lastIndexOf("\n", index) + 1, (text.indexOf("\n", index + length) + 1 || text.length + 1) - 1).trim();
    if (line === code || line.replace(/[\s-]/g, "") === code) score += 25; // the code alone on its line
    if (/\b(code|pin|passcode|otp)\b[^\n\w]{0,4}(is|:)?\s*$/i.test(before)) score += 20; // "code: 123456", "code is 123456"
    if (/^\s*(is|as)\s+(your|the)\b[^\n]{0,30}\bcode\b/i.test(text.slice(index + length, index + length + 50))) score += 20;
    if (kind === "digits" && code.length === 6) score += 8;
    if (kind === "alnum" && !hasLetterAndDigit(code)) score -= 15;
    candidates.push({ code, score, index });
  };

  for (const m of text.matchAll(/\b\d{3}[ -]\d{3}\b/g)) consider(m[0].replace(/[ -]/, ""), m.index, m[0].length, "split");
  for (const m of text.matchAll(/\b\d{4,8}\b/g)) {
    if (candidates.some((c) => m.index >= c.index && m.index < c.index + 7)) continue;
    consider(m[0], m.index, m[0].length, "digits");
  }
  for (const m of text.matchAll(/\b[A-Za-z0-9]{6,10}\b/g)) {
    const t = m[0];
    if (/^\d+$/.test(t) || /^[a-z]+$/.test(t) || /^[A-Z][a-z]+$/.test(t)) continue;
    // Upper-case words ("VERIFY", "SECURITY") are words. Alphanumeric codes carry a digit, or are 8+ letters in mixed case.
    if (!hasLetterAndDigit(t) && !(mixedCase(t) && t.length >= 8 && !/^[A-Z][a-z]+[A-Z][a-z]+$/.test(t))) continue;
    consider(t, m.index, t.length, "alnum");
  }

  // The same code written twice (subject and body) is one candidate with the better score.
  const best = new Map<string, CodeCandidate>();
  for (const c of candidates) if ((best.get(c.code)?.score ?? -Infinity) < c.score) best.set(c.code, c);
  const ranked = [...best.values()].filter((c) => c.score >= 40).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return { code: null, ambiguous: false, candidates: ranked };
  const second = ranked[1];
  const ambiguous = !!second && top.score - second.score < 12;
  return { code: top.code, ambiguous, candidates: ranked };
}

/** The code in a verification mail, or null. Kept for callers that only want the string. */
export function extractCode(text: string): string | null {
  return findCodes(text).code;
}
