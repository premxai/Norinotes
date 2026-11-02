import type { AtsType } from "@norinote/shared";
import type { Connector } from "../types.js";
import { ashby } from "./ashby.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { oracle, workday } from "./stubs.js";

export { ashby, greenhouse, lever, smartrecruiters, workday, oracle };
export { greenhouseFormUrl } from "./greenhouse.js";

/** Every job system, including the stubs that throw `not implemented`. */
export const CONNECTORS: Record<AtsType, Connector> = { greenhouse, lever, ashby, smartrecruiters, workday, oracle };

/** Job systems whose connector works today. Boards of other systems are never polled. */
export const SUPPORTED_ATS_TYPES: readonly AtsType[] = ["greenhouse", "lever", "ashby", "smartrecruiters"];

/** True when the job system has a working connector. */
export const isSupportedAts = (atsType: string): atsType is AtsType => (SUPPORTED_ATS_TYPES as readonly string[]).includes(atsType);

/** The connector for a job system. */
export const getConnector = (atsType: AtsType): Connector => CONNECTORS[atsType];

/** Find the supported connector that recognises this URL, with the board token and (for a posting) the job id. */
export function matchJobUrl(url: string): { connector: Connector; token: string; externalId: string | null } | null {
  for (const atsType of SUPPORTED_ATS_TYPES) {
    const connector = CONNECTORS[atsType];
    const hit = connector.parseUrl(url);
    if (hit) return { connector, ...hit };
  }
  return null;
}
