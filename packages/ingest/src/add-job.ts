import { eq, jobs } from "@norinote/db";
import type { Db } from "@norinote/db";
import { BlockedSourceError, isBlockedBoard, isBlockedCompany } from "./blocklist.js";
import { matchJobUrl, SUPPORTED_ATS_TYPES } from "./connectors/index.js";
import { assertPublicUrl, type HostLookup } from "./ssrf.js";
import { ensureCompany, upsertJobs } from "./store.js";
import type { HttpOptions } from "./types.js";

/** The link is not a posting on a job system Norinote can read (unknown host, or a company board rather than one job). */
export class UnsupportedJobUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedJobUrlError";
  }
}

/** The link looks like a posting, but the job system no longer has it (closed or removed). */
export class JobNotFoundError extends Error {
  constructor(readonly url: string) {
    super("That job posting could not be found. It may have been closed or removed.");
    this.name = "JobNotFoundError";
  }
}

export type AddJobOptions = {
  /** Time recorded as `first_seen_at` / `last_seen_at`. Default: the current time. */
  now?: Date;
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  /** Replaces DNS resolution in the SSRF check (tests). */
  lookup?: HostLookup;
  /** Other request knobs (tests). */
  http?: Omit<HttpOptions, "fetch">;
};

export type AddJobResult = {
  /** The stored job. */
  job: typeof jobs.$inferSelect;
  /** False when the job was already in the table (it was refreshed and reopened). */
  created: boolean;
};

/**
 * Add one job from a pasted posting link. The link must be public (SSRF guard: no loopback, private or internal
 * addresses, no non-http schemes) and belong to a supported job system (Greenhouse, including its embedded form link,
 * Lever, Ashby, SmartRecruiters). The posting is read from that system's own API and upserted like a polled job. The
 * company's board is added to `companies` if it was unknown, so it gets polled from then on.
 *
 * Throws `UnsafeUrlError` (internal address), `UnsupportedJobUrlError` (unknown host, or a board link with no job),
 * `BlockedSourceError` (reposting aggregator) or `JobNotFoundError`. Newly created jobs still need `understand.job`;
 * the caller enqueues it when `created` is true.
 */
export async function addJobByUrl(db: Db, url: string, opts: AddJobOptions = {}): Promise<AddJobResult> {
  const raw = url.trim();
  if (!raw) throw new UnsupportedJobUrlError("Paste the link of a job posting.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const parsed = await assertPublicUrl(withScheme, { lookup: opts.lookup });

  const match = matchJobUrl(parsed.toString());
  if (!match) {
    throw new UnsupportedJobUrlError(
      `${parsed.hostname} is not a job system Norinote can read yet. Supported: ${SUPPORTED_ATS_TYPES.join(", ")}.`,
    );
  }
  if (!match.externalId) {
    throw new UnsupportedJobUrlError("That link is a company's job board, not a single posting. Paste the link of one specific job.");
  }
  const { connector, token, externalId } = match;
  if (isBlockedBoard(connector.atsType, token)) throw new BlockedSourceError(token);
  if (!connector.fetchJob) throw new UnsupportedJobUrlError(`${connector.atsType} postings cannot be read one at a time yet.`);

  const fetched = await connector.fetchJob(token, externalId, { ...opts.http, fetch: opts.fetch });
  if (!fetched) throw new JobNotFoundError(raw);
  if (isBlockedCompany({ name: fetched.companyName })) throw new BlockedSourceError(fetched.companyName);

  const now = opts.now ?? new Date();
  const companyId = await ensureCompany(db, connector.atsType, token, fetched.companyName, "url");
  // Whatever its age: the user picked this job, and an older one stored without its text gets it back here.
  const { ids, newIds } = await upsertJobs(db, companyId, connector.atsType, [fetched], now, { keepText: true });
  const id = ids[0];
  if (!id) throw new Error("the job was not stored");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) throw new Error("the job was not stored");
  return { job, created: newIds.length > 0 };
}
