"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api, type AppStatus, type Application, type EmploymentType, type Job, type JobListItem, type JobPay, type PreviewQuestion, type Workplace } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { usePanel } from "./AppShell";
import { CompanyLogo } from "./CompanyLogo";
import { STATUS_LABEL, statusLabel } from "./LivePanel";
import { PageHead } from "./PageHead";
import { StatusChip, type ChipTone } from "./v2/StatusChip";

/*
 * /jobs: the open jobs, searchable, beside the one you picked (dashboard v2, "2 Jobs" boards, desktop and phone).
 * Everything shown is the API's: GET /jobs (All: every open job from the last 3 days, newest first; Recommended: those
 * that fit your searches, best fit first; Saved: the ones you saved), GET /applications (Applied), GET /jobs/:id (the
 * job, what it asks for, the company and your fit), GET /jobs/:id/preview (Review: the form's questions and what Nori
 * would put in, read only when you open that tab) and GET /jobs/locations (the places to filter by). Pay, job type
 * and workplace show only when the listing states them. From 880 px of page width the list and the job sit side by
 * side (measured, so the live panel narrowing the page counts too; ListDetail's 1024 px viewport switch can't see it);
 * narrower, the list comes first and a job opens on its own screen.
 */

type Tab = "all" | "recommended" | "saved" | "applied";
type DTab = "overview" | "company" | "insights" | "review";
const LIMIT = 100;
const WIDE = 880;
const MOVING: AppStatus[] = ["queued", "preparing", "applying", "awaiting_code"];

const TABS: [Tab, string, string][] = [
  ["all", "All", "M3.5 5.5h13M3.5 10h13M3.5 14.5h13"],
  ["recommended", "Recommended", "M10 2.5l1.8 5.2 5.2 1.8-5.2 1.8L10 16.5l-1.8-5.2L3 9.5l5.2-1.8z"],
  ["saved", "Saved", "M5.5 3h9v14l-4.5-3.2L5.5 17z"],
  ["applied", "Applied", "M10 2.8a7.2 7.2 0 1 1 0 14.4a7.2 7.2 0 0 1 0-14.4zM6.8 10.2l2.2 2.2 4.2-4.4"],
];
const DTABS: [DTab, string, string][] = [
  ["overview", "Overview", "M5 3h10v14H5zM8 7h4M8 10h4M8 13h2.5"],
  ["company", "Company", "M3.5 17h13M5 17V4.5h6V17M11 8h4v9M7.5 7.5h1M7.5 10.5h1M7.5 13.5h1"],
  ["insights", "Insights", "M4 16v-4M8.5 16V8M13 16V5M17.5 16v-6"],
  ["review", "Review", "M6 3h8l2 2v12H4V3zM7 9l2 2 4-4M7 14h6"],
];

