import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, eq, lanes, profiles } from "@norinote/db";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

let api: Api;
beforeAll(async () => { api = await makeApi(); });
afterAll(() => api.close());

const lane = (over: Record<string, unknown> = {}) => ({ name: "Engineer", titles: ["Software Engineer"], locations: [], remote: true, enabled: true, ...over });

describe("one threshold and one skip list", () => {
  it("reads the threshold from the roles until it is saved, then sets every role to it", async () => {
    const { cookie, user } = await api.signup("threshold@example.com");
    // A role saved without minFit takes the threshold (0.7 by default).
    await api.call("PUT", "/api/lanes", { cookie, body: [lane()] });
    expect((await api.call("GET", "/api/lanes", { cookie })).json[0].minFit).toBe(0.7);
    await api.db.update(lanes).set({ minFit: 0.45 }).where(eq(lanes.userId, user.id));
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json.settings.minFit).toBe(0.45);

    const before = api.queuedOf("match.user").length;
    await api.call("PUT", "/api/nori/settings", { cookie, body: { minFit: 0.6 } });
    expect((await api.call("GET", "/api/lanes", { cookie })).json.map((l: { minFit: number }) => l.minFit)).toEqual([0.6]);
    expect(api.queuedOf("match.user").length).toBe(before + 1);
    // A new role takes it too.
    await api.call("PUT", "/api/lanes", { cookie, body: [lane(), lane({ name: "Data", titles: ["Data Engineer"] })] });
    expect((await api.call("GET", "/api/lanes", { cookie })).json.map((l: { minFit: number }) => l.minFit)).toEqual([0.6, 0.6]);
  });

  it("keeps one skip list, shared by the profile, Nori, Today and batches", async () => {
    const { cookie, user } = await api.signup("skiplist@example.com");
    // An older copy in Nori's settings still counts.
    await api.db.insert(profiles).values({ userId: user.id, preferences: { nori: { skipCompanies: ["Old Co"] } } })
      .onConflictDoUpdate({ target: profiles.userId, set: { preferences: { nori: { skipCompanies: ["Old Co"] } } } });
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json.settings.skipCompanies).toEqual(["Old Co"]);

    await api.call("PUT", "/api/nori/settings", { cookie, body: { skipCompanies: ["Acme", "Globex Inc"] } });
    const me = (await api.call("GET", "/api/me", { cookie })).json;
    expect(me.profile.preferences.excludeCompanies).toEqual(["Acme", "Globex Inc"]);
    expect(me.profile.preferences.nori?.skipCompanies).toBeUndefined();

    // Saved through the profile, Nori sees the same list.
    await api.call("PUT", "/api/profile", { cookie, body: { preferences: { excludeCompanies: ["Initech"] } } });
    expect((await api.call("GET", "/api/nori/settings", { cookie })).json.settings.skipCompanies).toEqual(["Initech"]);

    // Today leaves a skipped company out; batches skip it.
    const skipped = await seedJob(api.db, { company: "Initech, Inc." });
    const kept = await seedJob(api.db, { company: "Hooli" });
    await seedShortlist(api.db, user.id, skipped.job.id, 0.9);
    await seedShortlist(api.db, user.id, kept.job.id, 0.8);
    const today = (await api.call("GET", "/api/shortlist", { cookie })).json as { items?: { job: { id: string } }[] } | { job: { id: string } }[];
    const todayIds = (Array.isArray(today) ? today : today.items ?? []).map((i) => i.job.id);
    expect(todayIds).toContain(kept.job.id);
    expect(todayIds).not.toContain(skipped.job.id);
    const batch = await api.call("POST", "/api/nori/batches", { cookie, body: { jobIds: [skipped.job.id, kept.job.id] } });
    expect(batch.json.skipped).toEqual([{ jobId: skipped.job.id, reason: "skipped_company" }]);
  });
});

describe("Overview: applications sent per day", () => {
  it("lists every day with its count, in the person's time zone", async () => {
    const { cookie, user } = await api.signup("activity@example.com");
    const now = Date.now();
    for (const [hoursAgo, company] of [[1, "A1"], [2, "A2"], [49, "A3"]] as const) {
      const { job } = await seedJob(api.db, { company });
      await seedApplication(api.db, user.id, job.id, { status: "submitted", submittedAt: new Date(now - hoursAgo * 3_600_000) });
    }
    const { job: unsent } = await seedJob(api.db, { company: "A4" });
    await seedApplication(api.db, user.id, unsent.id);
    const res = (await api.call("GET", "/api/applications/activity?days=7&tz=America/Los_Angeles", { cookie })).json;
    expect(res.timezone).toBe("America/Los_Angeles");
    expect(res.days).toHaveLength(7);
    expect(res.total).toBe(3);
    expect(res.days.every((d: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    // A bad time zone falls back to UTC.
    expect((await api.call("GET", "/api/applications/activity?tz=Not/AZone", { cookie })).json).toMatchObject({ timezone: "UTC", total: 3 });
    expect((await api.call("GET", "/api/applications/activity?tz=Not/AZone", { cookie })).json.days).toHaveLength(182);
  });
});

describe("Apply means send", () => {
  it("marks a new application approved, so it goes to the form once prepared", async () => {
    const { cookie } = await api.signup("send@example.com");
    const { job } = await seedJob(api.db, { company: "Send Co" });
    const res = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id, send: true } });
    expect(res.status).toBe(201);
    const [row] = await api.db.select().from(applications).where(eq(applications.id, res.json.id));
    expect(row!.approvedAt).toBeTruthy();
    expect(api.queuedOf("prepare.application").some((q) => (q.payload as { applicationId: string }).applicationId === res.json.id)).toBe(true);
  });

  it("sends a prepared one at once, and stops at the daily limit", async () => {
    const { cookie, user } = await api.signup("send2@example.com");
    const { job } = await seedJob(api.db, { company: "Ready Co" });
    const app = await seedApplication(api.db, user.id, job.id, { status: "prepared", preparedAt: new Date() });
    const res = await api.call("POST", "/api/applications", { cookie, body: { jobId: job.id, send: true } });
    expect(res.json.status).toBe("applying");
    expect(api.queuedOf("apply.run").some((q) => (q.payload as { applicationId: string }).applicationId === app.id)).toBe(true);

    await api.call("PUT", "/api/profile", { cookie, body: { autoApplyDailyCap: 1 } });
    const { job: next } = await seedJob(api.db, { company: "Later Co" });
    expect((await api.call("POST", "/api/applications", { cookie, body: { jobId: next.id, send: true } })).status).toBe(429);
    // Without send, Apply still prepares it for a later click.
    expect((await api.call("POST", "/api/applications", { cookie, body: { jobId: next.id } })).status).toBe(201);
  });
});

