import { applications, and, companies, eq, gte, jobs, type Db } from "@norinote/db";
import type { ApplicationStatus, AtsType, InboxKind } from "@norinote/shared";

const MAIL_PROVIDERS = new Set(["gmail", "googlemail", "yahoo", "outlook", "hotmail", "live", "msn", "icloud", "me", "aol", "proton", "protonmail", "pm", "gmx", "mail", "zoho", "fastmail", "hey"]);
/** Registrable labels of job-system mail and site domains, and the job system each one belongs to (null: not one we connect to). */
const ATS_SENDERS: Record<string, AtsType | null> = {
  greenhouse: "greenhouse", "greenhouse-mail": "greenhouse", lever: "lever", ashbyhq: "ashby", myworkday: "workday", myworkdayjobs: "workday",
  myworkdaysite: "workday", workday: "workday", smartrecruiters: "smartrecruiters", workable: "workable", icims: "icims", recruitee: "recruitee",
  teamtailor: "teamtailor", bamboohr: "bamboohr", breezy: "breezy", "breezy-mail": "breezy", rippling: "rippling", "rippling-ats": "rippling",
  pinpointhq: "pinpoint", personio: "personio", oraclecloud: "oracle", taleo: "oracle", jobvite: null, applytojob: null, successfactors: null,
  gem: null, hire: null, eightfold: null, dover: null,
};
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

const isAtsBase = (base: string): boolean => Object.prototype.hasOwnProperty.call(ATS_SENDERS, base);

/** Mail sent by an applicant-tracking system (greenhouse-mail.io, lever.co, ...). */
export const fromAts = (address: string): boolean => isAtsBase(senderBase(address));

/** The job system that sent this mail, when we know it. */
export const atsOfSender = (address: string): AtsType | null => ATS_SENDERS[senderBase(address)] ?? null;

const sameName = (a: string, b: string): boolean =>
  a.length >= 2 && b.length >= 2 && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));

/** Suffixes companies put on their own mail domains: acmecareers.com, acmehq.com, getacme.io. */
const DOMAIN_SUFFIXES = ["careers", "jobs", "hq", "inc", "team", "app", "labs", "group", "corp", "tech", "hr", "recruiting", "talent", "mail", "global", "usa", "us", "ai", "io"];
/**
 * Strict: the sender's domain is the company's own (acmerobotics.com for Acme Robotics, acmecareers.com, getacme.com), not
 * merely a domain that contains the name (acme-careers-example.net is anyone's). Used for trust, not for linking.
 */
function ownDomain(base: string, company: string): boolean {
  if (company.length < 2) return false;
  if (base === company) return true;
  return DOMAIN_SUFFIXES.some((s) => base === `${company}${s}`) || base === `get${company}` || base === `join${company}` || base === `try${company}`;
}

function hostBase(url: string): string {
  try { return domainBase(new URL(url).hostname.toLowerCase()); } catch { return ""; }
}

/**
 * Whether this sender may speak for the company: its own domain (or its careers domain), or an ATS whose display name
 * names the company. Anyone can write "Acme" in a subject line, so a status change (rejection, offer, interview) or a
 * code typed into a form needs this.
 */
export function senderSpeaksFor(from: { address: string; name: string }, companyName: string, companyDomain?: string | null): boolean {
  const company = norm(companyName);
  if (company.length < 2) return false;
  const base = norm(senderBase(from.address));
  if (base && !MAIL_PROVIDERS.has(base) && !isAtsBase(base)) {
    if (ownDomain(base, company)) return true;
    if (companyDomain && base === norm(domainBase(companyDomain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? ""))) return true;
  }
  if (fromAts(from.address)) {
    const display = norm(from.name);
    return display.length >= 2 && display.includes(company);
  }
  return false;
}

export type AppCandidate = {
  id: string; status: ApplicationStatus; companyName: string; companyDomain: string | null; atsType: AtsType; atsToken: string;
  title: string; applyUrl: string; externalId: string; updatedAt: Date;
};

const WAITING: ApplicationStatus[] = ["awaiting_code", "applying"];
const LINK_WINDOW_DAYS = 120;

/** The user's recent applications with their company, for linking a message to one of them. */
export async function loadCandidates(db: Db, userId: string, now: Date): Promise<AppCandidate[]> {
  const since = new Date(now.getTime() - LINK_WINDOW_DAYS * 86_400_000);
  return db
    .select({
      id: applications.id, status: applications.status, companyName: companies.name, companyDomain: companies.domain, atsType: jobs.atsType,
      atsToken: companies.atsToken, title: jobs.title, applyUrl: jobs.applyUrl, externalId: jobs.externalId, updatedAt: applications.updatedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), gte(applications.createdAt, since)));
}

