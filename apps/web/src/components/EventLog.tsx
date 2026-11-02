"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CircleX, TriangleAlert } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { RunEventRow } from "@/lib/types";
import { Icon } from "./Icon";
import { cx } from "./cx";

const levelClass = { info: "text-ink-2", warn: "text-attn-fg", error: "text-danger-fg" } as const;

/**
 * Run log: named steps with times, newest last. Shows the last `collapsedTo` lines until "Show all".
 * Announces new lines politely to screen readers.
 */
export function EventLog({ events, mode, collapsedTo = 5 }: {
  events: RunEventRow[]; mode: "live" | "polling" | "simulated" | "idle"; collapsedTo?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, all]);

  const modeLabel = { live: "live", polling: "checking every few seconds", simulated: "simulated", idle: "finished" }[mode];
  const active = mode === "live" || mode === "simulated" || mode === "polling";
  const shown = all ? events : events.slice(-collapsedTo);
  const hidden = events.length - shown.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-body-sm font-semibold text-ink">
          Run log
          <span className="inline-flex items-center gap-1.5 text-meta font-normal text-muted">
            {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />}
            {modeLabel}
          </span>
        </span>
        {(hidden > 0 || all) && events.length > collapsedTo && (
          <button type="button" onClick={() => setAll((a) => !a)} className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink">
            {all ? "Show less" : `Show all ${events.length}`}
            <Icon icon={all ? ChevronUp : ChevronDown} size={14} />
          </button>
        )}
      </div>
      <div ref={ref} className={cx("rounded-control bg-sunken px-3 py-2", all && "max-h-96 overflow-y-auto")} aria-live="polite">
        {events.length === 0 && <div className="py-1 text-meta text-muted">Waiting for the first step<span className="dots" /></div>}
        {shown.map((e, i) => (
          <div key={e.id ?? `${e.ts}-${i}`} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 py-1">
            <span className="font-mono text-[11.5px] leading-5 text-muted tnum">{formatTime(e.ts).slice(0, 5)}</span>
            <span className={cx("flex min-w-0 items-start gap-1.5 break-words text-meta", levelClass[e.level])} title={e.step}>
              {e.level === "error" && <Icon icon={CircleX} size={14} className="mt-[3px]" />}
              {e.level === "warn" && <Icon icon={TriangleAlert} size={14} className="mt-[3px]" />}
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
