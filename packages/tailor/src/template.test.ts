import { afterAll, describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { atsChecks } from "./ats.js";
import { chromiumInstalled, closeSharedBrowser } from "./browser.js";
import { exportResumePdf, renderResumeText, resumeFileBase } from "./export.js";
import { FONT_IDS, fontFaceCss, fontFiles, readFontFile } from "./fonts.js";
import { countPdfPages, renderResumePdf } from "./pdf.js";
import { SAMPLE_PERSONAS, SAMPLE_RESUME, STUDENT_RESUME, longResume } from "./sample-content.js";
import { ATS_STANDARD, DEFAULT_TEMPLATE, buildSections, dateRange, renderResumeHtml, themeFor } from "./template.js";
import { ATS_THEME, applyDensity, normalizeTheme } from "./theme.js";
import type { ResumeContent } from "./types.js";

afterAll(async () => { await closeSharedBrowser(); });

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function allText(c: ResumeContent): string[] {
  return [
    c.name, c.summary ?? "",
    ...c.experience.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...c.education.map((e) => e.school),
    ...c.skills.flatMap((g) => g.items),
    ...c.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...(c.certifications ?? []),
  ].filter(Boolean);
}

/** Text items of a PDF in the order the parser sees them, one string per page. */
async function pdfPages(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const t = await (await doc.getPage(i)).getTextContent();
    pages.push((t.items as { str: string }[]).map((x) => x.str).join(" "));
  }
  return pages;
}

describe("ATS Standard is the single template", () => {
  it("is the default, single column, ATS-safe, and any other template name renders the same", () => {
    expect(DEFAULT_TEMPLATE).toBe("ats");
    expect(ATS_STANDARD).toMatchObject({ id: "ats", name: "ATS Standard", atsSafe: true, columns: 1 });
    expect(renderResumeHtml(SAMPLE_RESUME, { template: "classic" as never })).toBe(renderResumeHtml(SAMPLE_RESUME));
    expect(renderResumeHtml(SAMPLE_RESUME, { template: "ats" })).toBe(renderResumeHtml(SAMPLE_RESUME));
  });

  it("mirrors the LaTeX one-pager: Times, centred header, company-first roles, labelled links, skills as bullets", () => {
    expect(themeFor()).toMatchObject({ font: "tinos", fontSize: 10.5, lineHeight: 1.2, margin: 0.5, headerAlign: "center", accent: "#000000" });
    const html = renderResumeHtml(SAMPLE_RESUME);
    expect(html).toContain("tinos-latin-400-normal.woff2");
    expect(html).toContain("font-size: 10.5pt; line-height: 1.2;");
    expect(html).toContain("header { text-align: center; }");
    expect(html).toContain("border-bottom: .6pt solid #000");
    const role = SAMPLE_RESUME.experience[0]!;
    expect(html).toContain(`<h3><span>${role.company}</span><span class="when">Mar 2022 – Present</span></h3>`);
    expect(html).toContain(`<p class="sub">${role.title} · ${role.location}</p>`);
    expect(html).toMatch(/<a href="https:\/\/linkedin\.com\/in\/alexmorgan">LinkedIn<\/a>/);
    expect(html).toMatch(/<a href="https:\/\/github\.com\/alexmorgan">GitHub<\/a>/);
    expect(html).toMatch(/<a href="https:\/\/alexmorgan\.example\.com">Portfolio<\/a>/);
    expect(html).toMatch(/<div class="skills">\s*<ul>\s*<li><strong>Languages:<\/strong> TypeScript, Python, SQL, Go<\/li>/);
    expect(html).toContain('<div class="edu"><h3><span>University of Washington</span><span class="when">2013 – 2017</span></h3><p class="sub">B.S. in Computer Science</p></div>');
    expect(html).toMatch(/@page \{ margin: 0\.30in 0\.5in 0\.40in 0\.5in; \}/);
  });

  it("prints the contact line as Location | phone | email | LinkedIn | GitHub | Portfolio", () => {
    const html = renderResumeHtml(SAMPLE_RESUME);
    const line = /<p class="contact">(.*)<\/p>/.exec(html)![1]!;
    const labels = line.split('<span class="sep">|</span>').map((x) => x.replace(/<[^>]+>/g, ""));
    expect(labels).toEqual(["San Francisco, CA", "(415) 555-0134", "alex.morgan@example.com", "LinkedIn", "GitHub", "Portfolio"]);
  });

  it("orders sections summary, skills, experience, education, projects, certifications and drops empty ones", () => {
    expect(buildSections(SAMPLE_RESUME).map((s) => s.id)).toEqual(["summary", "skills", "experience", "education", "projects", "certifications"]);
    const html = renderResumeHtml(SAMPLE_RESUME);
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1])).toEqual(["Summary", "Skills", "Experience", "Education", "Projects", "Certifications"]);
    expect(buildSections({ ...SAMPLE_RESUME, summary: "", certifications: [], projects: [] }).map((s) => s.id)).toEqual(["skills", "experience", "education"]);
  });

  it("matches the golden HTML for the sample resume", async () => {
    await expect(renderResumeHtml(SAMPLE_RESUME)).toMatchFileSnapshot("./__snapshots__/ats-standard-sample.html");
  });

  it("formats date ranges with an en dash and runs an open start to Present", () => {
    expect(dateRange("2021-03", "2022-01")).toBe("Mar 2021 – Jan 2022");
    expect(dateRange("2021", undefined)).toBe("2021 – Present");
    expect(dateRange(undefined, undefined)).toBe("");
  });
});

