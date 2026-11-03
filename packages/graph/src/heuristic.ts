/**
 * Deterministic resume parser: sections, role headers with date ranges, bullets, skill lists. It is the fallback when
 * the model's output is invalid, so a resume still yields career points. It never invents anything: every point carries
 * the resume line it came from.
 */
import { certificationsFromSections, type CertSections } from "./certifications.js";
import { findSkills, normalizeSkills } from "./skills.js";
import {
  DATE_RANGE, extractMetrics, extractScope, isPresent, normalizeDate, sectionOf, type Metric, type Section,
} from "./text.js";

export type PointKind = "role" | "project" | "achievement" | "education" | "skill" | "certification";

/** A career point before it is stored. Skills are canonical; `metrics` hold numbers and what they measure. */
export type DraftPoint = {
  kind: PointKind;
  title: string;
  org: string | null;
  startDate: string | null;
  endDate: string | null;
  text: string;
  skills: string[];
  scope: Record<string, unknown>;
  metrics: Metric[];
  sourceQuote: string | null;
};

const BULLET = /^\s*(?:[•·●▪■◦‣▸►○∙]\s*|[-–—*]\s+)(.+?)\s*$/;
const TITLE_RE = /\b(engineer(?:ing)?|developer|programmer|manager|director|analyst|designer|scientist|lead|intern|internship|consultant|architect|specialist|associate|officer|president|vp|vice president|head|founder|co-founder|cto|ceo|coo|cfo|coordinator|representative|executive|administrator|technician|strategist|researcher|recruiter|accountant|owner|principal|staff|senior|junior|sr\.?|jr\.?|assistant|advisor|writer|editor|marketer|agent|trainee|apprentice|fellow|teacher|instructor|professor|sales|swe|sde|devops|sre|tester|qa|admin|partner|supervisor|generalist)\b/i;
const COMPANY_HINT = /\b(?:inc|llc|ltd|limited|corp|corporation|company|gmbh|plc|pvt|labs?|technologies|group|holdings|bank|studios?|ventures|solutions|university|hospital|agency)\b\.?/i;
const EMPLOYMENT_PART = /^\(?(?:intern(?:ship)?|contract(?:or)?|freelance|part[- ]time|full[- ]time|temporary|temp|apprentice(?:ship)?|seasonal|permanent|self[- ]employed)\)?$/i;
const LOCATION_PART = /^(?:remote|hybrid|on-?site)(?:\s*\(.*\))?$|^[A-Z][A-Za-z.' ]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)*)$/;
const SEP_RE = /\s[|•·—–-]\s/;
const DEGREE_RE = /\b(?:bachelor|master|doctor|ph\.?d|b\.?s\.?c?|b\.?a\.?|b\.?e\.?|b\.?tech|m\.?s\.?c?|m\.?a\.?|m\.?tech|mba|diploma|associate|certificate|certification|high school|degree)\b/i;
const SCHOOL_RE = /\b(?:university|college|institute|school|academy|polytechnic)\b/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const stripEdges = (s: string) => s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/g, "");

type Header = { title: string; org: string | null; start: string | null; end: string | null; raw: string };

function parseHeader(rawLines: string[]): Header {
  const raw = rawLines.join(" | ");
  let s = raw;
  let start: string | null = null, end: string | null = null;
  const m = DATE_RANGE.exec(s);
  if (m) {
    start = normalizeDate(m[1]);
    end = isPresent(m[2]) ? null : normalizeDate(m[2]);
    s = s.replace(m[0], " | ");
  }
  let parts = s.split(/\s*[|•·]\s*|\s+[—–]\s+|\s+-\s+|\s{3,}/).map((p) => stripEdges(clean(p))).filter(Boolean);
  parts = parts.flatMap((p) => {
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(p);
    return at && TITLE_RE.test(at[1]!) ? [at[1]!, at[2]!] : [p];
  });
  if (parts.length === 1) {
    const c = parts[0]!.split(/\s*,\s*/);
    if (c.length >= 2 && TITLE_RE.test(c[0]!) && !TITLE_RE.test(c[1]!)) parts = [c[0]!, c.slice(1).join(", ")];
  }
  parts = parts.filter((p) => !EMPLOYMENT_PART.test(p) && !LOCATION_PART.test(p));
  // The title is the part with the most title words; company hints ("Inc", "Labs") count against it.
  let ti = 0, best = -Infinity;
  const words = new RegExp(TITLE_RE.source, "gi");
  parts.forEach((p, i) => {
    const n = p.match(words)?.length ?? 0;
    const score = n * 2 - (COMPANY_HINT.test(p) ? 3 : 0) - i * 0.1;
    if (n > 0 && score > best) { best = score; ti = i; }
  });
  const title = parts[ti] ?? "";
  const org = parts.find((p, i) => i !== ti && !/^\d+$/.test(p)) ?? null;
  return { title: clean(title), org: org ? clean(org) : null, start, end, raw: rawLines.join(" ") };
}

