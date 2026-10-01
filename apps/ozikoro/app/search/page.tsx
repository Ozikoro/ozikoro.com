/**
 * Search across the whole platform.
 *
 * Two modes, as the plan asks: **Knowledge** over the archive and the knowledge graph, and
 * **Research** over the publications and the people who wrote them. They share one implementation —
 * a mode narrows which kinds are searched, it does not change how anything is matched — so there is
 * one thing to get right rather than two that drift.
 *
 * It is a plain GET form, so a result set is an address that can be cited and shared, and the whole
 * page works without JavaScript. That is the design's own rule and it matters most here: a search box
 * that needs a script is a search box that fails on the poor connection the brief names.
 *
 * The facet counts are real, taken from what the query actually matched, so a filter cannot promise
 * results it does not have.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  KIND_LABEL,
  MODE_KINDS,
  listLabels,
  searchEverything,
  type SearchKind,
  type SearchMode,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  description:
    'Search the Ozikoro archive and research network: histories, clans, places, photographs, sources and published research.',
  robots: { index: false, follow: true },
};

function href(params: { q: string; mode: SearchMode; kind?: string | null }): string {
  const search = new URLSearchParams({ q: params.q, mode: params.mode });
  if (params.kind) search.set('kind', params.kind);
  return `/search/?${search.toString()}`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 200);
  const mode: SearchMode = params.mode === 'research' ? 'research' : 'knowledge';
  const kind = params.kind && (MODE_KINDS[mode] as string[]).includes(params.kind)
    ? (params.kind as SearchKind)
    : null;

  const db = await getDb();
  const [outcome, popularLabels] = await Promise.all([
    query ? searchEverything(db, query, { mode, ...(kind ? { kinds: [kind] } : {}), limit: 40 }) : Promise.resolve(null),
    listLabels(db, { limit: 14 }),
  ]);

  const kindsWithResults = MODE_KINDS[mode].filter((k) => (outcome?.counts[k] ?? 0) > 0);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Search</p>
        <h1>{query ? `Results for “${query}”` : 'Search the archive'}</h1>
      </header>

      <div className="chips section" role="tablist" aria-label="What to search">
        {(['knowledge', 'research'] as const).map((m) => (
          <Link
            key={m}
            className={`chip${m === mode ? ' chip-source' : ''}`}
            href={href({ q: query, mode: m })}
            aria-current={m === mode ? 'true' : undefined}
          >
            {m === 'knowledge' ? 'The archive and the record' : 'Research and researchers'}
          </Link>
        ))}
      </div>

      <form className="search section" method="get" action="/search/" role="search">
        {/* The mode survives the search, so a reader is not silently moved back to the other one. */}
        <input type="hidden" name="mode" value={mode} />
        <label className="small" htmlFor="q">
          {mode === 'knowledge'
            ? 'A town, a clan, a person, a subject or a word in the text'
            : 'A title, an abstract, an author or a research interest'}
        </label>
        <div className="row">
          <input id="q" name="q" type="search" defaultValue={query} autoFocus />
          <button className="btn btn-ink" type="submit">Search</button>
        </div>
        <p className="help">
          Tone marks and dotted vowels are optional — <em>Onicha</em> finds <em>Ọ̀nịchạ</em>.
        </p>
      </form>

      {outcome ? (
        outcome.results.length > 0 ? (
          <>
            {kindsWithResults.length > 1 ? (
              <ul className="chips section">
                <li>
                  <Link className={`chip${!kind ? ' chip-source' : ''}`} href={href({ q: query, mode })}>
                    Everything <span className="muted">{outcome.results.length}</span>
                  </Link>
                </li>
                {kindsWithResults.map((k) => (
                  <li key={k}>
                    <Link className={`chip${kind === k ? ' chip-source' : ''}`} href={href({ q: query, mode, kind: k })}>
                      {KIND_LABEL[k]} <span className="muted">{outcome.counts[k]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="stack-lg section">
              {outcome.results.map((result) => (
                <article className="entry" key={`${result.kind}-${result.id}-${result.url}`}>
                  <div>
                    <p className="eyebrow">
                      {KIND_LABEL[result.kind]}
                      {result.matchedOn === 'body' ? ' · matched in the text' : ''}
                      {result.matchedOn === 'author' ? ' · matched on the author' : ''}
                      {result.matchedOn === 'alias' ? ' · matched on another spelling' : ''}
                    </p>
                    <h3><Link href={result.url}>{result.title}</Link></h3>
                    {result.detail ? <p className="small muted">{result.detail}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty section">
            <p className="eyebrow">Nothing found</p>
            <p>
              No record in {mode === 'knowledge' ? 'the archive' : 'the research network'} matches{' '}
              <strong>{query}</strong>. Spelling varies across sources and the archive holds historical
              spellings, so a shorter form — a town or a root rather than a full name — often finds it.
            </p>
            <p className="small">
              {mode === 'knowledge' ? (
                <Link href={href({ q: query, mode: 'research' })}>Search the research network instead</Link>
              ) : (
                <Link href={href({ q: query, mode: 'knowledge' })}>Search the archive instead</Link>
              )}
            </p>
          </div>
        )
      ) : (
        <section className="section">
          <p className="eyebrow">Frequent subjects</p>
          <p className="small muted">
            The subjects the archive writes about most. Tone marks are optional in the search box.
          </p>
          <ul className="chips" style={{ marginTop: 'var(--s-4)' }}>
            {popularLabels.map((label) => (
              <li key={label.slug}>
                <Link className="chip" href={`/labels/${label.slug}`}>
                  {label.name} <span className="muted">{label.articleCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
