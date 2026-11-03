import { FONTS, fontFaceCss } from "./fonts.js";
import { ATS_THEME, PAGE_SIZES, SECTION_TITLES, applyDensity, normalizeTheme, type ResumeTheme, type SectionId } from "./theme.js";
import type { Density, FontId, PageSize, ResumeContact, ResumeContent, ResumeTemplate } from "./types.js";

export { PAGE_SIZES, SECTION_IDS, SECTION_TITLES } from "./theme.js";
export type { ResumeTheme, SectionId } from "./theme.js";

/** The section titles an ATS expects. A rendered heading outside this set fails the ATS heading check. */
export const STANDARD_HEADINGS: ReadonlySet<string> = new Set(Object.values(SECTION_TITLES));

/** ATS Standard is the only resume format Norinote uses. */
export const DEFAULT_TEMPLATE: ResumeTemplate = "ats";
export const DEFAULT_FONT: FontId = ATS_THEME.font;
export const DEFAULT_SIZE: PageSize = ATS_THEME.pageSize;

export type TemplateMeta = {
  id: ResumeTemplate;
  name: string;
  description: string;
  /** Single column, plain headings, no tables or images: parsers read it in order. */
  atsSafe: true;
  columns: 1;
  theme: ResumeTheme;
  /** Section order, top to bottom. Empty sections are left out. */
  sections: readonly SectionId[];
};

export const ATS_STANDARD: TemplateMeta = {
  id: "ats", name: "ATS Standard", columns: 1, atsSafe: true,
  description: "The parser-first one-pager: centred name, plain bold headings with a rule, company-first roles, Times type, tight spacing.",
  theme: ATS_THEME,
  sections: ["summary", "skills", "experience", "education", "projects", "certifications"],
};