function looksLikeHeader(line: string): boolean {
  if (DATE_RANGE.test(line)) return true;
  if (line.length <= 90 && !/[.;]$/.test(line) && (SEP_RE.test(line) || (/\s(?:at|@)\s/.test(line) && TITLE_RE.test(line)))) return true;
  return line.length <= 60 && /^[A-Z]/.test(line) && TITLE_RE.test(line) && !/[.;,]$/.test(line);
}

type Block = { header: Header; bullets: string[]; quotes: string[] };

/** Group lines into entries: a header (title, organisation, dates) followed by bullets. Used for experience and projects. */
function parseEntries(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let pending: string[] = [];
  let cur = null as Block | null;
  let hasLast = false;
  const flush = () => {
    if (!pending.length) return;
    const header = parseHeader(pending);
    pending = [];
    hasLast = false;
    if (!header.title) return;
    cur = { header, bullets: [], quotes: [] };
    blocks.push(cur);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) {
      if (pending.length) flush();
      if (!cur) continue;
      cur.bullets.push(clean(b[1]!));
      cur.quotes.push(line);
      hasLast = true;
      continue;
    }
    const hasRange = DATE_RANGE.test(line);
    if (cur && hasLast && !pending.length && !looksLikeHeader(line)) {
      const last = cur.bullets.length - 1;
      cur.bullets[last] = clean(`${cur.bullets[last]} ${line}`);
      cur.quotes[last] = `${cur.quotes[last]} ${line}`.trim();
      continue;
    }
    if (hasRange && pending.some((p) => DATE_RANGE.test(p))) flush();
    if (pending.length >= 3) flush();
    const prose = line.length > 110 || line.split(/\s+/).length > 14;
    if (prose && !hasRange && pending.length) flush();
    if (cur && !hasLast && !pending.length && prose) {
      cur.bullets.push(clean(line));
      cur.quotes.push(line);
      hasLast = true;
      continue;
    }
    if (prose && !hasRange) continue;
    pending.push(line);
  }
  flush();
  return blocks;
}

