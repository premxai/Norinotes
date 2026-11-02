import { and, eq, sql } from "drizzle-orm";
import { llmUsage, type Db } from "@norinote/db";
import { costMicros, dailyTokenBudget, type TokenCounts } from "./config.js";

export class BudgetExceededError extends Error {
  constructor(public readonly userId: string, public readonly used: number, public readonly budget: number) {
    super(`Daily token budget used up for user ${userId}: ${used} of ${budget} tokens today. It resets at midnight UTC.`);
    this.name = "BudgetExceededError";
  }
}

/** The UTC calendar day usage is counted in, as YYYY-MM-DD. */
export const utcDay = (d = new Date()): string => d.toISOString().slice(0, 10);

export type UsageToday = { promptTokens: number; completionTokens: number; totalTokens: number; costMicros: number; calls: number };

export async function usageToday(db: Db, userId: string, day = utcDay()): Promise<UsageToday> {
  const [row] = await db.select().from(llmUsage).where(and(eq(llmUsage.userId, userId), eq(llmUsage.day, day))).limit(1);
  const promptTokens = row?.promptTokens ?? 0;
  const completionTokens = row?.completionTokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, costMicros: row?.costMicros ?? 0, calls: row?.calls ?? 0 };
}

/** Throws BudgetExceededError when the user has already used today's tokens. A budget of null (unlimited) never throws. */
export async function checkBudget(db: Db, userId: string, budget: number | null = dailyTokenBudget()): Promise<void> {
  if (budget === null) return;
  const { totalTokens } = await usageToday(db, userId);
  if (totalTokens >= budget) throw new BudgetExceededError(userId, totalTokens, budget);
}

/** Adds one call to the user's row for today (insert or increment) and returns the cost in micro-dollars. */
export async function recordUsage(db: Db, userId: string, model: string, tokens: TokenCounts, day = utcDay()): Promise<number> {
  const prompt = Math.max(0, Math.round(tokens.promptTokens));
  const completion = Math.max(0, Math.round(tokens.completionTokens));
  const cost = costMicros(model, { ...tokens, promptTokens: prompt, completionTokens: completion });
  await db.insert(llmUsage).values({ userId, day, promptTokens: prompt, completionTokens: completion, costMicros: cost, calls: 1 })
    .onConflictDoUpdate({
      target: [llmUsage.userId, llmUsage.day],
      set: {
        promptTokens: sql`${llmUsage.promptTokens} + ${prompt}`,
        completionTokens: sql`${llmUsage.completionTokens} + ${completion}`,
        costMicros: sql`${llmUsage.costMicros} + ${cost}`,
        calls: sql`${llmUsage.calls} + 1`,
        updatedAt: new Date(),
      },
    });
  return cost;
}
