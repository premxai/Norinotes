/**
 * Greenhouse postings kept on the company's own careers site (a company link with ?gh_jid=, or a hosted page that
 * redirects there). The Greenhouse driver walks from the posting to the real form (careers.ts) and hands it to the driver
 * for what it finds: Lever, Ashby, a Greenhouse page, or a parking stub such as Workday. A bot check is a captcha for the
 * person, a refusal is blocked, a gone posting fails. A Greenhouse form the company page embeds in an iframe is filled
 * and sent inside that page (Prem, 2026-11-26); the embed address itself is never opened. APPLY_EMBEDDED_GREENHOUSE=false
 * turns that off.
 */
import type { Page } from "playwright";
import { followToForm, greenhouseIframe, revealIframe } from "../careers.js";
import { fillFields } from "../fill.js";
import { CONFIRMATION_SCRIPT, EMAIL_CODE_SCRIPT, runScript } from "../dom.js";
import { BLOCKED_REASON, CAPTCHA_REASON, declineCookies, EMAIL_CODE_REASON, submitAllowed } from "../flow.js";
import { detectCaptcha, discoverFields, findSubmitButton } from "../form.js";
import { greenhouseFormIsOffsite, OFFSITE_FORM_REASON } from "../schema.js";
import type { Driver, DriverContext, FillResult, NeedsUserKind, SubmitResult } from "../types.js";
import { GREENHOUSE_FORM_SELECTORS } from "./greenhouse.js";
import { parseHttpUrl } from "./util.js";

export const EMBEDDED_GREENHOUSE_FLAG = "APPLY_EMBEDDED_GREENHOUSE";
export const POSTING_GONE_REASON = "The posting is gone from the company's careers site.";
export const ROBOTS_REASON = "This company's own careers site asks automated tools not to open its application pages. Open the posting and apply there.";
export const OWN_FORM_REASON = "This company takes applications on its own careers site, in a form Nori doesn't fill yet. Open the posting and apply there.";
export const otherSystemReason = (system: string) => `This company's own careers site sends applications to ${system}, which Nori doesn't fill yet. Open the posting and apply there.`;

const GH_HOST = /(^|\.)greenhouse\.io$/i;

/** The posting's form is on the company's own site: a company link with ?gh_jid=, or a hosted page that redirects away. */
export async function onCareerSite(url: string): Promise<boolean> {
  const u = parseHttpUrl(url);
  if (!u) return false;
  if (!GH_HOST.test(u.hostname)) return u.searchParams.has("gh_jid");
  const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(u.pathname);
  return !!m && (await greenhouseFormIsOffsite(m[1]!, m[2]!)) === true;
}

/** The Greenhouse driver, extended to follow a posting to the company's careers site and on to the real form. */
export function withCareerSites(hosted: Driver, others: readonly Driver[]): Driver {
  const delegated = new WeakMap<Page, { driver: Driver; ctx: DriverContext } | "embedded">();
  const all = [hosted, ...others];
  const detect = (url: string) => all.find((d) => d.detect(url))?.name ?? null;
  return {
    name: hosted.name,
    detect: hosted.detect,
    formUrl: hosted.formUrl,
    async fill(page, ctx) {
      delegated.delete(page);
      if (!(await onCareerSite(ctx.applyUrl))) return hosted.fill(page, ctx);
      const started = Date.now();
      let site = await followToForm(page, ctx.applyUrl, { detect, onEvent: ctx.onEvent });
      // In a Finish session the person passes a bot check in the live view; then the walk starts again, once.
      if (site.kind === "captcha" && ctx.handoff && (await ctx.handoff("captcha"))) site = await followToForm(page, ctx.applyUrl, { detect, onEvent: ctx.onEvent });
      ctx.onEvent("career_site", `Company careers site: ${site.kind}`, { kind: site.kind, driver: site.driver, system: site.system, hops: site.hops, fields: site.fields, url: site.url, status: site.status },
        site.kind === "known_ats" ? "info" : "warn");
      const park = (kind: NeedsUserKind, reason: string): FillResult =>
        ({ status: "needs_user", formUrl: site.url, fields: [], files: [], pending: [], needsUser: { kind, reason }, durationMs: Date.now() - started });
      switch (site.kind) {
        case "known_ats": {
          const driver = all.find((d) => d.name === site.driver);
          if (!driver) return park("unsupported", OFFSITE_FORM_REASON);
          const next = { ...ctx, applyUrl: site.url };
          delegated.set(page, { driver, ctx: next });
          return driver.fill(page, next);
        }
        case "greenhouse_iframe":
          if (process.env[EMBEDDED_GREENHOUSE_FLAG] === "false") return park("unsupported", OFFSITE_FORM_REASON);
          delegated.set(page, "embedded");
          return fillEmbedded(page, ctx, started);
        case "captcha": return park("captcha", CAPTCHA_REASON);
        case "blocked": return park("blocked", BLOCKED_REASON);
        case "robots": return park("unsupported", ROBOTS_REASON);
        case "other_ats": return park("unsupported", otherSystemReason(site.system ?? "another job system"));
        case "dead": return { status: "failed", formUrl: site.url, fields: [], files: [], pending: [], error: POSTING_GONE_REASON, durationMs: Date.now() - started };
        default: {
          // A form of the company's own, or one only the shared flow's "Apply" reveal finds: fill it the way any form is
          // filled. A "form" without a resume upload or with under 3 fields filled is a search box or a newsletter
          // sign-up, never something to send.
          const next = { ...ctx, applyUrl: site.kind === "custom_form" ? site.url : ctx.applyUrl };
          const fill = await hosted.fill(page, next);
          if (fill.status === "failed" || (fill.status === "filled" && (fill.files.length === 0 || fill.fields.length < 3))) return park("unsupported", OWN_FORM_REASON);
          delegated.set(page, { driver: hosted, ctx: next });
          return fill;
        }
      }
    },
    async submit(page, ctx) {
      const d = delegated.get(page);
      if (d === "embedded") return submitEmbedded(page, ctx);
      return d ? d.driver.submit(page, d.ctx) : hosted.submit(page, ctx);
    },
  };
}

