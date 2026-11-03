# Applying (packages/apply)

Goal: from the click to submitted in 12 to 30 seconds, under 2 cents per application, with no invented answers. Real
submission only when `ALLOW_REAL_SUBMIT=true`; otherwise the form is filled and the run stops before submit.

## Why a browser

No job system offers a keyless submit API (checked on live pages, 2 Nov 2026): Greenhouse's application POST needs the
employer's API key (401 without), Lever's needs an employer key, SmartRecruiters and Workable need partner tokens, and
Ashby's `/api/` path is disallowed by robots.txt (Norinote never calls it). So the browser is the only route. What can be
read without a key is read before the click.

## Before the click: `prepare.application`

`createPreparer` (apps/worker) tailors the resume (packages/tailor), answers the standard questions, then calls
`prepareForm` (packages/apply/src/prepare.ts):

1. **Schema.** Greenhouse publishes the whole form without a key:
   `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true` (`first_name`, `last_name`, `email`,
   `phone`, `resume`, `question_<id>` with text, textarea, file, single and multi select; location, compliance,
   demographic questions, GDPR consent). Lever and Ashby are read from the page in a warm browser context without filling
   (`readFormFromPage`). Workday is parked at once (it needs an account per employer, which Norinote never creates);
   SmartRecruiters, Workable and iCIMS are typed stubs that park with "not supported yet".
2. **Recipe cache** (`form_recipes`, migration 0005). Fingerprint = sha256(ats, company token, sorted normalised
   `label|type|options`). It stores, per question, the profile slot and the widget strategy that worked; never an
   applicant's value (`saveRecipe` keeps only `labelKey, label, type, slot, strategy`). A hit skips classification; a
   stale entry heals once at fill time and is rewritten.
