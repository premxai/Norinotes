import { AiUnavailableError, BudgetExceededError } from "@norinote/ai";

/**
 * One JSON warn line for an error a matching step caught and moved past, so a real bug is not silent. Over budget and the
 * AI service being unavailable are expected and stay quiet. Only the error's class and code are logged: messages can carry
 * query parameters, and so personal data.
 */
export function warnSwallowed(event: string, err: unknown): void {
  if (err instanceof BudgetExceededError || err instanceof AiUnavailableError) return;
  const code = (err as { code?: unknown } | null)?.code ?? (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  console.warn(JSON.stringify({
    ts: new Date().toISOString(), level: "warn", event, error: err instanceof Error ? err.name : typeof err, ...(typeof code === "string" ? { code } : {}),
  }));
}
