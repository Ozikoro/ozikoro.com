# Architecture

This document records the design decisions behind Ozituma and — more usefully — *why* each was made,
including what the reference implementation does instead and what it cost.

The reference throughout is the open-source [Igbo API](https://github.com/nkowaokwu/igbo_api) behind
igboapi.com and nkowaokwu.com: the closest working model of what Ozituma is, and the source of both
the corpus we build on and a set of lessons taken from its architecture.

---

## Shape of the system

```
                    ┌─────────────────────────────────────────┐
   browser ────────▶│  Next.js 15 (App Router)                │
                    │                                         │
                    │  app/**/page.tsx   dictionary UI        │
                    │  app/api/v1/**     public REST API      │
                    │  lib/api.ts        auth + metering      │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │  packages/db                            │
                    │    repository.ts   search + reads       │
                    │    apikeys.ts      API keys, plans,     │
                    │                    quota enforcement    │
                    │    accounts.ts     passwords, sessions  │
                    │    contributions.ts submissions + the   │
                    │                    only publish path    │
                    │    migrate.ts      SQL migration runner │
                    │    import/         corpus importers     │
                    └───────────────┬─────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
    ┌─────────▼──────────┐                     ┌──────────▼─────────┐
    │ PostgreSQL         │                     │ S3-compatible      │
    │  (RDS in prod,     │                     │ object storage     │
    │   PGlite locally)  │                     │  (audio, uploads)  │
    └────────────────────┘                     └────────────────────┘

    packages/core — pure domain logic, no I/O:
      orthography.ts   the diacritic model
      languages.ts     language registry
      types.ts         API contracts, error codes
```

A **single deployable unit**. The Ozikoro technical scope calls for a 2–5 person team, so one Next.js
application serving both the site and the API is the right operational size: one build, one deploy,
one set of shared types. Business logic lives in `packages/core` and `packages/db`, not in route
handlers, so extracting a standalone API service later is a packaging change rather than a rewrite.

---

## Decision 1 — PostgreSQL, not document storage

The reference implementation stores words in MongoDB documents with deeply nested arrays and serves
them through `Model.aggregate().match().lookup()` pipelines.

Ozituma uses relational Postgres because the domain is relational, and because the platform's own
roadmap depends on it: the Ozikoro scope places clan registries, genealogy (people connected to
people) and PostGIS geography on the same database. Starting document-shaped and migrating later is
the expensive path.

The concrete wins here:

| Need | Reference implementation | Ozituma |
|---|---|---|
| "Is this a word?" | Regex per letter, unindexed | Btree lookup on a stored `search_form` column |
| Typo tolerance | 4 `stringSimilarity` calls per document in JS | `pg_trgm` GIN index (production) |
| Definition search | Mongo `$text` plus regex, re-ranked in JS | `tsvector` generated column, GIN index, `ts_rank` |
| Multi-sense / multi-dialect | Embedded subdocuments, `$lookup` at read time | Foreign keys and join tables |
| "Words whose spelling varies by dialect" | Scan every document | Indexed join |

**Tradeoff accepted:** more upfront schema design, and queries are written as SQL rather than
chained builder calls. In exchange, the database enforces the invariants and the query planner does
the ranking.

---

## Decision 2 — Two drivers, one SQL dialect

`DATABASE_URL` set → `node-postgres`. Unset → **PGlite**, which is Postgres 16 compiled to
WebAssembly.

This is not a mock or an emulation: it is the same engine, so the same migrations, generated
`tsvector` columns, GIN indexes, enum types and SQL run against both. Consequences:

- A new developer runs the whole platform with `npm install && npm run db:migrate` — no Postgres, no
  Docker, no service container.
- CI can run unit-level database tests without a sidecar.
- Production runs real Postgres on RDS with zero dialect drift.

**Limits, stated honestly:**

1. **PGlite is single-process.** A running dev server and a CLI script cannot share one data
   directory, and writes from one are not visible to the other. Use `DATABASE_URL` with Docker
   Postgres whenever you need both at once. (This bit during development: a plan-limit change made
   by a script was invisible to the running server until it restarted. That is expected behaviour,
   not a bug.)
2. **PGlite ships no `pg_trgm`.** Migration 0002 therefore installs the extension *defensively* — it
   tries, catches failure, and only builds the trigram indexes if it actually landed. The API
   feature-detects at runtime (`db.hasTrigram()`) and degrades to exact + prefix + full-text matching,
   reporting which strategy it used in `diagnostics`. Fuzzy search is better in production and still
   correct locally.

**Rejected alternative:** requiring Postgres for all development. It raises the floor for
contributing to a project whose contributors are, by design, linguists and language communities
rather than infrastructure engineers.

---

## Decision 3 — Plain SQL migrations, no ORM

Migrations are numbered `.sql` files applied in filename order and tracked in a `schema_migration`
table with a checksum. Editing an already-applied migration produces a loud warning rather than
silent divergence.

Ozituma leans on Postgres-specific features — generated `tsvector` columns, GIN indexes, expression
and partial indexes, enum types, `num_nonnulls` checks — and all of those are clearer as SQL a
reviewer can read than as ORM metadata that generates SQL nobody inspects. It also keeps the schema
portable: nothing about it is tied to a JavaScript toolchain.

Each migration runs inside a transaction. Postgres has transactional DDL, so a failed migration rolls
back whole.

---

## Decision 4 — The orthography model

The most consequential decision in the codebase.

**The problem.** African orthographies written in Latin script use combining diacritics for two
different purposes:

1. **Letter identity.** A dot below makes `ọ`, `ẹ`, `ṣ` distinct letters — in Igbo, Yoruba, Edo,
   Urhobo, Efik and Ibibio alike. A dot above makes Igbo `ṅ`. Removing these changes the word.
2. **Tone and length.** `ákwá` (cry) and `àkwà` (bed) are the same letters with different tone.

The reference implementation handles this with an Igbo-specific `diacriticCodes.ts`, two different
`removeAccents` modes and a hand-built regex with Igbo-only character ranges. That cannot generalise
to Yoruba, let alone to the Edoid and Bantu languages on Ozituma's roadmap.

**The solution.** `packages/core/src/orthography.ts` classifies marks by *function*, per language, and
every headword stores two derived projections computed in one pass:

| Field | Contains | Used for |
|---|---|---|
| `headword` | Original spelling, **case preserved** | Display |
| `exact_form` | Tone marks stripped, letter marks kept, case folded | "Same word, any tone" matching |
| `search_form` | All marks stripped, case folded | Permissive search and indexing |

Why case is preserved: the corpus carries both `Àba` (the town) and `àba` (a common noun) — 30 such
pairs. Lowercasing headwords silently merges them. Case is folded only in the derived search keys, so
users can type either casing and find both.

**Tradeoff accepted:** two extra indexed columns per row and the discipline of never deriving them
by hand. In exchange, tone-blind search works identically for every language, and the correctness
of all 8,822 rows is re-derived independently in `verify.ts` — the check computes the forms in
TypeScript and compares, rather than trying to express the folding rules in SQL. (An earlier version
of that check used `'[\u0300-\u036f]'`, which Postgres reads as a literal `u` and which therefore
matched nothing — a false pass. That is exactly why the check now re-derives rather than pattern-matches.)

---

## Decision 5 — Search in the database

`searchWords` runs two queries concurrently and merges them:

- **Headword direction** — exact match, prefix, alternate spellings, dialect spellings, fuzzy
  (when available), each scored; whole-headword matches outrank substring matches.
- **Definition direction** — `tsvector @@ plainto_tsquery('english', q)` over English glosses,
  ranked by `ts_rank`.

Results merge on word id (a headword match beats a definition match for the same word), then gain a
small bonus for high-frequency words and short headwords. This is what makes a single search box
answer both `water` and `mmiri` without the user choosing a direction.

**Tradeoff accepted:** the substring fallback (`LIKE '%x%'`) cannot use a btree index. At 8,822 rows
that is a sub-millisecond scan and the right trade for correctness; past roughly a million rows the
pg_trgm GIN index takes over automatically, because the fuzzy clause is added whenever the extension
is present.

**Rejected alternative:** reimplementing the reference's Redis response cache. Caching was
load-bearing there because search could not use an index at all. With indexed search, Postgres'
own plan and buffer cache are sufficient, and the API sets HTTP `Cache-Control` for edge caching
instead. A cache in front of an unindexed query hides the problem; fixing the query removes it.

---

## Decision 6 — API keys hashed, quotas resolved

Two specific failures in the reference implementation, both fixed structurally.

**Keys.** igbo_api generates a plain UUID v4 and stores it in cleartext (`const generateApiKey =
uuid`), so a database leak hands over every working credential. Ozituma stores a SHA-256 hash plus a
short display prefix: `ozt_live_8b150041…`. The plaintext key is returned exactly once at creation, and
an integrity check asserts the plaintext is not present in the table.

**Quotas.** igbo_api advertises 500 requests/day on its free tier and 2,500 on Team, but its
`authorizeDeveloperUsage` middleware never reads the developer's plan, so both tiers get a flat 2,500.
Worse, the pricing page and the enforced limit live in different files, so they drifted.

Ozituma makes the limit a database row in `plan_limit`, resolved per request as
`(plan, endpoint)` → `(plan, '*')`. The docs and pricing pages *read the same rows they are enforced
from*, so drift is impossible by construction. A plan with no configured limit **fails closed** rather
than allowing unlimited traffic.

Other corrections: every error code maps to an explicit HTTP status (the reference returns 400 for
everything, including rate limiting — which its own skipped test expected to be 403), a 429 carries
`Retry-After`, and CORS is permissive on `/api/v1` deliberately, since the API is meant to be called
from other people's browsers.

---

## Decision 7 — Attribution as structure

Detailed in [`DATA-SOURCES.md`](DATA-SOURCES.md). In short: `source` is a table, `source_id` is a
foreign key on every imported row, the API returns an `attribution` object per entry, and `verify.ts`
fails if any imported row is missing one. Both upstream licences require attribution, so a data
pipeline that can silently lose it is a compliance bug waiting to happen.

---

## Decision 8 — Idempotent, bulk, verified imports

The reference seeds itself by re-expanding its JSON dictionary at boot, printing to stdout, sleeping
15 seconds for MongoDB to rebuild text indexes, and calling `process.exit(0)`.

Ozituma's importer:

1. Merges the corpus in memory, keyed on the **tidied** headword — so `a-  m` and `a- m` become one
   entry, and a multi-row upsert cannot touch the same conflict target twice (Postgres rejects that,
   and it is the first error a naive importer hits).
2. Parks the source's existing slugs before writing, so re-imports can reallocate slugs derived from
   the folded spelling (`àkwà` and `ákwá` both want `akwa`) without violating the unique index.
3. Bulk-upserts in batched multi-`VALUES` statements inside a transaction.
4. Replaces only **its own** child rows, so editor and community contributions to the same headword
   survive a re-import.
5. Reports exactly what it did — and re-running it produces identical counts, which is asserted
   during development.

Then `npm run verify` re-derives every search key, checks uniqueness, scoping, attribution
completeness, index presence and functional search behaviour. 31 checks. It exits non-zero, so it is
usable as a CI gate.

---

## Decision 9 — Contributions are inert until a human approves them

The Ozikoro scope names this pattern twice, for the Name Dictionary and the Language Platform: "a
contribution/submission flow so ... the public can submit entries, with a review step before
publishing — the same open-contribution-plus-editorial-queue model both Afam and nkowaokwu.com
already use successfully."

So a submission is a `suggestion` row and nothing more. It is data *about* a proposed change. The
dictionary tables are written in exactly one function, `applySuggestion`, reachable only from
`reviewSuggestion`, which requires an `editor` or `admin` role. A submission that nobody reviews
changes nothing, forever.

Three details carry the weight:

**Self-review is refused.** A contributor cannot approve their own submission. Without that rule the
queue is decorative — the first thing anyone would do is approve themselves.

**Approval is idempotent by construction.** Reviewing requires the row to still be `pending`, so a
stale browser tab holding an approve button cannot apply the same contribution twice. This is
enforced in the database layer, not only in the route, because the route is not the only possible
caller.

**Approved content is attributed.** A community word whose headword already exists is *merged* —
the new definitions attach to the existing entry — and a community word that is new gets a
`source_id` pointing at `ozituma-community`, not at an upstream corpus. That keeps the
"every headword names a source" invariant in `verify.ts` meaningful: without it, the check would
pass on a lie. The submission's payload is `jsonb` so a new kind of contribution can be stored and
rendered before the UI knows how to apply it, but every field is validated on the way in *and* again
when applied.

### Sessions and passwords

Passwords use `scrypt` with a per-password salt and a self-describing stored format
(`scrypt$N$r$p$salt$hash`), so cost parameters can be raised later without invalidating existing
hashes. Only length is enforced — composition rules push people towards predictable substitutions.

Sessions are server-side and the cookie carries a random token whose **SHA-256 hash** is all that is
stored, so a database leak does not yield live sessions. Server-side sessions were chosen over
self-contained JWTs specifically because suspending an account or revoking one session must take
effect immediately; a stateless token can only be revoked via a list that amounts to the same table.

`Secure` on the cookie is derived from the configured site URL's scheme rather than `NODE_ENV`.
Basing it on `NODE_ENV` alone means `next start` — a production build served over plain HTTP for
testing — sets a cookie the browser silently refuses to store, so sign-in appears to succeed and does
nothing. That failure mode was hit during development and is why the rule is written down.

**Tradeoff accepted:** no email verification and no password reset flow yet. Both need an email
provider, and adding unverified email as a recovery path for a dictionary that accepts anonymous-ish
contributions would be a security regression dressed as a feature. The `account.email_verified`
column exists and is unused.

---

## Decision 10 — Audio goes through the same queue, and its bytes are not trusted

Pronunciation is the feature that makes a dictionary usable by a learner, and it is the first place
Ozituma accepts a binary from an untrusted user. Three decisions follow from that.

**Recordings are contributions, not a separate pipeline.** A recording creates a `suggestion` of kind
`audio`, exactly like a word or a correction. It is reviewed by the same editors in the same queue,
and only approval writes an `audio` row — with `status = 'published'`. Unreviewed recordings are
invisible to the public API. An unreviewed *definition* is embarrassing; an unreviewed *voice* is
someone's identifiable speech published without consent, so this path is the strictest one.

**The bytes are checked, not the label.** These files are served back to browsers from our own
origin, and the declared content type comes from the client. A file uploaded as `audio/wav` that is
actually HTML would be a stored-XSS vector. So `verifyAudioSignature` sniffs the container
signature — EBML for WebM, `OggS` for Ogg, `RIFF`/`WAVE` for WAV, `ID3`/frame sync for MP3, `ftyp`
for M4A — and rejects anything that does not match. The media route additionally re-derives the
content type from the *stored extension* rather than from anything the uploader sent, sends
`X-Content-Type-Options: nosniff`, and refuses to emit a type outside a known audio allowlist.

Size is enforced on the real byte length, which is worth stating because the reference implementation
measures a base64 string while its interface promises a smaller limit — so its stated limit is never
the one enforced.

**Two storage drivers, one interface.** `S3_BUCKET` set selects S3 (or MinIO, R2, Spaces); unset
selects the local filesystem. Same reasoning as PGlite for the database: the whole
record → review → publish → play path is buildable and testable without cloud credentials, which is
how it was verified here. The local driver logs a loud warning under `NODE_ENV=production`, because
its failure mode is silent data loss — a container filesystem is ephemeral, so recordings vanish on
redeploy while the database still points at keys that no longer exist.

**Uploads are proxied through the application rather than presigned.** At scale, presigned
direct-to-S3 uploads are the right answer. At a few tens of kilobytes per voice clip they would add a
second authentication mechanism, a bucket-policy surface and a CORS configuration to defend, in
exchange for bandwidth the application carries easily — and a proxy is the only arrangement where the
server can validate the bytes *before* they reach storage. Revisit if media size or volume grows.

**Tradeoff accepted:** a rejected recording leaves an orphaned object in the bucket, because the row
and the bytes cannot be deleted in one transaction. That is the correct order — the alternative is
losing an object while its row survives, which is unrecoverable — but it means a periodic sweep of
unreferenced objects is needed, and none is written yet.

---

## Decision 11 — The courses are a second hostname, not a second application

Ozituma Learn lives at `learn.ozituma.com` and is served by the **same** Next.js
process, the same container and the same database as the dictionary. The app reads
the `Host` header, serves Learn's chrome instead of the dictionary's, and rewrites
`/` to `/learn` (`apps/web/middleware.ts`). DNS is a `CNAME`; TLS is already
covered by Cloudflare's wildcard.

**The alternative was a separate app**, and it is the obvious shape: a course
platform and a reference work do not feel like one product. It was rejected on
three counts.

*Duplication.* A second app would need its own database client, its own session
and account handling, its own audio components and its own copy of
`@ozituma/core`. Those are not incidental — sessions and the eight-table corpus
model are the bulk of the backend — and the second copy would drift from the
first. The courses read the dictionary's own tables, so the two are not loosely
coupled; they are the same data.

*Cost.* The host is a `t4g.medium` sized explicitly around the memory peak of one
Next.js build. A second app means a second build on the same box, and either a
larger instance or a build that intermittently fails.

*The hostname is not the product boundary.* What makes Learn a distinct thing to a
learner is the curriculum, the chrome and the URL, not the process that renders
it. All three are separable from deployment topology, and all three are what was
built.

The subdomain is **canonical** — it is what appears in course canonical links and
what should be shared — while `ozituma.com/learn/*` also serves. That is
deliberate: the dictionary's navigation can link to the courses without
hard-coding a second domain, and the courses stay reachable if the subdomain's DNS
is having a bad day. Link prefixes are computed per request
(`apps/web/lib/learn-host.ts`) so that neither form produces a broken link on the
other host — a link written as `/learn/igbo` would, on the subdomain, rewrite to
`/learn/learn/igbo` and 404, and that failure is invisible in local development,
where the path form is the one you test.

### Course content is authored, not derived from the dictionary

The dictionary answers *what does this word mean*. A course answers *what should I
learn next, and can I now do it*. The first does not contain the second:

- A dictionary is unordered and complete; a course is ordered and partial. Twelve
  thousand Igbo headwords in alphabetical order teach nobody anything.
- A dictionary entry is evidence; a lesson is an argument. That `Kèdú` is a
  greeting does not say a beginner should meet it first, or that it belongs beside
  `Ọ dị mma`, or that it should be practised before `Nnọọ`. That sequencing is the
  product.
- A course has learners attached to it. Progress is per-account, which the
  dictionary has no notion of.

So lessons are authored in `data/learn/*.json` and imported by an idempotent
script, and `learn_vocab.dictionary_headword` links a word back to its entry *when
the corpus has it*. The link is a bonus, not a dependency: the course renders in
full against an empty dictionary, which matters because a course must not break
when a corpus import is re-run, and because the sixteen registered languages with
no corpus still need somewhere for their curriculum to live.

### Exercise grading moved to the server

`practice.ts` sends the answer to the browser and documents why that is
acceptable there: no score, no leaderboard, nothing to win, so cheating only
wastes the cheater's time. It also names the condition that would end that —
"when a leaderboard is added, grading must move to the server".

Lessons removed the condition without adding a leaderboard. A lesson now has
persistent progress and a stored `best_score` attached to a real account, and a
stored score a learner can forge is worse than no score at all: it is a number the
platform asserts and cannot stand behind.

So the answer never leaves the server. Two consequences follow, and both are
load-bearing:

1. **Composition is deterministic.** The server grades a submission it did not
   keep in memory, by rebuilding the exercise set from lesson content alone. Which
   exercises a lesson contains is a pure function of that content.
2. **Only the presentation varies.** Option order is shuffled per request, so a
   learner cannot memorise "it is always the third button", but the *identity* of
   the correct option never moves. `test:learn` asserts exactly this, because if
   the answer moved with the shuffle every score would be wrong while every page
   still looked right.

Typed answers are graded leniently on purpose. Igbo marks tone, and tone changes
meaning — `ákwá` (egg) and `àkwà` (bed) are different words — but a learner typing
on an English keyboard has learned the word and cannot yet type the orthography.
Failing them would teach that the keyboard is the subject. Tone marks and the dots
under `ị`, `ọ`, `ụ` and `ṅ` are printed on every card and are **not** graded.

---

## Testing strategy

| Layer | How it is tested |
|---|---|
| Orthography | 12 `node:test` unit tests against real Igbo and Yoruba words (`npm test`) |
| Contracts | 7 tests proving the frozen-contract guard can fail, plus live assertions in the smoke test |
| Schema | Applied from scratch to PGlite on every run |
| Data | 31 integrity checks including independent re-derivation (`npm run verify`) |
| Search / reads / key system | End-to-end smoke script exercising real queries and real quota behaviour |
| Contribution lifecycle | `test:contributions` — 77 checks: signup, submission, hostile input, role enforcement, self-review, approval, merge, rejection, audio storage and publication, and cleanup |
| Curriculum and exercises | `test:learn` — the course loads and is well formed; lesson bodies are validated and malformed blocks rejected; the answer is provably identical across presentation seeds while option order differs; the client payload carries no answer; typed answers tolerate tone marks and case but reject a different real word; progress keeps the best score across a worse run; the importer is idempotent. Creates its own account and removes it |
| Exercise engine scoring | `exercises.test.ts` — SM-2-style near-miss handling against real Igbo minimal pairs (`akwa` for `àkwà` is *almost*, not wrong); strictness is configurable because a tone drill must not forgive tone; every v1.0 type validates and scores; duplicate options, a missing answer and an ambiguous match are all rejected; the trust label follows review status |
| SRS scheduling | `srs.test.ts` — the two behaviours §F6 states in words are asserted as numbers: a wrong answer returns sooner (minutes, not days) and mastered items space out; the review log is checked field by field against what an FSRS optimiser needs |
| Gamification | `gamification.test.ts` — DST transitions, westward travel, same-day idempotency and the freeze mechanism, all against real IANA zones; XP comes from events, never a client-supplied number |
| AI guardrails | `ai/*.test.ts` — unpublished material can never be retrieved (§5.3); learner text cannot forge the data fence it is wrapped in (§8.1); the validator corrects an ungrounded "verified" claim rather than discarding a good answer, and rejects a tone-pair swap against the knowledge base; the spend cap breaches at the cap and reports unpriced models instead of counting them as free |
| Audio storage | Signature check against genuine WAV, plus rejection of HTML, empty files, traversal keys and unsupported types |
| API surface | Exercised over HTTP: 401s, 403s, 404s, 400s, 429 with `Retry-After`, headers |

The contribution test creates its own accounts and submissions with a unique suffix and removes them
in a `finally`, so it is safe against a populated database — and so a failing run cannot leave
residue that makes the *next* run's failures look like something else. That lesson was learned the
hard way: an earlier version cleaned up only on success, and a mid-run SQL error left orphaned
`example` rows that `verify.ts` then reported as an unrelated integrity failure.

The gap, stated plainly: there is **no browser test suite yet**, and no CI workflow file. Both are
the next step once the feature set stops moving.

---

## Known gaps

- **The gated audio corpora ARE imported** — this said the opposite until it was caught by the owner
  reading the site. 49,010 objects are in R2 and 46,419 rows are in `audio`, across 5,081 word
  pronunciations, 18,931 dialect pronunciations and 24,998 sentence recordings. They needed a
  Hugging Face token, and one was supplied. See `docs/DATA-SOURCES.md` §2 and §7.
- **Dialect recordings were attached to the wrong thing, and 46,419 rows had to be repaired.** A
  dialect recording was owned by the word with a dialect label rather than by the dialect spelling
  it is of, so the entry page matched it to a chip by dialect NAME — which plays the wrong recording
  as soon as a dialect has two spellings for one word. `audio.word_dialect_id` existed and was never
  written. The importer now sets it, `backfill-dialect-audio.ts` repaired the rows already stored,
  and the gate refuses to let an ambiguous one back in.
- **Three contribution kinds are stubs.** `new_word`, `new_definition`, `correction` and `audio` work
  end to end. `new_example`, `edit_word` and `dialect` are recognised by the schema and explicitly
  refused with `unsupported_kind`, rather than accepted into a queue nobody can act on.
- **No sweep for orphaned media.** A rejected recording leaves its object in the bucket (see
  Decision 10).
- **No streaming route for S3.** With a private bucket and no `MEDIA_PUBLIC_BASE_URL`, audio URLs are
  direct S3 paths that would need a signed URL. Serve through CloudFront with an OAC, or add a
  streaming route, before relying on private buckets.
- **Unclassified words.** The 618 headwords recovered from the common-word list carry no grammar
  class in the source, so they display as "Unclassified" until an editor classifies them.
- **Single-process local database.** See Decision 2.
- **No email verification or password reset**, and no account self-service (change password, delete
  account).
- **Deleting a dictionary entry is not implemented.** The schema cascades correctly, but an `example`
  whose last linked word is deleted is left behind; `verify.ts` detects this (it caught exactly this
  during development), so a future delete feature must handle examples explicitly.
- **No CI pipeline** and no browser tests.
