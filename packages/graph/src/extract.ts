/**
 * Resume file to clean, reading-order text plus the hyperlinks hidden behind words.
 *
 * PDF: text items with positions (pdf.js through unpdf), link annotations, two-column detection by finding a vertical
 * gutter no text crosses, lines rebuilt by baseline, bullets kept on their own lines. DOCX: mammoth HTML with links and
 * tables flattened row by row. Plain text and Markdown pass through. Parsers load lazily.
 */

export type ResumeFile = { name: string; mime: string; bytes: Uint8Array | ArrayBuffer };
export type ExtractedLink = { url: string; anchor?: string };
export type ExtractedResume = {
  text: string;
  links: ExtractedLink[];
  pages: number;
  /** Set when the file held no readable text (a scanned PDF). */
  error?: string;
};

export const SCANNED_PDF_ERROR = "scanned PDF: upload a text-based PDF or DOCX";

const BULLET_CHARS = "•·●▪■◦‣▸►○∙➢➤✓✔◆◇□–-*";
const ODD_BULLETS = /^[•●▪◦‣⁃∙]\s*/;

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC") // ligatures (fi, fl), non-breaking and wide spaces
    .replace(/\p{Cf}/gu, "") // byte-order mark, zero-width characters
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/\x00/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(ODD_BULLETS, (m) => (m.trim() ? "• " : m)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Format = "pdf" | "docx" | "txt";

function formatOf(mimeOrName: string): Format | null {
  const s = mimeOrName.toLowerCase().trim();
  if (s.includes("pdf")) return "pdf";
  if (s.includes("wordprocessingml") || /\.docx$/.test(s)) return "docx";
  if (s.startsWith("text/") || /\.(?:txt|md|markdown|text)$/.test(s)) return "txt";
  return null;
}

function sniff(b: Uint8Array): Format {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "docx";
  return "txt";
}

/** Reads a resume upload. Format comes from the MIME type, then the file name, then the file's first bytes. */
export async function extractResumeText(file: ResumeFile): Promise<ExtractedResume> {
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  const fmt = formatOf(file.mime) ?? formatOf(file.name) ?? sniff(bytes);
  if (fmt === "pdf") return extractPdf(bytes);
  if (fmt === "docx") return extractDocx(bytes);
  const raw = new TextDecoder("utf-8").decode(bytes);
  const links: ExtractedLink[] = [];
  const isMd = /\.(?:md|markdown)$/i.test(file.name) || /\[[^\]\n]+\]\(https?:[^)\s]+\)|^#{1,6}\s/m.test(raw);
  return { text: normalizeText(isMd ? markdownToText(raw, links) : raw), links, pages: 1 };
}

const addLink = (links: ExtractedLink[], url: string, anchor?: string) => {
  if (!links.some((l) => l.url === url)) links.push(anchor ? { url, anchor } : { url });
};

/** Markdown to plain lines: link text kept (URL collected), emphasis and heading marks dropped, list items become "• ". */
function markdownToText(md: string, links: ExtractedLink[]): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]\n]+)\]\(((?:https?:|mailto:|tel:)[^)\s]+)\)/g, (_m, anchor: string, url: string) => {
      addLink(links, url, anchor.trim());
      return anchor;
    })
    .split("\n")
    .map((l) => l
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "• ")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, ""))
    .join("\n");
}

// ---- PDF ------------------------------------------------------------------------------------------------------------

type Item = { str: string; x: number; y: number; w: number; h: number };
type Line = { y: number; h: number; x: number; items: Item[] };

async function extractPdf(bytes: Uint8Array): Promise<ExtractedResume> {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js detaches the buffer it is given; hand it a copy so the caller keeps theirs.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageTexts: string[] = [];
  const links: ExtractedLink[] = [];
  let chars = 0;
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const pageWidth = page.view[2] ?? 612;
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (typeof it.str !== "string" || !it.transform || !it.str.trim()) continue;
        const h = Math.abs(it.height || it.transform[3] || it.transform[0] || 10);
        items.push({ str: it.str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, w: it.width ?? 0, h });
      }
      chars += items.reduce((n, i) => n + i.str.trim().length, 0);

      const annots = (await page.getAnnotations().catch(() => [])) as { subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }[];
      for (const a of annots) {
        const url = a.subtype === "Link" ? a.url ?? a.unsafeUrl : undefined;
        if (!url || !a.rect || a.rect.length < 4) continue;
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = a.rect;
        const inside = items.filter((i) => {
          const cx = i.x + i.w / 2, cy = i.y + i.h / 3;
          return cx >= Math.min(x1, x2) - 1 && cx <= Math.max(x1, x2) + 1 && cy >= Math.min(y1, y2) - 2 && cy <= Math.max(y1, y2) + 2;
        }).sort((a2, b2) => b2.y - a2.y || a2.x - b2.x);
        addLink(links, url, inside.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim() || undefined);
      }
      pageTexts.push(layoutPage(items, pageWidth));
    }
  } finally {
    await closePdf(pdf);
  }
  const pages = pageTexts.length;
  if (chars < 20) return { text: "", links, pages, error: SCANNED_PDF_ERROR };
  return { text: normalizeText(pageTexts.join("\n\n")), links, pages };
}

