import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, type Db } from "@norinote/db";
import { costMicros, dailyTokenBudget, embeddingModel, modelFor, type Tier } from "./config.js";
import { assertAiAvailable, noteProviderFailure, noteProviderSuccess, resetAiAvailability } from "./errors.js";
import { createFakeProvider } from "./fake.js";
import { createOpenAiProvider } from "./openai.js";
import type { AiProvider, ChatMessage } from "./provider.js";
import { checkBudget, recordUsage } from "./usage.js";

export * from "./config.js";
export * from "./usage.js";
export { AiUnavailableError, aiAvailability, classifyProviderError, resetAiAvailability, setAiLogger } from "./errors.js";
export type { AiAvailability, AiUnavailableReason } from "./errors.js";
export { createFakeProvider, fakeEmbedding, sampleFromJsonSchema } from "./fake.js";
export type { FakeProviderOptions } from "./fake.js";
export type { AiProvider, ChatMessage, ChatRequest, ChatResponse } from "./provider.js";

// ---- provider selection ---------------------------------------------------------------------------------------------

let override: AiProvider | null = null;
let cached: AiProvider | null = null;

/** Force a provider (tests). Pass null to go back to automatic selection. Also clears any unavailability cooldown. */
export function setProvider(p: AiProvider | null): void {
  override = p;
  resetAiAvailability();
}

/** Under tests, or without OPENAI_API_KEY, the deterministic fake: no network, no cost. Otherwise OpenAI. */
export function getProvider(): AiProvider {
  if (override) return override;
  const key = process.env.OPENAI_API_KEY?.trim();
  const testing = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  if (testing || !key) return (cached?.name === "fake" ? cached : (cached = createFakeProvider()));
  return cached?.name === "openai" ? cached : (cached = createOpenAiProvider(key));
}

// ---- complete -------------------------------------------------------------------------------------------------------

export type CompleteArgs = {
  /** `small` unless a call genuinely needs the large model. */
  tier?: Tier;
  /** Stable instructions. Keep them identical between calls so the vendor's prompt cache can hit. */
  system: string;
  /** Stable context shared by many calls (for example the user's profile). Goes after `system`, before `input`. */
  prefix?: string;
  /** The part that changes on every call. Always last. */
  input: string;
  /** Zod schema of the reply. Without it the reply is plain text. */
  schema?: z.ZodType;
  /** Name sent with the JSON schema. Default "result". */
  schemaName?: string;
  /** OpenAI strict mode: every property must be required (use `.nullable()`, not `.optional()`). Output is zod-validated either way. */
  strict?: boolean;
  /** Charges this user's daily budget and records llm_usage. Omit for shared work with no owner (job understanding). */
  userId?: string;
  /** Database for the budget. Default: the shared one. */
  db?: Db;
  temperature?: number;
  maxOutputTokens?: number;
};

export type Usage = { promptTokens: number; completionTokens: number; cachedTokens: number; costMicros: number };
export type CompleteResult<T> = { output: T; text: string; model: string; usage: Usage };

export class AiOutputError extends Error {
  constructor(message: string, public readonly text: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Messages in cache-friendly order: everything stable first, the variable input last. */
export function buildMessages(args: Pick<CompleteArgs, "system" | "prefix" | "input">): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: args.system }];
  if (args.prefix) messages.push({ role: "user", content: args.prefix });
  messages.push({ role: "user", content: args.input });
  return messages;
}

/** JSON Schema for a zod schema, in the shape OpenAI's response_format wants. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

export async function complete<S extends z.ZodType>(args: CompleteArgs & { schema: S }): Promise<CompleteResult<z.output<S>>>;
export async function complete(args: CompleteArgs & { schema?: undefined }): Promise<CompleteResult<string>>;
export async function complete(args: CompleteArgs): Promise<CompleteResult<unknown>> {
  const tier = args.tier ?? "small";
  const model = modelFor(tier);
  assertAiAvailable();
  const db = args.userId ? (args.db ?? (await getDb())) : undefined;
  if (db && args.userId) await checkBudget(db, args.userId, dailyTokenBudget());

  const res = await getProvider().chat({
    model,
    messages: buildMessages(args),
    temperature: args.temperature ?? 0,
    maxOutputTokens: args.maxOutputTokens,
    cacheKey: `${tier}:${sha(args.system + (args.prefix ?? ""))}`,
    jsonSchema: args.schema ? { name: args.schemaName ?? "result", schema: toJsonSchema(args.schema), strict: args.strict ?? false } : undefined,
  }).catch((err: unknown) => { throw noteProviderFailure(err); });
  noteProviderSuccess();

  // The model was already paid for, so account for it before validating the reply.
  const cost = db && args.userId
    ? await recordUsage(db, args.userId, model, res)
    : costMicros(model, res);
  const usage: Usage = { promptTokens: res.promptTokens, completionTokens: res.completionTokens, cachedTokens: res.cachedTokens, costMicros: cost };

  if (!args.schema) return { output: res.text, text: res.text, model, usage };
  let parsed: unknown;
  try { parsed = JSON.parse(res.text); } catch { throw new AiOutputError("Model reply was not valid JSON", res.text); }
  const checked = args.schema.safeParse(parsed);
  if (!checked.success) throw new AiOutputError(`Model reply did not match the schema: ${z.prettifyError(checked.error)}`, res.text);
  return { output: checked.data, text: res.text, model, usage };
}

// ---- embed ----------------------------------------------------------------------------------------------------------

/**
 * One 1536-number vector per text, in order. Pass userId to charge that user's budget (embedding tokens count too).
 * Throws `AiUnavailableError` when the vendor cannot be used (see errors.ts) and `BudgetExceededError` over budget.
 */
export async function embed(texts: string[], opts: { userId?: string; db?: Db } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embeddingModel();
  assertAiAvailable();
  const db = opts.userId ? (opts.db ?? (await getDb())) : undefined;
  if (db && opts.userId) await checkBudget(db, opts.userId, dailyTokenBudget());
  const res = await getProvider().embed({ model, texts }).catch((err: unknown) => { throw noteProviderFailure(err); });
  noteProviderSuccess();
  if (res.vectors.length !== texts.length) throw new Error(`Embedding returned ${res.vectors.length} vectors for ${texts.length} texts`);
  if (db && opts.userId) await recordUsage(db, opts.userId, model, { promptTokens: res.promptTokens, completionTokens: 0 });
  return res.vectors;
}
