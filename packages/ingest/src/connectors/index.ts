import type { AtsType } from "@norinote/shared";
import type { Connector } from "../types.js";
import { ashby } from "./ashby.js";
import { bamboohr } from "./bamboohr.js";
import { breezy } from "./breezy.js";
import { greenhouse } from "./greenhouse.js";
import { icims } from "./icims.js";
import { lever } from "./lever.js";
import { oracle } from "./oracle.js";
import { personio } from "./personio.js";
import { pinpoint } from "./pinpoint.js";
import { recruitee } from "./recruitee.js";
import { rippling } from "./rippling.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { teamtailor } from "./teamtailor.js";
import { workable } from "./workable.js";
import { workday } from "./workday.js";

export { ashby, bamboohr, breezy, greenhouse, icims, lever, oracle, personio, pinpoint, recruitee, rippling, smartrecruiters, teamtailor, workable, workday };
export { greenhouseFormUrl } from "./greenhouse.js";

/** Every job system, including placeholders (`ready: false`) that are not implemented yet. */
export const CONNECTORS: Record<AtsType, Connector> = {
  greenhouse, lever, ashby, smartrecruiters, workday, oracle,
  workable, recruitee, teamtailor, personio, bamboohr, breezy, rippling, pinpoint, icims,
};

/** Job systems whose connector works today (derived from `ready`). Boards of other systems are never polled. */
export const SUPPORTED_ATS_TYPES: readonly AtsType[] = (Object.values(CONNECTORS) as Connector[])
  .filter((c) => c.ready !== false).map((c) => c.atsType);

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
