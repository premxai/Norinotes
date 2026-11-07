import { describe, expect, it } from "vitest";
import { createResendForwarder, readInboxSettings } from "./index.js";

describe("inbox settings", () => {
  it("forwards only when the user turned it on with an address", () => {
    expect(readInboxSettings(undefined)).toEqual({ forwardTo: null, forwardEnabled: false, retentionDays: null });
    expect(readInboxSettings({ inbox: { forwardTo: "Me@Work.example", forwardEnabled: true } })).toMatchObject({ forwardTo: "me@work.example", forwardEnabled: true });
    expect(readInboxSettings({ inbox: { forwardTo: "me@work.example", forwardEnabled: false } })).toMatchObject({ forwardEnabled: false });
  });
});

describe("Resend forwarder", () => {
  const mail = { to: "ada@example.com", from: "nori-abc@in.example.test", replyTo: "recruiter@acme.example", subject: "Fwd: Next steps", text: "Hello", inReplyTo: "<m1@acme.example>" };

  it("sends from the verified sender, with the employer as Reply-To and threading headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fwd = createResendForwarder({ apiKey: "re_test", from: "Norinote <hello@example.test>", fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch });
    await fwd.send(mail);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "Norinote inbox <hello@example.test>", to: ["ada@example.com"], reply_to: "recruiter@acme.example", subject: "Fwd: Next steps", text: "Hello",
      headers: { "In-Reply-To": "<m1@acme.example>", References: "<m1@acme.example>" },
    });
  });

  it("throws on a refused send so the queue retries", async () => {
    const fwd = createResendForwarder({ apiKey: "re_test", from: "hello@example.test", fetch: (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch });
    await expect(fwd.send(mail)).rejects.toThrow(/HTTP 422/);
  });
});