3. **Answer plan** (`planForm`, packages/answers/src/plan.ts), cheapest source first:
   - answers already on the application (the person's, keyed `field:<key>`, question id or text);
   - a **profile slot**, decided deterministically from name, id, autocomplete, label, legend and placeholder
     (`classifySlot`, packages/answers/src/slots.ts) and valued from the profile (`slotValue`). Stable keys first:
     Greenhouse `first_name`/`question_<id>`, Lever `name, email, phone, org, urls[...], resume, location, pronouns,
     eeo[gender|race|veteran|disability]`, Ashby `_systemfield_*`;
   - the **answer bank**: normalised text, then embedding similarity (one embedding call per form);
   - at most **one batched small-model call** (gpt-4.1-mini, strict JSON) for the remaining short questions: classify the
     label to a slot, choose options by meaning from the offered list, write short answers grounded in the profile. It
     may say "unsure", which becomes a pending question. Short answers are checked against the facts (numbers, names,
     tools must appear there);
   - **required long free text**: at most **one large-model call** (gpt-4.1) for the form. Every sentence must name a
     verbatim supporting quote from the career points or the posting; the quote must exist, the sentence's numbers,
     names and tools must be in it, and most of its content words must come from it. Anything else is pending.
     Optional long free text is left blank.
   - **Legal questions** (work authorisation, sponsorship, criminal history, salary, relocation, start date, age,
     consent) come only from the profile, even when the model classified them; otherwise pending. The model never
     supplies their value.
   - **EEO**: the profile's choice, else the form's "decline to self-identify" option when the question is required;
     optional ones without a profile choice stay blank.
   - Puzzles and anti-bot checks in the form ("decode this text", "prove you are not a bot") are never answered.
4. Answers are stored on the application as `field:<key>` (the person's own answers always win); the schema summary,
   fingerprint, usage and timings go to `receipt.prepared` and a `prepare_form` run event. Required questions nobody can
   answer park the application as `needs_user` with `pending_questions` (ids `field:<key>`), batched with the person's
   other pending questions (`pendingDigest`). When they are answered, the application is prepared again (cheap: the
   resume, the recipe and the earlier plan are reused) and returns to `prepared`.

## The click: `apply.run`

`runApplication` → driver `fill` on a warm pool page → `submit` only when allowed.

- **Pool** (pool.ts): one Chromium, fresh context per application (one spare context kept ready, never reused),
  images, fonts, media and analytics blocked (captcha scripts never), the browser's own user agent plus the project's
  polite `NorinoteJobAgent/1.0 (+https://norinote.xyz)`. No stealth plugins, no fingerprint tricks. A Playwright trace
  (DOM snapshots) is recorded per run.
- **Open**: straight to the form URL (`job-boards.greenhouse.io/{token}/jobs/{id}` for both Greenhouse hosts, never
  `/embed/`; Lever `/apply`; Ashby `/application`), wait for the first field (never network idle), then for React
  hydration on server-rendered boards (Greenhouse), decline a cookie banner, open the form if it hides behind "Apply".
- **Fill** (fill.ts), in this order: files first (Lever and Ashby re-parse the resume and autofill over typed text),
  every text field in one round trip (native setter + input/change/blur), then choices one at a time:
  - react-select comboboxes: click, type a filter, wait for the visible `role=listbox`, click the option by its text,
    read back the chosen value; never `#react-select-N` ids; retry once, then the field is unresolved;
  - native selects by label with fuzzy match and the decline fallback; radio and checkbox groups by clicking the visible
    label of the option; Ashby yes/no buttons; Ashby multi-select checkbox groups by field entry;
  - uploads with `setInputFiles`, verified by the filename chip (or the chip that replaces the input);
  - location autocompletes: type, let suggestions settle, pick the best, read back;
  - the phone country picker from the profile phone's dialing code.
  Then a re-read of text values, a validation scan (`aria-invalid`, error text) with one fix, follow-up fields an answer
  revealed (Greenhouse's Race after Hispanic/Latino), and a multi-page loop (Next, new fields, cap of 5 pages).
- **Stops** (needs_user, nothing guessed): a visible captcha challenge (the invisible reCAPTCHA Enterprise badge of
  Greenhouse and Ashby and Lever's invisible hCaptcha are not challenges), an emailed-code prompt, a password or account
  wall, a site that turns automation away, required questions without an answer or that could not be set.
- **Submit** (only `dryRun === false && ALLOW_REAL_SUBMIT === "true"`, checked again at the click): race success
  signals (a 2xx answer to the submit request, confirmation text, the form detached, the URL changed) against failure
  signals (error text, a captcha challenge, an email-code prompt). Event driven; no fixed sleeps.
- **Email codes**: the worker passes the owned inbox's `awaitVerification` as `ApplyDeps.verification` (accept "code");
  a link, or no code in time, parks the application as needs_user. Without the hook every code prompt parks.
- **AI browser fallback**: `ApplyDeps.aiFallback` (`AiBrowserFallback`) is a typed hook only; unset (today) unknown forms
  and read-back failures go to needs_user. No browser-use or Stagehand dependency.

## Safety

- One application per user and job, and per user and canonical job URL (`applications.canonical_url`, unique with the
  user; `canonicalJobUrl` folds boards, embeds and tracking links into one URL).
- One application per company at a time, plus a cooldown between two (`CompanyGate`, `APPLY_COMPANY_COOLDOWN_MS`,
  default 30 s).
- Submit is never clicked twice: the click is recorded before anything else can fail (`receipt.submitClicked`).
- Receipts: grouped fields, files, screenshot, trace path, confirmation text, `prepared` summary and per-step timings.
- Run events: `prepare_form`, `discovered`, `field_filled` (strategy, source, ms), `validation`, `timing`
  (openMs, discoverMs, filesMs, textMs, choicesMs, validateMs, readyMs), `captcha`, `verification`, `submit`.

## Eval

`npx tsx scripts/eval/apply-fixtures.mts` saves the fixtures (26 real public forms: 9 Greenhouse, 9 Lever, 8 Ashby,
scripts, iframes, tracking and keys stripped). `npx tsx scripts/eval/apply.mts [--model]` replays them on 127.0.0.1 with
a widget shim and the submit route stubbed, against the hand-labelled field map `fixtures/forms/expected.json`.
`npx tsx scripts/eval/apply-live.mts` runs at most 3 live dry runs per system with the fictional applicant and stops
before submit. Results: docs/eval/apply-run1.md. Spend for all of it is capped at $0.30 by
`scripts/eval/results/apply-spend-ledger.json`.
