/**
 * Company career sites. About two in five Greenhouse postings send people to the company's own careers page instead of
 * Greenhouse's hosted form. From the posting URL this follows redirects and the page's Apply link or button (a few hops,
 * robots.txt checked for every page it opens) and says what is actually there: a form on a job system Norinote has a
 * driver for, a Greenhouse form the company page embeds, another job system, a form of the company's own, a bot check,
 * or nothing. It never opens a boards.greenhouse.io/embed/ address itself, never solves or gets around a bot check, and
 * never types anything.
 */
import type { Frame, Page, Response } from "playwright";
import { USER_AGENT, NO_ROBOTS, parseRobots, robotsAllows, type Robots } from "@norinote/ingest";
import { runScript } from "./dom.js";
import { BLOCKED_RE, BOT_CHECK_RE } from "./flow.js";
import { discoverFields } from "./form.js";
import { parseHttpUrl } from "./drivers/util.js";
import type { DriverName, OnEvent } from "./types.js";

export type CareerSiteKind =
  /** The page is a posting on a job system Norinote has a driver (or a parking stub) for: Greenhouse, Lever, Ashby, Workday… */
  | "known_ats"
  /** A Greenhouse application form inside an iframe on the company's own page. */
  | "greenhouse_iframe"
  /** Another job system on its own host that Norinote has no driver for (Oracle, SuccessFactors, Taleo, Jobvite…). */
  | "other_ats"
  /** A form of the company's own (fields on the company page, no known job system behind it). */
  | "custom_form"
  /** A visible captcha or a bot-check interstitial (Cloudflare Turnstile "Just a moment…"). */
  | "captcha"
  /** The site turned the browser away: Access Denied, 403, "unusual activity". */
  | "blocked"
  /** The posting is gone: 404, "no longer available", an error page. */
  | "dead"
  /** robots.txt asks not to open the page. */
  | "robots"
  /** A careers page with no form and no Apply step that leads to one. */
  | "no_form";

export type CareerSite = {
  kind: CareerSiteKind;
  /** The page the walk ended on. */
  url: string;
  /** Pages opened or Apply steps taken after the first page. */
  hops: number;
  /** The driver for a known_ats page. */
  driver?: DriverName;
  /** The job system's name for other_ats, or the bot-check vendor for captcha/blocked. */
  system?: string;
  /** Fields seen (a custom form, or inside a Greenhouse iframe). Read only. */
  fields?: number;
  /** HTTP status of the last page, when known. */
  status?: number;
};

export type FollowOptions = {
  /** Which driver handles a URL (detectDriver). Passed in so this module does not depend on the drivers. */
  detect: (url: string) => DriverName | null;
  onEvent?: OnEvent;
  /** robots.txt check for a page; defaults to fetching the origin's robots.txt (cached per origin for this walk). */
  robotsAllow?: (url: string) => Promise<boolean>;
  /** Most Apply steps to follow. Defaults to 3. */
  maxHops?: number;
  /** Time a page gets to render scripts, iframes and bot checks after load. Defaults to 2500 ms. */
  settleMs?: number;
};

const NAV_TIMEOUT = 30_000;

/** Job systems Norinote has no driver for, by host. */
const OTHER_ATS: [RegExp, string][] = [
  [/(^|\.)oraclecloud\.com$/i, "Oracle"], [/(^|\.)successfactors\.(com|eu)$/i, "SuccessFactors"], [/(^|\.)taleo\.net$/i, "Taleo"],
  [/(^|\.)jobvite\.com$/i, "Jobvite"], [/(^|\.)rippling(-ats)?\.com$/i, "Rippling"], [/(^|\.)bamboohr\.com$/i, "BambooHR"],
  [/(^|\.)recruitee\.com$/i, "Recruitee"], [/(^|\.)teamtailor\.com$/i, "Teamtailor"], [/(^|\.)personio\.(de|com)$/i, "Personio"],
  [/(^|\.)breezy\.hr$/i, "Breezy"], [/(^|\.)pinpointhq\.com$/i, "Pinpoint"], [/(^|\.)eightfold\.ai$/i, "Eightfold"],
  [/(^|\.)avature\.net$/i, "Avature"], [/(^|\.)jazzhr\.com$|(^|\.)applytojob\.com$/i, "JazzHR"], [/(^|\.)dover\.com$/i, "Dover"],
  [/(^|\.)paylocity\.com$/i, "Paylocity"], [/(^|\.)ultipro\.com$|(^|\.)ukg\.net$/i, "UKG"], [/(^|\.)adp\.com$/i, "ADP"],
];

