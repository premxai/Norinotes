"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { api, type Application, type AppStatus, type JobListItem } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";
import { usePanel } from "./AppShell";
import { statusLabel } from "./LivePanel";
import { JobCard } from "./v2/JobCard";
import { StatusChip, type ChipTone } from "./v2/StatusChip";
import { Scene } from "@/components/Scene";

/* /overview (docs/dashboard-v2-plan.md section 1): the greeting over a header band of felt hills, four
   Recommended jobs as square cards with View all, and the applications sent per day over the last 6 months. Every number
   on it is the API's. */

const WAITING: AppStatus[] = ["prepared", "needs_user"];
const MOVING: AppStatus[] = ["queued", "preparing", "applying", "awaiting_code"];
const DAYS = 182;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Less to more: the accent mixed into the empty square's tint (theme tokens, so dark mode follows). */
const HEAT = [0, 30, 55, 80, 100].map((p) => (p ? `color-mix(in srgb, var(--color-accent) ${p}%, var(--color-tint))` : "var(--color-tint)"));
const level = (n: number) => (n <= 0 ? 0 : n >= 4 ? 4 : n);

function ago(iso: string | null) {
  if (!iso) return null;
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const place = (r: JobListItem) => (r.job.remote && !r.job.location ? "Remote" : (r.job.location ?? r.locationNames?.[0] ?? null));

function tone(a: Application): { tone: ChipTone; busy: boolean } {
  if (a.status === "failed") return { tone: a.error === "Cancelled by you" ? "neutral" : "bad", busy: false };
  if (a.status === "submitted") return { tone: "done", busy: false };
  if (a.status === "needs_user") return { tone: "needs", busy: false };
  if (a.status === "prepared" || a.status === "awaiting_code") return { tone: "waiting", busy: false };
  return { tone: "working", busy: true };
}

/** "YYYY-MM-DD" as a local date, so no time zone moves it a day. */
const toDate = (d: string) => {
  const [y = 1970, m = 1, day = 1] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const dayLabel = (date: Date, sent: number) => `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}: ${sent ? `${sent} sent` : "nothing sent"}`;

function Recommended() {
  const router = useRouter();
  const { open, panel, setNeedsYou } = usePanel();
  // A few more than four, so jobs already applied to can step aside for fresh ones.
  const list = usePolling("overview-recommended", () => api.jobs({ view: "best", limit: 12 }), 300_000);
  const apps = usePolling("applications", api.applications, (rows) => (rows?.some((r) => MOVING.includes(r.application.status)) ? 4000 : 30_000));
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refreshApps = apps.refresh;
  useEffect(() => {
    void refreshApps();
  }, [panel, refreshApps]);

  const byJob = new Map<string, Application>();
  for (const r of apps.data ?? []) if (!byJob.has(r.application.jobId)) byJob.set(r.application.jobId, r.application);
  const anyWaiting = (apps.data ?? []).some((r) => WAITING.includes(r.application.status));
  useEffect(() => setNeedsYou(anyWaiting), [anyWaiting, setNeedsYou]);

  // Best first as the API sends them; anything already sent steps aside.
  const sent = (r: JobListItem) => byJob.get(r.job.id)?.status === "submitted" || r.applicationStatus === "submitted";
  const cards = [...(list.data ?? [])].sort((a, b) => Number(sent(a)) - Number(sent(b))).slice(0, 4);

  async function apply(jobId: string) {
    setFailure(null);
    setBusy(jobId);
    const r = await api.apply(jobId);
    setBusy(null);
    if (!r.ok) return setFailure(r.error);
    void apps.refresh();
    open({ kind: "apps", ids: [r.data.id], index: 0 });
  }

  const offline = !list.data && !!list.error && list.status !== 401;
  // Phones: a row that scrolls sideways. From 768 px a grid by the page's own width (the live panel narrows it): two
  // across, three from 640 px (the fourth card waits), four from 940 px (a 1280 px window with the rail open, even with a scrollbar).
  const GRID =
    "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 max-tablet:-mx-4 max-tablet:px-4 max-tablet:scroll-px-4 tablet:grid tablet:grid-cols-2 tablet:gap-[18px] tablet:overflow-visible tablet:pb-0 @min-[640px]:grid-cols-3 @min-[940px]:grid-cols-4";
  const ITEM = "w-[min(78%,300px)] flex-none snap-start tablet:w-auto tablet:min-w-0";
  const FOURTH = "@min-[640px]:@max-[939px]:hidden";

  return (
    <section aria-labelledby="recommended" className="@container flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="recommended" className="text-[1.25rem] font-bold tracking-[-0.01em] text-ink tablet:text-[1.5rem]">
          Recommended for you
        </h2>
        <Link href="/jobs" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent hover:underline hover:underline-offset-[3px]">
          View all
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
      {failure && <FormError>{failure}</FormError>}
      {offline ? (
        <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
          <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
          <button type="button" onClick={() => void list.refresh()} className={buttonClass("outline", "mt-2 min-h-11")}>
            Try again
          </button>
        </div>
      ) : !list.data ? (
        <ul aria-label="Loading recommended jobs" className={GRID}>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} aria-hidden="true" className={`${ITEM} ${i === 3 ? FOURTH : ""}`}>
              <div className="aspect-square animate-pulse rounded-[26px] border-[1.5px] border-line bg-surface" />
            </li>
          ))}
        </ul>
      ) : !cards.length ? (
        <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">No recommended jobs right now</p>
          <p className="text-ink-2">
            Nori adds them as new jobs that fit your roles come in. <Link href="/jobs" className="font-semibold text-ink underline underline-offset-[3px]">See every open job</Link>
          </p>
        </div>
      ) : (
        <ul data-overview-cards className={GRID}>
          {cards.map((r, i) => {
            const app = byJob.get(r.job.id);
            const t = app && tone(app);
            return (
              <li key={r.job.id} className={`${ITEM} ${i === 3 ? FOURTH : ""}`}>
                <JobCard
                  title={r.job.title}
                  company={r.job.companyName}
                  logoUrl={r.job.companyLogoUrl}
                  place={place(r)}
                  posted={ago(r.job.postedAt)}
                  fit={r.match?.score ?? null}
                  onOpen={() => (app ? open({ kind: "apps", ids: [app.id], index: 0 }) : router.push(`/jobs?job=${encodeURIComponent(r.job.id)}`))}
                  action={
                    app && t ? (
                      <button type="button" onClick={() => open({ kind: "apps", ids: [app.id], index: 0 })} aria-label={`${statusLabel(app)}: watch ${r.job.title} at ${r.job.companyName}`} className="rounded-full">
                        <StatusChip tone={t.tone} busy={t.busy}>
                          {statusLabel(app)}
                        </StatusChip>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === r.job.id}
                        onClick={() => void apply(r.job.id)}
                        aria-label={`Apply to ${r.job.title} at ${r.job.companyName}`}
                        className={buttonClass("primary", "min-h-11 flex-none rounded-full px-5")}
                      >
                        {busy === r.job.id ? "Starting…" : "Apply"}
                      </button>
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Activity() {
  const { panel } = usePanel();
  const [tz] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const data = usePolling(`overview-activity:${tz}`, () => api.activity(DAYS, tz), 300_000);
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // A run that finishes while the panel is open shows up on the graph once it closes.
  const refresh = data.refresh;
  useEffect(() => {
    if (!panel) void refresh();
  }, [panel, refresh]);

  const days = data.data?.days ?? [];
  // Weeks run Monday to Sunday; the first week is padded so each row is one weekday.
  const lead = days[0] ? (toDate(days[0].date).getDay() + 6) % 7 : 0;
  const weeks = Math.ceil((lead + days.length) / 7);
  const months: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const day = days[Math.max(0, w * 7 - lead)];
    if (!day) continue;
    const d = toDate(day.date);
    const label = MONTHS[d.getMonth()] ?? "";
    if (months.at(-1)?.label !== label && (w === 0 || d.getDate() <= 7)) months.push({ col: w + 1, label });
  }
  // The first label only when it has room before the next one.
  if (months[0] && months[1] && months[1].col - months[0].col < 3) months.shift();

  // Phones start at today, the right-hand end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && days.length) el.scrollLeft = el.scrollWidth;
  }, [days.length]);

  const total = data.data?.total ?? 0;
  const pickedDay = picked ? days.find((d) => d.date === picked) : null;

  return (
    <section aria-labelledby="activity" className="rounded-[26px] border-[1.5px] border-line bg-surface px-4 pt-5 pb-5 tablet:px-[26px] tablet:pt-[22px] tablet:pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="activity" className="text-[1.25rem] font-bold text-ink tablet:text-[1.375rem]">
          Your applications
        </h2>
        {data.data && (
          <p data-activity-total className="text-small text-ink-2 tablet:text-[0.9375rem]">
            <b className="text-ink">{total}</b> sent in the last 6 months
          </p>
        )}
      </div>
      {!data.data ? (
        data.error && data.status !== 401 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-small text-ink-2">
            Couldn&rsquo;t load your applications.
            <button type="button" onClick={() => void data.refresh()} className={buttonClass("outline", "min-h-11")}>
              Try again
            </button>
          </div>
        ) : (
          <div aria-hidden="true" className="mt-[18px] h-[150px] animate-pulse rounded-row bg-tint tablet:h-[174px]" />
        )
      ) : (
        <>
          <div ref={scroller} className="mt-[18px] flex gap-2 overflow-x-auto pb-1 [--cell:15px] tablet:[--cell:18px]">
            <div aria-hidden="true" className="sticky left-0 z-[1] grid flex-none grid-rows-[20px_repeat(7,var(--cell))] gap-y-1 bg-surface pr-1 text-[0.75rem] text-ink-2">
              <span />
              {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                <span key={i} className="leading-[var(--cell)]">
                  {d}
                </span>
              ))}
            </div>
            <div className="flex-none">
              <div aria-hidden="true" className="grid h-5 grid-cols-[repeat(var(--weeks),var(--cell))] gap-x-1 text-[0.75rem] text-ink-2" style={{ "--weeks": weeks } as React.CSSProperties}>
                {months.map((m) => (
                  <span key={m.col} className="whitespace-nowrap" style={{ gridColumn: `${m.col} / span 3` }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div
                role="img"
                aria-label={`${total} ${total === 1 ? "application" : "applications"} sent in the last 6 months`}
                data-activity-grid
                className="mt-1 grid grid-flow-col grid-rows-[repeat(7,var(--cell))] auto-cols-[var(--cell)] gap-1"
              >
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`pad${i}`} />
                ))}
                {days.map((d) => {
                  const label = dayLabel(toDate(d.date), d.sent);
                  return (
                    <span
                      key={d.date}
                      title={label}
                      data-sent={d.sent}
                      onClick={() => setPicked(d.date)}
                      className={`cursor-pointer rounded-[4px] tablet:rounded-[5px] ${picked === d.date ? "outline-2 outline-offset-1 outline-ink" : ""}`}
                      style={{ background: HEAT[level(d.sent)] }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-[0.8125rem] text-ink-2">
            <span aria-live="polite">{pickedDay ? dayLabel(toDate(pickedDay.date), pickedDay.sent) : total ? "Pick a day to see it." : "Nothing sent yet. Each application Nori sends adds to a day here."}</span>
            <span aria-hidden="true" className="flex items-center gap-1">
              Less
              {HEAT.map((c) => (
                <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />
              ))}
              More
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export function Overview() {
  const me = usePolling("me-overview", api.me, 300_000);
  const [now] = useState(() => new Date());
  const hour = now.getHours();
  const first = (me.data?.profile.fullName ?? me.data?.user.name ?? "").trim().split(/\s+/)[0];
  const greeting = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${first ? `, ${first}` : ""}`;
  const today = `${WEEKDAYS_LONG[now.getDay()]}, ${now.getDate()} ${MONTHS_LONG[now.getMonth()]}`;

  return (
    <main id="main" className="flex flex-col pb-24 tablet:pb-12">
      {/* The header band: felt hills behind the greeting (morning in light theme, night in dark), calm on the left where
          the words sit. Decorative, so the scenes are hidden from screen readers. */}
      <section aria-labelledby="hello" className="relative flex min-h-[132px] flex-col justify-end gap-1 overflow-hidden rounded-bl-[28px] bg-surface-2 pt-8 pr-28 pb-6 pl-4 tablet:min-h-[190px] tablet:gap-2 tablet:rounded-bl-[40px] tablet:pr-44 tablet:pb-8 tablet:pl-8 laptop:min-h-[230px] laptop:px-14 laptop:pb-10">
        <Scene id="overview-dawn" position="70% 55%" priority className="theme-light-only" />
        <Scene id="overview-night" position="70% 55%" className="theme-dark-only" />
        {/* A wash of the page colour on the left keeps the greeting and date readable over the hills. */}
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-r from-bg/90 via-bg/55 to-transparent tablet:via-bg/35" />
        <h1 id="hello" className="relative font-serif text-[2rem] leading-[1.05] text-ink tablet:text-[2.5rem] laptop:text-[3.125rem]">
          {greeting}
        </h1>
        <p className="relative text-small text-ink-2 tablet:text-body">{today}</p>
        {/* Nori's seat on the hilltop at the right (below 1024 px, or when the rail is folded); on the rail otherwise. */}
        <div aria-hidden="true" data-nori-seat="strip" className="pointer-events-none absolute right-10 bottom-4 size-px tablet:right-20 tablet:bottom-6 laptop:hidden" />
      </section>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7 px-4 pt-5 tablet:px-8 tablet:pt-[26px]">
        <Recommended />
        <Activity />
      </div>
    </main>
  );
}

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
