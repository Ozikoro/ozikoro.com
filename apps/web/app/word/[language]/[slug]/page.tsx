import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { EntrySchema } from '@/components/entry-schema';
import { getDb } from '@ozituma/db/client';
import { getWord, relatedWords, searchWords } from '@ozituma/db/repository';
import {
  requireLanguage,
  getLanguage,
  languageCodeFromSlug,
  languageUrlSlug,
  isLegacyLanguageSlug,
} from '@ozituma/core';
import { SearchForm } from '@/components/dictionary';
import { VariantDisclosure } from '@/components/variants';
import { AudioButton } from '@/components/audio-button';
import { PronunciationRecorder } from '@/components/recorder';
import { getCurrentAccount } from '@/lib/session';
import { displayHeadword } from '@/lib/display';

export const dynamic = 'force-dynamic';

interface WordPageProps {
  params: Promise<{ language: string; slug: string }>;
  searchParams: Promise<{ recorded?: string; error?: string }>;
}

export async function generateMetadata({ params }: WordPageProps): Promise<Metadata> {
  const { language, slug } = await params;
  const db = await getDb();
  const word = await getWord(
    db,
    decodeURIComponent(slug),
    languageCodeFromSlug(language) ?? language
  );
  if (!word) return { title: 'Entry not found' };

  const gloss = word.glosses.slice(0, 3).join('; ');
  return {
    title: `${displayHeadword(word.headword)} — ${gloss || 'entry'}`,
    description: `${displayHeadword(word.headword)}${gloss ? `: ${gloss}` : ''}. ${
      getLanguage(languageCodeFromSlug(language) ?? language)?.name ?? language
    } dictionary entry on Ozituma.`,
  };
}

const RELATION_LABELS: Record<string, string> = {
  stem: 'Related root',
  synonym: 'Synonyms',
  antonym: 'Antonyms',
  hypernym: 'Broader terms',
  hyponym: 'Narrower terms',
  variant: 'Variants',
  derived: 'Derived from',
  related: 'Related',
  see_also: 'See also',
};

/**
 * The same relation types, read from the other end.
 *
 * Only the inverse of `stem` matters today, because it is the only type the
 * corpus stores — but writing it as a map rather than a special case keeps the
 * next importer that writes `synonym` or `derived` from silently mislabelling
 * them from this side.
 */
const INCOMING_RELATION_LABELS: Record<string, string> = {
  stem: 'Words built on this one',
  derived: 'Basis of',
};

/*
 * How many example sentences an entry page shows.
 *
 * The corpus attaches examples to the WORD, not to a sense — `example_word` has
 * no definition_id — so a well-attested entry can carry twenty of them, all
 * illustrating the headword rather than any one meaning. The reference design
 * shows one example under the sense it belongs to; we cannot place them that
 * precisely, so they follow the senses as a short quotation block instead.
 *
 * One WAS the default, because that is what the corpus usually has and what the
 * reference shows, with a second allowed only when the entry carried more than
 * one sense. The owner's instruction is the other way round, and it is the better
 * reading of what a page is for: two sentences show a word in two constructions,
 * which is the difference between an entry a learner can use and an entry that
 * merely has a line under it. Every entry with two or more examples now shows
 * two, whatever its sense count. Entries that have one still show one — the
 * corpus did not illustrate most words at all, and those are being filled in.
 *
 * Two is a hard ceiling either way. This is a reading view, not the corpus. The
 * API returns the full set for anyone who wants it — /api/v1/words/{id} is
 * unchanged.
 */
const MAX_EXAMPLES = 2;

/** How many chips one Related words group shows before it counts the rest. */
const MAX_RELATED_PER_GROUP = 24;

