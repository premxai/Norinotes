/**
 * Spend tracking for the eval harness. Every chat and embedding call goes through `instrumentProvider`, which adds the
 * tokens the vendor reported to a ledger (per phase and model), prices them with the table in @norinote/ai, and refuses a
 * call that would push the cumulative total over the cap. The ledger is a JSON file, so the cap holds across reruns.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PRICES_USD_PER_MILLION, costMicros, type AiProvider, type ChatRequest, type ChatResponse } from "@norinote/ai";

type EmbedRequest = Parameters<AiProvider["embed"]>[0];
type EmbedResponse = Awaited<ReturnType<AiProvider["embed"]>>;

export type LedgerEntry = { calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; micros: number };
export type LedgerFile = { entries: Record<string, LedgerEntry>; startedAt: string };

export class BudgetStopError extends Error {
  constructor(public readonly spentUsd: number, public readonly capUsd: number, public readonly wantedUsd: number) {
    super(`Eval budget stop: $${spentUsd.toFixed(3)} already spent, the next call is estimated at $${wantedUsd.toFixed(4)}, cap is $${capUsd.toFixed(2)}. `
      + "Nothing was lost: databases and caches are on disk, so raise EVAL_BUDGET_USD (or lower --cap) and run again to continue.");
    this.name = "BudgetStopError";
  }
}

export class Ledger {
  phase = "setup";
  private file: LedgerFile;

  constructor(private readonly filePath: string | null, public readonly capUsd: number) {
    this.file = { entries: {}, startedAt: new Date().toISOString() };
    if (filePath && existsSync(filePath)) {
      try { this.file = JSON.parse(readFileSync(filePath, "utf8")) as LedgerFile; } catch { /* start a fresh ledger */ }
    }
  }

  totalUsd(): number {
    return Object.values(this.file.entries).reduce((s, e) => s + e.micros, 0) / 1_000_000;
  }

  remainingUsd(): number {
    return this.capUsd - this.totalUsd();
  }

  /** Total for one phase, in dollars. */
  phaseUsd(phase: string): number {
    return Object.entries(this.file.entries).filter(([k]) => k.startsWith(`${phase}|`)).reduce((s, [, e]) => s + e.micros, 0) / 1_000_000;
  }

  byPhaseModel(): Array<{ phase: string; model: string } & LedgerEntry & { usd: number }> {
    return Object.entries(this.file.entries).map(([k, e]) => {
      const [phase = "", model = ""] = k.split("|");
      return { phase, model, ...e, usd: e.micros / 1_000_000 };
    });
  }

  /** Throws BudgetStopError when `estimateUsd` more would pass the cap. */
  assertRoom(estimateUsd: number): void {
    if (this.totalUsd() + estimateUsd > this.capUsd) throw new BudgetStopError(this.totalUsd(), this.capUsd, estimateUsd);
  }

  record(model: string, t: { promptTokens: number; cachedTokens?: number; completionTokens: number }): number {
    const key = `${this.phase}|${model}`;
    const e = this.file.entries[key] ?? { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, micros: 0 };
    const micros = costMicros(model, t);
    e.calls++;
    e.promptTokens += t.promptTokens;
    e.cachedTokens += t.cachedTokens ?? 0;
    e.completionTokens += t.completionTokens;
    e.micros += micros;
    this.file.entries[key] = e;
    this.save();
    return micros;
  }

  save(): void {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.file, null, 2));
  }
}

const CHARS_PER_TOKEN = 3; // pessimistic for English prose, so the estimate errs on the expensive side

/** Dollars a chat call may cost at most: all input tokens at the full price, plus the largest reply we allow. */
export function estimateChatUsd(req: ChatRequest): number {
  const price = PRICES_USD_PER_MILLION[req.model] ?? PRICES_USD_PER_MILLION["gpt-4.1"]!;
  const inputTokens = req.messages.reduce((s, m) => s + m.content.length, 0) / CHARS_PER_TOKEN;
  const outputTokens = req.maxOutputTokens ?? 900;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function estimateEmbedUsd(req: EmbedRequest): number {
  const price = PRICES_USD_PER_MILLION[req.model] ?? PRICES_USD_PER_MILLION["text-embedding-3-small"]!;
  return (req.texts.reduce((n: number, t: string) => n + t.length, 0) / CHARS_PER_TOKEN * price.input) / 1_000_000;
}

/** Wraps a provider so each call is checked against the cap before it is sent and recorded in the ledger after. */
export function instrumentProvider(real: AiProvider, ledger: Ledger): AiProvider {
  return {
    name: real.name,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      ledger.assertRoom(estimateChatUsd(req));
      const res = await real.chat(req);
      ledger.record(req.model, res);
      return res;
    },
    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      ledger.assertRoom(estimateEmbedUsd(req));
      const res = await real.embed(req);
      ledger.record(req.model, { promptTokens: res.promptTokens, completionTokens: 0 });
      return res;
    },
  };
}
