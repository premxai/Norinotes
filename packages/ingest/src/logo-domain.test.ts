import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs, shortlist, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { logoDomainFromPostings, registrableDomain, resolveLogoDomains } from "./logo-domain.js";

const post = (applyUrl: string, descriptionText = "") => ({ applyUrl, descriptionText });

describe("registrableDomain", () => {
  it("keeps the registrable part of a host", () => {
    expect(registrableDomain("careers.acme.com")).toEqual({ domain: "acme.com", label: "acme" });
    expect(registrableDomain("jobs.acme.co.uk")).toEqual({ domain: "acme.co.uk", label: "acme" });
    expect(registrableDomain("acme.io")).toEqual({ domain: "acme.io", label: "acme" });
  });

  it("rejects what is not a domain name", () => {
    expect(registrableDomain("localhost")).toBeNull();
    expect(registrableDomain("10.0.0.1")).toBeNull();
    expect(registrableDomain("acme.c")).toBeNull();
  });
});

describe("logoDomainFromPostings", () => {
  it("takes the company's own apply host", () => {
    expect(logoDomainFromPostings("Acme, Inc.", [post("https://careers.acme.com/jobs/123?gh_jid=123")])).toBe("acme.com");
  });

  it("finds the company's address or site in the text", () => {
    expect(logoDomainFromPostings("Mercury", [post("https://jobs.ashbyhq.com/mercury/1", "Need an accommodation? Write to accommodations@mercury.com.")])).toBe("mercury.com");
    expect(logoDomainFromPostings("Acme Robotics", [post("https://boards.greenhouse.io/acme/jobs/1", "Learn more at www.acmerobotics.com/about.")])).toBe("acmerobotics.com");
  });

  it("accepts the usual domain spellings of a name", () => {
    expect(logoDomainFromPostings("Scale AI", [post("https://x.test/1", "See scale.com")])).toBe("scale.com");
    expect(logoDomainFromPostings("Acme", [post("https://x.test/1", "Apply via getacme.io")])).toBe("getacme.io");
    expect(logoDomainFromPostings("Acme", [post("https://x.test/1", "Visit acmehq.com")])).toBe("acmehq.com");
    expect(logoDomainFromPostings("The Acme Group", [post("https://x.test/1", "acme-careers.com")])).toBe("acme-careers.com");
  });

  it("never takes job systems, mail providers or other companies", () => {
    expect(logoDomainFromPostings("Acme", [post("https://jobs.lever.co/acme/1", "Questions: acme.recruiting@gmail.com. We partner with Stripe (stripe.com).")])).toBeNull();
    expect(logoDomainFromPostings("Acme", [post("https://acme.recruitee.com/o/engineer")])).toBeNull();
  });

  it("ignores file names, code and careers-only domains", () => {
    expect(logoDomainFromPostings("Node", [post("https://x.test/1", "We use Node.js and React.")])).toBeNull();
    expect(logoDomainFromPostings("Flix", [post("https://flix.careers/jobs/1")])).toBeNull();
  });

  it("prefers the best-supported domain", () => {
    const postings = [
      post("https://careers.acme.co.uk/1", "Write to jobs@acme.co.uk."),
      post("https://x.test/2", "acme.com"),
    ];
    expect(logoDomainFromPostings("Acme", postings)).toBe("acme.co.uk");
  });

  it("gives up on names too short to match safely", () => {
    expect(logoDomainFromPostings("X", [post("https://x.com/1")])).toBeNull();
  });
});

describe("resolveLogoDomains", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await t.db.delete(shortlist);
    await t.db.delete(jobs);
    await t.db.delete(companies);
    await t.db.delete(users);
  });

  const NOW = new Date("2026-11-04T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  let n = 0;

  async function company(name: string, extra: Partial<typeof companies.$inferInsert> = {}): Promise<string> {
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `logo-${n++}`, name, firstReadAt: hoursAgo(24 * 30), ...extra }).returning();
    return c!.id;
  }

  async function job(companyId: string, applyUrl: string, text = "", postedAt: Date = hoursAgo(2)): Promise<string> {
    const id = `logo-job-${n++}`;
    const [j] = await t.db.insert(jobs).values({
      companyId, atsType: "greenhouse", externalId: id, title: "Engineer", descriptionText: text, applyUrl, dedupeKey: id, postedAt, firstSeenAt: postedAt,
    }).returning();
    return j!.id;
  }

  const row = async (id: string) => (await t.db.select().from(companies).where(eq(companies.id, id)))[0]!;

  it("fills the domain of companies with fresh jobs and marks the rest checked", async () => {
    const acme = await company("Acme");
    await job(acme, "https://boards.greenhouse.io/acme/jobs/1", "Contact talent@acme.com");
    const quiet = await company("Quiet Co");
    await job(quiet, "https://boards.greenhouse.io/quiet/jobs/1", "No links here.");
    const stale = await company("Stale");
    await job(stale, "https://stale.com/1", "", hoursAgo(24 * 10));

    expect(await resolveLogoDomains(t.db, { now: NOW })).toEqual({ checked: 2, found: 1 });
    expect((await row(acme)).logoDomain).toBe("acme.com");
    expect((await row(quiet)).logoDomain).toBeNull();
    expect((await row(quiet)).logoCheckedAt).toEqual(NOW);
    expect((await row(stale)).logoCheckedAt).toBeNull();

    // Nothing is due until the recheck period has passed.
    expect(await resolveLogoDomains(t.db, { now: NOW })).toEqual({ checked: 0, found: 0 });
    await job(quiet, "https://boards.greenhouse.io/quiet/jobs/2", "quietco.com", new Date(NOW.getTime() + 8 * 86_400_000 - 3_600_000));
    expect(await resolveLogoDomains(t.db, { now: new Date(NOW.getTime() + 8 * 86_400_000) })).toEqual({ checked: 1, found: 1 });
    expect((await row(quiet)).logoDomain).toBe("quietco.com");
  });

  it("skips companies a seed already knows the domain of, and blocked ones", async () => {
    const known = await company("Known", { domain: "known.example" });
    await job(known, "https://known.com/1");
    const blocked = await company("Blocked", { blocked: true });
    await job(blocked, "https://blocked.com/1");
    expect(await resolveLogoDomains(t.db, { now: NOW })).toEqual({ checked: 0, found: 0 });
  });

  it("looks at shortlisted companies first", async () => {
    const first = await company("Alpha");
    await job(first, "https://alpha.com/1");
    const listed = await company("Beta");
    const jobId = await job(listed, "https://beta.com/1");
    const [u] = await t.db.insert(users).values({ email: `logo${n++}@example.test`, passwordHash: "x" }).returning();
    await t.db.insert(shortlist).values({ userId: u!.id, jobId, fit: 0.8 });

    expect(await resolveLogoDomains(t.db, { now: NOW, batchSize: 1 })).toEqual({ checked: 1, found: 1 });
    expect((await row(listed)).logoDomain).toBe("beta.com");
    expect((await row(first)).logoDomain).toBeNull();
  });
});
