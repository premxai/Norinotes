"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { API_URL, api, type Application, type ApplicationDetail, type ApplicationRow, type Job, type OutcomeKind, type Outcomes, type ResumeContent, type ResumeView } from "@/lib/api";
import { isCancelled, isMoving, shortDate } from "@/lib/app-state";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { setOutcomes } from "@/lib/use-outcomes";
import { CompanyLogo } from "./CompanyLogo";
import { ApplicationBody, CancelAction, useApplication } from "./LivePanel";
import { PageHead } from "./PageHead";
import { ListDetail } from "./v2/ListDetail";
import { StatusChip, type ChipTone } from "./v2/StatusChip";

/*
 * /applications and /applications/:id (dashboard v2, docs/dashboard-v2-plan.md section 3): every job the person has
 * started applying to, beside the open one. The open one shows where it is: Optimizing your resume (no resume yet),
 * Watch Nori apply while it fills the form (LivePanel's ApplicationBody, which also asks for a code, takes answers and
 * offers Try again), Applied (the resume that was sent and the screenshot after Submit). Its Resume tab holds the
 * tailored resume once it exists. Everything shown is the API's: GET /applications, GET /applications/:id, the
 * receipt's screenshot under /api/artifacts and the resume's PDF under /api/resumes/:id.pdf.
 */

type Tab = "all" | "in_progress" | "applied" | "closed";
type Stage = { label: string; tone: ChipTone; busy?: boolean; tab: Exclude<Tab, "all"> };

const TABS: [Tab, string, string][] = [
  ["all", "All", ""],
  ["in_progress", "In progress", "in-progress"],
  ["applied", "Applied", "applied"],
  ["closed", "Closed", "closed"],
];
/** Earlier addresses (Tracker's links, older bookmarks) land on the tab that holds them now. */
const OLD_SHOW: Record<string, Tab> = { sent: "applied", replied: "applied" };

/** One chip per application: what the plan names (Optimizing resume, Applying, Needs help, Applied, the two ends). */
export function stageOf(a: Application): Stage {
  switch (a.status) {
    case "queued":
    case "preparing":
      return { label: "Optimizing resume", tone: "working", busy: true, tab: "in_progress" };
    case "prepared":
      return a.approvedAt ? { label: "Queued", tone: "waiting", tab: "in_progress" } : { label: "Ready for your OK", tone: "needs", tab: "in_progress" };
    case "applying":
    case "awaiting_code": // An emailed code is part of applying (the live view asks for it), not Needs help.
      return { label: "Applying", tone: "working", busy: true, tab: "in_progress" };
    case "needs_user":
      return { label: "Needs help", tone: "needs", tab: "in_progress" };
    case "submitted":
      return { label: "Applied", tone: "done", tab: "applied" };
    default:
      return isCancelled(a) ? { label: "Cancelled", tone: "neutral", tab: "closed" } : { label: "Didn't go through", tone: "bad", tab: "closed" };
  }
}

const place = (job: Job) => (job.remote && !job.location ? "Remote" : job.location);
const when = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString() ? "Today" : shortDate(iso);
};

/** Whether the screen is 1024 px or wider, where the list and the open application sit side by side. */
function useWide() {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia("(min-width: 1024px)");
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

/** A file under the API's /artifacts, fetched with the session and shown through an object URL (the site's CSP). */
function useArtifact(url: string | null) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!url) return;
    let live = true;
    let made: string | null = null;
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        const type = r.headers.get("content-type") ?? "";
        if (!r.ok || !type.startsWith("image/")) throw new Error(String(r.status));
        const blob = await r.blob();
        if (!live) return;
        made = URL.createObjectURL(blob);
        setState({ url: made, failed: false });
      })
      .catch(() => live && setState({ url: null, failed: true }));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return state;
}

// ---- the list ---------------------------------------------------------------------------------------------------------

