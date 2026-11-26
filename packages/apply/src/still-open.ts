/**
 * Is the job still open? Checked before an application is spent: when it is prepared and again just before the browser
 * opens the form to submit it. One request to the posting's public board, through ingest's polite fetch (robots.txt,
 * our User-Agent, retries on 429/503): Greenhouse's job JSON with its questions (the read prepare does anyway, so prepare
 * reuses it), Lever's posting JSON, Ashby's public job board list. Never Ashby's /api/, never a Greenhouse embed URL.
 *
 * Closed: a 404 or 410, a board that no longer lists the posting, a "no longer accepting applications" page, or a 403
 * that is still a 403 after one retry (boards refuse closed postings that way). A network error, a timeout, a 5xx or a
 * rate limit says nothing about the posting: `unknown`, and the application goes on.
 */
import { and, companies, eq, isNull, jobs, type Db } from "@norinote/db";
import { fetchWithRetry } from "@norinote/ingest";
import type { GreenhouseJobJson } from "./schema.js";

export type StillOpenState = "open" | "closed" | "unknown";
export type StillOpen = { state: StillOpenState; why: string; status?: number };

export type StillOpenOptions = {
  fetch?: typeof fetch;
  /** Wait before retrying a 403 (default 2 s); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

/** How long a confirmed-open check stands: a send right after prepare (autopilot) needs no second request. */
export const OPEN_CHECK_FRESH_MS = 15 * 60_000;
export const FORBIDDEN_RETRY_MS = 2000;
export const JOB_CLOSED_REASON = "This job is no longer open: the company took the posting down.";

const CLOSED_PAGE_RE = /no longer (accepting applications|available|open)|(position|job|role) (has been filled|is closed|has closed)|job not found/i;

/** Greenhouse job JSON read by the check, kept for a minute so prepare's schema read reuses it instead of asking again. */
const recentGreenhouse = new Map<string, { at: number; json: GreenhouseJobJson }>();
const GREENHOUSE_REUSE_MS = 60_000;

/** The Greenhouse job JSON (with questions) the open check just read for this posting, once; null when there is none. */
export function takeCheckedGreenhouseJob(token: string, jobId: string): GreenhouseJobJson | null {
  const key = `${token}/${jobId}`;
  const hit = recentGreenhouse.get(key);
  recentGreenhouse.delete(key);
  return hit && Date.now() - hit.at < GREENHOUSE_REUSE_MS ? hit.json : null;
}

function checkUrl(atsType: string, token: string, externalId: string): string | null {
  const t = encodeURIComponent(token);
  const id = encodeURIComponent(externalId);
  if (atsType === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs/${id}?questions=true`;
  if (atsType === "lever") return `https://api.lever.co/v0/postings/${t}/${id}`;
  if (atsType === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  return null;
}

/** What a 200 says about the posting. */
function readBody(atsType: string, externalId: string, token: string, body: string, contentType: string): StillOpen {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    if (CLOSED_PAGE_RE.test(body)) return { state: "closed", why: "the posting says it is no longer accepting applications" };
    return { state: "unknown", why: `unreadable answer (${contentType || "no content type"})` };
  }
  const o = (json ?? {}) as Record<string, unknown>;
  if (atsType === "greenhouse") {
    if (o.id == null) return { state: "closed", why: "the board returned no posting" };
    for (const [k, v] of recentGreenhouse) if (Date.now() - v.at >= GREENHOUSE_REUSE_MS) recentGreenhouse.delete(k);
    recentGreenhouse.set(`${token}/${externalId}`, { at: Date.now(), json: o as unknown as GreenhouseJobJson });
    return { state: "open", why: "the board lists it" };
  }
  if (atsType === "lever") return o.id ? { state: "open", why: "the board lists it" } : { state: "closed", why: "the board returned no posting" };
  const listed = ((o.jobs ?? []) as Array<{ id?: string; isListed?: boolean }>).find((j) => j.id === externalId);
  return listed && listed.isListed !== false ? { state: "open", why: "the board lists it" } : { state: "closed", why: "the board no longer lists it" };
}

/**
 * Re-reads the posting and, when it is gone, closes the job (`jobs.closed_at`; a later board read that lists it again
 * reopens it). A job already closed by the board reads answers `closed` without a request. Never throws.
 */
export async function checkStillOpen(db: Db, jobId: string, opts: StillOpenOptions = {}): Promise<StillOpen> {
  const [job] = await db.select({ atsType: jobs.atsType, externalId: jobs.externalId, closedAt: jobs.closedAt, token: companies.atsToken })
    .from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return { state: "unknown", why: "job not found" };
  if (job.closedAt) return { state: "closed", why: "the board stopped listing it" };
  const url = checkUrl(job.atsType, job.token, job.externalId);
  if (!url) return { state: "unknown", why: `not checked for ${job.atsType}` };

  const http = opts.fetch ? { fetch: opts.fetch } : {};
  let res: Response;
  try {
    res = await fetchWithRetry(url, {}, http);
    if (res.status === 403) {
      void res.body?.cancel().catch(() => {});
      await (opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(FORBIDDEN_RETRY_MS);
      res = await fetchWithRetry(url, {}, http);
    }
  } catch (err) {
    return { state: "unknown", why: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) void res.body?.cancel().catch(() => {});
  let check: StillOpen;
  if (res.status === 404 || res.status === 410) check = { state: "closed", why: `the board answered ${res.status}`, status: res.status };
  else if (res.status === 403) check = { state: "closed", why: "the board refused it twice (403)", status: 403 };
  else if (!res.ok) check = { state: "unknown", why: `the board answered ${res.status}`, status: res.status };
  else {
    try {
      check = { ...readBody(job.atsType, job.externalId, job.token, await res.text(), res.headers.get("content-type") ?? ""), status: res.status };
    } catch (err) {
      check = { state: "unknown", why: err instanceof Error ? err.message : String(err), status: res.status };
    }
  }
  if (check.state === "closed") {
    await db.update(jobs).set({ closedAt: (opts.now ?? (() => new Date()))() }).where(and(eq(jobs.id, jobId), isNull(jobs.closedAt)));
  }
  return check;
}