/** Pay as the listing states it ("$180k – $260k / year"), or null when it doesn't: never estimated. */
const CURRENCY: Record<JobPay["currency"], string> = { USD: "$", CAD: "CA$", EUR: "€", GBP: "£" };
function payText(pay: JobPay | null | undefined) {
  if (!pay || (pay.min === null && pay.max === null)) return null;
  const sym = CURRENCY[pay.currency] ?? `${pay.currency} `;
  const one = (n: number) => (pay.period === "year" && n >= 1000 ? `${sym}${fmt(Math.round(n / 1000))}k` : `${sym}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  const range = pay.min !== null && pay.max !== null && pay.min !== pay.max ? `${one(pay.min)} – ${one(pay.max)}` : pay.min !== null && pay.max === null ? `From ${one(pay.min)}` : pay.max !== null && pay.min === null ? `Up to ${one(pay.max)}` : one((pay.min ?? pay.max)!);
  return `${range} / ${pay.period}`;
}
const EMPLOYMENT: Record<EmploymentType, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary" };
const WORKPLACE: Record<Workplace, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On site" };
/** The listing's own tags: job type, then where the work happens (Remote only once, not when the place says it). */
function listingTags(job: Job, place: string) {
  const tags: string[] = [];
  if (job.employmentType && EMPLOYMENT[job.employmentType]) tags.push(EMPLOYMENT[job.employmentType]);
  if (job.workplace && WORKPLACE[job.workplace]) {
    if (!(job.workplace === "remote" && /remote/i.test(place))) tags.push(WORKPLACE[job.workplace]);
  } else if (remoteTag(job, place)) tags.push("Remote");
  return tags;
}
const TONE: Record<AppStatus, ChipTone> = { queued: "waiting", preparing: "working", prepared: "waiting", applying: "working", awaiting_code: "waiting", needs_user: "needs", submitted: "done", failed: "bad" };
/** The application systems' own names (jobs.ats_type). */
const ATS: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", workable: "Workable", icims: "iCIMS", jobvite: "Jobvite", bamboohr: "BambooHR", recruitee: "Recruitee", teamtailor: "Teamtailor" };
const atsName = (t: string | undefined) => (t ? (ATS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)) : null);

const fmt = (n: number) => n.toLocaleString("en-US");
function ago(job: Job) {
  const iso = job.postedAt ?? job.firstSeenAt ?? null;
  if (!iso) return null;
  const h = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3_600_000));
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
/** Where: the posting's place, Remote when it has none, and how many more places the same role is posted in. */
function placeOf(job: Job, names: string[] = []) {
  const first = job.location ?? names[0] ?? (job.remote ? "Remote" : "");
  const more = names.filter((n) => n !== first).length;
  return { first, more };
}

/** Some boards send descriptions with HTML entities left in (&#39;, &amp;): shown as the characters they stand for. */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•" };
const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  });
/** A Remote tag only when the place doesn't already say so ("US Remote"). */
const remoteTag = (job: Job, place: string) => !!job.remote && !/remote/i.test(place);

type Row = { job: Job; fit: number | null; status: AppStatus | null; places: string[]; widened: boolean; saved: boolean };

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="flex-none">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BOOKMARK = "M5.5 3h9v14l-4.5-3.2L5.5 17z";
const REMOTE = "remote";
const PIN = "M10 18s6-5.2 6-10a6 6 0 0 0-12 0c0 4.8 6 10 6 10zM10 5.8a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 0 1 0-4.4z";

/** Tabs with arrow keys, Home and End (WAI-ARIA tabs pattern); the panel is the caller's, labelled by the current tab. */
function Tabs<T extends string>({ label, items, current, onPick, ids, small = false }: { label: string; items: [T, string, string][]; current: T; onPick: (t: T) => void; ids: { tab: (t: T) => string; panel: string }; small?: boolean }) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const id = items[to]?.[0];
    if (!id) return;
    onPick(id);
    refs.current.get(id)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`flex overflow-x-auto shadow-[inset_0_-1.5px_0_var(--color-line)] [scrollbar-width:none] ${small ? "gap-2 tablet:gap-4" : "gap-1 tablet:gap-2"}`}>
      {items.map(([id, text, icon], i) => {
        const on = id === current;
        return (
          <button
            key={id}
            ref={(el) => void (el ? refs.current.set(id, el) : refs.current.delete(id))}
            type="button"
            role="tab"
            id={ids.tab(id)}
            aria-selected={on}
            aria-controls={ids.panel}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`flex min-h-11 flex-none items-center gap-2 border-b-[3px] px-2.5 tablet:px-3.5 ${small ? "text-[0.9375rem]" : "text-[0.9375rem] tablet:text-[1.0625rem]"} ${on ? "border-accent font-semibold text-ink" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}
          >
            <Icon d={icon} size={small ? 16 : 18} />
            {text}
          </button>
        );
      })}
    </div>
  );
}

