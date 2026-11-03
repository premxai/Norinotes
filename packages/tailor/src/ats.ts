import type { JobSpec } from "@norinote/shared";
import { STANDARD_HEADINGS } from "./template.js";
import { mentionsSkill, wordCount } from "./text.js";
import type { AtsCheck, AtsReport, ResumeContent } from "./types.js";

const MIN_WORDS = 8;
const MAX_WORDS = 30;
const PRONOUNS = /\b(I|me|my|mine|myself|we|our|ours|us)\b/;
/** Printable ASCII, Latin-1 letters, and common typographic punctuation (dashes, quotes, bullet, ellipsis). */
const SAFE_CHAR = /^[!-~\u00A1-\u00FF\u2010-\u2015\u2018-\u201F\u2022\u2026\u2122]$/;
const DATE_OK = /^(\d{4}(-\d{1,2})?|present|current)$/i;

/** All the text a parser will read, in order. */
export function contentText(c: ResumeContent): string {
  return [
    c.name, ...Object.values(c.contact), c.summary ?? "",
    ...c.skills.flatMap((g) => [g.group, ...g.items]),
    ...c.experience.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...c.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...c.education.flatMap((e) => [e.school, e.degree ?? "", e.field ?? ""]),
    ...(c.certifications ?? []),
  ].filter(Boolean).join("\n");
}

const short = (s: string, n = 48): string => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);

/** The skills a posting asks for, as keywords: required skills, else all skills, else its must-have phrases. */
export function postingKeywords(spec: JobSpec | null | undefined): string[] {
  if (!spec) return [];
  const required = spec.skills.filter((s) => s.required).map((s) => s.name);
  if (required.length) return required;
  if (spec.skills.length) return spec.skills.map((s) => s.name);
  return spec.mustHaves.filter((m) => wordCount(m) <= 3);
}

/**
 * Weighted ATS-readiness checks. The score is the passed weight over the applicable weight, 0..100. `html` is the
 * rendered document (to check headings and layout); `pages` comes from the renderer.
 */
export function atsChecks(content: ResumeContent, html: string, spec: JobSpec | null | undefined, pages?: number, maxPages = 1): AtsReport {
  const checks: AtsCheck[] = [];
  const add = (id: string, label: string, weight: number, pass: boolean, detail?: string) => checks.push({ id, label, weight, pass, ...(detail ? { detail } : {}) });

  const ct = content.contact;
  const missing = [!content.name.trim() && "name", !ct.email && "email", !(ct.phone || ct.linkedin) && "phone or LinkedIn"].filter(Boolean) as string[];
  add("contact", "Contact info present (name, email, phone or LinkedIn)", 10, missing.length === 0, missing.length ? `Missing ${missing.join(", ")}` : undefined);

  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
  const essentials = [content.experience.length ? "Experience" : "", content.education.length ? "Education" : "", content.skills.length ? "Skills" : ""].filter(Boolean);
  const absent = essentials.filter((h) => !h2s.includes(h));
  const unknown = h2s.filter((h) => !STANDARD_HEADINGS.has(h));
  add("headings", "Standard section headings", 10, absent.length === 0 && unknown.length === 0 && /<h1[\s>]/i.test(html),
    [absent.length ? `Missing ${absent.join(", ")}` : "", unknown.length ? `Non-standard: ${unknown.join(", ")}` : ""].filter(Boolean).join("; ") || undefined);

  const layout = [
    /<table[\s>]/i.test(html) && "table", /<img[\s>]/i.test(html) && "image", /<svg[\s>]/i.test(html) && "svg or icon",
    /column-count|columns\s*:|grid-template-columns|float\s*:\s*(left|right)/i.test(html) && "multi-column CSS", /background-image/i.test(html) && "background image",
  ].filter(Boolean) as string[];
  add("layout", "Single column, no tables, images or icons", 10, layout.length === 0, layout.length ? `Found ${layout.join(", ")}` : undefined);

  const bullets = [...content.experience.flatMap((r) => r.bullets), ...content.projects.flatMap((p) => p.bullets)].filter((b) => b.text.trim());
  const badLen = bullets.filter((b) => { const w = wordCount(b.text); return w < MIN_WORDS || w > MAX_WORDS; });
  add("bullet_length", `Bullets are ${MIN_WORDS} to ${MAX_WORDS} words`, 10, bullets.length > 0 && badLen.length === 0,
    bullets.length === 0 ? "No bullets" : badLen.length ? `${badLen.length} outside range, e.g. "${short(badLen[0]!.text)}" (${wordCount(badLen[0]!.text)} words)` : undefined);

  const badDates = content.experience.filter((r) => !(r.start && DATE_OK.test(r.start.trim())) || (r.end ? !DATE_OK.test(r.end.trim()) : false));
  add("dates", "Parseable dates on every role", 10, content.experience.length > 0 && badDates.length === 0,
    content.experience.length === 0 ? "No experience" : badDates.length ? `Missing or unparseable dates: ${badDates.map((r) => r.company || r.title).join(", ")}` : undefined);

  const keywords = postingKeywords(spec);
  let keywordCoverage: number | null = null;
  if (keywords.length > 0) {
    const text = contentText(content);
    const present = keywords.filter((k) => mentionsSkill(text, k));
    keywordCoverage = Math.round((present.length / keywords.length) * 100);
    const lacking = keywords.filter((k) => !present.includes(k));
    add("keywords", "Covers at least 70% of the posting's required skills", 15, keywordCoverage >= 70,
      `${present.length}/${keywords.length} (${keywordCoverage}%)${lacking.length ? `; missing ${lacking.slice(0, 5).join(", ")}` : ""}`);
  }

  if (typeof pages === "number") add("one_page", maxPages === 1 ? "Fits on one page" : `Fits within ${maxPages} pages`, 15, pages <= maxPages, `${pages} page${pages === 1 ? "" : "s"}`);

  const pron = [content.summary ?? "", ...bullets.map((b) => b.text)].find((t) => PRONOUNS.test(t.replace(/\bU\.?S\.?\b/g, "")));
  add("pronouns", "No first-person pronouns", 5, !pron, pron ? `"${short(pron)}"` : undefined);

  const bad = [...new Set([...contentText(content)].filter((ch) => /\S/.test(ch) && !SAFE_CHAR.test(ch)))];
  add("characters", "Plain, parser-safe characters", 5, bad.length === 0, bad.length ? `Unusual: ${bad.slice(0, 8).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}` : undefined);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const passed = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  return { score: total ? Math.round((passed / total) * 100) : 0, keywordCoverage, checks };
}
