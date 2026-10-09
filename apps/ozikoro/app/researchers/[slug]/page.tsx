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
  getOwnResearcher,
  getProfileForEditing,
  getResearcher,
  getResearcherBio,
  listByAccount,
  listMemberSocial,
  socialHref,
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

  /*
   * The signed-in account is resolved BEFORE the profile, because it decides which question is asked.
   * The public reader filters on `is_public = true`; the owner's own view must not, or clearing the
   * visibility box would hide from a person the only screen that can put it back. See
   * `getOwnResearcher`.
   */
  const current = await getCurrentAccount();
  const viewerId = current?.account.id ?? null;

  const researcher =
    (await getResearcher(db, id)) ?? (viewerId === id ? await getOwnResearcher(db, id) : null);
  if (!researcher) notFound();

  const [bio, works, editable, social] = await Promise.all([
    getResearcherBio(db, id),
    listByAccount(db, id, { includePrivate: false }),
    viewerId === id ? getProfileForEditing(db, id) : Promise.resolve(null),
    /*
     * THE HANDLES THE PERSON PUBLISHED, READ FOR EVERYBODY WHO MAY SEE THE PROFILE.
     *
     * They are the same public record as the biography and the picture — the person typed them on
     * `/account/` and asked to be found by them — so this is not gated on the viewer. A handle has no
     * visibility of its own and giving it one would be a third place for "is this profile public" to be
     * decided, which is the fault the two existing readers (`getResearcher` / `getOwnResearcher`) exist to
     * keep to one place.
     */
    listMemberSocial(db, id),
  ]);

  /*
   * THE FOLLOW STATE IS READ FOR THE READER, AND ONLY FOR THE READER.
   *
   * A signed-out visitor gets the follower COUNT and no button: the count is a fact about a public
   * profile, and whether *you* follow somebody is a fact about your own reading list. So the two
   * queries are asked separately — `countFollowers` always, `followsResearcher` only when there is
   * somebody signed in — rather than one query that returns a state the page would then hide.
   */
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
        {/*
          THE PERSON'S OWN PICTURE, WHERE THEY HAVE UPLOADED ONE.

          ⚠️ **THIS DREW A MONOGRAM FOR EVERYBODY, INCLUDING THE PEOPLE WHO HAD SET A PICTURE.** The page read
          no picture at all — `researcher.avatarUrl` did not exist — while `/researchers/` one link away drew
          real portraits for the writers, so a person's own profile page showed their initials beside a link to
          a directory that showed their face. The picture comes from the archive's own media store through
          `account.avatar_url`; see `setOwnAvatarUrl` for the write and `storePicture` for why it is an upload
          into this archive rather than a Gravatar address — **the CSP allows `img-src 'self'` and refuses an
          external avatar host**, which was measured on this very page: 22 Gravatar avatars refused here.

          A monogram where none is set, never a stock face — the rule `/researchers/` already states about
          Gravatar's `d=mm` silhouette, and the reason `alt` names whose picture it is either way.
        */}
        {researcher.avatarUrl ? (
          <img className="avatar" src={researcher.avatarUrl} alt={`Portrait of ${researcher.name}`} />
        ) : (
          <p className="avatar" aria-hidden="true">{initials(researcher.name)}</p>
        )}
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
              /*
               * THE OWNER'S OWN PROFILE, AND THE SCREEN THAT DID NOT EXIST.
               *
               * The database has modelled credentials, institution, research interests and visibility
               * since migration 0037 and the library has implemented the update since the same round —
               * but nothing ever called it, so a researcher could be listed and could deposit work and
               * could not write a single word about themselves. The empty state this page shows is an
               * invitation; this is the door it invites you through.
               *
               * `<details>` rather than a modal or a separate route: it is keyboard-operable with no
               * JavaScript, which is the pattern the dashboard brief names for disclosure, and it keeps
               * the profile itself the first thing on the page.
               */
              <details className="notice" style={{ marginTop: 'var(--s-2)' }}>
                <summary>Edit your profile</summary>
                <form method="post" action="/api/research" className="stack" style={{ marginTop: 'var(--s-4)' }}>
                  <input type="hidden" name="action" value="profile" />
                  <input type="hidden" name="returnTo" value={`/researchers/${id}/`} />

                  <p className="wpfield">
                    <label htmlFor="headline">Headline</label>
                    <input id="headline" name="headline" type="text" maxLength={200}
                      defaultValue={researcher.headline ?? ''}
                      placeholder="e.g. Lecturer in Igbo history" />
                  </p>

                  <p className="wpfield">
                    <label htmlFor="institution">Institution</label>
                    <input id="institution" name="institution" type="text" maxLength={200}
                      defaultValue={researcher.institution ?? ''} />
                    <span className="wphelp">Leave empty if you work independently. It is not required.</span>
                  </p>

                  <p className="wpfield">
                    <label htmlFor="department">Department</label>
                    <input id="department" name="department" type="text" maxLength={200}
                      defaultValue={researcher.department ?? ''} />
                  </p>

                  <p className="wpfield">
                    <label htmlFor="orcid">ORCID iD</label>
                    <input id="orcid" name="orcid" type="text" maxLength={40}
                      defaultValue={researcher.orcid ?? ''} placeholder="0000-0002-1825-0097" />
                    <span className="wphelp">
                      Recorded as you give it. It is your identifier and is not validated here.
                    </span>
                  </p>

                  <p className="wpfield">
                    <label htmlFor="website">Website</label>
                    <input id="website" name="website" type="url" maxLength={300}
                      defaultValue={editable?.website ?? ''} placeholder="https://" />
                  </p>

                  <p className="wpfield">
                    <label htmlFor="bio">About your work</label>
                    <textarea id="bio" name="bio" rows={6} maxLength={5000}
                      defaultValue={editable?.bio ?? ''} />
                  </p>

                  <p className="wpfield">
                    <label htmlFor="researchInterests">Research interests</label>
                    <input id="researchInterests" name="researchInterests" type="text" maxLength={1000}
                      defaultValue={researcher.researchInterests.join(', ')}
                      placeholder="Igbo history, Oral tradition" />
                    <span className="wphelp">Separate them with commas.</span>
                  </p>

                  <p className="wpfield">
                    <label htmlFor="isPublic">
                      <input id="isPublic" name="isPublic" type="checkbox" value="1"
                        defaultChecked={editable?.isPublic ?? true} />{' '}
                      List my profile in the researchers directory
                    </label>
                    <span className="wphelp">
                      Unchecking hides you from the directory. Your profile stays visible to you, so you
                      can turn it back on.
                    </span>
                  </p>

                  <p><button className="btn" type="submit">Save profile</button></p>
                </form>
              </details>
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

      {bio.website || social.length > 0 ? (
        <section className="section">
          <p className="eyebrow">Elsewhere</p>
          {bio.website ? (
            <p className="small"><a href={bio.website} rel="noopener noreferrer">{bio.website}</a></p>
          ) : null}
          {/*
            ── THE HANDLES, AS LINKS, BUILT FROM A CONSTANT HOST ──────────────────────────────────────────

            ⚠️ **THE `href` IS NOT THE STORED VALUE AND MUST NEVER BE.** It is assembled by `socialHref` from
            the network's own template in `member-social.ts` — `https://x.com/<handle>` and so on — over a
            handle that passed `SOCIAL_USERNAME_PATTERN`. **The reader supplies a handle, never a
            destination**, so no row in the table can send a reader to a host the archive did not choose; and
            the same pattern is a `check` constraint on the column, so a value that could escape the host
            cannot be stored by any path, not merely by this application.

            ⚠️ **AND AN UNRECOGNISED HANDLE RENDERS AS TEXT, NOT AS A LINK.** `socialHref` returns `null` for
            an unknown network, an empty handle or one that fails the pattern — a row written before the
            constraint existed, or by hand — and the `null` branch below prints the handle with no `<a>` around
            it. **That is the failing-safe shape the brief asks for**: the profile still draws, the handle is
            still visible, and nothing that could not be addressed becomes clickable.

            ⚠️ **NO `target="_blank"`.** The archive's other external links do not use one, and a profile's
            own links keeping the reader in the same tab is the browser's decision to make rather than this
            page's. `rel="noopener noreferrer"` is here because the destination is a third-party origin.
          */}
          {social.length > 0 ? (
            <ul className="chips" style={{ marginTop: 'var(--s-3)' }}>
              {social.map((handle) => {
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
          ) : null}
        </section>
      ) : null}

      <p className="actions section">
        <Link className="btn" href="/researchers">All researchers</Link>
        <Link className="btn btn-quiet" href="/publications">All research</Link>
      </p>
    </div>
  );
}
