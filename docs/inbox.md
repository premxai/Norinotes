# Owned inbox (packages/inbox)

Every user gets an address like `nori-k3x9q2mhd4@<INBOUND_EMAIL_DOMAIN>`. Norinote uses it as the email on applications, so
verification codes, confirmations, recruiter replies, interview invitations and rejections land with us, are linked to the
right application, and can wake an application run that is waiting for a code. Nothing is lost: every message is shown in
`/api/inbox`, and can be forwarded to the user's own mailbox.

## Choosing an inbound provider (checked 2026-11-02)

| Option | ~1k msgs/mo | ~50k msgs/mo | Raw MIME | Webhook auth | Catch-all on a subdomain | Notes |
|---|---|---|---|---|---|---|
| Cloudflare Email Routing + Email Worker | $0 | $0 (Workers Paid $5/mo if CPU limits bite) | yes (`message.raw`) | ours (HMAC we sign) | yes | 25 MiB max; `forward()` only to verified addresses (200 per account) |
| Postmark inbound | $16.50 (Pro, 10k) | ~$68.50 (Pro + overage) | no (parsed JSON, attachments base64) | basic auth in URL, no signature | yes (inbound domain MX) | SpamAssassin headers; 35 MB attachments; retries 10x |
| SendGrid Inbound Parse | $19.95 (Essentials 50k; no free plan, 60-day trial) | $19.95 | yes (option) | basic auth only | yes | multipart form posts |
| Mailgun routes | $0 (free: 100/day, 1 route) | $35 (Foundation) | yes (URL ending `mime`) | HMAC-SHA256 (timestamp+token) | yes | best-signed of the hosted options |
| Amazon SES receiving | ~$0.10 | ~$5 + $0.09/1k 256 KB chunks | yes (S3/SNS) | SNS signed messages | yes | most setup (S3, SNS, IAM); AWS lock-in |
| Resend inbound | $0 (free 3k, counts against send quota) | $20 (Pro 50k) | via API fetch | Svix-style signed webhooks | yes | body fetched with a second API call |
| ForwardEmail | $0 (webhooks on free) | $0 to $3 | yes | check before relying on it | yes, regex too | privacy-focused, open source |

Recommendation: **Cloudflare Email Routing with an Email Worker** that POSTs the raw MIME to
`/api/inbox/webhook/cloudflare`, signed with `INBOUND_WEBHOOK_SECRET`. It is free at any volume we will see, gives the raw
message (so we parse it ourselves with `postal-mime`, already installed), and the code is provider-agnostic: switching to
Postmark, Mailgun or SES is a new adapter in `packages/inbox/src/parse.ts`, not a redesign. Fallback: Postmark inbound
(adapter already written) if Cloudflare is not the DNS host.

