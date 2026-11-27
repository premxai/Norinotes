import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRANSITIONS } from "./state.js";

/**
 * docs/state-machines.md states which application moves are allowed, and people read it before changing the machine. It
 * is checked against the code so the two cannot drift: TRANSITIONS is the source, and a move added, removed or retyped
 * fails here until the doc says the same.
 */
const DOC = new URL("../../../docs/state-machines.md", import.meta.url);

function documentedTransitions(): Record<string, string[]> {
  const rows: Record<string, string[]> = {};
  for (const line of readFileSync(DOC, "utf8").split("\n")) {
    const m = /^\|\s*`(\w+)`\s*\|\s*(.+?)\s*\|$/.exec(line.trim());
    if (!m || !(m[1]! in TRANSITIONS)) continue;
    rows[m[1]!] = m[2]!.startsWith("—") ? [] : [...m[2]!.matchAll(/`(\w+)`/g)].map((x) => x[1]!);
  }
  return rows;
}

describe("docs/state-machines.md", () => {
  it("lists every allowed application move, and only those", () => {
    const documented = documentedTransitions();
    expect(Object.keys(documented).sort()).toEqual(Object.keys(TRANSITIONS).sort());
    for (const [from, to] of Object.entries(TRANSITIONS)) expect(documented[from], `the row for ${from}`).toEqual([...to]);
  });
});
