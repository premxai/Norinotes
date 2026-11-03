# Norinote architecture

Norinote is a personal job agent: a daily shortlist of jobs you are likely to get, applied in about 20 seconds each, getting smarter from every reply. No job board to scroll.

This repo is a clean rebuild. It ports only the parts of Nori (the live repo at `C:\dev\nori`, branch `fix/jobs-page-quality`) that fit this design, and leaves hackathon code behind.

## Rules

- Cost per application stays under 2 cents. Click to sent in 30 seconds or less.
- No per-user web search. No scoring every job for every user.
- No captcha bypassing, no invented claims on resumes or forms.
- Every job is collected and understood once, then shared by all users.
- Everything a user will need for an application is prepared before they click.

## Layout

```
apps/
  api/        Hono HTTP API (Node). Auth, profile, graph, jobs, shortlist, applications, agent status.
  worker/     Background runtime: pg-boss consumers for ingest, understand, match, prepare, apply, inbox.
  web/        Current dashboard (Next.js), temporary. A teammate is building the new landing and dashboard; it will
              replace this app and talk to the same API.
packages/
  db/         Drizzle schema, migrations (Postgres 17 + pgvector), client. PGlite (with the vector extension) for tests.
  queue/      pg-boss wrapper: typed job names, enqueue, work, schedule. In-memory adapter for unit tests.
  ai/         Model routing (small model by default, large only where named), prompt caching, structured output,
              embeddings, per-user daily token budget, usage accounting.
  ingest/     Job-system connectors (Greenhouse, Lever, Ashby, SmartRecruiters; Workday and Oracle next), polite HTTP,
              board registry, blocklist, normalisation, dedupe, closing jobs that leave a feed.
  graph/      Resume to career graph: parse, structure career points (skills, depth, recency, scope, impact), embed.
  match/      Job spec extraction (once per job), shortlist: SQL lane filter -> vector rank -> detailed fit on about 200
              -> top few. Gates for citizenship, clearance, years, location, sponsorship.
  tailor/     Resume tailoring: evidence index, deterministic selection, gated rewrite of the top bullets and summary,
              critique and revise, one-page render to PDF, coverage report.
  answers/    Answer bank: profile defaults plus previously given answers, matched by meaning; batches new questions.
  apply/      Application state machine, per-system Playwright drivers, warm browser pool, AI fallback hook, receipts.
  inbox/      Owned inbound email: parse verification codes, confirmations, replies; link them to applications.
  shared/     Types and zod contracts shared by api, worker and web.
```

Package names are `@norinote/<name>`. TypeScript ESM, Node 22, npm workspaces, vitest, zod 4.

## Data model (packages/db)

Shared, written once:
- `companies` (ats_type, ats_token, name, last_polled_at, blocked)
- `jobs` (company_id, ats_type, external_id, title, location, remote, description_text, apply_url, posted_at, first_seen_at, last_seen_at, closed_at, dedupe_key)
- `job_specs` (job_id, version, spec jsonb: must_haves, nice_to_haves, skills with level and years, seniority, role_family, years_min, location rules, citizenship_required, clearance_required, sponsorship: yes/no/unknown, responsibilities; model, created_at)
- `job_embeddings` (job_id, embedding vector(1536))

Per user:
- `users`, `sessions`, `auth_tokens` (email verification, password reset)
- `profiles` (contact, location, work authorisation, salary expectation, start date, EEO defaults, preferences)
- `lanes` (user_id, name, titles[], locations[], remote, min_fit, enabled), one shared daily cap on the profile
- `career_points` (user_id, kind: role/project/achievement/education/skill, title, org, start, end, text, skills[], scope jsonb, metrics jsonb, source_quote) and `career_point_embeddings`
- `shortlist` (user_id, job_id, fit numeric, fit_map jsonb, reasons[], status: new/dismissed/applied, created_at)
- `applications` (user_id, job_id, status, resume_id, answers jsonb, pending_questions jsonb, receipt jsonb, error, attempts, prepared_at, approved_at, submitted_at)
- `resumes` (application_id, content jsonb, changes jsonb, pdf_path, pages, ats_checks jsonb)
- `answer_bank` (user_id, question_text, question_embedding, answer, source: default/user/model, last_used_at)
- `run_events` (application_id, ts, step, level, message, data)
- `inbox_addresses` (user_id, address) and `inbox_messages` (user_id, application_id, kind, code, from, subject, body, received_at)
- `channels` (user_id, kind: telegram, address)
- `llm_usage` (user_id, day, prompt_tokens, completion_tokens, cost_micros)
- `outcomes` (application_id, kind: reply/interview/rejection/offer, at)

