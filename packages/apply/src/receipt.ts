import path from "node:path";
import { classifyField, type FieldClass } from "./form.js";
import type { FilledField, FillResult, NeedsUserKind, SubmitResult } from "./types.js";

export const RECEIPT_SECTIONS = ["Personal information", "Experience", "Education", "Questions", "Disclosures"] as const;
export type ReceiptSectionName = (typeof RECEIPT_SECTIONS)[number];

export type ReceiptField = {
  label: string;
  /** What the form now holds. For selects, radios and checkboxes this is the option that was selected. */
  value: string;
  kind: FilledField["kind"];
  /** True for select, radio and checkbox fields: `value` is the selected choice. */
  choice: boolean;
};

export type ReceiptSection = { name: ReceiptSectionName; count: number; fields: ReceiptField[] };

/** Stored in `applications.receipt`. Proof of what was filled and, when it happened, what the employer confirmed. */
export type ApplicationReceipt = {
  version: 1;
  driver: string;
  /** The submit button was not clicked (dry run, or ALLOW_REAL_SUBMIT is not "true"). */
  dryRun: boolean;
  submitted: boolean;
  /** Submit was clicked: the employer may have the application, so it is never re-sent automatically. */
  submitClicked: boolean;
  /** The site asked for an emailed code and the run is waiting for it. */
  awaitingCode?: boolean;
  formUrl: string | null;
  sections: ReceiptSection[];
  files: { label: string; name: string; path: string }[];
  totals: { fields: number; files: number };
  confirmationText?: string;
  screenshotPath?: string;
  tracePath?: string;
  durationMs: number;
  finishedAt: string;
  needsUser?: { kind: NeedsUserKind; reason: string };
  /** One line for lists: "23 fields filled, 1 file uploaded. Dry run, not submitted." */
  summary: string;
};

const DISCLOSURE_CLASSES = new Set<FieldClass>(["gender", "race", "hispanic", "veteran", "disability"]);
const PERSONAL_CLASSES = new Set<FieldClass>(["first_name", "last_name", "full_name", "email", "phone", "linkedin", "website", "github", "social", "location", "country"]);

/** Which receipt section a field belongs to, from its label. */
export function sectionFor(field: Pick<FilledField, "label" | "kind">): ReceiptSectionName {
  const l = field.label.toLowerCase();
  const cls = classifyField(field);
  if (DISCLOSURE_CLASSES.has(cls) || /sexual orientation|transgender|self-?identif/.test(l)) return "Disclosures";
  if (/school|universit|college|degree|education|\bgpa\b|\bmajor\b|discipline|graduat/.test(l)) return "Education";
  if (cls === "resume" || cls === "cover_letter" || /years? of (professional |work )?experience|current (company|employer|title|position)|employer|job title|notice period|salary|compensation/.test(l)) return "Experience";
  if (PERSONAL_CLASSES.has(cls) || /pronoun|address|zip|postal|\bstate\b|province/.test(l)) return "Personal information";
  return "Questions";
}

const CHOICE_KINDS = new Set<FilledField["kind"]>(["select", "radio", "checkbox"]);

export function groupFields(fields: FilledField[]): ReceiptSection[] {
  const sections = RECEIPT_SECTIONS.map((name): ReceiptSection => ({ name, count: 0, fields: [] }));
  for (const f of fields) {
    const section = sections.find((s) => s.name === sectionFor(f))!;
    section.fields.push({ label: f.label, value: f.value, kind: f.kind, choice: CHOICE_KINDS.has(f.kind) });
    section.count++;
  }
  return sections;
}

export type ReceiptInput = {
  driver: string;
  dryRun: boolean;
  fill: Pick<FillResult, "fields" | "files" | "formUrl" | "durationMs" | "needsUser">;
  submit?: Pick<SubmitResult, "status" | "submitClicked" | "confirmationText" | "durationMs" | "needsUser" | "finalUrl">;
  screenshotPath?: string;
  tracePath?: string;
  awaitingCode?: boolean;
  now?: Date;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildReceipt(input: ReceiptInput): ApplicationReceipt {
  const { fill, submit } = input;
  const sections = groupFields(fill.fields);
  const files = fill.files.map((f) => ({ label: f.label, name: path.basename(f.path), path: f.path }));
  const submitted = submit?.status === "submitted";
  const submitClicked = submit?.submitClicked ?? false;
  const needsUser = submit?.needsUser ?? fill.needsUser;
  const durationMs = fill.durationMs + (submit?.durationMs ?? 0);
  const tail = submitted ? "Submitted." : submitClicked ? "Submit was clicked but not confirmed." : input.dryRun ? "Dry run, not submitted." : "Not submitted.";
  return {
    version: 1,
    driver: input.driver,
    dryRun: input.dryRun,
    submitted,
    submitClicked,
    ...(input.awaitingCode ? { awaitingCode: true } : {}),
    formUrl: submit?.finalUrl ?? fill.formUrl,
    sections,
    files,
    totals: { fields: fill.fields.length, files: files.length },
    ...(submit?.confirmationText ? { confirmationText: submit.confirmationText } : {}),
    ...(input.screenshotPath ? { screenshotPath: input.screenshotPath } : {}),
    ...(input.tracePath ? { tracePath: input.tracePath } : {}),
    durationMs,
    finishedAt: (input.now ?? new Date()).toISOString(),
    ...(needsUser ? { needsUser } : {}),
    summary: `${plural(fill.fields.length, "field")} filled, ${plural(files.length, "file")} uploaded. ${tail}`,
  };
}

/** The receipt's sections as plain text, for a Telegram message or a log. */
export function formatReceipt(r: ApplicationReceipt): string {
  const lines = [r.summary];
  for (const s of r.sections) {
    if (!s.count) continue;
    lines.push("", `${s.name} (${s.count})`);
    for (const f of s.fields) lines.push(`  ${f.choice ? "[x]" : "-"} ${f.label}: ${f.value}`);
  }
  if (r.files.length) lines.push("", `Files: ${r.files.map((f) => f.name).join(", ")}`);
  if (r.confirmationText) lines.push("", `Confirmation: ${r.confirmationText}`);
  lines.push("", `Took ${(r.durationMs / 1000).toFixed(1)} s`);
  return lines.join("\n");
}
