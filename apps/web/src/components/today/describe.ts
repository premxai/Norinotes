import type { ApplicationListItem } from "@/lib/types";

/** What a waiting item asks of the person, in one line, and the label of the button that answers it. */
export function describeWaiting(item: ApplicationListItem): { kind: string; line: string; action: string } {
  const a = item.application;
  if (a.status === "prepared") {
    const n = Object.keys(a.answers ?? {}).length;
    const edits = item.resume?.changes.length ?? 0;
    return {
      kind: "Ready",
      line: `Resume tailored${edits > 0 ? ` (${edits} line${edits === 1 ? "" : "s"} changed)` : ""} and ${n} field${n === 1 ? "" : "s"} filled. One click sends it.`,
      action: "Review and send",
    };
  }
  const q = a.pendingQuestions[0]?.text;
  const more = a.pendingQuestions.length - 1;
  return {
    kind: "Question",
    line: q ? `${q}${more > 0 ? ` (and ${more} more)` : ""}` : "The form asked something your profile cannot answer.",
    action: "Answer",
  };
}
