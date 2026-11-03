# Matching quality baseline

Generated 2026-11-03 03:53 UTC. 12 fictional profiles, top 20 of each shortlist judged by gpt-4.1 (rubric v1).
Jobs: a copy of the live collection (`norinote-eval4`), as of 2026-11-03. Per user the newest 250 lane-fitting jobs were understood with gpt-4.1-mini (embeddings: text-embedding-3-small). Reproduce with `npx tsx scripts/eval/run.mts`.

## Overall

| Metric | Value |
|---|---|
| P@10 (judge score >= 4, averaged over profiles) | 0.45 |
| P@20 | 0.35 |
| P@10 / P@20 if duplicate listings count as misses | 0.43 / 0.32 |
| nDCG@20 (gain = score - 1, ideal = same items re-sorted) | 0.93 |
| Mean judge score (per profile average / all 167 jobs) | 3.50 / 3.61 |
| Mean shortlist size | 13.92 |
| Duplicates (same company and title as a higher row) | 6 of 167 |
| Lane matches: count, mean score, hit rate | 87, 4.00, 62% |
| Widened rows: count, mean score, hit rate | 80, 3.19, 38% |
| OpenAI spend for the whole eval (cap $4.60) | $4.18 |

## Per profile

| Profile | Lane-fit jobs | Understood | Embedded | Size | P@10 | P@20 | nDCG@20 | Mean | Widened (n, mean) | Build ms | Spend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--:|--:|
| New-grad software engineer | 371 | 305 | 305 | 9 | 0.10 | 0.05 | 0.82 | 2.78 | 6 (3.00) | 22502 | $0.0077 |
| Senior frontend engineer | 323 | 265 | 265 | 11 | 0.70 | 0.40 | 0.91 | 3.91 | 6 (4.50) | 37905 | $0.0209 |
| Backend / platform engineer (mid) | 368 | 300 | 300 | 20 | 0.40 | 0.35 | 0.90 | 3.50 | 0 (n/a) | 2221 | $0.0484 |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 112 | 112 | 16 | 0.30 | 0.35 | 0.94 | 3.50 | 12 (3.25) | 25535 | $0.0197 |
| Product manager (US citizen) | 206 | 206 | 206 | 18 | 0.30 | 0.40 | 0.85 | 3.33 | 13 (3.38) | 29081 | $0.0262 |
| Product designer | 52 | 52 | 52 | 10 | 0.40 | 0.20 | 0.92 | 3.70 | 6 (3.33) | 12173 | $0.0063 |
| DevOps / SRE (US citizen) | 88 | 88 | 88 | 20 | 0.80 | 0.70 | 0.97 | 4.05 | 6 (3.67) | 10372 | $0.0433 |
| Account executive (sales) | 339 | 250 | 250 | 20 | 1.00 | 0.70 | 0.96 | 3.85 | 7 (3.00) | 15945 | $0.0368 |
| Marketing manager | 105 | 105 | 105 | 20 | 0.30 | 0.30 | 0.89 | 3.10 | 17 (2.88) | 17371 | $0.0073 |
| Financial analyst | 9 | 9 | 9 | 3 | 0.10 | 0.05 | 1.00 | 3.33 | 2 (2.50) | 5015 | $0.0020 |
| Registered nurse (US citizen) | 16 | 16 | 16 | 14 | 1.00 | 0.70 | 1.00 | 5.00 | 0 (n/a) | 3184 | $0.0136 |
| Bootcamp career switcher into frontend | 51 | 51 | 51 | 6 | 0.00 | 0.00 | 1.00 | 2.00 | 5 (2.00) | 13687 | $0.0117 |

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
| New-grad software engineer | 305 | 0 | 518 | 67 | 3 | older 4, role_pool 2 | yes |
| Senior frontend engineer | 265 | 0 | 239 | 171 | 5 | adjacent_titles 2, older 3, role_pool 1 | yes |
| Backend / platform engineer (mid) | 200 | 0 | 77 | 101 | 20 | none | no |
| Data scientist / ML engineer (needs visa sponsorship) | 112 | 0 | 273 | 67 | 4 | adjacent_titles 1, older 7, role_pool 4 | yes |
| Product manager (US citizen) | 206 | 0 | 138 | 97 | 5 | older 12, role_pool 1 | yes |
| Product designer | 52 | 0 | 39 | 32 | 4 | role_pool 6 | yes |
| DevOps / SRE (US citizen) | 88 | 0 | 81 | 44 | 14 | adjacent_titles 6 | no |
| Account executive (sales) | 250 | 0 | 136 | 168 | 13 | adjacent_titles 7 | no |
| Marketing manager | 105 | 0 | 122 | 60 | 3 | older 4, role_pool 13 | yes |
| Financial analyst | 9 | 0 | 6 | 7 | 1 | older 1, role_pool 1 | yes |
| Registered nurse (US citizen) | 16 | 0 | 0 | 2 | 14 | none | no |
| Bootcamp career switcher into frontend | 51 | 0 | 420 | 5 | 1 | adjacent_titles 1, older 2, role_pool 2 | yes |

