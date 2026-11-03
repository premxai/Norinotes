# Matching quality baseline

Generated 2026-11-03 02:00 UTC. 12 fictional profiles, top 20 of each shortlist judged by gpt-4.1 (rubric v1).
Jobs: a copy of the live collection (`norinote-eval2`), as of 2026-11-03. Per user the newest 250 lane-fitting jobs were understood with gpt-4.1-mini (embeddings: text-embedding-3-small). Reproduce with `npx tsx scripts/eval/run.mts`.

## Overall

| Metric | Value |
|---|---|
| P@10 (judge score >= 4, averaged over profiles) | 0.30 |
| P@20 | 0.20 |
| P@10 / P@20 if duplicate listings count as misses | 0.30 / 0.20 |
| nDCG@20 (gain = score - 1, ideal = same items re-sorted) | 0.94 |
| Mean judge score (per profile average / all 131 jobs) | 3.20 / 3.23 |
| Mean shortlist size | 10.92 |
| Duplicates (same company and title as a higher row) | 0 of 131 |
| Lane matches: count, mean score, hit rate | 18, 4.00, 67% |
| Widened rows: count, mean score, hit rate | 113, 3.11, 31% |
| OpenAI spend for the whole eval (cap $9.00) | $3.78 |

## Per profile

| Profile | Lane-fit jobs | Understood | Embedded | Size | P@10 | P@20 | nDCG@20 | Mean | Widened (n, mean) | Build ms | Spend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--:|--:|
| New-grad software engineer | 371 | 250 | 250 | 5 | 0.10 | 0.05 | 0.98 | 2.80 | 5 (2.80) | 35642 | $0.41 |
| Senior frontend engineer | 323 | 250 | 250 | 7 | 0.60 | 0.30 | 0.98 | 4.14 | 6 (4.00) | 6466 | $0.10 |
| Backend / platform engineer (mid) | 368 | 280 | 280 | 20 | 0.40 | 0.25 | 0.85 | 3.10 | 13 (2.92) | 7095 | $0.10 |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 112 | 112 | 11 | 0.50 | 0.25 | 0.93 | 3.36 | 9 (3.11) | 11435 | $0.21 |
| Product manager (US citizen) | 206 | 206 | 206 | 20 | 0.50 | 0.30 | 0.87 | 2.90 | 20 (2.90) | 17452 | $0.38 |
| Product designer | 52 | 52 | 52 | 8 | 0.20 | 0.10 | 0.93 | 3.38 | 6 (3.33) | 6686 | $0.11 |
| DevOps / SRE (US citizen) | 88 | 88 | 88 | 12 | 0.40 | 0.20 | 0.95 | 3.58 | 10 (3.50) | 4048 | $0.13 |
| Account executive (sales) | 339 | 250 | 250 | 20 | 0.50 | 0.50 | 0.86 | 3.40 | 19 (3.37) | 16673 | $0.41 |
| Marketing manager | 105 | 105 | 105 | 20 | 0.30 | 0.35 | 0.93 | 3.25 | 18 (3.06) | 9793 | $0.21 |
| Financial analyst | 9 | 9 | 9 | 3 | 0.10 | 0.05 | 1.00 | 3.33 | 2 (2.50) | 2381 | $0.0277 |
| Registered nurse (US citizen) | 16 | 16 | 16 | 0 | 0.00 | 0.00 | n/a | n/a | 0 (n/a) | 1439 | $0.0195 |
| Bootcamp career switcher into frontend | 51 | 51 | 51 | 5 | 0.00 | 0.00 | 1.00 | 2.00 | 5 (2.00) | 3691 | $0.0480 |

Lane-fit jobs = open, posted within 60 days, fit a lane by title and place. Understood and Embedded count those with a spec and an embedding after the run, so a gap between them is an index gap; a low P@10 with both full is a ranking problem.

## Index coverage per profile

| Profile | Lane-fit | With text | Selected (newest) | Selected understood | Selected embedded | Description reads (filled / gone / failed) | Understand failures |
|---|--:|--:|--:|--:|--:|--|--:|
| New-grad software engineer | 371 | 349 | 250 | 250 | 250 | 19 / 1 / 0 | 0 |
| Senior frontend engineer | 323 | 320 | 250 | 250 | 250 | 0 / 1 / 0 | 0 |
| Backend / platform engineer (mid) | 368 | 364 | 250 | 250 | 250 | 1 / 1 / 0 | 0 |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 110 | 112 | 112 | 112 | 2 / 0 / 0 | 0 |
| Product manager (US citizen) | 206 | 187 | 206 | 206 | 206 | 19 / 0 / 0 | 0 |
| Product designer | 52 | 50 | 52 | 52 | 52 | 2 / 0 / 0 | 0 |
| DevOps / SRE (US citizen) | 88 | 84 | 88 | 88 | 88 | 3 / 0 / 0 | 0 |
| Account executive (sales) | 339 | 258 | 250 | 250 | 250 | 81 / 0 / 0 | 0 |
| Marketing manager | 105 | 100 | 105 | 105 | 105 | 5 / 0 / 0 | 0 |
| Financial analyst | 9 | 3 | 9 | 9 | 9 | 6 / 0 / 0 | 0 |
| Registered nurse (US citizen) | 16 | 0 | 16 | 16 | 16 | 16 / 0 / 0 | 0 |
| Bootcamp career switcher into frontend | 51 | 51 | 51 | 51 | 51 | 0 / 0 / 0 | 0 |

