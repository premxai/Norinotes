/* Dashboard v2's status chip (docs/dashboard-v2-plan.md): one look for an application's or a message's state across
   Overview, Jobs, Applications and Inbox. The words come from the caller; the tone picks the colours. */

export type ChipTone = "working" | "waiting" | "needs" | "done" | "good" | "bad" | "neutral";

const TONE: Record<ChipTone, string> = {
  working: "bg-info-tint text-info", // Applying, Optimizing resume
  waiting: "bg-warning-tint text-warning", // Queued, Waiting for a code
  needs: "bg-peach-tint text-needs", // Needs help
  done: "bg-accent-tint text-accent", // Applied, Sent
  good: "bg-accent-tint text-accent", // Interview, Offer, Reply
  bad: "bg-danger-tint text-danger", // Didn't go through, Rejected
  neutral: "bg-tint text-ink", // Cancelled, Confirmation, Other
};

export function StatusChip({ tone, children, busy = false, className = "" }: { tone: ChipTone; children: React.ReactNode; busy?: boolean; className?: string }) {
  return (
    <span className={`inline-flex h-7 flex-none items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>
      {busy && <span aria-hidden="true" className="size-2.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}
      {children}
    </span>
  );
}