export default async function WordPage({ params, searchParams }: WordPageProps) {
  const [{ language, slug }, query] = await Promise.all([params, searchParams]);
  const db = await getDb();

  // A language is addressed by its slug. An ISO code in the path - /word/ibo/ulo -
  // is a legacy link, so it is redirected permanently rather than served under
  // two URLs, and never 404'd: the entry is right there.
  const code = languageCodeFromSlug(language);
  if (code === undefined) notFound();
  if (isLegacyLanguageSlug(language)) {
    permanentRedirect(`/word/${languageUrlSlug(code)}/${encodeURIComponent(slug)}`);
  }

  const word = await getWord(db, decodeURIComponent(slug), code);
  if (!word) notFound();

  // Only loaded when the entry exists, so a 404 does no extra work.
  const [currentAccount, dialectRows] = await Promise.all([
    getCurrentAccount(),
    db.rows<{ code: string; name: string }>(
      `select code, name from dialect where language_code = $1 and is_active order by name`,
      [language]
    ),
  ]);

  const recorded = query.recorded === '1';
  const audioError = query.error ?? null;
  const dialectOptions = dialectRows.map((row) => ({ code: row.code, name: row.name }));

  // Look the language up by its ISO code, not by the URL slug it was addressed
  // with. getLanguage keys on the code, so passing `igbo` returned undefined and
  // every fallback silently showed the raw slug — "igbo" rather than "Igbo".
  const languageDef = getLanguage(code);

  // Sibling entries that fold to the same search key. This is what makes
  // tone-blind lookup useful: searching "akwa" finds bed, cry, egg and cloth,
  // so each of those pages should surface the others.
  const siblings = (await searchWords(db, { query: word.exactForm, language, strict: true, perPage: 12 }))
    .data.filter((s) => s.id !== word.id);

  /*
   * Related words, in the order they should be read.
   *
   * Stored relations first, and both directions of them: `out` is what this entry
   * is built on, `in` is what is built on this entry. The corpus stores only one
   * direction (compound -> root), so reading the outgoing half alone — which is
   * what this page did — meant `nne`, with thirteen relations recorded, showed
   * nothing while `nne ukwu`, with one, showed `nne`.
   *
   * Then the derived ones, which exist because the stored relations cover only a
   * quarter of the vocabulary: compounds the corpus never linked, and entries
   * whose meanings overlap. Anything already listed is not repeated, and the
   * stored relation wins where the two agree, because a recorded fact beats a
   * derived one.
   */
  const relatedGroups: Array<{ label: string; items: Array<{ id: number; headword: string; slug: string }> }> = [];
  const listed = new Set<number>([word.id]);

  for (const direction of ['out', 'in'] as const) {
    for (const [type, relations] of Object.entries(
      word.related
        .filter((rel) => rel.direction === direction)
        .reduce<Record<string, typeof word.related>>((acc, rel) => {
          (acc[rel.relationType] ??= []).push(rel);
          return acc;
        }, {})
    )) {
      const items = relations.filter((rel) => !listed.has(rel.id));
      if (items.length === 0) continue;
      for (const rel of items) listed.add(rel.id);
      relatedGroups.push({
        // The same relation type reads differently from each end: "nne ukwu"
        // shows the root it is built on, "nne" shows the words built on it.
        label:
          direction === 'in'
            ? (INCOMING_RELATION_LABELS[type] ?? RELATION_LABELS[type] ?? type)
            : (RELATION_LABELS[type] ?? type),
        items,
      });
    }
  }

  const derived = await relatedWords(
    db,
    { id: word.id, language: code, headword: word.headword },
    word.definitions.map((definition) => definition.text)
  );
  for (const [via, label] of [
    ['compound', 'Words containing this one'],
    ['meaning', 'Similar meaning'],
  ] as const) {
    const items = derived.filter((rel) => rel.via === via && !listed.has(rel.id));
    if (items.length === 0) continue;
    for (const rel of items) listed.add(rel.id);
    relatedGroups.push({ label, items: items.slice(0, 12) });
  }

  // Spelling variants are the plain words this entry is also written as. They
  // are disclosed on request rather than listed, because on a well-attested
  // entry they are long enough to push the senses off the first screen.
  const variants = [...new Set(word.forms.map((form) => form.value))];

  /*
   * The dialect label, which the reference calls `entry.dialect`.
   *
   * Ozituma's model is the inverse of the reference's. Their entry is LABELLED
   * with the variety it belongs to ("General Igbo"); Ozituma's entry belongs to
   * the standard language and `word_dialect` records how OTHER varieties spell
   * it. So this names the varieties the entry is attested in, and falls back to
   * the language itself when there are none — which is the same fact the
   * reference's "General Igbo" is stating, reached from the other direction.
   */
  const dialectNames = [...new Set(word.dialects.map((d) => d.name))];

  /*
   * The Dialect line carries the full list, because it is body text and a
   * complete answer is worth the wrap: an entry can be attested in nine
   * varieties (chọfè is), and naming all nine is the honest answer.
   *
   * There is deliberately NO fallback to the language. This briefly read
   * "Dialect: Igbo" for every entry with no dialect form recorded, which stated
   * something false — Igbo is the language, not a dialect of it, and the 45
   * varieties in the seed (Abịrịba, Ọka, Ẹkpẹyẹ …) are its dialects. An entry
   * with no dialect form now shows no dialect material at all, which is the
   * honest reading of "none recorded".
   */
  const dialectLabel = dialectNames.join(', ');

  /*
   * The badge is a LABEL, and the reference keeps its label short: "General
   * Igbo". Naming nine varieties there would turn a filing label into a
   * paragraph and break the header, so past two it states the count instead.
   * Nothing is lost — every variety is named in the Dialect line and, where
   * the spelling differs from the headword, on the chip itself.
   */
  const dialectBadge =
    dialectNames.length <= 2
      ? dialectNames.join(', ')
      : `${dialectNames.length} varieties`;

  /*
   * Dialect spellings that say something a chip can carry. A variety whose
   * spelling is identical to the headword adds nothing — the variety is already
   * named in the dialect line above — so it is not repeated as a chip.
   */
  /*
   * Dialect forms, INCLUDING the ones spelled exactly like the headword.
   *
   * Filtering those out looked tidy and read as a bug: the owner opened /ike and
   * saw "Dialect: Ẹkpẹyẹ" with nothing under it, and reasonably concluded the
   * Ekpeye word was missing. It is not — Ẹkpẹyẹ has `ike` for "power, strength",
   * spelled the same as the Igbo — but a page that names a variety and then shows
   * no form for it cannot be told apart from one that lost the form.
   *
   * 2,208 dialect rows across the corpus carry the headword's own spelling, and
   * for most of them it is a real cognate rather than a mistake: Igbo and Ẹkpẹyẹ
   * share a great deal of vocabulary. They are shown now, marked as identical, so
   * "same word in that variety" is stated rather than implied by silence.
   */
  const dialectSpellings = word.dialects;

  /*
   * Two examples wherever the entry has them.
   *
   * The rule used to be one example, and two only when the word carried more
   * than one sense — on the reasoning that a second sentence was there to
   * account for a second meaning. The owner's instruction is the other way
   * round: every page should show at least two, because one sentence shows a
   * word in one construction and two show it doing two different things. So the
   * floor is now two, and the cap is still two, which makes the number of
   * sentences on the page a property of the entry rather than of its sense
   * count.
   */
  const examples = word.examples.slice(0, MAX_EXAMPLES);

  /*
   * The recording beside the headword is the headword's OWN, and nothing else
   * may stand in that place.
   *
   * This line used to be `const [primaryAudio, ...otherAudio] = word.audio`,
   * which assumes the first clip belongs to the word. That is only true while
   * the word owns one, and on /word/igbo/ike it did not: the entry's own
   * recording had been removed, the six clips that remained all belonged to
   * dialect spellings, and the first of them — Ọnịcha's recording of "ume" —
   * was rendered under "Voice recording" beside the headword "ike". The page
   * named one word and played another, which is the single worst thing a
   * dictionary page can do.
   *
   * So the choice is made on what the clip IS, never on where it sits in the
   * array. A word with no recording of its own shows no Voice recording block
   * at all, and its dialect recordings stay on their chips — where they say
   * which variety they are and which spelling they are of.
   */
  const headwordAudio = word.audio.filter((clip) => clip.isHeadword);
  const [primaryAudio, ...extraHeadwordAudio] = headwordAudio;
  const dialectAudio = word.audio.filter((clip) => !clip.isHeadword);

  /*
   * Everything that has no chip of its own, listed rather than dropped.
   *
   * Two kinds end up here. A dialect recording whose variety has no spelling row
   * on this entry — the entry page has nothing to hang it on, but it is still a
   * recording of this word in a named variety. And a SECOND recording of the
   * headword itself, which is what a contributor's upload alongside the corpus
   * recording looks like; it must not displace the first, and it must not vanish.
   */
  const dialectFormNames = new Set(word.dialects.map((d) => d.name));
  const listedAudio = [
    ...extraHeadwordAudio,
    ...dialectAudio.filter((clip) => !clip.dialect || !dialectFormNames.has(clip.dialect)),
  ];

  /*
   * What the edit form offers, which is what the page shows plus one empty pair.
   *
   * `word.examples` is the whole set the entry holds; the page displays the first two and this form
   * must not offer more than a reader can see. The empty pair at the end is how a new example is
   * added, and it carries no id, which is what tells the apply step to insert rather than update.
   */
  const examinedExamples: Array<{ id: number | null; text: string; translation: string | null }> = [
    ...examples.map((example) => ({
      id: example.id ?? null,
      text: example.text,
      translation: example.translation ?? null,
    })),
    { id: null, text: '', translation: null },
  ];
  const hiddenExamples = Math.max(0, word.examples.length - examples.length);

  /** The headword in Ndebe, when it has one. */
  const ndebe = word.scripts.find((s) => s.code === 'Ndebe')?.value ?? null;

  return (
    /*
     * .wrap AND .wrap-narrow, like every other page in the app.
     *
     * .wrap-narrow only overrides max-width — it carries no centring and no
     * horizontal padding of its own. Used alone it produced a 46rem column
     * pinned to the left edge of the viewport with the text flush against it
     * and a dead gap down the right, which is what "scattered" was.
     */
    <div className="wrap wrap-narrow">
      {/*
        THE DICTIONARY'S OWN STRUCTURED DATA.

        `DefinedTerm` in a `DefinedTermSet` — schema.org's types for exactly this. **The Ozikoro archive emits
        `Article` and this emits `DefinedTerm`, because an entry is not an article and the two sites should
        share a vocabulary without pretending to be the same kind of thing.**

        No JSON-LD existed anywhere in this app before this. A dictionary with 12,000 entries was telling a
        search engine only its title and description.
      */}
      <EntrySchema
        entry={{
          headword: displayHeadword(word.headword),
          languageName:
            getLanguage(languageCodeFromSlug(language) ?? language)?.name ?? language,
          languageSlug: language,
          url: `https://ozituma.com/word/${language}/${encodeURIComponent(slug)}/`,
          glosses: word.glosses,
          partOfSpeech: word.partOfSpeech ?? null,
          audioUrl: null,
        }}
      />
      {/*
        The reference opens an entry with a link back to the dictionary index,
        above the headword and its rule. Ozituma keeps its search form too,
        because the index is where a search begins and this page is where a
        reader arrives from one.
      */}
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/" style={{ fontSize: '0.875rem', color: 'var(--clay)' }}>
          ← Dictionary
        </Link>
      </p>

      <div style={{ marginBottom: '1.5rem', maxWidth: '42rem' }}>
        {/* The ISO code, not the URL slug: the form posts this back to the
            landing page, which looks the language up by code. */}
        <SearchForm language={code} />
      </div>

      <article>
        {/* Row one: the headword on the left, the meanings beside it. */}
        <div className="entry-columns">
        <header className="entry-header">
          <div className="entry-title-row">
            <h1 className="entry-title">{displayHeadword(word.headword)}</h1>
            {word.partOfSpeech ? <span className="entry-pos">{word.partOfSpeech}</span> : null}
          </div>

          <div className="entry-meta">
            {word.pronunciation ? <span className="mono">{word.pronunciation}</span> : null}
            <span>{languageDef?.name ?? language}</span>
            {word.isCommon && word.frequencyRank !== null ? (
              <span>frequency rank #{word.frequencyRank + 1}</span>
            ) : null}
            {word.exactForm !== word.headword ? (
              <span>tone-neutral spelling: {displayHeadword(word.exactForm)}</span>
            ) : null}
          </div>

          {/*
            The badge carries the same value as the Dialect line further down,
            which is what the reference does: it renders `entry.dialect` in both
            places. Here that is the varieties the entry is attested in, or the
            language itself when it is only recorded in the standard one.
          */}
          {dialectNames.length > 0 ? (
            <p className="dialect-badge">{dialectBadge}</p>
          ) : null}

          {/*
            The headword in Ndebe, the syllabary for Igbo.

            Read from word_script rather than transliterated here, so that a
            correction to a particular spelling has somewhere to live — the
            mechanical result is a starting point, and the script's own author
            has open questions about parts of it (see docs/DATA-SOURCES.md).
            A word that cannot be written has no row and simply shows nothing,
            which is the honest outcome: 163 of 8,822 headwords are in that
            position, mostly because they are not Igbo words to begin with.
          */}
          {ndebe ? (
            <>
              <p className="voice-label">Ndebe script</p>
              <p className="script-sign" lang="und-Ndebe">
                {ndebe}
              </p>
            </>
          ) : null}

          {primaryAudio ? (
            <>
              <p className="voice-label">Voice recording</p>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>
                <AudioButton
                  src={primaryAudio.url}
                  label={`Play the recording of ${word.headword}`}
                />
                {primaryAudio.speaker ? `recorded by ${primaryAudio.speaker}` : 'play'}
              </p>
              {primaryAudio.dialect ? (
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
                  {primaryAudio.dialect} dialect
                </p>
              ) : null}
            </>
          ) : null}
        </header>

        <div className="entry-body">
        {/* The owner asked for "Meanings" plain: the examples below belong to the
            entry, not to the heading, and the heading was claiming them. */}
        <section className="entry-section" aria-label="Meanings">
          <h2>Meanings</h2>
          {word.definitions.length > 0 ? (
            <ol className="sense-list">
              {word.definitions.map((definition, index) => (
                <li className="sense" key={`${definition.text}-${index}`}>
                  <span className="sense-number" aria-hidden="true">
                    {index + 1}.
                  </span>
                  <div className="sense-body">
                    <p className="sense-gloss">{definition.text}</p>
                    {/*
                      A sense labelled with a dialect is marked as such. An entry
                      can carry senses from several varieties — Igbo "gba" has
                      nine Ekpeye ones among its thirty-two — and without the
                      label they would read as standard Igbo.
                    */}
                    {definition.label ? (
                      <span className="chip chip-dialect sense-label">{definition.label}</span>
                    ) : null}
                    {definition.partOfSpeech ? (
                      <span className="muted sense-label" style={{ fontSize: '0.86rem' }}>
                        {definition.partOfSpeech.name}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
          </ol>
          ) : (
            <p className="muted">
              No definition recorded yet. This entry is a cross-reference in the source corpus.
            </p>
          )}
        </section>
        </div>
        </div>

        {/*
          Row two, under both columns: the dialect material on the left, where
          the word column is, and the example sentences on the right, where the
          meanings are.

          The dialect forms are chips rather than a table, each attributed to the
          variety it was recorded in, and each carrying its own recording as a
          play button the size of the text beside it.
        */}
        <div className="entry-columns entry-columns-lower">
          <section className="entry-section" aria-label="Dialect and variants">
            <h2>Dialect &amp; variants</h2>

            {dialectNames.length > 0 ? (
              <p className="dialect-line">
                Dialect: <strong>{dialectLabel}</strong>
              </p>
            ) : null}

            {dialectSpellings.length > 0 ? (
              <ul className="variant-chips dialect-chips">
                {dialectSpellings.map((form) => {
                  /*
                   * The recording is matched on the SPELLING it is of, not on the
                   * dialect's name.
                   *
                   * Matching by name was wrong as soon as a dialect has two
                   * spellings for one word: Ajalị records both "ọrụ" and "ihe
                   * ọmụmụ", and `find` by name returned whichever came first, so
                   * the chip for "ihe ọmụmụ" played the recording of "ọrụ". The
                   * page named one word and played another.
                   *
                   * A form with no recording of its own now shows no button,
                   * which is the honest outcome — better than a button that
                   * plays a different word.
                   *
                   * Every chip the recording belongs to gets it, not just the
                   * first one. The corpus records a spelling once and names the
                   * varieties that share it: `ike`'s entry gives one recording of
                   * "ume" and says it is Ọnịcha and Ezaa. `find` returned a single
                   * clip, so whichever chip came first in the list played it — on
                   * /ike that was Ezaa, and the Ọnịcha chip for the very spelling
                   * the recording is of had no button at all. Two varieties, one
                   * recording, both chips playable.
                   */
                  const clips = word.audio.filter(
                    (a) => a.dialectSpelling === form.spelling
                  );
                  const [firstClip] = clips;
                  return (
                    <li className="variant-chip dialect-form" key={form.code}>
                      {firstClip ? (
                        <AudioButton
                          src={firstClip.url}
                          label={`Play ${form.spelling}, ${form.name} dialect`}
                        />
                      ) : null}
                      {form.spelling} <span className="variant-chip-note">{form.name}</span>
                      {clips.length > 1 ? (
                        <span className="variant-chip-note">
                          {' '}
                          &middot; {clips.length} recordings
                        </span>
                      ) : null}
                      {form.spelling === word.headword ? (
                        <span className="variant-chip-note"> — same spelling as the Izugbe</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {variants.length > 0 ? (
              <VariantDisclosure variants={variants} />
            ) : (
              /*
                The fallback is on variants alone, as in the reference. Keying it
                on "no dialect forms either" meant an entry with dialect forms and
                no variants showed neither the disclosure nor the sentence.
              */
              <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                No other variants have been documented for this word.
              </p>
            )}

            {/*
              Recordings with no chip of their own: a further recording of the
              headword, or a dialect recording whose variety has no spelling row
              here. A button each, not a transport bar.

              The label names what the recording actually is. It used to read
              "Play the recording of <headword>" for every clip in this list,
              which is false for a dialect recording of a different spelling —
              the button then claimed to be the headword while playing another
              word's pronunciation, which is the same lie the headword position
              was telling on /word/igbo/ike.
            */}
            {listedAudio.length > 0 ? (
              <ul className="variant-chips dialect-chips">
                {listedAudio.map((clip, index) => (
                  <li className="variant-chip dialect-form" key={index}>
                    <AudioButton
                      src={clip.url}
                      label={
                        clip.dialectSpelling
                          ? `Play ${clip.dialectSpelling}${
                              clip.dialect ? `, ${clip.dialect} dialect` : ''
                            }`
                          : `Play another recording of ${word.headword}`
                      }
                    />
                    <span className="variant-chip-note">
                      {clip.isHeadword
                        ? 'another recording'
                        : (clip.dialect ?? 'dialect not specified')}
                    </span>
                    {clip.dialectSpelling ? (
                      <span className="variant-chip-note">
                        {' '}
                        &middot; {clip.dialectSpelling}
                      </span>
                    ) : null}
                    {clip.speaker ? (
                      <span className="variant-chip-note"> &middot; {clip.speaker}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="entry-section" aria-label="Examples">
            <h2>Examples</h2>
            {examples.length > 0 ? (
              <>
                {examples.map((example, index) => (
                  <blockquote className="sense-quote" key={index}>
                    <p className="sense-quote-text">{example.text}</p>
                    {example.translation ? (
                      <p className="sense-quote-translation">&mdash; {example.translation}</p>
                    ) : null}
                  </blockquote>
                ))}
              </>
            ) : (
              <p className="muted" style={{ fontSize: '0.9rem' }}>
                No example sentences have been recorded for this word.
              </p>
            )}
          </section>
        </div>

        {/*
          Always rendered. The name dictionary shows related names on every page,
          and the same expectation applies here: a reader who has just read one
          entry should always be offered the next. When nothing is known the
          section says so, the way the Examples section does, rather than
          disappearing — an absent heading reads as a missing feature.
        */}
        <section className="entry-section" aria-label="Related words">
          <p className="entry-label">Related words</p>
          {relatedGroups.length > 0 ? (
            relatedGroups.map((group, index) => {
              /*
               * `aka` is the root of more than forty entries, and a wall of chips
               * buries the rest of the page. The tail is cut and counted rather
               * than dropped: the fact stays visible, only shorter.
               */
              const shown = group.items.slice(0, MAX_RELATED_PER_GROUP);
              return (
                <div key={group.label}>
                  <p
                    className="muted"
                    style={{
                      fontSize: '0.82rem',
                      margin: index === 0 ? '0.9rem 0 0.4rem' : '0 0 0.4rem',
                    }}
                  >
                    {group.label}
                  </p>
                  <ul className="relation-chips">
                    {shown.map((rel) => (
                      <li key={rel.id}>
                        <Link
                          className="relation-chip"
                          href={`/word/${language}/${encodeURIComponent(rel.slug)}`}
                        >
                          {displayHeadword(rel.headword)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {group.items.length > shown.length ? (
                    <p className="muted" style={{ fontSize: '0.82rem', margin: '0.3rem 0 0' }}>
                      …and {group.items.length - shown.length} more in this list.
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              This entry stands on its own for now. Related words come from how the
              dictionary links entries to each other — a word built on this one, a word this
              one is built on, or a word that shares its meaning — and nothing here has
              enough of that yet to show.
            </p>
          )}
        </section>

        {/*
          Editing the entry, for anyone signed in.

          The owner's rule, extended from proverbs: "on the name page, i need you to make it
          editable for contributors and users... also, the same in the dictionary section. editors
          should be able to edit, and submit to admin for approval." So this is a proposal, not an
          edit — an editor reads it, and only an approval changes the entry. The previous wording
          is recorded on the way through, so nothing a source printed is lost.
        */}
        <div className="section" style={{ marginTop: '2.5rem' }}>
          <h2>Propose an edit</h2>
          {currentAccount ? (
            <>
              <p className="muted" style={{ fontSize: '0.9rem' }}>
                Submitting as{' '}
                <strong>
                  {currentAccount.account.displayName ?? currentAccount.account.email}
                </strong>
                . An editor reads every proposal before it is published.
              </p>
              <form
                action="/api/contributions"
                method="post"
                style={{ display: 'grid', gap: '0.6rem', maxWidth: '42rem' }}
              >
                <input type="hidden" name="kind" value="word_edit" />
                <input type="hidden" name="language" value={code} />
                <input type="hidden" name="wordId" value={word.id} />
                <input type="hidden" name="previousHeadword" value={word.headword} />
                <input
                  type="hidden"
                  name="previousMeanings"
                  value={word.definitions.map((d) => d.text).join('\n')}
                />
                <label htmlFor="edit-headword" style={{ fontSize: '0.85rem' }}>
                  The headword
                </label>
                <input
                  id="edit-headword"
                  name="headword"
                  className="search-input"
                  defaultValue={word.headword}
                  maxLength={120}
                />
                <label htmlFor="edit-meanings" style={{ fontSize: '0.85rem' }}>
                  The meanings, one to a line, in the order they should be read
                </label>
                <textarea
                  id="edit-meanings"
                  name="meanings"
                  className="search-input"
                  rows={Math.max(3, word.definitions.length + 1)}
                  defaultValue={word.definitions.map((d) => d.text).join('\n')}
                  maxLength={4000}
                />
                <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                  One meaning per line. Adding, removing or reordering a line adds, removes or
                  reorders the senses on the entry.
                </p>
                {/*
                  The examples, one pair of boxes each. Two per entry is what the page shows, and
                  the owner asked for them to be editable: "a contributor and user should be able to
                  edit everything, including the examples, dialect, meanings".
                */}
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', fontWeight: 600 }}>
                  Examples
                </p>
                {/*
                  Only the examples the page SHOWS — `examples`, the two that are displayed, not
                  `word.examples`, the whole set. The owner found this: "it showed even edit of
                  examples that was not showing live on the page... do show only the visible ones to
                  edit, not the invisible ones." A form that lists what the reader cannot see is
                  asking them to edit blind.

                  Each row carries the id of the example it is, so an edit rewrites that sentence and
                  touches nothing else.
                */}
                {examinedExamples.map((example, index) => (
                  <div key={example.id ?? `new-${index}`} style={{ display: 'grid', gap: '0.35rem' }}>
                    <input type="hidden" name="exampleId" value={example.id ?? ''} />
                    <input type="hidden" name="previousExampleId" value={example.id ?? ''} />
                    <input type="hidden" name="previousExampleText" value={example.text} />
                    <input
                      type="hidden"
                      name="previousExampleTranslation"
                      value={example.translation ?? ''}
                    />
                    <input
                      name="exampleText"
                      className="search-input"
                      defaultValue={example.text}
                      maxLength={600}
                      aria-label={`Example ${index + 1} in Igbo`}
                      placeholder={`Example ${index + 1} in Igbo`}
                    />
                    <input
                      name="exampleTranslation"
                      className="search-input"
                      defaultValue={example.translation ?? ''}
                      maxLength={600}
                      aria-label={`Example ${index + 1} in English`}
                      placeholder={`Example ${index + 1} in English (optional)`}
                    />
                  </div>
                ))}
                <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                  {hiddenExamples > 0
                    ? `This entry holds ${hiddenExamples} further example${hiddenExamples === 1 ? '' : 's'} that the page does not show, so they are not offered here. Clear a sentence to drop it, or fill an empty pair to add one.`
                    : 'Clear a sentence to drop it, or fill an empty pair to add one.'}
                </p>

                {/*
                  The dialect spellings, one row per variety the entry is recorded in. The dialect
                  code travels in a hidden field so the label and the value cannot drift.
                */}
                {word.dialects.length > 0 ? (
                  <>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', fontWeight: 600 }}>
                      Dialect spellings
                    </p>
                    {word.dialects.map((form) => (
                      <div key={form.code} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <input type="hidden" name="previousDialectCode" value={form.code} />
                        <input type="hidden" name="previousDialectSpelling" value={form.spelling} />
                        <input type="hidden" name="dialectCode" value={form.code} />
                        <span className="muted" style={{ fontSize: '0.85rem', minWidth: '7.5rem' }}>
                          {form.name}
                        </span>
                        <input
                          name="dialectSpelling"
                          className="search-input"
                          defaultValue={form.spelling}
                          maxLength={120}
                          aria-label={`${form.name} spelling`}
                        />
                      </div>
                    ))}
                  </>
                ) : null}

                <label htmlFor="edit-word-note" style={{ fontSize: '0.85rem' }}>
                  Why (optional)
                </label>
                <input
                  id="edit-word-note"
                  name="note"
                  className="search-input"
                  maxLength={1000}
                  placeholder="What is wrong with it as it stands?"
                />
                <div>
                  <button className="button" type="submit">
                    Propose this edit
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p>
              <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to
              propose an edit. An editor reads every proposal before anything changes.
            </p>
          )}
        </div>

        <div className="section" style={{ marginTop: '2.5rem' }}>
          <h2>{word.audio.length > 0 ? 'Add another pronunciation' : 'Add a pronunciation'}</h2>

          {recorded ? (
            <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
              <strong>Thank you — your recording was submitted for review.</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                An editor will listen to it before it appears here. Recordings are never published
                without review.
              </p>
            </div>
          ) : null}

          {audioError ? (
            <div className="notice notice-warn" role="alert" style={{ marginBottom: '1rem' }}>
              {audioError}
            </div>
          ) : null}

          {currentAccount ? (
            <>
              <p className="muted" style={{ fontSize: '0.9rem' }}>
                Submitting as{' '}
                <strong>
                  {currentAccount.account.displayName ?? currentAccount.account.email}
                </strong>
                , and your name will be shown as the speaker of this recording.
              </p>
              <PronunciationRecorder
                wordId={word.id}
                language={language}
                dialects={dialectOptions}
              />
            </>
          ) : (
            <p>
              <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to
              record a pronunciation. Recordings are reviewed by an editor before they are published
              — and a recording is credited to the person who made it.
            </p>
          )}
        </div>

        {siblings.length > 0 ? (
          <div className="section">
            <h2>Same spelling, different tones</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              These entries fold to the same letters once tone is removed, so a tone-blind search
              returns all of them.
            </p>
            <ul className="result-list">
              {siblings.map((sibling) => (
                <li key={sibling.id}>
                  <Link
                    className="result"
                    href={`/word/${languageUrlSlug(sibling.language)}/${encodeURIComponent(sibling.slug)}`}
                  >
                    <span className="result-head">
                      <span className="result-headword">
                        {displayHeadword(sibling.headword)}
                      </span>
                    </span>
                    <span className="result-gloss">{sibling.glosses.join('; ')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          No Source & licence block, and nothing about the entry's provenance
          anywhere on a public page.

          The owner asked for it off the entry, and then for the same material off
          the about page: a reader came for the word, and a record of where the
          word was obtained reads like part of its description.

          The record itself is untouched and still travels with the data — every
          row keeps its source_id, and the API returns an attribution object on
          every response, which is what keeps properly credited corpora credited.
          It is simply not displayed to a reader who did not ask for it.
        */}
      </article>
    </div>
  );
}
