import Link from 'next/link';
import { displayHeadword } from '@/lib/display';
import type { WordSummary } from '@ozituma/db/repository';

/**
 * Search box. A plain GET form, so search works without JavaScript and every
 * result set is a shareable, indexable URL — which for a dictionary is the
 * whole point.
 */
export function SearchForm({
  action = '/',
  query = '',
  language = 'ibo',
  autoFocus = false,
}: {
  action?: string;
  query?: string;
  language?: string;
  autoFocus?: boolean;
}) {
  return (
    <form className="search-form" action={action} method="get" role="search">
      <label htmlFor="q" className="sr-only">
        Search the dictionary
      </label>
      <input
        id="q"
        className="search-input"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search in Igbo or English — e.g. mmiri, water, ọ̀dị́nàlà"
        autoComplete="off"
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {language !== 'ibo' ? <input type="hidden" name="language" value={language} /> : null}
      <button className="button" type="submit">
        Search
      </button>
    </form>
  );
}

const MATCH_LABELS: Record<string, string> = {
  headword: '',
  variant: 'alternate spelling',
  dialect: 'dialect spelling',
  definition: 'English meaning',
  fuzzy: 'close match',
};

export function ResultList({ results }: { results: WordSummary[] }) {
  if (results.length === 0) return null;

  return (
    <ul className="result-list">
      {results.map((word) => (
        <li key={word.id}>
          <Link className="result" href={`/word/${word.language}/${encodeURIComponent(word.slug)}`}>
            <span className="result-head">
              <span className="result-headword">{displayHeadword(word.headword)}</span>
              {word.partOfSpeech ? <span className="chip chip-pos">{word.partOfSpeech}</span> : null}
              {word.isCommon ? <span className="chip chip-common">common</span> : null}
            </span>
            {word.glosses.length > 0 ? (
              <span className="result-gloss">{word.glosses.join('; ')}</span>
            ) : (
              <span className="result-gloss muted">No definition recorded yet</span>
            )}
            {MATCH_LABELS[word.matchType] ? (
              <span className="result-meta">
                <span className="chip chip-match">matched on {MATCH_LABELS[word.matchType]}</span>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Pagination({
  page,
  perPage,
  total,
  hasMore,
  buildHref,
}: {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
  buildHref: (page: number) => string;
}) {
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      {page > 1 ? (
        <Link className="button button-secondary" href={buildHref(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : null}
      <span className="muted">
        {total === 0 ? 'No results' : `${first}–${last} of ${total.toLocaleString()}`}
      </span>
      <span className="spacer" />
      {hasMore ? (
        <Link className="button button-secondary" href={buildHref(page + 1)} rel="next">
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
