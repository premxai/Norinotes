import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, jobs, runEvents, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { PrepareFormResult } from "@norinote/apply";
import { createPreparer, tailorForApplication } from "./preparer.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let n = 0;
async function seedApp(resumeId: string | null = null, applyUrl?: string) {
  n++;
  const [u] = await t.db.insert(users).values({ email: `prep${n}@example.test`, passwordHash: "x" }).returning();
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `prep-${n}`, name: "Acme" }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `prep-${n}`, title: "Engineer", applyUrl: applyUrl ?? `https://job-boards.greenhouse.io/acme/jobs/${n}`, dedupeKey: `prep-${n}` }).returning();
  const [a] = await t.db.insert(applications).values({ userId: u!.id, jobId: j!.id, status: "preparing", resumeId }).returning();
  return a!.id;
}

const noAnswers = (async () => ({ answers: {}, pending: [], sources: {}, skipped: [] })) as never;

describe("createPreparer", () => {
  it("tailors, then reads the form; questions only the person can answer park it with the pending questions", async () => {
    const id = await seedApp();
    const calls: string[] = [];
    const pending = [{ id: "field:question_1", text: "Why us?", type: "textarea" as const, options: [], required: true }];
    const preparer = createPreparer(t.db, {
      tailor: (async () => { calls.push("tailor"); return {} as never; }) as never,
      answer: noAnswers,
      form: async () => { calls.push("form"); return { outcome: "needs_user", reason: "The form asks 1 question only you can answer.", pending, timings: {} } satisfies PrepareFormResult; },
    });
    expect(await preparer.prepare(id)).toEqual({ outcome: "needs_user", reason: "The form asks 1 question only you can answer.", pending });
    expect(calls).toEqual(["tailor", "form"]);
  });

  it("parks a job Nori will not fill before tailoring anything, and says why", async () => {
    const id = await seedApp(null, "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123");
    const calls: string[] = [];
    const preparer = createPreparer(t.db, {
      tailor: (async () => { calls.push("tailor"); return {} as never; }) as never,
      answer: (async () => { calls.push("answer"); return { answers: {} }; }) as never,
      form: async () => { calls.push("form"); return { outcome: "prepared", pending: [], timings: {} }; },
    });
    const res = await preparer.prepare(id);
    expect(res.outcome).toBe("needs_user");
    expect(res.outcome === "needs_user" ? res.reason : "").toMatch(/Workday|account/i);
    // No model spend, no form read, and the person can still ask for the resume on its own.
    expect(calls).toEqual([]);
    const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
    expect(row!.resumeId).toBeNull();
    const steps = (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, id))).map((e) => e.step);
    expect(steps).toContain("prepare_parked");
  });

  it("parks a job system Nori does not send through, and an unknown form", async () => {
    for (const url of ["https://jobs.smartrecruiters.com/acme/123", "https://careers.example.com/apply/42"]) {
      const id = await seedApp(null, url);
      const preparer = createPreparer(t.db, { tailor: (async () => { throw new Error("no tailor"); }) as never, answer: noAnswers });
      expect((await preparer.prepare(id)).outcome).toBe("needs_user");
    }
  });

  it("preparing again after the person answered reuses the tailored resume", async () => {
    const id = await seedApp("00000000-0000-4000-8000-000000000001");
    const calls: string[] = [];
    const preparer = createPreparer(t.db, {
      tailor: (async () => { calls.push("tailor"); return {} as never; }) as never,
      answer: noAnswers,
      form: async () => { calls.push("form"); return { outcome: "prepared", pending: [], timings: {} }; },
    });
    expect(await preparer.prepare(id)).toEqual({ outcome: "prepared" });
    expect(calls).toEqual(["form"]);
    const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
    expect(row!.resumeId).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("tailorForApplication", () => {
  it("tailors one application's resume on demand and logs it", async () => {
    const id = await seedApp();
    expect(await tailorForApplication(t.db, id, { tailor: (async () => ({ resumeId: "00000000-0000-4000-8000-000000000009", pages: 1 })) as never }))
      .toEqual({ ok: true, resumeId: "00000000-0000-4000-8000-000000000009" });
    const steps = (await t.db.select().from(runEvents).where(eq(runEvents.applicationId, id))).map((e) => e.step);
    expect(steps).toContain("resume");
  });

  it("says what stops it when there is nothing to build a resume from", async () => {
    const id = await seedApp();
    const out = await tailorForApplication(t.db, id, { tailor: (async () => { throw new Error("No career points yet"); }) as never });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Upload your resume/);
  });
});
