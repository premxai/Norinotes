/**
 * Finish end to end on LOCAL pages served from 127.0.0.1: a sign-in wall and a captcha box the "person" gets past
 * through the live view's input bus, then Nori fills the form. Dry run only. Skipped when Chromium is not installed.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, companies, eq, jobs, resumes, runEvents, users } from "@norinote/db";
import { createTestDb, type TestDb } from "@norinote/db/testing";
import { createBrowserPool, createMemoryInputBus, createApplication, finishApplications, greenhouseDriver, type BrowserPool, type LiveInputBus } from "./index.js";
import { chromiumInstalled, startFixtureServer, type FixtureServer } from "./test-helpers.js";
import { CompanyGate } from "./gate.js";

const FORM = `<form id="application_form">
  <label for="first_name">First Name</label><input id="first_name" type="text" required>
  <label for="email">Email</label><input id="email" type="email" required>
  <button type="button">Submit Application</button></form>`;

/** The form behind a sign-in: the sign-in page sets a cookie on Enter in the password box. Boxes sit at fixed spots. */
const SIGNIN_PAGE = `<html><body><div id="root"></div><script>
  if (document.cookie.indexOf("signedin=1") >= 0) document.getElementById("root").innerHTML = ${JSON.stringify(FORM)};
  else {
    document.getElementById("root").innerHTML = '<form id="login" style="position:absolute;left:0;top:0">'
      + '<input id="user" type="email" style="position:absolute;left:100px;top:100px;width:200px;height:30px">'
      + '<input id="pass" type="password" style="position:absolute;left:100px;top:200px;width:200px;height:30px"></form>';
    document.getElementById("pass").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && this.value.length > 3) { document.cookie = "signedin=1; path=/"; location.reload(); }
    });
  }
</script></body></html>`;

/** A visible captcha box on the form; its "I'm not a robot" button (inside the frame) takes it away. */
const CAPTCHA_PAGE = `<html><body>${FORM.replace("</form>", '<iframe src="/recaptcha/api2/anchor?size=normal" width="304" height="78" style="position:absolute;left:400px;top:300px;border:0"></iframe></form>')}</body></html>`;
const ANCHOR = `<html><body style="margin:0"><button style="width:304px;height:78px" onclick="parent.document.querySelector('iframe').remove()">I'm not a robot</button></body></html>`;

const run = chromiumInstalled();

describe.skipIf(!run)("Finish on local pages", () => {
  let tmp: string;
  let resumePath: string;
  let server: FixtureServer;
  let pool: BrowserPool;
  let t: TestDb;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "norinote-finish-"));
    resumePath = path.join(tmp, "resume.pdf");
    await writeFile(resumePath, "%PDF-1.4\n% test resume\n%%EOF\n");
    server = await startFixtureServer({ "/signin-apply": SIGNIN_PAGE, "/captcha-apply": CAPTCHA_PAGE, "/recaptcha/api2/anchor": ANCHOR });
    pool = createBrowserPool({ size: 1, artifactsDir: path.join(tmp, "artifacts"), timeoutMs: 80_000 });
    t = await createTestDb();
    delete process.env.ALLOW_REAL_SUBMIT;
  });
  afterAll(async () => {
    await pool.close();
    await server.close();
    await t.close();
    await rm(tmp, { recursive: true, force: true });
  });

  async function parked(applyPath: string) {
    const [u] = await t.db.insert(users).values({ email: `fin-e2e-${applyPath.slice(1)}@example.test`, passwordHash: "x" }).returning();
    const [c] = await t.db.insert(companies).values({ atsType: "greenhouse", atsToken: `fin-e2e${applyPath}`, name: "Local Co" }).returning();
    const [j] = await t.db.insert(jobs).values({ companyId: c!.id, atsType: "greenhouse", externalId: applyPath, title: "Engineer", applyUrl: `${server.origin}${applyPath}`, dedupeKey: applyPath }).returning();
    const res = await createApplication(t.db, u!.id, j!.id);
    if (!res.created) throw new Error("seed failed");
    const [r] = await t.db.insert(resumes).values({ applicationId: res.application.id, content: {}, pdfPath: resumePath }).returning();
    await t.db.update(applications).set({ status: "ready_to_finish", resumeId: r!.id, approvedAt: new Date() }).where(eq(applications.id, res.application.id));
    return { userId: u!.id, id: res.application.id, url: `${server.origin}${applyPath}` };
  }

  const deps = (inputs: LiveInputBus, url: string) => ({
    pool, inputs, drivers: [{ ...greenhouseDriver, detect: () => true }], companyGate: new CompanyGate(0), handoffPollMs: 100, handoffTimeoutMs: 30_000,
    preparer: { prepare: async () => ({ outcome: "prepared" as const }) },
    loadInputs: async () => ({
      applyUrl: url, jobTitle: "Engineer", companyName: "Local Co", resumePdfPath: resumePath, answers: {},
      profile: { fullName: "Test Applicant", firstName: "Test", lastName: "Applicant", email: "test.applicant@norinote.test", workAuth: {} },
    }),
  });

  async function whenHandedOff(id: string) {
    for (let i = 0; i < 300; i++) {
      if ((await t.db.select().from(applications).where(eq(applications.id, id)))[0]!.receipt?.handoff) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("never handed off");
  }

  it("the person signs in through the live view, then Nori fills the form (and never keeps what they typed)", async () => {
    const app = await parked("/signin-apply");
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, app.userId, [app.id], deps(inputs, app.url));
    await whenHandedOff(app.id);
    const at = (x: number, y: number) => ({ kind: "click" as const, x: x / 1280, y: y / 900 });
    await inputs.publish(app.id, at(200, 115));
    await inputs.publish(app.id, { kind: "type", text: "person@example.test" });
    await inputs.publish(app.id, at(200, 215));
    await inputs.publish(app.id, { kind: "type", text: "correct-horse-battery" });
    await inputs.publish(app.id, { kind: "key", key: "Enter" });
    const [res] = await running;
    expect(res, res?.message).toMatchObject({ status: "prepared" }); // dry run: filled, stopped before submit
    const [row] = await t.db.select().from(applications).where(eq(applications.id, app.id));
    expect(row!.receipt).toMatchObject({ dryRun: true });
    expect(JSON.stringify(row!.receipt)).toContain("Test");
    const events = await t.db.select().from(runEvents).where(eq(runEvents.applicationId, app.id));
    expect(events.map((e) => e.step)).toEqual(expect.arrayContaining(["handoff", "handoff_done"]));
    expect(JSON.stringify([row, events])).not.toContain("correct-horse-battery");
  }, 90_000);

  it("the person ticks the captcha box in the live view, then Nori carries on", async () => {
    const app = await parked("/captcha-apply");
    const inputs = createMemoryInputBus();
    const running = finishApplications(t.db, app.userId, [app.id], deps(inputs, app.url));
    await whenHandedOff(app.id);
    await inputs.publish(app.id, { kind: "click", x: 550 / 1280, y: 339 / 900 });
    const [res] = await running;
    expect(res, res?.message).toMatchObject({ status: "prepared" });
  }, 90_000);
});
