/**
 * Generic, label-based form handling shared by every driver: field discovery, classification, filling, submit-button
 * lookup and CAPTCHA detection. Ported from Nori's drivers, minus the per-field model call: every answer a form needs is
 * prepared before the click (the answers package), so an unknown required question becomes `pending`, never a guess.
 */
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { ApplicantProfile, DriverContext, FilledField, FormField, PendingQuestion } from "./types.js";
import {
  runScript, DISCOVER_SCRIPT, SELECT_OPTIONS_SCRIPT, CHOICE_LABELS_SCRIPT, FORCE_VALUE_SCRIPT,
  FIND_SUBMIT_SCRIPT, CAPTCHA_SCRIPT, FIELD_ERROR_SCRIPT,
} from "./dom.js";

export type FieldClass =
  | "first_name" | "last_name" | "full_name" | "email" | "phone" | "linkedin" | "website" | "github" | "social"
  | "location" | "country" | "resume" | "cover_letter" | "work_auth" | "sponsorship"
  | "gender" | "race" | "hispanic" | "veteran" | "disability" | "custom";

/** Discovery output: a FormField plus hints the filler uses (extra props survive as plain JSON). */
export type DiscoveredField = FormField & { combobox?: boolean; group?: "phone_country" };

/** Selectors tried, in order, as the form root before falling back to form heuristics. */
export const PREFERRED_FORM_SELECTORS = ["#application_form", "form#application-form", "#application-form", "form[data-testid*=application i]"];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const norm = (s: string) => s.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** A stable id for a question, used as the key of `applications.answers` and of a pending question. */
export function questionId(label: string): string {
  const slug = norm(label).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "question").slice(0, 80).replace(/-+$/g, "");
}

/**
 * A field label without the page's decoration. Some forms glue the required marker and helper text onto the label
 * ("Resume/CV ✱ATTACH RESUME/CVCouldn't auto-read resume..."), which would make labels unreadable on a receipt and
 * impossible to match against answers the person saved. Cut at the marker; drop a trailing "*".
 */
export function cleanLabel(raw: string, options: string[] = []): string {
  let s = clean(raw);
  // A radio or checkbox group's label can arrive with its options' text glued on ("RaceHispanic or Latino..."): cut there.
  const cuts = options.map((o) => clean(o)).filter((o) => o.length >= 4).map((o) => s.indexOf(o)).filter((i) => i > 0);
  if (cuts.length) s = s.slice(0, Math.min(...cuts));
  const mark = s.search(/[✱＊]/);
  if (mark > 0) s = s.slice(0, mark);
  s = s.replace(/\s*\*+\s*$/, "").trim();
  return s || clean(raw);
}

/** Find every input/textarea/select in the main application form. Tags the chosen form with data-norinote-form. */
export async function discoverFields(page: Page, preferred: string[] = PREFERRED_FORM_SELECTORS): Promise<DiscoveredField[]> {
  const fields = await runScript<DiscoveredField[]>(page, DISCOVER_SCRIPT, preferred);
  for (const f of fields) f.label = cleanLabel(f.label, f.options);
  for (const f of fields) {
    if (!f.combobox) continue;
    // react-select style: the listbox only renders while open, so open it, read the options, close it.
    const options = await comboboxOptionTexts(page, f.selector).catch(() => [] as string[]);
    if (options.length) f.options = options;
  }
  return fields;
}

export function classifyField(field: Pick<FormField, "label" | "kind">): FieldClass {
  const l = field.label.toLowerCase().replace(/\s+/g, " ").trim();
  const has = (re: RegExp) => re.test(l);
  if (has(/cover letter/)) return "cover_letter";
  if (has(/\bresume\b|\bcv\b|résumé|curriculum vitae/)) return "resume";
  if (has(/sponsor|\bvisa\b|h-?1b/)) return "sponsorship";
  if (has(/authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able)|eligible to work|right to work|work permit/)) return "work_auth";
  if (has(/hispanic|latino|latina|latinx/)) return "hispanic";
  if (has(/\bveteran|military service/)) return "veteran";
  if (has(/disabilit/)) return "disability";
  if (has(/\bgender\b|\bsex\b/) && !has(/pronoun/)) return "gender";
  if (has(/\brace\b|ethnic/)) return "race";
  if (has(/linkedin/)) return "linkedin";
  if (has(/github/)) return "github";
  if (has(/twitter|\bx\.com\b|\bx (handle|profile)\b|gitlab|mastodon|bluesky|dribbble|behance|stack ?overflow|facebook|instagram|tiktok/)) return "social";
  if (has(/e-?mail/)) return "email";
  if (has(/first name|given name|forename/)) return "first_name";
  if (has(/last name|surname|family name/)) return "last_name";
  if (has(/full name|legal name/) || /^(your )?name$/.test(l)) return "full_name";
  if (has(/phone|mobile|telephone|cell/)) return "phone";
  if (has(/website|portfolio|personal (site|url|page)|^url$|blog/)) return "website";
  if (/^country\b/.test(l) || has(/country of residence|which country/)) return "country";
  if (has(/location|city|where are you (based|located)|current address/)) return "location";
  return "custom";
}

