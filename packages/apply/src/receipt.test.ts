import { describe, expect, it } from "vitest";
import { buildReceipt, formatReceipt, groupFields, sectionFor } from "./receipt.js";
import type { FilledField } from "./types.js";

const f = (label: string, value: string, kind: FilledField["kind"] = "text"): FilledField => ({ label, value, kind });

describe("receipt sections", () => {
  it("assigns fields to the five sections", () => {
    expect(sectionFor(f("First Name", "Ada"))).toBe("Personal information");
    expect(sectionFor(f("Email", "a@b.c", "email"))).toBe("Personal information");
    expect(sectionFor(f("Phone country code", "United States +1", "select"))).toBe("Personal information");
    expect(sectionFor(f("LinkedIn Profile", "x"))).toBe("Personal information");
    expect(sectionFor(f("Resume/CV", "resume.pdf", "file"))).toBe("Experience");
    expect(sectionFor(f("Current company", "Acme"))).toBe("Experience");
    expect(sectionFor(f("School", "MIT"))).toBe("Education");
    expect(sectionFor(f("Degree", "BSc", "select"))).toBe("Education");
    expect(sectionFor(f("Gender", "Female", "radio"))).toBe("Disclosures");
    expect(sectionFor(f("Are you a veteran?", "No", "select"))).toBe("Disclosures");
    expect(sectionFor(f("Why do you want to work here?", "Robots", "textarea"))).toBe("Questions");
    expect(sectionFor(f("Will you need sponsorship?", "No", "radio"))).toBe("Questions");
  });

  it("groups with counts and marks radio, select and checkbox values as selected choices", () => {
    const sections = groupFields([
      f("First Name", "Ada"), f("Last Name", "Lovelace"), f("Resume/CV", "resume.pdf", "file"),
      f("Will you need sponsorship?", "No", "radio"), f("How did you hear about us?", "LinkedIn", "select"),
      f("I acknowledge", "Yes", "checkbox"), f("Gender", "Decline", "select"),
    ]);
    expect(sections.map((s) => [s.name, s.count])).toEqual([
      ["Personal information", 2], ["Experience", 1], ["Education", 0], ["Questions", 3], ["Disclosures", 1],
    ]);
    const questions = sections.find((s) => s.name === "Questions")!;
    expect(questions.fields.map((x) => [x.label, x.value, x.choice])).toEqual([
      ["Will you need sponsorship?", "No", true], ["How did you hear about us?", "LinkedIn", true], ["I acknowledge", "Yes", true],
    ]);
    expect(sections[0]!.fields.every((x) => !x.choice)).toBe(true);
  });

  it("records files, confirmation text, duration and an honest summary", () => {
    const fill = { fields: [f("First Name", "Ada"), f("Resume/CV", "resume.pdf", "file")], files: [{ label: "Resume/CV", path: "/tmp/x/resume.pdf" }], formUrl: "https://x.test/form", durationMs: 4000, needsUser: undefined };
    const dry = buildReceipt({ driver: "greenhouse", dryRun: true, fill });
    expect(dry).toMatchObject({ dryRun: true, submitted: false, submitClicked: false, files: [{ label: "Resume/CV", name: "resume.pdf" }], totals: { fields: 2, files: 1 }, durationMs: 4000 });
    expect(dry.summary).toBe("2 fields filled, 1 file uploaded. Dry run, not submitted.");

    const sent = buildReceipt({ driver: "greenhouse", dryRun: false, fill, submit: { status: "submitted", submitClicked: true, confirmationText: "Thank you for applying.", durationMs: 1500, needsUser: undefined, finalUrl: undefined } });
    expect(sent).toMatchObject({ submitted: true, submitClicked: true, confirmationText: "Thank you for applying.", durationMs: 5500 });
    expect(sent.summary).toContain("Submitted.");
    const text = formatReceipt(sent);
    expect(text).toContain("Personal information (1)");
    expect(text).toContain("Confirmation: Thank you for applying.");
    expect(text).toContain("Took 5.5 s");
  });
});
