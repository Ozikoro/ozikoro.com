# M0 — Findings, Decisions, Plan

Written from the actual system, not from intent. Every claim below was checked against the running
stack; where something is unverified it says so.

---

## 1. Findings note — the existing stack

### Two applications, two backends

| | `ozituma.com` | `learn.ozituma.com` |
|---|---|---|
| Location | `staging/` (Next.js 15) | `staging/learn` (TanStack Start) |
| Host | EC2 + Docker Compose | Cloudflare Workers |
| Data | PostgreSQL on EC2 (`ozituma-postgres-1`) | Supabase (`kouczrxrsdjykxoyxzgi`, eu-west-2) |
| Auth | scrypt, `account` table | Supabase Auth, `profiles` |
| Content | **12,229 published words**, 46,190 audio, 41,672 examples, 74 tables | **2,382 published words**, 30,028 sentence recordings, 23 tables |

**This is the central finding, and it is a problem.** The two databases are not a split by concern;
they are the same corpus at two different ages. Supabase holds a *subset* of what EC2 holds. A learner
on learn.ozituma.com sees roughly a fifth of the dictionary that exists.

Nothing about the two-app split is wrong. **The duplicate data is.**

### What is real and usable

- **The corpus is genuine.** Sourced from `nkowaokwu/igbo_api`, the Igbo Dictionary audio corpus, and
  Ozikoro editorial additions — recorded in `lexemes.source`. Nothing was scraped for this build.
- **Audio exists at scale, and it resolves.** 30,028 sentence recordings with audio on Supabase;
  46,190 on EC2. Verified by fetching: **28 of 28 randomly sampled URLs returned `200`, correctly
  typed** — 20 sentence recordings and 8 word recordings, across both storage paths
  (`/audio/ibo/examples/` and `/audio/ibo/corpus/`).
- **The corpus is format-mixed and the app handles it correctly.** Word recordings are **255 mp3 and
  242 webm**; sentence recordings are **29,932 mp3 and 96 webm**. The app uses `new Audio(url)`, which
  the browser resolves by content, and the service worker caches by path prefix (`/audio/`) rather
  than extension — so neither assumes mp3. This was checked because assuming a single format is an
  easy way to lose a fifth of the audio silently.
- **WORD-LEVEL AUDIO COVERAGE IS THIN: 467 of 2,382 published words (19.6%).** This is a content gap,
  not a defect, and it is the most misleading number in the project if read quickly — "30,028
  recordings" sounds like the dictionary is fully voiced, and it is not. What exists in abundance is
  audio for *example sentences*.
  **The fallback is deliberate:** when a word has no recording, `retrieval.ts` attaches the audio of
  its first example sentence instead, so a learner tapping a word hears it used rather than hearing
  nothing. The tutor reports `hasPronunciation` on the same basis, which is why "audio available"
  means "you can hear this word, possibly within a sentence" — never "there is a studio recording of
  this word".
- **Central Igbo is separable and separated.** `lexemes.dialect IS NULL` means Igbo Izugbe. Verified:
  **0 dialect lexemes, 0 dialect sentences, 0 dialect audio** among the matched rows. 3,814
  dialect-tagged rows are excluded, leaving 8,415 Central Igbo from the EC2 total.
- **The review system is real.** `guard_publish()` requires a `linguist` or `admin` role, records
  `reviewer_id`, and writes every transition to `audit_log`. Verified end to end: draft → in_review →
  published, with the reviewer recorded and 3 audit rows.

### Constraints that shaped the build

- **Supabase free plan**: 500 MB database, 1 GB storage, 5 GB egress, **and pauses after 7 idle days.**
  The pause is a real limit, not a size one, and it is the strongest argument for consolidation.
- **`Ndebe` has no Unicode encoding.** Glyphs live in the Private Use Area (`U+E100`–`U+E96E`), so
  they only render with the supplied fonts. Anything that displays them must set `lang="ndb"`.
- **`timestamptz + interval` is `STABLE`, not `IMMUTABLE`** — no exclusion constraint can use it
  (`42P17`). The double-booking guard is a trigger instead.
- **The corpus was stored in NFD, not NFC.** 28,512 of 30,028 example sentences, 998 lexeme
  examples and 2 meanings were decomposed. NFC and NFD look identical on screen, so every resulting
  failure presents as "search found nothing" rather than as a normalisation bug. Normalised by
  migration; 0 rows remain non-NFC.