const yesNo = (b: boolean | undefined) => (b === undefined ? undefined : b ? "Yes" : "No");

/** "US" -> "United States"; names pass through. */
export function countryName(country: string | undefined): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c)) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()) ?? c;
    } catch {
      return c;
    }
  }
  return c;
}

const DIAL_CODES: Record<string, string> = {
  "7": "RU", "20": "EG", "27": "ZA", "30": "GR", "31": "NL", "32": "BE", "33": "FR", "34": "ES", "36": "HU", "39": "IT",
  "40": "RO", "41": "CH", "43": "AT", "44": "GB", "45": "DK", "46": "SE", "47": "NO", "48": "PL", "49": "DE", "51": "PE", "52": "MX",
  "54": "AR", "55": "BR", "56": "CL", "57": "CO", "60": "MY", "61": "AU", "62": "ID", "63": "PH", "64": "NZ", "65": "SG", "66": "TH",
  "81": "JP", "82": "KR", "84": "VN", "86": "CN", "90": "TR", "91": "IN", "92": "PK", "234": "NG", "254": "KE", "351": "PT", "353": "IE",
  "358": "FI", "380": "UA", "420": "CZ", "852": "HK", "880": "BD", "886": "TW", "966": "SA", "971": "AE", "972": "IL",
};

/** Country for the phone dialing-code picker, from the profile phone ("+1 ..." => United States). */
export function phoneCountryValue(profile: ApplicantProfile): string | undefined {
  const m = profile.phone?.trim().match(/^(?:\+|00)\s*(\d{1,3})/);
  if (m) {
    const digits = m[1]!;
    if (digits.startsWith("1")) {
      // NANP: +1 covers the US and Canada; trust the profile country when it says Canada.
      return countryName(/^(ca|canada)$/i.test(profile.country ?? "") ? "CA" : "US");
    }
    for (const len of [3, 2, 1]) {
      const iso = digits.length >= len ? DIAL_CODES[digits.slice(0, len)] : undefined;
      if (iso) return countryName(iso);
    }
  }
  return countryName(profile.country);
}

const OTHER_COUNTRIES = [
  "united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "ireland",
  "canada", "australia", "new zealand", "india", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium",
  "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland", "czech republic", "czechia", "romania", "greece",
  "european union", "eu", "eea", "europe", "singapore", "japan", "china", "hong kong", "south korea", "korea", "taiwan", "israel",
  "uae", "united arab emirates", "saudi arabia", "brazil", "mexico", "argentina", "chile", "colombia", "philippines", "vietnam",
  "indonesia", "malaysia", "thailand", "south africa", "nigeria", "kenya", "egypt", "pakistan", "bangladesh", "turkey",
];
const OTHER_RE = new RegExp(String.raw`\b(${OTHER_COUNTRIES.join("|")}|u\.k\.)(?![a-z])`, "i");

/** The non-US country a work-authorization or sponsorship question names, or null. The profile only knows the US answer. */
export function foreignWorkCountry(label: string): string | null {
  return OTHER_RE.exec(label)?.[1] ?? null;
}

const EEO_KEYS: Partial<Record<FieldClass, string[]>> = {
  gender: ["gender", "sex"],
  race: ["race", "ethnicity"],
  hispanic: ["hispanic", "hispanicLatino", "ethnicity"],
  veteran: ["veteran", "veteranStatus"],
  disability: ["disability", "disabilityStatus"],
};
const DECLINE_RE = /decline|prefer not|do not wish|don.t wish|choose not|not to (say|answer|disclose|identify)|rather not/i;

