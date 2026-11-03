/**
 * The filler: puts a prepared answer plan into a live form, fast and with read-back.
 *
 *   files first (Lever and Ashby re-parse the resume and autofill over what was typed), then every text field in ONE
 *   round trip (native setter + input/change/blur), then choices one at a time: native selects by label with fuzzy match
 *   and a decline fallback, react-select style comboboxes (click, type a filter, wait for the visible listbox, click the
 *   option by its text, read back), radio and checkbox groups by clicking the visible label, Ashby yes/no buttons,
 *   location autocompletes (suggestions settle before moving on) and the phone country picker. Then a validation scan:
 *   a field showing an error is fixed once, and then it is the person's (needs_user).
 *
 * Nothing here guesses: a required field with no value is a pending question. No fixed sleeps: every wait is for a
 * condition (a listbox, a chip, a suggestion) with a short cap.
 */
import path from "node:path";
import type { Locator, Page } from "playwright";
import { runScript, BATCH_SET_SCRIPT, VALIDATION_SCRIPT, FIELD_BLOCK_TEXT_SCRIPT, SELECT_OPTIONS_SCRIPT, CHOICE_LABELS_SCRIPT } from "./dom.js";
import {
  classifyField, comboboxOptionTexts, eeoValue, foreignWorkCountry, norm, pendingFromField, phoneCountryValue, profileValue, questionId, type DiscoveredField,
} from "./form.js";
import { labelKey, type WidgetStrategy } from "./recipes.js";
import type { DriverContext, FilledField, PendingQuestion } from "./types.js";

export type FillTimings = { filesMs: number; textMs: number; choicesMs: number; validateMs: number };

