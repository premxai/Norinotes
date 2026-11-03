# Norinote end-to-end dry run 1

Run at 2026-11-03T08:01:21.609Z by `npx tsx scripts/e2e-dry-run.mts`. Fictional person: Marcus Johnson (DevOps / SRE (US citizen), profile `devops_sre`). Model cap $0.15 per run.

## Step 1: Database: a fresh copy of the job index

Copied `norinote-eval4` to `C:\Users\SRIVAR~1\AppData\Local\Temp\norinote-e2e-2pQV3t` (the copy only is used): 71839 jobs, 1116 with specs, 1116 with embeddings.

_PASS in 2.3 s, model $0.0000; 71839 jobs, 1116 embedded_

## Step 2: User through the API: sign up, profile, resume, lanes, graph, inbox address

- account marcus.johnson.e2e@norinote.test, user 548d5920
- resume `07-devops-sre.txt` read by the model in 9.1 s: 30 nodes; graph view 30 nodes
- career points by kind: {"certification":3,"education":1,"role":3,"skill":1}; certifications: AWS Certified Solutions Architect Professional; Certified Kubernetes Administrator (CKA); HashiCorp Terraform Associate
- lanes: Site Reliability Engineer / DevOps Engineer / Platform Engineer in Denver, CO, Seattle, WA, San Francisco, CA or remote
- inbox address: `nori-2s7ddkrhnt@in.norinote.test`

_PASS in 9.3 s, model $0.0023; 8 points, 3 certifications_

## Step 3: match.user through the worker consumers: the shortlist

- lane-fitting jobs without a spec (understand.job backlog): 0
- match.user ran 1x in 9.9 s (considered 88, scored 58, saved 20, lane matches 12, widened 8)

Top 5 of 20:

| # | fit | company | title | system | reasons |
|---|---|---|---|---|---|
| 1 | 0.959 | Arenaclub | Senior DevOps Engineer | greenhouse | Your 7+ years as a Senior Site Reliability Engineer with AWS, Kubernetes, Terraform, and CI/CD directly match this Senior DevOps Engineer role. / Strong evidence for Experience designing and operating AWS cloud infrastructure: Senior Site Reliability Engineer at Summit Cloud Software / Strong evidence for Hands-on experience managing Kubernetes clusters: Senior Site Reliability Engineer at Summit Cloud Software |
| 2 | 0.912 | Merge | DevOps Engineer | ashby | Your 7+ years as Senior Site Reliability Engineer with AWS, Kubernetes, Terraform, and scalable system deployment matches the DevOps Engineer role requirements. / Strong evidence for Deep experience with AWS/GCP cloud infrastructure: Senior Site Reliability Engineer at Summit Cloud Software / Strong evidence for Experience with Terraform: Senior Site Reliability Engineer at Summit Cloud Software |
| 3 | 0.910 | Authzed | Senior Site Reliability Engineer, Security | ashby | Your extensive SRE experience with Kubernetes, AWS, Terraform, and CI/CD aligns well with the Senior Site Reliability Engineer, Security role at Authzed. / Strong evidence for Hands-on experience with Kubernetes and containerized production environments: Senior Site Reliability Engineer at Summit Cloud Software / Strong evidence for Experience with Infrastructure as Code (Pulumi, Terraform, AWS CDK): Senior Site Reliability Engineer at Summit Cloud Software |
| 4 | 0.890 | Atria Physician Practice New York PC | Software Engineer, DevOps | workable | Strong evidence for Experience with infrastructure-as-code (ideally Terraform): Senior Site Reliability Engineer at Summit Cloud Software / Strong evidence for Experience building CI/CD pipelines (ideally GitHub Actions): Senior Site Reliability Engineer at Summit Cloud Software |
| 5 | 0.856 | Dailypay | Senior Software Engineer, ML Platform | ashby | Strong evidence for Strong cloud platform proficiency (AWS preferred): Senior Site Reliability Engineer at Summit Cloud Software / Strong evidence for Experience with infrastructure-as-code (Terraform or CloudFormation): Senior Site Reliability Engineer at Summit Cloud Software |

_PASS in 11.6 s, model $0.0011; 20 rows, top fit 0.96_

## Step 4: prepare.application through the worker: tailored resume, answer plan, pending questions

- picked #1: Arenaclub, Senior DevOps Engineer (greenhouse, fit 0.959) https://job-boards.greenhouse.io/arenaclub/jobs/4474448009
- status: **needs_user** (The form asks 2 questions only you can answer.)
- tailored resume (ATS Standard, 1 page(s)): `data/samples/e2e/resume.pdf`
- tailoring: supported must-have coverage 6/8 (75%) -> 8/8 (100%); exact spelling 5/8 (63%) -> 8/8 (100%); key phrase 5/8 (63%) -> 8/8 (100%)
  bullets rewritten 3, kept 0, reverted 3; summary from model; stop: round limit (2); ATS score 100; tailoring cost $0.0161
  gaps (2): [must] Experience with Terraform infrastructure as code (lacks infrastructure as code); Experience supporting high-growth or high-availability production envi
