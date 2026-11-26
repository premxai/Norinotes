/**
 * Greenhouse postings that send people to the company's own careers site: what is behind them, and how far Nori's
 * Greenhouse driver gets. Dry run only, with the clearly fictional applicant; submit is never called.
 *
 *   npx tsx scripts/eval/career-sites.mts --out ~/.capy/work/careers                # pick a sample (sample.json)
 *   npx tsx scripts/eval/career-sites.mts --out ~/.capy/work/careers --survey       # classify each page (survey.json)
 *   npx tsx scripts/eval/career-sites.mts --out ~/.capy/work/careers --fill before  # driver dry run (fill-before.json)
 *   add --only <token-id,...> to run part of the sample and --label <name> to name the output file
 *
 * Sample: Greenhouse boards in the registry, jobs first published in the last 7 days with a US location, whose posting
 * link (absolute_url) is not on greenhouse.io; newest first, at most 2 per company. One request at a time with gaps,
 * robots.txt checked for every page the walk opens, never a boards.greenhouse.io/embed/ address. Results hold company
 * tokens, job ids, hosts and counts only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, migrate } from "@norinote/db";
import { BOARD_REGISTRY, EARLY_CAREER_BOARDS, getJson } from "@norinote/ingest";
import { createBrowserPool, detectDriver, followToForm, greenhouseDriver, submitAllowed, type DriverContext, type FillResult } from "@norinote/apply";
import { APPLICANT_PROFILE, seedApplicant } from "./lib/applicant.js";

delete process.env.ALLOW_REAL_SUBMIT;
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", path.join(os.homedir(), ".capy/work/careers"))!.replace(/^~/, os.homedir()));
const MAX = Number(opt("n", "80"));
const FILL = opt("fill");
const ONLY = opt("only")?.split(",");
const LABEL = opt("label");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(path.join(OUT, "shots"), { recursive: true });

type Job = { token: string; company: string; id: string; title: string; url: string; host: string; published: string };
type GhJob = { id: number; title: string; absolute_url: string; first_published?: string; location?: { name?: string } };

const NON_US = /\b(canada|toronto|vancouver|montreal|london|united kingdom|\buk\b|ireland|dublin|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|poland|warsaw|india|bangalore|bengaluru|hyderabad|pune|singapore|japan|tokyo|australia|sydney|melbourne|brazil|são paulo|sao paulo|mexico|israel|tel aviv|emea|apac|latam|europe|korea|seoul|china|hong kong|taiwan|philippines|argentina|colombia|chile|portugal|lisbon|italy|milan|sweden|stockholm|denmark|copenhagen|switzerland|zurich|austria|vienna|belgium|czech|prague|romania|ukraine|serbia|nigeria|kenya|south africa|uae|dubai|new zealand)\b/i;
const US = /\b(united states|usa|u\.s\.|\bus\b|remote|new york|nyc|san francisco|sf|bay area|seattle|austin|boston|chicago|los angeles|denver|atlanta|washington|dc|miami|dallas|houston|portland|san jose|palo alto|mountain view|menlo park|sunnyvale|san mateo|redwood city|oakland|san diego|philadelphia|pittsburgh|phoenix|salt lake|minneapolis|detroit|nashville|raleigh|charlotte|columbus|baltimore|st\. louis|kansas city|irvine|boulder|brooklyn|jersey|ca|ny|wa|tx|ma|il|co|ga|fl|nc|va|or|ut|az|pa|nj|mn|mi|oh|tn|md)\b/i;

async function pickSample(): Promise<Job[]> {
  const boards = [...new Map([...BOARD_REGISTRY, ...EARLY_CAREER_BOARDS].filter((b) => b.atsType === "greenhouse").map((b) => [b.token, b])).values()];
  const since = Date.now() - 7 * 86_400_000;
  const perCompany: Job[][] = [];
  for (const b of boards) {
    const json = await getJson<{ jobs: GhJob[] }>("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(b.token) + "/jobs").catch(() => null);
    await sleep(700);
    const fresh = (json?.jobs ?? []).filter((j) => {
      const loc = j.location?.name ?? "";
      const host = (() => { try { return new URL(j.absolute_url).hostname; } catch { return ""; } })();
      return host && !/(^|\.)greenhouse\.io$/i.test(host) && j.first_published && Date.parse(j.first_published) >= since && US.test(loc) && !NON_US.test(loc);
    }).sort((a, z) => Date.parse(z.first_published!) - Date.parse(a.first_published!));
    if (fresh.length) perCompany.push(fresh.slice(0, 2).map((j) => ({ token: b.token, company: b.name, id: String(j.id), title: j.title, url: j.absolute_url, host: new URL(j.absolute_url).hostname, published: j.first_published! })));
    console.log(b.token + ": " + fresh.length + " fresh US off-site");
  }
  const picked = [...perCompany.map((c) => c[0]!), ...perCompany.flatMap((c) => c.slice(1))].slice(0, MAX);
  console.log(boards.length + " boards, " + perCompany.length + " companies with fresh off-site US jobs, " + picked.length + " picked");
  return picked;
}

async function main() {
  const samplePath = path.join(OUT, "sample.json");
  if (!existsSync(samplePath)) writeFileSync(samplePath, JSON.stringify(await pickSample(), null, 1));
  const sample = (JSON.parse(readFileSync(samplePath, "utf8")) as Job[]).filter((j) => !ONLY || ONLY.includes(j.token + "-" + j.id));
  if (!args.includes("--survey") && !FILL) return;

  const handle = await connect({ pgliteDir: path.join(os.tmpdir(), "norinote-career-sites") });
  await migrate(handle);
  const { resumePath } = await seedApplicant(handle.db);
  const pool = createBrowserPool({ size: 1, artifactsDir: path.join(os.tmpdir(), "norinote-career-sites-artifacts"), spareContexts: 0 });
  const results: Record<string, unknown>[] = [];
  const outFile = path.join(OUT, (FILL ? "fill-" + FILL : "survey") + (LABEL ? "-" + LABEL : "") + ".json");
  try {
    for (const job of sample) {
      const key = job.token + "-" + job.id;
      const t = Date.now();
      try {
        const { value } = await pool.run("career-" + key, async (page) => {
          if (!FILL) {
            const site = await followToForm(page, job.url, { detect: (u) => detectDriver(u)?.name ?? null });
            await page.screenshot({ path: path.join(OUT, "shots", key + "-survey.png"), timeout: 15_000 }).catch(() => {});
            return { ...site, url: undefined, finalHost: new URL(site.url).hostname, finalPath: new URL(site.url).pathname.slice(0, 80) };
          }
          const ctx: DriverContext = {
            applicationId: "career-" + key, applyUrl: job.url, profile: APPLICANT_PROFILE, resumePdfPath: resumePath, answers: {}, dryRun: true,
            onEvent: (step, message) => { if (args.includes("--verbose")) console.log("  " + step + ": " + message.slice(0, 160)); }, recordSubmitClick: async () => { throw new Error("dry runs never submit"); },
          };
          if (submitAllowed(ctx)) throw new Error("refusing: submit would be allowed");
          const fill: FillResult = await greenhouseDriver.fill(page, ctx);
          await page.screenshot({ path: path.join(OUT, "shots", key + "-" + FILL + ".png"), timeout: 15_000 }).catch(() => {});
          return { status: fill.status, needsUser: fill.needsUser?.kind, reason: fill.needsUser?.reason, error: fill.error, filled: fill.fields.length, files: fill.files.length, pending: fill.pending.length,
            finalHost: fill.formUrl ? new URL(fill.formUrl).hostname : new URL(page.url()).hostname };
        }, { timeoutMs: 150_000 });
        results.push({ token: job.token, company: job.company, id: job.id, startHost: job.host, ms: Date.now() - t, ...value });
      } catch (err) {
        results.push({ token: job.token, company: job.company, id: job.id, startHost: job.host, ms: Date.now() - t, kind: "crashed", status: "crashed", error: String(err instanceof Error ? err.message : err).slice(0, 200) });
      }
      const r = results.at(-1)!;
      console.log(key + ": " + (r.kind ?? r.status) + " " + (r.driver ?? r.system ?? r.needsUser ?? r.error ?? "") + " -> " + r.finalHost + " (" + r.ms + " ms)");
      writeFileSync(outFile, JSON.stringify(results, null, 1));
      await sleep(2000);
    }
  } finally {
    await pool.close();
    await handle.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
