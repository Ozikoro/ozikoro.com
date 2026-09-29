# Decisions log

Running record of decisions for the Ozituma Igbo Learning Platform, as required by §2.1 of
`Ozituma_Igbo_Learning_Platform_Spec.docx`: *"MUST ask the human when a requirement is
ambiguous instead of guessing, and record the answer in /docs/decisions.md."*

**How to read this.** §18 lists twelve decisions that only the owner can make. Each is
reproduced below with the spec's own default, the current status, and what it blocks. A default
is not a decision — it is what happens if nobody decides, and several defaults knowingly ship a
worse product. Items marked **BLOCKING** stop work.

**Status values:** `OPEN` (awaiting the owner) · `ANSWERED` (decided, with date) ·
`PROPOSED` (developer recommendation awaiting approval) · `DEFERRED` (correctly not needed yet)

---

## Owner decisions (§18)

### D1 — Final product display name
**Spec default:** working name "Ozituma Learn Igbo" · **Status:** PROPOSED
The address `learn.ozituma.com` is confirmed and is not in question. The display name is.
Proposed: **"Ozituma Learn"** for the platform, **"Igbo"** for the course, matching the existing
`data/learn/igbo.json` course title and the `/learn/igbo` route. Blocks nothing technically;
affects titles, metadata and copy.

### D2 — Launch content volume and levels
**Spec default:** Level 0 and 1, 30 lessons, 400 vocabulary items · **Status:** OPEN
Affects nothing in code (the schema is volume-independent) but everything in scheduling.

### D3 — Dialect stance for launch
**Spec default:** Standard Igbo only; dialect notes as tagged extras · **Status:** OPEN
The dictionary already holds 48 mapped dialects with recordings, so the extras exist. The
question is whether they appear in learner-facing lesson content at launch. §11.1 requires the
linguists to set the policy before it is implemented as a rule.

### D4 — Lead linguist and native-speaker reviewers
**Spec default:** **none — explicitly BLOCKING** · **Status:** OPEN — **BLOCKING**
§17.3 requires a lead linguist plus at least two native reviewers from different regions, and
§11.1 requires them to write the orthography, tone-marking, dialect and register style guide.
**No learner-visible Igbo content can be published before this is answered.** It also blocks
resolving the unverified content described in `M0-FINDINGS.md` §3.3.

### D5 — Minimum age and child policy
**Spec default:** adults and teens 13+, parental notice under 18, no under-13 accounts ·
**Status:** OPEN
Affects the signup flow, the AI tutor's strictness settings (§8.2 safety layer) and the privacy
policy. The default is workable and can be implemented while the decision is pending, but any
change later touches auth, consent records and the tutor.

### D6 — Pricing and plan limits
**Spec default:** everything free during beta; premium switched off · **Status:** OPEN
Blocks only §14 work, which the default defers past v1.0.

### D7 — Payment providers at launch
**Spec default:** payments disabled at v1.0, enabled at v1.1 · **Status:** OPEN
Paystack is already integrated in the existing app, which makes the v1.1 path cheaper than the
spec assumes. Stripe is absent and would be new work.

### D8 — Shared login with ozituma.com from day one or later
**Spec default:** later; separate accounts in v1.0 · **Status:** OPEN
**This one now has a real answer available.** The spec recommended answering it in a Phase 0
discovery pass, which has been done: accounts, sessions and `scrypt` password hashing already
exist and work, and the session cookie can be scoped to `.ozituma.com`. Sharing from day one is
therefore *cheaper* here than the spec's default assumes — it is one cookie domain rather than a
second auth system. Blocks the auth work in M1.

### D9 — Hosting region and providers
**Spec default:** developer recommendation after a latency test · **Status:** PROPOSED
Recommendation: keep the existing stack — AWS `us-east-1`, single EC2, Docker Compose, Caddy,
Cloudflare in front — rather than moving to Vercel/Cloudflare Pages. Reasons in
`M0-FINDINGS.md` §4. A second Next.js build must be sized first, and a latency check from
Nigeria against `us-east-1` versus an EU region is worth running before committing.

### D10 — Who owns and pays for AI usage, and the spending cap
**Spec default:** owner-held account with a low hard cap in beta · **Status:** OPEN
Needed at M7. The account must exist before the §8.3 evaluation harness can run, because the
harness is what gates every prompt and model change.

### D11 — Does the platform fall inside the existing Ozituma equity arrangement?
**Spec default:** **none — "settle in writing before work starts"** · **Status:** OPEN — **BLOCKING**
§6.2 and §17.4 both flag this. The repository's own `AGENTS.md` records that Ozituma is run with
a developer partner under an existing equity arrangement, so the question is concrete rather
than hypothetical. This is a legal question, not an engineering one, and no technical work
resolves it. §17.4 also requires contributor agreements for linguists and recording consent
releases for every speaker — without those, audio cannot be commissioned.

