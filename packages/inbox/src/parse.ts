import PostalMime from "postal-mime";
import { htmlToText, parseAddress, parseAddressList } from "./text.js";

/** Attachment facts we keep. The content itself is never stored. */
export type AttachmentMeta = { filename: string; contentType: string; size: number };

/** What the receiving side said about spam and sender authentication. */
export type SpamVerdict = { spam: boolean; reason: string | null };

/** Where a message came from. `cloudflare` is our own Email Worker (raw MIME, HMAC); `raw` the same scheme from any relay. */
export const INBOUND_PROVIDERS = ["cloudflare", "raw", "generic", "postmark"] as const;
export type InboundProvider = (typeof INBOUND_PROVIDERS)[number];

/** One inbound message, normalised, whatever its transport. Addresses are lower-cased. */
export type InboundEmail = {
  /** Message-ID (or the provider's id); null when the message carries none. */
  messageId: string | null;
  from: string;
  fromName: string;
  /** Every recipient we can see: the envelope recipient first, then To, Cc, the provider's original recipient, Delivered-To. */
  to: string[];
  subject: string;
  /** Plain text: the text part, or the sanitised HTML part converted to text. */
  text: string;
  /** The HTML part as received (used only to find links; never stored). */
  html: string | null;
  receivedAt: Date;
  attachments: AttachmentMeta[];
  spam: SpamVerdict;
  provider: InboundProvider | "unknown";
  /** Size of what the provider handed over, in bytes. */
  sizeBytes: number;
};

/**
 * What a webhook may hand over: a raw MIME message (string or bytes), Postmark's inbound JSON, or a generic
 * `{ from, to, subject, text, html, attachments?, spam? }`. `{ raw }` / `{ rawEmail }` / `{ message }` wrap a raw MIME string.
 */
export type InboundPayload = string | Uint8Array | ArrayBuffer | Record<string, unknown>;

/** Largest message we read. Cloudflare Email Routing accepts up to 25 MiB; anything over this is refused before parsing. */
export const INBOUND_MAX_BYTES = 15 * 1024 * 1024;

