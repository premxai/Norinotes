import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { fetchGreenhouseSchema } from "./schema.js";
import { checkStillOpen, FORBIDDEN_RETRY_MS } from "./still-open.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let seq = 0;
async function seedJob(atsType: "greenhouse" | "lever" | "ashby" | "workday", extra: Partial<typeof jobs.$inferInsert> = {}) {
  const n = ++seq;
  const [c] = await t.db.insert(companies).values({ atsType, atsToken: `board${n}`, name: `Co ${n}` }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType, externalId: `p${n}`, title: "Engineer", applyUrl: `https://example.test/${n}`, dedupeKey: `k${n}`, ...extra }).returning();
  return { job: j!, token: c!.atsToken };
}

/** A fake board, no network: robots.txt is absent; each posting request gets the next answer. */
function board(...answers: Array<Response | Error>) {
  const asked: string[] = [];
  const slept: number[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    asked.push(url);
    const r = answers[Math.min(asked.length - 1, answers.length - 1)]!;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as typeof globalThis.fetch;
  return { asked, slept, fetch, opts: { fetch, sleep: async (ms: number) => { slept.push(ms); } } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const closedAt = async (id: string) => (await t.db.select({ closedAt: jobs.closedAt }).from(jobs).where(eq(jobs.id, id)))[0]!.closedAt;

describe("checkStillOpen", () => {
  it("reads Greenhouse's job JSON with its questions, and prepare's schema read reuses it", async () => {
    const { job, token } = await seedJob("greenhouse");
    const b = board(json({ id: 7, title: "Engineer", questions: [{ label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] }] }));
    expect(await checkStillOpen(t.db, job.id, b.opts)).toMatchObject({ state: "open", status: 200 });
    expect(b.asked).toEqual([`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${job.externalId}?questions=true`]);
    const schema = await fetchGreenhouseSchema(token, job.externalId, { fetch: b.fetch });
    expect(schema?.fields.map((f) => f.label)).toContain("First Name");
    expect(b.asked).toHaveLength(1);
  });

  it("a 404 or 410 closes the job", async () => {
    for (const status of [404, 410]) {
      const { job } = await seedJob("greenhouse");
      expect(await checkStillOpen(t.db, job.id, board(new Response("", { status })).opts)).toMatchObject({ state: "closed", status });
      expect(await closedAt(job.id)).toBeInstanceOf(Date);
    }
  });

  it("a 403 counts as closed only when the retry is refused too", async () => {
    const once = await seedJob("greenhouse");
    const b1 = board(new Response("", { status: 403 }), json({ id: 1 }));
    expect(await checkStillOpen(t.db, once.job.id, b1.opts)).toMatchObject({ state: "open" });
    expect(b1.asked).toHaveLength(2);
    expect(b1.slept).toEqual([FORBIDDEN_RETRY_MS]);
    expect(await closedAt(once.job.id)).toBeNull();

    const twice = await seedJob("greenhouse");
    const b2 = board(new Response("", { status: 403 }));
    expect(await checkStillOpen(t.db, twice.job.id, b2.opts)).toMatchObject({ state: "closed", status: 403 });
    expect(b2.asked).toHaveLength(2);
    expect(await closedAt(twice.job.id)).toBeInstanceOf(Date);
  });

  it("a network error, a timeout or a server error is unknown and leaves the job open", async () => {
    for (const answer of [new TypeError("fetch failed"), new Error("GET x timed out after 15000ms"), new Response("", { status: 500 })]) {
      const { job } = await seedJob("greenhouse");
      expect(await checkStillOpen(t.db, job.id, board(answer).opts)).toMatchObject({ state: "unknown" });
      expect(await closedAt(job.id)).toBeNull();
    }
  });

  it("reads Lever's posting JSON", async () => {
    const open = await seedJob("lever");
    const b = board(json({ id: open.job.externalId, text: "Engineer" }));
    expect(await checkStillOpen(t.db, open.job.id, b.opts)).toMatchObject({ state: "open" });
    expect(b.asked).toEqual([`https://api.lever.co/v0/postings/${open.token}/${open.job.externalId}`]);
    const gone = await seedJob("lever");
    expect(await checkStillOpen(t.db, gone.job.id, board(json({ ok: false, error: "Document not found" }, 404)).opts)).toMatchObject({ state: "closed" });
  });

  it("reads Ashby's public job board: a posting it no longer lists is closed", async () => {
    const { job, token } = await seedJob("ashby");
    const listed = board(json({ jobs: [{ id: job.externalId, title: "Engineer" }] }));
    expect(await checkStillOpen(t.db, job.id, listed.opts)).toMatchObject({ state: "open" });
    expect(listed.asked).toEqual([`https://api.ashbyhq.com/posting-api/job-board/${token}`]);
    expect(listed.asked.some((u) => /jobs\.ashbyhq\.com\/api\//.test(u))).toBe(false);
    expect(await checkStillOpen(t.db, job.id, board(json({ jobs: [{ id: "other" }, { id: job.externalId, isListed: false }] })).opts)).toMatchObject({ state: "closed", why: "the board no longer lists it" });
    expect(await closedAt(job.id)).toBeInstanceOf(Date);
  });

  it("a page saying the posting no longer takes applications is closed", async () => {
    const { job } = await seedJob("lever");
    const page = new Response("<html><body><h1>This job is no longer accepting applications</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await checkStillOpen(t.db, job.id, board(page).opts)).toMatchObject({ state: "closed" });
  });

  it("asks nothing for a job the board already closed, or a job system it does not check", async () => {
    const closed = await seedJob("greenhouse", { closedAt: new Date("2026-11-20T00:00:00Z") });
    const b = board(json({ id: 1 }));
    expect(await checkStillOpen(t.db, closed.job.id, b.opts)).toMatchObject({ state: "closed" });
    const workday = await seedJob("workday");
    expect(await checkStillOpen(t.db, workday.job.id, b.opts)).toMatchObject({ state: "unknown" });
    expect(b.asked).toEqual([]);
  });
});
