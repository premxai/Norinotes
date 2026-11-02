/** Structured logs: one JSON object per line on stdout. Secrets never go in; known secret-shaped fields and URLs with credentials are scrubbed. */

export type LogFields = Record<string, unknown>;
export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

const SECRET_KEY = /secret|token|password|passwd|authorization|cookie|api[-_]?key|credential|dsn|connection|code$/i;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const MAX_STRING = 400;

/** Removes anything that looks like a secret from a value that is about to be logged. */
export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const clean = value.replace(URL_CREDENTIALS, "$1***@");
    return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}...` : clean;
  }
  if (value instanceof Error) return scrub(value.message, depth + 1);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 3) return "[object]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1);
  return out;
}

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`), now: () => Date = () => new Date()): Logger {
  const emit = (level: "info" | "warn" | "error") => (event: string, fields: LogFields = {}) => {
    write(JSON.stringify({ ts: now().toISOString(), level, event, ...(scrub(fields) as LogFields) }));
  };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