describe("Apply now from Recommended, the company, a used code", () => {
  it("picks the person's Recommended jobs itself", async () => {
    const { cookie, user } = await api.signup("recommended@example.com");
    await api.call("PUT", "/api/nori/settings", { cookie, body: { minFit: 0.7, skipCompanies: ["Skip Co"] } });
    const strong = await seedJob(api.db, { company: "Strong Co" });
    const weak = await seedJob(api.db, { company: "Weak Co" });
    const skipped = await seedJob(api.db, { company: "Skip Co" });
    await seedShortlist(api.db, user.id, strong.job.id, 0.9);
    await seedShortlist(api.db, user.id, weak.job.id, 0.5);
    await seedShortlist(api.db, user.id, skipped.job.id, 0.95);
    const res = await api.call("POST", "/api/nori/batches", { cookie, body: { recommended: true } });
    expect(res.status).toBe(201);
    expect(res.json.added).toBe(1);
    const detail = (await api.call("GET", `/api/nori/batches/${res.json.batch.id}`, { cookie })).json;
    expect(detail.applications.map((a: { company: string }) => a.company)).toEqual(["Strong Co"]);
    // Nothing left to send.
    expect((await api.call("POST", "/api/nori/batches", { cookie, body: { recommended: true } })).status).toBe(409);
    expect((await api.call("POST", "/api/nori/batches", { cookie, body: { recommended: true, jobIds: [strong.job.id] } })).status).toBe(400);
  });

  it("shows the company, and pay only when the listing states it", async () => {
    const { cookie } = await api.signup("company@example.com");
    const { job } = await seedJob(api.db, { company: "Paid Co", description: "Full-time. The salary range is $150,000 - $180,000 per year." });
    const res = (await api.call("GET", `/api/jobs/${job.id}`, { cookie })).json;
    expect(res.job.company).toMatchObject({ name: "Paid Co", size: null, about: null });
    expect(res.job.pay).toEqual({ min: 150000, max: 180000, currency: "USD", period: "year" });
    expect(res.job.employmentType).toBe("full_time");
    const list = (await api.call("GET", "/api/jobs?view=new&lanes=false&group=false&limit=200", { cookie })).json as { job: { id: string; pay: unknown } }[];
    expect(list.find((i) => i.job.id === job.id)?.job.pay).toEqual({ min: 150000, max: 180000, currency: "USD", period: "year" });
  });
});

describe("Review: what Nori would send", () => {
  it("lists the form's questions with what Nori has and what it would ask, without AI or saving anything", async () => {
    const { readFileSync } = await import("node:fs");
    const gh = readFileSync(new URL("../../../packages/apply/src/fixtures/forms/greenhouse-discord-88407560.gh.json", import.meta.url), "utf8");
    const calls: string[] = [];
    const preview = await makeApi({ previewFetch: (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(gh, { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch });
    try {
      const { cookie } = await preview.signup("preview@example.com");
      const { job } = await seedJob(preview.db, { company: "Discord" });
      await preview.db.update((await import("@norinote/db")).jobs).set({ applyUrl: "https://job-boards.greenhouse.io/discord/jobs/8840756002" }).where(eq((await import("@norinote/db")).jobs.id, job.id));
      const res = await preview.call("GET", `/api/jobs/${job.id}/preview`, { cookie });
      expect(res.status).toBe(200);
      expect(res.json.available).toBe(true);
      expect(calls[0]).toContain("discord");
      const byLabel = Object.fromEntries(res.json.questions.map((q: { label: string; status: string }) => [q.label, q.status]));
      expect(byLabel["First Name"]).toBe("ready");
      expect(res.json.counts.total).toBe(res.json.questions.length);
      expect(res.json.counts.ready + res.json.counts.ask + res.json.counts.skip).toBe(res.json.counts.total);
      expect((await preview.db.select().from(applications)).length).toBe(0);

      const other = await seedJob(preview.db, { company: "Lever Co" });
      await preview.db.update((await import("@norinote/db")).jobs).set({ applyUrl: "https://jobs.lever.co/leverco/abc" }).where(eq((await import("@norinote/db")).jobs.id, other.job.id));
      expect((await preview.call("GET", `/api/jobs/${other.job.id}/preview`, { cookie })).json).toMatchObject({ available: false });
    } finally {
      await preview.close();
    }
  });
});
