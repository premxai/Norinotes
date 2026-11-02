/**
 * When the model vendor cannot be used right now: classification of provider errors into one typed error, and a short
 * cooldown so a dead key or an outage is not hammered with thousands of failing calls.
 *
 * Messages and log lines carry only the reason and the HTTP status. The vendor's own message is never copied, because an
 * authentication failure quotes part of the API key.
 */

export type AiUnavailableReason = "auth" | "rate_limit" | "server" | "network";

export class AiUnavailableError extends Error {
  constructor(
    public readonly reason: AiUnavailableReason,
    public readonly status: number | null = null,
    /** How long calls are refused after this error, in ms. */
    public readonly cooldownMs: number = cooldownFor(reason),
    message?: string,
  ) {
    super(message ?? `The AI service is unavailable (${DESCRIPTIONS[reason]}).`);
    this.name = "AiUnavailableError";
  }
}

const DESCRIPTIONS: Record<AiUnavailableReason, string> = {
  auth: "authentication failed",
  rate_limit: "rate limited",
  server: "provider error",
  network: "network error",
};

const AUTH_COOLDOWN_MS = 5 * 60_000;
const TRANSIENT_COOLDOWN_MS = 30_000;

function cooldownFor(reason: AiUnavailableReason): number {
  return reason === "auth" ? AUTH_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS;
}

const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);
const NETWORK_NAMES = new Set(["APIConnectionError", "APIConnectionTimeoutError", "AbortError", "TimeoutError", "FetchError"]);

type Loose = { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; cause?: unknown; response?: { status?: unknown }; headers?: unknown };

function statusOf(e: Loose): number | null {
  for (const v of [e.status, e.statusCode, e.response?.status]) if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function isNetwork(e: Loose, depth = 0): boolean {
  if (typeof e.name === "string" && NETWORK_NAMES.has(e.name)) return true;
  if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
  if (e instanceof TypeError && /fetch failed|network/i.test(e.message)) return true;
  return depth < 2 && typeof e.cause === "object" && e.cause !== null && isNetwork(e.cause as Loose, depth + 1);
}

/**
 * Sorts a provider error into an `AiUnavailableError`: 401 and 403 are `auth`, 429 is `rate_limit` (a quota that ran out
 * counts as `auth`: waiting seconds will not help), 5xx is `server`, connection failures and timeouts are `network`.
 * Anything else (a bad request, a refusal, a bug) returns null and is not the provider being unavailable.
 */
export function classifyProviderError(err: unknown): AiUnavailableError | null {
  if (err instanceof AiUnavailableError) return err;
  if (typeof err !== "object" || err === null) return null;
  const e = err as Loose;
  const status = statusOf(e);
  if (status === 401 || status === 403) return new AiUnavailableError("auth", status);
  if (status === 429) {
    const quota = e.code === "insufficient_quota" || /insufficient_quota/.test(String((e as { type?: unknown }).type ?? ""));
    return new AiUnavailableError(quota ? "auth" : "rate_limit", status);
  }
  if (status !== null && status >= 500 && status <= 599) return new AiUnavailableError("server", status);
  if (status === null && isNetwork(e)) return new AiUnavailableError("network");
  return null;
}

// ---- cooldown -------------------------------------------------------------------------------------------------------

type Logger = (event: string, fields: Record<string, unknown>) => void;

const defaultLogger: Logger = (event, fields) => {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event, ...fields }));
};

let logger: Logger = defaultLogger;
let current: { until: number; error: AiUnavailableError } | null = null;

/** Where the one line per cooldown goes. Default: a JSON line on stderr. Pass null to restore the default. */
export function setAiLogger(fn: Logger | null): void {
  logger = fn ?? defaultLogger;
}

/** Forget any cooldown (tests, or after the key was fixed). */
export function resetAiAvailability(): void {
  current = null;
}

export type AiAvailability = { available: boolean; reason: AiUnavailableReason | null; retryAt: Date | null };

export function aiAvailability(now = Date.now()): AiAvailability {
  if (!current || current.until <= now) return { available: true, reason: null, retryAt: null };
  return { available: false, reason: current.error.reason, retryAt: new Date(current.until) };
}

/** Throws the error that started the current cooldown (without calling the vendor) while one is running. */
export function assertAiAvailable(now = Date.now()): void {
  if (current && current.until > now) {
    const { error } = current;
    throw new AiUnavailableError(error.reason, error.status, current.until - now, `${error.message} Not retrying until the cooldown ends.`);
  }
}

/**
 * Called with whatever a vendor call threw. A provider-unavailable error starts a cooldown (and is logged once per
 * cooldown, not once per failed call); the typed error is returned for the caller to throw. Other errors come back as they are.
 */
export function noteProviderFailure(err: unknown, now = Date.now()): unknown {
  const classified = classifyProviderError(err);
  if (!classified) return err;
  if (!current || current.until <= now) {
    current = { until: now + classified.cooldownMs, error: classified };
    logger("ai.unavailable", { reason: classified.reason, status: classified.status, cooldownSeconds: Math.round(classified.cooldownMs / 1000) });
  }
  return classified;
}

/** A vendor call went through: any earlier failure is over, so the next one is logged again. */
export function noteProviderSuccess(): void {
  current = null;
}
