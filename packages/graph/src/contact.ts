/**
 * Deterministic contact extraction from resume text plus the document's hyperlinks. No model involved: contact details
 * sit in the header, are short, and a regex that is right beats a model that is usually right.
 */
import { sectionOf } from "./text.js";
import type { ExtractedLink } from "./extract.js";

export type Contact = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  /** "City, ST" or "City, Country" as written, without postcode. */
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

// ---- geography ------------------------------------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const US_STATE_NAMES = new Set(Object.values(US_STATES).map((s) => s.toLowerCase()));
const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "u.s.": "United States", "u.s.a.": "United States", "united states of america": "United States",
  uk: "United Kingdom", "u.k.": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom",
  uae: "United Arab Emirates", holland: "Netherlands", "the netherlands": "Netherlands", korea: "South Korea", czechia: "Czech Republic",
};
const COUNTRIES = [
  "Argentina", "Australia", "Austria", "Bangladesh", "Belgium", "Brazil", "Bulgaria", "Canada", "Chile", "China", "Colombia",
  "Croatia", "Cyprus", "Czech Republic", "Denmark", "Egypt", "Estonia", "Finland", "France", "Germany", "Ghana", "Greece",
  "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Kenya", "Latvia", "Lithuania",
  "Luxembourg", "Malaysia", "Mexico", "Morocco", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru",
  "Philippines", "Poland", "Portugal", "Romania", "Saudi Arabia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea",
  "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Thailand", "Turkey", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Vietnam",
];
const COUNTRY_BY_LOWER = new Map<string, string>([...COUNTRIES.map((c) => [c.toLowerCase(), c] as [string, string]), ...Object.entries(COUNTRY_ALIASES)]);
const canonicalCountry = (s: string) => COUNTRY_BY_LOWER.get(s.trim().toLowerCase().replace(/\s+/g, " "));

