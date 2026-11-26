import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES, ApplicationStatus, JobSpec, Lane, ShortlistItem } from "./index.js";

describe("shared contracts", () => {
  it("has the application states from the architecture, in order", () => {
    expect(APPLICATION_STATUSES).toEqual(["queued", "preparing", "prepared", "applying", "awaiting_code", "submitted", "needs_user", "ready_to_finish", "failed"]);
    expect(ApplicationStatus.safeParse("done").success).toBe(false);
  });

  it("validates a job spec and rejects an unknown sponsorship value", () => {
    const spec = {
      mustHaves: ["TypeScript"], niceToHaves: [], skills: [{ name: "TypeScript", level: "advanced", years: 3, required: true }],
      seniority: "mid", roleFamily: "software engineering", yearsMin: 3,
      location: { remote: "hybrid", countries: ["US"], cities: ["Austin"] },
      citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: ["Build APIs"],
    };
    expect(JobSpec.safeParse(spec).success).toBe(true);
    expect(JobSpec.safeParse({ ...spec, sponsorship: "maybe" }).success).toBe(false);
  });

  it("reads a job spec stored before the citizenship scope existed as citizens-only", () => {
    const spec = {
      mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "software engineering", yearsMin: null,
      location: { remote: "onsite", countries: ["US"], cities: [] },
      citizenshipRequired: true, clearanceRequired: false, sponsorship: "unknown", responsibilities: [],
    };
    expect(JobSpec.parse(spec).citizenshipScope).toBe("citizen");
    expect(JobSpec.parse({ ...spec, citizenshipScope: "us_person" }).citizenshipScope).toBe("us_person");
    expect(JobSpec.safeParse({ ...spec, citizenshipScope: "anyone" }).success).toBe(false);
  });

  it("bounds fit and min fit to 0..1", () => {
    expect(Lane.safeParse({ id: "1", name: "x", titles: [], locations: [], remote: true, minFit: 1.5, enabled: true }).success).toBe(false);
    expect(ShortlistItem.safeParse({ id: "1", jobId: "2", fit: 0.8, fitMap: [], reasons: [], status: "new", createdAt: "2026-01-01T00:00:00Z" }).success).toBe(true);
  });
});
