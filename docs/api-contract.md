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
- GET `/api/jobs` with `view`, `sort`, `lanes`, `maxAgeDays`, `clearance`, `limit`; returns
  `[{ job, match, applicationStatus?, locations?, locationNames? }]`; `job.companyName` is a non-null string.
- GET `/api/jobs/summary`, GET `/api/jobs/:id` returning `{ job, match }`, POST `/api/jobs/url` returning `{ job }`.

## Shortlist
- GET `/api/shortlist` returning
  `[{ id, jobId, fit, reasons, status, createdAt, job: { id, companyName, title, location, remote, applyUrl, postedAt } }]`
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
- GET `/api/inbox` returning `[{ id, applicationId, fromAddress, subject, bodyText, receivedAt, kind, code, read? }]`
- POST `/api/inbound/email` (provider webhook, secret-checked, no session)
- GET `/api/channels/telegram` returning `{ configured, botUsername, linked }`; POST `/api/channels/telegram/link`
  returning `{ code, expiresAt, botUsername, link }`

## Health
- GET `/api/health`
