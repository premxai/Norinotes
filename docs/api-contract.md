# API contract used by the dashboard

The dashboard and site in `apps/landing` call exactly these endpoints. The API must serve these shapes, so keep it
stable and document additions here.

Session cookie: `SESSION_COOKIE_NAME` (default `norinote_session`), httpOnly, secure in production, sameSite lax.

## Auth
- GET `/api/auth/session`
- POST `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/forgot-password`,
  `/api/auth/reset-password`, `/api/auth/verify-email`, `/api/auth/change-password`, `/api/auth/resend-verification`
- GET `/api/auth/sessions`, DELETE `/api/auth/sessions/:id`, POST `/api/auth/sessions/revoke-others`
- DELETE `/api/auth/account` with body `{ confirm }`

## Onboarding and profile
- GET `/api/onboarding`; PUT `/api/onboarding` with body `{ step, data }`, steps: resume, contact, authorization,
  screening, attestations (`{ attestations }`, as on `PUT /api/profile`), preferences. Finishing creates a first lane from the preferences. The authorization step needs
  `workAuth.status`; without it the PUT returns 400 "Choose your work status". The status (citizen, permanent_resident,
  visa, other) is what the matching gates and form answers read for citizenship and permanent residence; being
  authorised to work says neither.
- GET `/api/me`, PUT `/api/profile`. `autoApplyDailyCap` (0 to 100) is the daily limit: applications approved per day
  in the person's own time zone, by any channel. 0 means "not set", so the default 20 applies; turning the limit off is
  not offered (docs/api-contract.md, Nori page). `attestations` holds the person's answer per kind of form attestation (`privacy`,
  `demographic_data`, `retention`, `accuracy`, `background_check`, `ai_policy`, `recording`, `arbitration`,
  `contact`, `terms`): `true`, `false` or `null` (not answered, Nori asks). PUT a partial object; `null` forgets one.
  Nori ticks a form's attestation only from the answer for its kind (docs/applying.md).
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
- Engine scope (`ENGINE_ATS`, now `greenhouse`): every job list and count shows only Greenhouse jobs, whether the posting
  is on Greenhouse's own board or on the company's careers site (Nori follows it to the form). Saved and Applied keep
  everything. Every fresh
  Greenhouse job is read and embedded, and Recommended is scored from all of them in the person's places (closeness to
  their graph, then evidence), not only titles that fit a role.
- GET `/api/jobs` with `view` (best, new, today, saved, applied; default best), `sort` (best, new), `lanes` (true/false,
  default true for `best`), `group` (true/false: one entry per role, default true), `maxAgeHours` (1 to 168, default 168,
  the 7-day window; `view=today` is the last 24 hours), `clearance` (hide/show, default show), `minScore` (0 to 1),
  `status` (open/all, default open), `q`, `limit` (1 to 200, default 50); only jobs posted in the last 7 days are listed,
  plus jobs the user added by link (always); returns
  `[{ job, match, applicationStatus?, locations?, locationNames? }]`; `job.companyName` is a non-null string.
  `job.companyLogoUrl` is the company's logo on Brandfetch's CDN, or null (no known domain, or `BRANDFETCH_CLIENT_ID`
  unset). Load it only in an `<img>`; it answers 404 when Brandfetch has no logo, so show the letter tile on error too.
- GET `/api/jobs/summary` returning `{ open, newToday, fitsLanes, hasLanes }` over the last 7 days, GET `/api/jobs/:id` returning `{ job, match }`, POST `/api/jobs/url` returning `{ job }` (and saving it for the user, so it always shows in their list).
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
  `job.requirements.disqualifiers` says "Requires US citizenship" for a citizens-only job and "Requires US citizenship
  or permanent residency" for a U.S.-person job (ITAR/EAR export control, "green card holders and citizens").

## Companies people ask for
- POST `/api/companies` with `{ query }` (a company name, or a link: its board or its own careers page; 2 to 2000
  characters). Nori finds the company's public job board on Greenhouse, Ashby, Lever, Workable, Rippling or Workday,
  checks it against the live public feed and adds it to the shared registry, so every person's search reads it.
  - 201 `{ status: "added", company, openJobs }`: a new board. `openJobs` is null when the board is too big to count in
    one short read.
  - 200 `{ status: "exists", company }`: the board (or a company of that name) was already in the registry. Nothing is
    fetched.
  - `company` is `{ id, name, system, systemName, reading }`. `reading` is false while the worker doesn't read that
    system yet (`ENGINE_ATS`), so the dashboard says when its jobs will appear.
  - 404 `{ error }`: no public board was found; `error` says so in plain words.
  - 422 `{ error }`: empty or unusable input, an internal address, a blocked aggregator, or LinkedIn, Indeed or
    Glassdoor (refused without any request). 429 with Retry-After: 10 requests per person per hour. 503: a board or
    site could not be read right now.

