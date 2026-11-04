# Sign-in and sign-up design spec

The rules to build part 2 from: `/signup`, `/signin`, `/forgot-password`, `/reset-password` and `/verify-email`.
[ui-plan.md](ui-plan.md) (part 2) says what's on these pages and why. This file says how they look, move and behave at
every size, followed by the build checklist. The wireframe (the "Sign-in and sign-up" page of the design canvas) follows
these rules. Where they disagree, this file wins.

This file only adds to [landing-design-spec.md](landing-design-spec.md). Tokens, type roles, focus ring, motion
tokens, budgets and the QA approach are the same, and aren't repeated here.

Status: decided, except the items under [Still open](#15-still-open). Built fresh in `apps/landing`, like the landing
page.

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| Where | `apps/landing`, route group `(auth)`, so the landing page's Nori stays mounted into sign-up and on into onboarding |
| Layout | From 1024 px: split, the scene on the left (5/12), the form on the right. Below 1024: a scene band across the top, the form under it |
| Methods | Email and password only, through the existing `apps/api` endpoints. No Google yet |
| Sign-up fields | Email and password. The name comes in onboarding |
| Scenes | Gate (sign-up, verify) and nook (sign-in, forgot, reset): a portrait source with a column crop and a band crop |
| Nori | The same Nori on a seat in the scene, wired to the fields with `watchFields`, reacting to each answer |
| API | Called directly from the browser with `credentials: "include"`, at `NEXT_PUBLIC_API_URL` |
| Accessibility | WCAG 2.2 AA, including 3.3.7 (redundant entry) and 3.3.8 (accessible authentication) |
| Performance | Same budgets as the landing page; these pages are lighter |

## 2. Layout

| Range | Layout | Scene | Form |
|---|---|---|---|
| 1024+ (laptop, desktop, wide) | Two columns, full height: `min-height: 100svh`, and at least 640 px | Left column, `5fr`; the form column is `7fr`. The scene covers the column | Top bar 72 px tall; the form block is centred in what's left, up to 400 px wide (`max-w-note`), with side padding 48 px |
| 768–1023 (tablet) | One column | A band across the top, `clamp(220px, 34svh, 320px)` tall | Centred, up to 400 px wide, 32 px side margin |
| Below 768 (phone) | One column | A 56 px top bar on `bg` with the logo, then the band, `clamp(200px, 30svh, 260px)` tall | Full width with the 16 px page margin |

- **Why the tablet doesn't split.** At 768 wide, 5/12 is a 320 px strip, which shows a sliver of the scene and squeezes
  the form. The band reads better on portrait tablets. This changes the plan's "narrower split on tablets".
- **Why the phone logo isn't on the scene.** It was in the wireframe, but on the gate band the logo area falls to 1.0:1
  against ink (the hedge and lantern sit there). A plain 56 px bar keeps it legible on both scenes. The bar holds the
  logo only; the switch link moves under the button.
- **Wide screens (1920+):** the scene column keeps growing (5/12); the form block stays 400 px, centred in its column.
- **Short screens (height under 700):** the form block aligns to the top of its column instead of the centre, 24 px
  below the top bar, and the column scrolls. The scene column stays fixed to the screen height (`position: sticky;
  top: 0; height: 100svh`).
- The page has no landing nav and no footer. The logo links to `/`.

## 3. Spacing

The landing page's 4 px scale.

| Between | Phone | 1024+ |
|---|---|---|
| Top bar (or band) and headline | 28 | Centred block |
| Headline and lead | 8 | 12 |
| Lead and the plan chip, or the form | 24 | 32 |
| Label and input | 8 | 8 |
| Input and its hint or error | 8 | 8 |
| One field and the next | 16 | 20 |
| Last field and the form error or button | 24 | 24 |
| Button and status line | 12 | 12 |
| Status line and small print, or switch link | 16 | 16 |

## 4. Type

| Element | Role | Size | Notes |
|---|---|---|---|
| Headline (`h1`) | New role `auth`: Geist Serif Triangle 400 | `clamp(2.25rem, 1.971rem + 1.143vw, 3rem)`: 36 at 390 px to 48 at 1440 | Line height 1.05, tracking -0.02em. At most 28 characters |
| Lead | Lead | 17 to 20 px | `ink-2` on `bg`. At most 80 characters |
| Field label | UI label | 16 px, Geist 600 | Always visible, above the field |
| Input text | Body | 16 px | Never under 16 px: iOS zooms into smaller inputs |
| Hint, field error | Small | 14 px | Hint `ink-2`; error `danger` with an icon |
| Form error | Body | 15 px | `ink` on `danger-tint` |
| Button | UI label | 16 px | |
| Status line | UI label | 15 px, Geist 600 | `accent` |
| Small print, switch link | Small | 14 px | `ink-2`, links `ink` |
| Nori's bubble | nori-pet | nori-pet's own | |

## 5. Colour

The Dawn tokens, plus one new one.

| Token | Hex | Use |
|---|---|---|
| `danger-tint` | `#FBEAE6` | Background of the form error box only |

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on `danger-tint` | 12.7 | Pass |
| `danger` on `danger-tint` (icon, border) | 5.1 | Pass |
| `danger` on `surface` (field error text sits on `bg`; fields are `surface`) | 5.8 | Pass |
| `line-strong` field border on `bg` | 3.9 | Pass (3:1) |
| Ink logo on the gate band (top left) | worst 1.0, average 4.1 | Fails: hence the phone top bar |
| Ink logo on the nook band | worst 1.0, average 8.7 | Fails at the worst pixel too |

No text sits on the scenes at any size. Nori's bubble is a `surface` card.

## 6. Components

| Component | Spec |
|---|---|
| Auth layout | `AuthShell`: the scene (column or band), Nori's seat, the top bar, and a slot for the page. One per route group, so moving between auth pages keeps the shell and only swaps the form |
| Top bar | Logo (to `/`) on the left. From 768 px, the switch link on the right: "Have an account? **Sign in**", "New here? **Create an account**", or "Remembered it? **Sign in**" |
| Field | Label, input, then a hint or an error, all wired with `aria-describedby`. Input: 48 px tall, 10 px radius, 1.5 px `line-strong` border, `surface` fill, 14 px horizontal padding. Invalid: `danger` border plus `aria-invalid`, and the error text replaces the hint |
| Password field | A Field with a **Show** / **Hide** text button inside the right edge: 44 × 44, `aria-pressed`, `aria-controls`, `aria-label` "Show password" / "Hide password". It switches `type` between `password` and `text` and keeps focus in place |
| Form error | A box above the button: `danger-tint`, 1.5 px `danger` border, 12 px radius, padding 12 × 14, an icon, the API's message in words. `role="alert"`. "Email taken" ends with a **Sign in instead** link |
| Submit button | The landing's primary button, full width, 48 px. While a request runs: its label becomes the busy wording ("Creating your account…"), it gets `aria-disabled="true"`, and repeat presses are ignored. Its width never changes. No spinner; Nori turns its key |
| Status line | Under the button, `aria-live="polite"`, 22 px reserved so nothing jumps. Busy wording while waiting, then "Account created. Opening onboarding…" or "Signed in. Opening today's shortlist…" with a check icon |
| Plan chip | Sign-up only, with `?plan=pro`: a `tint` pill, "**Pro selected** · you'll add payment after setup" |
| Result panel | Replaces the form on forgot (sent), reset (done) and verify: the headline, one or two lines and one primary button. Focus moves to its headline (`tabindex="-1"`) |
| Small print | Sign-up only, under the status line: "By creating an account you agree to the **Terms** and **Privacy**." |

## 7. Images

| Scene | Pages | Source | Column crop (1024+) | Band crop (below 1024) |
|---|---|---|---|---|
| Gate (`gate`, take `gate-2.png`) | Sign-up, verify | 1024 × 1536 | Whole image, `object-position: 90% 62%`. Seat x 0.90, y 0.619 | 3:2 crop, `crop: { aspect: 1.5, y: 0.594 }`. Seat x 0.89, y 0.65 |
| Nook (`nook`, take `nook-2.png`) | Sign-in, forgot, reset | 1024 × 1536 | Whole image, `object-position: 78% 62%`. Seat x 0.765, y 0.678 | 3:2 crop, `crop: { aspect: 1.5, y: 0.648 }`. Seat x 0.765, y 0.715 |

- The gate seat is the flat top of the fence post at the right edge. x 0.90 rather than the post's centre (0.914) keeps
  Nori inside the column at every width.
- Object positions keep the seat on screen when the column is wider or narrower than 2:3, such as 1280 × 720 (the drawn
  image is cropped top and bottom) or 1024 × 1366 (cropped at the sides). Seats are placed with the landing page's
  `Seat` cover maths, so Nori stays on the post or cushion at every size.
- Built by `art/build.mjs` as four picks: `gate`, `gate-band`, `nook`, `nook-band`. Column widths 640, 960 and 1280;
  band widths 480, 780 and 1080. AVIF with WebP, the same dither, previews and `scenes.json` entries.
- Budgets: a column image at most 120 KB at 1280 (AVIF), a band at most 80 KB at 1080.
- `<picture>` with `media="(min-width: 1024px)"` for the column source and the band as the default, so phones never
  download the tall image.
- The scene is the page's largest paint on desktop: preload it with `fetchpriority="high"` for the matching media. It
  sits on its dominant colour from `scenes.json` with the 24 px blurred preview, as the landing scenes do.
- `alt=""`: the scenes are decoration.

## 8. Nori

Same package, same rules as the landing page (spec section 9): it never covers a field, button or the top bar, it can
be dragged, tucked and muted, and reduced motion gets still poses.

| Moment | Call | Row |
|---|---|---|
| Arrives from the landing page | `sitOn(seat)` with a glide (`moveTo(x, y, true)`), then the page's idle | |
| Opened directly | Appears on the seat, then `react("hello")` once per visit | wave |
| Email focused or typed in | `watchFields({ text: [email], password, reveal })` | type-along, following the caret |
| Password focused | (watchFields) `password` | cover, then covered |
| **Show** pressed | (watchFields) `password-show` | peek |
| **Hide** pressed | (watchFields) `password-hide` | cover |
| Leaving the password field | (watchFields) `password-done` | uncover |
| Request running | `react("signing-in")` | key |
| Sign-up succeeds | `react("welcome")`, then go on after it finishes or after 1.2 s, whichever is first | bow |
| Sign-in succeeds | `react("signed-in", { say: "Welcome back!" })`, then go on (same timing) | nod, wave |
| Any error | `react("auth-failed", { say })`, at most 40 characters. The full message is in the form | shake-no |
| Reset link sent | `react("email-sent", { say: "Check your inbox." })` | check-mail |
| Password saved | `play("nod")` | nod |
| Verifying a link | `react("loading")` until the answer, then `play("celebrate")` or `play("deflated")`, then `play("comfort")` | sway |

- **Seat controller.** `NoriStage` picks a controller by route: the landing choreography on `/`, and a small auth
  controller in `(auth)`. That controller sits Nori on the `data-nori-seat="auth"` element, re-sits it on resize and on
  scroll (so on a phone Nori moves with the band), and unwires the fields when the page changes.
- **Phones and the keyboard.** When the keyboard opens and the band scrolls away, Nori goes with it; it never hops onto
  the form. Its reactions still play, and its words still go through the polite live region. The outcome reactions come
  after submit, once the keyboard has closed.
- **Loading.** The auth rows (type-along, cover, covered, peek, uncover, key, nod, wave, bow, shake-no, check-mail, sway,
  celebrate, deflated, comfort) are fetched after the page settles, password rows first as soon as any field is
  focused. About 850 KB of sprites in all, never on the first screen.
- **Never the only signal.** Every outcome Nori shows is also in words in the form.

## 9. Behaviour

### Routing

| Case | Result |
|---|---|
| Visiting `/signin` or `/signup` while signed in (`GET /api/auth/session` is 200) | `router.replace` to where sign-in would go. The form renders straight away and isn't held back for this check |
| After sign-in | `GET /api/onboarding`: `step` is `"done"`, go to `/dashboard`; otherwise go to `/onboarding` |
| `?next=/some/path` | Used after sign-in only if it starts with a single `/`, isn't `//` or `/\`, and isn't an auth page. Otherwise ignored |
| `?plan=pro` | Shows the plan chip and is kept in memory for onboarding. Nothing is charged; there's no billing yet |
| Switching between sign-in, sign-up and forgot | The typed email carries over in an in-memory store, never in the URL or storage |
| `/reset-password` or `/verify-email` with no token | The expired-link panel straight away |

Until parts 3 and 4 exist, `/onboarding` and `/dashboard` are Dawn placeholder pages (`ComingNext`), like `/signin` was.

### Validation

Checked on submit, not while typing. The `<form>` has `noValidate`, so the browser's own bubbles never appear.

| Field | Rule | Message |
|---|---|---|
| Email | Trimmed, then something@something.something | Enter an email address, like name@example.com |
| Password on sign-up and reset | At least 8 characters | Use at least 8 characters |
| Password on sign-in | Not empty | Enter your password |

After a failed check, focus moves to the first invalid field. An error clears as soon as that field is edited.

### API answers

| Endpoint (`/api/auth/…`) | Success | Errors shown (the API's own `error` text) |
|---|---|---|
| `POST signup` `{ email, password }` | 201 → `welcome` → `/onboarding` | 409 "An account with this email already exists." + **Sign in instead** · 429 · 400 |
| `POST login` `{ email, password }` | 200 → `signed-in` → onward (see Routing) | 401 "Incorrect email or password" · 429 |
| `POST forgot-password` `{ email }` | 200, always the same for every address → the "Check your inbox" panel | 429 |
| `POST reset-password` `{ token, password }` | 200 → the "Password changed" panel → **Sign in** (every session was signed out) | 400 "This reset link is invalid or has expired. Ask for a new one." with a link to `/forgot-password` · 429 |
| `POST verify-email` `{ token }` | 200 → "Email confirmed" → **Continue** (`/onboarding` or `/dashboard` if signed in, else `/signin`) | 400 → "This link has expired" panel · 429 |
| `GET session` | 200 `{ user }` | 401 means signed out (not an error) |

- Any other status, or a network failure: "Couldn't reach Norinote. Check your connection and try again."
- A 400 from validation (`{ error, detail }`) shouldn't happen after the client checks. If it does, show `error`.
- Responses are read as `{ user }` or `{ error, detail? }`. The types live in the app (`lib/api.ts`);
  `@norinote/shared` has no auth contracts to reuse (landing spec section 16 now says so).

### Tokens and privacy

- On `/reset-password` and `/verify-email`, the token is read from the query string once, then removed with
  `history.replaceState`, so it doesn't stay in history or get sent on in a Referer.
- `Referrer-Policy: no-referrer` on those two pages. They're also `noindex`.
- Passwords are never logged, stored or sent anywhere except the API. The email is held in memory only.

### Connecting

- `NEXT_PUBLIC_API_URL`, default `http://localhost:4000`. The CSP's `connect-src` adds that origin.
- The API's `WEB_URL` must be the app's origin: `http://localhost:3400` in development. The API's CORS and origin check
  both use it, and it builds the email links from it.
- The session cookie is httpOnly, `SameSite=Lax` and `Secure` in production. For it to be sent, the app and the API must
  be on the same site in production (for example `norinote.com` and `api.norinote.com`).
- Without `RESEND_API_KEY`, the API prints email links to its console, which is how they're tested locally.

## 10. Motion

- Nothing on the form animates in: it's usable on the first frame.
- The scene paints over its blurred preview, as on the landing page.
- The form error and the field errors appear without movement. No shaking forms; Nori does the head shake.
- The result panel cross-fades with the form (`dur-base`). Under reduced motion, it swaps instantly.
- Between auth pages, only the form block changes; the shell, the scene (if the same) and Nori stay put. Between gate and
  nook pages, the scene cross-fades (`dur-slow`) and Nori glides to the new seat.

## 11. Responsive behaviour

| Element | 1024+ | 768–1023 | Below 768 |
|---|---|---|---|
| Scene | Left column, full height, sticky | Band, 220 to 320 px | Band, 200 to 260 px, below a 56 px logo bar |
| Nori | Size `m`, on the column seat | `m`, on the band seat | `s` (nori-pet switches below 520 px), on the band seat |
| Switch link | Top bar, right | Top bar, right | Under the button, centred |
| Headline | 43 to 48 px | 40 to 43 px | 36 to 40 px |
| Autofocus on email | Yes (sign-in, sign-up, forgot) | No | No: the keyboard would cover the scene and Nori |

## 12. Accessibility

On top of landing spec section 12:
- One `h1` per page; the shell has `header` and `main`. Each page has its own `<title>`: "Create your account ·
  Norinote", "Sign in · Norinote", "Reset your password · Norinote", "Choose a new password · Norinote", "Confirm your
  email · Norinote".
- Real `<form>`s with `name` and `autocomplete`: `email`; `new-password` on sign-up and reset; `current-password` on
  sign-in. On email: `inputmode="email"`, `autocapitalize="none"`, `spellcheck="false"`.
- **3.3.8 Accessible authentication:** paste is allowed everywhere, password managers fill both fields, and there's no
  puzzle or memory test.
- **3.3.7 Redundant entry:** the email carries over between sign-in, sign-up and forgot.
- **3.3.1 / 3.3.3:** every error names the problem and how to fix it, in words, next to the field or in the alert.
- No time limits on the page. The link lifetimes (one hour, 3 days) are stated in words.
- The Show button changes its `aria-pressed` and label; it never moves focus.
- Targets: 44 × 44 at least (the Show button, the links in the top bar and under the button have padding to reach it).

## 13. Performance

- Each page is static. The only client code is the form and the auth seat controller: under 15 KB gzip of our own
  JavaScript.
- LCP: the scene column on desktop, the headline on phones. Target under 2.0 s on 4G, as on the landing page.
- Before the first interaction: under 350 KB (fonts, the scene, Nori's idle rows).
- CLS under 0.05: the status line, error areas and hint keep their space or push content below the button only.

## 14. Copy

| Page | `<h1>` | Lead | Button | Busy |
|---|---|---|---|---|
| Sign-up | Create your account | Then add your resume, and Nori builds your first shortlist. | Create account | Creating your account… |
| Sign-in | Welcome back | Sign in to see today's shortlist. | Sign in | Signing in… |
| Forgot | Reset your password | We'll email you a link. It works for one hour. | Send link | Sending… |
| Forgot, sent | Check your inbox | If there's an account for {email}, a reset link is on its way. It works for one hour. | Back to sign in | |
| Reset | Choose a new password | You'll sign in with it next. | Save password | Saving… |
| Reset, done | Password changed | You're signed out on every device. Sign in with your new password. | Sign in | |
| Verify, ok | Email confirmed | Thanks. You're all set. | Continue | |
| Verify, expired | This link has expired | Confirmation links last 3 days. Sign in, and Nori can send you a new one. | Sign in | |

Nori's bubbles: "Welcome! Let's add your resume." · "Welcome back!" · "Check your inbox." · "That didn't match." ·
"You already have an account!" · "Let's wait a little." · "I can't reach Norinote." · "Just one thing to fix." ·
"All set!" · "That link's too old."

Rules as on the landing page: verbs first on buttons, no exclamation marks in the form (Nori may use them), true
numbers only.

## 15. Still open

- **Pro without billing.** The chip says payment comes after setup. Whoever builds billing decides what happens then.
- **Google sign-in:** later, an `apps/api` task first.
- **Resending the confirmation email:** `POST /api/auth/resend-verification` exists. Its button lives in the dashboard
  (part 4), not here.
- **Hosting and domain:** shared with landing Phase 6; the API and the app must be on the same site.

## 16. Build checklist

Each phase ends with lint, type check and a look at 390 and 1440. Commit only with an explicit go.

### Phase 0: wiring
- [ ] `NEXT_PUBLIC_API_URL` in `.env.example` and `next.config.ts` (CSP `connect-src`); `lib/api.ts` with typed calls and
  one error type.
- [ ] A local run against `apps/api` with `WEB_URL=http://localhost:3400`: session, sign-up, sign-in and log-out work from
  the browser console.

### Phase 1: scenes
- [ ] `build.mjs` picks `gate`, `gate-band`, `nook` and `nook-band` (section 7). Check the seats with the preview overlay.
- [ ] Measure the scenes' fills, and check that no text needs to sit on them.

### Phase 2: shell and components
- [ ] Tokens: `--text-auth`, `--color-danger-tint`.
- [ ] `AuthShell` (column, band, logo bar, top bar, seat), `Field`, `PasswordField`, `FormError`, `StatusLine`,
  `ResultPanel`, `PlanChip`.
- [ ] The `(auth)` layout replaces the placeholders, plus `/forgot-password`, `/reset-password` and `/verify-email`.
  `/onboarding` and `/dashboard` placeholders.

### Phase 3: pages and API
- [ ] The five pages with validation, the API answers from section 9, routing, `?next=`, `?plan=pro`, the email carry-over
  and token clean-up.

### Phase 4: Nori
- [ ] The auth seat controller in `NoriStage` (by route), `watchFields`, reactions, the glide in from the landing page,
  row prefetching.

### Phase 5: QA
- [ ] The landing QA script grows an auth suite: the 11 sizes in three engines, axe, keyboard only, reduced motion, text
  spacing, every error from section 9 (the API mocked with Playwright routes), and one real end-to-end run against a
  local API: sign up, sign out, sign in, forgot and reset with the link from the API's console.
- [ ] Budgets from section 13.
