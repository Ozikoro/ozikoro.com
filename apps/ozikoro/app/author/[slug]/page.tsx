/**
 * The `/author/<slug>/` addresses WordPress served.
 *
 * WHY THIS EXISTS
 *
 * WordPress published an archive page per author. The migration kept each contributor's slug, but this
 * platform served authors at `/researchers/` only — so 91 published articles, whose bodies link to
 * `/author/<name>/` 195 times, now contained roughly 25 links to a 404. Checked in round 74; the slugs
 * were confirmed to match the contributors table exactly in round 76.
 *
 * A route rather than a redirect, and deliberately: the address can be SERVED, which keeps it a 200 at
 * the URL WordPress published. Round 58 is the standing reminder of what rewriting archived addresses
 * to make a lookup work costs.
 *
 * ── THE PAGE SHOWED LESS ABOUT A WRITER THAN THE PAGE THE READER CAME FROM (round 338) ────────────────
 *
 * `/researchers/` listed the same eleven people with their portraits, their biographies, their record
 * counts and their institutions, and linked each one here. **This page drew a bare heading, a record
 * count and a grid**: it never read `ozikoro_contributor.avatar_url` or `.bio`, which the row already
 * carried, and it used none of the design's own `.profile-head` / `.avatar` / `.stat-row` idiom — the
 * idiom `/researchers/` and `/researchers/<id>/` both use. *The owner called it "not well designed".*
 *
 * So the head is the design's profile head: the author's OWN portrait where one has been supplied (the
 * column is cleared of Gravatar's `d=mm` silhouette, which is a stock face and not a person), a monogram
 * where none has, the biography the record holds, the counts, and — where a public research profile is
 * joined to this byline by the record — the profile's own address. **Nothing here is inferred from a
 * matching name**: `ozikoro_contributor.account_id` is set only by an approved claim, and a name is not
 * proof, so a byline with no linked profile simply has none.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  listArticles,
  countArticles,
  getBylineProfile,
  listMemberSocial,
  sameOriginPortrait,
  socialHref,
} from '@ozikoro/platform';
import { ArticleEntry } from '../../_components/article-entry';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

const PER_PAGE = 24;

async function authorArticles(slug: string, page: number) {
  const db = await getDb();
  const [articles, total] = await Promise.all([
    listArticles(db, { authorSlug: slug, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    countArticles(db, { authorSlug: slug }),
  ]);
  return { articles, total };
}

/** `IE` from `Idenze Ezeme` — the same monogram `/about/` and `/researchers/` draw. */
function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** `1051` -> `1,051`. The archive counts in en-GB, as the rest of the site does. */
function n(value: number): string {
  return value.toLocaleString('en-GB');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { total } = await authorArticles(slug, 1);
  if (total === 0) return { title: 'Not found' };

  const db = await getDb();
  const byline = await getBylineProfile(db, slug);
  // The name comes from the contributor's own row, falling back to the byline printed on the records.
  const name = byline?.name ?? slug;
  return {
    title: `${name} — records in the Ozikoro archive`,
    description: `${total} ${total === 1 ? 'record' : 'records'} by ${name} in the Ozikoro archive.`,
    alternates: { canonical: `https://ozikoro.com/author/${slug}/` },
  };
}

