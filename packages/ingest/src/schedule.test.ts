import { describe, expect, it } from "vitest";
import { errorRetryMs, pollIntervalMs } from "./schedule.js";
import { hostKey } from "./hosts.js";

const HOUR = 3_600_000;

describe("pollIntervalMs", () => {
  it("is 24h / (1 + new_jobs_7d / 7), clamped to 1h..48h", () => {
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 0 })).toBe(24 * HOUR);
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 7 })).toBe(12 * HOUR);
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 21 })).toBe(6 * HOUR);
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 100000 })).toBe(HOUR);
  });

  it("reads a board with lane demand every 3 hours, and hourly when it often posts jobs that fit", () => {
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 0, demand: 1 })).toBe(3 * HOUR);
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 0, demand: 5, matching7d: 2 })).toBe(3 * HOUR);
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 3, demand: 1, matching7d: 3 })).toBe(HOUR);
    // Matching jobs without an enabled lane (demand 0) change nothing.
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 0, matching7d: 10 })).toBe(24 * HOUR);
    // A busy board is never read less often because of demand.
    expect(pollIntervalMs({ atsType: "greenhouse", newJobs7d: 100000, demand: 1 })).toBe(HOUR);
  });

  it("never goes below the job system's minimum", () => {
    expect(pollIntervalMs({ atsType: "workday", newJobs7d: 100000, demand: 100, matching7d: 50 })).toBe(6 * HOUR);
    expect(pollIntervalMs({ atsType: "workable", newJobs7d: 0, demand: 1, matching7d: 50 })).toBe(3 * HOUR);
    expect(pollIntervalMs({ atsType: "workable", newJobs7d: 100000 })).toBe(3 * HOUR);
  });
});

describe("errorRetryMs", () => {
  it("doubles from 30 minutes up to 6 hours", () => {
    expect([1, 2, 3, 4, 5, 9].map(errorRetryMs)).toEqual([30 * 60_000, HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 6 * HOUR]);
  });
});

describe("hostKey", () => {
  it("groups Workday by cluster, Oracle by tenant host, the rest by feed host", () => {
    expect(hostKey("workday", "nvidia|wd5|NVIDIAExternalCareerSite")).toBe("wd5.myworkdayjobs.com");
    expect(hostKey("workday", "other|wd5|Site")).toBe("wd5.myworkdayjobs.com");
    expect(hostKey("workday", "x|wd1|S")).toBe("wd1.myworkdayjobs.com");
    expect(hostKey("workday")).toBe("workday");
    expect(hostKey("oracle", "ehtf|us2|CX_1")).toBe("ehtf.fa.us2.oraclecloud.com");
    expect(hostKey("greenhouse", "acme")).toBe("boards-api.greenhouse.io");
    expect(hostKey("workable", "acme")).toBe("apply.workable.com");
    expect(hostKey("recruitee", "acme")).toBe("recruitee.com");
  });
});
