# Matching quality baseline

Generated 2026-11-03 03:23 UTC. 12 fictional profiles, top 20 of each shortlist judged by gpt-4.1 (rubric v1).
Jobs: a copy of the live collection (`norinote-eval3`), as of 2026-11-03. Per user the newest 250 lane-fitting jobs were understood with gpt-4.1-mini (embeddings: text-embedding-3-small). Reproduce with `npx tsx scripts/eval/run.mts`.

## Overall

| Metric | Value |
|---|---|
| P@10 (judge score >= 4, averaged over profiles) | 0.33 |
| P@20 | 0.22 |
| P@10 / P@20 if duplicate listings count as misses | 0.31 / 0.21 |
| nDCG@20 (gain = score - 1, ideal = same items re-sorted) | 0.92 |
| Mean judge score (per profile average / all 140 jobs) | 3.24 / 3.26 |
| Mean shortlist size | 11.67 |
| Duplicates (same company and title as a higher row) | 3 of 140 |
| Lane matches: count, mean score, hit rate | 34, 3.88, 65% |
| Widened rows: count, mean score, hit rate | 106, 3.07, 29% |
| OpenAI spend for the whole eval (cap $4.00) | $3.93 |

## Per profile

| Profile | Lane-fit jobs | Understood | Embedded | Size | P@10 | P@20 | nDCG@20 | Mean | Widened (n, mean) | Build ms | Spend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--:|--:|
| New-grad software engineer | 371 | 305 | 305 | 9 | 0.10 | 0.05 | 0.78 | 2.67 | 7 (2.86) | 28830 | $0.0191 |
| Senior frontend engineer | 323 | 265 | 265 | 6 | 0.60 | 0.30 | 0.98 | 4.50 | 5 (4.40) | 52253 | $0.0031 |
| Backend / platform engineer (mid) | 368 | 300 | 300 | 20 | 0.40 | 0.35 | 0.86 | 3.40 | 6 (3.17) | 9756 | $0.0229 |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 112 | 112 | 11 | 0.50 | 0.25 | 0.93 | 3.45 | 9 (3.22) | 17642 | $0.0079 |
| Product manager (US citizen) | 206 | 206 | 206 | 20 | 0.50 | 0.30 | 0.87 | 2.90 | 20 (2.90) | 19648 | $0.0038 |
| Product designer | 52 | 52 | 52 | 8 | 0.20 | 0.10 | 0.93 | 3.38 | 6 (3.33) | 10505 | $0.0028 |
| DevOps / SRE (US citizen) | 88 | 88 | 88 | 19 | 0.70 | 0.50 | 0.98 | 3.84 | 13 (3.46) | 11651 | $0.0286 |
| Account executive (sales) | 339 | 250 | 250 | 20 | 0.80 | 0.45 | 0.93 | 3.05 | 14 (2.57) | 16522 | $0.0291 |
| Marketing manager | 105 | 105 | 105 | 20 | 0.10 | 0.30 | 0.81 | 3.15 | 20 (3.15) | 34475 | $0.0193 |
| Financial analyst | 9 | 9 | 9 | 3 | 0.10 | 0.05 | 1.00 | 3.33 | 2 (2.50) | 6033 | $0.0040 |
| Registered nurse (US citizen) | 16 | 16 | 16 | 0 | 0.00 | 0.00 | n/a | n/a | 0 (n/a) | 29379 | $0.0028 |
| Bootcamp career switcher into frontend | 51 | 51 | 51 | 4 | 0.00 | 0.00 | 1.00 | 2.00 | 4 (2.00) | 8976 | $0.0074 |

Lane-fit jobs = open, posted within 60 days, fit a lane by title and place. Understood and Embedded count those with a spec and an embedding after the run, so a gap between them is an index gap; a low P@10 with both full is a ranking problem.

## Index coverage per profile

| Profile | Lane-fit | With text | Selected (newest) | Selected understood | Selected embedded | Description reads (filled / gone / failed) | Understand failures |
|---|--:|--:|--:|--:|--:|--|--:|
| New-grad software engineer | 371 | 368 | 250 | 250 | 250 | 0 / 1 / 0 | 0 |
| Senior frontend engineer | 323 | 320 | 250 | 250 | 250 | 0 / 1 / 0 | 0 |
| Backend / platform engineer (mid) | 368 | 365 | 250 | 250 | 250 | 0 / 1 / 0 | 0 |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 112 | 112 | 112 | 112 | 0 / 0 / 0 | 0 |
| Product manager (US citizen) | 206 | 206 | 206 | 206 | 206 | 0 / 0 / 0 | 0 |
| Product designer | 52 | 52 | 52 | 52 | 52 | 0 / 0 / 0 | 0 |
| DevOps / SRE (US citizen) | 88 | 87 | 88 | 88 | 88 | 0 / 0 / 0 | 0 |
| Account executive (sales) | 339 | 339 | 250 | 250 | 250 | 0 / 0 / 0 | 0 |
| Marketing manager | 105 | 105 | 105 | 105 | 105 | 0 / 0 / 0 | 0 |
| Financial analyst | 9 | 9 | 9 | 9 | 9 | 0 / 0 / 0 | 0 |
| Registered nurse (US citizen) | 16 | 16 | 16 | 16 | 16 | 0 / 0 / 0 | 0 |
| Bootcamp career switcher into frontend | 51 | 51 | 51 | 51 | 51 | 0 / 0 / 0 | 0 |

