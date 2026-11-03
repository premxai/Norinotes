/**
 * Collects the apply-eval fixtures: real public application pages from Greenhouse, Lever and Ashby, rendered once in a
 * normal Chromium (images, fonts and media blocked), stripped of scripts, iframes, tracking, keys and the job description,
 * and saved with their stylesheets so field visibility replays faithfully. For Greenhouse the public form schema
 * (boards-api ...?questions=true, no key needed) is saved next to the page.
 *
 *   npx tsx scripts/eval/apply-fixtures.mts [--per 9] [--only greenhouse,lever,ashby]
 *
 * Plain GETs with the project's polite fetch for the feeds; robots.txt is respected (never boards.greenhouse.io/embed/,
 * never jobs.ashbyhq.com/api/ directly). Nothing is filled or submitted. Output: packages/apply/src/fixtures/forms/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { getJson, USER_AGENT } from "@norinote/ingest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "packages", "apply", "src", "fixtures", "forms");
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PER = Number(opt("per", "9"));
const ONLY = new Set((opt("only", "greenhouse,lever,ashby") ?? "").split(","));

type Target = { ats: "greenhouse" | "lever" | "ashby"; company: string; jobId: string; url: string; title: string };

const GH_BOARDS = ["discord", "gitlab", "figma", "robinhood", "cloudflare", "anthropic", "reddit", "airtable", "twilio", "stripe"];
const LEVER_BOARDS = ["leverdemo", "palantir", "spotify", "shieldai", "zoox", "leverdemo", "palantir", "shieldai", "zoox", "leverdemo", "spotify"];
const ASHBY_BOARDS = ["ramp", "notion", "linear", "openai", "vanta", "replit", "posthog", "cohere", "ramp"];

async function safeJson<T>(url: string): Promise<T | null> {
  try { return await getJson<T>(url, { timeoutMs: 30_000 }); } catch (err) { console.log(`feed failed: ${url}: ${err instanceof Error ? err.message : String(err)}`); return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function greenhouseTargets(): Promise<Target[]> {
  const out: Target[] = [];
  for (const token of GH_BOARDS) {
    if (out.length >= PER) break;
    const list = await safeJson<{ jobs: { id: number; title: string; absolute_url: string }[] }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
    // Only postings hosted on Greenhouse (company career sites embed the form through /embed/, which robots.txt disallows).
    const job = list?.jobs.find((j) => /(^|\.)greenhouse\.io\//.test(j.absolute_url.replace(/^https?:\/\//, "")));
    if (!job) continue;
    out.push({ ats: "greenhouse", company: token, jobId: String(job.id), url: `https://job-boards.greenhouse.io/${token}/jobs/${job.id}`, title: job.title });
  }
  return out;
}

async function leverTargets(): Promise<Target[]> {
  const out: Target[] = [];
  const used = new Map<string, number>();
  for (const co of LEVER_BOARDS) {
    if (out.length >= PER) break;
    const list = await safeJson<{ id: string; text: string; hostedUrl: string }[]>(`https://api.lever.co/v0/postings/${co}?mode=json&limit=12`);
    await sleep(1100); // api.lever.co asks for Crawl-delay: 1
    const n = used.get(co) ?? 0;
    // A different posting each time a board repeats; leverdemo postings carry different custom cards.
    const job = list?.[n * 3];
    if (!job) continue;
    used.set(co, n + 1);
    out.push({ ats: "lever", company: co, jobId: job.id, url: `${job.hostedUrl}/apply`, title: job.text });
  }
  return out;
}

async function ashbyTargets(): Promise<Target[]> {
  const out: Target[] = [];
  const used = new Map<string, number>();
  for (const co of ASHBY_BOARDS) {
    if (out.length >= PER) break;
    const list = await safeJson<{ jobs: { id: string; title: string; jobUrl: string; applyUrl: string }[] }>(`https://api.ashbyhq.com/posting-api/job-board/${co}`);
    const n = used.get(co) ?? 0;
    const job = list?.jobs[n * 5];
    if (!job) continue;
    used.set(co, n + 1);
    out.push({ ats: "ashby", company: co, jobId: job.id, url: `${job.jobUrl}/application`, title: job.title.trim() });
  }
  return out;
}

/** In-page sanitiser: keeps the form and its ancestors (so CSS still applies), drops everything else. Arg: form selectors. */
const SANITIZE = String.raw`(function (sels) {
  var form = null;
  for (var i = 0; i < sels.length && !form; i++) { try { form = document.querySelector(sels[i]); } catch (e) {} }
  if (!form) return false;
  // Cookie banners and modals are not part of the form.
  document.querySelectorAll('[class*=cookie i], [id*=cookie i], [class*=consent-banner i], #onetrust-consent-sdk').forEach(function (n) { if (!n.contains(form)) n.remove(); });
  var node = form;
  while (node && node.parentElement && node !== document.body) {
    var parent = node.parentElement;
    Array.prototype.slice.call(parent.children).forEach(function (sib) {
      if (sib === node) return;
      if (/^(STYLE|LINK)$/.test(sib.tagName)) return;
      if (/^H[1-3]$/.test(sib.tagName) || sib.querySelector && sib.querySelector('h1') && sib.textContent.length < 400) return;
      sib.remove();
    });
    node = parent;
  }
  document.querySelectorAll('script, noscript, iframe, object, embed, template, link[rel=preload], link[rel=prefetch], link[rel=modulepreload], link[rel=icon], link[rel*=apple], meta[property], meta[name]:not([name=viewport]), img, picture, video, audio, source').forEach(function (n) { n.remove(); });
  document.querySelectorAll('svg').forEach(function (n) { while (n.firstChild) n.removeChild(n.firstChild); });
  document.querySelectorAll('textarea[name=g-recaptcha-response], textarea[name=h-captcha-response], input[name=h-captcha-response], #hcaptchaSubmitBtn, .grecaptcha-badge, [data-sitekey], [data-hcaptcha-widget-id]').forEach(function (n) { n.remove(); });
  document.querySelectorAll('input[type=hidden]').forEach(function (n) { n.setAttribute('value', ''); n.removeAttribute('data-value'); });
  document.querySelectorAll('*').forEach(function (n) {
    Array.prototype.slice.call(n.attributes).forEach(function (a) {
      if (/^(on|nonce$|integrity$|data-sitekey$|data-gtm|data-analytics|data-ga)/i.test(a.name)) n.removeAttribute(a.name);
    });
  });
  document.querySelectorAll('style').forEach(function (st) { st.textContent = st.textContent.replace(/@font-face\s*{[^}]*}/g, '').replace(/url\(\s*['"]?data:[^)]*\)/g, 'none'); });
  // Rich text the form shows (consent paragraphs) stays; long job copy outside the form is already gone.
  return true;
})`;