describe("theme normalisation and density", () => {
  it("layers overrides on ATS Standard and clamps bad input", () => {
    expect(themeFor({ accent: "#ff0000", fontSize: 99, margin: -3, font: "nope" })).toMatchObject({ accent: "#ff0000", fontSize: 13, margin: 0.35, font: "tinos" });
    expect(normalizeTheme(null)).toEqual(ATS_THEME);
    expect(normalizeTheme({ accent: "red" }).accent).toBe(ATS_THEME.accent);
    expect(normalizeTheme({ pageSize: "a4", headerAlign: "left" })).toMatchObject({ pageSize: "a4", headerAlign: "left" });
  });

  it("tightens type, line height and margins with density, never below the floor", () => {
    const t = themeFor();
    const compact = applyDensity(t, "compact");
    const tight = applyDensity(t, "tight");
    expect(applyDensity(t, "normal")).toBe(t);
    expect(tight.fontSize).toBeLessThan(compact.fontSize);
    expect(compact.fontSize).toBeLessThan(t.fontSize);
    expect(tight.margin).toBeLessThan(compact.margin);
    expect(applyDensity({ ...t, fontSize: 8.5, lineHeight: 1.05, margin: 0.35 }, "tight")).toMatchObject({ fontSize: 8.5, lineHeight: 1.05, margin: 0.35 });
    const html = renderResumeHtml(SAMPLE_RESUME, { density: "compact" });
    expect(html).toContain("font-size: 10.1pt");
    expect(renderResumeHtml(SAMPLE_RESUME, { density: "tight" })).toContain("font-size: 9.65pt");
  });

  it("honours font, size and theme options", () => {
    const html = renderResumeHtml(SAMPLE_RESUME, { font: "inter", size: "a4", theme: { fontSize: 11 } });
    expect(html).toMatch(/@page \{ size: A4;/);
    expect(html).toContain("inter-latin-400-normal.woff2");
    expect(html).toContain("font-size: 11pt");
  });
});

describe.each(Object.entries(SAMPLE_PERSONAS))("%s persona", (_name, persona) => {
  it("renders escaped, complete, single-column HTML", () => {
    const html = renderResumeHtml(persona);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<table|<img|<svg|<script/i);
    expect(html).not.toContain("<data>");
    for (const t of allText(persona)) expect(html, `missing "${t.slice(0, 40)}"`).toContain(esc(t));
  });

  it("passes the ATS heading and layout checks", () => {
    const r = atsChecks(persona, renderResumeHtml(persona), null, 1);
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
    expect(byId.headings).toBe(true);
    expect(byId.layout).toBe(true);
  });
});

describe("fonts", () => {
  it("every registered font has files and valid @font-face rules", () => {
    for (const id of FONT_IDS) {
      expect(fontFiles(id).length, id).toBeGreaterThan(0);
      for (const f of fontFiles(id)) expect(readFontFile(f.file)?.length ?? 0, f.file).toBeGreaterThan(1000);
    }
    const css = fontFaceCss(["inter", "inter", "lora"], "/api/resume-fonts/");
    expect(css).toContain("src:url(/api/resume-fonts/inter-latin-400-normal.woff2)");
    expect(css.match(/inter-latin-400-normal/g)).toHaveLength(1);
    expect(css).toContain("unicode-range");
  });

  it("refuses anything that is not a registered font file name", () => {
    for (const bad of ["../package.json", "..%2Fx.woff2", "inter-latin-400-normal.woff2/../../x", "/etc/passwd", "inter.woff2", "x-latin-400-normal.woff2", ""]) {
      expect(readFontFile(bad), bad).toBeNull();
    }
  });
});