### D12 — Tutor enabled for all users in beta
**Spec default:** enabled with strict limits and labels · **Status:** OPEN
Needed at M7. The default is reasonable.

---

## Technical decisions made during discovery

These are substitutions or clarifications under §2 (*"the developer MAY propose an alternative,
provided every requirement in Sections 8, 10 and 13 is still met"*). Each records what was
given up and what replaces it.

### T1 — Keep the existing Postgres and data layer; do not adopt Supabase
**Status:** PROPOSED · **Detail:** `M0-FINDINGS.md` §4.1
Supabase bundles Postgres, auth, storage and RLS; all four already exist here and are in
production with a 16,596-headword corpus, ~46,000 audio objects and a live Paystack integration.
Adopting it would create a second database and a shared-lexicon sync problem in exchange for
capabilities already present.

### T2 — Skip Row Level Security; retain server-side authorisation
**Status:** PROPOSED · **Detail:** `M0-FINDINGS.md` §4.3
RLS defends databases that clients reach directly. The browser here never touches Postgres;
every query goes through a server-side route holding the only credentials. The substitution is
recorded because it is a deliberate departure from an explicit MUST in §9 and §13, and it must
be revisited if any future feature gives a client direct database access.

### T3 — Do not rebuild `/lib/text`
**Status:** PROPOSED · **Detail:** `M0-FINDINGS.md` §3.2
§19.5 proposes a `/lib/text` module for NFC and diacritic handling. That already exists as
`packages/core/src/orthography.ts`, tested, and handles the dot-below/dot-above distinction more
precisely than the spec requires. `/lib/text` becomes a re-export.

### T4 — CI is part of M0, not a later milestone
**Status:** PROPOSED · **Detail:** `M0-FINDINGS.md` §4.4
There is no CI in the repository. §19.2's definition of done and §13's testing requirements
cannot be enforced without it, so it is pulled forward.

### T5 — Unverified AI-authored Igbo is quarantined as draft
**Status:** PROPOSED · **Detail:** `M0-FINDINGS.md` §3.3
`data/learn/igbo.json` contains 46 vocabulary items, 23 phrases and grammar/cultural claims
written by an AI before this spec existed. §2.1 forbids AI-authored language content reaching
learners. Proposed: retain as engine test data, stamp `ai_generated = true` and
`status = 'draft'`, exclude from production, and route anything that survives through the §11.5
review gates. **This is a self-report and the owner should confirm the handling.**

### T6 — Adopt Tailwind for the new app, or extend the existing design system
**Status:** OPEN — needs the owner (see M0 questions)
§7 specifies Tailwind and a Radix/shadcn component library. The existing app uses plain CSS
custom properties with an established palette (`--ink`, `--ochre`, `--clay`, `--paper`), a type
scale and components. Two options: adopt Tailwind in `apps/learn` (spec-faithful, two styling
systems in one repo), or extend the existing tokens (one system, diverges from §7). §7 requires
fonts to be tested for Igbo diacritics either way.

### T7 — `regions.test.ts` was never run, and it had been failing
**Status:** FIXED · **Detail:** found while adding the exercise tests
`packages/core/package.json` listed test files explicitly and omitted `src/regions.test.ts`. The
file had therefore never run in CI or locally, and three of its assertions had been failing since
it was written. Fixed by changing the script to `node --test src/*.test.ts`, which cannot drift
again when a file is added.

**What the failure turned out to be:** the test asserted `isIgboRegion('Nsukka')` (double k — the
English anglicisation) while the vocabulary, `data/names/origins.json` and the project's own
dialect table all use **`Nsuka`** — the ASCII-folded Igbo form of *Nsụka* (single k). The code was
consistent with itself; the test was the outlier. Corrected the test rather than the data, and
left the vocabulary untouched.

**Raised, not decided — [LINGUIST TO CONFIRM]:** whether learner-facing text should print the
English *Nsukka* or the Igbo *Nsụka* is an orthography decision, and §11.1 assigns those to the
linguists. It matters beyond this one word: §11.1 requires a style guide covering "spelling, word
division, capitalisation, hyphenation", and place names that have both an English and an Igbo form
are the first place a learner notices which convention the platform chose. No code change is
needed until that guide exists.

### T8 — `flashcard` added to the canonical question type union
**Status:** PROPOSED · **Detail:** `packages/core/src/exercises.ts`
Appendix A's `type` list is `mcq | match | listen | sentence_build | fill_gap | scramble |
speaking | free_response`, which does not include flashcard — but §F5 lists flashcard as one of
the six v1.0 types and §F6 requires the learner to rate recall on it as Again/Hard/Good/Easy. It
is a real type with a real scorer (the rating *is* the SRS input), so it belongs in the union
rather than being disguised as an `mcq` with no options. Flagged rather than assumed because
Appendix A is explicit.

### T9 — The learner-facing trust label follows review status, not AI provenance
**Status:** FIXED · **Detail:** `packages/core/src/exercises.ts`, `packages/core/src/ai/retrieval.ts`
Two modules were answering the same question differently. `trustLabelFor` let `aiGenerated` win in
every case, so a published AI-drafted question was labelled "AI-assisted"; the new retrieval layer
labels a tutor answer "verified" whenever it is grounded in published content.

§5.3 settles it. The two labels are defined as "Reviewed and approved by an authorised linguist or
native-speaker reviewer" and "Generated or transformed with AI and **not yet editorially
verified**". "Not yet" is decisive: published content has, by the §5.3 lifecycle, passed linguist
and native-speaker approval, so it is verified, and calling it AI-assisted understates a review
that actually happened. `aiGenerated` is still stored on every row and is what the CMS and an
auditor read — it is simply not the thing the learner-facing label certifies.

An earlier test asserted the opposite behaviour; it was rewritten with the reasoning recorded.

### T10 — The AI layer lives in `packages/core/src/ai/`, not in `/lib/ai`
**Status:** PROPOSED · **Detail:** §19.5 suggests `/lib/ai` inside the app
The gateway, prompt registry, retrieval, validator, limits and evaluation harness are pure domain
logic with no dependence on Next.js, the database or a provider — so they sit in `packages/core`
alongside the exercise engine and the SRS, where they are testable with `node --test` and sharable
with whatever the M6+ admin CMS turns out to be. The spec's `/lib/ai` becomes a thin re-export if
the app split (Q1) creates `apps/learn`.

### T11 — The 200-case evaluation set is a linguist deliverable and is not authored here
**Status:** BLOCKED on D4 · **Detail:** `packages/core/src/ai/evaluation.ts`
§8.1 requires "at least 200 test prompts with reference answers" and §2.1 forbids an agent writing
Igbo reference answers. The harness is built and tested; the cases cannot be. `validateEvalSet`
refuses to certify a release against fewer than 200 cases or against a set that does not cover all
six §8.3 measures, so the gap cannot be papered over when the time comes.

---

## Open questions raised during discovery

| # | Question | Blocks |
|---|---|---|
| Q1 | Stack and deployment: keep Postgres + existing auth? One app or split `apps/learn`? | M1, and all UI work |
| Q2 | Tailwind for the new app, or extend the existing CSS design system? | M1 design system |
| Q3 | Confirm the handling of the unverified Igbo content (T5) | M2 content load |
| Q4 | Is hosting staying on the current EC2 instance, or moving? | M1 environments, cost |
| Q5 | Which region should be latency-tested for West African learners? | D9, M1 |
| Q6 | Does the Name Dictionary need re-exporting for the shared-lexicon import, and in what format? | M2 |
| Q7 | Orthography convention for names with both an English and an Igbo form (`Nsukka` / `Nsụka`) — see T7 | The §11.1 style guide |

---

## Recorded answers

Answers are appended with their date, so the reason a thing was built the way it was is never
re-litigated from memory.

### 28 September 2026 — owner answered the M0 blocking questions

| # | Question | Answer |
|---|---|---|
| Q1 / T-arch | One app or split `apps/learn`? | **Split to `apps/learn`**, sharing `packages/core` and `packages/db`. Confirms §6.1: separate deployment, independent release cycle, own container behind Caddy at `learn.ozituma.com`. The host-based routing built earlier is superseded. |
| Q2 / T6 | Tailwind, or the existing CSS system? | **Extend the existing CSS design-token system.** Diverges from §7's Tailwind recommendation under the §2 substitution clause, in exchange for one visual system across the dictionary and the courses. §7's requirement that fonts be tested for Igbo diacritics still applies. |
| Q3 / T5 | How to handle the unverified AI-authored Igbo? | **Quarantine as unverified draft.** Re-stamp as AI-generated and `draft`, exclude from production, retain as engine test data, and route anything that survives through the §11.5 linguist and native-speaker gates. Nothing is deleted. |
| Q4 | What next? | **Finish the pure domain core** — SRS scheduler, XP/streaks with timezone edge cases, and the §8.1 AI guardrail layer — all stack-independent and testable before the app split begins. |

**Still open and blocking learner-visible content:** D4 (lead linguist and native reviewers —
no default), D11 (equity and IP — settle in writing before work starts), and the §17.4 legal
instruments. None of these are engineering decisions and no amount of code resolves them.

