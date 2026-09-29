# Data sources, licensing and attribution

Ozituma does not scrape dictionaries. Every word in the database comes from a source recorded in the
`source` table, and every API response carries that attribution. This document is the provenance
record, and the checklist for adding a language.

## Why this is a first-class concern

The corpora we build on are licensed under **Apache-2.0** and **CC-BY-4.0**. Both permit commercial
use. Both **require attribution**. CC-BY-4.0 additionally requires that attribution travel with
derivative works.

So attribution is not a footer. It is:

- a `source` table with a `license_code`, `attribution_text` and `citation` per corpus,
- a `source_id` foreign key on `word`, `definition`, `example` and `audio`,
- an `attribution` object on every `/api/v1/words/:id` response,
- the licence section on `/about`, linked from the footer of every page, which lists every source
  with its licence, attribution text and citation,
- and integrity checks in `packages/db/src/verify.ts` that fail the build if any imported row loses
  its source.

Note that the first three of those are a *record*, and only the fourth is a display. Neither licence
requires attribution on a particular screen: Apache-2.0 requires the notices to be retained in
redistribution, and CC-BY-4.0 requires attribution "in any reasonable manner based on the medium,
means and context". The owner's position is that the API and `/about` are the reasonable manner for
this medium, and that a citation printed under a definition reads as a fact about the word rather
than as a fact about the data. Entry pages therefore no longer carry a Source block — see §4.

```bash
npm run verify   # "every headword has a source" and "every definition has a source" must pass
```

## Sources in use

### 1. Igbo API — `nkowaokwu/igbo_api`

| | |
|---|---|
| URL | https://github.com/nkowaokwu/igbo_api |
| Licence | **Apache-2.0** |
| Used for | 8,204 headwords, 10,623 definitions, 1,734 example sentences, 453 spelling variants, 8,065 stem relations, the 45-dialect enumeration, grammar categories and inflection types |
| Files | `src/dictionaries/ig-en/ig-en.json`, `src/dictionaries/ig-en/ig-en_1000_common.json`, `src/shared/constants/Dialect.ts`, `WordClass.ts`, `Tenses.ts` |
| Citation | Ijemma Onwuzulike et al., *The IgboAPI Dataset: Empowering Igbo Language Technologies through Multi-dialectal Enrichment*, arXiv:2405.00997 |

> **Note on the licence field.** The repository's `LICENSE.md` is the Apache License 2.0, while its
> `package.json` declares `"license": "ISC"` — an inconsistency in the upstream project. Apache-2.0 is
> the operative repository licence, and it is the more permissive of the two in the ways that matter
> here (it grants an explicit patent licence). If you redistribute Ozituma, keep the upstream
> attribution and the Apache-2.0 NOTICE.

**A finding worth recording:** `ig-en_1000_common.json` is *not* a subset of `ig-en.json`. Only 84 of
its 702 words appear in the main dictionary; the other **618 are high-frequency vocabulary that exists
nowhere else in the corpus**. An importer that reads only the main file silently discards the most
commonly used words in the language. Ozituma imports both (see `packages/db/src/import/igbo.ts`).

#### A note on the licence file

The repository ships a root `LICENSE.md` containing the full **Apache License 2.0** text, while its
`package.json` declares `"license": "ISC"` and carries no `repository` field — the shape of an
`npm init` scaffold whose default was never changed. We rely on the `LICENSE.md`, which is the
licence the project states in its own repository and the one the corpus has been treated as
carrying throughout. Worth confirming with the maintainer if this corpus is ever redistributed
rather than consumed.

### 2 & 3. Audio corpora — `nkowaokwu/ibo-dict`, `nkowaokwu/ibo-dict-expansion`

| | |
|---|---|
| URLs | https://huggingface.co/datasets/nkowaokwu/ibo-dict · https://huggingface.co/datasets/nkowaokwu/ibo-dict-expansion |
| Licence | **CC-BY-4.0** |
| Contents | 49,010 recordings: 5,081 word pronunciations, 18,931 dialect pronunciations, 24,998 sentence recordings |
| Metadata | `ibo-dict.json` (5,095 word entries) and `igbo-dict.json` (sentence entries) |
| Access | Gated — HTTP 401 anonymously, HTTP 302 with a token |

```bash
export HF_TOKEN=hf_...
npm run fetch:audio            # 49,010 files, ~2.5 GB, ~50 min at 12 files/s
npm run fetch:audio -- --limit 500    # smoke test
npm run import:ibodict         # words, definitions, dialect forms, audio
```

`fetch-audio.ts` is resumable: a file already present at the expected size is skipped, so a re-run
after a network failure costs only the missing files. It writes an `audio-manifest.json` mapping
every audio path to the word and dialect it belongs to, which the raw folder cannot express.

#### `ibo-dict.json` is a complementary corpus, not a duplicate

This matters and was not obvious. Only about **26%** of its 5,095 words appear in the Igbo API's
`ig-en.json` — so it contributes roughly **3,700 headwords that exist nowhere else**, each with a
definition and grammar class, plus the recordings. The two datasets came from the same project but
are different snapshots.

It is also richer per entry than the API dictionary: a word, a grammar class, a definition, a
standard pronunciation, and a list of dialect variants each with their own spelling and recording.

#### Two mappings this corpus depends on, both verified before importing

| Source field | Form | Resolves against | Coverage |
|---|---|---|---|
| `wordClass` | **label**, e.g. `"Active verb"` | `part_of_speech.name` | **100%** (20/20 labels) |
| `dialects[].dialects[]` | **name**, e.g. `"Ọnịcha"` | `dialect.name` | **100%** (33/33 names) |

Neither needs a hardcoded lookup table, which is the language-scoped reference data doing its job:
the taxonomy is data, so a corpus speaking in labels and names still lands on the right rows.

#### Audio is uploaded, not linked

The recordings sit behind Hugging Face's gated endpoint, so their URLs need a token and cannot be
served to the public. Each file is uploaded through the active storage driver — S3 in production,
local filesystem in development — and the database stores the resulting key. Keys derive from a hash
of the source path, so a re-import reuses the same object instead of duplicating it.

#### A caveat on tone marking