async function closePdf(pdf: unknown): Promise<void> {
  const p = pdf as { destroy?: () => Promise<void>; loadingTask?: { destroy?: () => Promise<void> } };
  await (p.destroy?.() ?? p.loadingTask?.destroy?.())?.catch(() => undefined);
}

/** Most common value (within `tol`) of a list of numbers, with its share. */
function modeOf(xs: number[], tol: number): { value: number; share: number } {
  let best = { value: xs[0] ?? 0, count: 0 };
  for (const x of xs) {
    const count = xs.filter((y) => Math.abs(y - x) <= tol).length;
    if (count > best.count) best = { value: x, count };
  }
  return { value: best.value, share: xs.length ? best.count / xs.length : 0 };
}

function groupLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const tol = Math.max(2, Math.min(it.h, 14) * 0.45);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); line.x = Math.min(line.x, it.x); }
    else lines.push({ y: it.y, h: it.h, x: it.x, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

const right = (l: Line) => Math.max(...l.items.map((i) => i.x + i.w));

/**
 * A vertical gutter: an x in the middle of the page that almost no text crosses, with real text on both sides, and whose
 * right-hand lines share a left edge (a column), unlike right-aligned dates.
 */
function findGutter(items: Item[], pageWidth: number): { x: number; rightEdge: number } | null {
  const lines = groupLines(items);
  if (lines.length < 8) return null;
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w));
  const width = maxX - minX;
  if (width < pageWidth * 0.4) return null;
  const step = 2;
  const candidates: { x: number; ok: boolean }[] = [];
  for (let x = minX + width * 0.18; x <= minX + width * 0.82; x += step) {
    let crossing = 0, left = 0, rightN = 0;
    for (const l of lines) {
      let lc = false, ll = false, lr = false;
      for (const i of l.items) {
        if (i.x < x - 1 && i.x + i.w > x + 1) lc = true;
        else if (i.x + i.w <= x + 1) ll = true;
        else lr = true;
      }
      if (lc) crossing++;
      if (ll) left++;
      if (lr) rightN++;
    }
    candidates.push({ x, ok: crossing <= Math.max(1, lines.length * 0.12) && left >= lines.length * 0.25 && rightN >= lines.length * 0.25 });
  }
  let best: { x: number; run: number } | null = null;
  let runStart = -1;
  for (let k = 0; k <= candidates.length; k++) {
    if (candidates[k]?.ok) { if (runStart < 0) runStart = k; continue; }
    if (runStart >= 0) {
      const run = k - runStart;
      const center = candidates[runStart]!.x + ((run - 1) * step) / 2;
      if (run * step >= 6 && (!best || run > best.run)) best = { x: center, run };
      runStart = -1;
    }
  }
  if (!best) return null;
  const g = best.x;
  const starts = lines.map((l) => l.items.find((i) => i.x >= g - 1)?.x).filter((x): x is number => x !== undefined);
  const edge = modeOf(starts, 3);
  if (edge.share < 0.5 || starts.length < 6) return null;
  return { x: g, rightEdge: edge.value };
}

const BULLET_START = new RegExp(`^[${BULLET_CHARS.replace(/[-\]\\]/g, "\\$&")}]$`);
const HAS_BULLET = /^\s*(?:[•·●▪■◦‣▸►○∙➢➤✓✔◆◇□]|[-–—*]\s)/;

function lineText(l: Line): string {
  let out = "";
  let prev: Item | null = null;
  for (const it of l.items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const fs = Math.max(4, Math.min(prev.h, it.h));
      const prevBullet = BULLET_START.test(prev.str.trim());
      if (gap > fs * 2.5 && !prevBullet) out = out.replace(/\s+$/, "") + "   ";
      else if (gap > fs * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      else if (prevBullet && !/\s$/.test(out)) out += " ";
    }
    out += it.str;
    prev = it;
  }
  out = out.replace(/\s+$/, "");
  return out.replace(/\s{2,}([•●▪■◦‣▸►])\s*/g, "\n$1 ").replace(/^([•●▪■◦‣▸►])(?=\S)/, "$1 ");
}

/**
 * Lines of one column to text. List markers drawn as graphics (Chromium, design tools) leave no glyph, so indented runs
 * are recovered as bullets: a line at a recurring indent starts a bullet unless the line before it ran to the margin.
 */
