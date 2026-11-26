# Job collection: design and contract

Goal: a large, fresh, shared job index so a new user never sees an empty page. Collection is shared by all users;
there is no per-user web search.

## Principles

- One connector per job system (ATS), never per company. A company is only a tenant id on a system.
- Every company is verified against its live public feed before it is polled regularly.
- A job is closed only after it is missing from two consecutive complete reads. A board that answers "not found" goes
  on probation; its jobs close only after 3 days of not-found answers.
- Polite by default: our User-Agent, robots.txt obeyed on every request, per-host concurrency limits, Retry-After
  respected, conditional requests (ETag) where supported. No residential proxies, no captcha or Cloudflare challenge solving, no logged-in endpoints, no
  LinkedIn/Indeed/Glassdoor scraping.

## Live and parked job systems

- Live (`SUPPORTED_ATS_TYPES`): Greenhouse, Lever, Ashby, Workday, Workable, Rippling. A connector test pins this set.
- Parked (`ready: false`, code kept): SmartRecruiters, iCIMS, Oracle Cloud, Recruitee, Teamtailor, Personio, BambooHR,
  Breezy, Pinpoint. A parked system's boards are never polled (`nextBoards`), seeded (`importSeeds`, and its seed CSV is
  not downloaded), or added from a pasted link (`addJobByUrl`). To bring one back, set its connector's `ready` to true.
- SmartRecruiters stays parked whatever we decide about the others: its robots.txt disallows every path for our
  User-Agent, so it has no registry entries either.

## Turning Lever on in production

Lever's connector and form driver are ready, but production reads and sends only Greenhouse: `fly.api.toml` and
`fly.worker.toml` both set `ENGINE_ATS = "greenhouse"`. Turning Lever on is the maintainer's job. It needs no new
secret, no migration and no model key.

1. Set `ENGINE_ATS = "greenhouse,lever"` in the `[env]` of **both** `fly.api.toml` and `fly.worker.toml`, then
   redeploy both apps. On the worker, this setting decides which boards are polled, read, matched and caught up. On the
   API, it decides which jobs the lists and counts show, and whether "Add a company" says a Lever board is read now. Keep
   the two values the same. Otherwise people see jobs the worker never matches, or the worker matches jobs nobody sees.
2. `BATCH_ATS` (on both apps) gates "Apply for me" batches, chat batches and autopilot schedules. It does not gate
   Apply on a single job. Leave it at `"greenhouse"` until the first one-click Lever applications have been watched
   from start to finish. Then set it to `"greenhouse,lever"` on both apps.
3. Boards: the worker seeds the 20 Lever boards in `BOARD_REGISTRY` every time it starts. For more boards, run
   `npx tsx scripts/import-seeds.mts --only lever --dry-run` and then the same command without `--dry-run`, against the
   production database. They come in as `candidate` rows and are checked on their first poll (`VALIDATE_PER_RUN`).
4. Nothing else needs to change. `HOST_BOARDS_PER_RUN` is a cap per host, so `api.lever.co` gets its own budget
   alongside Greenhouse's. The request helpers (http.ts) obey robots.txt and Lever's `Crawl-delay: 1`. Lever has no form
   API, so prepare reads each Lever form in the browser pool (`BROWSER_POOL_SIZE`) as well as filling it at the click.

What to expect, from a dry run on 2026-11-26 of 34 fresh US postings at 21 companies, using `scripts/eval/lever-targets.mts`
and `scripts/eval/lever-live.mts` with the fictional applicant, no model key and no submission:

- Every form was read.
- 70% of required fields were filled from the profile.
- Every other required field went to the person as a pending question with its real label. These are factual, legal,
  consent and custom questions that Norinote never drafts.
- 8 of the 34 forms needed nothing from the person.

