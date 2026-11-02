import Link from "next/link";
import type { AgentActivity } from "@/lib/types";
import { Icon } from "../Icon";
import { TimeAgo } from "../TimeAgo";
import { cx } from "../cx";
import { headline, KIND_ICON } from "../agent/kinds";

/** Everything the agent did, newest first, one line each. */
export function ActivityFeed({ items, limit = 12 }: { items: AgentActivity[]; limit?: number }) {
  if (items.length === 0) return <p className="py-4 text-body-sm text-muted">Nothing yet. What Norinote does for you will show up here.</p>;
  return (
    <ol className="divide-y divide-line">
      {items.slice(0, limit).map((a) => {
        const waiting = a.kind === "prepared" || a.kind === "needs_user";
        const body = (
          <>
            <span className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", waiting ? "bg-attn-tint text-attn-fg" : "bg-sunken text-ink-2")}>
              <Icon icon={KIND_ICON[a.kind]} size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm text-ink">{headline(a)}</span>
              {a.kind === "skipped" && a.data?.reasons && a.data.reasons.length > 0 && (
                <span className="mt-0.5 block text-meta text-muted">{a.data?.reasons?.join(", ")}</span>
              )}
              {a.kind === "submitted" && a.data?.dryRun && <span className="mt-0.5 block text-meta text-sandbox-fg">Dry run, nothing was sent</span>}
            </span>
            <TimeAgo iso={a.ts} className="mt-1 shrink-0 text-[12px] text-muted" />
          </>
        );
        return (
          <li key={a.id}>
            {a.applicationId ? (
              <Link href={`/applications/${a.applicationId}`} className="flex items-start gap-3 rounded-control px-1 py-2.5 hover:bg-sunken/60">{body}</Link>
            ) : (
              <div className="flex items-start gap-3 px-1 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