## Where the shortlist came from

| Profile | Considered | Without spec | Gated out | Below min fit | Lane matches | Widened by step | Pool used |
|---|--:|--:|--:|--:|--:|--|--|
| New-grad software engineer | 200 | 0 | 571 | 16 | 0 | older 2, role_pool 3 | yes |
| Senior frontend engineer | 200 | 0 | 239 | 139 | 1 | adjacent_titles 1, older 3, role_pool 2 | yes |
| Backend / platform engineer (mid) | 200 | 0 | 268 | 114 | 7 | adjacent_titles 8, older 4, role_pool 1 | yes |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 0 | 344 | 45 | 2 | older 5, role_pool 4 | yes |
| Product manager (US citizen) | 200 | 0 | 151 | 93 | 0 | older 12, role_pool 8 | yes |
| Product designer | 52 | 0 | 39 | 34 | 2 | role_pool 6 | yes |
| DevOps / SRE (US citizen) | 88 | 0 | 203 | 52 | 2 | adjacent_titles 3, older 5, role_pool 2 | yes |
| Account executive (sales) | 200 | 0 | 177 | 137 | 1 | adjacent_titles 7, older 12 | no |
| Marketing manager | 105 | 0 | 117 | 63 | 2 | older 4, role_pool 14 | yes |
| Financial analyst | 9 | 0 | 11 | 6 | 1 | older 1, role_pool 1 | yes |
| Registered nurse (US citizen) | 16 | 0 | 0 | 16 | 0 | none | no |
| Bootcamp career switcher into frontend | 51 | 0 | 455 | 1 | 0 | adjacent_titles 1, older 1, role_pool 3 | yes |

## Why rows missed

Share of every judged row by the judge's main reason (duplicates are reassigned to `duplicate`).

| Reason | All profiles | new_grad_swe | senior_frontend | backend_platform_mid | data_scientist_ml | product_manager | product_designer | devops_sre | account_executive | marketing_manager | financial_analyst | registered_nurse | bootcamp_frontend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| good_fit | 36% | 20% | 86% | 25% | 45% | 30% | 25% | 33% | 50% | 35% | 33% | 0% | 0% |
| wrong_function | 20% | 60% | 14% | 20% | 27% | 10% | 25% | 25% | 0% | 25% | 0% | 0% | 60% |
| wrong_seniority_too_senior | 6% | 0% | 0% | 0% | 9% | 0% | 0% | 0% | 30% | 5% | 0% | 0% | 0% |
| wrong_seniority_too_junior | 19% | 20% | 0% | 40% | 0% | 30% | 38% | 17% | 0% | 15% | 33% | 0% | 20% |
| location_mismatch | 5% | 0% | 0% | 5% | 9% | 5% | 0% | 0% | 10% | 10% | 0% | 0% | 0% |
| missing_must_have | 10% | 0% | 0% | 0% | 0% | 25% | 13% | 17% | 10% | 10% | 33% | 0% | 0% |
| visa_or_clearance_blocked | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| unclear_job | 4% | 0% | 0% | 10% | 9% | 0% | 0% | 8% | 0% | 0% | 0% | 0% | 20% |
| duplicate | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |

Misses only (score below 4 or duplicate): wrong_function 31%, wrong_seniority_too_junior 30%, missing_must_have 15%, wrong_seniority_too_senior 10%, location_mismatch 8%.

## Widening

Widened rows: 113 of 131; mean score 3.11, hit rate 31% (lane matches: mean 4.00, hit rate 67%).

| Step | Rows | Mean score |
|---|--:|--:|
| older | 49 | 3.57 |
| role_pool | 44 | 2.73 |
| adjacent_titles | 20 | 2.80 |

## Ten worst rows

