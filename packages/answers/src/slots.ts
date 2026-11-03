/**
 * Profile slots: what a form field asks about the person, decided deterministically from the field's name, id,
 * autocomplete, label, legend and placeholder, and the value each slot takes from the profile. Pure, no I/O.
 *
 * A slot never invents a value. Legal slots (work authorisation, sponsorship, criminal history, salary, relocation, start
 * date, age, consent) come only from the profile; when the profile has no answer they become a pending question. Equal
 * opportunity slots use the profile's choice, else the form's own "decline to self-identify" option.
 */
import type { CareerPoint, PendingQuestion } from "@norinote/shared";
import { countryCode, defaultAnswer, type Facts } from "./defaults.js";
import { isNo, isYes, matchOption, normalizeQuestion } from "./text.js";

export const SLOTS = [
  "first_name", "last_name", "full_name", "preferred_name", "email", "phone", "phone_country",
  "linkedin", "github", "website", "social", "location", "city", "state", "country", "zip", "address",
  "resume", "resume_text", "cover_letter", "current_company", "current_title", "school", "degree", "discipline",
  "pronouns", "hear_about",
  "work_auth", "sponsorship", "criminal", "salary", "relocation", "start_date", "age", "consent", "sms_consent",
  "eeo_gender", "eeo_race", "eeo_hispanic", "eeo_veteran", "eeo_disability", "eeo_orientation", "eeo_signature",
  "custom",
] as const;
export type Slot = (typeof SLOTS)[number];

/** Answered only from the profile. Without a profile answer: a pending question, never a model guess. */
export const LEGAL_SLOTS: ReadonlySet<Slot> = new Set<Slot>(["work_auth", "sponsorship", "criminal", "salary", "relocation", "start_date", "age", "consent"]);
export const EEO_SLOTS: ReadonlySet<Slot> = new Set<Slot>(["eeo_gender", "eeo_race", "eeo_hispanic", "eeo_veteran", "eeo_disability", "eeo_orientation"]);

export type FieldType = "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "multiselect" | "radio" | "checkbox" | "boolean" | "file" | "location";

/** What the planner knows about one field, from the job system's schema or from the page. */
export type SlotField = {
  /** Stable key: the field's name or id (`question_123`, `urls[LinkedIn]`, `_systemfield_email`, a uuid on Ashby). */
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  placeholder?: string | null;
  /** Where the field sits: the main form, an EEO block, a compliance block. */
  section?: "main" | "eeo" | "compliance" | null;
};

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

/** Exact keys the supported job systems use for their standard fields (stable across postings). */
const KEY_SLOTS: Record<string, Slot> = {
  first_name: "first_name", last_name: "last_name", preferred_name: "preferred_name", email: "email", phone: "phone",
  resume: "resume", resume_text: "resume_text", cover_letter: "cover_letter", cover_letter_text: "resume_text",
  location: "location", "candidate-location": "location", "location-input": "location",
  // Greenhouse US EEOC block
  gender: "eeo_gender", race: "eeo_race", hispanic_ethnicity: "eeo_hispanic", veteran_status: "eeo_veteran", disability_status: "eeo_disability",
  // Lever
  name: "full_name", org: "current_company", pronouns: "pronouns", "urls[linkedin]": "linkedin", "urls[github]": "github",
  "urls[twitter]": "social", "urls[portfolio]": "website", "urls[other website]": "website", "urls[other]": "website", "urls[website]": "website",
  "eeo[gender]": "eeo_gender", "eeo[race]": "eeo_race", "eeo[veteran]": "eeo_veteran", "eeo[disability]": "eeo_disability",
  "eeo[disabilitysignature]": "eeo_signature", "eeo[disabilitysignaturedate]": "eeo_signature",
  // Ashby
  _systemfield_name: "full_name", _systemfield_email: "email", _systemfield_phone: "phone", _systemfield_resume: "resume",
  _systemfield_location: "location", _systemfield_linkedin: "linkedin", _systemfield_github: "github", _systemfield_website: "website",
  smsconsent: "sms_consent", whatsappconsent: "sms_consent", communicationconsent: "sms_consent",
};