// ---- patterns -------------------------------------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URLISH_RE = /\b(?:https?:\/\/|www\.)[^\s<>()|,;"'\]]+/gi;
const KNOWN_HOSTS = "linkedin\\.com|github\\.com|github\\.io|gitlab\\.com|medium\\.com|twitter\\.com|x\\.com|stackoverflow\\.com|kaggle\\.com|leetcode\\.com|behance\\.net|dribbble\\.com|huggingface\\.co";
const BARE_KNOWN_RE = new RegExp(`(?<![\\w.@/-])(?:[a-z0-9-]+\\.)*(?:${KNOWN_HOSTS})(?:\\/[^\\s<>()|,;"'\\]]*)?`, "gi");
const BARE_DOMAIN_RE = /(?<![\w.@/-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|app|ai|xyz|tech|site|page|design|codes|blog|info|in|ca|so|sh|studio|online)(?:\/[^\s<>()|,;"'\]]*)?(?![\w@])/gi;
const PHONE_RE = /(?<![\w/@.])(?:\+[ \t]?|00)?\(?\d[\d \t().\-–]{6,}\d(?![\w/@])/g;
const SEP = /\s*[|•·●▪◦✉☎☏\u{1F4CD}\u{1F4DE}\u{1F4E7}\u{1F517}]\s*|\s{3,}|\t|\s+[—–]\s+/u;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Contact regexes rescan long runs from every position; cap the text and blank any run no email, URL or phone could be. */
const MAX_CONTACT_CHARS = 60_000;
const bound = (text: string) => text.slice(0, MAX_CONTACT_CHARS).replace(/\S{200,}/g, " ").replace(/[\d \t().\-–]{40,}/g, " ");

// ---- urls -----------------------------------------------------------------------------------------------------------

/** https URL with lowercase host, no "www.", no trailing slash; social profiles lose query and fragment. */
function normalizeUrl(raw: string): string | null {
  let s = raw.trim().replace(/[.,;:!?)\]}>'"’”]+$/, "");
  if (!s || /^(?:mailto|tel|sms|javascript|data|file):/i.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(?:^|\.)linkedin\.com$/.test(host)) host = "linkedin.com";
  const social = /(?:^|\.)(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|behance\.net|dribbble\.com|kaggle\.com|leetcode\.com|stackoverflow\.com)$/.test(host);
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}${social ? "" : `${u.search}${u.hash}`}`;
}

const GITHUB_RESERVED = new Set(["features", "about", "topics", "sponsors", "orgs", "marketplace", "pricing", "login", "join", "settings", "explore", "collections", "trending", "enterprise", "team", "readme"]);
const OTHER_PROFILE_HOSTS = /(?:^|\.)(?:gitlab\.com|twitter\.com|x\.com|medium\.com|stackoverflow\.com|kaggle\.com|leetcode\.com|behance\.net|dribbble\.com|huggingface\.co|youtube\.com|instagram\.com|facebook\.com)$/;

type Kind = "linkedin" | "github" | "other-profile" | "website" | "ignore";
function classify(url: string): { kind: Kind; profile?: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { kind: "ignore" }; }
  const host = u.hostname;
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "linkedin.com") {
    return (segs[0] === "in" || segs[0] === "pub") && segs[1] ? { kind: "linkedin", profile: `https://linkedin.com/${segs[0]}/${segs.slice(1).join("/")}` } : { kind: "ignore" };
  }
  if (host === "github.com") {
    if (!segs[0] || GITHUB_RESERVED.has(segs[0].toLowerCase())) return { kind: "ignore" };
    return { kind: "github", profile: `https://github.com/${segs[0]}` };
  }
  if (host === "gist.github.com") return { kind: "ignore" };
  if (OTHER_PROFILE_HOSTS.test(host)) return { kind: "other-profile" };
  return { kind: "website" };
}

// ---- phone ----------------------------------------------------------------------------------------------------------

function validPhone(c: string): boolean {
  const digits = c.replace(/\D/g, "");
  if (/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(c.trim())) return false; // 2019 - 2022
  if (/\d{1,2}\/\d{2,4}/.test(c) || /\s{3,}/.test(c)) return false;
  if ((c.match(/\(/g)?.length ?? 0) !== (c.match(/\)/g)?.length ?? 0) && !/^\(/.test(c.trim())) return false;
  if (/^\s*(?:\+|00)/.test(c)) return digits.length >= 8 && digits.length <= 15;
  if (digits.startsWith("0")) return digits.length >= 10 && digits.length <= 12;
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function phonesIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(PHONE_RE)) {
    const c = m[0].trim().replace(/[\s–-]+$/, "");
    if (validPhone(c)) { out.push(clean(c)); continue; }
    // "WA 98101 (206) 555-0100": retry from each later group boundary.
    for (const x of c.matchAll(/[\s(]\(?(?=\d|\+)/g)) {
      const sub = c.slice((x.index ?? 0) + (x[0].startsWith("(") ? 0 : 1)).trim();
      if (validPhone(sub)) { out.push(clean(sub)); break; }
    }
  }
  return out;
}

// ---- location -------------------------------------------------------------------------------------------------------

const LOC_PREFIX = /^(?:location|address|based\s+in|lives?\s+in|home|city|residence)\s*[:\-–]?\s*/i;
const CITY_RE = /^\p{Lu}[\p{L}.'’-]*(?:\s+(?:\p{Lu}[\p{L}.'’-]*|de|del|la|le|upon|on|am|sur|of))*$/u;
type Loc = { location: string; city: string; state: string | null; country: string | null };

/** "City, ST", "City, State", "City, Country" or "City, Region, Country"; postcodes and "Location:" prefixes are tolerated. */
export function parseLocation(fragRaw: string): Loc | null {
  let f = clean(fragRaw).replace(LOC_PREFIX, "").replace(/[.;]+$/, "");
  if (!f || f.length > 70 || /@|https?:|www\./i.test(f)) return null;
  f = f.replace(/\s+\d{5}(?:-\d{4})?(?=$|,)/, "")
    .replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}(?=$|,)/, "")
    .replace(/\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d(?=$|,)/, "")
    .replace(/\s+\d{6}(?=$|,)/, "");
  const parts = f.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  const tail = parts.length > 3 || /\d/.test(parts[0]!) ? parts.slice(-3).filter((p) => !/\d/.test(p)) : parts;
  if (tail.length < 2 || tail.length > 3) return null;
  const [city = "", a = "", b] = tail;
  if (!CITY_RE.test(city) || city.split(" ").length > 4) return null;
  const location = tail.join(", ");
  if (b !== undefined) {
    const country = canonicalCountry(b);
    if (country && /^\p{Lu}[\p{L} .'-]*$/u.test(a)) return { location, city, state: a, country };
    return null;
  }
  if (/^[A-Z]{2}$/.test(a) && US_STATES[a]) return { location, city, state: a, country: "United States" };
  if (CA_PROVINCES.has(a)) return { location, city, state: a, country: "Canada" };
  if (US_STATE_NAMES.has(a.toLowerCase())) return { location, city, state: a, country: "United States" };
  const country = canonicalCountry(a);
  return country ? { location, city, state: null, country } : null;
}

const stripContactNoise = (line: string) =>
  line.replace(EMAIL_RE, " | ").replace(URLISH_RE, " | ").replace(BARE_KNOWN_RE, " | ").replace(PHONE_RE, (m) => (validPhone(m.trim()) ? " | " : m));

function findLocation(head: string[], fallback: string[]): Loc | null {
  const scan = (lines: string[]): Loc | null => {
    for (const l of lines) {
      if (sectionOf(l)) continue;
      const stripped = stripContactNoise(l);
      for (const frag of stripped.split(SEP)) {
        const loc = parseLocation(frag);
        if (loc) return loc;
      }
      const m = /(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3}),\s*([A-Z]{2})\b(?!\.)/u.exec(stripped);
      if (m && US_STATES[m[2]!]) return { location: `${m[1]}, ${m[2]}`, city: m[1]!, state: m[2]!, country: "United States" };
    }
    return null;
  };
  return scan(head) ?? scan(fallback);
}

