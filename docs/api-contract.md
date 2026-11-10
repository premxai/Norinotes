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
- Every card node has `source` (readable: "your resume", "a fact you added", "GitHub", "your website") and `origin:
  { kind: "resume" | "user" | "github" | "site", ref, label }` (`ref`: the repo or page URL; `label`: the resume line it
  quotes, the repo as `owner/name`, or the site's host). Skill nodes have `origin: null`.
- Sources the person names: GET `/api/graph/sources` returning `{ sources: [{ id, kind, value, status, error,
  factsAdded, lastReadAt, createdAt }] }` (`status`: pending, reading, done, failed; `error` says what to fix).
  POST `/api/graph/sources` with `{ kind: "github" | "site" | "linkedin", value }`: a GitHub username (a profile link
  is reduced to the name), a public http(s) page, or a `linkedin.com/in/` link. 201 `{ source }`, or 200 with the same
  source when it is already there; 400 for a bad value, 422 for a non-public address, 409 past 10 sources. GitHub and
  site sources are read by the worker (public repos that are the person's own, not forks or archived, become project
  cards; a site is read like a resume, quotes checked, and its robots.txt is honoured); a LinkedIn link is only kept,
  never fetched. Nothing is ever searched for by the person's name. POST `/api/graph/sources/:id/refresh` reads it again
  (its facts are replaced). DELETE `/api/graph/sources/:id` removes the source and every fact read from it, returning
  `{ ok, factsRemoved }`; matching runs again.

## Lanes
- GET `/api/lanes`; PUT `/api/lanes` with the whole array (new lanes have no `id`). Shape is the shared `Lane`
  (`remote` boolean, `minFit` 0..1). `minFit` is optional on PUT: a role saved without it takes the threshold
  (`/api/nori/settings` minFit), which is where the threshold is set for every role.

## Jobs
- Engine scope (`ENGINE_ATS`, now `greenhouse`): every job list and count shows only Greenhouse jobs whose form is on
  Greenhouse's own board (embedded forms on a company site are left out). Saved and Applied keep everything. Every fresh
  Greenhouse job is read and embedded, and Recommended is scored from all of them in the person's places (closeness to
  their graph, then evidence), not only titles that fit a role.
- GET `/api/jobs` with `view`, `sort`, `lanes`, `maxAgeHours` (1 to 72, default 72; `view=today` is the last 24 hours),
  `clearance`, `limit`; only jobs posted in the last 72 hours are listed, plus jobs the user added by link (always); returns
  `[{ job, match, applicationStatus?, locations?, locationNames? }]`; `job.companyName` is a non-null string.
  `job.companyLogoUrl` is the company's logo on Brandfetch's CDN, or null (no known domain, or `BRANDFETCH_CLIENT_ID`
  unset). Load it only in an `<img>`; it answers 404 when Brandfetch has no logo, so show the letter tile on error too.
- GET `/api/jobs/summary` returning `{ open, newToday, fitsLanes, hasLanes }` over the last 72 hours, GET `/api/jobs/:id` returning `{ job, match }`, POST `/api/jobs/url` returning `{ job }` (and saving it for the user, so it always shows in their list).
- Every `job` also carries what its listing states, else null (never estimated): `pay: { min, max, currency: "USD" |
  "EUR" | "GBP" | "CAD", period: "year" | "month" | "hour" } | null`, `employmentType: "full_time" | "part_time" |
  "contract" | "internship" | "temporary" | null`, `workplace: "remote" | "hybrid" | "onsite" | null`.
- GET `/api/jobs/:id` also returns `job.company: { name, website, logoUrl, size: null, about: null }` (size and about are
  not collected yet).
- GET `/api/jobs/:id/preview` (the Review tab): `{ available: true, ats, questions: [{ key, label, type, required, status:
  "ready" | "ask" | "skip", answer, source }], counts: { total, ready, ask, skip } }` or `{ available: false, ats, reason }`
  (only Greenhouse forms are read ahead of time; others are read at Apply). Read only: no AI, no application, nothing
  saved. `answer` is what Nori would send (the resume shows as "Your tailored resume"); `ask` = Nori would ask you.
