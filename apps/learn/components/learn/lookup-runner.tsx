'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Dictionary lookup, on the learning app.
 *
 * WHY THERE IS A SEARCH BOX HERE AT ALL
 *
 * §4 puts "Dictionary (Igbo to English, English to Igbo) with diacritic-insensitive search" in v1.0,
 * and §6.2 says the courses share the dictionary's lexicon. A learner reading a lesson — or mid-way
 * through a practice set — meets a word and wants to look it up without leaving. Sending them to
 * another origin and back loses their place.
 *
 * It queries the dictionary's own search rather than reimplementing one, so results rank, fold and
 * fuzzy-match identically on both sites.
 *
 * TYPING DOES NOT SEARCH ON EVERY KEYSTROKE WITHOUT BOUND
 *
 * A debounce, because an Igbo word is typed a character at a time and each character would otherwise
 * be a database round trip — and the app is aimed at mid-range phones on slow connections (§13),
 * where that is the difference between a search box that feels instant and one that feels broken.
 */

interface LookupResult {
  id: number;
  headword: string;
  slug: string;
  glosses: string[];
  partOfSpeech: string | null;
  isCommon: boolean;
  isVerified: boolean;
  matchType: string;
  audioUrl: string | null;
}

/** Why a result matched, in words. Only shown when it is not a plain headword hit. */
function matchNote(matchType: string): string | null {
  switch (matchType) {
    case 'headword':
    case 'exact':
      return null;
    case 'variant':
      return 'matched a spelling variant';
    case 'dialect':
      return 'matched a dialect form';
    case 'definition':
      return 'matched the meaning';
    case 'fuzzy':
      return 'close spelling';
    default:
      return matchType ? `matched on ${matchType}` : null;
  }
}

export function LookupRunner({
  dictionaryUrl,
  initialQuery = '',
}: {
  dictionaryUrl: string;
  /** Pre-filled from the URL, so a search can be linked to and shared. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<LookupResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The debounce timer and the newest request, so an earlier slow response cannot overwrite a later
  // fast one — the classic stale-search bug, where results for "kw" land after results for "akwa".
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    const trimmed = query.trim();
    if (trimmed === '') {
      // An empty box clears rather than browsing. `searchWords` would return common words for an
      // empty query, which is right for a browse page and wrong here: clearing the box should
      // empty the list, not silently load a different one.
      setResults([]);
      setTotal(0);
      setSearched(false);
      setError(null);
      return;
    }

    setLoading(true);
    timer.current = setTimeout(() => {
      const ticket = latest.current + 1;
      latest.current = ticket;

      fetch(`/api/learn/lookup?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' })
        .then(async (response) => {
          const body = await response.json();
          // Discarded if a newer search has started. Without this check the list can end up
          // showing results for something the learner has already typed past.
          if (ticket !== latest.current) return;
          if (!response.ok) {
            setError(body?.error?.message ?? 'The lookup failed. Try again.');
            setResults([]);
            setTotal(0);
            return;
          }
          setError(null);
          setResults(body.results ?? []);
          setTotal(body.total ?? 0);
          setSearched(true);
        })
        .catch(() => {
          if (ticket !== latest.current) return;
          setError('Network error. Check your connection.');
          setResults([]);
        })
        .finally(() => {
          if (ticket === latest.current) setLoading(false);
        });
    }, 220);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div>
      <form
        className="learn-recall"
        onSubmit={(event) => {
          event.preventDefault();
        }}
        role="search"
      >
        <label className="learn-recall-label" htmlFor="lookup-input">
          Igbo or English
        </label>
        <input
          id="lookup-input"
          className="learn-recall-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. akwa — tone marks optional"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // An Igbo keyboard is not required to search, which is the whole point of the folding.
          lang="ig"
        />
        {loading ? <span className="muted" style={{ fontSize: '0.84rem' }}>Searching…</span> : null}
      </form>

      {error ? (
        <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      ) : null}

      {searched && results.length === 0 && !loading && !error ? (
        <div className="notice" style={{ marginTop: '1rem' }}>
          <strong>Nothing matched “{query.trim()}”.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            The dictionary holds published Igbo entries only. If the word you want is not here, it
            may not have been added yet.
          </p>
        </div>
      ) : null}

      {results.length > 0 ? (
        <>
          <p className="muted" style={{ fontSize: '0.86rem', margin: '1rem 0 0.5rem' }}>
            {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
            {total > results.length ? `, showing the first ${results.length}` : ''}
          </p>

          <ul className="learn-review-list">
            {results.map((result) => {
              const note = matchNote(result.matchType);
              return (
                <li key={result.id} className="learn-review-item">
                  <span className="learn-review-prompt">
                    <a href={`${dictionaryUrl}/word/igbo/${result.slug}`}>{result.headword}</a>
                    {result.isCommon ? <span className="chip chip-common">common</span> : null}
                  </span>

                  <span className="learn-review-answer">
                    {result.glosses.length > 0 ? (
                      result.glosses.join('; ')
                    ) : (
                      <span className="muted">no gloss recorded</span>
                    )}
                    {result.partOfSpeech ? (
                      <span className="muted"> · {result.partOfSpeech}</span>
                    ) : null}
                  </span>

                  {result.audioUrl ? (
                    <audio
                      controls
                      preload="none"
                      src={result.audioUrl}
                      style={{ width: '100%', maxWidth: '18rem', marginTop: '0.4rem' }}
                    >
                      Your browser does not support audio playback.
                    </audio>
                  ) : null}

                  {note ? (
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {note}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
