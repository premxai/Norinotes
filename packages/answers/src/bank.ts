import { embed } from "@norinote/ai";
import { and, answerBank, asc, cosineDistance, desc, eq, inArray, isNotNull, sql, type Db } from "@norinote/db";
import type { Answer } from "@norinote/shared";
import { normalizeQuestion } from "./text.js";

/**
 * Cosine similarity at which two questions count as the same one. With text-embedding-3-small, rewordings of one
 * question score about 0.85 to 0.95 and different questions on the same topic about 0.6 to 0.75; 0.82 sits between,
 * and `sameSpecifics` (numbers, tools, names) vetoes close pairs that ask about different things.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.82;

export type AnswerSource = "default" | "user" | "model";
export type BankRow = { id: string; questionText: string; answer: string; source: AnswerSource; lastUsedAt: Date | null };
export type SimilarRow = BankRow & { similarity: number };

/** How much to trust an answer, for breaking ties: what the user typed beats a saved default beats a model draft. */
export const SOURCE_RANK: Record<AnswerSource, number> = { user: 3, default: 2, model: 1 };

/** All of a user's bank rows without their vectors (a bank is hundreds of rows at most). */
export async function loadBank(db: Db, userId: string): Promise<BankRow[]> {
  return db.select({ id: answerBank.id, questionText: answerBank.questionText, answer: answerBank.answer, source: answerBank.source, lastUsedAt: answerBank.lastUsedAt })
    .from(answerBank).where(eq(answerBank.userId, userId));
}

/** The user's closest bank rows to a question vector, best first. */
export async function findSimilar(db: Db, userId: string, vector: number[], limit = 5): Promise<SimilarRow[]> {
  const distance = cosineDistance(answerBank.questionEmbedding, vector);
  const rows = await db.select({
    id: answerBank.id, questionText: answerBank.questionText, answer: answerBank.answer, source: answerBank.source, lastUsedAt: answerBank.lastUsedAt,
    similarity: sql<number>`1 - (${distance})`,
  }).from(answerBank).where(and(eq(answerBank.userId, userId), isNotNull(answerBank.questionEmbedding))).orderBy(asc(distance)).limit(limit);
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

export async function markUsed(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(answerBank).set({ lastUsedAt: new Date() }).where(inArray(answerBank.id, [...new Set(ids)]));
}

const toAnswer = (r: BankRow): Answer => ({ id: r.id, questionText: r.questionText, answer: r.answer, source: r.source, lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null });

const bankColumns = { id: answerBank.id, questionText: answerBank.questionText, answer: answerBank.answer, source: answerBank.source, lastUsedAt: answerBank.lastUsedAt };

/** The user's remembered answers for the You page: most recently used first, then newest. */
export async function listAnswers(db: Db, userId: string, limit = 1000): Promise<Answer[]> {
  const rows = await db.select(bankColumns).from(answerBank).where(eq(answerBank.userId, userId))
    .orderBy(sql`${answerBank.lastUsedAt} desc nulls last`, desc(answerBank.createdAt)).limit(limit);
  return rows.map(toAnswer);
}

/**
 * The user's own change to a remembered answer. It becomes theirs (`user`), so defaults and model drafts never
 * overwrite it. Null when the row is not theirs or does not exist. The question stays as asked (its vector matches it).
 */
export async function updateAnswer(db: Db, userId: string, id: string, answer: string): Promise<Answer | null> {
  const [row] = await db.update(answerBank).set({ answer, source: "user" })
    .where(and(eq(answerBank.id, id), eq(answerBank.userId, userId))).returning(bankColumns);
  return row ? toAnswer(row) : null;
}

/** Forgets one remembered answer. False when it was not the user's or does not exist. */
export async function deleteAnswer(db: Db, userId: string, id: string): Promise<boolean> {
  const gone = await db.delete(answerBank).where(and(eq(answerBank.id, id), eq(answerBank.userId, userId))).returning({ id: answerBank.id });
  return gone.length > 0;
}

/**
 * Remember an answer for a question. The same question (ignoring case and punctuation) updates its row instead of
 * adding another. A user's own answer is never overwritten by a default or a model draft; their newer answer replaces
 * anything. The question is embedded so later rewordings find it; if embedding fails (budget), the row is saved
 * without a vector and still matches by exact text.
 */
export async function saveAnswer(db: Db, userId: string, question: string, answer: string, source: AnswerSource): Promise<Answer> {
  const text = question.trim();
  const key = normalizeQuestion(text);
  if (!key) throw new Error("Cannot save an answer for an empty question");
  const existing = (await loadBank(db, userId)).find((r) => normalizeQuestion(r.questionText) === key);
  if (existing && SOURCE_RANK[existing.source] > SOURCE_RANK[source]) return toAnswer(existing);

  let vector: number[] | null = null;
  try { vector = (await embed([text], { userId, db }))[0] ?? null; } catch { vector = null; }

  if (existing) {
    const [row] = await db.update(answerBank).set({ answer, source, questionText: text, questionEmbedding: vector, lastUsedAt: new Date() }).where(eq(answerBank.id, existing.id))
      .returning({ id: answerBank.id, questionText: answerBank.questionText, answer: answerBank.answer, source: answerBank.source, lastUsedAt: answerBank.lastUsedAt });
    return toAnswer(row!);
  }
  const [row] = await db.insert(answerBank).values({ userId, questionText: text, questionEmbedding: vector, answer, source, lastUsedAt: new Date() })
    .returning({ id: answerBank.id, questionText: answerBank.questionText, answer: answerBank.answer, source: answerBank.source, lastUsedAt: answerBank.lastUsedAt });
  return toAnswer(row!);
}
