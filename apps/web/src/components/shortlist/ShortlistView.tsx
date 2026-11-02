"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import type { ShortlistItem } from "@/lib/types";
import { ApplyButton } from "../ApplyButton";
import { Monogram } from "../Monogram";
import { TimeAgo } from "../TimeAgo";
import { placeName, workMode } from "../jobMeta";
import { Button, EmptyState, Frame, Notice, cx } from "../ui";

/** One shortlisted job: who, what, where, how well it fits and why, then Apply or Dismiss. */
function ShortlistCard({ item, busy, onDismiss }: { item: ShortlistItem; busy: boolean; onDismiss: () => void }) {
  const { job } = item;
  const fit = pct(item.fit);
  const mode = workMode(job);
  const place = placeName(job.location) ?? (mode === "Remote" ? "Anywhere" : "Location not listed");
  const reasons = item.reasons.slice(0, 3);
  return (
    <li>
      <Frame as="article" className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
        <Monogram name={job.companyName} size={44} className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/jobs?job=${job.id}`} className="min-w-0 text-[15px] font-semibold text-ink underline-offset-4 hover:underline">{job.title}</Link>
            <span
              title={`${fit}% fit with your career graph`}
              className={cx("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold tnum", fit >= 70 ? "bg-accent-tint text-accent-fg" : "bg-sunken text-ink-2")}
            >
              {fit}% fit
            </span>
          </div>
          <p className="mt-0.5 text-meta text-muted">
            {job.companyName} · {place}{job.remote && mode !== "Remote" ? " · remote OK" : ""}
            {job.postedAt ? <> · posted <TimeAgo iso={job.postedAt} /></> : null}
          </p>
          {reasons.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5" aria-label="Why this fits">
              {reasons.map((r, i) => (
                <li key={`${i}-${r}`} className="flex items-start gap-2 text-body-sm text-ink-2">
                  <Check size={15} aria-hidden="true" className="mt-[3px] shrink-0 text-accent" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
          <ApplyButton jobId={job.id} size="md" label="Apply" />
          <Button variant="secondary" size="md" icon={X} onClick={onDismiss} disabled={busy}>Dismiss</Button>
        </div>
      </Frame>
    </li>
  );
}

/** The daily shortlist: jobs picked for you, each one click from an application. */
export function ShortlistView({ initial }: { initial: ShortlistItem[] }) {
  const [items, setItems] = useState(initial.filter((i) => i.status === "new"));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function dismiss(item: ShortlistItem) {
    setBusyId(item.jobId);
    setError(null);
    try {
      await api.dismissShortlist(item.jobId);
      setItems((list) => list.filter((x) => x.jobId !== item.jobId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState title="Nothing on your shortlist right now">
        Norinote adds jobs here as it finds ones you are likely to get. Check that your <Link href="/settings#lanes" className="font-medium text-accent underline-offset-4 hover:underline">lanes</Link> say what you want, or browse <Link href="/jobs" className="font-medium text-accent underline-offset-4 hover:underline">all jobs</Link>.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="red">{error}</Notice>}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <ShortlistCard key={item.id} item={item} busy={busyId === item.jobId} onDismiss={() => void dismiss(item)} />
        ))}
      </ul>
    </div>
  );
}