Lever pages load an invisible hCaptcha. No challenge appeared while filling, but one can appear at submit. When it
does, the application parks as `ready_to_finish` and the person solves it in the live view. No real Lever submission
has been sent yet, so watch the first ones. Lever's feed dates jobs by `createdAt`, which can be earlier than the
posting date, so a few fresh Lever jobs leave the 7-day window early.

## Connector contract (`packages/ingest/src/types.ts`)

- `Connector { atsType, ready?, capabilities?, listJobs(token, http?, { etag? }), fetchJob?, parseUrl }`.
- New connectors return `ListResult { jobs, complete, notFound?, notModified?, etag? }`. Set `complete: false` whenever
  any page failed or a result cap could not be fully split. Set `notFound: true` when the board does not exist.
  Throw for retryable failures (429, 5xx, timeouts) so the queue retries.
- Each system has its own file in `packages/ingest/src/connectors/` (placeholders use `placeholder()` with
  `ready: false`). `SUPPORTED_ATS_TYPES` is derived from `ready`.
- Token formats:
  - greenhouse, lever, ashby, workable, recruitee, teamtailor, personio, bamboohr, breezy, rippling, pinpoint:
    the tenant slug.
  - smartrecruiters: the company identifier.
  - workday: `tenant|wdN|site` (for example `nvidia|wd5|NVIDIAExternalCareerSite`). Tenant is case-sensitive.
  - oracle: `host|region|siteNumber` (for example `ehtf|us2|CX_1`), from `https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{siteNumber}`.
  - icims: the portal subdomain from `careers-{slug}.icims.com`.

## Endpoints (verified by research on 2026-11-02)

| System | Request | Notes |
|---|---|---|
| Workday | `POST https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}`; detail `GET /wday/cxs/{tenant}/{site}{externalPath}` | `limit` max 20; `total` capped at 2,000 and only reliable on page 1; offsets can wrap. Split large tenants by facets in `appliedFacets` (jobFamilyGroup, locations, timeType, workerSubType; recursion depth up to 4). About 10 concurrent requests per host at most. A wrong wdN returns 422; some tenants answer 401/403 to servers: skip them. |
| Oracle | `GET https://{host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.workLocation,requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=200,offset={n},sortBy=POSTING_DATES_DESC`; detail `recruitingCEJobRequisitionDetails?finder=ById;Id="{id}",siteNumber={site}` | Without `expand` the requisition list is empty. `TotalJobsCount` in `items[0]`. Field names vary by version. |
| SmartRecruiters | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=n` | 10 requests/second documented. |
| Workable | `GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | Strict: 429 above 2 to 4 concurrent. |
| Recruitee | `GET https://{slug}.recruitee.com/api/offers/` | One response with descriptions. |
| Teamtailor | `GET https://{slug}.teamtailor.com/jobs.rss` | Documented public RSS. |
| Personio | `GET https://{slug}.jobs.personio.de/xml` (also `.com`) | XML. |
| BambooHR | `GET https://{slug}.bamboohr.com/careers/list` (JSON), fall back to `/jobs/embed2.php` (now JSON `departments[].positions[]` on most tenants, legacy HTML on some) | A redirect to www.bamboohr.com means no tenant. |
| Breezy | `GET https://{slug}.breezy.hr/json` | A 404 or a redirect to breezy.hr means no tenant. Sends ETag. |
| Rippling | `GET https://api.rippling.com/platform/api/ats/v1/board/{slug}/jobs` | Public JSON. The `ats.rippling.com` host answers an HTML 404. |
| Pinpoint | `GET https://{slug}.pinpointhq.com/postings.json` | Public JSON. Sends ETag. |
| iCIMS | `GET https://careers-{slug}.icims.com/jobs/search?ss=1&pr={page}&in_iframe=1` (HTML) plus `JobPosting` JSON-LD on each job page | HTML only, bot protection on some portals: low concurrency, skip on 403. |

Greenhouse, Lever, Ashby, Teamtailor, Personio, Pinpoint and Breezy support ETag / If-None-Match (304). Personio's XML
carries full descriptions; Workday list rows carry none (filled by `fetchJob` for jobs that matter).

