/**
 * The researchers' directory.
 *
 * Being found is the stated purpose of the research network, so this lists everyone who has chosen a
 * public profile. It deliberately does not require an institution: the plan is explicit that
 * university affiliation must not be mandatory for an independent or community researcher, so an
 * entry with no institution is a complete entry rather than an unfinished one.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listResearchers } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Researchers',
  description: 'The researchers, students, lecturers, independent scholars and community knowledge holders publishing through Ozikoro.',
  alternates: { canonical: 'https://ozikoro.com/researchers' },
};

function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export default async function ResearchersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() || null;

  const db = await getDb();
  const researchers = await listResearchers(db, { search: query, limit: 60 });

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The research network</p>
        <h1>Researchers</h1>
        <p className="lede">
          Students, lecturers, independent researchers and community knowledge holders who publish
          through Ozikoro. A researcher profile is a CV and a calling card in one, and it works the
          same whether or not its owner has a university.
        </p>
      </header>

      <form className="search section" method="get" action="/researchers" role="search">
        <label className="small" htmlFor="q">Search by name, institution or interest</label>
        <div className="row">
          <input id="q" name="q" type="search" defaultValue={query ?? ''} />
          <button className="btn btn-ink" type="submit">Search</button>
        </div>
      </form>

      {researchers.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">No profiles yet</p>
          <p>
            Nobody has published a profile here yet. The directory fills from its first member rather
            than from invented ones — the design&rsquo;s example profiles were demonstrations, and the
            archive does not present those as people.
          </p>
          <p className="small">
            <Link href="/publications">See the research</Link> in the meantime.
          </p>
        </div>
      ) : (
        <div className="grid-3 section">
          {researchers.map((r) => (
            <article className="entry" key={r.accountId}>
              <div className="profile-head">
                <p className="avatar" aria-hidden="true">{initials(r.name)}</p>
                <div>
                  <h3><Link href={`/researchers/${r.slug}/`}>{r.name}</Link></h3>
                  <p className="small muted">
                    {r.headline ?? (r.institution ? `${r.department ? `${r.department}, ` : ''}${r.institution}` : 'Independent researcher')}
                  </p>
                </div>
              </div>
              {r.researchInterests.length > 0 ? (
                <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
                  {r.researchInterests.slice(0, 4).map((i) => <span className="chip" key={i}>{i}</span>)}
                </div>
              ) : null}
              <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
                {r.publicationCount} {r.publicationCount === 1 ? 'publication' : 'publications'}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