- GET `/api/jobs?view=applied`: jobs with an application of the person's, newest application first, open or closed,
  whatever their age or roles; each item's `applicationStatus` says where it is. `limit` is 1-200 (default 50).
- Jobs page: GET `/api/jobs` also takes `view=saved` (the user's saved jobs, newest saved first, open or closed, whatever
  their age or lanes; `q` still applies), `location=<text>` (location contains it) and `remote=true`. Every item has
  `saved: boolean`, and so does `job` on GET `/api/jobs/:id`. POST and DELETE `/api/jobs/:id/save` return `{ saved }`
  (a save is a bookmark: it does not add the job to the other lists, unlike a job added by link). GET
  `/api/jobs/locations` returns `{ locations: [{ name, count }] }`, the 30 most common open-job locations.
  `job.requirements.responsibilities` is the full list of what the job involves ("What you'll do").

## Shortlist
- GET `/api/shortlist` returning
  `[{ id, jobId, fit, reasons, status, createdAt, job: { id, companyName, companyLogoUrl, title, location, remote, applyUrl, postedAt } }]`
- POST `/api/shortlist/:jobId/dismiss`

## Applications
- GET `/api/applications` returning `[{ application, job, resume? }]`; POST `/api/applications` with `{ jobId, send? }`.
  `send: true` makes Apply the approval: a prepared application goes to the form at once (`status: "applying"`), one
  still being prepared is sent by the worker as soon as it is prepared, with no stop at `prepared`. It counts against the
  daily limit: 429 when today's limit is used up. Without `send`, Apply prepares it and waits for a click as before.
- GET `/api/applications/activity?days=182&tz=<IANA zone>` returning `{ days: [{ date: "YYYY-MM-DD", sent }], total,
  timezone }`: applications sent (submittedAt) per local day, every day listed oldest first, 0 when none. `days` 1-730
  (default 182); an unknown `tz` falls back to UTC.
- GET `/api/applications/:id` returning `{ application, job, resume, events }`; `application` carries `createdAt`
  and `updatedAt`.
- POST `/api/applications/:id/approve` (optional `{ answers }`), `/api/applications/:id/answer` (`{ answers }` keyed
  by pending question id), `/api/applications/:id/retry`.
