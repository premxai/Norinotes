# Tailoring eval, run 3c

Generated 2026-11-03T05:31:48.388Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $1.81, spent $1.788 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 4 (4 shortlist pairs: each profile's best match and a middle one; 0 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 82.5% -> 82.5% -> 82.5% |
| Same, counting only the posting's exact spelling | 82.5% -> 82.5% |
| Supported must-haves whose key phrase appears verbatim, as written -> tailored | 63.8% -> 63.8% |
| Bullets opening in the present tense / summaries attaching years to a skill | 1 / 0 |
| Strong original opening verbs kept | 88% |
| Tacked-on key phrases / job-ad boilerplate fragments (both must be 0) | 0 / 0 |
| No-op rewrites skipped (kept as written) / offered | 12 / 22 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | 100% |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 0 |
| Words per bullet, all final bullets / rewritten ones | 19.1 / 19.8 |
| Opening-verb diversity (unique openers / bullets) | 1 |
| Bullets rewritten / offered / reverted after two failures | 6 / 22 / 4 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | 3.5, 5, 4, 4 |
| Fabrications the judge listed | 0 |
| Tailoring cost per resume, mean / max | $0.0122 / $0.0139 |

## Compared with earlier runs

| Metric | Run 1 | Run 2 | Run 3 | Run 4 | Run 3c |
|---|---|---|---|---|---|
| Supported must-have coverage, as written -> tailored | 80.5% -> 90.5% | 83.4% -> 96.2% | 83.4% -> 92.4% | 78.8% -> 88.3% | 82.5% -> 82.5% |
| Same, posting's exact spelling | 80% -> 89.9% | 82.7% -> 95.5% | 82.7% -> 91.7% | 76.5% -> 86% | 82.5% -> 82.5% |
| Key phrase verbatim, as written -> tailored | not measured | 74.6% -> 86.6% | 74.6% -> 83.9% | 64% -> 71% | 63.8% -> 63.8% |
| Unsupported entities | 0 | 0 | 0 | 0 | 0 |
| Banned phrases | 0 | 1 | 0 | 0 | 0 |
| Strong original verbs kept | not measured | not measured | 99% | 77% | 88% |
| Tacked-on key phrases (must be 0) | n/a | n/a | 0 | 0 | 0 |
| Job-ad boilerplate fragments (must be 0) | n/a | n/a | 0 | 0 | 0 |
| No-op rewrites skipped (kept as written) | n/a | n/a | 87 | 8 | 12 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | not measured | not measured | 67% | 100% | 100% |
| Words per bullet (all / rewritten) | 19.3 / 21 | 19.7 / 21.3 | 19.2 / 22.2 | 21.3 / 22.4 | 19.1 / 19.8 |
| Bullets rewritten / offered / reverted | 117 / 140 / 23 | 120 / 137 / 16 | 32 / 141 / 22 | 20 / 34 / 6 | 6 / 22 / 4 |
| Judge relevance / truthfulness / specificity / tone | 2.9 / 4.7 / 3.6 / 3.7 | 3 / 4.8 / 3.8 / 3.8 | 3 / 4.7 / 3.8 / 3.7 | 3.5 / 4.8 / 4 / 4 | 3.5 / 5 / 4 / 4 |
| Fabrications the judge listed | 6 | 4 | 4 | 0 | 0 |
| Pairs | 27 | 26 | 27 | 6 | 4 |
| Tailoring cost per resume, mean / max | $0.0096 / $0.0135 | $0.0100 / $0.0139 | $0.0107 / $0.0163 | $0.0135 / $0.0169 | $0.0122 / $0.0139 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 0/5, 1 reverted | 0 | 3/5/4/4 | $0.0101 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 80% -> 80% | 1/6, 1 reverted | 0 | 4/5/4/4 | $0.0115 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 50% (50% -> 50%) of 4 | 0% -> 0% | 4/5 | 0 | 4/5/4/4 | $0.0132 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 75% -> 75% | 1/6, 2 reverted | 0 | 3/5/4/4 | $0.0139 |

## Supported must-haves still not shown after tailoring

- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- account_executive (top): Ability to close complex deals; Experience in Higher Education vertical sales

## Adversarial pairs: gaps reported, nothing filled


## Judge notes and fabrications

- new_grad_swe (top): The tailored resume effectively highlights relevant skills and experience, but could better emphasize system design and scalability expertise.
- senior_frontend (top): The tailored resume effectively highlights relevant experience and skills for the Reddit position, maintaining truthfulness and specificity.
- account_executive (top): The tailored resume effectively highlights relevant experience and skills for the Enterprise Account Executive role, maintaining truthfulness and specificity.
- registered_nurse (top): The tailored resume is truthful and specific, but lacks direct experience in oncology or infusion, which affects its relevance to the job posting.

## Unsupported entities found by the independent check

None.

## Examples

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior frontend engineer with 9 years of experience, working with JavaScript, TypeScript, React and Next.js. Tech lead for the merchant dashboard used by 120,000 merchants.
- Before: Built interactive charting for a business intelligence product with D3 and React; handled tables of 1M+ rows with virtualization.
  After: Created interactive charting for a business intelligence product with D3 and React; handled tables of 1M+ rows with virtualization.

**account_executive**, Enterprise Account Executive, Higher Ed @ Boxinc

- Summary: Senior account executive targeting enterprise account executive roles with a record of carrying a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts. Recognized for President's Club 2024 and 2025 and exceeding quota 7 of 10 quarters.
- Before: Carry a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts (1,000 to 10,000 employees).
  After: Carried a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts with 1,000 to 10,000 employees.
- Before: President's Club 2024 and 2025.
  After: Achieved President's Club 2024 and 2025 awards.
- Before: Run discovery, demos with a sales engineer, security questionnaires and procurement negotiation; forecast weekly in Salesforce.
  After: Ran discovery, demos with a sales engineer, security questionnaires, procurement negotiation, and forecasted weekly in Salesforce.

**registered_nurse**, Registered Nurse | Chemo Infusion @ Elyb

- Summary: Registered nurse in the registered nurse field with patient assessment and patient education skills, precepted new graduate nurses, and cared for post-operative adult patients. Provided care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit.
- Before: Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol, and coordinate with cardiology.
  After: Cared for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit, interpreted rhythms, titrated cardiac drips per protocol, and coordinated with cardiology.

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Computer science graduate targeting software engineer roles, working with React, Node.js and PostgreSQL. Built a REST endpoint in Python and PostgreSQL that lets clinic staff export appointment reports.


## Readability issues found

None.
