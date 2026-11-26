# State machines

Every status in Norinote, where it lives, what moves it, and what recovers it when a process dies. Audited 16–17 Nov 2026.
Change a machine here first, then in code.

## Applications (`applications.status`)

`queued → preparing → prepared → applying → (awaiting_code →) submitted`, with `needs_user`, `ready_to_finish` and `failed` as exits.

- **One table of allowed moves:** `TRANSITIONS` in `packages/apply/src/state.ts`, below. Every write goes through
  `transitionApplication` (`packages/apply/src/store.ts`), guarded on the status it read; nothing sets a status directly.

| From | May move to |
|---|---|
| `queued` | `preparing`, `failed` |
| `preparing` | `prepared`, `needs_user`, `failed` |
| `prepared` | `applying`, `failed` |
| `applying` | `awaiting_code`, `submitted`, `needs_user`, `ready_to_finish`, `failed`, `prepared` |
| `awaiting_code` | `applying`, `submitted`, `needs_user`, `failed` |
| `needs_user` | `preparing`, `applying`, `failed` |
| `ready_to_finish` | `applying`, `failed` |
| `submitted` | — (final) |
| `failed` | `queued` |

- **What each move needs** (`checkTransition`): `preparing → prepared` needs a resume; `applying` needs
  `approvedAt` (the person's click, a batch's turn, or autopilot); `ready_to_finish → applying` only for the person
  (`by: "user"`, Finish or Retry); `failed → queued` only for the person (Retry), which clears the old approval;
  `needs_user → applying` and `needs_user → preparing` need every required question answered; `applying → prepared` only
  for a dry run (it resets the attempts); no move into `applying` while `submitMayHaveHappened` (the click was recorded
  and no code or captcha held the form), and none once the worker's 3 attempts are used up (the person's own answers and
  Retry start a fresh set).

- **One step left (`ready_to_finish`):** `applying → ready_to_finish` when the form is filled (every question answered) and
  a visible captcha or a sign-in page is all that is left (a bot-check page shown instead of the form, such as Cloudflare's
  "Performing security verification", counts as a captcha), or when the submit click met a captcha challenge (receipt
  `captchaHeld`: the challenge held the form, so it was not sent). `ready_to_finish → applying` only for the person
  (`by: "user"`, approved), with a fresh set of attempts: Finish in the live view, or Retry. `ready_to_finish → failed` on
  Cancel. The worker never moves it on its own; Telegram groups these into "N applications need one tap". A site that
  refuses the browser outright (Access Denied, 403) is `needs_user` with kind `blocked`, not `failed` and not one step left.
- **Finish session** (`apply.finish`, `finishApplications`): up to 5 applications, one after another on one fresh browser
  context. Each moves `ready_to_finish → applying` when its turn comes, never earlier. While the person is at the wall the
  receipt holds `handoff`; afterwards the usual `applying` exits apply. A wall the person did not get past, or a run that
  broke, goes back to `ready_to_finish` (never a background retry: nobody would be there to take the step). The handoff
  wait (10 minutes) stays well inside `staleRuns`' 25 minutes.

- **Hidden state that changes behaviour:**
  - `attempts`: at most 3 browser tries. A browser retry counts; the person's own answer or Retry starts again at 1.
  - `approvedAt`: the person said send. Cleared on retry. Today's approvals count against the daily limit. Every approval (`approveAndSubmit`, `approveBeforePrepared`) counts and stamps inside one transaction that holds the user's row lock, so two at once cannot both take the last place.
  - `batchId`: the batch drain sends it when its spacing slot comes.
  - Receipt flags `submitClicked` / `awaitingCode` / `codeMissing` / `captchaHeld` decide whether a re-run could duplicate an application. `submitClicked` is written, and the write confirmed, before every submit click; no confirmed write, no click.
- **A click nobody could confirm:** Nori clicked submit and the employer's answer never arrived (`receipt.submitClicked`).
  The worker will not send it again (the employer may have it) and will not call it sent (it may not), so Approve and
  Retry are refused and Cancel is too: the person answers it, and both answers are final. `needs_user | failed →
  submitted` by `markSent` (their word that it went out; receipt `markedSent`), or `clearSubmitClick` on `needs_user` /
  `failed`, which drops the mark (receipt `clickClearedAt`) so Retry may send it and Cancel is allowed again. Only the
  person (`by: "user"`); the worker never moves an application this way.
