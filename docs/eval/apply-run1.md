# Auto-apply eval, run 1 (2 Nov 2026)

Code: packages/apply (prepare, recipes, filler, drivers), packages/answers (slots, plan). Scripts:
`scripts/eval/apply-fixtures.mts` (collect), `scripts/eval/apply.mts --model` (fixture replay),
`scripts/eval/apply-live.mts` (live dry runs). Raw results: `scripts/eval/results/apply-run1.json`,
`scripts/eval/results/apply-live-run1.json`. Applicant: fictional "Test Applicant", test.applicant@norinote.test,
San Francisco, US work authorisation without sponsorship, five career points, no EEO choices, no consent preference.

## Fixtures

26 real public application pages saved on 2 Nov 2026 with plain GETs (robots.txt respected; never
`boards.greenhouse.io/embed/`, never Ashby's `/api/`), scripts, iframes, tracking, keys, hidden-input values and the job
description stripped; stylesheets kept so visibility replays faithfully:

- Greenhouse (9, with the public questions JSON): Discord, GitLab, Figma, Robinhood, Cloudflare, Anthropic, Reddit,
  Airtable, Twilio.
- Lever (9): leverdemo x2, Palantir x2, Shield AI x2, Zoox x2, Spotify.
- Ashby (8): Ramp x2, Notion, Linear, OpenAI, Vanta, Replit, Cohere.

`fixtures/forms/expected.json` is the hand-labelled field map (476 fields: slot and required flag per field key). It
started from the deterministic classifier's draft and was corrected by hand question by question (29 corrections,
then 19 more after looking at the pages; for example "Have you previously worked at or consulted for GitLab?" is not a
social-profile field, "SMS" consent under the Phone entry is optional). Lever's country-specific demographic surveys
appear only after a location is chosen (JavaScript) and are left out of scoring.

Replay serves each page on 127.0.0.1 with a small widget shim (react-select menus from the saved Greenhouse options,
Ashby yes/no buttons, filename chips, location suggestions) and the submit route stubbed. Nothing leaves the machine.

## Fixture metrics (real models, cold cache: empty recipe cache and answer bank)

| system | forms | slot accuracy | discovery | required flag | unknown required | fill read-back | ready p50 (local) | model cost / form |
|---|---|---|---|---|---|---|---|---|
| Greenhouse | 9 | 98.3% | 97.2% | 100.0% | 25.2% | 100.0% | 2.6 s | $0.0011 |
| Lever | 9 | 100.0% | 100.0% | 100.0% | 26.4% | 100.0% | 1.3 s | $0.0019 |
| Ashby | 8 | 99.1% | 100.0% | 99.1% | 28.8% | 100.0% | 1.1 s | $0.0018 |
| all | 26 | 99.2% | 98.9% | 99.8% | 26.6% | 100.0% | 1.3 s | $0.0016 (max $0.0067) |

- Slot accuracy: the plan's slot against the labelled slot, per field. The 4 misses are relocation or start-date slots
  given to questions labelled "custom" (a Reddit commute-distance question, an Anthropic address question). None
  produces a wrong answer: the profile has no relocation answer, so they go to the person.
- Discovery: fields of the Greenhouse API schema (or the labelled map) found on the page with the right key. The misses
  are Greenhouse's Race question, which the page shows only after the Hispanic/Latino answer (the live filler handles it
  through the revealed-fields step; the static replay cannot).
- Unknown required: required fields left as pending questions. They are the questions only the person can answer:
  consent checkboxes (11; Norinote never consents for the person), "why this company" and story questions the facts do
  not support (13 + 5 rejected by the grounding check), past dealings with the company, export control, salary and age
  when the profile has none, and options that do not fit (25 "not sure"). With a filled profile (consent preference,
  salary, relocation) the rate falls; with recipes and the bank warm it costs less, not fewer questions.
- Fill read-back: every planned value on the page was set and read back (text, react-select, native select, radio and
  checkbox groups by label, Ashby yes/no buttons, uploads, location).
- Model use: 23 small calls and 12 large calls for 26 forms (at most one of each per form, as designed); 3 forms needed
  no model at all.

