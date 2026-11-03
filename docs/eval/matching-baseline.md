# Matching quality baseline

Generated 2026-11-03 01:04 UTC. 12 fictional profiles, top 20 of each shortlist judged by gpt-4.1 (rubric v1).
Jobs: a copy of the live collection (`norinote-eval`), as of 2026-11-03. Per user the newest 250 lane-fitting jobs were understood with gpt-4.1-mini (embeddings: text-embedding-3-small). Reproduce with `npx tsx scripts/eval/run.mts`.

## Overall

| Metric | Value |
|---|---|
| P@10 (judge score >= 4, averaged over profiles) | 0.27 |
| P@20 | 0.20 |
| P@10 / P@20 if duplicate listings count as misses | 0.27 / 0.20 |
| nDCG@20 (gain = score - 1, ideal = same items re-sorted) | 0.89 |
| Mean judge score (per profile average / all 199 jobs) | 2.89 / 2.95 |
| Mean shortlist size | 16.58 |
| Duplicates (same company and title as a higher row) | 0 of 199 |
| Lane matches: count, mean score, hit rate | 2, 3.50, 50% |
| Widened rows: count, mean score, hit rate | 197, 2.95, 23% |
| OpenAI spend for the whole eval (cap $9.00) | $1.63 |

## Per profile

| Profile | Lane-fit jobs | Understood | Embedded | Size | P@10 | P@20 | nDCG@20 | Mean | Widened (n, mean) | Build ms | Spend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--:|--:|
| New-grad software engineer | 27 | 27 | 27 | 19 | 0.20 | 0.10 | 0.99 | 2.37 | 19 (2.37) | 5179 | $0.0831 |
| Senior frontend engineer | 25 | 25 | 25 | 20 | 0.30 | 0.30 | 0.85 | 3.00 | 20 (3.00) | 477 | $0.0670 |
| Backend / platform engineer (mid) | 28 | 28 | 28 | 20 | 0.30 | 0.15 | 0.78 | 2.90 | 19 (2.95) | 922 | $0.0839 |
| Data scientist / ML engineer (needs visa sponsorship) | 8 | 8 | 8 | 20 | 0.30 | 0.25 | 0.84 | 2.90 | 20 (2.90) | 1170 | $0.0735 |
| Product manager (US citizen) | 22 | 22 | 22 | 20 | 0.40 | 0.40 | 0.87 | 3.45 | 20 (3.45) | 2337 | $0.10 |
| Product designer | 3 | 3 | 3 | 8 | 0.10 | 0.05 | 0.73 | 2.75 | 8 (2.75) | 918 | $0.0059 |
| DevOps / SRE (US citizen) | 12 | 12 | 12 | 20 | 0.40 | 0.25 | 0.84 | 3.25 | 20 (3.25) | 755 | $0.0848 |
| Account executive (sales) | 86 | 86 | 86 | 20 | 0.20 | 0.25 | 0.85 | 3.00 | 19 (2.89) | 4651 | $0.20 |
| Marketing manager | 5 | 5 | 5 | 16 | 0.00 | 0.00 | 0.99 | 2.56 | 16 (2.56) | 1169 | $0.0701 |
| Financial analyst | 1 | 1 | 1 | 1 | 0.00 | 0.00 | 1.00 | 2.00 | 1 (2.00) | 798 | $0.0035 |
| Registered nurse (US citizen) | 16 | 16 | 16 | 15 | 1.00 | 0.60 | 1.00 | 4.40 | 15 (4.40) | 1301 | $0.0739 |
| Bootcamp career switcher into frontend | 3 | 3 | 3 | 20 | 0.00 | 0.00 | 0.91 | 2.10 | 20 (2.10) | 676 | $0.0693 |

Lane-fit jobs = open, posted within 60 days, fit a lane by title and place. Understood and Embedded count those with a spec and an embedding after the run, so a gap between them is an index gap; a low P@10 with both full is a ranking problem.

## Index coverage per profile

| Profile | Lane-fit | With text | Selected (newest) | Selected understood | Selected embedded | Description reads (filled / gone / failed) | Understand failures |
|---|--:|--:|--:|--:|--:|--|--:|
| New-grad software engineer | 27 | 15 | 27 | 27 | 27 | 11 / 1 / 0 | 0 |
| Senior frontend engineer | 25 | 24 | 25 | 25 | 25 | 0 / 1 / 0 | 0 |
| Backend / platform engineer (mid) | 28 | 26 | 28 | 28 | 28 | 1 / 1 / 0 | 0 |
| Data scientist / ML engineer (needs visa sponsorship) | 8 | 8 | 8 | 8 | 8 | 0 / 0 / 0 | 0 |
| Product manager (US citizen) | 22 | 9 | 22 | 22 | 22 | 13 / 0 / 0 | 0 |
| Product designer | 3 | 3 | 3 | 3 | 3 | 0 / 0 / 0 | 0 |
| DevOps / SRE (US citizen) | 12 | 9 | 12 | 12 | 12 | 3 / 0 / 0 | 0 |
| Account executive (sales) | 86 | 11 | 86 | 86 | 86 | 75 / 0 / 0 | 0 |
| Marketing manager | 5 | 5 | 5 | 5 | 5 | 0 / 0 / 0 | 0 |
| Financial analyst | 1 | 1 | 1 | 1 | 1 | 0 / 0 / 0 | 0 |
| Registered nurse (US citizen) | 16 | 0 | 16 | 16 | 16 | 16 / 0 / 0 | 0 |
| Bootcamp career switcher into frontend | 3 | 3 | 3 | 3 | 3 | 0 / 0 / 0 | 0 |

