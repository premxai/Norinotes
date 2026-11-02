import PostalMime from "postal-mime";
import { htmlToText, parseAddress, parseAddressList } from "./text.js";

/** One inbound message, whatever its transport. Addresses are lower-cased. */
export type InboundEmail = {
  /** Message-ID (or the provider's id); null when the message carries none. */
  messageId: string | null;
  from: string;
  fromName: string;
  /** Every recipient we can see: To, Cc, the provider's original recipient, Delivered-To. */
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  receivedAt: Date;
};

/**
 * What a webhook may hand over: a raw MIME message (string or bytes), Postmark's inbound JSON, or a generic
 * `{ from, to, subject, text, html }`. `{ raw }` / `{ rawEmail }` / `{ message }` wrap a raw MIME string.
 */
export type InboundPayload = string | Uint8Array | ArrayBuffer | Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

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

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

export async function parseMime(raw: string | Uint8Array | ArrayBuffer): Promise<InboundEmail> {
  const m = await PostalMime.parse(raw);
  const header = (name: string) => m.headers.find((h) => h.key === name)?.value ?? "";
  const from = m.from && "address" in m.from && m.from.address ? m.from : null;
  const to = [
    ...(m.to ?? []).flatMap((a) => (a.address ? [a.address] : a.group?.map((g) => g.address) ?? [])),
    ...(m.cc ?? []).flatMap((a) => (a.address ? [a.address] : [])),
    ...parseAddressList(header("x-original-to")), ...parseAddressList(header("delivered-to")), ...(m.deliveredTo ? [m.deliveredTo] : []),
  ].map((a) => a.toLowerCase());
  const text = m.text?.trim() ? m.text : m.html ? htmlToText(m.html) : "";
  return {
    messageId: m.messageId?.trim() || null,
    from: (from?.address ?? "").toLowerCase(), fromName: from?.name ?? "",
    to: uniq(to), subject: m.subject ?? "", text, html: m.html ?? null, receivedAt: dateOf(m.date),
  };
}

/** Postmark inbound webhook JSON. */
function fromPostmark(o: Record<string, unknown>): InboundEmail {
  const full = rec(o.FromFull);
  const headers = Array.isArray(o.Headers) ? (o.Headers as unknown[]).map(rec) : [];
  const header = (name: string) => str(headers.find((h) => str(h.Name).toLowerCase() === name)?.Value);
  const from = parseAddress(str(full.Email) ? `${str(full.Name)} <${str(full.Email)}>` : str(o.From));
  const html = str(o.HtmlBody) || null;
  return {
    messageId: str(o.MessageID) || header("message-id") || null,
    from: from.address, fromName: str(full.Name) || from.name,
    to: uniq([
      ...addressesOf(o.ToFull), ...addressesOf(o.CcFull), ...addressesOf(o.To), ...addressesOf(o.Cc),
      ...addressesOf(str(o.OriginalRecipient)), ...addressesOf(header("x-original-to")), ...addressesOf(header("delivered-to")),
    ].map((a) => a.toLowerCase())),
    subject: str(o.Subject), text: str(o.TextBody) || (html ? htmlToText(html) : ""), html, receivedAt: dateOf(o.Date ?? header("date")),
  };
}

function fromGeneric(o: Record<string, unknown>): InboundEmail {
  const from = parseAddress(str(o.from) || str(o.sender) || str(rec(o.from).address));
  const html = str(o.html) || null;
  return {
    messageId: str(o.messageId) || str(o.message_id) || str(o.id) || null,
    from: from.address, fromName: str(o.fromName) || from.name,
    to: uniq([...addressesOf(o.to), ...addressesOf(o.cc), ...addressesOf(o.recipient)].map((a) => a.toLowerCase())),
    subject: str(o.subject), text: str(o.text) || str(o.body) || (html ? htmlToText(html) : ""), html, receivedAt: dateOf(o.date ?? o.receivedAt),
  };
}

/** Normalises any supported payload into an `InboundEmail`. Throws on a payload it cannot read. */
export async function normalizeInbound(payload: InboundPayload): Promise<InboundEmail> {
  if (typeof payload === "string" || payload instanceof Uint8Array || payload instanceof ArrayBuffer) return parseMime(payload);
  const o = rec(payload);
  const wrapped = str(o.raw) || str(o.rawEmail) || str(o.message);
  if (wrapped && /^[\w-]+:/m.test(wrapped.slice(0, 2000))) return parseMime(wrapped);
  if ("TextBody" in o || "HtmlBody" in o || "MessageID" in o || "FromFull" in o) return fromPostmark(o);
  if ("from" in o || "subject" in o || "text" in o) return fromGeneric(o);
  throw new Error("Unrecognised inbound email payload");
}
