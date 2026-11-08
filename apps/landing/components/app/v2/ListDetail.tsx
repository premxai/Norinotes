import type { ReactNode } from "react";

/* Dashboard v2's list beside its open item (Jobs, Applications and Inbox, docs/dashboard-v2-plan.md): two panels side
   by side from 1024 px; below that the list is the page, and an open item is its own page with a way back. The caller
   owns the selection (usually the address), so Back and links work. */

export function ListDetail({
  list,
  detail,
  open,
  listLabel,
  backLabel,
  onBack,
  listWidth = "420px",
}: {
  list: ReactNode;
  detail: ReactNode;
  /** Whether an item is open: on phones and tablets it decides which panel shows. */
  open: boolean;
  listLabel: string;
  /** The back link's words below 1024 px, such as "Applications". */
  backLabel: string;
  onBack: () => void;
  listWidth?: string;
}) {
  return (
    <div className="laptop:grid laptop:min-h-0 laptop:flex-1 laptop:gap-5" style={{ gridTemplateColumns: `${listWidth} minmax(0, 1fr)` }}>
      <section aria-label={listLabel} className={`flex min-h-0 flex-col overflow-hidden rounded-[22px] border-[1.5px] border-line bg-surface ${open ? "max-laptop:hidden" : ""}`}>
        {list}
      </section>
      <section className={`flex min-h-0 flex-col overflow-hidden rounded-[22px] border-[1.5px] border-line bg-surface ${open ? "" : "max-laptop:hidden"}`}>
        <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1.5 self-start px-4 pt-2 text-small font-semibold text-ink laptop:hidden">
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M11 3L5 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel}
        </button>
        {detail}
      </section>
    </div>
  );
}
