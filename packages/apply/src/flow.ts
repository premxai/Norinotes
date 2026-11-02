/**
 * The shared apply flow every driver uses: open the form (straight to its own URL when it can be derived), discover,
 * fill in one pass, then stop (dry run, pending questions, captcha) or submit and read the confirmation.
 *
 * Safety: submit is only ever clicked through `clickSubmit`, which re-checks `submitAllowed`. Password fields are never
 * filled (an account wall returns needs_user), and CAPTCHAs are never solved or bypassed (needs_user).
 */
import path from "node:path";
import type { Page } from "playwright";
import type { DriverContext, FillResult, FormField, PendingQuestion, SubmitResult } from "./types.js";
import { detectCaptcha, discoverFields, fillForm, findSubmitButton, PREFERRED_FORM_SELECTORS } from "./form.js";
import {
  runScript, CONFIRMATION_SCRIPT, CODE_INPUTS_SCRIPT, ERRORS_SCRIPT, PASSWORD_SCRIPT, FORM_VISIBLE_SCRIPT,
} from "./dom.js";

export type FlowOptions = {
  name: string;
  preferredForms?: string[];
  /** The form's own address when it can be derived from the posting URL (skips the job page). */
  formUrl: (url: string) => string | null;
  /** Site-specific step before discovery (e.g. wait for a client-rendered form, or jump into an embedded iframe). */
  beforeDiscover?: (page: Page, ctx: DriverContext) => Promise<void>;
};

const NAV_TIMEOUT = 30_000;
const CONFIRM_RE = /thank you|thanks for applying|application (has been |was )?(submitted|received)/i;
/** A page that turns automation away. Norinote hands these to the person and never tries to get around them. */
const BLOCKED_RE = /access is temporarily restricted|unusual activity from your (device|network)|automated \(bot\) activity|verify you are (a )?human|are you a robot|checking if the site connection is secure/i;
const VERIFY_RE = /verification code|enter the code|security code|code (was|has been) sent/i;

export const CAPTCHA_REASON = "A captcha is on the form. Norinote never solves or bypasses captchas: open the posting and apply yourself.";
export const BLOCKED_REASON = "This site blocks automated applications: open the posting and apply yourself.";
export const ACCOUNT_REASON = "The site asks you to sign in or create an account. Norinote never does that: open the posting and apply yourself.";

/** The one and only place the submit gate is decided: not a dry run, and ALLOW_REAL_SUBMIT is exactly "true". */
export function submitAllowed(ctx: Pick<DriverContext, "dryRun">): boolean {
  return ctx.dryRun === false && process.env.ALLOW_REAL_SUBMIT === "true";
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText : ''").then(String).catch(() => "");
}

async function goto(page: Page, ctx: DriverContext, url: string): Promise<void> {
  ctx.onEvent("navigate", `Opening ${url}`, { url });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
  } catch (err) {
    // Pages with long-polling never go idle; continue if the document itself loaded.
    if (!page.url() || page.url() === "about:blank") throw err;
    ctx.onEvent("navigate_warn", "Page did not reach network idle; continuing", undefined, "warn");
  }
}

