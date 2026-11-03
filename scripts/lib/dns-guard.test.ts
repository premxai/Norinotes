import { describe, expect, it } from "vitest";
import { judgeDnsFailure, RECENT_SUCCESS_MS, type DnsAnswer, type PublicResolver } from "./dns-guard.js";

const now = 1_000_000_000;
const fresh = now - 5_000;
/** A resolver that knows which hosts exist: everything else is NXDOMAIN. */
const knows = (...hosts: string[]): PublicResolver => async (h) => (hosts.includes(h) ? "found" : "nxdomain");
const fixed = (answer: DnsAnswer): PublicResolver => async () => answer;
const base = { host: "ghost.wd5.myworkdayjobs.com", tenantHostSystem: true, lastSuccessAt: fresh, now, controlHosts: ["ctl.example"] };

describe("judgeDnsFailure", () => {
  it("calls a tenant host dead only when two public resolvers agree it does not exist and the controls resolve", async () => {
    const r = knows("ctl.example");
    expect(await judgeDnsFailure({ ...base, resolvers: [r, r] })).toBe("dead");
  });

  it("treats a local outage as a network problem: the public resolvers still find the tenant host", async () => {
    const r = knows("ctl.example", base.host);
    expect(await judgeDnsFailure({ ...base, resolvers: [r, r] })).toBe("network");
  });

  it("treats unreachable or failing public resolvers as no evidence", async () => {
    expect(await judgeDnsFailure({ ...base, resolvers: [fixed("unknown"), fixed("unknown")] })).toBe("network");
    expect(await judgeDnsFailure({ ...base, resolvers: [knows("ctl.example"), fixed("unknown")] })).toBe("network");
  });

  it("needs both resolvers to agree", async () => {
    expect(await judgeDnsFailure({ ...base, resolvers: [knows("ctl.example"), knows("ctl.example", base.host)] })).toBe("network");
  });

  it("never trusts a failure when the control hosts do not resolve (the whole network is down)", async () => {
    expect(await judgeDnsFailure({ ...base, resolvers: [fixed("nxdomain"), fixed("nxdomain")] })).toBe("network");
  });

  it("never marks a shared API host dead", async () => {
    const r = knows("ctl.example");
    expect(await judgeDnsFailure({ ...base, tenantHostSystem: false, resolvers: [r, r] })).toBe("network");
  });

  it("ignores a failure when no board has answered recently (laptop just woke up or the Wi-Fi dropped)", async () => {
    const r = knows("ctl.example");
    expect(await judgeDnsFailure({ ...base, lastSuccessAt: now - RECENT_SUCCESS_MS - 1, resolvers: [r, r] })).toBe("network");
    expect(await judgeDnsFailure({ ...base, lastSuccessAt: 0, resolvers: [r, r] })).toBe("network");
  });

  it("needs at least two resolvers", async () => {
    expect(await judgeDnsFailure({ ...base, resolvers: [knows("ctl.example")] })).toBe("network");
  });
});
