import type { PendingQuestion } from "@norinote/shared";
import { isNo, isYes, matchOption, normalizeQuestion } from "./text.js";

/** What the profile row says, read tolerantly (the profile is jsonb, so keys may be spelled a few ways). */
export type Facts = {
  firstName: string; lastName: string; fullName: string;
  email: string; phone: string; linkedin: string; github: string; website: string;
  location: string; city: string; state: string; country: string; zip: string; address1: string; address2: string;
  workAuth: Record<string, unknown>;
  salary: Record<string, unknown>;
  startDate: string;
  eeo: Record<string, string>;
  preferences: Record<string, unknown>;
};

export type ProfileRowLike = {
  contact?: Record<string, string> | null; location?: string | null; workAuth?: Record<string, unknown> | null;
  salaryExpectation?: Record<string, unknown> | null; startDate?: string | null; eeo?: Record<string, string> | null; preferences?: Record<string, unknown> | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function factsFrom(profile: ProfileRowLike | undefined, userEmail = ""): Facts {
  const c = profile?.contact ?? {};
  const pick = (...keys: string[]) => keys.map((k) => str(c[k])).find(Boolean) ?? "";
  let first = pick("firstName", "first_name", "first");
  let last = pick("lastName", "last_name", "last");
  const full = pick("name", "fullName", "full_name") || [first, last].filter(Boolean).join(" ");
  if (!first && full) first = full.split(/\s+/)[0] ?? "";
  if (!last && full.includes(" ")) last = full.split(/\s+/).slice(1).join(" ");
  const location = str(profile?.location) || pick("location");
  const segs = location.split(",").map((s) => s.trim()).filter(Boolean);
  const address1 = pick("address1", "addressLine1", "address_line_1", "address", "street");
  const address2raw = pick("address2", "addressLine2", "address_line_2", "apt", "apartment", "unit");
  return {
    firstName: first, lastName: last, fullName: full,
    email: pick("email") || userEmail, phone: pick("phone", "mobile"),
    linkedin: pick("linkedin"), github: pick("github"), website: pick("website", "portfolio"),
    location, city: pick("city") || (segs.length > 1 ? (segs[0] ?? "") : ""), state: pick("state", "province") || (segs.length > 2 ? (segs[1] ?? "") : ""),
    country: pick("country"), zip: pick("zip", "postalCode", "postal_code"),
    address1,
    // Address line 2 is its own value. Never a copy of line 1.
    address2: address2raw && normalizeQuestion(address2raw) !== normalizeQuestion(address1) ? address2raw : "",
    workAuth: profile?.workAuth ?? {}, salary: profile?.salaryExpectation ?? {}, startDate: str(profile?.startDate),
    eeo: profile?.eeo ?? {}, preferences: profile?.preferences ?? {},
  };
}

// ---- countries ------------------------------------------------------------------------------------------------------

const COUNTRIES: Record<string, string[]> = {
  US: ["united states", "united states of america", "usa", "u.s.", "us"], CA: ["canada"], GB: ["united kingdom", "uk", "great britain", "england"],
  IE: ["ireland"], DE: ["germany"], FR: ["france"], NL: ["netherlands"], ES: ["spain"], PT: ["portugal"], IT: ["italy"], SE: ["sweden"],
  CH: ["switzerland"], PL: ["poland"], IN: ["india"], AU: ["australia"], NZ: ["new zealand"], SG: ["singapore"], JP: ["japan"], IL: ["israel"],
  BR: ["brazil"], MX: ["mexico"],
};
const DISPLAY: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain", PT: "Portugal",
  IT: "Italy", SE: "Sweden", CH: "Switzerland", PL: "Poland", IN: "India", AU: "Australia", NZ: "New Zealand", SG: "Singapore", JP: "Japan", IL: "Israel",
  BR: "Brazil", MX: "Mexico",
};

