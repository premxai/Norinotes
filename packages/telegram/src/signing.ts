import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Signing secret outside production when SESSION_SECRET is unset (API and worker must agree), so local testing needs no setup. */
export const DEV_SESSION_SECRET = "norinote-dev-session-secret";

/**
 * Inline-button callback data: `<op>.<arg>...<sig>`, at most 64 bytes (Telegram's limit). The signature is an HMAC of the
 * body and the user id the chat is linked to, keyed with SESSION_SECRET, so a button only works in the chat of the user it
 * was made for, and nobody can make one up.
 *
 *   a.<job>.<sig>           Apply to a shortlisted job
 *   s.<job>.<sig>           Skip (dismiss) it
 *   c.<msg>.<q>.<o>.<sig>   Choose option o for question group q of a questions message
 *   t.<msg>.<q>.<sig>       Type a free-text answer for question group q
 */
export type CallbackOp = "a" | "s" | "c" | "t";
export type Callback = { op: CallbackOp; args: string[] };

const SIG_CHARS = 12;
const OPS = new Set<CallbackOp>(["a", "s", "c", "t"]);

const mac = (secret: string, userId: string, body: string) =>
  createHmac("sha256", secret).update(`tg1|${userId}|${body}`).digest("base64url").slice(0, SIG_CHARS);

/** A UUID as 22 base64url characters. */
export function packId(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

/** Back from `packId`; null when it is not one. */
export function unpackId(packed: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(packed)) return null;
  const hex = Buffer.from(packed, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function signCallback(secret: string, userId: string, op: CallbackOp, args: (string | number)[]): string {
  const body = [op, ...args.map(String)].join(".");
  const data = `${body}.${mac(secret, userId, body)}`;
  if (Buffer.byteLength(data) > 64) throw new Error("callback data over 64 bytes");
  return data;
}

/** The op and arguments when `data` was signed for `userId` with `secret`; null otherwise (forged, or for another user). */
export function verifyCallback(secret: string, userId: string, data: string): Callback | null {
  const cut = data.lastIndexOf(".");
  if (cut <= 0) return null;
  const body = data.slice(0, cut);
  const given = Buffer.from(data.slice(cut + 1));
  const want = Buffer.from(mac(secret, userId, body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const [op, ...args] = body.split(".");
  if (!op || !OPS.has(op as CallbackOp)) return null;
  return { op: op as CallbackOp, args };
}

/** The `secret_token` Telegram sends back on every webhook call: derived, so there is one secret less to manage. */
export function webhookSecret(sessionSecret: string, botToken: string): string {
  return createHmac("sha256", sessionSecret).update(`telegram-webhook|${createHash("sha256").update(botToken).digest("hex")}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
