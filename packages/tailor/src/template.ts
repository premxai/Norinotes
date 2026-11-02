import { FONTS, fontFaceCss } from "./fonts.js";
import type { Density, FontId, PageSize, ResumeBullet, ResumeContact, ResumeContent, ResumeTemplate } from "./types.js";

export const PAGE_SIZES: Record<PageSize, { widthIn: number; heightIn: number; css: string }> = {
  letter: { widthIn: 8.5, heightIn: 11, css: "Letter" },
  a4: { widthIn: 8.2677, heightIn: 11.6929, css: "A4" },
};

/** Section titles are the standard words applicant systems look for. */
export const SECTION_TITLES = { summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects", education: "Education" } as const;
export const STANDARD_HEADINGS: ReadonlySet<string> = new Set(Object.values(SECTION_TITLES));

export const DEFAULT_TEMPLATE: ResumeTemplate = "ats";
export const DEFAULT_FONT: FontId = "tinos";
export const DEFAULT_SIZE: PageSize = "letter";

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

export function dateRange(start?: string | null, end?: string | null): string {
  const s = formatDate(start);
  const en = formatDate(end) || (s ? "Present" : "");
  return s && en ? `${s} - ${en}` : s || en;
}

const hrefOf = (u: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);

/** Location | phone | email | links, links shown by their label (the href keeps the address). */
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

function bulletList(items: ResumeBullet[]): string {
  const li = items.map((b) => b.text.trim()).filter(Boolean).map((t) => `<li>${e(t)}</li>`);
  return li.length ? `<ul>\n${li.join("\n")}\n</ul>` : "";
}

type Built = { id: string; title: string; html: string };

/** Sections in the order parsers and recruiters expect, with empty ones removed. */
export function buildSections(c: ResumeContent): Built[] {
  const summary = c.summary?.trim() ? `<p>${e(c.summary.trim())}</p>` : "";
  const skillRows = c.skills.filter((g) => g.items.length > 0).map((g) => `<li><strong>${e(g.group)}:</strong> ${g.items.map((i) => e(i)).join(", ")}</li>`);
  const skills = skillRows.length ? `<div class="skills">\n<ul>\n${skillRows.join("\n")}\n</ul>\n</div>` : "";
  const experience = c.experience.map((r) => {
    const when = dateRange(r.start, r.end);
    const sub = [r.title, r.location].filter(Boolean).map((x) => e(x!)).join(" · ");
    return `<div class="role">\n<h3><span>${e(r.company || r.title)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>\n${sub && r.company ? `<p class="sub">${sub}</p>\n` : ""}${bulletList(r.bullets)}\n</div>`;
  }).join("\n");
  const projects = c.projects.filter((p) => p.name).map((p) => `<div class="role">\n<h3><span>${e(p.name)}</span></h3>\n${bulletList(p.bullets)}\n</div>`).join("\n");
  const education = c.education.map((ed) => {
    const when = dateRange(ed.start, ed.end);
    return `<div class="edu"><h3><span>${e(ed.school)}</span>${when ? `<span class="when">${e(when)}</span>` : ""}</h3>${ed.degree ? `<p class="sub">${e(ed.degree)}</p>` : ""}</div>`;
  }).join("\n");
  const all: Built[] = [
    { id: "summary", title: SECTION_TITLES.summary, html: summary },
    { id: "skills", title: SECTION_TITLES.skills, html: skills },
    { id: "experience", title: SECTION_TITLES.experience, html: experience },
    { id: "projects", title: SECTION_TITLES.projects, html: projects },
    { id: "education", title: SECTION_TITLES.education, html: education },
  ];
  return all.filter((s) => s.html);
}

/** Fitting levels: tighter type and margins pull a resume onto the page limit without touching its words. */
export function densityAdjust(density: Density): { fs: number; lh: number; m: number } {
  return density === "normal" ? { fs: 0, lh: 0, m: 0 } : density === "compact" ? { fs: 0.4, lh: 0.07, m: 0.08 } : { fs: 0.85, lh: 0.14, m: 0.16 };
}

export type HtmlOptions = { template?: ResumeTemplate; font?: FontId; size?: PageSize; density?: Density; fontBase?: string };

/** A complete, self-contained, single-column resume HTML document. */
export function renderResumeHtml(content: ResumeContent, opts: HtmlOptions = {}): string {
  const font = opts.font ?? DEFAULT_FONT;
  const size = PAGE_SIZES[opts.size ?? DEFAULT_SIZE];
  const d = densityAdjust(opts.density ?? "normal");
  const fontSize = Math.max(8.5, +(10.5 - d.fs).toFixed(2));
  const lineHeight = Math.max(1.05, +(1.2 - d.lh).toFixed(2));
  const margin = Math.max(0.35, +(0.5 - d.m).toFixed(2));
  const top = (margin * 0.6).toFixed(2);
  const bottom = (margin * 0.8).toFixed(2);
  const stack = FONTS[font].stack;
  const items = contactItems(content.contact);
  const contactHtml = items.length ? `<p class="contact">${items.map((x) => `<span class="item">${x}</span>`).join('<span class="sep">|</span>')}</p>` : "";
  const sections = buildSections(content).map((s) => `<section class="sec" id="${s.id}">\n<h2>${s.title}</h2>\n${s.html}\n</section>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(content.name || "Resume")} - Resume</title>
<style>
${fontFaceCss([font], opts.fontBase ?? "fonts")}
@page { size: ${size.css}; margin: ${top}in ${margin}in ${bottom}in ${margin}in; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${stack}; font-size: ${fontSize}pt; line-height: ${lineHeight}; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
a { color: inherit; text-decoration: none; }
p { margin: 0; }
header { text-align: center; }
h1 { margin: 0; font-size: 17pt; font-weight: 700; line-height: 1.15; }
h1, h2, h3 { break-after: avoid; }
.contact { font-size: .9em; margin: 2pt 0 0 0; }
.contact .item { white-space: nowrap; }
.contact span.sep { margin: 0 .3em; }
h2 { margin: 5pt 0 1pt 0; font-size: 1em; font-weight: 700; border-bottom: .6pt solid #000; line-height: 1.2; }
.sec:first-of-type h2 { margin-top: 4pt; }
h3 { display: flex; justify-content: space-between; gap: 10pt; margin: 3pt 0 0 0; font-size: 1em; font-weight: 700; }
h3 .when { font-weight: 400; white-space: nowrap; }
.sub { margin: 0; }
ul { margin: 0; padding-left: 13pt; }
li { margin: 0; break-inside: avoid; }
.role, .edu { break-inside: avoid-page; }
.edu { margin-top: 2pt; }
.edu h3 { margin-top: 0; }
@media screen { body { width: ${size.widthIn}in; margin: 14px auto; padding: ${top}in ${margin}in ${bottom}in ${margin}in; } }
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
