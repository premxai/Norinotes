import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ApplicationListItem } from "@/lib/types";
import { Icon } from "../Icon";
import { Monogram } from "../Monogram";
import { TimeAgo } from "../TimeAgo";
import { appUpdatedAt } from "@/lib/format";
import { describeWaiting } from "./describe";

/**
 * Waiting on you: every item that blocks the agent until the person acts. Each card is one link to the decision,
 * orange-edged, with the one-line ask and the button label that answers it.
 */
export function WaitingList({ items, compact }: { items: ApplicationListItem[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const d = describeWaiting(item);
        return (
          <li key={item.application.id}>
            <Link
              href={`/applications/${item.application.id}`}
              className="group flex items-center gap-3.5 rounded-card border-2 border-attn bg-surface p-3.5 transition-colors duration-150 hover:bg-attn-tint/40 sm:p-4"
            >
              {!compact && <Monogram name={item.job.companyName} className="hidden sm:flex" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex h-5 items-center rounded-full bg-attn-tint px-2 text-[11px] font-semibold text-attn-fg">{d.kind}</span>
                  <span className="truncate text-meta text-muted">{item.job.companyName}</span>
                  <span className="text-meta text-muted" aria-hidden="true">·</span>
                  <TimeAgo iso={appUpdatedAt(item.application)} className="text-meta text-muted" />
                </div>
                <p className="mt-1 truncate text-body-sm font-semibold text-ink sm:text-[15px]">{item.job.title}</p>
                <p className="mt-0.5 line-clamp-2 text-meta text-ink-2">{d.line}</p>
              </div>
              <span className="hidden shrink-0 items-center gap-1.5 rounded-control bg-ink px-3.5 py-2 text-[13px] font-semibold text-on-ink sm:inline-flex">
                {d.action}
                <Icon icon={ArrowRight} size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
              </span>
              <Icon icon={ArrowRight} className="text-muted sm:hidden" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
