/** Pure ranking metrics and bookkeeping for the matching eval. No I/O, so it is unit tested. */

export const REASON_CODES = [
  "good_fit", "wrong_function", "wrong_seniority_too_senior", "wrong_seniority_too_junior", "location_mismatch",
  "missing_must_have", "visa_or_clearance_blocked", "unclear_job", "duplicate",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** A job counts as a hit when the judge scored it at least this. */
export const RELEVANT_SCORE = 4;

export type RankedJudgment = { rank: number; score: number; reason: ReasonCode; widenedBy: string | null; duplicate: boolean };

/** Share of the first `k` ranked items that scored `RELEVANT_SCORE` or more. The denominator is `k` even when fewer were returned. */
export function precisionAt(scores: readonly number[], k: number, threshold = RELEVANT_SCORE): number {
  if (k <= 0) return 0;
  return scores.slice(0, k).filter((s) => s >= threshold).length / k;
}

/** Same hit rate but over what was returned (no penalty for a short list); null for an empty list. */
export function precisionOfReturned(scores: readonly number[], k: number, threshold = RELEVANT_SCORE): number | null {
  const head = scores.slice(0, k);
  return head.length === 0 ? null : head.filter((s) => s >= threshold).length / head.length;
}

/**
 * nDCG at `k` with gain = score - 1 (a 1 is worth nothing, a 5 is worth 4) and the usual log2 discount. The ideal order is the
 * same returned items sorted by score, so it measures ranking quality within the returned list, not what was left out.
 * Null when nothing was returned or every item is worth nothing (the ideal is 0).
 */
export function ndcgAt(scores: readonly number[], k: number): number | null {
  const head = scores.slice(0, k);
  if (head.length === 0) return null;
  const dcg = (xs: readonly number[]) => xs.reduce((s, x, i) => s + (x - 1) / Math.log2(i + 2), 0);
  const ideal = dcg([...head].sort((a, b) => b - a));
  return ideal === 0 ? null : dcg(head) / ideal;
}

export const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

/** Share of each reason code among `items` (all codes present, summing to 1 for a non-empty list). */
export function reasonShares(items: ReadonlyArray<{ reason: ReasonCode }>): Record<ReasonCode, number> {
  const out = Object.fromEntries(REASON_CODES.map((r) => [r, 0])) as Record<ReasonCode, number>;
  if (items.length === 0) return out;
  for (const i of items) out[i.reason]++;
  for (const r of REASON_CODES) out[r] /= items.length;
  return out;
}

/** Marks a later item with the same company and normalised title as an earlier one (location ignored). Returns one flag per item. */
export function duplicateFlags(items: ReadonlyArray<{ company: string | null; title: string }>): boolean[] {
  const seen = new Set<string>();
  return items.map((i) => {
    const key = `${(i.company ?? "").toLowerCase().trim()}|${i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

export type ProfileMetrics = {
  size: number;
  p10: number;
  p20: number;
  p10Returned: number | null;
  p10Dedup: number;
  p20Dedup: number;
  meanScore: number | null;
  ndcg20: number | null;
  duplicates: number;
  reasonShares: Record<ReasonCode, number>;
  /** Reason shares among items that missed: a score below the threshold, or a duplicate listing (whose `reason` the caller sets to "duplicate"). */
  failureShares: Record<ReasonCode, number>;
  widened: { count: number; meanScore: number | null; hitRate: number | null; byStep: Record<string, { count: number; meanScore: number | null }> };
  lane: { count: number; meanScore: number | null; hitRate: number | null };
};

/** Metrics for one ranked list of judgments (rank 1 first). */
export function profileMetrics(items: readonly RankedJudgment[]): ProfileMetrics {
  const ranked = [...items].sort((a, b) => a.rank - b.rank);
  const scores = ranked.map((i) => i.score);
  // A duplicate listing is not a second hit: for the dedup variants it counts as score 1.
  const dedupScores = ranked.map((i) => (i.duplicate ? 1 : i.score));
  const widened = ranked.filter((i) => i.widenedBy);
  const lane = ranked.filter((i) => !i.widenedBy);
  const hit = (xs: readonly RankedJudgment[]) => (xs.length === 0 ? null : xs.filter((i) => i.score >= RELEVANT_SCORE).length / xs.length);
  const byStep: Record<string, { count: number; meanScore: number | null }> = {};
  for (const step of new Set(widened.map((w) => w.widenedBy!))) {
    const xs = widened.filter((w) => w.widenedBy === step);
    byStep[step] = { count: xs.length, meanScore: mean(xs.map((x) => x.score)) };
  }
  return {
    size: ranked.length,
    p10: precisionAt(scores, 10),
    p20: precisionAt(scores, 20),
    p10Returned: precisionOfReturned(scores, 10),
    p10Dedup: precisionAt(dedupScores, 10),
    p20Dedup: precisionAt(dedupScores, 20),
    meanScore: mean(scores),
    ndcg20: ndcgAt(scores, 20),
    duplicates: ranked.filter((i) => i.duplicate).length,
    reasonShares: reasonShares(ranked),
    failureShares: reasonShares(ranked.filter((i) => i.score < RELEVANT_SCORE || i.duplicate)),
    widened: { count: widened.length, meanScore: mean(widened.map((i) => i.score)), hitRate: hit(widened), byStep },
    lane: { count: lane.length, meanScore: mean(lane.map((i) => i.score)), hitRate: hit(lane) },
  };
}

const avgOf = (xs: ReadonlyArray<number | null>): number | null => mean(xs.filter((x): x is number => x !== null));

/** Overall figures: P@k, nDCG and mean score averaged per profile (each profile counts once), reason shares pooled over every judged job. */
export function overallMetrics(perProfile: ReadonlyArray<{ metrics: ProfileMetrics; items: readonly RankedJudgment[] }>) {
  const all = perProfile.flatMap((p) => p.items);
  const pooledWidened = all.filter((i) => i.widenedBy);
  const pooledLane = all.filter((i) => !i.widenedBy);
  const hit = (xs: readonly RankedJudgment[]) => (xs.length === 0 ? null : xs.filter((i) => i.score >= RELEVANT_SCORE).length / xs.length);
  return {
    profiles: perProfile.length,
    shortlistSizeMean: avgOf(perProfile.map((p) => p.metrics.size)),
    p10: avgOf(perProfile.map((p) => p.metrics.p10)),
    p20: avgOf(perProfile.map((p) => p.metrics.p20)),
    p10Dedup: avgOf(perProfile.map((p) => p.metrics.p10Dedup)),
    p20Dedup: avgOf(perProfile.map((p) => p.metrics.p20Dedup)),
    ndcg20: avgOf(perProfile.map((p) => p.metrics.ndcg20)),
    meanScoreMacro: avgOf(perProfile.map((p) => p.metrics.meanScore)),
    meanScorePooled: mean(all.map((i) => i.score)),
    judged: all.length,
    reasonShares: reasonShares(all),
    failureShares: reasonShares(all.filter((i) => i.score < RELEVANT_SCORE || i.duplicate)),
    widened: { count: pooledWidened.length, meanScore: mean(pooledWidened.map((i) => i.score)), hitRate: hit(pooledWidened) },
    lane: { count: pooledLane.length, meanScore: mean(pooledLane.map((i) => i.score)), hitRate: hit(pooledLane) },
    duplicates: all.filter((i) => i.duplicate).length,
  };
}