export type FillOutcome = {
  filled: FilledField[];
  pending: PendingQuestion[];
  files: { label: string; path: string }[];
  /** The widget strategy that filled each field, by normalised label (for the recipe cache). */
  strategies: Record<string, WidgetStrategy>;
  /** Fields that failed read-back or validation even after one fix. */
  unresolved: { label: string; reason: string }[];
  /** A widget needed a second strategy (a stale recipe or selector healed). */
  healed: boolean;
  timings: FillTimings;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const DECLINE_RE = /decline|prefer not|do not wish|don.t wish|choose not|not to (say|answer|disclose|identify)|rather not/i;
const YES = /^(y|yes|true|1|i am|i do|i will|i have)\b/i;
const NO = /^(n|no|false|0|i am not|i do not|i don't|i will not|i have not)\b/i;
const CHECK_ON = /^(y|yes|true|1|on|checked|acknowledged?|i acknowledge|agreed?|i agree|accept(ed)?|i accept|confirm(ed)?|i confirm|consent|i consent)\b/i;
const MULTI_SPLIT = /\s*;\s*/;
const DECLINE_MARK = "@decline";
const EEO_CLASSES = new Set(["gender", "race", "hispanic", "veteran", "disability"]);

const polarity = (s: string): "yes" | "no" | undefined => (NO.test(s.trim()) ? "no" : YES.test(s.trim()) ? "yes" : undefined);

/** Index of the option text that means `value`: exact, polarity, shortest containing, longest contained. -1 when none. */
export function pickOption(texts: string[], value: string): number {
  const v = norm(value);
  const t = texts.map((x) => norm(clean(x)));
  const exact = t.findIndex((x) => x === v);
  if (exact >= 0) return exact;
  const p = polarity(value);
  if (p && v.split(" ").length <= 3) {
    const hits = t.map((x, j) => ({ x, j })).filter(({ x }) => polarity(x) === p);
    if (hits.length) return hits.sort((a, b) => a.x.length - b.x.length)[0]!.j;
  }
  const containing = t.map((x, j) => ({ x, j })).filter(({ x }) => x && v.length >= 2 && x.includes(v)).sort((a, b) => a.x.length - b.x.length);
  if (containing.length) return containing[0]!.j;
  const contained = t.map((x, j) => ({ x, j })).filter(({ x }) => x.length >= 3 && v.includes(x)).sort((a, b) => b.x.length - a.x.length);
  if (contained.length) return contained[0]!.j;
  return -1;
}

/** Lookup of a prepared value: `field:<key|name|id>`, then question id, then the label text. */
function valueLookup(answers: Record<string, string>): (f: DiscoveredField) => string | undefined {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(answers)) { map.set(k, v); map.set(norm(k), v); }
  return (f) => {
    const keys = [f.key, f.name, f.id].filter((k): k is string => !!k).map((k) => `field:${k}`);
    for (const k of [...keys, questionId(f.label), f.label, norm(f.label)]) {
      const v = map.get(k);
      if (v !== undefined && v !== "") return v;
    }
    return undefined;
  };
}

type Resolved = { field: DiscoveredField; value: string; source: string; cls: string };

/** Decide every field's value before touching the page. */
function resolve(ctx: DriverContext, fields: DiscoveredField[]): { todo: Resolved[]; pending: PendingQuestion[]; skipped: DiscoveredField[] } {
  const lookup = valueLookup(ctx.answers);
  const todo: Resolved[] = [];
  const pending: PendingQuestion[] = [];
  const skipped: DiscoveredField[] = [];
  const classes = fields.map((f) => classifyField(f));
  // A lone unlabeled file input is almost always the resume upload.
  if (!classes.includes("resume")) {
    const i = fields.findIndex((f, j) => f.kind === "file" && classes[j] === "custom");
    if (i >= 0) classes[i] = "resume";
  }
  for (const [i, field] of fields.entries()) {
    const cls = field.kind === "file" || classes[i] !== "resume" ? classes[i]! : "custom";
    let value = lookup(field);
    let source = "plan";
    if (value === "@resume") value = ctx.resumePdfPath;
    if (value === undefined && (field.group === "phone_country" || field.widget === "phone-country")) { value = phoneCountryValue(ctx.profile); source = "profile"; }
    if (value === undefined) {
      const foreign = (cls === "work_auth" || cls === "sponsorship") && foreignWorkCountry(field.label);
      value = foreign ? undefined : profileValue(cls, ctx.profile, ctx.resumePdfPath);
      source = "profile";
    }
    if (value === undefined) { value = eeoValue(cls, ctx.profile, field.options); source = "eeo"; }
    // An EEO menu whose options are only known once it opens: its own decline option, picked on the page.
    if (value === undefined && field.required && EEO_CLASSES.has(cls) && !(field.options?.length)) { value = DECLINE_MARK; source = "eeo"; }
    if (value === undefined || value === "") {
      if (field.required) pending.push(pendingFromField(field));
      else skipped.push(field);
      continue;
    }
    if (field.kind === "file" && cls !== "resume" && value !== ctx.resumePdfPath && !path.isAbsolute(value)) {
      // A file field's plan value must be a file on disk; anything else is not uploadable.
      if (field.required) pending.push(pendingFromField(field));
      continue;
    }
    todo.push({ field, value, source, cls });
  }
  return { todo, pending, skipped };
}

async function blockText(page: Page, selector: string): Promise<string> {
  return runScript<string>(page, FIELD_BLOCK_TEXT_SCRIPT, selector).catch(() => "");
}

/** Wait until `check` holds or the cap passes; polls on animation frames' worth of time, never a fixed sleep. */
async function until(check: () => Promise<boolean>, capMs: number, stepMs = 80): Promise<boolean> {
  const deadline = Date.now() + capMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// ---- widgets ----------------------------------------------------------------------------------------------------------

async function uploadFile(page: Page, f: DiscoveredField, file: string): Promise<string> {
  await page.locator(f.selector).first().setInputFiles(file);
  const name = path.basename(file);
  const stem = name.replace(/\.[a-z0-9]+$/i, "");
  // The filename chip proves the site took the file (and, on Lever and Ashby, that parsing finished).
  // Some boards replace the input with a chip once the upload finishes (Greenhouse): look in the form, not only the block.
  const ok = await until(async () => {
    const form = await page.locator("[data-norinote-form]").first().innerText().catch(() => "");
    const text = `${await blockText(page, f.selector)} ${form}`.toLowerCase();
    return text.includes(name.toLowerCase()) || text.includes(stem.toLowerCase());
  }, 8000, 150);
  if (!ok) {
    const count = await page.locator(f.selector).first().evaluate((el) => (el as unknown as { files?: { length: number } }).files?.length ?? 0).catch(() => 0);
    if (!count) throw new Error("the upload did not register");
  }
  return name;
}

async function nativeSelect(page: Page, f: DiscoveredField, value: string): Promise<string> {
  const opts = (await runScript<{ text: string; value: string }[]>(page, SELECT_OPTIONS_SCRIPT, f.selector)).filter((o) => o.value !== "" || o.text !== "");
  const real = opts.filter((o) => o.value !== "" && !/^select\b|^choose\b|^--/i.test(o.text));
  let i = pickOption(real.map((o) => o.text), value);
  if (i < 0) i = real.findIndex((o) => norm(o.value) === norm(value));
  if (i < 0 && DECLINE_RE.test(value)) i = real.findIndex((o) => DECLINE_RE.test(o.text));
  if (i < 0) throw new Error(`no option matching "${value}"`);
  await page.locator(f.selector).first().selectOption({ value: real[i]!.value });
  return real[i]!.text;
}

/** [role=option] items of the listbox this combobox controls, else any visible listbox. */
async function listboxOptions(page: Page, input: Locator): Promise<Locator> {
  const id = (await input.getAttribute("aria-controls").catch(() => null)) || (await input.getAttribute("aria-owns").catch(() => null));
  if (id) {
    const box = page.locator(`[id=${JSON.stringify(id)}]`);
    if (await box.count().catch(() => 0)) return box.locator('[role="option"]');
  }
  return page.locator('[role="listbox"]:visible [role="option"], .select__menu:visible [role="option"], .select__menu:visible .select__option');
}

/** The value a react-select style widget shows (its single-value element), or "". */
async function chosenText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => {
    const box = (el as unknown as { closest(s: string): { querySelector(s: string): { textContent: string | null } | null } | null }).closest("[class*=value-container], [class*=control], .select-shell");
    return box?.querySelector("[class*=single-value], [class*=singleValue]")?.textContent?.trim() ?? "";
  }).catch(() => "");
}

