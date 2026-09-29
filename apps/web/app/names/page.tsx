import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listPersonNames, DEFAULT_LANGUAGE } from '@ozituma/db/repository';
import { getLanguage, languageCodeFromSlug } from '@ozituma/core';
import { Pagination } from '@/components/dictionary';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The Name Dictionary',
  description:
    'Search Igbo personal names by the name itself, by a word in its meaning, or by the form the name takes in a neighbouring variety. Every entry carries the sentence behind the name.',
  openGraph: {
    title: 'The Name Dictionary — Ozituma',
    description:
      'A searchable dictionary of Igbo personal names with their meanings, variants, forms in other Igbo varieties, and gender.',
  },
};

const GENDERS = [
  { value: '', label: 'All' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unisex', label: 'Unisex' },
] as const;

interface NamesPageProps {
  searchParams: Promise<{ q?: string; language?: string; gender?: string; page?: string }>;
}

/**
 * Rows per page. The corpus is 2,500 names and growing, so the list is paged
 * rather than truncated — an earlier limit of 200 silently hid everything past
 * the first page with no way to reach it.
 */
const PER_PAGE = 50;

export default async function NamesPage({ searchParams }: NamesPageProps) {
  const query = await searchParams;
  const language = languageCodeFromSlug(query.language ?? '') ?? DEFAULT_LANGUAGE;
  const term = (query.q ?? '').trim();
  const gender = GENDERS.some((g) => g.value !== '' && g.value === query.gender)
    ? (query.gender as 'male' | 'female' | 'unisex')
    : undefined;
  const page = Math.max(1, Number(query.page ?? '1') || 1);

  const db = await getDb();
  const [{ data: names, total }, languageDef] = await Promise.all([
    listPersonNames(db, {
      language,
      query: term,
      gender,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    }),
    Promise.resolve(getLanguage(language)),
  ]);
  const hasMore = page * PER_PAGE < total;

  const languageName = languageDef?.name ?? language;

  // Keep the filter links honest: they carry the current search through.
  /** Keeps the search and the filter while moving between pages. */
  const pageHref = (target: number): string => {
    const search = new URLSearchParams();
    if (term) search.set('q', term);
    if (gender) search.set('gender', gender);
    if (target > 1) search.set('page', String(target));
    const qs = search.toString();
    return qs ? `/names?${qs}` : '/names';
  };

  const href = (params: { gender?: string }) => {
    const search = new URLSearchParams();
    if (term) search.set('q', term);
    if (params.gender) search.set('gender', params.gender);
    const qs = search.toString();
    return qs ? `/names?${qs}` : '/names';
  };

  return (
    <div className="wrap wrap-narrow">
      <div className="name-page-head">
        <p className="name-eyebrow">{languageName} names</p>
        <h1 className="name-title">The Name Dictionary</h1>
        <p className="name-lede">
          Every Igbo name is a sentence. Search by the name itself, by a word in its meaning, or by
          the place it comes from.
        </p>
      </div>

      {/*
        A plain GET form, so search works with no JavaScript — the same standard
        the contribution forms are held to. The result is a URL you can share.
      */}
      <form className="name-search" action="/names" method="get" role="search">
        {gender ? <input type="hidden" name="gender" value={gender} /> : null}
        <label className="sr-only" htmlFor="name-q">
          Search names
        </label>
        <input
          id="name-q"
          className="search-input"
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search names, meanings, origin, or a form in another variety…"
        />
        <button className="button" type="submit">
          Search
        </button>
      </form>

      <p className="name-count">
        <strong>{total}</strong> {total === 1 ? 'name' : 'names'}
        {term ? ` matching “${term}”` : ''}
        {gender ? ` · ${gender}` : ''}
      </p>

      <p className="pagination">
        {GENDERS.map((option) => {
          const active = (option.value || undefined) === gender;
          return (
            <Link
              key={option.label}
              href={href({ gender: option.value || undefined })}
              aria-current={active ? 'true' : undefined}
              style={active ? { fontWeight: 700, textDecoration: 'none' } : undefined}
            >
              {option.label}
            </Link>
          );
        })}
      </p>

      <ul className="name-list">
        {names.map((name) => (
          <li key={name.id}>
            <Link className="name-row" href={`/names/${encodeURIComponent(name.slug)}`}>
              <span className="name-row-head">
                <span className="name-row-name">{name.name}</span>
                <br />
                <span className="name-row-gender">
                  {name.gender}
                  {name.variants.length > 0 ? ` · also ${name.variants.join(', ')}` : ''}
                </span>
              </span>
              <span className="name-row-meaning">{name.meaning ?? 'Meaning not recorded.'}</span>
            </Link>
          </li>
        ))}
        {names.length === 0 ? (
          <li className="name-empty">
            {term
              ? `No names match “${term}” yet.`
              : 'No names have been published for this language yet.'}
          </li>
        ) : null}
      </ul>

      <Pagination
        page={page}
        perPage={PER_PAGE}
        total={total}
        hasMore={hasMore}
        buildHref={pageHref}
      />

      {/*
        About the names themselves, not about where they were found.

        This section used to list the collections the names were compiled from and
        their licence status. The owner's rule for anything public in this project
        is that it describes the language and the project, never the provenance of
        the material: a reader wants to know what an Igbo name is, and a note about
        suppliers answers a question nobody asked and one the project should not be
        answering in public at all.
      */}
      <div className="section" style={{ marginTop: '2.5rem' }}>
        <h2>Reading a name</h2>
        <p>
          A name here is written the way it is written in Igbo, with its tone marks, because the
          marks carry the meaning. Underneath it is the sentence the name is — most Igbo names are
          a short statement, a wish or a question, and the meaning given is that statement rather
          than a translation of the name&apos;s parts.
        </p>
        <p>
          Beside the meaning is the gender the name is used for, and the part of Igboland whose
          people bear it. Where a name has come down in more than one form, the other spellings are
          shown with it, because a reader who knows the name as <em>Adannịa</em> should find it
          under <em>Adannaya</em> as well. Searching ignores tone marks and letter marks, so
          typing <span className="mono">obinna</span> finds{' '}
          <span className="mono">Ọ̀bị̀nna</span>, and typing a word from a meaning finds the names
          that carry it.
        </p>
      </div>

    </div>
  );
}
