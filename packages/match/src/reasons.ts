import { OUTCOME_REASON_PREFIX } from "./outcomes.js";
import { SKIP_REASON_PREFIX } from "./skip-feedback.js";

/** Most reasons a shortlist row keeps. */
export const MAX_REASONS = 3;

/**
 * A row's reasons with `line` inserted at `at`, trimmed to MAX_REASONS. The new line, "Gap: ..." lines, the outcome
 * nudge's reason and the skip penalty's reason are always kept; other lines are dropped from the end first. So a gap that holds a job out of the strong
 * band is never cut, and the raw fit can still be read back from the nudge's reason.
 */
export function withReason(reasons: readonly string[], line: string, at: number): string[] {
  const out = [...reasons];
  let kept = Math.min(Math.max(0, at), out.length);
  out.splice(kept, 0, line);
  for (let i = out.length - 1; i >= 0 && out.length > MAX_REASONS; i--) {
    if (i === kept || out[i]!.startsWith("Gap:") || out[i]!.startsWith(OUTCOME_REASON_PREFIX) || out[i]!.startsWith(SKIP_REASON_PREFIX)) continue;
    out.splice(i, 1);
    if (i < kept) kept--;
  }
  return out;
}
