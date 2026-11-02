import type { Browser } from "playwright";
import { withPage } from "./browser.js";
import { readFontFile } from "./fonts.js";
import { DEFAULT_FONT, DEFAULT_SIZE, DEFAULT_TEMPLATE, PAGE_SIZES, renderResumeHtml } from "./template.js";
import type { Density, FontId, PageSize, ResumeBullet, ResumeContent, ResumeTemplate } from "./types.js";

/** Count pages in a PDF by its page objects ("/Type /Page", not "/Pages"). */
export function countPdfPages(pdf: Buffer | Uint8Array): number {
  const s = Buffer.from(pdf).toString("latin1");
  const n = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (n > 0) return n;
  const count = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(s);
  return count ? Number(count[1]) : 0;
}

/** Turns resume HTML into PDF bytes. Replaceable so the fitting loop can be tested without a browser. */
export type PdfRenderer = (html: string, opts: { size: PageSize; browser?: Browser }) => Promise<Buffer>;

const FONT_HOST = "https://fonts.norinote.invalid";

/** Chromium through Playwright. Fonts are served from node_modules by intercepting requests to a fake host. */
export const playwrightRenderer: PdfRenderer = (html, { size, browser }) => withPage(async (page) => {
  await page.route(`${FONT_HOST}/**`, (route) => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const body = readFontFile(file);
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*", "cache-control": "max-age=3600" }, body });
  });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  return Buffer.from(await page.pdf({ format: PAGE_SIZES[size].css as "Letter" | "A4", printBackground: true, preferCSSPageSize: true }));
}, browser);

// ---------------------------------------------------------------------------------------------------------------------
// One-page fitting
// ---------------------------------------------------------------------------------------------------------------------

export type Measured = { pages: number; pdf: Buffer };
/** Renders `content` at a density and says how many pages it came to. */
export type Measure = (content: ResumeContent, density: Density) => Promise<Measured>;

export type FitResult = {
  content: ResumeContent;
  density: Density;
  pages: number;
  pdf: Buffer;
  /** Bullets removed, lowest weight first. */
  dropped: ResumeBullet[];
  /** How many renders the search took. */
  renders: number;
};

/**
 * Bullets that may be cut, cheapest first: lowest weight, and among equals the ones further down the page. The best
 * bullet of each role always stays, so no role is left without a single line; projects can go entirely.
 */
export function dropOrder(content: ResumeContent): ResumeBullet[] {
  type Cand = { b: ResumeBullet; pos: number };
  const cands: Cand[] = [];
  let pos = 0;
  for (const r of content.experience) {
    let keepIdx = 0;
    r.bullets.forEach((b, i) => { if (b.weight > (r.bullets[keepIdx]?.weight ?? -Infinity)) keepIdx = i; });
    r.bullets.forEach((b, i) => { pos++; if (i !== keepIdx) cands.push({ b, pos }); });
  }
  for (const p of content.projects) for (const b of p.bullets) { pos++; cands.push({ b, pos }); }
  return cands.sort((a, b) => a.b.weight - b.b.weight || b.pos - a.pos).map((c) => c.b);
}

/** Content without the given bullets; a project left with no bullets is removed. */
export function withoutBullets(content: ResumeContent, ids: ReadonlySet<string>): ResumeContent {
  return {
    ...content,
    experience: content.experience.map((r) => ({ ...r, bullets: r.bullets.filter((b) => !ids.has(b.id)) })),
    projects: content.projects.map((p) => ({ ...p, bullets: p.bullets.filter((b) => !ids.has(b.id)) })).filter((p) => p.bullets.length > 0),
  };
}

/**
 * Bring a resume within `maxPages`. First tighter type (normal, then compact); then cut the lowest-weight bullets,
 * found by binary search over how many to cut, so the render count stays logarithmic; and only if even that is not
 * enough, tight type with every cuttable bullet gone. Returns the best attempt, with its real page count.
 */
