import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, inboxMessages, jobs, outcomes, profiles, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { pollGmailReplies, registrableDomain, replyQueries, saveGmailConnection, type ComposioGmail, type GmailMessage } from "./index.js";

describe("which mail is asked for", () => {
  it("reduces a host or URL to its registrable domain", () => {
    expect(registrableDomain("https://careers.acme.com/jobs/1")).toBe("acme.com");
    expect(registrableDomain("jobs.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("acme.io")).toBe("acme.io");
    expect(registrableDomain("localhost")).toBeNull();
  });

  it("asks for the company's own domain and for its job system's mail that names it, and nothing else", () => {
    const since = new Date("2026-11-01T00:00:00Z");
    const [q, ...rest] = replyQueries([
      { companyName: "Acme Robotics", companyDomain: "acmerobotics.com", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1", atsType: "greenhouse" },
      { companyName: "Initech", companyDomain: null, applyUrl: "https://careers.initech.example.com/apply/9", atsType: "lever" },
      { companyName: 'Quote "Co"', companyDomain: null, applyUrl: "https://jobs.lever.co/quote/1", atsType: "lever" },
    ], since);
    expect(rest).toEqual([]);
    expect(q).toMatch(new RegExp(`^after:${since.getTime() / 1000} -in:chats -in:sent -in:drafts \\(`));
    expect(q).toContain("from:acmerobotics.com");
    expect(q).toContain('(from:(greenhouse-mail.io OR greenhouse.io) "Acme Robotics")');
    expect(q).toContain("from:example.com");
    expect(q).toContain('(from:(hire.lever.co OR lever.co) "Quote Co")');
    expect(q).not.toContain("from:greenhouse.io OR");
    expect(q).not.toMatch(/from:lever\.co\b(?! OR|\))/);
  });

  it("splits a long list into several searches", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ companyName: `Company ${i}`, companyDomain: `company${i}.com`, applyUrl: "", atsType: "greenhouse" as const }));
    const qs = replyQueries(many, new Date());
    expect(qs.length).toBeGreaterThan(1);
    for (const q of qs) expect(q.length).toBeLessThanOrEqual(1500);
    expect(qs.join(" ")).toContain("from:company79.com");
  });
});

