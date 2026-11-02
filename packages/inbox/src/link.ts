import { applications, and, companies, eq, gte, jobs, type Db } from "@norinote/db";
import type { ApplicationStatus, InboxKind } from "@norinote/shared";

const MAIL_PROVIDERS = new Set(["gmail", "googlemail", "yahoo", "outlook", "hotmail", "live", "msn", "icloud", "me", "aol", "proton", "protonmail", "pm", "gmx", "mail", "zoho", "fastmail", "hey"]);
const ATS_DOMAINS = new Set(["greenhouse", "greenhouse-mail", "lever", "ashbyhq", "myworkday", "myworkdayjobs", "workday", "smartrecruiters", "workable", "icims", "jobvite", "bamboohr", "recruitee", "breezy", "teamtailor", "applytojob", "successfactors", "taleo", "rippling", "gem", "hire", "eightfold", "dover", "oraclecloud"]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** Letters and digits only, lower-case, company suffixes dropped: "Acme, Inc." becomes "acme". */
export const norm = (s: string): string =>
  s.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

function domainBase(domain: string): string {
  if (!domain) return "";
  const labels = domain.split(".");
  const tld = labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2] ?? "") ? 3 : 2;
  return (labels.length >= tld ? labels[labels.length - tld] : labels[0]) ?? "";
}

/** The registrable label of an address's domain: "acme" for jobs@mail.acme.co.uk. Empty when there is none. */
export function senderBase(address: string): string {
  const domain = address.split("@")[1]?.toLowerCase().replace(/[>\s].*$/, "");
  return domainBase(domain ?? "");
}

/** Mail sent by an applicant-tracking system (greenhouse-mail.io, lever.co, ...). */
export const fromAts = (address: string): boolean => ATS_DOMAINS.has(senderBase(address));

const sameName = (a: string, b: string): boolean =>
  a.length >= 2 && b.length >= 2 && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));

/**
 * Whether this sender may speak for the company: its own domain, or an ATS whose display name names the company.
 * Anyone can write "Acme" in a subject line, so a status change (rejection, offer, interview) needs this.
 */
export function senderSpeaksFor(from: { address: string; name: string }, companyName: string): boolean {
  const company = norm(companyName);
  if (company.length < 2) return false;
  const base = norm(senderBase(from.address));
  if (base && !MAIL_PROVIDERS.has(base) && !ATS_DOMAINS.has(base) && sameName(base, company)) return true;
  if (fromAts(from.address)) {
    const display = norm(from.name);
    return display.length >= 2 && display.includes(company);
  }
  return false;
}

export type AppCandidate = {
  id: string; status: ApplicationStatus; companyName: string; title: string; applyUrl: string; updatedAt: Date;
};

const ACTIVE: ApplicationStatus[] = ["awaiting_code", "applying"];
const LINK_WINDOW_DAYS = 120;

/** The user's recent applications with their company, for linking a message to one of them. */
export async function loadCandidates(db: Db, userId: string, now: Date): Promise<AppCandidate[]> {
  const since = new Date(now.getTime() - LINK_WINDOW_DAYS * 86_400_000);
  return db
    .select({ id: applications.id, status: applications.status, companyName: companies.name, title: jobs.title, applyUrl: jobs.applyUrl, updatedAt: applications.updatedAt })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, since)));
}

function hostBase(url: string): string {
  try { return domainBase(new URL(url).hostname.toLowerCase()); } catch { return ""; }
}

type Mail = { from: string; fromName: string; subject: string; text: string };

/**
 * How strongly a message points at one application, 0 for none: the sender's own domain (or the ATS display name) naming
 * the company, the subject naming it, the start of the body naming it; plus a point when the job title appears.
 */
function evidence(c: AppCandidate, email: Mail): number {
  const company = norm(c.companyName);
  if (company.length < 2) return 0;
  const base = norm(senderBase(email.from));
  let score = 0;
  if (base && !MAIL_PROVIDERS.has(base) && !ATS_DOMAINS.has(base)) {
    const applyBase = hostBase(c.applyUrl);
    if (sameName(base, company)) score = 4;
    else if (applyBase && !ATS_DOMAINS.has(applyBase) && base === norm(applyBase)) score = 4;
  }
  if (score === 0 && fromAts(email.from) && norm(email.fromName).includes(company)) score = 4;
  if (company.length >= 3 && norm(email.subject).includes(company)) score = Math.max(score, 3);
  if (company.length >= 4 && norm(email.text.slice(0, 3000)).includes(company)) score = Math.max(score, 2);
  if (score === 0) return 0;
  const title = c.title.trim().toLowerCase();
  if (title.length >= 5 && `${email.subject}\n${email.text}`.toLowerCase().includes(title)) score += 1;
  return score;
}

/**
 * The application a message most likely belongs to: the strongest evidence wins; on a tie, one that is applying or waiting
 * for a code (for a code mail) or already submitted (for anything else), then the most recently updated.
 */
export function pickApplication(candidates: readonly AppCandidate[], email: Mail, kind: InboxKind): AppCandidate | null {
  const scored = candidates.map((c) => ({ c, score: evidence(c, email) })).filter((x) => x.score > 0);
  if (!scored.length) return null;
  const phase = (c: AppCandidate) => ((kind === "verification_code" ? ACTIVE.includes(c.status) : c.status === "submitted") ? 1 : 0);
  scored.sort((a, b) => b.score - a.score || phase(b.c) - phase(a.c) || b.c.updatedAt.getTime() - a.c.updatedAt.getTime());
  return scored[0]?.c ?? null;
}
