/**
 * Facts a job listing states about itself: the pay range, the kind of job, where the work happens. Read from the
 * listing's own words only; when the listing does not say, the answer is null. Nothing is estimated.
 */

export type Pay = { min: number; max: number; currency: "USD" | "EUR" | "GBP" | "CAD"; period: "year" | "month" | "hour" };
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship" | "temporary";
export type Workplace = "remote" | "hybrid" | "onsite";

const MONEY = String.raw`(?:(?:US|CA)?\$|USD\s?|CAD\s?|€|EUR\s?|£|GBP\s?)\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`;
/** A stated range ("$150,000 - $200,000", "$60–$80 per hour", "USD 120K to 150K") or one amount with a period. */
const RANGE = new RegExp(String.raw`(${MONEY})\s*(?:-|–|—|to)\s*((?:(?:US|CA)?\$|USD\s?|CAD\s?|€|EUR\s?|£|GBP\s?)?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?)([^\n.;]{0,40})`, "i");
const SINGLE = new RegExp(String.raw`(${MONEY})\s*(?:/|per\s+|an\s+|a\s+)(hour|hr|year|yr|annum|month|mo)\b`, "i");

/** A Postgres regex that finds the first pay-looking stretch of a description, for list queries (see `parsePay`). */
export const PAY_SQL_PATTERN = String.raw`((?:\$|USD|CAD|€|£|GBP|EUR)\s?[0-9][0-9,.]*\s?[kK]?\s*(?:-|–|—|to|/|per)[^.\n]{0,60})`;

function amount(raw: string): number | null {
  const k = /k\s*$/i.test(raw.trim());
  const n = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(k ? n * 1000 : n);
}

function currencyOf(raw: string): Pay["currency"] {
  if (/€|EUR/i.test(raw)) return "EUR";
  if (/£|GBP/i.test(raw)) return "GBP";
  if (/CA\$|CAD/i.test(raw)) return "CAD";
  return "USD";
}

function periodOf(after: string, min: number): Pay["period"] {
  if (/\b(hour|hr|hourly)\b/i.test(after)) return "hour";
  if (/\b(month|mo|monthly)\b/i.test(after)) return "month";
  if (/\b(year|yr|annual|annually|annum|salary)\b/i.test(after)) return "year";
  return min < 500 ? "hour" : "year";
}

/** The pay range the text states, or null. "$150K - $200K" → { min: 150000, max: 200000, currency: "USD", period: "year" }. */
export function parsePay(text: string | null | undefined): Pay | null {
  if (!text) return null;
  const r = RANGE.exec(text);
  if (r) {
    const min = amount(r[1]!);
    let max = amount(r[2]!);
    // "$120 - 150K": the k on the second amount covers both.
    if (min !== null && max !== null && /k\s*$/i.test(r[2]!.trim()) && !/k\s*$/i.test(r[1]!.trim()) && min < 1000) {
      return sane({ min: min * 1000, max, currency: currencyOf(r[1]!), period: periodOf(r[3] ?? "", min * 1000) });
    }
    if (min !== null && max !== null) {
      if (max < min) max = min;
      return sane({ min, max, currency: currencyOf(r[1]!), period: periodOf(r[3] ?? "", min) });
    }
  }
  const s = SINGLE.exec(text);
  if (s) {
    const v = amount(s[1]!);
    if (v !== null) return sane({ min: v, max: v, currency: currencyOf(s[1]!), period: periodOf(s[2]!, v) });
  }
  return null;
}

/** Drops numbers no listing means as pay (a "$5" perk, a "$2B" valuation read as a range). */
function sane(p: Pay): Pay | null {
  const [lo, hi] = p.period === "hour" ? [7, 1000] : p.period === "month" ? [500, 100_000] : [15_000, 2_000_000];
  if (p.min < lo || p.max > hi || p.max > p.min * 4) return null;
  return p;
}

/** The kind of job the title or listing names, or null. */
export function parseEmploymentType(title: string, text: string | null | undefined): EmploymentType | null {
  const t = `${title}\n${(text ?? "").slice(0, 4000)}`;
  if (/\bintern(ship)?\b/i.test(title)) return "internship";
  if (/\b(contract|contractor|freelance|1099|c2c)\b/i.test(title)) return "contract";
  if (/\bpart[\s-]?time\b/i.test(title)) return "part_time";
  if (/\b(temporary|temp)\b/i.test(title)) return "temporary";
  if (/\bfull[\s-]?time\b/i.test(t)) return "full_time";
  if (/\bpart[\s-]?time (role|position|job)\b/i.test(t)) return "part_time";
  if (/\b(contract|contractor) (role|position)\b/i.test(t)) return "contract";
  if (/\binternship\b/i.test(t)) return "internship";
  return null;
}

/** Where the work happens, as the listing says: remote, hybrid or on site. Null when it doesn't say. */
export function parseWorkplace(location: string | null, remote: boolean, text: string | null | undefined): Workplace | null {
  const t = `${location ?? ""}\n${(text ?? "").slice(0, 4000)}`;
  if (/\bhybrid\b/i.test(t)) return "hybrid";
  if (remote || /\bremote\b/i.test(location ?? "")) return "remote";
  if (/\b(on[\s-]?site|in[\s-]office|in[\s-]person)\b/i.test(t)) return "onsite";
  return null;
}

/** All three for one job. `payText` is the pay stretch a list query found (lists carry only the start of the text). */
export function listingFacts(j: { title: string; location: string | null; remote: boolean; descriptionText: string | null }, payText?: string | null) {
  return {
    pay: parsePay(payText ?? j.descriptionText),
    employmentType: parseEmploymentType(j.title, j.descriptionText),
    workplace: parseWorkplace(j.location, j.remote, j.descriptionText),
  };
}
