# Reference material

Upstream analysis that informed Ozituma's design. These are **records of other people's code**, not
part of Ozituma — nothing here is imported, built or served.

| File | What it is |
|---|---|
| `ozikoro-technical-scope.md` / `.docx` | The Ozikoro technical scoping document. Ozituma is **Layer 2 — the Language Platform** (§5). Source of the multi-language requirement, the stack choice, and the delivery tiers. |
| `igbo-api-analysis-raw.md` | A 2,337-line architectural analysis of [nkowaokwu/igbo_api](https://github.com/nkowaokwu/igbo_api), the open-source API behind igboapi.com. Quotes upstream code (Apache-2.0 — see [`NOTICE.md`](../../NOTICE.md)). Raw and unreviewed; this README is the distilled version. |

---

## The scope correction that matters most

**nkowaokwu.com and igboapi.com are two different codebases.** The repository on GitHub is the API,
the igboapi.com marketing site, and the developer dashboard — **not** the dictionary application.

Evidence, recorded so this does not get rediscovered the hard way:

- `src/siteConstants.ts` defines `DICTIONARY_APP_URL = 'https://nkowaokwu.com'` — a link *out*.
- `about.json` describes the API as hosting "all word and example sentence data that is shown on
  Nkọwa okwu" — a separate consumer.
- `Products.tsx` is literally `const Products = () => null;`.
- The Cypress suite navigates *away* to `nkowaokwu.com/home`.
- No `leaderboard`, `wordOfTheDay`, `flashcard` or `game` symbol exists anywhere in the repo.

**Consequence for parity work.** The user-facing features we want at parity — word of the day, tenses
display, dialect tabs, games, flashcards, leaderboard, crowdsourced suggestions — are **not available
to port**. Only their schema supports survive upstream: a `SuggestionSourceEnum`, a
`Pronunciation.{approvals,denials,review,speaker}` shape, `StatTypes.USER`, 49 migrations over
`wordsuggestions`/`examplesuggestions`, and a migration that *removed* a `crowdsourcing` field.

So those features must be **designed from the published product**, not copied from source. Observing
nkowaokwu.com directly is the input, not this repository.

---

## The one artefact worth copying

The reference implementation has drifted in several places (listed below), but one habit held: it
freezes the exact JSON key set of every API response, per version, in `__tests__/shared/constants.ts`.

```
WORD_KEYS_V1 = variations, definitions, stems, id, word, wordClass, pronunciation,
               relatedTerms, hypernyms, hyponyms, nsibidi, attributes
WORD_KEYS_V2 = variations, definitions, stems, id, word, pronunciation,
               relatedTerms, hypernyms, hyponyms, attributes, tags
```

Read the delta and you can see the actual product history: `wordClass` and `nsibidi` were dropped in
v2, `tags` was added. That is what a frozen contract buys you — a change log you cannot lie about.

**Ozituma ports the pattern**: `packages/core/src/contracts.ts` freezes our own v1 shapes, and
`packages/db/src/smoke.ts` asserts them against real query results. `contracts.test.ts` proves the
guard can actually fail, because a contract check that cannot fail is worse than none.

For integrators moving from igboapi.com, `IGBOAPI_V1_FIELD_MAP` in the same file records the field
mapping — `word` → `headword`, `wordClass` → `partOfSpeech`, and so on.

---

## Contradictions found upstream — fixed here, not ported

| Upstream problem | What Ozituma does |
|---|---|
| **Tier gating does not exist.** `Plan` and `accountStatus` are written by Stripe webhooks but never read by `authorizeDeveloperUsage`; every tier gets the flat `ApiUsageLimit` (DICTIONARY 2500, SPEECH_TO_TEXT 20, TRANSLATE 5) while the pricing page advertises Starter 500 / Team 2,500. `PROD_LIMIT = 500` is exported and never imported. | The limit is a `plan_limit` row resolved per request, and the docs/pricing pages read the same rows enforcement uses. An unconfigured plan fails closed. |
| **API keys stored cleartext.** `const generateApiKey = uuid`, stored unhashed; `findDeveloper` even scans every developer with `compareSync` as a fallback. | SHA-256 hash plus a display prefix. The plaintext key is returned once. An integrity check asserts it is absent from the table. |
| **Every error is HTTP 400**, including rate limiting — which a skipped test expected to be 403. | Each error code maps to an explicit status; 429 carries `Retry-After`. |
| **`apiLimit` query param is dead** — declared in types and used only in a `describe.skip`ped test. | No dead parameters. Every documented parameter is read. |
| **No machine-readable spec.** Developer experience rests on hand-written prose docs. | OpenAPI 3.1 at `/api/v1/openapi.json`. |
| `Word.examples` declared `[String]` but populated with ObjectIds; serving goes through a `$lookup`. | Real join table with foreign keys and a check constraint. |
| `attachRedisClient` calls `redisClient.quit()` on every response while reusing a singleton. | No shared client to tear down; caching is HTTP `Cache-Control`. |
| Config drift: `deploy.yml` writes `AWS_*`, `ENV_VPC_CONNECTOR`, `ENV_REDIS_STATUS` that `config.ts` never reads; `config.ts` hardcodes a Stripe test-key fallback. | Config documented in `.env.example`, no secrets in source, no unread variables. |
| Dockerfile is `node:18` against `engines: >=20`. | `node:24-alpine`, matching the runtime that executes the TypeScript sources directly. |

---

## Language-specific surface: the checklist for adding a language

The analysis's §11 is a useful inventory of everything that is Igbo-specific upstream. It doubles as
the checklist of what must be **data, not code** in Ozituma — and confirms the schema decision was
the right one, because every item below is now a table row or a language-scoped registry entry.

Upstream, all of these are hardcoded TypeScript enums, constants or files:

| Upstream hardcoding | Ozituma |
|---|---|
| `dictionaries/ig-en`, `en-ig` (4 JSON files) | Importer + `data/sources/<language>/` |
| Nsibidi subsystem (~10 files incl. a 31,504-line dictionary, `WordClass.nsibidiValue` CJK strings, a `cjkRange`) | `word_script` — any script, any language |
| 46-code `DialectEnum` + `Dialect.ts` with `ibo-*` labels | `dialect` table scoped by `language_code` |
| `diacriticCodes.ts` + two `removeAccents` modes + `normalization.js` | `packages/core/src/orthography.ts`, driven by per-language mark classification |
| `WordClass` (AV/MV/PV/ISUF/ESUF are Igbo grammar) | `part_of_speech` scoped by `language_code` |
| `Tenses` (7 Igbo slots incl. `presentPassive`) | `word_form` + `form_type` scoped by `language_code` |
| English `StopWords`, `IGNORE_ENGLISH_WORDS`, `isWord('american-english')` | Postgres full-text configuration |
| `LanguageEnum` (eng/hau/ibo/yor) | `language` table with 17 registered |
| locales `['en','ig']`, `Akagu2020.ttf` | Per-language presentation, not a build-time locale |

One upstream detail worth preserving as a design principle: `removeAccents` had two modes — `remove`
(drops the underdot U+0323) and `removeExcluding` (keeps it) — because **Igbo ị/ọ/ụ are phonemes while
accents are tones**. Ozituma generalises exactly that split into `search_form` and `exact_form`, and
extends the "letter-defining mark" set to include U+0307 for ṅ and U+0331 for underlines used in some
Edoid and Ijaw orthographies.

Also useful, and taken seriously: upstream records `Label`s such as `IGBO_WIKIMEDIANS`, `PROVERB`,
`BIBLICAL` and `IS_STANDARD_IGBO` — a reminder that a dictionary carries register and provenance, not
just definitions. `tag`, `example.style` and the `source` table cover those.

---

## Known-stale or unused upstream code (do not model on it)

- `en-ig_normalized_expanded.json` (6.7 MB) is a build artefact **never imported at runtime**.
- `diacriticless` is used **only in a test**.
- `presentPassive` has no index, unlike the other six tenses.
- `NsibidiCharacter` uniquely lacks the `toObject` plugin and `timestamps`.
- `MAX_AUDIO_SIZE = 5000000` while the UI toast says "500Kb maximum", and the check measures the
  **base64** length rather than the file size.
- Cypress is configured but wired into no CI workflow.
- `Stat`/`GitHubStars` components exist and are unit-tested but mounted on no live route.