- answer plan (api): 12 fields, 8 ready, 2 pending, 2 skipped; by source: profile slots 7, answers 1, bank 0, small model 0, large model 0; calls: 1 small, 0 large, 0 embed; plan 717 ms, schema 93 ms
- standard and form answers stored: 14
- pending questions (2):
  - `field:question_8207217009` (required) text: LinkedIn Profile
  - `field:question_8207219009` (required) select: Do you require relocation to work in a hybrid schedule in our SF office? [Yes | No]

_PASS in 14.5 s, model $0.0168; needs_user, 2 pending_

## Step 5: Pending questions answered through the API

- LinkedIn Profile -> **N/A**
- Do you require relocation to work in a hybrid schedule in our SF office? -> **Yes**
- API answered: status applying, resumed true
- note: answering moved the application straight to `applying` and stamped `approved_at` (apps/api answerApplication calls approveAndSubmit); apply.run was queued and is held by this script until the click in step 6

_PASS in 0.4 s, model $0.0000; answering approved the application (reported)_

## Step 6: Apply through the worker against a local replay of the live form (nothing sent to the employer)

- live page already saved by an earlier run: `data\samples\e2e\greenhouse-arenaclub-4474448009.live.html` (not fetched again)
- saved `data/samples/e2e/greenhouse-arenaclub-4474448009.live.html` (53 KB) and the replay copy (36 KB, 18 form controls, scripts and frames removed)
- replay on http://127.0.0.1:54543 with the fixture widget shim; submit route stubbed; every non-127.0.0.1 request aborted in the browser

Run A (dry run): status **prepared**; click to ready 2.5 s (form ready in 1.9 s: open 1162 ms, discover 12, files 34, text 9, choices 625, validate 39); 12 fields and 1 file filled; submit clicked: false; stub submits: 0
- filled: First Name = Marcus; Last Name = Johnson; Preferred First Name = Marcus; Email = nori-2s7ddkrhnt@in.norinote.test; Phone = (720) 555-0152; LinkedIn Profile = N/A; Country = United States +1; Do you require relocation to work in a hybrid sche = Yes; Resume/CV = bfbcf92f-63de-4ac2-9201-aeaa8a217a69.pdf; Are you willing to work onsite in downtown SF in a = Yes; Are you legally authorized to work in the United S = Yes; Will you now or in the future require visa sponsor = No
- email on the form: `nori-2s7ddkrhnt@in.norinote.test` (the owned inbox address)
- screenshot of the filled form: `data/samples/e2e/filled-form.png`

Run B (stubbed submit): status **submitted**; click to submitted 2.3 s (submit 63 ms); submit clicked: true; confirmation: "Thank you for applying."; stub submits: 1
- run events: submit: Clicking "Submit application" | submitted: Thank you for applying.
- screenshot after the stubbed submit: `data/samples/e2e/after-submit.png`
- requests aborted by the 127.0.0.1-only rule: none; local server hits: GET /e2e/greenhouse-arenaclub-4474448009.html, GET /css/greenhouse.css, GET /__shim.js, POST /__submit

_PASS in 4.8 s, model $0.0000; A prepared, B submitted (stub)_

## Step 7: Inbox: signed verification mail -> awaitVerification; recruiter reply and interview -> outcomes