/** ISO code of a country given as a code or a name, or null. */
export function countryCode(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase().replace(/^the /, "");
  if (!t) return null;
  for (const [code, names] of Object.entries(COUNTRIES)) if (t === code.toLowerCase() || names.includes(t)) return code;
  return null;
}

/** The country a question names ("... to work in Canada?"), if any. "us" and "uk" count only when written in capitals. */
export function countryIn(text: string): string | null {
  for (const [code, names] of Object.entries(COUNTRIES)) {
    for (const n of names) {
      if (n === "us" || n === "uk") { if (new RegExp(`\\b${n.toUpperCase()}\\b`).test(text)) return code; continue; }
      if (new RegExp(`(?<![a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i").test(text)) return code;
    }
  }
  return null;
}

/** Country of a job from its spec's countries, falling back to its location text. */
export function jobCountry(spec: { location?: { countries?: string[] } } | null | undefined, location: string | null | undefined): string | null {
  for (const c of spec?.location?.countries ?? []) { const code = countryCode(c); if (code) return code; }
  return location ? countryIn(location) : null;
}

type Auth = { authorized: boolean | null; needsSponsorship: boolean | null };

const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") { if (/^(yes|true|y)$/i.test(v.trim())) return true; if (/^(no|false|n)$/i.test(v.trim())) return false; }
  return null;
};

/** The profile's work authorisation for one country: keyed by country code, or flat (meaning the home country). */
export function authFor(facts: Facts, country: string | null): Auth | null {
  const wa = facts.workAuth;
  const read = (o: Record<string, unknown>): Auth => ({
    authorized: bool(o.authorized ?? o.authorised ?? o.authorizedUS ?? o.eligible),
    needsSponsorship: bool(o.needsSponsorship ?? o.requiresSponsorship ?? o.sponsorship ?? o.needsVisaSponsorship),
  });
  for (const [k, v] of Object.entries(wa)) {
    if (v && typeof v === "object" && !Array.isArray(v) && country && countryCode(k) === country) return read(v as Record<string, unknown>);
  }
  const flat = ["authorized", "authorised", "authorizedUS", "eligible", "needsSponsorship", "requiresSponsorship", "sponsorship", "needsVisaSponsorship"].some((k) => k in wa);
  if (flat) {
    const home = countryCode(str(wa.country)) ?? countryCode(facts.country) ?? (wa.authorizedUS !== undefined ? "US" : null);
    if (!country || !home || home === country) return read(wa);
  }
  return null;
}

// ---- answers --------------------------------------------------------------------------------------------------------

const DECLINE = [/decline/i, /prefer not/i, /don'?t wish/i, /do not wish/i, /choose not/i, /not (to )?(say|answer|disclose|specify|identify)/i];
const isDecline = (o: string): boolean => DECLINE.some((r) => r.test(o));

/** Pick by pattern order, skipping options that match `avoid`. */
function pick(options: readonly string[], patterns: RegExp[], avoid?: RegExp): string | null {
  for (const re of patterns) {
    const hit = options.find((o) => re.test(o) && !(avoid && avoid.test(o)));
    if (hit) return hit;
  }
  return null;
}

/** Answer yes or no: the matching option for choices, the bare word otherwise. */
function yesNo(q: PendingQuestion, yes: boolean): string | null {
  if (q.options.length === 0) return yes ? "Yes" : "No";
  return q.options.find((o) => (yes ? isYes(o) : isNo(o))) ?? null;
}

/** A free-text value for a text question, or the option it means for a choice. Null when no option means it. */
function value(q: PendingQuestion, v: string): string | null {
  if (!v) return null;
  if (q.options.length === 0) return v;
  return matchOption(v, q.options);
}

const EEO_CATEGORY: [RegExp, string][] = [
  [/veteran/, "veteran"], [/disab/, "disability"], [/sexual orientation|lgbtq/, "orientation"],
  [/hispanic|latin[oax]/, "hispanic"], [/race|racial|ethnic/, "race"], [/gender|\bsex\b|transgender/, "gender"],
];

/** EEO questions: the user's stored choice, otherwise decline to answer. Never guesses. */
function eeoAnswer(q: PendingQuestion, label: string, facts: Facts): string | null {
  const cat = EEO_CATEGORY.find(([re]) => re.test(label))?.[1];
  const chosen = ((cat && facts.eeo[cat]) || "decline").trim();
  const decline = (): string | null => (q.options.length === 0 ? "Decline to answer" : pick(q.options, DECLINE));
  if (/^(decline|prefer not|n\/a)/i.test(chosen)) return decline();
  if (q.options.length === 0) return chosen;
  const open = q.options.filter((o) => !isDecline(o));
  if (isYes(chosen) || isNo(chosen)) return yesNo({ ...q, options: open }, isYes(chosen)) ?? decline();
  return matchOption(chosen, open) ?? decline();
}

function salaryAnswer(q: PendingQuestion, label: string, facts: Facts): string | null {
  const s = facts.salary;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && Number(v.replace(/[^\d.]/g, "")) > 0 ? Number(v.replace(/[^\d.]/g, "")) : null);
  const amount = num(s.amount) ?? num(s.target) ?? num(s.max) ?? num(s.min);
  if (amount === null) return null;
  if (q.options.length > 0) {
    // Range options ("$100,000 - $150,000", "150k+", "Under 80k"): the one that contains the amount.
    const nums = (o: string) => [...o.toLowerCase().replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k\b)?/g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1));
    for (const o of q.options) {
      const n = nums(o);
      if (n.length >= 2 && amount >= n[0]! && amount <= n[1]!) return o;
      if (n.length === 1 && /\+|above|over|more|or higher/i.test(o) && amount >= n[0]!) return o;
      if (n.length === 1 && /under|below|less|up to/i.test(o) && amount < n[0]!) return o;
    }
    return null;
  }
  if (/number|numeric|digits|\busd\b|\(\$\)|\$/.test(label) || /^\d+$/.test(String(amount)) && /\b(usd|\$)\b/i.test(label)) return String(Math.round(amount));
  const currency = str(s.currency) || "USD";
  const period = str(s.period);
  return `${Math.round(amount).toLocaleString("en-US")} ${currency}${period ? ` per ${period}` : ""}`;
}

const HEAR = /(hear|heard|learn(ed)?|find|found) (out )?about (us|this|the|our)|how did you (find|hear|learn|discover|come across)|where did you (first )?(hear|find|see|learn)|referral source|source of (this )?application/;
const SALARY = /salary|compensation|pay (expectation|range|requirement)|desired (pay|rate)|expected (pay|rate)|rate expectation/;
const START = /start date|when (can|could|would) you (start|begin|join)|earliest (possible )?(start|date|availab)|available to start|availability (to start|date)/;
const AUTH = /(authori[sz]ed|eligible|legally|right|permitted|legal right) to work|work authori[sz]ation|work permit|employment eligibility/;
const EEO = /\b(gender|sex|race|racial|ethnicity|ethnic|hispanic|latino|latina|latinx|veteran|disability|disabled|sexual orientation|lgbtq|transgender)\b/;

/**
 * Answer from facts only, or null. Every choice is one of `q.options` exactly; when no option means the answer, null.
 * `targetCountry` is the country the job (or the question) is about, for work authorisation.
 */
export function defaultAnswer(q: PendingQuestion, facts: Facts, ctx: { jobCountry: string | null; defaultHeardAbout?: string }): string | null {
  if (q.type === "file") return null;
  const label = q.text.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  if (!label) return null;
  const short = label.length <= 70;

  if (EEO.test(label) && !/sponsor|authori[sz]|work/.test(label)) return eeoAnswer(q, label, facts);

  if (HEAR.test(label)) {
    // Where Norinote found the posting: a job board. Never a recruiter, a referral or an employee name.
    const stated = str(facts.preferences.heardAbout);
    if (q.options.length === 0) return stated || ctx.defaultHeardAbout || "Job board";
    if (stated) { const m = matchOption(stated, q.options); if (m) return m; }
    const bad = /recruit|referr|employee|friend|colleague|agency|event|campus|university|social|twitter|facebook|instagram|tiktok|youtube|podcast|newsletter|ad\b|advert/i;
    return pick(q.options, [/job[- ]?board/i, /job (site|posting|listing|search)/i, /linkedin|indeed|glassdoor|ziprecruiter|wellfound|handshake/i, /careers? (page|site)|company (web)?site|\bwebsite\b|online|internet|web search|search engine/i, /\bother\b/i], bad);
  }

  if (SALARY.test(label)) return salaryAnswer(q, label, facts);

  if (START.test(label) && !/why|motivat/.test(label)) return value(q, facts.startDate);

  if (/relocat/.test(label)) {
    const r = bool(facts.preferences.willingToRelocate ?? facts.preferences.relocate ?? facts.preferences.openToRelocation);
    return r === null || (q.options.length > 0 && !q.options.some((o) => isYes(o) || isNo(o))) ? null : yesNo(q, r);
  }

  const target = countryIn(q.text) ?? ctx.jobCountry ?? countryCode(facts.country) ?? countryCode(str(facts.workAuth.country));
  if (/sponsor/.test(label)) {
    const a = authFor(facts, target);
    if (!a) return null;
    const needs = a.needsSponsorship ?? (a.authorized === true ? false : null);
    if (needs === null) return null;
    // "Are you able to work without sponsorship?" asks the opposite way round.
    const inverted = /without (visa |employer )?sponsorship|not (require|need) (visa |employer )?sponsorship|able to work (in|without)/.test(label);
    return yesNo(q, inverted ? !needs : needs);
  }
  if (AUTH.test(label)) {
    const a = authFor(facts, target);
    if (!a || a.authorized === null) return null;
    return yesNo(q, a.authorized);
  }

  if (short) {
    if (/^(legal )?(first|given) name\b/.test(label)) return value(q, facts.firstName);
    if (/^(legal )?(last|family) name\b|^surname\b/.test(label)) return value(q, facts.lastName);
    if (/^(your )?(full|legal) name\b|^(your )?name\b$/.test(label)) return value(q, facts.fullName);
    if (/^(your )?e-?mail( address)?\b/.test(label)) return value(q, facts.email);
    if (/^(your )?(phone|mobile|telephone|cell)( number)?\b/.test(label)) return value(q, facts.phone);
    if (/linkedin/.test(label)) return value(q, facts.linkedin);
    if (/github/.test(label)) return value(q, facts.github);
    if (/\b(website|portfolio|personal (site|url|page)|blog)\b/.test(label) && !/company|employer/.test(label)) return value(q, facts.website);
    if (/address( line)? ?2\b|apartment|\bapt\b|\bsuite\b|\bunit\b/.test(label)) return value(q, facts.address2);
    if (/address( line)? ?1\b|street address|^address\b/.test(label)) return value(q, facts.address1);
    if (/\b(zip|postal)\b/.test(label)) return value(q, facts.zip);
    if (/^city\b/.test(label)) return value(q, facts.city);
    if (/^(state|province)\b|state\s*\/\s*province/.test(label)) return value(q, facts.state);
    if (/^country\b|country of residence|country.*(reside|live|based)/.test(label) && !/work|citizen/.test(label)) {
      const code = countryCode(facts.country) ?? ctx.jobCountry;
      if (!facts.country && !code) return null;
      if (q.options.length === 0) return facts.country || (code ? (DISPLAY[code] ?? null) : null);
      return matchOption(facts.country, q.options) ?? (code && DISPLAY[code] ? matchOption(DISPLAY[code], q.options) ?? q.options.find((o) => countryCode(o) === code) ?? null : null);
    }
    if (/^(current |your )?(location|city)\b|where (are you|do you) (currently )?(located|based|live)|current (city|location)/.test(label)) return value(q, facts.location);
  }
  return null;
}
