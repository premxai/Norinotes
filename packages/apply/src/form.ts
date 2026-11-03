/**
 * Generic, label-based form handling shared by every driver: field discovery, classification (a fallback when no plan
 * entry exists), profile values, submit-button lookup and CAPTCHA detection. Filling lives in fill.ts. Every answer a form
 * needs is prepared before the click (prepare.ts), so an unknown required question becomes `pending`, never a guess.
 */
import type { Locator, Page } from "playwright";
import type { ApplicantProfile, FormField, PendingQuestion } from "./types.js";
import { runScript, DISCOVER_SCRIPT, FIND_SUBMIT_SCRIPT, CAPTCHA_SCRIPT } from "./dom.js";

export type FieldClass =
  | "first_name" | "last_name" | "full_name" | "email" | "phone" | "linkedin" | "website" | "github" | "social"
  | "location" | "country" | "resume" | "cover_letter" | "work_auth" | "sponsorship"
  | "gender" | "race" | "hispanic" | "veteran" | "disability" | "custom";

/** Discovery output: a FormField plus hints the filler uses (extra props survive as plain JSON). */
export type DiscoveredField = FormField & {
  combobox?: boolean;
  group?: "phone_country";
  /** Stable key: name, non-generated id, or the field entry's path (Ashby). */
  key?: string | null;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  /** How the filler should set it (see WidgetStrategy in recipes.ts). */
  widget?: "text" | "native-select" | "combobox" | "radio-label" | "checkbox-label" | "checkbox" | "yesno" | "file" | "location" | "phone-country";
  multiple?: boolean;
};

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
export async function discoverFields(page: Page, preferred: string[] = PREFERRED_FORM_SELECTORS, opts: { comboOptions?: boolean } = {}): Promise<DiscoveredField[]> {
  const fields = await runScript<DiscoveredField[]>(page, DISCOVER_SCRIPT, preferred);
  for (const f of fields) f.label = cleanLabel(f.label, f.options);
  for (const f of fields) {
    if (!f.combobox || !opts.comboOptions || f.widget === "location" || f.widget === "phone-country") continue;
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
  if (!keys) return undefined;
  const eeo = profile.eeo ?? {};
  const key = keys.find((k) => eeo[k] !== undefined && eeo[k] !== "");
  const raw = key ? eeo[key] : undefined;
  // No choice in the profile: the form's own decline option, never a guess.
  if (!raw) return options?.find((o) => DECLINE_RE.test(o));
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

/** [role=option] items of the listbox this combobox controls (falls back to any visible listbox). */
async function comboOptionLocator(page: Page, input: Locator): Promise<Locator> {
  const id = (await input.getAttribute("aria-controls").catch(() => null)) || (await input.getAttribute("aria-owns").catch(() => null));
  if (id) {
    const box = page.locator(`[id=${JSON.stringify(id)}]`);
    if (await box.count()) return box.locator('[role="option"]');
  }
  return page.locator('[role="listbox"]:visible [role="option"]');
}

/** Open a react-select style combobox, read its option texts, close it. Used when reading a form at prepare time. */
export async function comboboxOptionTexts(page: Page, selector: string): Promise<string[]> {
  const input = page.locator(selector).first();
  try {
    await input.click({ timeout: 3000 }).catch(() => input.focus());
    let opts = await comboOptionLocator(page, input);
    await opts.first().waitFor({ state: "visible", timeout: 1500 }).catch(async () => {
      await input.press("ArrowDown").catch(() => {});
      opts = await comboOptionLocator(page, input);
      await opts.first().waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
    });
    const texts = (await opts.allInnerTexts()).map(clean).filter(Boolean);
    return [...new Set(texts)];
  } finally {
    await input.press("Escape").catch(() => {});
  }
}

/** The shared PendingQuestion for a field the form needs and nobody could answer. Id: field:<key> when the field has one. */
export function pendingFromField(field: FormField & { key?: string | null }): PendingQuestion {
  const type: PendingQuestion["type"] =
    field.kind === "textarea" ? "textarea"
    : field.kind === "select" || field.kind === "radio" ? "select"
    : field.kind === "checkbox" ? ((field.options?.length ?? 0) > 1 ? "multiselect" : "boolean")
    : field.kind === "file" ? "file"
    : "text";
  return { id: field.key ? `field:${field.key}` : questionId(field.label), text: field.label, type, options: field.options ?? [], required: field.required };
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
    if (frame === page.mainFrame() || !/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(url)) continue;
    if (/size=invisible/i.test(url)) continue;
    const el = await frame.frameElement().catch(() => null);
    if (!el || !(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    // A checkbox widget is about 300x75; a challenge (bframe, hCaptcha challenge) is larger. The score badge is 256x60 and invisible-sized.
    const challenge = /bframe|frame=challenge|hcaptcha.*challenge|turnstile|challenges\.cloudflare/i.test(url);
    if (box && box.width >= (challenge ? 100 : 200) && box.height >= (challenge ? 100 : 60)) return `frame:${url.slice(0, 120)}`;
  }
  return runScript<string | null>(page, CAPTCHA_SCRIPT);
}
