import { describe, expect, it } from "vitest";
import { classifyMessage, extractCode, findCodes, htmlToText, normalizeInbound, sanitizeHtml, stripTrackingParams } from "./index.js";
import {
  ASHBY_CONFIRMATION, CALENDLY_INTERVIEW, GREENHOUSE_CODE, GREENHOUSE_CODE_HTML, INTERVIEW, LEVER_CONFIRMATION, NEWSLETTER, ORDER_RECEIPT,
  RECRUITER_REPLY, REJECTION, WORKDAY_ACCOUNT, withTo,
} from "./fixtures.js";

const TO = "nori-test@inbox.example.test";
const classify = async (raw: string) => {
  const e = await normalizeInbound(withTo(raw, TO));
  return { email: e, c: classifyMessage({ from: e.from, subject: e.subject, text: e.text }) };
};

describe("findCodes: what is and is not a code", () => {
  it("reads codes next to the code words", () => {
    expect(extractCode("Your verification code is 482913. It expires in 10 minutes.")).toBe("482913");
    expect(extractCode("Your one-time passcode:\n\n  731 942\n")).toBe("731942");
    expect(extractCode("Enter the following code to sign in: K4T9QZ")).toBe("K4T9QZ");
    expect(extractCode("Use 55821 as your login code.")).toBe("55821");
  });

  it("ignores dates, phone numbers, zip codes, order numbers, money and years", () => {
    const text = `Your security code is 640218.
Order #448812 placed on 10/30/2026 for $1299. Call (415) 555-0137 or +1 415 555 0199.
Ship to 1 Market St, San Francisco, CA 94105. Requisition R-1204, job id 7712345. Copyright 2026.`;
    const r = findCodes(text);
    expect(r.code).toBe("640218");
    for (const bad of ["448812", "2026", "1299", "94105", "1204", "7712345", "0137"]) expect(r.candidates.map((c) => c.code)).not.toContain(bad);
  });

  it("finds nothing in mail that only has numbers", () => {
    expect(findCodes("Invoice 22001 for order 99812, due 11/04/2026. Questions? 1-800-555-0199.").code).toBeNull();
    expect(findCodes("Use promo code SAVE2026 for 20% off. Our code of conduct applies.").code).toBeNull();
  });

  it("flags two equally plausible codes as ambiguous", () => {
    const r = findCodes("Your code is 123456 or, if that fails, your backup code is 654321.");
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.map((c) => c.code).sort()).toEqual(["123456", "654321"]);
  });
});

describe("classifyMessage on the fixture mails", () => {
  it("Greenhouse code, plain text and HTML with a tracking pixel", async () => {
    expect((await classify(GREENHOUSE_CODE)).c).toMatchObject({ kind: "verification_code", code: "aB3dE9xK", verification: "code", ambiguous: false });
    const html = await classify(GREENHOUSE_CODE_HTML);
    expect(html.c).toMatchObject({ kind: "verification_code", code: "Xk7Pq2Lm", verification: "code" });
    expect(html.email.text).not.toMatch(/wf\/open|upn=/);
    expect(html.email.spam).toEqual({ spam: false, reason: null });
  });

  it("Workday account mail: verify by link, the candidate id is not a code", async () => {
    const { c } = await classify(WORKDAY_ACCOUNT);
    expect(c).toMatchObject({ kind: "verification_code", code: null, verification: "link" });
    expect(c.magicLink).toBe("https://umbrella.wd1.myworkdayjobs.com/en-US/External/activate/9f8e7d6c5b4a?redirect=%2Fjob%2FR-88213");
  });

  it("confirmations from Lever and Ashby, with attachment metadata only", async () => {
    expect((await classify(LEVER_CONFIRMATION)).c.kind).toBe("confirmation");
    const ashby = await classify(ASHBY_CONFIRMATION);
    expect(ashby.c.kind).toBe("confirmation");
    expect(ashby.email.attachments).toEqual([{ filename: "Ada_Lovelace_Resume.pdf", contentType: "application/pdf", size: expect.any(Number) }]);
    // Tracking parameters are dropped from links; the rest of the link stays.
    expect(ashby.c.links[0]).toBe("https://jobs.ashbyhq.com/hooli/7c1e9b52-3f0a-4d7e-9a1b-2c3d4e5f6a7b/application");
  });

  it("rejection, interview invitations and a recruiter reply", async () => {
    expect((await classify(REJECTION)).c.kind).toBe("rejection");
    expect((await classify(INTERVIEW)).c.kind).toBe("interview");
    expect((await classify(CALENDLY_INTERVIEW)).c).toMatchObject({ kind: "interview", code: null });
    expect((await classify(RECRUITER_REPLY)).c.kind).toBe("recruiter_reply");
  });

  it("a recruiter's question under a 'Your application for ...' subject is a reply, not a confirmation (e2e run 1)", () => {
    const subject = "Your application for Senior DevOps Engineer";
    expect(classifyMessage({ from: "jordan.lee@arenaclub.com", subject, text: "Hi Marcus, I'm the recruiter for the Senior DevOps Engineer role. Before we go further, could you tell me your current notice period?" }).kind)
      .toBe("recruiter_reply");
    // Automatic receipts under the same subject stay confirmations, questions in the footer or not.
    expect(classifyMessage({ from: "no-reply@us.greenhouse-mail.io", subject, text: "We will review it shortly. Questions? See our FAQ." }).kind).toBe("confirmation");
    expect(classifyMessage({ from: "careers@arenaclub.com", subject, text: "Thanks for applying! We have received your application. Questions? Just reply." }).kind).toBe("confirmation");
    expect(classifyMessage({ from: "careers@arenaclub.com", subject, text: "We will review your materials and be in touch." }).kind).toBe("confirmation");
  });

  it("a newsletter and an order receipt full of numbers are not codes", async () => {
    expect((await classify(NEWSLETTER)).c).toMatchObject({ kind: "other", code: null, ambiguous: false });
    expect((await classify(ORDER_RECEIPT)).c).toMatchObject({ kind: "other", code: null });
  });

  it("is ambiguous when a code mail has two candidates or mixes outcomes", () => {
    expect(classifyMessage({ from: "a@b.co", subject: "Your verification code", text: "Your code is 123456 or your backup code is 654321." }))
      .toMatchObject({ kind: "verification_code", ambiguous: true });
    expect(classifyMessage({ from: "r@acme.com", subject: "Update", text: "Unfortunately the team is not moving forward with the onsite, but we'd like to invite you to an interview for another role." }))
      .toMatchObject({ kind: "rejection", ambiguous: true });
  });
});

describe("HTML handling", () => {
  it("strips tracking pixels, remote images, scripts and tracking parameters", () => {
    const html = `<p>Hi</p><img src="https://t.example/open.gif?id=1" width="1" height="1"><img src="https://cdn.example/logo.png" alt="Acme">
<script>alert(1)</script><a href="https://acme.example/jobs?utm_source=x&amp;id=7" onclick="track()">Jobs</a>`;
    const clean = sanitizeHtml(html);
    expect(clean).not.toMatch(/<img|<script|onclick|utm_source/);
    expect(htmlToText(html)).toBe("Hi\nAcme\nJobs (https://acme.example/jobs?id=7)");
    expect(stripTrackingParams("https://x.test/verify?token=abc&utm_medium=email")).toBe("https://x.test/verify?token=abc");
  });
});
