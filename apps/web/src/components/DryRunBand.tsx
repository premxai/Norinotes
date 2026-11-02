import { cx } from "./cx";

/**
 * The dry run band: violet, full width, at the top of every signed-in page while this server never sends.
 * Live mode shows no band at all, so its absence is the signal that approvals are real.
 */
export function DryRunBand({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      role="status"
      className={cx(
        "flex flex-none items-center gap-2 border-b border-sandbox-line bg-sandbox text-sandbox-fg",
        compact ? "px-3.5 py-1.5 text-[12px]" : "min-h-9 px-4 py-1.5 text-[13px] sm:px-6",
        className,
      )}
    >
      <span className="font-semibold">Dry run</span>
      <span className="min-w-0">
        Forms are filled, nothing is sent{compact ? "." : <span className="hidden sm:inline">. Live sending is off on this server.</span>}
      </span>
    </div>
  );
}