export type LinkMail = { from: string; fromName: string; subject: string; text: string; links?: readonly string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A job-system reference that appears in the mail: the posting's external id, or the board token in a link. */
function referenceScore(c: AppCandidate, hay: string, links: readonly string[]): { score: number; why: string | null } {
  const ext = c.externalId.trim();
  // Ids short or plain enough to collide with other numbers ("12") do not count.
  if (ext.length >= 5 || (ext.length >= 4 && /[a-z-]/i.test(ext))) {
    if (new RegExp(`(^|[^A-Za-z0-9])${escapeRe(ext)}([^A-Za-z0-9]|$)`, "i").test(hay)) return { score: 5, why: "job reference" };
  }
  const token = c.atsToken.trim().toLowerCase();
  if (token.length >= 3) {
    const tokenRe = new RegExp(`(boards\\.greenhouse\\.io|job-boards\\.greenhouse\\.io|jobs\\.lever\\.co|jobs\\.ashbyhq\\.com|jobs\\.smartrecruiters\\.com|apply\\.workable\\.com)/${escapeRe(token)}(/|\\b)|//${escapeRe(token)}\\.(wd\\d+\\.)?myworkday(jobs|site)?\\.com`, "i");
    if (links.some((l) => tokenRe.test(l)) || tokenRe.test(hay)) return { score: 3, why: "board link" };
  }
  return { score: 0, why: null };
}

/**
 * How strongly a message points at one application, 0 for none. Sender domain naming the company (or matching its careers
 * or apply domain) 4; the ATS display name naming it 4; a job reference id 5; a board link 3; the subject naming the
 * company 3; the start of the body 2. Plus 1 when the job title appears, plus 1 when the sending ATS is the job's ATS.
 */
function evidence(c: AppCandidate, email: LinkMail): { score: number; why: string[] } {
  const company = norm(c.companyName);
  const base = norm(senderBase(email.from));
  const hay = `${email.subject}\n${email.text}`;
  const why: string[] = [];
  let score = 0;
  const bump = (s: number, w: string) => { if (s > score) score = s; why.push(w); };
  if (company.length >= 2 && base && !MAIL_PROVIDERS.has(base) && !isAtsBase(base)) {
    const applyBase = hostBase(c.applyUrl);
    const careers = c.companyDomain ? norm(domainBase(c.companyDomain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "")) : "";
    if (sameName(base, company)) bump(4, "sender domain");
    else if (careers && base === careers) bump(4, "careers domain");
    else if (applyBase && !isAtsBase(applyBase) && base === norm(applyBase)) bump(4, "apply domain");
  }
  if (company.length >= 2 && fromAts(email.from) && norm(email.fromName).includes(company)) bump(4, "ATS display name");
  const ref = referenceScore(c, hay, email.links ?? []);
  if (ref.why) bump(ref.score, ref.why);
  if (company.length >= 3 && norm(email.subject).includes(company)) bump(3, "subject");
  if (company.length >= 4 && norm(email.text.slice(0, 3000)).includes(company)) bump(2, "body");
  if (score === 0) return { score: 0, why };
  const title = c.title.trim().toLowerCase();
  if (title.length >= 5 && hay.toLowerCase().includes(title)) { score += 1; why.push("job title"); }
  if (atsOfSender(email.from) === c.atsType) { score += 1; why.push("same ATS"); }
  return { score, why };
}

export type LinkResult = {
  app: AppCandidate | null;
  /** More than one application fits equally well. A verification mail is then left unlinked rather than guessed. */
  ambiguous: boolean;
  /** The evidence for the pick, for `inbox_messages.meta.link`. */
  why: string[];
};

/**
 * The application a message most likely belongs to. The strongest evidence wins; on a tie, one waiting for mail (for a
 * verification mail) or already submitted (for anything else), then the most recently updated. A verification mail with
 * no company evidence at all is linked only when exactly one application from the sending job system is waiting for a
 * code (Greenhouse code mails often do not name the company). Ties that nothing breaks are reported as ambiguous; a
 * verification mail is then not linked, because a code typed into the wrong form is worse than a code not typed.
 */
export function linkApplication(candidates: readonly AppCandidate[], email: LinkMail, kind: InboxKind): LinkResult {
  const verification = kind === "verification_code";
  const scored = candidates.map((c) => ({ c, ...evidence(c, email) })).filter((x) => x.score > 0);
  if (!scored.length) {
    if (!verification) return { app: null, ambiguous: false, why: [] };
    const ats = atsOfSender(email.from);
    const waiting = ats ? candidates.filter((c) => WAITING.includes(c.status) && c.atsType === ats) : [];
    if (waiting.length === 1) return { app: waiting[0]!, ambiguous: false, why: ["only waiting application on this ATS"] };
    return { app: null, ambiguous: waiting.length > 1, why: [] };
  }
  const phase = (c: AppCandidate) => ((verification ? WAITING.includes(c.status) : c.status === "submitted") ? 1 : 0);
  scored.sort((a, b) => b.score - a.score || phase(b.c) - phase(a.c) || b.c.updatedAt.getTime() - a.c.updatedAt.getTime());
  const [top, second] = scored;
  const tied = !!second && second.score === top!.score && phase(second.c) === phase(top!.c);
  if (tied && verification) return { app: null, ambiguous: true, why: top!.why };
  return { app: top!.c, ambiguous: tied, why: top!.why };
}

/** The application only (older callers). */
export function pickApplication(candidates: readonly AppCandidate[], email: LinkMail, kind: InboxKind): AppCandidate | null {
  return linkApplication(candidates, email, kind).app;
}
