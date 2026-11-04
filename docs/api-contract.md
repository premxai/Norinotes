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
- GET `/api/me`, PUT `/api/profile`
- POST `/api/profile/resume` (pasted text), POST `/api/profile/resume-file` (upload)

## Career graph
- GET `/api/graph` returning `{ nodes, edges }`
- POST `/api/graph/facts`, DELETE `/api/graph/nodes/:id`

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

## Resumes and artifacts
- GET `/api/resumes/:id` returning `{ id, applicationId, content, changes, pages, atsChecks }`
- GET `/api/resumes/:id.pdf` (the PDF), GET `/api/artifacts/*` (receipt screenshots, owner only)

## Agent
- GET `/api/agent/status` returning `{ dailyCap, usedToday, liveSubmit?, lastTickAt?, nextTickAt? }`
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
