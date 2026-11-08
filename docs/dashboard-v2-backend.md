# Dashboard v2: what the backend needs

The API side of [dashboard-v2-plan.md](dashboard-v2-plan.md), section by section, against the API as it stands
(apps/api/src/routes, docs/api-contract.md, 2026-11-07). **Exists** = usable as is; **Change** = there, needs more;
**Missing** = to build. The UI is being wireframed and built in parallel; the order at the end is the order the UI
needs things in.

**Progress (2026-11-07, from the backend session; shapes in docs/api-contract.md win over this file):** built, tested
and gated, not yet deployed: the one threshold (`/api/nori/settings` minFit; `minFit` optional on PUT `/api/lanes`),
the one skip list (`skipCompanies` = `preferences.excludeCompanies`, up to 1000), `GET /api/applications/activity?days=&tz=`,
`POST /api/applications { jobId, send: true }` (429 at the daily limit), and `GET /api/jobs?view=applied` (with
`applicationStatus`). Already there: `limit` on `/api/jobs`, `resumeId` on applications, the needs-you count, graph
`source` ("resume" | "user") and `sourceQuote`.

**Update (later 2026-11-07):** everything else is built and passes the gate, locally only (not deployed):
`pay` (`{ min, max, currency, period }` or null, only when the listing states it), `employmentType` and `workplace`
on every job; `job.company { name, website, logoUrl, size: null, about: null }` on `GET /api/jobs/:id`;
`GET /api/jobs/:id/preview` (`{ available, ats, questions: [{ key, label, type, required, status: "ready" | "ask" |
"skip", answer, source }], counts }`, or `{ available: false, reason }` off Greenhouse); Apply now as
`POST /api/nori/batches { recommended: true, limit? }` (the server picks; 409 when none); the Nori chat
(`GET /api/nori/chat?before=`, `POST /api/nori/chat { message }` → `{ message, reply }` with `reply.actions:
[{ kind, summary, undoId }]`, `POST /api/nori/chat/undo/:undoId` → `{ ok, summary }`); Inbox `usedAt`; graph sources
(`GET/POST /api/graph/sources`, `POST /api/graph/sources/:id/refresh`, `DELETE /api/graph/sources/:id` →
`{ ok, factsRemoved }`; kinds github, site and linkedin; LinkedIn is stored, never fetched; at most 10). Graph nodes
keep the readable `source` string; v2 reads the new `node.origin: { kind: "resume" | "user" | "github" | "site", ref,
label } | null`. Only the schedule is still held. The backend session wrote the Privacy paragraph for graph sources;
it goes in the Privacy policy when the Career graph section ships:

> Career graph sources. If you add your GitHub username or your own website, Norinote reads only what you named: your
> public GitHub repositories (names, descriptions, languages and topics, not forks or archived ones) and the page you
> gave us, following its robots.txt. We turn them into career facts marked with where they came from, and you can
> remove a source at any time; its facts go with it. A LinkedIn link you add is stored so it can go on your
> applications; Norinote never visits or reads LinkedIn. We never look you up by name or search for you anywhere.

## Shared

| Need | Status | Notes |
|---|---|---|
| "Recommended" = matches in the person's roles at or above their threshold | **Change** | Today the threshold lives twice: lanes' `minFit` and Nori settings' `minFit`. One threshold, used by `GET /api/jobs?view=best&lanes=true&minScore=` and by Apply for me. |
| Companies to skip | **Change** | Lives twice: `profile.preferences.excludeCompanies` and Nori settings' `skipCompanies`. One list, used by matching and batches. |
| A count of what needs the person, for a dot in the rail | Exists | `GET /api/nori/needs-you` (`items.length`). A cheaper `GET /api/nori/needs-you/count` would do if it's polled on every page. |

## 1. Overview