async function comboboxReadsBack(page: Page, f: DiscoveredField, picked: string): Promise<boolean> {
  const text = norm(await blockText(page, f.selector));
  if (text.includes(norm(picked).slice(0, 40))) return true;
  // Some pickers show a short form of the choice (the phone country shows "+1" for "United States +1").
  const shown = norm(await chosenText(page, f.selector));
  return shown.length > 0 && norm(picked).includes(shown);
}

/** react-select style: click, type a filter, wait for the visible listbox, click the option by text, read back. */
async function combobox(page: Page, f: DiscoveredField, value: string): Promise<string> {
  const input = page.locator(f.selector).first();
  const wanted = f.multiple || (f.options?.length ?? 0) > 0 && value.includes(";") ? value.split(MULTI_SPLIT).filter(Boolean) : [value];
  const chosen: string[] = [];
  for (const want of wanted) {
    let done = false;
    let lastError = "";
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      await input.click({ timeout: 4000 }).catch(() => input.focus());
      // A long option is found by its first words; a second attempt searches the full list.
      const filter = attempt === 0 && want !== DECLINE_MARK ? want.split(/\s+/).slice(0, 4).join(" ").slice(0, 40) : "";
      // Typed, not filled: react-select closes its menu on a programmatic fill (seen live on Greenhouse).
      await input.fill("").catch(() => {});
      if (filter) await input.pressSequentially(filter, { delay: 0 }).catch(() => {});
      let opts = await listboxOptions(page, input);
      if (!(await until(async () => (await opts.count()) > 0, 2500))) {
        await input.press("ArrowDown").catch(() => {});
        opts = await listboxOptions(page, input);
        await until(async () => (await opts.count()) > 0, 1500);
      }
      const texts = (await opts.allInnerTexts().catch(() => [] as string[])).map(clean);
      const idx = want === DECLINE_MARK ? texts.findIndex((x) => DECLINE_RE.test(x)) : pickOption(texts, want);
      if (idx < 0) { lastError = `no option matching "${want}" among ${texts.length} (${texts.slice(0, 3).join(" | ").slice(0, 80)})`; await input.fill("").catch(() => {}); continue; }
      try {
        await opts.nth(idx).click({ timeout: 3000 });
        const picked = texts[idx]!;
        if (await until(() => comboboxReadsBack(page, f, picked), 1500)) { chosen.push(picked); done = true; }
        else lastError = `"${picked}" did not read back`;
      } catch (err) {
        lastError = err instanceof Error ? err.message.split(/\r?\n/)[0]! : String(err);
      }
    }
    await input.press("Escape").catch(() => {});
    if (!done) throw new Error(lastError || `could not pick "${want}"`);
  }
  return chosen.join(", ");
}