// ---- name -----------------------------------------------------------------------------------------------------------

const CREDENTIALS = "PMP|MBA|Ph\\.?\\s?D\\.?|CPA|CFA|P\\.?E\\.?|RN|MD|M\\.D\\.|CISSP|CSM|M\\.?S\\.?c?|B\\.?S\\.?c?|M\\.?A\\.?|B\\.?A\\.?|J\\.?D\\.?|Esq\\.?|Jr\\.?|Sr\\.?|II|III|IV";
const CRED_SUFFIX = new RegExp(`(?:\\s*,\\s*|\\s+)(?:${CREDENTIALS})(?:\\s*,\\s*(?:${CREDENTIALS}))*\\.?$`, "i");
const PARTICLES = new Set(["van", "von", "de", "der", "den", "da", "das", "dos", "del", "della", "di", "du", "le", "la", "bin", "binti", "al", "el", "ter", "ten", "y"]);
const NOT_NAME = /\b(?:resume|résumé|curriculum|vitae|cv|portfolio|engineer|developer|manager|designer|analyst|scientist|consultant|specialist|director|architect|officer|intern|lead|president|founder|coordinator|administrator|associate|summary|profile|objective|experience|education|skills|contact|street|avenue|road|suite|apt|university|college|inc|llc|ltd|corp|technologies|solutions)\b/i;
const NAME_TOKEN = /^(?:\p{Lu}[\p{L}'’]*(?:-\p{Lu}?[\p{L}'’]+)*\.?|\p{Lu}\.)$/u;

