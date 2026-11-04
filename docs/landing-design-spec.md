# Landing page design spec

The rules to build the Norinote landing page from. [ui-plan.md](ui-plan.md) says what goes on the page; this file says how
it looks, moves and behaves at every size, followed by the build checklist. The wireframe ("Landing v2" on the design
canvas) follows these rules. Where the two disagree, this file wins.

Status: decided, except the items under [Still open](#17-still-open). Everything is built fresh: nothing is copied from
the older sites, `apps/web` or the `nori-pet` playground pages (see the roadmap in [ui-plan.md](ui-plan.md)).

## 1. Decisions at a glance

| Area | Decision |
|---|---|
| App | `apps/landing`: a new Next.js app with Tailwind v4 tokens from this file, `nori-pet` through a `file:` link, and `apps/api` only for sign-up |
| Theme | Dawn, light only on the landing page |
| Type | Geist Serif Triangle for headlines, Geist for text and UI, Geist Mono for numbers |
| Grid | 12 columns from 1024 px, 8 from 768 px, 4 below that; content up to 1200 px wide |
| Spacing | 4 px base, 10-step scale; sections 64 px apart on phones and 120 px on desktop |
| Breakpoints | 360 (smallest supported), 768, 1024, 1280, 1440 (design width), 1920 (widest layout) |
| Hero | Poster: full-bleed clay scene, headline in the sky, Nori on the hilltop with a note that unfolds into today's jobs |
| Images | One generated felt-and-clay world, 4 scenes plus a phone crop of the hero, AVIF with WebP fallback |
| Nori | Hops between section seats on desktop; on phones it leaves the hero and docks small in the corner |
| Motion | One easing curve, 4 durations, no scroll-jacking, everything off under reduced motion |
| Accessibility | WCAG 2.2 AA; every colour pair below is checked |
| Performance | LCP under 2.0 s on a mid-range phone, CLS under 0.05, under 500 KB before the first scroll |

## 2. Breakpoints and layout grid

Design at 1440 × 900 and 390 × 844, then check every width in the QA matrix (section 15).

| Range | Name | Columns | Side margin | Gutter | Notes |
|---|---|---|---|---|---|
| 360–767 | phone | 4 | 16 | 16 | One column of content. 360 is the smallest width that must work without horizontal scroll |
| 768–1023 | tablet | 8 | 32 | 24 | Two-up grids; the sticky panel in 03 turns into a stack |
| 1024–1279 | laptop | 12 | 32 | 24 | Full desktop layout; Nori starts hopping between seats |
| 1280–1919 | desktop | 12 | auto (content centred) | 24 | Content capped at 1200 px |
| 1920+ | wide | 12 | auto | 24 | Content stays at 1200 px; only scenes and section bands go wider. Scenes cap at 2560 px, then get a `bg` edge |

- Container: `max-width: 1200px` content plus side margins. The hero headline gets its own `max-width: 1120px`. Lead
  paragraphs cap at 640 px (about 60 characters) and body text at 68 characters.
- Grid: `grid-template-columns: repeat(N, minmax(0, 1fr))`. Two-up layouts span 6 + 6 (or 7 + 5 for text and visual) on
  12 columns, 4 + 4 on 8 columns, and stack on 4 columns.
- Hero height: `100svh`, with a minimum of 640 px and a maximum of 1080 px. The headline block is anchored to the top and
  the scene to the bottom (`object-position: 50% 100%`), so the hill and Nori's seat are always in view.
- Short screens (height under 760 px, common on 1280 × 720 laptops): the display size also obeys `11.5vh` (see section 4).
  That keeps the headline, subhead, buttons and Nori inside the first screen.

## 3. Spacing

A 4 px base. Use only these steps.

| Token | px | Typical use |
|---|---|---|
| `space-1` | 4 | Icon to label, tight chip padding |
| `space-2` | 8 | Gap between buttons, inside tags |
| `space-3` | 12 | Gap in lists of job rows |
| `space-4` | 16 | Heading to lead, phone side margin, card gap on phones |
| `space-5` | 24 | Lead to buttons, card padding, desktop gutter |
| `space-6` | 32 | Tablet and desktop side margin |
| `space-7` | 48 | Between a text block and its visual on desktop |
| `space-8` | 64 | Section padding on phones |
| `space-9` | 96 | Section padding on tablets |
| `space-10` | 128 | Largest gap: hero top on tall screens |

- Section padding (top and bottom): `clamp(4rem, 2.7rem + 5.333vw, 7.5rem)`, which is 64 px at 390 wide and 120 px at
  1440.
- Inside a section, in order: label, then `space-4`, then H2, then `space-4`, then lead, then `space-7` on desktop
  (`space-5` on phones), then content.
- Cards: padding `space-5` (24) on desktop and 20 on phones. Gap between cards: 20 on desktop and 16 on phones.
- Leave room for Nori: any card Nori sits on gets at least 96 px clear above it inside its section, so Nori never overlaps
  the heading above.
- Alternate section bands: 03, 05, 07 and 09 sit on `surface-2`; the rest sit on `bg`. That gives a slow rhythm without
  dividing lines.

## 4. Type

Families, all from Vercel's `geist` package (1.9.0 or later, SIL OFL): `geist/font/serif/triangle`, `geist/font/sans`
and `geist/font/mono`.

| Role | Font | Size, phone to desktop | Line height | Tracking | Notes |
|---|---|---|---|---|---|
| Display (hero) | Geist Serif Triangle 400 | `min(clamp(2.875rem, 1.436rem + 5.905vw, 6.75rem), 11.5vh)`: 46 to 108 px | 0.97 | -0.025em | One per page, at most 50 characters |
| Display (final CTA) | Geist Serif Triangle 400 | `clamp(2.5rem, 1.757rem + 3.048vw, 4.5rem)`: 40 to 72 px | 1.0 | -0.02em | |
| H2 | Geist Serif Triangle 400 | `clamp(2.125rem, 1.614rem + 2.095vw, 3.5rem)`: 34 to 56 px | 1.05 | -0.02em | At most 45 characters |
| H3 / card title | Geist 600 | `clamp(1.25rem, 1.157rem + 0.381vw, 1.5rem)`: 20 to 24 px | 1.3 | -0.01em | |
| Lead | Geist 400 | `clamp(1.0625rem, 0.993rem + 0.286vw, 1.25rem)`: 17 to 20 px | 1.55 | 0 | At most 160 characters |
| Body | Geist 400 | 16 px, 17 px from 1024 up | 1.55 | 0 | |
| UI label, button | Geist 600 | 16 px | 1 | 0 | |
| Small | Geist 400 | 14 px | 1.45 | 0 | Meta lines in job rows |
| Numbers, timer | Geist Mono 500 | Context size; the timer is 32 to 48 px | 1 | 0 | Fit scores, prices, codes, counters |
| Label / eyebrow | Geist Mono 400 | 12 to 13 px | 1.4 | 0.02em | Section labels, "Sample" tags |

Rules:
- Geist Serif ships only weight 400. Headlines get their weight from size alone. Set `font-synthesis: none` so a browser
  never fakes a bold or italic.
- Never use the serif below 26 px. Anything smaller uses Geist.
- Use only these three families. No other fonts, no all caps except in the mono labels, and no letter-spaced headings.
- Text on the hero image is always `ink`, never `ink-2` (see the contrast table).
- Copy is US English (the market is US jobs: "authorization", "resume").

## 5. Colour

Dawn tokens. Every colour on the page comes from this table.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FBF4EA` | Page background (rice cream) |
| `surface` | `#FFFDF8` | Cards, Nori's note, bubbles, sheets |
| `surface-2` | `#F5EBDD` | Alternate section bands, side panels |
| `tint` | `#F0E2CF` | Placeholders, chips, quiet fills |
| `line` | `#E4D7C4` | Decorative borders and rules only |
| `line-strong` | `#857A6A` | Form-field borders and other controls that must be seen (3:1) |
| `ink` | `#1F2A24` | Text, headlines, outline buttons, focus ring |
| `ink-2` | `#55605A` | Secondary text on plain backgrounds (never on images) |
| `accent` | `#2F5D46` | Seaweed green: primary buttons, active step, progress, Pro card border |
| `accent-hover` | `#244A38` | Primary button hover and press |
| `on-accent` | `#FFFDF8` | Text on `accent` |
| `peach` | `#E8936A` | Decoration only, such as confetti or a highlight stroke. Never text, never text on it smaller than 24 px |
| `danger` | `#B23A2E` | Errors (sign-up form) |
| `warning` | `#8A5A00` | "Needs you" states |

Contrast (WCAG 2.2; 4.5:1 for body text, 3:1 for large text and controls):

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on `bg` / `surface` / `surface-2` / `tint` | 13.6 / 14.6 / 12.6 / 11.7 | Pass, any size |
| `ink-2` on `bg` / `surface` / `surface-2` / `tint` | 6.0 / 6.4 / 5.6 / 5.1 | Pass, any size |
| `on-accent` on `accent` | 7.4 | Pass (buttons) |
| `accent` text on `bg` / `surface-2` | 6.9 / 6.4 | Pass (links, mono numbers in green) |
| `on-accent` on `accent-hover` | 9.8 | Pass |
| `line-strong` on `bg` / `surface` / `surface-2` | 3.9 / 4.1 / 3.6 | Pass for field borders (3:1) |
| `line` on `bg` | 1.3 | Decorative only, never the only edge of a control |
| `danger` / `warning` on `bg` | 5.4 / 5.4 | Pass |
| `ink` on the hero sky behind the headline (measured on the Dawn scene, worst pixel) | 9.6 | Pass |
| `ink` on the sky behind the subhead and buttons (worst pixel) | 8.2 / 6.5 | Pass |
| `ink-2` on the hero sky (average) | 4.9 to 3.7 | Fails lower down: hence "ink only on images" |
| White text on the hero sky | 1.2 to 1.8 | Never |

- Meaning is never carried by colour alone: the active step also has a thicker border, and statuses also have words.
- Selection colour: `tint` background with `ink` text.

## 6. Shape and depth

- Radii: chips and pills 999 px; inputs 10 px; job rows 12 px; cards 18 px; scenes and panels 24 px; bubbles 18 px with a
  tail; phone sheet 22 px on its top corners. Nothing else.
- Borders: 1.5 px `line` on cards; 1.5 px `line-strong` on inputs; 2.5 px `accent` for emphasis (the active step, the Pro
  card).
- Elevation, using warm ink-tinted shadows only:
  - `e0`: flat, a border only. All in-page cards.
  - `e1`: `0 1px 2px rgb(31 42 36 / .06), 0 8px 24px rgb(31 42 36 / .10)`. Nori's note, bubbles, the FAQ open state.
  - `e2`: `0 16px 48px rgb(31 42 36 / .16)`. The phone sheet and any dialog.
- No glass, blur, glow, gradients on text, or decorative gradients. The scenes bring the colour.

## 7. Components and states

Every interactive component has rest, hover (pointer devices only), focus-visible, active (pressed) and, where it
applies, loading and error states. Avoid disabled buttons; if one is truly needed, explain why next to it.

| Component | Spec |
|---|---|
| Primary button | Pill, height 50 (44 minimum), padding 0 24, `accent` fill with `on-accent` text. Hover `accent-hover`; press scales to 0.98 for 120 ms. One per view |
| Outline button | Pill, transparent, 1.5 px `ink` border, `ink` text. Hover fills with `tint` (or `surface` at 60% on images) |
| Text link | `ink`, underline 1 px with 3 px offset. Hover changes the underline to `accent` |
| Focus ring | `outline: 2px solid ink; outline-offset: 3px`, plus a 4 px `surface` halo (`box-shadow`) so it shows on the sky and on green buttons |
| Nav | Over the hero: transparent, 80 px tall. After the hero, a sticky 64 px bar on `bg` at 92% with a `line` bottom border. Phone: logo plus a menu button that opens a full-height sheet |
| Nori's note (closed) | `surface` pill, 1.5 px `ink` border, one rounded corner pointing at Nori, "**3** for today →", 44 px tall |
| Nori's note (open), desktop | A 400 px card at `e1` beside Nori: "Today" in the serif, 3 job rows, **Send all 3** and **Fold**. It's a disclosure (`aria-expanded`), not a modal; Esc folds it |
| Nori's note (open), phone | A bottom sheet at `e2` with a 40% scrim and a grab handle. It's a modal dialog: focus moves in and is trapped; Esc, the scrim and **Fold** close it |
| Job row | 12 px radius, `line` border, padding 12 by 14: title (Geist 600), meta (14 px `ink-2`), fit score on the right (Geist Mono) |
| Bubble (Nori) | From nori-pet; `surface`, 18 px radius, tail toward Nori, max width 280 px (phones: full width minus 32). Questions use real buttons |
| Tag | Mono 11 px, pill, `tint` fill, `ink-2` text. Every demo carries a "Sample" tag |
| Card | `surface`, 1.5 px `line` border, 18 px radius, `e0` |
| Sticky steps (03) | 4 step cards in a list with a sticky visual panel on the right (top: 96 px). The active step gets a 2.5 px `accent` border. Steps advance by IntersectionObserver, never by hijacking the scroll |
| Replay (04) | A browser-window frame, a form that fills in field by field, a side rail with the timer and steps. Controls: **Play / Pause** and **Run it again**, always visible (WCAG 2.2.2: anything moving for more than 5 seconds can be paused) |
| Pricing card | Free and Pro side by side from 768 px. On phones, Pro comes first |
| FAQ | Native `<details>`; summary 18 px Geist 600, 20 px vertical padding, `line` dividers; one open at a time is fine but not forced |
| Sign-up hand-off | **Get started** goes to `/signup`. Until part 2 (sign-in and sign-up) is designed and built, `/signup` and `/signin` are plain Dawn placeholder pages |

## 8. Images

### The scenes

| # | Scene | Where | Aspect and size | Safe areas |
|---|---|---|---|---|
| S1 | Dawn hills (`hero`) | Hero, 768 px and up | 3:2, 1536 × 1024 source | Top 50% calm: ink at least 9.6:1 behind the headline, 6.5:1 behind the buttons. Seat x 64%, y 67.5% |
| S1p | Dawn hills, portrait (`hero-phone`) | Hero, below 768 px | 2:3, 1024 × 1536 | Top 42% calm: ink at least 10.4:1 behind the headline, 8.0:1 behind the subhead and button. Seat x 42%, y 69% |
| S2 | Nori's little desk at morning light (`desk`) | 06, behind the question bubble | 4:3 | Seat on the desk's left half (x 30%, y 69%); calm wall on the right for the bubble, which is a `surface` card, not text on the image |
| S3 | Later-morning horizon (`horizon`) | 11, final call to action | 2:1 (21:9 crossed busy hills where ink fell to 1.5:1) | Words only inside the middle 50% of the width and the top 44%: ink at least 9.8:1 there. Seat on the low middle hill, x 50%, y 85% |
| S4 | Low horizon strip (`footer`) | Footer, where Nori sleeps | 4:1 | Plain sky above 30%; seat on the right hill, x 80%, y 55% |
| OG | Poster: S1, headline and Nori | Link previews | 1200 × 630 | Rendered by Next's `opengraph-image` route with the Geist fonts, in Phase 3 |

All five scenes are made and built: `apps/landing/art/scenes.mjs` generates them (prompts included), and
`apps/landing/art/build.mjs` records the picked takes, crops and seats and writes `public/scenes/` and
`lib/scenes.json`. Raw takes stay in `art/raw/`, which isn't committed.

### How they're made

- Model `gpt-image-2.5-sunburst`, quality high. Use the common prompt in `nori-pet/work/scenes.mjs`: felt, clay and rice
  paper diorama, no people, no text, an empty seat, a calm sky. Two takes per scene, then pick one. About $0.06 a take.
- Scenes never include Nori. The live sprite sits on the seat.
- Each scene gets a manifest entry (`scenes.json`) with its file, aspect, dominant colour and seat point (x%, y%), and its
  safe headline box. Code places Nori from the seat point and the image's `object-fit: cover` maths, so Nori stays on the
  hill at every width.

### Files

- Widths 768, 1280, 1920 and 2560 px, served with `srcset` and `sizes`. Phones get S1p via `<picture>` media queries.
- Format: AVIF (quality about 50) with a WebP fallback (quality about 80).
- The sources are 1536 px wide, so the 1920 and 2560 versions are upscaled. Use Lanczos with a light unsharp mask; the soft
  felt look hides it.
- Add about 1.5% noise to the sky before encoding. That stops colour banding in the smooth gradient.
- Budgets: hero at most 180 KB at 1920 (AVIF), other scenes at most 120 KB each. Built sizes at 1920 (AVIF): hero 61 KB,
  horizon 58 KB, footer 39 KB; the desk is 32 KB at its largest (1280) and the phone hero 48 KB at 1080.
- Loading: the hero is preloaded with `fetchpriority="high"` and sits on a `#FCD8B3` fill (the sky's average colour) with
  a 24 px blurred preview, so there is no flash. All other scenes lazy-load. Every image has a fixed `aspect-ratio` (no
  layout shift).
- Alt text: scenes are decorative (`alt=""`). The words carry the meaning.
- The headline box never moves onto busy parts of a scene. Check this at 360, 768, 1280 and 1920.

## 9. Nori

The same `@norinote/nori-pet` package as the dashboard: [nori-pet/README.md](../nori-pet/README.md).

| Width | Hero | After the hero |
|---|---|---|
| 1024 px and up | On the hill seat | Hops to each section's seat |
| 768–1023 | On the hill seat | Docks bottom right; plays each section's cue in place, no hopping |
| Below 768 | On the hill seat | Docks bottom right; cues in place |

Size: nori-pet's own default, `m` (112 px), or `s` (80 px) below 520 px, and whatever the visitor picks from Nori's
menu. The page doesn't change Nori's size from section to section, because nori-pet saves a size as the visitor's
preference, and a size change mid-scroll is jarring.

As built (`apps/landing/lib/choreo.ts`): the current section is the one covering the most of the screen (at least
40%), chosen 180 ms after scrolling settles. Nori glides and hops to its seat, then starts the cue. A seat without
room for Nori (under the sticky nav, or off the bottom) parks Nori in the corner until there's room. Once the visitor
drags Nori, it stays where they put it for the visit. Each section's rows are fetched while the section before it is
on screen.

Behaviour:
- **Seats.** Each section names one seat element (`data-nori-seat`). Nori uses `sitOn(seat)` when that section is at
  least 40% in view, and only once it has stopped hopping. Hops take 400 to 600 ms. A section's cue plays once Nori has
  arrived.
- **Hero note.** It peeks open by itself after about 3 seconds, once per visit (`sessionStorage`). It never opens by itself
  on phones; the closed note just wiggles once.
- **Bubbles.** At most one per section, at most 70 characters, closed after about 3.5 seconds or when the next one comes.
  The only bubble that waits is the question in 06.
- **Never covers** the headline, a primary button, a form field or the sticky nav. Seats sit beside content, not on it.
  If the phone keyboard opens or a sheet is up, Nori tucks itself away.
- **Layers (z-index):** content 0, sticky nav 50, Nori 60, Nori's bubble 61, sheets and dialogs 70, toasts 80.
- **Touch.** Nori's element has `touch-action: none`, so grabbing Nori doesn't scroll the page. It's small and docked in
  a corner, so it rarely gets in the way. Tap pets it (or opens the note in the hero); drag moves it; it remembers where it
  was dropped and whether it was tucked.
- **Loading.** On load: idle, blink, look and hold (about 110 KB). When a section comes within one screen, prefetch the
  next section's rows. The 32 rows the landing page uses total about 2 MB, and they are never loaded at once.
- **Reduced motion.** Still poses, no hops (Nori appears at each seat instead), no effects (nori-pet already does this).
- **Easter eggs**, which are enhancements and never required: drop Nori on **Get started** in 11 for `welcome` (bow); let
  the footer idle for 20 seconds for `sleep`.

## 10. Motion

| Token | Value | Used for |
|---|---|---|
| `ease-out` | `cubic-bezier(.2, .8, .2, 1)` | Everything that enters or responds |
| `ease-in-out` | `cubic-bezier(.45, 0, .55, 1)` | Loops and ambient motion only |
| `dur-fast` | 120 ms | Hover, press |
| `dur-base` | 200 ms | Small UI changes, tabs, FAQ |
| `dur-slow` | 320 ms | Note unfold, sheet, sticky step swaps |
| `dur-reveal` | 600 ms | Section content entering |

- Section reveals: content rises 12 px and fades in, once, with at most 3 items staggered 60 ms apart. Nothing
  re-animates on scroll back.
- Hero: the scene drifts at most 2% (slow parallax) on desktop only, and is still on phones and under reduced motion.
- No scroll-jacking, no smooth-scroll overrides, no autoplaying sound, and nothing flashes more than 3 times a second.
- Replay (04): starts when the frame is 50% in view, runs about 20 seconds mapped to the real phases, then stops on
  "Sent". Under reduced motion it shows the finished state and the step list.
- `prefers-reduced-motion: reduce` turns off reveals, parallax, hops and effects. Content is never hidden behind an
  animation that might not run (no `opacity: 0` without a fallback).

## 11. Responsive behaviour by section

| # | Desktop (1024+) | Tablet (768–1023) | Phone (below 768) |
|---|---|---|---|
| 01 Hero | Headline centred in the sky, buttons side by side, Nori on the right crest, note opens beside it | Same, smaller display size | Portrait scene; headline, subhead and one full-width **Get started**; note opens as a bottom sheet |
| 02 No board | Text left (5 col), wall-to-3 visual right (7 col) | Stacked, visual below | Stacked; the wall shows 12 tiles instead of 24 |
| 03 How it works | Steps left, sticky visual right | Steps with the visual inside each step | Same as tablet, Nori docked |
| 04 Replay | Form (8 col) plus side rail (4 col) | Side rail moves above the form | 3 fields only, timer on top, controls full width |
| 05 Tailored | Before and after side by side | Side by side | Stacked; the reason sits under each changed line |
| 06 In charge | Text left, S2 scene with the bubble right | Stacked, scene below | Stacked; the bubble opens from docked Nori, full width |
| 07 Smarter | 5-day row | 5-day row, smaller | Vertical timeline, Monday on top |
| 08 Wherever | 3 tiles | 3 tiles, then 2 + 1 under 900 px | Stacked |
| 09 Pricing | 2 cards, max 820 px wide | 2 cards | Stacked, Pro first |
| 10 FAQ | Single column, 860 px max | Same | Same |
| 11 Final CTA | S3 scene; headline, lead and button centred in the sky (top 44%, middle half), Nori on the hill below | Same | Words on plain `bg` above a cropped strip of the scene with Nori; full-width button |
| 12 Footer | One row | Wraps | Stacked, links in 2 columns |

## 12. Accessibility (WCAG 2.2 AA)

- Colour pairs pass (section 5); text on scenes is `ink` only.
- Keyboard: a skip link first; logical tab order; the focus ring on everything; Esc closes the note, the sheet and
  bubbles; Nori is a real button with a label that changes with its state.
- Targets: at least 44 × 44 px, and 8 px between neighbouring targets.
- Structure: one `h1` (the hero), an `h2` per section, landmarks (`header`, `nav`, `main`, `footer`), and lists marked up
  as lists.
- Motion: reduced motion respected; the replay can be paused.
- Nori's speech goes through nori-pet's polite live region, once per bubble.
- Zoom: at 200% and with the text-spacing override, nothing is cut off or overlaps.
- Language `en-US`. Forms (sign-up) have visible labels, errors in words next to the field, and no placeholder-only labels.
- Test with axe, keyboard only, VoiceOver on iOS and NVDA on Windows.

## 13. Performance and loading

| Budget | Target |
|---|---|
| LCP (hero image or headline) | Under 2.0 s on a mid-range phone on 4G (measured: 0.56 s, see Phase 5) |
| CLS | Under 0.05 (fixed aspect ratios, font fallbacks with `size-adjust`) |
| INP | Under 200 ms |
| Before the first scroll | Under 500 KB: HTML, CSS, fonts, hero, about 110 KB of Nori |
| JavaScript (gzip, first load) | The page's own code under 40 KB, not counting sprite images. Next 16 and React 19 add about 150 KB that no page can avoid (measured 3 Nov 2026: 188 KB in all, about 30 KB of it ours). The earlier 120 KB total isn't reachable on this stack |
| Fonts | Preload the serif and sans subsets (Latin). The mono loads normally. `font-display: swap` |

- The page is static (built ahead of time); the only live part is sign-up.
- Images and sprites load lazily, as in sections 8 and 9.
- No third-party scripts on the first screen.

## 14. Copy and content rules

- Hero headline at most 50 characters, H2s at most 45, leads at most 160. Buttons are 1 to 3 words, verb first, no
  exclamation marks.
- Only true numbers: "about 20 seconds". No user counts, ratings, testimonials or company logos.
- Every demo uses made-up companies and is tagged "Sample".
- Never suggest Nori gets past captchas, invents experience, or sends without approval or a cap the user set.
- Numbers (fit, prices, timers, codes) are set in Geist Mono.

## 15. Meta and QA matrix

- `<title>`: "Norinote: a few jobs you're likely to get, every morning" (58 characters). The meta description is at most
  155 characters.
- OG and Twitter image: 1200 × 630 poster (S1, headline, Nori).
- Favicon and app icons from Nori's idle frame (32, 180 and 512 px PNG). `theme-color` `#FBF4EA`.
- Canonical URL, `robots.txt`, `sitemap.xml`. Structured data: `SoftwareApplication` with the Free and Pro offers, only
  once prices are final.
- QA widths: 360, 390, 430, 768, 1024, 1280, 1440, 1920 and 2560. QA heights: 640, 720, 900 and 1080. Browsers: Chrome,
  Safari (macOS and iOS), Firefox and Edge.

## 16. Stack

Picked for these rules: a static, fast landing page now, and the same design and the same Nori for sign-in, sign-up,
onboarding and the dashboard later. Versions match what the repo already runs.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Matches the repo. Server Components keep the landing page's JavaScript small; the landing page is fully static (prerendered) |
| Routes | Route groups in one app: `(marketing)` for `/`, `/privacy`, `/terms`; `(auth)` for `/signin`, `/signup`; `(onboarding)`; and the dashboard later | One root layout mounts Nori once, so Nori carries over from the landing page into sign-up and onboarding without reloading. Shared tokens, fonts and components with no extra package |
| Styling | Tailwind CSS 4, CSS-first: the tokens in sections 3 to 6 and 10 live in one `@theme` block in `app/globals.css` | One source of truth for colour, spacing, radii, shadows and motion. No hand-typed hex values in components |
| Fonts | The `geist` package through `next/font`: `GeistSerifTriangle`, `GeistSans`, `GeistMono` | Self-hosted, preloaded, with automatic fallback metrics (no layout shift) |
| Components | Hand-built in `components/`, one file each; native `<dialog>` for the phone sheet, `<details>` for the FAQ, `popover` and `aria-expanded` for the note | Accessible by default, almost no JavaScript, no component-library look. No shadcn, Radix or MUI |
| Motion | CSS transitions and keyframes, IntersectionObserver, the Web Animations API | Covers every rule in section 10. No animation library, which keeps the bundle small |
| Nori | `@norinote/nori-pet` with a `file:` link; `nori-pet/scripts/copy-assets.mjs` copies its sprites into `public/nori/` before `dev` and `build`; one client component, `<NoriStage>`, in the root layout, plus a small seat controller | The package already does the player, bubbles, drag and accessibility |
| Images | An art folder in the app: `art/scenes.mjs` (prompts and generation with `gpt-image-2.5-sunburst`, the same spending ledger) and `art/build.mjs` (sharp: dither, upscale, AVIF and WebP at 4 widths, blurred previews, `scenes.json`). Pages use `<picture>` with the prebuilt files | Full control over quality and budgets, and it works on any host |
| Sign-up and sign-in (part 2) | Calls the existing `apps/api` auth endpoints, typed with the zod contracts in `@norinote/shared` | The backend is the product; only the UI is new |
| Tests | Vitest for small logic (the cover maths, the seat controller); Playwright for page checks and screenshots at the QA widths; `@axe-core/playwright` for accessibility; Lighthouse CI for the budgets in section 13 | Every item in the QA phase can be checked by a script |
| Lint and types | Its own `eslint.config.mjs` (Next's rules) and `tsconfig.json`. The repo's root lint and type check skip `apps/landing`, as they already skip `apps/web` | Keeps the backend's `npm run gate` unaffected |
| Hosting | To be decided (Vercel fits Next.js and Geist best). Nothing is deployed without an explicit go | |

App layout:

```
apps/landing/
  app/
    layout.tsx            fonts, <NoriStage>, skip link
    globals.css           Tailwind 4 @theme tokens and base styles
    (marketing)/page.tsx  the landing page: sections 01 to 12
    (marketing)/privacy/, (marketing)/terms/
    (auth)/signin/, (auth)/signup/   placeholders until part 2
  components/             Button, Nav, NoriNote, JobRow, Bubble, StepList, Replay, PricingCard, Faq, Scene, ...
  sections/               one file per landing section (Hero.tsx, NoBoard.tsx, ...)
  lib/                    seat controller, cover maths, motion helpers
  art/                    scene prompts, generation and the image pipeline (raw files are not committed)
  public/nori/, public/scenes/
  tests/                  Playwright and Vitest
```

## 17. Still open

- Final headline and section copy.
- The Free tier's limits.
- Analytics: none, or a cookieless one. Without tracking cookies there's no consent banner.
- Domain and where it's hosted. Nothing gets deployed without an explicit go.

## 18. Build checklist

Phase 0, decide
- [x] App location and stack: `apps/landing`, as in section 16 (decided 2026-11-03).
- [ ] Approve the final copy for all 12 sections.
- [ ] Set the Free tier's limits.

Phase 1, foundation
- [x] Scaffold the app (section 16); add `geist` and `@norinote/nori-pet`; copy Nori's assets into `public/nori/`.
- [x] Make the repo's root lint and type check skip `apps/landing`, as they skip `apps/web`.
- [x] Placeholder `/signin` and `/signup` pages so every landing link works.
- [x] Tokens: colours (section 5), spacing (3), radii and elevation (6), motion (10) as CSS variables and Tailwind theme
  (`apps/landing/app/globals.css`).
- [x] Type: the three families through `geist/font/*`, the clamp scale (section 4), `font-synthesis: none`.
- [x] Base styles: the `wrap` container, the focus ring, selection colour, skip link, reduced-motion defaults.

Phase 2, art
- [x] Generate S1p (portrait hero), S2 (desk), S3 (horizon) and S4 (footer). Two takes each, then pick.
- [x] Image pipeline: noise dither, upscale, AVIF and WebP at each width, blurred previews, `scenes.json` with seat points.
- [x] Icons from Nori's resting frame (`art/icons.mjs`: 32 px favicon, 180 px Apple icon, 512 px).
- [x] The OG and Twitter images (`art/og.mjs`, with a TTF copy of Geist Serif Triangle in `art/fonts/` under the OFL).

Phase 3, sections, in order
- [x] Nav (over-hero and sticky states, phone menu sheet).
- [x] 01 poster hero with the note (desktop disclosure, phone sheet). The hero scene is anchored 30% from the top, so
  on wide, short screens the hill and Nori stay below the buttons.
- [x] 02 to 12 as specified, plus `/privacy` and `/terms` placeholders. The copy is the wireframe draft until Phase 0's
  copy review. No GitHub link in the footer until the repository's visibility is confirmed.
- [x] Interim Nori: it sits on the hero's hill while the hero is in view and docks otherwise; clicking it there opens
  the note. Every section already carries its `data-nori-seat`, and the replay, question and note send
  `norinote:replay`, `norinote:answer` and `norinote:note` for Phase 4.

Phase 4, Nori choreography
- [x] A seat controller: IntersectionObserver per section, `sitOn` seats, cues, row prefetch (`lib/choreo.ts`).
- [x] Phone and tablet docking, the hero note (Nori opens it too), the "never covers" rules (room above every seat,
  parking under the nav). Sheets sit above Nori (layer 70 over 60), so it doesn't need to tuck for them.
- [x] The replay timeline driving both the form and Nori, with Play / Pause; Nori catches up if it lands mid-run.
- [x] Drop Nori on the final Get started for a bow and sign-up; Nori falls asleep after 20 seconds on the footer.
- [ ] Check with reduced motion turned on in the operating system (the browser pane can't emulate it). nori-pet shows
  still poses and the page skips reveals, but nobody has looked yet.

Phase 5, QA (`apps/landing/tests/qa.mjs`: build with `NEXT_DIST_DIR=.next-qa npm run build`, serve with
`NEXT_DIST_DIR=.next-qa npx next start -p 3401`, then `npm run qa`). Last run, 3 Nov 2026: 184 of 184 checks pass,
twice in a row.
- [x] Every width and height in the QA matrix (11 sizes, 360 × 640 to 2560 × 1440, plus 720 × 450 for 200% zoom) in
  Chromium, Firefox and WebKit (Playwright 1.64). Each one checks: no sideways scroll; the hero buttons in the first
  screen; Nori and its note clear of the headline, subhead and buttons; the scene loaded; Nori clear of every heading,
  button and the nav, section by section; no console errors. Edge is Chromium, so Chromium covers it.
- [x] axe (WCAG 2.0 to 2.2 A and AA, plus best practice) at 1440 and 390: no violations. What axe leaves to a person is
  the contrast of text over the scenes, measured pixel by pixel instead (sections 5 and 8).
- [x] Keyboard: the skip link comes first, every stop shows a focus ring, every focused element is in view, and every
  target is at least 24 px.
- [x] Reduced motion (emulated): no content hidden behind reveals, the replay shows the finished run, Nori moves
  without gliding.
- [x] Text spacing (WCAG 1.4.12) at 1440 and 390: no sideways scroll, no clipped text.
- [x] Performance on a 390 px phone, 4G (9 Mbps, 60 ms), 4x slower CPU, cold cache: LCP 0.56 s (the headline), CLS 0,
  499 KB before the first scroll. Lighthouse's slow 4G, for reference: LCP 0.91 s, CLS 0.026, 428 KB. This is
  Playwright with Chromium's own timing, not the Lighthouse tool.
- [x] Honesty pass: "200 listings" became "hundreds" (never measured); "tomorrow's shortlist" became "your first
  shortlist" (it's built as soon as a resume is in); every other claim matches ARCHITECTURE.md and docs/.
- [ ] Not done here, needs a person: VoiceOver on an iPhone and NVDA on Windows; real phones (the QA ran in emulation);
  Safari itself (WebKit stands in for it); reduced motion turned on in a real operating system.

What QA changed:
- nori-pet fetched all 45 strips (about 2.6 MB) right after load. It has a `preload: "lazy"` option now, which the
  landing page uses; extra strips wait until the page has settled.
- The first frame waited on the whole 10,000 px page (LCP 2.4 s). Sections below the hero skip layout until the page
  settles (`content-visibility`), then render for real (`components/Settle.tsx`).
- Geist Mono is no longer preloaded (70 KB). Running text uses tabular figures; mono stays for data.
- Nori checks every seat and its corner for anything it would cover. It parks or tucks itself away instead, and the
  extra room above the Wherever and Pricing seats keeps it off their headings.
- On phones, the hero note sits at the hero's bottom left. On short phones (under 760 px tall) the subhead gets a
  rice-cream backing, because it lands on the hills there.
- The footer clips its scene, which removed 13 px of sideways scroll at 360. No board stacks on phones.
- Nav and footer links are at least 24 px tall. The note's fit scores use hidden text instead of an `aria-label` on a
  span.
- `upgrade-insecure-requests` is sent only when the site URL is https: on http://localhost, Safari loaded nothing.

Phase 6, ship prep, only with an explicit go
- [ ] Meta, sitemap and robots; the analytics decision; domain and hosting.