const FORM_SELECTORS: Record<Target["ats"], string[]> = {
  greenhouse: ["form#application-form", "#application_form", "form.application--form"],
  lever: ["form#application-form", "form.application-form", "#application-form"],
  ashby: [".ashby-application-form-container", "form"],
};

const ANALYTICS = /google-analytics|googletagmanager|doubleclick|segment\.(io|com)|hotjar|fullstory|mixpanel|amplitude|datadoghq|intercom|facebook\.net|linkedin\.com\/(px|li)|recruitics|clarity\.ms|sentry\.io/i;

async function main() {
  mkdirSync(path.join(outDir, "css"), { recursive: true });
  const targets: Target[] = [
    ...(ONLY.has("greenhouse") ? await greenhouseTargets() : []),
    ...(ONLY.has("lever") ? await leverTargets() : []),
    ...(ONLY.has("ashby") ? await ashbyTargets() : []),
  ];
  console.log(`collecting ${targets.length} forms`);
  const browser = await chromium.launch();
  const css: Record<string, Map<string, string>> = { greenhouse: new Map(), lever: new Map(), ashby: new Map() };
  // Very large inline <style> blocks (Lever inlines its whole stylesheet) move to one shared file per system.
  const inline: Record<string, Map<string, string>> = { greenhouse: new Map(), lever: new Map(), ashby: new Map() };
  const manifest: Array<Target & { id: string; fetchedAt: string; fields: number }> = [];

  for (const t of targets) {
    const id = `${t.ats}-${t.company}-${t.jobId.slice(0, 8)}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const base = await context.newPage();
    const real = await base.evaluate("navigator.userAgent") as string;
    await base.close();
    await context.setExtraHTTPHeaders({});
    await context.route("**/*", (route) => {
      const r = route.request();
      if (["image", "font", "media"].includes(r.resourceType()) || ANALYTICS.test(r.url())) return route.abort();
      return route.continue({ headers: { ...r.headers(), "user-agent": `${real} ${USER_AGENT}` } });
    });
    const page: Page = await context.newPage();
    const sheets: [string, Promise<string>][] = [];
    page.on("response", (res) => {
      if (res.request().resourceType() === "stylesheet") sheets.push([res.url(), res.text().catch(() => "")]);
    });
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator("input:not([type=hidden]), textarea").first().waitFor({ timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      let schema: unknown = null;
      if (t.ats === "greenhouse") {
        schema = await getJson(`https://boards-api.greenhouse.io/v1/boards/${t.company}/jobs/${t.jobId}?questions=true`);
        if (schema && typeof schema === "object") {
          // The posting text is the employer's copy; the eval only needs the form.
          for (const k of ["content", "metadata", "ai_disclaimer"]) delete (schema as Record<string, unknown>)[k];
        }
      }
      const fields = await page.locator("input:not([type=hidden]), textarea, select").count();
      const ok = await page.evaluate(`${SANITIZE}(${JSON.stringify(FORM_SELECTORS[t.ats])})`);
      if (!ok) throw new Error("form not found");
      for (const [url, text] of sheets) css[t.ats]!.set(url, await text);
      let html = await page.content();
      html = html.replace(/<link[^>]+rel="?stylesheet"?[^>]*>/gi, "")
        .replace(/<head[^>]*>/i, (m) => `${m}<link rel="stylesheet" href="css/${t.ats}.css">`);
      let moved = false;
      html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (m, _a: string, body: string) => {
        if (body.length < 50_000) return m;
        inline[t.ats]!.set(body.slice(0, 200) + body.length, body);
        moved = true;
        return "";
      });
      if (moved) html = html.replace(`href="css/${t.ats}.css">`, `href="css/${t.ats}.css"><link rel="stylesheet" href="css/${t.ats}-inline.css">`);
      writeFileSync(path.join(outDir, `${id}.html`), html);
      if (schema) writeFileSync(path.join(outDir, `${id}.gh.json`), JSON.stringify(schema, null, 1));
      manifest.push({ ...t, id, fetchedAt: new Date().toISOString(), fields });
      console.log(`ok ${id} (${fields} controls, ${Math.round(html.length / 1024)} KB)`);
    } catch (err) {
      console.log(`skip ${id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    } finally {
      await context.close();
    }
    await sleep(1500);
  }
  await browser.close();
  for (const [ats, sheetsByUrl] of Object.entries(css)) {
    if (!sheetsByUrl.size) continue;
    // Font faces would only 404 locally.
    const text = [...sheetsByUrl.values()].join("\n").replace(/@font-face\s*{[^}]*}/g, "").replace(/url\((?!["']?data:)[^)]*\)/g, "none");
    writeFileSync(path.join(outDir, "css", `${ats}.css`), text);
    const extra = inline[ats];
    if (extra?.size) writeFileSync(path.join(outDir, "css", `${ats}-inline.css`), [...extra.values()].join("\n").replace(/@font-face\s*{[^}]*}/g, ""));
  }
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`saved ${manifest.length} fixtures`);
}

main().catch((err) => { console.error(err); process.exit(1); });
