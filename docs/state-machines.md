# State machines

Every status in Norinote, where it lives, what moves it, and what recovers it when a process dies. Audited 16–17 Nov 2026.
Change a machine here first, then in code.

## Applications (`applications.status`)

`queued → preparing → prepared → applying → (awaiting_code →) submitted`, with `needs_user`, `ready_to_finish` and `failed` as exits.

- **One step left (`ready_to_finish`):** `applying → ready_to_finish` when the form is filled (every question answered) and
  a visible captcha or a sign-in page is all that is left, or when the submit click met a captcha challenge (receipt
  `captchaHeld`: the challenge held the form, so it was not sent). `ready_to_finish → applying` only for the person
  (`by: "user"`, approved), with a fresh set of attempts: Finish in the live view, or Retry. `ready_to_finish → failed` on
  Cancel. The worker never moves it on its own; Telegram groups these into "N applications need one tap".
- **Finish session** (`apply.finish`, `finishApplications`): up to 5 applications, one after another on one fresh browser
  context. Each moves `ready_to_finish → applying` when its turn comes, never earlier. While the person is at the wall the
  receipt holds `handoff`; afterwards the usual `applying` exits apply. A wall the person did not get past, or a run that
  broke, goes back to `ready_to_finish` (never a background retry: nobody would be there to take the step). The handoff
  wait (10 minutes) stays well inside `staleRuns`' 25 minutes.

- **One table of allowed moves:** `TRANSITIONS` in `packages/apply/src/state.ts`. Every write goes through `transitionApplication` (`packages/apply/src/store.ts`), guarded on the status it read.
- **Hidden state that changes behaviour:**
  - `attempts`: at most 3 browser tries. A browser retry counts; the person's own answer or Retry starts again at 1.
  - `approvedAt`: the person said send. Cleared on retry. Today's approvals count against the daily limit. Every approval (`approveAndSubmit`, `approveBeforePrepared`) counts and stamps inside one transaction that holds the user's row lock, so two at once cannot both take the last place.
  - `batchId`: the batch drain sends it when its spacing slot comes.
  - Receipt flags `submitClicked` / `awaitingCode` / `codeMissing` / `captchaHeld` decide whether a re-run could duplicate an application. `submitClicked` is written, and the write confirmed, before every submit click; no confirmed write, no click.
- **Recovery:** the worker's drain loop re-queues `preparing` / `applying` / `awaiting_code` rows untouched for 25 minutes (`staleRuns`). A row whose submit may already have been clicked is never re-sent; it goes to `needs_user`.
- **Who sends:** the prepare consumer sends approved applications (batch or not); the batch drain sends the batch's prepared, unapproved ones. The API's `sendsOnItsOwn` tells the UI which ones go out without another OK.

## Apply batches (`apply_batches.status`)

`running → done` (nothing left to send) or `→ stopped` (the person stopped it; final). The drain reopens `done` when a batch application comes back to send. A recommended batch started less than 60 s ago is reused, not duplicated, and is capped at what is left of today's limit.

## Jobs

- **Freshness:** `open` (`closed_at` null) → `closed` after two complete reads without it, or when the board is gone.
- **Reading:** none → version 0 (`heuristic`, the rule-based fallback while the AI is down) → version ≥ 1 (AI). The worker's catch-up pass (every 10 min, only while the AI answers) re-reads version-0 jobs and rebuilds their embedding. `GET /api/health/ai` returns 503 when nearly all jobs read in the last hour are version 0, or at once when no `OPENAI_API_KEY` is set. A missing key counts as the AI being down. The catch-up's first run in each worker process also repairs rows that the old no-key fake model wrote (specs with role family "fake", mostly-zero embeddings): those jobs go back to version 0, and the resumes are marked for re-reading (`apps/worker/src/repair-ai-stub.ts`).
- **Storage:** the sweep blanks the description and drops specs and embeddings of jobs that aged out.

## Boards (`companies.status`)

`candidate → active | dead`; `active → probation → dead` when a board disappears; `→ disabled` after repeated errors or 401/403. `blocked` is permanent. Polls outside the engine scope (`ENGINE_ATS`) are dropped. A back-off retry is kept to one per board per 5 minutes.

## Shortlist (`shortlist.status`)

`new → dismissed | applied`, never back. Creating any application marks the row `applied`. A full rebuild re-checks older `new` rows against the person's current roles, gates, skip list and minimum fit, and removes those that fail.

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
| 4 | A revoked Gmail connection makes a code wait call Composio every 5 s and fail. | `packages/inbox/src/gmail.ts` |
| 4 | "Show earlier messages" double-click duplicates chat messages. | `apps/landing/components/app/NoriV2.tsx` |
| 4 | A Telegram Apply on a job that has since closed still creates the application. | `apps/api/src/routes/applications.ts` |
| 3 | Changing the schedule while the scheduler writes `lastRunOn` can run a second batch that day. | `packages/apply/src/schedule.ts` |
| 3 | A double-click on the last onboarding step can create duplicate roles. | `apps/api/src/routes/onboarding.ts` |
| 3 | A failed onboarding load shows the error with no retry button. | `apps/landing` onboarding steps |
| 2 | A batch whose last item is an approved dry-run application can show `done` slightly early. | `apps/worker/src/consumers.ts` prepare consumer |
| — | Gmail connect passes no callback URL to Composio, so the person lands on Composio's page after approving. The dashboard now refreshes its Gmail status when they come back. Check whether Composio's link call accepts a callback. | `packages/inbox/src/gmail.ts` |
