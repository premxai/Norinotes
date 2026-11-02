export type Tier = "small" | "large";

export const DEFAULT_SMALL_MODEL = "gpt-4.1-mini";
export const DEFAULT_LARGE_MODEL = "gpt-4.1";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
/** Must equal EMBEDDING_DIMENSIONS in @norinote/db (the vector(1536) columns). */
export const EMBEDDING_DIMENSIONS = 1536;
/** Tokens (prompt + completion) per user per UTC day across every model call made on that user's behalf. */
export const DEFAULT_DAILY_TOKEN_BUDGET = 300_000;

type Env = Record<string, string | undefined>;
const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

/** `small` is the default everywhere; `large` only where a call names it. */
export function modelFor(tier: Tier, env: Env = process.env): string {
  return tier === "large" ? pick(env.AI_LARGE_MODEL, DEFAULT_LARGE_MODEL) : pick(env.AI_SMALL_MODEL, DEFAULT_SMALL_MODEL);
}

export function embeddingModel(env: Env = process.env): string {
  return pick(env.EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL);
}

/** AI_DAILY_TOKEN_BUDGET: unset = 300000; 0 (or "off") = unlimited, returned as null. */
export function dailyTokenBudget(env: Env = process.env): number | null {
  const raw = env.AI_DAILY_TOKEN_BUDGET?.trim();
  if (!raw) return DEFAULT_DAILY_TOKEN_BUDGET;
  if (/^(0|off|none|unlimited)$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_TOKEN_BUDGET;
}

/**
 * US dollars per million tokens. Because a dollar is a million micros, this number is also micro-dollars per token.
 *
 * PRICES MUST BE CHECKED against https://openai.com/api/pricing before anyone relies on the cost figures: these are the
 * last values we knew, vendors change them, and `llm_usage.cost_micros` is only as right as this table. A model that is
 * not listed is priced like the large model, so a wrong or new model name over-reports cost instead of hiding it.
 */
export const PRICES_USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, cachedInput: 0.13, output: 0 },
};

export type TokenCounts = { promptTokens: number; completionTokens: number; cachedTokens?: number };

/** Cost of one call in micro-dollars, rounded up so tiny calls never read as free. */
export function costMicros(model: string, t: TokenCounts): number {
  const price = PRICES_USD_PER_MILLION[model] ?? PRICES_USD_PER_MILLION[DEFAULT_LARGE_MODEL]!;
  const cached = Math.min(t.cachedTokens ?? 0, t.promptTokens);
  const fresh = t.promptTokens - cached;
  return Math.ceil(fresh * price.input + cached * price.cachedInput + t.completionTokens * price.output);
}
