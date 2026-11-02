/** Small text helpers shared by the contact parser and the heuristic resume parser: section headings, dates, quantities. */

// ---- sections -------------------------------------------------------------------------------------------------------

export type Section =
  | "experience" | "education" | "skills" | "projects" | "certifications" | "summary"
  | "contact" | "publications" | "awards" | "languages" | "volunteer" | "other";

const HEADINGS: [Section, RegExp][] = [
  ["experience", /^(?:(?:professional|work|relevant|industry|related|recent|career|employment|teaching|research|leadership|military)\s+)?experience$|^(?:employment|work|career|professional)(?:\s+(?:history|record|experience|background))?$|^experience\s*(?:&|and)\s*(?:projects|leadership)$|^positions?\s+held$|^internships?$|^(?:selected\s+)?work$/],
  ["education", /^education(?:al)?(?:\s+(?:background|history|qualifications))?(?:\s*(?:&|and)\s*(?:training|certifications?|awards|credentials|qualifications))?$|^academic(?:s| background| qualifications| history)?$|^qualifications$/],
  ["skills", /^(?:(?:technical|core|key|relevant|professional|hard|soft|computer|it|programming)\s+)?(?:skills?|competenc(?:ies|e)|expertise|technologies|tech(?:nical)?\s+stack|toolkit|tools)(?:\s*(?:&|and|\/)\s*(?:skills|tools|technologies|competencies|interests|languages|expertise|certifications))?$|^skills?\s+(?:summary|set|profile)$|^areas\s+of\s+expertise$|^programming\s+languages$|^tools\s*(?:&|and)\s*technologies$/],
  ["projects", /^(?:(?:personal|selected|side|key|notable|open[ -]source|technical|academic|relevant|research|major|independent)\s+)?projects?(?:\s*(?:&|and)\s*(?:publications|research|open source))?$|^portfolio$/],
  ["certifications", /^(?:licenses?\s*(?:&|and|\/)\s*)?certifications?(?:\s*(?:&|and|\/)\s*(?:licenses?|training|courses))?$|^licenses?$|^certificates?$|^credentials$|^professional\s+(?:certifications?|development|licenses?)$|^courses?(?:\s*(?:&|and)\s*certifications?)?$/],
  ["summary", /^(?:professional\s+|career\s+|executive\s+|personal\s+)?(?:summary|profile|objective|statement|overview)$|^about(?:\s+me)?$|^summary\s+of\s+qualifications$|^highlights$|^career\s+highlights$/],
  ["contact", /^(?:contact|contact\s+(?:info(?:rmation)?|details|me)|personal\s+(?:details|information|info)|details|links|find\s+me\s+online|online)$/],
  ["publications", /^(?:selected\s+)?(?:publications?|papers|research\s+papers|patents|talks|presentations|speaking)(?:\s*(?:&|and)\s*(?:patents|talks|presentations))?$/],
  ["awards", /^(?:awards?|honou?rs|achievements|accomplishments|recognition|scholarships)(?:\s*(?:&|and)\s*(?:honou?rs|awards|achievements|recognition))?$/],
  ["languages", /^(?:spoken\s+|foreign\s+)?languages?(?:\s+spoken)?$/],
  ["volunteer", /^(?:volunteer(?:ing)?|community(?:\s+(?:service|involvement))?|volunteer\s+(?:experience|work))$|^(?:leadership\s*(?:&|and)\s*)?(?:activities|extracurriculars?|involvement)$/],
  ["other", /^(?:interests|hobbies|references|leadership|affiliations|memberships|professional\s+affiliations|additional\s+information|miscellaneous)$/],
];

