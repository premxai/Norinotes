/**
 * The shared apply flow every driver uses: open the form (straight to its own URL when it can be derived), wait for the
 * first field (never network idle), decline a cookie banner, discover, fill the prepared plan, follow a multi-page form up
 * to a page cap, then stop (dry run, pending questions, captcha, email code) or submit and race the outcome signals.
 *
 * Safety: submit is only ever clicked through `clickSubmit`, which re-checks `submitAllowed`. Password fields are never
 * filled (an account wall returns needs_user), and captchas are never solved, evaded or bypassed (needs_user).
 */
import path from "node:path";
import type { Page, Response } from "playwright";
import type { DriverContext, FillResult, PendingQuestion, SubmitResult } from "./types.js";
import { fillFields, type FillOutcome } from "./fill.js";
import { detectCaptcha, discoverFields, findSubmitButton, PREFERRED_FORM_SELECTORS, type DiscoveredField } from "./form.js";
import {
  runScript, CONFIRMATION_SCRIPT, CODE_INPUTS_SCRIPT, ERRORS_SCRIPT, PASSWORD_SCRIPT, FORM_VISIBLE_SCRIPT, EMAIL_CODE_SCRIPT,
} from "./dom.js";

export type FlowOptions = {
  name: string;
  preferredForms?: string[];
  /** The form's own address when it can be derived from the posting URL (skips the job page). */
  formUrl: (url: string) => string | null;
  /** Site-specific step before discovery (e.g. leave an embedding career page for the hosted form). */
  beforeDiscover?: (page: Page, ctx: DriverContext) => Promise<void>;
  /** Selector of the first field to wait for after navigation. */
  firstField?: string;
};

const NAV_TIMEOUT = 30_000;
const FIRST_FIELD_TIMEOUT = 15_000;
const PAGE_CAP = 5;
const CONFIRM_RE = /thank you|thanks for applying|application (has been |was )?(submitted|received)|we('ve| have) received your application/i;
/** A page that turns automation away. Norinote hands these to the person and never tries to get around them. */
const BLOCKED_RE = /access is temporarily restricted|unusual activity from your (device|network)|automated \(bot\) activity|verify you are (a )?human|are you a robot|checking if the site connection is secure/i;
const FAIL_TEXT_RE = /(there (was|were) (an )?(error|problem)s?|please (correct|fix|complete) the (errors?|required|highlighted)|something went wrong|could not (be )?submit)/i;

export const CAPTCHA_REASON = "The site showed a captcha. Norinote never solves or bypasses captchas: open the posting and finish the application yourself.";
export const BLOCKED_REASON = "This site blocks automated applications: open the posting and apply yourself.";
export const ACCOUNT_REASON = "The site asks you to sign in or create an account. Norinote never does that: open the posting and apply yourself.";
export const EMAIL_CODE_REASON = "The employer emailed you a verification code. Enter it on the employer's page to finish (Norinote does not read your email yet).";

/** The one and only place the submit gate is decided: not a dry run, and ALLOW_REAL_SUBMIT is exactly "true". */
export function submitAllowed(ctx: Pick<DriverContext, "dryRun">): boolean {
  return ctx.dryRun === false && process.env.ALLOW_REAL_SUBMIT === "true";
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText : ''").then(String).catch(() => "");
}

const FIELD_SEL = "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select";

async function goto(page: Page, ctx: DriverContext, url: string, firstField: string): Promise<void> {
  ctx.onEvent("navigate", `Opening ${url}`, { url });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  // The first field is what matters, not every analytics request settling.
  await page.locator(firstField).first().waitFor({ state: "attached", timeout: FIRST_FIELD_TIMEOUT }).catch(() => {});
  await waitForHydration(page);
}

/**
 * A server-rendered form (Greenhouse's Remix boards, Next.js pages) shows its fields before React has attached its
 * handlers: an upload or a menu used before then is silently ignored. Wait for the load event (fast: heavy resources are
 * blocked), then for React's own marker on a form field. Pages rendered on the client already pass.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(`(function () {
    var ssr = window.__remixContext || window.__NEXT_DATA__ || document.querySelector('[data-reactroot]');
    if (!ssr) return true;
    var el = document.querySelector('form input:not([type=hidden]), form textarea');
    return !el || Object.keys(el).some(function (k) { return k.indexOf('__react') === 0; });
  })()`, undefined, { timeout: 5000, polling: 100 }).catch(() => {});
}

/** Decline a cookie banner when one covers the form: the privacy-preserving choice, never "accept". */
async function declineCookies(page: Page): Promise<void> {
  const deny = page.getByRole("button", { name: /^(deny|decline|reject( all)?|only (necessary|essential)( cookies)?|necessary only)$/i }).first();
  if (await deny.isVisible().catch(() => false)) await deny.click({ timeout: 2000 }).catch(() => {});
}

/** Click an "Apply" button/tab/link when the form is not visible yet. */
async function revealForm(page: Page, ctx: DriverContext, preferred: string[]): Promise<void> {
  if (await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred)) return;
  const candidates = [
    page.getByRole("button", { name: /^\s*apply\b/i }),
    page.getByRole("link", { name: /^\s*apply\b/i }),
    page.getByRole("tab", { name: /apply|application/i }),
  ];
  for (const c of candidates) {
    const first = c.first();
    if (await first.isVisible().catch(() => false)) {
      ctx.onEvent("reveal_form", "Opening the application form");
      await first.click().catch(() => {});
      await page.waitForFunction(`(${FORM_VISIBLE_SCRIPT})(${JSON.stringify(preferred)})`, undefined, { timeout: 8000 }).catch(() => {});
      return;
    }
  }
}

