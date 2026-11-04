import { and, companies, eq, freshJobSql, inArray, isNull, jobs, lt, lte, or, shortlist, sql } from "@norinote/db";
import type { Db } from "@norinote/db";
import { normalizeCompany, normalizeText } from "./dedupe.js";

/** Companies checked per run. Each run is two reads and one update per company found, no outside requests. */
export const LOGO_BATCH_SIZE = 500;
/** A company whose postings named no domain is searched again after this long (new postings bring new clues). */
export const LOGO_RECHECK_DAYS = 7;
/** Newest fresh postings read per company. */
export const LOGO_POSTINGS_PER_COMPANY = 5;
/** Characters of each description searched. */
const TEXT_CHARS = 20_000;

/** Trailing words a company drops from its domain: "Scale AI" is scale.com, "Acme Labs" is acme.com. */
const GENERIC_TAIL = new Set([
  "ai", "app", "apps", "company", "global", "group", "health", "holdings", "hq", "inc", "international", "io", "lab", "labs",
  "software", "solutions", "studio", "studios", "systems", "tech", "technologies", "technology", "usa",
]);
/** Words companies wrap around their name in a domain: getacme.com, acmehq.com, acme-careers.com. */
const LABEL_PREFIX = /^(get|try|join|use|go|hello|meet|with)(?=[a-z0-9]{3})/;
const LABEL_SUFFIX = /(hq|app|inc|careers|jobs|team|labs|ai|io)$/;
/** Public suffixes with two labels, so careers.acme.co.uk is acme.co.uk. */
const TWO_PART_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.in", "co.jp", "com.br", "com.mx", "co.za", "com.sg", "com.cn",
  "co.il", "com.tr",
]);
/** File extensions that look like a top-level domain in text ("Node.js", "resume.pdf"). */
const NOT_TLD = new Set(["js", "jsx", "ts", "tsx", "py", "rb", "md", "pdf", "png", "jpg", "jpeg", "gif", "svg", "txt", "doc", "docx", "csv", "json", "html"]);

const EMAIL_RE = /[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi;
const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})\b/gi;

/**
 * The name as domain labels could spell it: "Scale AI, Inc." gives "scaleai", "scaleaiinc" and "scale". Keys under 3
 * characters are dropped.
 */
function nameKeys(name: string): Set<string> {
  const words = normalizeCompany(name).split(" ").filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  const keys = new Set<string>();
  const add = (ws: string[]) => { const k = ws.join(""); if (k.length >= 3) keys.add(k); };
  add(words);
  // With the legal suffix too: "Quiet Co" is often quietco.com.
  const full = normalizeText(name).split(" ").filter(Boolean);
  add(full[0] === "the" && full.length > 1 ? full.slice(1) : full);
  for (let ws = words; ws.length > 1 && GENERIC_TAIL.has(ws[ws.length - 1]!);) { ws = ws.slice(0, -1); add(ws); }
  return keys;
}

/** A registrable domain's own label with the usual prefixes and suffixes taken off: "getacme" and "acmehq" give "acme". */
function labelKeys(label: string): string[] {
  const l = label.replace(/-/g, "");
  const noPrefix = l.replace(LABEL_PREFIX, "");
  return [...new Set([l, noPrefix, l.replace(LABEL_SUFFIX, ""), noPrefix.replace(LABEL_SUFFIX, "")])].filter((k) => k.length >= 3);
}

/** "careers.acme.co.uk" to { domain: "acme.co.uk", label: "acme" }. Null for hosts that are not a domain name. */
export function registrableDomain(host: string): { domain: string; label: string } | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9-]+$/.test(l))) return null;
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,24}$/.test(tld)) return null;
  const take = labels.length >= 3 && TWO_PART_SUFFIX.has(labels.slice(-2).join(".")) ? 3 : 2;
  const label = labels[labels.length - take]!;
  if (!label || label.startsWith("-") || label.endsWith("-")) return null;
  return { domain: labels.slice(-take).join("."), label };
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname || null; } catch { return null; }
}

/**
 * The company's own web domain as its postings show it, or null. Candidates are the apply link's host, addresses
 * (accommodations@acme.com) and domains written in the text (acme.com/careers). A candidate counts only when its label
 * spells the company's name (acme.com, getacme.com, acmehq.com for "Acme, Inc."), so job systems, mail providers and
 * other companies' sites never match. The best-supported domain wins: an apply link counts 3, an address 2, a mention 1.
 */