/** The profile's equal-opportunity default for a field class. "decline" resolves to the form's own decline option. */
export function eeoValue(cls: FieldClass, profile: ApplicantProfile, options: string[] | undefined): string | undefined {
  const keys = EEO_KEYS[cls];
  const eeo = profile.eeo;
  if (!keys || !eeo) return undefined;
  const key = keys.find((k) => eeo[k] !== undefined && eeo[k] !== "");
  const raw = key ? eeo[key] : undefined;
  if (!raw) return undefined;
  if (/^(decline|declined|prefer not to say)$/i.test(raw.trim())) return options?.find((o) => DECLINE_RE.test(o));
  return raw;
}

export function profileValue(cls: FieldClass, profile: ApplicantProfile, resumePdfPath?: string): string | undefined {
  switch (cls) {
    case "first_name": return profile.firstName;
    case "last_name": return profile.lastName;
    case "full_name": return profile.fullName;
    case "email": return profile.email;
    case "phone": return profile.phone;
    case "linkedin": return profile.linkedin;
    case "website": return profile.website;
    case "github": return profile.github;
    case "location": return profile.location;
    case "country": return countryName(profile.country);
    case "resume": return resumePdfPath;
    case "work_auth": return yesNo(profile.workAuth.authorizedUS);
    case "sponsorship": return yesNo(profile.workAuth.needsSponsorship);
    default: return undefined;
  }
}

