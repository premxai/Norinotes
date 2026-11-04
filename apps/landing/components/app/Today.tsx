"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { FormError } from "@/components/auth/fields";
import { Scene } from "@/components/Scene";
import { api, type Application, type ShortlistEntry } from "@/lib/api";
import { noriReact } from "@/lib/auth-flow";
import { usePolling } from "@/lib/use-polling";
import { usePanel } from "./AppShell";
import { STATUS_LABEL } from "./LivePanel";

/* /today (4a spec section 8): the greeting, the day line, what needs you, and today's job cards. */

const WAITING: Application["status"][] = ["prepared", "needs_user"];
const MOVING: Application["status"][] = ["queued", "preparing", "applying", "awaiting_code"];
const UNDO_MS = 5000;

function ago(iso: string | null) {
  if (!iso) return null;
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  if (h < 1) return "posted just now";
  if (h < 24) return `posted ${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `posted ${d} ${d === 1 ? "day" : "days"} ago`;
}

const place = (e: ShortlistEntry) => (e.job.remote && !e.job.location ? "Remote" : (e.job.location ?? (e.locationNames[0] || "")));

function Strip({ night }: { night: boolean }) {
  // Light: the landing footer's hills; dark, and after 6 pm: the night strip. Below 1024 px Nori stands in its
  // bottom-right corner, all of it inside the strip (80 px Nori in 112 px on phones, 112 px Nori in 132 px on tablets).
  const scene = (id: "footer" | "night", className: string) => (
    <div className={`relative h-[112px] overflow-hidden rounded-card tablet:h-[132px] tablet:rounded-[20px] laptop:h-[112px] ${className}`}>
      <Scene id={id} position="50% 60%" sizes="(min-width: 1024px) 960px, 100vw" />
      <div data-nori-seat="strip" className="pointer-events-none absolute right-12 bottom-3 size-px tablet:right-16 laptop:hidden" />
    </div>
  );
  return night ? scene("night", "") : (
    <>
      {scene("footer", "theme-light-only")}
      {scene("night", "theme-dark-only")}
    </>
  );
}

function Card({ e, app, onApply, onOpen, onDismiss }: { e: ShortlistEntry; app?: Application; onApply: () => void; onOpen: () => void; onDismiss: () => void }) {
  const name = `${e.job.title} at ${e.job.companyName}`;
  return (
    <li className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-line bg-surface p-4 tablet:px-5 tablet:py-[18px]">
      <div className="flex items-start justify-between gap-3 tablet:gap-4">
        {/* Its name is what it shows (voice control users say what they see), with the fit added for screen readers. */}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-[1.0625rem] font-semibold text-ink tablet:text-[1.125rem]">{e.job.title}</span>
          <span className="mt-1 block text-[0.8125rem] text-ink-2 tablet:text-small">{[e.job.companyName, place(e), ago(e.job.postedAt)].filter(Boolean).join(" · ")}</span>
          <span className="sr-only">, fit {e.fit.toFixed(2)}</span>
        </button>
        {/* Geist with tabular figures, not Mono: the mono font (70 KB) would load on every first screen. */}
        <p aria-hidden="true" className="text-[1.125rem] font-semibold text-ink tabular-nums tablet:text-[1.25rem]">
          {e.fit.toFixed(2)}
        </p>
      </div>
      {e.reasons.slice(0, 2).map((r) => (
        <p key={r} className="flex gap-2 text-small leading-[1.45] text-ink-2">
          <span aria-hidden="true" className="text-accent">
            ●
          </span>
          {r}
        </p>
      ))}
      <div className="flex items-center gap-3.5 pt-1">
        {app ? (
          <>
            <span className="rounded-full bg-tint px-2.5 py-1 text-[0.75rem] font-medium text-ink">{STATUS_LABEL[app.status]}</span>
            <button type="button" onClick={onOpen} className="min-h-11 px-0.5 text-small font-medium text-ink underline underline-offset-[3px]">
              Watch
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onApply} aria-label={`Apply to ${name}`} className={buttonClass("primary", "min-h-11 max-tablet:flex-1")}>
              Apply
            </button>
            <button type="button" onClick={onDismiss} className="min-h-11 px-0.5 text-small font-medium text-ink underline underline-offset-[3px]">
              Not for me
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function Today() {
  const { open, panel, setNeedsYou } = usePanel();
  const list = usePolling("shortlist", api.shortlist, 30_000);
  const meta = usePolling("shortlist-meta", api.shortlistMeta, 300_000);
  // Faster while anything is moving, so each card's chip keeps up with the live panel.
  const apps = usePolling("applications", api.applications, (rows) => (rows?.some((r) => MOVING.includes(r.application.status)) ? 4000 : 30_000));
  const agent = usePolling("agent-today", api.agentStatus, 30_000);
  const me = usePolling("me-today", api.me, 300_000);
  const [hidden, setHidden] = useState<string[]>([]);
  const [undo, setUndo] = useState<string | null>(null);
  const dismissTimers = useRef(new Map<string, number>());
  const [failure, setFailure] = useState<string | null>(null);
  const [hour] = useState(() => new Date().getHours());

  // Refresh the list when the panel closes or changes, so the cards' chips follow what happened.
  const refreshApps = apps.refresh;
  useEffect(() => {
    void refreshApps();
  }, [panel, refreshApps]);

  const entries = (list.data ?? []).filter((e) => !hidden.includes(e.jobId));
  const byJob = new Map<string, Application>();
  for (const row of apps.data ?? []) if (!byJob.has(row.application.jobId)) byJob.set(row.application.jobId, row.application);
  const waiting = (apps.data ?? []).filter((r) => WAITING.includes(r.application.status)).map((r) => r.application.id);
  // Highest fit first; anything already sent sinks to the bottom with its chip.
  const cards = [...entries].sort((a, b) => Number(byJob.get(a.jobId)?.status === "submitted") - Number(byJob.get(b.jobId)?.status === "submitted") || b.fit - a.fit);
  const fresh = cards.filter((e) => !byJob.has(e.jobId));
  const anyWaiting = waiting.length > 0;
  useEffect(() => setNeedsYou(anyWaiting), [anyWaiting, setNeedsYou]);
  const evening = hour >= 18;
  const first = (me.data?.profile.fullName ?? me.data?.user.name ?? "").split(/\s+/)[0];
  const greeting = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${first ? `, ${first}` : ""}`;
  const cap = agent.data?.dailyCap ?? 0;
  const used = agent.data?.usedToday ?? 0;
  const dayLine = [fresh.length ? `${fresh.length} for today` : null, waiting.length ? `${waiting.length} needs you` : null, cap > 0 ? `${used} of ${cap} sent today` : used ? `${used} sent today` : null].filter(Boolean).join(" · ");

  // Nori: a wave with the count once a day when new jobs are in; asleep on a quiet evening (section 10).
  const newCount = fresh.length;
  useEffect(() => {
    if (!newCount) return;
    const day = new Date().toDateString();
    try {
      if (localStorage.getItem("norinote-shortlist-ready") === day) return;
      localStorage.setItem("norinote-shortlist-ready", day);
    } catch {
      // Storage blocked: Nori waves on each visit.
    }
    void noriReact({ event: "shortlist-ready", say: `${newCount} ${newCount === 1 ? "job fits" : "jobs fit"} you today.` });
  }, [newCount]);
  const quiet = evening && !newCount && !waiting.length && !!list.data;
  useEffect(() => {
    if (!quiet) return;
    const t = window.setTimeout(() => void noriReact({ row: "sleep" }), 20_000);
    return () => clearTimeout(t);
  }, [quiet]);

  async function applyTo(jobIds: string[]) {
    setFailure(null);
    const ids: string[] = [];
    for (const jobId of jobIds) {
      const r = await api.apply(jobId);
      if (r.ok) ids.push(r.data.id);
      else setFailure(r.error);
    }
    void apps.refresh();
    if (ids.length) open({ kind: "apps", ids, index: 0 });
  }

  function dismiss(jobId: string) {
    setHidden((h) => [...h, jobId]);
    setUndo(jobId);
    // The API has no un-dismiss, so it's told only once Undo has had its 5 seconds.
    dismissTimers.current.set(
      jobId,
      window.setTimeout(() => {
        dismissTimers.current.delete(jobId);
        void api.dismiss(jobId);
        setUndo((u) => (u === jobId ? null : u));
      }, UNDO_MS),
    );
  }
  function undoDismiss() {
    if (!undo) return;
    clearTimeout(dismissTimers.current.get(undo));
    dismissTimers.current.delete(undo);
    setHidden((h) => h.filter((x) => x !== undo));
    setUndo(null);
  }
  // Leaving the page doesn't lose a dismissal: whatever is still waiting is sent.
  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      for (const [jobId, t] of timers) {
        clearTimeout(t);
        void api.dismiss(jobId);
      }
    };
  }, []);

  const offline = !list.data && !!list.error && list.status !== 401;
  const empty = list.data && !cards.length && !waiting.length;
  const firstMorning = empty && (apps.data?.length ?? 0) === 0;
  const allDone = list.data && cards.length > 0 && !fresh.length && !waiting.length;

  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pt-[18px] pb-24 tablet:gap-5 tablet:px-8 tablet:pt-7 tablet:pb-12 laptop:px-10">
      <div className="flex flex-col gap-1 tablet:gap-1.5">
        <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">{greeting}</h1>
        <p className="text-small text-ink-2 tablet:text-body">{list.data ? dayLine || "Nothing waiting on you" : " "}</p>
        {meta.data && meta.data.widened.length > 0 && <p className="text-small text-ink-2">Showing similar roles while Nori looks for more.</p>}
      </div>
      <Strip night={evening} />

      {waiting.length > 0 && (
        <button type="button" onClick={() => open({ kind: "apps", ids: waiting, index: 0 })} className="flex items-center gap-3 rounded-[14px] border-2 border-warning bg-surface px-4 py-3.5 text-left text-small text-ink tablet:text-body">
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-warning" />
          <span className="flex-1">
            <b>Nori needs you</b> · {waiting.length} {waiting.length === 1 ? "application" : "applications"} waiting on you
          </span>
          <span className="font-semibold">Open</span>
        </button>
      )}

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
        <ul aria-label="Loading today's jobs" className="flex flex-col gap-3 tablet:gap-3.5">
          {[0, 1, 2].map((i) => (
            <li key={i} aria-hidden="true" className="h-[172px] animate-pulse rounded-card border-[1.5px] border-line bg-surface" />
          ))}
        </ul>
      ) : empty ? (
        <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-line bg-surface p-6">
          <p className="font-serif text-[1.5rem] text-ink tablet:text-[1.75rem]">{firstMorning ? "Nori is still finding your first jobs" : "Nothing new today"}</p>
          <p className="text-ink-2">{firstMorning ? "They'll be here as soon as they're in." : "Nori checks again overnight."}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[1.125rem] font-semibold text-ink tablet:text-[1.25rem]">{allDone ? "That's today done" : `${fresh.length} for today`}</h2>
            {fresh.length > 1 && (
              <button type="button" onClick={() => void applyTo(fresh.map((e) => e.jobId))} className={buttonClass("primary", "min-h-11")}>
                Send all {fresh.length}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-3 tablet:gap-3.5">
            {cards.map((e) => {
              const app = byJob.get(e.jobId);
              return (
                <Card
                  key={e.id}
                  e={e}
                  app={app}
                  onApply={() => void applyTo([e.jobId])}
                  onOpen={() => open(app ? { kind: "apps", ids: [app.id], index: 0 } : { kind: "job", entry: e })}
                  onDismiss={() => dismiss(e.jobId)}
                />
              );
            })}
          </ul>
        </>
      )}

      {undo && (
        <div role="status" className="fixed bottom-20 left-1/2 z-[30] flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink py-1.5 pr-2 pl-4 text-small text-bg tablet:bottom-6">
          Hidden from today.
          <button type="button" onClick={undoDismiss} className="min-h-10 px-2 font-semibold underline underline-offset-[3px]">
            Undo
          </button>
        </div>
      )}
    </main>
  );
}