- **Closed job:** before `preparing` runs the preparer and before `applying` opens the browser, the worker re-reads the
  posting (`checkStillOpen`, run event `still_open` with `data.state` open, closed or unknown). Closed: `preparing → failed`
  or `applying → failed` with error "This job is no longer open: the company took the posting down." and the job's
  `closed_at` set. Unknown (network trouble) goes on. An open answer is trusted for 15 minutes. Retry works as for any
  failed application, and checks again.
- **Recovery:** the worker's drain loop re-queues `preparing` / `applying` / `awaiting_code` rows untouched for 25 minutes (`staleRuns`). A row whose submit may already have been clicked is never re-sent; it goes to `needs_user`.
- **Who sends:** the prepare consumer sends approved applications (batch or not), and, when the person's schedule is on and
  not paused, a strong fit Nori prepared ahead that the apply decision sends (`autopilotStrongFit` calls `decideApplies`
  with what is left of today's limit: action `send` only, within the weekly pace, no hard no, no company applied to in
  60 days, skip list, not a ghost job reposted 3 or more times in 60 days; `BATCH_ATS`; the daily limit counted atomically by `approveAndSubmit`). `ask`, `later` and `skip`
  leave it `prepared` for the person; the batch drain sends the batch's prepared, unapproved ones. The API's `sendsOnItsOwn` tells the UI which ones go out without another OK.

## Apply decision (`decideApplies`, no status of its own)

What Nori would do with a new match, recomputed from stored rows on every call and never stored itself
(`packages/match/src/decision.ts`, no model call). Each match gets a `group` and an `action`:

- Hard no's are `skip`: a failed gate (location and remote scope, authorisation and sponsorship, citizenship and
  clearance, a large years gap), a seniority gap of two levels or more either way, a central must-have the person clearly
  lacks, a skipped company, or a company applied to in the last 60 days.
- `strong`: every must-have evidenced, inside the person's level band, their own function, a posting the model read.
  `worth_a_shot`: most must-have weight evidenced, a title in or next to their function, posted under 48 hours ago.
  `stretch`: everything else that is not a hard no.
- `send`: the person's aggressiveness sends that group on its own (cautious: strong, 10 a week; balanced: strong and
  worth a shot, 20; wide: the same two, 30) and stays within the week's remaining pace, one per company, spread across
  kinds of jobs. `later`: it would, but the pace, today's limit or one-per-company holds it. `ask`: a one-tap prompt.
  A ghost job (reposted 3 or more times in 60 days) is at most `ask`.
- The same decision is what "Apply for me" (`recommendedJobIds`, packages/apply/src/batch.ts), the schedule and the
  strong-fit autopilot (`autopilotStrongFit`, packages/apply/src/strong-fit.ts) send, so a job Nori sends on its own is
  one the decision says `send`.

## Apply batches (`apply_batches.status`)

`running → done` (nothing left to send) or `→ stopped` (the person stopped it; final). The drain reopens `done` when a batch application comes back to send. A recommended batch started less than 60 s ago is reused, not duplicated, and is capped at what is left of today's limit.

**The one pause** (`profiles.preferences.noriPaused`, `packages/apply/src/pause.ts`): while it is set, `drainBatches` approves nothing (a running batch keeps its place and its view reads `waitingFor: "paused"`), `runSchedules` starts nothing and marks no day as run, `autopilotStrongFit` answers `paused`, `prepareStrongFitsAhead` and `actsForPerson` create nothing, and the prepare consumer holds an application the person approved before the pause, as does the auto-answer step. The person's own clicks, Finish and Cancel still work. The flag has its own key and the scheduler's `lastRunOn` write is guarded on it, so no scheduler or settings write can clear it.

## Jobs

- **Freshness window:** only a job posted in the last 7 days is shown or matched to anyone (`MAX_JOB_AGE_HOURS`, the one
  place the window is set, in `packages/db/src/fresh.ts`), and US jobs only for now. A newer job may rank higher; an older
  one is never listed. A job whose feed gives no posted date counts only when it appeared on a later read than the board's
  first. The 72-hour window of the first design is gone (Prem, 2026-11-25).
- **Lifecycle:** `open` (`closed_at` null) → `closed` after two complete reads without it, when the board is gone, or
  when the check before applying finds the posting gone (404/410, no longer listed, a "no longer accepting applications"
  page, or 403 twice). A board read that lists it again reopens it.