function Row({ row, open, onPick }: { row: ApplicationRow; open: boolean; onPick: (id: string) => void }) {
  const a = row.application;
  const s = stageOf(a);
  const pick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onPick(a.id);
  };
  return (
    <li>
      <Link
        href={`/applications/${a.id}`}
        prefetch={false}
        onClick={pick}
        aria-current={open ? "true" : undefined}
        data-app={a.id}
        className={`flex min-h-[72px] items-center gap-3 rounded-row border-[1.5px] px-3 py-2.5 no-underline ${open ? "border-accent bg-accent-tint" : "border-transparent hover:bg-tint"}`}
      >
        <CompanyLogo name={row.job.companyName} url={row.job.companyLogoUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold text-ink">{row.job.title}</span>
          <span className="mt-0.5 block truncate text-small text-ink-2">
            {row.job.companyName} · {when(a.submittedAt ?? a.createdAt)}
          </span>
        </span>
        <StatusChip tone={s.tone} busy={s.busy} className="max-tablet:px-2.5 max-tablet:text-[0.75rem]">
          {s.label}
        </StatusChip>
      </Link>
    </li>
  );
}

// ---- the open application ---------------------------------------------------------------------------------------------

/** Queued or preparing: the resume is being tailored. No resume is shown until it's ready. */
function Optimizing({ detail, refresh }: { detail: ApplicationDetail; refresh: () => Promise<void> }) {
  const a = detail.application;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function cancel() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await api.cancel(a.id);
    setBusy(false);
    if (!r.ok) setFailure(r.error);
    void refresh();
  }
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center tablet:py-12">
      <span aria-hidden="true" className="relative grid size-16 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-info-tint border-t-info motion-reduce:animate-none" />
        <svg width="24" height="24" viewBox="0 0 24 24" className="text-info">
          <path d="M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </span>
      <p role="status" className="font-serif text-[1.5rem] leading-[1.15] text-ink tablet:text-[1.75rem]">
        Optimizing your resume for {detail.job.companyName}
      </p>
      <p className="max-w-[34rem] text-ink-2">
        {a.approvedAt
          ? "When it’s ready it’s kept in the Resume tab, and Nori starts the application."
          : "When it’s ready it’s kept in the Resume tab, and the application waits for your OK."}
      </p>
      {failure && <FormError>{failure}</FormError>}
      <div className="mt-2">
        <CancelAction busy={busy} onCancel={() => void cancel()} />
      </div>
    </div>
  );
}

const KIND_LABEL: Record<OutcomeKind, string> = { reply: "Reply", interview: "Interview", offer: "Offer", rejection: "Rejection" };
const SAY: Record<OutcomeKind, string> = { reply: "They replied!", interview: "An interview!", offer: "An offer!", rejection: "On to the next one." };
const SEEN_KEY = "norinote-last-seen-outcomes";

