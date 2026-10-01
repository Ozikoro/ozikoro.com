/**
 * One entity: a clan, a town, a place, a person, a period.
 *
 * This is the canonical page search promises, and it is where the platform's "one institution, three
 * roles" stops being a slogan. The dictionary already holds the clan, its grouping, its present-day
 * states and its towns; the archive holds the histories written about it. Neither restates the other.
 * `entity.dictionary` is that join, and the page shows both sides with the reader able to cross to
 * Ozituma for the language layer rather than reading a copy of it.
 *
 * The chronology is rendered from the qualifier, not from the year. "circa 1200" and "1200" are
 * different claims, and a page that prints the number alone makes the stronger one by accident.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getEntityBySlug } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  person: 'Person', people: 'People', community: 'Community', clan: 'Clan', town: 'Town',
  place: 'Place', historical_place: 'Historical place', archaeological_site: 'Archaeological site',
  polity: 'Polity', kingdom: 'Kingdom', chiefdom: 'Chiefdom', event: 'Event', period: 'Period',
  migration: 'Migration', trade_route: 'Trade route', conflict: 'Conflict', treaty: 'Treaty',
  deity: 'Deity', ritual: 'Ritual', festival: 'Festival', folklore: 'Folklore',
  oral_tradition: 'Oral tradition', architecture: 'Architecture', music: 'Music', craft: 'Craft',
  institution: 'Institution', language: 'Language', dialect: 'Dialect', object: 'Object',
  museum: 'Museum', collection: 'Collection', document: 'Document', photograph: 'Photograph',
  audio: 'Audio', video: 'Video', manuscript: 'Manuscript', dataset: 'Dataset',
  publication: 'Publication', topic: 'Topic', other: 'Record',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const entity = await getEntityBySlug(db, slug);
  if (!entity) return { title: 'Not found' };
  return {
    title: entity.name,
    description: entity.summary ?? `${KIND_LABEL[entity.kind] ?? entity.kind} in the Ozikoro archive.`,
    alternates: { canonical: `https://ozikoro.com/entities/${entity.slug}` },
  };
}

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const entity = await getEntityBySlug(db, slug);
  if (!entity) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': entity.kind === 'person' ? 'Person' : 'Place',
    name: entity.name,
    ...(entity.aliases.length > 0 ? { alternateName: entity.aliases } : {}),
    ...(entity.summary ? { description: entity.summary } : {}),
    ...(entity.latitude !== null && entity.longitude !== null
      ? { geo: { '@type': 'GeoCoordinates', latitude: entity.latitude, longitude: entity.longitude } }
      : {}),
    url: `https://ozikoro.com/entities/${entity.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <header>
          <p className="eyebrow">{KIND_LABEL[entity.kind] ?? entity.kind}</p>
          <h1>{entity.name}</h1>
          {entity.aliases.length > 0 ? (
            <p className="small muted">
              Also recorded as {entity.aliases.map((a, i) => (
                <span key={a}>{i > 0 ? ', ' : ''}<em>{a}</em></span>
              ))}
            </p>
          ) : null}
          {entity.summary ? <p className="lede">{entity.summary}</p> : null}

          <div className="chips" style={{ marginTop: 'var(--s-4)' }}>
            {entity.dateStatement ? <span className="chip chip-period">{entity.dateStatement}</span> : null}
            {entity.latitude !== null && entity.longitude !== null ? (
              <span className="chip mono">
                {entity.latitude.toFixed(4)}, {entity.longitude.toFixed(4)}
              </span>
            ) : null}
          </div>
        </header>

        {/*
          The dictionary side. Shown when the entity is one of the dictionary's records, which is what
          "one institution" means in practice: the same clan, described once, read from both.
        */}
        {entity.dictionary.length > 0 ? (
          <section className="provenance section" aria-labelledby="dictionary">
            <p className="eyebrow" id="dictionary">Also recorded in the dictionary</p>
            {entity.dictionary.map((link) => (
              <div key={`${link.kind}-${link.id}`} style={{ marginBottom: 'var(--s-4)' }}>
                <p>
                  <strong>{link.label}</strong>
                  {link.tribe ? ` · ${link.tribe}` : ''}
                  {link.kind === 'clan' ? ' · clan' : link.kind === 'clan_town' ? ' · town' : ' · language'}
                </p>
                {link.states.length > 0 ? (
                  <p className="small muted">
                    Present-day {link.states.join(', ')}
                    {link.lgas.length > 0 ? ` · ${link.lgas.join(', ')}` : ''}
                  </p>
                ) : null}
                {link.towns.length > 0 ? (
                  <p className="small muted">Towns recorded: {link.towns.join(', ')}</p>
                ) : null}
                <p className="small">
                  <a href={link.url} rel="noopener noreferrer">Open it in Ozituma →</a>
                </p>
              </div>
            ))}
            <p className="small muted">
              Ozikoro links to the dictionary rather than restating it. The spellings, the towns and the
              language records live in Ozituma, which is the language layer of this platform.
            </p>
          </section>
        ) : null}

        {entity.locationNote ? (
          <section className="section">
            <p className="eyebrow">Location</p>
            <p>{entity.locationNote}</p>
          </section>
        ) : null}

        {entity.relations.length > 0 ? (
          <section className="section">
            <p className="eyebrow">Connected records</p>
            <ul className="stack">
              {entity.relations.map((r) => (
                <li key={`${r.relation}-${r.entityId}`}>
                  <Link href={`/entities/${r.slug}/`}>{r.name}</Link>
                  <span className="small muted">
                    {' '}
                    {r.direction === 'out' ? `→ ${r.relation.replace(/_/g, ' ')}` : `← ${r.relation.replace(/_/g, ' ')}`}
                    {' · '}
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="section">
          <p className="eyebrow">Histories</p>
          {entity.articles.length === 0 ? (
            /*
             * The honest empty state. Nothing links this entity to a record yet, and attaching one is a
             * human decision — the schema deliberately does not guess a clan from an article's prose.
             */
            <div className="unsourced">
              <p className="eyebrow">No histories linked yet</p>
              <p>
                No published record names this {KIND_LABEL[entity.kind]?.toLowerCase() ?? 'entity'} yet.
                Editors attach records from the editorial queue, entry by entry, rather than a script
                guessing which clan a history is about.
              </p>
            </div>
          ) : (
            <ul className="stack">
              {entity.articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/${a.slug}/`}>{a.title}</Link>
                  <span className="small muted">
                    {' · '}
                    {a.role.replace(/_/g, ' ')}
                    {a.publishedAt ? ` · ${new Date(a.publishedAt).getUTCFullYear()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="actions section">
          <Link className="btn" href="/entities/">All records in the graph</Link>
        </p>
      </div>
    </>
  );
}
