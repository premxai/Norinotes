import type { Page } from "playwright";
import type { Driver, DriverContext } from "../types.js";
import { fillFlow, submitFlow, type FlowOptions } from "../flow.js";
import { parseHttpUrl } from "./util.js";

const GH_HOST = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;

export const GREENHOUSE_FORM_SELECTORS = ["form#application-form", "#application_form", "#application-form", "form.application--form", "form[action*='greenhouse']"];

/**
 * The hosted posting page, which carries the form: `job-boards.greenhouse.io/{company}/jobs/{id}` for both the old
 * boards.greenhouse.io and the new job-boards host (EU kept). An `/embed/job_app?for=&token=` link maps to the same page:
 * /embed/ is disallowed by robots.txt, so Norinote never opens it.
 */
export function greenhouseFormUrl(url: string): string | null {
  const u = parseHttpUrl(url);
  if (!u || !GH_HOST.test(u.hostname)) return null;
  const eu = /\.eu\./i.test(u.hostname) ? ".eu" : "";
  if (/^\/embed\/job_app\/?$/i.test(u.pathname)) {
    const company = u.searchParams.get("for"), id = u.searchParams.get("token");
    return company && id ? `https://job-boards${eu}.greenhouse.io/${encodeURIComponent(company)}/jobs/${id}` : null;
  }
  const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
  if (!m) return null;
  return `https://job-boards${eu}.greenhouse.io/${m[1]}/jobs/${m[2]}`;
}

/** Company career pages embed the Greenhouse form in an iframe; go to the hosted posting page instead of the embed. */
async function leaveEmbed(page: Page, ctx: DriverContext): Promise<void> {
  if (GH_HOST.test(new URL(page.url()).hostname)) return;
  const src = await page.locator("iframe#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']").first()
    .getAttribute("src", { timeout: 1000 }).catch(() => null);
  const hosted = src ? greenhouseFormUrl(new URL(src, page.url()).toString()) : null;
  if (!hosted) return;
  ctx.onEvent("navigate", `Opening the hosted Greenhouse form ${hosted}`, { url: hosted });
  await page.goto(hosted, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("form#application-form input, #application_form input").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
}

const flow: FlowOptions = {
  name: "greenhouse", preferredForms: GREENHOUSE_FORM_SELECTORS, formUrl: greenhouseFormUrl, beforeDiscover: leaveEmbed,
  firstField: "#first_name, form#application-form input, #application_form input, iframe#grnhse_iframe",
};

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