describe("text export and file names", () => {
  it("writes readable plain text in PDF order", () => {
    const t = renderResumeText(SAMPLE_RESUME);
    expect(t.split("\n")[0]).toBe("Alex Morgan");
    expect(t).toContain("San Francisco, CA | (415) 555-0134 | alex.morgan@example.com");
    expect(t).toContain("Northwind Labs  |  Mar 2022 – Present\nSenior Software Engineer · San Francisco, CA");
    expect(t).toContain("- Led the migration of the checkout flow");
    expect(t).toContain("Languages: TypeScript, Python, SQL, Go");
    expect(t).not.toMatch(/\n{3,}/);
    const heads = [...t.matchAll(/^([A-Z]+)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(["SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", "PROJECTS", "CERTIFICATIONS"]);
    expect(renderResumeText(STUDENT_RESUME)).not.toContain("CERTIFICATIONS");
  });

  it("makes safe file names", () => {
    expect(resumeFileBase("Łukasz Żółkiewski-Núñez")).toBe("Lukasz-Zolkiewski-Nunez-Resume");
    expect(resumeFileBase("../../etc/passwd")).toBe("etc-passwd-Resume");
    expect(resumeFileBase("")).toBe("My-Resume");
    expect(resumeFileBase("x".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});

describe("real PDF render", () => {
  it.skipIf(!chromiumInstalled())("renders the sample on one page with a clean, in-order text layer", async () => {
    const out = await renderResumePdf(SAMPLE_RESUME);
    expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(out.pages).toBe(1);
    expect(out.density).toBe("normal");
    expect(out.dropped).toEqual([]);
    const pages = await pdfPages(out.pdf);
    expect(pages).toHaveLength(1);
    const text = squash(pages[0]!);
    for (const t of allText(SAMPLE_RESUME)) expect(text, `lost: "${t.slice(0, 50)}"`).toContain(squash(t));
    // Reading order: name, contact line, then the sections top to bottom.
    const marks = ["Alex Morgan", "San Francisco, CA", "LinkedIn", "Summary", "Skills", "Experience", "Northwind Labs", "Brightside Analytics", "Copperline", "Education", "University of Washington", "Projects", "Certifications"];
    const at = marks.map((m) => squash(pages[0]!).indexOf(squash(m)));
    expect(at.every((i) => i >= 0), JSON.stringify(Object.fromEntries(marks.map((m, i) => [m, at[i]])))).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Links keep readable labels: the label is text, not an image.
    expect(text).toContain("linkedin");
    expect(text).toContain("github");
    expect(text).toContain("portfolio");
  }, 90_000);

  it.skipIf(!chromiumInstalled())("prints every word of every persona as real text", async () => {
    for (const [name, persona] of Object.entries(SAMPLE_PERSONAS)) {
      const r = await renderResumePdf(persona, { maxPages: 3, trim: false });
      const text = squash((await pdfPages(r.pdf)).join(" "));
      expect(r.pages, name).toBeLessThanOrEqual(3);
      for (const t of allText(persona)) expect(text, `${name} lost: "${t.slice(0, 50)}"`).toContain(squash(t));
    }
  }, 120_000);

  it.skipIf(!chromiumInstalled())("fits a long resume on one page, keeping each role's best bullet and the order of what is left", async () => {
    const long = longResume();
    const out = await renderResumePdf(long);
    expect(out.pages).toBe(1);
    expect(countPdfPages(out.pdf)).toBe(1);
    expect((await pdfPages(out.pdf))).toHaveLength(1);
    for (let i = 0; i < long.experience.length; i++) {
      expect(out.content.experience[i]!.bullets.map((b) => b.id), `role ${i}`).toContain(`l${i}-0`);
    }
    // Tighter type comes before cutting: a resume left at normal density lost nothing.
    if (out.density === "normal") expect(out.dropped).toEqual([]);
  }, 120_000);

  it.skipIf(!chromiumInstalled())("exports a named PDF that is one page", async () => {
    const out = await exportResumePdf(SAMPLE_RESUME);
    expect(out.fileName).toBe("Alex-Morgan-Resume.pdf");
    expect(out.pages).toBe(1);
    expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 90_000);
});
