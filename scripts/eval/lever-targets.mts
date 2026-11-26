/**
 * Fresh US Lever postings for scripts/eval/lever-live.mts: the Lever boards in BOARD_REGISTRY first, then the
 * open-ats-feed seed list in random order, read one at a time through the public postings API (getJson: our User-Agent,
 * robots.txt and Crawl-delay obeyed) with 1.5 s between boards. Keeps postings created in the last 7 days whose country is
 * US, at most 2 per company.
 *
 *   npx tsx scripts/eval/lever-targets.mts [count=34] [out=lever-targets.json]
 */
import { writeFileSync } from "node:fs";
import { BOARD_REGISTRY, getJson, parseOpenAtsFeed, USER_AGENT } from "@norinote/ingest";
import { isUsPlace } from "@norinote/shared";

const FEED_URL = "https://raw.githubusercontent.com/veresk06/open-ats-feed/main/actor/data/companies.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const registry = BOARD_REGISTRY.filter((b) => b.atsType === "lever").map((b) => ({ token: b.token, name: b.name }));
const feedRes = await fetch(FEED_URL, { headers: { "user-agent": USER_AGENT } });
const feed = parseOpenAtsFeed(await feedRes.json()).rows.filter((r) => r.atsType === "lever").map((r) => ({ token: r.token, name: r.name }));
const seen = new Set<string>();
const tokens = [...registry, ...feed].filter((t) => (seen.has(t.token.toLowerCase()) ? false : (seen.add(t.token.toLowerCase()), true)));
console.error(`registry ${registry.length}, feed ${feed.length}, unique ${tokens.length}`);
const cutoff = Date.now() - 7 * 86_400_000;
type P = { id: string; text: string; hostedUrl?: string; createdAt?: number; categories?: { location?: string; allLocations?: string[] }; workplaceType?: string; country?: string };
const picked: { company: string; token: string; id: string; title: string; location: string; createdAt: string; url: string }[] = [];
const target = Number(process.argv[2] ?? 34);
const order = [...registry, ...feed.filter((f) => !registry.some((r) => r.token.toLowerCase() === f.token.toLowerCase())).sort(() => Math.random() - 0.5)];
const done = new Set<string>();
for (const t of order) {
  if (picked.length >= target) break;
  if (done.has(t.token.toLowerCase())) continue;
  done.add(t.token.toLowerCase());
  let list: P[] | null = null;
  try { list = await getJson<P[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(t.token)}?mode=json`); } catch (e) { console.error(t.token, String(e).slice(0, 80)); }
  await sleep(1500);
  if (!Array.isArray(list)) continue;
  const fresh = list.filter((p) => (p.createdAt ?? 0) >= cutoff && (p.country ? p.country === "US" : isUsPlace(p.categories?.location ?? null, false)) && p.hostedUrl);
  console.error(`${t.token}: ${list.length} open, ${fresh.length} fresh US`);
  for (const p of fresh.sort(() => Math.random() - 0.5).slice(0, 2)) {
    picked.push({ company: t.name, token: t.token, id: p.id, title: p.text, location: p.categories?.location ?? "", createdAt: new Date(p.createdAt!).toISOString(), country: p.country ?? "", url: p.hostedUrl! });
  }
}
writeFileSync(process.argv[3] ?? "lever-targets.json", JSON.stringify(picked.slice(0, target), null, 1));
console.error(`picked ${Math.min(picked.length, target)}`);