## Shortlist
- GET `/api/shortlist` (optional `limit`, 1 to 200, default 50) returning
  `[{ id, jobId, fit, reasons, status, createdAt, job: { id, companyName, companyLogoUrl, title, location, remote, applyUrl, postedAt } }]`
- GET `/api/shortlist/meta` returning `{ total, widened, lanesMatched, poolUsed, reading }` for the list's banner. `reading` is
  `"basic"` when more than half of the listed roles were read without the AI (only a rule-based job spec, no job
  embedding, or no embedded career points, so they were ranked by skill overlap), else `"full"` (also for an empty list).
  The dashboard can show a plain note for `"basic"`, e.g. "Your matches are using basic reading right now".
- POST `/api/shortlist/:jobId/dismiss` with an optional body `{ reason }`, returning `{ ok: true, reason, addedToSkipList }`.
  Skips the job (and the same role in other cities). `reason` is one of `not_my_kind` ("Not my kind of role"), `too_senior`
  ("Too senior"), `too_junior` ("Too junior"), `wrong_location` ("Wrong location"), `company` ("Company I don't want"),
  `missing_skills` ("Missing skills"), `other` ("Other"), or null/absent (no body still works); anything else is 400. Labels
  are `SKIP_REASON_LABELS` in @norinote/shared. Calling it again with a reason on a job already skipped records the reason,
  so the dashboard can skip first and ask why second. An applied job is left alone (`reason: null`). Effects:
  - `company` adds the company to the skip list (`preferences.excludeCompanies`); `addedToSkipList` is true when it was not
    there yet. Undo: remove it from the skip list (PUT `/api/profile`).
  - `not_my_kind`, `too_senior`, `too_junior`, `wrong_location` feed matching once the same kind is skipped twice (see
    skip effects below); `missing_skills` and `other` are only stored.
- GET `/api/shortlist/skip-effects` returning `[{ id, kind, reason, label, skips, delta }]`: what the person's skip reasons
  currently change in their matches. `kind` is `role` (a role family, e.g. label "frontend software engineering roles"),
  `level_above` / `level_below` ("senior level and above"), `city` ("Austin, TX") or `state` ("TX"); `skips` is how many
  skips are behind it; `delta` is the fit change for a matching job (-0.05; all effects together at most -0.1). Matching
  rows say so in their `reasons`, e.g. "You skipped 3 jobs at senior level or above as too senior (-0.05 fit)".
- DELETE `/api/shortlist/skip-effects/:id` (URL-encode the id, e.g. `role%3Asales`) removes an effect and rematches:
  the skips behind it stop counting (new skips of that kind can bring it back). 404 when it is not active.
- A row's `reasons` may include "Reposted N times in 60 days" (N is 3 or more): the company keeps re-listing this job;
  its `fit` is 0.03 lower for it.
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
- Every `application` (list, detail, POST) carries `batchId` (string or null) and `sendsOnItsOwn` (boolean): true when it
  has not started yet (queued, preparing or prepared) and Nori will send it without another click, because it is in a
  running batch (sent when its spacing slot comes) or the person already approved it (Apply with send). False for one
  waiting for the person's OK, and for a dry run that came back to prepared. Show Approve only when it is false.
- POST `/api/applications/:id/approve` (optional `{ answers }`), `/api/applications/:id/answer` (`{ answers }` keyed
  by pending question id), `/api/applications/:id/retry`. Answering every question of a parked application resumes it
  (`resumed: true`) and starts a fresh set of tries; when it still cannot go on the answers are kept and the reply is 409
  with the reason (never `ok` without a resume). Approve on a parked application with no question to answer (captcha,
  unsupported form, a code that never came) is 409 with the reason and changes nothing; Retry is the way back. Retrying a
  failed application clears its approval: it waits for the person's OK (or its batch's turn) again.
