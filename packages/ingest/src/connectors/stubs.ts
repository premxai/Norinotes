import type { AtsType } from "@norinote/shared";
import type { Connector } from "../types.js";

/**
 * A connector that is not implemented yet. Boards of a placeholder system are never polled (`ready: false`).
 * Each job system has its own file in this folder; replace the placeholder export there with the real connector.
 */
export function placeholder(atsType: AtsType): Connector {
  const fail = async (): Promise<never> => { throw new Error(`not implemented: ${atsType} connector`); };
  return { atsType, ready: false, listJobs: fail, fetchJob: fail, parseUrl: () => null };
}
