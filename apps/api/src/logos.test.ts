import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, eq } from "@norinote/db";
import { brandfetchLogo } from "./serialize.js";
import { makeApi, seedApplication, seedJob, seedShortlist, type Api } from "./testkit.js";

describe("brandfetchLogo", () => {
  const logo = brandfetchLogo("bf-id");

  it("builds a CDN URL that 404s when there is no logo", () => {
    expect(logo("acme.com")).toBe("https://cdn.brandfetch.io/domain/acme.com/w/128/h/128/fallback/404/type/icon?c=bf-id");
    expect(logo("https://www.Acme.co.uk/careers")).toBe("https://cdn.brandfetch.io/domain/acme.co.uk/w/128/h/128/fallback/404/type/icon?c=bf-id");
  });

  it("returns null without a usable domain or a client id", () => {
    expect(logo(null)).toBeNull();
    expect(logo("not a domain")).toBeNull();
    expect(logo("acme.com/../x\"<")).toBe("https://cdn.brandfetch.io/domain/acme.com/w/128/h/128/fallback/404/type/icon?c=bf-id");
    expect(brandfetchLogo(undefined)("acme.com")).toBeNull();
  });
});

describe("company logos on jobs", () => {
  let api: Api;
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    api = await makeApi({ config: { brandfetchClientId: "bf-id" } });
    const s = await api.signup("logos@example.com");
    cookie = s.cookie;
    userId = s.user.id;
  });
  afterAll(() => api.close());

  it("puts the logo URL on shortlist rows, job details and applications, preferring the found domain", async () => {
    const found = await seedJob(api.db, { company: "Found Co", hoursAgo: 2 });
    await api.db.update(companies).set({ logoDomain: "foundco.com", domain: "seed.example.org" }).where(eq(companies.id, found.company.id));
    const seeded = await seedJob(api.db, { company: "Seeded Co", hoursAgo: 2 });
    await api.db.update(companies).set({ domain: "seeded.example.org" }).where(eq(companies.id, seeded.company.id));
    const none = await seedJob(api.db, { company: "Plain Co", hoursAgo: 2 });
    for (const j of [found, seeded, none]) await seedShortlist(api.db, userId, j.job.id, 0.8);

    const list = await api.call("GET", "/api/shortlist", { cookie });
    const urlOf = (name: string) => list.json.find((e: { job: { companyName: string } }) => e.job.companyName === name)?.job.companyLogoUrl;
    expect(urlOf("Found Co")).toContain("/domain/foundco.com/");
    expect(urlOf("Seeded Co")).toContain("/domain/seeded.example.org/");
    expect(urlOf("Plain Co")).toBeNull();

    expect((await api.call("GET", `/api/jobs/${found.job.id}`, { cookie })).json.job.companyLogoUrl).toContain("/domain/foundco.com/");

    await seedApplication(api.db, userId, found.job.id);
    const apps = await api.call("GET", "/api/applications", { cookie });
    expect(apps.json[0].job.companyLogoUrl).toContain("/domain/foundco.com/");
  });

  it("has no logo URLs without a client id", async () => {
    const plain = await makeApi();
    try {
      const s = await plain.signup("nologo@example.com");
      const { job, company } = await seedJob(plain.db, { hoursAgo: 2 });
      await plain.db.update(companies).set({ logoDomain: "acme.com" }).where(eq(companies.id, company.id));
      expect((await plain.call("GET", `/api/jobs/${job.id}`, { cookie: s.cookie })).json.job.companyLogoUrl).toBeNull();
    } finally {
      await plain.close();
    }
  });
});
