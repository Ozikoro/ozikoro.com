# Ozituma

**The language platform of Ozikoro.** A multi-language dictionary for African languages —
headwords, meanings, dialect variants, example sentences and pronunciation — with its own free
public developer API.

> **Ozikoro** is the history and archive: the parent project, at
> [ozikoro.com](https://ozikoro.com). **Ozituma** is its dictionary — the language layer and a child
> of Ozikoro, at [ozituma.com](https://ozituma.com).

**Status: a working multi-language dictionary and teaching tool.** Two languages are live —
**Igbo** with 12,467 headwords, 14,984 definitions, 21,108 dialect forms and 46,419 recordings, and
**Yoruba** with 4,369 headwords and 5,333 glosses — served through a verified public API with
accounts, contributions, an editorial review queue and three practice modes. Adding Yoruba required
**no change to the schema, search, API or UI**: one source row, one importer, one corpus file. See
[Roadmap](#roadmap).

---

## What works today

| | |
|---|---|
| **Dictionary search** | Tone-blind and diacritic-insensitive: typing `ulo` finds `ụlọ`; typing `akwa` finds `àkwà` (bed), `ákwá` (cry), `àkwa` (egg) and `akwà` (cloth) |
| **Bidirectional lookup** | Igbo → English and English → Igbo in a single call, ranked |
| **Public API** | `/api/v1/words`, `/words/:id`, `/word-of-the-day`, `/languages`, `/stats` with API keys, metering, quota enforcement and an OpenAPI spec |
| **Web app** | Server-rendered dictionary: search, entry pages, languages, docs, developer signup |
| **Accounts** | Sign-up, sign-in, server-side hashed sessions, `contributor`/`editor`/`admin` roles |
| **Open contribution** | Anyone signed in can submit a word, a meaning or a correction — no JavaScript required |
| **Pronunciation audio** | 14,916 recordings imported from an openly licensed corpus (standard **and** per-dialect), plus in-browser recording with signature-validated upload, S3-compatible storage and speaker credit |
| **Editorial review queue** | Editors approve or reject; approval is the only path that writes to the published dictionary, and every published entry carries its source |
| **Dialect coverage** | 21,108 dialect spellings across 33 named varieties, each with its own pronunciation where one was recorded |
| **Multi-language** | 2 languages live, 17 registered. Grammar categories, inflection types and dialects are per-language **rows**, so adding a language is a corpus, not a migration — Yoruba proved it end to end with no code change |
| **Practice** | Three quiz modes generated live from the dictionary — meanings, listening and dialects — with distractors chosen to be genuinely hard |
| **Ozituma Learn** | Authored language courses at [learn.ozituma.com](https://learn.ozituma.com): units, lessons with vocabulary, phrases, grammar notes and dialogues, and lesson-scoped exercises that are graded on the server. Igbo is live; adding a course for another language is a JSON file, not a migration |
| **Verified data** | 40 integrity checks plus a 77-check lifecycle test that creates and removes its own data, media included |

---

## Quick start

No database install required. Ozituma uses **PGlite** — real Postgres 16 compiled to WebAssembly —
whenever `DATABASE_URL` is unset, so you can be running in about a minute.

```bash
git clone <this repo> && cd Ozikoro
npm install

# 1. Create the schema (25 tables, 73 indexes, generated tsvector columns)
npm run db:migrate

# 2. Seed reference data: languages, 45 Igbo dialects, grammar categories, plan limits
npm run seed

# 3. Stage the Igbo corpus (openly licensed — see docs/DATA-SOURCES.md)
mkdir -p data/sources/igbo-api
cp <igbo_api>/src/dictionaries/ig-en/ig-en.json data/sources/igbo-api/
cp <igbo_api>/src/dictionaries/ig-en/ig-en_1000_common.json data/sources/igbo-api/

# 4. Import it (idempotent — safe to re-run)
npm run import:igbo

# 5. Prove the data is sound
npm run verify

# 6. Load the courses for learn.ozituma.com (idempotent, safe to re-run)
npm run import:learn -- --apply

# 7. Run the app
npm run dev            # http://localhost:3000
```

The courses are then at **http://localhost:3000/learn**, or at the real subdomain
shape if you browse to **http://learn.localhost:3000** — Chrome resolves
`*.localhost` to loopback, so the Host-based routing can be exercised without DNS.

Then get a key and call the API:

```bash
curl -X POST http://localhost:3000/api/v1/developers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'

curl 'http://localhost:3000/api/v1/words?keyword=mmiri' \
  -H 'X-API-Key: ozt_live_...'
```

### Or with real Postgres

PGlite is single-process, so use Postgres when you want the server and a CLI running together, or
when you want `pg_trgm` (which PGlite does not ship):

```bash
docker compose -f docker/docker-compose.yml up -d postgres minio
export DATABASE_URL=postgres://ozituma:ozituma@localhost:5432/ozituma
npm run db:migrate && npm run seed && npm run import:igbo
npm run dev
```

---

## Repository layout

```
ozituma/
├── apps/
│   └── web/                    Next.js 15 app: dictionary UI + public API
│       ├── app/                App Router pages and /api/v1 route handlers
│       ├── components/         Search, result list, key signup
│       └── lib/                API auth pipeline, OpenAPI document
├── packages/
│   ├── core/                   Language-agnostic domain logic (no I/O)
│   │   ├── orthography.ts      The diacritic model — the load-bearing idea
│   │   ├── languages.ts        Registry of the 17 languages served
│   │   └── types.ts            API contracts and error codes
│   └── db/                     Schema, migrations, importer, queries
│       ├── migrations/         Plain SQL, applied in filename order
│       ├── src/repository.ts   Search and read layer
│       ├── src/apikeys.ts      API keys, plans, quota enforcement
│       ├── src/accounts.ts     Passwords (scrypt), hashed sessions, roles
│       ├── src/contributions.ts Submissions and the only path that publishes
│       ├── src/role.ts         Account administration CLI (not an API route)
│       ├── src/verify.ts       31 integrity checks
│       └── src/import/         Corpus importers
├── docker/                     Dockerfile and local stack
└── docs/                       Architecture, data sources, deployment
```

### Commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:reset` | Drop and recreate the schema (destructive) |
| `npm run seed` | Seed languages, dialects, grammar, plan limits, attribution |
| `npm run import:igbo` | Import the Igbo API corpus (idempotent) |
| `npm run fetch:audio` | Download the gated CC-BY-4.0 recordings (resumable) |
| `npm run import:ibodict` | Import the audio corpus: words, dialect forms, recordings |
| `npm run verify` | Run 31 data-integrity checks; exits non-zero on failure |
| `npm run smoke` | Search, read layer, API keys, quotas and frozen contracts |
| `npm test` | Orthography and contract unit tests |
| `npm run test:contributions` | Full contribution lifecycle, including hostile input |
| `npm run accounts -- list` | List accounts and roles |
| `npm run accounts -- promote <email> editor` | Grant review rights |
| `npm run dev` | Start the web app |
| `npm run docker:up` | Full local stack: Postgres + MinIO + app |

### Becoming an editor

The first editor must be created from the command line, not the web app — granting
publish rights to a dictionary is a database-level decision, so it requires database-level
access. There is deliberately no bootstrap route to escalate that.

```bash
npm run accounts -- create editor@ozituma.com "a-long-passphrase" "Editor Name"
npm run accounts -- promote editor@ozituma.com editor
```

Then sign in at `/signin`. Contributors sign up themselves at `/join`.

---

## The two decisions that shape everything

### 1. Language-specific facts are data, not code

The reference implementation this platform learns from (the Igbo API behind nkowaokwu.com) is
structurally single-language: Igbo's seven tenses, Igbo's 46-dialect enum, Igbo's grammar classes and
its alternative-script column are baked into its schemas and TypeScript enums.

Ozituma inverts that. Every language-specific concept is a **row scoped to a language**:

| Concept | Where it lives |
|---|---|
| Grammar classes | `part_of_speech` with `language_code` |
| "Tenses" | `word_form` + `form_type` per language |
| Dialects | `dialect` table per language |
| Alternative scripts (Ajami, NKo, Kikuyu…) | `word_script`, any script, any language |
| Definition language | `definition.language_code` — English today, Igbo-in-Igbo later |

Adding Yoruba means importing a corpus and seeding its grammar categories. No migration.

### 2. Every headword carries two derived spellings

African orthographies use diacritics for two completely different jobs, and conflating them breaks
search:

- **Letter-defining marks.** A dot below makes `ọ`, `ẹ`, `ṣ` genuinely different letters in Igbo,
  Yoruba, Edo, Urhobo, Efik and Ibibio alike.
- **Tone marks.** `ákwá` (cry) and `àkwà` (bed) are the same letters.

Ozituma stores both projections of every headword, computed in one pass by
`packages/core/src/orthography.ts`:

- `exact_form` — tone removed, letter marks kept
- `search_form` — every mark removed, for typo- and tone-blind recall

So a user typing `ulo` finds `ụlọ`, and typing `akwa` finds all four tone variants — while the
distinctions survive wherever they matter. Verified by 12 unit tests and re-derived independently
for every row during `npm run verify`.

---

## API

Base URL `/api/v1`. Authenticate with the `X-API-Key` header. Full reference at `/docs`, and a
machine-readable OpenAPI 3.1 document at `/api/v1/openapi.json`.

```
GET  /api/v1/words?keyword=mmiri&language=ibo&limit=20
GET  /api/v1/words/mmiri
GET  /api/v1/word-of-the-day
GET  /api/v1/languages
GET  /api/v1/stats
POST /api/v1/developers
```

**Rate limits are data.** The number published on the pricing and docs pages is read from the same
`plan_limit` row that enforcement uses, so advertised and enforced limits cannot drift apart:

| Plan | All endpoints | `translate` | `speech_to_text` |
|---|---|---|---|
| `free` | 1,000/day | 50/day | 20/day |
| `team` | 50,000/day | 5,000/day | 1,000/day |
| `institution` | 500,000/day | — | — |

Keys are stored as SHA-256 hashes with a short display prefix. The plaintext key is shown once, at
creation, and is not recoverable.

---

## Licensing and attribution

Dictionary content is derived from **openly licensed** corpora, and attribution is structural: every
entry returned by the API names its source and licence. If you reuse Ozituma data, carry the
attribution with it.

| Source | Licence |
|---|---|
| [nkowaokwu/igbo_api](https://github.com/nkowaokwu/igbo_api) — corpus, dialects, grammar | Apache-2.0 |
| [nkowaokwu/ibo-dict](https://huggingface.co/datasets/nkowaokwu/ibo-dict) — audio (gated) | CC-BY-4.0 |
| [nkowaokwu/ibo-dict-expansion](https://huggingface.co/datasets/nkowaokwu/ibo-dict-expansion) — audio (gated) | CC-BY-4.0 |

Both licences permit commercial use. Full provenance, citation and the process for adding corpora:
[`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) and [`NOTICE.md`](NOTICE.md).

---

## Roadmap

Delivered — the foundation:

- [x] Multi-language Postgres schema, plain-SQL migrations, portable across PGlite and Postgres
- [x] Orthography engine verified against Igbo and Yoruba
- [x] Idempotent bulk corpus importer with attribution
- [x] Ranked bidirectional search (exact → prefix → variant → dialect → fuzzy → full-text)
- [x] Public API with hashed keys, per-endpoint quotas, OpenAPI spec, frozen v1 contracts
- [x] Server-rendered dictionary UI
- [x] Accounts with hashed server-side sessions and contributor/editor/admin roles
- [x] Open contribution with an editorial review queue; approval is the only publish path
- [x] Pronunciation recording, signature-validated upload, S3-compatible storage and moderation
- [x] Docker + AWS-portable deployment shape
- [x] 31-check data integrity gate plus a 77-check contribution lifecycle test

Next — to reach parity with nkowaokwu.com:

> **Note on parity.** nkowaokwu.com is a separate, closed codebase from the open igboapi.com
> repository. Its games, flashcards, leaderboard, word-of-the-day and dialect tabs cannot be
> ported from source and have to be designed from the published product. See
> [`docs/reference/README.md`](docs/reference/README.md).

- [x] All 49,010 gated recordings downloaded and imported (words, dialects and sentences)
- [x] Games: meanings, listening and dialect practice generated from the dictionary
- [ ] Leaderboard and word-of-the-day email (a leaderboard requires moving answer grading server-side — noted in `practice.ts`)
- [ ] Developer dashboard (usage graphs, key rotation, plan upgrades)
- [ ] Remaining contribution kinds: example sentences, dialect forms, edits
- [ ] pg_trgm typo-tolerance index in production and per-language full-text configurations
- [x] Second language: Yoruba (4,369 headwords, Apache-2.0 source)
- [ ] Edo: 517 pages of scanned dictionary need OCR plus speaker review; one born-digital source
      (Edo personal names) is extractable without OCR and is the sensible pilot
- [ ] CI pipeline and browser tests

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design decisions and their tradeoffs
- [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md) — corpus provenance, licensing, how to add a language
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — AWS deployment (ECS Fargate, RDS, S3, CloudFront)
