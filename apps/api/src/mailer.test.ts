import { describe, expect, it } from "vitest";
import { createMailer, createResendMailer } from "./mailer.js";

function recordingFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 200 ? '{"id":"m1"}' : '{"message":"echo token=secret"}', { status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("Resend mailer", () => {
  it("posts the message with the key as a bearer token", async () => {
    const { calls, fetch } = recordingFetch();
    await createResendMailer({ apiKey: "re_test", from: "Norinote <hello@norinote.xyz>", fetch }).send({ to: "a@b.co", subject: "Hi", text: "Body" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "Norinote <hello@norinote.xyz>", to: ["a@b.co"], subject: "Hi", text: "Body" });
  });

  it("throws with the status only, never the response body", async () => {
    const { fetch } = recordingFetch(422);
    const send = createResendMailer({ apiKey: "re_test", from: "x@norinote.xyz", fetch }).send({ to: "a@b.co", subject: "Hi", text: "token=secret" });
    await expect(send).rejects.toThrow("HTTP 422");
    await expect(send).rejects.not.toThrow(/secret/);
  });
});

describe("createMailer", () => {
  it("falls back to the console unless both the key and the sender are set", async () => {
    const lines: string[] = [];
    await createMailer({ production: true, resendApiKey: "re_test" }, (l) => lines.push(l)).send({ to: "a@b.co", subject: "Hi", text: "token=secret" });
    expect(lines).toEqual(['[mail] not delivered (no mail provider configured): to=a@b.co subject="Hi"']);
  });
});
