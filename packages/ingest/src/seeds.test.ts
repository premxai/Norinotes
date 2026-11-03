import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, companies, eq, jobs } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import {
  importSeeds, parseCsv, parseOpenAtsFeed, parseOracleUrl, parseSeedCsv, parseSeedRow, parseWorkdayUrl, type SeedCompany,
} from "./seeds.js";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM", () => {
    const text = "﻿name,slug,url\r\n\"48Forty Solutions, LLC\",48forty,https://careers-48forty.icims.com\r\n\"Say \"\"hi\"\"\",hi,\"https://x.test/a\nb\"\r\n\r\nlast,l,u";
    expect(parseCsv(text)).toEqual([
      ["name", "slug", "url"],
      ["48Forty Solutions, LLC", "48forty", "https://careers-48forty.icims.com"],
      ["Say \"hi\"", "hi", "https://x.test/a\nb"],
      ["last", "l", "u"],
    ]);
  });
});

describe("parseWorkdayUrl", () => {
  it("reads tenant, cluster and site", () => {
    expect(parseWorkdayUrl("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")).toBe("nvidia|wd5|NVIDIAExternalCareerSite");
    expect(parseWorkdayUrl("https://3m.wd1.myworkdayjobs.com/search")).toBe("3m|wd1|search");
    expect(parseWorkdayUrl("https://acme.wd103.myworkdayjobs.com/External_Careers/")).toBe("acme|wd103|External_Careers");
  });
  it("skips a locale before the site and ignores the rest of the path", () => {
    expect(parseWorkdayUrl("https://acme.wd5.myworkdayjobs.com/en-US/Careers")).toBe("acme|wd5|Careers");
    expect(parseWorkdayUrl("https://acme.wd5.myworkdayjobs.com/Careers/job/Austin/Engineer_R-1")).toBe("acme|wd5|Careers");
    expect(parseWorkdayUrl("https://acme.wd5.myworkdayjobs.com/en-US")).toBe("acme|wd5|en-US"); // a lone segment is the site
  });
  it("rejects other hosts, missing clusters and missing sites", () => {
    expect(parseWorkdayUrl("https://acme.myworkdayjobs.com/Careers")).toBeNull();
    expect(parseWorkdayUrl("https://wd5.myworkdaysite.com/recruiting/acme/Careers")).toBeNull();
    expect(parseWorkdayUrl("https://acme.wd5.myworkdayjobs.com/")).toBeNull();
    expect(parseWorkdayUrl("not a url at all")).toBeNull();
    expect(parseWorkdayUrl("")).toBeNull();
  });
});

describe("parseOracleUrl", () => {
  it("reads host, region and site number", () => {
    expect(parseOracleUrl("https://ehtf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1")).toBe("ehtf|us2|CX_1");
    expect(parseOracleUrl("https://fa-etzd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001")).toBe("fa-etzd-saasfaprod1|ocs|CX_1001");
    expect(parseOracleUrl("https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs?lastSelectedFacet=X")).toBe("ebwg|us2|CX");
    expect(parseOracleUrl("https://EBWG.fa.EM2.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX")).toBe("ebwg|em2|CX");
  });
  it("rejects custom domains and URLs without a site", () => {
    expect(parseOracleUrl("https://careers.alithya.com/hcmUI/CandidateExperience/en/sites/AlithyaCareersCarrieres")).toBeNull();
    expect(parseOracleUrl("https://ehtf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en")).toBeNull();
  });
});

