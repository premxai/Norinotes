/**
 * Following a Greenhouse posting to the company's own careers site, against LOCAL pages served from 127.0.0.1. No real
 * site, no real submission. Skipped when Chromium is not installed.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { followToForm, isGreenhouseEmbed } from "./careers.js";
import { EMBEDDED_GREENHOUSE_FLAG, POSTING_GONE_REASON, withCareerSites } from "./drivers/career-site.js";
import { createBrowserPool, type BrowserPool, type Driver, type DriverContext, type DriverName, type FillResult } from "./index.js";
import { OFFSITE_FORM_REASON } from "./schema.js";
import { chromiumInstalled, startFixtureServer, type FixtureServer } from "./test-helpers.js";

const run = chromiumInstalled();
const TIMEOUT = 90_000;

const page = (body: string, title = "Careers") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const PAGES: Record<string, string> = {
  "/robots.txt": "User-agent: *\nDisallow: /private",
  "/jobs/to-lever": page(`<nav><a href="/">Apply</a></nav><h1>Engineer</h1><p>About the role.</p><a href="/lever/acme/1">Apply for this job</a>`),
  "/lever/acme/1": page(`<form><input name="name"><input name="email" type="email"><input type="file" name="resume"></form>`),
  "/jobs/embedded": page(`<h1>Engineer</h1><div id="grnhse_app"><iframe id="grnhse_iframe" src="/greenhouse-form.html" width="800" height="1600"></iframe></div>`),
  "/jobs/to-embed-link": page(`<h1>Engineer</h1><a href="https://boards.greenhouse.io/embed/job_app?for=acme&token=1">Apply now</a>`),
  "/jobs/button": page(`<h1>Engineer</h1><button type="button" onclick="document.getElementById('f').style.display='block'">Apply</button>
    <form id="f" style="display:none"><label>First name <input name="first"></label><label>Last name <input name="last"></label>
    <label>Email <input type="email" name="email"></label><label>Resume <input type="file" name="cv"></label></form>`),
  "/jobs/bot-check": page("<p>Performing security verification</p><p>This website uses a security service to protect against malicious bots.</p>", "Just a moment..."),
  "/jobs/denied": page("<h1>Access Denied</h1><p>You don't have permission to access this server.</p><p>Reference #18.1</p>", "Access Denied"),
  "/jobs/gone": page("<h1>Sorry, this job is no longer available.</h1><a href='/'>See all jobs</a>"),
  "/private/job": page("<h1>Engineer</h1>"),
  "/jobs/nothing": page("<h1>Engineer</h1><p>Read about our values.</p>"),
};

/** The fixture form's own questions (src/fixtures/greenhouse-form.html). */
const ANSWERS = {
  "why-do-you-want-to-work-here": "I love building robots that ship.",
  "how-did-you-hear-about-us": "LinkedIn",
  "which-office-would-you-like-to-work-from": "remote",
  "i-acknowledge-that-the-information-i-have-provided-is-accurate": "Yes",
};