## Why rows missed

Share of every judged row by the judge's main reason (duplicates are reassigned to `duplicate`).

| Reason | All profiles | new_grad_swe | senior_frontend | backend_platform_mid | data_scientist_ml | product_manager | product_designer | devops_sre | account_executive | marketing_manager | financial_analyst | registered_nurse | bootcamp_frontend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| good_fit | 47% | 11% | 73% | 35% | 44% | 44% | 40% | 70% | 55% | 30% | 33% | 79% | 0% |
| wrong_function | 15% | 22% | 9% | 0% | 38% | 11% | 20% | 15% | 0% | 35% | 0% | 0% | 33% |
| wrong_seniority_too_senior | 1% | 0% | 0% | 0% | 6% | 0% | 0% | 5% | 0% | 0% | 0% | 0% | 0% |
| wrong_seniority_too_junior | 16% | 56% | 0% | 55% | 0% | 6% | 30% | 0% | 0% | 15% | 33% | 0% | 50% |
| location_mismatch | 5% | 0% | 0% | 0% | 13% | 0% | 0% | 10% | 15% | 10% | 0% | 0% | 0% |
| missing_must_have | 10% | 0% | 0% | 10% | 0% | 39% | 10% | 0% | 15% | 10% | 33% | 0% | 0% |
| visa_or_clearance_blocked | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| unclear_job | 2% | 11% | 18% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 17% |
| duplicate | 4% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 15% | 0% | 0% | 21% | 0% |

Misses only (score below 4 or duplicate): wrong_seniority_too_junior 30%, wrong_function 28%, missing_must_have 18%, location_mismatch 10%, duplicate 7%.

## Widening

Widened rows: 80 of 167; mean score 3.19, hit rate 38% (lane matches: mean 4.00, hit rate 62%).

| Step | Rows | Mean score |
|---|--:|--:|
| older | 33 | 3.48 |
| role_pool | 30 | 2.77 |
| adjacent_titles | 17 | 3.35 |

## Ten worst rows