describe("parseSeedRow per system", () => {
  const row = (atsType: Parameters<typeof parseSeedRow>[0], name: string, slug: string, url: string) => parseSeedRow(atsType, { name, slug, url });

  it("path-token systems use the URL spelling, else the slug", () => {
    expect(row("greenhouse", "10Beauty", "10beauty", "https://job-boards.greenhouse.io/10beauty")).toEqual({ atsType: "greenhouse", token: "10beauty", name: "10Beauty", domain: null, discoveredVia: "seed:ats-scrapers" });
    expect(row("lever", "#paid", "hashtagpaid", "https://jobs.lever.co/hashtagpaid")?.token).toBe("hashtagpaid");
    expect(row("ashby", "0g Labs", "0g", "https://jobs.ashbyhq.com/0g")?.token).toBe("0g");
    expect(row("ashby", "X", "x", "")?.token).toBe("x");
    expect(row("workable", "0x", "0x", "https://apply.workable.com/0x")?.token).toBe("0x");
    expect(row("rippling", "11:FS Group Ltd", "11fs-group-ltd", "https://ats.rippling.com/11fs-group-ltd/jobs")?.token).toBe("11fs-group-ltd");
  });

  it("SmartRecruiters keeps the company identifier case from the URL", () => {
    expect(row("smartrecruiters", "IOTA GROUP", "iotagroup", "https://careers.smartrecruiters.com/IOTAGROUP/iota")?.token).toBe("IOTAGROUP");
    expect(row("smartrecruiters", "1871", "1871", "https://careers.smartrecruiters.com/1871")?.token).toBe("1871");
    expect(row("smartrecruiters", "Hooli", "hooli", "https://jobs.smartrecruiters.com/Hooli")?.token).toBe("Hooli");
  });

  it("subdomain systems read the tenant from the host", () => {
    expect(row("recruitee", "12Build", "12build", "https://12build.recruitee.com")?.token).toBe("12build");
    expect(row("teamtailor", "123 POUSSE", "123pousse", "https://123pousse.teamtailor.com")?.token).toBe("123pousse");
    expect(row("personio", "1KOMMA5", "1komma5grad", "https://1komma5grad.jobs.personio.com")?.token).toBe("1komma5grad");
    expect(row("personio", "Acme", "acme", "https://acme.jobs.personio.de")?.token).toBe("acme");
    expect(row("bamboohr", "10web", "10web", "https://10web.bamboohr.com/careers")?.token).toBe("10web");
    expect(row("breezy", "1001", "1001", "https://1001.breezy.hr")?.token).toBe("1001");
    expect(row("pinpoint", "Accenture", "accenture", "https://accenture.pinpointhq.com")?.token).toBe("accenture");
    expect(row("icims", "360care LLC", "360care", "https://careers-360care.icims.com")?.token).toBe("360care");
  });

  it("Workday and Oracle rows become composite tokens, with the company name of the seed", () => {
    expect(row("workday", "23Andme", "23andme/23", "https://23andme.wd5.myworkdayjobs.com/23")).toMatchObject({ atsType: "workday", token: "23andme|wd5|23", name: "23Andme" });
    expect(row("oracle", "ACI Worldwide Job Opportunities", "ebwg", "https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX")).toMatchObject({ atsType: "oracle", token: "ebwg|us2|CX", name: "ACI Worldwide Job Opportunities" });
  });

  it("skips unusable rows: wrong host, no site, no usable slug, and iCIMS without a careers- host", () => {
    expect(row("workday", "X", "x", "https://x.example.com/site")).toBeNull();
    expect(row("oracle", "Alithya", "alithya", "https://careers.alithya.com/hcmUI/CandidateExperience/en/sites/A")).toBeNull();
    expect(row("lever", "Bad", "bad slug!", "")).toBeNull();
    expect(row("icims", "X", "x", "https://jobs-x.icims.com")).toBeNull();
    expect(row("greenhouse", "Empty", "", "")).toBeNull();
  });

  it("falls back to a prettified token when the name is empty, and treats a bare url as the slug in legacy files", () => {
    expect(parseSeedRow("lever", { name: "", slug: "acme-corp", url: "" })?.name).toBe("Acme Corp");
    expect(parseSeedRow("lever", { name: "Legacy", url: "legacyco" })).toMatchObject({ token: "legacyco", name: "Legacy" });
  });

  it("skips blocklisted sources", () => {
    expect(row("lever", "Jobgether", "jobgether", "https://jobs.lever.co/jobgether")).toBeNull();
    expect(row("ashby", "Talent.com", "something", "https://jobs.ashbyhq.com/something")).toBeNull();
    expect(row("greenhouse", "Fine Co", "jobrightai", "")).toBeNull();
  });
});

describe("parseSeedCsv", () => {
  it("maps a whole file by header and counts unusable rows", () => {
    const csv = [
      "name,slug,url",
      "Acme,acme,https://acme.wd5.myworkdayjobs.com/en-US/Careers",
      "\"Foo, Bar Inc\",foo,https://foo.wd1.myworkdayjobs.com/Main",
      "Broken,broken,https://broken.example.com/x",
    ].join("\n");
    const res = parseSeedCsv("workday", csv);
    expect(res.rows.map((r) => [r.token, r.name])).toEqual([["acme|wd5|Careers", "Acme"], ["foo|wd1|Main", "Foo, Bar Inc"]]);
    expect(res.skipped).toBe(1);
  });

  it("reads the iCIMS file with its extra column and the legacy two-column shape", () => {
    expect(parseSeedCsv("icims", "name,slug,url,company_name\n142designgroup,142designgroup,https://careers-142designgroup.icims.com,").rows[0]?.token).toBe("142designgroup");
    expect(parseSeedCsv("breezy", "name,url\nOld Style,oldstyle").rows[0]).toMatchObject({ token: "oldstyle", name: "Old Style" });
  });
});

