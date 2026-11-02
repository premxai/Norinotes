import type { Page } from "playwright";
import type { Driver, DriverContext } from "../types.js";
import { fillFlow, submitFlow, type FlowOptions } from "../flow.js";
import { parseHttpUrl } from "./util.js";

const GH_HOST = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;

export const GREENHOUSE_FORM_SELECTORS = ["#application_form", "form#application-form", "#application-form", "form[action*='greenhouse']"];

/** `https://boards.greenhouse.io/{company}/jobs/{id}` -> the form-only page `/embed/job_app?for={company}&token={id}`. */
export function greenhouseFormUrl(url: string): string | null {
  const u = parseHttpUrl(url);
  if (!u || !GH_HOST.test(u.hostname)) return null;
  if (/^\/embed\/job_app\/?$/i.test(u.pathname)) return u.toString();
  const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
  if (!m) return null;
  return `${u.protocol}//${u.host}/embed/job_app?for=${encodeURIComponent(m[1]!)}&token=${m[2]}`;
}

/** Company career pages embed the Greenhouse form in an iframe; open the iframe document directly. */
async function enterEmbed(page: Page, ctx: DriverContext): Promise<void> {
  const src = await page.locator("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']").first()
    .getAttribute("src", { timeout: 1000 }).catch(() => null);
  if (!src) return;
  const url = new URL(src, page.url()).toString();
  ctx.onEvent("navigate", `Opening embedded Greenhouse form ${url}`, { url });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
}

const flow: FlowOptions = { name: "greenhouse", preferredForms: GREENHOUSE_FORM_SELECTORS, formUrl: greenhouseFormUrl, beforeDiscover: enterEmbed };

export const greenhouseDriver: Driver = {
  name: "greenhouse",
  detect(url) {
    const u = parseHttpUrl(url);
    if (!u) return false;
    if (GH_HOST.test(u.hostname)) return /^\/(embed\/job_app\/?$|[^/]+\/jobs\/\d+)/i.test(u.pathname);
    return u.searchParams.has("gh_jid");
  },
  formUrl: greenhouseFormUrl,
  fill: (page, ctx) => fillFlow(page, ctx, flow),
  submit: (page, ctx) => submitFlow(page, ctx, flow),
};