## Where the shortlist came from

| Profile | Considered | Without spec | Gated out | Below min fit | Lane matches | Widened by step | Pool used |
|---|--:|--:|--:|--:|--:|--|--|
| New-grad software engineer | 27 | 0 | 64 | 4 | 0 | adjacent_titles 4, role_pool 15 | yes |
| Senior frontend engineer | 25 | 0 | 1 | 24 | 0 | adjacent_titles 20 | no |
| Backend / platform engineer (mid) | 28 | 0 | 2 | 25 | 1 | adjacent_titles 19 | no |
| Data scientist / ML engineer (needs visa sponsorship) | 8 | 0 | 2 | 8 | 0 | adjacent_titles 20 | no |
| Product manager (US citizen) | 22 | 0 | 0 | 22 | 0 | adjacent_titles 20 | no |
| Product designer | 3 | 0 | 1 | 3 | 0 | adjacent_titles 4, role_pool 4 | yes |
| DevOps / SRE (US citizen) | 12 | 0 | 1 | 11 | 0 | adjacent_titles 20 | no |
| Account executive (sales) | 86 | 0 | 3 | 82 | 1 | adjacent_titles 19 | no |
| Marketing manager | 5 | 0 | 1 | 5 | 0 | adjacent_titles 5, older 2, role_pool 9 | yes |
| Financial analyst | 1 | 0 | 0 | 1 | 0 | adjacent_titles 1 | no |
| Registered nurse (US citizen) | 16 | 0 | 0 | 16 | 0 | older 15 | no |
| Bootcamp career switcher into frontend | 3 | 0 | 0 | 3 | 0 | adjacent_titles 18, older 1, role_pool 1 | yes |

## Why rows missed

Share of every judged row by the judge's main reason (duplicates are reassigned to `duplicate`).

| Reason | All profiles | new_grad_swe | senior_frontend | backend_platform_mid | data_scientist_ml | product_manager | product_designer | devops_sre | account_executive | marketing_manager | financial_analyst | registered_nurse | bootcamp_frontend |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| good_fit | 24% | 11% | 30% | 15% | 25% | 40% | 13% | 25% | 25% | 0% | 0% | 80% | 0% |
| wrong_function | 27% | 26% | 45% | 15% | 45% | 15% | 38% | 45% | 0% | 50% | 0% | 0% | 25% |
| wrong_seniority_too_senior | 5% | 0% | 5% | 5% | 10% | 5% | 0% | 0% | 15% | 6% | 0% | 0% | 0% |
| wrong_seniority_too_junior | 17% | 16% | 5% | 45% | 5% | 10% | 13% | 5% | 5% | 6% | 0% | 0% | 65% |
| location_mismatch | 11% | 0% | 10% | 15% | 15% | 0% | 25% | 15% | 30% | 6% | 0% | 0% | 10% |
| missing_must_have | 12% | 5% | 5% | 5% | 0% | 30% | 13% | 10% | 25% | 31% | 0% | 7% | 0% |
| visa_or_clearance_blocked | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| unclear_job | 6% | 42% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 13% | 0% |
| duplicate | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |

Misses only (score below 4 or duplicate): wrong_function 36%, wrong_seniority_too_junior 22%, missing_must_have 15%, location_mismatch 14%, unclear_job 7%.

## Widening

Widened rows: 197 of 199; mean score 2.95, hit rate 23% (lane matches: mean 3.50, hit rate 50%).

| Step | Rows | Mean score |
|---|--:|--:|
| adjacent_titles | 150 | 2.96 |
| role_pool | 29 | 2.17 |
| older | 18 | 4.11 |

## Ten worst rows

