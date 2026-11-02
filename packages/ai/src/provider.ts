export type ChatMessage = { role: "system" | "user"; content: string };

export type ChatRequest = {
  model: string;
  /** Stable prefix first (system, then per-user context), the part that changes last. */
  messages: ChatMessage[];
  /** When set the reply must be JSON matching this JSON Schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown>; strict: boolean };
  temperature: number;
  maxOutputTokens?: number;
  /** Groups calls that share a prefix so the vendor routes them to the same cache. */
  cacheKey?: string;
};

export type ChatResponse = { text: string; promptTokens: number; completionTokens: number; cachedTokens: number };

export type EmbedRequest = { model: string; texts: string[] };
export type EmbedResponse = { vectors: number[][]; promptTokens: number };

/** The one seam to a model vendor. The real one calls OpenAI; the fake is deterministic and free. */
export interface AiProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
}
