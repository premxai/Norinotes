import type { Job, Match } from "@/lib/types";

/** "Vercel" -> "VE", "Lumen Analytics" -> "LA". */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export type WorkMode = "Remote" | "Hybrid" | "On-site";

/** Greenhouse-style locations carry the mode as a prefix ("Hybrid - London"). */
export function workMode(job: Pick<Job, "location" | "remote">): WorkMode {
  const loc = (job.location ?? "").toLowerCase();
  if (/^\s*hybrid\b/.test(loc) || /\bhybrid\b/.test(loc)) return "Hybrid";
  if (job.remote || /^\s*remote\b/.test(loc) || /\bremote\b/.test(loc)) return "Remote";
  return "On-site";
}

/** Location without the mode prefix; null when nothing is left. */
export function placeName(location: string | null): string | null {
  if (!location) return null;
  const s = location.replace(/^\s*(hybrid|remote|on-?site)\s*[-–:·,]?\s*/i, "").trim();
  return s || null;
}

const SENIORITY: Record<string, string> = {
  intern: "Intern", entry: "Entry", junior: "Junior", mid: "Mid", senior: "Senior", lead: "Lead",
  staff: "Staff", principal: "Principal", manager: "Manager", director: "Director", executive: "Executive",
};
export const SENIORITY_ORDER = ["intern", "entry", "junior", "mid", "senior", "staff", "lead", "principal", "manager", "director", "executive"];

export function seniorityKey(job: Pick<Job, "requirements">): string | null {
  const s = job.requirements?.seniority?.toLowerCase();
  return s && s !== "unknown" ? s : null;
}
export const seniorityLabel = (k: string) => SENIORITY[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

const SOURCES: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", workday: "Workday", oracle: "Oracle", url: "Web" };
export const sourceLabel = (ats: string) => SOURCES[ats.toLowerCase()] ?? ats.charAt(0).toUpperCase() + ats.slice(1);

export type SkillChip = { name: string; matched: boolean; required: boolean };

/**
 * Up to `max` short skill names from the match explanation: matched first (up to 3), then missing,
 * then any remaining matched. Long requirement sentences are skipped; they read badly as chips.
 */
export function skillChips(match: Match | null, max = 5): SkillChip[] {
  if (!match) return [];
  const seen = new Set<string>();
  const short = (s: string) => s.length <= 24 && s.split(/\s+/).length <= 3;
  const take = (arr: { requirement: string; required: boolean }[], matched: boolean) =>
    arr
      .filter((r) => short(r.requirement))
      .sort((a, b) => Number(b.required) - Number(a.required))
      .filter((r) => {
        const k = r.requirement.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((r) => ({ name: r.requirement, matched, required: r.required }));
  const matched = take(match.explanation.matched, true);
  const missing = take(match.explanation.missing, false);
  const out = [...matched.slice(0, 3), ...missing].slice(0, max);
  for (const m of matched.slice(3)) if (out.length < max) out.push(m);
  return out.sort((a, b) => Number(b.matched) - Number(a.matched));
}

export const postedIso = (job: Pick<Job, "postedAt" | "firstSeenAt">) => job.postedAt ?? job.firstSeenAt;

// ---------- board filters (URL <-> state) ----------
export type BoardFilters = {
  q: string;
  min: number;
  remote: boolean;
  seniority: string[];
  sources: string[];
  hideApplied: boolean;
};
export const DEFAULT_FILTERS: BoardFilters = { q: "", min: 0, remote: false, seniority: [], sources: [], hideApplied: false };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const list = (v: string | string[] | undefined) => first(v).split(",").map((s) => s.trim()).filter(Boolean);

export function parseFilters(sp: SP): BoardFilters {
  const min = Number(first(sp.min) || first(sp.minScore));
  return {
    q: first(sp.q),
    min: Number.isFinite(min) ? Math.max(0, Math.min(100, Math.round(min))) : 0,
    remote: first(sp.remote) === "1",
    seniority: list(sp.sen),
    sources: list(sp.src),
    hideApplied: first(sp.hide) === "1" || first(sp.status) === "new",
  };
}

export function filtersToParams(f: BoardFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.min) p.set("min", String(f.min));
  if (f.remote) p.set("remote", "1");
  if (f.seniority.length) p.set("sen", f.seniority.join(","));
  if (f.sources.length) p.set("src", f.sources.join(","));
  if (f.hideApplied) p.set("hide", "1");
  return p;
}

export const activeFilterCount = (f: BoardFilters) =>
  (f.q ? 1 : 0) + (f.min ? 1 : 0) + (f.remote ? 1 : 0) + f.seniority.length + f.sources.length + (f.hideApplied ? 1 : 0);

// ---------- job views (server-fetched; tabs are links) ----------
/** Best match (lanes on), Newest (everything open, newest first) and New today (last 24 hours). */
export type JobsView = "best" | "new" | "today";
export const JOB_VIEWS: { id: JobsView; label: string }[] = [
  { id: "best", label: "Best match" },
  { id: "new", label: "Newest" },
  { id: "today", label: "New today" },
];
/** URL params that belong to the view, not the board filters. */
export const VIEW_PARAMS = ["view", "clearance", "older"] as const;
export const CLEARANCE_STORAGE_KEY = "norinote.jobs.hideClearance";

export type ViewState = { view: JobsView; hideClearance: boolean; older: boolean };

export function parseView(sp: SP): ViewState {
  const v = first(sp.view);
  const view: JobsView = v === "new" || v === "today" || v === "best" ? v : first(sp.sort) === "new" ? "new" : "best"; // ?sort=new is the old link
  return { view, hideClearance: first(sp.clearance) === "hide", older: view !== "today" && first(sp.older) === "1" };
}

/** Query for the view alone, leaving out values that are the default so the URL stays short. */
export function viewToParams(s: ViewState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.view !== "best") p.set("view", s.view);
  if (s.hideClearance) p.set("clearance", "hide");
  if (s.older) p.set("older", "1");
  return p;
}
