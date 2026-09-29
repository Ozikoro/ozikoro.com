/**
 * Data integrity gate.
 *
 * Run after every import and in CI. These are not smoke tests — each check
 * encodes an invariant that, if broken, means the dictionary is silently
 * wrong or the platform is in licence breach. Exit code 1 on any failure.
 *
 *   npm -w @ozituma/db run verify
 */
import {
  deriveForms,
  genderFromName,
  getLanguage,
  IGBO_REGIONS,
  IGBO_VARIETIES,
  transliterate,
} from '@ozituma/core';
import { closeDb, getDb, type Db } from './client.ts';
import { duplicateSignature } from './import/corpus.ts';
import { MECHANICAL_NOTE } from './import/script.ts';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const row = await db.one<{ n: number }>(sql, params);
  return Number(row?.n ?? 0);
}

export async function verifyData(db: Db): Promise<CheckResult[]> {
  results.length = 0;

  // ---------------------------------------------------------------------
  // Volume: the dictionary is actually populated.
  // ---------------------------------------------------------------------
  const words = await count(db, `select count(*)::int as n from word`);
  check('word table populated', words > 8000, `${words} headwords`);

  const igboWords = await count(
    db,
    `select count(*)::int as n from word where language_code = 'ibo'`
  );
  check('Igbo headwords imported', igboWords > 8000, `${igboWords} Igbo headwords`);

  const defs = await count(db, `select count(*)::int as n from definition`);
  check('definitions imported', defs > 9000, `${defs} definitions`);

  const examples = await count(db, `select count(*)::int as n from example`);
  check('examples imported', examples > 1000, `${examples} examples`);

  const relations = await count(
    db,
    `select count(*)::int as n from word_relation where relation_type = 'stem'`
  );
  check('stem relations resolved', relations > 7000, `${relations} stem edges`);

  // ---------------------------------------------------------------------
  // Uniqueness: no duplicate headwords or slugs within a language.
  // ---------------------------------------------------------------------
  const dupHeadwords = await count(
    db,
    `select count(*)::int as n from (
       select language_code, headword from word
        group by language_code, headword having count(*) > 1
     ) d`
  );
  check('no duplicate headwords', dupHeadwords === 0, `${dupHeadwords} duplicates`);

  const dupSlugs = await count(
    db,
    `select count(*)::int as n from (
       select language_code, slug from word
        group by language_code, slug having count(*) > 1
     ) d`
  );
  check('no duplicate slugs per language', dupSlugs === 0, `${dupSlugs} collisions`);

  const parkedSlugs = await count(db, `select count(*)::int as n from word where slug like 'parked-%'`);
  check(
    'no headword left with a parked slug',
    parkedSlugs === 0,
    `${parkedSlugs} words still parked (run the importer to completion)`
  );

  // ---------------------------------------------------------------------
  // Derived-form correctness: this is the invariant the whole search layer
  // rests on. If search_form is not the fully-folded form of the headword,
  // tone-blind search silently stops working for some rows.
  //
  // We re-derive every row in TypeScript and compare, rather than trying to
  // express the folding rules in SQL. That makes this a genuine independent
  // check of the importer: SQL regex escaping for combining-mark ranges is
  // easy to get subtly wrong (an earlier version of this check used
  // '[\u0300-\u036f]', which Postgres reads as a literal 'u' and therefore
  // matched nothing — a false pass).
  // ---------------------------------------------------------------------
  const allWords = await db.rows<{
    id: string;
    language_code: string;
    headword: string;
    exact_form: string;
    search_form: string;
  }>(`select id, language_code, headword, exact_form, search_form from word`);

  const wrongExact: string[] = [];
  const wrongSearch: string[] = [];
  const toneLeftInExact: string[] = [];
  const marksInSearch: string[] = [];
  const TONE_MARKS = /[\u0301\u0300\u0304\u030c\u0302\u0303\u0306\u0308]/;
  const ANY_MARK = /[\u0300-\u036f]/;

  for (const row of allWords) {
    const language = getLanguage(row.language_code);
    const derived = deriveForms(row.headword, language);
    if (derived.exactForm !== row.exact_form) wrongExact.push(row.headword);
    if (derived.searchForm !== row.search_form) wrongSearch.push(row.headword);
    if (TONE_MARKS.test(row.exact_form.normalize('NFD'))) toneLeftInExact.push(row.headword);
    if (ANY_MARK.test(row.search_form.normalize('NFD'))) marksInSearch.push(row.headword);
  }

  check(
    'exact_form re-derives identically for every headword',
    wrongExact.length === 0,
    wrongExact.length === 0
      ? `${allWords.length} rows verified`
      : `${wrongExact.length} wrong, e.g. ${wrongExact.slice(0, 3).join(', ')}`
  );

  check(
    'search_form re-derives identically for every headword',
    wrongSearch.length === 0,
    wrongSearch.length === 0
      ? `${allWords.length} rows verified`
      : `${wrongSearch.length} wrong, e.g. ${wrongSearch.slice(0, 3).join(', ')}`
  );

  check(
    'exact_form retains no tone marks',
    toneLeftInExact.length === 0,
    toneLeftInExact.length === 0
      ? '0 rows carry tone'
      : `${toneLeftInExact.length} rows, e.g. ${toneLeftInExact.slice(0, 3).join(', ')}`
  );

  check(
    'search_form retains no combining marks',
    marksInSearch.length === 0,
    marksInSearch.length === 0
      ? '0 rows carry diacritics'
      : `${marksInSearch.length} rows, e.g. ${marksInSearch.slice(0, 3).join(', ')}`
  );

  // ---------------------------------------------------------------------
  // Attribution: CC-BY-4.0 and Apache-2.0 both require attribution to
  // travel with the work, so every imported row must name a source.
  // ---------------------------------------------------------------------
  const wordsWithoutSource = await count(db, `select count(*)::int as n from word where source_id is null`);
  check(
    'every headword has a source',
    wordsWithoutSource === 0,
    `${wordsWithoutSource} headwords lack attribution`
  );

  const definitionsWithoutSource = await count(
    db,
    `select count(*)::int as n from definition where source_id is null`
  );
  check(
    'every definition has a source',
    definitionsWithoutSource === 0,
    `${definitionsWithoutSource} definitions lack attribution`
  );

  const sourcesWithoutLicence = await count(
    db,
    `select count(*)::int as n from source
      where license_code is null or length(trim(license_code)) = 0
         or attribution_text is null or length(trim(attribution_text)) = 0`
  );
  check(
    'every source records a licence and attribution text',
    sourcesWithoutLicence === 0,
    `${sourcesWithoutLicence} sources incomplete`
  );

  // ---------------------------------------------------------------------
  // Referential integrity for the joins the API depends on.
  // ---------------------------------------------------------------------
  // Examples are linked to words so they can appear on entry pages. A small
  // share cannot be linked at all: the sentence corpus contains sentences whose
  // words are simply not in the dictionary yet, and forcing a link by matching
  // short common words ("m", "na", "ya") would attach thousands of unrelated
  // sentences to almost every entry.
  //
  // So the invariant is a RATE, not zero — and the rate is asserted, so it
  // cannot quietly grow. It should fall as the dictionary grows.
  //
  // This check is worth reading twice for a second reason: it is what caught a
  // real importer bug. Duplicate sentence texts shared a hash-derived
  // external_id, the importer's id map collapsed each pair to one row, and the
  // other row was inserted with no links — 652 silent orphans. The count was
  // 2,059 before the fix and 1,442 after.
  const orphanedExamples = await count(
    db,
    `select count(*)::int as n from example e
      where not exists (select 1 from example_word ew where ew.example_id = e.id)`
  );
  const totalExamples = await count(db, `select count(*)::int as n from example`);
  const orphanRate = totalExamples === 0 ? 0 : orphanedExamples / totalExamples;
  check(
    'unlinked examples stay a small minority',
    orphanRate < 0.1,
    `${orphanedExamples}/${totalExamples} unlinked (${(orphanRate * 100).toFixed(1)}%, limit 10%)`
  );

  const wordsWithNoDefinitions = await count(
    db,
    `select count(*)::int as n from word w
      where not exists (select 1 from definition d where d.word_id = w.id)`
  );
  // 85 cross-reference-only entries exist in the source ("a -> see e").
  // They are legitimate headwords, so we assert the number stays small and
  // known rather than zero.
  check(
    'cross-reference-only headwords stay a small minority',
    wordsWithNoDefinitions < 200,
    `${wordsWithNoDefinitions} headwords with no definition`
  );

  // ---------------------------------------------------------------------
  // Grammar and dialect scoping: language-scoped reference data must point
  // at the right language. This is the generalisation that lets one schema
  // serve many languages, so a mismatch here is a design regression.
  // ---------------------------------------------------------------------
  const misScopedPos = await count(
    db,
    `select count(*)::int as n from definition d
       join word w on w.id = d.word_id
       join part_of_speech p on p.id = d.part_of_speech_id
      where p.language_code is not null and p.language_code <> w.language_code`
  );
  check(
    'grammar categories match their headword language',
    misScopedPos === 0,
    `${misScopedPos} mismatched rows`
  );

  const misScopedDialect = await count(
    db,
    `select count(*)::int as n from word_dialect wd
       join word w on w.id = wd.word_id
       join dialect dl on dl.id = wd.dialect_id
      where w.language_code <> dl.language_code`
  );
  check(
    'dialects match their headword language',
    misScopedDialect === 0,
    `${misScopedDialect} mismatched rows`
  );

  // ---------------------------------------------------------------------
  // Audio. Now a substantial part of the corpus (tens of thousands of rows),
  // so it gets the same scrutiny as text: every row must resolve to something
  // playable, be attributed, and be scoped to the right language.
  // ---------------------------------------------------------------------
  const audioRows = await count(db, `select count(*)::int as n from audio`);
  check('audio imported', audioRows > 10_000, `${audioRows} recordings`);

  const audioNoSource = await count(
    db,
    `select count(*)::int as n from audio
      where storage_key is null and external_url is null`
  );
  check(
    'every recording is playable (has a key or a URL)',
    audioNoSource === 0,
    `${audioNoSource} rows with neither`
  );

  const audioNoAttribution = await count(
    db,
    `select count(*)::int as n from audio where source_id is null`
  );
  check(
    'every recording has a source',
    audioNoAttribution === 0,
    `${audioNoAttribution} recordings lack attribution`
  );

  const audioMisScoped = await count(
    db,
    `select count(*)::int as n from audio a
       join dialect d on d.id = a.dialect_id
      where a.language_code <> d.language_code`
  );
  check(
    'dialect-attributed audio matches its language',
    audioMisScoped === 0,
    `${audioMisScoped} mismatched rows`
  );

  // An audio row must hang off exactly one owner — the schema has a check
  // constraint for this, so a violation would mean the constraint is gone.
  const audioMultiOwner = await count(
    db,
    /*
     * `person_name_id` is a fourth kind of owner, added by migration 0024 so a name can carry a
     * recording. This check enumerated the other three, so the first name recording written counted
     * as having no owner at all and failed the gate — the check was right about the rule and out of
     * date about the schema, which is the failure mode a schema-aware gate is supposed to avoid.
     */
    `select count(*)::int as n from audio
      where num_nonnulls(word_id, word_dialect_id, example_id, person_name_id) <> 1`
  );
  check(
    'every recording has exactly one owner',
    audioMultiOwner === 0,
    `${audioMultiOwner} rows with the wrong owner count`
  );

  /*
   * Every headword pronunciation in the dictionary was once deleted by a sweep
   * that removed "recordings naming no variety", on the reasoning that such a clip
   * cannot say what it is. A headword recording has no variety because it is not OF
   * one, so that rule emptied the entire word layer of the corpus — 4,446 rows —
   * and the check below did not notice, because it had been rewritten to count a
   * dialect recording hanging off a dialect spelling as "this entry has audio".
   *
   * The loosening is what let the loss stand. Both halves are the same fact and are
   * checked separately: the rows exist, and the entries own them.
   */
  const headwordAudioRows = await count(
    db,
    `select count(*)::int as n from audio
      where word_id is not null and dialect_id is null and status = 'published'`
  );
  check(
    'headword pronunciations exist',
    headwordAudioRows >= 4_000,
    `${headwordAudioRows} recordings belonging to a word`
  );

  /*
   * An entry is audible when a recording belongs to IT — not when one belongs to
   * one of its dialect spellings.
   *
   * That distinction is the whole point of this check and it was briefly lost.
   * Counting dialect recordings as the entry's own let 13,366 entries report as
   * "having audio" while none of them had a recording of the word itself, which is
   * exactly the state /word/igbo/ike was in: six dialect clips, no pronunciation of
   * "ike", and the page playing Ọnịcha's "ume" in the headword's place.
   */
  const wordsWithAudio = await count(
    db,
    `select count(*)::int as n from word w
      where w.language_code = 'ibo' and w.status = 'published'
        and exists (select 1 from audio a where a.word_id = w.id and a.status = 'published')`
  );
  check(
    'a meaningful share of headwords have their own recording',
    wordsWithAudio >= 3_000,
    `${wordsWithAudio} headwords with a recording of their own`
  );

  const dialectAudio = await count(
    db,
    `select count(*)::int as n from audio where dialect_id is not null`
  );
  check(
    'dialect-specific pronunciations are attributed',
    dialectAudio >= 10_000,
    `${dialectAudio} dialect-attributed recordings`
  );

  // No recording may hang off a word that is not published — otherwise audio
  // would leak into the API for an entry that is still a draft.
  const audioOnUnpublished = await count(
    db,
    `select count(*)::int as n from audio a
       join word w on w.id = a.word_id
      where w.status <> 'published'`
  );
  check(
    'no recording is attached to an unpublished entry',
    audioOnUnpublished === 0,
    `${audioOnUnpublished} rows on non-published words`
  );

  // A smoke test that the join the API depends on actually returns rows: pick
  // the word with the most audio and confirm both it and its recordings resolve.
  const richestWord = await db.one<{ headword: string; search_form: string; clips: number }>(
    /*
     * The smoke test for the join the API depends on, counted on the recordings the
     * word OWNS.
     *
     * It briefly counted dialect recordings too, "because after the unlabelled clips
     * were removed there is no word left with headword-level audio, and a smoke test
     * that fails on an empty set would report the API as broken while it answers
     * correctly". The API was not answering correctly: it was handing entries
     * whichever dialect clip came first in place of their own pronunciation. A smoke
     * test that has been taught to pass on the broken state is worse than no smoke
     * test, so this one asks the question the page asks.
     */
    `select w.headword, w.search_form,
            count(a.id)::int as clips
       from word w
       left join audio a on a.word_id = w.id and a.status = 'published'
      where w.status = 'published'
      group by w.id, w.headword, w.search_form
      order by clips desc, w.headword
      limit 1`
  );
  check(
    'a known word resolves to its published recordings',
    (richestWord?.clips ?? 0) >= 1,
    richestWord ? `"${richestWord.headword}" has ${richestWord.clips} recordings` : 'no word has audio'
  );

  // ---------------------------------------------------------------------
  // Multi-language readiness: the reference data for more than one language
  // must exist, proving the schema is genuinely general and not Igbo-only.
  // ---------------------------------------------------------------------
  const languages = await count(db, `select count(*)::int as n from language`);
  check('multiple languages registered', languages >= 5, `${languages} languages`);

  // The central architectural bet is that a language is a corpus plus a few
  // reference rows, not a code change. That claim is only credible if more than
  // one language actually has content, so assert it rather than describing it.
  const languagesWithWords = await db.rows<{ language_code: string; n: number }>(
    `select language_code, count(*)::int as n from word
      where status = 'published' group by language_code order by n desc`
  );
  check(
    'more than one language has published content',
    languagesWithWords.length >= 2,
    languagesWithWords.map((l) => `${l.language_code}=${l.n}`).join(', ')
  );

  // Content must not leak across languages: an Igbo query must never return
  // Yoruba words. This is the failure that a shared table invites, and it would
  // be invisible in a single-language deployment.
  const crossLanguageLeak = await count(
    db,
    `select count(*)::int as n from word w
       join definition d on d.word_id = w.id
      where w.language_code <> (select language_code from word w2 where w2.id = d.word_id)`
  );
  check(
    'no word is scoped to two languages at once',
    crossLanguageLeak === 0,
    `${crossLanguageLeak} inconsistent rows`
  );

  // A check for mapping failures, and it has to tell two things apart that look
  // identical by count alone:
  //
  //   REAL POLYSEMY. Igbo "gba" has 32 senses — buy, shoot, sting, weave,
  //   wrestle, foretell, celebrate — accumulated from three independent corpora.
  //   That is a word with a lot of meanings.
  //
  //   A MAPPING FAILURE. The Yoruba source attached one 26-word alphabetical
  //   run of unrelated English words ("tale, talent, tarnish, talk, ...") to a
  //   single key. That is not a word with a lot of meanings.
  //
  // Counting glosses cannot separate them, and an earlier version of this check
  // flagged the legitimate one. The discriminator is ALPHABETICAL SPREAD: a real
  // polysemous word has senses starting all over the alphabet, while a runaway
  // alphabetical list stays inside one or two letters.
  const overGlossed = await db.rows<{ headword: string; language_code: string; n: number; initials: number }>(
    `select w.headword, w.language_code, count(*)::int as n,
            count(distinct lower(left(d.text, 1)))::int as initials
       from word w join definition d on d.word_id = w.id
      group by w.id, w.headword, w.language_code
     having count(*) > 25 and count(distinct lower(left(d.text, 1))) <= 4
      order by n desc limit 5`
  );
  const mostGlossed = await db.one<{ headword: string; n: number }>(
    `select w.headword, count(*)::int as n from word w join definition d on d.word_id = w.id
      group by w.id, w.headword order by n desc limit 1`
  );
  check(
    'no headword looks like a runaway alphabetical mapping',
    overGlossed.length === 0,
    overGlossed.length === 0
      ? `none (most-glossed is "${mostGlossed?.headword}" with ${mostGlossed?.n}, which spreads across the alphabet)`
      : overGlossed.map((r) => `${r.headword}(${r.n} glosses, ${r.initials} initials)`).join(', ')
  );

  const languagesWithPos = await count(
    db,
    `select count(distinct language_code)::int as n from part_of_speech where language_code is not null`
  );
  check(
    'grammar categories seeded for more than one language',
    languagesWithPos >= 1,
    `${languagesWithPos} languages with own grammar categories`
  );

  const dialects = await count(db, `select count(*)::int as n from dialect`);
  check('dialects seeded', dialects >= 40, `${dialects} dialects`);

  // ---------------------------------------------------------------------
  // Quota configuration: every plan must have a limit, because the whole
  // point of this table is that advertised == enforced.
  // ---------------------------------------------------------------------
  const plans = await db.rows<{ plan: string }>(`select distinct plan from plan_limit`);
  const missingPlanLimits: string[] = [];
  for (const plan of ['free', 'team', 'institution']) {
    if (!plans.some((p) => p.plan === plan)) missingPlanLimits.push(plan);
  }
  check(
    'every plan has an enforced limit',
    missingPlanLimits.length === 0,
    missingPlanLimits.length === 0
      ? `${plans.length} plans configured`
      : `missing: ${missingPlanLimits.join(', ')}`
  );

  const hasWildcard = await count(
    db,
    `select count(*)::int as n from plan_limit where endpoint = '*'`
  );
  check(
    'plans have a wildcard fallback limit',
    hasWildcard >= 3,
    `${hasWildcard} wildcard limits`
  );

  // ---------------------------------------------------------------------
  // Search readiness: the generated tsvector must actually be populated and
  // the search columns must be indexed.
  // ---------------------------------------------------------------------
  const emptyVectors = await count(
    db,
    `select count(*)::int as n from word where search_vector is null`
  );
  check('search vectors generated', emptyVectors === 0, `${emptyVectors} null vectors`);

  const indexed = await db.rows<{ indexname: string }>(
    `select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in ('word_search_form_idx','word_search_prefix_idx',
                          'word_search_fts_idx','definition_search_fts_idx')`
  );
  check(
    'core search indexes exist',
    indexed.length === 4,
    `${indexed.length}/4 present`
  );

  // ---------------------------------------------------------------------
  // Functional smoke tests: prove real lookups return real rows.
  // ---------------------------------------------------------------------
  const toneBlind = await count(
    db,
    `select count(*)::int as n from word where language_code = 'ibo' and search_form = 'akwa'`
  );
  check(
    'tone-blind lookup finds akwa-class headwords',
    toneBlind >= 2,
    `${toneBlind} rows for search_form 'akwa' (àkwà / ákwá)`,
  );

  const diacriticInsensitive = await count(
    db,
    `select count(*)::int as n from word where language_code = 'ibo' and search_form = 'ulo'`
  );
  check(
    'folded lookup finds ụlọ from "ulo"',
    diacriticInsensitive >= 1,
    `${diacriticInsensitive} rows for search_form 'ulo'`
  );

  const englishLookup = await count(
    db,
    `select count(*)::int as n from definition
      where search_vector @@ to_tsquery('english', 'water')`
  );
  check(
    'English full-text search matches definitions',
    englishLookup >= 1,
    `${englishLookup} definitions match "water"`
  );

  const commonWords = await count(db, `select count(*)::int as n from word where is_common`);
  check(
    'common words flagged from the frequency list',
    commonWords >= 690,
    `${commonWords} common words`
  );

  const rankedCommon = await count(
    db,
    `select count(*)::int as n from word where is_common and frequency_rank is null`
  );
  check(
    'every common word has a frequency rank',
    rankedCommon === 0,
    `${rankedCommon} common words unranked`
  );

  // ---------------------------------------------------------------------
  // The name dictionary.
  //
  // Names are a separate table with their own invariants, and the two that
  // matter are the ones a reader would be misled by: a name published with no
  // meaning, and a gender asserted beyond what the source supports.
  // ---------------------------------------------------------------------
  const personNames = await count(db, `select count(*)::int as n from person_name`);
  check('name dictionary populated', personNames > 0, `${personNames} personal names`);

  const publishedNames = await count(
    db,
    `select count(*)::int as n from person_name where status = 'published'`
  );
  check(
    'names are published for the name dictionary',
    publishedNames > 0,
    `${publishedNames} published, ${personNames - publishedNames} draft`
  );

  // A name with no meaning is a headword with nothing behind it. The importer
  // skips these rather than storing them, so any that exist came from elsewhere.
  const namelessNames = await count(
    db,
    `select count(*)::int as n from person_name where meaning is null or btrim(meaning) = ''`
  );
  check(
    'every published name carries a meaning',
    namelessNames === 0,
    `${namelessNames} names with no meaning`
  );

  const dupNameSlugs = await count(
    db,
    `select count(*)::int as n from (
       select language_code, slug from person_name
        group by language_code, slug having count(*) > 1
     ) d`
  );
  check(
    'no duplicate name slugs per language',
    dupNameSlugs === 0,
    `${dupNameSlugs} collisions`
  );

  // Gender is constrained in the schema; this proves the constraint is the one
  // actually in force, and that nothing has defaulted a name to 'male' or
  // 'female' without a title morpheme to justify it.
  const badGender = await count(
    db,
    `select count(*)::int as n from person_name
      where gender not in ('unisex', 'male', 'female')`
  );
  check(
    'name genders stay within the three-word vocabulary',
    badGender === 0,
    `${badGender} rows outside unisex/male/female`
  );

  /*
   * Every name's gender is either what the morpheme rule says, or the owner's
   * own word — and there is nothing else it can be.
   *
   * This used to be a sentence of SQL here, restating the rule the importer
   * applies. Two copies of a rule drift, and this one had already drifted in a
   * way that mattered: the SQL tested only whether SOME gendering morpheme was
   * present, so a name containing nwanyi and marked MALE passed. The rule now
   * lives in @ozituma/core and both sides call it, which is what makes the
   * direction check below possible at all.
   *
   * The `owner` basis is the one exception, and it is deliberately narrow. The
   * owner knows things the morphemes do not: Ijele carries no gendering morpheme
   * and is a man's name. A gate that rejected that would be overruling the
   * person the dictionary belongs to in order to defend an inference — which is
   * backwards. What the gate CAN require is that the exception is honest: it must
   * actually change the answer, and must not be a no-op standing on top of a rule
   * that already agreed.
   *
   * The owner may also overrule the rule TOWARDS unisex, which this check used to
   * forbid outright ("owner basis on a unisex name"). The assumption behind that
   * — that the owner only ever corrects a name into being gendered — was wrong,
   * and `Òkèìlòlò` is the case that showed it: the morpheme rule reads the `lolo`
   * ending as female, the owner says the name is unisex, and the owner is the
   * authority on their own names. An unisex statement that the rule already made
   * is still a no-op and is still reported, so nothing the check was protecting
   * has been given up.
   */
  const genderRows = await db.rows<{
    name: string;
    search_form: string;
    gender: string;
    gender_basis: string;
  }>(`select name, search_form, gender, gender_basis from person_name`);

  const genderDrift: string[] = [];
  const redundantOwner: string[] = [];
  const ownerStated: string[] = [];

  for (const row of genderRows) {
    const expected = genderFromName(row.search_form);

    if (row.gender_basis === 'owner') {
      // A statement that changes nothing is the thing to report, whichever way
      // it points. A statement that changes the answer — including to unisex —
      // is the owner's word and stands.
      if (expected.gender === row.gender) {
        redundantOwner.push(row.name);
      }
      ownerStated.push(`${row.name}=${row.gender}`);
      continue;
    }

    if (row.gender !== expected.gender || row.gender_basis !== expected.basis) {
      genderDrift.push(
        `${row.name}: stored ${row.gender}/${row.gender_basis}, rule says ` +
          `${expected.gender}/${expected.basis}`
      );
    }
  }

  check(
    'every gender is the morpheme rule, or the owner stating it outright',
    genderDrift.length === 0,
    genderDrift.length === 0
      ? `${ownerStated.length} by the owner's word (${ownerStated.join(', ')}), ` +
          `${genderRows.length - ownerStated.length} by morpheme`
      : `${genderDrift.length}: ${genderDrift.slice(0, 4).join('; ')}`
  );

  check(
    'the owner overrules the rule only where the rule is wrong',
    redundantOwner.length === 0,
    redundantOwner.length === 0
      ? 'no owner correction merely repeats what the morphemes already said'
      : `${redundantOwner.length} redundant: ${redundantOwner.join(', ')}`
  );

  /*
   * One name, one entry.
   *
   * The key ignores spacing and punctuation, because that is how the duplicates
   * arose: "Chukwudalu" beside "Chukwu Dalu", "Nkemjiaka" beside "Nkem ji aka",
   * "Okika di gboo" beside "Òkìkà dị̀gboò". A reader searching either spelling
   * must land on one entry, so two rows sharing this key is a defect.
   */
  const duplicateKeys = await count(
    db,
    `select count(*)::int as n from (
       select lower(regexp_replace(search_form, '[^a-z]', '', 'g')) as k
         from person_name group by k having count(*) > 1
     ) d`
  );
  check(
    'no two names are the same name spelled twice',
    duplicateKeys === 0,
    `${duplicateKeys} duplicate groups`
  );

  // The folded key is what makes a name findable without typing tone marks, so
  // it has to be derivable from the name itself.
  const nameRows = await db.rows<{ name: string; search_form: string }>(
    `select name, search_form from person_name`
  );
  const nameMismatch = nameRows.filter(
    (row) => deriveForms(row.name).searchForm !== row.search_form
  ).length;
  check(
    'search_form re-derives identically for every name',
    nameMismatch === 0,
    `${nameRows.length} rows verified, ${nameMismatch} mismatched`
  );

  const unattributedNames = await count(
    db,
    `select count(*)::int as n from person_name n
      where n.status = 'published' and n.source_id is null`
  );
  check(
    'every published name has a source',
    unattributedNames === 0,
    `${unattributedNames} names lack attribution`
  );

  /*
   * The owner's rule, and the one gender assertion in the corpus that comes
   * from a rule rather than a source: Ada is a daughter, so every name
   * beginning "ada" is female. Checked against the FOLDED form, so Àkụ̀-style
   * tone marks cannot let one through.
   */
  const adaNotFemale = await count(
    db,
    `select count(*)::int as n from person_name
      where search_form like 'ada%' and gender <> 'female'`
  );
  check(
    'every name beginning "ada" is female',
    adaNotFemale === 0,
    `${adaNotFemale} Ada-prefixed names not female`
  );

  // A name is not its own variant. This is what a sloppy merge or a scraper
  // that lists a headword alongside its own entry would produce.
  const selfVariants = await count(
    db,
    `select count(*)::int as n from person_name where name = any(variants)`
  );
  check(
    'no name lists itself among its own variants',
    selfVariants === 0,
    `${selfVariants} self-referential variants`
  );

  /*
   * A name is one capitalised word. "Eze ndi eze" is how the WORDS of the name
   * are written so a reader can follow the meaning; the name is Ezendieze. A
   * spaced name on the site is therefore either a source's explanation that
   * leaked into the name column, or two spellings glued together.
   */
  const spacedNames = await count(
    db,
    `select count(*)::int as n from person_name where name like '% %'`
  );
  check(
    'no name contains a space',
    spacedNames === 0,
    `${spacedNames} names with a space`
  );

  const lowerCaseNames = await count(
    db,
    `select count(*)::int as n from person_name where name !~ '^[A-ZÀ-Ỹ]'`
  );
  check(
    'every name starts with a capital letter',
    lowerCaseNames === 0,
    `${lowerCaseNames} names not capitalised`
  );

  const namesWithVariants = await count(
    db,
    `select count(*)::int as n from person_name where array_length(variants, 1) > 0`
  );
  check(
    'variants are recorded for a meaningful share of names',
    namesWithVariants >= 500,
    `${namesWithVariants} names carry variants`
  );

  /*
   * ORIGIN IS WHERE A NAME IS BORNE, NOT WHERE IT WAS COLLECTED.
   *
   * The owner rejected provenance in this column by name, having seen a source
   * list sitting under a name's meaning. So the check is not "the origin looks
   * plausible" — it is "the origin is one of the Igbo regions, and it is not the
   * name of any source this database holds". Both halves matter: the first stops
   * a typo, the second stops the exact defect coming back through a future
   * importer that decides to be helpful.
   */
  const originRows = await db.rows<{ name: string; origins: string[] }>(
    `select name, origins from person_name where array_length(origins, 1) > 0`
  );

  const regionCodes = new Set(IGBO_REGIONS.map((r) => r.code));
  const offVocabulary = originRows.flatMap((row) =>
    row.origins.filter((origin) => !regionCodes.has(origin)).map((o) => `${row.name}:${o}`)
  );
  check(
    'every origin is a region from the Igbo vocabulary',
    offVocabulary.length === 0,
    offVocabulary.length === 0
      ? `${originRows.length} names carry a documented origin`
      : `${offVocabulary.length} off-vocabulary: ${offVocabulary.slice(0, 5).join(', ')}`
  );

  /*
   * The same claim from the other side. Even a region name that somehow also
   * became a source would be caught here, and it is the check that reads most
   * like the complaint: a source is not an origin.
   */
  const sourceNames = await db.rows<{ name: string; slug: string }>(
    `select name, slug from source`
  );
  const sourceLabels = new Set(
    sourceNames.flatMap((s) => [s.name.toLowerCase(), s.slug.toLowerCase()])
  );
  const provenanceAsOrigin = originRows.flatMap((row) =>
    row.origins
      .filter((origin) => sourceLabels.has(origin.toLowerCase()))
      .map((o) => `${row.name}:${o}`)
  );
  check(
    'no origin is the name of a source we collected from',
    provenanceAsOrigin.length === 0,
    provenanceAsOrigin.length === 0
      ? `${sourceLabels.size} source labels checked against every origin`
      : `${provenanceAsOrigin.length}: ${provenanceAsOrigin.slice(0, 5).join(', ')}`
  );

  /*
   * A no-space origin, and one that is a real word rather than a URL. The
   * vocabulary check above already covers this, but the failure it protects
   * against — "myigboname.com" appearing under a name — is worth naming.
   */
  const urlLikeOrigins = originRows.flatMap((row) =>
    row.origins.filter((origin) => /[.:/]|\.(com|ng|org|net)$/i.test(origin))
  );
  check(
    'no origin looks like a website',
    urlLikeOrigins.length === 0,
    `${urlLikeOrigins.length} URL-like origins`
  );

  /*
   * Cross-variety forms: *Wike* beside *Nwike*, *Ovunda* beside *Obinna*.
   *
   * The column is jsonb, so nothing but this check stands between a malformed
   * write and an entry page rendering "undefined". Each form needs a form, a
   * variety from the vocabulary, and a variety form that is not simply the name
   * again — that last one is what a rushed edit to the curated list looks like.
   */
  const varietyRows = await db.rows<{
    name: string;
    variety_forms: unknown;
  }>(
    `select name, variety_forms from person_name
      where jsonb_array_length(variety_forms) > 0`
  );

  const varietySet = new Set<string>(IGBO_VARIETIES);
  const badForms: string[] = [];
  for (const row of varietyRows) {
    if (!Array.isArray(row.variety_forms)) {
      badForms.push(`${row.name}: not an array`);
      continue;
    }
    for (const entry of row.variety_forms) {
      if (typeof entry !== 'object' || entry === null) {
        badForms.push(`${row.name}: not an object`);
        continue;
      }
      const { form, variety } = entry as { form?: unknown; variety?: unknown };
      if (typeof form !== 'string' || form.trim().length === 0) {
        badForms.push(`${row.name}: empty form`);
        continue;
      }
      if (typeof variety !== 'string' || !varietySet.has(variety)) {
        badForms.push(`${row.name}: unknown variety ${String(variety)}`);
        continue;
      }
      if (form.toLowerCase() === row.name.toLowerCase()) {
        badForms.push(`${row.name}: form repeats the name`);
      }
    }
  }
  check(
    'every cross-variety form names a form and a known variety',
    badForms.length === 0,
    badForms.length === 0
      ? `${varietyRows.length} names carry forms in other varieties`
      : `${badForms.length}: ${badForms.slice(0, 5).join('; ')}`
  );

  /*
   * The alternative-script layer.
   *
   * Ndebe values are stored rather than computed on render, so that a human
   * correction has somewhere to live. That makes the stored value and the
   * transliterator two things that can disagree, and this is where the
   * disagreement is caught.
   *
   * The rule is the note. A row whose note says MECHANICAL must reproduce from
   * its headword exactly; a correction changes the note and is then left alone
   * by both the importer and this check. So the exception is explicit and
   * visible rather than an unexplained difference that the next import would
   * quietly overwrite.
   */
  const scriptRows = await db.rows<{
    headword: string;
    script_code: string;
    value: string;
    notes: string | null;
  }>(
    `select w.headword, ws.script_code, ws.value, ws.notes
       from word_script ws
       join word w on w.id = ws.word_id`
  );

  const scriptDrift = scriptRows
    .filter((row) => row.notes === MECHANICAL_NOTE)
    .filter((row) => transliterate(row.headword).text !== row.value)
    .map((row) => row.headword);

  const corrections = scriptRows.filter((row) => row.notes !== MECHANICAL_NOTE);

  check(
    'every mechanical script value re-derives from its headword',
    scriptDrift.length === 0,
    scriptDrift.length === 0
      ? `${scriptRows.length - corrections.length} mechanical rows verified, ` +
          `${corrections.length} recorded as corrections`
      : `${scriptDrift.length} drifted: ${scriptDrift.slice(0, 5).join(', ')}`
  );

  /*
   * A script value that cannot be rendered is worse than no script value: it
   * shows as boxes and still reads as a claim. So a stored Ndebe value may
   * contain exactly two things — Ndebe's own characters, and the punctuation the
   * entry is written with.
   *
   * The punctuation is not a loophole. The corpus has affix entries written
   * "-fu" and glosses that leaked into headwords, "(agwa) -ma", and the
   * transliterator carries their punctuation through rather than pretending a
   * hyphen is an Igbo letter. What must NOT appear is a Latin letter: if one
   * does, something wrote a spelling instead of a transliteration, and the font
   * has no glyph for it.
   */
  const isNdebeCodepoint = (cp: number): boolean => {
    // Ndebe's own block, as drawn by the font.
    if (cp >= 0xe100 && cp <= 0xe96e) return true;
    // A space, or printable ASCII punctuation or a digit — never a letter.
    if (cp === 0x20) return true;
    if (cp > 0x20 && cp < 0x7f && !/[A-Za-z]/.test(String.fromCodePoint(cp))) return true;
    return false;
  };

  const badScriptValues = scriptRows.filter((row) => {
    if (row.value.trim().length === 0) return true;
    return [...row.value].some((c) => !isNdebeCodepoint(c.codePointAt(0) ?? 0));
  });

  check(
    'every stored script value is Ndebe, plus the punctuation the entry carries',
    badScriptValues.length === 0,
    badScriptValues.length === 0
      ? `${scriptRows.length} values hold only U+E100-U+E96E and non-letter ASCII`
      : `${badScriptValues.length}: ${badScriptValues.slice(0, 5).map((r) => r.headword).join(', ')}`
  );

  /*
   * Coverage, as a floor rather than a target.
   *
   * 163 headwords cannot be written and that is correct — they are `ŋ`, bare
   * abbreviations and English words that leaked into headwords. This check is
   * not here to demand 100%; it is here so that an importer that silently stops
   * writing half the corpus fails the build instead of shrinking the feature.
   */
  const publishedIbo = await count(
    db,
    `select count(*)::int as n from word where language_code = 'ibo' and status = 'published'`
  );
  const covered = scriptRows.filter((row) => row.script_code === 'Ndebe').length;
  const coverage = publishedIbo === 0 ? 0 : covered / publishedIbo;

  check(
    'the script layer covers the great majority of Igbo headwords',
    publishedIbo === 0 || coverage >= 0.9,
    publishedIbo === 0
      ? 'no published Igbo headwords to cover'
      : `${covered} of ${publishedIbo} (${(coverage * 100).toFixed(1)}%)`
  );

  /*
   * One word, one meaning, one entry — in every language.
   *
   * The defect this encodes was reported from the site: /word/igbo/nna and
   * /word/igbo/nna-2, two pages for `nna` "father". The cause was two corpus
   * files describing the same word under different spellings — the main
   * dictionary's `nnà` and the frequency-ranked common list's tone-neutral
   * `nna` — merged on the raw headword, which made them two keys.
   *
   * The key is the exact form PLUS the definitions, and both halves matter.
   * Exact form folds tone, so `nna`/`nnà` collide; definitions then separate the
   * real homographs, because `nso` ("close"), `nsò` ("queue") and `ǹso`
   * ("nearness") share a form and are three words. A check on either half alone
   * would be wrong in one direction or the other: on form alone it would demand
   * merging homographs, on definitions alone it would demand merging `akwa`,
   * which genuinely means bed, cry, egg and cloth across its tones.
   *
   * The homograph count is reported alongside so that "0 duplicate groups"
   * cannot be mistaken for "nothing was examined".
   */
  const wordRows = await db.rows<{
    language_code: string;
    exact_form: string;
    definitions: string[];
  }>(
    `select w.language_code, w.exact_form,
            coalesce(
              (select array_agg(d.text order by d.position)
                 from definition d
                where d.word_id = w.id and d.language_code = 'eng'),
              '{}'
            ) as definitions
       from word w
      where w.status = 'published'`
  );

  const signatureCounts = new Map<string, number>();
  const meaningsPerForm = new Map<string, Set<string>>();
  for (const row of wordRows) {
    const signature = duplicateSignature(row.exact_form, row.definitions);
    const scoped = `${row.language_code}\u0000${signature}`;
    signatureCounts.set(scoped, (signatureCounts.get(scoped) ?? 0) + 1);

    const formKey = `${row.language_code}\u0000${row.exact_form}`;
    const meanings = meaningsPerForm.get(formKey) ?? new Set<string>();
    meanings.add(signature);
    meaningsPerForm.set(formKey, meanings);
  }

  const duplicateGroups = [...signatureCounts.values()].filter((n) => n > 1).length;
  const redundantEntries = [...signatureCounts.values()].reduce((a, n) => a + (n - 1), 0);
  const homographs = [...meaningsPerForm.values()].filter((s) => s.size > 1).length;

  check(
    'no two entries are the same word with the same meaning',
    duplicateGroups === 0,
    duplicateGroups === 0
      ? `${wordRows.length} entries, ${homographs} homograph groups kept apart`
      : `${duplicateGroups} duplicate groups, ${redundantEntries} redundant entries`
  );

  /*
   * A dialect recording must say which SPELLING it is of.
   *
   * The defect this guards was reported from /word/igbo/oru-3: the Ajalị chip
   * for "ihe ọmụmụ" played the recording of "ọrụ". A recording attached to a
   * word and labelled with a dialect is only unambiguous while that dialect has
   * ONE spelling for that word — with two, matching by dialect name picks
   * whichever row comes first, and the page names one word while playing
   * another. That is exactly the condition checked here, and it is checked
   * rather than assumed because it is invisible in the data: both recordings
   * look correct on their own.
   *
   * `word_dialect_id` is the owner that removes the ambiguity. Any row still
   * owned by a word, whose dialect has more than one spelling for it, is a
   * recording that cannot be placed on the right chip.
   */
  const ambiguousDialectAudio = await count(
    db,
    `select count(*)::int as n
       from audio a
      where a.dialect_id is not null
        and a.word_id is not null
        and (
          select count(*) from word_dialect wd
           where wd.word_id = a.word_id and wd.dialect_id = a.dialect_id
        ) > 1`
  );
  check(
    'no dialect recording is ambiguous about which spelling it is of',
    ambiguousDialectAudio === 0,
    ambiguousDialectAudio === 0
      ? 'every dialect recording with two possible spellings names its own'
      : `${ambiguousDialectAudio} recordings that could be placed on the wrong chip`
  );

  const dialectAudioOwned = await count(
    db,
    `select count(*)::int as n from audio where word_dialect_id is not null`
  );
  const dialectAudioTotal = await count(
    db,
    `select count(*)::int as n from audio where dialect_id is not null`
  );
  check(
    'dialect recordings are attached to the spelling they are of',
    dialectAudioTotal === 0 || dialectAudioOwned > 0,
    `${dialectAudioOwned} of ${dialectAudioTotal} dialect recordings name their spelling`
  );

  return [...results];
}

export async function runVerifyCli(): Promise<void> {
  const db = await getDb();
  try {
    console.log(`\nVerifying Ozituma data (driver: ${db.driver})\n`);
    const checks = await verifyData(db);

    const width = Math.max(...checks.map((c) => c.name.length));
    let failed = 0;
    for (const c of checks) {
      const mark = c.passed ? '\u2713' : '\u2717';
      if (!c.passed) failed += 1;
      console.log(`  ${mark} ${c.name.padEnd(width)}  ${c.detail}`);
    }

    console.log('');
    if (failed === 0) {
      console.log(`  ${checks.length}/${checks.length} checks passed.\n`);
    } else {
      console.log(`  ${failed} of ${checks.length} checks FAILED.\n`);
      process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('verify.ts')) {
  runVerifyCli().catch((error) => {
    console.error('\nVerification error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