## Queues (packages/queue, pg-boss)

| Job | Trigger | Does |
|---|---|---|
| `ingest.poll-board` | schedule, per board every 3 h, oldest first | fetch one board, upsert jobs, close missing ones, enqueue `understand` only for new jobs that fit an enabled lane of some user |
| `understand.job` | new job that fits a lane, or an unspecced job that fits a user's new lane (`match.user`) | extract `job_specs` with the small model, write `job_embeddings`; at most 4 at once (`UNDERSTAND_CONCURRENCY`). Without the AI service: a heuristic spec (version 0, `model: heuristic`), upgraded later |
| `match.new-jobs` | after `understand` batches | find users whose lanes and embeddings fit the new jobs; detailed fit; upsert `shortlist` |
| `match.user` | profile, graph or lanes change | queue `understand` for the user's unspecced lane-fitting jobs, then rebuild the shortlist from the stored index (jobs without an embedding are ranked by skill overlap) |
| `prepare.application` | job reaches the top of a shortlist, or user queues it | tailor resume, draft answers from the answer bank, mark prepared |
| `apply.run` | user click (counts as approval) or autopilot within the daily cap | fill and submit with the warm browser pool |
| `inbox.receive` | inbound email webhook | parse, store, link to the application, wake a waiting `apply.run` |

Per-host concurrency and rate limits live in the queue config. Workers are idempotent and retry with backoff.

## Matching (packages/match)

1. SQL filter: open, posted within 60 days, fits an enabled lane (title, location, remote), not blocked, gates pass.
2. Vector rank: cosine similarity between the user's profile embedding (mean of top career points) and `job_embeddings`, top about 200.
3. Detailed fit: requirement by requirement against career points (exact skill match, embedding similarity, graph links), weighted by the spec; must-haves cap the score.
   Then scaled by function alignment (title and role family against the lanes and recent roles), seniority against the user's
   years in that function, and place; capped for jobs without a description or with only a heuristic spec. Scale: 0.8+ strong,
   0.6 to 0.8 plausible (the default lane minimum is 0.6), 0.45 to 0.6 stretch (the widening floor), under 0.3 irrelevant.
   Gates also drop remote jobs limited to countries or regions the user cannot work in. Order: lane matches, then widened
   rows; well-specified jobs first, then fit x confidence plus a small recency bonus.
4. Model only on the top few: a short "why this fits" line and the fit map used by tailoring.

## Tailoring (packages/tailor)

Goal: the resume matches the posting as strongly as the person's real experience allows. Rewrite and reframe only; never add
a skill, tool, employer, number, scope or seniority. A must-have the person lacks is reported as a gap, not filled.
Details in docs/tailoring.md.

1. Evidence index: every requirement (must-haves, nice-to-haves, listed skills) against the career points, through an alias
   table of about 290 terms (`aliases.ts`: K8s/Kubernetes, FP&A, EHR, BLS ...). Exact or alias match first; the fit map and
   embedding similarity only for descriptive requirements; soft ones (ownership, end-to-end, startup pace, stakeholder
   work) only where a point shows the behaviour. Each descriptive requirement keeps the posting's key phrase. No support is a gap.
2. Deterministic selection: bullets weighted by the requirements their own text supports (must-haves double); the latest
   and recent or relevant roles get 3 to 5 bullets, older ones 1 to 2; the latest role's first three bullets each lead
   with a different supported must-have; a role's best bullet is never cut. Skills: every
   skill the job names that the person really has, in the job's spelling, then the rest.
