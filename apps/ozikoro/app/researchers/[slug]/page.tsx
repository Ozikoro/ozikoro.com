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
import {
  countFollowers,
  followsResearcher,
  getResearcher,
  getResearcherBio,
  listByAccount,
} from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

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

export default async function ResearcherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { slug } = await params;
  const notices = await searchParams;
  const id = Number.parseInt(slug, 10);
  if (!Number.isInteger(id)) notFound();

  const db = await getDb();
  const researcher = await getResearcher(db, id);
  if (!researcher) notFound();

  const [bio, works] = await Promise.all([
    getResearcherBio(db, id),
    listByAccount(db, id, { includePrivate: false }),
  ]);

  /*
   * THE FOLLOW STATE IS READ FOR THE READER, AND ONLY FOR THE READER.
   *
   * A signed-out visitor gets the follower COUNT and no button: the count is a fact about a public
   * profile, and whether *you* follow somebody is a fact about your own reading list. So the two
   * queries are asked separately — `countFollowers` always, `followsResearcher` only when there is
   * somebody signed in — rather than one query that returns a state the page would then hide.
   */
  const current = await getCurrentAccount();
  const viewerId = current?.account.id ?? null;
  const [followers, following] = await Promise.all([
    countFollowers(db, id),
    viewerId === null ? Promise.resolve(false) : followsResearcher(db, viewerId, id),
  ]);

  const role = researcher.headline
    ?? (researcher.institution ? `${researcher.department ? `${researcher.department}, ` : ''}${researcher.institution}` : 'Independent researcher');

  return (
    <div className="wrap section">
      {notices.saved ? (
        <div className="notice notice--success" role="status">
          <div><p className="notice__body">{notices.saved}</p></div>
        </div>
      ) : null}
      {notices.error ? (
        <div className="notice notice--error" role="alert">
          <div><p className="notice__body">{notices.error}</p></div>
        </div>
      ) : null}

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
            {/*
              The follower count is shown whether or not there are any. "0 followers" on a new profile is
              a true statement and a different one from hiding the figure — and the design's rule that an
              empty profile is an invitation rather than a failure applies to its numbers too.
            */}
            <span className="chip">
              {followers} {followers === 1 ? 'follower' : 'followers'}
            </span>
          </div>

          {/*
            FOLLOWING IS A READER'S ACT, SO THE CONTROL BELONGS TO THE READER.
            Signed out, the form is not rendered at all — a button that bounces somebody to a sign-in
            page is a promise the page cannot keep on its own, and the page says what signing in would
            buy instead. An author is not offered a button to follow themselves: the endpoint refuses
            it, and offering a control whose only outcome is a refusal is the fault this pass exists to
            remove.
          */}
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            {viewerId === null ? (
              <p className="small muted">
                <Link href={`/signin?next=${encodeURIComponent(`/researchers/${id}/`)}`}>Sign in</Link> to follow
                this researcher and keep a reading list.
              </p>
            ) : viewerId === id ? (
              <p className="small muted">This is your own profile.</p>
            ) : (
              <form method="post" action="/api/follows">
                <input type="hidden" name="kind" value="researcher" />
                <input type="hidden" name="subjectAccountId" value={id} />
                <input type="hidden" name="on" value={following ? '0' : '1'} />
                <input type="hidden" name="returnTo" value={`/researchers/${id}/`} />
                <button className={following ? 'btn btn-quiet' : 'btn'} type="submit">
                  {following ? 'Following — stop' : 'Follow'}
                </button>
              </form>
            )}
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
