import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundProvider } from "./parse.js";
import { verifyInboundSecret } from "./secret.js";

/** Headers our Email Worker (or any relay using the same scheme) sends with each POST. */
export const SIGNATURE_HEADER = "x-norinote-signature";
export const TIMESTAMP_HEADER = "x-norinote-timestamp";
/** The SMTP envelope recipient (RCPT TO), which a Bcc'd message does not show in its headers. */
export const ENVELOPE_TO_HEADER = "x-norinote-envelope-to";
/** How far a signed timestamp may be from our clock. Replays older than this are refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const toBuffer = (body: string | Uint8Array): Buffer => (typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body.buffer, body.byteOffset, body.byteLength));

/** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`, the value of `x-norinote-signature`. */
export function signWebhook(body: string | Uint8Array, secret: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.`).update(toBuffer(body)).digest("hex");
  return `v1=${mac}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "no_secret" | "missing" | "stale" | "mismatch" };

/**
 * Checks an HMAC-signed webhook body (our Cloudflare Email Worker, the raw and generic adapters). The timestamp must be
 * within five minutes, and the signature is compared in constant time. Several `v1=` values (comma separated) are allowed
 * so the secret can be rotated: sign with both while switching. An unset secret never verifies.
 */
export function verifyWebhookSignature(
  body: string | Uint8Array, headers: { signature?: string | null; timestamp?: string | null }, secret: string | null | undefined, now: Date = new Date(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const ts = Number.parseInt(headers.timestamp ?? "", 10);
  if (!headers.signature || !Number.isFinite(ts)) return { ok: false, reason: "missing" };
  if (Math.abs(now.getTime() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const want = Buffer.from(signWebhook(body, secret, ts).slice(3), "hex");
  for (const part of headers.signature.split(",")) {
    const m = /^\s*v1=([0-9a-f]{64})\s*$/i.exec(part);
    if (!m?.[1]) continue;
    const got = Buffer.from(m[1], "hex");
    if (got.length === want.length && timingSafeEqual(got, want)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

/**
 * Verifies a provider webhook request. `cloudflare`, `raw`, `generic`: our HMAC scheme. `postmark`: Postmark does not sign
 * inbound posts; the secret travels as HTTP basic auth in the webhook URL (`https://inbound:<secret>@api.../postmark`)
 * and is compared in constant time. Every provider needs `INBOUND_WEBHOOK_SECRET`.
 */
export function verifyProviderRequest(
  provider: InboundProvider, body: string | Uint8Array, header: (name: string) => string | null | undefined, secret: string | null | undefined, now: Date = new Date(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (provider === "postmark") {
    const h = header("authorization") ?? header("x-webhook-secret");
    if (!h) return { ok: false, reason: "missing" };
    return verifyInboundSecret(h, secret) ? { ok: true } : { ok: false, reason: "mismatch" };
  }
  return verifyWebhookSignature(body, { signature: header(SIGNATURE_HEADER), timestamp: header(TIMESTAMP_HEADER) }, secret, now);
}
