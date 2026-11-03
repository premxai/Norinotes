import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, jobs, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import type { PrepareFormResult } from "@norinote/apply";
import { createPreparer } from "./preparer.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

let n = 0;
async function seedApp(resumeId: string | null = null) {
  n++;
  const [u] = await t.db.insert(users).values({ email: `prep${n}@example.test`, passwordHash: "x" }).returning();
  const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `prep-${n}`, name: "Acme" }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: `prep-${n}`, title: "Engineer", applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${n}`, dedupeKey: `prep-${n}` }).returning();
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
