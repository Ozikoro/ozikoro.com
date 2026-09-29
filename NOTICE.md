# NOTICE

Ozituma — the language platform of Ozikoro.

This product includes dictionary and linguistic data derived from third-party works. Their licences
and attributions are reproduced below, and the same information is recorded in the database's
`source` table and returned with every API response that contains derived data.

---

## 1. Igbo API — nkowaokwu/igbo_api

- **Source:** https://github.com/nkowaokwu/igbo_api
- **Licence:** Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- **Used for:** Igbo headword corpus (8,204 headwords), English glosses (10,623 definitions),
  example sentences (1,734), spelling variants (453), stem relations, the enumeration of 45 Igbo
  dialects, Igbo grammar categories, and Igbo inflection/tense categories.
- **Adapted files:** `src/dictionaries/ig-en/ig-en.json`,
  `src/dictionaries/ig-en/ig-en_1000_common.json`, `src/shared/constants/Dialect.ts`,
  `src/shared/constants/WordClass.ts`, `src/shared/constants/Tenses.ts`.
- **Modifications:** data normalised into a relational schema; dialect, grammar and tense
  enumerations converted from TypeScript enums into language-scoped database rows; orthographic
  search keys derived for every headword.

> Ijemma Onwulike et al., *The IgboAPI Dataset: Empowering Igbo Language Technologies through
> Multi-dialectal Enrichment*, arXiv:2405.00997.

**Licence note.** The upstream repository's `LICENSE.md` contains the Apache License 2.0 while its
`package.json` declares `"license": "ISC"`. Apache-2.0 is treated here as the operative repository
licence. Redistributors should preserve this NOTICE.

---

## 2. Igbo Dictionary audio corpus — nkowaokwu/ibo-dict

- **Source:** https://huggingface.co/datasets/nkowaokwu/ibo-dict
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0) —
  https://creativecommons.org/licenses/by/4.0/
- **Contents:** 25,500 single-word audio recordings covering dialectal variations, and 25,000 Igbo
  sentence recordings.
- **Status:** **Not yet incorporated.** The dataset is gated and requires an access token. This
  notice is included in advance so that attribution is in place when the audio pipeline lands.

---

## 3. Igbo Dictionary expansion corpus — nkowaokwu/ibo-dict-expansion

- **Source:** https://huggingface.co/datasets/nkowaokwu/ibo-dict-expansion
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0) —
  https://creativecommons.org/licenses/by/4.0/
- **Status:** **Not yet incorporated.** Gated; requires an access token.

---

## 4. Software dependencies

Ozituma is built on open-source software including Next.js, React, PostgreSQL, PGlite,
`node-postgres`, TypeScript and Node.js. Their licences are recorded in the dependency tree and in
`package-lock.json`. Ozituma's own source code is the property of Ozikoro.

---

## Attribution as displayed

The following strings are held in the `source` table and surfaced on entry pages and in API
responses:

| Source slug | Attribution text |
|---|---|
| `igbo-api` | Igbo dialect, grammar and tense reference data adapted from the Igbo API (nkowaokwu/igbo_api), used under the Apache License 2.0. |
| `ibo-dict` | Audio pronunciations from the nkowaokwu/ibo-dict dataset, used under CC BY 4.0. Contains 25,500 dialectal word recordings and 25,000 sentence recordings contributed by Igbo speakers. |
| `ibo-dict-expansion` | Additional Igbo audio recordings from the nkowaokwu/ibo-dict-expansion dataset, used under CC BY 4.0. |

## Reusing Ozituma data

Data returned by the Ozituma API is derived from the works above. If you redistribute it:

1. Carry the `attribution` object returned with each entry.
2. State that the data was obtained from Ozituma (ozituma.com) and, upstream, from the sources named
   above.
3. Do not imply that the upstream authors endorse your use.

The dictionary content is not sublicensed to you by Ozikoro; your rights come from Apache-2.0 and
CC BY 4.0 respectively.
