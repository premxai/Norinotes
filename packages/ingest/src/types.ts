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
 * One job system (Greenhouse, Lever, ...). `listJobs` returns every open job on a board and returns `[]` when the board
 * does not exist (404); it throws on any other failure. `fetchJob` reads a single posting when the system has an
 * endpoint for it (or falls back to the list) and returns null when it is gone.
 */
export interface Connector {
  atsType: AtsType;
  listJobs(token: string, http?: HttpOptions): Promise<NormalizedJob[]>;
  fetchJob?(token: string, externalId: string, http?: HttpOptions): Promise<NormalizedJob | null>;
  /** Recognise a posting or board URL of this system: `{ token, externalId }` (externalId null for a board root), or null when it is not ours. */
  parseUrl(url: string): { token: string; externalId: string | null } | null;
}
