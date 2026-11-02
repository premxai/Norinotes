import OpenAI from "openai";
import type { AiProvider, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from "./provider.js";

/** Largest batch the embeddings endpoint is sent at once. */
const EMBED_BATCH = 256;

/** The real provider. Only built when OPENAI_API_KEY is set and not under test. */
export function createOpenAiProvider(apiKey: string, client: OpenAI = new OpenAI({ apiKey, maxRetries: 3, timeout: 60_000 })): AiProvider {
  return {
    name: "openai",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await client.chat.completions.create({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        ...(req.maxOutputTokens ? { max_completion_tokens: req.maxOutputTokens } : {}),
        ...(req.cacheKey ? { prompt_cache_key: req.cacheKey } : {}),
        ...(req.jsonSchema
          ? { response_format: { type: "json_schema" as const, json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: req.jsonSchema.strict } } }
          : {}),
      });
      const choice = res.choices[0];
      if (choice?.message.refusal) throw new Error(`Model refused: ${choice.message.refusal}`);
      return {
        text: choice?.message.content ?? "",
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        cachedTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      };
    },
    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      const vectors: number[][] = [];
      let promptTokens = 0;
      for (let i = 0; i < req.texts.length; i += EMBED_BATCH) {
        // The endpoint rejects empty strings; a single space embeds to a harmless vector.
        const batch = req.texts.slice(i, i + EMBED_BATCH).map((t) => t || " ");
        const res = await client.embeddings.create({ model: req.model, input: batch, dimensions: 1536 });
        for (const d of res.data) vectors.push(d.embedding);
        promptTokens += res.usage.prompt_tokens;
      }
      return { vectors, promptTokens };
    },
  };
}