/** Upload the resume through an "Attach" button + file chooser when no file input was found. */
async function attachResumeFallback(page: Page, ctx: DriverContext): Promise<boolean> {
  const attach = page.locator("[data-norinote-form]").getByRole("button", { name: /attach|upload/i }).first();
  if (!(await attach.isVisible().catch(() => false))) return false;
  try {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), attach.click()]);
    await chooser.setFiles(ctx.resumePdfPath);
    ctx.onEvent("field_filled", "Attached resume through file chooser", { label: "Resume/CV", kind: "file" });
    return true;
  } catch {
    return false;
  }
}

/** A Next/Continue button of a multi-page form, when there is no submit button on this page. */
async function nextButton(page: Page) {
  if (await findSubmitButton(page)) return null;
  const next = page.locator("[data-norinote-form]").getByRole("button", { name: /^\s*(next|continue|save and continue|next step)\b/i }).first();
  return (await next.isVisible().catch(() => false)) ? next : null;
}

const base = (started: number) => ({ durationMs: Date.now() - started });

export async function fillFlow(page: Page, ctx: DriverContext, opts: FlowOptions): Promise<FillResult> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const preferred = opts.preferredForms ?? PREFERRED_FORM_SELECTORS;
  const firstField = opts.firstField ?? FIELD_SEL;
  const derived = opts.formUrl(ctx.applyUrl);
  const targets = [...new Set([derived, ctx.applyUrl].filter((u): u is string => Boolean(u)))];
  const needsUser = (kind: NonNullable<FillResult["needsUser"]>["kind"], reason: string, extra: Partial<FillResult> = {}): FillResult =>
    ({ status: "needs_user", formUrl: page.url(), fields: [], files: [], pending: [], needsUser: { kind, reason }, timings, ...extra, ...base(started) });

  let fields: DiscoveredField[] = [];
  for (const [i, target] of targets.entries()) {
    const t = Date.now();
    await goto(page, ctx, target, firstField);
    if (opts.beforeDiscover) await opts.beforeDiscover(page, ctx);
    await declineCookies(page);
    await revealForm(page, ctx, preferred);
    timings.openMs = Date.now() - t;

    if (await runScript<boolean>(page, PASSWORD_SCRIPT)) {
      ctx.onEvent("needs_user", "The site asks for a password; Norinote never signs in or creates accounts", undefined, "warn");
      return needsUser("account", ACCOUNT_REASON);
    }
    const captcha = await detectCaptcha(page);
    if (captcha) {
      ctx.onEvent("captcha", `Captcha challenge on load (${captcha}); leaving it for the user`, { captcha }, "warn");
      return needsUser("captcha", CAPTCHA_REASON);
    }

    const td = Date.now();
    fields = await discoverFields(page, preferred);
    timings.discoverMs = Date.now() - td;
    ctx.onEvent("discovered", `Found ${fields.length} fields`, { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required, widget: f.widget })) });
    if (fields.length) break;

    if (BLOCKED_RE.test(await bodyText(page))) {
      ctx.onEvent("needs_user", "The site turned automated access away; Norinote does not try to get around that", undefined, "warn");
      return needsUser("blocked", BLOCKED_REASON);
    }
    if (i < targets.length - 1) ctx.onEvent("form_not_found", "No form at the derived address; trying the posting URL", { url: target }, "warn");
  }
  if (!fields.length) {
    return { status: "failed", formUrl: page.url(), fields: [], files: [], pending: [], error: "No application form fields found", timings, ...base(started) };
  }

  const formUrl = page.url();
  const all: FillOutcome = { filled: [], pending: [], files: [], strategies: {}, unresolved: [], healed: false, timings: { filesMs: 0, textMs: 0, choicesMs: 0, validateMs: 0 } };
  const seenAll = new Set<string>();
  for (let pageNo = 1, round = 0; ; round++) {
    for (const f of fields) seenAll.add(f.selector);
    const out = await fillFields(page, ctx, fields, ctx.strategyHints ?? {});
    all.filled.push(...out.filled);
    all.pending.push(...out.pending);
    all.files.push(...out.files);
    all.unresolved.push(...out.unresolved);
    Object.assign(all.strategies, out.strategies);
    all.healed ||= out.healed;
    for (const k of Object.keys(out.timings) as (keyof FillOutcome["timings"])[]) all.timings[k] += out.timings[k];
    if (out.pending.length) break;
    // An answer can reveal follow-up fields (Greenhouse shows Race after the Hispanic/Latino answer): fill those too.
    if (round < 3) {
      const revealed = (await discoverFields(page, preferred)).filter((f) => !seenAll.has(f.selector) && !all.filled.some((x) => x.label === f.label));
      if (revealed.length) {
        ctx.onEvent("revealed_fields", `${revealed.length} follow-up field(s) appeared`, { labels: revealed.map((f) => f.label) });
        fields = revealed;
        continue;
      }
    }
    const next = await nextButton(page);
    if (!next) break;
    pageNo++;
    if (pageNo > PAGE_CAP) {
      return needsUser("other", `The form has more than ${PAGE_CAP} pages; finish it yourself.`, { fields: all.filled, files: all.files });
    }
    const before = new Set(fields.map((f) => f.selector));
    ctx.onEvent("next_page", `Going to page ${pageNo} of the form`);
    await next.click({ timeout: 4000 });
    await page.waitForFunction(`document.querySelectorAll(${JSON.stringify(FIELD_SEL)}).length > 0`, undefined, { timeout: 8000 }).catch(() => {});
    fields = (await discoverFields(page, preferred)).filter((f) => !before.has(f.selector) || !all.filled.some((x) => x.label === f.label));
    if (!fields.length) break;
  }
  timings.filesMs = all.timings.filesMs;
  timings.textMs = all.timings.textMs;
  timings.choicesMs = all.timings.choicesMs;
  timings.validateMs = all.timings.validateMs;
  const { filled, files } = all;
  let pending: PendingQuestion[] = dedupePending(all.pending);

  if (!files.length && ctx.resumePdfPath && (await attachResumeFallback(page, ctx))) {
    files.push({ label: "Resume/CV", path: ctx.resumePdfPath });
    filled.push({ label: "Resume/CV", value: path.basename(ctx.resumePdfPath), kind: "file" });
    pending = pending.filter((p) => !(p.type === "file" && /resume|cv/i.test(p.text)));
  }
  timings.readyMs = Date.now() - started;
  ctx.onEvent("timing", `Form ready in ${(timings.readyMs / 1000).toFixed(1)} s`, { ...timings, fields: filled.length });
  const extra = { strategies: all.strategies, healed: all.healed, timings };

  const captcha = await detectCaptcha(page);
  if (captcha) {
    ctx.onEvent("captcha", `Captcha challenge (${captcha}); leaving it for the user`, { captcha }, "warn");
    return needsUser("captcha", CAPTCHA_REASON, { formUrl, fields: filled, files, pending, ...extra });
  }
  if (await runScript<string | null>(page, EMAIL_CODE_SCRIPT).catch(() => null)) {
    ctx.onEvent("verification", "The site asks for an emailed code before submit", undefined, "warn");
    return needsUser("verification_code", EMAIL_CODE_REASON, { formUrl, fields: filled, files, pending, ...extra });
  }
  if (pending.length) {
    ctx.onEvent("needs_user", `${pending.length} question(s) need the user`, { pending: pending.map((p) => p.text), unresolved: all.unresolved }, "warn");
    const n = pending.length;
    const why = all.unresolved.length ? ` (${all.unresolved.length} could not be set on the page)` : "";
    return needsUser("questions", `The form asks ${n} required question${n === 1 ? "" : "s"} Norinote has no answer for${why}.`, { formUrl, fields: filled, files, pending, ...extra });
  }
  return { status: "filled", formUrl, fields: filled, files, pending: [], ...extra, ...base(started) };
}

