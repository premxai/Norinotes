# Job collection: design and contract

Goal: a large, fresh, shared job index so a new user never sees an empty page. Collection is shared by all users;
there is no per-user web search.

## Principles

- One connector per job system (ATS), never per company. A company is only a tenant id on a system.
- Every company is verified against its live public feed before it is polled regularly.
- A job is closed only after it is missing from two consecutive complete reads. A board that answers "not found" goes
  on probation; its jobs close only after 3 days of not-found answers.
- Polite by default: our User-Agent, per-host concurrency limits, Retry-After respected, conditional requests (ETag)
  where supported. No residential proxies, no captcha or Cloudflare challenge solving, no logged-in endpoints, no
  LinkedIn/Indeed/Glassdoor scraping.

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
user, url, crawl), `status` (candidate, active, probation, disabled, dead), `last_polled_at`, `last_success_at`,
`next_poll_at`, `error_streak`, `not_found_since`, `last_job_count`, `new_jobs_7d`, `etag`, `priority`, `blocked`.

- New seeds start as `candidate`; a validation job reads the feed once: jobs found -> `active`; empty -> `active` with low
  priority; not found -> `dead`.
- 5 consecutive errors or 14 days at zero jobs -> `disabled`, rechecked weekly.
- `next_poll_at = now + clamp(24h / (1 + new_jobs_7d / 7), 1h, 48h)`, shortened for companies that fit many users'
  lanes (lane demand), and never sooner than the system's politeness allows.

Implementation notes (migration 0003, `packages/ingest/src/poll.ts`, `schedule.ts`):

- Extra columns: `host` (politeness group: Workday by wdN cluster, Oracle by tenant host, others by feed host), `status_reason`,
  `empty_since`, `boost_until` (a user is waiting on the company: it polls at priority 200 until then; the boost lapses by itself);
  `jobs.missing_reads` counts complete reads that missed a job (closed at 2, reset when seen).
- Priorities: curated registry 100, seeds 0, empty boards -10. `nextBoards` orders by effective priority, then `next_poll_at`
  (never polled first), at most `HOST_BOARDS_PER_RUN` per host group; the worker queues candidates (validation) on their own budget
  (`VALIDATE_PER_RUN`) and runs at most 2 (Workable), the connector's `maxConcurrencyPerHost` or `POLLS_PER_HOST` (4) polls per host group.
- A 401/403 from the host (`BlockedByHostError`) disables the board with a reason and no retries; it is rechecked weekly.
  Failed polls back off 30 min, 1 h, 2 h, 4 h, 6 h and count once per window.
- Workday list rows carry no text; `understand.job` fetches the posting (`fillJobDescription`) when the job fits a lane.
- Seeds: `npx tsx scripts/import-seeds.mts [--dry-run] [--only workday,oracle] [--include-empty] [--dir folder]`.

## Seeds (discovery without crawling, for now)

- `kalil0321/ats-scrapers` `ats-companies/*.csv` (MIT code; data licence to confirm before redistributing): Workday,
  Oracle, SmartRecruiters, Workable, iCIMS, BambooHR, Personio, Teamtailor, Rippling, Breezy, Recruitee, Greenhouse,
  Lever, Ashby and more.
- `veresk06/open-ats-feed` (MIT, data public domain): verified Greenhouse, Lever, Ashby, Breezy, Recruitee, Teamtailor
  boards.
- Excluded: `Riley-Dorrington/job-board-aggregator` data (CC BY-NC, non-commercial only).
- Seeds are imported by a script into `companies` as `candidate`; nothing is trusted until validated.
- Later: Common Crawl columnar index (Athena) discovery and a career-page scan for custom domains.

## Only the last 72 hours

Users are shown and matched only jobs posted in the last 72 hours (`MAX_JOB_AGE_HOURS` and `freshJobSql` in
packages/db/src/fresh.ts), everywhere: the shortlist, widening, role pools, the jobs list and summary, and the Telegram digest.
The age is the feed's posted date. For a job whose feed gives none, the time we first saw it stands in, but only if it
appeared on a later read than the board's first (`companies.first_read_at`): a first read finds everything already on the
board, of unknown age, so those undated jobs never count. Older jobs stay in the index (for closing and stats) but are not shown.
The one exception is a job the user added by pasting its link (`saved_jobs`): it always shows for that user, whatever its age
or lane fit.

## Never empty

1. Precomputed pools per (role family x metro or remote), refreshed hourly from the shared index.
2. When a user's lanes match fewer than 20 open jobs, widen step by step: adjacent titles, then remote, then the
   role-family pool. Age is never widened: every step keeps the 72-hour limit. Tell the user which widening was used.
3. On signup or a lane change, raise the priority of companies whose recent jobs fit the lanes and poll them first.
