import Link from 'next/link';
import { Fragment } from 'react';
import { getDb } from '@ozituma/db/client';
import { readSettings } from '@ozituma/db/settings';
import {
  getDictionaryStats,
  listLanguages,
  searchWords,
  wordOfTheDay,
} from '@ozituma/db/repository';
import { languageCodeFromSlug, languageUrlSlug } from '@ozituma/core';
import { Pagination, ResultList, SearchForm } from '@/components/dictionary';

export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

interface HomeProps {
  searchParams: Promise<{ q?: string; page?: string; language?: string }>;
}

export default async function HomePage({ searchParams }: HomeProps) {
  const params = await searchParams;
  const db = await getDb();

  const query = (params.q ?? '').trim();

  /*
   * The language arrives as a URL slug ("igbo"), not as an ISO code ("ibo").
   *
   * Every search form in the app posts back to this page, and the one on a word
   * page carries the language it was searching in — as a slug, because that is
   * what the URL uses. This used the parameter raw, so a search submitted from
   * an entry page asked for `where language_code = 'igbo'`, matched nothing, and
   * reported no results; the same search from the landing page worked, because
   * that form omits the parameter entirely and this line fell back to 'ibo'.
   *
   * Normalising here rather than only at the form means any inbound link with a
   * slug or a code resolves, which is the same promise the /word route already
   * makes for its own paths.
   */
  const language = languageCodeFromSlug((params.language ?? '').trim()) ?? 'ibo';
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const isSearching = query.length > 0;

  const [result, stats, languages] = await Promise.all([
    isSearching
      ? searchWords(db, { query, language, page, perPage: PER_PAGE })
      : Promise.resolve(null),
    getDictionaryStats(db),
    listLanguages(db),
  ]);

  // The word of the day is only worth the round trip on the landing page.
  const daily = isSearching ? null : await wordOfTheDay(db, language);
  const settings = await readSettings(db);

  const populated = languages.filter((l) => l.wordCount > 0);
  const upcoming = languages.filter((l) => l.wordCount === 0);

  /*
   * The home page, arranged by the admin.
   *
   * The owner: "let the admin be able to edit and change any colour or any design from the
   * website, even if it means drag and drop to make it easy like wordpress does." Colours were
   * one half of that; this is the other. Each section of the front page is a block with a name,
   * the admin drags them into order at /admin/layout, and a block switched off renders nothing.
   *
   * The search results are deliberately not a block. They are not part of the page's arrangement —
   * they are the answer to a question the reader asked, and they appear where the reader is
   * regardless of how the front page is set out.
   */
  const blocks: Record<string, React.ReactNode> = {
    hero: !isSearching ? (
      <section className="hero">
          <h1>A dictionary for African languages.</h1>
          <p className="hero-lede">
            Ozituma documents words, meanings, dialect variants and pronunciation — starting with
            Igbo, built to extend to Yoruba, Edo, Efik, Ibibio, Hausa and beyond. Every word is here
            for anyone to read, and the whole dictionary is served through a free API.
          </p>

          <div style={{ marginTop: '1.5rem', maxWidth: '42rem' }}>
            <SearchForm autoFocus />
          </div>

          <ul className="hero-stats">
            <li>
              <strong>{stats.words.toLocaleString()}</strong>
              <span>headwords</span>
            </li>
            <li>
              <strong>{stats.definitions.toLocaleString()}</strong>
              <span>definitions</span>
            </li>
            <li>
              <strong>{stats.examples.toLocaleString()}</strong>
              <span>example sentences</span>
            </li>
            <li>
              <strong>{stats.dialects}</strong>
              <span>dialects mapped</span>
            </li>
            <li>
              <strong>{stats.languages}</strong>
              <span>languages registered</span>
            </li>
          </ul>
        </section>
    ) : null,
    wordOfTheDay: !isSearching && daily ? (
      <section style={{ marginBottom: '2.5rem' }}>
          <h2>Word of the day</h2>
          <div className="card">
            <div className="result-head">
              <Link
                className="result-headword"
                href={`/word/${languageUrlSlug(daily.language)}/${encodeURIComponent(daily.slug)}`}
              >
                {daily.headword}
              </Link>
              {daily.partOfSpeech ? <span className="chip chip-pos">{daily.partOfSpeech}</span> : null}
            </div>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-soft)' }}>
              {daily.glosses.join('; ') || 'No definition recorded yet.'}
            </p>
            {daily.examples[0] ? (
              <div className="example" style={{ marginTop: '0.9rem' }}>
                <div className="example-igbo">{daily.examples[0].text}</div>
                {daily.examples[0].translation ? (
                  <div className="example-en">{daily.examples[0].translation}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
    ) : null,
    languages: !isSearching ? (
      <section>
          <h2>Languages</h2>
          <p className="muted" style={{ fontSize: '0.92rem' }}>
            We publish an honest word count for every language, so you can see what is usable today
            and what is still being prepared.
          </p>
          <div className="grid">
            {populated.map((language) => (
              <Link key={language.code} className="card" href={`/?language=${language.urlSlug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3>{language.name}</h3>
                <p className="card-meta" style={{ margin: 0 }}>
                  {language.nativeName}
                  <br />
                  {language.wordCount.toLocaleString()} words · {language.dialectCount} dialects
                </p>
              </Link>
            ))}
            {upcoming.slice(0, 8).map((language) => (
              <div key={language.code} className="card" style={{ opacity: 0.62 }}>
                <h3>{language.name}</h3>
                <p className="card-meta" style={{ margin: 0 }}>
                  {language.nativeName}
                  <br />
                  Being prepared
                </p>
              </div>
            ))}
          </div>
          {upcoming.length > 8 ? (
            <p style={{ marginTop: '1rem' }}>
              <Link href="/languages">See all {languages.length} languages →</Link>
            </p>
          ) : null}
        </section>
    ) : null,
    contribute: !isSearching ? (
      <section style={{ marginBottom: '2.5rem' }}>
        <h2>Add to the dictionary</h2>
        <p className="muted" style={{ fontSize: '0.92rem', maxWidth: '42rem' }}>
          Every entry here came from somebody who knew the word. If a word of yours is missing, or a
          meaning is wrong, that is worth more than a report — it is the entry.
        </p>
        <p style={{ marginTop: '0.9rem' }}>
          <Link className="button" href="/contribute">Contribute a word</Link>{' '}
          <Link className="button button-secondary" href="/developers">Use the API</Link>
        </p>
      </section>
    ) : null,
  };

  return (
    <div className="wrap">
      {isSearching && result ? (
        <section>
          <div style={{ marginBottom: '1.5rem', maxWidth: '42rem' }}>
            <SearchForm query={query} language={language} />
          </div>

          <h2 style={{ marginBottom: '0.35rem' }}>
            {result.total.toLocaleString()} result{result.total === 1 ? '' : 's'} for “{query}”
          </h2>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Searched headwords, alternate and dialect spellings, and English definitions.
            {result.diagnostics.trigram
              ? ' Typo-tolerant matching is active.'
              : ' Typo-tolerant matching is unavailable here; exact and prefix matching are used.'}
          </p>

          {result.data.length > 0 ? (
            <ResultList results={result.data} />
          ) : (
            <div className="notice notice-warn">
              <strong>No entry matched “{query}”.</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                The dictionary is growing. You can{' '}
                <Link href="/developers">use the API</Link> to check for near matches, or help by
                contributing this word once accounts open.
              </p>
            </div>
          )}

          {result.total > PER_PAGE ? (
            <Pagination
              page={result.page}
              perPage={result.perPage}
              total={result.total}
              hasMore={result.hasMore}
              buildHref={(p) =>
                `/?q=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}&page=${p}`
              }
            />
          ) : null}
        </section>
      ) : null}
      {settings['home.blocks'].map((id) => (
        <Fragment key={id}>{blocks[id] ?? null}</Fragment>
      ))}
    </div>
  );
}

