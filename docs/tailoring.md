# Tailoring

How `@norinote/tailor` turns a person's career points into a resume for one job. The goal is the strongest truthful match:
mirror the posting's wording, lead with the most relevant real experience, and list every real skill the posting names.
Rewriting and reframing are allowed; adding a skill, tool, employer, number, scope or seniority is not. A must-have the
person lacks is a gap in the report, never a line on the resume.

## Pipeline (`tailorResume` in tailor.ts)

1. **Evidence** (`evidence.ts`). Requirements come from the job spec (must-haves, nice-to-haves, listed skills not already
   named) or the fit map. Each names terms found through the alias table (`aliases.ts`, about 290 canonical terms with
   aliases and acronyms across tech, business and healthcare; short ambiguous names such as Go, R, ED, Epic match only
   in their exact case; false friends such as "MQL to SQL" are ignored). A term requirement is supported only by a point
   that names one of its terms, exactly or by alias. A descriptive requirement is supported by shared words, then the fit
   map, then embedding similarity (cosine 0.45 or more) when vectors are available. A soft requirement (ownership,
   end-to-end, startup pace, stakeholder work, self-direction, ambiguity, mentoring, people leadership; `key-phrases.ts`)
   counts only where a point shows the behaviour ("from design through on-call", "partnered with supply chain"), and only
   the line that shows it supports it. Each descriptive requirement keeps the posting's own key phrase ("Experience building
   and operating production services" -> "production services"). No support is a gap.
2. **Selection** (`select.ts`, no model). A bullet's weight is the requirements its own text supports, must-haves
   counting double (plus a little for a number). Roles: the latest always, the rest by coverage, shown newest first. The
   latest and recent (ended within 3 years) or relevant (75% of the best role's coverage) roles get 3 to 5 bullets, older
   ones 1 to 2. Bullets in a role go best first, except that the latest role's first three each lead with a different
   supported must-have (its `focus`); the one-page fitter never cuts a role's heaviest bullet. Skills:
   every skill the job names that the person shows anywhere (skills lists or text), in the job's spelling and order, with
   the long form or acronym once when the person writes the other one ("Amazon Web Services (AWS)"), then the rest.
   Years for the summary: whole years from the person's own dates in roles sharing a title word with the job title,
   rounded down; none (no year count at all) below 2.
3. **Rewrite** (`rewrite.ts`). One large-model call (gpt-4.1, temperature 0.2, strict JSON). Input: up to 6 bullets (every
   shown bullet of the top role, then the heaviest others), each with its source (its own line plus the role's title,
   organisation and dates), the requirements that source truly supports, the posting terms and key phrases it may carry
   (`mirror`: only for evidence that is a term match, shared words, the behaviour itself, or fit-map or semantic evidence of
   0.6 or more), its `focus`, and the terms and phrases the person lacks. Output: each bullet with its source id, and a 2 to
   3 sentence summary. Style: verb, what, how, result; 18 to 28 words; a different opening verb per bullet; past tense for
   every bullet, the current role included; the posting's exact term and key phrase where true, never a near synonym; each
   key term at most 3 times on the resume; no generic phrases or requirement boilerplate (`phrases.ts`).
4. **Gate** (`gateBullet` in validate.ts), per bullet, all failures reported: every number (digits or words), tool or
   skill term, employer and title must be in the cited source (alias aware); no term of a requirement the person lacks;
   no key phrase of an unsupported requirement, no wording of an unshown soft requirement; no tool released after the role
   ended (`release-years.ts`); 16 to 30 words; no banned phrase; opening verb unused elsewhere; past tense; no term past 3
   uses; no first person; no raised ownership. Failing bullets are retried once in one
   small-model call with the reasons; failing twice reverts to the person's words. The summary has its own gate: provenance
   against all career points; a year count only if it equals the target-function years (2 or more), and never tied to a
   skill or field ("9 years of experience in HubSpot" fails); every alias-table term in the career points; no title the person has
   not held (except "for X roles"), banned phrases, overuse. A rejected summary falls back to one built from facts.
5. **Critique and revise**, at most 2 rounds. A small-model reviewer sees the open gaps (supported requirements not shown,
   or supported must-haves whose key phrase is not on the resume word for word, with the bullets whose sources support them) and the rewrites with their sources, and may return only coverage gaps or
   faithfulness fixes. Revisions go through the same gate; an unfaithful rewrite that cannot be fixed reverts; a round
   that lowers coverage is undone. Stops when nothing is open, when coverage stops improving, or after round 2
   (`nextRound`).
6. **Render** to one page and store: `resumes.changes` (each bullet change with its source ids, gate result and attempts)
   and `resumes.ats_checks.tailoring` (`TailoringReport`: supported must-have coverage for the resume as written, after
   selection and final, alias aware, exact spelling and verbatim key phrase; gaps with lacking terms; per-bullet results;
   rounds; calls and cost).

Without the AI service (`AiUnavailableError`, budget, malformed reply) steps 3 to 5 are skipped: evidence, selection,
ordering, skills and a facts-only summary still produce a complete resume, and the report says why.

## Cost

One gpt-4.1 call (about 1,700 tokens in, 350 out) is about 0.6 cents; retries, critique and revisions run on gpt-4.1-mini.
Eval run 2: $0.0100 mean, $0.0139 max per resume.

## Eval

`npx tsx scripts/eval/tailor.mts` runs 27 pairs (12 fictional profiles x 2 shortlist jobs from a copy of the job index,
plus 3 adversarial pairs) under a hard cap ($1.21 across runs) and reports coverage before and after (alias aware, exact
spelling, verbatim key phrase), unsupported entities (independent check, must be 0), banned phrases, tense, words per
bullet, verb diversity, a gpt-4o judge (relevance, truthfulness, specificity, tone), and cost, compared with the previous run.
Run 1 (docs/eval/tailor-run1.md): coverage 80.5% -> 90.5%, judge truthfulness 4.7. Run 2 (docs/eval/tailor-run2.md, 26 of
27 pairs before the cap): coverage 83.4% -> 96.2%, exact spelling 82.7% -> 95.5%, verbatim key phrase 74.6% -> 86.6%,
0 unsupported entities, judge 3.0 / 4.8 / 3.8 / 3.8.
