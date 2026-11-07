# API contract used by the temporary web app

The trimmed dashboard in `apps/web` calls exactly these endpoints. The API must serve these shapes. The new frontend
from the design team will use the same API, so keep it stable and document additions here.

Session cookie: `SESSION_COOKIE_NAME` (default `norinote_session`), httpOnly, secure in production, sameSite lax.

## Auth
- GET `/api/auth/session`
- POST `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/forgot-password`,
  `/api/auth/reset-password`, `/api/auth/verify-email`, `/api/auth/change-password`, `/api/auth/resend-verification`
- GET `/api/auth/sessions`, DELETE `/api/auth/sessions/:id`, POST `/api/auth/sessions/revoke-others`
- DELETE `/api/auth/account` with body `{ confirm }`

## Onboarding and profile
- GET `/api/onboarding`; PUT `/api/onboarding` with body `{ step, data }`, steps: resume, contact, authorization,
  screening, preferences. Finishing creates a first lane from the preferences.
- GET `/api/me`, PUT `/api/profile`. `autoApplyDailyCap` (0 to 100) is the daily limit: applications approved per UTC
  day, by any channel; 0 = no limit.
- POST `/api/profile/resume` (pasted text), POST `/api/profile/resume-file` (upload)
- The answer bank (answers Nori remembered from forms, and the user's own): GET `/api/profile/answers` returning
  `[{ id, questionText, answer, source, lastUsedAt }]` (`source` is `user`, `default` or `model`; most recently used
  first); PATCH `/api/profile/answers/:id` with `{ answer }` (1 to 2000 characters) returning the row, now `source:
  "user"` so nothing overwrites it; DELETE `/api/profile/answers/:id`. Another user's id is 404.

## Career graph
- GET `/api/graph` returning `{ nodes, edges }`
- POST `/api/graph/facts`, DELETE `/api/graph/nodes/:id`
- PATCH `/api/graph/nodes/:id` edits a card in place with any of `{ title, org, statement, skills, startDate, endDate }`
  (dates `YYYY` or `YYYY-MM`, null clears; `org: null` clears; skills normalised like the resume's). Returns `{ node }`
  in the graph's node shape and re-runs matching. 400 for an empty or invalid edit (including an end before the start),
  422 for a skill node (skills change through the cards that name them), 404 for another user's card. The card keeps
  its source: a newer resume still replaces cards that came from a resume. 120 edits an hour.

## Lanes
- GET `/api/lanes`; PUT `/api/lanes` with the whole array (new lanes have no `id`). Shape is the shared `Lane`
  (`remote` boolean, `minFit` 0..1).

## Jobs
- GET `/api/jobs` with `view`, `sort`, `lanes`, `maxAgeHours` (1 to 72, default 72; `view=today` is the last 24 hours),
  `clearance`, `limit`; only jobs posted in the last 72 hours are listed, plus jobs the user added by link (always); returns
  `[{ job, match, applicationStatus?, locations?, locationNames? }]`; `job.companyName` is a non-null string.
  `job.companyLogoUrl` is the company's logo on Brandfetch's CDN, or null (no known domain, or `BRANDFETCH_CLIENT_ID`
  unset). Load it only in an `<img>`; it answers 404 when Brandfetch has no logo, so show the letter tile on error too.
- GET `/api/jobs/summary` returning `{ open, newToday, fitsLanes, hasLanes }` over the last 72 hours, GET `/api/jobs/:id` returning `{ job, match }`, POST `/api/jobs/url` returning `{ job }` (and saving it for the user, so it always shows in their list).

## Shortlist
- GET `/api/shortlist` returning
  `[{ id, jobId, fit, reasons, status, createdAt, job: { id, companyName, companyLogoUrl, title, location, remote, applyUrl, postedAt } }]`
- POST `/api/shortlist/:jobId/dismiss`

## Applications
- GET `/api/applications` returning `[{ application, job, resume? }]`; POST `/api/applications` with `{ jobId }`.
- GET `/api/applications/:id` returning `{ application, job, resume, events }`; `application` carries `createdAt`
  and `updatedAt`.
- POST `/api/applications/:id/approve` (optional `{ answers }`), `/api/applications/:id/answer` (`{ answers }` keyed
  by pending question id), `/api/applications/:id/retry`.
- GET `/api/applications/:id/live`: "Watch Nori apply". The latest JPEG of the employer's page while Nori works on it
  (a new frame about every second while `applying` or `awaiting_code`; the last one stays about 15 minutes). Owner only;
  404 when there is none; `cache-control: no-store`. The site's CSP allows images only from itself, data: and blob:, so
  the dashboard fetches each frame and shows it through an object URL.
- POST `/api/applications/:id/cancel`: the person drops the application. It becomes `failed` with error `"Cancelled by
  you"` (Retry brings it back). 409 while Nori is on the employer's page (`applying`, `awaiting_code`) or once it was
  `submitted`; cancelling a failed one is a no-op 200.
- Retry after a code that never came is allowed: the receipt carries `codeMissing: true` (the site holds an application
  until its code is entered), so the duplicate guard does not apply.
- POST `/api/applications/:id/code` with `{ code }` (3 to 20 letters, digits, spaces or dashes): the verification code
  the employer emailed the person, typed while the run waits on the page (`status: "awaiting_code"`, up to 8 minutes).
  The waiting run picks it up within seconds and carries on. 409 when the application is not waiting for a code, 400
  for a malformed code. Telegram sends an urgent "Type your code" message with a link when a run starts waiting. If no
  code arrives in time the application parks as `needs_user`; Retry starts the form again and a new code is emailed.
- Approve is refused with 429 when the daily limit is used up (`autoApplyDailyCap` above 0 and that many already
  approved today, UTC); nothing changes and the application stays prepared. An application approved earlier (from
  Telegram before it was prepared, or before its questions were answered) has already counted and is never refused.

## Connected Gmail
- GET `/api/inbox/gmail` returning `{ available, connected, status }`: `available` is false when the server has no
  Composio key; `status` is Composio's (`INITIATED`, `ACTIVE`, `EXPIRED`, ...) or null when never connected.
- POST `/api/inbox/gmail/connect` returning `{ url }`: open it and approve read-only Gmail access. 503 when Gmail cannot
  be connected here or Composio is unavailable.
- DELETE `/api/inbox/gmail`: disconnects and forgets the connection.
- While connected, a run waiting for an emailed code reads it from Gmail by itself; typing it still works.

## Resumes and artifacts
- GET `/api/resumes/:id` returning `{ id, applicationId, content, changes, pages, atsChecks }`
- GET `/api/resumes/:id.pdf` (the PDF), GET `/api/artifacts/*` (receipt screenshots, owner only)

## Agent
- GET `/api/agent/status` returning `{ dailyCap, usedToday, liveSubmit?, lastTickAt?, nextTickAt? }`; `usedToday`
  counts applications approved since midnight UTC, the same count the limit is enforced on.
- GET `/api/agent/activity?limit=` returning events of kind discovered, scored, queued, skipped, prepared, approved,
  submitted, needs_user, reply, interview.

## Inbox and channels
- GET `/api/inbox` (newest first) returning `[{ id, applicationId, application: { id, status, companyName, jobTitle } | null,
  fromAddress, fromName, subject, bodyText, receivedAt, kind, code, verificationLink, links, attachments: [{ filename, contentType,
  size }], spam }]`; GET `/api/inbox/:id` adds `classifiedBy`, `forwardedAt` (404 for another user's message)
- GET `/api/inbox/address` returning `{ address, configured, settings: { forwardTo, forwardEnabled, retentionDays } }` (creates
  the address on first call); PUT `/api/inbox/settings` with any of those three settings
- POST `/api/inbox/webhook/:provider` (`cloudflare`, `raw`, `generic`: HMAC headers `x-norinote-timestamp` and
  `x-norinote-signature: v1=<hex>`; `postmark`: basic auth). No session. 200 `{ stored, duplicate }` or `{ stored: false, reason }`,
  401 bad signature, 413 too large. See docs/inbox.md
- POST `/api/inbound/email` (older webhook, shared secret, any shape; kept for compatibility)
- GET `/api/channels/telegram` returning `{ configured, botUsername, linked, linkedAt, settings: { dailyTime, timezone, count,
  summaryTime, quietHours: { enabled, start, end }, events: { digest, questions, submitted, needsUser, inbox, summary } } }`;
  PUT `/api/channels/telegram` with any subset of `settings` (same response; 400 on a bad time or zone); DELETE
  `/api/channels/telegram` returning `{ ok, linked: false }`; POST `/api/channels/telegram/link` (optional `{ timezone }`, the
  browser's zone) returning `{ code, expiresAt, botUsername, link }` (`link` is `https://t.me/<bot>?start=<code>`, single use,
  15 minutes); POST `/api/channels/telegram/webhook` (Telegram only, header `x-telegram-bot-api-secret-token`). See docs/telegram.md

## Health
- GET `/api/health`
