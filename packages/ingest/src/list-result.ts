import type { ListResult, NormalizedJob } from "./types.js";

/**
 * Bring what a connector returned to a `ListResult`. A plain array is a complete read; an empty array means the board
 * does not exist (the older connectors' convention), so it is reported as `notFound`. A `ListResult` passes through.
 */
export function toListResult(raw: NormalizedJob[] | ListResult): ListResult {
  if (!Array.isArray(raw)) return raw;
  return { jobs: raw, complete: true, notFound: raw.length === 0 };
}