## Company registry (`companies` table)

Columns: `ats_type`, `ats_token`, `name`, `domain`, `discovered_via` (registry, seed:ats-scrapers, seed:open-ats-feed,
user, url, crawl, or the discovery source that promoted it), `status` (candidate, active, probation, disabled, dead), `last_polled_at`, `last_success_at`,
`next_poll_at`, `error_streak`, `not_found_since`, `last_job_count`, `new_jobs_7d`, `etag`, `priority`, `blocked`.

- New seeds start as `candidate`; a validation job reads the feed once: jobs found -> `active`; empty -> `active` with low
  priority; not found -> `dead`.
- 5 consecutive errors or 14 days at zero jobs -> `disabled`, rechecked weekly.
- `next_poll_at`: see Polling cadence below.

## Polling cadence

Early applicants get far more interviews, so the boards where people's jobs appear are read most often
(`pollIntervalMs` in packages/ingest/src/schedule.ts, lane demand in apps/worker/src/demand.ts):

| Board | Read again after |
|---|---|
| Its recent jobs fit some user's enabled lane, and it posted at least 3 jobs that fit a lane in the last 7 days | about 1 hour |
| Its recent jobs fit some user's enabled lane (quiet: fewer than 3 such jobs in 7 days) | about 3 hours |
| Nobody's lanes fit it | `clamp(24h / (1 + new_jobs_7d / 7), 1h, 48h)` |

- Lane demand is worked out just before each poll: the enabled lanes (of any user, read once per 5 minutes) whose
  titles match one of the board's 100 most recent open job titles, and how many of the board's jobs from the last
  7 days (posted, or first seen) match a lane title. A busy board is never read less often because of demand.
- Politeness stays first. No board is read sooner than its job system allows (Workday, Oracle and iCIMS 6 h, Workable
  3 h, SmartRecruiters 2 h, the rest 30 minutes), whatever its demand. Per-host limits (`HOST_BOARDS_PER_RUN`,
  `POLLS_PER_HOST`, Workable 2), robots.txt and Crawl-delay (http.ts), Retry-After and the host back-off apply to every
  read. Greenhouse, Lever, Ashby, Breezy, Pinpoint, Teamtailor and Personio are read with If-None-Match, so an hourly
  read of an unchanged board is a 304 with no body.
- A user waiting on a company (signup, a lane change) still boosts it for 24 hours (`boost_until`), which puts it first
  in the queue.
- Each `ingest.poll-board` log line carries `demand`, `matching7d` and `nextPollMinutes`.

Implementation notes (migration 0003, `packages/ingest/src/poll.ts`, `schedule.ts`):

- Extra columns: `host` (politeness group: Workday by wdN cluster, Oracle by tenant host, others by feed host), `status_reason`,
  `empty_since`, `boost_until` (a user is waiting on the company: it polls at priority 200 until then; the boost lapses by itself);
  `jobs.missing_reads` counts complete reads that missed a job (closed at 2, reset when seen).
- Priorities: curated registry 100, boards promoted by discovery 50, seeds 0, empty boards -10. `nextBoards` orders by effective priority, then `next_poll_at`
  (never polled first), at most `HOST_BOARDS_PER_RUN` per host group; the worker queues candidates (validation) on their own budget
  (`VALIDATE_PER_RUN`) and runs at most 2 (Workable), the connector's `maxConcurrencyPerHost` or `POLLS_PER_HOST` (4) polls per host group.
- A 401/403 from the host (`BlockedByHostError`) disables the board with a reason and no retries; it is rechecked weekly.
- robots.txt (packages/ingest/src/robots.ts, enforced in http.ts for every feed request): read once per origin and kept 6 h,
  for our User-Agent's group, else `*`. A disallowed path is never fetched: `RobotsDisallowedError` disables the board
  ("disallowed by robots.txt", rechecked weekly). Crawl-delay spaces requests to the origin; one over 60 s counts as
  disallowed. A robots.txt that answers 4xx or HTML allows everything; 5xx or a timeout is a retryable failure and
  nothing is fetched from that origin meanwhile.
  Failed polls back off 30 min, 1 h, 2 h, 4 h, 6 h and count once per window.
