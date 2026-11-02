/**
 * @norinote/ingest: collect every job once, for everyone.
 *
 * - Connectors read a job system's public feed (Greenhouse, Lever, Ashby, SmartRecruiters; Workday and Oracle are stubs).
 * - `seedCompanies` loads the verified board registry into `companies`; `dueBoards` says which boards to poll next.
 * - `pollBoard` reads one board, upserts its jobs, closes the ones that left the feed and reports `newJobIds` so the
 *   worker can enqueue `understand.job`. Ingest never calls the queue itself.
 * - `addJobByUrl` adds one job from a pasted link (SSRF-guarded).
 */

export type { Connector, HttpOptions, NormalizedJob } from "./types.js";

export {
  CONNECTORS, SUPPORTED_ATS_TYPES, getConnector, isSupportedAts, matchJobUrl,
  greenhouse, lever, ashby, smartrecruiters, workday, oracle, greenhouseFormUrl,
} from "./connectors/index.js";

export {
  FETCH_TIMEOUT_MS, USER_AGENT, MAX_ATTEMPTS, MAX_RETRY_AFTER_MS,
  RateLimitedError, HostBackoff, feedHost, parseRetryAfter, backoffMs, fetchWithRetry, getJson,
} from "./http.js";

export { htmlToText, decodeEntities, unescapeHtml } from "./html.js";
export { prettifyToken, REMOTE_RE } from "./util.js";
export { dedupeKey, normalizeCompany, normalizeText } from "./dedupe.js";

export { BLOCKED_SOURCES, BlockedSourceError, isBlockedBoard, isBlockedCompany, normalizeSourceKey } from "./blocklist.js";
export type { BlockedSource } from "./blocklist.js";

export { BOARD_REGISTRY, VERIFIED_AT } from "./board-registry.js";
export type { BoardEntry } from "./board-registry.js";
export { EARLY_CAREER_BOARDS, EARLY_CAREER_VERIFIED_AT } from "./board-registry-early-career.js";

export { POLL_INTERVAL_MS, seedCompanies, dueBoards } from "./companies.js";
export type { DueBoard, SeedResult } from "./companies.js";

export { pollBoard, HostBackedOffError } from "./poll.js";
export type { PollOptions, PollResult } from "./poll.js";

export { addJobByUrl, UnsupportedJobUrlError, JobNotFoundError } from "./add-job.js";
export type { AddJobOptions, AddJobResult } from "./add-job.js";

export { UnsafeUrlError, assertPublicUrl, isPrivateAddress, safeFetch } from "./ssrf.js";
export type { HostLookup } from "./ssrf.js";