/** A candidate heading line without markdown, decoration or letter spacing ("E X P E R I E N C E"), lower case. */
function headingText(line: string): string {
  let t = line.trim().replace(/^#+\s*/, "").replace(/[:\-=_*#|\s]+$/g, "").replace(/^[-=_*#|\s]+/g, "").trim();
  if (/^(?:\S\s){3,}\S$/.test(t)) t = t.replace(/\s/g, "");
  return t.replace(/\s+/g, " ").toLowerCase();
}

/** The section a line opens, or null when it is not a heading. */
export function sectionOf(line: string): Section | null {
  const raw = line.trim();
  if (!raw || raw.length > 48) return null;
  const t = headingText(raw);
  if (!t || t.length > 45) return null;
  for (const [name, re] of HEADINGS) if (re.test(t)) return name;
  return null;
}

// ---- dates ----------------------------------------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const DATE = `(?:${MONTH}[,\\s]+\\d{4}|${SEASON}\\s+\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4}[-/.](?:0[1-9]|1[0-2])(?!\\d)|(?:19|20)\\d{2})`;
const PRESENT = "present|current|now|ongoing|today|till date|to date";
/** "Jan 2022 - Present", "2019 to 2021", "03/2020 – 08/2022". Group 1 is the start, group 2 the end. */
export const DATE_RANGE = new RegExp(`\\(?\\b(${DATE})\\s*(?:-|\\u2013|\\u2014|\\u2012|~|to|until|through|thru)\\s*(${DATE}|${PRESENT})\\b\\)?`, "i");

export function isPresent(raw: string | null | undefined): boolean {
  return !!raw && new RegExp(`^(?:${PRESENT})$`, "i").test(raw.trim());
}

/**
 * Normalise "Jan 2022", "January 2022", "01/2022", "2022-01" or "2022" to `YYYY-MM` (or `YYYY` when the month is
 * unknown). "Present" and friends give null. Anything with no year gives null.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || isPresent(s)) return null;
  let m = /^(\d{4})[-/.](\d{1,2})/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]!.padStart(2, "0")}`;
  m = /^([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const idx = MONTHS.indexOf(m[1]!.slice(0, 3));
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
  }
  m = /\b((?:19|20)\d{2})\b/.exec(s);
  return m ? m[1]! : null;
}

/** Months since year 0 for a `YYYY` or `YYYY-MM` date; a bare year counts from January (start) or December (end). */
export function monthIndex(date: string, edge: "start" | "end"): number | null {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(date);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) : edge === "start" ? 1 : 12;
  return Number(m[1]) * 12 + (month - 1);
}

export function currentMonthIndex(now = new Date()): number {
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

// ---- quantities -----------------------------------------------------------------------------------------------------

export type Metric = { value: number; unit: string | null; measures: string };

const MULT: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };
const num = (s: string) => Number(s.replace(/,/g, ""));

/** The numbers in one resume line, each with the words around it as "what it measures". Percentages, money, multiples and counts. */
export function extractMetrics(line: string): Metric[] {
  const out: Metric[] = [];
  const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);
  const seen = new Set<string>();
  const push = (m: Metric) => { const k = `${m.value}${m.unit}`; if (!seen.has(k)) { seen.add(k); out.push(m); } };
  for (const m of line.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) push({ value: Number(m[1]), unit: "%", measures: clip(line) });
  for (const m of line.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|mm|m|b|million|billion|thousand)?\b/gi)) {
    push({ value: num(m[1]!) * (MULT[(m[2] ?? "").toLowerCase()] ?? 1), unit: "USD", measures: clip(line) });
  }
  for (const m of line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\s?[x×](?![A-Za-z0-9])/gi)) push({ value: Number(m[1]), unit: "x", measures: clip(line) });
  for (const m of line.matchAll(/(?<![\w.$])(\d[\d,]*(?:\.\d+)?)\s?(k|m|b)?\+?\s+([A-Za-z][A-Za-z-]*)/gi)) {
    const unit = m[3]!.toLowerCase();
    if (/^(?:19|20)\d{2}$/.test(m[1]!) && !m[2]) continue;
    if (["years", "year", "yrs", "yr", "months", "month", "th", "st", "nd", "rd", "of", "and", "the", "to", "or"].includes(unit)) continue;
    push({ value: num(m[1]!) * (MULT[(m[2] ?? "").toLowerCase()] ?? 1), unit, measures: clip(line) });
  }
  return out.slice(0, 4);
}

/** Team size, user count and similar scope signals from one line. Empty object when there are none. */
export function extractScope(line: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  const team = /(?:team|group|squad)\s+of\s+(\d+)|(?:led|managed|mentored|supervised|directed|hired)\s+(?:a\s+)?(?:team\s+of\s+)?(\d+)(?:\+)?\s+(?:engineers?|developers?|people|reports|interns|analysts|designers)/i.exec(line);
  const size = team?.[1] ?? team?.[2];
  if (size) scope.teamSize = Number(size);
  const users = /(\d[\d,.]*\s?(?:k|m|b)?)\+?\s+(?:monthly\s+|daily\s+|active\s+)?(?:users|customers|clients|merchants|subscribers|requests|students)/i.exec(line);
  if (users) {
    const raw = users[1]!.replace(/\s/g, "");
    const mult = MULT[raw.slice(-1).toLowerCase()];
    scope.users = mult ? Number(raw.slice(0, -1).replace(/,/g, "")) * mult : Number(raw.replace(/,/g, ""));
  }
  const budget = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|mm|m|b|million|billion)?\s+(?:budget|spend|portfolio|revenue|in\s+revenue|arr)/i.exec(line);
  if (budget) scope.budget = `$${budget[1]}${(budget[2] ?? "").toUpperCase().replace("MILLION", "M").replace("BILLION", "B")}`;
  if (/\b(?:owned|led|founded|architected|spearheaded|ran)\b/i.test(line)) scope.ownership = "lead";
  return scope;
}