/** Radio and checkbox groups: click the visible label of the option, then read the checked state back. */
async function choiceGroup(page: Page, f: DiscoveredField, value: string): Promise<string> {
  const labels = await runScript<{ label: string; value: string }[]>(page, CHOICE_LABELS_SCRIPT, f.selector);
  const all = page.locator(f.selector);
  if (f.kind === "checkbox" && labels.length <= 1) {
    const on = CHECK_ON.test(value.trim());
    const box = all.first();
    if ((await box.isChecked().catch(() => false)) !== on) {
      const id = await box.getAttribute("id").catch(() => null);
      const lab = id ? page.locator(`label[for=${JSON.stringify(id)}]`).first() : null;
      if (lab && (await lab.isVisible().catch(() => false))) await lab.click({ timeout: 3000 }).catch(() => {});
      if ((await box.isChecked().catch(() => false)) !== on) await box.setChecked(on, { force: true, timeout: 3000 });
    }
    if ((await box.isChecked()) !== on) throw new Error("the checkbox did not change");
    return on ? "Yes" : "No";
  }
  const wanted = f.kind === "checkbox" ? value.split(/\s*[;|]\s*/).filter(Boolean) : [value];
  const chosen: string[] = [];
  for (const w of wanted) {
    const texts = labels.map((l) => l.label || l.value);
    let i = pickOption(texts, w);
    if (i < 0 && DECLINE_RE.test(w)) i = texts.findIndex((t) => DECLINE_RE.test(t));
    if (i < 0) throw new Error(`no choice matching "${w}"`);
    const input = all.nth(i);
    if (!(await input.isChecked().catch(() => false))) {
      const id = await input.getAttribute("id").catch(() => null);
      const forLabel = id ? page.locator(`label[for=${JSON.stringify(id)}]`) : input.locator("xpath=ancestor::label[1]");
      const lab = input.locator("xpath=ancestor::label[1]").or(forLabel).first();
      const clicked = (await lab.isVisible().catch(() => false)) && (await lab.click({ timeout: 3000 }).then(() => true, () => false));
      if (!clicked || !(await input.isChecked().catch(() => false))) await input.setChecked(true, { force: true, timeout: 3000 });
    }
    if (!(await input.isChecked())) throw new Error(`"${texts[i]}" did not stay selected`);
    chosen.push(texts[i]!);
  }
  return chosen.join(", ");
}

/** Ashby yes/no: two buttons over a hidden checkbox. */
async function yesNoButtons(page: Page, f: DiscoveredField, value: string): Promise<string> {
  const yes = polarity(value) !== "no";
  const entry = page.locator(f.selector).first();
  const button = entry.getByRole("button", { name: yes ? /^\s*yes\s*$/i : /^\s*no\s*$/i }).first();
  await button.click({ timeout: 4000 });
  const ok = await until(async () => button.evaluate((b) => {
    const e = b as unknown as { className: unknown; textContent: string | null; getAttribute(n: string): string | null; closest(s: string): { querySelector(s: string): { checked: boolean } | null } | null };
    const cls = typeof e.className === "string" ? e.className : "";
    const box = e.closest("[data-field-path]")?.querySelector("input[type=checkbox]") ?? null;
    return /active|selected|checked/i.test(cls) || e.getAttribute("aria-pressed") === "true" || (box !== null && box.checked === (e.textContent ?? "").trim().toLowerCase().startsWith("y"));
  }), 1500);
  if (!ok) throw new Error("the yes/no choice did not read back");
  return yes ? "Yes" : "No";
}

/** Location autocomplete: type, wait for suggestions to settle, pick the best, read back. */
async function location(page: Page, f: DiscoveredField, value: string): Promise<string> {
  const input = page.locator(f.selector).first();
  await input.click({ timeout: 4000 }).catch(() => input.focus());
  await input.fill("").catch(() => {});
  await input.pressSequentially(value.slice(0, 40), { delay: 15 });
  const suggestions = page.locator('[role="listbox"]:visible [role="option"], .pac-container:visible .pac-item, ul[id*="autocomplete"]:visible li, .dropdown-results:visible > div, .location-results:visible li');
  let count = 0;
  let last = -1;
  // Settle: the list is stable for one poll (async suggestions arrive in bursts).
  await until(async () => { const n = await suggestions.count(); const settled = n > 0 && n === last; last = n; count = n; return settled; }, 3000, 200);
  if (count > 0) {
    const texts = (await suggestions.allInnerTexts()).map(clean);
    const i = Math.max(0, pickOption(texts, value));
    await suggestions.nth(i).click({ timeout: 3000 }).catch(() => {});
  } else {
    const auto = (await input.getAttribute("aria-autocomplete").catch(() => null)) ?? (await input.getAttribute("role").catch(() => null));
    if (auto) { await input.press("ArrowDown").catch(() => {}); await input.press("Enter").catch(() => {}); }
  }
  const now = (await input.inputValue().catch(() => "")) || (await chosenText(page, f.selector)) || (await blockText(page, f.selector));
  if (!clean(now)) throw new Error("the location was not accepted");
  return clean(now).slice(0, 120);
}

