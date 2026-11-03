# Outcomes loop

What happened to each application, recorded honestly, and used carefully: per-user stats, a small per-user nudge to
matching, a measurable view of tailoring, and a product-level report. Code: `packages/match/src/outcomes.ts` (recording,
history, summary), `packages/match/src/outcome-learning.ts` (the nudge), `apps/api/src/routes/outcomes.ts`,
`scripts/outcomes-report.mts`. Migration `0006_outcomes_loop`.

## Recording

| What happened | Where it comes from | Stored as |
|---|---|---|
| recruiter reply, interview/scheduling, rejection, offer | a classified inbox message linked to a submitted application, not spam, from the company or its job system (`meta.trusted`) | `outcomes` row: application_id, kind (`reply`, `interview`, `rejection`, `offer`), at = arrival time, source `inbox`, message_id |
| the same, arriving at the user's own mailbox | the user: `POST /api/applications/:id/outcomes` | `outcomes` row, source `manual` |
| confirmation of receipt | a linked, trusted `confirmation` message | `applications.confirmed_at` and `receipt.confirmation` (not an outcome) |
| no response | 30 days after submission with no active outcome | derived on read, never stored |

- **Idempotent.** `syncInboxOutcomes` writes at most one row per message (unique `message_id`). The inbox package already
  writes one row per application and kind when the mail arrives (without a message id); the sync gives that row its message
  id instead of adding a second. A message the model later settles as another kind moves its row; one settled as not an
  outcome drops it. Unlinked, spam and untrusted messages, and applications never submitted, are ignored.
- **When it runs.** On every read that needs it (`GET /api/applications/:id/outcomes`, `GET /api/outcomes/summary`) and
  before the nudge is recomputed. It is a few indexed queries, so no daily job is needed and the worker is unchanged.
- **Corrections.** `DELETE /api/applications/:id/outcomes/:outcomeId` (or `?kind=rejection` for every active row of a kind)
  sets `deleted_at`; the row stays so re-reading its message never brings it back. The inbox package's own check ("already
  recorded for this application and kind") sees the kept row too. Then add the right one with POST.
- **Manual add.** `{ kind, at? }` (ISO time, default now, not in the future). An active outcome of the same kind is returned
  (200) instead of a second one; a new one answers 201. The application must be submitted (409 otherwise). Every route
  checks ownership: another user's application is a 404.

## Summary: `GET /api/outcomes/summary`

For the signed-in user only. `overall`, then `bySystem`, `byRoleFamily` (from the title, the same classifier matching uses),
`byFitBand` and `byResume`; each group has:

`applications` (submitted), `settled` (an outcome or 30 days of silence), `pending`, `responses` (any outcome; a rejection
is a response), `interviews` (interview or offer), `rejections`, `offers`, `noResponse`, `responseRate`, `interviewRate`,
`rejectionRate` (over settled applications, so recent ones do not drag rates down), `medianDaysToFirstReply`, `smallSample`.

- **Small samples.** Under 5 settled applications a group shows counts only: every rate is `null` and `smallSample` is true.
  The median needs 5 replies. `minSample` and `noResponseDays` are in the response.
- **Fit bands.** `0.8+`, `0.6-0.8`, `widened` (rows the widening ladder added), plus `under 0.6` and `unranked` (never on the
  shortlist, e.g. a pasted job URL). The band uses the raw fit: an outcome nudge is subtracted again, read from its reason.
- **Resume.** `off` (no tailoring report), `v1` (tailoring report version 1 with model rewrites), `v1-selection` (selection
  only; the model was unavailable). Recorded once per submitted application in `applications.tailoring_version`, so later
  edits to a resume do not rewrite history. No automatic tailoring change is made from this yet.
- `learning`: whether the nudge is active, how many resolved applications it has (`needed`: 10) and its current nudges.

## Learning: the outcome nudge

A per-user adjustment that is small, explainable and conservative.

- **Minimum sample.** Only after 10 resolved applications (an outcome, or 30 days of silence) submitted within the last year.
- **Signal.** Positive: a reply, interview or offer. Against: a rejection (weight 1) or silence (weight 0.5). Every
  application is weighted by age (half-life 90 days); older than 365 days is ignored.
- **Dimensions.** Role family and seniority (the spec's, else from the title), job system, and board size (open postings on
  the company's board at its last poll: small under 25, mid-size under 200, large; the only company size signal we have).
- **Per value** with at least 3 resolved applications: a smoothed positive rate (2 pseudo-applications at the user's own
  overall rate) minus the overall rate, times 0.1, capped at +/-0.02. Values within 0.005 of zero are dropped. With no
  positive (or no negative) signal at all there is no contrast and no nudge.
- **Per job** the matching values add up, capped at +/-0.05, rounded to 0.01.
- **Where it applies.** In `scoreCandidates` (shortlist.ts), after the gates and the lane minimum have seen the raw fit, so a
  nudge never admits a job those turned away and never overrides a gate. It moves the stored fit (and the ranking key) and
  adds a reason in second place, e.g. "From your replies: 5 of 6 data analysis applications led to a reply or interview,
  against 5 of 12 overall (+0.02 fit)". The reason carries the exact change, so the raw fit can always be recovered.
- **Storage.** `profiles.preferences.outcomeLearning` (version, computedAt, resolved, positive, active, nudges), written with
  `jsonb_set` so other preferences are untouched. Recomputed when older than 6 hours at the next shortlist build, and at
  once after a manual change or a summary read. A new nudge shows from the next shortlist rebuild. A failure in the
  nudge never fails a shortlist: the rows stay as scored.

## Product report

`npx tsx scripts/outcomes-report.mts [--since YYYY-MM-DD] [--json]` prints aggregate rates for all users by fit band, job
system, role family and resume version (same rules: settled denominator, counts only under 5). It is read-only: it does
not migrate or sync, so run `npm run db:migrate` first on an older database. `DATABASE_URL` selects Postgres, else the local
PGlite.

## Not done yet

- No automatic change to tailoring from outcomes; the summary only makes it measurable.
- Outcome kinds are the inbox's; a "withdrawn by me" or "position closed" outcome would be a new kind.
- Mail the user forwards from their own mailbox is not parsed; they add those outcomes by hand.
