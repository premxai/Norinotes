"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Application, type RunEvent } from "@/lib/api";
import { isCancelled } from "@/lib/app-state";

/*
 * "Watch Nori apply": where the run is (a stage bar from the status and run events) and the employer's page as Nori sees
 * it (GET /applications/:id/live, about a frame a second while it applies or waits for a code; the last frame stays
 * about 15 minutes after the run). The frames show the person's own details, so there's nothing to share or download.
 */

const ACTIVE: Application["status"][] = ["applying", "awaiting_code"];

/** Polls the live frame every second while `active`; once when it isn't, for the run's last frame. */
function useLiveFrame(id: string, active: boolean, started: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!started) return;
    let live = true;
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) {
        const blob = await api.liveFrame(id);
        if (!live) return;
        // A 404 or a dropped request keeps the last good frame.
        if (blob) {
          const next = URL.createObjectURL(blob);
          if (shown.current) URL.revokeObjectURL(shown.current);
          shown.current = next;
          setUrl(next);
        }
      }
      if (live && active) timer = window.setTimeout(() => void tick(), 1000);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, active, started]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  return url;
}

type Stage = { label: string; state: "done" | "now" | "next" | "needs" | "failed"; note?: string };

/** Where an emailed code came from, as the run log says it (never the code itself). */
export const codeSource = (message: string) =>
  /^Found the code in your Gmail/i.test(message) ? "Code from your Gmail" : /^Using the code you typed/i.test(message) ? "Code you typed" : /^Code received by email/i.test(message) ? "Code from your inbox" : null;

/** Tailoring resume → Filling the form → Submitting → (Waiting for code, when one was asked) → Sent. */
function stagesOf(a: Application, events: RunEvent[]): Stage[] | null {
  if (a.status === "prepared" || isCancelled(a)) return null;
  const submitting = events.some((e) => e.step === "submit");
  const code = a.status === "awaiting_code" || events.some((e) => e.step === "verification") || a.receipt?.awaitingCode === true || a.receipt?.codeMissing === true;
  const labels = ["Tailoring resume", "Filling the form", "Submitting", ...(code ? ["Waiting for code"] : []), "Sent"];
  const at =
    a.status === "queued" || a.status === "preparing" ? 0
    : a.status === "applying" ? (submitting ? 2 : 1)
    : a.status === "awaiting_code" ? 3
    : a.status === "submitted" ? labels.length
    : a.status === "needs_user" && a.receipt?.codeMissing === true ? 3
    : submitting ? 2
    : a.approvedAt ? 1
    : 0;
  const stop = a.status === "needs_user" ? "needs" : a.status === "failed" ? "failed" : null;
  const source = events.map((e) => codeSource(e.message)).filter(Boolean).at(-1) ?? undefined;
  return labels.map((label, i) => ({ label, state: i < at ? "done" : i === at ? (stop ?? "now") : "next", note: label === "Waiting for code" && i < at ? source : undefined }));
}

const MARK: Record<Stage["state"], string> = { done: "✓", now: "•", next: "", needs: "!", failed: "×" };
const TONE: Record<Stage["state"], string> = {
  done: "border-accent bg-accent text-on-accent",
  now: "border-ink bg-surface text-ink",
  next: "border-line bg-surface text-ink-2",
  needs: "border-warning bg-surface text-warning",
  failed: "border-danger bg-surface text-danger",
};
const SUFFIX: Partial<Record<Stage["state"], string>> = { needs: " · needs you", failed: " · stopped" };

/** The stage bar, then the live frame with `children` (the run log) beside it on the application's page, below it in the panel. */
export function WatchNori({ application: a, events, wide = false, children }: { application: Application; events: RunEvent[]; wide?: boolean; children: ReactNode }) {
  const active = ACTIVE.includes(a.status);
  const url = useLiveFrame(a.id, active, active || !!a.approvedAt);
  const stages = stagesOf(a, events);
  return (
    <>
      {stages && (
        <ol aria-label="Where the run is" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => (
            <li key={s.label} aria-current={s.state === "now" ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center">
              {i > 0 && <span aria-hidden="true" className={`absolute top-[11px] right-1/2 h-[2px] w-full ${s.state === "next" ? "bg-line" : "bg-accent"}`} />}
              <span aria-hidden="true" className={`relative grid size-6 place-items-center rounded-full border-2 text-[0.75rem] font-bold ${TONE[s.state]}`}>
                {MARK[s.state]}
              </span>
              <span className={`text-[0.75rem] leading-[1.25] ${s.state === "next" ? "text-ink-2" : "font-semibold text-ink"}`}>
                {s.label}
                {SUFFIX[s.state] && <span className={s.state === "needs" ? "text-warning" : "text-danger"}>{SUFFIX[s.state]}</span>}
              </span>
              {s.note && <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-accent">{s.note}</span>}
            </li>
          ))}
        </ol>
      )}
      {active || url ? (
        <div className={wide ? "grid gap-4 laptop:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] laptop:items-start" : "flex flex-col gap-4"}>
          <figure className="m-0 flex flex-col gap-1.5">
            <figcaption className="flex items-center gap-2 text-small font-semibold text-ink">
              {active && <span aria-hidden="true" className="size-2 rounded-full bg-accent shadow-[0_0_0_4px] shadow-accent/20" />}
              {active ? "Watch Nori apply" : "The employer’s page when the run ended"}
            </figcaption>
            {/* 16:10, the frames' shape, so nothing moves when the first one arrives. */}
            <div className="relative aspect-[16/10] overflow-hidden rounded-[12px] border-[1.5px] border-line bg-surface-2">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched frame; next/image has nothing to optimise
                <img src={url} alt="The employer’s application page, as Nori sees it" draggable={false} className="absolute inset-0 size-full object-contain" />
              ) : (
                <p className="absolute inset-0 m-0 grid place-items-center text-small text-ink-2">Opening the employer&rsquo;s page…</p>
              )}
            </div>
          </figure>
          {children}
        </div>
      ) : (
        children
      )}
    </>
  );
}
