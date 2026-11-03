import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, jobs, lanes, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { countDemand, createDemandCounter, laneTitleMatches } from "./demand.js";

describe("laneTitleMatches", () => {
  it("needs every meaningful word of the lane title in the job title, in any order", () => {
    expect(laneTitleMatches("Backend Engineer", "Senior Backend Engineer, Payments")).toBe(true);
    expect(laneTitleMatches("Software Engineer", "Engineer, Software (Remote)")).toBe(true);
    expect(laneTitleMatches("Backend Engineer", "Frontend Engineer")).toBe(false);
    expect(laneTitleMatches("Data Scientist", "Data Engineer")).toBe(false);
    expect(laneTitleMatches("Head of Product", "Product Lead")).toBe(false);
    expect(laneTitleMatches("", "Anything")).toBe(false);
    expect(laneTitleMatches("The", "The Job")).toBe(false);
  });
});

describe("countDemand", () => {
  it("counts lanes, not matching titles", () => {
    const laneTitles = [["Backend Engineer", "Platform Engineer"], ["Data Scientist"], ["Designer"]];
    expect(countDemand(laneTitles, ["Senior Backend Engineer", "Platform Engineer II", "Marketing Manager"])).toBe(1);
    expect(countDemand(laneTitles, ["Data Scientist", "Backend Engineer"])).toBe(2);
    expect(countDemand(laneTitles, [])).toBe(0);
    expect(countDemand([], ["Backend Engineer"])).toBe(0);
  });
});

describe("createDemandCounter", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.db.delete(jobs); await t.db.delete(companies); await t.db.delete(lanes); });

  const NOW = new Date("2026-10-31T12:00:00Z");
  let n = 0;
  async function lane(titles: string[], enabled = true) {
    const [u] = await t.db.insert(users).values({ email: `d${n++}@example.test`, passwordHash: "x" }).returning();
    await t.db.insert(lanes).values({ userId: u!.id, name: titles[0]!, titles, locations: [], remote: true, enabled });
  }
  async function board(titles: Array<[string, boolean]>) {
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `c${n++}`, name: "Co" }).returning();
    for (const [title, closed] of titles) {
      await t.db.insert(jobs).values({
        companyId: c!.id, atsType: "greenhouse", externalId: `e${n++}`, title, applyUrl: "https://x.test", dedupeKey: `d${n}`, closedAt: closed ? NOW : null,
      });
    }
    return c!.id;
  }

  it("counts enabled lanes that match the recent open jobs of a company", async () => {
    await lane(["Backend Engineer"]);
    await lane(["Data Scientist"], false); // disabled
    await lane(["Backend Engineer", "Platform Engineer"]);
    await lane(["Designer"]);
    const id = await board([["Senior Backend Engineer", false], ["Marketing Manager", false], ["Designer", true]]);
    const demand = createDemandCounter(t.db, () => NOW);
    expect(await demand(id)).toBe(2);
  });

  it("is 0 for a company with no jobs yet, and when nobody has a lane", async () => {
    const empty = await board([]);
    expect(await createDemandCounter(t.db, () => NOW)(empty)).toBe(0);
    await lane(["Backend Engineer"]);
    expect(await createDemandCounter(t.db, () => NOW)(empty)).toBe(0);
  });

  it("reads lanes once per five minutes", async () => {
    const id = await board([["Backend Engineer", false]]);
    let now = NOW;
    const demand = createDemandCounter(t.db, () => now);
    expect(await demand(id)).toBe(0);
    await lane(["Backend Engineer"]);
    expect(await demand(id)).toBe(0); // cached
    now = new Date(NOW.getTime() + 6 * 60_000);
    expect(await demand(id)).toBe(1);
  });
});
