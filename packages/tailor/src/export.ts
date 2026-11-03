import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderResumePdf, type RenderedResume, type RenderOptions } from "./pdf.js";
import { buildSections, dateRange } from "./template.js";
import type { ResumeContact, ResumeContent } from "./types.js";

/**
 * Exports of an ATS Standard resume. PDF is the format applications use. DOCX is not offered: the source exporter needs
 * the `docx` package, which this repo does not install.
 */

const TRANSLIT: Record<string, string> = { "Ł": "L", "ł": "l", "Ø": "O", "ø": "o", "Đ": "D", "đ": "d", "ß": "ss", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe", "Þ": "Th", "þ": "th", "Ð": "D", "ð": "d", "İ": "I", "ı": "i" };

/** A safe download name: "Jordan Rivera" -> "Jordan-Rivera-Resume". Accents and special letters become plain ASCII. */
export function resumeFileBase(name: string | undefined, suffix = "Resume"): string {
  const base = (name ?? "").replace(/[ŁłØøĐđßÆæŒœÞþÐðİı]/g, (c) => TRANSLIT[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "My"}-${suffix}`.slice(0, 80);
}

const contactParts = (c: ResumeContact): string[] =>
  [c.location, c.phone, c.email, c.linkedin, c.github, c.website].map((x) => x?.trim() ?? "").filter(Boolean);

/** Plain text for pasting into an application form or an email, in the same order as the PDF. */
export function renderResumeText(content: ResumeContent): string {
  const out: string[] = [content.name || ""];
  const contact = contactParts(content.contact);
  if (contact.length) out.push(contact.join(" | "));
  for (const s of buildSections(content)) {
    out.push("", s.title.toUpperCase());
    switch (s.id) {
      case "summary": out.push((content.summary ?? "").trim()); break;
      case "skills": for (const g of content.skills) if (g.items.length) out.push(`${g.group}: ${g.items.join(", ")}`); break;
      case "experience":
        for (const r of content.experience) {
          out.push([r.company || r.title, dateRange(r.start, r.end)].filter(Boolean).join("  |  "));
          const sub = [r.company ? r.title : "", r.location].filter(Boolean).join(" · ");
          if (sub) out.push(sub);
          for (const b of r.bullets) if (b.text.trim()) out.push(`- ${b.text.trim()}`);
        }
        break;
      case "education":
        for (const e of content.education) {
          out.push([e.school, dateRange(e.start, e.end)].filter(Boolean).join("  |  "));
          const deg = e.degree && e.field ? `${e.degree} in ${e.field}` : e.degree || e.field || "";
          if (deg) out.push(deg);
        }
        break;
      case "projects":
        for (const p of content.projects) { if (!p.name) continue; out.push(p.name); for (const b of p.bullets) if (b.text.trim()) out.push(`- ${b.text.trim()}`); }
        break;
      case "certifications": for (const c of content.certifications ?? []) if (c.trim()) out.push(`- ${c.trim()}`); break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export type PdfExport = RenderedResume & { fileName: string };

/** Render the PDF and name it. Writes it to `dir` when given. */
export async function exportResumePdf(content: ResumeContent, opts: RenderOptions & { dir?: string } = {}): Promise<PdfExport> {
  const rendered = await renderResumePdf(content, opts);
  const fileName = `${resumeFileBase(content.name)}.pdf`;
  if (opts.dir) await writeFile(path.join(opts.dir, fileName), rendered.pdf);
  return { ...rendered, fileName };
}