| # | Profile | Rank | Job | Score | Reason | Judge |
|--:|---|--:|---|--:|---|---|
| 1 | backend_platform_mid | 1 | Business Title IT Dev Senior (Software Engineer) - Contractor at Corpay (Europe Remote - Parking) | 2 | location_mismatch | The job is remote but specifies Europe, while the candidate is based in the US and did not list Europe as an accepted location. |
| 2 | bootcamp_frontend | 1 (widened: role_pool) | RPA Developer (UIPath) at Southgeeks (Remote) | 2 | wrong_function | The candidate is a junior frontend developer with no RPA or UiPath experience, while the job requires 4+ years of UiPath development and deep RPA expertise. |
| 3 | devops_sre | 1 (widened: adjacent_titles) | Business Title IT Dev Senior (Software Engineer) - Contractor at Corpay (Europe Remote - Parking) | 2 | location_mismatch | The job is remote but specifically listed as Europe-based, while the candidate is only seeking US-based or remote US roles. |
| 4 | financial_analyst | 1 (widened: adjacent_titles) | Analyst, Financial Instruments & Technology at Kroll (New York, NY, United States) | 2 | unclear_job | The job posting lacks sufficient detail to determine the specific function or requirements for the Analyst, Financial Instruments & Technology role. |
| 5 | product_designer | 1 (widened: role_pool) | Senior Graphic Designer, Video Content at Interdependence (Remote) | 2 | location_mismatch | The job requires candidates to be based in Mumbai or surrounding cities, but the candidate is located in New York and did not list Mumbai as an accepted location. |
| 6 | senior_frontend | 1 (widened: adjacent_titles) | Business Title IT Dev Senior (Software Engineer) - Contractor at Corpay (Europe Remote - Parking) | 2 | location_mismatch | The job is remote but specifically listed as Europe Remote, while the candidate is based in the US and did not list Europe as an accepted location. |
| 7 | account_executive | 2 (widened: adjacent_titles) | Sales Development Representative at Interdependence (Remote) | 2 | wrong_seniority_too_senior | The candidate is a senior enterprise account executive, significantly overqualified for an SDR role focused on inbound lead qualification. |
| 8 | backend_platform_mid | 2 (widened: adjacent_titles) | Azure Infrastructure as Code Engineer (Contract, 25 hrs/week) at Stafford Gray (Miami, Florida, United States) | 2 | wrong_function | The candidate is a backend/software engineer, not a cloud infrastructure or Azure IaC specialist as required by the job. |
| 9 | bootcamp_frontend | 2 (widened: adjacent_titles) | Business Title IT Dev Senior (Software Engineer) - Contractor at Corpay (Europe Remote - Parking) | 2 | location_mismatch | The job is remote but specifies Europe, while the candidate is based in the US and only seeks US or specific US metro locations. |
| 10 | data_scientist_ml | 2 (widened: adjacent_titles) | Business Analyst at Teamliquid (State of São Paulo, Brazil) | 2 | location_mismatch | The job is remote but based in Brazil, and the candidate is only seeking roles in the US or remote US positions. |

## Spend

| Phase | Model | Calls | Prompt tokens (cached) | Completion tokens | USD |
|---|---|--:|--:|--:|--:|
| resume | gpt-4.1-mini | 17 | 27024 (11264) | 27309 | $0.0511 |
| resume | text-embedding-3-small | 17 | 8480 (0) | 0 | $0.0002 |
| understand | gpt-4.1-mini | 209 | 357847 (89856) | 96607 | $0.27 |
| understand | text-embedding-3-small | 208 | 50864 (0) | 0 | $0.0011 |
| shortlist | text-embedding-3-small | 35 | 14008 (0) | 0 | $0.0003 |
| judge | gpt-4.1 | 205 | 362611 (62464) | 8949 | $0.70 |
| unrecorded-concurrent-runs | estimate | 0 | 0 (0) | 0 | $0.60 |

The `unrecorded` row is a deliberate over-estimate for calls made by an aborted attempt whose ledger writes were lost (three runs overlapped by mistake); real usage of that attempt was well below it.

Total $1.63 against a cap of $9.00. Prices come from the table in packages/ai/src/config.ts and must be checked against the vendor before the dollars are relied on.

## Method notes

- Users, lanes, work authorisation and resumes are in `scripts/eval/profiles.json` and `scripts/eval/resumes/`; all people and employers in the resumes are fictional.
- The shortlist is `buildShortlist` with widening on, read back in the order the API serves it (lane matches first, then widened rows, each best fit first), top 20 rows. Rows are raw: the API additionally collapses the same company and title into one entry, which is why duplicates are reported on their own.
- The judge sees the resume, the profile (lanes, work authorisation, seniority) and the job title, company, location and the first 3,500 characters of the description; one call per (profile, job), cached in `scripts/eval/cache/judgments.json`.
- P@k divides by k even when fewer rows came back, so a short shortlist is penalised. nDCG@20 only ranks the rows that were returned; it does not see good jobs that were never retrieved.
- Reason codes describe the candidate against the job: `wrong_seniority_too_junior` means the candidate is too junior for the job, `wrong_seniority_too_senior` means the candidate is overqualified (the judge applied them this way consistently).
- A single LLM judge is not ground truth: expect a few points of noise and a bias towards keyword overlap. Treat differences of a few points between runs as noise.
