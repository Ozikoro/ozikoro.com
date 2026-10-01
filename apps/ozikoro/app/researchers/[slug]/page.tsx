/**
 * One researcher.
 *
 * The design calls a profile "a business card and a CV in one" and says an empty profile must look
 * like an invitation rather than a failure. Both are honoured here: the head carries the identity, and
 * a researcher with nothing published yet gets a specific, achievable next step rather than a blank.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getResearcher, getResearcherBio, listByAccount } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const id = Number.parseInt(slug, 10);
  if (!Number.isInteger(id)) return { title: 'Not found' };
  const db = await getDb();
  const researcher = await getResearcher(db, id);
  if (!researcher) return { title: 'Not found' };
  return {
    title: researcher.name,
    description: researcher.headline ?? `${researcher.name} publishes through the Ozikoro research network.`,
    alternates: { canonical: `https://ozikoro.com/researchers/${id}` },
  };
}

export default async function ResearcherPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = Number.parseInt(slug, 10);
  if (!Number.isInteger(id)) notFound();

  const db = await getDb();
  const researcher = await getResearcher(db, id);
  if (!researcher) notFound();

  const [bio, works] = await Promise.all([
    getResearcherBio(db, id),
    listByAccount(db, id, { includePrivate: false }),
  ]);

  const role = researcher.headline
    ?? (researcher.institution ? `${researcher.department ? `${researcher.department}, ` : ''}${researcher.institution}` : 'Independent researcher');

  return (
    <div className="wrap section">
      <div className="profile-head">
        <p className="avatar" aria-hidden="true">{initials(researcher.name)}</p>
        <div>
          <h1 style={{ fontSize: 'var(--t-2xl)' }}>{researcher.name}</h1>
          <p className="lede" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--t-base)', fontFamily: 'var(--font-sans)' }}>{role}</p>
          <div className="chips" style={{ marginTop: 'var(--s-4)' }}>
            {researcher.orcid ? (
              <a className="chip" href={`https://orcid.org/${researcher.orcid}`} rel="noopener noreferrer">ORCID {researcher.orcid}</a>
            ) : null}
            {researcher.memberSince ? (
              <span className="chip">Member since {new Date(researcher.memberSince).getUTCFullYear()}</span>
            ) : null}
            <span className="chip chip-source">
              {researcher.publicationCount} {researcher.publicationCount === 1 ? 'publication' : 'publications'}
            </span>
          </div>
        </div>
      </div>

      {bio.bio ? (
        <section className="section">
          <p className="eyebrow">About</p>
          <div className="prose"><p>{bio.bio}</p></div>
        </section>
      ) : null}

      {researcher.researchInterests.length > 0 ? (
        <section className="section">
          <p className="eyebrow">Research interests</p>
          <ul className="chips">
            {researcher.researchInterests.map((i) => (
              <li key={i}><Link className="chip" href={`/publications?q=${encodeURIComponent(i)}`}>{i}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <p className="eyebrow">Publications</p>
        {works.length === 0 ? (
          /*
           * An empty profile as an invitation, with a specific next step. The design notes are
           * explicit that this state is a real screen and must not read as a failure.
           */
          <div className="unsourced">
            <p className="eyebrow">Nothing published yet</p>
            <p>
              {researcher.name} has not published through Ozikoro yet. A working paper, a conference
              paper or a thesis chapter all count — it does not have to be a journal article.
            </p>
          </div>
        ) : (
          <ul className="stack">
            {works.map((w) => (
              <li key={w.id}>
                <Link href={w.url}>{w.title}</Link>
                <span className="small muted">
                  {' · '}
                  {w.publishedAt ? new Date(w.publishedAt).getUTCFullYear() : 'unpublished'}
                  {' · '}
                  {w.peerReviewed ? 'peer-reviewed' : 'editorially reviewed only'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {bio.website ? (
        <section className="section">
          <p className="eyebrow">Elsewhere</p>
          <p className="small"><a href={bio.website} rel="noopener noreferrer">{bio.website}</a></p>
        </section>
      ) : null}

      <p className="actions section">
        <Link className="btn" href="/researchers">All researchers</Link>
        <Link className="btn btn-quiet" href="/publications">All research</Link>
      </p>
    </div>
  );
}
