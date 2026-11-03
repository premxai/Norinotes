# Tailoring eval, run 4b

Generated 2026-11-03T05:48:03.581Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $2.26, spent $2.214 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 6 (6 shortlist pairs: each profile's best match and a middle one; 0 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 77.8% -> 85% -> 85% |
| Same, counting only the posting's exact spelling | 77.8% -> 85% |
| Supported must-haves whose key phrase appears verbatim, as written -> tailored | 57.3% -> 70.2% |
| Bullets opening in the present tense / summaries attaching years to a skill | 3 / 0 |
| Strong original opening verbs kept | 100% |
| Tacked-on key phrases / job-ad boilerplate fragments (both must be 0) | 0 / 0 |
| No-op rewrites skipped (kept as written) / offered | 8 / 32 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | 100% |
| Facts repeated across bullets / junk skills (category labels, degrees) / resumes without a name | 0 / 0 / 0 |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 0 |
| Words per bullet, all final bullets / rewritten ones | 19.1 / 20.3 |
| Opening-verb diversity (unique openers / bullets) | 0.9 |
| Bullets rewritten / offered / reverted after two failures | 12 / 32 / 12 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | null, null, null, null |
| Fabrications the judge listed | 0 |
| Tailoring cost per resume, mean / max | $0.0107 / $0.0150 |

## Compared with earlier runs

| Metric | Run 4 | Run 4b |
|---|---|---|
| Supported must-have coverage, as written -> tailored | 83.4% -> 93% | 77.8% -> 85% |
| Same, posting's exact spelling | 82.7% -> 92.4% | 77.8% -> 85% |
| Key phrase verbatim, as written -> tailored | 74.6% -> 84.4% | 57.3% -> 70.2% |
| Unsupported entities | 0 | 0 |
| Banned phrases | 0 | 0 |
| Strong original verbs kept | 99% | 100% |
| Tacked-on key phrases (must be 0) | 0 | 0 |
| Job-ad boilerplate fragments (must be 0) | 0 | 0 |
| No-op rewrites skipped (kept as written) | 61 | 8 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | 81% | 100% |
| Facts repeated across bullets / junk skills / resumes without a name | 0 / 0 / 0 | 0 / 0 / 0 |
| Words per bullet (all / rewritten) | 19.4 / 21.8 | 19.1 / 20.3 |
| Bullets rewritten / offered / reverted | 43 / 139 / 31 | 12 / 32 / 12 |
| Judge relevance / truthfulness / specificity / tone | 3.3 / 4.9 / 4 / 4.1 | null / null / null / null |
| Fabrications the judge listed | 2 | 0 |
| Pairs | 27 | 6 |
| Tailoring cost per resume, mean / max | $0.0111 / $0.0148 | $0.0107 / $0.0150 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 1/5, 1 reverted | 0 | n/a | $0.0060 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 80% -> 80% | 0/6, 2 reverted | 0 | n/a | $0.0075 |
| backend_platform_mid | top | Senior Software Engineer, ML Platform @ Dailypay | 57% -> 100% (57% -> 100%) of 7 | 29% -> 86% | 3/6, 3 reverted | 0 | n/a | $0.0150 |
| product_designer | top | Staff Product Designer @ F2 Ai | 80% -> 80% (80% -> 80%) of 5 | 60% -> 80% | 2/6, 4 reverted | 0 | n/a | $0.0142 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 50% (50% -> 50%) of 4 | 0% -> 0% | 5/5 | 0 | n/a | $0.0136 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 75% -> 75% | 1/4, 2 reverted | 0 | n/a | $0.0079 |

## Supported must-haves still not shown after tailoring

- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- product_designer (top): Strong portfolio demonstrating design thinking and problem solving
- account_executive (top): Ability to close complex deals; Experience in Higher Education vertical sales

## Adversarial pairs: gaps reported, nothing filled


## Judge notes and fabrications


## Unsupported entities found by the independent check

None.

## Examples

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior frontend engineer with 9 years of experience, working with JavaScript, TypeScript, React and Next.js. Tech lead for the merchant dashboard used by 120,000 merchants.

**account_executive**, Enterprise Account Executive, Higher Ed @ Boxinc

- Summary: Senior account executive in the enterprise account executive field with 7 years of experience, carrying a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts. Exceeded quota 7 of 10 quarters and earned President's Club 2024 and 2025.
- Before: Carry a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts (1,000 to 10,000 employees).
  After: Carried a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts with 1,000 to 10,000 employees.
- Before: President's Club 2024 and 2025.
  After: Achieved President's Club 2024 and 2025 awards.
- Before: Run discovery, demos with a sales engineer, security questionnaires and procurement negotiation; forecast weekly in Salesforce.
  After: Ran discovery, demos with a sales engineer, security questionnaires, procurement negotiation, and forecasted weekly in Salesforce.

**registered_nurse**, Registered Nurse | Chemo Infusion @ Elyb

- Summary: Registered nurse with 6 years of experience, working with patient assessment and patient education. Cared for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit.
- Before: Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol, and coordinate with cardiology.
  After: Cared for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpreted rhythms, titrated cardiac drips per protocol, and coordinated with cardiology.

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Computer science graduate and software engineer skilled in React, Node.js, and PostgreSQL. Built a REST endpoint in Python and PostgreSQL for clinic staff and delivered a real-time transit delay tracker web app with about 400 weekly users in the first month.
- Before: Ran weekly recitations for 40 students, wrote autograder scripts in Python, held office hours.
  After: Led weekly recitations for 40 students and wrote autograder scripts in Python to support student learning and assessment.


## Readability issues found

None.