export class InboundTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Inbound message is ${bytes} bytes, over the ${INBOUND_MAX_BYTES} byte limit`);
    this.name = "InboundTooLargeError";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

function dateOf(v: unknown): Date {
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function addressesOf(v: unknown): string[] {
  if (typeof v === "string") return parseAddressList(v);
  if (Array.isArray(v)) {
    return v.flatMap((x) => {
      if (typeof x === "string") return parseAddressList(x);
      const o = rec(x);
      const a = str(o.Email) || str(o.email) || str(o.address);
      return a ? [a.toLowerCase()] : [];
    });
  }
  return [];
}

const byteLength = (p: string | Uint8Array | ArrayBuffer): number => (typeof p === "string" ? Buffer.byteLength(p) : p.byteLength);

/**
 * Spam verdict from the receiving side's headers: SpamAssassin (`X-Spam-Status: Yes`, `X-Spam-Flag`, score over 5, as
 * Postmark and most relays add), and `Authentication-Results` where DMARC failed and neither SPF nor DKIM passed (a forged
 * sender). Mail with no such headers is not spam.
 */
export function spamVerdict(header: (name: string) => string): SpamVerdict {
  const status = header("x-spam-status");
  if (/^\s*yes\b/i.test(status) || /^\s*yes\b/i.test(header("x-spam-flag"))) return { spam: true, reason: "spam filter" };
  const score = Number.parseFloat(header("x-spam-score"));
  if (Number.isFinite(score) && score > 5) return { spam: true, reason: `spam score ${score}` };
  const auth = header("authentication-results").toLowerCase();
  if (/\bdmarc=fail\b/.test(auth) && !/\bspf=pass\b/.test(auth) && !/\bdkim=pass\b/.test(auth)) return { spam: true, reason: "sender authentication failed" };
  return { spam: false, reason: null };
}

export async function parseMime(raw: string | Uint8Array | ArrayBuffer, opts: { envelopeTo?: string[]; provider?: InboundProvider } = {}): Promise<InboundEmail> {
  const sizeBytes = byteLength(raw);
  if (sizeBytes > INBOUND_MAX_BYTES) throw new InboundTooLargeError(sizeBytes);
  const m = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const header = (name: string) => m.headers.filter((h) => h.key === name).map((h) => h.value).join("; ");
  const from = m.from && "address" in m.from && m.from.address ? m.from : null;
  const to = [
    ...(opts.envelopeTo ?? []),
    ...(m.to ?? []).flatMap((a) => (a.address ? [a.address] : a.group?.map((g) => g.address) ?? [])),
    ...(m.cc ?? []).flatMap((a) => (a.address ? [a.address] : [])),
    ...parseAddressList(header("x-original-to")), ...parseAddressList(header("delivered-to")), ...(m.deliveredTo ? [m.deliveredTo] : []),
  ].map((a) => a.toLowerCase());
  const text = m.text?.trim() ? m.text : m.html ? htmlToText(m.html) : "";
  return {
    messageId: m.messageId?.trim() || null,
    from: (from?.address ?? "").toLowerCase(), fromName: from?.name ?? "",
    to: uniq(to), subject: m.subject ?? "", text, html: m.html ?? null, receivedAt: dateOf(m.date),
    attachments: (m.attachments ?? []).filter((a) => a.disposition !== "inline" || !a.mimeType.startsWith("image/")).map((a) => ({
      filename: (a.filename ?? "attachment").slice(0, 200), contentType: a.mimeType, size: typeof a.content === "string" ? a.content.length : a.content.byteLength,
    })),
    spam: spamVerdict(header), provider: opts.provider ?? "unknown", sizeBytes,
  };
}

/** Postmark inbound webhook JSON. */
export function fromPostmark(o: Record<string, unknown>, sizeBytes = 0): InboundEmail {
  const full = rec(o.FromFull);
  const headers = Array.isArray(o.Headers) ? (o.Headers as unknown[]).map(rec) : [];
  const header = (name: string) => headers.filter((h) => str(h.Name).toLowerCase() === name).map((h) => str(h.Value)).join("; ");
  const from = parseAddress(str(full.Email) ? `${str(full.Name)} <${str(full.Email)}>` : str(o.From));
  const html = str(o.HtmlBody) || null;
  return {
    messageId: header("message-id") || str(o.MessageID) || null,
    from: from.address, fromName: str(full.Name) || from.name,
    to: uniq([
      ...addressesOf(str(o.OriginalRecipient)), ...addressesOf(o.ToFull), ...addressesOf(o.CcFull), ...addressesOf(o.To), ...addressesOf(o.Cc),
      ...addressesOf(header("x-original-to")), ...addressesOf(header("delivered-to")),
    ].map((a) => a.toLowerCase())),
    subject: str(o.Subject), text: str(o.TextBody) || (html ? htmlToText(html) : ""), html, receivedAt: dateOf(o.Date ?? header("date")),
    attachments: (Array.isArray(o.Attachments) ? (o.Attachments as unknown[]).map(rec) : []).map((a) => ({
      filename: (str(a.Name) || "attachment").slice(0, 200), contentType: str(a.ContentType) || "application/octet-stream", size: num(a.ContentLength),
    })),
    spam: spamVerdict(header), provider: "postmark", sizeBytes,
  };
}

/** Our generic JSON shape (also what a custom relay or a test posts). */
export function fromGeneric(o: Record<string, unknown>, sizeBytes = 0): InboundEmail {
  const from = parseAddress(str(o.from) || str(o.sender) || str(rec(o.from).address));
  const html = str(o.html) || null;
  const headers = rec(o.headers);
  const header = (name: string) => str(Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1]);
  const spam = o.spam === true ? { spam: true, reason: str(o.spamReason) || "marked by sender" } : spamVerdict(header);
  return {
    messageId: str(o.messageId) || str(o.message_id) || str(o.id) || null,
    from: from.address, fromName: str(o.fromName) || from.name,
    to: uniq([...addressesOf(o.envelopeTo), ...addressesOf(o.to), ...addressesOf(o.cc), ...addressesOf(o.recipient)].map((a) => a.toLowerCase())),
    subject: str(o.subject), text: str(o.text) || str(o.body) || (html ? htmlToText(html) : ""), html, receivedAt: dateOf(o.date ?? o.receivedAt),
    attachments: (Array.isArray(o.attachments) ? (o.attachments as unknown[]).map(rec) : []).map((a) => ({
      filename: (str(a.filename) || str(a.name) || "attachment").slice(0, 200), contentType: str(a.contentType) || str(a.type) || "application/octet-stream", size: num(a.size),
    })),
    spam, provider: "generic", sizeBytes,
  };
}

/** Normalises any supported payload into an `InboundEmail`, guessing the shape. Throws on a payload it cannot read. */
export async function normalizeInbound(payload: InboundPayload): Promise<InboundEmail> {
  if (typeof payload === "string" || payload instanceof Uint8Array || payload instanceof ArrayBuffer) return parseMime(payload);
  const o = rec(payload);
  const wrapped = str(o.raw) || str(o.rawEmail) || str(o.message);
  if (wrapped && /^[\w-]+:/m.test(wrapped.slice(0, 2000))) return parseMime(wrapped, { envelopeTo: addressesOf(o.envelopeTo) });
  if ("TextBody" in o || "HtmlBody" in o || "MessageID" in o || "FromFull" in o) return fromPostmark(o);
  if ("from" in o || "subject" in o || "text" in o) return fromGeneric(o);
  throw new Error("Unrecognised inbound email payload");
}