/** Click an "Apply" button/tab/link when the form is not visible yet. */
async function revealForm(page: Page, ctx: DriverContext, preferred: string[]): Promise<void> {
  if (await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred)) return;
  const candidates = [
    page.getByRole("button", { name: /apply/i }),
    page.getByRole("link", { name: /^\s*apply\b/i }),
    page.getByRole("tab", { name: /apply|application/i }),
    page.locator('a[href*="#app"], a[href*="application"]'),
  ];
  for (const c of candidates) {
    const first = c.first();
    if (await first.isVisible().catch(() => false)) {
      ctx.onEvent("reveal_form", "Opening the application form");
      await first.click().catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      for (let i = 0; i < 20; i++) {
        if (await runScript<boolean>(page, FORM_VISIBLE_SCRIPT, preferred)) return;
        await page.waitForTimeout(250);
      }
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

const base = (started: number) => ({ durationMs: Date.now() - started });

export async function fillFlow(page: Page, ctx: DriverContext, opts: FlowOptions): Promise<FillResult> {
  const started = Date.now();
  const preferred = opts.preferredForms ?? PREFERRED_FORM_SELECTORS;
  const derived = opts.formUrl(ctx.applyUrl);
  const targets = [...new Set([derived, ctx.applyUrl].filter((u): u is string => Boolean(u)))];

  let fields: FormField[] = [];
  for (const [i, target] of targets.entries()) {
    await goto(page, ctx, target);
    if (opts.beforeDiscover) await opts.beforeDiscover(page, ctx);
    await revealForm(page, ctx, preferred);

    if (await runScript<boolean>(page, PASSWORD_SCRIPT)) {
      ctx.onEvent("needs_user", "The site asks for a password; Norinote never signs in or creates accounts", undefined, "warn");
      return { status: "needs_user", formUrl: page.url(), fields: [], files: [], pending: [], needsUser: { kind: "account", reason: ACCOUNT_REASON }, ...base(started) };
    }

    fields = await discoverFields(page, preferred);
    ctx.onEvent("discovered", `Found ${fields.length} fields`, { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required })) });
    if (fields.length) break;

    if (BLOCKED_RE.test(await bodyText(page))) {
      ctx.onEvent("needs_user", "The site turned automated access away; Norinote does not try to get around that", undefined, "warn");
      return { status: "needs_user", formUrl: page.url(), fields: [], files: [], pending: [], needsUser: { kind: "blocked", reason: BLOCKED_REASON }, ...base(started) };
    }
    if (i < targets.length - 1) ctx.onEvent("form_not_found", "No form at the derived address; trying the posting URL", { url: target }, "warn");
  }
  if (!fields.length) {
    return { status: "failed", formUrl: page.url(), fields: [], files: [], pending: [], error: "No application form fields found", ...base(started) };
  }

  const formUrl = page.url();
  const outcome = await fillForm(page, ctx, fields);
  const { filled, files } = outcome;
  let pending: PendingQuestion[] = outcome.pending;

  if (!files.length && ctx.resumePdfPath && (await attachResumeFallback(page, ctx))) {
    files.push({ label: "Resume/CV", path: ctx.resumePdfPath });
    filled.push({ label: "Resume/CV", value: path.basename(ctx.resumePdfPath), kind: "file" });
    pending = pending.filter((p) => !(p.type === "file" && /resume|cv/i.test(p.text)));
  }

  const captcha = await detectCaptcha(page);
  if (captcha) {
    ctx.onEvent("captcha", `CAPTCHA detected (${captcha}); leaving it for the user`, { captcha }, "warn");
    return { status: "needs_user", formUrl, fields: filled, files, pending, needsUser: { kind: "captcha", reason: CAPTCHA_REASON }, ...base(started) };
  }
  if (pending.length) {
    ctx.onEvent("needs_user", `${pending.length} question(s) need the user`, { pending: pending.map((p) => p.text) }, "warn");
    const n = pending.length;
    return {
      status: "needs_user", formUrl, fields: filled, files, pending,
      needsUser: { kind: "questions", reason: `The form asks ${n} required question${n === 1 ? "" : "s"} Norinote has no answer for.` }, ...base(started),
    };
  }
  return { status: "filled", formUrl, fields: filled, files, pending: [], ...base(started) };
}

