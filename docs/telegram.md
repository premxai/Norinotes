# Telegram channel (packages/telegram)

Telegram is the fastest way to use Norinote day to day: the daily shortlist with Apply and Skip buttons, the questions an
application needs answered, and a short note when something is sent, needs you, or an employer writes back.

Code: `packages/telegram` (client, send queue, signing, linking, digest, questions, events, outbox, notifier, update handler),
`apps/api/src/routes/channels.ts` and `apps/api/src/telegram.ts` (routes, webhook, button actions), `apps/worker/src/telegram.ts`
(the notifier timer), `scripts/telegram.mts` (polling runner, webhook setup). Migration `0007_telegram_channel`.

## Linking

1. The app calls `POST /api/channels/telegram/link` (optionally with the browser's `timezone`, which becomes the default zone)
   and shows `link`: `https://t.me/<bot>?start=<token>`. The token is 16 characters, single use, valid 15 minutes, and only its
   SHA-256 is stored (`auth_tokens`, kind `telegram_link`). Making a new one cancels the previous unused one.
2. Telegram opens the bot and sends `/start <token>`. The bot checks the token (unknown, expired and used tokens get their own
   reply; 10 failed tries per chat in 10 minutes are refused), marks it used and writes `channels` (user, `telegram`, chat id).
   One chat per user; linking a chat to another account moves it.
3. `/stop` in the chat, or `DELETE /api/channels/telegram` in the app, unlinks. A chat that blocks the bot is unlinked on the
   next send (403).

Only private chats that are linked get anything. Any other chat gets one line: connect from the app.

## What is sent

| Message | When | Buttons |
|---|---|---|
| Daily shortlist | once per local day from `dailyTime` (default 09:00) in `timezone` (default UTC, or the browser's zone at link time); nothing on a day with nothing new | per job: Apply n, Skip n, Details n (link to `/jobs?job=<id>`) |
| Questions | unanswered pending questions on the user's parked applications that no earlier message asked (30 days) | choice: one button per option; text: Type answer n (or reply to the message); files, multi-select, over 10 options: Answer in the app |
| Submitted | an application reached `submitted` | Receipt (link to `/applications/<id>`) |
| Needs you | parked without questions: captcha, emailed code not received, Workday or other account wall, blocked site | Finish in Norinote, Open the posting |
| Inbox | interview invite, recruiter reply or offer in the owned inbox (never spam): sender, subject, a short snippet | Open in Norinote |
| Daily summary | at most once a day from `summaryTime` (default 20:00), only if something happened | Open Norinote |

The daily shortlist takes the top `count` (default 5, max 10) shortlist rows that are `new`, open, from an unblocked company,
without an application, and never sent before (60 days), in the web shortlist's order (lane matches before widened rows, best
fit first), one per company and role. Each shows title, company, location, fit band (Strong 0.8+, Good 0.6+, Stretch 0.45+)
and the first "why this fits" reason.

Events are only announced for things that happened after linking and within the last 3 days, so linking never floods a chat.

**Quiet hours** (default 22:00 to 08:00 local, can be turned off) hold every message until they end, except urgent ones:
"needs you" and questions for an application the user already approved (it is waiting to be sent).

Every message has a dedupe key (`digest:2026-11-02`, `submitted:<id>`, `needs_user:<id>:<attempt>:<hash>`, `inbox:<id>`,
`questions:<hash of the newly open questions>`, `summary:<date>`) in `channel_messages`, so a tick that runs twice sends nothing
twice. Rows older than 90 days are deleted.

## Buttons

- **Apply** goes through the same functions as the web: `startApplication` (as `POST /api/applications`), then
  - prepared or parked: `approveApplication` (as `POST /api/applications/:id/approve`), which queues `apply.run`;
  - still queued or preparing: the tap is the approval, so `approved_at` is set now (it counts in `usedToday`) and an
    `apply_intent` row is recorded; the worker approves and queues `apply.run` as soon as the application is prepared.
    If preparation parks it on questions, the questions message follows and answering resumes it.
  - When the profile has a daily cap above 0 and today's approvals have reached it, Apply refuses and says so. (A cap of 0
    means autopilot is off; manual approvals, from the web or Telegram, are then not limited.)
- **Skip** dismisses the row (as `POST /api/shortlist/:jobId/dismiss`, other cities of the same role too).
- **Details** is a plain link to the app.
- Applied and skipped jobs lose their buttons (`editMessageReplyMarkup`); the toast says what happened.

**Questions** come from `pendingDigest` in @norinote/answers, which batches the same question across applications. One answer
is written to every application question in its group through `answerApplication` (as `POST /api/applications/:id/answer`):
saved on the application, remembered in the answer bank, and a parked application resumes when its last required question is
answered. Legal questions (work authorisation, sponsorship, salary, relocation, start date and the other legal slots of
@norinote/answers) only ever show the options the question itself lists; a legal yes/no question without listed options is
answered by typing. Nothing is suggested by Norinote. Free text: tap Type answer n, which sends a reply prompt, or reply to the
questions message itself (that answers its first open text question).