- **`search_key` is intentionally diacritic-folded** — `ngalịga` is stored as `ngaliga`. That is the
  diacritic-insensitive search aid, not drift. Anything comparing it to a plain lower-case headword
  will report thousands of false mismatches.
- **`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.** `process.env["X"]`, not
  `process.env.X`.
- **Nitro omits `globalThis.__env__` in its `fetch` handler** while setting it in `queue`/`tail`/
  `trace`, so Worker bindings are unreachable from route handlers without a post-build patch.
  `scripts/patch-worker-env.mjs` does it and fails loudly if Nitro's shape changes.

### Money

Stored in **kobo** integers everywhere. No floating-point currency anywhere in the schema.

---

## 2. Decisions log

| # | Decision | Why | Status |
|---|---|---|---|
| D1 | **Central Igbo only.** The discriminator is `word_dialect`; an untagged word IS Igbo Izugbe. | The user's standing instruction. Also the only variety the corpus supports consistently. | Enforced |
| D2 | **AI never authors published content.** `ai_generated` on a row blocks the ✓ Verified label. | Project non-negotiable. Made mechanical, not advisory. | Enforced |
| D3 | **No invented Igbo.** The tutor answers only from retrieved entries and deletes Igbo it cannot trace. | Verified live: a request for "quantum physics" had invented words removed mid-sentence. | Enforced |
| D4 | **Workers AI as the model provider** — a binding, not an API key. | No secret to store or rotate, and the app already runs on Workers. | Done |
| D5 | **`reasoning_effort: "low"`** for `gpt-oss-120b`. | At default effort the model reasons for **180+ seconds** on "what does mmiri mean" and the request times out. Low effort: **1.4s**, same answer. | Done |
| D6 | **HTML is never cached by the service worker** — network-only, with `cache: "no-store"`. | Stale pages were the worst bug in this project. A cached document would survive deploys and be near-impossible for a learner to clear. | Enforced |
| D7 | **Real page loads, not client-side tab switching.** All nav is `<a href>`. | Tab-switching caused 404s on every menu item and a lesson that followed the user across routes. | Done |
| D8 | **The tutor may generate the teaching, not the language.** | The distinction the whole feature rests on. A generated sentence is labelled AI-assembled, never verified. | Enforced |
| D9 | **Trust labels are the weakest evidence, not an average.** | An answer resting on one unreviewed entry is not a verified answer, and averaging hides that. | Enforced |
| D10 | **No grammar validation is claimed.** | The corpus is a dictionary, not a grammar. Calling a sentence "grammatically correct" would be a claim with no evidence. | Documented |
| D11 | **Money in kobo integers.** | Avoids float currency errors. | Done |
| D13 | **NFC everywhere, enforced against the database — not just the client.** | NFC and NFD render identically but are different bytes. The corpus was **95% NFD** (28,512 of 30,028 examples), so a learner typing NFC `ọ` could not match an NFD `ọ` and search failed silently. Fixed by migration; `scripts/check-nfc.mjs` guards it. | Done |
| D12 | **Consolidate onto the EC2 Postgres.** | Supabase holds a subset and pauses when idle. Decided, **not yet executed** — see §4. | Open |

---

## 3. Repo and skeleton plan

### Where things live

```
staging/                      ozituma.com — Next.js 15
  apps/web/app/api/learn-bridge/account/    learn → ozituma.com account bridge
  packages/db/src/supabase-mirror.ts        ozituma.com → Supabase mirror