## Where the shortlist came from

| Profile | Considered | Without spec | Gated out | Below min fit | Lane matches | Widened by step | Pool used |
|---|--:|--:|--:|--:|--:|--|--|
| New-grad software engineer | 305 | 0 | 518 | 68 | 2 | older 5, role_pool 2 | yes |
| Senior frontend engineer | 265 | 0 | 239 | 175 | 1 | adjacent_titles 2, older 2, role_pool 1 | yes |
| Backend / platform engineer (mid) | 300 | 0 | 180 | 165 | 14 | adjacent_titles 6 | no |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 0 | 273 | 69 | 2 | older 5, role_pool 4 | yes |
| Product manager (US citizen) | 206 | 0 | 138 | 102 | 0 | older 12, role_pool 8 | yes |
| Product designer | 52 | 0 | 39 | 34 | 2 | role_pool 6 | yes |
| DevOps / SRE (US citizen) | 88 | 0 | 191 | 52 | 6 | adjacent_titles 5, older 6, role_pool 2 | yes |
| Account executive (sales) | 250 | 0 | 197 | 175 | 6 | adjacent_titles 12, older 2 | no |
| Marketing manager | 105 | 0 | 122 | 63 | 0 | older 4, role_pool 16 | yes |
| Financial analyst | 9 | 0 | 6 | 7 | 1 | older 1, role_pool 1 | yes |
| Registered nurse (US citizen) | 16 | 0 | 0 | 16 | 0 | none | no |
| Bootcamp career switcher into frontend | 51 | 0 | 420 | 6 | 0 | adjacent_titles 1, older 1, role_pool 2 | yes |

## Why rows missed

Share of every judged row by the judge's main reason (duplicates are reassigned to `duplicate`).

| Reason | All profiles | new_grad_swe | senior_frontend | backend_platform_mid | data_scientist_ml | product_manager | product_designer | devops_sre | account_executive | marketing_manager | financial_analyst | registered_nurse | bootcamp_frontend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| good_fit | 36% | 11% | 100% | 35% | 45% | 30% | 25% | 53% | 30% | 30% | 33% | 0% | 0% |
| wrong_function | 16% | 22% | 0% | 5% | 36% | 10% | 25% | 16% | 0% | 30% | 0% | 0% | 50% |
| wrong_seniority_too_senior | 6% | 0% | 0% | 0% | 9% | 0% | 0% | 0% | 40% | 0% | 0% | 0% | 0% |
| wrong_seniority_too_junior | 21% | 56% | 0% | 40% | 0% | 30% | 38% | 11% | 0% | 20% | 33% | 0% | 25% |
| location_mismatch | 5% | 0% | 0% | 5% | 9% | 5% | 0% | 0% | 10% | 10% | 0% | 0% | 0% |
| missing_must_have | 9% | 0% | 0% | 5% | 0% | 25% | 13% | 11% | 5% | 10% | 33% | 0% | 0% |
| visa_or_clearance_blocked | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| unclear_job | 4% | 11% | 0% | 10% | 0% | 0% | 0% | 11% | 0% | 0% | 0% | 0% | 25% |
| duplicate | 2% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 15% | 0% | 0% | 0% | 0% |

Misses only (score below 4 or duplicate): wrong_seniority_too_junior 33%, wrong_function 24%, missing_must_have 14%, wrong_seniority_too_senior 10%, location_mismatch 8%.

## Widening

Widened rows: 106 of 140; mean score 3.07, hit rate 29% (lane matches: mean 3.88, hit rate 65%).

| Step | Rows | Mean score |
|---|--:|--:|
| older | 38 | 3.37 |
| role_pool | 42 | 2.86 |
| adjacent_titles | 26 | 2.96 |

## Ten worst rows

