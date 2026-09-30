import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listProverbs, DEFAULT_LANGUAGE } from '@ozituma/db/repository';
import { PROVERB_THEMES, asProverbTheme } from '@ozituma/core';
import './proverbs.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Igbo proverbs & meanings',
  description:
    'Explore Igbo proverbs, literal translations, meanings, and the wisdom behind each saying.',
  openGraph: {
    title: 'Igbo Proverbs & Meanings — Ozituma',
    description: 'A growing archive of Igbo sayings and the wisdom they carry.',
  },
};

/**
 * Rows per page.
 *
 * The design lists proverbs in one continuous column with no pager, because the collection it
 * was drawn against was small enough to read that way. This one is not, and an unlinked tail
 * would be invisible with no way to reach it — so the pager stays, drawn in the page's own
 * voice: small, clay, and below the list, where it does not compete with the proverbs.
 *
 * The owner: "On the proverbs page, please list only 20 proverbs, not 100, then one can click
 * next to see the others." Twenty is also the number a reader can take in without scrolling
 * past the point of remembering what they were looking for, and it makes the page light
 * enough that moving to the next one is instant.
 */
const PER_PAGE = 20;

const THEMES = ['All', ...PROVERB_THEMES] as const;

interface ProverbsPageProps {
  searchParams: Promise<{ q?: string; theme?: string; language?: string; page?: string }>;
}

export default async function ProverbsPage({ searchParams }: ProverbsPageProps) {
  const query = await searchParams;
  const language = query.language || DEFAULT_LANGUAGE;
  const term = (query.q ?? '').trim();
  const theme = asProverbTheme((query.theme ?? '').trim()) ?? '';
  const page = Math.max(1, Number(query.page ?? '1') || 1);

  const db = await getDb();
  const { data: proverbs, total } = await listProverbs(db, {
    language,
    query: term,
    theme: theme || undefined,
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });

  /** Keeps the search and the theme while moving between pages or themes. */
  const href = (next: { q?: string; theme?: string; page?: number }): string => {
    const search = new URLSearchParams();
    const nextTerm = next.q ?? term;
    const nextTheme = next.theme ?? theme;
    if (nextTerm) search.set('q', nextTerm);
    if (nextTheme) search.set('theme', nextTheme);
    if (next.page && next.page > 1) search.set('page', String(next.page));
    const qs = search.toString();
    return qs ? `/proverbs?${qs}` : '/proverbs';
  };

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="proverbs-page">
      <div className="prov-band">
        <div className="prov-band-inner">
          <p className="prov-eyebrow">Ilu Igbo · Oral wisdom</p>
          <h1 className="prov-title">Igbo proverbs &amp; meanings</h1>
          <p className="prov-lede">
            A saying holds more than its words. Explore the literal language and the meaning passed
            from one generation to the next.
          </p>
        </div>
      </div>

      <div className="prov-body">
        {/* A plain GET form: the search works with no JavaScript, and its result is a URL. */}
        <form className="prov-search" action="/proverbs" method="get" role="search">
          {theme ? <input type="hidden" name="theme" value={theme} /> : null}
          <label className="sr-only" htmlFor="proverb-q">
            Search proverbs or meanings
          </label>
          <input
            id="proverb-q"
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search a saying or meaning…"
            aria-label="Search proverbs or meanings"
          />
          <button className="prov-button" type="submit">
            <SearchIcon />
            <span className="prov-button-label">Search</span>
          </button>
        </form>

        <div className="prov-themes" aria-label="Filter by theme">
          {THEMES.map((name) => {
            const active = name === 'All' ? theme === '' : theme === name;
            return (
              <Link
                key={name}
                href={href({ theme: name === 'All' ? '' : name, page: 1 })}
                className={active ? 'prov-chip prov-chip-on' : 'prov-chip'}
                aria-current={active ? 'true' : undefined}
                scroll={false}
              >
                {name}
              </Link>
            );
          })}
        </div>

        <p className="prov-count">
          {total} {total === 1 ? 'proverb' : 'proverbs'}
          {term ? ` for “${term}”` : ''}
        </p>

        <ul className="prov-list">
          {proverbs.map((proverb, index) => (
            <li key={proverb.id}>
              <Link className="prov-row" href={`/proverbs/${proverb.id}`}>
                <span className="prov-row-index">
                  {String((page - 1) * PER_PAGE + index + 1).padStart(2, '0')}
                </span>
                <div className="prov-row-main">
                  {proverb.theme ? <span className="prov-row-theme">{proverb.theme}</span> : null}
                  <h2 className="prov-row-text">{proverb.text}</h2>
                  {proverb.literal ? (
                    <p className="prov-row-literal">“{proverb.literal}”</p>
                  ) : null}
                </div>
                {proverb.translation ? (
                  <p className="prov-row-meaning">
                    {proverb.equivalent ? `“${proverb.equivalent}” ` : ''}
                    {proverb.translation}
                  </p>
                ) : (
                  <p className="prov-row-missing">No English rendering recorded yet.</p>
                )}
                <ArrowRightIcon />
              </Link>
            </li>
          ))}
          {proverbs.length === 0 ? (
            <li className="prov-empty">
              {term
                ? 'No proverbs found. Try another saying or meaning.'
                : 'No proverbs have been published for this language yet.'}
            </li>
          ) : null}
        </ul>

        {lastPage > 1 ? (
          <p className="prov-pages">
            {page > 1 ? <Link href={href({ page: page - 1 })}>← Previous</Link> : null}
            <span>
              Page {page} of {lastPage}
            </span>
            {page < lastPage ? <Link href={href({ page: page + 1 })}>Next →</Link> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m21 21-4.34-4.34" strokeLinecap="round" />
      <circle cx="11" cy="11" r="8" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      className="prov-row-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
