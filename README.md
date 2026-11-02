# Norinote

A personal job agent: a daily shortlist of jobs you are likely to get, applied in about 20 seconds each, getting smarter from every reply. No job board to scroll.

Design and rules live in [ARCHITECTURE.md](ARCHITECTURE.md). Package conventions are in [docs/building.md](docs/building.md), and the endpoints the dashboard uses are in [docs/api-contract.md](docs/api-contract.md).

## Layout

- `apps/api`: HTTP API (Hono). `apps/worker`: background jobs on the queue. `apps/web`: the current dashboard (temporary; the new landing page and dashboard will replace it and use the same API).
- `packages/`: `db` (Postgres + pgvector, PGlite for local and tests), `queue` (pg-boss), `ai` (model routing, budget, fallbacks), `ingest` (job-system feeds), `graph` (resume to career points), `match` (job specs, shortlist), `tailor` (one-page resume), `answers` (answer bank), `apply` (form drivers, browser pool), `inbox` (owned email for codes and replies), `shared` (contracts).

## Run locally

Requires Node 22.12 or newer.

```
npm install
npx playwright install chromium   # once, for the form drivers and resume PDFs
cp .env.example .env              # optional: everything runs without it
npm run dev                       # API on :4000 and the worker in one process
npm run dev --workspace @norinote/web   # dashboard on :3000
```

With no `DATABASE_URL`, `npm run dev` uses an embedded PGlite database under `./data/pglite` and an in-memory queue, so nothing else needs installing. With a `DATABASE_URL` it uses Postgres and pg-boss; in production the API (`npm run dev:api`) and the worker (`npm run dev:worker`) run as separate processes against the same database.

With no valid `OPENAI_API_KEY`, resumes and job specs are read with rule-based parsing and matching ranks by skill overlap; set a real key for model-quality reading, tailoring and embeddings. Real form submission stays off unless `ALLOW_REAL_SUBMIT=true`.

## Checks

```
npm run gate     # typecheck, unit tests (PGlite with pgvector), lint, web build
```
