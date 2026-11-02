"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { appUpdatedAt, FAILED, IN_FLIGHT, NEEDS_YOU, SUBMITTED } from "@/lib/format";
import type { ApplicationListItem } from "@/lib/types";
import { Monogram } from "./Monogram";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";
import { EmptyState, Icon, cx } from "./ui";

type Filter = { id: string; label: string; match: (i: ApplicationListItem) => boolean };

const FILTERS: Filter[] = [
  { id: "all", label: "All", match: () => true },
  { id: "needs", label: "Waiting on you", match: (i) => NEEDS_YOU.includes(i.application.status) },
  { id: "flight", label: "In progress", match: (i) => IN_FLIGHT.includes(i.application.status) },
  { id: "sent", label: "Sent", match: (i) => SUBMITTED.includes(i.application.status) },
  { id: "failed", label: "Failed", match: (i) => FAILED.includes(i.application.status) },
];

function nextStep(i: ApplicationListItem): string {
  const a = i.application;
  if (a.status === "prepared") return "Review and send";
  if (a.status === "needs_user") return `Answer ${a.pendingQuestions.length || "a"} question${a.pendingQuestions.length === 1 ? "" : "s"}`;
  if (IN_FLIGHT.includes(a.status)) return "Norinote is on it";
  if (a.status === "failed") return "Try again";
  return "Wait for a reply";
}

const updated = (i: ApplicationListItem) => +new Date(appUpdatedAt(i.application) ?? 0);

export function ApplicationsView({ items }: { items: ApplicationListItem[] }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, items.filter(f.match).length])), [items]);
  const active = FILTERS.find((f) => f.id === filter)!;
  const term = q.trim().toLowerCase();
  const rows = items
    .filter(active.match)
    .filter((i) => !term || `${i.job.title} ${i.job.companyName}`.toLowerCase().includes(term))
    .sort((a, b) => Number(NEEDS_YOU.includes(b.application.status)) - Number(NEEDS_YOU.includes(a.application.status)) || updated(b) - updated(a));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search applications</span>
          <Icon icon={Search} size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or title" className="h-10 w-full rounded-control border border-control bg-surface pl-9 pr-3 text-body-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
        </label>
      </div>

      <div role="group" aria-label="Filter by stage" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0 || f.id === filter).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
              filter === f.id ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-ink-2 hover:border-control",
              f.id === "needs" && filter !== f.id && "border-attn text-attn-fg",
            )}
          >
            {f.label}
            <span className={cx("tnum", filter === f.id ? "text-on-ink/80" : "text-muted")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={items.length === 0 ? "No applications yet" : "Nothing in this view"}>
          {items.length === 0 ? <>Apply to a job from your <Link href="/dashboard" className="font-medium text-accent underline-offset-4 hover:underline">shortlist</Link> or from <Link href="/jobs" className="font-medium text-accent underline-offset-4 hover:underline">Jobs</Link>.</> : "Try another filter."}
        </EmptyState>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Next step</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((i) => {
                  const waiting = NEEDS_YOU.includes(i.application.status);
                  return (
                    <tr key={i.application.id} className={cx("hover:bg-sunken/50", waiting && "bg-attn-tint/30")}>
                      <td className="px-4 py-3">
                        <Link href={`/applications/${i.application.id}`} className="group flex min-w-0 items-center gap-3">
                          <Monogram name={i.job.companyName} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink underline-offset-4 group-hover:underline">{i.job.title}</span>
                            <span className="block truncate text-meta text-muted">{i.job.companyName}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3"><StatusPill status={i.application.status} /></td>
                      <td className={cx("px-3 py-3 text-meta", waiting ? "font-semibold text-attn-fg" : "text-ink-2")}>{nextStep(i)}</td>
                      <td className="px-4 py-3 text-right text-meta text-muted"><TimeAgo iso={appUpdatedAt(i.application)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* phone cards */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {rows.map((i) => {
              const waiting = NEEDS_YOU.includes(i.application.status);
              return (
                <li key={i.application.id}>
                  <Link href={`/applications/${i.application.id}`} className={cx("flex flex-col gap-1.5 rounded-card border bg-surface p-3.5", waiting ? "border-2 border-attn" : "border-line")}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{i.job.title}</span>
                        <span className="block truncate text-meta text-muted">{i.job.companyName}</span>
                      </span>
                      <StatusPill status={i.application.status} />
                    </div>
                    <p className={cx("text-meta", waiting ? "font-semibold text-attn-fg" : "text-ink-2")}>{nextStep(i)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