const YES = /^(y|yes|true|1|i am|i do|i will)\b/i;
const NO = /^(n|no|false|0|i am not|i do not|i don't|i will not)\b/i;
const CHECK_ON = /^(y|yes|true|1|on|checked|acknowledged?|i acknowledge|agreed?|i agree|accept(ed)?|i accept|confirm(ed)?|i confirm)\b/i;
function polarity(s: string): "yes" | "no" | undefined {
  const t = s.trim();
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return undefined;
}

/** Pick the option best matching value: exact text, exact value, yes/no polarity, prefix, substring. */
function matchOption<T extends { text: string; value: string }>(opts: T[], value: string): T | undefined {
  const v = norm(value);
  const usable = opts.filter((o) => o.value !== "" || o.text !== "");
  return (
    usable.find((o) => norm(o.text) === v) ??
    usable.find((o) => norm(o.value) === v) ??
    (polarity(value) ? usable.find((o) => o.value !== "" && polarity(o.text) === polarity(value)) : undefined) ??
    usable.find((o) => o.value !== "" && norm(o.text).startsWith(v)) ??
    usable.find((o) => o.value !== "" && v.length >= 3 && norm(o.text).includes(v))
  );
}

/** Index of the option text best matching value (case-insensitive): exact, shortest containing, longest contained, polarity. */
function pickIndex(texts: string[], value: string): number {
  const v = norm(value);
  const t = texts.map(norm);
  const exact = t.findIndex((x) => x === v);
  if (exact >= 0) return exact;
  const ranked = (pred: (x: string) => boolean, shortest: boolean) => {
    const hits = t.map((x, j) => ({ x, j })).filter(({ x }) => x !== "" && pred(x));
    hits.sort((a, b) => (shortest ? a.x.length - b.x.length : b.x.length - a.x.length));
    return hits[0]?.j ?? -1;
  };
  const containing = ranked((x) => x.includes(v), true);
  if (containing >= 0) return containing;
  const contained = ranked((x) => x.length >= 2 && v.includes(x), false);
  if (contained >= 0) return contained;
  const p = polarity(value);
  return p ? t.findIndex((x) => polarity(x) === p) : -1;
}

async function waitForCount(loc: Locator, ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  for (;;) {
    const n = await loc.count().catch(() => 0);
    if (n > 0 || Date.now() >= deadline) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** [role=option] items of the listbox this combobox controls (falls back to any visible listbox). */
async function comboOptionLocator(page: Page, input: Locator): Promise<Locator> {
  const id = (await input.getAttribute("aria-controls").catch(() => null)) || (await input.getAttribute("aria-owns").catch(() => null));
  if (id) {
    const box = page.locator(`[id=${JSON.stringify(id)}]`);
    if (await box.count()) return box.locator('[role="option"]');
  }
  return page.locator('[role="listbox"]:visible [role="option"]');
}

async function openCombobox(page: Page, input: Locator): Promise<Locator> {
  await input.click({ timeout: 5000 }).catch(() => input.focus());
  let opts = await comboOptionLocator(page, input);
  if (!(await waitForCount(opts, 1500))) {
    await input.press("ArrowDown").catch(() => {});
    opts = await comboOptionLocator(page, input);
    await waitForCount(opts, 1000);
  }
  return opts;
}

export async function comboboxOptionTexts(page: Page, selector: string): Promise<string[]> {
  const input = page.locator(selector).first();
  try {
    const opts = await openCombobox(page, input);
    const texts = (await opts.allInnerTexts()).map(clean).filter(Boolean);
    return [...new Set(texts)];
  } finally {
    await input.press("Escape").catch(() => {});
  }
}

async function fillCombobox(page: Page, field: FormField, value: string): Promise<string> {
  const input = page.locator(field.selector).first();
  let lastError = "";
  // Menus re-render (filtering, async options, blur timers), so an option can detach mid-click: retry a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.click({ timeout: 5000 }).catch(() => input.focus());
    await input.fill(attempt === 2 ? "" : value).catch(() => {});
    let opts = await comboOptionLocator(page, input);
    let texts = (await waitForCount(opts, 2500)) ? await opts.allInnerTexts() : [];
    let idx = pickIndex(texts, value);
    if (idx < 0) {
      // The typed filter may not match the option wording; clear it and search the full list.
      await input.fill("").catch(() => {});
      opts = await openCombobox(page, input);
      texts = await opts.allInnerTexts();
      idx = pickIndex(texts, value);
    }
    if (idx < 0) {
      await input.press("Escape").catch(() => {});
      throw new Error(`No option matching "${value}" for "${field.label}"`);
    }
    try {
      await opts.nth(idx).click({ timeout: 3000 });
      return clean(texts[idx]!);
    } catch (err) {
      lastError = err instanceof Error ? err.message.split(/\r?\n/)[0]! : String(err);
    }
  }
  await input.press("Escape").catch(() => {});
  throw new Error(`Could not pick "${value}" for "${field.label}": ${lastError}`);
}

async function setChecked(loc: Locator, on: boolean) {
  try {
    await loc.setChecked(on, { timeout: 5000 });
  } catch {
    // Custom-styled inputs hide the real control behind a label.
    await loc.setChecked(on, { force: true, timeout: 5000 });
  }
}

/** Fill one field. Returns the value as it now reads on the page (option text for choices, file name for files). */
export async function fillField(page: Page, field: FormField, value: string): Promise<string> {
  const loc = page.locator(field.selector).first();
  switch (field.kind) {
    case "file": {
      await loc.setInputFiles(value);
      return path.basename(value);
    }
    case "select": {
      const tag = await loc.evaluate((el) => el.tagName);
      if (tag !== "SELECT") return fillCombobox(page, field, value);
      const opts = await runScript<{ text: string; value: string }[]>(page, SELECT_OPTIONS_SCRIPT, field.selector);
      const hit = matchOption(opts, value);
      if (!hit) throw new Error(`No option matching "${value}" for "${field.label}"`);
      await loc.selectOption({ value: hit.value });
      return hit.text;
    }
    case "radio":
    case "checkbox": {
      const labels = await runScript<{ label: string; value: string }[]>(page, CHOICE_LABELS_SCRIPT, field.selector);
      const all = page.locator(field.selector);
      if (field.kind === "checkbox" && labels.length <= 1) {
        const on = CHECK_ON.test(value.trim());
        await setChecked(loc, on);
        return on ? "Yes" : "No";
      }
      const wanted = field.kind === "checkbox" ? value.split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [value];
      const chosen: string[] = [];
      for (const w of wanted) {
        const opts = labels.map((l, i) => ({ text: l.label, value: l.value, i }));
        const hit = matchOption(opts, w);
        if (!hit) throw new Error(`No choice matching "${w}" for "${field.label}"`);
        await setChecked(all.nth(hit.i), true);
        chosen.push(hit.text || hit.value);
      }
      return chosen.join(", ");
    }
    default: {
      await loc.fill(value);
      let current = await loc.inputValue().catch(() => "");
      if (current !== value) {
        await runScript(page, FORCE_VALUE_SCRIPT, [field.selector, value]);
        current = await loc.inputValue().catch(() => value);
      }
      return current;
    }
  }
}

/**
 * Places-style autocomplete (Greenhouse "Location (City)"): typing is not enough, a suggestion must be picked. Clicks the
 * first suggestion within 2 s, else ArrowDown+Enter only when the input advertises autocomplete (never Enter on a plain
 * input: that could submit the form). Returns the field's value afterwards.
 */
export async function settleAutocomplete(page: Page, field: FormField, ctx: Pick<DriverContext, "onEvent">): Promise<string> {
  const input = page.locator(field.selector).first();
  const first = page.locator('[role="listbox"]:visible [role="option"]')
    .or(page.locator(".pac-container:visible .pac-item"))
    .or(page.locator('ul[id*="autocomplete"]:visible li'))
    .first();
  const deadline = Date.now() + 2000;
  let picked = false;
  while (Date.now() < deadline) {
    if (await first.isVisible().catch(() => false)) {
      await first.click().catch(() => {});
      picked = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!picked) {
    const role = await input.getAttribute("role").catch(() => null);
    const auto = await input.getAttribute("aria-autocomplete").catch(() => null);
    if (role === "combobox" || auto) {
      await input.press("ArrowDown").catch(() => {});
      await input.press("Enter").catch(() => {});
      picked = true;
    }
  }
  await page.waitForTimeout(150);
  const error = await runScript<string | null>(page, FIELD_ERROR_SCRIPT, field.selector).catch(() => null);
  if (error || !picked) {
    ctx.onEvent("field_warn", `"${field.label}" may not have accepted the location${error ? `: ${error}` : " (no suggestion picked)"}`, { label: field.label, error }, "warn");
  }
  return input.inputValue().catch(() => "");
}

/** The shared PendingQuestion for a field the form needs and nobody could answer. */
export function pendingFromField(field: FormField): PendingQuestion {
  const type: PendingQuestion["type"] =
    field.kind === "textarea" ? "textarea"
    : field.kind === "select" || field.kind === "radio" ? "select"
    : field.kind === "checkbox" ? ((field.options?.length ?? 0) > 1 ? "multiselect" : "boolean")
    : field.kind === "file" ? "file"
    : "text";
  return { id: questionId(field.label), text: field.label, type, options: field.options ?? [], required: field.required };
}

export type FillOutcome = { filled: FilledField[]; pending: PendingQuestion[]; files: { label: string; path: string }[] };

const isPhoneCountry = (f: FormField) => (f as DiscoveredField).group === "phone_country" || /^phone country code$/i.test(f.label);

/** Lookup of answers by question id or by normalised question text. */
export function answerLookup(answers: Record<string, string>): (label: string) => string | undefined {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(answers)) {
    map.set(k, v);
    map.set(norm(k), v);
  }
  return (label) => {
    for (const key of [questionId(label), label, norm(label)]) {
      const v = map.get(key);
      if (v !== undefined && v !== "") return v;
    }
    return undefined;
  };
}

/**
 * Fill every discovered field in one pass. Value precedence: ctx.answers (explicit decisions, prepared answers), then the
 * profile, then the profile's equal-opportunity defaults. Required fields left without a value become pending questions.
 */
export async function fillForm(page: Page, ctx: DriverContext, fields: FormField[]): Promise<FillOutcome> {
  const answerFor = answerLookup(ctx.answers);
  const filled: FilledField[] = [];
  const pending: PendingQuestion[] = [];
  const files: { label: string; path: string }[] = [];

  const classes = fields.map((f) => (f.kind === "file" || classifyField(f) !== "resume" ? classifyField(f) : "custom"));
  // A lone unlabeled file input is almost always the resume upload.
  if (!classes.includes("resume")) {
    const i = fields.findIndex((f, j) => f.kind === "file" && classes[j] === "custom");
    if (i >= 0) classes[i] = "resume";
  }

  for (const [i, field] of fields.entries()) {
    const cls = classes[i]!;

    if (isPhoneCountry(field)) {
      // Part of the phone field: chosen from the phone's dialing code, never asked as a question.
      const value = answerFor(field.label) || phoneCountryValue(ctx.profile);
      if (!value) {
        ctx.onEvent("field_skipped", "No dialing code in profile phone; phone country left as is", { label: field.label });
        continue;
      }
      try {
        const actual = await fillField(page, field, value);
        filled.push({ label: field.label, value: actual, kind: field.kind });
        ctx.onEvent("field_filled", `Filled "${field.label}"`, { label: field.label, kind: field.kind, classification: "phone", source: "profile", value: actual });
      } catch (err) {
        ctx.onEvent("field_warn", `Could not set phone country: ${err instanceof Error ? err.message : String(err)}`, { label: field.label }, "warn");
      }
      continue;
    }

    let value: string | undefined = answerFor(field.label);
    let source = "answers";
    if (value === undefined) {
      // The profile's work authorization is US-only; "authorised to work in the UK?" is not answered from it.
      const foreign = (cls === "work_auth" || cls === "sponsorship") && foreignWorkCountry(field.label);
      value = foreign ? undefined : profileValue(cls, ctx.profile, ctx.resumePdfPath);
      source = "profile";
    }
    if (value === undefined) {
      value = eeoValue(cls, ctx.profile, field.options);
      source = "eeo";
    }
    if (value === undefined || value === "") {
      if (field.required) {
        pending.push(pendingFromField(field));
        ctx.onEvent("field_pending", `No answer for required field "${field.label}"`, { label: field.label, kind: field.kind });
      } else {
        ctx.onEvent("field_skipped", `Skipped optional field "${field.label}"`, { label: field.label, kind: field.kind });
      }
      continue;
    }
    try {
      let actual = await fillField(page, field, value);
      if (cls === "location" && field.kind !== "select") actual = (await settleAutocomplete(page, field, ctx)) || actual;
      filled.push({ label: field.label, value: actual, kind: field.kind });
      if (field.kind === "file") files.push({ label: field.label, path: value });
      ctx.onEvent("field_filled", `Filled "${field.label}"`, {
        label: field.label, kind: field.kind, classification: cls, source,
        value: field.kind === "file" ? actual : actual.slice(0, 120),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.onEvent("field_error", `Could not fill "${field.label}": ${message}`, { label: field.label, kind: field.kind }, "warn");
      if (field.required) pending.push(pendingFromField(field));
    }
  }
  await verifyFilled(page, ctx, fields, filled, pending);
  return { filled, pending, files };
}

const TEXT_KINDS = new Set<FormField["kind"]>(["text", "email", "tel", "textarea"]);

/**
 * Re-read every text field once the whole form is filled. A page's own scripts can reject or clear a value after we set it
 * (an autocomplete that "found no location", a field that re-renders), and a receipt must show what the form really holds:
 * what is in the box now replaces what we typed, and a field that ended up empty is not reported as filled.
 */
async function verifyFilled(page: Page, ctx: DriverContext, fields: FormField[], filled: FilledField[], pending: PendingQuestion[]): Promise<void> {
  await page.waitForTimeout(250);
  for (const entry of [...filled]) {
    const field = fields.find((f) => f.label === entry.label && TEXT_KINDS.has(f.kind));
    if (!field) continue;
    const now = await page.locator(field.selector).first().inputValue().catch(() => null);
    if (now === null || now === entry.value) continue;
    if (now.trim() === "") {
      filled.splice(filled.indexOf(entry), 1);
      ctx.onEvent("field_warn", `"${field.label}" is empty after filling: the form did not keep the value`, { label: field.label, wanted: entry.value }, "warn");
      if (field.required) pending.push(pendingFromField(field));
    } else {
      ctx.onEvent("field_warn", `"${field.label}" holds "${now.slice(0, 60)}" rather than what was typed`, { label: field.label, wanted: entry.value, actual: now }, "warn");
      entry.value = now;
    }
  }
}

/** Locate the submit control (button text first, then type=submit in the form). Never clicks it. */
export async function findSubmitButton(page: Page) {
  const label = await runScript<string | null>(page, FIND_SUBMIT_SCRIPT);
  return label ? { label, locator: page.locator("[data-norinote-submit]").first() } : null;
}

/** Returns a reason string when a CAPTCHA challenge is visible, else null. Never tries to solve one. */
export async function detectCaptcha(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    const url = frame.url();
    if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(url) && !/size=invisible/i.test(url) && frame !== page.mainFrame()) {
      const el = await frame.frameElement().catch(() => null);
      const box = el ? await el.boundingBox().catch(() => null) : null;
      if (box && box.width >= 20 && box.height >= 20) return `frame:${url.slice(0, 120)}`;
    }
  }
  return runScript<string | null>(page, CAPTCHA_SCRIPT);
}