- `status: "ready_to_finish"` ("One step left"): Nori filled the form and stopped at a visible captcha or a sign-in page
  that only the person can do. The resume, answers and receipt stay; `error` holds the one-line reason (it names a
  captcha or a sign-in). Approve is 409; Cancel works; Retry runs it again without the person (a captcha is not always
  shown twice); Finish (below) is the way with the person. A submit the site
  stopped with a captcha challenge carries `receipt.captchaHeld: true`: the challenge held the form, so it may be sent
  again. Telegram sends one "N applications need one tap" message per new set of these.
- GET `/api/applications/flow` (optional `?days=`): the tracker's Sankey. `{ since, total, nodes: [{ id, label, count,
  stage }], links: [{ source, target, value }] }`. Stage 0 `started`; 1 `sent`, `needs_you`, `in_progress`, `cancelled`,
  `failed`; 2 (from sent) `interview`, `replied`, `rejected`, `waiting`, `silent` (no reply after 30 days); 3 (from
  interview) `offer`, `rejected_after_interview`, `interviewing`. One path per application; links into a node sum to
  its count; outcomes come from the `outcomes` table (inbox or manual), an interview beats a reply.
- GET `/api/applications/:id/live`: "Watch Nori apply". The latest JPEG of the employer's page while Nori works on it
  (a new frame about every second while `applying` or `awaiting_code`; the last one stays about 15 minutes). Owner only;
  404 when there is none; `cache-control: no-store`. The site's CSP allows images only from itself, data: and blob:, so
  the dashboard fetches each frame and shows it through an object URL.
- An application whose job closed before it was sent becomes `failed` with error `"This job is no longer open: the
  company took the posting down."` (checked before preparing and before sending). Retry checks again.
- POST `/api/applications/:id/cancel`: the person drops the application. It becomes `failed` with error `"Cancelled by
  you"` (Retry brings it back). 409 once it was `submitted`, while a live run holds it (`applying`, `awaiting_code` and
  either a browser step of this process or a row touched within 25 minutes), and while a submit click is marked: that is
  the person's to settle first (below). Cancelling a failed one is a no-op 200.
- A submit click Nori could not confirm (`receipt.submitClicked: true` on a `needs_user` or `failed` application) is the
  one case the worker will not resolve: only the person knows whether the employer has it, and both answers are final.
  - POST `/api/applications/:id/marked-sent`: `needs_user` or `failed` → `submitted`, as if Nori had seen the
    confirmation (`submittedAt` now, receipt `markedSent: true`). 409 when it cannot move.
  - POST `/api/applications/:id/not-sent`: clears the submit mark of a parked application (`clickClearedAt` in the
    receipt), so Retry may send it again and Cancel is allowed. 409 when there is no marked click.
  - Both are the person's own word: the worker never calls them, and Retry and Approve stay refused until one is used.
- Receipt fields (`receipt.sections[].fields[]`) Nori drafted carry `noriWrote: true`: show "Nori wrote this" next to
  them. `receipt.prepared.drafted` lists those answers as `{ key, label, value }` (docs/applying.md).
- Retry after a code that never came is allowed: the receipt carries `codeMissing: true` (the site holds an application
  until its code is entered), so the duplicate guard does not apply.
- POST `/api/applications/:id/code` with `{ code }` (3 to 20 letters, digits, spaces or dashes): the verification code
  the employer emailed the person, typed while the run waits on the page (`status: "awaiting_code"`, up to 8 minutes).
  The waiting run picks it up within seconds and carries on. 409 when the application is not waiting for a code, 400
  for a malformed code. Telegram sends an urgent "Type your code" message with a link when a run starts waiting. If no
  code arrives in time the application parks as `needs_user`; Retry starts the form again and a new code is emailed.
- POST `/api/applications/finish` with optional `{ ids }` (1 to 5 application ids; default: the oldest 5 with one step
  left): starts one Finish session and returns `{ ok: true, applicationIds }` in the order Nori takes them. 409 when none
  of them (or none at all) is `ready_to_finish`. Nori opens each in turn (status `applying`, the live view shows it),
  fills it again from its recipe and answers, and at the captcha or sign-in sets `receipt.handoff: { kind: "captcha" |
  "account", since }`: the person's turn. The dashboard then makes the live view clickable and polls frames faster (a new
  one about every half second). When the wall is gone Nori clears `handoff` and submits; if the person stops or 10 minutes
  pass it goes back to `ready_to_finish`. A sign-in carries over to the next application in the same session; the
  browser context, with every sign-in, is thrown away when the session ends. Nothing in a session is traced.