| # | Profile | Rank | Job | Score | Reason | Judge |
|--:|---|--:|---|--:|---|---|
| 1 | bootcamp_frontend | 1 (widened: role_pool) | Design Engineer at Method (New York, NY) | 2 | wrong_function | This role is for a highly specialized Design Engineer with advanced visual, motion, and creative coding skills, which the candidate's entry-level frontend background does not match. |
| 2 | account_executive | 2 (widened: adjacent_titles) | Sales Development Representative at Perk (Chicago) | 2 | wrong_seniority_too_senior | The candidate is a senior enterprise account executive, significantly overqualified for an SDR role, which is an entry-level sales position. |
| 3 | bootcamp_frontend | 2 (widened: role_pool) | Middle Manual QA Engineer (Growth) at Zeely (Remote) | 2 | wrong_function | The candidate is targeting junior frontend or full-stack engineering roles, but this is a mid-level manual QA position requiring 3+ years of QA experience. |
| 4 | new_grad_swe | 2 (widened: role_pool) | Design Engineer at Method (New York, NY) | 2 | wrong_function | The candidate is a software engineer with backend and full stack experience, but this role is primarily for a design engineer with strong visual and motion design skills. |
| 5 | bootcamp_frontend | 3 (widened: role_pool) | Hardware Lab Engineer Intern at Axelera (Florence (on-site)) | 2 | wrong_function | The candidate is a junior web developer with no hardware or electrical engineering background, while the job requires hands-on hardware lab and electronics skills. |
| 6 | data_scientist_ml | 3 (widened: role_pool) | Quantitative Researcher at Hyperbolic (San Francisco, CA) | 2 | wrong_function | The candidate is a data scientist and machine learning engineer, but the job requires deep experience in quantitative finance, derivatives pricing, and structuring, which is not shown in the resume. |
| 7 | financial_analyst | 3 (widened: role_pool) | Commercial Credit Analyst - Equipment Finance at Altiussearchgroup (Phoenix, United States / Atlanta, United States / Austin, United States / Baltimore, United States / Beaverton, United States / Bend, United States / Boston, United States / Irvine, United States / Cedar Rapids, United States / Chicago, United States / Cincinatti, United States / Dallas, United States / Danbury, United States / Denver, United States / Miami, United States / Fort Worth, United States / Franklin, United States / Glendale, United States / Madison, United States / Minneapolis, United States / Nashville, United States / New York, United States / Newark, United States / Philadelphia, United States / Portland, United States / Salt Lake City, United States / San Francisco, CA, United States / Seattle, United States) | 2 | missing_must_have | The candidate lacks the required direct commercial equipment finance underwriting experience, which is a hard requirement for this role. |
| 8 | product_manager | 3 (widened: older) | Senior Staff Product Manager, eCommerce at Liftoff (United States (Remote)) | 2 | missing_must_have | The candidate lacks required experience in performance advertising, DSPs, or ad network e-commerce products, which is a hard requirement for this role. |
| 9 | backend_platform_mid | 4 | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | The job posting lacks any description, so it's unclear what the function or requirements are beyond the title. |
| 10 | bootcamp_frontend | 4 (widened: adjacent_titles) | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | There is no job description, so it's unclear if the candidate's skills and level match the requirements for this Software Engineer role. |

## Spend

| Phase | Model | Calls | Prompt tokens (cached) | Completion tokens | USD |
|---|---|--:|--:|--:|--:|
| resume | gpt-4.1-mini | 29 | 46124 (11264) | 46814 | $0.0900 |
| resume | text-embedding-3-small | 29 | 14359 (0) | 0 | $0.0003 |
| understand | gpt-4.1-mini | 1325 | 2253292 (192512) | 664490 | $1.91 |
| understand | text-embedding-3-small | 1324 | 337670 (0) | 0 | $0.0074 |
| shortlist | text-embedding-3-small | 178 | 119221 (0) | 0 | $0.0025 |
| judge | gpt-4.1 | 331 | 590021 (81920) | 14635 | $1.17 |
| unrecorded-concurrent-runs | estimate | 0 | 0 (0) | 0 | $0.60 |

The `unrecorded` row is a deliberate over-estimate for calls made by an aborted attempt whose ledger writes were lost (three runs overlapped by mistake); real usage of that attempt was well below it.

Total $3.78 against a cap of $9.00. Prices come from the table in packages/ai/src/config.ts and must be checked against the vendor before the dollars are relied on.

## Method notes

- Users, lanes, work authorisation and resumes are in `scripts/eval/profiles.json` and `scripts/eval/resumes/`; all people and employers in the resumes are fictional.
- The shortlist is `buildShortlist` with widening on, read back in the order the API serves it (lane matches first, then widened rows, each best fit first), top 20 rows. Rows are raw: the API additionally collapses the same company and title into one entry, which is why duplicates are reported on their own.
- The judge sees the resume, the profile (lanes, work authorisation, seniority) and the job title, company, location and the first 3,500 characters of the description; one call per (profile, job), cached in `scripts/eval/cache/judgments.json`.
- P@k divides by k even when fewer rows came back, so a short shortlist is penalised. nDCG@20 only ranks the rows that were returned; it does not see good jobs that were never retrieved.
- Reason codes describe the candidate against the job: `wrong_seniority_too_junior` means the candidate is too junior for the job, `wrong_seniority_too_senior` means the candidate is overqualified (the judge applied them this way consistently).
- A single LLM judge is not ground truth: expect a few points of noise and a bias towards keyword overlap. Treat differences of a few points between runs as noise.
