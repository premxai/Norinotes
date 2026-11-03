# Tailoring eval, run 3b

Generated 2026-11-03T05:27:16.616Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $1.81, spent $1.720 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 6 (6 shortlist pairs: each profile's best match and a middle one; 0 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 78.8% -> 83.5% -> 88.3% |
| Same, counting only the posting's exact spelling | 76.5% -> 86% |
| Supported must-haves whose key phrase appears verbatim, as written -> tailored | 64% -> 71% |
| Bullets opening in the present tense / summaries attaching years to a skill | 1 / 0 |
| Strong original opening verbs kept | 77% |
| Tacked-on key phrases / job-ad boilerplate fragments (both must be 0) | 0 / 0 |
| No-op rewrites skipped (kept as written) / offered | 8 / 34 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | 100% |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 0 |
| Words per bullet, all final bullets / rewritten ones | 21.3 / 22.4 |
| Opening-verb diversity (unique openers / bullets) | 1 |
| Bullets rewritten / offered / reverted after two failures | 20 / 34 / 6 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | 3.5, 4.8, 4, 4 |
| Fabrications the judge listed | 0 |
| Tailoring cost per resume, mean / max | $0.0135 / $0.0169 |

## Compared with earlier runs

| Metric | Run 1 | Run 2 | Run 3 | Run 3b |
|---|---|---|---|---|
| Supported must-have coverage, as written -> tailored | 80.5% -> 90.5% | 83.4% -> 96.2% | 83.4% -> 92.4% | 78.8% -> 88.3% |
| Same, posting's exact spelling | 80% -> 89.9% | 82.7% -> 95.5% | 82.7% -> 91.7% | 76.5% -> 86% |
| Key phrase verbatim, as written -> tailored | not measured | 74.6% -> 86.6% | 74.6% -> 83.9% | 64% -> 71% |
| Unsupported entities | 0 | 0 | 0 | 0 |
| Banned phrases | 0 | 1 | 0 | 0 |
| Strong original verbs kept | not measured | not measured | 99% | 77% |
| Tacked-on key phrases (must be 0) | n/a | n/a | 0 | 0 |
| Job-ad boilerplate fragments (must be 0) | n/a | n/a | 0 | 0 |
| No-op rewrites skipped (kept as written) | n/a | n/a | 87 | 8 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | not measured | not measured | 67% | 100% |
| Words per bullet (all / rewritten) | 19.3 / 21 | 19.7 / 21.3 | 19.2 / 22.2 | 21.3 / 22.4 |
| Bullets rewritten / offered / reverted | 117 / 140 / 23 | 120 / 137 / 16 | 32 / 141 / 22 | 20 / 34 / 6 |
| Judge relevance / truthfulness / specificity / tone | 2.9 / 4.7 / 3.6 / 3.7 | 3 / 4.8 / 3.8 / 3.8 | 3 / 4.7 / 3.8 / 3.7 | 3.5 / 4.8 / 4 / 4 |
| Fabrications the judge listed | 6 | 4 | 4 | 0 |
| Pairs | 27 | 26 | 27 | 6 |
| Tailoring cost per resume, mean / max | $0.0096 / $0.0135 | $0.0100 / $0.0139 | $0.0107 / $0.0163 | $0.0135 / $0.0169 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 3/5, 1 reverted | 0 | 3/4/4/4 | $0.0120 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 80% -> 80% | 1/6, 1 reverted | 0 | 4/5/4/4 | $0.0125 |
| data_scientist_ml | top | Data Scientist ll - RiskOS @ Socure | 43% -> 100% (29% -> 86%) of 7 | 29% -> 71% | 4/6, 2 reverted | 0 | 3/5/4/4 | $0.0169 |
| product_manager | top | Senior Product Manager @ Versapay | 100% -> 100% (100% -> 100%) of 4 | 100% -> 100% | 4/6 | 0 | 4/5/4/4 | $0.0116 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 50% (50% -> 50%) of 4 | 0% -> 0% | 5/5 | 0 | 4/5/4/4 | $0.0135 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 75% -> 75% | 3/6, 2 reverted | 0 | 3/5/4/4 | $0.0143 |

## Supported must-haves still not shown after tailoring

- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- account_executive (top): Ability to close complex deals; Experience in Higher Education vertical sales

## Adversarial pairs: gaps reported, nothing filled


## Judge notes and fabrications

- new_grad_swe (top): The tailored resume effectively highlights relevant skills and projects, but lacks direct experience with financial institutions or large-scale systems.
- senior_frontend (top): The tailored resume effectively highlights relevant experience and skills for the Reddit position, maintaining truthfulness and specificity.
- data_scientist_ml (top): The tailored resume aligns well with the job posting, emphasizing relevant skills and experience, but could better highlight specific fraud and risk experience.
- product_manager (top): The tailored resume effectively highlights relevant experience and skills for the Senior Product Manager role, maintaining truthfulness and specificity.
- account_executive (top): The tailored resume effectively highlights relevant experience and skills for the Enterprise Account Executive role, maintaining truthfulness and specificity.
- registered_nurse (top): The tailored resume is truthful and specific but lacks direct experience in oncology or infusion, which affects its relevance to the job posting.

## Unsupported entities found by the independent check

None.

## Examples

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior frontend engineer with 9 years of experience, working with JavaScript, TypeScript, React and Next.js. Tech lead for the merchant dashboard used by 120,000 merchants.
- Before: Built marketing sites and a CMS-driven web app in JavaScript, Sass and Node.
  After: Created marketing sites and a CMS-driven web app using JavaScript, Sass, and Node, implementing frontend features and styles for web applications.

**data_scientist_ml**, Data Scientist ll - RiskOS @ Socure

- Summary: Senior data scientist targeting data scientist roles, skilled in machine learning, Python, SQL, and scikit-learn. Built NLP models extracting variants from 200,000 clinical notes with 0.91 F1 and developed demand-forecasting and product-ranking systems.
- Before: Built demand-forecasting system for 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch; led A/B testing program with 25 experiments per quarter; productionised product-ranking model served via Python microservice on Kubernetes; mentored 2 junior data scientists; presented results to VP-level stakeholders.
  After: Built demand-forecasting system for 8,000 SKUs using Python with LightGBM and temporal fusion transformer, analyzing large, heterogeneous datasets to support A/B testing and production model deployment.
- Before: Served product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
  After: Served product-ranking model on Kubernetes via Python microservice processing large, heterogeneous datasets at 40 ms p95 latency, lifting conversion by 2.3%.
- Before: Reduced forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system of 8,000 SKUs.
  After: Reduced forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system processing large, heterogeneous datasets of 8,000 SKUs.

**product_manager**, Senior Product Manager @ Versapay

- Summary: Senior product manager targeting product manager roles, skilled in A/B Testing and Figma, who launched automated payment reminders after 20 customer interviews and a 6-week experiment. Owns the invoicing and collections product line and wrote the strategy and PRDs for a self-serve onboarding flow.
- Before: Own the invoicing and collections product line (ARR $38M); manage a squad of 7 engineers, 1 designer and 1 data analyst.
  After: Owned the invoicing and collections product line (ARR $38M) and managed a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Managed the reporting module for an HR platform with 900 enterprise customers; shipped a custom report builder used by 62% of accounts within 6 months.
  After: Delivered Product Management for the reporting module of an HR platform with 900 enterprise customers, launching a custom report builder used by 62% of accounts within 6 months.
- Before: Ran user research, triaged 300+ feature requests and ran sprint ceremonies.
  After: Conducted user research, triaged over 300 feature requests, and facilitated sprint ceremonies to support product development and Agile processes.

**account_executive**, Enterprise Account Executive, Higher Ed @ Boxinc

- Summary: Senior account executive targeting enterprise account executive roles, carrying a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts. Recognized with President's Club 2024 and 2025 and exceeded quota 7 of 10 quarters.
- Before: Carry a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts (1,000 to 10,000 employees).
  After: Carried a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts with 1,000 to 10,000 employees.
- Before: President's Club 2024 and 2025.
  After: Achieved President's Club 2024 and 2025 awards by consistently exceeding performance targets in a senior account executive role.
- Before: Run discovery, demos with a sales engineer, security questionnaires and procurement negotiation; forecast weekly in Salesforce.
  After: Conducted discovery, demos with a sales engineer, security questionnaires, and procurement negotiation; forecasted weekly in Salesforce.

**registered_nurse**, Registered Nurse | Chemo Infusion @ Elyb

- Summary: Registered nurse targeting registered nurse roles, skilled in patient assessment and patient education. Precepted new graduate nurses and cared for post-operative adult patients while providing care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit.
- Before: Provided nursing assistant support at Lakeshore Regional Hospital.
  After: Supported nursing care by assisting patients with daily living activities and collaborating with the healthcare team at Lakeshore Regional Hospital.
- Before: Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol, and coordinate with cardiology.
  After: Provided care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpreted rhythms, titrated cardiac drips per protocol, and coordinated with cardiology.
- Before: Cared for post-operative adult patients (orthopedics and general surgery); wound care, pain management, IV therapy, discharge teaching. Float pool volunteer to ICU step-down during 2021 surge.
  After: Cared for post-operative adult patients in orthopedics and general surgery, providing wound care, pain management, IV therapy, and patient education including discharge teaching.

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Computer science graduate targeting software engineer roles, working with React, Node.js and PostgreSQL. Created a REST endpoint in Python and PostgreSQL that lets clinic staff export appointment reports, cutting manual report requests to the data team by about 30 per week.
- Before: Ran weekly recitations for 40 students, wrote autograder scripts in Python, held office hours.
  After: Ran weekly recitations for 40 students, wrote autograder scripts in Python, and held office hours to assist students with coursework.
- Before: Built a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports; cut manual report requests to the data team by about 30 per week.
  After: Implemented a REST endpoint in Python (FastAPI) and PostgreSQL for clinic staff to export appointment reports, cutting manual report requests to the data team by about 30 per week.
- Before: Built a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports; cut manual report requests to the data team by about 30 per week.
  After: Created a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports, cutting manual report requests to the data team by about 30 per week.


## Readability issues found

None.