describe("polling a connected Gmail for employer replies", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  const NOW = new Date("2026-11-20T12:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
  let n = 0;

  async function person(o: { status?: "submitted" | "prepared"; connected?: boolean } = {}) {
    const [u] = await t.db.insert(users).values({ email: `r${n++}@example.test`, passwordHash: "x" }).returning();
    await t.db.insert(profiles).values({ userId: u!.id });
    const [c] = await t.db.insert(companies).values({ name: "Acme Robotics", atsType: "greenhouse", atsToken: `acme-${n++}`, domain: "acmerobotics.com" }).returning();
    const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `x${n++}`, title: "Platform Engineer", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1", dedupeKey: `k${n++}` }).returning();
    const submitted = (o.status ?? "submitted") === "submitted";
    const [a] = await t.db.insert(applications).values({ userId: u!.id, jobId: j!.id, status: o.status ?? "submitted", submittedAt: submitted ? daysAgo(10) : null }).returning();
    if (o.connected !== false) await saveGmailConnection(t.db, u!.id, { connectedAccountId: `ca_${n++}`, startedAt: daysAgo(30).toISOString(), activeAt: daysAgo(30).toISOString() });
    return { userId: u!.id, appId: a!.id };
  }

  function fakeGmail(pages: GmailMessage[][], o: { status?: string; fail?: boolean } = {}) {
    const queries: string[] = [];
    const g: ComposioGmail & { queries: string[] } = {
      queries,
      connect: async () => ({ url: "", connectedAccountId: null }),
      status: async () => (o.status ?? "ACTIVE") as never,
      disconnect: async () => undefined,
      fetch: async () => { throw new Error("use fetchPage"); },
      fetchPage: async (_u, query, { pageToken }) => {
        if (o.fail) throw new Error("Composio down");
        queries.push(query);
        const i = pageToken ? Number(pageToken) : 0;
        return { messages: pages[i] ?? [], nextPageToken: i + 1 < pages.length ? String(i + 1) : null };
      },
    };
    return g;
  }

  const LONG = "We enjoyed reading your application and would like to invite you to an interview for the Platform Engineer role. ".repeat(6) + "Pick a time here: https://calendly.com/acme/30min";
  const mail: GmailMessage[][] = [
    [
      { id: "r1", from: "Dana Recruiter <dana@acmerobotics.com>", subject: "Interview for Platform Engineer", text: LONG, receivedAt: daysAgo(3) },
      { id: "r2", from: "Acme Robotics <news@acmerobotics.com>", subject: "Acme Robotics newsletter, issue 12", text: "Our latest robots. Unsubscribe here.", receivedAt: daysAgo(2) },
    ],
    [
      { id: "r3", from: "Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Your application to Acme Robotics", text: "Thank you for your time. Unfortunately we will not be moving forward with your application.", receivedAt: daysAgo(1) },
      { id: "r4", from: "A Friend <friend@example.org>", subject: "Did Acme Robotics reply?", text: "Any news on the interview with Acme Robotics? Unfortunately I have not heard.", receivedAt: daysAgo(1) },
    ],
  ];

  it("keeps only trusted replies to submitted applications, as a snippet, and records their outcomes", async () => {
    const { userId, appId } = await person();
    const gmail = fakeGmail(mail);
    const res = await pollGmailReplies({ db: t.db, gmail, userId, now: NOW });
    expect(res).toEqual({ status: "done", read: 4, stored: 2, outcomes: 2 });
    expect(gmail.queries[0]).toContain(`after:${daysAgo(10).getTime() / 1000}`);

    const stored = await t.db.select().from(inboxMessages).where(eq(inboxMessages.userId, userId));
    expect(stored.map((m) => m.kind).sort()).toEqual(["interview", "rejection"]);
    for (const m of stored) {
      expect(m.applicationId).toBe(appId);
      expect(m.body.length).toBeLessThanOrEqual(280);
      expect(m.links).toEqual([]);
      expect(m.meta).toMatchObject({ snippetOnly: true, trusted: true });
    }
    expect(stored.find((m) => m.kind === "interview")?.receivedAt).toEqual(daysAgo(3));
    const rows = await t.db.select().from(outcomes).where(eq(outcomes.applicationId, appId));
    expect(rows.map((r) => [r.kind, r.at.getTime()]).sort()).toEqual([["interview", daysAgo(3).getTime()], ["rejection", daysAgo(1).getTime()]]);

    // The next poll starts an hour before this one and stores nothing twice.
    const later = new Date(NOW.getTime() + 3_600_000 * 2);
    const again = fakeGmail(mail);
    expect(await pollGmailReplies({ db: t.db, gmail: again, userId, now: later })).toMatchObject({ status: "done", stored: 0, outcomes: 0 });
    expect(again.queries[0]).toContain(`after:${(NOW.getTime() - 3_600_000) / 1000}`);
    expect(await t.db.select().from(inboxMessages).where(eq(inboxMessages.userId, userId))).toHaveLength(2);
  });

  it("reads nothing without an active connection or a submitted application", async () => {
    const none = await person({ connected: false });
    expect(await pollGmailReplies({ db: t.db, gmail: fakeGmail(mail), userId: none.userId, now: NOW })).toMatchObject({ status: "no_connection" });
    const expired = await person();
    const g1 = fakeGmail(mail, { status: "EXPIRED" });
    expect(await pollGmailReplies({ db: t.db, gmail: g1, userId: expired.userId, now: NOW })).toMatchObject({ status: "not_active" });
    expect(g1.queries).toEqual([]);
    const notSent = await person({ status: "prepared" });
    const g2 = fakeGmail(mail);
    expect(await pollGmailReplies({ db: t.db, gmail: g2, userId: notSent.userId, now: NOW })).toMatchObject({ status: "nothing_applied" });
    expect(g2.queries).toEqual([]);
    expect(await t.db.select().from(inboxMessages).where(eq(inboxMessages.userId, notSent.userId))).toHaveLength(0);
  });

  it("does not move on after a failed search, so the next poll reads the same mail", async () => {
    const { userId } = await person();
    const events: string[] = [];
    expect(await pollGmailReplies({ db: t.db, gmail: fakeGmail(mail, { fail: true }), userId, now: NOW, log: (e) => events.push(e) })).toMatchObject({ status: "failed" });
    expect(events).toEqual(["gmail.replies_failed"]);
    const [p] = await t.db.select({ p: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId));
    expect((p!.p as Record<string, unknown>).gmailReplies).toBeUndefined();
  });
});
