import { EMBEDDING_DIMENSIONS } from "./config.js";
import type { AiProvider, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from "./provider.js";

const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Deterministic stand-in for an embedding model: each word hashes to a dimension, so texts that share words point the
 * same way (cosine similarity rises with overlap) and identical text gives an identical unit vector.
 */
export function fakeEmbedding(text: string, dims = EMBEDDING_DIMENSIONS): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? [];
  for (const w of words) {
    const h = fnv1a(w);
    v[h % dims]! += (h >>> 31) & 1 ? -1 : 1;
  }
  let norm = Math.hypot(...v);
  if (norm === 0) { v[0] = 1; norm = 1; }
  return v.map((x) => x / norm);
}

type Json = Record<string, unknown>;

/** A minimal value that satisfies a JSON Schema (as produced by z.toJSONSchema): first enum member, 0, "fake", [], etc. */
export function sampleFromJsonSchema(schema: Json): unknown {
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const alt = (schema.anyOf ?? schema.oneOf) as Json[] | undefined;
  if (alt?.length) return sampleFromJsonSchema(alt.find((a) => a.type !== "null") ?? alt[0]!);
  const t = Array.isArray(schema.type) ? (schema.type.find((x) => x !== "null") ?? "null") : schema.type;
  switch (t) {
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Json>;
      return Object.fromEntries(Object.entries(props).map(([k, s]) => [k, sampleFromJsonSchema(s)]));
    }
    case "array": return [];
    case "string": return "fake";
    case "integer":
    case "number": return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean": return false;
    default: return null;
  }
}

export type FakeProviderOptions = {
  /** Custom reply. Return an object (sent as JSON) or a string. Default: a minimal valid value for the schema, or echo text. */
  chat?: (req: ChatRequest) => unknown;
};

/** Deterministic provider for tests and for running without OPENAI_API_KEY. Never touches the network. */
export function createFakeProvider(opts: FakeProviderOptions = {}): AiProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    name: "fake",
    calls,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      calls.push(req);
      const custom = opts.chat?.(req);
      let text: string;
      if (custom !== undefined) text = typeof custom === "string" ? custom : JSON.stringify(custom);
      else if (req.jsonSchema) text = JSON.stringify(sampleFromJsonSchema(req.jsonSchema.schema));
      else text = `[fake ${req.model}] ${req.messages.at(-1)?.content.slice(0, 80) ?? ""}`;
      const promptTokens = req.messages.reduce((n, m) => n + approxTokens(m.content), 0);
      return { text, promptTokens, completionTokens: approxTokens(text), cachedTokens: 0 };
    },
    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      return { vectors: req.texts.map((t) => fakeEmbedding(t)), promptTokens: req.texts.reduce((n, t) => n + approxTokens(t), 0) };
    },
  };
}
