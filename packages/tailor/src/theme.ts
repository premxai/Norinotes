import { FONT_IDS } from "./fonts.js";
import type { Density, FontId, PageSize } from "./types.js";

/** Section ids in the order ATS Standard prints them. */
export const SECTION_IDS = ["summary", "skills", "experience", "education", "projects", "certifications"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
/** Section titles are the standard words applicant systems look for. */
export const SECTION_TITLES: Record<SectionId, string> = {
  summary: "Summary", skills: "Skills", experience: "Experience", education: "Education", projects: "Projects", certifications: "Certifications",
};

export const PAGE_SIZES: Record<PageSize, { label: string; widthIn: number; heightIn: number; css: "Letter" | "A4" }> = {
  letter: { label: "US Letter", widthIn: 8.5, heightIn: 11, css: "Letter" },
  a4: { label: "A4", widthIn: 8.2677, heightIn: 11.6929, css: "A4" },
};

export type ResumeTheme = {
  font: FontId;
  /** Heading font; defaults to the body font. */
  headingFont?: FontId;
  /** #rrggbb */
  accent: string;
  /** Body size in pt. */
  fontSize: number;
  lineHeight: number;
  /** Page margin in inches. */
  margin: number;
  pageSize: PageSize;
  headerAlign: "left" | "center";
};

/** The ATS Standard look: Times-metric Tinos 10.5 pt, line height 1.2, half-inch margins, black, centred header. */
export const ATS_THEME: ResumeTheme = {
  font: "tinos", accent: "#000000", fontSize: 10.5, lineHeight: 1.2, margin: 0.5, pageSize: "letter", headerAlign: "center",
};

/** Fill any missing or invalid field from `base`, and clamp numbers to their ranges. Never throws. */
export function normalizeTheme(input: unknown, base: ResumeTheme = ATS_THEME): ResumeTheme {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const font = FONT_IDS.includes(o.font as FontId) ? (o.font as FontId) : base.font;
  const headingFont = FONT_IDS.includes(o.headingFont as FontId) ? (o.headingFont as FontId) : base.headingFont;
  return {
    font,
    ...(headingFont ? { headingFont } : {}),
    accent: typeof o.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(o.accent) ? o.accent.toLowerCase() : base.accent,
    fontSize: num(o.fontSize, 8.5, 13, base.fontSize),
    lineHeight: num(o.lineHeight, 1.05, 1.7, base.lineHeight),
    margin: num(o.margin, 0.35, 1.1, base.margin),
    pageSize: o.pageSize === "a4" || o.pageSize === "letter" ? o.pageSize : base.pageSize,
    headerAlign: o.headerAlign === "center" || o.headerAlign === "left" ? o.headerAlign : base.headerAlign,
  };
}

/** Fitting levels: tighter type and margins pull a resume onto the page limit without touching its words. */
export function applyDensity(theme: ResumeTheme, density: Density): ResumeTheme {
  if (density === "normal") return theme;
  const d = density === "compact" ? { fs: 0.4, lh: 0.07, m: 0.08 } : { fs: 0.85, lh: 0.14, m: 0.16 };
  return {
    ...theme,
    fontSize: Math.max(8.5, +(theme.fontSize - d.fs).toFixed(2)),
    lineHeight: Math.max(1.05, +(theme.lineHeight - d.lh).toFixed(2)),
    margin: Math.max(0.35, +(theme.margin - d.m).toFixed(2)),
  };
}
