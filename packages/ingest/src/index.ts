/**
 * @norinote/ingest: collect every job once, for everyone.
 *
 * - Connectors read a job system's public feed (one file per job system in connectors/; unfinished ones are placeholders).
 * - `seedCompanies` loads the verified board registry into `companies`; `nextBoards` says which boards to poll next;
 *   `importSeeds` loads big candidate lists (see seeds.ts).
 * - `pollBoard` reads one board, upserts its jobs, closes the ones missing from two complete reads, keeps the company registry row current and reports `newJobIds` so the
 *   worker can enqueue `understand.job`. Ingest never calls the queue itself.
 * - `addJobByUrl` adds one job from a pasted link (SSRF-guarded).
 * - Lean storage: jobs that are not fresh are stored without their description, and `sweepStaleJobs` trims jobs that
 *   aged out and nobody refers to (description, specs, embeddings); `fillJobDescription` reads the text back on demand.
 */

export type { Connector, ConnectorCapabilities, HttpOptions, ListOptions, ListResult, NormalizedJob } from "./types.js";
export { toListResult } from "./list-result.js";

export {
  CONNECTORS, SUPPORTED_ATS_TYPES, getConnector, isSupportedAts, matchJobUrl,
  greenhouse, lever, ashby, smartrecruiters, workday, oracle, greenhouseFormUrl,
} from "./connectors/index.js";
export { BlockedByHostError } from "./connectors/workday.js";

export {
  FETCH_TIMEOUT_MS, USER_AGENT, MAX_ATTEMPTS, MAX_RETRY_AFTER_MS,
  RateLimitedError, HostBackoff, feedHost, parseRetryAfter, backoffMs, fetchWithRetry, getJson, getJsonConditional,
} from "./http.js";

export { htmlToText, decodeEntities, unescapeHtml } from "./html.js";
export { prettifyToken, REMOTE_RE } from "./util.js";
export { dedupeKey, normalizeCompany, normalizeText } from "./dedupe.js";

export { BLOCKED_SOURCES, BlockedSourceError, isBlockedBoard, isBlockedCompany, normalizeSourceKey } from "./blocklist.js";
export type { BlockedSource } from "./blocklist.js";

export { BOARD_REGISTRY, VERIFIED_AT } from "./board-registry.js";
export type { BoardEntry } from "./board-registry.js";
export { EARLY_CAREER_BOARDS, EARLY_CAREER_VERIFIED_AT } from "./board-registry-early-career.js";

export { hostKey } from "./hosts.js";
export {
  PRIORITY, PROBATION_MS, EMPTY_DISABLE_MS, ERROR_STREAK_LIMIT, RECHECK_MS, PROBATION_RECHECK_MS, MISSING_READS_TO_CLOSE,
  pollIntervalMs, errorRetryMs,
} from "./schedule.js";
export type { NextPollInput } from "./schedule.js";
export { seedCompanies, nextBoards, maxPollsPerHost, DEFAULT_POLLS_PER_HOST } from "./companies.js";
export type { DueBoard, NextBoardsOptions, SeedResult } from "./companies.js";

export {
  parseCsv, parseSeedCsv, parseOpenAtsFeed, parseSeedRow, importSeeds, SEED_SOURCES, SEED_LICENCES, SEED_CSV_SYSTEMS,
  parseWorkdayUrl, parseOracleUrl,
} from "./seeds.js";
export type { ParsedSeeds, SeedCompany, SeedImportResult, SeedSource } from "./seeds.js";

export { pollBoard, HostBackedOffError } from "./poll.js";
export type { PollOptions, PollResult } from "./poll.js";

export { fillJobDescription } from "./detail.js";
export type { FillDescriptionResult } from "./detail.js";

export { sweepStaleJobs, SWEEP_BATCH_SIZE, SWEEP_MAX_BATCHES, SWEEP_GRACE_HOURS } from "./sweep.js";
export type { SweepOptions, SweepResult } from "./sweep.js";
export type { UpsertOptions, UpsertResult } from "./store.js";

export { addJobByUrl, UnsupportedJobUrlError, JobNotFoundError } from "./add-job.js";
export type { AddJobOptions, AddJobResult } from "./add-job.js";

export { UnsafeUrlError, assertPublicUrl, isPrivateAddress, safeFetch } from "./ssrf.js";
export type { HostLookup } from "./ssrf.js";