- **Reading:** none → version 0 (`heuristic`, the rule-based fallback while the AI is down) → version ≥ 1 (AI). The worker's catch-up pass (every 10 min, only while the AI answers) re-reads version-0 jobs and rebuilds their embedding. `GET /api/health/ai` returns 503 when nearly all jobs read in the last hour are version 0, or at once when no `OPENAI_API_KEY` is set. A missing key counts as the AI being down. The catch-up's first run in each worker process also repairs rows that the old no-key fake model wrote (specs with role family "fake", mostly-zero embeddings): those jobs go back to version 0, and the resumes are marked for re-reading (`apps/worker/src/repair-ai-stub.ts`).
- **Storage:** the sweep blanks the description and drops specs and embeddings of jobs that aged out.

## Boards (`companies.status`)

`candidate → active | dead`; `active → probation → dead` when a board disappears; `→ disabled` after repeated errors or 401/403. `blocked` is permanent. Polls outside the engine scope (`ENGINE_ATS`) are dropped. A back-off retry is kept to one per board per 5 minutes.

## Discovered boards (`board_candidates.status`)

`new → promoted | low_value | empty | dead | disallowed | failing` on verification (`verifyCandidates`,
packages/ingest/src/discovery/verify.ts). Promotion writes the board into `companies` (`active`, or brings back a
`candidate`/`dead`/`disabled` row that is not blocked). Every status is verified again later: promoted, low_value,
empty, disallowed and failing after 30 days, dead after 90; a failed read is retried after a day and becomes `failing`
on the third failure in a row. A low_value or empty board that reaches the bar later is promoted then. A promoted board
only gets fresh numbers: from then on the poller owns its `companies` row. A board already live when it is loaded
starts as `promoted`.

## Shortlist (`shortlist.status`)

`new → dismissed | applied`, never back. Creating any application marks the row `applied`, including one Nori creates to
prepare a new strong fit (0.8+) ahead for a person with the schedule or the Telegram strong-fit alert on (run event
`strong_fit`; never a hard no of the apply decision). Skip on that alert cancels the application (`failed`, "Cancelled by you").
A skip records `dismissed_at` and, when the person gives one, `skip_reason` (it can be added to a row already dismissed;
the status does not change). A full rebuild re-checks older `new` rows against the person's current roles, gates, skip
list and minimum fit, and removes those that fail.

## Telegram outbox (`channel_messages.status`)

`pending → sent | skipped | failed` (failed after 5 attempts). Rows are claimed atomically, so two workers never send the same one.

## Graph sources (`graph_sources.status`)

`pending → reading → done | failed`. Failed GitHub or site sources are tried again after a day, at most 3 times.

## Onboarding (`profiles.preferences.onboarding.step`)

`resume → contact → authorization → screening → preferences → done`. It only moves forward.

## Known issues, not fixed

Scored as how often (1–10) × how bad (1–10). Below 5: written down, code left alone.

| Score | Issue | Where |
|---|---|---|
| 4 | A drain pass between `startBatch` inserting the batch and linking its applications can mark it done and send a "0 sent" Telegram summary; the next pass reopens it. | `packages/apply/src/batch.ts` startBatch / drainBatches |
| 4 | Deleting a graph source while it is being read leaves the read's facts without a source. | `apps/api/src/routes/graph.ts`, `apps/worker/src/graph-sources.ts` |
| 4 | "Show earlier messages" double-click duplicates chat messages. | `apps/landing/components/app/NoriV2.tsx` |
| 4 | A Telegram Apply on a job that has since closed still creates the application. | `apps/api/src/routes/applications.ts` |
| 3 | Changing the schedule while the scheduler writes `lastRunOn` can run a second batch that day. | `packages/apply/src/schedule.ts` |
| 3 | A double-click on the last onboarding step can create duplicate roles. | `apps/api/src/routes/onboarding.ts` |
| 3 | A failed onboarding load shows the error with no retry button. | `apps/landing` onboarding steps |
| 2 | A batch whose last item is an approved dry-run application can show `done` slightly early. | `apps/worker/src/consumers.ts` prepare consumer |
| — | Gmail connect passes no callback URL to Composio, so the person lands on Composio's page after approving. The dashboard now refreshes its Gmail status when they come back. Check whether Composio's link call accepts a callback. | `packages/inbox/src/gmail.ts` |