- POST `/api/applications/:id/live/input` with one input, while `receipt.handoff` is set: `{ kind: "click", x, y }` (x and
  y are fractions 0 to 1 of the frame), `{ kind: "type", text }` (1 to 200 characters), `{ kind: "key", key, shift? }`
  (Enter, Tab, Backspace, Delete, Escape, ArrowUp/Down/Left/Right, Home, End, Space), `{ kind: "scroll", dy }`,
  `{ kind: "done" }` (check now), `{ kind: "cancel" }` (stop; back to one step left). Returns `{ ok: true }`; 409 when Nori
  is not waiting for the person on that application, 400 for anything else. Inputs go straight to the browser and are
  never stored or logged: they may be a password. Nori never types into a sign-in page itself.
- Approve is refused with 429 when the daily limit is used up (`autoApplyDailyCap`, or the default 20 when it is 0, all
  approved today in the person's own time zone); nothing changes and the application stays prepared. An application approved earlier (from
  Telegram before it was prepared, or before its questions were answered) has already counted and is never refused.

## Outcomes
- GET `/api/applications/:id/outcomes` returning `{ applicationId, submittedAt, confirmedAt, state, outcomes: [{ id,
  kind, at, source, messageId }] }`: what the employer said, and the state it adds up to (`state` is the tracker's stage,
  null before the application was sent). Reads from the inbox first (`syncInboxOutcomes`). `source` is `inbox` or `user`.
- POST `/api/applications/:id/outcomes` with `{ kind, at? }` (`kind` one of `reply`, `interview`, `rejection`, `offer`;
  `at` an ISO time, not in the future): records one by hand, for replies that reach the person's own mailbox. 201
  `{ outcome, created, ...the view above }`, 200 when it was already there, 409 before the application was sent.
- DELETE `/api/applications/:id/outcomes/:outcomeId` removes one; DELETE `/api/applications/:id/outcomes?kind=<kind>`
  removes every active one of that kind (`{ ok, removed }`). A removed outcome is not re-added from its message.
