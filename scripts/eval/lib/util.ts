export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. The first rejection stops new work and rejects. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]!, i); } catch (e) { failed ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed !== null) throw failed;
  return out;
}