async function strategyFor(page: Page, f: DiscoveredField): Promise<WidgetStrategy> {
  if (f.widget) return f.widget as WidgetStrategy;
  if (f.kind === "file") return "file";
  if (f.kind === "radio") return "radio-label";
  if (f.kind === "checkbox") return (f.options?.length ?? 0) > 1 ? "checkbox-label" : "checkbox";
  if (f.kind === "select") return (await page.locator(f.selector).first().evaluate((el) => el.tagName).catch(() => "")) === "SELECT" ? "native-select" : "combobox";
  return "text";
}

/** Fill one field with one strategy. Returns what the field holds now. */
async function fillWith(page: Page, s: WidgetStrategy, f: DiscoveredField, value: string): Promise<string> {
  switch (s) {
    case "file": return uploadFile(page, f, value);
    case "native-select": return nativeSelect(page, f, value);
    case "combobox": case "phone-country": return combobox(page, f, value);
    case "radio-label": case "checkbox-label": case "checkbox": return choiceGroup(page, f, value);
    case "yesno": return yesNoButtons(page, f, value);
    case "location": return location(page, f, value);
    case "text": {
      const loc = page.locator(f.selector).first();
      await loc.fill(value);
      return loc.inputValue();
    }
  }
}

const FALLBACK: Partial<Record<WidgetStrategy, WidgetStrategy>> = { location: "text", combobox: "native-select", "native-select": "combobox", "phone-country": "native-select" };

/** Strategy, then one heal with the alternative when the first fails. */
async function fillOne(page: Page, f: DiscoveredField, value: string, hint?: WidgetStrategy): Promise<{ value: string; strategy: WidgetStrategy; healed: boolean }> {
  const first = hint ?? (await strategyFor(page, f));
  try {
    return { value: await fillWith(page, first, f, value), strategy: first, healed: false };
  } catch (err) {
    const alt = hint && hint !== (await strategyFor(page, f)) ? await strategyFor(page, f) : FALLBACK[first];
    if (!alt) throw err;
    try {
      return { value: await fillWith(page, alt, f, value), strategy: alt, healed: true };
    } catch (again) {
      const msg = (e: unknown) => (e instanceof Error ? e.message.split(/\r?\n/)[0]! : String(e));
      throw new Error(`${first}: ${msg(err)}; ${alt}: ${msg(again)}`);
    }
  }
}

const TEXT_KINDS = new Set<DiscoveredField["kind"]>(["text", "email", "tel", "textarea"]);

/**
 * Fill every discovered field from ctx.answers (the prepared plan), then the profile. `hints` are recipe strategies by
 * label. Required fields without a value become pending questions; fields that cannot be set are reported unresolved.
 */
