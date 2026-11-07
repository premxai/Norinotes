import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, inboxAddresses, jobs, profiles, resumes, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { loadApplyInputs, profileFromRows } from "./inputs.js";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());

describe("profileFromRows", () => {
  it("builds the applicant from the free-form contact and work-auth JSON", () => {
    const p = profileFromRows({ email: "login@example.test" }, {
      contact: { name: "Ada Lovelace", phone: "+1 415 555 0100", linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada" },
      location: "San Francisco, CA, USA",
      workAuth: { US: { authorized: "yes", needsSponsorship: false } },
      eeo: { gender: "decline" },
    });
    expect(p).toMatchObject({
      fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "login@example.test", phone: "+1 415 555 0100",
      location: "San Francisco, CA, USA", country: "US", workAuth: { authorizedUS: true, needsSponsorship: false }, eeo: { gender: "decline" },
    });
  });

  it("falls back to the login email, accepts flat work-auth keys, and leaves unknowns undefined", () => {
    const p = profileFromRows({ email: "login@example.test" }, {
      contact: { firstName: "Grace", lastName: "Hopper", email: "grace@navy.test" }, location: null,
      workAuth: { authorizedUS: true, needsSponsorship: "no" }, eeo: {},
    });
    expect(p).toMatchObject({ fullName: "Grace Hopper", email: "grace@navy.test", workAuth: { authorizedUS: true, needsSponsorship: false } });
    expect(p.country).toBeUndefined();
    expect(p.phone).toBeUndefined();
    const none = profileFromRows({ email: "x@y.test" }, null);
    expect(none).toMatchObject({ email: "x@y.test", fullName: "", workAuth: {} });
  });
});

describe("loadApplyInputs", () => {
  it("fills forms with the person's own email, even when they have a Norinote inbox address", async () => {
    const [u] = await t.db.insert(users).values({ email: "login@example.test", passwordHash: "x" }).returning();
    await t.db.insert(profiles).values({ userId: u!.id, contact: { name: "Ada Lovelace", email: "ada@own-mail.test" } });
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "acme-inputs", name: "Acme" }).returning();
    const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: "4001", title: "SRE", applyUrl: "https://job-boards.greenhouse.io/acme-inputs/jobs/4001", dedupeKey: "acme|sre|inputs" }).returning();
    const [a] = await t.db.insert(applications).values({ userId: u!.id, jobId: j!.id, status: "applying" }).returning();
    const [r] = await t.db.insert(resumes).values({ applicationId: a!.id, content: {}, pdfPath: "/tmp/resume.pdf" }).returning();
    await t.db.update(applications).set({ resumeId: r!.id }).where(eq(applications.id, a!.id));
    expect((await loadApplyInputs(t.db, a!.id)).profile.email).toBe("ada@own-mail.test");
    await t.db.insert(inboxAddresses).values({ userId: u!.id, address: "nori-k3x9q2mhd4@in.norinote.test" });
    expect((await loadApplyInputs(t.db, a!.id)).profile.email).toBe("ada@own-mail.test");
  });
});