- Workday list rows carry no text; `understand.job` fetches the posting (`fillJobDescription`) when the job fits a lane.
- Seeds: `npx tsx scripts/import-seeds.mts [--dry-run] [--only workday,oracle] [--include-empty] [--dir folder]`.

## Companies people ask for (`discoverCompany`, POST `/api/companies`)

A person names a company, by name or by link, and Nori adds its public job board to `companies` for everyone
(`packages/ingest/src/discover.ts`).

- Systems: Greenhouse, Ashby, Lever, Workable, Rippling and Workday (`DISCOVERY_SYSTEMS`, minus any parked connector).
- A board link is used as it is. Any other link is read as the company's careers page: one GET per hop (SSRF guard,
  robots.txt obeyed, 1 MB at most) and the board links in it (hrefs, iframes, scripts, URLs in inline JSON) are the
  candidates. A page that redirects to a board names it, and the board page itself is not requested.
- A name is first matched against the registry (case, punctuation and a legal suffix ignored). Otherwise the tokens the
  name is likely to use (`tokensForName`: "Acme Robotics" gives acmerobotics, acme-robotics) are tried on each
  system's public feed in order. Workday needs a link (its tenant, cluster and site can't be guessed). Nothing searches
  the web, and no person is ever looked up.
- Dedupe: every candidate is matched against `companies` (system and token, case-insensitive) before any feed request.
- Verification: the candidate's feed is read through its connector, the same read the poller makes, cut short after
  `MAX_VERIFY_REQUESTS` (12) requests. The board must answer; a board guessed from a name must also list open jobs, so an
  unrelated empty board with the same token isn't added. robots.txt applies to every request (http.ts).
- LinkedIn, Indeed and Glassdoor are refused before any request, and never fetched even when a careers page links to
  them. Blocked aggregators (`blocklist.ts`) are refused.
- A new row is `active`, `discovered_via = 'user'`, default priority, and is polled on the next scheduler tick if its
  system is in `ENGINE_ATS`. Who asked is not stored.
- The API allows 10 requests per person per hour.

## Board discovery (`packages/ingest/src/discovery/`)

Discovery finds boards on allowed systems (Greenhouse, Lever, Ashby, Workable, Rippling: `DISCOVERY_ATS`) and keeps
them in `board_candidates`, apart from `companies`, so the poller never reads a board nobody has verified.

Candidate sources (`CandidateSource` in sources.ts: an id, a licence, `disabledReason`, `list`):

| Source | What | Licence |
|---|---|---|
| `user` | Boards people added (POST /api/companies). Already live; listed so they are scored too, never demoted. | people's own additions |
| `seed:open-ats-feed` | `veresk06/open-ats-feed` `actor/data/companies.json`, verified live boards. | MIT code, data public domain |
| `seed:ats-directory` | `moonie0201/ats-directory` `companies.jsonl`, rows a live probe confirmed (`ok`), US host only. | CC0 1.0 |
| `seed:ats-company-slugs` | `datakit457/ats-company-slugs` `data/boards.csv`, rows with `board_ok`. | CC0 (README) |
| `seed:open-jobs` | `elliottdehn/open-jobs` `slugs.json`, boards its crawler runs (not those marked gone). | CC0 1.0 |
| `seed:ats-scrapers` | `kalil0321/ats-scrapers` `ats-companies/{system}.csv`. | MIT (repository licence) |
| `aggregator:treg` | Paid aggregator (Treg/MobiusEngine). A stub: off without `TREG_API_KEY`, and not built until Prem decides on paid sources. | paid |

