# Launch checklist: Greenhouse engine

There is no launch date. Prem confirmed on 2026-11-25 that the 30 Nov date below was a placeholder and that the work is
feature by feature, with each feature checked and built properly before the next. Read the weeks and the launch day as a
sequence of gates, not a calendar.

**Done means:** a new US user signs up on norinote.xyz, uploads a resume, and sees Greenhouse matches within about 15 minutes. They approve a job. Nori fills and submits the application, reading the verification code from Gmail if one is asked for. The user sees the application as submitted. Nobody on our side helps.

Owners: **You** = Prem, **Me** = this Claude session (backend, worker, deploys), **UI** = the UI session.

## State on 11 Nov

- **OpenAI key:** still the expired one on both Fly apps (digest `c38a7c7b…`). Every AI step is down: job reading, embeddings, resume parsing and answer drafting.
- **Jobs:** about 700 fresh hosted Greenhouse jobs (last 72 h). All were read by the rough rule-based reader.
- **Already working:** collection (about 60 boards every 3 min), Greenhouse form filling (Braze submitted live), Gmail code reading (Composio), batches, schedule, chat with undo, Jobs page.
- **Gaps:** no error tracking; no alert when the AI fails; Telegram linked for 0 users; `docs/legal/` is empty (a `/terms` page exists in the web app).

## Week 1 (11–16 Nov): make the engine work

- [ ] **You:** create a new OpenAI key. Check billing and set a monthly spend limit. Put the key in `.env.production` and import it into `norinote-api` and `norinote-worker`.
- [ ] **Me:** test the key from both apps. Re-queue reading for the Greenhouse backlog. Confirm the jobs have AI specs and embeddings, not `heuristic`.
- [ ] **Me:** add an alert for when the AI is down (a health check plus a Telegram message to you). An expired key must never silently fall back again.
- [ ] **Me:** run a fill-rate test. Prepare, but don't send, 50 random fresh Greenhouse jobs with a test profile. Count how many reach "ready" with no questions. Fix the top failures until at least 90% do.
- [ ] **Me:** check match quality. Review the top 20 matches for your profile and for 2 different test profiles, and fix obviously bad matches.
- [ ] **Me:** check Greenhouse coverage. Count the US Greenhouse boards we collect and add board tokens until every launch role (AI/ML, software, data, product) has a healthy number of fresh jobs.

## Week 2 (17–23 Nov): a new user gets through without help

- [ ] **You:** answer the UI session's 2 open product questions.
- [ ] **UI:** Apply sends straight away (`send: true`).
- [ ] **UI:** add multi-select to the Saved list, with an "Apply for me" button.
- [ ] **UI:** add a Telegram connect step to onboarding, and "Greenhouse jobs for now" copy.
- [ ] **Me:** test every reason an application stops for the user: missing answer, code not found, off-site form, attempts used up. Each shows a clear ask, and the run continues after the user answers.
- [ ] **Me:** check that "needs you" and "submitted" messages reach the user by Telegram and by email.
- [ ] **You:** do a full new-user run on production with a fresh account: sign up, resume, connect Gmail, link Telegram, approve 2 jobs, watch them submit. I can't sign up on production for you.
- [ ] **Me:** fix everything that run turns up, then you repeat the run.

## Week 3 (24–29 Nov): safe to open the doors

- [ ] **Me:** test the safety rules on production: the daily cap, one application per company per 60 days, never applying to the same job twice, and the stop or pause control that halts everything.
- [ ] **Me:** add a cost guard: a cap on AI spend per user per day. Check `llm_usage` after the beta.
- [ ] **Me:** add error tracking for API errors and failed applications.
- [ ] **Me:** turn on Supabase backups and do one restore test. Size the database pool and Fly machines for about 100 users.
- [ ] **You (legal):** make sure the Terms and Privacy pages are live. They need to say that Nori applies on the user's behalf, reads only code emails from Gmail, and how to delete your data. Delete-account must remove the user's data.
- [ ] **You:** run a beta with 5–10 real users from 24 Nov (note that Thanksgiving is 26 Nov). I watch their runs daily and fix what breaks.
- [ ] **Both:** code freeze on 28 Nov. Only fixes after that.

## Launch day (date not set)

- [ ] **Me:** final deploy of both Fly apps. **UI:** Vercel deploy.
- [ ] **Me:** smoke test on production: sign up → matches → one submitted application.
- [ ] **Me:** keep the daily cap low (around 5 per user) for the first week, and watch every run on day one.

## After launch (not needed for launch day)

- The next job system after Greenhouse (Ashby or Lever), one at a time.
- Norinote's own Google app for Gmail. Composio works for launch, but Google's review of the Gmail scope takes weeks, so start early if you want it.
- Installable web app and push notifications; Telegram chat; SMS or WhatsApp; a native app.
- Ideas from career-ops: a check that a job is still open, ghost-job detection, follow-ups.