Model answers kept (all grounded): yes/no from the location ("Are you based in an EU timezone?" No), a sales-experience
threshold (No, no sales role in the facts), short achievement answers restating career points, one long answer ("What
full-time job are you applying for?"). An earlier version of the large-model step embellished stories (an invented
"database indexing" cause for a latency change); the sentence-by-sentence support check now rejects that, and those
questions go to the person.

## Live dry runs (public postings, fictional applicant, stopped before submit)

`ALLOW_REAL_SUBMIT` forced off, `dryRun` true, submit never called; screenshots in `data/samples/apply/`.

| posting | prepare | time to ready | fields set | result | captcha frames seen (none challenged) | model cost |
|---|---|---|---|---|---|---|
| Greenhouse Discord | 3.0 s (API, recipe hit) | 6.4 s | 17 | needs_user: 4 questions | reCAPTCHA Enterprise, invisible | $0.0023 |
| Greenhouse GitLab | 2.1 s | 4.9 s | 10 | needs_user: 2 questions | reCAPTCHA Enterprise, invisible | $0.0003 |
| Greenhouse Reddit | 0.4 s | 9.6 s | 14 | needs_user: 2 questions | reCAPTCHA Enterprise, invisible | $0.0000 |
| Lever leverdemo | 5.4 s (page) | 3.7 s | 13 | ready to submit | hCaptcha, invisible (6 frames) | $0.0005 |
| Lever leverdemo (2) | 1.7 s | 3.7 s | 12 | ready to submit | hCaptcha, invisible | $0.0005 |
| Lever Zoox | 2.2 s | 4.0 s | 14 | needs_user: export control | hCaptcha, invisible | $0.0024 |
| Ashby Ramp | 3.9 s (page) | 3.1 s | 8 | needs_user: 4 (incl. a decode puzzle) | reCAPTCHA Enterprise anchor + bframe, hidden | $0.0028 |
| Ashby Notion | 2.4 s | 2.8 s | 8 | needs_user: office days | reCAPTCHA Enterprise, hidden | $0.0005 |
| Ashby Linear | 4.0 s | 1.7 s | 8 | needs_user: cover letter + 3 essays | none | $0.0042 |

Time to ready is from opening the form to every planned field set and read back (median 3.7 s, max 9.6 s). With the
Greenhouse and Ashby uploads and the submit wait still to come, click to submitted should land well inside 12 to 30 s;
real submission was not exercised (dry runs only). Greenhouse's resume upload goes to its S3 bucket as soon as the file
is attached (before submit), as it does for any person filling the form.

Captcha: every Greenhouse and Ashby form loads invisible reCAPTCHA Enterprise (anchor with `size=invisible`, a hidden
bframe); Lever loads invisible hCaptcha. No visible challenge and no email-code prompt appeared while filling. They can
only appear at submit (low score), which these dry runs never reach; the filler parks such a run as `needs_user`.

Live fixes this run found (now in the code): Greenhouse's Remix boards ignore an upload or menu used before React
hydrates (wait for hydration); Greenhouse replaces the file input with a chip after upload (look for the chip in the
form); react-select closes its menu on a programmatic fill (type the filter); the phone country picker shows "+1" for
"United States +1" (accept the short form on read-back); job systems reject an empty PDF (use a real one).

## Cost

Model spend for everything in this run (fixture eval twice with real models, live dry runs, debugging): $0.189 of the
$0.30 cap (ledger: `scripts/eval/results/apply-spend-ledger.json`). Per application: $0.0016 mean and $0.0067 max cold;
$0.000 to $0.004 in the live runs with recipes and the bank warm. Under the 2 cent target by a wide margin; the large
model is the main cost when a form has required essays.

## Open issues

- Real submission and the post-submit signals (2xx, confirmation, captcha, email code) are tested only against the
  local stub; the first real submissions should be watched.
- Stale recipe classifications are not re-checked on a cache hit (Reddit's commute question kept "relocation" from an
  earlier run; it could not be set, so it went to the person). A recipe version bump on classifier changes would fix it.
- Lever's country surveys and Greenhouse's Race question appear only after another answer; the revealed-fields step
  handles them live but the replay cannot score them.
- Consent checkboxes are the largest source of pending questions; a profile-level consent preference (`autoConsent`)
  is read but not yet settable from the UI.
