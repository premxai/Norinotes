/**
 * How long a new job takes to reach a person: from first_seen_at to the shortlist and to a prepared application.
 *
 *   npx tsx scripts/measure-fast-path.mts [--runs 5] [--timeout 60]
 *
 * Runs the worker in this process with real timers (scheduler on, default MATCH_BATCH_MS), an in-memory PGlite database,
 * the in-memory queue, a local fake board (no network) and the fake AI provider (no paid calls). One person with a lane
 * and the schedule (autopilot) on, so a strong fit may be prepared for them. A new job is posted on the board and the
 * board is made due; the script waits for its shortlist row and its prepared application. Nothing is sent: the form
 * step is stubbed and ALLOW_REAL_SUBMIT is never set.
 */
import { createFakeProvider, setProvider } from "@norinote/ai";
import { applications, careerPoints, companies, eq, jobs, lanes, profiles, shortlist, users } from "@norinote/db";
import { createTestDb } from "@norinote/db/testing";
import { saveSchedule } from "@norinote/apply";
import { embedCareerPoints } from "@norinote/graph";
import { MemoryQueue } from "@norinote/queue";
import { createLogger, createPreparer, loadConfig, startWorker } from "../apps/worker/src/index.js";

delete process.env.ALLOW_REAL_SUBMIT;
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;
const TIMEOUT_MS = (Number(process.argv[process.argv.indexOf("--timeout") + 1]) || 60) * 1000;