| # | Profile | Rank | Job | Score | Reason | Judge |
|--:|---|--:|---|--:|---|---|
| 1 | bootcamp_frontend | 1 | Applied AI Engineer (Full-Stack) at Pinecone (New York City) | 2 | wrong_seniority_too_junior | The candidate is an entry-level bootcamp graduate with no professional software experience, while the job requires strong engineering background and hands-on AI application experience. |
| 2 | bootcamp_frontend | 2 (widened: role_pool) | Design Engineer at Method (New York, NY) | 2 | wrong_function | This role is for a highly specialized Design Engineer with advanced visual, motion, and creative coding skills, which the candidate's entry-level frontend background does not match. |
| 3 | new_grad_swe | 2 | Software Engineer II (Fullstack), Digital Storefront at Toast (US (remote)) | 2 | wrong_seniority_too_junior | The candidate is an entry-level new grad, but this is a Software Engineer II role requiring more experience than they have. |
| 4 | bootcamp_frontend | 3 (widened: adjacent_titles) | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | There is no job description, so it's unclear if the candidate's skills and level match the requirements for this Software Engineer role. |
| 5 | financial_analyst | 3 (widened: role_pool) | Commercial Credit Analyst - Equipment Finance at Altiussearchgroup (Phoenix, United States / Atlanta, United States / Austin, United States / Baltimore, United States / Beaverton, United States / Bend, United States / Boston, United States / Irvine, United States / Cedar Rapids, United States / Chicago, United States / Cincinatti, United States / Dallas, United States / Danbury, United States / Denver, United States / Miami, United States / Fort Worth, United States / Franklin, United States / Glendale, United States / Madison, United States / Minneapolis, United States / Nashville, United States / New York, United States / Newark, United States / Philadelphia, United States / Portland, United States / Salt Lake City, United States / San Francisco, CA, United States / Seattle, United States) | 2 | missing_must_have | The candidate lacks the required direct commercial equipment finance underwriting experience, which is a hard requirement for this role. |
| 6 | new_grad_swe | 3 | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | The job posting lacks any description, so it's unclear what the actual requirements or responsibilities are. |
| 7 | senior_frontend | 3 | Senior Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | There is no job description, so it is unclear what the function or requirements are beyond the title. |
| 8 | bootcamp_frontend | 4 (widened: role_pool) | Program Engineer at Designedconveyorsystems (Franklin, TN or Remote) | 2 | wrong_function | The role is a program-level engineering integrator requiring cross-functional engineering and project management experience, which the candidate lacks as an entry-level frontend developer. |
| 9 | senior_frontend | 4 | Software Engineer (Remote) at Kestrel Intelligence (United States) | 2 | unclear_job | The job posting lacks any description, so it's unclear what function or skills are required for this role. |
| 10 | bootcamp_frontend | 5 (widened: older) | Software Engineer - Next.js at Vercel (Hybrid - San Francisco, New York City) | 2 | wrong_seniority_too_junior | The candidate is an entry-level bootcamp graduate, while this role requires strong production experience and deep expertise in JavaScript, TypeScript, and React. |

## Spend

| Phase | Model | Calls | Prompt tokens (cached) | Completion tokens | USD |
|---|---|--:|--:|--:|--:|
| resume | gpt-4.1-mini | 53 | 84324 (26752) | 83367 | $0.16 |
| resume | text-embedding-3-small | 53 | 25581 (0) | 0 | $0.0005 |
| understand | gpt-4.1-mini | 1325 | 2253292 (192512) | 664490 | $1.91 |
| understand | text-embedding-3-small | 1324 | 337670 (0) | 0 | $0.0074 |
| shortlist | text-embedding-3-small | 283 | 256862 (0) | 0 | $0.0053 |
| judge | gpt-4.1 | 416 | 743470 (92160) | 18533 | $1.50 |
| unrecorded-concurrent-runs | estimate | 0 | 0 (0) | 0 | $0.60 |

The `unrecorded` row is a deliberate over-estimate for calls made by an aborted attempt whose ledger writes were lost (three runs overlapped by mistake); real usage of that attempt was well below it.

Total $4.18 against a cap of $4.60. Prices come from the table in packages/ai/src/config.ts and must be checked against the vendor before the dollars are relied on.

## Method notes

- Users, lanes, work authorisation and resumes are in `scripts/eval/profiles.json` and `scripts/eval/resumes/`; all people and employers in the resumes are fictional.
- The shortlist is `buildShortlist` with widening on, read back in the order the API serves it (lane matches first, then widened rows, each best fit first), top 20 rows. Rows are raw: the API additionally collapses the same company and title into one entry, which is why duplicates are reported on their own.
- The judge sees the resume, the profile (lanes, work authorisation, seniority) and the job title, company, location and the first 3,500 characters of the description; one call per (profile, job), cached in `scripts/eval/cache/judgments.json`.
- P@k divides by k even when fewer rows came back, so a short shortlist is penalised. nDCG@20 only ranks the rows that were returned; it does not see good jobs that were never retrieved.
- Reason codes describe the candidate against the job: `wrong_seniority_too_junior` means the candidate is too junior for the job, `wrong_seniority_too_senior` means the candidate is overqualified (the judge applied them this way consistently).
- A single LLM judge is not ground truth: expect a few points of noise and a bias towards keyword overlap. Treat differences of a few points between runs as noise.
