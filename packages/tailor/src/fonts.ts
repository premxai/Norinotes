import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { FontId } from "./types.js";

/**
 * Fonts a resume can use. All are open licence (SIL OFL) and ship through @fontsource, so a PDF looks the same on a
 * laptop, in CI and on the server. Text stays real text (Chromium embeds a subset), so applicant systems can read it.
 */
type FontSpec = { id: FontId; pkg: string; stack: string; weights: number[]; italic: boolean };

export const FONTS: Record<FontId, FontSpec> = {
  "source-sans": { id: "source-sans", pkg: "source-sans-3", stack: "'Source Sans 3', Calibri, Carlito, Arial, sans-serif", weights: [400, 600, 700], italic: true },
  inter: { id: "inter", pkg: "inter", stack: "'Inter', Arial, Helvetica, sans-serif", weights: [400, 600, 700], italic: true },
  lora: { id: "lora", pkg: "lora", stack: "'Lora', Georgia, 'Times New Roman', serif", weights: [400, 700], italic: true },
  garamond: { id: "garamond", pkg: "eb-garamond", stack: "'EB Garamond', Garamond, Georgia, serif", weights: [400, 700], italic: true },
  /** Same metrics as Times New Roman, so a resume set in it lays out like a Times one. */
  tinos: { id: "tinos", pkg: "tinos", stack: "'Tinos', 'Times New Roman', Times, 'Liberation Serif', serif", weights: [400, 700], italic: true },
};

export const FONT_IDS = Object.keys(FONTS) as FontId[];
export const isFontId = (v: unknown): v is FontId => typeof v === "string" && v in FONTS;

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const require_ = createRequire(import.meta.url);
const dirCache = new Map<string, string>();

function filesDir(pkg: string): string {
  let d = dirCache.get(pkg);
  if (!d) {
    d = path.join(path.dirname(require_.resolve(`@fontsource/${pkg}/package.json`)), "files");
    dirCache.set(pkg, d);
  }
  return d;
}

type FontFile = { file: string; weight: number; style: "normal" | "italic"; range: string };

/** The woff2 files a font needs (only those that exist on disk). */
export function fontFiles(id: FontId): FontFile[] {
  const f = FONTS[id];
  const out: FontFile[] = [];
  for (const weight of f.weights) {
    for (const style of f.italic ? (["normal", "italic"] as const) : (["normal"] as const)) {
      for (const [subset, range] of [["latin", LATIN], ["latin-ext", LATIN_EXT]] as const) {
        const file = `${f.pkg}-${subset}-${weight}-${style}.woff2`;
        if (existsSync(path.join(filesDir(f.pkg), file))) out.push({ file, weight, style, range });
      }
    }
  }
  return out;
}

/** @font-face rules for the given fonts. `base` is where the browser fetches the files from. */
export function fontFaceCss(ids: FontId[], base: string): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const id of new Set(ids)) {
    const family = FONTS[id].stack.split(",")[0]!.replace(/'/g, "").trim();
    for (const ff of fontFiles(id)) {
      if (seen.has(ff.file)) continue;
      seen.add(ff.file);
      rules.push(`@font-face{font-family:'${family}';font-style:${ff.style};font-weight:${ff.weight};font-display:block;src:url(${base.replace(/\/$/, "")}/${ff.file}) format('woff2');unicode-range:${ff.range}}`);
    }
  }
  return rules.join("\n");
}

const ALLOWED_FILE = /^[a-z0-9-]+-latin(-ext)?-\d{3}-(normal|italic)\.woff2$/;

/** Read a font file by name for the PDF renderer. Only names from the registry resolve. */
export function readFontFile(file: string): Buffer | null {
  if (!ALLOWED_FILE.test(file)) return null;
  for (const id of FONT_IDS) {
    const f = FONTS[id];
    if (!file.startsWith(`${f.pkg}-`)) continue;
    const p = path.join(filesDir(f.pkg), file);
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}