**Callback security.** Callback data is `<op>.<args>.<sig>` (at most 64 bytes): `a`/`s` + the job id (22 base64url
characters), `c` + message row + question group + option index, `t` + message row + group. `sig` is 12 characters of
HMAC-SHA256 over the body and the user id the chat is linked to, keyed with `SESSION_SECRET`. A forged button, or a button for
another user's chat, is answered with an empty toast and does nothing. Question rows are also checked to belong to the user.

## Transport and limits

- **Webhook** (production): `POST /api/channels/telegram/webhook`. Telegram sends the `secret_token` given in `setWebhook` in
  the `X-Telegram-Bot-Api-Secret-Token` header; it is derived as HMAC(SESSION_SECRET, sha256(bot token)) and compared in
  constant time (401 otherwise). Valid calls always get 200 so one bad update does not block the queue.
- **Polling** (local): `npx tsx scripts/telegram.mts poll` long-polls `getUpdates` and forwards each update to the running API's
  webhook with the same header, so the code path is identical and no public URL is needed.
- **Client**: `createBotClient` over fetch with `sendMessage`, `editMessageReplyMarkup`, `answerCallbackQuery`, `setWebhook`,
  `deleteWebhook`, `getUpdates`, `getMe`. Errors are `TelegramApiError` with `errorCode`, `description`, `retryAfter`.
- **Limits**: `SendQueue` serialises calls per chat at least 1 s apart and keeps the process under 30 messages/s; a 429 waits
  Telegram's `retry_after` and retries (3 times, waits over 60 s go back to the outbox with `not_before`). The worker sends
  each user's messages in order, users in parallel.
- The notifier runs every `TELEGRAM_TICK_SECONDS` (default 30) in the worker. It walks every linked user, which is fine for
  thousands of users; past that, shard by user id or move the per-user part onto a queue.

## Settings

`GET /api/channels/telegram` returns `{ configured, botUsername, linked, linkedAt, settings }`; `PUT` takes any subset of:

```json
{ "dailyTime": "09:00", "timezone": "Europe/London", "count": 5, "summaryTime": "20:00",
  "quietHours": { "enabled": true, "start": "22:00", "end": "08:00" },
  "events": { "digest": true, "questions": true, "submitted": true, "needsUser": true, "inbox": true, "summary": true } }
```

Stored in `profiles.preferences.telegram` (kept out of the user-facing preferences returned by `/api/me`).

## Setup the owner does later (nothing here has been done)

1. In Telegram, open **@BotFather**, send `/newbot`, choose a display name (Norinote) and a username ending in `bot`
   (e.g. `NorinoteBot`). BotFather replies with the token. Keep it secret.
2. Optional, in BotFather: `/setdescription`, `/setabouttext`, `/setuserpic`, and `/setcommands` with
   `start - Connect or check the connection`, `stop - Disconnect this chat`, `help - What this bot does`.
   Leave privacy mode on and do not add the bot to groups (only private chats are served).
3. Set on the API and the worker: `TELEGRAM_BOT_TOKEN=<token>`, `TELEGRAM_BOT_USERNAME=<username without @>`, a long random
   `SESSION_SECRET` (32+ bytes; the same value on both, it signs the buttons), `WEB_URL` (links in messages) and `API_URL`.
   `npx tsx scripts/telegram.mts me` checks the token.
4. Production: deploy, then run `npx tsx scripts/telegram.mts set-webhook` with the production `TELEGRAM_BOT_TOKEN`,
   `SESSION_SECRET` and `API_URL` (https) in the environment. Telegram only calls https URLs on ports 443, 80, 88 or 8443.
5. Local: `npm run dev` in one terminal and `npx tsx scripts/telegram.mts poll` in another (it removes any webhook first; run
   `set-webhook` again before going back to production, or use a second bot for development).
6. In the app: Settings, Connect Telegram, tap the link, press Start in Telegram.

## Tests

`packages/telegram/src/telegram.test.ts` (signing and forged data, 429 retry_after, per-chat spacing, quiet hours and time
zones, linking with valid, expired and reused tokens, daily shortlist selection and timing, events held through quiet hours,
blocked chats, Apply intents) and `apps/api/src/telegram.test.ts` (webhook secret, unknown chats, settings, deep-link linking,
/stop and DELETE, Apply/Skip/Details, forged and foreign buttons, question round trips with a choice tap and a free-text reply,
legal questions without suggested options). All against `fakeBotApi()` from `@norinote/telegram/testing`; no network.
