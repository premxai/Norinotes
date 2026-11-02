import { STATUS_LABEL } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/types";
import { cx } from "./cx";

export const PIPELINE: ApplicationStatus[] = ["queued", "preparing", "prepared", "applying", "awaiting_code", "submitted"];

/** The stop where the person must act; the current one is drawn in orange. */
const GATES: ApplicationStatus[] = ["prepared"];

/**
 * Progress strip: one segment per step. Done = ink, current = orange if it waits on you, blue if Norinote is working,
 * upcoming = faint. "Awaiting code" only appears when a run actually stops there. For side states (needs_user, failed)
 * pass the last pipeline step reached as `lastStep` so the strip shows where it stopped.
 */
export function Stepper({ status, lastStep }: { status: ApplicationStatus; lastStep?: string }) {
  const steps = PIPELINE.filter((s) => s !== "awaiting_code" || status === "awaiting_code" || lastStep === "awaiting_code");
  let current = steps.indexOf(status);
  let problem: "needs_user" | "failed" | null = null;
  if (current < 0) {
    problem = status as "needs_user" | "failed";
    const li = lastStep ? steps.indexOf(lastStep as ApplicationStatus) : -1;
    current = li >= 0 ? li : steps.indexOf("applying");
  }
  const done = status === "submitted";
  const waiting = !done && (GATES.includes(steps[current]) || problem === "needs_user");
  const label = done ? STATUS_LABEL[status] : problem ? `${STATUS_LABEL[steps[current]]}: ${STATUS_LABEL[problem]}` : STATUS_LABEL[steps[current]];

  return (
    <div>
      <p className="mb-2 flex items-baseline gap-2 text-meta text-muted sm:hidden">
        <span className="tnum">Step {current + 1} of {steps.length}</span>
        <span className="font-medium text-ink">{label}</span>
      </p>
      <ol className="flex gap-1" aria-label="Application progress">
        {steps.map((step, i) => {
          const isDone = done || i < current;
          const isCurrent = !done && i === current;
          return (
            <li key={step} className="min-w-0 flex-1" aria-current={isCurrent ? "step" : undefined}>
              <span
                className={cx(
                  "block h-1.5 rounded-full",
                  isDone && "bg-ink",
                  isCurrent && (problem === "failed" ? "bg-danger" : waiting ? "bg-attn" : "bg-accent"),
                  !isDone && !isCurrent && "bg-line",
                )}
              />
              <span
                className={cx(
                  "mt-2 hidden truncate text-[12px] sm:block",
                  isCurrent ? (waiting ? "font-semibold text-attn-fg" : "font-semibold text-ink") : isDone ? "text-ink-2" : "text-muted",
                )}
              >
                {STATUS_LABEL[step]}
                {isCurrent && problem && <span className={cx("block", problem === "failed" ? "text-danger-fg" : "text-attn-fg")}>{STATUS_LABEL[problem]}</span>}
              </span>
              <span className="sr-only">{isDone ? "done" : isCurrent ? "current" : "to do"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