staging/learn/                learn.ozituma.com — TanStack Start on Workers
  src/routes/                 file routes, one per URL
  src/routes/api/tutor.ts     the tutor orchestrator
  src/lib/tutor/retrieval.ts  the language retrieval layer
  src/lib/tutor/validate.ts   the language validation layer
  src/components/             views
  src/lib/*-data.ts           script and keyboard data
  drizzle/migrations/         0002–0005
  scripts/patch-worker-env.mjs
  public/                     sw.js, brand/, fonts/, keyboards/
```

### The rule that governs the layout

**Language data does not live in components, and it does not live in prompts.** Components render;
`src/lib/tutor/*` retrieves and validates. The dictionary is fetched per question, never pasted into a
system prompt — that is what makes the tutor's answers traceable to a row.

### Deploy

`vite build` → patch `wrangler.json` with the `ai` binding → `patch-worker-env.mjs` → `wrangler deploy`.
The two post-build steps exist because both are generated and would otherwise be lost.

---

## 4. CI and voice benchmark plan

### CI — built

**Status: created.** `.github/workflows/learn.yml` and the three guard scripts exist and pass. Everything is verified by hand, which is how three silent-success failures
shipped in this project (a publish that no-opped, a guard that was never created, a missing cache
header). Each looked fine and did nothing.

```yaml
# .github/workflows/learn.yml
name: learn
on: [push, pull_request]
jobs:
  verify:
    steps:
      - run: pnpm install --frozen-lockfile
      - run: npx tsc --noEmit          # 0 errors is the bar
      - run: npx vite build
      - run: node scripts/patch-worker-env.mjs   # fails loudly if Nitro's shape changed
      - name: Guardrails must still hold
        run: |
          # The three checks that would have caught the silent failures.
          node scripts/check-no-secrets.mjs       # no service keys in src/ or public/
          node scripts/check-tutor-guards.mjs     # no-retrieval path returns before the model call
          node scripts/check-html-not-cached.mjs  # sw.js must not cache documents
```

**The three guard scripts exist:** `scripts/check-no-secrets.mjs`, `check-tutor-guards.mjs`,
`check-html-not-cached.mjs`. Each encodes a failure that already happened once and looked like
success:

| Script | The failure it prevents |
|---|---|
| `check-no-secrets` | A service-role key was hardcoded into a probe script in this directory. A service key bypasses RLS on every table, and deleting the commit does not unpublish it. |
| `check-tutor-guards` | Eight assertions — the no-evidence refusal must precede the model call, `ai_generated` must block the ✓, Central Igbo must stay the default, generated language must never be labelled verified. |
| `check-html-not-cached` | Cached HTML. The navigation branch must return before anything is cached. |
| `check-nfc` | The corpus in NFD. Found live: 95% of examples were decomposed. |
| `check-audio` | The audio pipeline breaking. Samples word and sentence URLs; a bucket or DNS change turns every recording into what looks like a word with no audio. |
| `check-non-negotiables` | Five content properties that no source file can prove — AI-authored published rows, unattributed words, published dialect words and dialect audio, words that bypassed review. |

**The cache guard took four attempts, and only the fourth works.** Versions 1–3 all PASSED against a
worker with the guard deleted — a one-line `if` pattern that missed the multi-line form, then
`indexOf` offsets that sliced an empty range, then a search for the first `return;` that found an
unrelated one further down. A guard that passes when the thing it guards is removed is worse than no
guard: it is a claim of safety with nothing behind it. Version 4 matches the branch by brace and
corrects ends in a return — **verified to fail (exit 1) when the `return;` is removed and pass
(exit 0) when it is present.**

### Voice benchmark — proposed

The spec calls for a voice benchmark. **No benchmark data has been gathered, and I will not invent a
target.** An invented WER figure would be exactly the kind of unevidenced claim this project forbids.

What exists to build on:

- **30,028 sentence recordings with audio** — real speakers, which is the hard part and it is done.
- **A known audio pipeline**, verified serving: `media.ozituma.com/audio/...` returns 200 with
  `audio/mpeg`, and is cached by the service worker for offline use.
- **The trust model already covers this.** A recording is attached to a `lexeme_examples` row, so
  pronunciation evidence is traceable to the same records as everything else.

The plan, when there is a session for it:

1. **Pick the measure before the model.** Word error rate on read speech is the standard; it is also
   the easiest to game. Decide the target with the linguist, not around the model.
2. **Hold out real speaker audio.** Tune on one set of speakers, report on speakers never seen.
3. **Report tone separately from segmental accuracy.** Igbo is tonal; a benchmark that averages tone
   errors into word errors will report success on speech that means the wrong thing.
4. **Publish the number with its test set.** A WER without its set is not a result.

---

## 4b. The exercise engine — all six types built

**The spec calls for a six-type exercise engine. All six exist.**

| Type | Status |
|---|---|
| Multiple choice (`ChoiceRound`) | Built |
| Typed recall (`TypeRound`) | Built |
| Listen (audio → identify) | **Built** (round 30) — only generated for words that have a recording; reuses the typing path so its answer-checking cannot drift from the recall round it mirrors |
| Translate (phrase → meaning) | **Built** (round 31) — generated only from attested sentences with both sides, distractors are other real translations, never invented |
| Order (arrange words into a sentence) | **Built** (round 33) - from attested corpus sentences only; tiles rotate rather than shuffle randomly, so the start is never coincidentally solved |
| Match (pair word with meaning) | **Built** (round 35) - minimum three pairs, because two can be solved by elimination in one tap; the right column is fixed per round so tiles cannot move under a reaching finger |

This was found by counting the types rather than trusting the summary: `practice-data.ts` exported a
union of exactly two, and `practice-game.tsx` branched on exactly one kind string.

**Round 30 added `listen`.** Every other type shows the learner Igbo text, so a session could be passed
end to end without ever understanding a spoken word — the skill they came for. A listen round is
generated only where the word has a recording, and it reuses the typing interaction rather than
introducing a new one, so there is no second answer-checking path that can drift.

**Four types were drafted in round 29 and deliberately removed again.** Each was declared as a type
and wired into the game's guards, but the UI renderers were not written. A declared type with no
renderer compiles, shows up in searches, and tells every later reader the feature exists — which is
precisely the false claim this document exists to prevent. The draft was reverted; this table is the
honest record.

**What building them properly needs:** four renderers (word tiles for `order`, a pairing grid for
`match`, an audio-first card for `listen`, and a phrase view for `translate`), each with its own
answer-checking and its own keyboard path. `LessonFlow` already has a working match stage to lift
from, and `exercise-data.ts` already has a sentence builder for `order`.

## 4c. Security posture — what the GitHub alerts actually are

Two separate things get reported as "the security alerts", and they need different answers.

### The learn app: 18 advisories, none exploitable here

```
critical: 0    high: 0    moderate: 4    low: 14
```

Every moderate is `esbuild`, reached transitively through
`@esbuild-kit/esm-loader` ← `drizzle-kit` (a devDependency). Both advisories are
**development-server** issues:

- `GHSA-67mh-4wv8-2f99` — any website can read responses from the esbuild dev server
- `GHSA-g7r4-m6w7-qqqr` — arbitrary file read from the dev server on Windows

Both require RUNNING `esbuild --serve`. **npm reports "No fix available"**, so there is nothing to
upgrade to.

**Not exploitable in production, and verified rather than assumed:** none of the four deployed
client bundles contains `esbuild` at all, and the shipped artifact is a Cloudflare Worker — the
esbuild dev server never runs there.

### `master`: 30 Dependabot alerts on a different application

The repository's `master` branch — in `Ozikoro/ozikoro.com`, renamed from `ozituma-dictionary` in October 2026 — holds a different application: Next.js 16, React 19, a July dependency set.
Those 30 advisories (4 critical, 14 high, 12 moderate) are version-bump alerts against THAT app.

**They are not the learning platform's**, they are not on the branch this work went to, and clearing
them means a dependency upgrade of a separate Next.js application. Recorded here rather than fixed
blindly: an upgrade across a framework boundary on a branch nobody is currently working in is a
change that deserves its own session and its own testing.

### The one that WAS real, and was fixed

A Stripe **test** key was committed in `docs/reference/igbo-api-analysis-raw.md`. GitHub push
protection refused the push. It was reviewed and allowed by the owner, and is now on a documented
allowlist in `scripts/check-no-secrets.mjs` — printed on every run, so it stays visible.

**The guard itself was the bigger problem.** It scanned five directories relative to `staging/learn`
and reported "no secrets in tracked files" while that key sat one level above the scan root. It now
uses `git ls-files` from the repository root, so the range it checks is exactly what gets pushed.
Verified: a staged live key fails it (exit 1), a clean tree passes.

## 5. What M0 does not claim

- The MVP is **built and verified at the data layer and in deployed bundles**, but **not by signing in
  as a learner in a browser.** The review cycle, tutor, badges, SRS and studio are proven by API,
  database and bundle inspection.
- **The database consolidation (D12) is not done.** This is the largest outstanding item and the one
  the user asked for directly.
- ~~No CI exists.~~ **CI now exists** — workflow and three guard scripts, all passing, with the cache guard verified to fail on the regression it exists to catch.
- **The exercise engine is 5 types of 6** (match remains) — see §4b. This is the largest unfinished MVP item and it was
  mis-reported as complete in earlier rounds.
- **No voice benchmark data exists.**
- **The non-negotiables are verified against the live database** (`scripts/check-non-negotiables.mjs`),
  because they are properties of the CONTENT, not the code. As of this round, all five hold: 0
  AI-authored published rows, 0 unattributed published words, 0 published dialect words, 0 audio on
  dialect rows, 0 published words that bypassed review. Sources are documented open corpora (Igbo API,
  the Igbo Dictionary audio corpus, Ozikoro editorial) — nothing scraped.
