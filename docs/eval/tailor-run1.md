# Tailoring eval, run 1

Generated 2026-11-03T04:10:50.052Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $1, spent $0.811 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 27 (24 shortlist pairs: each profile's best match and a middle one; 3 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 80.5% -> 88.7% -> 90.5% |
| Same, counting only the posting's exact spelling | 80% -> 89.9% |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 0 |
| Words per bullet, all final bullets / rewritten ones | 19.3 / 21 |
| Opening-verb diversity (unique openers / bullets) | 1 |
| Bullets rewritten / offered / reverted after two failures | 117 / 140 / 23 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | 2.9, 4.7, 3.6, 3.7 |
| Fabrications the judge listed | 6 |
| Tailoring cost per resume, mean / max | $0.0096 / $0.0135 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 5/5 | 0 | 3/4/3/4 | $0.0090 |
| new_grad_swe | middle | Software Engineer II (Fullstack), Digital Storefront @ Toast | 50% -> 100% (50% -> 100%) of 4 | 5/5 | 0 | 3/5/4/4 | $0.0089 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 4/6, 2 reverted | 0 | 4/5/4/4 | $0.0104 |
| senior_frontend | middle | Senior Software Engineer, Developer Productivity @ Sprig | 88% -> 100% (88% -> 100%) of 8 | 4/6, 2 reverted | 0 | 3/5/4/4 | $0.0100 |
| backend_platform_mid | top | Senior Software Engineer, ML Platform @ Dailypay | 43% -> 100% (43% -> 100%) of 7 | 6/6 | 0 | 3/5/4/4 | $0.0107 |
| backend_platform_mid | middle | Senior Software Engineer (Backend) @ Vclusterlabs | 40% -> 40% (40% -> 40%) of 5 | 5/5 | 0 | 3/4/4/4 | $0.0091 |
| data_scientist_ml | top | Data Scientist ll - RiskOS @ Socure | 38% -> 63% (25% -> 50%) of 8 | 5/6, 1 reverted | 0 | 3/5/4/4 | $0.0135 |
| data_scientist_ml | middle | Sr Data Engineer @ Meridianlink | 100% -> 100% (100% -> 100%) of 2 | 4/6, 2 reverted | 0 | 3/5/4/4 | $0.0119 |
| product_manager | top | Senior Product Manager @ Versapay | 100% -> 100% (100% -> 100%) of 4 | 6/6 | 0 | 4/5/4/4 | $0.0104 |
| product_manager | middle | OP Labs - Sr. Product Manager, Fintechs & Exchanges @ Decirc | 100% -> 100% (100% -> 100%) of 2 | 5/6, 1 reverted | 0 | 3/5/4/4 | $0.0103 |
| product_designer | top | Staff Product Designer @ F2 Ai | 83% -> 83% (83% -> 83%) of 6 | 4/6, 2 reverted | 0 | 4/4/4/4 | $0.0102 |
| product_designer | middle | Sr. Designer, Multidisciplinary @ Gmrmarketing | 100% -> 100% (100% -> 100%) of 1 | 6/6 | 0 | 2/4/3/3 | $0.0100 |
| devops_sre | top | DevOps Engineer @ Merge | 100% -> 100% (100% -> 100%) of 5 | 5/6, 1 reverted | 0 | 5/5/5/5 | $0.0107 |
| devops_sre | middle | Senior Infrastructure Engineer @ Axion | 100% -> 100% (100% -> 100%) of 5 | 5/5 | 0 | 3/5/4/4 | $0.0087 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 50% (50% -> 50%) of 4 | 4/5, 1 reverted | 0 | 3/4/3/4 | $0.0102 |
| account_executive | middle | Enterprise Sales Development Representative @ Smartlyio | 100% -> 100% (100% -> 100%) of 1 | 4/5, 1 reverted | 0 | 3/5/4/4 | $0.0083 |
| marketing_manager | top | Director, Demand Generation @ Kpaonline | 100% -> 100% (100% -> 100%) of 3 | 4/5, 1 reverted | 0 | 3/4/3/3 | $0.0104 |
| marketing_manager | middle | Senior Growth Analyst @ Roo | n/a -> n/a (n/a -> n/a) of 0 | 4/4 | 0 | 2/4/3/3 | $0.0079 |
| financial_analyst | top | Senior Financial Analyst, Category Finance – Away from Home  | 75% -> 75% (75% -> 75%) of 4 | 4/6, 2 reverted | 0 | 4/5/4/4 | $0.0094 |
| financial_analyst | middle | Senior Financial Analyst (Hybrid) @ Rewardsnetwork | 100% -> 100% (100% -> 100%) of 1 | 4/5, 1 reverted | 0 | 3/5/4/4 | $0.0083 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 4/6, 2 reverted | 0 | 3/5/4/4 | $0.0118 |
| registered_nurse | middle | Registered Nurse / Orthopedics @ Elyb | 75% -> 100% (75% -> 100%) of 4 | 3/5, 2 reverted | 0 | 4/5/4/4 | $0.0107 |
| bootcamp_frontend | top | Design Engineer @ Method | 50% -> 100% (50% -> 100%) of 2 | 4/4 | 0 | 2/5/3/3 | $0.0078 |
| bootcamp_frontend | middle | Program Engineer @ Designedconveyorsystems | n/a -> n/a (n/a -> n/a) of 0 | 2/2 | 0 | 1/5/2/3 | $0.0053 |
| registered_nurse | adversarial | Senior Software Engineer, ML Platform @ Dailypay | n/a -> n/a (n/a -> n/a) of 0 | 4/4 | 0 | 1/5/2/3 | $0.0085 |
| financial_analyst | adversarial | Staff Product Designer @ F2 Ai | n/a -> n/a (n/a -> n/a) of 0 | 4/5, 1 reverted | 0 | 1/5/3/3 | $0.0084 |
| senior_frontend | adversarial | Registered Nurse / Chemo Infusion @ Elyb | n/a -> n/a (n/a -> n/a) of 0 | 3/4, 1 reverted | 0 | 1/5/3/3 | $0.0076 |

## Supported must-haves still not shown after tailoring

- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- backend_platform_mid (middle): Ability to manage feature development end-to-end; Self-driven with high technical agency; Experience working in high-growth startup environments
- data_scientist_ml (top): Experience owning end-to-end analytics and model development projects; Experience with fraud, risk, trust & safety, or workforce/hiring analytics; Experience working with large, heterogeneous datasets
- product_designer (top): Strong portfolio demonstrating design thinking and problem solving
- account_executive (top): Ability to close complex deals; Experience in Higher Education vertical sales
- financial_analyst (top): BS in Finance, Accounting, Economics, or related field

## Adversarial pairs: gaps reported, nothing filled

- **registered_nurse** for Senior Software Engineer, ML Platform @ Dailypay: 4 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years professional software engineering experience; Proficiency in Python (lacks Python); Experience building and operating production services; Strong cloud platform proficiency (AWS preferred) (lacks AWS); Experience with distributed systems and service-oriented architecture (lacks distributed systems); Experience with infrastructure-as-code (Terraform or CloudFormation) (lacks infrastructure-as-code, Terraform). Judge: The tailored resume is completely irrelevant to the job posting for a Senior Software Engineer, ML Platform, as it focuses on nursing experience.
- **financial_analyst** for Staff Product Designer @ F2 Ai: 4 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years of experience in product design or UX/UI (lacks UX, UI); Strong portfolio demonstrating design thinking and problem solving; Experience leading end-to-end design across features; Ability to collaborate with product, engineering, and business stakeholders; Experience with SaaS products and/or AI-driven tools (lacks SaaS, AI); product design (lacks product design). Judge: The tailored resume does not match the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.
- **senior_frontend** for Registered Nurse | Chemo Infusion @ Elyb: 3 bullets rewritten, 0 unsupported entities. Must-have gaps: Graduate from a nursing program; Current licensure as a registered nurse in Minnesota (lacks registered nurse); Current American Heart Association BLS Healthcare Provider card (lacks BLS); Obtain Oncology Nurse Society Chemotherapy provider card within 6 months of hire; Maintain current Oncology Nurse Society provider card at all times; nursing (lacks nursing). Judge: The tailored resume is completely irrelevant to the job posting for a Registered Nurse position, as it focuses on software engineering experience.

## Judge notes and fabrications

- new_grad_swe (top): The tailored resume aligns with the job posting by highlighting relevant skills and experience, but lacks depth in specific achievements related to financial institutions or large-scale systems.
- new_grad_swe (middle): The tailored resume effectively highlights relevant skills and experience, but could better align with the job posting by emphasizing full-stack development and specific technologies like Node.js and React.
- senior_frontend (top): The tailored resume effectively highlights relevant experience and skills for the Reddit position, maintaining truthfulness and specificity.
- senior_frontend (middle): The tailored resume aligns well with the job posting, emphasizing relevant skills and experience, but lacks some specific CI/CD and build system details.
- backend_platform_mid (top): The tailored resume accurately reflects the candidate's experience and skills, but lacks direct ML platform experience, which is crucial for the role.
- backend_platform_mid (middle): The tailored resume is well-structured and relevant but slightly exaggerates the candidate's experience. Fabrications listed: 6 years of experience (original resume shows 5 years)
- data_scientist_ml (top): The tailored resume aligns well with the job posting, emphasizing relevant skills and experience, but lacks specific mention of fraud detection or RiskOS-related experience.
- data_scientist_ml (middle): The tailored resume is truthful and specific, but lacks direct relevance to the Sr Data Engineer role, focusing more on data science and machine learning rather than ETL and data engineering.
- product_manager (top): The tailored resume effectively highlights relevant experience and skills for the Senior Product Manager role, maintaining truthfulness and specificity.
- product_manager (middle): The tailored resume is truthful and specific but lacks direct relevance to the blockchain and DeFi focus of the job posting.
- product_designer (top): The tailored resume effectively aligns with the job posting, emphasizing relevant skills and experiences, but slightly exaggerates the candidate's experience. Fabrications listed: 8 years of experience (original resume states 6 years)
- product_designer (middle): The tailored resume lacks relevance to the job posting, as it does not highlight experience in 3D design, motion graphics, or experiential media, which are key requirements for the role. Fabrications listed: 8 years of experience in Figma and multidisciplinary design
- devops_sre (top): The tailored resume effectively highlights relevant experience and skills for the DevOps Engineer position, maintaining truthfulness and specificity throughout.
- devops_sre (middle): The tailored resume aligns well with the job posting but lacks specific experience with GCP and Kubernetes on GCP, which are crucial for the role.
- account_executive (top): The tailored resume is mostly truthful and well-structured, but it lacks specific alignment with the higher education vertical and AI focus of the job posting. Fabrications listed: Senior Account Executive with 7 years of experience (should be 8 years)
- account_executive (middle): The tailored resume accurately reflects the candidate's experience and skills, but it could better emphasize the specific skills and experiences relevant to the SDR role, such as prospecting and pipeline management.
- marketing_manager (top): The tailored resume aligns with the job posting but lacks depth in strategic leadership and multi-year planning experience. The claim of 9 years of experience is inaccurate based on the original resume. Fabrications listed: 9 years of experience in HubSpot, Salesforce, and SEO
- marketing_manager (middle): The tailored resume lacks relevance to the Senior Growth Analyst role, focusing more on marketing than data analysis or growth strategy. Fabrications listed: 9 years of experience in paid media, lead nurturing, and lifecycle marketing
- financial_analyst (top): The tailored resume effectively highlights relevant experience and skills for the Senior Financial Analyst role, with no fabrications and a professional tone.
- financial_analyst (middle): The tailored resume aligns well with the job posting but lacks emphasis on experience with marketing and partnerships, which are key for the role.
- registered_nurse (top): The tailored resume accurately reflects the candidate's experience and skills, but lacks direct oncology or infusion experience, which is crucial for the job posting.
- registered_nurse (middle): The tailored resume effectively highlights relevant orthopedic experience and skills, maintaining truthfulness and specificity, but could better emphasize orthopedic-specific achievements.
- bootcamp_frontend (top): The tailored resume lacks direct relevance to the Design Engineer role, as it doesn't highlight experience with design systems, Three.js, WebGL, or frontend craft, which are crucial for the position.
- bootcamp_frontend (middle): The tailored resume does not align with the job posting for a Program Engineer, as it lacks relevant engineering or program management experience and focuses on teaching and frontend development skills.
- registered_nurse (adversarial): The tailored resume is completely irrelevant to the job posting for a Senior Software Engineer, ML Platform, as it focuses on nursing experience.
- financial_analyst (adversarial): The tailored resume does not match the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.
- senior_frontend (adversarial): The tailored resume is completely irrelevant to the job posting for a Registered Nurse position, as it focuses on software engineering experience.

## Unsupported entities found by the independent check

None.

## Examples

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Software Engineering Intern with 1 year of experience in React and PostgreSQL. Skilled in building web applications and REST endpoints for data-driven products.
- Before: Ran weekly recitations for 40 students, wrote autograder scripts in Python, held office hours.
  After: Led weekly recitations for 40 students and developed autograder scripts in Python to support learning in data structures courses.
- Before: Built a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports; cut manual report requests to the data team by about 30 per week.
  After: Developed a REST endpoint using Python (FastAPI) and PostgreSQL to enable clinic staff to export appointment reports, reducing manual report requests by about 30 per week.

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior Frontend Engineer with 9 years of experience, working with JavaScript, TypeScript and React.
- Before: Tech lead for the merchant dashboard (React, TypeScript, GraphQL, Next.js) used by 120,000 merchants; led a team of 5.
  After: Lead development of a merchant dashboard using React, TypeScript, GraphQL, and Next.js for 120,000 merchants, guiding a team of 5 engineers.
- Before: Migrated a 200-component Angular 1 app to React with a strangler pattern over 14 months, with no customer downtime. Mentored 3 junior engineers.
  After: Migrated a 200-component Angular 1 application to React using a strangler pattern over 14 months with no customer downtime, mentoring 3 junior engineers.

**backend_platform_mid**, Senior Software Engineer, ML Platform @ Dailypay

- Summary: Software Engineer II with 6 years of experience delivering production services using Python, AWS, Terraform, CI/CD pipelines, Docker, and Kubernetes. Skilled in building scalable APIs and optimizing deployment processes for cloud-based environments.
- Before: Built an internal deployment CLI and Terraform modules used by 9 teams; reduced new-service setup from 3 days to 2 hours.
  After: Develop internal deployment CLI and Terraform modules, reducing new-service setup time from 3 days to 2 hours for 9 teams.
- Before: Designed an idempotent retry layer for carrier webhooks that eliminated duplicate shipment records (previously ~0.4% of events).
  After: Design an idempotent retry layer for carrier webhooks, eliminating duplicate shipment records that previously accounted for approximately 0.4% of events.

**data_scientist_ml**, Data Scientist ll - RiskOS @ Socure

- Summary: Senior Data Scientist with 5 years of experience, working with machine learning, Python and SQL.
- Before: Served product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
  After: Serve product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency, resulting in a 2.3% conversion lift.
- Before: Reduced forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system of 8,000 SKUs.
  After: Reduce forecast error (WAPE) by 19% and stockouts by 11% for demand-forecasting system of 8,000 SKUs.

**product_manager**, Senior Product Manager @ Versapay

- Summary: Senior Product Manager with 7 years of experience in Product Management, A/B Testing, Figma, and Stakeholder Management. Skilled in launching new features and driving user activation.
- Before: Own the invoicing and collections product line (ARR $38M); manage a squad of 7 engineers, 1 designer and 1 data analyst.
  After: Direct the invoicing and collections product line with $38M ARR by coordinating a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Managed the reporting module for an HR platform with 900 enterprise customers; shipped a custom report builder used by 62% of accounts within 6 months.
  After: Oversaw the reporting module for an HR platform with 900 enterprise customers, delivering a custom report builder adopted by 62% of accounts within 6 months.

**product_designer**, Staff Product Designer @ F2 Ai

- Summary: Senior Product Designer with 8 years of experience, working with UX, design systems and UX research.
- Before: Lead designer for the card and spending experience in iOS, Android and web; collaborate with 2 PMs and 12 engineers.
  After: Collaborate with 2 PMs and 12 engineers as lead designer for the card and spending experience across iOS, Android, and web platforms.
- Before: Redesigned onboarding after moderated usability tests with 18 participants; completion rose from 62% to 78%.
  After: Conduct moderated usability testing with 18 participants to inform onboarding redesign, resulting in completion rising from 62% to 78%.


## Notes (written by hand after the run)

This file is the second pass of run 1. The first pass on the same 27 pairs ($0.39) found bugs, which were fixed before
this pass ($0.39); together with a 2-pair smoke test ($0.04) the eval has spent $0.81 of its $1 cap.

First pass: coverage 81.4% -> 89.2% -> 92% (exact spelling 80.8% -> 91.5%), judge 2.9 / 4.3 / 3.4 / 3.7, 11 judge-listed
fabrications, 10 flagged entities. What it exposed, and the fix:
- The facts-only summary fell back to the posting's skill list when the person had none of them ("Registered Nurse ...
  working with Python, Scala and Go"). Now it lists only skills the career points show.
- Years of experience counted earlier roles in other functions ("9 years in product management" from a business-analyst
  start). Now only roles sharing a title word with the latest role count.
- The summary gate did not check alias-table terms ("cross-functional", "data analysis" with no source). It does now.
- "MQL to SQL" (a sales-qualified lead) was read as the SQL language. A false-friend list in aliases.ts handles it.
- "Specializing in Kubernetes" read as inflated: "specializing", "expertise in", "expert in" and "mastery of" are banned.
- 5 of the 10 flagged entities were the checker's own false positives (the "M" in "$38M"); the checker was fixed.

After this pass, one more summary rule was added and unit-tested but not re-measured (the cap would not cover a third
pass): years go with the role, never with a skill ("9 years of experience in HubSpot, Salesforce and SEO" fails the gate
and is retried). The judge's remaining "fabrications" in this pass are all of that kind, or years computed from dates
up to today where the fictional resume's own summary was written earlier (the backend profile's "6 years" against "5").

Reading the numbers: coverage is over the must-haves the career points support; adversarial pairs have none, so they show
n/a and are excluded from the averages. The judge's relevance score also reflects how well the person fits the job (the
middle and adversarial pairs are weaker fits by design), so it is low even when the tailoring is sound.
