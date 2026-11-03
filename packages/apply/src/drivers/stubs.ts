/**
 * Typed stubs for job systems Norinote does not fill yet. Each recognises its URLs (so the application is not mistaken for
 * an unknown form) and parks it with the person with a clear reason. Workday stays parked on purpose: it needs an account
 * per employer tenant, and Norinote never creates accounts.
 */
import type { Driver, DriverName, FillResult, SubmitResult } from "../types.js";
import { parseHttpUrl } from "./util.js";

export const WORKDAY_REASON = "Workday asks you to create an account with each employer. Norinote never creates accounts: open the posting and apply yourself.";
export const NOT_YET_REASON = (system: string) => `${system} forms are not supported yet: open the posting and apply yourself.`;

function stub(name: DriverName, display: string, host: RegExp, reason: string): Driver {
  const detect = (url: string) => { const u = parseHttpUrl(url); return !!u && host.test(u.hostname); };
  return {
    name,
    detect,
    formUrl: () => null,
    async fill(_page, ctx): Promise<FillResult> {
      ctx.onEvent("unsupported_form", reason, { url: ctx.applyUrl, system: display }, "warn");
      return { status: "needs_user", formUrl: null, fields: [], files: [], pending: [], needsUser: { kind: name === "workday" ? "account" : "unsupported", reason }, durationMs: 0 };
    },
    async submit(): Promise<SubmitResult> {
      return { status: "failed", submitClicked: false, error: reason, durationMs: 0 };
    },
  };
}

export const workdayDriver = stub("workday", "Workday", /(\.myworkdayjobs\.com|\.myworkdaysite\.com|(^|\.)workday\.com)$/i, WORKDAY_REASON);
export const smartRecruitersDriver = stub("smartrecruiters", "SmartRecruiters", /(^|\.)smartrecruiters\.com$/i, NOT_YET_REASON("SmartRecruiters"));
export const workableDriver = stub("workable", "Workable", /(^|\.)workable\.com$/i, NOT_YET_REASON("Workable"));
export const icimsDriver = stub("icims", "iCIMS", /(^|\.)icims\.com$/i, NOT_YET_REASON("iCIMS"));
