import type { AtsType } from "@norinote/shared";

/** Feed host per job system for systems that read from one shared API host. */
const FEED_HOSTS: Partial<Record<AtsType, string>> = {
  greenhouse: "boards-api.greenhouse.io",
  lever: "api.lever.co",
  ashby: "api.ashbyhq.com",
  smartrecruiters: "api.smartrecruiters.com",
  workable: "apply.workable.com",
  rippling: "ats.rippling.com",
  // Tenant-subdomain systems: every tenant is its own subdomain but they share infrastructure, so they share a group.
  recruitee: "recruitee.com",
  teamtailor: "teamtailor.com",
  personio: "personio.de",
  bamboohr: "bamboohr.com",
  breezy: "breezy.hr",
  pinpoint: "pinpointhq.com",
  icims: "icims.com",
};

/**
 * The politeness group of a board: boards with the same host key share a concurrency limit and, in the scheduler, a
 * per-run cap. Workday is grouped by its cluster (`wd5.myworkdayjobs.com`), Oracle by its tenant host, the rest by the
 * system's feed host. `token` is needed for Workday and Oracle; without it they fall back to the system name.
 */
export function hostKey(atsType: AtsType, token?: string | null): string {
  if (atsType === "workday" && token) {
    const cluster = token.split("|")[1];
    if (cluster && /^wd\d+$/i.test(cluster)) return `${cluster.toLowerCase()}.myworkdayjobs.com`;
  }
  if (atsType === "oracle" && token) {
    const [host, region] = token.split("|");
    if (host && region) return `${host.toLowerCase()}.fa.${region.toLowerCase()}.oraclecloud.com`;
  }
  return FEED_HOSTS[atsType] ?? atsType;
}