function titleCaseName(s: string): string {
  const words = s.split(" ");
  if (!words.some((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}{2}/u.test(w))) return s;
  return words.map((w, i) => {
    if (/^\p{Lu}\.?$/u.test(w)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && PARTICLES.has(lower)) return lower;
    return lower.replace(/(^|[-'’])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  }).join(" ");
}

function nameCandidate(segment: string): string | null {
  let t = clean(segment).replace(/^#+\s*/, "").replace(/\*\*|__/g, "").replace(/^(?:name\s*:\s*)/i, "");
  t = t.replace(CRED_SUFFIX, "").replace(CRED_SUFFIX, "").replace(/[,;:]+$/, "").trim();
  if (!t || t.includes("@") || /\d/.test(t) || /https?:|www\.|\.com\b/i.test(t) || sectionOf(t) || NOT_NAME.test(t)) return null;
  const tokens = t.split(" ");
  const core = tokens.filter((w) => !PARTICLES.has(w.toLowerCase()));
  if (core.length < 2 || core.length > 4 || tokens.length > 5) return null;
  if (!tokens.every((w) => PARTICLES.has(w.toLowerCase()) || NAME_TOKEN.test(w))) return null;
  if (core.filter((w) => w.replace(/\./g, "").length > 1).length < 2) return null;
  return titleCaseName(t);
}

function findName(lines: string[]): string | null {
  const top = lines.map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of top) {
    const sec = sectionOf(line);
    if (sec === "contact") continue;
    if (sec) break;
    const segs = line.split(SEP).filter((s) => s.trim());
    const cand = segs.length ? nameCandidate(segs[0]!) : null;
    if (cand) return cand;
  }
  // Fallback: the longest mostly-capitalised line in the first five.
  let best: string | null = null;
  for (const l of top.slice(0, 5)) {
    const seg = clean(l.split(SEP)[0] ?? "").replace(CRED_SUFFIX, "");
    if (!seg || /[@\d,]|https?:|www\./i.test(seg) || sectionOf(seg) || parseLocation(seg)) continue;
    const words = seg.split(" ");
    if (words.length < 2 || words.length > 5 || NOT_NAME.test(seg)) continue;
    if (words.filter((w) => /^\p{Lu}/u.test(w)).length < words.length - 1) continue;
    if (!best || seg.length > best.length) best = seg;
  }
  return best ? titleCaseName(best) : null;
}

// ---- entry point ----------------------------------------------------------------------------------------------------

/** Lines before the first content section, plus any "Contact" / "Links" section (sidebars). */
function headRegion(lines: string[]): string[] {
  const idx: number[] = [];
  let inHead = true, inContact = false, sawHeading = false;
  lines.forEach((l, i) => {
    const sec = sectionOf(l);
    if (sec) { sawHeading = true; inHead = false; inContact = sec === "contact"; return; }
    if ((inHead || inContact) && l.trim()) idx.push(i);
  });
  const picked = sawHeading ? idx : lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0).slice(0, 12);
  return picked.filter((i, n) => n < 15 || i <= 25).map((i) => lines[i]!);
}

type Cand = { url: string; kind: Kind; profile?: string; conf: number; inHead: boolean; order: number };
const LABELED = /\b(linkedin|github)\s*(?::|-|–|—)\s*(?:@)?((?:in\/)?[A-Za-z0-9][A-Za-z0-9_.-]{1,60})\b/gi;

/** Name, email, phone, LinkedIn, GitHub, website and location from resume text (and, when known, the document's hyperlinks). */
export function parseContact(textRaw: string, links: readonly ExtractedLink[] = []): Contact {
  const text = bound(textRaw.replace(/\r\n?/g, "\n"));
  const lines = text.split("\n");
  const head = headRegion(lines);
  const headText = head.join("\n");
  const out: Contact = { fullName: null, email: null, phone: null, linkedin: null, github: null, website: null, location: null, city: null, state: null, country: null };

  // Email and phone: hyperlinks win, then the header, then anywhere.
  const linkEmails: string[] = [], linkPhones: string[] = [];
  const cands: Cand[] = [];
  let order = 0;
  for (const l of links) {
    const raw = l.url.trim();
    if (/^mailto:/i.test(raw)) { try { linkEmails.push(decodeURIComponent(raw.slice(7).split("?")[0] ?? "").trim()); } catch { /* malformed escape */ } continue; }
    if (/^tel:/i.test(raw)) { linkPhones.push(clean(l.anchor && /\d{3}/.test(l.anchor) ? l.anchor : raw.slice(4))); continue; }
    const url = normalizeUrl(raw);
    if (!url) continue;
    const c = classify(url);
    cands.push({ url, kind: c.kind, profile: c.profile, conf: 1, inHead: true, order: order++ });
  }
  out.email = linkEmails.find(Boolean) ?? headText.match(EMAIL_RE)?.[0] ?? text.match(EMAIL_RE)?.[0] ?? null;
  out.phone = head.flatMap(phonesIn)[0] ?? linkPhones[0] ?? lines.slice(0, 20).flatMap(phonesIn)[0] ?? lines.flatMap(phonesIn)[0] ?? null;
  out.fullName = findName(lines);

  const loc = findLocation(head, lines.filter((l) => l.trim()).slice(0, 15));
  if (loc) ({ location: out.location, city: out.city, state: out.state, country: out.country } = loc);

  // URLs in the text.
  const headSet = new Set(head);
  lines.forEach((line) => {
    const inHead = headSet.has(line);
    const noEmail = line.replace(EMAIL_RE, " ");
    const add = (raw: string, conf: number) => {
      const url = normalizeUrl(raw);
      if (!url) return;
      const c = classify(url);
      cands.push({ url, kind: c.kind, profile: c.profile, conf, inHead, order: order++ });
    };
    for (const m of noEmail.matchAll(URLISH_RE)) add(m[0], 0.95);
    const noUrls = noEmail.replace(URLISH_RE, " ");
    for (const m of noUrls.matchAll(BARE_KNOWN_RE)) add(m[0], 0.9);
    if (inHead) for (const m of noUrls.replace(BARE_KNOWN_RE, " ").matchAll(BARE_DOMAIN_RE)) add(m[0], 0.88);
    for (const m of noUrls.matchAll(LABELED)) {
      const handle = m[2]!;
      if (/\.(?:com|net|org|io)\b/i.test(handle)) continue;
      add(m[1]!.toLowerCase() === "linkedin" ? `https://linkedin.com/in/${handle.replace(/^in\//i, "")}` : `https://github.com/${handle}`, 0.85);
    }
  });
  const ranked = [...cands].sort((a, b) => b.conf - a.conf || a.order - b.order);
  const li = ranked.find((c) => c.kind === "linkedin");
  if (li) out.linkedin = li.profile ?? li.url;
  const gh = ranked.find((c) => c.kind === "github");
  if (gh) out.github = gh.profile ?? gh.url;
  const emailHost = out.email?.split("@")[1]?.toLowerCase();
  const site = ranked.find((c) => c.kind === "website" && c.inHead && !(emailHost && new URL(c.url).hostname === emailHost && /^(?:gmail|yahoo|outlook|hotmail|icloud|proton)/.test(emailHost)));
  if (site) out.website = site.url;
  return out;
}