const DEAD_RE = /page (you('re| are) looking for )?(was )?not (be )?found|(job|position|posting|role|opening)( you('re| are) looking for)? (is |has been )?(no longer|not) (available|open|active|accepting)|no longer accepting applications|(position|job|role) has been filled|this job (has )?(expired|closed)|application error|404/i;
const BOT_VENDOR: [RegExp, string][] = [[/cloudflare|cf-ray|turnstile/i, "Cloudflare"], [/akamai|reference #\d/i, "Akamai"], [/perimeterx|px-captcha|press (&|and) hold/i, "PerimeterX"], [/datadome/i, "DataDome"], [/incapsula|imperva/i, "Imperva"]];

const GH_EMBED_SRC = /(^|\.)greenhouse\.io$/i;

/** robots.txt of each origin, fetched once per walk. A missing or unreadable file allows everything. */
function defaultRobots(): (url: string) => Promise<boolean> {
  const cache = new Map<string, Promise<Robots>>();
  return async (url) => {
    const u = new URL(url);
    let robots = cache.get(u.origin);
    if (!robots) {
      robots = fetch(u.origin + "/robots.txt", { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) })
        .then(async (r) => (r.ok ? parseRobots((await r.text()).slice(0, 512 * 1024), USER_AGENT.split("/")[0]!.toLowerCase()) : NO_ROBOTS))
        .catch(() => NO_ROBOTS);
      cache.set(u.origin, robots);
    }
    return robotsAllows(await robots, u.pathname + u.search);
  };
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate("document.body ? document.body.innerText.slice(0, 20000) : ''").then(String).catch(() => "");
}

/** The Greenhouse application iframe the company page embeds (by id or by its src), if any. */
export async function greenhouseIframe(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const u = parseHttpUrl(frame.url());
    if (u && GH_EMBED_SRC.test(u.hostname) && /\/embed\/job_app/i.test(u.pathname)) return frame;
    const el = await frame.frameElement().catch(() => null);
    if (el && (await el.getAttribute("id").catch(() => null)) === "grnhse_iframe") return frame;
  }
  return null;
}

/** The first visible Apply link or button: its href when it is a link to another page, else a click target. */
const APPLY_SCRIPT = String.raw`function () {
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function visible(el) { if (!el.getClientRects().length) return false; var s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; }
  var re = /^(apply( now| today| here| online)?|apply (for|to) (this|the) (job|position|role|opening)|submit (an |your )?application|start (your )?application|i'm interested)\b/i;
  var els = Array.prototype.slice.call(document.querySelectorAll('a, button, [role=button], input[type=button], input[type=submit]'));
  var best = null;
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!visible(el) || el.closest('nav, header, footer')) continue;
    var text = clean(el.innerText || el.value || el.getAttribute('aria-label'));
    if (!re.test(text) || text.length > 60) continue;
    var href = el.tagName === 'A' ? el.href : '';
    if (href && /^(mailto|tel|javascript):/i.test(href)) continue;
    el.setAttribute('data-norinote-apply', '1');
    var same = !href || href.split('#')[0] === location.href.split('#')[0];
    best = { text: text, href: same ? null : href };
    break;
  }
  return best;
}`;