describe("parseOpenAtsFeed", () => {
  const feed = {
    providers: {
      greenhouse: { live: [["spacex", 2272], ["jobgether", 5]], empty: ["quietco"], verified: true },
      lever: { live: [["waymark", 3]], unverified: ["maybe-live"] },
      breezy: { live: [["american-logistics-authority", 2760]], empty: [] },
      nonsense: { live: [["x", 1]] },
    },
  };

  it("takes verified live boards of known systems, never unverified ones, and applies the blocklist", () => {
    const res = parseOpenAtsFeed(feed);
    expect(res.rows.map((r) => `${r.atsType}:${r.token}`)).toEqual(["greenhouse:spacex", "lever:waymark", "breezy:american-logistics-authority"]);
    expect(res.rows[0]).toMatchObject({ discoveredVia: "seed:open-ats-feed", name: "Spacex", domain: null });
    expect(res.skipped).toBe(1);
  });

  it("includes empty boards only when asked", () => {
    expect(parseOpenAtsFeed(feed, { includeEmpty: true }).rows.map((r) => r.token)).toContain("quietco");
  });

  it("tolerates garbage", () => {
    expect(parseOpenAtsFeed(null).rows).toEqual([]);
    expect(parseOpenAtsFeed({ providers: { greenhouse: { live: "x" } } }).rows).toEqual([]);
  });
});

describe("importSeeds", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.db.delete(jobs); await t.db.delete(companies); });

  const seed = (atsType: SeedCompany["atsType"], token: string, name = token, via: SeedCompany["discoveredVia"] = "seed:ats-scrapers"): SeedCompany =>
    ({ atsType, token, name, domain: null, discoveredVia: via });
  const all = { supported: () => true };

  it("inserts candidates with host, source and priority 0, and counts per system", async () => {
    const res = await importSeeds(t.db, [seed("greenhouse", "a"), seed("greenhouse", "b"), seed("lever", "c"), seed("workday", "t|wd5|S", "Tenant Inc")], all);
    expect(res.inserted).toEqual({ greenhouse: 2, lever: 1, workday: 1 });
    const rows = await t.db.select().from(companies);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "candidate" && r.priority === 0 && r.nextPollAt === null && r.discoveredVia === "seed:ats-scrapers")).toBe(true);
    expect(rows.find((r) => r.atsType === "workday")).toMatchObject({ name: "Tenant Inc", host: "wd5.myworkdayjobs.com" });
    expect(rows.find((r) => r.atsToken === "a")?.host).toBe("boards-api.greenhouse.io");
  });

  it("de-duplicates inside the input (any letter case, first wins) and against existing companies, and never touches existing rows", async () => {
    await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: "Known", name: "Known (mine)", status: "active", priority: 100 });
    const res = await importSeeds(t.db, [
      seed("greenhouse", "new", "New", "seed:open-ats-feed"), seed("greenhouse", "NEW", "New again"), seed("greenhouse", "known"),
      seed("lever", "new"),
    ], all);
    expect(res.inserted).toEqual({ greenhouse: 1, lever: 1 });
    expect(res.duplicates).toBe(2);
    const [known] = await t.db.select().from(companies).where(eq(companies.atsToken, "Known"));
    expect(known).toMatchObject({ name: "Known (mine)", status: "active", priority: 100 });
    const [first] = await t.db.select().from(companies).where(and(eq(companies.atsType, "greenhouse"), eq(companies.atsToken, "new")));
    expect(first).toMatchObject({ name: "New", discoveredVia: "seed:open-ats-feed" });
  });

  it("is idempotent", async () => {
    const rows = [seed("lever", "x"), seed("lever", "y")];
    expect((await importSeeds(t.db, rows, all)).inserted).toEqual({ lever: 2 });
    const again = await importSeeds(t.db, rows, all);
    expect(again.inserted).toEqual({});
    expect(again.duplicates).toBe(2);
  });

  it("skips unsupported systems and blocklisted names", async () => {
    const res = await importSeeds(t.db, [seed("lever", "ok"), seed("greenhouse", "nope"), seed("lever", "jobgether")], { supported: (s) => s === "lever" });
    expect(res).toMatchObject({ inserted: { lever: 1 }, unsupported: 1, blocked: 1 });
  });

  it("writes in batches", async () => {
    const many = Array.from({ length: 25 }, (_, i) => seed("ashby", `co${i}`));
    const res = await importSeeds(t.db, many, { ...all, batchSize: 10 });
    expect(res.inserted).toEqual({ ashby: 25 });
    expect(await t.db.select().from(companies)).toHaveLength(25);
  });
});
