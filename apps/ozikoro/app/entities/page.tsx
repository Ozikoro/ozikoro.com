/**
 * The knowledge graph's index.
 *
 * It says how sparse the graph still is rather than implying it is complete. Attaching a record to a
 * clan is an editorial decision, so the graph fills as editors work — and a reader arriving at an
 * index of eleven things should be told why there are eleven, not left to conclude the archive is
 * thin.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getEntityStats, listEntities } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The record',
  description: 'Clans, towns, places, people and periods in the Ozikoro archive, linked to their records.',
  alternates: { canonical: 'https://ozikoro.com/entities' },
};

export default async function EntitiesPage() {
  const db = await getDb();
  const [entities, stats] = await Promise.all([listEntities(db, { limit: 100 }), getEntityStats(db)]);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The knowledge graph</p>
        <h1>The record</h1>
        <p className="lede">
          The clans, towns, places, people and periods the archive knows about, each with the histories
          written about it.
        </p>
      </header>

      <div className="partial-note section">
        <p className="eyebrow">Where this stands</p>
        <p>
          {stats.entities.toLocaleString('en-GB')} entities across {stats.kinds} kinds, with{' '}
          {stats.linkedArticles.toLocaleString('en-GB')} of the{' '}
          {stats.linkedArticles === 0 ? '1,051' : ''} migrated records linked to one so far.
        </p>
        <p className="small">
          Linking a history to a clan or a town is an editorial decision made by a person, not inferred
          from the prose — a script that guessed which clan a history is about would be inventing
          history. The graph therefore fills as editors work through the queue.
        </p>
      </div>

      {entities.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing in the graph yet</p>
          <p>
            No entity has been created yet. They are made when an editor links a record to a clan, a
            town or a place — and the dictionary&rsquo;s own 228 clans are offered as a pick-list, so
            linking chooses the record that already exists rather than creating a second copy of it.
          </p>
          <p className="small">
            <Link href="/archive/">Browse the archive</Link> in the meantime.
          </p>
        </div>
      ) : (
        <div className="grid-3 section">
          {entities.map((e) => (
            <article className="entry" key={e.id}>
              <div>
                <p className="eyebrow">{e.kind.replace(/_/g, ' ')}</p>
                <h3><Link href={`/entities/${e.slug}/`}>{e.name}</Link></h3>
                {e.summary ? <p className="small muted">{e.summary.slice(0, 140)}</p> : null}
                <p className="small muted">
                  {e.articleCount} {e.articleCount === 1 ? 'history' : 'histories'}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