export async function fillFields(page: Page, ctx: DriverContext, fields: DiscoveredField[], hints: Record<string, WidgetStrategy> = {}): Promise<FillOutcome> {
  const timings: FillTimings = { filesMs: 0, textMs: 0, choicesMs: 0, validateMs: 0 };
  const { todo, pending, skipped } = resolve(ctx, fields);
  for (const f of skipped) ctx.onEvent("field_skipped", `Skipped optional field "${f.label}"`, { label: f.label, kind: f.kind });
  for (const p of pending) ctx.onEvent("field_pending", `No answer for required field "${p.text}"`, { label: p.text });
  const filled: FilledField[] = [];
  const files: { label: string; path: string }[] = [];
  const strategies: Record<string, WidgetStrategy> = {};
  const unresolved: { label: string; reason: string }[] = [];
  let healed = false;

  const record = (r: Resolved, value: string, strategy: WidgetStrategy, ms?: number) => {
    filled.push({ label: r.field.label, value, kind: r.field.kind });
    strategies[labelKey(r.field.label)] = strategy;
    ctx.onEvent("field_filled", `Filled "${r.field.label}"`, { label: r.field.label, kind: r.field.kind, strategy, source: r.source, value: r.field.kind === "file" ? value : value.slice(0, 120), ...(ms !== undefined ? { ms } : {}) });
  };
  const fail = (r: Resolved, err: unknown) => {
    const reason = err instanceof Error ? err.message.split(/\r?\n/)[0]! : String(err);
    ctx.onEvent("field_error", `Could not fill "${r.field.label}": ${reason}`, { label: r.field.label, kind: r.field.kind }, "warn");
    if (r.field.required) { unresolved.push({ label: r.field.label, reason }); pending.push(pendingFromField(r.field)); }
  };

  // 1. Files.
  let t = Date.now();
  for (const r of todo.filter((x) => x.field.kind === "file")) {
    try {
      const name = await uploadFile(page, r.field, r.value);
      files.push({ label: r.field.label, path: r.value });
      record(r, name, "file");
    } catch (err) { fail(r, err); }
  }
  timings.filesMs = Date.now() - t;

  // 2. Plain text in one round trip; anything that did not stick is typed.
  t = Date.now();
  const texts = todo.filter((x) => TEXT_KINDS.has(x.field.kind) && (hints[labelKey(x.field.label)] ?? x.field.widget ?? "text") === "text");
  if (texts.length) {
    const after = await runScript<(string | null)[]>(page, BATCH_SET_SCRIPT, texts.map((r) => [r.field.selector, r.value])).catch(() => texts.map(() => null));
    for (const [i, r] of texts.entries()) {
      if (after[i] === r.value) { record(r, r.value, "text"); continue; }
      try {
        const loc = page.locator(r.field.selector).first();
        await loc.fill(r.value, { timeout: 4000 });
        const now = await loc.inputValue();
        if (now.trim() === "") throw new Error("the field stayed empty");
        record(r, now, "text");
      } catch (err) { fail(r, err); }
    }
  }
  timings.textMs = Date.now() - t;

  // 3. Choices and autocompletes, one at a time (menus are global and steal focus).
  t = Date.now();
  for (const r of todo.filter((x) => x.field.kind !== "file" && !texts.includes(x))) {
    const t1 = Date.now();
    try {
      const res = await fillOne(page, r.field, r.value, hints[labelKey(r.field.label)]);
      healed ||= res.healed;
      record(r, res.value, res.strategy, Date.now() - t1);
    } catch (err) { fail(r, err); }
  }
  timings.choicesMs = Date.now() - t;

  // 4. Read back text once more (a page script can clear a value after we set it), then the validation scan.
  t = Date.now();
  for (const entry of [...filled]) {
    const field = fields.find((f) => f.label === entry.label && TEXT_KINDS.has(f.kind) && (f.widget ?? "text") === "text");
    if (!field) continue;
    const now = await page.locator(field.selector).first().inputValue().catch(() => null);
    if (now === null || now === entry.value) continue;
    if (now.trim() === "") {
      const r = todo.find((x) => x.field === field)!;
      try { await page.locator(field.selector).first().fill(r.value); entry.value = await page.locator(field.selector).first().inputValue(); }
      catch (err) { filled.splice(filled.indexOf(entry), 1); fail(r, err); }
    } else entry.value = now;
  }
  const filledSelectors = todo.filter((r) => filled.some((x) => x.label === r.field.label)).map((r) => r.field.selector);
  let errors = await runScript<{ selector: string; error: string }[]>(page, VALIDATION_SCRIPT, filledSelectors).catch(() => []);
  if (errors.length) {
    ctx.onEvent("validation", `${errors.length} field(s) show an error; fixing once`, { errors });
    for (const e of errors) {
      const r = todo.find((x) => x.field.selector === e.selector);
      if (!r) continue;
      await fillOne(page, r.field, r.value).catch(() => null);
    }
    errors = await runScript<{ selector: string; error: string }[]>(page, VALIDATION_SCRIPT, filledSelectors).catch(() => []);
    for (const e of errors) {
      const r = todo.find((x) => x.field.selector === e.selector);
      if (!r) continue;
      unresolved.push({ label: r.field.label, reason: e.error });
      if (!pending.some((p) => p.text === r.field.label)) pending.push(pendingFromField(r.field));
      ctx.onEvent("validation_error", `"${r.field.label}" still shows an error: ${e.error}`, { label: r.field.label, error: e.error }, "warn");
    }
  }
  // A pending menu question needs its options for the person to answer: read them now (only for those).
  for (const p of pending) {
    const f = fields.find((x) => pendingFromField(x).id === p.id);
    if (f?.combobox && !p.options.length && f.widget !== "location") p.options = await comboboxOptionTexts(page, f.selector).catch(() => []);
  }
  timings.validateMs = Date.now() - t;
  return { filled, pending, files, strategies, unresolved, healed, timings };
}