const uniqMetrics = (ms: Metric[]) => {
  const seen = new Set<string>();
  return ms.filter((m) => { const k = `${m.value}${m.unit}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
};

function entryToPoints(kind: "role" | "project", b: Block): DraftPoint[] {
  const text = b.bullets.map((x) => `• ${x}`).join("\n");
  const all = `${b.header.title} ${text}`;
  const scope: Record<string, unknown> = {};
  for (const bullet of b.bullets) for (const [k, v] of Object.entries(extractScope(bullet))) if (!(k in scope)) scope[k] = v;
  const points: DraftPoint[] = [{
    kind,
    title: b.header.title,
    org: b.header.org,
    startDate: b.header.start,
    endDate: b.header.end,
    text: text || b.header.raw,
    skills: findSkills(all),
    scope,
    metrics: uniqMetrics(b.bullets.flatMap(extractMetrics)),
    sourceQuote: b.header.raw,
  }];
  // A bullet with a number is worth its own point: "cut p95 latency 40%" is what a recruiter reads.
  b.bullets.forEach((bullet, i) => {
    const metrics = extractMetrics(bullet);
    if (!metrics.length) return;
    points.push({
      kind: "achievement",
      title: bullet.length > 80 ? `${bullet.slice(0, 77).trimEnd()}...` : bullet,
      org: b.header.org,
      startDate: b.header.start,
      endDate: b.header.end,
      text: bullet,
      skills: findSkills(bullet),
      scope: extractScope(bullet),
      metrics,
      sourceQuote: b.quotes[i] ?? bullet,
    });
  });
  return points;
}

function parseProjects(lines: string[]): DraftPoint[] {
  // Projects usually are "Name | Stack (dates)" followed by bullets; lines with no title word still count as headers here.
  const out: DraftPoint[] = [];
  let cur = null as { name: string; raw: string; bullets: string[]; quotes: string[] } | null;
  const done = () => {
    if (!cur) return;
    const header = parseHeader([cur.raw]);
    const text = cur.bullets.map((x) => `• ${x}`).join("\n");
    const name = clean(stripEdges(cur.raw.replace(DATE_RANGE, " ").split(/\s[|—–-]\s|:\s/)[0] ?? cur.name)) || cur.name;
    const year = header.start ? null : normalizeDate(/\b(?:19|20)\d{2}\b/.exec(cur.raw)?.[0]);
    out.push({
      kind: "project", title: name, org: null, startDate: header.start ?? year, endDate: header.start ? header.end : year, text: text || cur.raw,
      skills: findSkills(`${cur.raw} ${text}`), scope: {}, metrics: uniqMetrics(cur.bullets.flatMap(extractMetrics)), sourceQuote: cur.raw,
    });
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b && cur) { cur.bullets.push(clean(b[1]!)); cur.quotes.push(line); continue; }
    if (b) continue;
    if (cur && cur.bullets.length === 0 && line.length > 90) { cur.bullets.push(clean(line)); cur.quotes.push(line); continue; }
    if (cur && cur.bullets.length > 0 && !looksLikeHeader(line) && line.length > 40 && !/^[A-Z][\w .&'-]{0,40}\s[|:–—-]/.test(line)) {
      const last = cur.bullets.length - 1;
      cur.bullets[last] = clean(`${cur.bullets[last]} ${line}`);
      continue;
    }
    done();
    cur = { name: clean(line), raw: line, bullets: [], quotes: [] };
  }
  done();
  return out;
}

function parseEducation(lines: string[]): DraftPoint[] {
  const out: DraftPoint[] = [];
  let group: string[] = [];
  const flush = () => {
    if (!group.length) return;
    const raw = group.join(" ");
    group = [];
    const range = DATE_RANGE.exec(raw);
    const year = /\b((?:19|20)\d{2})\b/.exec(raw)?.[1] ?? null;
    const body = clean(raw.replace(DATE_RANGE, " ").replace(/\b(?:GPA|CGPA)\b[^|,;]*/i, " "));
    const parts = body.split(/\s*[|•·]\s*|\s+[—–]\s+|\s+-\s+|\s{2,}|,\s+(?=[A-Z])/).map((p) => stripEdges(clean(p))).filter(Boolean);
    const school = parts.find((p) => SCHOOL_RE.test(p)) ?? null;
    const degree = parts.find((p) => p !== school && DEGREE_RE.test(p)) ?? parts.find((p) => p !== school) ?? school;
    if (!degree) return;
    out.push({
      kind: "education", title: degree, org: school === degree ? null : school,
      startDate: range ? normalizeDate(range[1]) : null,
      endDate: range ? (isPresent(range[2]) ? null : normalizeDate(range[2])) : normalizeDate(year),
      text: raw, skills: findSkills(raw), scope: {}, metrics: [], sourceQuote: raw,
    });
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const b = BULLET.exec(line);
    if (b && group.length) { group.push(clean(b[1]!)); continue; }
    if (group.length && (SCHOOL_RE.test(line) || DEGREE_RE.test(line)) && group.some((g) => SCHOOL_RE.test(g) || DEGREE_RE.test(g)) && /(?:19|20)\d{2}/.test(group.join(" "))) flush();
    group.push(clean(b ? b[1]! : line));
  }
  flush();
  return out;
}

function parseSkillLines(lines: string[]): DraftPoint[] {
  const out: DraftPoint[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) line = b[1]!;
    const cat = /^([A-Za-z][A-Za-z &/+#.-]{1,35}):\s*(.+)$/.exec(line);
    const label = cat?.[1] ? clean(cat[1]) : "Skills";
    const body = cat?.[2] ?? line;
    const items = body.split(/\s*[,;|•·]\s*|\s{2,}/).map((i) => clean(i).replace(/\([^)]*\)\s*$/, "").replace(/[.:]+$/, "")).filter((i) => i && i.length <= 40 && /[A-Za-z]/.test(i));
    const skills = normalizeSkills([...findSkills(body, { list: true }), ...items.filter((i) => i.split(" ").length <= 3)]);
    if (!skills.length) continue;
    out.push({ kind: "skill", title: label, org: null, startDate: null, endDate: null, text: skills.join(", "), skills, scope: {}, metrics: [], sourceQuote: raw.trim() });
  }
  return out;
}

function splitSections(text: string): Map<Section | "head", string[]> {
  const sections = new Map<Section | "head", string[]>();
  let current: Section | "head" = "head";
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const sec = sectionOf(line);
    if (sec) { current = sec; if (!sections.has(sec)) sections.set(sec, []); continue; }
    const bucket = sections.get(current) ?? [];
    bucket.push(line);
    sections.set(current, bucket);
  }
  return sections;
}

/** A resume's lines split for the certification finder: the licences section apart from every other section. */
export function certificationSections(text: string): CertSections {
  const sections = splitSections(text);
  return {
    certifications: sections.get("certifications") ?? [],
    others: [...sections.entries()].filter(([k]) => k !== "certifications").map(([k, lines]) => ({ lines, head: k === "head" })),
  };
}

/** Parse resume text into draft career points without a model. */
export function heuristicPoints(text: string): DraftPoint[] {
  const sections = splitSections(text);
  const points: DraftPoint[] = [];
  const exp = sections.get("experience") ?? [];
  for (const b of parseEntries(exp)) points.push(...entryToPoints("role", b));
  points.push(...parseProjects(sections.get("projects") ?? []));
  for (const b of parseEntries(sections.get("volunteer") ?? [])) points.push(...entryToPoints("role", b));
  points.push(...parseEducation(sections.get("education") ?? []));
  // Licences, certifications and clinical cards: the licences section, then credentials named anywhere else in the text.
  points.push(...certificationsFromSections(certificationSections(text)));
  points.push(...parseSkillLines(sections.get("skills") ?? []));
  return points;
}
