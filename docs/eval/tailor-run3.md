# Tailoring eval, run 3

Generated 2026-11-03T05:22:03.157Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $1.81, spent $1.611 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 27 (24 shortlist pairs: each profile's best match and a middle one; 3 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 83.4% -> 91.7% -> 92.4% |
| Same, counting only the posting's exact spelling | 82.7% -> 91.7% |
| Supported must-haves whose key phrase appears verbatim, as written -> tailored | 74.6% -> 83.9% |
| Bullets opening in the present tense / summaries attaching years to a skill | 9 / 0 |
| Strong original opening verbs kept | 99% |
| Tacked-on key phrases / job-ad boilerplate fragments (both must be 0) | 0 / 0 |
| No-op rewrites skipped (kept as written) / offered | 87 / 141 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | 67% |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 0 |
| Words per bullet, all final bullets / rewritten ones | 19.2 / 22.2 |
| Opening-verb diversity (unique openers / bullets) | 0.9 |
| Bullets rewritten / offered / reverted after two failures | 32 / 141 / 22 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | 3, 4.7, 3.8, 3.7 |
| Fabrications the judge listed | 4 |
| Tailoring cost per resume, mean / max | $0.0107 / $0.0163 |

## Compared with earlier runs

| Metric | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Supported must-have coverage, as written -> tailored | 80.5% -> 90.5% | 83.4% -> 96.2% | 83.4% -> 92.4% |
| Same, posting's exact spelling | 80% -> 89.9% | 82.7% -> 95.5% | 82.7% -> 91.7% |
| Key phrase verbatim, as written -> tailored | not measured | 74.6% -> 86.6% | 74.6% -> 83.9% |
| Unsupported entities | 0 | 0 | 0 |
| Banned phrases | 0 | 1 | 0 |
| Strong original verbs kept | not measured | not measured | 99% |
| Tacked-on key phrases (must be 0) | n/a | n/a | 0 |
| Job-ad boilerplate fragments (must be 0) | n/a | n/a | 0 |
| No-op rewrites skipped (kept as written) | n/a | n/a | 87 |
| Summaries in shape (2 sentences, 25 to 45 words, no parentheses) | not measured | not measured | 67% |
| Words per bullet (all / rewritten) | 19.3 / 21 | 19.7 / 21.3 | 19.2 / 22.2 |
| Bullets rewritten / offered / reverted | 117 / 140 / 23 | 120 / 137 / 16 | 32 / 141 / 22 |
| Judge relevance / truthfulness / specificity / tone | 2.9 / 4.7 / 3.6 / 3.7 | 3 / 4.8 / 3.8 / 3.8 | 3 / 4.7 / 3.8 / 3.7 |
| Fabrications the judge listed | 6 | 4 | 4 |
| Pairs | 27 | 26 | 27 |
| Tailoring cost per resume, mean / max | $0.0096 / $0.0135 | $0.0100 / $0.0139 | $0.0107 / $0.0163 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 0/5, 1 reverted | 0 | 3/4/4/4 | $0.0111 |
| new_grad_swe | middle | Software Engineer II (Fullstack), Digital Storefront @ Toast | 50% -> 75% (50% -> 75%) of 4 | 50% -> 75% | 0/5, 1 reverted | 0 | 3/5/4/4 | $0.0099 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 80% -> 80% | 0/6 | 0 | 4/5/5/5 | $0.0105 |
| senior_frontend | middle | Senior Software Engineer, Developer Productivity @ Sprig | 88% -> 100% (88% -> 100%) of 8 | 88% -> 88% | 1/6, 1 reverted | 0 | 3/5/4/4 | $0.0117 |
| backend_platform_mid | top | Senior Software Engineer, ML Platform @ Dailypay | 43% -> 86% (43% -> 86%) of 7 | 29% -> 71% | 0/6, 2 reverted | 0 | 3/5/4/4 | $0.0124 |
| backend_platform_mid | middle | Senior Software Engineer (Backend) @ Vclusterlabs | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 1/6 | 0 | 4/4/4/4 | $0.0107 |
| data_scientist_ml | top | Data Scientist ll - RiskOS @ Socure | 43% -> 86% (29% -> 71%) of 7 | 29% -> 71% | 4/6, 2 reverted | 0 | 3/5/4/4 | $0.0163 |
| data_scientist_ml | middle | Sr Data Engineer @ Meridianlink | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 0/6 | 0 | 3/5/4/4 | $0.0121 |
| product_manager | top | Senior Product Manager @ Versapay | 100% -> 100% (100% -> 100%) of 4 | 100% -> 100% | 3/6, 1 reverted | 0 | 4/5/4/4 | $0.0114 |
| product_manager | middle | OP Labs - Sr. Product Manager, Fintechs & Exchanges @ Decirc | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 2/6 | 0 | 3/5/4/4 | $0.0110 |
| product_designer | top | Staff Product Designer @ F2 Ai | 80% -> 80% (80% -> 80%) of 5 | 60% -> 80% | 3/6, 3 reverted | 0 | 4/4/4/4 | $0.0132 |
| product_designer | middle | Sr. Designer, Multidisciplinary @ Gmrmarketing | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 0/6 | 0 | 2/3/3/3 | $0.0105 |
| devops_sre | top | DevOps Engineer @ Merge | 100% -> 100% (100% -> 100%) of 5 | 80% -> 80% | 1/6 | 0 | 5/5/5/5 | $0.0118 |
| devops_sre | middle | Senior Infrastructure Engineer @ Axion | 100% -> 100% (100% -> 100%) of 5 | 100% -> 100% | 1/5 | 0 | 4/5/5/5 | $0.0092 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 50% (50% -> 50%) of 4 | 0% -> 0% | 2/5, 1 reverted | 0 | 4/5/4/4 | $0.0119 |
| account_executive | middle | Enterprise Sales Development Representative @ Smartlyio | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 2/5, 1 reverted | 0 | 3/4/4/4 | $0.0096 |
| marketing_manager | top | Director, Demand Generation @ Kpaonline | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 1/5 | 0 | 3/4/3/3 | $0.0107 |
| marketing_manager | middle | Senior Growth Analyst @ Roo | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 2/4, 1 reverted | 0 | 2/5/3/3 | $0.0093 |
| financial_analyst | top | Senior Financial Analyst, Category Finance – Away from Home  | 75% -> 75% (75% -> 75%) of 4 | 50% -> 50% | 3/6, 1 reverted | 0 | 4/5/4/4 | $0.0101 |
| financial_analyst | middle | Senior Financial Analyst (Hybrid) @ Rewardsnetwork | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 1/5 | 0 | 3/5/4/4 | $0.0090 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 75% -> 75% | 2/6, 2 reverted | 0 | 3/5/4/4 | $0.0136 |
| registered_nurse | middle | Registered Nurse / Orthopedics @ Elyb | 75% -> 100% (75% -> 100%) of 4 | 50% -> 75% | 0/5, 3 reverted | 0 | 4/5/4/4 | $0.0121 |
| bootcamp_frontend | top | Design Engineer @ Method | 50% -> 100% (50% -> 100%) of 2 | 50% -> 100% | 1/4 | 0 | 2/4/3/3 | $0.0088 |
| bootcamp_frontend | middle | Program Engineer @ Designedconveyorsystems | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 0/2 | 0 | 2/5/3/3 | $0.0057 |
| registered_nurse | adversarial | Senior Software Engineer, ML Platform @ Dailypay | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 0/4, 2 reverted | 0 | 1/5/2/2 | $0.0097 |
| financial_analyst | adversarial | Staff Product Designer @ F2 Ai | 100% -> 100% (100% -> 100%) of 1 | 0% -> 100% | 2/5 | 0 | 1/5/3/3 | $0.0092 |
| senior_frontend | adversarial | Registered Nurse / Chemo Infusion @ Elyb | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 0/4 | 0 | 1/5/3/2 | $0.0073 |

## Supported must-haves still not shown after tailoring

- new_grad_swe (middle): Experience developing full stack web applications
- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- backend_platform_mid (top): Experience building and operating production services
- data_scientist_ml (top): Experience with fraud, risk, trust & safety, or workforce/hiring analytics
- product_designer (top): Strong portfolio demonstrating design thinking and problem solving
- account_executive (top): Ability to close complex deals; Experience in Higher Education vertical sales
- financial_analyst (top): BS in Finance, Accounting, Economics, or related field

## Adversarial pairs: gaps reported, nothing filled

- **registered_nurse** for Senior Software Engineer, ML Platform @ Dailypay: 0 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years professional software engineering experience; Proficiency in Python (lacks Python); Experience building and operating production services; Strong cloud platform proficiency (AWS preferred) (lacks AWS); Experience with distributed systems and service-oriented architecture (lacks distributed systems); Experience with infrastructure-as-code (Terraform or CloudFormation) (lacks infrastructure-as-code, Terraform). Judge: The tailored resume is irrelevant to the job posting, as it focuses on nursing experience rather than software engineering or ML platform skills.
- **financial_analyst** for Staff Product Designer @ F2 Ai: 2 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years of experience in product design or UX/UI (lacks UX, UI); Strong portfolio demonstrating design thinking and problem solving; Experience leading end-to-end design across features; Experience with SaaS products and/or AI-driven tools (lacks SaaS, AI); product design (lacks product design); UX/UI design (lacks UX/UI design, UX, UI design). Judge: The tailored resume does not align with the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.
- **senior_frontend** for Registered Nurse | Chemo Infusion @ Elyb: 0 bullets rewritten, 0 unsupported entities. Must-have gaps: Graduate from a nursing program; Current licensure as a registered nurse in Minnesota (lacks registered nurse); Current American Heart Association BLS Healthcare Provider card (lacks BLS); Obtain Oncology Nurse Society Chemotherapy provider card within 6 months of hire; Maintain current Oncology Nurse Society provider card at all times; nursing (lacks nursing). Judge: The tailored resume is completely irrelevant to the job posting for a Registered Nurse position, as it focuses on software engineering experience and skills.

## Judge notes and fabrications

- new_grad_swe (top): The tailored resume effectively highlights relevant skills and projects but could better emphasize experience with scalable architectures and direct customer interaction.
- new_grad_swe (middle): The tailored resume is truthful and specific, but could better highlight full-stack experience and relevant technologies like React and Node.js upfront for stronger relevance.
- senior_frontend (top): The tailored resume effectively highlights relevant experience and skills for the Reddit position, maintaining truthfulness and specificity throughout.
- senior_frontend (middle): The tailored resume aligns well with the job posting, emphasizing relevant skills and experience, but lacks direct mention of build systems or CI/CD expertise.
- backend_platform_mid (top): The tailored resume effectively highlights relevant skills and experience, but lacks direct ML platform experience, which is crucial for the role.
- backend_platform_mid (middle): The tailored resume effectively highlights relevant Kubernetes and Go experience, but slightly exaggerates the candidate's total experience. Fabrications listed: 6 years of experience (original resume shows 5 years)
- data_scientist_ml (top): The tailored resume effectively highlights relevant skills and experience in machine learning and NLP, but lacks direct mention of fraud detection or identity verification, which are key to the job posting.
- data_scientist_ml (middle): The tailored resume effectively highlights relevant skills and experience for the Sr Data Engineer role, but could better emphasize ETL and data pipeline experience.
- product_manager (top): The tailored resume effectively highlights relevant experience and skills for the Senior Product Manager role, with no fabrications and good specificity.
- product_manager (middle): The tailored resume is truthful and specific but lacks direct relevance to the blockchain and DeFi focus of the job posting.
- product_designer (top): The tailored resume effectively aligns with the job posting, emphasizing relevant skills and experiences, but slightly exaggerates the candidate's experience duration. Fabrications listed: 8 years of experience (original resume states 6 years)
- product_designer (middle): The tailored resume repeats some achievements and inflates experience, but lacks alignment with the job's multidisciplinary and experiential focus. Fabrications listed: 8 years of experience (original resume shows 6 years)
- devops_sre (top): The tailored resume effectively highlights relevant experience and skills for the DevOps Engineer position, maintaining truthfulness and specificity throughout.
- devops_sre (middle): The tailored resume effectively highlights relevant experience and skills for the Senior Infrastructure Engineer role, with no fabrications and strong specificity.
- account_executive (top): The tailored resume effectively highlights relevant experience and skills for the Enterprise Account Executive role, maintaining truthfulness and specificity.
- account_executive (middle): The tailored resume effectively highlights relevant experience and skills, but misrepresents the candidate's current role focus. Fabrications listed: Targeting enterprise sales development representative roles
- marketing_manager (top): The tailored resume aligns with the job posting but lacks emphasis on strategic leadership and multi-year planning experience, which are crucial for the Director role.
- marketing_manager (middle): The tailored resume lacks relevance to the Senior Growth Analyst role, focusing more on marketing experience rather than data analysis and growth metrics.
- financial_analyst (top): The tailored resume effectively highlights relevant experience and skills for the Senior Financial Analyst role, with no fabrications and good specificity.
- financial_analyst (middle): The tailored resume aligns well with the job posting but lacks emphasis on collaboration with marketing and partnerships, which is crucial for the role.
- registered_nurse (top): The tailored resume effectively highlights relevant nursing experience and skills, but lacks specific mention of oncology or infusion experience, which are key to the job posting.
- registered_nurse (middle): The tailored resume effectively highlights relevant orthopedic and nursing experience, maintaining truthfulness and specificity, but could better emphasize orthopedic-specific skills.
- bootcamp_frontend (top): The tailored resume lacks relevance to the Design Engineer role, focusing more on teaching and basic frontend skills rather than design and engineering expertise.
- bootcamp_frontend (middle): The tailored resume lacks relevance to the Program Engineer role, focusing more on teaching and frontend development rather than program management and engineering oversight.
- registered_nurse (adversarial): The tailored resume is irrelevant to the job posting, as it focuses on nursing experience rather than software engineering or ML platform skills.
- financial_analyst (adversarial): The tailored resume does not align with the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.
- senior_frontend (adversarial): The tailored resume is completely irrelevant to the job posting for a Registered Nurse position, as it focuses on software engineering experience and skills.

## Unsupported entities found by the independent check

None.

## Examples

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior frontend engineer with 9 years of experience, working with JavaScript, TypeScript, React and Next.js. Tech lead for the merchant dashboard (React, TypeScript, GraphQL, Next.js) used by 120,000 merchants; led a team of 5.

**data_scientist_ml**, Data Scientist ll - RiskOS @ Socure

- Summary: Senior data scientist targeting data scientist roles with skills in machine learning, Python, SQL, and scikit-learn, and a strength in developing NLP models for large, heterogeneous datasets. Experience includes building demand-forecasting systems and productionizing models with measurable business impact, including lifting conversion by 2.3%.
- Before: Built demand-forecasting system for 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch; led A/B testing program with 25 experiments per quarter; productionised product-ranking model served via Python microservice on Kubernetes; mentored 2 junior data scientists; presented results to VP-level stakeholders.
  After: Built demand-forecasting system for large, heterogeneous datasets of 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch; productionised product-ranking model served via Python microservice on Kubernetes.
- Before: Served product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
  After: Served product-ranking model for large, heterogeneous datasets via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
- Before: Reduced forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system of 8,000 SKUs.
  After: Reduced forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system of large, heterogeneous datasets of 8,000 SKUs.

**product_manager**, Senior Product Manager @ Versapay

- Summary: Senior product manager with 7 years of experience, working with A/B Testing, Figma, Product Management and Stakeholder Management. Owned the invoicing and collections product line (ARR $38M) and managed a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Own the invoicing and collections product line (ARR $38M); manage a squad of 7 engineers, 1 designer and 1 data analyst.
  After: Owned the invoicing and collections product line (ARR $38M) and managed a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Managed the reporting module for an HR platform with 900 enterprise customers; shipped a custom report builder used by 62% of accounts within 6 months.
  After: Managed the reporting module for an HR platform with 900 enterprise customers and shipped a custom report builder used by 62% of accounts within 6 months.
- Before: Managed the reporting module for an HR platform with 900 enterprise customers; shipped a custom report builder used by 62% of accounts within 6 months.
  After: Drove Product Management for the reporting module of an HR platform with 900 enterprise customers, shipping a custom report builder used by 62% of accounts within 6 months.

**account_executive**, Enterprise Account Executive, Higher Ed @ Boxinc

- Summary: Senior account executive with 7 years of experience. Carry a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts (1,000 to 10,000 employees).
- Before: Run discovery, demos with a sales engineer, security questionnaires and procurement negotiation; forecast weekly in Salesforce.
  After: Ran discovery, demos with a sales engineer, security questionnaires, procurement negotiation, and forecasted weekly in Salesforce.
- Before: Booked 25+ qualified meetings per month through outbound calls, email and LinkedIn; 118% of target.
  After: Booked 25+ qualified meetings per month through outbound calls, email, and LinkedIn, achieving 118% of target.

**registered_nurse**, Registered Nurse | Chemo Infusion @ Elyb

- Summary: Registered nurse with 6 years of experience, working with nursing, patient assessment, BSN and patient education. Precept new graduate nurses (5 in 2025); led a unit project that reduced falls by 28% with hourly rounding. Epic and Pyxis proficiency.
- Before: Cared for post-operative adult patients (orthopedics and general surgery); wound care, pain management, IV therapy, discharge teaching. Float pool volunteer to ICU step-down during 2021 surge.
  After: Delivered patient education and care for post-operative adult patients in orthopedics and general surgery, including wound care, pain management, IV therapy, and discharge teaching as a registered nurse.
- Before: Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol, and coordinate with cardiology.
  After: Cared for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpreted rhythms, titrated cardiac drips per protocol, and coordinated with cardiology.

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Computer science graduate targeting software engineer roles, working with React, Node.js and PostgreSQL. Built a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports; cut manual report requests to the data team by about 30 per week.


## Readability issues found

None.


## Notes (written by hand after the runs)

Run 3 is the full 27-pair run of the first round-3 pipeline ($0.42). It exposed two problems, which were fixed and
checked on smaller runs with what was left of the $1.81 cap: run 3b (6 top pairs, one per profession in the examples,
$0.11, docs/eval/tailor-run3b.md) and run 3c (4 top pairs, $0.07, docs/eval/tailor-run3c.md). The eval has now spent
$1.79 of $1.81 across all runs. Small runs are not directly comparable with the 27-pair ones: they contain only top pairs.

### Runs 1 to 3c side by side

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

### What each run showed

- **Run 3 (27 pairs).** The new rules held: 0 tacked-on phrases, 0 boilerplate fragments, 99% of strong original verbs
  kept, 0 unsupported entities, 0 banned phrases. But the no-op rule was far too eager: 87 of 141 offered bullets kept
  as written, including present-tense originals the model returned unchanged (9 present-tense openers), so coverage
  gained less than in run 2 (92.4% against 96.2%; key phrase 83.9% against 86.6%). Only 67% of summaries were in shape:
  most model summaries failed the new gate (job-ad wording such as "expertise in" and "demonstrated", a skill that
  bullets already used 3 times, 46 to 48 words), and the facts-only fallback copied bullet text with parentheses and
  semicolons, read "OP Labs" as the role in "OP Labs - Sr. Product Manager", and listed fields such as "BSN" or "Finance"
  as skills.
- **Fixes, then run 3b (6 pairs).** Each offered bullet now carries `add` (posting terms and phrases its source supports
  that the text lacks) and `fix` (tense, too long, generic wording, a repeated opening verb); an unchanged return counts
  as kept only when there is nothing to fix. One summary mention of a skill is always allowed. The role is read from the
  part of the title that names a role. Facts summaries use one clean past-tense sentence and skip fields and degrees.
  Result: summaries 100% in shape, judge 3.5 / 4.8 / 4.0 / 4.0, 0 judge-listed fabrications. New problems: one key phrase
  carried onto three bullets ("large, heterogeneous datasets"), short bullets padded to reach 16 words ("by consistently
  exceeding performance targets", not in the source), a line shown twice in the new-grad resume, and fields used as
  objects ("Delivered Product Management for the reporting module").
- **Fixes, then run 3c (4 pairs).** Each posting phrase may go on one bullet only (gate rule), a short original may
  stay short (the floor is its own length) and the prompt forbids padding, identical lines are shown once, fields and
  degrees are not offered as bullet terms, and "managed" counts as a strong verb. Result: judge truthfulness 5.0, 0
  fabrications, every summary in shape, but on these four already well-covered pairs no coverage was gained: 12 of 22
  offered bullets stayed as written. After 3c the summary gate also rejects a summary that names the role twice
  ("Registered nurse in the registered nurse field", seen in 3c); unit-tested, not re-measured.

### Sample PDFs

`data/samples/tailored-senior_frontend-before.pdf` and `-after.pdf`, `data/samples/tailored-registered_nurse-before.pdf`
and `-after.pdf`, ATS Standard template, from run 3c. "Before" is the career points as the person wrote them (latest
roles in date order, their own lines and skills list, no summary); "after" is the tailored resume.

### Open issues

- The balance between keeping the person's words and mirroring the posting now leans to keeping: on run 3c's pairs the
  verbatim key-phrase share did not move (63.8%). Rewrites happen only when a bullet has something to add or fix; the
  critique round is the remaining lever for phrase gaps. Worth tuning on the next budget.
- The gate cannot see invented descriptive detail (no new term, number or name), such as padding; the prompt and the
  short-bullet rule reduce it, and the critique can flag it, but nothing deterministic blocks it.

### Six examples across professions

**senior_frontend** for Senior Frontend Software Engineer, Consumer Engineering @ Reddit (run 3c)

- Summary: Senior frontend engineer with 9 years of experience, working with JavaScript, TypeScript, React and Next.js. Tech lead for the merchant dashboard used by 120,000 merchants.
- Before: Built interactive charting for a business intelligence product with D3 and React; handled tables of 1M+ rows with virtualization.
  After: Created interactive charting for a business intelligence product with D3 and React; handled tables of 1M+ rows with virtualization.

**data_scientist_ml** for Data Scientist ll - RiskOS @ Socure (run 3b)

- Summary: Senior data scientist targeting data scientist roles, skilled in machine learning, Python, SQL, and scikit-learn. Built NLP models extracting variants from 200,000 clinical notes with 0.91 F1 and developed demand-forecasting and product-ranking systems.
- Before: Built demand-forecasting system for 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch; led A/B testing program with 25 experiments per quarter; productionised product-ranking model served via Python microservice on Kubernetes; mentored 2 junior data scientists; presented results to VP-level stakeholders.
  After: Built demand-forecasting system for 8,000 SKUs using Python with LightGBM and temporal fusion transformer, analyzing large, heterogeneous datasets to support A/B testing and production model deployment.
- Before: Served product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
  After: Served product-ranking model on Kubernetes via Python microservice processing large, heterogeneous datasets at 40 ms p95 latency, lifting conversion by 2.3%.

**product_manager** for Senior Product Manager @ Versapay (run 3b)

- Summary: Senior product manager targeting product manager roles, skilled in A/B Testing and Figma, who launched automated payment reminders after 20 customer interviews and a 6-week experiment. Owns the invoicing and collections product line and wrote the strategy and PRDs for a self-serve onboarding flow.
- Before: Own the invoicing and collections product line (ARR $38M); manage a squad of 7 engineers, 1 designer and 1 data analyst.
  After: Owned the invoicing and collections product line (ARR $38M) and managed a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Managed the reporting module for an HR platform with 900 enterprise customers; shipped a custom report builder used by 62% of accounts within 6 months.
  After: Delivered Product Management for the reporting module of an HR platform with 900 enterprise customers, launching a custom report builder used by 62% of accounts within 6 months.

**account_executive** for Enterprise Account Executive, Higher Ed @ Boxinc (run 3c)

- Summary: Senior account executive targeting enterprise account executive roles with a record of carrying a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts. Recognized for President's Club 2024 and 2025 and exceeding quota 7 of 10 quarters.
- Before: Carry a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts (1,000 to 10,000 employees).
  After: Carried a $1.6M annual quota selling a cloud security platform to mid-market and enterprise accounts with 1,000 to 10,000 employees.
- Before: President's Club 2024 and 2025.
  After: Achieved President's Club 2024 and 2025 awards.

**registered_nurse** for Registered Nurse | Chemo Infusion @ Elyb (run 3c)

- Summary: Registered nurse in the registered nurse field with patient assessment and patient education skills, precepted new graduate nurses, and cared for post-operative adult patients. Provided care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit.
- Before: Provide care for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit; interpret rhythms, titrate cardiac drips per protocol, and coordinate with cardiology.
  After: Cared for 4 to 5 patients per shift on a 32-bed cardiac telemetry unit, interpreted rhythms, titrated cardiac drips per protocol, and coordinated with cardiology.

**new_grad_swe** for Software Engineer, Product @ Prelim (run 3c)

- Summary: Computer science graduate targeting software engineer roles, working with React, Node.js and PostgreSQL. Built a REST endpoint in Python and PostgreSQL that lets clinic staff export appointment reports.
- No bullet rewritten: every offered bullet already carried the posting terms its source supports, so the person's own words were kept.