/** What came of a sent application: from Nori's inbox, or marked here by hand (with Undo for the one just marked). */
function WhatHappened({ id }: { id: string }) {
  const server = usePolling(`outcomes:${id}`, () => api.outcomes(id), 60_000);
  const [local, setLocal] = useState<Outcomes | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const outcomes = (local ?? server.data)?.outcomes ?? [];

  async function mark(kind: OutcomeKind) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await api.addOutcome(id, kind);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    setLocal(r.data);
    setOutcomes(id, r.data);
    setMarked(r.data.outcome.id);
    setSaid(`Marked as ${KIND_LABEL[kind].toLowerCase()}. Undo is available.`);
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen || r.data.outcome.at > seen) localStorage.setItem(SEEN_KEY, r.data.outcome.at);
    } catch {
      // Storage blocked: nothing else compares with it.
    }
    if (r.data.created) void noriReact({ event: kind, say: SAY[kind] });
  }
  async function undo(outcomeId: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const r = await api.removeOutcome(id, outcomeId);
    setBusy(false);
    if (!r.ok) return setFailure(r.error);
    setLocal(r.data);
    setOutcomes(id, r.data);
    setMarked(null);
    setSaid("Undone.");
  }

  return (
    <section aria-labelledby="mark-title" className="flex flex-col gap-3 rounded-card border-[1.5px] border-line p-4">
      <h3 id="mark-title" className="text-[1.0625rem] font-semibold text-ink">
        What happened?
      </h3>
      {outcomes.length > 0 && (
        <ul aria-label="What came of it, newest first" className="flex flex-col gap-1.5">
          {[...outcomes].sort((x, y) => y.at.localeCompare(x.at)).map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-2 text-small text-ink">
              <span className="font-semibold">{KIND_LABEL[o.kind]}</span>
              <span className="text-ink-2">
                · {shortDate(o.at)} · {o.source === "manual" ? "Marked by you" : o.messageId ? <Link href={`/inbox/${o.messageId}`} className="underline underline-offset-[3px]">From Nori&rsquo;s inbox</Link> : "From Nori’s inbox"}
              </span>
              {o.id === marked && (
                <button type="button" onClick={() => void undo(o.id)} aria-disabled={busy || undefined} className="min-h-10 px-1 font-semibold text-ink underline underline-offset-[3px]">
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 tablet:flex tablet:flex-wrap">
        {(["reply", "interview", "offer", "rejection"] as OutcomeKind[]).map((k) => (
          <button key={k} type="button" onClick={() => void mark(k)} aria-disabled={busy || undefined} className={buttonClass("outline", "min-h-11 px-5")}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="text-small text-ink-2">Replies that go to your own email don&rsquo;t reach Nori&rsquo;s inbox, so you can mark them here.</p>
      {failure && <FormError>{failure}</FormError>}
      <p role="status" className="sr-only">
        {said}
      </p>
    </section>
  );
}

function Shot({ url, onBack }: { url: string; onBack: () => void }) {
  const img = useArtifact(url);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  return (
    <div className="flex flex-col gap-3">
      <button ref={back} type="button" onClick={onBack} className="min-h-10 self-start text-small font-semibold text-ink">
        ‹ Back
      </button>
      <figure className="m-0 flex flex-col gap-2">
        <figcaption className="text-small font-semibold text-ink">The page after Submit</figcaption>
        <div className="relative min-h-[200px] overflow-hidden rounded-[12px] border-[1.5px] border-line bg-surface-2">
          {img.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched artifact; next/image has nothing to optimise
            <img src={img.url} alt="The employer’s page after Nori pressed Submit" className="block h-auto w-full" />
          ) : (
            <p className="absolute inset-0 m-0 grid place-items-center px-4 text-center text-small text-ink-2">{img.failed ? "The screenshot couldn’t be loaded here." : "Loading the screenshot…"}</p>
          )}
        </div>
      </figure>
      <a href={url} target="_blank" rel="noreferrer" className="min-h-10 self-start py-2 text-small font-semibold text-ink underline underline-offset-[3px]">
        Open it in a new tab<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

function Applied({ detail, onResume }: { detail: ApplicationDetail; onResume: () => void }) {
  const a = detail.application;
  const [shot, setShot] = useState(false);
  const receipt = a.receipt;
  const confirmation = typeof receipt?.confirmation === "string" ? receipt.confirmation : null;
  const path = typeof receipt?.screenshotPath === "string" && receipt.screenshotPath.startsWith("artifacts/") ? `${API_URL}/api/${receipt.screenshotPath}` : null;
  const took = a.approvedAt && a.submittedAt ? Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.approvedAt)) / 1000)) : null;
  const changes = detail.resume?.changes.length ?? 0;
  if (shot && path) return <Shot url={path} onBack={() => setShot(false)} />;
  const card = "flex min-h-[96px] flex-col items-start justify-between gap-2 rounded-card border-[1.5px] border-line bg-surface-2 p-4 text-left hover:border-line-strong";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-serif text-[1.5rem] leading-[1.15] text-ink">
          {a.submittedAt ? `Sent ${shortDate(a.submittedAt)}` : "Sent"}
          {took !== null && ` in ${took} ${took === 1 ? "second" : "seconds"}`}
        </p>
        {confirmation && <p className="mt-1 text-small text-ink-2">Confirmation <span className="font-semibold text-ink tabular-nums">{confirmation}</span></p>}
        {receipt?.dryRun === true && <p className="mt-1 text-small text-ink-2">A practice run: nothing reached the employer.</p>}
      </div>
      {(detail.resume || path) && (
        <div className="grid gap-3 tablet:grid-cols-2">
          {detail.resume && (
            <button type="button" onClick={onResume} className={card}>
              <span className="font-semibold text-ink">The resume that was sent</span>
              <span className="text-small text-ink-2">
                Tailored for {detail.job.companyName}
                {changes > 0 && ` · ${changes} ${changes === 1 ? "line" : "lines"} changed`}
              </span>
            </button>
          )}
          {path && (
            <button type="button" onClick={() => setShot(true)} className={card}>
              <span className="font-semibold text-ink">The application screenshot</span>
              <span className="text-small text-ink-2">The page after Submit</span>
            </button>
          )}
        </div>
      )}
      <WhatHappened id={a.id} />
    </div>
  );
}

const contactLine = (c: Record<string, unknown>) =>
  ["location", "email", "phone", "linkedin", "github", "website"].map((k) => c[k]).filter((v): v is string => typeof v === "string" && !!v.trim());
const dates = (start: string | null, end: string | null) => (start || end ? `${start ?? ""}${start && end ? " to " : ""}${end ?? (start ? " to now" : "")}` : null);

/** A resume's bullets, the lines tailored for this job highlighted. */
function Bullets({ items, changed }: { items: { id: string; text: string }[]; changed: Set<string> }) {
  return (
    <ul className="mt-1 flex flex-col gap-1 pl-4">
      {items.map((b, i) => (
        <li key={b.id || i} className="list-disc text-small leading-[1.5] text-ink">
          {changed.has(b.text) || (b.id && changed.has(b.id)) ? <mark className="rounded-[4px] bg-accent-tint px-0.5 text-ink">{b.text}</mark> : b.text}
        </li>
      ))}
    </ul>
  );
}

function ResumeDoc({ resume, company }: { resume: ResumeView; company: string }) {
  const changed = new Set(resume.changes.flatMap((c) => [c.after, ...(c.bulletId ? [c.bulletId] : [])]));
  const n = resume.changes.length;
  const c: ResumeContent | undefined = resume.content;
  const heading = "mt-4 border-b-[1.5px] border-line pb-1 text-[0.75rem] font-semibold tracking-[0.08em] text-ink-2 uppercase";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-small text-ink-2">
          Tailored for {company}
          {n > 0 && ` · ${n} ${n === 1 ? "line" : "lines"} changed${c ? " (highlighted)" : ""}`}
        </p>
        {resume.id && (
          <a href={`${API_URL}/api/resumes/${resume.id}.pdf`} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-10")}>
            Download PDF<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {c ? (
        <article aria-label="The tailored resume" className="rounded-card border-[1.5px] border-line bg-bg p-4 tablet:p-6">
          <p className="font-serif text-[1.375rem] leading-[1.15] text-ink">{c.name}</p>
          {contactLine(c.contact).length > 0 && <p className="mt-1 text-small break-words text-ink-2">{contactLine(c.contact).join(" · ")}</p>}
          {c.summary && <p className="mt-3 text-small leading-[1.55] text-ink">{c.summary}</p>}
          {c.experience.length > 0 && (
            <>
              <p className={heading}>Experience</p>
              {c.experience.map((e, i) => (
                <div key={i} className="mt-2.5">
                  <p className="text-small font-semibold text-ink">
                    {[e.title, e.company].filter(Boolean).join(" · ")}
                    {dates(e.start, e.end) && <span className="font-normal text-ink-2"> · {dates(e.start, e.end)}</span>}
                  </p>
                  <Bullets items={e.bullets} changed={changed} />
                </div>
              ))}
            </>
          )}
          {c.projects.length > 0 && (
            <>
              <p className={heading}>Projects</p>
              {c.projects.map((p, i) => (
                <div key={i} className="mt-2.5">
                  <p className="text-small font-semibold text-ink">{p.name}</p>
                  <Bullets items={p.bullets} changed={changed} />
                </div>
              ))}
            </>
          )}
          {c.education.length > 0 && (
            <>
              <p className={heading}>Education</p>
              {c.education.map((e, i) => (
                <p key={i} className="mt-2 text-small text-ink">
                  <span className="font-semibold">{e.school}</span>
                  {[e.degree, e.field].filter(Boolean).length > 0 && ` · ${[e.degree, e.field].filter(Boolean).join(", ")}`}
                  {dates(e.start, e.end) && <span className="text-ink-2"> · {dates(e.start, e.end)}</span>}
                </p>
              ))}
            </>
          )}
          {c.skills.length > 0 && (
            <>
              <p className={heading}>Skills</p>
              {c.skills.map((s, i) => (
                <p key={i} className="mt-1.5 text-small text-ink">
                  {s.group && <span className="font-semibold">{s.group}: </span>}
                  {s.items.join(", ")}
                </p>
              ))}
            </>
          )}
        </article>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {resume.changes.map((x, i) => (
            <li key={i} className="flex flex-col gap-0.5 text-small">
              <mark className="self-start rounded-[4px] bg-accent-tint px-0.5 text-ink">{x.after}</mark>
              {x.reason && <span className="text-[0.8125rem] text-ink-2">{x.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobDetails({ job }: { job: Job }) {
  const text = job.descriptionText?.trim();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-ink-2">{[`${job.title} at ${job.companyName}`, place(job)].filter(Boolean).join(" · ")}</p>
      {text ? <div className="text-small leading-[1.6] whitespace-pre-line text-ink">{text}</div> : <p className="text-small text-ink-2">The listing&rsquo;s text isn&rsquo;t stored for this job.</p>}
      <a href={job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "min-h-11 self-start")}>
        Open the job posting<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

type DTab = "app" | "resume" | "job";

function Detail({ id, row, heading }: { id: string; row: ApplicationRow | undefined; heading: RefObject<HTMLHeadingElement | null> }) {
  const poll = useApplication(id);
  const detail = poll.data;
  const [tab, setTab] = useState<DTab>("app");
  const a = detail?.application ?? row?.application;
  const job = detail?.job ?? row?.job;

  if (!a || !job) {
    const missing = poll.status === 404 || poll.status === 400;
    return (
      <div className="flex flex-col items-start gap-3 p-4 tablet:p-6">
        {missing ? (
          <>
            <h2 ref={heading} tabIndex={-1} className="font-serif text-[1.5rem] leading-[1.15] text-ink outline-none">
              That application isn&rsquo;t here.
            </h2>
            <p className="text-ink-2">It may have been removed, or the link is wrong.</p>
          </>
        ) : poll.error && poll.status !== 401 ? (
          <p className="text-ink-2">Couldn&rsquo;t reach Norinote. This tries again by itself.</p>
        ) : (
          <>
            <h2 className="sr-only">Loading the application</h2>
            <div aria-hidden="true" className="h-16 w-full animate-pulse rounded-card bg-tint" />
            <div aria-hidden="true" className="h-[240px] w-full animate-pulse rounded-card bg-tint" />
          </>
        )}
      </div>
    );
  }

  const s = stageOf(a);
  const resume = detail?.resume ?? null;
  const shown: DTab = tab === "resume" && !resume ? "app" : tab;
  const tabs: [DTab, string, boolean][] = [
    ["app", "Application", true],
    ["resume", "Resume", !!resume],
    ["job", "Job details", true],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 px-4 pt-3 tablet:px-6 laptop:pt-5">
        <CompanyLogo name={job.companyName} url={job.companyLogoUrl} />
        <div className="min-w-0 flex-1">
          <h2 ref={heading} tabIndex={-1} className="text-[1.25rem] leading-[1.25] font-semibold text-ink outline-none tablet:text-[1.375rem]">
            {job.title}
          </h2>
          <p className="mt-0.5 text-small text-ink-2">{[job.companyName, place(job)].filter(Boolean).join(" · ")}</p>
        </div>
        <StatusChip tone={s.tone} busy={s.busy}>
          {s.label}
        </StatusChip>
      </div>
      <div role="tablist" aria-label="About this application" className="mt-3 flex gap-1 overflow-x-auto border-b-[1.5px] border-line px-3 [scrollbar-width:none] tablet:px-5">
        {tabs.map(([t, label, enabled]) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`dtab-${t}`}
            aria-selected={shown === t}
            aria-controls="dtab-panel"
            aria-disabled={!enabled || undefined}
            title={enabled ? undefined : "The resume shows here once it’s ready"}
            onClick={() => enabled && setTab(t)}
            className={`-mb-[1.5px] min-h-11 flex-none border-b-2 px-3 text-small whitespace-nowrap ${shown === t ? "border-accent font-semibold text-ink" : "border-transparent font-medium text-ink-2"} ${enabled ? "hover:text-ink" : "cursor-not-allowed opacity-60"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Focusable, so the panel scrolls from the keyboard. Its mono type (the run's clock, the code box) is set in the
          page's sans: Geist Mono stays off the first screen (the 450 KB budget). */}
      <div id="dtab-panel" role="tabpanel" tabIndex={0} aria-labelledby={`dtab-${shown}`} className="min-h-0 flex-1 overflow-y-auto p-4 tablet:p-6 [&_.font-mono]:font-sans [&_.font-mono]:tabular-nums">
        {shown === "resume" && resume ? (
          <ResumeDoc resume={resume} company={job.companyName} />
        ) : shown === "job" ? (
          <JobDetails job={job} />
        ) : !detail ? (
          <div aria-hidden="true" className="h-[240px] w-full animate-pulse rounded-card bg-tint" />
        ) : a.status === "queued" || a.status === "preparing" ? (
          <Optimizing detail={detail} refresh={poll.refresh} />
        ) : a.status === "submitted" ? (
          <Applied detail={detail} onResume={() => setTab("resume")} />
        ) : (
          <ApplicationBody detail={detail} refresh={poll.refresh} />
        )}
      </div>
    </div>
  );
}

// ---- the page ---------------------------------------------------------------------------------------------------------

function pathId(): string | null {
  const m = location.pathname.match(/^\/applications\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function Applications({ initialId = null }: { initialId?: string | null }) {
  const list = usePolling("applications", api.applications, (rows) => (rows?.some((r) => isMoving(r.application)) ? 4000 : 30_000));
  const wide = useWide();
  // The tab is kept in the URL (?show=in-progress), so Back and a shared link keep it. The tabs only render once the
  // list has loaded, so reading the URL here can't differ from the prerendered page.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "all";
    const show = new URLSearchParams(location.search).get("show") ?? "";
    return TABS.find(([, , u]) => u && u === show)?.[0] ?? OLD_SHOW[show] ?? "all";
  });
  const [query, setQuery] = useState("");
  // The open application is the address's (/applications/:id); rows change it without leaving the page.
  const [picked, setPicked] = useState<string | null>(initialId);
  const pushed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const onPop = () => setPicked(pathId());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  function choose(t: Tab) {
    setTab(t);
    const url = new URL(location.href);
    const u = TABS.find(([id]) => id === t)![2];
    if (u) url.searchParams.set("show", u);
    else url.searchParams.delete("show");
    history.replaceState(history.state, "", url.pathname + url.search);
  }
  function pick(id: string) {
    const to = `/applications/${encodeURIComponent(id)}${location.search}`;
    if (!picked) {
      history.pushState(null, "", to);
      pushed.current = true;
    } else history.replaceState(history.state, "", to);
    setPicked(id);
    // On a phone the application is a new screen: its title takes focus. Side by side, focus stays on the list.
    if (!wide) requestAnimationFrame(() => heading.current?.focus());
  }
  function back() {
    const from = picked;
    if (pushed.current) {
      pushed.current = false;
      history.back();
    } else history.replaceState(history.state, "", `/applications${location.search}`);
    setPicked(null);
    window.setTimeout(() => document.querySelector<HTMLElement>(`main [data-app="${CSS.escape(from ?? "")}"]`)?.focus(), 60);
  }

  const rows = list.data ?? [];
  const count = (t: Tab) => (t === "all" ? rows.length : rows.filter((r) => stageOf(r.application).tab === t).length);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === "all" || stageOf(r.application).tab === tab) && (!q || `${r.job.title} ${r.job.companyName}`.toLowerCase().includes(q)));
  // Side by side with nothing chosen, the first one in the list is open.
  const openId = picked ?? (wide ? (shown[0]?.application.id ?? null) : null);
  const openRow = rows.find((r) => r.application.id === openId);
  const offline = !list.data && !!list.error && list.status !== 401;

  let body: ReactNode;
  if (offline && !picked) {
    body = (
      <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
        <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
        <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
        <button type="button" onClick={() => void list.refresh()} className={buttonClass("outline", "mt-2 min-h-11")}>
          Try again
        </button>
      </div>
    );
  } else if (list.data && rows.length === 0 && !picked) {
    body = (
      <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
        <p className="font-serif text-[1.5rem] text-ink tablet:text-[1.75rem]">Nothing sent yet</p>
        <p className="text-ink-2">Jobs you apply to, yourself or through Nori, show up here with where they are.</p>
        <Link href="/jobs" className={buttonClass("outline", "mt-2 min-h-11")}>
          Find jobs
        </Link>
      </div>
    );
  } else {
    body = (
      <ListDetail
        open={!!picked}
        listWidth="clamp(300px, 36%, 420px)"
        listLabel="Your applications"
        backLabel="Applications"
        onBack={back}
        list={
          <>
            <div className="flex flex-col gap-2 border-b-[1.5px] border-line px-3 pt-2 pb-3">
              <div role="group" aria-label="Show" className="-mx-3 flex gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {TABS.map(([t, label]) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tab === t}
                    onClick={() => choose(t)}
                    className={`flex min-h-11 flex-none items-center gap-1.5 border-b-2 px-2.5 text-small whitespace-nowrap ${tab === t ? "border-accent font-semibold text-ink" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}
                  >
                    {label}
                    {list.data && <span className="font-normal text-ink-2 tabular-nums">{count(t)}</span>}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search applications"
                placeholder="Search applications"
                className="h-11 w-full rounded-input border-[1.5px] border-line-strong bg-bg px-3 text-body text-ink placeholder:text-ink-2"
              />
            </div>
            {!list.data ? (
              <ul aria-label="Loading your applications" className="flex flex-col gap-1.5 p-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i} aria-hidden="true" className="h-[72px] animate-pulse rounded-row bg-tint" />
                ))}
              </ul>
            ) : shown.length ? (
              <ul aria-label="Applications" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
                {shown.map((r) => (
                  <Row key={r.application.id} row={r} open={r.application.id === openId} onPick={pick} />
                ))}
              </ul>
            ) : (
              <p className="m-3 rounded-card border-[1.5px] border-dashed border-line px-4 py-6 text-center text-ink-2">{q ? "No applications match that." : "Nothing here right now."}</p>
            )}
          </>
        }
        detail={
          openId ? (
            <Detail key={openId} id={openId} row={openRow} heading={heading} />
          ) : (
            <p className="m-auto p-6 text-center text-ink-2">{list.data ? "Pick an application to see where it is." : ""}</p>
          )
        }
      />
    );
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-4 pb-24 tablet:px-8 tablet:pb-12 laptop:h-svh laptop:px-10 laptop:pt-7 laptop:pb-8">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">Applications</h1>
      </PageHead>
      {body}
    </main>
  );
}