- unsigned/wrong signature: HTTP 401
- verification mail: HTTP 200 {"stored":true,"duplicate":false}; awaitVerification -> code Q7t03a8Vx in 25 ms (sent Q7t03a8Vx)
- recruiter reply: HTTP 200; interview invite: HTTP 200
- inbox (GET /api/inbox shows the same): interview -> this application (trusted); recruiter_reply -> this application (trusted); verification_code Q7t03a8Vx -> this application (trusted)
- outcomes for this application: reply (inbox), interview (inbox); GET /api/applications/:id/outcomes -> {"applicationId":"1477e0bd-bdbd-4983-b7cc-8eaa63d31b6a","submittedAt":"2026-11-03T08:02:04.489Z","confirmedAt":null,"state":"interview","outcomes":[{"id":"d04a45cd-5e53-4dc0-a3fd-7095db3cc822","kind":
- GET /api/outcomes/summary overall: applications 1, responses 1, interviews 1, pending 0, smallSample true

_PASS in 0.1 s, model $0.0000; code delivered, 3/3 linked, 2 outcomes_

## Step 8: summary

| step | result | time | model cost | notes |
|---|---|---|---|---|
| 1. Database: a fresh copy of the job index | pass | 2.3 s | $0.0000 | 71839 jobs, 1116 embedded |
| 2. User through the API: sign up, profile, resume, lanes, graph, inbox address | pass | 9.3 s | $0.0023 | 8 points, 3 certifications |
| 3. match.user through the worker consumers: the shortlist | pass | 11.6 s | $0.0011 | 20 rows, top fit 0.96 |
| 4. prepare.application through the worker: tailored resume, answer plan, pending questions | pass | 14.5 s | $0.0168 | needs_user, 2 pending |
| 5. Pending questions answered through the API | pass | 0.4 s | $0.0000 | answering approved the application (reported) |
| 6. Apply through the worker against a local replay of the live form (nothing sent to the employer) | pass | 4.8 s | $0.0000 | A prepared, B submitted (stub) |
| 7. Inbox: signed verification mail -> awaitVerification; recruiter reply and interview -> outcomes | pass | 0.1 s | $0.0000 | code delivered, 3/3 linked, 2 outcomes |
| total | pass | 43.0 s | $0.0202 | cap $0.15 |

Click (step 6, run A) to ready: **2.5 s**. Click (run B) to stubbed-submitted: **2.3 s**.

Model spend by step and model: s2 gpt-4.1-mini: 1 calls, $0.0022; s2 text-embedding-3-small: 1 calls, $0.0000; s3 text-embedding-3-small: 9 calls, $0.0004; s3 gpt-4.1-mini: 3 calls, $0.0007; s4 text-embedding-3-small: 1 calls, $0.0000; s4 gpt-4.1: 1 calls, $0.0114; s4 gpt-4.1-mini: 6 calls, $0.0055; s5 text-embedding-3-small: 2 calls, $0.0000.

## Findings

The report above is the third execution of the script; the first two found the bugs below. Spend: $0.0229, $0.0202, $0.0202 (about $0.063 across all three, each run under its own $0.15 cap). The live Arenaclub page and its questions JSON were fetched once, in the first run, and reused after that.

Bugs fixed (each has a regression test):
- **packages/answers + packages/apply: forms got the person's own email, not the owned inbox address.** docs/inbox.md says the inbox address is the email on applications, but `loadContext` (answers) and `loadApplyInputs` (apply) read `profiles.contact.email`. So verification codes would have gone to the person's own mailbox and `awaitVerification` would never have seen them. Both now use the user's `inbox_addresses` row when there is one, and the contact email when there is not. Caveat: in development the API gives addresses on `inbox.norinote.local`, so a development run with ALLOW_REAL_SUBMIT=true would put that address on a real form.
- **packages/answers: "Do you require relocation to work in our SF office?" was answered from willingness to relocate.** For a person in Denver who is not willing to move, the answer came out "No", which tells the employer no relocation is needed. Needing relocation depends on where the person lives, so this question (and relocation assistance or package questions) now goes to the person as pending.
- **packages/inbox: a recruiter's question was read as a confirmation.** A human reply under a subject like "Your application for ..." was classified as a confirmation, so no reply outcome was recorded and `confirmed_at` was set. Now a message from a person (not a no-reply sender) that asks a question and has no "received your application" wording is classified as a reply.
- **packages/tailor: the summary gate read "$1.1M a year" as a claim of 1 year of experience.** It rejected a correct model summary twice and fell back to the summary built from facts. Rates ("$1.1M a year", "150 deploys a year", "twice a year") no longer count as year claims.

Bugs reported (apps/api, being edited by another agent, so not changed here):
- **Answering a pending question approves the application.** `answerApplication` in `apps/api/src/routes/applications.ts` calls `approveAndSubmit` for any `needs_user` application. When the application was parked during preparation (no `approved_at` yet), answering stamps the approval and moves it straight to `applying` with `apply.run` queued. So with ALLOW_REAL_SUBMIT=true, answering a question would submit without the user's click. docs/applying.md says it should go back to `prepared` instead. Suggested fix: when `approvedAt` is null, move it to `preparing` (as `retryApplication` does) instead of calling `approveAndSubmit`. This script held `apply.run` until the click to keep the timing honest.

Observations (not failures):
- The resume parse varies from run to run: 12, 12 and 8 career points; achievements were 4 in one run and 0 in another. All three certifications were found every time.
- The uploaded resume file is named `<uuid>.pdf`. Recruiters will see that name, not something like Marcus_Johnson_Resume.pdf.
- Tailoring lists "Terraform infrastructure as code" as a must-have gap ("lacks infrastructure as code") even though the person writes Terraform modules.
- The live Greenhouse form needed no requests other than 127.0.0.1 after the sanitiser, and the 127.0.0.1-only rule blocked nothing.