const spec = {
  mustHaves: ["Python", "Kubernetes", "PostgreSQL", "AWS", "Docker", "Terraform"].map((text) => ({ text, weight: 0.8 })), niceToHaves: [{ text: "Redis", weight: 0.3 }],
  skills: ["Python", "Kubernetes", "PostgreSQL", "AWS", "Docker", "Terraform"].map((name) => ({ name, level: "advanced", years: null, required: true })),
  seniority: "mid", roleFamily: "backend engineering", yearsMin: null,
  location: { remote: "remote", countries: ["United States"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: ["Build backend APIs"],
};
setProvider(createFakeProvider({ chat: (req) => (req.jsonSchema?.name === "job_spec" ? spec : undefined) }));

const t = await createTestDb();
const db = t.db;
const [user] = await db.insert(users).values({ email: "measure@example.test", passwordHash: "x" }).returning();
const userId = user!.id;
await db.insert(profiles).values({ userId, location: "Austin, TX", contact: { name: "Test Person", email: "measure@example.test" }, workAuth: { US: { authorized: true, needsSponsorship: false } } });
await db.insert(lanes).values({ userId, name: "Backend", titles: ["Backend Engineer"], locations: [], remote: true, minFit: 0.2 });
await db.insert(careerPoints).values([
  { userId, kind: "role", title: "Backend Engineer", org: "Initech", startDate: "2021-01", endDate: null, skills: ["Python", "Kubernetes", "PostgreSQL", "AWS", "Docker", "Terraform"],
    text: "Backend Engineer. Built backend APIs in Python on Kubernetes with PostgreSQL on AWS, packaged with Docker and provisioned with Terraform." },
  { userId, kind: "project", title: "Payments API", org: "Initech", startDate: "2022-03", endDate: null, skills: ["Python", "PostgreSQL", "Redis", "AWS"],
    text: "Payments API in Python and PostgreSQL with Redis caching on AWS, serving 2,000 requests a second." },
  { userId, kind: "role", title: "Platform Engineer", org: "Hooli", startDate: "2018-06", endDate: "2020-12", skills: ["Kubernetes", "Docker", "Terraform", "AWS"],
    text: "Platform Engineer. Ran Kubernetes clusters on AWS with Docker and Terraform." },
]);
await embedCareerPoints(db, userId);
// The schedule (autopilot) on, at a time that is not due during the run.
await saveSchedule(db, userId, { enabled: true, days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], time: "03:00", timezone: "Pacific/Kiritimati", lastRunOn: null });

const posted: Array<{ id: number; title: string; at: string }> = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const m = /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs/.exec(url);
  if (!m) return new Response("not found", { status: 404 });
  const board = posted.filter((p) => url.includes(`/boards/co${p.id}/`));
  return new Response(JSON.stringify({ jobs: board.map((p) => ({
    id: p.id, title: p.title, absolute_url: `https://boards.greenhouse.io/co${p.id}/jobs/${p.id}`, first_published: p.at,
    location: { name: "Remote - US" }, company_name: `Company ${p.id}`,
    content: "&lt;p&gt;Backend Engineer. Build backend APIs in Python on Kubernetes with PostgreSQL on AWS. Package services with Docker and provision infrastructure with Terraform. Own services end to end, from design to on-call. You will work with product and data teams to ship payment features, keep latency low with Redis caching, and improve reliability. Requirements: strong Python, production Kubernetes, PostgreSQL schema design, AWS, Docker, Terraform. Nice to have: Redis. We are a remote-first team in the United States building tools that help small businesses get paid faster. Benefits include health insurance, equity and a learning budget.&lt;/p&gt;",
  })) }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const config = { ...loadConfig({}), scheduleEveryMs: 1000, batchDrainMs: 1000 };
const worker = await startWorker({
  db, queue: new MemoryQueue(), config, log: createLogger(() => {}), fetch: fakeFetch, seed: false, warmUp: false,
  preparer: createPreparer(db, { form: async () => ({ outcome: "prepared", pending: [], timings: {} }) }),
});

const results: Array<{ shortlistMs: number | null; preparedMs: number | null; fit: number | null }> = [];
for (let i = 1; i <= runs; i++) {
  const id = 7000 + i;
  // An existing, healthy board (read before), due now, that just posted a job.
  await db.insert(companies).values({ atsType: "greenhouse", atsToken: `co${id}`, name: `Company ${id}`, status: "active", firstReadAt: new Date(Date.now() - 86_400_000), nextPollAt: new Date() });
  posted.push({ id, title: "Backend Engineer", at: new Date().toISOString() });
  const deadline = Date.now() + TIMEOUT_MS;
  let row: { firstSeenAt: Date; jobId: string } | undefined;
  let shortlisted: { createdAt: Date; fit: number } | undefined;
  let prepared: Date | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    [row] = await db.select({ firstSeenAt: jobs.firstSeenAt, jobId: jobs.id }).from(jobs).where(eq(jobs.externalId, String(id)));
    if (!row) continue;
    [shortlisted] = await db.select({ createdAt: shortlist.createdAt, fit: shortlist.fit }).from(shortlist).where(eq(shortlist.jobId, row.jobId));
    const [app] = await db.select({ preparedAt: applications.preparedAt }).from(applications).where(eq(applications.jobId, row.jobId));
    prepared = app?.preparedAt ?? null;
    if (prepared) break;
  }
  const since = (d: Date | null | undefined) => (row && d ? d.getTime() - row.firstSeenAt.getTime() : null);
  results.push({ shortlistMs: since(shortlisted?.createdAt), preparedMs: since(prepared), fit: shortlisted?.fit ?? null });
  console.log(`run ${i}: fit ${shortlisted?.fit ?? "-"}, first_seen -> shortlist ${since(shortlisted?.createdAt) ?? "not within the run"} ms, -> prepared ${since(prepared) ?? `not within ${TIMEOUT_MS / 1000} s`}${since(prepared) === null ? "" : " ms"}`);
}
const median = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
console.log(`median: first_seen -> shortlist ${median(results.map((r) => r.shortlistMs))} ms, first_seen -> prepared ${median(results.map((r) => r.preparedMs))?.toString().concat(" ms") ?? "never (waits for the schedule or a click)"}`);
await worker.stop();
await t.close();
process.exit(0);
