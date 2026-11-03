import type { AtsType } from "@norinote/shared";

/**
 * A job as a connector returns it, before it is written to the `jobs` table. Optional values are `null`, never missing.
 * `descriptionText` is plain text (HTML already stripped).
 */
export type NormalizedJob = {
  atsType: AtsType;
  /** Stable id within the job system (Greenhouse job id, Lever posting id, Ashby id, SmartRecruiters id). */
  externalId: string;
  companyName: string;
  /** Board token the job was read from. */
  companyToken: string;
  title: string;
  location: string | null;
  remote: boolean;
  descriptionText: string;
  applyUrl: string;
  /** When the feed says the job was published; null when it does not. */
  postedAt: Date | null;
};

/** Test seams and knobs for outgoing requests. Production code passes nothing. */
export type HttpOptions = {
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  /** Replaces the retry sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Replaces Math.random in the backoff jitter (tests). */
  random?: () => number;
  /** Replaces Date.now when reading an HTTP-date Retry-After (tests). */
  now?: () => number;
  /** Per-attempt timeout; default 15 s. */
  timeoutMs?: number;
};

/**
 * What one read of a board produced. `complete` is false when the read may have missed jobs (a page failed, a cap was
 * hit and could not be split): jobs must never be closed on an incomplete read. `notFound` means the board itself is
 * gone (404 or the system's equivalent); the registry puts the board on probation instead of closing its jobs at once.
 * `notModified` means a conditional request (ETag) answered 304: nothing changed, keep everything as it is.
 */
export type ListResult = {
  jobs: NormalizedJob[];
  complete: boolean;
  notFound?: boolean;
  notModified?: boolean;
  /** ETag (or Last-Modified) to send next time, when the system supports conditional requests. */
  etag?: string | null;
};

/** Options for one board read. */
export type ListOptions = {
  /** Validator from the previous read; connectors that support conditional requests send it. */
  etag?: string | null;
};

/** How a job system behaves, so the scheduler can be polite and efficient. */
export type ConnectorCapabilities = {
  /** Supports ETag / If-None-Match (304 when unchanged). */
  conditional?: boolean;
  /** Most requests to send to one host at the same time. */
  maxConcurrencyPerHost?: number;
};

/**
 * One job system (Greenhouse, Lever, ...). `listJobs` reads every open job on a board. Older connectors return a plain
 * array (`[]` meaning the board does not exist); new connectors return a `ListResult`. It throws on failures that are not
 * "board gone" (rate limits, server errors), so the caller can retry. `fetchJob` reads a single posting when the system
 * has an endpoint for it (or falls back to the list) and returns null when it is gone.
 */
export interface Connector {
  atsType: AtsType;
  /** False for placeholders that are not implemented yet; such boards are never polled. Default true. */
  ready?: boolean;
  capabilities?: ConnectorCapabilities;
  listJobs(token: string, http?: HttpOptions, opts?: ListOptions): Promise<NormalizedJob[] | ListResult>;
  fetchJob?(token: string, externalId: string, http?: HttpOptions): Promise<NormalizedJob | null>;
  /** Recognise a posting or board URL of this system: `{ token, externalId }` (externalId null for a board root), or null when it is not ours. */
  parseUrl(url: string): { token: string; externalId: string | null } | null;
}