/** Theme for the template: ATS Standard's look, then the caller's overrides, clamped to sane ranges. */
export function themeFor(overrides?: unknown): ResumeTheme {
  return normalizeTheme(overrides, ATS_STANDARD.theme);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const e = escapeHtml;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2021-03" -> "Mar 2021"; "2021" stays; "present" -> "Present"; anything else passes through. */
export function formatDate(d?: string | null): string {
  if (!d) return "";
  const t = d.trim();
  if (/^(present|current|now)$/i.test(t)) return "Present";
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(t);
  if (m) {
    const mi = Number(m[2]) - 1;
    return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[1]}` : m[1]!;
  }
  return t;
}

/** "Mar 2021 – Present" (en dash). A start with no end reads as running to the present. */
export function dateRange(start?: string | null, end?: string | null): string {
  const s = formatDate(start);
  const en = formatDate(end) || (s ? "Present" : "");
  return s && en ? `${s} – ${en}` : s || en;
}

const hrefOf = (u: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);

/** Location | phone | email | LinkedIn | GitHub | Portfolio, links shown by their label (the href keeps the address). */
function contactItems(c: ResumeContact): string[] {
  const out: string[] = [];
  if (c.location?.trim()) out.push(e(c.location.trim()));
  if (c.phone?.trim()) out.push(e(c.phone.trim()));
  if (c.email?.trim()) out.push(`<a href="mailto:${e(c.email.trim())}">${e(c.email.trim())}</a>`);
  for (const [u, label] of [[c.linkedin, "LinkedIn"], [c.github, "GitHub"], [c.website, "Portfolio"]] as const) {
    if (u?.trim()) out.push(`<a href="${e(hrefOf(u))}">${label}</a>`);
  }
  return out;
}

function bulletList(items: { text: string }[]): string {
  const li = items.map((b) => b.text.trim()).filter(Boolean).map((t) => `<li>${e(t)}</li>`);
  return li.length ? `<ul>\n${li.join("\n")}\n</ul>` : "";
}

type Built = { id: SectionId; title: string; html: string };

function sectionBodies(c: ResumeContent): Record<SectionId, string> {
  const summary = c.summary?.trim() ? `<p>${e(c.summary.trim())}</p>` : "";
  const skillRows = c.skills.filter((g) => g.items.length > 0).map((g) => `<li><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</li>`);
  const skills = skillRows.length ? `<div class="skills">\n<ul>\n${skillRows.join("\n")}\n</ul>\n</div>` : "";
  const experience = c.experience.map((r) => {
    // Company first in bold with the dates on the right; title and location on the line below. What Workday-style parsers read best.
    const when = dateRange(r.start, r.end);
    const sub = [r.title, r.location].filter(Boolean).map((x) => e(x!)).join(" · ");
    return `<div class="role">\n<h3><span>${e(r.company || r.title)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${sub && r.company ? `<p class="sub">${sub}</p>\n` : ""}${bulletList(r.bullets)}\n</div>`;
  }).join("\n");
  const education = c.education.map((ed) => {
    const when = dateRange(ed.start, ed.end);
    const deg = ed.degree && ed.field ? `${ed.degree} in ${ed.field}` : ed.degree || ed.field || "";
    return `<div class="edu"><h3><span>${e(ed.school)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>${deg ? `<p class="sub">${e(deg)}</p>` : ""}</div>`;
  }).join("\n");
  const projects = c.projects.filter((p) => p.name).map((p) => `<div class="role">\n<h3><span>${e(p.name)}</span></h3>\n${bulletList(p.bullets)}\n</div>`).join("\n");
  const certs = (c.certifications ?? []).filter((x) => x.trim());
  const certifications = certs.length ? bulletList(certs.map((text) => ({ text }))) : "";
  return { summary, skills, experience, education, projects, certifications };
}

/** Sections in the order parsers and recruiters expect, with empty ones removed. */
export function buildSections(c: ResumeContent): Built[] {
  const bodies = sectionBodies(c);
  return ATS_STANDARD.sections.filter((id) => bodies[id]).map((id) => ({ id, title: SECTION_TITLES[id], html: bodies[id] }));
}

function css(t: ResumeTheme): string {
  const page = PAGE_SIZES[t.pageSize];
  const body = FONTS[t.font].stack;
  const head = FONTS[t.headingFont ?? t.font].stack;
  const top = (t.margin * 0.6).toFixed(2);
  const bottom = (t.margin * 0.8).toFixed(2);
  // Mirrors a LaTeX one-pager that Workday and the big parsers read cleanly: Times at 10.5pt, half-inch sides with a
  // shorter top margin, bold section titles over a thin rule, no colour, bullets with no gaps.
  return `@page { size: ${page.css}; margin: ${t.margin}in; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${body}; font-size: ${t.fontSize}pt; line-height: ${t.lineHeight}; color: #151515; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --accent: ${t.accent}; --head: ${head}; --body: ${body}; --fs: ${t.fontSize}pt; }
a { color: inherit; text-decoration: none; }
.contact .item { white-space: nowrap; }
p { margin: 0; }
ul { margin: 2pt 0 0 0; padding-left: 14pt; }
li { margin: 0 0 1.2pt 0; break-inside: avoid; }
h1, h2, h3 { margin: 0; break-after: avoid; }
.role, .edu { break-inside: avoid-page; }
h3 { display: flex; justify-content: space-between; gap: 10pt; font-size: 1em; font-weight: 700; margin: 6pt 0 1pt 0; }
h3 .when { font-weight: 400; white-space: nowrap; }
.sub { font-style: italic; margin: 0 0 1pt 0; }
.skills p { margin: 0 0 1.5pt 0; }
.edu { margin: 3pt 0 0 0; }
.edu h3 { margin-top: 0; }
@media screen {
  html { background: #e9e7e2; }
  body { width: ${page.widthIn}in; min-height: ${page.heightIn}in; margin: 14px auto; padding: ${t.margin}in; box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08); }
}
@page { margin: ${top}in ${t.margin}in ${bottom}in ${t.margin}in; }
@media screen { body { padding: ${top}in ${t.margin}in ${bottom}in ${t.margin}in; } }
body { color: #000; }
header { text-align: ${t.headerAlign}; }
h1 { font-size: 17pt; font-weight: 700; line-height: 1.15; }
.contact { font-size: .9em; margin: 2pt 0 0 0; color: #000; }
.contact span.sep { margin: 0 .3em; }
h2 { font-family: var(--head); font-size: 1em; font-weight: 700; margin: 5pt 0 1pt 0; padding-bottom: 0; border-bottom: .6pt solid #000; line-height: 1.2; }
.sec:first-of-type h2 { margin-top: 4pt; }
h3 { margin: 3pt 0 0 0; font-weight: 700; }
h3 .when { font-weight: 400; }
.sub { font-style: normal; margin: 0; }
ul { padding-left: 13pt; margin-top: 0; }
li { margin: 0; }
.edu { margin-top: 2pt; }`;
}

export type HtmlOptions = {
  /** Kept for callers that name the template. ATS Standard is the only one, so any value renders as ATS Standard. */
  template?: ResumeTemplate;
  font?: FontId;
  size?: PageSize;
  /** Theme overrides (font size, margin, accent...), normalised and clamped. `font` and `size` win over it. */
  theme?: unknown;
  density?: Density;
  /** Where the browser fetches font files from. */
  fontBase?: string;
};

/** A complete, self-contained, single-column ATS Standard resume HTML document. */
export function renderResumeHtml(content: ResumeContent, opts: HtmlOptions = {}): string {
  const overrides = { ...(opts.theme && typeof opts.theme === "object" ? opts.theme : {}), ...(opts.font ? { font: opts.font } : {}), ...(opts.size ? { pageSize: opts.size } : {}) };
  const theme = applyDensity(themeFor(overrides), opts.density ?? "normal");
  const fonts: FontId[] = [theme.font, theme.headingFont ?? theme.font];
  const items = contactItems(content.contact);
  const contactHtml = items.length ? `<p class="contact">${items.map((x) => `<span class="item">${x}</span>`).join('<span class="sep">|</span>')}</p>` : "";
  const sections = buildSections(content).map((s) => `<section class="sec" id="${s.id}">\n<h2>${s.title}</h2>\n${s.html}\n</section>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(content.name || "Resume")} - Resume</title>
<style>
${fontFaceCss(fonts, opts.fontBase ?? "fonts")}
${css(theme)}
</style>
</head>
<body>
<header>
<h1>${e(content.name)}</h1>
${contactHtml}
</header>
${sections.join("\n")}
</body>
</html>
`;
}
