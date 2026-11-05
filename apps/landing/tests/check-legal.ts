// Checks the legal pages' parser on the real texts and on broken ones, and prints the result as JSON (tests/qa-legal.mjs
// reads it). Run with tsx: it imports lib/legal.ts directly, as the pages do at build time.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseLegal, type LegalName } from "../lib/legal";

const read = (name: LegalName) => readFileSync(path.join(process.cwd(), "content", "legal", `${name}.md`), "utf8");
const throws = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const docs = Object.fromEntries(
  (["privacy", "terms"] as const).map((name) => {
    const d = parseLegal(name, read(name), { production: true });
    return [name, { title: d.title, updated: d.updated, ids: d.sections.map((s) => s.id), rows: d.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r[0]) : []))) }];
  }),
);

const base = read("privacy");
const broken = {
  unsettledInProduction: throws(() => parseLegal("privacy", base.replace("Norinote is a job agent", "[[a gap]] Norinote is a job agent"), { production: true })),
  unsettledInDevelopment: throws(() => parseLegal("privacy", base.replace("Norinote is a job agent", "[[a gap]] Norinote is a job agent"))),
  subheading: throws(() => parseLegal("privacy", base.replace("## 2. What we collect", "### Extra\n\n## 2. What we collect"))),
  numberedList: throws(() => parseLegal("privacy", base.replace("## 3. Who else", "1. a numbered item\n\n## 3. Who else"))),
  gapInNumbers: throws(() => parseLegal("privacy", base.replace("## 3. Who else", "## 4. Who else"))),
  badLink: throws(() => parseLegal("privacy", base.replace("Norinote is a job agent", "[x](http://example.com) Norinote is a job agent"))),
  badDate: throws(() => parseLegal("privacy", base.replace(/Last updated: [\d-]+/, "Last updated: soon"))),
};

process.stdout.write(JSON.stringify({ docs, broken }));