3. One large-model call (temperature 0.2, JSON) rewrites up to 6 bullets (the top role's, then the heaviest) and writes
   the summary; each bullet cites its source point and carries the posting's own key phrases where its source supports
   them. A deterministic gate checks every bullet (numbers, tools, employers, titles against the cited source; lacked
   requirements and phrases; tools newer than the role; length; banned phrases; repeated verbs; past tense; term overuse).
   The summary may state years only as the exact whole years in the target function (none below 2, never tied to a skill). Failures are retried once on the small model; failing twice reverts to the original.
4. Critique and revise, at most 2 rounds (small model): only coverage gaps or faithfulness fixes; stops when nothing is
   open, coverage stops improving, or after round 2.
5. One-page render; `resumes.ats_checks.tailoring` stores the report (coverage before and after, gaps, per-bullet source
   ids and gate results, rounds, cost). Without the AI service steps 3 and 4 are skipped and the selection stands.

Cost about 1 cent per resume (eval run 2: $0.0100 mean, $0.0139 max; docs/eval/tailor-run2.md).

## Applying (packages/apply)

- State machine: `queued -> preparing -> prepared -> applying -> awaiting_code -> submitted | needs_user | failed`.
- A user click on a prepared application approves and submits. Autopilot uses the same path within the daily cap.
- Drivers per job system (Greenhouse, Lever, Ashby first). A warm Playwright pool on the worker, 3 to 4 parallel pages.
- Unknown forms: a fallback hook for an AI browser agent (not wired tonight). Captcha or bot check: park as `needs_user`.
- Real submission only when `ALLOW_REAL_SUBMIT=true`; otherwise dry run that fills and stops before submit.

## API surface (apps/api)

Keeps the shapes the current web app uses for the core flows, so it keeps working until the new frontend lands:
`/api/health`, `/api/auth/*` (signup, login, logout, session, forgot/reset password, verify email, change password, sessions),
`/api/me`, `/api/profile` (PUT), `/api/profile/resume`, `/api/profile/resume-file`, `/api/onboarding` (GET, PUT),
`/api/graph` (GET), `/api/graph/facts` (POST), `/api/graph/nodes/:id` (DELETE), `/api/lanes` (GET, PUT),
`/api/jobs` (GET with view/sort/maxAgeDays/clearance), `/api/jobs/summary`, `/api/jobs/:id`, `/api/jobs/url` (POST),
`/api/shortlist` (GET, new), `/api/applications` (GET, POST), `/api/applications/:id` (GET) and its actions,
`/api/resumes/:id`, `/api/agent/status`, `/api/agent/activity`, `/api/inbox` (GET), `/api/channels/telegram*`,
`/api/auth/account` (DELETE).

Dropped on purpose: model settings and bring-your-own keys, Composio integrations, Google Sheets tracker sync,
per-user discovery (`/api/jobs/discover`), manual board polling, the desktop companion, MCP, WhatsApp and Slack.

## What is ported from Nori, and what is not

Ported (cleaned up, behind tests): job-system connectors, polite fetching, board registry with the early-career
additions, blocklist; resume parsing; tailoring rules and the one-page PDF template; Greenhouse, Lever and Ashby
drivers; the citizenship and clearance detector; auth and sessions; the application state ideas and run events.

Not ported: Parallel, Exa, Composio, Cline provider and bring-your-own-key, the companion app, MCP server, WhatsApp
and Slack, Google Sheets, social discovery, demo and hackathon scripts, `.clinerules`, the timer-and-lease scheduler,
scoring every job for every user, the 16 overlapping docs.

## Environment

`DATABASE_URL`, `OPENAI_API_KEY`, `AI_SMALL_MODEL` (default gpt-4.1-mini), `AI_LARGE_MODEL` (default gpt-4.1),
`EMBEDDING_MODEL` (default text-embedding-3-small), `ALLOW_REAL_SUBMIT`, `INBOUND_EMAIL_DOMAIN`,
`INBOUND_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `WEB_URL`, `API_URL`, `SESSION_SECRET`.
Hosting decisions (Vercel, Neon, Fly region) are made tomorrow; nothing here assumes a provider beyond Postgres.

## Quality gate

`npm run gate`: typecheck, unit tests (PGlite with pgvector), lint, web build. Every package has tests next to its
code. No secrets in the repo; `.env.example` lists every variable.