export async function fitToPages(content: ResumeContent, measure: Measure, opts: { maxPages?: number } = {}): Promise<FitResult> {
  const maxPages = opts.maxPages ?? 1;
  let renders = 0;
  const cache = new Map<string, Measured>();
  const run = async (c: ResumeContent, density: Density, key: string): Promise<Measured> => {
    const hit = cache.get(key);
    if (hit) return hit;
    renders++;
    const m = await measure(c, density);
    cache.set(key, m);
    return m;
  };
  const fits = (m: Measured) => m.pages <= maxPages;
  const done = (c: ResumeContent, density: Density, m: Measured, dropped: ResumeBullet[]): FitResult => ({ content: c, density, pages: m.pages, pdf: m.pdf, dropped, renders });

  const normal = await run(content, "normal", "normal:0");
  if (fits(normal)) return done(content, "normal", normal, []);
  const compact = await run(content, "compact", "compact:0");
  if (fits(compact)) return done(content, "compact", compact, []);

  const order = dropOrder(content);
  const cut = (k: number) => order.slice(0, k);
  const contentWithout = (k: number) => withoutBullets(content, new Set(cut(k).map((b) => b.id)));

  // Binary search the fewest bullets to cut at `density`, or null when cutting everything cuttable is not enough.
  const search = async (density: Density): Promise<FitResult | null> => {
    if (order.length === 0) return null;
    const all = await run(contentWithout(order.length), density, `${density}:${order.length}`);
    if (!fits(all)) return null;
    let lo = 1, hi = order.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(await run(contentWithout(mid), density, `${density}:${mid}`))) hi = mid; else lo = mid + 1;
    }
    const m = await run(contentWithout(lo), density, `${density}:${lo}`);
    return done(contentWithout(lo), density, m, cut(lo));
  };

  const atCompact = await search("compact");
  if (atCompact) return atCompact;
  const atTight = await search("tight");
  if (atTight) return atTight;

  // Nothing fits: report the tightest attempt honestly (pages > maxPages) so the caller can flag it.
  const last = await run(contentWithout(order.length), "tight", `tight:${order.length}`);
  return done(contentWithout(order.length), "tight", last, cut(order.length));
}

// ---------------------------------------------------------------------------------------------------------------------
// Public render
// ---------------------------------------------------------------------------------------------------------------------

export type RenderOptions = {
  template?: ResumeTemplate;
  font?: FontId;
  size?: PageSize;
  /** A Playwright browser to use. Default: a shared one launched on first use. */
  browser?: Browser;
  /** Replace the PDF renderer (tests). */
  renderer?: PdfRenderer;
  /** Pages allowed. Default 1. */
  maxPages?: number;
  /** Cut low-weight bullets to reach the page limit. Default true. */
  trim?: boolean;
};

export type RenderedResume = {
  pdf: Buffer;
  /** The resume document as rendered (fonts are not embedded here; use it for text checks and previews). */
  html: string;
  pages: number;
  /** Content after trimming. */
  content: ResumeContent;
  density: Density;
  dropped: ResumeBullet[];
  renders: number;
};

/** Render a resume to a PDF, refitting until it reaches the page limit or runs out of things to cut. */
export async function renderResumePdf(content: ResumeContent, opts: RenderOptions = {}): Promise<RenderedResume> {
  const template = opts.template ?? DEFAULT_TEMPLATE;
  const font = opts.font ?? DEFAULT_FONT;
  const size = opts.size ?? DEFAULT_SIZE;
  const renderer = opts.renderer ?? playwrightRenderer;
  const measure: Measure = async (c, density) => {
    const html = renderResumeHtml(c, { template, font, size, density, fontBase: FONT_HOST });
    const pdf = await renderer(html, { size, browser: opts.browser });
    return { pdf, pages: countPdfPages(pdf) };
  };
  const maxPages = opts.maxPages ?? 1;
  let fit: FitResult;
  if (opts.trim === false) {
    const normal = await measure(content, "normal");
    fit = { content, density: "normal", pages: normal.pages, pdf: normal.pdf, dropped: [], renders: 1 };
  } else {
    fit = await fitToPages(content, measure, { maxPages });
  }
  const html = renderResumeHtml(fit.content, { template, font, size, density: fit.density });
  return { pdf: fit.pdf, html, pages: fit.pages, content: fit.content, density: fit.density, dropped: fit.dropped, renders: fit.renders };
}