const AUTOCOMPLETE_SLOTS: Record<string, Slot> = {
  "given-name": "first_name", "family-name": "last_name", name: "full_name", email: "email", tel: "phone", "tel-national": "phone",
  "address-level2": "city", "address-level1": "state", "postal-code": "zip", "country-name": "country", country: "country",
  "street-address": "address", "address-line1": "address", organization: "current_company", "organization-title": "current_title", url: "website",
};

const isText = (f: SlotField) => !["select", "multiselect", "radio", "checkbox", "boolean", "file"].includes(f.type) && f.options.length === 0;
const isChoiceLike = (f: SlotField) => !isText(f) && f.type !== "file";
const shortLabel = (f: SlotField) => lc(f.label).length <= 60;
const notProse = (f: SlotField) => !/\b(tell us|describe|explain|share|why|how (are|do|did|would))\b/.test(lc(f.label));

/** Label rules, in order; the first that matches wins. */
const LABEL_RULES: [RegExp, Slot, ((f: SlotField) => boolean)?][] = [
  // A free-text follow-up ("If yes, what type of sponsorship?", "If other, please explain") is its own question.
  [/^(if (yes|so|not|other|applicable|you (answered|selected|chose|checked))|please (explain|elaborate|specify|provide (more|further|additional)))\b/, "custom", isText],
  [/cover letter/, "cover_letter", (f) => f.type === "file" || f.type === "textarea"],
  [/\b(resume|cv|résumé|curriculum vitae)\b/, "resume", (f) => f.type === "file"],
  [/^(resume|cv)\b.*\b(text|paste)|paste (your )?(resume|cv)/, "resume_text"],
  [/\bsponsor|sponorship|\bvisa\b|h-?1b/, "sponsorship"],
  [/authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able|permitted)|eligible to work|right to work|work permit|employment eligibility|legal(ly)? (right|entitled) to work|work authori[sz]ed/, "work_auth"],
  [/^(are|is) you (a |an )?[a-z .]{0,30}(citizen|permanent resident)\b/, "work_auth", isChoiceLike],
  [/convicted|criminal|felony|misdemeanou?r|background check.*(pass|consent)|arrest/, "criminal"],
  [/salary|compensation|pay (expectation|range|requirement)|desired (pay|rate)|expected (pay|rate)|rate expectation|\bote\b/, "salary"],
  [/relocat/, "relocation", (f) => notProse(f) && !/address from which|where (do|will) you|plan on working from|currently based within|commuting distance/.test(lc(f.label))],
  [/start date|when (can|could|would) you (start|begin|join)|earliest (possible )?(start|date|availab)|earliest .{0,30}\bstart|available to start|available for full[- ]time|notice period/, "start_date"],
  [/(18|eighteen)( years)?( of age| years old| or older)|\bover 18\b|at least 18|legal (working )?age/, "age"],
  [/\b(pronoun)/, "pronouns"],
  [/sms|text messages?|whatsapp/, "sms_consent", (f) => f.options.length > 0 || f.type === "checkbox" || f.type === "boolean"],
  [/hispanic|latin[oax]/, "eeo_hispanic"],
  [/\bveteran|military (service|status)|protected veteran|transitioning service member|served in the (military|armed forces)/, "eeo_veteran"],
  [/disabilit/, "eeo_disability"],
  [/^gender identity|self-identification of gender/, "eeo_gender"],
  [/sexual orientation|lgbtq|transgender/, "eeo_orientation"],
  [/\bgender\b|\bsex\b/, "eeo_gender"],
  [/\brace\b|ethnic/, "eeo_race"],
  [/(i )?(consent|agree|acknowledge|certify|confirm|accept)\b.*(privacy|data|information|processing|terms|policy|retain|collect|store|accurate|true|notetaker|record)|privacy (policy|notice)|gdpr|consent to (contact|be contacted)|has my consent|^i (confirm|acknowledge) (that )?i have read/, "consent", (f) => f.type === "checkbox" || f.type === "boolean" || f.options.length <= 3],
  [/(hear|heard|learn(ed)?|find|found) (out )?about (us|this|the|our|[a-z]+\?)|how did you (find|hear|learn|discover|come across)|where did you (first )?(hear|find|see|learn)|referral source|source of (this )?application/, "hear_about"],
  [/linkedin/, "linkedin"],
  [/github|samples of (your )?code|code samples/, "github", (f) => f.type !== "file"],
  [/^x$|twitter|\bx\.com\b|\bx (handle|profile|url)\b|mastodon|bluesky|dribbble|behance|stack ?overflow|facebook|instagram/, "social", (f) => isText(f) && (shortLabel(f) || /url|profile|handle|username|link/.test(lc(f.label)))],
  [/e-?mail/, "email", isText],
  [/preferred (first )?name|nickname|name you go by|name you('d| would)? prefer/, "preferred_name"],
  [/^(legal )?(first|given) name|^forename/, "first_name"],
  [/^(legal )?(last|family) name|^surname/, "last_name"],
  [/^(your )?(full |legal |complete )?name$|^full name|^legal name|^name \(/, "full_name"],
  [/^(phone|mobile|telephone|cell)( number)?$|^(your |best )?(phone|mobile)|phone number/, "phone", isText],
  [/website|portfolio|personal (site|url|page)|^url$|\bblog\b|^where can we (learn more about you|see your work)/, "website", isText],
  [/(current|most recent|present)\)? (company|employer|organi[sz]ation)|(current|most recent).{0,20}\b(company|employer)\b|^company( name)?$|^employer$/, "current_company", (f) => isText(f) && notProse(f)],
  [/(current|most recent|present) (job )?(title|role|position)|^(job )?title$/, "current_title", (f) => isText(f) && shortLabel(f) && notProse(f)],
  [/^(school|university|college|institution)( name)?$|school name|university name|(name of|which) (school|university|college)|^school\b|which university/, "school"],
  [/^degree\b|highest (level of )?(degree|education)|degree (type|level|obtained)/, "degree"],
  [/^(discipline|major|field of study|area of study)\b/, "discipline"],
  [/address( line)? ?2|apartment|\bapt\b|\bsuite\b/, "custom"],
  [/street address|address( line)? ?1|^address$|^mailing address/, "address"],
  [/\b(zip|postal)( code)?\b/, "zip"],
  [/^city\b/, "city"],
  [/^(state|province)\b|state ?\/ ?province/, "state"],
  [/^country\b|country of residence|which country|country (do you|where you) (live|reside)|country (in which|where) you are (located|based)|what country are you (based|located)/, "country", (f) => !/work|citizen|authori/.test(lc(f.label))],
  [/^(current )?location\b|location \(city\)|where are you (currently )?(based|located)|where (do you|will you) (currently )?(live|plan on working|plan to work)|from where do you (intend|plan) to work|address from which you plan|what is your (current )?location|current (city|address)|city and state/, "location", notProse],
];

/** Deterministic slot for a field, or "custom" when nothing identifies it. */
export function classifySlot(f: SlotField): Slot {
  const keys = [f.key, f.name, f.id].filter((k): k is string => !!k).map((k) => k.toLowerCase());
  for (const k of keys) {
    const s = KEY_SLOTS[k];
    if (s) return s;
    if (/^gdpr_|consent_given/.test(k)) return "consent";
  }
  const label = lc(f.label).replace(/\*/g, "").trim();
  for (const [re, slot, guard] of LABEL_RULES) if (re.test(label) && (!guard || guard(f))) return slot;
  const ac = lc(f.autocomplete);
  if (ac && ac !== "off" && ac !== "on" && AUTOCOMPLETE_SLOTS[ac]) return AUTOCOMPLETE_SLOTS[ac]!;
  const ph = lc(f.placeholder);
  if (ph) for (const [re, slot, guard] of LABEL_RULES) if (re.test(ph) && (!guard || guard(f))) return slot;
  return "custom";
}

/** Facts read from the career points: current employer and title, school, degree. */
export type CareerFacts = { currentCompany: string; currentTitle: string; school: string; degree: string; discipline: string };

const sortKey = (d: string | null | undefined) => (d ?? "").padEnd(7, "-");

export function careerFacts(points: readonly CareerPoint[]): CareerFacts {
  const roles = points.filter((p) => p.kind === "role");
  const current = roles.filter((p) => !p.endDate).sort((a, b) => sortKey(b.startDate).localeCompare(sortKey(a.startDate)))[0]
    ?? [...roles].sort((a, b) => sortKey(b.endDate).localeCompare(sortKey(a.endDate)))[0];
  const edu = points.filter((p) => p.kind === "education").sort((a, b) => sortKey(b.endDate ?? b.startDate).localeCompare(sortKey(a.endDate ?? a.startDate)))[0];
  // Education points are written "B.S. Computer Science" at "State University"; split degree and discipline at the first " in " or space after the degree.
  const degreeText = edu?.title ?? "";
  const m = /^(.*?\b(?:bachelor'?s?|master'?s?|b\.?\s?[as]\.?|m\.?\s?[as]\.?|b\.?eng|m\.?eng|ph\.?d\.?|mba|associate'?s?|bsc|msc|ba|bs|ms|ma)\b\.?)(?:\s+(?:of|in)\s+|,\s*|\s+)?(.*)$/i.exec(degreeText);
  return {
    currentCompany: current?.org ?? "",
    currentTitle: current?.title ?? "",
    school: edu?.org ?? "",
    degree: m ? m[1]!.trim() : degreeText,
    discipline: m ? (m[2] ?? "").trim() : "",
  };
}

export type SlotValue =
  | { status: "ready"; value: string; source: "profile" | "eeo" | "decline" }
  | { status: "pending"; reason: string }
  | { status: "skip"; reason: string };

const DECLINE_RE = /decline|prefer not|don'?t wish|do not wish|choose not|not (to )?(say|answer|disclose|specify|identify)|rather not/i;

const toQuestion = (f: SlotField): PendingQuestion => ({
  id: f.key, text: f.label, required: f.required, options: f.options,
  type: f.type === "textarea" ? "textarea" : f.type === "file" ? "file" : f.type === "multiselect" || (f.type === "checkbox" && f.options.length > 1) ? "multiselect"
    : f.options.length > 0 ? "select" : f.type === "checkbox" || f.type === "boolean" ? "boolean" : "text",
});

/** A free-text value for a text field, the option it means for a choice. Null when no option means it. */
function fit(f: SlotField, v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (f.options.length === 0) return s;
  return matchOption(s, f.options);
}

function yesNo(f: SlotField, yes: boolean): string | null {
  if (f.options.length === 0) return yes ? "Yes" : "No";
  return f.options.find((o) => (yes ? isYes(o) : isNo(o))) ?? null;
}

const missing = (f: SlotField, what: string): SlotValue =>
  f.required ? { status: "pending", reason: `Your profile has no ${what}` } : { status: "skip", reason: `no ${what} in the profile` };

/** Dialing-code country for the phone widget, from the profile phone's prefix, else the profile country. */
export function phoneCountry(facts: Facts): string | null {
  const m = facts.phone.trim().match(/^(?:\+|00)\s*(\d{1,3})/);
  if (m?.[1]?.startsWith("1")) return countryCode(facts.country) === "CA" ? "Canada" : "United States";
  if (m) {
    const table: Record<string, string> = { "44": "United Kingdom", "91": "India", "49": "Germany", "33": "France", "61": "Australia", "353": "Ireland", "31": "Netherlands", "34": "Spain", "65": "Singapore", "81": "Japan", "972": "Israel", "55": "Brazil", "52": "Mexico" };
    for (const len of [3, 2]) { const c = table[m[1]!.slice(0, len)]; if (c) return c; }
  }
  return facts.country || null;
}

/**
 * The value a slot takes for this field, from the profile only. Choices map to one of the field's options exactly.
 * `jobCountry` decides which country's work authorisation a question is about when it does not say.
 */
export function slotValue(slot: Slot, f: SlotField, facts: Facts, career: CareerFacts, ctx: { jobCountry: string | null }): SlotValue {
  const ready = (v: string | null, what: string, source: "profile" | "eeo" | "decline" = "profile"): SlotValue =>
    v ? { status: "ready", value: v, source } : missing(f, what);
  switch (slot) {
    case "first_name": return ready(fit(f, facts.firstName), "first name");
    case "last_name": return ready(fit(f, facts.lastName), "last name");
    case "full_name": return ready(fit(f, facts.fullName), "name");
    case "preferred_name": return f.required ? ready(fit(f, facts.firstName), "first name") : { status: "skip", reason: "optional" };
    case "email": return ready(fit(f, facts.email), "email");
    case "phone": return ready(fit(f, facts.phone), "phone number");
    case "phone_country": return ready(fit(f, phoneCountry(facts)), "phone country");
    case "linkedin": return ready(fit(f, facts.linkedin), "LinkedIn URL");
    case "github": return ready(fit(f, facts.github), "GitHub URL");
    case "website": return ready(fit(f, facts.website || facts.github || facts.linkedin), "website");
    case "social": return missing(f, "social profile");
    case "location": return ready(fit(f, facts.location), "location");
    case "city": return ready(fit(f, facts.city || facts.location.split(",")[0]?.trim()), "city");
    case "state": return ready(fit(f, facts.state), "state");
    case "zip": return ready(fit(f, facts.zip), "postal code");
    case "address": return ready(fit(f, facts.address1), "street address");
    case "country": {
      const v = defaultAnswer(toQuestion({ ...f, label: "Country" }), facts, { jobCountry: ctx.jobCountry });
      return ready(v, "country");
    }
    case "resume": return { status: "ready", value: "@resume", source: "profile" };
    case "resume_text": return { status: "skip", reason: "the resume is uploaded as a file" };
    case "cover_letter": return f.required ? { status: "pending", reason: "The form requires a cover letter file" } : { status: "skip", reason: "optional cover letter" };
    case "current_company": return ready(fit(f, career.currentCompany), "current employer");
    case "current_title": return ready(fit(f, career.currentTitle), "current title");
    case "school": return ready(fit(f, career.school), "school");
    case "degree": return ready(fit(f, career.degree), "degree");
    case "discipline": return ready(fit(f, career.discipline), "field of study");
    case "pronouns": {
      const p = typeof facts.preferences.pronouns === "string" ? facts.preferences.pronouns : "";
      if (f.type === "checkbox" && f.options.length > 1) return p ? ready(fit(f, p), "pronouns") : { status: "skip", reason: "optional" };
      return ready(fit(f, p), "pronouns");
    }
    case "hear_about": return ready(defaultAnswer(toQuestion({ ...f, label: "How did you hear about us?" }), facts, { jobCountry: ctx.jobCountry }), "referral source");
    case "sms_consent": {
      // Messaging consent was never given: the privacy-preserving choice, and only when the form insists.
      if (!f.required) return { status: "skip", reason: "optional messaging consent" };
      const no = f.options.find((o) => /^no\b|do not consent|don'?t consent|opt out/i.test(o));
      return no ? { status: "ready", value: no, source: "decline" } : { status: "pending", reason: "The form asks for messaging consent" };
    }
    case "consent": {
      const yes = facts.preferences.autoConsent === true || facts.preferences.consentToProcessing === true;
      if (!yes) return f.required ? { status: "pending", reason: "The form asks for your consent; Norinote never gives it for you" } : { status: "skip", reason: "optional consent" };
      return ready(f.options.length ? (f.options.find((o) => isYes(o) || /agree|consent|accept|acknowledge/i.test(o)) ?? null) : "Yes", "consent");
    }
    case "eeo_signature": return { status: "skip", reason: "a signature is the person's own" };
    case "eeo_gender": case "eeo_race": case "eeo_hispanic": case "eeo_veteran": case "eeo_disability": case "eeo_orientation": {
      if (f.type === "text" && f.options.length === 0 && !f.required) return { status: "skip", reason: "optional free-text EEO" };
      // An optional self-identification question with no choice in the profile is left blank (declining it changes nothing).
      const category = { eeo_gender: "gender", eeo_race: "race", eeo_hispanic: "hispanic", eeo_veteran: "veteran", eeo_disability: "disability", eeo_orientation: "orientation" }[slot];
      if (!f.required && !facts.eeo[category]) return { status: "skip", reason: "optional, no choice in the profile" };
      const v = defaultAnswer(toQuestion(f), facts, { jobCountry: ctx.jobCountry });
      if (!v) return f.required ? { status: "pending", reason: "No matching self-identification option" } : { status: "skip", reason: "no option to decline" };
      return { status: "ready", value: v, source: DECLINE_RE.test(v) ? "decline" : "eeo" };
    }
    case "work_auth": case "sponsorship": case "salary": case "relocation": case "start_date": {
      // The slot may come from a model's reading of an unusual label; the profile rules key on wording, so add the word.
      const hint = { work_auth: "authorized to work", sponsorship: "sponsorship", salary: "salary", relocation: "relocate", start_date: "start date" }[slot];
      const v = defaultAnswer(toQuestion(f), facts, { jobCountry: ctx.jobCountry })
        ?? defaultAnswer(toQuestion({ ...f, label: `${f.label} (${hint})` }), facts, { jobCountry: ctx.jobCountry });
      // "Based in X or willing to relocate?": not willing does not make it No when the person may already live there.
      if (v && slot === "relocation" && /\b(based|located|live|living|reside)\b.{0,40}\bor\b|\bor\b.{0,40}\b(based|located|live|living|reside)\b|\blocal to\b/.test(lc(f.label)) && isNo(v)) {
        return f.required ? { status: "pending", reason: "It depends on where you live now" } : { status: "skip", reason: "depends on where the person lives" };
      }
      return v ? { status: "ready", value: v, source: "profile" } : missing(f, LEGAL_WHAT[slot] ?? "answer");
    }
    case "criminal": {
      const c = facts.preferences.criminalRecord;
      if (typeof c === "boolean") { const v = yesNo(f, c); if (v) return { status: "ready", value: v, source: "profile" }; }
      return missing(f, "answer about criminal history");
    }
    case "age": {
      const adult = facts.preferences.over18 ?? facts.preferences.adult;
      if (typeof adult === "boolean") { const v = yesNo(f, adult); if (v) return { status: "ready", value: v, source: "profile" }; }
      return missing(f, "answer about your age");
    }
    case "custom": return { status: "skip", reason: "not a profile slot" };
  }
}

const LEGAL_WHAT: Record<string, string> = {
  work_auth: "work authorisation for this country", sponsorship: "sponsorship answer for this country", salary: "salary expectation",
  relocation: "relocation preference", start_date: "start date",
};

/** Normalised label used for recipe lookups and the answer bank. */
export const labelKey = (label: string): string => normalizeQuestion(label.replace(/\*/g, ""));