function dedupePending(list: PendingQuestion[]): PendingQuestion[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

type Outcome = "confirmed" | "verify" | "errors" | "captcha" | "timeout";

/**
 * Race what can happen after the click: success (a 2xx answer to the submit request, confirmation text, the form
 * detached, the URL changed) against failure (error text, a captcha challenge, an email-code prompt). Event-driven waits;
 * a short poll only reads the page state when something happened.
 */
async function raceAfterSubmit(page: Page, startUrl: string, ms: number, confirmedBefore: boolean, submitResponse: Promise<Response | null>): Promise<Outcome> {
  const deadline = Date.now() + ms;
  let ok2xx = false;
  void submitResponse.then((r) => { if (r && r.status() >= 200 && r.status() < 300) ok2xx = true; });
  const signal = () => Promise.race([
    submitResponse.then(() => "response"),
    page.waitForURL((u) => u.toString() !== startUrl, { timeout: 2000 }).then(() => "url", () => "tick"),
    page.locator("[data-norinote-form]").waitFor({ state: "detached", timeout: 2000 }).then(() => "detached", () => "tick"),
    page.getByText(CONFIRM_RE).first().waitFor({ state: "visible", timeout: 2000 }).then(() => "text", () => "tick"),
  ]);
  while (Date.now() < deadline) {
    await signal().catch(() => "tick");
    try {
      if (await detectCaptcha(page)) return "captcha";
      const text = await bodyText(page);
      const formGone = (await page.locator("[data-norinote-form]").count()) === 0 || page.url() !== startUrl;
      if (CONFIRM_RE.test(text) && (!confirmedBefore || formGone)) return "confirmed";
      if (await runScript<string | null>(page, EMAIL_CODE_SCRIPT)) return "verify";
      if ((await runScript<number>(page, ERRORS_SCRIPT)) > 0 || (FAIL_TEXT_RE.test(text) && !formGone)) return "errors";
      if (ok2xx && formGone) return "confirmed";
    } catch {
      // Navigation in progress; the next signal will tell.
    }
  }
  return "timeout";
}

async function enterCode(page: Page, code: string): Promise<void> {
  const n = await runScript<number>(page, CODE_INPUTS_SCRIPT);
  if (n <= 1) {
    await page.locator('[data-norinote-code="0"]').fill(code);
    return;
  }
  const chars = code.replace(/\s+/g, "").split("");
  for (let i = 0; i < Math.min(n, chars.length); i++) await page.locator(`[data-norinote-code="${i}"]`).fill(chars[i]!);
}

async function clickSubmit(page: Page, ctx: DriverContext): Promise<string> {
  if (!submitAllowed(ctx)) throw new Error("Refusing to submit: dryRun is set or ALLOW_REAL_SUBMIT is not \"true\"");
  const btn = await findSubmitButton(page);
  if (!btn) throw new Error("Submit button not found");
  ctx.onEvent("submit", `Clicking "${btn.label}"`, { label: btn.label });
  await btn.locator.click();
  return btn.label;
}

/** The submit request: a POST, PUT or GraphQL mutation to the form's own site (not analytics or captcha). */
function waitForSubmitResponse(page: Page, ms: number): Promise<Response | null> {
  const host = (() => { try { return new URL(page.url()).hostname.split(".").slice(-2).join("."); } catch { return ""; } })();
  return page.waitForResponse((r) => {
    const req = r.request();
    if (!["POST", "PUT"].includes(req.method())) return false;
    const url = r.url();
    return !/recaptcha|hcaptcha|google|analytics|segment|sentry|datadog/i.test(url) && (!host || url.includes(host));
  }, { timeout: ms }).catch(() => null);
}

/** Send the filled form that `fillFlow` left on this page. */
export async function submitFlow(page: Page, ctx: DriverContext, _opts: Pick<FlowOptions, "name">): Promise<SubmitResult> {
  const started = Date.now();
  if (!submitAllowed(ctx)) {
    ctx.onEvent("submit_refused", "Not submitting: dry run, or ALLOW_REAL_SUBMIT is not \"true\"", undefined, "warn");
    return { status: "failed", submitClicked: false, error: "Refusing to submit: dryRun is set or ALLOW_REAL_SUBMIT is not \"true\"", ...base(started) };
  }
  let clicked = false;
  let usedCode = false;
  try {
    const startUrl = page.url();
    const confirmedBefore = CONFIRM_RE.test(await bodyText(page));
    const response = waitForSubmitResponse(page, 25_000);
    await clickSubmit(page, ctx);
    clicked = true;
    let state = await raceAfterSubmit(page, startUrl, 25_000, confirmedBefore, response);

    if (state === "verify") {
      usedCode = true;
      ctx.onEvent("verification", "Site asked for an emailed verification code");
      const code = ctx.waitForCode ? await ctx.waitForCode(_opts.name) : null;
      if (!code) {
        return { status: "needs_user", submitClicked: true, usedCode, ...base(started), needsUser: { kind: "verification_code", reason: EMAIL_CODE_REASON } };
      }
      await enterCode(page, code);
      ctx.onEvent("verification", "Entered verification code");
      const verifyUrl = page.url();
      const again = waitForSubmitResponse(page, 25_000);
      await clickSubmit(page, ctx);
      state = await raceAfterSubmit(page, verifyUrl, 25_000, confirmedBefore, again);
    }

    if (state === "captcha" || (await detectCaptcha(page))) {
      ctx.onEvent("captcha", "Captcha challenge after submit; leaving it for the user", undefined, "warn");
      return { status: "needs_user", submitClicked: true, usedCode, needsUser: { kind: "captcha", reason: CAPTCHA_REASON }, ...base(started) };
    }

    const confirmationText = (await runScript<string | null>(page, CONFIRMATION_SCRIPT).catch(() => null)) ?? undefined;
    if (!confirmationText && state === "errors") {
      return { status: "failed", submitClicked: true, usedCode, error: "Form reported validation errors after submit", finalUrl: page.url(), ...base(started) };
    }
    if (!confirmationText && state === "timeout") {
      // No thank-you text and the same form still on the same page: the click most likely did not send it.
      const formStill = (await page.locator("[data-norinote-form]").count().catch(() => 0)) > 0 && page.url() === startUrl;
      if (formStill) {
        return {
          status: "failed", submitClicked: true, usedCode, finalUrl: page.url(), ...base(started),
          error: "Clicked submit, but the form is still on the page and no confirmation appeared. It may not have gone through: check the employer's site or your email before trying again.",
        };
      }
    }
    if (!confirmationText) ctx.onEvent("submit_unconfirmed", "Submitted but no confirmation text was found", undefined, "warn");
    ctx.onEvent("submitted", confirmationText ?? "Submitted", { submitMs: Date.now() - started });
    return { status: "submitted", submitClicked: true, usedCode, confirmationText, finalUrl: page.url(), ...base(started) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.onEvent("error", error, undefined, "error");
    return { status: "failed", submitClicked: clicked, usedCode, error, ...base(started) };
  }
}


