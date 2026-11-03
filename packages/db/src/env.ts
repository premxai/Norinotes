import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load `KEY=value` lines from a `.env` file into `process.env`, for local runs. Values in the file win over variables
 * already set in the shell (a stale machine-wide key must not shadow the project's key). In production there is no
 * `.env` file and nothing happens. Returns the names that were set, never their values.
 */
export function loadDotEnv(file = path.resolve(".env"), env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(file)) return [];
  const set: string[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    // An empty value in the file means "not configured here": keep whatever the environment has.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === "") continue;
    env[key] = value;
    set.push(key);
  }
  return set;
}
