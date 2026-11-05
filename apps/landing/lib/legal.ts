import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * The privacy policy and the terms, read from content/legal/*.md at build time (legal pages spec section 4). Only the
 * subset the texts use is understood; anything else throws, naming the file and line, so a text can't quietly use
 * something the page doesn't show. Server only: the pages are prerendered and ship none of this.
 */

export type LegalName = "privacy" | "terms";

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export type LegalSection = { id: string; number: number; title: string; blocks: LegalBlock[] };

export type LegalDoc = { name: LegalName; title: string; updated: string; summary: string; sections: LegalSection[] };

/** "4. Who else handles it" → "who-else-handles-it": stable when sections are renumbered. */
export const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The links a text may use: the other page, the home page's sections, and the web. */
export const allowedHref = (href: string) => /^\/(privacy|terms)$/.test(href) || /^\/#[a-z-]+$/.test(href) || /^https:\/\/\S+$/.test(href);

const UNSETTLED = /\[\[[\s\S]*?\]\]/;

/** Parses one text. `production` makes unsettled `[[…]]` text an error; elsewhere it's shown as a mark. */
export function parseLegal(name: LegalName, source: string, { production = false } = {}): LegalDoc {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fail = (line: number, why: string): never => {
    throw new Error(`content/legal/${name}.md:${line + 1}: ${why}`);
  };
  if (production) {
    const at = lines.findIndex((l) => UNSETTLED.test(l));
    if (at !== -1) fail(at, `unsettled text ${lines[at]!.match(UNSETTLED)![0]} can't ship (legal pages spec section 4)`);
  }

  let k = 0;
  const skipBlank = () => {
    while (k < lines.length && lines[k]!.trim() === "") k++;
  };

  skipBlank();
  const title = lines[k]?.match(/^# (.+)$/)?.[1] ?? fail(k, "expected the title (# …)");
  k++;
  skipBlank();
  const date = lines[k]?.match(/^Last updated: (\d{4}-\d{2}-\d{2})$/)?.[1] ?? fail(k, "expected \"Last updated: YYYY-MM-DD\"");
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail(k, `not a date: ${date}`);
  k++;
  skipBlank();

  const summary: string[] = [];
  while (k < lines.length && lines[k]!.startsWith(">")) summary.push(lines[k++]!.replace(/^>\s?/, ""));
  if (summary.length === 0) fail(k, "expected the summary (> …)");

  const sections: LegalSection[] = [];
  while (k < lines.length) {
    const line = lines[k]!;
    if (line.trim() === "") {
      k++;
      continue;
    }
    const head = line.match(/^## (\d+)\. (.+)$/);
    if (head) {
      const number = Number(head[1]);
      if (number !== sections.length + 1) fail(k, `section ${number} should be ${sections.length + 1}`);
      sections.push({ id: slug(head[2]!), number, title: head[2]!.trim(), blocks: [] });
      k++;
      continue;
    }
    const section = sections.at(-1) ?? fail(k, "text before the first section");
    if (/^(#|>|\d+\.\s|!\[|<)/.test(line)) fail(k, `not part of the legal pages' Markdown: ${line.slice(0, 40)}`);
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (k < lines.length && lines[k]!.startsWith("|")) {
        const cells = lines[k]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        k++;
      }
      const [first, ...rest] = rows;
      if (!first || rest.length === 0) fail(k - 1, "a table needs a header and at least one row");
      if (rest.some((r) => r.length !== first!.length)) fail(k - 1, "every table row needs as many cells as the header");
      section.blocks.push({ kind: "table", head: first!, rows: rest });
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (k < lines.length && (lines[k]!.startsWith("- ") || (items.length > 0 && lines[k]!.startsWith("  ") && lines[k]!.trim() !== ""))) {
        if (lines[k]!.startsWith("- ")) items.push(lines[k]!.slice(2).trim());
        else items[items.length - 1] += ` ${lines[k]!.trim()}`;
        k++;
      }
      section.blocks.push({ kind: "list", items });
      continue;
    }
    const para: string[] = [];
    while (k < lines.length && lines[k]!.trim() !== "" && !/^(## |\||- )/.test(lines[k]!)) para.push(lines[k++]!.trim());
    section.blocks.push({ kind: "p", text: para.join(" ") });
  }
  if (sections.length === 0) fail(lines.length - 1, "no sections");

  // Links: only the ones the pages know how to follow.
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\]\(([^)]+)\)/g)) if (!allowedHref(m[1]!)) fail(i, `link not allowed: ${m[1]}`);
  });

  return {
    name,
    title,
    updated: date,
    // The box has its own "In short" heading.
    summary: summary.join(" ").replace(/^\*\*In short\.\*\*\s*/, ""),
    sections,
  };
}

/** Reads and parses content/legal/<name>.md (at build time: both pages are static). */
export function readLegal(name: LegalName): LegalDoc {
  const file = path.join(process.cwd(), "content", "legal", `${name}.md`);
  return parseLegal(name, readFileSync(file, "utf8"), { production: process.env.NODE_ENV === "production" });
}

/** "2026-11-04" → "November 4, 2026". */
export const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
