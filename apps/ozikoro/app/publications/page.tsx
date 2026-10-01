/**
 * The research repository.
 *
 * What is listed is strictly what has been published and made public: a draft, a submission under
 * review and a work whose author has kept it private are all absent. That is not a filter on the
 * display, it is the query (`listPublished`), because a list that showed what it had fetched and hid
 * it in the markup would leak the moment somebody read the response.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listPublished } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Research',
  description: 'Published research from the Ozikoro network: papers, theses, reports and working papers, with their review status stated.',
  alternates: { canonical: 'https://ozikoro.com/publications' },
};

/** Names as a citation lists them, with an ampersand before the last of several. */
function authorLine(authors: { name: string }[]): string {
  const names = authors.map((a) => a.name);
  if (names.length === 0) return 'Anonymous';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; discipline?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() || null;
  const discipline = params.discipline?.trim() || null;

  const db = await getDb();
  const works = await listPublished(db, { search: query, discipline, limit: 50 });

  const disciplines = [...new Set(works.flatMap((w) => w.disciplines))].sort();

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The research network</p>
        <h1>Research</h1>
        <p className="lede">
          Work published through Ozikoro by students, lecturers, independent researchers and
          community knowledge holders. Every entry states whether it completed peer review — and where
          it did not, says so.
        </p>
      </header>

      <form className="search section" method="get" action="/publications" role="search">
        <label className="small" htmlFor="q">Search titles and abstracts</label>
        <div className="row">
          <input id="q" name="q" type="search" defaultValue={query ?? ''} />
          <button className="btn btn-ink" type="submit">Search</button>
        </div>
      </form>

      {disciplines.length > 0 ? (
        <ul className="chips section">
          <li><Link className="chip" href="/publications">All</Link></li>
          {disciplines.map((d) => (
            <li key={d}><Link className="chip" href={`/publications?discipline=${encodeURIComponent(d)}`}>{d}</Link></li>
          ))}
        </ul>
      ) : null}

      {works.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing published yet</p>
          <p>
            No research has been published here yet. The repository opens with its first accepted
            work rather than with a demonstration entry, because a research repository that lists
            work nobody wrote is worse than an empty one.
          </p>
          <p className="small">
            <Link href="/researchers">See the researchers</Link> who have joined.
          </p>
        </div>
      ) : (
        <div className="stack-lg section">
          {works.map((work) => (
            <article className="entry" key={work.id}>
              <div>
                <p className="eyebrow">
                  {work.kind.replace(/_/g, ' ')}
                  {work.publishedAt ? ` · ${new Date(work.publishedAt).getUTCFullYear()}` : ''}
                </p>
                <h3><Link href={work.url}>{work.title}</Link></h3>
                <p className="small muted">{authorLine(work.authors)}</p>
                {work.abstract ? <p className="small">{work.abstract.slice(0, 300)}{work.abstract.length > 300 ? '…' : ''}</p> : null}
                <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
                  {/*
                    The badge states what actually happened. A work that was published without expert
                    review gets the ochre chip, not a peer-reviewed one, and the wording matches the
                    sentence on its own page.
                  */}
                  {work.peerReviewed ? (
                    <span className="chip chip-source">Peer-reviewed</span>
                  ) : (
                    <span className="chip chip-period">Editorially reviewed only</span>
                  )}
                  {work.disciplines.slice(0, 3).map((d) => (
                    <span className="chip" key={d}>{d}</span>
                  ))}
                  {work.doi ? <span className="chip mono">doi:{work.doi}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