function Tag({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <li className={`rounded-lg border-[1.5px] px-2.5 py-0.5 text-[0.8125rem] font-medium ${strong ? "border-transparent bg-accent-tint text-accent" : "border-line text-ink"}`}>{children}</li>;
}

/** One job in the list: logo, title and when it was posted, company and place, then tags. The picked one is tinted. */
function JobRow({ row, current, onPick }: { row: Row; current: boolean; onPick: (el: HTMLButtonElement) => void }) {
  const { job } = row;
  const { first, more } = placeOf(job, row.places);
  const when = ago(job);
  const pay = payText(job.pay);
  const tags = listingTags(job, first);
  return (
    <li>
      <button
        type="button"
        data-job={job.id}
        aria-current={current ? "true" : undefined}
        onClick={(e) => onPick(e.currentTarget)}
        className={`flex w-full gap-3.5 rounded-[14px] border-[1.5px] p-3.5 text-left tablet:pl-4 ${current ? "border-accent bg-accent-tint" : "border-line bg-surface hover:border-line-strong"}`}
      >
        <CompanyLogo name={job.companyName} url={job.companyLogoUrl} box="size-11 rounded-xl text-[1.125rem] tablet:size-12" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2.5">
            <span className="min-w-0 flex-1 text-[1.0625rem] leading-[1.25] font-semibold tracking-[-0.01em] text-ink tablet:text-[1.125rem]">{job.title}</span>
            {when && <span className="flex-none text-[0.8125rem] text-ink-2">{when}</span>}
          </span>
          <span className="text-small text-ink">
            {job.companyName}
            {first && (
              <>
                <span aria-hidden="true"> &nbsp;•&nbsp; </span>
                <span className="sr-only">, </span>
                {first}
                {more > 0 && <span className="text-ink-2"> and {more} more</span>}
              </>
            )}
          </span>
          {pay && <span className="text-small text-ink">{pay}</span>}
          {(row.fit !== null || row.status || tags.length > 0 || row.widened || row.saved || job.closedAt) && (
            <ul aria-label="Tags" className="mt-1.5 flex flex-wrap items-center gap-2">
              {row.fit !== null && <Tag strong>Fit {row.fit.toFixed(2)}</Tag>}
              {tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
              {row.widened && <Tag>Similar role</Tag>}
              {job.closedAt && <Tag>Closed</Tag>}
              {row.saved && <Tag>Saved</Tag>}
              {row.status && (
                <li>
                  <StatusChip tone={TONE[row.status]} className="h-6 px-2.5">
                    {STATUS_LABEL[row.status]}
                  </StatusChip>
                </li>
              )}
            </ul>
          )}
        </span>
      </button>
    </li>
  );
}

const CHECK = (
  <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true" className="mt-px flex-none">
    <circle cx="11" cy="11" r="10" className="fill-accent" />
    <path d="M6.5 11.2l3 3 6-6.2" fill="none" className="stroke-on-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Bullets = ({ items, check = false }: { items: string[]; check?: boolean }) => (
  <ul className="flex flex-col gap-1.5 text-[0.9375rem] leading-[1.5] text-ink">
    {items.map((t) => (
      <li key={t} className="flex gap-3">
        {check ? CHECK : <span aria-hidden="true" className="mt-[7px] size-2 flex-none rounded-full bg-accent/45" />}
        <span>{t}</span>
      </li>
    ))}
  </ul>
);
const Section = ({ title, children, first = false }: { title: string; children: ReactNode; first?: boolean }) => (
  <section className={`flex flex-col gap-2 py-4 ${first ? "" : "border-t-[1.5px] border-line"}`}>
    <h3 className="text-[1.0625rem] font-semibold text-ink tablet:text-[1.1875rem]">{title}</h3>
    {children}
  </section>
);

/** Where a ready answer comes from, in the person's words (the answers package's sources). */
const SOURCE: Record<string, string> = { profile: "from your profile", eeo: "from your profile", decline: "you chose not to say", answers: "from your answers", bank: "from your saved answers", model: "written from your career graph", large: "written from your career graph" };
const MARK: Record<PreviewQuestion["status"], { sr: string; cls: string; d: string }> = {
  ready: { sr: "Ready", cls: "bg-accent text-on-accent", d: "M5.5 10.2l3 3 6-6.2" },
  ask: { sr: "Nori will ask you", cls: "bg-warning-tint text-warning", d: "M7.6 7.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M10 15h.01" },
  skip: { sr: "Left empty", cls: "bg-tint text-ink-2", d: "M6.5 10h7" },
};

/** Review: the form's questions and what Nori would put in (GET /jobs/:id/preview), or why it can't read the form yet. */
function ReviewPanel({ id }: { id: string }) {
  const preview = usePolling(`job-preview:${id}`, () => api.jobPreview(id), 900_000);
  const p = preview.data;
  if (!p) {
    return <p className="pt-4 text-[0.9375rem] text-ink-2">{preview.error && preview.status !== 401 ? (preview.status === 429 ? preview.error : "Couldn’t read the application form just now. Try again in a minute.") : "Reading the application form…"}</p>;
  }
  if (!p.available) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <h3 className="text-[1.0625rem] font-semibold text-ink tablet:text-[1.1875rem]">What Nori would send</h3>
        <p className="text-[0.9375rem] leading-[1.55] text-ink">{p.reason}</p>
      </div>
    );
  }
  const { counts } = p;
  return (
    <div className="flex flex-col gap-3 pt-4">
      <h3 className="text-[1.0625rem] font-semibold text-ink tablet:text-[1.1875rem]">What Nori would send</h3>
      <p className="text-[0.9375rem] text-ink-2">
        {counts.ready} of {counts.total} {counts.total === 1 ? "question" : "questions"} Nori can answer from what it knows
        {counts.ask > 0 && `; it would ask you ${counts.ask}`}. Your resume is tailored when you press Apply.
      </p>
      <ul aria-label="The form’s questions" className="flex flex-col gap-2">
        {p.questions.map((q) => {
          const m = MARK[q.status];
          const how = q.status === "ready" ? [q.answer, q.source ? SOURCE[q.source] : null].filter(Boolean).join(" · ") : q.status === "ask" ? "Nori will ask you" : "Optional, left empty";
          return (
            <li key={q.key} className="flex items-start gap-3 rounded-xl border-[1.5px] border-line px-3 py-2.5">
              <span className={`mt-px grid size-[22px] flex-none place-items-center rounded-full ${m.cls}`}>
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
                  <path d={m.d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="sr-only">{m.sr}: </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.9375rem] font-semibold break-words text-ink">
                  {q.label}
                  {q.required && <span className="font-normal text-ink-2"> (required)</span>}
                </span>
                <span className="line-clamp-3 text-small break-words whitespace-pre-line text-ink-2">{how}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The job you picked: who and where, Save and Apply (or how the application is going), the pay when stated, then
 *  Overview, Company, Insights and Review. Side by side, the header stays put while the rest scrolls. */
function JobDetail({ id, row, app, wide, busy, failure, saved: savedNow, onSave, onApply, onWatch, onBack, headingRef }: {
  id: string;
  row: Row | undefined;
  app: Application | undefined;
  wide: boolean;
  busy: boolean;
  failure: string | null;
  /** What you just set with Save, until the API's answer catches up. */
  saved: boolean | undefined;
  onSave: (on: boolean) => void;
  onApply: () => void;
  onWatch: () => void;
  onBack: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const detail = usePolling(`job-detail:${id}`, () => api.jobDetail(id), 300_000);
  const [tab, setTab] = useState<DTab>("overview");
  // Review reads the employer's form, so only once it's been opened (and then it stays read while you look around).
  const [reviewed, setReviewed] = useState(false);
  const [more, setMore] = useState(false);
  const base = useId();
  const job = detail.data?.job ?? row?.job;
  const match = detail.data?.match ?? null;
  const req = detail.data?.job?.requirements ?? null;
  const company = detail.data?.job?.company ?? null;

  if (!job) {
    return (
      <div className="flex flex-col gap-3 p-5 tablet:p-6">
        {!wide && (
          // Nori's seat on this screen, as on every page's title row below 1024 px.
          <PageHead>
            <BackButton onBack={onBack} />
          </PageHead>
        )}
        <p className="text-ink-2">{detail.error && detail.status !== 401 ? (detail.status === 404 ? "That job isn’t open any more." : detail.error) : "Loading the job…"}</p>
      </div>
    );
  }

  const { first, more: morePlaces } = placeOf(job, row?.places);
  const status = app ? statusLabel(app) : row?.status ? STATUS_LABEL[row.status] : null;
  const appStatus = app?.status ?? row?.status ?? null;
  const name = `${job.title} at ${job.companyName}`;
  const text = decode(job.descriptionText ?? "").trim();
  const LONG = 900;
  const doing = req?.responsibilities?.length ? req.responsibilities : null;
  const mustTotal = match ? match.explanation.matched.filter((m) => m.required).length + match.explanation.missing.filter((m) => m.required).length : 0;
  const mustCovered = match ? match.explanation.matched.filter((m) => m.required).length : 0;
  const ats = atsName(job.atsType);
  const saved = savedNow ?? detail.data?.job?.saved ?? row?.saved ?? false;
  const closed = !!(detail.data?.job?.closedAt ?? job.closedAt);
  const pay = payText(job.pay);
  const tags = listingTags(job, first);
  const pick = (t: DTab) => {
    setTab(t);
    if (t === "review") setReviewed(true);
  };
  const site = company?.website ? company.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;

  const save = (
    <button type="button" aria-pressed={saved} onClick={() => onSave(!saved)} className={buttonClass("outline", "min-h-11 rounded-full")}>
      <svg width="16" height="18" viewBox="0 0 20 20" aria-hidden="true">
        <path d={BOOKMARK} fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      {saved ? "Saved" : "Save"}
    </button>
  );

  const actions = (
    <>
      {save}
      {status ? (
        <>
          <span role="status" className="inline-flex min-h-11 items-center justify-center">
            <StatusChip tone={app && status === "Cancelled" ? "neutral" : appStatus ? TONE[appStatus] : "neutral"} busy={!!appStatus && MOVING.includes(appStatus)} className="h-11 px-4 text-[0.9375rem]">
              {status}
            </StatusChip>
          </span>
          {app && (
            <button type="button" onClick={onWatch} className={buttonClass("outline", "min-h-11 rounded-full")}>
              {MOVING.includes(app.status) ? "Watch" : "Open"}
            </button>
          )}
        </>
      ) : closed ? (
        <span role="status" className="inline-flex min-h-11 items-center justify-center">
          <StatusChip tone="neutral" className="h-11 px-4 text-[0.9375rem]">
            Closed
          </StatusChip>
        </span>
      ) : (
        <button type="button" onClick={onApply} disabled={busy} aria-label={`Apply to ${name}`} className={buttonClass("primary", "min-h-11 rounded-full px-7 disabled:opacity-60")}>
          {busy ? "Starting…" : "Apply"}
        </button>
      )}
    </>
  );

  return (
    <article aria-labelledby={`${base}-title`} className={`flex flex-col ${wide ? "min-h-0 flex-1" : ""}`}>
      {/* The header: who and where, with Save and Apply. Side by side it stays put while the description scrolls. */}
      <div className={`flex flex-col gap-4 p-4 tablet:p-6 laptop:px-7 ${wide ? "flex-none border-b-[1.5px] border-line pb-5" : "pb-0 tablet:pb-0"}`}>
        {!wide && (
          // Nori's seat on this screen, as on every page's title row below 1024 px.
          <PageHead>
            <BackButton onBack={onBack} />
          </PageHead>
        )}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 tablet:gap-x-[18px]">
          <CompanyLogo name={job.companyName} url={job.companyLogoUrl} box="size-[60px] rounded-[16px] text-[1.625rem] tablet:size-16 tablet:rounded-[18px] tablet:text-[1.75rem]" />
          <div className="min-w-[12rem] flex-1 pt-0.5">
            <h2 id={`${base}-title`} ref={headingRef} tabIndex={-1} className="text-[1.4375rem] leading-[1.2] font-semibold tracking-[-0.015em] text-ink outline-none tablet:text-[1.6875rem]">
              {job.title}
            </h2>
            <p className="mt-0.5 text-body text-ink-2 tablet:text-[1.0625rem]">
              {job.companyName}
              {first && (
                <>
                  {" · "}
                  {first}
                  {morePlaces > 0 && ` and ${morePlaces} more`}
                </>
              )}
            </p>
            <p className="mt-1 text-small text-ink-2">
              {[ago(job), ats ? `applies through ${ats}` : null].filter(Boolean).join(" · ")}
              {" · "}
              <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-[3px]">
                See the posting<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
          {wide && <div className="flex flex-none flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
      </div>

      <div className={`flex flex-col gap-4 px-4 pt-4 pb-6 tablet:px-6 laptop:px-7 ${wide ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {failure && <FormError>{failure}</FormError>}
        {(pay || tags.length > 0) && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            {pay && (
              <div>
                <p className="text-small text-ink-2">Offering</p>
                <p className="text-[1.375rem] font-semibold tracking-[-0.01em] text-ink tabular-nums tablet:text-[1.625rem]">{pay}</p>
              </div>
            )}
            {tags.length > 0 && (
              <ul aria-label="About the job" className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </ul>
            )}
          </div>
        )}
        {req && req.disqualifiers.length > 0 && (
          <p className="rounded-row bg-tint px-3.5 py-2.5 text-small text-ink">
            <b>Heads up:</b> {req.disqualifiers.join(". ")}.
          </p>
        )}

        <div>
          <Tabs label="About this job" items={DTABS} current={tab} onPick={pick} ids={{ tab: (t) => `${base}-${t}`, panel: `${base}-panel` }} small />
          <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`}>
            {tab === "overview" ? (
              <>
                <Section title="About the role" first>
                  {text ? (
                    <p className="text-[0.9375rem] leading-[1.55] whitespace-pre-line text-ink">
                      {more || text.length <= LONG ? text : `${text.slice(0, LONG).trimEnd()}…`}
                      {text.length > LONG && (
                        <button type="button" onClick={() => setMore((m) => !m)} className="ml-1 min-h-6 font-semibold underline underline-offset-[3px]">
                          {more ? "Show less" : "Read more"}
                        </button>
                      )}
                    </p>
                  ) : (
                    <p className="text-[0.9375rem] text-ink-2">{detail.data ? "The posting has no description. See the posting for the details." : "Loading…"}</p>
                  )}
                </Section>
                {(doing || req?.summary) && <Section title="What you’ll do">{doing ? <Bullets items={doing} /> : <p className="text-[0.9375rem] leading-[1.55] text-ink">{req?.summary}</p>}</Section>}
                {match && match.explanation.reasons.length > 0 && (
                  <Section title="Why it matches you">
                    <Bullets items={match.explanation.reasons} check />
                  </Section>
                )}
              </>
            ) : tab === "company" ? (
              <div className="flex flex-col gap-3 pt-4">
                <div className="flex items-center gap-3.5">
                  <CompanyLogo name={company?.name ?? job.companyName} url={company?.logoUrl ?? job.companyLogoUrl} box="size-12 rounded-xl text-[1.25rem]" />
                  <h3 className="text-[1.0625rem] font-semibold text-ink tablet:text-[1.1875rem]">{company?.name ?? job.companyName}</h3>
                </div>
                {detail.data ? (
                  <>
                    <dl className="flex flex-col gap-2 text-[0.9375rem] text-ink">
                      {company?.website && site && (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-ink-2">Website</dt>
                          <dd>
                            <a href={company.website} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-[3px]">
                              {site}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          </dd>
                        </div>
                      )}
                      {company?.size && (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-ink-2">Size</dt>
                          <dd>{company.size}</dd>
                        </div>
                      )}
                    </dl>
                    {company?.about && <p className="text-[0.9375rem] leading-[1.55] whitespace-pre-line text-ink">{company.about}</p>}
                    {!company?.size && !company?.about && <p className="text-[0.9375rem] text-ink-2">What the company does and its size show here once Norinote has read them.</p>}
                  </>
                ) : (
                  <p className="text-[0.9375rem] text-ink-2">Loading…</p>
                )}
              </div>
            ) : tab === "insights" ? (
              <div className="flex flex-col gap-1 pt-4">
                <dl className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-3">
                  {match && (
                    <div>
                      <dt className="sr-only">Fit</dt>
                      <dd className="text-[1.5rem] font-bold text-ink tabular-nums tablet:text-[1.625rem]">{match.score.toFixed(2)}</dd>
                      <dd className="text-small text-ink-2">match with your profile</dd>
                    </div>
                  )}
                  {mustTotal > 0 && (
                    <div>
                      <dt className="sr-only">Must-haves</dt>
                      <dd className="text-[1.5rem] font-bold text-ink tabular-nums tablet:text-[1.625rem]">
                        {mustCovered} of {mustTotal}
                      </dd>
                      <dd className="text-small text-ink-2">must-haves you cover</dd>
                    </div>
                  )}
                  {ats && (
                    <div>
                      <dt className="sr-only">Application system</dt>
                      <dd className="text-[1.5rem] font-bold text-ink tablet:text-[1.625rem]">{ats}</dd>
                      <dd className="text-small text-ink-2">application form</dd>
                    </div>
                  )}
                </dl>
                {match ? (
                  <>
                    {match.explanation.matched.length > 0 && (
                      <Section title="What you cover">
                        <Bullets items={match.explanation.matched.map((m) => m.label)} check />
                      </Section>
                    )}
                    {match.explanation.missing.length > 0 && (
                      <Section title="Not on your profile yet">
                        <Bullets items={match.explanation.missing.map((m) => (m.required ? `${m.requirement} (must-have)` : m.requirement))} />
                      </Section>
                    )}
                  </>
                ) : (
                  <p className="pt-3 text-[0.9375rem] text-ink-2">{detail.data ? "Nori hasn’t scored this job against your profile yet, so there’s no fit to show." : "Loading…"}</p>
                )}
              </div>
            ) : null}
            {reviewed && (
              <div hidden={tab !== "review"}>
                <ReviewPanel id={id} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Phones: Save and Apply stay at the bottom, above the tabs. */}
      {!wide && <div className="sticky bottom-16 z-[5] flex gap-2.5 border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-4 tablet:bottom-0 [&>*]:flex-1">{actions}</div>}
    </article>
  );
}

/** Where the jobs are: anywhere, remote, or one of the most common places of open jobs (GET /jobs/locations). */
function Where({ value, onChange, places }: { value: string; onChange: (v: string) => void; places: { name: string; count: number }[] }) {
  return (
    <label className={`relative flex min-h-11 flex-none items-center gap-2 rounded-xl border-[1.5px] border-line bg-surface pr-3 pl-3 text-[0.9375rem] font-medium text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink tablet:min-h-[46px] tablet:pl-4`}>
      <Icon d={PIN} />
      <span className="sr-only">Where</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[14rem] min-w-0 cursor-pointer appearance-none bg-surface pr-5 text-ink outline-none">
        <option value="">Anywhere</option>
        <option value={REMOTE}>Remote</option>
        {/* The chosen place stays listed even if it drops out of the top 30. */}
        {value && value !== REMOTE && !places.some((l) => l.name === value) && <option value={value}>{value}</option>}
        {places.map((l) => (
          <option key={l.name} value={l.name}>
            {l.name} ({fmt(l.count)})
          </option>
        ))}
      </select>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none absolute right-3">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </label>
  );
}

const BackButton = ({ onBack }: { onBack: () => void }) => (
  <button type="button" onClick={onBack} className="-ml-2 flex min-h-11 items-center gap-1.5 self-start px-2 text-body font-semibold text-ink">
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M11 3L5 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    Back to jobs
  </button>
);

export function Jobs() {
  const { open, panel } = usePanel();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [age, setAge] = useState<24 | 72>(72);
  const [hideClearance, setHideClearance] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** "" anywhere, REMOTE, or a place from GET /jobs/locations. */
  const [where, setWhere] = useState("");
  const [savedNow, setSavedNow] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<string | null>(null);
  const pushed = useRef(false);
  const ids = useId();

  // Side by side once the page is wide enough (the live panel takes room from it too), measured before the first paint.
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= WIDE);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The picked job is in the address (?job=…), so Back on a phone returns to the list and a link opens the job.
  useEffect(() => {
    const read = () => setSelected(new URLSearchParams(location.search).get("job"));
    read();
    addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim().slice(0, 100)), 300);
    return () => clearTimeout(t);
  }, [query]);

  const view = tab === "recommended" ? "best" : tab === "saved" ? "saved" : "new";
  const clearance = hideClearance ? "hide" : "show";
  const place = where === REMOTE ? { remote: true } : where ? { location: where } : {};
  const list = usePolling(tab === "applied" ? null : `jobs:${view}:${q}:${age}:${clearance}:${where}`, () => api.jobs({ view, q, maxAgeHours: age, clearance, limit: LIMIT, ...place }), 300_000);
  const places = usePolling("job-locations", api.jobLocations, 3_600_000);
  const summary = usePolling("jobs-summary", api.jobsSummary, 300_000);
  const apps = usePolling("applications", api.applications, (rows) => (rows?.some((r) => MOVING.includes(r.application.status)) ? 4000 : 30_000));
  const refreshApps = apps.refresh;
  useEffect(() => {
    void refreshApps();
  }, [panel, refreshApps]);

  // While a new search loads, the last results stay (dimmed) instead of the list going blank on every keystroke.
  const [kept, setKept] = useState<JobListItem[] | null>(null);
  if (list.data && list.data !== kept) setKept(list.data);
  const items = list.data ?? (list.loading ? kept : null);

  const byJob = new Map<string, Application>();
  for (const r of apps.data ?? []) if (!byJob.has(r.application.jobId)) byJob.set(r.application.jobId, r.application);

  const needle = q.toLowerCase();
  // Applied: one row per job (its latest application), newest first as the API sends them.
  const appliedJobs = apps.data ? [...new Map(apps.data.toReversed().map((r) => [r.application.jobId, r])).values()].reverse() : null;
  const rows: Row[] | null =
    tab === "applied"
      ? appliedJobs
        ? appliedJobs
            .filter((r) => !needle || `${r.job.title} ${r.job.companyName}`.toLowerCase().includes(needle))
            .map((r) => ({ job: r.job, fit: null, status: r.application.status, places: [], widened: false, saved: savedNow[r.job.id] ?? false }))
        : null
      : items
        ? items.map((i) => ({ job: i.job, fit: i.match?.score ?? null, status: byJob.get(i.job.id)?.status ?? i.applicationStatus, places: i.locationNames ?? [], widened: !!i.match?.widenedBy, saved: savedNow[i.job.id] ?? !!i.saved }))
        : null;

  const source = tab === "applied" ? apps : list;
  const offline = !rows && !!source.error && source.status !== 401;
  const shownId = selected ?? (wide ? (rows?.[0]?.job.id ?? null) : null);
  const shownRow = rows?.find((r) => r.job.id === shownId);
  const filters = (age === 24 ? 1 : 0) + (hideClearance ? 1 : 0);
  const n = rows?.length ?? 0;
  const s = summary.data;
  const total = tab === "all" && !q && !hideClearance && !where && s ? (age === 24 ? s.newToday : s.open) : null;
  const count =
    tab === "applied"
      ? `${n} applied${q ? " that match" : ""}`
      : tab === "saved"
        ? `${n} saved`
      : total !== null && total > n
        ? `${fmt(total)} open postings · newest ${n} shown`
        : tab === "recommended"
          ? `${n === LIMIT ? `Top ${n}` : n} that fit your searches`
          : `${n === LIMIT ? `First ${n}` : n} ${n === 1 ? "job" : "jobs"}`;

  function pick(id: string, el?: HTMLElement) {
    opener.current = id;
    const url = new URL(location.href);
    url.searchParams.set("job", id);
    if (!selected) {
      history.pushState(null, "", url.pathname + url.search);
      pushed.current = true;
    } else history.replaceState(history.state, "", url.pathname + url.search);
    setSelected(id);
    setFailure(null);
    // On a phone the job is a new screen: its title takes focus. Side by side, focus stays on the list.
    if (!wide) requestAnimationFrame(() => heading.current?.focus());
    else el?.focus();
  }
  function back() {
    if (pushed.current) {
      pushed.current = false;
      history.back();
    } else {
      history.replaceState(history.state, "", location.pathname);
      setSelected(null);
    }
    const id = opener.current;
    window.setTimeout(() => document.querySelector<HTMLElement>(`main [data-job="${CSS.escape(id ?? "")}"]`)?.focus(), 60);
  }
  async function toggleSave(jobId: string, on: boolean) {
    setFailure(null);
    setSavedNow((m) => ({ ...m, [jobId]: on }));
    const r = await api.saveJob(jobId, on);
    if (!r.ok) {
      setSavedNow((m) => ({ ...m, [jobId]: !on }));
      setFailure(r.error);
      return;
    }
    if (tab === "saved") void list.refresh();
  }
  async function apply(jobId: string) {
    setFailure(null);
    setBusy(jobId);
    const r = await api.apply(jobId);
    setBusy(null);
    if (!r.ok) return setFailure(r.error);
    void apps.refresh();
    open({ kind: "apps", ids: [r.data.id], index: 0 });
  }

  const empty =
    tab === "applied"
      ? q
        ? `Nothing you applied to matches “${q}”.`
        : "You haven’t applied to anything yet. Pick a job and Apply now, and it shows here."
      : tab === "saved" && !q
        ? "Nothing saved yet. Save a job to keep it here."
        : q || where
        ? `No ${tab === "saved" ? "saved" : "open"} jobs match${q ? ` “${q}”` : ""}${where ? ` ${where === REMOTE ? "as remote" : `in ${where}`}` : ""}.${q ? " Search looks at job titles and company names." : ""}`
        : tab === "recommended"
          ? "Nothing from the last 3 days fits your searches yet. Nori looks again as new jobs come in."
          : "No open jobs from the last 3 days yet. Nori collects new ones through the day.";

  const detailOnly = !wide && !!selected;
  const app = shownId ? byJob.get(shownId) : undefined;

  return (
    <main ref={main} id="main" className="mx-auto flex w-full max-w-[1240px] flex-col px-4 pb-24 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      {detailOnly ? (
        <h1 className="sr-only">Jobs</h1>
      ) : (
        <>
          <PageHead>
            <h1 className="text-[1.875rem] leading-[1.1] font-bold tracking-[-0.02em] text-ink laptop:text-[2.375rem]">Jobs</h1>
            <p className="mt-1 text-[0.9375rem] text-ink-2 tablet:text-[1.0625rem]">Discover and apply to roles that fit your goals.</p>
          </PageHead>

          <div className="mt-4 flex tablet:mt-5">
            <label className="relative flex min-h-11 max-w-[560px] min-w-0 flex-1 items-center gap-3 rounded-xl border-[1.5px] border-line bg-surface-2 px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink tablet:min-h-[46px]">
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="flex-none text-ink-2">
                <circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search jobs</span>
              <input
                type="search"
                value={query}
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search roles or companies"
                className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-2"
              />
            </label>
          </div>

          <div className="mt-3.5">
            <Tabs label="Which jobs" items={TABS} current={tab} onPick={(t) => {
                setTab(t);
                setFailure(null);
                // A new list starts at its first job.
                if (selected) {
                  history.replaceState(history.state, "", location.pathname);
                  pushed.current = false;
                  setSelected(null);
                }
              }} ids={{ tab: (t) => `${ids}-tab-${t}`, panel: `${ids}-list` }} />
          </div>
        </>
      )}

      <div className={`mt-5 tablet:mt-[22px] ${wide ? "grid grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)] items-start gap-5 desktop:grid-cols-[440px_minmax(0,1fr)]" : ""}`}>
        {!detailOnly && (
          <section role="tabpanel" id={`${ids}-list`} aria-labelledby={`${ids}-tab-${tab}`} aria-busy={source.loading} className={wide ? "overflow-hidden rounded-[22px] border-[1.5px] border-line bg-surface" : ""}>
            {/* The list's header: how many, then the filters and where (the boards' "All filters · Worldwide"). */}
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${wide ? "border-b-[1.5px] border-line px-[18px] py-3" : "mb-3 px-0.5"}`}>
              <p aria-live="polite" className="min-w-0 flex-1 basis-[11rem] text-small font-semibold text-ink">
                {rows ? count : " "}
              </p>
              {tab !== "applied" && (
                <div className="flex">
                  <Where value={where} onChange={setWhere} places={places.data?.locations ?? []} />
                </div>
              )}
              {tab !== "applied" && (
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls={`${ids}-filters`}
                  onClick={() => setFiltersOpen((o) => !o)}
                  className="flex min-h-11 flex-none items-center gap-2 rounded-xl border-[1.5px] border-line bg-surface px-3 text-[0.9375rem] font-semibold text-ink hover:border-line-strong tablet:min-h-[46px] tablet:px-4"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 6h9M15 6h2M3 14h2M8 14h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <circle cx="13.5" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="6.5" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span className="max-tablet:sr-only">Filters</span>
                  {filters > 0 && (
                    <span>
                      <span className="max-tablet:hidden"> · </span>
                      {filters}
                      <span className="sr-only"> on</span>
                    </span>
                  )}
                </button>
              )}
            </div>
            {filtersOpen && tab !== "applied" && (
              <div id={`${ids}-filters`} className={`flex flex-wrap gap-x-8 gap-y-3 ${wide ? "border-b-[1.5px] border-line px-[18px] py-3.5" : "mb-3 rounded-card border-[1.5px] border-line bg-surface p-4"}`}>
                <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <legend className="float-left mr-3 min-h-9 content-center text-small font-semibold text-ink">Posted in the last</legend>
                  {([[24, "24 hours"], [72, "3 days"]] as const).map(([h, label]) => (
                    <label key={h} className="flex min-h-9 cursor-pointer items-center gap-2 text-small text-ink">
                      <input type="radio" name={`${ids}-age`} checked={age === h} onChange={() => setAge(h)} className="size-4 accent-accent" />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-small text-ink">
                  <input type="checkbox" checked={hideClearance} onChange={(e) => setHideClearance(e.target.checked)} className="size-4 accent-accent" />
                  Hide jobs that need US citizenship or a security clearance
                </label>
              </div>
            )}

            {offline ? (
              <div className={`flex flex-col items-start gap-2 ${wide ? "px-[18px] py-5" : "rounded-card border-[1.5px] border-line bg-surface p-6"}`}>
                <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
                <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
                <button type="button" onClick={() => void source.refresh()} className={buttonClass("outline", "mt-2 min-h-11")}>
                  Try again
                </button>
              </div>
            ) : !rows ? (
              <ul aria-label="Loading jobs" className={`flex flex-col gap-2.5 ${wide ? "p-2.5" : ""}`}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i} aria-hidden="true" className="h-[108px] animate-pulse rounded-[14px] border-[1.5px] border-line bg-surface" />
                ))}
              </ul>
            ) : rows.length === 0 ? (
              <p className={`text-[0.9375rem] text-ink-2 ${wide ? "px-[18px] py-5" : "rounded-card border-[1.5px] border-line bg-surface p-5"}`}>{empty}</p>
            ) : (
              <ul aria-label="Jobs" className={`flex flex-col gap-2.5 transition-opacity ${list.loading && tab !== "applied" ? "opacity-60" : ""} ${wide ? "p-2.5" : ""}`}>
                {rows.map((r) => (
                  <JobRow key={r.job.id} row={r} current={wide && r.job.id === shownId} onPick={(el) => pick(r.job.id, el)} />
                ))}
              </ul>
            )}
          </section>
        )}

        {shownId && (
          <section aria-label="The job" className={wide ? "sticky top-6 flex max-h-[calc(100svh-3rem)] flex-col overflow-hidden rounded-[22px] border-[1.5px] border-line bg-surface" : "-mx-4 -mt-5 tablet:-mx-8 tablet:mt-0 tablet:rounded-card tablet:border-[1.5px] tablet:border-line tablet:bg-surface"}>
            <JobDetail key={shownId} id={shownId} row={shownRow} app={app} wide={wide} busy={busy === shownId} failure={failure} saved={savedNow[shownId]} onSave={(on) => void toggleSave(shownId, on)} onApply={() => void apply(shownId)} onWatch={() => app && open({ kind: "apps", ids: [app.id], index: 0 })} onBack={back} headingRef={heading} />
          </section>
        )}
      </div>
    </main>
  );
}