/** What the current page is, without leaving it. */
export async function classifyPage(page: Page, response: Response | null, opts: Pick<FollowOptions, "detect">): Promise<Omit<CareerSite, "hops">> {
  const url = page.url();
  const status = response?.status();
  const host = parseHttpUrl(url)?.hostname ?? "";
  const text = await bodyText(page);
  const title = await page.title().catch(() => "");
  const html = await page.content().catch(() => "");
  const vendor = (BOT_VENDOR.find(([re]) => re.test(html.slice(0, 50_000)) || re.test(text))?.[1]);
  const base = { url, ...(status !== undefined ? { status } : {}) };

  const challengeFrame = page.frames().some((f) => /challenges\.cloudflare\.com|turnstile|hcaptcha\.com\/captcha|recaptcha\/(api2|enterprise)\/anchor/i.test(f.url()) && !/size=invisible/i.test(f.url()));
  if (BOT_CHECK_RE.test(title) || (text.length < 1500 && BOT_CHECK_RE.test(text)) || (challengeFrame && text.length < 600)) return { ...base, kind: "captcha", ...(vendor ? { system: vendor } : {}) };
  if (status === 401 || status === 403 || status === 429 || BLOCKED_RE.test(title) || (text.length < 2000 && BLOCKED_RE.test(text))) return { ...base, kind: "blocked", ...(vendor ? { system: vendor } : {}) };
  if (status === 404 || status === 410 || (status !== undefined && status >= 500)) return { ...base, kind: "dead" };

  // A company page with ?gh_jid= is routed to the Greenhouse driver by URL, but it is not Greenhouse's own page.
  const driver = opts.detect(url);
  if (driver && (driver !== "greenhouse" || GH_EMBED_SRC.test(host))) return { ...base, kind: "known_ats", driver };
  const other = OTHER_ATS.find(([re]) => re.test(host));
  if (other) return { ...base, kind: "other_ats", system: other[1] };

  const gh = await greenhouseIframe(page);
  if (gh) {
    const fields = await discoverFields(gh as unknown as Page).then((f) => f.length).catch(() => 0);
    return { ...base, kind: "greenhouse_iframe", fields };
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const d = opts.detect(frame.url());
    if (d && d !== "greenhouse") return { ...base, url: frame.url(), kind: "known_ats", driver: d };
    const o = OTHER_ATS.find(([re]) => re.test(parseHttpUrl(frame.url())?.hostname ?? ""));
    if (o) return { ...base, kind: "other_ats", system: o[1] };
  }

  const fields = await discoverFields(page).catch(() => []);
  const real = fields.filter((f) => f.kind !== "checkbox" && f.kind !== "unknown");
  if (real.length >= 3 && fields.some((f) => f.kind === "email" || f.kind === "file" || /e-?mail/i.test(f.label))) return { ...base, kind: "custom_form", fields: fields.length };
  if (DEAD_RE.test(title) || (DEAD_RE.test(text) && text.length < 3000)) return { ...base, kind: "dead" };
  return { ...base, kind: "no_form" };
}

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Open the posting and walk to its application form. Stops at the first page that is a known job system, an embedded
 * Greenhouse form, another job system, a form of the company's own, a bot check, a dead page, or a page robots.txt
 * keeps out; otherwise follows the Apply link (opening its address) or clicks the Apply button, up to maxHops times.
 */
export async function followToForm(page: Page, startUrl: string, opts: FollowOptions): Promise<CareerSite> {
  const robotsAllow = opts.robotsAllow ?? defaultRobots();
  const maxHops = opts.maxHops ?? 3;
  const settleMs = opts.settleMs ?? 2500;
  const open = async (url: string): Promise<Response | null | "robots"> => {
    if (isGreenhouseEmbed(url)) throw new Error("Refusing to open a Greenhouse /embed/ address");
    if (!(await robotsAllow(url))) return "robots";
    opts.onEvent?.("navigate", `Opening ${url}`, { url });
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    // A redirect to another page (Greenhouse's hosted page to the company's careers site) is checked the same way.
    if (page.url() !== url && !(await robotsAllow(page.url()))) return "robots";
    await settle(page, settleMs);
    return res;
  };

  let res = await open(startUrl);
  if (res === "robots") return { kind: "robots", url: startUrl, hops: 0 };
  for (let hops = 0; ; hops++) {
    const seen = await classifyPage(page, res, opts);
    if (seen.kind !== "no_form" || hops >= maxHops) return { ...seen, hops };
    const apply = await runScript<{ text: string; href: string | null } | null>(page, APPLY_SCRIPT).catch(() => null);
    if (!apply) return { ...seen, hops };
    opts.onEvent?.("follow_apply", `Following "${apply.text}"`, { href: apply.href });
    if (apply.href) {
      if (isGreenhouseEmbed(apply.href)) return { ...seen, kind: "greenhouse_iframe", hops };
      const next = await open(apply.href);
      if (next === "robots") return { kind: "robots", url: apply.href, hops: hops + 1 };
      res = next;
      continue;
    }
    const before = page.url();
    const popup = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.locator("[data-norinote-apply]").first().click({ timeout: 5000 }).catch(() => {});
    const opened = await popup;
    if (opened) {
      // An Apply button that opens a new tab: read its address and open it here, through the robots check.
      await opened.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
      const to = opened.url();
      await opened.close().catch(() => {});
      if (!parseHttpUrl(to)) return { ...seen, hops: hops + 1 };
      const next = await open(to);
      if (next === "robots") return { kind: "robots", url: to, hops: hops + 1 };
      res = next;
      continue;
    }
    await settle(page, settleMs);
    if (page.url() !== before && !(await robotsAllow(page.url()))) return { kind: "robots", url: page.url(), hops: hops + 1 };
    res = null;
  }
}

/** A boards.greenhouse.io/embed/ (or job-boards) address: robots.txt keeps these out, so Norinote never opens one itself. */
export function isGreenhouseEmbed(url: string): boolean {
  const u = parseHttpUrl(url);
  return !!u && GH_EMBED_SRC.test(u.hostname) && /^\/embed\//i.test(u.pathname);
}