The headwords in `ibo-dict.json` carry tone marks that appear to have come from an automated pass
rather than a lexicographer — `àgbàrà` is all-grave. Ozituma stores what the source says and credits
it, and the derived `exact_form`/`search_form` mean search is unaffected; but an editor reviewing
these entries should treat the tone marks as unverified, and `is_verified` stays `false` for them.

### 4. Igbo personal names — Nze (@nzemmili)

The name dictionary is fed by a compiled list of unique Igbo names posted by Nze (@nzemmili) on X
(`x.com/nzemmili/status/1878602661458853917`, January 2025), captured from the accompanying image and
read with macOS Vision OCR. 43 entries, each a name — often with short forms in brackets — and an
English meaning.

| | |
|---|---|
| Source row | `x-nzemmili-igbo-names` |
| Licence | **`unknown`** — the post states none |
| Imported | 42 rows for Igbo (1 skipped: no meaning came across in the OCR) |
| Recorded in | `person_name`, not `word` — see `0007_person_names.sql` |
| Importer | `packages/db/src/import/names.ts` |

**The licence position, stated plainly.** The post grants no licence, so this list was first imported
as `draft` under the rule in `AGENTS.md` — imported data stays `draft` unless its licence permits
publication. The project owner has since directed that the names be published, on the basis that the
list is a compilation circulated for this use and is credited in full. The importer therefore writes
`published`, and the source row still records `license_code = 'unknown'` rather than being upgraded to
a licence the compiler never granted. The attribution and the uncertainty are both visible on
`/about#licensing`, and `source_id` is on every row.

**The owner asked for that attribution off the entry pages, and it came off every one of them.** The
reason is not that the record was wrong but that it was in the wrong place: a list of websites a name
happened to appear on was rendered under the name's meaning, where a reader takes it for a fact about
the name. That applied to word entries too — a citation for the Igbo API printed under a definition
reads the same way — and the owner's judgement is that the API is enough.

What satisfies the licences is unchanged and untouched: the `source` table with a `license_code`,
`attribution_text` and `citation` per corpus, a `source_id` on every row, an `attribution` object on
every API response, the integrity checks below, and the licence table on `/about`, which the footer
links from every page. What came off is the per-entry presentation.

**Recorded so it is not rediscovered later:** CC-BY-4.0 asks for attribution "in any reasonable
manner based on the medium, means and context", and this site's position is that a machine-readable
attribution on every API response plus a licence table reachable in one click from every page meets
that. If the position is ever challenged, the fix is to restore the block on word entries — the data
to render it was never removed from the query.

**Gender is a rule about the name's own morphemes.** A name containing *nwanyi* (woman) is female and
one containing *nwoke* (man) is male; a name beginning *ada* (daughter) is female; *lolo* (a titled
woman) is female; *ozo*, *eze* or *nze* (the king, the titled man) is male. Everything else is
**unisex**. `father` and `mother` are **not** signals, so `Akunna` ("father's wealth") and `Akunne`
("mother's wealth") are both unisex.

What a source *calls* a name is deliberately not a basis. Several of the pages above are titled "Igbo
names for boys", and the owner's correction was that this is a claim about usage rather than about the
name: girls are usually given `Chiamaka`, so sites label it female, but nothing in the name says so.
Dropping that basis made 2,669 names unisex, and `npm run verify` now recomputes the rule from the
name and fails the build if any gendered row carries no gendering morpheme.

**OCR corrections are explicit.** `lwene`→`Iwene`, `lyiora`→`Iyiora`, `lfemeli`→`Ifemeli`: macOS
Vision reads a capital *I* as a lowercase *l*. They are fixed by named rule in the importer rather
than silently, and any entry whose meaning failed to come across is skipped instead of stored
half-formed. Two OCR artefacts are known to remain in the data and are visible on the site:
`Chinualumogu - Chinua` still carries the separator the OCR left behind (it should be `Chinualumogu`
with short form `Chinua`), and `Osu uzo` keeps a space where the short form `Osuzo` does not.

### 5. The owner's list, and the fifth source: the web

The name dictionary's main corpus is a list of Igbo personal names supplied
directly by the project owner: 669 entries, each "Name / Variant — meaning",
carrying the tone marks the OCR of the X image could not. It is the same corpus
as section 4, expanded and spelled correctly, and where the two overlap the
owner's row wins.

Alongside it, twelve sites the owner supplied were read for further names:

| Source | Licence | Contributed |
|---|---|---|
| My Igbo Name | none stated | 592 rows |
| Umu Igbo | none stated | 182 |
| Wikipedia — Igbo given names | **CC BY-SA 4.0** | 110 |
| Behind the Name | none stated | 120 |
| Legit.ng | none stated | 359 |
| Maternity Nest | none stated | 356 |
| Okwu ID | none stated | 43 |
| Adabekee | none stated | 50 |
| FunTimes Magazine | none stated | 30 |
| Onyinye Favour Chibueze (LinkedIn) | none stated | 1,177 |

| Nairaland | none stated | 59 |

**Two hosts needed a browser, and one still does.** Both refuse a plain HTTP
client before any script runs, so the first pass could not read either:

- **Nairaland** — recovered. It answers with a Cloudflare challenge, so it was
  read through real Chrome using `scripts/fetch-with-browser.mjs`, which drives
  headless Chrome over the DevTools Protocol. Headless alone is detected: the
  challenge sat at "Just a moment…" until the automation signals were
  suppressed (`--disable-blink-features=AutomationControlled`, a real user agent,
  and `navigator.webdriver` removed before any page script runs). 59 of its 60
  entries carry a gloss; the other is commentary about the name's bearer rather
  than a meaning, and an entry with no meaning is not a dictionary entry.
- **names.org** — **still not in the corpus.** DataDome returns a 1.5 KB shell
  even to Chrome driven this way, and clearing it needs a residential
  fingerprint or a solved CAPTCHA, which is not something to work around.

