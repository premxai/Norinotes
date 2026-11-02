"use client";

import { resumePdfUrl, USE_MOCK } from "@/lib/api";
import type { Resume, ResumeContent } from "@/lib/types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal HTML rendering of a resume, used only when the API is mocked (no PDF exists). */
function mockHtml(c: ResumeContent): string {
  const contact = Object.values(c.contact).filter(Boolean).map((x) => esc(String(x))).join(" | ");
  const exp = c.experience
    .map(
      (e) => `<h3>${esc(e.title)}, ${esc(e.company)} <span>${esc(e.start ?? "")} - ${esc(e.end ?? "")}</span></h3><ul>${e.bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul>`,
    )
    .join("");
  const edu = c.education.map((e) => `<p>${esc(e.school)}: ${esc(e.degree ?? "")} ${esc(e.field ?? "")} <span>${esc(e.start ?? "")} - ${esc(e.end ?? "")}</span></p>`).join("");
  const skills = c.skills.map((s) => `<p><b>${esc(s.group)}:</b> ${s.items.map(esc).join(", ")}</p>`).join("");
  return `<!doctype html><html><body style="font:12px/1.45 Georgia,serif;margin:0;padding:32px 36px;color:#141311;background:#fffdf9">
  <h1 style="margin:0;font-size:22px">${esc(c.name)}</h1><div style="color:#555;margin-bottom:8px">${contact}</div>
  ${c.summary ? `<p>${esc(c.summary)}</p>` : ""}
  <h2 style="font-size:13px;border-bottom:1px solid #999;margin:12px 0 4px">EXPERIENCE</h2>${exp}
  <h2 style="font-size:13px;border-bottom:1px solid #999;margin:12px 0 4px">EDUCATION</h2>${edu}
  <h2 style="font-size:13px;border-bottom:1px solid #999;margin:12px 0 4px">SKILLS</h2>${skills}
  <style>h3{font-size:12px;margin:8px 0 2px;display:flex;justify-content:space-between}h3 span,p span{font-weight:normal;color:#555}ul{margin:2px 0 0 16px;padding:0}li{margin-bottom:2px}p{margin:2px 0}</style>
  </body></html>`;
}

export function ResumePreview({ resume, className }: { resume: Resume; className?: string }) {
  const common = `block w-full bg-[#fffdf9] ${className ?? "h-[480px] sm:h-[620px]"}`;
  if (USE_MOCK) {
    return <iframe title="Resume preview (mock)" srcDoc={mockHtml(resume.content)} className={common} />;
  }
  return <iframe title="Resume PDF" src={`${resumePdfUrl(resume.id)}#toolbar=0&navpanes=0&view=FitH`} className={common} />;
}
