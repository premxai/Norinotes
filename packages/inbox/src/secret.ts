import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Checks the shared secret an email provider sends with its webhook. Accepts the bare secret (`X-Webhook-Secret: s`),
 * `Bearer s`, and HTTP basic auth (`Basic base64(user:s)`, which is how Postmark carries it in the webhook URL). The
 * comparison is constant time. An empty or missing configured secret never verifies, so a deployment that forgot to set
 * `INBOUND_WEBHOOK_SECRET` rejects everything instead of accepting everything.
 */
export function verifyInboundSecret(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const value = header.trim();
  const candidates = [value];
  const bearer = /^Bearer\s+(.+)$/i.exec(value);
  if (bearer?.[1]) candidates.push(bearer[1].trim());
  const basic = /^Basic\s+(.+)$/i.exec(value);
  if (basic?.[1]) {
    const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    candidates.push(colon >= 0 ? decoded.slice(colon + 1) : decoded);
  }
  const want = digest(secret);
  let ok = false;
  for (const c of candidates) if (timingSafeEqual(digest(c), want)) ok = true;
  return ok;
}
