"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { ResumeChange } from "@/lib/types";
import { Icon } from "../Icon";
import { cx } from "../cx";

export type NodeInfo = { label: string; type: string; quote?: string | null };

/**
 * One tailored line: what it replaced (struck), the new line, its source as a button that opens a preview of the
 * fact it came from, and (when `onKeep` is given) a keep or revert control. Nothing here is decorative: every line must trace to a fact.
 */
export function ChangeCard({ change, nodes, kept = true, onKeep, disabled, selected, onSelect }: {
  change: ResumeChange;
  nodes: Record<string, NodeInfo>;
  kept?: boolean;
  /** When absent the card is read-only: no Keep or Revert control. */
  onKeep?: (keep: boolean) => void;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sources = change.nodeIds.map((id) => ({ id, ...(nodes[id] ?? { label: id, type: "fact" }) }));
  const sourceLabel = sources.length > 0 ? sources.map((s) => s.label).slice(0, 2).join(" · ") + (sources.length > 2 ? ` +${sources.length - 2}` : "") : "From your graph";
  return (
    <li
      className={cx("rounded-card border bg-surface p-3.5 transition-colors", selected ? "border-ink" : "border-line", !kept && "bg-sunken")}
      onClick={onSelect}
    >
      {change.before && change.before !== change.after && (
        <p className={cx("text-meta", kept ? "text-muted line-through decoration-control" : "text-ink")}>{change.before}</p>
      )}
      <p className={cx("mt-1 text-body-sm", kept ? "text-ink" : "text-muted line-through decoration-control")}>{change.after}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-control px-1 text-[12px] font-medium text-accent hover:bg-accent-tint"
        >
          <span className="truncate underline decoration-dotted underline-offset-4">Source: {sourceLabel}</span>
          <Icon icon={ChevronDown} size={14} className={cx("transition-transform", open && "rotate-180")} />
        </button>
        <div className="flex-1" />
        {onKeep && <div role="group" aria-label="This change" className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-pressed={kept}
            disabled={disabled}
            onClick={() => onKeep(true)}
            className={cx("h-8 rounded-l-control border px-3 text-[12px] font-semibold disabled:opacity-45", kept ? "border-ink bg-ink text-on-ink" : "border-control bg-surface text-ink hover:bg-sunken")}
          >
            Keep
          </button>
          <button
            type="button"
            aria-pressed={!kept}
            disabled={disabled}
            onClick={() => onKeep(false)}
            className={cx("-ml-px h-8 rounded-r-control border px-3 text-[12px] font-semibold disabled:opacity-45", !kept ? "border-ink bg-ink text-on-ink" : "border-control bg-surface text-ink hover:bg-sunken")}
          >
            Revert
          </button>
        </div>}
      </div>

      {open && (
        <div className="mt-2.5 flex flex-col gap-2 rounded-control bg-sunken p-3">
          {change.reason && <p className="text-meta text-ink-2">{change.reason}</p>}
          {sources.map((s) => (
            <div key={s.id} className="flex flex-col gap-0.5">
              <p className="text-meta"><span className="text-muted capitalize">{s.type}</span> <span className="font-semibold text-ink">{s.label}</span></p>
              {s.quote && <p className="text-meta text-muted">&ldquo;{s.quote}&rdquo;</p>}
              <Link href={`/graph?node=${encodeURIComponent(s.id)}`} className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-accent underline-offset-4 hover:underline">
                Open in graph <Icon icon={ArrowUpRight} size={12} />
              </Link>
            </div>
          ))}
          {sources.length === 0 && <p className="text-meta text-muted">This line reorders or trims what was already on your resume.</p>}
        </div>
      )}
    </li>
  );
}