| Need | Status | Notes |
|---|---|---|
| Greeting name, sent today | Exists | `GET /api/me`, `GET /api/agent/status` |
| Four recommended jobs | Exists | `GET /api/jobs?view=best&lanes=true&minScore=<threshold>` with a `limit` (add `limit` if it isn't there) |
| Activity graph: applications sent per day, last 6 months | **Missing** | `GET /api/applications/activity?days=182` → `{ days: [{ date: "2026-11-07", sent: 3 }], total }`, dates in the person's time zone (or take `tz`). Sent = `submittedAt`. |

## 2. Jobs

| Need | Status | Notes |
|---|---|---|
| List with search, location, Saved, best/new | Exists | `GET /api/jobs` (`view`, `q`, `location`, `minScore`, `status`), `GET /api/jobs/locations`, `POST/DELETE /api/jobs/:id/save` |
| Tabs: All (open jobs in your roles and places), Recommended (above threshold), Saved, Applied | **Change** | Applied: `view=applied` (jobs with an application of the person's), or the UI joins `GET /api/applications`. |
| Pay when the listing states it | **Change** | `job.pay: { min, max, currency, period } \| null`, parsed from the listing (Ashby and Lever often give it; Greenhouse rarely). Never estimated. |
| Tags from the listing | **Change** | `job.employmentType` (full-time, contract…) and `job.workplace` (remote, hybrid, on site) where the ATS gives them. |
| Company tab | **Missing** | What's known of the employer: `job.company: { name, website, logoUrl, size?, about? }` from the board and the careers page. Empty fields stay empty. |
| Insights tab (why it matches) | Exists | `GET /api/jobs/:id` → `match` (score, reasons) |
| Review tab: what Nori would send before Apply | **Missing** | `GET /api/jobs/:id/preview` → the form's questions (from `jobSpecs`), which ones Nori already has answers for (answer bank and profile), and which it would ask. No AI call; the tailored resume isn't made until Apply. |

## 3. Applications

| Need | Status | Notes |
|---|---|---|
| Apply means send | **Change** | `POST /api/applications { jobId, send: true }`: prepares (tailors the resume) and goes straight on to apply, no `prepared` stop. Counts as the person's approval; logged as such. |
| Stages: Optimizing resume → Applying (live) → Applied / Needs help | Exists | Statuses `preparing`, `applying`, `awaiting_code`, `submitted`, `needs_user`, `failed`; `GET /api/applications/:id/live` |
| Resume section (the tailored resume, what changed, PDF) | Exists | `GET /api/resumes/:id`, `GET /api/resumes/:id.pdf` (the application detail should carry `resumeId`) |
| Screenshot after Submit | Exists | `receipt.screenshotPath` via `GET /api/artifacts/*` |
| Needs help: the questions, answered in place | Exists | `pendingQuestions`, `POST /api/applications/:id/answer` (resumes the run) |
| Notes and next action (if kept) | **Missing** | `PUT /api/applications/:id/note { text }`; follow-up reminders `PUT /api/applications/:id/follow-up { at }`. Only if the UI keeps them. |
| Add an application made outside Norinote (if kept) | **Missing** | `POST /api/applications/external { company, title, url, appliedAt }`. Only if kept. |

## 4. Tracker

| Need | Status | Notes |
|---|---|---|
| Flow, headline numbers, periods | Exists | `GET /api/applications/flow?days=` |

## 5. Inbox

| Need | Status | Notes |
|---|---|---|
| Messages, codes, settings | Exists | `GET /api/inbox`, `GET /api/inbox/:id`, `PUT /api/inbox/settings` |
| "Nori already used this code" | **Change** | `usedAt` on a verification-code message (set when a run takes it). |

## 6. Nori (the chat)

| Need | Status | Notes |
|---|---|---|
| Talk with the agent | **Missing** | `POST /api/nori/chat { message }` → Nori's reply (streamed if possible) plus `actions: [{ kind, summary, undoId }]` for anything it changed. `GET /api/nori/chat?before=` for the history. Each message spends AI tokens: count it against the daily AI budget and say so when it's used up. |
| What the chat can do | **Missing** (tools over existing APIs) | Read and set roles (`/api/lanes`), add a role, set the daily cap and the threshold (`/api/nori/settings`), set or pause the schedule, Apply now (a batch of the Recommended jobs, Greenhouse only for now), and answer questions about matches and applications. Nothing it changes is hidden: every change comes back as an action. |
| Undo a change the chat made | **Missing** | `POST /api/nori/chat/undo/:undoId` |
| Setup card beside the chat | Exists (mostly) | Roles from `/api/lanes`; cap, threshold from `/api/nori/settings`; schedule from below. |
| Apply now from Recommended | **Change** | `POST /api/nori/batches { recommended: true }`: the server picks the Recommended jobs itself (above threshold, in roles, not applied, not skipped), so the UI needn't send ids. |
| Schedule (autopilot) | **Missing** | `GET/PUT /api/nori/schedule { enabled, days: ["mon",…], time: "09:00", timezone, paused }`; the worker starts a batch of new Recommended jobs at that time, within the daily cap; a summary afterwards by Telegram or email. Blocked on product: the Terms/FAQ/landing rewrite and free vs Pro (plan, Nori). |

## 7. Career graph

| Need | Status | Notes |
|---|---|---|
| The graph, Add fact, Fix, Remove | Exists | `GET /api/graph`, `POST /api/graph/facts`, `PATCH/DELETE /api/graph/nodes/:id` |
| Where each fact came from | **Change** | `node.source: { kind: "resume" \| "github" \| "site" \| "you", ref, label }` (resume line, repo, URL) on every node. |
| Sources the person connects or names | **Missing** | `GET/POST/DELETE /api/graph/sources` for a GitHub username or account, a personal site, a LinkedIn URL they paste. A worker job reads public repos (names, descriptions, languages, READMEs) and the site, and adds facts with their source. Never a search for the person by name. The Privacy policy needs a paragraph for it. |

## 8. Settings

| Need | Status | Notes |
|---|---|---|
| Account: email, password, devices, delete | Exists | `/api/auth/*` (change-password, sessions, account) |
| Theme | Exists | client side |
| Profile and form facts | Exists | `GET /api/me`, `PUT /api/profile` |
| Places, salary, companies to skip | Change | `PUT /api/profile` preferences; skip list merged with Nori's (Shared) |
| Gmail, Telegram | Exists | `/api/inbox/gmail*`, `/api/channels/telegram*` |

## Order the UI needs them

1. Shared threshold and skip list; `limit` on `/api/jobs`; `/api/applications/activity` (Overview).
2. `view=applied`, `job.pay`, `job.employmentType`/`workplace`, `job.company`, `/api/jobs/:id/preview` (Jobs).
3. `send: true` on Apply; `resumeId` on the application detail (Applications).
4. `node.source` and graph sources (Career graph).
5. The Nori chat, undo, `recommended: true` batches; the schedule last, after the wording and pricing are settled.