/** Local stand-ins: /lever/ pages are "Lever". */
const detect = (url: string): DriverName | null => (/\/lever\//.test(url) ? "lever" : null);

describe("isGreenhouseEmbed", () => {
  it("recognises the embed addresses Norinote never opens", () => {
    expect(isGreenhouseEmbed("https://boards.greenhouse.io/embed/job_app?for=acme&token=1")).toBe(true);
    expect(isGreenhouseEmbed("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1")).toBe(true);
    expect(isGreenhouseEmbed("https://job-boards.greenhouse.io/acme/jobs/1")).toBe(false);
    expect(isGreenhouseEmbed("https://acme.com/embed/job_app")).toBe(false);
  });
});

describe.skipIf(!run)("following a posting to the company's careers site", () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let tmp: string;
  let resumePath: string;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "norinote-careers-"));
    resumePath = path.join(tmp, "resume.pdf");
    await writeFile(resumePath, "%PDF-1.4\n% test resume\n%%EOF\n");
    server = await startFixtureServer(PAGES);
    pool = createBrowserPool({ size: 1, artifactsDir: path.join(tmp, "artifacts"), timeoutMs: 80_000 });
  });
  afterAll(async () => {
    await pool.close();
    await server.close();
    await rm(tmp, { recursive: true, force: true });
  });
  afterEach(() => { delete process.env[EMBEDDED_GREENHOUSE_FLAG]; delete process.env.ALLOW_REAL_SUBMIT; });

  const withPage = <T,>(fn: (p: Page) => Promise<T>) => pool.run("careers-e2e", (p) => fn(p), { timeoutMs: 80_000 }).then((r) => r.value);
  const follow = (p: string) => withPage((pg) => followToForm(pg, server.origin + p, { detect, settleMs: 300 }));

  it("follows the Apply link (not the nav one) to a known job system", async () => {
    expect(await follow("/jobs/to-lever")).toMatchObject({ kind: "known_ats", driver: "lever", hops: 1, url: `${server.origin}/lever/acme/1` });
  }, TIMEOUT);

  it("finds a Greenhouse form embedded on the company page and counts its fields without typing", async () => {
    const site = await follow("/jobs/embedded");
    expect(site.kind).toBe("greenhouse_iframe");
    expect(site.fields).toBeGreaterThan(3);
  }, TIMEOUT);

  it("never opens a Greenhouse embed address an Apply link points to", async () => {
    const opened: string[] = [];
    const robotsAllow = async (url: string) => { opened.push(url); return true; };
    const site = await withPage((pg) => followToForm(pg, `${server.origin}/jobs/to-embed-link`, { detect, settleMs: 300, robotsAllow }));
    expect(site).toMatchObject({ kind: "greenhouse_iframe", hops: 0 });
    expect(opened).toEqual([`${server.origin}/jobs/to-embed-link`]);
  }, TIMEOUT);

  it("clicks an Apply button that reveals a form of the company's own", async () => {
    expect(await follow("/jobs/button")).toMatchObject({ kind: "custom_form", hops: 1 });
  }, TIMEOUT);

  it("tells bot checks, refusals, gone postings, robots.txt and empty pages apart", async () => {
    expect((await follow("/jobs/bot-check")).kind).toBe("captcha");
    expect((await follow("/jobs/denied")).kind).toBe("blocked");
    expect((await follow("/jobs/gone")).kind).toBe("dead");
    expect((await follow("/jobs/nothing")).kind).toBe("no_form");
    expect(await follow("/private/job")).toMatchObject({ kind: "robots", hops: 0 });
    expect(server.hits).not.toContain("GET /private/job");
  }, TIMEOUT);

  describe("the Greenhouse driver on a careers site", () => {
    const calls: { name: string; url: string; step: "fill" | "submit" }[] = [];
    const fake = (name: DriverName, matches: (url: string) => boolean): Driver => ({
      name, detect: matches, formUrl: () => null,
      fill: async (_p, ctx) => { calls.push({ name, url: ctx.applyUrl, step: "fill" }); return { status: "filled", formUrl: ctx.applyUrl, fields: [], files: [], pending: [], durationMs: 0 } satisfies FillResult; },
      submit: async (_p, ctx) => { calls.push({ name, url: ctx.applyUrl, step: "submit" }); return { status: "failed", submitClicked: false, durationMs: 0 }; },
    });
    const driver = withCareerSites(fake("greenhouse", () => false), [fake("lever", (u) => /\/lever\//.test(u))]);
    const ctxFor = (p: string): DriverContext => ({
      applicationId: "app-1", applyUrl: `${server.origin}${p}?gh_jid=1`, resumePdfPath: resumePath, answers: {}, dryRun: true, onEvent: () => {},
      recordSubmitClick: async () => { throw new Error("never submits"); },
      profile: {
        fullName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 415 555 0100",
        linkedin: "https://linkedin.com/in/ada", website: "https://ada.dev", location: "San Francisco, CA", country: "US",
        workAuth: { authorizedUS: true, needsSponsorship: false },
      },
    });

    it("hands the form it reaches to that system's driver, for fill and for submit", async () => {
      calls.length = 0;
      const ctx = ctxFor("/jobs/to-lever");
      await withPage(async (p) => { await driver.fill(p, ctx); await driver.submit(p, ctx); });
      expect(calls).toEqual([
        { name: "lever", url: `${server.origin}/lever/acme/1`, step: "fill" },
        { name: "lever", url: `${server.origin}/lever/acme/1`, step: "submit" },
      ]);
    }, TIMEOUT);

    it("fills a Greenhouse form embedded on the company page in place, and parks it when turned off", async () => {
      const on = await withPage(async (p) => {
        const fill = await driver.fill(p, ctxFor("/jobs/embedded"));
        const submit = await driver.submit(p, ctxFor("/jobs/embedded"));
        return { fill, submit };
      });
      expect(on.fill.fields.find((f) => /first name/i.test(f.label))?.value).toBe("Ada");
      expect(on.fill.files.length).toBe(1);
      expect(on.submit).toMatchObject({ status: "failed", submitClicked: false });

      process.env[EMBEDDED_GREENHOUSE_FLAG] = "false";
      const off = await withPage((p) => driver.fill(p, ctxFor("/jobs/embedded")));
      expect(off).toMatchObject({ status: "needs_user", needsUser: { kind: "unsupported", reason: OFFSITE_FORM_REASON } });
    }, TIMEOUT);

    it("sends the embedded form only with dryRun false AND ALLOW_REAL_SUBMIT=true (local fixture), storing the click first", async () => {
      process.env.ALLOW_REAL_SUBMIT = "true";
      let recorded = 0;
      const ctx = { ...ctxFor("/jobs/embedded"), dryRun: false, answers: ANSWERS, recordSubmitClick: async () => { recorded++; } };
      const out = await withPage(async (p) => ({ fill: await driver.fill(p, ctx), submit: await driver.submit(p, ctx) }));
      expect(out.fill.pending).toEqual([]);
      expect(out.fill.status).toBe("filled");
      expect(out.submit).toMatchObject({ status: "submitted", submitClicked: true });
      expect(recorded).toBe(1);
    }, TIMEOUT);

    it("parks a bot check as a captcha and fails a gone posting with the reason", async () => {
      expect(await withPage((p) => driver.fill(p, ctxFor("/jobs/bot-check")))).toMatchObject({ status: "needs_user", needsUser: { kind: "captcha" } });
      expect(await withPage((p) => driver.fill(p, ctxFor("/jobs/gone")))).toMatchObject({ status: "failed", error: POSTING_GONE_REASON });
    }, TIMEOUT);
  });
});