- GET `/api/applications/flow` (optional `?days=`): the tracker's Sankey. `{ since, total, nodes: [{ id, label, count,
  stage }], links: [{ source, target, value }] }`. Stage 0 `started`; 1 `sent`, `needs_you`, `in_progress`, `cancelled`,
  `failed`; 2 (from sent) `interview`, `replied`, `rejected`, `waiting`, `silent` (no reply after 30 days); 3 (from
  interview) `offer`, `rejected_after_interview`, `interviewing`. One path per application; links into a node sum to
  its count; outcomes come from the `outcomes` table (inbox or manual), an interview beats a reply.
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

## Nori page ("Apply for me")
- GET/PUT `/api/nori/settings`: `{ settings: { spacingMinutes (1-60, default 4), minFit, skipCompanies, dailyLimit
  (1-100; the profile's daily cap, default 20) } }`. PUT takes any of these; unknown keys are 400.
  - `minFit` (0-1) is THE threshold: "Recommended" (`GET /api/jobs?view=best&minScore=<minFit>`), the "All strong"
    shortcut and the roles. Until it is saved it reads as the lowest of the enabled roles' minFit (0.7 with none).
    Saving it sets every role's minFit to it and re-runs matching.
  - `skipCompanies` (up to 1000 names) is THE skip list, the same as `profile.preferences.excludeCompanies`: saving
    either changes both. Matching leaves those companies out of the shortlist, Today hides them, batches skip them
    ("Acme, Inc." and "acme" are the same company).
- POST `/api/nori/batches` with `{ recommended: true, limit? }` (Apply now): the server picks the Recommended jobs itself
  (new matches at or above the threshold, open, last 72 hours, not applied, not skipped, one per company, best fit
  first, allowed job systems; `limit` 1-50, default 10). 409 when there are none. Same response as below.
- POST `/api/nori/batches` with `{ jobIds }` (1 to 50): the person approves these at once. At most one job per company,
  never a skipped company; an unsent application of theirs is taken over, a sent one is skipped. 201 `{ batch, added,
  skipped: [{ jobId, reason }] }` (reasons: not_found, not_supported, embedded_form, applied_recently (another job at a company applied to in the last 60
  days), skipped_company, same_company, already_applied,
  duplicate_recent); 409 when nothing could be added. Applications are prepared now. `BATCH_ATS` on the API (e.g.
  `greenhouse`) limits batches to those job systems; others are skipped as not_supported. Shortlist jobs carry
  `atsType`, so the page can offer only those.
- The worker (every 30 s) starts a running batch's next prepared application when nothing of it is on a page, the
  spacing has passed since the last start and today's limit has room. What needs the person is parked (needs_user)
  and never guessed; answering resumes it. A batch with nothing left to send becomes `done`; Telegram sends a summary.
- GET `/api/nori/batches` (latest 10) and GET `/api/nori/batches/:id` (with its applications: id, jobId, title,
  company, status, error, needs). A batch view: `{ id, status: running|stopped|done, createdAt, finishedAt,
  lastStartedAt, counts: { total, sent, working, preparing, ready, needsYou, cancelled, failed }, waitingFor:
  spacing|daily_limit|preparing|you|null, nextAt }`.
- POST `/api/nori/batches/:id/stop`: cancels what has not started (`"Cancelled by you"`); sent ones stay sent.
- GET `/api/nori/needs-you`: `{ items: [{ applicationId, jobId, title, company, applyUrl, needs: questions|code|captcha|
  account|other, reason, questions, batchId, updatedAt }] }`, newest first.

## Nori chat
- GET `/api/nori/chat?before=<ISO time>` returning `{ messages: [{ id, role: "user" | "nori", text, actions, createdAt }] }`,
  oldest first, 50 at most (page back with `before` = the oldest `createdAt`).
- POST `/api/nori/chat` with `{ message }` (1-2000 chars) returning `{ message, reply }` (both message views). One small
  model call per message, charged to the person's daily AI budget; when it is used up (or AI is down) the reply says so
  and nothing changes. `reply.actions: [{ kind, summary, undoId }]` lists every change Nori made: `set_threshold`,
  `set_daily_limit`, `add_role`, `remove_role`, `skip_company`, `unskip_company`, `apply_now` (a batch of Recommended
  jobs). `undoId` is null when there is nothing to undo. Nori never changes anything without listing it. No schedule yet.
- POST `/api/nori/chat/undo/:undoId` returning `{ ok, summary }`: puts back what that change replaced (undoing
  `apply_now` stops the batch). Once only: `{ ok: false, summary: "Already undone" }` the second time; 404 for an unknown id.

## Nori schedule (autopilot)
- GET/PUT `/api/nori/schedule` returning `{ schedule: { enabled, days: ["mon".."sun"], time: "HH:MM", timezone, paused,
  lastRunOn, nextRunOn } }`. Off by default (weekdays 09:00 America/Los_Angeles once turned on). PUT takes any of
  enabled, days (1-7), time (24-hour HH:MM), timezone (IANA), paused; anything else is 400. `nextRunOn` is the next local
  date it runs (null when off or paused). On a chosen day, within the hour after `time`, the worker starts one "Apply
  for me" batch of new Recommended jobs (as many as today's limit still allows, Greenhouse only for now) and marks the
  day as run; the batch summary goes out like any batch's. The chat can turn it on (`schedule_on`) and pause it
  (`schedule_off`), each undoable.
- A Greenhouse job whose form lives on the company's own site (Greenhouse's page redirects there) is parked at
  preparation with `needs: "offsite"` in GET `/api/nori/needs-you` ("apply on their site"); Nori never fills embedded forms.

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
- Inbox messages carry `usedAt` (ISO time or null): when an application run took that message's code or link ("Nori
  already used this code").

## Health
- GET `/api/health`