/** Poll until the page shows a confirmation, a verification prompt, or validation errors. */
async function waitForAfterSubmit(page: Page, startUrl: string, ms: number, confirmedBefore: boolean): Promise<"confirmed" | "verify" | "errors" | "timeout"> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    try {
      const text = await bodyText(page);
      const formGone = (await page.locator("[data-norinote-form]").count()) === 0 || page.url() !== startUrl;
      if (CONFIRM_RE.test(text) && (!confirmedBefore || formGone)) return "confirmed";
      if (VERIFY_RE.test(text) && (await runScript<number>(page, CODE_INPUTS_SCRIPT)) > 0) return "verify";
      if ((await runScript<number>(page, ERRORS_SCRIPT)) > 0) return "errors";
      if (page.url() !== startUrl) await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    } catch {
      // Navigation in progress; try again.
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
  for (let i = 0; i < Math.min(n, chars.length); i++) {
    await page.locator(`[data-norinote-code="${i}"]`).fill(chars[i]!);
  }
}

async function clickSubmit(page: Page, ctx: DriverContext): Promise<string> {
  if (!submitAllowed(ctx)) throw new Error("Refusing to submit: dryRun is set or ALLOW_REAL_SUBMIT is not \"true\"");
  const btn = await findSubmitButton(page);
  if (!btn) throw new Error("Submit button not found");
  ctx.onEvent("submit", `Clicking "${btn.label}"`, { label: btn.label });
  await btn.locator.click();
  return btn.label;
}

/** Send the filled form that `fillFlow` left on this page. */
export async function submitFlow(page: Page, ctx: DriverContext, opts: Pick<FlowOptions, "name">): Promise<SubmitResult> {
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
    await clickSubmit(page, ctx);
    clicked = true;
    let state = await waitForAfterSubmit(page, startUrl, 20_000, confirmedBefore);

    if (state === "verify") {
      usedCode = true;
      ctx.onEvent("verification", "Site asked for an emailed verification code");
      const code = await ctx.waitForCode(opts.name);
      if (!code) {
        return {
          status: "needs_user", submitClicked: true, usedCode, ...base(started),
          needsUser: { kind: "verification_code", reason: "The site emailed a verification code and none arrived in time. Enter it on the employer's page to finish." },
        };
      }
      await enterCode(page, code);
      ctx.onEvent("verification", "Entered verification code");
      const verifyUrl = page.url();
      await clickSubmit(page, ctx);
      state = await waitForAfterSubmit(page, verifyUrl, 20_000, confirmedBefore);
    }

    if (await detectCaptcha(page)) {
      ctx.onEvent("captcha", "CAPTCHA appeared after submit; leaving it for the user", undefined, "warn");
      return { status: "needs_user", submitClicked: true, usedCode, needsUser: { kind: "captcha", reason: CAPTCHA_REASON }, ...base(started) };
    }

    const confirmationText = (await runScript<string | null>(page, CONFIRMATION_SCRIPT).catch(() => null)) ?? undefined;
    if (!confirmationText && state === "errors") {
      return { status: "failed", submitClicked: true, usedCode, error: "Form reported validation errors after submit", finalUrl: page.url(), ...base(started) };
    }
    if (!confirmationText && state === "timeout") {
      // No thank-you text and the same form still on the same page: the click most likely did not send it. Calling it
      // "submitted" would record a job the employer never got.
      const formStill = (await page.locator("[data-norinote-form]").count().catch(() => 0)) > 0 && page.url() === startUrl;
      if (formStill) {
        return {
          status: "failed", submitClicked: true, usedCode, finalUrl: page.url(), ...base(started),
          error: "Clicked submit, but the form is still on the page and no confirmation appeared. It may not have gone through: check the employer's site or your email before trying again.",
        };
      }
    }
    if (!confirmationText) ctx.onEvent("submit_unconfirmed", "Submitted but no confirmation text was found", undefined, "warn");
    ctx.onEvent("submitted", confirmationText ?? "Submitted");
    return { status: "submitted", submitClicked: true, usedCode, confirmationText, finalUrl: page.url(), ...base(started) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.onEvent("error", error, undefined, "error");
    return { status: "failed", submitClicked: clicked, usedCode, error, ...base(started) };
  }
}