function linesToText(lines: Line[]): string {
  if (!lines.length) return "";
  const left = Math.min(...lines.map((l) => l.x));
  const rightMargin = Math.max(...lines.map(right));
  const width = Math.max(1, rightMargin - left);
  const indents = lines.map((l) => l.x - left).filter((d) => d > 5 && d < 45);
  const indent = indents.length >= 2 ? modeOf(indents, 1.5) : null;
  const isIndented = (l: Line) => indent !== null && Math.abs(l.x - left - indent.value) <= 1.5;
  const centered = (l: Line) => Math.abs(l.x - left - (rightMargin - right(l))) < 8 && l.x - left > 20;

  const out: string[] = [];
  let prev: Line | null = null;
  let prevListed = false;
  for (const l of lines) {
    let gapBreak = false;
    if (prev && prev.y - l.y > Math.max(prev.h, l.h) * 1.9) { out.push(""); gapBreak = true; }
    let text = lineText(l);
    let listed = false;
    if (isIndented(l) && !centered(l) && !HAS_BULLET.test(text)) {
      let wrapped = false;
      if (prev && prevListed && !gapBreak && Math.abs(prev.x - l.x) <= 1.5 && !/[.!?]$/.test(lineText(prev).trim())) {
        const charW = (right(l) - l.x) / Math.max(1, text.length);
        const firstWord = (text.split(/\s+/)[0] ?? "").length * charW;
        const remaining = rightMargin - right(prev);
        wrapped = firstWord + charW * 1.5 > remaining && right(prev) >= rightMargin - width * 0.25;
      }
      if (!wrapped) text = `• ${text}`;
      listed = true;
    }
    out.push(text);
    prevListed = listed || HAS_BULLET.test(text);
    prev = l;
  }
  return out.join("\n");
}

/** Reading-order text for one page. Full-width rows and name banners stay whole; between them the left column is read before the right. */
function layoutPage(items: Item[], pageWidth: number): string {
  if (!items.length) return "";
  const gutter = findGutter(items, pageWidth);
  if (!gutter) return linesToText(groupLines(items));
  const g = gutter.x;
  const rows = groupLines(items);
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w));
  const center = (minX + maxX) / 2;
  const full = (l: Line) => {
    if (l.items.some((i) => i.x < g - 1 && i.x + i.w > g + 1)) return true;
    const offEdges = Math.abs(l.x - minX) > 4 && Math.abs(l.x - gutter.rightEdge) > 4;
    return offEdges && Math.abs((l.x + right(l)) / 2 - center) < 12;
  };
  const parts: string[] = [];
  let band: Line[] = [];
  let bandSplit = false;
  const flush = () => {
    if (!band.length) return;
    if (!bandSplit) parts.push(linesToText(band));
    else {
      const leftCol: Line[] = [], rightCol: Line[] = [];
      for (const l of band) {
        const li = l.items.filter((i) => i.x + i.w / 2 < g);
        const ri = l.items.filter((i) => i.x + i.w / 2 >= g);
        if (li.length) leftCol.push({ ...l, items: li, x: li[0]!.x });
        if (ri.length) rightCol.push({ ...l, items: ri, x: ri[0]!.x });
      }
      parts.push([linesToText(leftCol), linesToText(rightCol)].filter(Boolean).join("\n\n"));
    }
    band = [];
  };
  for (const r of rows) {
    const split = !full(r);
    if (band.length && split !== bandSplit) flush();
    bandSplit = split;
    band.push(r);
  }
  flush();
  return parts.filter(Boolean).join("\n\n");
}

// ---- DOCX -----------------------------------------------------------------------------------------------------------

async function extractDocx(bytes: Uint8Array): Promise<ExtractedResume> {
  const mod = await import("mammoth");
  const mammoth = mod.default ?? mod;
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const links: ExtractedLink[] = [];
  return { text: normalizeText(htmlToText(html, links)), links, pages: 1 };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e.startsWith("#")) {
    const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Mammoth HTML to text: block elements become lines, list items get "• ", table rows become "cell | cell", links are collected. */
export function htmlToText(html: string, links: ExtractedLink[]): string {
  let s = html.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const url = decode(href).trim();
    const anchor = decode(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (url && !url.startsWith("#")) addLink(links, url, anchor || undefined);
    return inner;
  });
  // Short single-paragraph cells read as "a | b | c"; cells holding blocks (layout tables for two-column resumes) are read cell by cell.
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1] ?? "");
    const blocky = cells.some((c) => (c.match(/<(?:p|li|h[1-6])\b/gi)?.length ?? 0) > 1);
    if (blocky) return `\n${cells.join("\n")}\n`;
    return `\n${cells.map((c) => c.replace(/<\/?(?:p|h[1-6])\b[^>]*>/gi, " ").trim()).filter(Boolean).join(" | ")}\n`;
  });
  s = s
    .replace(/<\/?(?:table|tbody|thead)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>(?:\s*<p\b[^>]*>)?/gi, "• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(?:p|h[1-6]|ul|ol|div)\b[^>]*>/gi, "")
    .replace(/<\/(?:p|h[1-6]|ul|ol|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(s)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .map((l) => (/^•\s*$/.test(l) ? "" : l))
    .join("\n")
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .replace(/^\s*\|\s*|\s*\|\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}