Forwarding is deliberately not done by re-sending the original message (that breaks SPF/DMARC and lands in junk, and
Cloudflare's `forward()` only reaches verified addresses). The `Forwarder` interface sends a new message from our domain
with the original sender as Reply-To. It is a stub that logs until an outbound provider is chosen (Cloudflare Email
Sending: 3,000/mo included on Workers Paid, then $0.35 per 1,000; or Postmark/SES).

## How a message flows

1. The provider POSTs to `POST /api/inbox/webhook/:provider` (`cloudflare` or `raw`: raw MIME; `generic`: our JSON; both
   HMAC-signed. `postmark`: Postmark JSON, basic auth). Bodies over 15 MB are refused (413). Unknown recipients get 200
   `{ stored: false }` so the provider stops retrying.
2. `storeInbound` (fast, no model): finds the user by the envelope recipient or To/Cc (plus-addresses work), classifies with
   rules, extracts the code and links, links to an application, stores `inbox_messages`, records an outcome for submitted
   applications, wakes in-process waiters. A repeated Message-ID is stored once.
3. The API enqueues `inbox.receive`. The worker's `handleInboxReceive` settles an ambiguous rule result with the small
   model (`gpt-4.1-mini` via @norinote/ai; on `AiUnavailableError` or budget exhaustion the message becomes `other`, so a
   guess is never typed into a form), relinks (the application may be newer than the mail), and forwards if enabled.
4. `awaitVerification` in the apply run sees the code or link.

### Classification (rules first)

Kinds: `verification_code` (with `code`, or with `meta.verification = "link"` and `meta.verificationLink` for
verify-by-link mail; one stored kind keeps the web's kind union unchanged), `confirmation`, `recruiter_reply`, `interview`,
`rejection`, `offer`, `other`.

Codes: the OTP-autofill approach. Find the code words (code, verification, one-time, security, passcode, OTP), collect
code-shaped tokens near them (4 to 8 digits, `123 456`, 6 to 10 character alphanumerics with a digit or mixed case), and
drop tokens whose own context says they are something else: URLs, emails, dates, times, phone numbers, zip codes,
order/invoice/requisition/reference/ticket numbers, money, percentages, years, promo codes, "code of conduct". Closest
wins; a token alone on its line or after "code:" scores higher. Two close candidates make the message ambiguous. Newsletters
and receipts are recognised as bulk and never read for codes.

### Linking

Evidence per application (recent 120 days): sender domain is the company's (or its careers domain, `companies.domain`, or
the apply URL's host) 4; the ATS display name names the company ("Acme via Greenhouse") 4; the posting's external id in
the mail (`R-1204`) 5; a board link with the company's token 3; the subject names the company 3; the body 2; +1 for the job
title, +1 when the sending ATS is the job's ATS. Ties prefer an application waiting for a code (for verification mail) or
already submitted (for everything else), then the most recent. A verification mail that names no company is linked only
when exactly one application on that ATS is waiting. An unbroken tie on a verification mail leaves it unlinked
(`meta.link.ambiguous`): a code typed into the wrong form is worse than none.

`meta.trusted` is true only when the sender is the company's own domain (strict: `acme.com`, `acmecareers.com`, not
`acme-careers-example.net`) or the job's ATS. Untrusted codes are stored and shown but never handed to apply.

## awaitVerification (for packages/apply)

```ts
import { awaitVerification, type VerificationResult } from "@norinote/inbox";

function awaitVerification(args: {
  applicationId: string;
  since: Date;            // only mail that arrived at or after this (take it just before clicking submit)
  timeoutMs: number;      // resolve null after this long
  accept?: "code" | "link" | "any";   // default "any"; a code wins when both arrived
  exclude?: Set<string>;  // message ids already used; the returned one is added
  signal?: AbortSignal;   // abort resolves null
  db?: Db;                // default getDb()
  pollMs?: number;        // default 1500
}): Promise<VerificationResult | null>;

type VerificationResult =
  | { type: "code"; code: string; messageId: string; receivedAt: Date; from: string }
  | { type: "link"; link: string; messageId: string; receivedAt: Date; from: string };
```

It polls `inbox_messages` (works across processes: the API stores, the worker waits) and is woken immediately by a store
or reprocess in the same process. It returns linked, trusted messages for the application; an unlinked message only when
its ATS is the job's ATS and this is the user's only application waiting on that ATS. Spam is never returned.
`createCodeWaiter(db)` adapts it to apply's existing `CodeWaiter` interface (codes only, 2-minute look-back), and the
worker already passes that to apply.

## Addresses and settings

`assignInboxAddress(db, userId, domain)`: `nori-` plus 10 random characters from an alphabet without look-alikes
(no `0 o 1 l i`), about 49 bits, unique index, created once per user (on onboarding, or on `GET /api/inbox/address`).
Forwarding (`forwardTo`, `forwardEnabled`) and `retentionDays` (1 to 365) live in `profiles.preferences.inbox`; a
forwarding address on our own domain is refused (loop).

## Privacy

- Stored: sender address and display name, subject (500 chars), plain-text body (20,000 chars), links without tracking
  parameters, code, attachment names/types/sizes. Not stored: HTML, attachment content, other headers.
- HTML is sanitised before conversion: scripts, styles, forms, iframes, tracking pixels and every remote image are removed.
- Retention: `INBOX_RETENTION_DAYS` (default 90) or the user's shorter setting; the worker sweeps every 6 hours
  (`purgeExpiredInbox`). Deleting the account deletes the mail (cascade).
- Spam (SpamAssassin headers, DMARC fail without SPF or DKIM pass, or `spam: true` from a relay) is kept but never linked,
  forwarded, or used as a code.

## Setup the owner does later (nothing here has been done)

1. Pick a subdomain for inbound mail, e.g. `in.norinote.xyz`, so the main domain's mail is untouched. Set
   `INBOUND_EMAIL_DOMAIN=in.norinote.xyz` and a long random `INBOUND_WEBHOOK_SECRET` (32+ bytes) on the API and worker.
2. Cloudflare dashboard, the zone: Email > Email Routing > enable for the subdomain (Settings > add subdomain). Cloudflare
   adds the MX records (`route1/2/3.mx.cloudflare.net`) and an SPF TXT record on `in.norinote.xyz`. Do not add MX records
   for the apex unless you want Cloudflare to receive that mail too.
3. Create the Email Worker (Workers > Create > Email Worker) with the code below; add `INBOUND_WEBHOOK_SECRET` and
   `API_URL` as Worker secret and variable. The Worker needs no packages; the API parses the MIME.
4. Email Routing > Routing rules > Catch-all address > Action "Send to a Worker" > the worker. Enable the catch-all.
5. Send a test mail to the address shown by `GET /api/inbox/address`; it should appear in `GET /api/inbox`.
6. Optional fallback for messages the API refuses: set `FALLBACK_TO` to a verified Cloudflare destination address.
7. Later, for forwarding: choose an outbound provider, verify the sending domain (SPF, DKIM, DMARC), and replace
   `createStubForwarder` in `apps/worker/src/consumers.ts` with a real `Forwarder`.

Postmark instead: create an inbound stream, set the inbound domain MX to `inbound.postmarkapp.com`, and the webhook URL to
`https://inbound:<INBOUND_WEBHOOK_SECRET>@<api host>/api/inbox/webhook/postmark`.

```js
// Cloudflare Email Worker: forwards each message's raw MIME to the Norinote API, signed.
export default {
  async email(message, env) {
    if (message.rawSize > 15 * 1024 * 1024) {
      if (env.FALLBACK_TO) await message.forward(env.FALLBACK_TO);
      else message.setReject("Message too large");
      return;
    }
    const body = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const ts = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.INBOUND_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = new Uint8Array([...new TextEncoder().encode(ts + "."), ...body]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, signed))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const res = await fetch(`${env.API_URL}/api/inbox/webhook/cloudflare`, {
      method: "POST",
      headers: { "content-type": "message/rfc822", "x-norinote-timestamp": ts, "x-norinote-signature": `v1=${mac}`, "x-norinote-envelope-to": message.to },
      body,
    });
    // 5xx: throw so Cloudflare reports a temporary failure and the sender retries. 4xx other than 401: keep a copy if possible.
    if (res.status >= 500) throw new Error(`Norinote API ${res.status}`);
    if (!res.ok && env.FALLBACK_TO) await message.forward(env.FALLBACK_TO);
  },
};
```

## Code map

`parse.ts` (normalised `InboundEmail`, MIME/Postmark/generic adapters, spam verdict, size limit), `signature.ts` (HMAC,
provider checks), `text.ts` (sanitise, pixels, tracking parameters, HTML to text), `codes.ts` + `classify.ts` (rules),
`model.ts` (small-model fallback), `link.ts` (linking, trust), `receive.ts` (store, reprocess, meta), `waiter.ts`
(`awaitVerification`, `createCodeWaiter`), `notify.ts` (in-process wake-up), `address.ts` (addresses, settings),
`forward.ts` (forwarder interface, stub), `retention.ts`, `process.ts` (`inbox.receive` handler). Tests use synthetic
fixtures in `fixtures.ts`; no real mail, no network, no model calls.