Excluded: `Riley-Dorrington/job-board-aggregator` (CC BY-NC), lists with no licence, Common Crawl (its terms), and
parked systems.

- `npx tsx scripts/discover-boards.mts load [--dry-run]` lists every enabled source into `board_candidates` (status
  `new`). A board listed by several sources is stored once (case-insensitive) with every source's id; a board already
  live in `companies` is stored as `promoted` and linked. Blocklisted boards are skipped.
- Verification (`verifyCandidates`, discovery/verify.ts): each due candidate's feed is read once through its connector, the
  same read the poller makes (robots.txt and Crawl-delay obeyed in http.ts), one board at a time per feed host with a
  1 s gap; a host that keeps answering 429/503 is left alone for the rest of the run. The board is scored on its open US
  jobs (`isUsPlace`) dated in the last 7 days whose title is in a target role family (`targetFamilyOf` in
  packages/match: ai_ml, data, product, software, design). Undated jobs never count.
- Promotion: a score of at least `PROMOTE_BAR` (2) puts the board into `companies` as `active` with
  `discovered_via` = the first source that listed it and priority 50 (`PRIORITY.discovered`, between seeds and the
  curated registry). From then on the poller reads it at the adaptive cadence above. Below the bar the board is
  `low_value` (or `empty`); a missing board is `dead`; robots.txt or a 401/403 makes it `disallowed`. Statuses and
  re-verification times are in docs/state-machines.md.
- A verified board reaches the poller two ways. Immediately, promotion writes it into `companies` (`discovered_via` = its
  source). Permanently, `npx tsx scripts/discover-boards.mts export` rewrites
  `packages/ingest/src/board-registry-discovered.ts` with every board verification promoted, and `BOARD_REGISTRY`
  includes that list next to the curated registry, so a fresh database (and `seedCompanies`) knows the boards without a
  discovery run. The file records the counts each entry was kept on.
