# Building norinote: conventions for contributors and agents

Read ARCHITECTURE.md first. This file records the exact foundation APIs so packages fit together.

## Ground rules

- One package per concern under `packages/`, named `@norinote/<name>`, TypeScript ESM, tests next to the code.
- A package owns its folder. Do not edit another package; if you need something from it, say so in your report.
- `packages/shared` and `packages/db` are the shared contracts. Changes to them go through the coordinator.
- No secrets, no network calls in tests, no paid APIs in tests. The AI fake provider is used automatically in tests.
- `npm run gate` must pass: typecheck, unit tests, lint.

## @norinote/shared

Zod schemas and types: `Job`, `JobSpec`, `CareerPoint`, `Lane`, `ShortlistItem`, `FitMapEntry`, `Application`,
`PendingQuestion`, `RunEvent`, `Answer`, plus const arrays such as `APPLICATION_STATUSES`. Optional fields are
`.nullable()`, never `.optional()`.

## @norinote/db

- Tables in camelCase (`jobs`, `jobSpecs`, `jobEmbeddings`, `companies`, `careerPoints`, `careerPointEmbeddings`,
  `shortlist`, `applications`, `resumes`, `answerBank`, `runEvents`, `inboxAddresses`, `inboxMessages`, `channels`,
  `llmUsage`, `outcomes`, `users`, `sessions`, `authTokens`, `profiles`, `lanes`).
- `Db`, `getDb()`, `closeDb()`, `connect({ url?, pgliteDir? })`, `migrate(handle)`, `queryRows(db, sql)`, and
  re-exports of drizzle helpers (`eq`, `and`, `sql`, `cosineDistance`, ...).
- Tests: `import { createTestDb } from "@norinote/db/testing"` gives `{ db, close }`, a fresh in-memory PGlite with
  pgvector per call.
- Notes: `applications.resume_id` has no foreign key (avoids a cycle). `career_points` uses `start_date`/`end_date`.
  `inbox_messages` uses `from_address`. `llm_usage` has `calls`. `llm_usage.user_id` references `users`, so create the
  user first in tests.

## @norinote/queue

- `JOBS`: `ingestPollBoard` = `ingest.poll-board`, `understandJob` = `understand.job`, `matchNewJobs` =
  `match.new-jobs`, `matchUser` = `match.user`, `prepareApplication` = `prepare.application`, `applyRun` =
  `apply.run`, `inboxReceive` = `inbox.receive`. Payload zod schemas in `payloadSchemas`; limits in `QUEUE_CONFIG`.
- `startQueue(connectionString | { connectionString?, adapter? })`, `stopQueue()`, `enqueue(name, payload, opts)`
  (`dedupeKey` + `dedupeSeconds` drop duplicates and return null), `work(name, handler(payload, { id, attempt }),
  { concurrency })`, `schedule(name, cron, payload)`.
- Without a connection string it uses `MemoryQueue` (`drain()`, `stats()`, `tickSchedules(date)` for tests).

## @norinote/ai

- `complete({ tier?, system, prefix?, input, schema?, schemaName?, strict?, userId?, db? })` returns
  `{ output, text, model, usage }`. Tier `small` (default) or `large`. Put stable context (instructions, the user's
  profile) in `system` and `prefix` so prompt caching works; the variable part goes in `input`.
- `embed(texts, { userId?, db? })` returns `number[][]` (1536 dimensions).
- Budget and accounting only when `userId` and `db` are passed (`AI_DAILY_TOKEN_BUDGET`, default 300000).
- Tests: the fake provider is used automatically; `createFakeProvider({ chat })` and `setProvider()` let a test script
  structured outputs; `fakeEmbedding(text)` is deterministic.

### When the AI service is unavailable

- `complete` and `embed` throw `AiUnavailableError` (`reason`: auth, rate_limit, server, network) for a 401/403, 429, 5xx or a
  connection failure, and refuse further calls for a cooldown (5 minutes after an auth error, 30 seconds otherwise) with one
  log line per cooldown, never the key. `BudgetExceededError` is separate and unchanged. `setProvider()` clears the cooldown.
- graph: `buildCareerPoints` and `addFact` fall back to the heuristic parser (`source: "heuristic"`, `aiUnavailable: true`) and
  save points unembedded; `embedCareerPoints` embeds them on the next run.
- match: `understandJob` stores a heuristic spec (`model: "heuristic"`, `HEURISTIC_SPEC_VERSION` 0, below `SPEC_VERSION`) and
  leaves the job unembedded; `buildShortlist` and `matchNewJobs` rank jobs with a spec but no embedding (and users with no
  embedded points) by skill overlap instead of cosine similarity.
- api: resume and fact routes answer 200 with a `note` instead of failing.
- worker: `understand.job` is queued on demand (a new job that fits some enabled lane; a lane change queues the user's backlog)
  and runs at most `UNDERSTAND_CONCURRENCY` (default 4) at a time.
