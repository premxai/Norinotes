"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/Button";
import { api, type ApplicationRow, type OutcomeKind, type OutcomeStats, type Outcomes } from "@/lib/api";
import {
  CHIP, GROUP_OF, GROUPS, addDays, dayKey, describeDay, isMoving, marksByDay, mondayOf, rowLine, rowState, type Group, type Mark, type RowState,
} from "@/lib/app-state";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { useOutcomes } from "@/lib/use-outcomes";
import { CompanyLogo } from "./CompanyLogo";
import { PageHead } from "./PageHead";

/* /applications (4b spec section 3): the week strip, the numbers, the filter tabs and every application. */

const DOT: Record<Mark, string> = { sent: "bg-line-strong", reply: "bg-accent", interview: "bg-peach", rejection: "bg-danger" };
const DOT_ORDER: Mark[] = ["interview", "reply", "rejection", "sent"];
const URL_OF: Record<Group, string> = { all: "", in_progress: "in-progress", sent: "sent", replied: "replied", closed: "closed" };
const SEEN_KEY = "norinote-last-seen-outcomes";

export function StateChip({ state }: { state: RowState }) {
  const c = CHIP[state];
  return <span className={`inline-flex h-[26px] flex-none items-center rounded-full px-2.5 text-[0.75rem] font-medium whitespace-nowrap ${c.className}`}>{c.label}</span>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayName = (d: Date, style: "short" | "long") => d.toLocaleDateString("en-GB", { weekday: style });
const monthName = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
const span = (from: Date, to: Date) =>
  from.getMonth() === to.getMonth()
    ? `${from.getDate()}–${to.getDate()} ${to.toLocaleDateString("en-GB", { month: "short" })}`
    : `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

function ResultLine({ s }: { s: OutcomeStats }) {
  const counts = [plural(s.applications, "sent", "sent"), plural(s.responses, "reply", "replies"), plural(s.interviews, "interview", "interviews"), ...(s.offers ? [plural(s.offers, "offer", "offers")] : [])];
  const median = s.medianDaysToFirstReply;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[1.125rem] font-semibold text-ink tabular-nums">{counts.join(" · ")}</p>
      <p className="text-small text-ink-2 tabular-nums tablet:text-[0.9375rem]">
        {s.smallSample || s.responseRate === null
          ? "Rates show once 5 applications have had an answer or 30 days."
          : [`Response rate ${Math.round(s.responseRate * 100)}%`, ...(median !== null ? [`Median ${median} ${median === 1 ? "day" : "days"} to a first reply`] : [])].join(" · ")}
      </p>
    </div>
  );
}

function WeekStrip({ offset, minOffset, onOffset, day, onDay, marks }: {
  offset: number;
  minOffset: number;
  onOffset: (n: number) => void;
  day: string | null;
  onDay: (d: string | null) => void;
  marks: ReturnType<typeof marksByDay>;
}) {
  const now = new Date();
  const today = dayKey(now);
  const monday = addDays(mondayOf(now), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const arrow = "grid size-11 place-items-center rounded-full text-[1.25rem] text-ink hover:bg-tint disabled:opacity-35 disabled:hover:bg-transparent";
  return (
    // A fixed height (the skeleton's too), so nothing moves when the data arrives; the legend sits at the foot.
    <section aria-labelledby="week-title" className="flex h-[212px] flex-col rounded-card border-[1.5px] border-line bg-surface p-3.5 tablet:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="week-title" className="text-[1.0625rem] font-semibold text-ink">
          {offset === 0 ? "This week" : offset === -1 ? "Last week" : "Week of"} <span className="font-normal text-ink-2">· {span(days[0]!, days[6]!)}</span>
        </h2>
        <div className="flex">
          <button type="button" aria-label="Previous week" disabled={offset <= minOffset} onClick={() => onOffset(offset - 1)} className={arrow}>
            ‹
          </button>
          <button type="button" aria-label="Next week" disabled={offset >= 0} onClick={() => onOffset(offset + 1)} className={arrow}>
            ›
          </button>
        </div>
      </div>
      <div role="group" aria-label="Days of the week" className="mt-3 grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 tablet:gap-1.5">
        {days.map((d) => {
          const k = dayKey(d);
          const list = marks.get(k) ?? [];
          const dots = [...list].sort((a, b) => DOT_ORDER.indexOf(a.mark) - DOT_ORDER.indexOf(b.mark));
          const future = k > today;
          const on = day === k;
          return (
            <button
              key={k}
              type="button"
              disabled={future}
              aria-pressed={on}
              onClick={() => onDay(on ? null : k)}
              className={`flex min-h-[76px] flex-col items-center justify-start gap-1 rounded-[12px] px-0.5 pt-2 pb-2 text-center disabled:opacity-40 ${on ? "bg-ink text-bg" : "text-ink hover:bg-tint"} ${k === today && !on ? "outline-[1.5px] -outline-offset-[1.5px] outline-ink outline-solid" : ""}`}
            >
              <span className={`text-[0.75rem] ${on ? "" : "text-ink-2"}`}>{dayName(d, "short")}</span>{" "}
              <span className="text-[1rem] font-semibold tabular-nums">{d.getDate()}</span>
              <span className="sr-only">
                {" "}
                {monthName(d)}: {describeDay(list)}
                {k === today ? ", today" : ""}
              </span>
              <span aria-hidden="true" className="mt-0.5 flex h-2.5 flex-wrap justify-center gap-[3px]">
                {dots.slice(0, 4).map((m, i) => (
                  <span key={i} className={`size-2 rounded-full tablet:size-2.5 ${DOT[m.mark]} ${on ? "ring-1 ring-bg" : ""}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <ul aria-hidden="true" className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3 text-[0.75rem] text-ink-2">
        {(["sent", "reply", "interview", "rejection"] as Mark[]).map((m) => (
          <li key={m} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${DOT[m]}`} />
            {m === "sent" ? "Sent" : m === "reply" ? "Reply or offer" : m === "interview" ? "Interview" : "Rejection"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ row, o }: { row: ApplicationRow; o: Outcomes | undefined }) {
  const a = row.application;
  const state = rowState(a, o);
  return (
    <li>
      <Link
        href={`/applications/${a.id}`}
        className="flex min-h-[76px] items-center justify-between gap-3 rounded-card border-[1.5px] border-line bg-surface px-4 py-3.5 no-underline hover:border-line-strong tablet:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <CompanyLogo name={row.job.companyName} url={row.job.companyLogoUrl} />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-ink">
              {row.job.title} <span className="font-normal text-ink-2">· {row.job.companyName}</span>
            </span>
            <span className="mt-0.5 block truncate text-small text-ink-2">{rowLine(a, o, state)}</span>
          </span>
        </span>
        <StateChip state={state} />
      </Link>
    </li>
  );
}

export function Applications() {
  const list = usePolling("applications", api.applications, (rows) => (rows?.some((r) => isMoving(r.application)) ? 4000 : 30_000));
  const summary = usePolling("outcomes-summary", api.summary, 300_000);
  // Linked mail moves an application's outcomes on, so its newest message is part of the outcomes' stamp.
  const inbox = usePolling("inbox", api.inbox, 30_000);
  const stamps = new Map<string, string>();
  for (const m of inbox.data ?? []) if (m.applicationId && !stamps.has(m.applicationId)) stamps.set(m.applicationId, m.id);
  const { map, loaded } = useOutcomes(list.data, stamps);
  // The tab is kept in the URL (?show=replied), so Back and a shared link keep it. The tabs only render once the list has
  // loaded, so reading the URL here can't differ from the prerendered page.
  const [group, setGroup] = useState<Group>(() => {
    if (typeof window === "undefined") return "all";
    const show = new URLSearchParams(location.search).get("show");
    return (Object.keys(URL_OF) as Group[]).find((k) => URL_OF[k] === show) ?? "all";
  });
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  function choose(g: Group) {
    setGroup(g);
    const url = new URL(location.href);
    if (g === "all") url.searchParams.delete("show");
    else url.searchParams.set("show", URL_OF[g]);
    history.replaceState(history.state, "", url);
  }

  // The numbers follow the outcomes: fetched again once a change has loaded.
  const outcomeSig = [...map].map(([id, o]) => `${id}:${o.state}:${o.outcomes.length}`).join(",");
  const refreshSummary = summary.refresh;
  useEffect(() => {
    if (loaded && outcomeSig) void refreshSummary();
  }, [loaded, outcomeSig, refreshSummary]);

  // Nori: the most important outcome since the last visit, once (section 7). The first visit only sets the mark.
  const outcomeTimes = [...map.values()].flatMap((o) => o.outcomes.map((x) => `${x.at}|${x.kind}`)).join(",");
  useEffect(() => {
    if (!loaded) return;
    const all = outcomeTimes ? outcomeTimes.split(",").map((s) => ({ at: s.split("|")[0]!, kind: s.split("|")[1] as OutcomeKind })) : [];
    const newest = all.reduce((t, x) => (x.at > t ? x.at : t), "");
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
      if (newest && (!seen || newest > seen)) localStorage.setItem(SEEN_KEY, newest);
    } catch {
      return; // Storage blocked: no "since the last visit", so no reaction.
    }
    if (!seen) return;
    const fresh = new Set(all.filter((x) => x.at > seen).map((x) => x.kind));
    const kind = (["offer", "interview", "reply", "rejection"] as OutcomeKind[]).find((k) => fresh.has(k));
    if (kind) void noriReact({ event: kind, say: kind === "offer" ? "An offer!" : kind === "interview" ? "An interview!" : kind === "reply" ? "They replied!" : "On to the next one." });
  }, [loaded, outcomeTimes]);

  const rows = list.data ?? [];
  const states = new Map(rows.map((r) => [r.application.id, rowState(r.application, map.get(r.application.id))]));
  const marks = marksByDay(rows, map);
  const onDay = day ? new Set((marks.get(day) ?? []).map((m) => m.appId)) : null;
  const count = (g: Group) => (g === "all" ? rows.length : rows.filter((r) => GROUP_OF[states.get(r.application.id)!] === g).length);
  const shown = rows.filter((r) => (group === "all" || GROUP_OF[states.get(r.application.id)!] === group) && (!onDay || onDay.has(r.application.id)));
  const earliest = rows.reduce((t, r) => Math.min(t, Date.parse(r.application.createdAt)), now);
  const minOffset = Math.min(0, Math.round((mondayOf(new Date(earliest)).getTime() - mondayOf(new Date(now)).getTime()) / (7 * 86_400_000)));
  const offline = !list.data && !!list.error && list.status !== 401;
  const dayLabel = day ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";

  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pb-24 tablet:gap-5 tablet:px-8 tablet:pb-12 laptop:px-10 laptop:pt-7">
      <PageHead>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">Applications</h1>
      </PageHead>

      {offline ? (
        <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink">Couldn&rsquo;t reach Norinote</p>
          <p className="text-ink-2">Check your connection; this page tries again by itself.</p>
          <button type="button" onClick={() => void list.refresh()} className={buttonClass("outline", "mt-2 min-h-11")}>
            Try again
          </button>
        </div>
      ) : !list.data ? (
        <>
          {/* The same heights as what replaces them: the strip, the numbers' slot and the tabs. */}
          <div aria-hidden="true" className="h-[212px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
          <div aria-hidden="true" className="min-h-[68px] tablet:min-h-[52px]" />
          <div aria-hidden="true" className="h-10" />
          <ul aria-label="Loading your applications" className="flex flex-col gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} aria-hidden="true" className="h-[76px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
            ))}
          </ul>
        </>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink tablet:text-[1.75rem]">Nothing sent yet</p>
          <p className="text-ink-2">Applications you send from Today show up here.</p>
          <Link href="/today" className={buttonClass("outline", "mt-2 min-h-11")}>
            Go to Today
          </Link>
        </div>
      ) : (
        <>
          <WeekStrip offset={offset} minOffset={minOffset} onOffset={(n) => (setOffset(n), setDay(null))} day={day} onDay={setDay} marks={marks} />
          {/* A slot as tall as the numbers can be, so they don't push the list down when they arrive. */}
          <div className="min-h-[68px] tablet:min-h-[52px]">{summary.data && summary.data.overall.applications > 0 && <ResultLine s={summary.data.overall} />}</div>

          <div role="group" aria-label="Show" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:flex-wrap tablet:px-0 [&::-webkit-scrollbar]:hidden">
            {GROUPS.map((g) => {
              const known = g.id === "all" || g.id === "in_progress" || loaded;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={group === g.id}
                  onClick={() => choose(g.id)}
                  className={`flex h-10 flex-none items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-small font-medium ${group === g.id ? "border-ink bg-ink text-bg" : "border-line-strong text-ink hover:bg-tint"}`}
                >
                  {g.label}
                  {known && <span className={`tabular-nums ${group === g.id ? "" : "text-ink-2"}`}>{count(g.id)}</span>}
                </button>
              );
            })}
          </div>

          {day && (
            <button type="button" onClick={() => setDay(null)} className="-mt-1 min-h-10 self-start text-small font-semibold text-ink underline underline-offset-[3px]">
              Clear {dayLabel}
            </button>
          )}

          {shown.length ? (
            <ul aria-label="Applications" className="flex flex-col gap-2.5">
              {shown.map((r) => (
                <Row key={r.application.id} row={r} o={map.get(r.application.id)} />
              ))}
            </ul>
          ) : (
            <p className="rounded-card border-[1.5px] border-dashed border-line px-4 py-6 text-center text-ink-2">
              {group !== "all" && !loaded ? "Loading what happened…" : day ? `Nothing here for ${dayLabel}.` : "Nothing here right now."}
            </p>
          )}
        </>
      )}
    </main>
  );
}
