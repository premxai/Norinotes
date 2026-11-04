import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { CONNECTORS } from "./connectors/index.js";
import { fillJobDescription } from "./detail.js";
import type { Connector } from "./types.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.db.delete(jobs); await t.db.delete(companies); });

async function seed(atsType: "workday" | "greenhouse", text: string) {
  const [c] = await t.db.insert(companies).values({ atsType, atsToken: atsType === "workday" ? "acme|wd5|S" : "acme", name: "Acme" }).returning();
  const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType, externalId: "R-1", title: "Engineer", descriptionText: text, applyUrl: "https://x.test", dedupeKey: "k" }).returning();
  return j!.id;
}

async function withFetchJob<T>(fetchJob: Connector["fetchJob"], fn: () => Promise<T>, atsType: "workday" | "greenhouse" = "workday"): Promise<T> {
  const original = CONNECTORS[atsType];
  CONNECTORS[atsType] = { ...original, ready: true, fetchJob };
  try { return await fn(); } finally { CONNECTORS[atsType] = original; }
}
const posting = (text: string) => ({
  atsType: "workday" as const, externalId: "R-1", companyName: "Acme", companyToken: "acme|wd5|S", title: "Engineer", location: null, remote: false,
  descriptionText: text, applyUrl: "https://x.test", postedAt: null,
});

describe("fillJobDescription", () => {
  it("reads the single posting of a Workday job that has no text yet and stores it", async () => {
    const id = await seed("workday", "");
    const calls: string[] = [];
    const res = await withFetchJob(async (token, externalId) => { calls.push(`${token}/${externalId}`); return posting("Build things."); }, () => fillJobDescription(t.db, id));
    expect(res).toBe("filled");
    expect(calls).toEqual(["acme|wd5|S/R-1"]);
    expect((await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]?.descriptionText).toBe("Build things.");
  });

  it("does nothing when the job already has text", async () => {
    const has = await seed("workday", "already here");
    const never = async () => { throw new Error("must not be called"); };
    expect(await withFetchJob(never, () => fillJobDescription(t.db, has))).toBe("has_text");
    expect(await fillJobDescription(t.db, "00000000-0000-4000-8000-000000000000")).toBe("missing");
  });

  it("refills a job stored without its text (not fresh when collected, or swept) on a system whose list carries text", async () => {
    const id = await seed("greenhouse", "");
    const calls: string[] = [];
    const res = await withFetchJob(async (token, externalId) => { calls.push(`${token}/${externalId}`); return { ...posting("Back again."), atsType: "greenhouse" as const }; },
      () => fillJobDescription(t.db, id), "greenhouse");
    expect(res).toBe("filled");
    expect(calls).toEqual(["acme/R-1"]);
    expect((await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]?.descriptionText).toBe("Back again.");
  });

  it("reports a posting that is gone and leaves an empty description alone", async () => {
    const id = await seed("workday", "");
    expect(await withFetchJob(async () => null, () => fillJobDescription(t.db, id))).toBe("gone");
    expect(await withFetchJob(async () => posting("  "), () => fillJobDescription(t.db, id))).toBe("unsupported");
    expect((await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]?.descriptionText).toBe("");
  });
});
