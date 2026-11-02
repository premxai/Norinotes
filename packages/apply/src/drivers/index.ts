import type { Page } from "playwright";
import type { Driver, DriverContext, FillResult, UnknownFormHandler } from "../types.js";
import { ashbyDriver } from "./ashby.js";
import { greenhouseDriver } from "./greenhouse.js";
import { leverDriver } from "./lever.js";

export { greenhouseDriver, greenhouseFormUrl } from "./greenhouse.js";
export { leverDriver, leverFormUrl } from "./lever.js";
export { ashbyDriver, ashbyFormUrl } from "./ashby.js";

export const DRIVERS: readonly Driver[] = [greenhouseDriver, leverDriver, ashbyDriver];

/** The driver for an apply URL, or null when no driver recognises it. */
export function detectDriver(url: string, drivers: readonly Driver[] = DRIVERS): Driver | null {
  return drivers.find((d) => d.detect(url)) ?? null;
}

export const UNSUPPORTED_FORM_REASON = "This form type is not supported yet";

/** Default fallback: parks the application with the person. A future AI browser agent replaces it. */
export const defaultUnknownFormHandler: UnknownFormHandler = {
  async handle(_page: Page, ctx: DriverContext): Promise<FillResult> {
    ctx.onEvent("unsupported_form", UNSUPPORTED_FORM_REASON, { url: ctx.applyUrl }, "warn");
    return {
      status: "needs_user", formUrl: null, fields: [], files: [], pending: [],
      needsUser: { kind: "unsupported", reason: UNSUPPORTED_FORM_REASON }, durationMs: 0,
    };
  },
};