- GET `/api/outcomes/summary`: the person's own rates, `{ overall, bySystem, byRoleFamily, byFitBand, byResume,
  minSample, noResponseDays, learning }`. A stats row is `{ key, applications, settled, pending, responses, interviews,
  rejections, offers, noResponse, responseRate, interviewRate, rejectionRate, medianDaysToFirstReply, smallSample }`;
  under `minSample` settled applications the rates and the median are null and `smallSample` is true, so counts only.
  Rates are over settled applications. `learning` is the nudge Nori learned (`{ active, resolved, positive, needed,
  computedAt, nudges: [{ dimension, value, positive, resolved, delta }] }`), or null when it cannot be computed. No
  model call.

## Nori page ("Apply for me")
- GET/PUT `/api/nori/settings`: `{ settings: { spacingMinutes (1-60, default 4), minFit, aggressiveness, skipCompanies,
  dailyLimit (1-100; the profile's daily cap, default 20) } }`. PUT takes any of these; unknown keys are 400.
  - `dailyLimit` is the one daily limit: a click, Apply with send, Telegram, Apply now, a batch and the schedule all count
    against it, and the day is the person's own (their schedule's time zone, `America/Los_Angeles` until they set one; see
    `capDayStart` in packages/apply/src/day.ts). A profile with no limit set (`daily_cap = 0`) has the default 20; turning
    the limit off is not offered.
  - `aggressiveness` (`cautious` | `balanced` | `wide`, default `balanced`; stored in `preferences.nori.aggressiveness`)
    is how much Nori sends without asking (ARCHITECTURE.md, Matching step 6): cautious sends only strong matches, 10 a
    week; balanced also worth-a-shot ones posted in the last 2 days, 20 a week; wide asks less of those, 30 a week.
    Everything Nori sends on its own (Apply now, the schedule, autopilot for strong fits) follows it.
  - `minFit` (0-1) is the Recommended list's threshold (`GET /api/jobs?view=best&minScore=<minFit>`), the dashboard's
    "All strong" shortcut (it picks jobs for a batch the person starts, so it is their approval) and the roles. It no
    longer decides what Nori sends on its own. Until it is saved it reads as the lowest of the enabled roles' minFit (0.6 with none;
    onboarding creates the first role at 0.6).
    Saving it sets every role's minFit to it and re-runs matching.
  - `skipCompanies` (up to 1000 names) is THE skip list, the same as `profile.preferences.excludeCompanies`: saving
    either changes both. Matching leaves those companies out of the shortlist, Today hides them, batches skip them
    ("Acme, Inc." and "acme" are the same company).
- POST `/api/nori/batches` with `{ recommended: true, limit? }` (Apply now): the server picks the jobs itself: new
  matches that are open, from the last 7 days, not applied, not skipped, on allowed job systems, that the apply decision
  sends now (`action: "send"` in GET `/api/nori/decisions`: the groups the person's aggressiveness sends, within the
  weekly pace, one per company, spread across kinds of jobs; `limit` 1-50, default 10). 409 when there are none. Same response as below. It never
  takes more jobs than today's limit has room for (`dailyLimit` minus applications approved today, UTC); 429 when there
  is no room. Pressed again within 60 seconds while the batch it started is running (a double click), it starts nothing
  and returns that batch: 200 `{ batch, added: <its total>, skipped: [], reused: true }`.
- POST `/api/nori/batches` with `{ jobIds }` (1 to 50): the person approves these at once, whatever their apply
  decision group and the weekly pace. At most one job per company, never a skipped company, never a hard no; an unsent
  application of theirs is taken over, a sent one is skipped. 201 `{ batch, added, skipped: [{ jobId, reason, detail? }] }`
  (reasons: not_found, not_supported, applied_recently (another job at a company applied to in the last 60
  days), skipped_company, same_company, already_applied, duplicate_recent, not_a_fit (a hard no of the apply decision;
  `detail` says which in plain words, e.g. "Missing a must-have: Kubernetes")); 409 when nothing could be added. Applications are prepared now. `BATCH_ATS` on the API (e.g.
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
- GET `/api/nori/decisions` (Apply decisions): `{ aggressiveness, weekUsed, weekLeft, decisions: [{ jobId, title, company,
  group: strong|worth_a_shot|stretch|null, action: send|later|ask|skip, reasons: [string], fit }] }` for the person's new
  matches, sends first (in sending order), then later, ask and skip, each best fit first. `send`: Nori would send it now
  (within what is left of today's limit and `weekLeft`: applications approved in the last 7 days plus jobs queued in
  a batch that is still running, counted in `weekUsed`); `later`: it would, but the limit, the pace or one-per-company
  holds it; `ask`: the one-tap prompt (Apply starts a one-job batch with `{ jobIds }`, Skip dismisses it); `skip`: a hard
  no (`group` null), never sent. `reasons`
  are plain sentences for the person. No model call.
- GET `/api/nori/needs-you`: `{ items: [{ applicationId, jobId, title, company, applyUrl, status, needs: questions|code|captcha|
  account|offsite|unsupported|other, reason, questions, batchId, updatedAt }] }`, newest first. `unsupported` is a form
  Nori cannot fill at all (Workday, SmartRecruiters, an unknown system, a posting that sends people to the company's own
  site): the person applies there themselves. `status` is `needs_user` or
  `ready_to_finish` (one step left: `needs` is captcha or account). Batch counts' `needsYou` include both.

## Nori chat
- GET `/api/nori/chat?before=<ISO time>` returning `{ messages: [{ id, role: "user" | "nori", text, actions, createdAt }] }`,
  oldest first, 50 at most (page back with `before` = the oldest `createdAt`).
- POST `/api/nori/chat` with `{ message }` (1-2000 chars) returning `{ message, reply }` (both message views). One small
  model call per message, charged to the person's daily AI budget; when it is used up (or AI is down) the reply says so
  and nothing changes. `reply.actions: [{ kind, summary, undoId }]` lists every change Nori made: `set_threshold`,
  `set_aggressiveness` (cautious, balanced or wide), `set_daily_limit`, `add_role`, `remove_role`, `skip_company`, `unskip_company`, `apply_now` (a batch of Recommended
  jobs), `schedule_on` and `schedule_off` (the autopilot below). `undoId` is null when there is nothing to undo. Nori never
  changes anything without listing it.
- POST `/api/nori/chat/undo/:undoId` returning `{ ok, summary }`: puts back what that change replaced (undoing
  `apply_now` stops the batch). Once only: `{ ok: false, summary: "Already undone" }` the second time; 404 for an unknown id.

## Nori schedule (autopilot)
- GET/PUT `/api/nori/schedule` returning `{ schedule: { enabled, days: ["mon".."sun"], time: "HH:MM", timezone, paused,
  lastRunOn, nextRunOn } }`. Off by default (weekdays 09:00 America/Los_Angeles once turned on). PUT takes any of
  enabled, days (1-7), time (24-hour HH:MM), timezone (IANA), paused; anything else is 400. `nextRunOn` is the next local
  date it runs (null when off or paused). On a chosen day, within the hour after `time`, the worker starts one "Apply
  for me" batch of the jobs the apply decision sends (as for Apply now: at most what today's limit still allows, within
  the weekly pace, Greenhouse only for now) and marks the day as run; the batch summary goes out like any batch's. The chat can turn it on (`schedule_on`) and pause it
  (`schedule_off`), each undoable. While it is on and not paused, a new strong fit (0.8+) is also sent as soon as Nori has
  prepared it, any day and time, when the apply decision says `send` (within the same daily limit and the weekly pace;
  see docs/applying.md); its run log has an `apply_decision` event, and an `autopilot` event when it was sent. One the
  decision leaves to the person (`ask`) stays prepared, and the Telegram strong-fit alert asks "Your call" with Apply
  and Skip.
- A Greenhouse job whose form lives on the company's own site (Greenhouse's page redirects there) is prepared as usual;
  at the click Nori follows the posting to the form (docs/applying.md). When it leads to a form of the company's own
  or another job system Nori doesn't fill, the application shows with
  `needs: "offsite"` in GET `/api/nori/needs-you` ("apply on their site").

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
- GET `/api/agent/status` returning `{ dailyCap, usedToday, liveSubmit?, lastTickAt?, nextTickAt? }`; `dailyCap` is the
  limit in force (the person's, else 20) and `usedToday` counts applications approved since their own midnight, the same
  count the limit is enforced on.
- GET `/api/agent/activity?limit=` returning events of kind discovered, scored, queued, skipped, prepared, approved,
  submitted, needs_user (also for ready_to_finish), reply, interview.

## Inbox and channels
- GET `/api/inbox` (newest first; optional `limit`, 1 to 200, default 100) returning `[{ id, applicationId, application: { id, status, companyName, jobTitle } | null,
  fromAddress, fromName, subject, bodyText, receivedAt, kind, code, verificationLink, links, attachments: [{ filename, contentType,
  size }], spam }]`; GET `/api/inbox/:id` adds `classifiedBy`, `forwardedAt` (404 for another user's message)
- GET `/api/inbox/address` returning `{ address, configured, settings: { forwardTo, forwardEnabled, retentionDays } }` (creates
  the address on first call); PUT `/api/inbox/settings` with any of those three settings
- POST `/api/inbox/webhook/:provider` (`cloudflare`, `raw`, `generic`: HMAC headers `x-norinote-timestamp` and
  `x-norinote-signature: v1=<hex>`; `postmark`: basic auth). No session. 200 `{ stored, duplicate }` or `{ stored: false, reason }`,
  401 bad signature, 413 too large. See docs/inbox.md
- POST `/api/inbound/email` (older webhook, shared secret, any shape; kept for compatibility)
- GET `/api/channels/telegram` returning `{ configured, botUsername, linked, linkedAt, settings: { dailyTime, timezone, count,
  summaryTime, quietHours: { enabled, start, end }, events: { digest, questions, submitted, needsUser, inbox, summary, strongFit } } }` (`strongFit`, default on:
  a strong fit as soon as Nori prepared it, with Apply and Skip; turning it off also stops Nori preparing strong fits ahead
  unless the schedule is on);
  PUT `/api/channels/telegram` with any subset of `settings` (same response; 400 on a bad time or zone); DELETE
  `/api/channels/telegram` returning `{ ok, linked: false }`; POST `/api/channels/telegram/link` (optional `{ timezone }`, the
  browser's zone) returning `{ code, expiresAt, botUsername, link }` (`link` is `https://t.me/<bot>?start=<code>`, single use,
  15 minutes); POST `/api/channels/telegram/webhook` (Telegram only, header `x-telegram-bot-api-secret-token`). See docs/telegram.md
- Inbox messages carry `usedAt` (ISO time or null): when an application run took that message's code or link ("Nori
  already used this code").

## Health
- GET `/api/health`: `{ ok, time }`, the database only; 503 when it cannot be read (the platform's own check).
- GET `/api/health/ai`: `{ ok, configured, recentSpecs?, ruleBased?, time }`, for an uptime monitor. 503 at once when this
  process has no `OPENAI_API_KEY`, and when nearly all jobs read in the last hour came from the rule-based fallback
  (at least 5 of them, 80% or more); the counts are only there when the key is set.