export function logoDomainFromPostings(companyName: string, postings: readonly { applyUrl: string; descriptionText: string }[]): string | null {
  const names = nameKeys(companyName);
  if (names.size === 0) return null;
  const weight = new Map<string, number>();
  const consider = (host: string, w: number, fromText: boolean) => {
    const r = registrableDomain(host);
    if (!r) return;
    const tld = r.domain.split(".").pop()!;
    // flix.careers is a careers site; logo services know the brand domain.
    if (tld === "careers" || tld === "jobs" || (fromText && NOT_TLD.has(tld))) return;
    if (!labelKeys(r.label).some((k) => names.has(k))) return;
    weight.set(r.domain, (weight.get(r.domain) ?? 0) + w);
  };
  for (const p of postings) {
    const host = hostOf(p.applyUrl);
    if (host) consider(host, 3, false);
    const text = p.descriptionText.slice(0, TEXT_CHARS);
    for (const m of text.matchAll(EMAIL_RE)) consider(m[1]!, 2, false);
    // Addresses also match as plain domains; take the text without them so they are not counted twice.
    for (const m of text.replace(EMAIL_RE, " ").matchAll(HOST_RE)) consider(m[1]!, 1, true);
  }
  let best: string | null = null;
  let bestWeight = 0;
  for (const [domain, w] of weight) if (w > bestWeight) { best = domain; bestWeight = w; }
  return best;
}

export type LogoDomainOptions = {
  now?: Date;
  batchSize?: number;
  recheckDays?: number;
  postingsPerCompany?: number;
};

export type LogoDomainResult = { checked: number; found: number };

/**
 * Fills `companies.logo_domain` for companies that have fresh jobs (the ones users can see), companies on someone's
 * shortlist first. Reads only our own postings: no outside lookups, and nothing from a logo service is stored (their
 * terms ask for live lookups). Companies with a seed-known `domain` are skipped; the API uses that one. A company with
 * no match is looked at again after `recheckDays`.
 */
export async function resolveLogoDomains(db: Db, opts: LogoDomainOptions = {}): Promise<LogoDomainResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? LOGO_BATCH_SIZE));
  const perCompany = Math.max(1, Math.floor(opts.postingsPerCompany ?? LOGO_POSTINGS_PER_COMPANY));
  const recheck = new Date(now.getTime() - (opts.recheckDays ?? LOGO_RECHECK_DAYS) * 86_400_000);

  const due = await db.select({ id: companies.id, name: companies.name }).from(companies)
    .where(and(
      isNull(companies.logoDomain), isNull(companies.domain), eq(companies.blocked, false),
      or(isNull(companies.logoCheckedAt), lt(companies.logoCheckedAt, recheck)),
      sql`EXISTS (SELECT 1 FROM ${jobs} WHERE ${jobs.companyId} = ${companies.id} AND ${jobs.closedAt} IS NULL AND ${freshJobSql(now)})`,
    ))
    .orderBy(
      sql`EXISTS (SELECT 1 FROM ${shortlist} INNER JOIN ${jobs} ON ${jobs.id} = ${shortlist.jobId} WHERE ${jobs.companyId} = ${companies.id}) DESC`,
      sql`${companies.logoCheckedAt} ASC NULLS FIRST`,
    )
    .limit(batchSize);
  if (due.length === 0) return { checked: 0, found: 0 };

  const ids = due.map((c) => c.id);
  const ranked = db.select({
    companyId: jobs.companyId,
    applyUrl: jobs.applyUrl,
    descriptionText: sql<string>`left(${jobs.descriptionText}, ${TEXT_CHARS})`.as("description_text"),
    rn: sql<number>`row_number() over (partition by ${jobs.companyId} order by ${jobs.firstSeenAt} desc)`.as("rn"),
  }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(inArray(jobs.companyId, ids), isNull(jobs.closedAt), freshJobSql(now)))
    .as("ranked");
  const rows = await db.select({ companyId: ranked.companyId, applyUrl: ranked.applyUrl, descriptionText: ranked.descriptionText })
    .from(ranked).where(lte(ranked.rn, perCompany));
  const byCompany = new Map<string, { applyUrl: string; descriptionText: string }[]>();
  for (const r of rows) {
    const list = byCompany.get(r.companyId) ?? [];
    list.push({ applyUrl: r.applyUrl, descriptionText: r.descriptionText ?? "" });
    byCompany.set(r.companyId, list);
  }

  let found = 0;
  const missed: string[] = [];
  for (const c of due) {
    const domain = logoDomainFromPostings(c.name, byCompany.get(c.id) ?? []);
    if (!domain) { missed.push(c.id); continue; }
    await db.update(companies).set({ logoDomain: domain, logoCheckedAt: now }).where(eq(companies.id, c.id));
    found++;
  }
  if (missed.length) await db.update(companies).set({ logoCheckedAt: now }).where(inArray(companies.id, missed));
  return { checked: due.length, found };
}
