import type { Page } from "playwright";
import type { Driver, DriverContext, FillResult, UnknownFormHandler } from "../types.js";
import { ashbyDriver } from "./ashby.js";
import { withCareerSites } from "./career-site.js";
import { greenhouseHostedDriver } from "./greenhouse.js";
import { leverDriver } from "./lever.js";
import { icimsDriver, smartRecruitersDriver, workableDriver, workdayDriver } from "./stubs.js";

export { greenhouseHostedDriver, greenhouseFormUrl } from "./greenhouse.js";
export { EMBEDDED_GREENHOUSE_FLAG, onCareerSite, withCareerSites } from "./career-site.js";
export { leverDriver, leverFormUrl } from "./lever.js";
export { ashbyDriver, ashbyFormUrl } from "./ashby.js";
export { workdayDriver, smartRecruitersDriver, workableDriver, icimsDriver, WORKDAY_REASON, NOT_YET_REASON } from "./stubs.js";

const PARKED: readonly Driver[] = [workdayDriver, smartRecruitersDriver, workableDriver, icimsDriver];
/** Greenhouse, following a posting to the company's careers site and on to Lever, Ashby or a parking stub when it leads there. */
export const greenhouseDriver: Driver = withCareerSites(greenhouseHostedDriver, [leverDriver, ashbyDriver, ...PARKED]);

/** Drivers that fill forms, then the typed stubs that park their systems with a clear reason. */
export const DRIVERS: readonly Driver[] = [greenhouseDriver, leverDriver, ashbyDriver, ...PARKED];

/** The driver for an apply URL, or null when no driver recognises it. */
export function detectDriver(url: string, drivers: readonly Driver[] = DRIVERS): Driver | null {
  return drivers.find((d) => d.detect(url)) ?? null;
}

export const UNSUPPORTED_FORM_REASON = "This form type is not supported yet";

/** Default fallback: parks the application with the person. A future AI browser agent replaces it (AiBrowserFallback). */
export const defaultUnknownFormHandler: UnknownFormHandler = {
  async handle(_page: Page, ctx: DriverContext): Promise<FillResult> {
    ctx.onEvent("unsupported_form", UNSUPPORTED_FORM_REASON, { url: ctx.applyUrl }, "warn");
    return {
      status: "needs_user", formUrl: null, fields: [], files: [], pending: [],
      needsUser: { kind: "unsupported", reason: UNSUPPORTED_FORM_REASON }, durationMs: 0,
    };
  },
};