Its meanings needed extracting rather than copying. The post is written for a
reader, so entry 1 defines Achebe as "famous but uncommon thanks to the Nigerian
novelist" — commentary, not a gloss. The text after the last
*means*/*translates to* is taken instead, which is where the post restates the
meaning ("Ngozi is one of the most common Igbo names … Ngozi means blessing"),
and anything that still reads as commentary is dropped.

**The licence position, stated plainly.** Setting Wikipedia aside, none of these
pages states a licence. They are imported on the same basis as section 4: at the
owner's direction, with `license_code` recorded as `unknown` rather than upgraded
to a licence no site granted. Wikipedia's CC BY-SA 4.0 is recorded as such. The
position is stated on `/about#licensing`, and this is the one part of the corpus
whose redistribution rests on the owner's decision rather than on a grant from
the source.

**Merging, and what is deliberately not inferred.** Rows merge only when their
FOLDED forms are identical (`deriveForms().searchForm`), so no relationship
between two differently-spelled names is invented. Where the owner's list covers
a name, its variants are the ones used and the scraped variants are discarded —
mixing them put *Adaora* under *Adaoha*, which is a parsing slip on the source
page rather than a variant. For a name no owner entry covers, the scraped
variants are all the evidence there is, minus any that is itself a headword here
with a different meaning. Meanings are de-duplicated by containment and capped
at two: six sites phrase "King's daughter" six ways, and joining all of them
produced a concordance rather than a gloss.

**Origin is where a name is borne, not where it was collected.** The owner
rejected provenance in this column after seeing a source list rendered under a
name's meaning, and the correction is enforced in three places rather than one:

- `packages/core/src/regions.ts` holds the vocabulary — the Igbo areas a name
  can be attributed to, from Anambra and Nsukka to Mbaise, Ngwa, Ikwerre and
  Anioma, with state-level entries so a source that only establishes a state can
  be recorded without being stretched to a town.
- `data/names/origins.json` holds the curated, **evidenced** list of name →
  region: **1,000 names**, 71 of them borne in more than one place. It is our own
  knowledge rather than a scraped corpus, so unlike everything under
  `data/sources/` it is tracked in git, and every row carries the source it rests
  on. `data/names/variety-forms.json` sits beside it.
- `packages/db/src/import/name-regions.ts` is the schema and the gate: it refuses
  to return a list with an unknown region, an empty origin, or a row with no
  evidence, and reports every problem at once rather than one typo per run.
  `npm run verify` then checks the same thing from the database side — that no
  origin is the name of any source this database holds, and that none looks like
  a website.

126 of the 1,000 names are entries the corpus already holds, so 126 entries
carry an Origin. The other 874 are a standing invitation rather than a defect:
they come from anthroponym studies of Afikpo, Nsukka, Ika, Etche, Ogba and
Ekpeye, whose names come from naming research rather than from the baby-name
pages this corpus was built from. They are documented for a region and are simply
not entries here yet.

**Where the origins come from, and one that was checked by hand.** The largest
single source is Obiorah (2021), *Free Variation and Tones in the Igbo Personal
Names*, whose data are 600 names from university registers that record each
bearer's state of origin — 56 attributions rest on it, more than any other
source, so it was read directly rather than taken from a summary. Its claims are
specific and the attributions follow them exactly: the /l/ form of a name is
found among Anambra and Enugu indigenes and the /r/ variant among Imo and Abia
(Amala/Amara, Ulimma/Urimma, Oliaku/Oriaku); /f/ among Anambra and Enugu and /h/
among Imo and Abia (Ifeoma/Iheoma, Afamefuna/Ahamefula); /v/ among Anambrarians;
and /n/ among Anambra and Enugu against /l/ among Imo and Abia.

The rest are area studies — Azubuike (2025) on Onitsha personal names sampled
from Onitsha-origin informants, the 145 Ọka anthroponyms collected at Awka,
Nwala (2018) on Etche names, Emeka-Nwobia (2016) on Afikpo, the Ogba Language
Committee's dictionary, a natively compiled Ekpeye list, and Oweleke (2021) on
Igbuzo/Anioma.

Eight regions in the vocabulary produced no documented personal-name evidence
and are therefore unused: **Ohaji, Ndoki, Aro, Mbaise, Orlu, Owerri, Okigwe and
Ikwo.** What exists for those is dialect phonology, place names and pan-Igbo
lists — not names attested as borne by people there. They are in the vocabulary
and empty in the data, which is the correct state rather than a gap to be filled
from inference.

**Cross-variety forms are not spelling variants.** `Nwike` is Igbo and `Wike` is
the Ikwerre form of the same name, "child of strength" — from *nwa* (child) and
*ike* (strength, power, might). `Obinna` is Igbo and `Ovunda` is the Ikwerre,
Ogba and Ohaji form. Recording *Wike* as a misspelling of *Nwike* would throw away
the fact that matters, so these are stored as labelled pairs in
`person_name.variety_forms`, shown on the entry as chips carrying the variety,
and searchable: "wike" finds Nwike, and "ovunda" finds Obinna.

`data/names/variety-forms.json` holds **62 forms across 50 names** — Ikwerre 36,
Anioma 13, Ika 5, Ogba 4, Ohaji 2, Etche 2. 29 of the 50 names are entries the
corpus holds. Each row records whether the source *states* the correspondence or
merely *lists* both forms with the same meaning, and each carries its evidence.
The strongest are Nwike/Wike, where a national newspaper states the Nw → W rule
outright, and Iheanacho/Nhnẹanọtnu, Elewechi/Aleruchi and Osu/Ofu from a
peer-reviewed journal; most of the rest come from three systematic Ikwerre/Igbo
correspondence tables posted to a Nairaland thread by speakers of the language.
Those are one person's assertion about their own language, which is evidence, but
it is not settled etymology and the file does not pretend otherwise. Nothing here
was inferred from how two names look.

**Egbema, Ndoki and Ukwuani yielded no documented correspondence at all**, and
the Ohaji half of the owner's Obinna/Ovunda example is recorded on the owner's
statement rather than on a source, because no source for it was found.

### 6. The name register, and two traps

Behind the Name turned out to publish two further Igbo lists that the first pass
missed, both structured and both usable: **116** names from its Igbo-origin index
and **273** from its submitted-names page. The submitted page carries its own
warning that entries are user-contributed and that their definitions cannot be
guaranteed, so it ranks last when several sources gloss the same name.

Nairaland contributes **59** names from its "60 Igbo Names" post. Its other
threads on Igbo names were read too and yield very little: the replies are
chatter, and one gloss in them reads "Nkiruka still means boobs is bigger".
Six names with plain, uncontested glosses were taken from them and are
attributed to the threads; the jokes were left out. **Nairaland does not hold
thousands of Igbo names**, which is worth stating because it was expected to.

**A trap: the hidden export is not the register.** Every page on
myigboname.com carries a visually hidden link to `/api/entries/export`,
labelled "Full name archive export". It is not the site's data. It returns 40
entries with **six distinct meanings between them**, in camelCase — ChiNwa,
NwaEze, ObiKelu, KeluSomto — and **none of the 40 appears in the site's own
register**. It is scaffold data for the site's interface. Importing it would
have added forty fabricated names with recycled glosses, so it is recorded here
as a thing not to fetch rather than quietly ignored.

**A second trap, on our side.** myigboname.com began answering 404 to every
path, including "/" and "/robots.txt", after a fast pass over its register. That
is a block, not a missing page, and both curl and a real browser got it, so it
is an IP-level refusal rather than a fingerprint check. The response is to back
off, not to reach for proxies: `wait-and-crawl-myigboname.mjs` polls politely
every three minutes and reads the register one request at a time with a
two-second gap once it is welcome again.

### 7. Getting the recordings to the browser

For a long time every recording on the site showed `0:00 / 0:00` and played
nothing. The database held 46,419 audio rows; the bucket held none of them. The
files existed, but only on the machine that had done the import.

**The media is uploaded, not linked.** The corpora are gated on Hugging Face, so
a recording cannot be served from its origin; `ibodict.ts` and `examples.ts`
each read the file and `put()` it through the active storage driver — the local
filesystem in development, **S3 (Cloudflare R2) in production**. Two key
namespaces, from two importers that disagree about which repo is which:

| Importer | Source repo | Key |
|---|---|---|
| `ibodict.ts` | `nkowaokwu/ibo-dict` | `audio/ibo/corpus/<sha256(path)[:24]>` |
| `examples.ts` | `nkowaokwu/ibo-dict-expansion` | `audio/ibo/examples/<sha256(path)[:24]>` |

Both derive the key from the repo-relative path, so the same file lands on the
same key every time and a re-upload is harmless.

**Three things went wrong, and each is worth remembering:**

1. **Nothing had ever been uploaded in production.** The records were moved
   across without the media, so the rows were right and the objects were absent.
2. **`fetch-audio.ts` wanted `ibo-dict-expansion.json`, not the `igbo-dict.json`
   its own config names** — the code uses the repo's basename and ignores the
   `metadata` field. The download silently skipped a whole dataset.
3. **Concurrency 8 is too fast for the site.** Hugging Face answered HTTP 429 to
   3,835 files, and the run reported them as failures rather than stopping. At
   concurrency 2 the same set downloads with zero failures in five minutes.

**The importer's upload loop is sequential** — `await storage.put()` inside a
`for` — which moves about one file a second, roughly six hours for the corpus.
Since the key is deterministic, the same objects can be written concurrently
without coordinating with the importer, and that is what
`scripts/upload-media.mjs` does: 32 workers, ~50 files a second, 49,010 objects
with zero failures in about twenty minutes.

**And the media host needs the objects to exist before it answers.** With an
empty bucket, `media.ozituma.com` returns its 404 page for every key, which is
indistinguishable from a wrong key. Checking the bucket is the way to tell the
two apart.

### 8. Ndebe, the alternative script (and its font)

Ndebe is a constructed **syllabary** for Igbo, written left to right, by Lotanna
Igwe-Odunze and the Ndebe Project. One character is a whole syllable and tone is a
different character rather than an accent on one, so a syllable is a cell of a
42 bodies x 9 vowels x 3 tones grid — 1,134 syllables. `packages/core/src/ndebe.ts`
holds the grid and the arithmetic, cross-checked against the vendor's own font
tables rather than against itself.

| | |
|---|---|
| Script holder | Lotanna Igwe-Odunze / Ndebe Project — <https://ndebe.org> |
| Font | **Ndebe Rounded**, Version 1.000 RC1, Copyright 2026 Lotanna Igwe-Odunze |
| Family / weight | `'Ndebe Rounded'` at weight 400, with `font-synthesis: none` |
| Source | <https://github.com/ndebeproject/ndebe-fonts> → `Ndebe Rounded/Font/` |
| Licence | **none stated in the font or its repository.** Not restated as one |
| Embedding | `OS/2.fsType = 8` (editable embedding) |
| Permission | obtained by the project owner; the agreement is his record to keep |
| Shipped at | `apps/web/public/fonts/NdebeRounded-Regular.{woff2,woff}` |
| sha256 | woff2 `be6a3758f0c42bb9d2a59d59d9c8cca4fb6c109278b6318de0736681a9fc548f`, woff `e438003eafc860af7fdc69d837e87df8b9b10b8d759837ff7b75c0248ff23ad3` |
| Stored in | `word_script`, `script_code = 'Ndebe'` |
| Importer | `packages/db/src/import/script.ts` — `npm run import:script` |

**We ship the vendor's own web files, byte for byte**, verified against the
SHA-256 hashes published in the repository's `FONT-MANIFEST.json`. There is no
subsetting and no conversion: the fonts repository already publishes WOFF2 and
WOFF, which also takes the file a browser downloads from 4.7 MB to **110 KB**.
The `?v=` query on the URL is the vendor's own cache-busting hash, so a future
font swap cannot be served from a stale cache.

**Rounded is a strict superset of the Plain font it replaced, at the same
codepoints**: all 1,287 of Plain's codepoints are present in Rounded at identical
values, plus 87 more. So the transliterator did not change — the generated values
were already right and were simply being drawn by an earlier font. All 1,164
codepoints the engine can emit were checked against Rounded's cmap and none is
missing or `.notdef`.

**The family was renamed in the CSS, not just the file.** A browser holding the
old `Ndebe Plain` face would otherwise pair new characters with old drawings.
Naming the family `'Ndebe Rounded'` makes an old cached font unusable rather than
silently wrong.

**`font-synthesis: none` is the vendor's own instruction**, and it matters more
here than for ordinary text: Ndebe Rounded has one real face at weight 400, and a
browser faking a bold would draw a different character. The vendor also ships
**Ndebe Soft Bold** at weight 700 as a separate family; it is not used yet.

**The font carries no licence metadata** — only copyright, and a note that
`fsType = 8` permits embedding in editable documents while, in the repository's
own words, "this technical setting does not grant additional distribution or
licensing rights". So the font is used because the project owner obtained
permission from the Ndebe Project, and that is recorded here rather than
converted into a licence the holder never granted. **If that permission ever
lapses, the feature comes out** — the font, the `word_script` rows and the
display — rather than being hidden behind a flag. Half-removed licensing is how a
site ships something it has no right to ship.

**Composition confirmed against the creator's own method.** He explained that the
script is composed syllable by syllable — look up `é`, look up `zè`, paste the
two characters — and that `ézè` is therefore two characters. That is exactly what
the transliterator produces: `é` is the standalone vowel marker `U+E25F` and `zè`
is the syllable `U+E79A`, both cross-checked against the vendor-derived syllable
table. Mechanical composition and copying from the chart agree, which is what
makes the whole layer safe to generate rather than transcribe.

**A defect in the transliterator, found before the script was shown.** Tone was
being discarded for every **dotted** vowel: `ọ̀`, `ọ́`, `ị́`, `ụ̀` all came out
mid. The cause is subtle and worth recording — there is no precomposed codepoint
for `ọ̀`, so it is always `o` + U+0323 + U+0300, and the code read one character
and passed it to a tone reader that needed the accent too. Plain vowels were
unaffected because `á` IS one precomposed codepoint, which is exactly why the
existing tone test (`nwa` / `nwá` / `nwà`) passed over the bug. In a language
where `àkwà` (bed), `ákwá` (cry) and `àkwá` (egg) differ only by tone, every
dotted vowel in the dictionary was being written wrong.

Three more defects in the same family came out with it: precomposed tone nasals
(`ǹ`, `ḿ`, `ń`) matched no body at all and were reported as unwritable; a syllabic
nasal took its tone from the character that followed it rather than its own, so
`ǹdè` wrote a mid nasal; and punctuation counted as letters that could not be
written, which rejected **4,278 of 8,822 headwords** — 4,131 of them on a hyphen
alone, because the corpus contains affix entries written `-fụ`. The input is now
decomposed once at the door, every read takes the whole cluster, and anything that
is not a letter is carried through as itself.

**Coverage: 8,659 of 8,822 published Igbo headwords (98.2%)** have a Ndebe form.
The 163 that do not are skipped rather than approximated, and the reasons are
known:

- **`ŋ` — 57 headwords.** Ndebe has **no body** for it. `ng` and `ngw` have none
  either, and the script's own reference material records this as unresolved,
  with the existing tooling writing `ng` through the N body and labelling it
  ASSUMED. Ozituma does not assume it: those words get no script. **This needs a
  ruling from the script's author**, not a guess from us.
- **24 headwords are a bare letter or abbreviation** — `C.`, `CH`, `B` — so they
  are not Igbo words.
- **The rest carry English that leaked into a headword**, e.g.
  `-fabà (or -fàbà)` and `-gabìga (compare - gafèga)`. `or` and `compare` have no
  Ndebe spelling because they are not Igbo.

Two further open questions from the script's own reference are unresolved and
left unresolved: `v` has three candidate bodies, and **Ndebe cannot distinguish
`n` from `m`** — there is one N/M character, so `mbosi` and `nbosi` are identical.
The transliterator picks the earliest of equals and does not claim more.

**Why the value is stored and not computed.** Transliteration is deterministic, so
it could be derived on every render. It is stored because a correction needs
somewhere to live: the mechanical result is a starting point, the author's open
questions above show it is not the last word, and a table is where a human ruling
goes without editing code. Each row's `notes` says how it was produced —
`mechanical transliteration of the headword` — and the integrity gate re-derives
every row carrying that note and fails if it differs. A correction changes the
note, which makes it deliberate and visible instead of an unexplained difference
the next import would silently overwrite.

### 9. One word, one entry

The same word must not be reachable twice with the same meaning. It was:
`/word/igbo/nna` and `/word/igbo/nna-2` were both `nna` "father", reported from
the site as a defect.

**The cause was the two corpus files merging on the raw headword.** The Igbo
corpus arrives as a main dictionary plus a frequency-ranked common-word list, and
they spell the same words differently. The main dictionary has `nnà` "father"
classified NNC; the common list has `nna` "father" and **no word class at all** —
0 of its 702 entries carry one. The merge key is the tidy headword, `nna` and
`nnà` are different strings, so they became two entries. **238 of the common
list's 702 keys match a main entry once tone is dropped**, so this was never one
accident.

**The rule is exact form plus definitions, and both halves are load-bearing.**
Exact form folds tone but keeps the marks that change which letter it is, so
`nna` and `nnà` collide while `nso` and `ǹso` do not. Definitions then keep real
homographs apart: `nso` ("close"), `nsò` ("queue") and `ǹso` ("nearness") share a
form and are three words. Form alone would demand merging those; definitions
alone would demand merging `akwa`, which genuinely means bed, cry, egg and cloth
across its tones. The gate reports the homograph count beside the duplicate count
so that "0 duplicates" cannot be mistaken for "nothing examined" — currently
**764 homograph groups are deliberately kept apart**.

**The survivor is chosen, not taken.** A classified part of speech beats none —
which is what makes the main dictionary's entry win over the common list, exactly
as it should, since the common list is a frequency ranking rather than a second
opinion. Then more tone marks, because the headword is the entry and the
tone-neutral spelling is already printed beneath it. Then lexicographic, so a
re-run cannot reorder the dictionary.

**Prevention and repair are separate, deliberately.** The importer collapses as it
writes, because that is where the duplicate is created and because allocating
slugs after the collapse keeps the canonical URL — `nna` now serves `nnà` rather
than the survivor sitting on `nna-2`. `npm run dedupe:words` sweeps what is
already stored, in any language, and restores the un-suffixed slug when the row
being removed was holding it. The preference rule is one function in
`packages/db/src/import/corpus.ts`, shared by both, so the two cannot disagree.

Running it removed **94 duplicate entries from Igbo** and **4 from Yoruba** —
Yoruba's are two spellings of the same word differing only in a diacritic, e.g.
`onítöôjú` beside `onítõöjú`, both "attendant".

**What is moved, and what is not.** Most of what hangs off a word is rewritten by
the next import from the corpus — definitions, example links, spelling variants —
so a cascade delete costs nothing there. What is NOT recomputable is moved across
first: recordings, dialect spellings, and the recordings attached to those
spellings. Script values are the exception in the other direction: a Ndebe value
is **derived** from the headword and encodes tone, so one computed from the
tone-neutral spelling is wrong on the tone-marked one. Those are deleted and
rewritten rather than carried, which the integrity gate caught on 56 rows when
they were not. A recorded *correction* is a human statement and is always moved.

## A quality decision: what we deliberately did not import

`ig-en_normalized_expanded.json` (and its reverse) is a 212,155-entry English → Igbo index shipped in
the same repository. It is tempting because it is ten times the size of the real dictionary, and it is
misleading: it maps `aarrgh` to `arr.. .arrarrarr`, and generally looks like a raw lexicon dump rather
than curated dictionary data.

Ozituma serves the English → Igbo direction instead through **ranked full-text search over the 9,937
real definitions**, which is smaller, higher quality, and properly ranked by Postgres `ts_rank`. That
query answers `water` with `mmiri` and its genuine glosses rather than noise.

If a cleaned version of that index appears, it belongs in `word_relation` as typed edges — not
concatenated into the dictionary.

### The VCV word list: scanned, matched, and mostly not needed

`faculty.ucr.edu/~legneref/igbo/ogamigbovcvdictionary.htm` is Catherine Acholonu's list of 380 Igbo
words whose second letter is a consonant — *Aba, Abu, Ebe, Iba, Oba…* — OCR'd from print. The owner
asked for every word in it the dictionary does not already hold, so the page was converted to text,
the 380 numbered entries parsed, and each one compared against `word.headword`,
`word_dialect.spelling` and `word_form.value` with tone marks, case and punctuation stripped.

347 matched outright. The rest are all forms of words already held once the scan's OCR is corrected:
the page prints `I` as `l` and `c` as `e`, so `lehe` is *iche* and `lIu` is *ilu*, and many entries are
inflected or deverbal — "Achu, pursuing" is `-chu`, "Ipu, to germinate" is `-pu`, "Onyu, one who
excretes" is `-nyụ`, "Izo, to save, to contest" is `-zo`. **No headword in the list was missing.**

Two *meanings* were missing, and both came in through `data/words/additions.json`: the entry `anọ`
carried only "stay" and `atọ` only "third", so the cardinal numerals are now recorded with an example
each. Three entries the scan could not settle — `Uge` (palm-wine dregs), `Ehuo` (bowing in reverence),
`Ukwo` (popularity, fame) — were left out deliberately: the OCR leaves their spelling unrecoverable,
and a headword nobody can spell is worse than no headword. The dialect labels the book uses ("Orlu
dialect", "autochthon dialect", "migrant Igbo dialect") are the author's own classification and were
not turned into varieties.

## Adding a new language

The schema is built for this, so the work is corpus preparation rather than engineering.

1. **Register the language** in `packages/core/src/languages.ts` — ISO 639-3 code, endonym, scripts,
   tier, speaker count, and whether its orthography marks tone. The seed script writes it to the
   `language` table.
2. **Seed its grammar.** Add a `<language>-reference.json` under `packages/db/seed-data/` with its
   parts of speech, form types and dialects, and wire it into `seed.ts` the way Igbo is.
3. **Record the source** in the `SOURCES` array in `seed.ts` — name, URL, licence, and the exact
   `attribution_text` that must be displayed. Do not skip this; `npm run verify` will fail if imported
   rows lack a source.
4. **Write an importer** under `packages/db/src/import/`, using `igbo.ts` as the template. The shared
   helpers in `corpus.ts` handle bulk upserts, deterministic slug allocation and idempotency.
5. **Verify before publishing.** Run `npm run import:<language>` twice — counts must be identical the
   second time — then `npm run verify` and re-read the search results by hand. Tone-blind lookup is
   the feature most likely to be quietly wrong for an orthography nobody has tested yet.

### Corpus sources under consideration

Assembled for the Ozikoro language platform as candidates for tier 2 and 3 languages. **None of these
are imported yet, and each needs its licence confirmed before it is:**

| Language | ISO | Candidate sources |
|---|---|---|
| Yoruba | `yor` | Yoruba-Resources (GitHub), Lingvanex |
| Edo (Bini) | `bin` | Munro, *Edo grammar*; Thomas, *Edo dictionary* (centreforedostudies.be) |
| Urhobo | `urh` | Okrokoto, *Urhobo dictionary* (Urhobo Digital Library & Museum); urhobo.net |
| Efik | `efi` | *Efik language* (Una, 1920s, Internet Archive) |
| Ibibio | `ibb` | Ibibio dictionary (scanned) |
| Hausa | `hau` | Hausa–English dictionaries (multiple scans) |
| Akan / Twi | `twi` | GhanaNLP `kasa`, open-twi, Akan–Twi dictionaries |
| Wolof | `wol` | UCLA OPL 19; Gambia resource page; jolof (GitHub) |
| Mandinka | `mnk` | Peace Corps Mandinka–English dictionary; Gambia resource page |
| Adamawa Fulfulde | `fuv` | Stennes, *A Reference Grammar of Adamawa Fulani*; Fulani–English (1932) |
| Mende | `men` | *Mende–English Dictionary* (Innes); Sierra Leone Mende Manual |
| Kikongo | `kon` | Kikongo–English dictionaries (multiple scans) |
| Kimbundu | `kmb` | Assis, *Diccionário Kimbundu*; Portuguese–Umbundu dictionaries |
| Umbundu | `umb` | Umbundu vocabulary lists |
| Gullah | `gul` | Gullah Bible (Scripture Earth); ERIC ED198712; Wólakota Project handouts |

**Before importing any of these**, establish: (a) whether the work is in the public domain or under a
reusable licence, (b) for a Portuguese- or French-source dictionary, whether a machine translation
step is needed and how its errors will be marked, and (c) whether the orthography uses combining marks
this platform's orthography engine handles. Scanned PDFs also need OCR plus a correction pass by a
speaker — an OCR'd dictionary that nobody has read is worse than an empty one.

### Acquisition pass: what is actually usable, measured

Every candidate source you listed was downloaded and probed with `npm run probe:pdf`, which now
reports text **quality** as well as quantity. `npm run acquire` re-runs the downloads.

| Language | Source | Pages | Letters | Verdict |
|---|---|---|---|---|
| **Urhobo** | Ukere, *Urhobo Dictionary* (urhobo.net) | 53 | 89% | **Usable — imported (940 entries)** |
| **Urhobo** | Okrokoto dictionary | 64 | 65% | Usable, not yet parsed |
| **Gullah** | Bible (Scripture Earth) | 905 | 95% | Usable |
| **Gullah** | *Gullah grammar sketch* (Frank) | 11 | 93% | Usable |
| **Gullah** | CodeTalker handouts (Wólakota) | 12 | 93% | Usable |
| **Gullah** | ERIC ED198712 | 125 | 85% | Usable |
| **Mandinka** | Gambia resource page | 162 | 79% | Usable after decoding (below) |
| **Wolof** | Gambia resource page | 76 | 76% | Usable after decoding (below) |
| **Efik** | Wikisource scan | 78 | 61% | Usable, roughest of the set |
| **Ẹdo** | *Ẹdo personal names* | 28 | 91% | Usable |
| Ẹdo | Melzian (1937) / Agheysi / Thomas | 517 | 0% | Scanned |
| Fula | Stennes grammar / Fulani–English 1932 | 550 | 0% | Scanned |
| Mende | Mende Manual | 93 | 0% | Scanned |
| Mandinka | Peace Corps dictionary | 162 | 16% | **Encoding broken** |

**Ten of eighteen sources have extractable text**, covering six languages — far better than the
"everything needs OCR" picture a filename suggests. Igbo was not the exception; it was just first.

#### Two traps that a character count does not catch

Both were caught here, and both would have sent an importer off to parse noise:

1. **Broken font encoding.** The Peace Corps Mandinka dictionary has a healthy-looking text layer of
   4,762 characters per page. `npm run probe:pdf` initially called it usable. It extracts as
   `? ? ? ? ? ?` — the embedded fonts have no ToUnicode map, so every glyph is undecodable. The probe
   now measures what fraction of characters are actual letters and reports this as
   `TEXT LAYER UNUSABLE`.

2. **A constant character shift.** The Gambia-published Wolof and Mandinka dictionaries extract as
   real letters that are the *wrong* letters — every character shifted by +29:

   ```
   extracted:  D Q G D   Q   FHQVHU /LL VD DQGD OD
   intended:   a n d a   n   censer Lii sa anda la
   ```

   That is arithmetic, not a guess, so `scripts/decode-shifted-text.mjs` reverses it — closer to the
   original than OCR would be, and in seconds rather than minutes per page. Diacritics that shift past
   printable ASCII are unrecoverable and come back as digits (`le6u j7g..` for `lëu ñëw`), so entries
   containing those are rejected rather than guessed at.

#### The +29 shift, and the trap inside it

Fixing the shift was not enough, and the second bug is the more instructive one.

The first decoder restricted itself to printable ASCII (0x20–0x7E), on the
assumption that a font offset only moves printable characters. It produced
output like this:

```
cuuraa  n  porridge. Toogalcuuraa gerte. Cookpeanutporridge.
```

Legible, and wrong. The source encodes its common punctuation as **control
characters** — the space is `0x03`, the comma `0x0F`, the hyphen `0x10`, the full
stop `0x11`. Leaving them unshifted dropped every one of them, welding words
together. It reads as a decoding failure, but it is an off-by-one in a range
check, and the fix is to shift every code point rather than the printable ones.

That took Wolof from 19.6% of lines damaged to **0.5%**.

#### A third trap: text that is present, and assembled wrong

The Ekpeye dictionary — Blench (2013), *A Dictionary of Ẹkpẹyẹ*, after Clark and Williamson — has two
text layers in circulation and they fail in **opposite** directions, which is worse than one of them
failing:

|  | ịda "father" | àkwa "bridge" | ẹgwẹ "kola nut" |
|---|---|---|---|
| archive.org scan | `da` | `ak w a` | `egw e` |
| pdf.js text layer | `ịda` | `a` | `ẹ` |

The archive.org layer keeps the letters and loses the special characters — ị is dropped outright, ɗ
becomes j, ŋ becomes q — and puts each table cell on its own line, which is why the first importer had
to reassemble four columns per entry. The PDF's own layer keeps the diacritics and loses a whole word
wherever a headword changes font mid-word, because the fragments sit on different baselines:
`extract-pdf-text.mjs` starts a new line at any baseline change over 2 points, so "àkwa" arrives as

```
àk
w
a n. bridge
```

and a parser reading one line per entry sees a word called "a". That was 219 headwords — a quarter of
the file — and the damage is invisible in the output, because every fragment is still plausible text.

**The first import used the archive.org layer, and the cost was an entry reading "da — fall / father":**
a headword that had lost its first letter, merged into an unrelated Igbo verb, with both senses under
it. Nothing about that entry looked broken on the page.

Fixed by extracting visual rows instead of trusting pdf.js's line order.
`scripts/extract-pdf-rows.mjs` groups items by baseline within **7 points** — a number taken from the
document, where a font change moves a glyph up to 5 points while the rows themselves are 13.9 points
apart — joins them in x order, inserts a space only where there is a real gap, and closes up a
combining mark the layout split off. The output is one complete entry per line:

```
ịda n. father
ịdaƙanị n. grandfather
àkwa n. bridge
egwù n. rainbow
```

The re-scan is applied with `--replace`, which drops this source's dialect rows, senses and *draft*
words before writing the new reading — a published word is never deleted by an import, and a word
another source has defined keeps its entry and loses only the stale spelling.

That extraction was checked against a third reading, and the check is worth recording for what it did
*not* do. The same 43 pages were rendered at 3× and read with Apple's Vision OCR
(`ekpeye-work/ocr.swift`, with both layers' vocabulary passed in as custom words). Vision reads the
table's columns in a different order, so it confirms that a row really is one word — it reads
`àhubẹle` as `hub'ele` — but across all 43 pages it preserved **zero** instances of ị, ɗ and ŋ. It
cannot settle a letter, and it was not used to. The PDF's own character data is the authority for
those; what Vision was good for was the count of entries and the shape of a row.


The third layer is layout: in these dictionaries **only the headword is
letter-spaced**, not the gloss.

```
c u u c u n  penis term used for small boys.
```

A whole-line collapse welds the gloss into `Cookpeanutporridge`. So the join is
applied only to the leading run of single letters, treating the last of them as
the part-of-speech marker — which it is, since `c u u c u n` is the headword
`cuucu` plus `n`. That heuristic lives in the importer, not the decoder: the
decoder is arithmetic, and layout is a parsing concern.

#### Two more languages: Wolof and Mandinka

| Language | Entries matched | Distinct headwords | Extra senses merged |
|---|---|---|---|
| **Mandinka** | 11,197 | **10,154** | 1,018 |
| **Wolof** | 5,757 | **5,230** | 502 |

Both imported as `draft`: the licence on the Gambia resource page is unresolved,
so they are **not served by the API** — verified, both return zero search
results while Igbo and Yoruba report content.

#### Known limitations of the recovered text

Worth stating rather than discovering later:

- **Apostrophes are gone.** The apostrophe was encoded as `0x0A`, which the PDF
  layer treated as a line break before any decoding ran, so `man's name` arrives
  as `man s name`. The word is there; the punctuation is not.
- **Gloss and example are not separated.** Entries print `headword POS gloss.
  Example sentence. English translation.` with no delimiter, and both gloss and
  example contain capitals, so a reliable split is not possible from the text
  alone. The gloss keeps the example, which is a real limitation and a reason
  these stay draft: an editor has to split them.
- **Some accented vowels are unrecoverable** where the shift lands past the
  supported range, and such entries are rejected rather than guessed at (25 in
  each file).

#### Urhobo: imported, and deliberately not published

940 headwords from Ukere (1986), matching the dictionary's own `headword / part-of-speech / gloss`
layout, e.g. `abaka — Noun — grasshopper`.

**They are imported as `draft`, so the API does not serve them.** The licence is unresolved: this is a
1986 locally published Nigerian print dictionary, re-typed by a volunteer and republished on
urhobo.net with no licence statement. Publishing it would be redistributing somebody else's
dictionary. The entries exist so the work can proceed — and so a speaker can review them — the moment
permission is obtained.

`importStatus` in `text-dictionary.ts` exists for exactly this: adding a language should never require
deciding to publish it.

---

### Reconnaissance findings: Edo, the next language

Measured with `npm run probe:pdf`, not assumed:

| Source | Size | Text layer | Verdict |
|---|---|---|---|
Every Edo source now on disk, probed with `npm run probe:pdf`:

| Source | Pages | Text layer | Verdict |
|---|---|---|---|
| Melzian, *A Concise Dictionary of the Bini Language of Southern Nigeria* (1937) | 251 | **none** (0 chars/page) | **Scanned. Needs OCR.** |
| Agheysi, *An Edo–English Dictionary* | 202 | **none** (0 chars/page) | **Scanned. Needs OCR.** |
| Thomas, *Edo–English Dictionary* | 64 | **none** (0 chars/page) | **Scanned. Needs OCR.** |
| *Ẹdo personal names and world view* (`edonames.pdf`) | 28 | **1,118 chars/page** | **Born-digital. Extractable.** |

All three dictionaries were produced by the same GPL Ghostscript 8.60 pipeline, so
they are scans of print editions. That is **517 pages of Edo dictionary text that
must be OCR'd** — and the 1937 Melzian volume is old enough to be public domain,
which is the most promising of the three.

**The one born-digital source is a linguistics paper**, not a dictionary: a study of
Ẹdo personal names with interlinear morphological glosses, e.g.

```
Aisagbo = nbuo = mwan:
  A + i + sẹ + agbo + n + bu + o + mwa
  {Impersonal {negative reach world determine person Pronoun} marker}
  'One's destiny is not determined in the world'
```

Two things follow. It contains genuine name → meaning pairs, so a small number of
Ẹdo entries can be extracted **without OCR** — a useful pilot that needs no new
tooling. And note the `ẹ =` / `ọ =` rendering: the paper writes underdot vowels as
ASCII `e =` and `o =`, so extraction must normalise that back to `ẹ` and `ọ` or
every headword will be wrong. The same care applies to any OCR of the scanned
dictionaries, which is exactly why a speaker has to review the output.

**So Edo is an OCR project, not a data import.** That is a different order of work from Igbo, where
the corpora arrived as structured JSON with a licence and a schema. The pipeline would be:

1. **Probe every candidate file first** with `npm run probe:pdf`. Born-digital is far cheaper, and
   it is not guessable from a filename or a file size.
2. OCR with `tesseract.js` (WebAssembly, so no system install) or a system `tesseract`. Nothing is
   currently installed here — no `pdftotext`, `tesseract`, `mutool` or Python PDF library.
3. **A correction pass by an Edo speaker.** Not optional. 1970s OCR turns `ọ` into `o`, `ẹ` into
   `e`, mangles tone marks, and confuses `r`/`n`/`m`. Every one of those errors produces something
   that looks like a real word.
4. Only then the five-step importer checklist above.

**Worth stating plainly for planning:** the Igbo corpora were the *cheap* case, not the typical one.
They were already digital, structured, and openly licensed. Edo, Urhobo, Efik, Ibibio, Hausa and the
rest of the candidate list are scanned print dictionaries, and the cost is dominated by step 3 —
human review — not by code.

## Attribution text as shipped

These exact strings are stored in the `source` table and returned with each entry:

> **Igbo API (nkowaokwu/igbo_api)** — Igbo dialect, grammar and tense reference data adapted from the
> Igbo API (nkowaokwu/igbo_api), used under the Apache License 2.0.

> **Igbo Dictionary audio corpus (nkowaokwu/ibo-dict)** — Audio pronunciations from the
> nkowaokwu/ibo-dict dataset, used under CC BY 4.0. Contains 25,500 dialectal word recordings and
> 25,000 sentence recordings contributed by Igbo speakers.

## Removed: the machine-written proverb renderings

`data/proverbs/translations.json` held 1,220 English meanings written by a model for proverbs the
corpus had no translation for, and `packages/db/src/import/proverb-translations.ts` wrote them in.
Both are deleted, and the meanings are cleared from the database.

The owner's instruction, 2026-09-28: *"every single proverbs you generated its meaning, especially
from gemini should be deleted. keep the ones that came with english translations already."*

The registry now keeps only what a publication printed. 700 published proverbs carry an English a
source printed; 1,634 carry none. A proverb with no English is the honest state — a reader who does
not speak Igbo is told nothing rather than told something a model made up, and the file's own note
admitted these were "machine renderings, then checked by a second model", which is a review of
plausibility and not a source.

An entry with no English is also a request: it is the clearest invitation the site can make to a
speaker to supply the line.
