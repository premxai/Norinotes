#!/usr/bin/env node
/**
 * The quality gate. Every change must pass this before it is committed.
 *
 *   node scripts/gate.mjs                    run every step
 *   node scripts/gate.mjs --only typecheck,tests
 *
 * Exit code 0 only when every step passed. To add a step (for example the web build), add one entry to STEPS.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * { id, label, cmd, args, env? }. Steps run in order and the gate stops at the first failure.
 * Planned: { id: "build", label: "Web build", cmd: npm, args: ["run", "build", "--workspace", "apps/web"] }.
 */
const STEPS = [
  { id: "typecheck", label: "TypeScript", cmd: npm, args: ["run", "typecheck"] },
  { id: "tests", label: "Unit tests (PGlite with pgvector)", cmd: npm, args: ["test"] },
  { id: "lint", label: "Lint", cmd: npm, args: ["run", "lint"] },
  { id: "build", label: "Web build", cmd: npm, args: ["run", "build", "--workspace", "@norinote/web"], env: { NEXT_PUBLIC_USE_MOCK: "1" } },
];

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? new Set((process.argv[onlyArg + 1] ?? "").split(",")) : null;

const results = [];
for (const step of STEPS) {
  if (only && !only.has(step.id)) continue;
  process.stdout.write(`\n=== ${step.label} ===\n`);
  const started = Date.now();
  const r = spawnSync(step.cmd, step.args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...(step.env ?? {}) } });
  results.push({ ...step, status: r.status === 0 ? "pass" : "FAIL", ms: Date.now() - started });
  if (r.status !== 0) break;
}

console.log("\n--- gate summary ---");
for (const r of results) console.log(`${r.status.padEnd(6)} ${r.label.padEnd(40)} ${(r.ms / 1000).toFixed(1)}s`);
const failed = results.length === 0 || results.some((r) => r.status === "FAIL");
console.log(failed ? "\nGATE FAILED" : "\nGATE PASSED");
process.exit(failed ? 1 : 0);