| # | Profile | Rank | Job | Score | Reason | Judge |
|--:|---|--:|---|--:|---|---|
| 1 | bootcamp_frontend | 1 (widened: role_pool) | Design Engineer at Method (New York, NY) | 2 | wrong_function | This role is for a highly specialized Design Engineer with advanced visual, motion, and creative coding skills, which the candidate's entry-level frontend background does not match. |
| 2 | new_grad_swe | 1 | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | The job posting lacks any description, so it's unclear what the actual requirements or responsibilities are. |
| 3 | bootcamp_frontend | 2 (widened: adjacent_titles) | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | There is no job description, so it's unclear if the candidate's skills and level match the requirements for this Software Engineer role. |
| 4 | new_grad_swe | 2 | Software Engineer II (Fullstack), Digital Storefront at Toast (US (remote)) | 2 | wrong_seniority_too_junior | The candidate is an entry-level new grad, but this is a Software Engineer II role requiring more experience than they have. |
| 5 | bootcamp_frontend | 3 (widened: role_pool) | Program Engineer at Designedconveyorsystems (Franklin, TN or Remote) | 2 | wrong_function | The role is a program-level engineering integrator requiring cross-functional engineering and project management experience, which the candidate lacks as an entry-level frontend developer. |
| 6 | data_scientist_ml | 3 (widened: role_pool) | Quantitative Researcher at Hyperbolic (San Francisco, CA) | 2 | wrong_function | The candidate is a data scientist and machine learning engineer, but the job requires deep experience in quantitative finance, derivatives pricing, and structuring, which is not shown in the resume. |
| 7 | financial_analyst | 3 (widened: role_pool) | Commercial Credit Analyst - Equipment Finance at Altiussearchgroup (Phoenix, United States / Atlanta, United States / Austin, United States / Baltimore, United States / Beaverton, United States / Bend, United States / Boston, United States / Irvine, United States / Cedar Rapids, United States / Chicago, United States / Cincinatti, United States / Dallas, United States / Danbury, United States / Denver, United States / Miami, United States / Fort Worth, United States / Franklin, United States / Glendale, United States / Madison, United States / Minneapolis, United States / Nashville, United States / New York, United States / Newark, United States / Philadelphia, United States / Portland, United States / Salt Lake City, United States / San Francisco, CA, United States / Seattle, United States) | 2 | missing_must_have | The candidate lacks the required direct commercial equipment finance underwriting experience, which is a hard requirement for this role. |
| 8 | product_manager | 3 (widened: older) | Senior Staff Product Manager, eCommerce at Liftoff (United States (Remote)) | 2 | missing_must_have | The candidate lacks required experience in performance advertising, DSPs, or ad network e-commerce products, which is a hard requirement for this role. |
| 9 | bootcamp_frontend | 4 (widened: older) | Software Engineer - Next.js at Vercel (Hybrid - San Francisco, New York City) | 2 | wrong_seniority_too_junior | The candidate is an entry-level bootcamp graduate, while this role requires strong production experience and deep expertise in JavaScript, TypeScript, and React. |
| 10 | product_manager | 4 (widened: older) | Staff Product Manager, Ads Formats at Reddit (Remote - United States) | 2 | missing_must_have | The candidate lacks direct experience in Ads monetization products or ad formats, which is a hard requirement for this Staff Product Manager role. |

## Spend

| Phase | Model | Calls | Prompt tokens (cached) | Completion tokens | USD |
|---|---|--:|--:|--:|--:|
| resume | gpt-4.1-mini | 41 | 65224 (11264) | 65479 | $0.13 |
| resume | text-embedding-3-small | 41 | 19901 (0) | 0 | $0.0004 |
| understand | gpt-4.1-mini | 1325 | 2253292 (192512) | 664490 | $1.91 |
| understand | text-embedding-3-small | 1324 | 337670 (0) | 0 | $0.0074 |
| shortlist | text-embedding-3-small | 233 | 188720 (0) | 0 | $0.0039 |
| judge | gpt-4.1 | 361 | 644179 (87040) | 16035 | $1.29 |
| unrecorded-concurrent-runs | estimate | 0 | 0 (0) | 0 | $0.60 |

The `unrecorded` row is a deliberate over-estimate for calls made by an aborted attempt whose ledger writes were lost (three runs overlapped by mistake); real usage of that attempt was well below it.

Total $3.93 against a cap of $4.00. Prices come from the table in packages/ai/src/config.ts and must be checked against the vendor before the dollars are relied on.

## Method notes

- Users, lanes, work authorisation and resumes are in `scripts/eval/profiles.json` and `scripts/eval/resumes/`; all people and employers in the resumes are fictional.
- The shortlist is `buildShortlist` with widening on, read back in the order the API serves it (lane matches first, then widened rows, each best fit first), top 20 rows. Rows are raw: the API additionally collapses the same company and title into one entry, which is why duplicates are reported on their own.
- The judge sees the resume, the profile (lanes, work authorisation, seniority) and the job title, company, location and the first 3,500 characters of the description; one call per (profile, job), cached in `scripts/eval/cache/judgments.json`.
- P@k divides by k even when fewer rows came back, so a short shortlist is penalised. nDCG@20 only ranks the rows that were returned; it does not see good jobs that were never retrieved.
- Reason codes describe the candidate against the job: `wrong_seniority_too_junior` means the candidate is too junior for the job, `wrong_seniority_too_senior` means the candidate is overqualified (the judge applied them this way consistently).
- A single LLM judge is not ground truth: expect a few points of noise and a bias towards keyword overlap. Treat differences of a few points between runs as noise.