/** Fill the Greenhouse form inside the company page's iframe, in place, in one pass. */
async function fillEmbedded(page: Page, ctx: DriverContext, started: number): Promise<FillResult> {
  // A cookie banner over the bottom of the page covers the form's menus: decline it first, as on any form. A cookie
  // choice or the page's own Apply button may reload the iframe, so it is looked up again afterwards.
  await declineCookies(page);
  const first = await greenhouseIframe(page);
  if (first) await revealIframe(page, first);
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  const frame = await greenhouseIframe(page);
  if (!frame) return { status: "failed", formUrl: page.url(), fields: [], files: [], pending: [], error: "The embedded form went away", durationMs: Date.now() - started };
  await frame.locator("form input:not([type=hidden])").first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
  const root = frame as unknown as Page;
  const fields = await discoverFields(root, GREENHOUSE_FORM_SELECTORS);
  ctx.onEvent("discovered", `Found ${fields.length} fields in the embedded form`, { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required, widget: f.widget })) });
  if (!fields.length) return { status: "failed", formUrl: page.url(), fields: [], files: [], pending: [], error: "No application form fields found", durationMs: Date.now() - started };
  const out = await fillFields(root, ctx, fields, ctx.strategyHints ?? {});
  const result = { formUrl: page.url(), fields: out.filled, files: out.files, pending: out.pending, strategies: out.strategies, healed: out.healed, durationMs: Date.now() - started };
  if (await detectCaptcha(page)) return { ...result, status: "needs_user", needsUser: { kind: "captcha", reason: CAPTCHA_REASON } };
  if (out.pending.length) {
    const n = out.pending.length;
    return { ...result, status: "needs_user", needsUser: { kind: "questions", reason: `${n} required question${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your answer` } };
  }
  return { ...result, status: "filled" };
}

const CONFIRM_WAIT_MS = 25_000;

/**
 * Send the embedded form: the click is stored before it happens (as in flow.ts), then the page is watched for a thank-you
 * message, a captcha challenge or an emailed-code step, in the iframe or around it. Never clicks when not allowed.
 */
async function submitEmbedded(page: Page, ctx: DriverContext): Promise<SubmitResult> {
  const started = Date.now();
  const base = () => ({ durationMs: Date.now() - started });
  if (!submitAllowed(ctx)) {
    ctx.onEvent("submit_refused", "Not submitting: dry run, or ALLOW_REAL_SUBMIT is not \"true\"", undefined, "warn");
    return { status: "failed", submitClicked: false, error: "Refusing to submit: dryRun is set or ALLOW_REAL_SUBMIT is not \"true\"", ...base() };
  }
  const frame = await greenhouseIframe(page);
  const btn = frame ? await findSubmitButton(frame as unknown as Page) : null;
  if (!btn) return { status: "failed", submitClicked: false, error: "Submit button not found in the embedded form", ...base() };
  await ctx.recordSubmitClick();
  ctx.onEvent("submit", `Clicking "${btn.label}"`, { label: btn.label });
  try {
    await btn.locator.click();
  } catch (err) {
    return { status: "failed", submitClicked: true, error: err instanceof Error ? err.message : String(err), ...base() };
  }
  for (const until = Date.now() + CONFIRM_WAIT_MS; Date.now() < until; await page.waitForTimeout(1000)) {
    const inFrame = await greenhouseIframe(page);
    const roots = [page, ...(inFrame ? [inFrame as unknown as Page] : [])];
    for (const root of roots) {
      const confirmationText = await runScript<string | null>(root, CONFIRMATION_SCRIPT).catch(() => null);
      if (confirmationText) {
        ctx.onEvent("submitted", confirmationText, { submitMs: Date.now() - started });
        return { status: "submitted", submitClicked: true, confirmationText, finalUrl: page.url(), ...base() };
      }
      if (await runScript<boolean | null>(root, EMAIL_CODE_SCRIPT).catch(() => null)) {
        return { status: "needs_user", submitClicked: true, usedCode: true, needsUser: { kind: "verification_code", reason: EMAIL_CODE_REASON }, ...base() };
      }
    }
    if (await detectCaptcha(page)) {
      ctx.onEvent("captcha", "Captcha challenge after submit; leaving it for the user", undefined, "warn");
      return { status: "needs_user", submitClicked: true, needsUser: { kind: "captcha", reason: CAPTCHA_REASON }, ...base() };
    }
  }
  return {
    status: "failed", submitClicked: true, finalUrl: page.url(), ...base(),
    error: "Clicked submit, but no confirmation appeared. It may not have gone through: check the employer's site or your email before trying again.",
  };
}