export default async function AuthorPage({ params }: PageProps) {
  const { slug } = await params;
  const { articles, total } = await authorArticles(slug, 1);
  if (total === 0) notFound();

  const db = await getDb();
  const byline = await getBylineProfile(db, slug);
  const name = byline?.name ?? articles[0]?.authorName ?? slug;

  /*
   * ⚠️ **THE HANDLES ARE READ ONLY WHERE THE RECORD LINKS AN ACCOUNT, AND TODAY THAT IS NOBODY.**
   *
   * `listMemberSocial` is asked for `byline.accountId`, which `decideContributorClaim` sets when — and only
   * when — an editor approves a claim. **Measured on the live database: zero of the sixteen bylines are
   * linked to an account, and zero claims have been made.** So this block renders for nobody today, and it is
   * written anyway because the alternative is a biography that a writer edits on `/account/` and cannot see
   * on their own byline page the moment their claim IS approved. It costs one indexed query on a page that
   * already makes four.
   *
   * **THE LINK IS NOT MADE ON A MATCHING NAME.** The same rule this page's header already states: a name is
   * neither unique nor secret, which is why `/claims/` exists and why an editor decides. A page that joined
   * on the name would be attributing 1,051 published records to whoever shares a byline.
   */
  const bylineSocial = byline?.accountId ? await listMemberSocial(db, byline.accountId) : [];

  /*
   * ⚠️ THE PORTRAIT IS FILTERED TO WHAT THIS SITE CAN ACTUALLY SERVE, AND THAT IS NOT BELT-AND-BRACES.
   *
   * The `<img>` below used `byline.avatarUrl` directly and this page's own header promised it was "the
   * author's own portrait … never a Gravatar default". **That promise is a property of the DATA, not of the
   * page**, and measured in this checkout it is false: one of the 16 byline rows still carries
   * `https://secure.gravatar.com/avatar/…?d=mm&r=g`, on the row behind 314 published records. The page would
   * have drawn a request this site's CSP (`img-src 'self' data: https://i.ytimg.com`) REFUSES — a broken-image
   * box where a person's face belongs, which is the exact fault an agent measured on `/researchers/` when 22
   * Gravatar avatars were refused.
   *
   * `sameOriginPortrait` returns the value only when it is a path this site serves, so anything from another
   * host falls through to the monogram. **A bad portrait becomes a monogram, never a broken box.**
   */
  const portrait = sameOriginPortrait(byline?.avatarUrl);

  /*
   * The role line reads the research profile where the record links one, and says what the archive holds
   * otherwise — a byline is a contributor to the archive, and "Independent researcher" would be a claim
   * about a person this page has no record for.
   */
  const role =
    byline?.headline ??
    (byline?.institution
      ? `${byline.department ? `${byline.department}, ` : ''}${byline.institution}`
      : 'Contributor to the archive');

  /*
   * `CollectionPage` with `about` a `Person`, not a `ProfilePage`: this is a list of records BY someone,
   * and the archive is not asserting a biography it does not hold. The same reasoning as the subject
   * pages — describe the list, do not claim the thing.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${name} — records in the Ozikoro archive`,
    about: { '@type': 'Person', name },
    url: `https://ozikoro.com/author/${slug}/`,
    isPartOf: { '@type': 'Collection', name: 'The Ozikoro archive', url: 'https://ozikoro.com/archive/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: total },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <div className="profile-head">
          {portrait ? (
            /* A portrait this site serves. See `portrait` above for why an external address is not drawn. */
            <img className="avatar" src={portrait} alt={`Portrait of ${name}`} />
          ) : (
            <p className="avatar" role="img" aria-label={`Monogram for ${name}: no portrait has been supplied`}>
              {initials(name)}
            </p>
          )}
          <div>
            <p className="eyebrow">Contributor</p>
            <h1 style={{ fontSize: 'var(--t-2xl)' }}>{name}</h1>
            <p
              className="lede"
              style={{ marginTop: 'var(--s-2)', fontSize: 'var(--t-base)', fontFamily: 'var(--font-sans)' }}
            >
              {role}
            </p>
            <div className="chips" style={{ marginTop: 'var(--s-4)' }}>
              <span className="chip chip-source">
                {n(total)} {total === 1 ? 'record' : 'records'} in the archive
              </span>
              {byline?.researchInterests?.length ? (
                <span className="chip">
                  {byline.researchInterests.length}{' '}
                  {byline.researchInterests.length === 1 ? 'research interest' : 'research interests'}
                </span>
              ) : null}
            </div>
            <div className="row" style={{ marginTop: 'var(--s-5)' }}>
              {/*
                THE RESEARCH PROFILE, WHERE THE RECORD LINKS ONE. `account_id` is set only when an editor
                approves a claim, so this is a link the record supports rather than a join on a name — and
                where there is no such link the page offers the claim instead of a profile that would be a
                guess. `/researchers/` is the directory either way.
              */}
              {byline?.accountId ? (
                <Link className="btn" href={`/researchers/${byline.accountId}/`}>
                  Research profile
                </Link>
              ) : (
                <Link className="btn btn-quiet" href="/claims/">
                  Claim this byline
                </Link>
              )}
              <Link className="btn btn-quiet" href="/researchers/">
                All researchers
              </Link>
            </div>
          </div>
        </div>

        {/*
          THE STAT ROW IS THE DESIGN'S, WITH THE NUMBERS THIS RECORD HOLDS. The design draws four; a byline
          has three facts here and the page prints three, because a stat that says nothing is worse than a
          shorter row.
        */}
        <div
          className="stat-row"
          style={{ marginTop: 'var(--s-7)', paddingTop: 'var(--s-5)', borderTop: '1px solid var(--rule)' }}
        >
          <p className="stat">
            <b>{n(total)}</b>
            <span>{total === 1 ? 'Record in the archive' : 'Records in the archive'}</span>
          </p>
          <p className="stat">
            <b>{byline?.bio ? 'Yes' : 'None'}</b>
            <span>Biography supplied</span>
          </p>
          <p className="stat">
            {/*
              THE COUNT AGREES WITH THE HEAD, WHICH IS THE POINT. It read `byline.avatarUrl`, so a byline whose
              stored portrait is a Gravatar address reported "Yes" above a monogram. **A figure that disagrees
              with the thing beside it is worse than no figure**, so this reads the same filtered value the
              portrait itself does.
            */}
            <b>{portrait ? 'Yes' : 'Monogram'}</b>
            <span>Portrait supplied</span>
          </p>
        </div>
      </div>

      {byline?.bio ? (
        <div className="wrap section" style={{ paddingTop: 0 }}>
          <section>
            <p className="eyebrow">About</p>
            <div className="prose">
              <p>{byline.bio}</p>
            </div>
          </section>
        </div>
      ) : null}

      {/*
        ── WHERE THE WRITER PUBLISHES ELSEWHERE ──────────────────────────────────────────────────────────

        ⚠️ **THIS RENDERS FOR NOBODY IN THE ARCHIVE TODAY, AND THAT IS A MEASURED FACT RATHER THAN AN
        OVERSIGHT.** `bylineSocial` is read from the account the record links, and no byline has one — zero of
        sixteen. See the note where it is read. It is written now so that the moment an editor approves a
        claim the whole profile arrives at once rather than the biography arriving and the handles not.

        The `href` is built by `socialHref` from a constant host, never from the stored value; an unrecognised
        handle falls to the `<span>`, which is a handle shown and not made clickable. Exact same rule and the
        same function as `/researchers/<id>/`, deliberately — two renderers of one value is where a security
        rule gets fixed in one place.
      */}
      {bylineSocial.length > 0 ? (
        <div className="wrap section" style={{ paddingTop: 0 }}>
          <section>
            <p className="eyebrow">Elsewhere</p>
            <ul className="chips">
              {bylineSocial.map((handle) => {
                const href = socialHref(handle.network, handle.username);
                return (
                  <li key={handle.network}>
                    {href ? (
                      <a className="chip" href={href} rel="noopener noreferrer">
                        {handle.label} · {handle.username}
                      </a>
                    ) : (
                      <span className="chip">
                        {handle.label} · {handle.username}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}

      <div className="wrap" style={{ paddingTop: 0, paddingBottom: 0 }}>
        {/*
          THE WRITER'S OWN DOOR, SAID WHERE A WRITER WOULD LOOK FOR IT.

          *"especially writers to change their bio"* — so the byline page states where the biography and the
          picture are edited, and states the one thing about it that is not yet true: until a claim is approved
          the biography above is the one the WordPress import brought across, not one this person has written.
        */}
        <p className="small muted">
          {byline?.accountId ? (
            <>
              This is {name}&rsquo;s own byline — the biography and picture above are the ones they set on their
              account, and they can change them at <Link href="/account/">their account page</Link>.
            </>
          ) : (
            <>
              Written by {name}. No account is linked to this byline yet, so nobody can correct the biography
              above from this site.{' '}
              <Link href="/claims/">If this is your work, claim the byline</Link> — once an editor approves it,
              the biography, the picture and any social handles on that account appear here.
            </>
          )}
        </p>
      </div>

      <div className="wrap section" style={{ paddingTop: 0 }}>
        <p className="eyebrow">Records</p>
        <div className="grid cards">
          {articles.map((a) => (
            <ArticleEntry key={a.id} article={a} />
          ))}
        </div>

        {total > PER_PAGE ? (
          <p className="small muted">
            Showing the first {PER_PAGE} of {total}. <Link href="/archive/">Browse the whole archive</Link>.
          </p>
        ) : null}
      </div>
    </>
  );
}
