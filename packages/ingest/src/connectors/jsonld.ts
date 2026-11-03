import { htmlToText } from "../html.js";
import { parseDate, REMOTE_RE } from "../util.js";
import { joinParts, str, uniq } from "./feed-kit.js";

/**
 * Parse the schema.org `JobPosting` JSON-LD that many career pages embed (iCIMS, Breezy and others). Handles several
 * `<script type="application/ld+json">` blocks, `@graph` arrays, top-level arrays, several locations, `validThrough`
 * in the past (closed) and `jobLocationType: TELECOMMUTE` (remote). The idea of reading JSON-LD from iCIMS detail
 * pages comes from the MIT-licensed kalil0321/ats-scrapers (scrapers/icims.py); this implementation is new.
 */

export type JobPostingFields = {
  title: string | null;
  /** Plain text. */
  descriptionText: string;
  /** All places joined with " | "; null when the posting names none. */
  location: string | null;
  remote: boolean;
  /** The posting's own `url` when present, else the page it was read from. */
  applyUrl: string;
  postedAt: Date | null;
  validThrough: Date | null;
  /** `validThrough` is in the past. */
  closed: boolean;
  companyName: string | null;
  /** Raw schema.org value (FULL_TIME ...); first one when it is a list. */
  employmentType: string | null;
  department: string | null;
  /** `identifier` (string or PropertyValue.value), when present. */
  identifier: string | null;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

function parseBlock(raw: string): unknown {
  const body = raw.trim().replace(/^<!--/, "").replace(/-->$/, "").replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, "").trim();
  if (!body) return null;
  try { return JSON.parse(body); } catch { /* raw newlines or tabs inside strings are common */ }
  try { return JSON.parse(Array.from(body, (ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("")); } catch { return null; }
}

function isJobPosting(n: Json): boolean {
  const t = n["@type"];
  return Array.isArray(t) ? t.includes("JobPosting") : t === "JobPosting";
}

function collect(node: unknown, out: Json[]): void {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
  if (!isObj(node)) return;
  if (isJobPosting(node)) out.push(node);
  if (node["@graph"] !== undefined) collect(node["@graph"], out);
  if (node["mainEntity"] !== undefined) collect(node["mainEntity"], out);
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const asList = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** A name from a string or an object with `name`. */
function nameOf(v: unknown): string | null {
  const x = first(v);
  if (typeof x === "string") return str(x);
  return isObj(x) ? str(x["name"]) : null;
}

const clean = (s: string | null): string | null => (s && !/^(unavailable|n\/a|null|undefined)$/i.test(s) ? s : null);

function placeText(place: unknown): string | null {
  if (typeof place === "string") return clean(str(place));
  if (!isObj(place)) return null;
  const addr = place["address"];
  if (typeof addr === "string") return clean(str(addr));
  if (isObj(addr)) {
    const text = joinParts([clean(nameOf(addr["addressLocality"])), clean(nameOf(addr["addressRegion"])), clean(nameOf(addr["addressCountry"]))]);
    if (text) return text;
  }
  return clean(str(place["name"]));
}

function dateOf(v: unknown): Date | null { return typeof v === "string" || typeof v === "number" ? parseDate(v) : null; }

/** `validThrough` as an instant; a bare date means the whole day is still open. */
function validThroughOf(v: unknown): Date | null {
  const d = dateOf(v);
  if (!d) return null;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? new Date(d.getTime() + 24 * 3600 * 1000) : d;
}

function toFields(p: Json, pageUrl: string, now: Date): JobPostingFields {
  const places = asList(p["jobLocation"]).map(placeText);
  let location = uniq(places).join(" | ") || null;
  const types = asList(p["jobLocationType"]).map((t) => String(t).toUpperCase());
  const telecommute = types.some((t) => t.includes("TELECOMMUTE"));
  if (!location && telecommute) {
    const reqs = uniq(asList(p["applicantLocationRequirements"]).map((r) => nameOf(r)));
    location = reqs.length ? `Remote (${reqs.join(", ")})` : null;
  }
  const title = str(p["title"]) ?? str(p["name"]);
  const validThrough = validThroughOf(p["validThrough"]);
  const ident = first(p["identifier"]);
  const dept = first(p["occupationalCategory"]) ?? first(p["industry"]);
  return {
    title,
    descriptionText: typeof p["description"] === "string" ? htmlToText(p["description"]) : "",
    location,
    remote: telecommute || REMOTE_RE.test(location ?? ""),
    applyUrl: str(p["url"]) ?? pageUrl,
    postedAt: dateOf(p["datePosted"]),
    validThrough,
    closed: validThrough !== null && validThrough.getTime() < now.getTime(),
    companyName: nameOf(p["hiringOrganization"]),
    employmentType: typeof first(p["employmentType"]) === "string" ? str(first(p["employmentType"])) : null,
    department: typeof dept === "string" ? str(dept) : null,
    identifier: typeof ident === "string" || typeof ident === "number" ? str(String(ident)) : isObj(ident) ? str(String(ident["value"] ?? "")) : null,
  };
}

/** Every JobPosting on the page, in document order. */
export function parseJobPostingsJsonLd(html: string, pageUrl: string, now: Date = new Date()): JobPostingFields[] {
  const found: Json[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) collect(parseBlock(m[1] ?? ""), found);
  return found.map((p) => toFields(p, pageUrl, now));
}

/** The first JobPosting on the page, or null when it has none. */
export function parseJobPostingJsonLd(html: string, pageUrl: string, now: Date = new Date()): JobPostingFields | null {
  return parseJobPostingsJsonLd(html, pageUrl, now)[0] ?? null;
}
