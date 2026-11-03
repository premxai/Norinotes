# Tailoring eval, run 2

Generated 2026-11-03T04:38:14.139Z by `npx tsx scripts/eval/tailor.mts` on a copy of the run-3 job index. Writer gpt-4.1 (rewrite, retry, revise), critic gpt-4.1-mini, judge gpt-4o. Cap $1.21, spent $1.193 in total (all runs of this eval, ledger `scripts/eval/results/tailor-spend-ledger.json`).

Pairs: 26 (24 shortlist pairs: each profile's best match and a middle one; 2 adversarial: a job from another profession).

## Summary

| Metric | Value |
|---|---|
| Supported must-have coverage, resume as written -> selected -> tailored (alias aware, shortlist pairs) | 83.4% -> 91.7% -> 96.2% |
| Same, counting only the posting's exact spelling | 82.7% -> 95.5% |
| Supported must-haves whose key phrase appears verbatim, as written -> tailored | 74.6% -> 86.6% |
| Bullets opening in the present tense / summaries attaching years to a skill | 3 / 1 |
| Unsupported entities in rewritten bullets and model summaries (must be 0) | 0 |
| Banned phrases on the final resumes | 1 |
| Words per bullet, all final bullets / rewritten ones | 19.7 / 21.3 |
| Opening-verb diversity (unique openers / bullets) | 1 |
| Bullets rewritten / offered / reverted after two failures | 120 / 137 / 16 |
| Judge (1 to 5): relevance, truthfulness, specificity, tone | 3, 4.8, 3.8, 3.8 |
| Fabrications the judge listed | 4 |
| Tailoring cost per resume, mean / max | $0.0100 / $0.0139 |

## Compared with run 1

| Metric | Run 1 | Run 2 |
|---|---|---|
| Supported must-have coverage, as written -> tailored | 80.5% -> 90.5% | 83.4% -> 96.2% |
| Same, posting's exact spelling | 80% -> 89.9% | 82.7% -> 95.5% |
| Key phrase verbatim, as written -> tailored | not measured | 74.6% -> 86.6% |
| Unsupported entities | 0 | 0 |
| Banned phrases | 0 | 1 |
| Words per bullet (all / rewritten) | 19.3 / 21 | 19.7 / 21.3 |
| Bullets rewritten / offered / reverted | 117 / 140 / 23 | 120 / 137 / 16 |
| Judge relevance / truthfulness / specificity / tone | 2.9 / 4.7 / 3.6 / 3.7 | 3 / 4.8 / 3.8 / 3.8 |
| Fabrications the judge listed | 6 | 4 |
| Tailoring cost per resume, mean / max | $0.0096 / $0.0135 | $0.0100 / $0.0139 |

## Pairs

| Profile | Kind | Job | Coverage before -> after (exact) | Key phrase before -> after | Rewritten | Unsupported | Judge R/T/S/N | Cost |
|---|---|---|---|---|---|---|---|---|
| new_grad_swe | top | Software Engineer, Product @ Prelim | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 4/5, 1 reverted | 0 | 3/5/4/4 | $0.0096 |
| new_grad_swe | middle | Software Engineer II (Fullstack), Digital Storefront @ Toast | 50% -> 100% (50% -> 100%) of 4 | 50% -> 100% | 5/5 | 0 | 3/5/4/4 | $0.0095 |
| senior_frontend | top | Senior Frontend Software Engineer, Consumer Engineering @ Re | 80% -> 80% (80% -> 80%) of 5 | 80% -> 80% | 6/6 | 0 | 4/5/4/4 | $0.0104 |
| senior_frontend | middle | Senior Software Engineer, Developer Productivity @ Sprig | 88% -> 100% (88% -> 100%) of 8 | 88% -> 88% | 6/6 | 0 | 3/5/4/4 | $0.0111 |
| backend_platform_mid | top | Senior Software Engineer, ML Platform @ Dailypay | 43% -> 100% (43% -> 100%) of 7 | 29% -> 86% | 6/6 | 0 | 3/4/4/4 | $0.0114 |
| backend_platform_mid | middle | Senior Software Engineer (Backend) @ Vclusterlabs | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 5/6, 1 reverted | 0 | 3/5/4/4 | $0.0103 |
| data_scientist_ml | top | Data Scientist ll - RiskOS @ Socure | 43% -> 86% (29% -> 71%) of 7 | 29% -> 71% | 6/6 | 0 | 3/5/4/4 | $0.0139 |
| data_scientist_ml | middle | Sr Data Engineer @ Meridianlink | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 5/6, 1 reverted | 0 | 3/5/4/4 | $0.0115 |
| product_manager | top | Senior Product Manager @ Versapay | 100% -> 100% (100% -> 100%) of 4 | 100% -> 100% | 6/6 | 0 | 4/5/4/4 | $0.0105 |
| product_manager | middle | OP Labs - Sr. Product Manager, Fintechs & Exchanges @ Decirc | 100% -> 100% (100% -> 100%) of 2 | 100% -> 100% | 6/6 | 0 | 3/5/4/4 | $0.0103 |
| product_designer | top | Staff Product Designer @ F2 Ai | 80% -> 100% (80% -> 100%) of 5 | 60% -> 80% | 6/6 | 0 | 4/4/4/4 | $0.0106 |
| product_designer | middle | Sr. Designer, Multidisciplinary @ Gmrmarketing | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 4/6, 2 reverted | 0 | 3/4/3/4 | $0.0109 |
| devops_sre | top | DevOps Engineer @ Merge | 100% -> 100% (100% -> 100%) of 5 | 80% -> 100% | 6/6 | 0 | 5/5/5/5 | $0.0112 |
| devops_sre | middle | Senior Infrastructure Engineer @ Axion | 100% -> 100% (100% -> 100%) of 5 | 100% -> 100% | 3/5, 1 reverted | 0 | 3/5/4/4 | $0.0092 |
| account_executive | top | Enterprise Account Executive, Higher Ed @ Boxinc | 50% -> 75% (50% -> 75%) of 4 | 0% -> 0% | 4/5, 1 reverted | 0 | 4/4/4/4 | $0.0112 |
| account_executive | middle | Enterprise Sales Development Representative @ Smartlyio | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 4/5, 1 reverted | 0 | 3/5/4/4 | $0.0090 |
| marketing_manager | top | Director, Demand Generation @ Kpaonline | 100% -> 100% (100% -> 100%) of 3 | 100% -> 100% | 4/5, 1 reverted | 0 | 3/4/4/4 | $0.0100 |
| marketing_manager | middle | Senior Growth Analyst @ Roo | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 3/4, 1 reverted | 0 | 2/5/3/3 | $0.0078 |
| financial_analyst | top | Senior Financial Analyst, Category Finance – Away from Home  | 75% -> 75% (75% -> 75%) of 4 | 50% -> 50% | 4/6, 2 reverted | 0 | 4/5/4/4 | $0.0097 |
| financial_analyst | middle | Senior Financial Analyst (Hybrid) @ Rewardsnetwork | 100% -> 100% (100% -> 100%) of 1 | 100% -> 100% | 3/5, 2 reverted | 0 | 3/4/4/4 | $0.0087 |
| registered_nurse | top | Registered Nurse / Chemo Infusion @ Elyb | 100% -> 100% (100% -> 100%) of 4 | 75% -> 75% | 5/6, 1 reverted | 0 | 3/5/4/4 | $0.0122 |
| registered_nurse | middle | Registered Nurse / Orthopedics @ Elyb | 75% -> 100% (75% -> 100%) of 4 | 50% -> 75% | 5/5 | 0 | 4/5/4/4 | $0.0098 |
| bootcamp_frontend | top | Design Engineer @ Method | 50% -> 100% (50% -> 100%) of 2 | 50% -> 100% | 4/4 | 0 | 2/5/3/3 | $0.0081 |
| bootcamp_frontend | middle | Program Engineer @ Designedconveyorsystems | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 2/2 | 0 | 1/5/2/2 | $0.0049 |
| registered_nurse | adversarial | Senior Software Engineer, ML Platform @ Dailypay | n/a -> n/a (n/a -> n/a) of 0 | n/a -> n/a | 3/4, 1 reverted | 0 | 1/5/3/3 | $0.0086 |
| financial_analyst | adversarial | Staff Product Designer @ F2 Ai | 100% -> 100% (100% -> 100%) of 1 | 0% -> 100% | 5/5 | 0 | 1/5/3/3 | $0.0084 |

## Supported must-haves still not shown after tailoring

- senior_frontend (top): Bachelor’s degree in Computer Science or related field or equivalent experience
- data_scientist_ml (top): Experience with fraud, risk, trust & safety, or workforce/hiring analytics
- account_executive (top): Experience in Higher Education vertical sales
- financial_analyst (top): BS in Finance, Accounting, Economics, or related field

## Adversarial pairs: gaps reported, nothing filled

- **registered_nurse** for Senior Software Engineer, ML Platform @ Dailypay: 3 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years professional software engineering experience; Proficiency in Python (lacks Python); Experience building and operating production services; Strong cloud platform proficiency (AWS preferred) (lacks AWS); Experience with distributed systems and service-oriented architecture (lacks distributed systems); Experience with infrastructure-as-code (Terraform or CloudFormation) (lacks infrastructure-as-code, Terraform). Judge: The tailored resume is completely irrelevant to the job posting for a Senior Software Engineer, ML Platform, as it focuses on nursing experience.
- **financial_analyst** for Staff Product Designer @ F2 Ai: 5 bullets rewritten, 0 unsupported entities. Must-have gaps: 5+ years of experience in product design or UX/UI (lacks UX, UI); Strong portfolio demonstrating design thinking and problem solving; Experience leading end-to-end design across features; Experience with SaaS products and/or AI-driven tools (lacks SaaS, AI); product design (lacks product design); UX/UI design (lacks UX/UI design, UX, UI design). Judge: The tailored resume does not align with the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.

## Judge notes and fabrications

- new_grad_swe (top): The tailored resume effectively highlights relevant skills and experience, but could better emphasize system design and scalability experience for stronger alignment with the job posting.
- new_grad_swe (middle): The tailored resume effectively highlights relevant skills and experience for the job posting, but could better emphasize full-stack development and specific technologies like Node.js and React.
- senior_frontend (top): The tailored resume effectively highlights relevant experience and skills for the Reddit position, maintaining truthfulness and specificity, though it could better emphasize collaboration and mentorship aspects.
- senior_frontend (middle): The tailored resume aligns well with the job posting, emphasizing relevant skills and experience, but lacks direct mention of CI/CD or build systems expertise.
- backend_platform_mid (top): The tailored resume effectively highlights relevant skills and experience, but slightly exaggerates the candidate's total experience. Fabrications listed: 6 years of experience (original resume shows 5 years)
- backend_platform_mid (middle): The tailored resume accurately reflects the candidate's experience and skills, but lacks direct evidence of Kubernetes mastery or open-source contributions, which are key for the job posting.
- data_scientist_ml (top): The tailored resume aligns well with the job posting in terms of skills and experience, but lacks specific mention of fraud detection or RiskOS-related experience.
- data_scientist_ml (middle): The tailored resume accurately reflects the candidate's experience and skills, but lacks direct alignment with the specific data engineering focus of the job posting.
- product_manager (top): The tailored resume effectively highlights relevant experience and skills for the Senior Product Manager role, maintaining truthfulness and specificity.
- product_manager (middle): The tailored resume aligns well with the job posting in terms of fintech experience and product management skills, but lacks specific blockchain or DeFi experience mentioned in the posting.
- product_designer (top): The tailored resume effectively aligns with the job posting, emphasizing relevant skills and experiences, but slightly exaggerates the candidate's experience duration. Fabrications listed: 8 years of experience (original resume shows 6 years)
- product_designer (middle): The tailored resume aligns moderately with the job posting, but lacks emphasis on multidisciplinary design and experiential media. Fabrications listed: 8 years of experience in multidisciplinary design
- devops_sre (top): The tailored resume effectively highlights relevant experience and skills for the DevOps Engineer position, maintaining truthfulness and specificity throughout.
- devops_sre (middle): The tailored resume accurately reflects the candidate's experience but lacks specific alignment with GCP and security hardening, which are key to the job posting.
- account_executive (top): The tailored resume is well-aligned with the job posting, emphasizing relevant experience and skills, but contains a minor discrepancy in years of experience. Fabrications listed: Senior Account Executive with 7 years of experience.
- account_executive (middle): The tailored resume accurately reflects the candidate's experience and skills, but it could better emphasize the specific requirements of the SDR role, such as collaboration with marketing and strategic account research.
- marketing_manager (top): The tailored resume is well-aligned with the job posting, emphasizing demand generation and relevant skills, but lacks seniority and strategic leadership experience required for a Director role.
- marketing_manager (middle): The tailored resume lacks relevance to the Senior Growth Analyst role, focusing more on marketing than data analysis or growth metrics.
- financial_analyst (top): The tailored resume effectively highlights relevant experience and skills for the Senior Financial Analyst role, with no fabrications and a professional tone.
- financial_analyst (middle): The tailored resume aligns well with the job posting but lacks emphasis on collaboration with marketing and partnerships, which is crucial for the role.
- registered_nurse (top): The tailored resume is truthful and well-organized, but lacks specific oncology or infusion experience, which limits its relevance to the job posting.
- registered_nurse (middle): The tailored resume effectively highlights relevant orthopedic and nursing experience, maintaining truthfulness and specificity, though it could better emphasize orthopedic-specific skills.
- bootcamp_frontend (top): The tailored resume lacks relevance to the Design Engineer role, as it does not highlight any design or visual skills, which are crucial for the position. It truthfully represents the candidate's background but misses specificity in design-related achievements.
- bootcamp_frontend (middle): The tailored resume lacks relevance to the Program Engineer role, focusing instead on teaching and frontend development skills, with minimal specificity related to the job posting.
- registered_nurse (adversarial): The tailored resume is completely irrelevant to the job posting for a Senior Software Engineer, ML Platform, as it focuses on nursing experience.
- financial_analyst (adversarial): The tailored resume does not align with the job posting for a Staff Product Designer, as it focuses on financial analysis rather than design experience.

## Unsupported entities found by the independent check

None.

## Examples

**new_grad_swe**, Software Engineer, Product @ Prelim

- Summary: Teaching Assistant, Data Structures (CS 112), working with React, Node.js and PostgreSQL.
- Before: Ran weekly recitations for 40 students, wrote autograder scripts in Python, held office hours.
  After: Led weekly recitations for 40 students, developed autograder scripts using Python, and provided support during office hours.
- Before: Built a REST endpoint in Python (FastAPI) and PostgreSQL that lets clinic staff export appointment reports; cut manual report requests to the data team by about 30 per week.
  After: Developed a REST endpoint in Python (FastAPI) and PostgreSQL to enable clinic staff to export appointment reports, reducing manual report requests by about 30 per week.

**senior_frontend**, Senior Frontend Software Engineer, Consumer Engineering @ Reddit

- Summary: Senior Frontend Engineer with 9 years of experience, working with JavaScript, TypeScript and React.
- Before: Tech lead for the merchant dashboard (React, TypeScript, GraphQL, Next.js) used by 120,000 merchants; led a team of 5.
  After: Demonstrated strong proficiency in TypeScript by serving as tech lead for the merchant dashboard (React, TypeScript, GraphQL, Next.js) used by 120,000 merchants.
- Before: Rebuilt the dashboard on a shared component library, cutting median page load from 4.1 s to 1.6 s and Largest Contentful Paint by 52%.
  After: Rebuilt the dashboard on a shared component library, cutting median page load from 4.1 seconds to 1.6 seconds and Largest Contentful Paint by 52%.

**backend_platform_mid**, Senior Software Engineer, ML Platform @ Dailypay

- Summary: Software Engineer II with 6 years of experience. Skilled in Python, AWS, Terraform, CI/CD pipelines, Docker, and Kubernetes. Delivers production services and cloud-native solutions for software engineering roles.
- Before: Built an internal deployment CLI and Terraform modules used by 9 teams; reduced new-service setup from 3 days to 2 hours.
  After: Developed an internal deployment CLI and Terraform modules adopted by 9 teams, reducing new-service setup time from 3 days to 2 hours for production services.
- Before: Designed an idempotent retry layer for carrier webhooks that eliminated duplicate shipment records (previously ~0.4% of events).
  After: Engineered an idempotent retry layer for carrier webhooks that eliminated duplicate shipment records, previously accounting for approximately 0.4% of events in production services.

**data_scientist_ml**, Data Scientist ll - RiskOS @ Socure

- Summary: Senior Data Scientist with 5 years of experience, working with machine learning, Python and SQL.
- Before: Built demand-forecasting system for 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch; led A/B testing program with 25 experiments per quarter; productionised product-ranking model served via Python microservice on Kubernetes; mentored 2 junior data scientists; presented results to VP-level stakeholders.
  After: Engineered demand-forecasting system for 8,000 SKUs using LightGBM and temporal fusion transformer in PyTorch, supporting large, heterogeneous datasets and productionising models with Python microservices.
- Before: Served product-ranking model via Python microservice on Kubernetes at 40 ms p95 latency; lifted conversion by 2.3%.
  After: Delivered product-ranking model through Python microservice on Kubernetes at 40 ms p95 latency, contributing to large, heterogeneous datasets and achieving a 2.3% conversion lift.

**product_manager**, Senior Product Manager @ Versapay

- Summary: Senior Product Manager with 7 years of experience. Skilled in Product Management, A/B Testing, Figma, and Stakeholder Management. Experienced in launching new features, driving user research, and optimizing onboarding flows for SaaS products.
- Before: Own the invoicing and collections product line (ARR $38M); manage a squad of 7 engineers, 1 designer and 1 data analyst.
  After: Directed the invoicing and collections product line with $38M ARR, overseeing a squad of 7 engineers, 1 designer, and 1 data analyst.
- Before: Launched automated payment reminders after 20 customer interviews and a 6-week experiment; reduced average days-to-pay from 41 to 33 and added $2.4M in expansion ARR.
  After: Implemented automated payment reminders following 20 customer interviews and a 6-week experiment, reducing average days-to-pay from 41 to 33 and adding $2.4M in expansion ARR.

**product_designer**, Staff Product Designer @ F2 Ai

- Summary: Senior Product Designer with 8 years of experience. Skilled in UX, design systems, UX research, and usability testing.
- Before: Lead designer for the card and spending experience in iOS, Android and web; collaborate with 2 PMs and 12 engineers.
  After: Directed the card and spending experience for iOS, Android, and web by collaborating with business stakeholders, including 2 PMs and 12 engineers.
- Before: Built and maintain a Figma component library of 140 components with design tokens, now used by 6 product teams.
  After: Established and maintained a Figma component library of 140 components with design tokens, adopted by 6 product teams and business stakeholders.


## Notes (written by hand after the run)

Run 2 used the round-2 pipeline: past tense for every rewritten bullet, years in the summary only as the exact whole
years in the target function (none below 2, never tied to a skill), the posting's own key phrases carried onto bullets
whose sources truly support them, soft must-haves (ownership, end-to-end, startup pace, stakeholder work...) supported
only by a point that shows the behaviour, and the latest role's first three bullets each leading with a different
supported must-have. Same 27 pairs, same judge model and rubric (job descriptions cut at 3,000 characters instead of
3,500 to fit the budget).

The cap stopped the run before the 27th pair (senior_frontend against the nurse job, an adversarial pair): $1.193 of
$1.21 spent across all runs of this eval. Averages are over the 26 pairs that ran.

What the numbers say:
- Coverage rose on both measures, and the new verbatim key-phrase share went from 74.6% to 86.6%.
- Unsupported entities stayed at 0; the judge's truthfulness score rose to 4.8 and its fabrication list fell from 6 to 4.
  All 4 are year counts: three computed from role dates up to today (later than each fictional resume's own summary
  was written, or counting an earlier design role as design work), and one under-count (7 against 8).
- The 3 present-tense openers are the person's own bullets left as written (not offered, or reverted), such as
  "Partner with supply chain...". Only rewritten bullets are made past tense.
- The 1 banned phrase was "specialists", a noun in a bullet the person wrote, matched by "specialis\w*". The pattern now
  matches only the verb forms.
- 1 summary tied years to a field ("4 years of experience in Finance roles"): the years rule only rejected skills from
  the alias table. Now any "N years ... in/with/of X" fails.
- Mirroring sometimes copied requirement boilerplate onto a bullet ("Demonstrated strong proficiency in TypeScript by
  serving as tech lead"). "Demonstrated proficiency", "proficiency in", "proficient in", "strong knowledge of" and
  "hands-on experience" are now banned.
The last three fixes are unit-tested but not re-measured: the budget is spent.