- `npx tsx scripts/discover-boards.mts verify [--systems greenhouse,lever] [--all]` verifies locally;
  `npx tsx scripts/discover-boards.mts report` prints candidates found, verified, promoted, and fresh US target-role
  jobs per family before (registry and people's additions) and after.
- In production the worker verifies `DISCOVERY_BATCH` (30) due candidates of the engine scope (`ENGINE_ATS`) every
  `DISCOVERY_EVERY_MINUTES`. Off by default: load candidates first (`discover-boards.mts load` against the
  production database, which is the maintainer's call), then set e.g. `DISCOVERY_EVERY_MINUTES=10`.
- The old path, `npx tsx scripts/import-seeds.mts [--dry-run] [--only workday,oracle] [--include-empty] [--dir folder]`,
  still imports seed rows straight into `companies` as `candidate` (the first poll validates them); it is the only
  way to seed Workday and Oracle tenants.

## US jobs only

Norinote shows US jobs only for now. Each job records whether it is in the US (`jobs.us`), decided when it is written
(`upsertJobs`) by `isUsPlace` (packages/shared/src/location.ts, the same location parser the matcher's gates use): a place
that names the US is in, one that names only other countries or regions ("London, UK", "Remote - Philippines", "EMEA")
is out, and one that names no place ("Remote", "2 Locations", no text) is in. `freshJobSql` requires `jobs.us`, so a job
outside the US reaches nobody: not the shortlist, the role pools, the jobs list and search, the location list, the
summary or the Telegram digest. It is stored without its description like any job that is not fresh, and it is never
understood (no model call). Rows written before the column existed count as US until their board is read again. The one
exception is the same as for age: a job the user added by pasting its link.

## Only the last 7 days

Users are shown and matched only jobs posted in the last 7 days (`MAX_JOB_AGE_HOURS`, the one place the window is set, and `freshJobSql` in
packages/db/src/fresh.ts), everywhere: the shortlist, widening, role pools, the jobs list and summary, and the Telegram digest. Within the window, newer jobs get a small ranking bonus (`RECENCY_HOURS` in packages/match/src/shortlist.ts).
The age is the feed's posted date. For a job whose feed gives none, the time we first saw it stands in, but only if it
appeared on a later read than the board's first (`companies.first_read_at`): a first read finds everything already on the
board, of unknown age, so those undated jobs never count. Older jobs stay in the index (for closing and stats) but are not shown.
The one exception is a job the user added by pasting its link (`saved_jobs`): it always shows for that user, whatever its age
or lane fit.

## Lean storage

A full collection is about 1.3M open jobs, and almost all of their size is `description_text`. A job nobody can be shown
needs only its small row, so the collector still knows it has seen it. Job rows are never deleted (an undated job inserted
again would count as new).

- At write time (`upsertJobs`, packages/ingest/src/store.ts): a job that is not fresh when written (posted more than 7
  days ago, or undated and listed on the board's first read; `isFreshJob` in packages/db/src/fresh.ts mirrors
  `freshJobSql`) is stored without its description. A known job that is not fresh keeps whatever text it has, so later
  polls neither refill a trimmed job nor wipe one a user needs. Such jobs are never queued for understanding: the worker
  only queues new jobs that are fresh and fit a lane.
- The sweep (`sweepStaleJobs`, packages/ingest/src/sweep.ts; worker, every `JOB_SWEEP_EVERY_MINUTES`, default 60): jobs out
  of the window by more than 6 hours that no user refers to get an empty description and lose their `job_specs` and
  `job_embeddings` rows. A user refers to a job when it is in their `saved_jobs`, `applications` or `shortlist` (any
  status); those keep everything. Batches of `JOB_SWEEP_BATCH` (500), one short transaction each that skips rows a poll is
  writing, at most 200 batches per run; idempotent; one `jobs.sweep` log line with the counts.
- Reading the text again: a pasted link (`addJobByUrl`) stores the posting's text whatever its age. Before preparing an
  application the worker reads the posting again when the job has no text (`fillJobDescription`, any job system with a
  single-posting read) and understands it when it has no spec, so tailoring and answers have the job to work from.
- Freed space is reused by Postgres, but the table file does not shrink by itself. After the first sweep of a large
  existing database, run `VACUUM FULL jobs` once (it locks the table) to give the space back.

## Company logos

Job cards show the company's logo from Brandfetch's Logo API, which looks logos up by web domain. Seeds know almost no
domains, so the worker finds them in our own postings (`resolveLogoDomains`, packages/ingest/src/logo-domain.ts; every
`LOGO_DOMAINS_EVERY_MINUTES`, default 15, `LOGO_DOMAINS_BATCH` companies a run, shortlisted companies first):

- Candidates are the apply link's host, addresses in the text (accommodations@acme.com) and domains written in it
  (acme.com/careers). One counts only when its label spells the company's name (acme.com, getacme.io, acmehq.com for
  "Acme, Inc."), so job systems, mail providers and other companies never match. Apply links weigh most.
- The result goes to `companies.logo_domain`, which is display only. `companies.domain` stays for domains a seed knows
  exactly, because the inbox trusts mail from it.
- Only companies with fresh jobs are searched; one with no match is searched again after 7 days.
- On the collection of 2026-11-03, about 1 in 5 visible companies got a domain. The rest show a letter tile.
- Nothing from Brandfetch is stored: its terms allow only live lookups and `<img>` embedding. The API builds
  `companyLogoUrl` from the domain and the public `BRANDFETCH_CLIENT_ID`; the browser loads it.

## Never empty

1. Precomputed pools per (role family x metro or remote), refreshed hourly from the shared index.
2. When a user's lanes match fewer than 20 open jobs, widen step by step: adjacent titles, then remote, then the
   role-family pool. Age is never widened: every step keeps the 7-day limit. Tell the user which widening was used.
3. On signup or a lane change, raise the priority of companies whose recent jobs fit the lanes and poll them first.
