/**
 * Account and profile — the member's own record.
 *
 * A REAL GATED ROUTE, NOT A DEMONSTRATION
 *
 * The design's screen carries a banner: *"Dashboard design demonstration — all records and statuses are
 * example material."* This page shows **the signed-in account's actual record** — its address, display name,
 * role and the capabilities that role resolves to — because that is the one thing an account page can state
 * without inventing anything. The design's four sections (identity, privacy, languages, security) are kept as
 * structure, and each says what it will hold.
 *
 * THE GATE IS THE SAME ONE THE ADMINISTRATION USES
 *
 * `getCurrentAccount()` from `@/lib/session`, then a redirect to `/signin` carrying the requested path so a
 * reader arrives back where they were. Roles and capabilities come from `capabilitiesFor`, which resolves
 * them in the database — **never from a cookie, and never from anything the browser sends.**
 *
 * WHAT IT OFFERS, AND WHAT IT STILL DOES NOT
 *
 * It offers **two real operations**:
 *
 *   1. **editing your own public profile** — the biography, the picture and the social handles — which is
 *      what the owner asked for in as many words: *"people should be able to edit their profiles, especially
 *      writers to change their bio, or profile pictures and social media networks username."* The write is
 *      `POST /api/account/profile`; where each field appears to a reader is stated on the page itself rather
 *      than left to be discovered.
 *   2. **changing your own password**, which is required to prove the current one first. That was missing,
 *      and the owner reported it in as many words — *"why is users not able to change their passwords?
 *      everyone should be able to change their passwords."* Until this form existed the only way to replace
 *      a password on the archive was `/forgot/`, which needs an email to arrive and costs the person every
 *      session they had.
 *
 * No "delete account" and no notification toggles. Each is a real operation with a real consequence, and a
 * control that appears to work and does not is worse than one that is absent. The page says so where a reader
 * would look for them.
 *
 * ⚠️ AND THE IDENTITY CARD BELOW USED TO SAY THE OPPOSITE OF WHAT THIS PAGE NOW DOES. It read *"Your display
 * name and biography are not editable here yet. The archive does not accept a public identity it cannot
 * attribute, so this opens when the editorial process behind it does."* **That was true when it was written
 * and this page makes it false**, so it has been rewritten to say what is actually true — including the one
 * part of the old sentence that is still true, which is the attribution rule: a byline is claimed and
 * reviewed, and a matching name is not proof. See the note under the profile form.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { MIN_PASSWORD_LENGTH } from '@ozituma/db/accounts';
import {
  SOCIAL_NETWORKS,
  capabilitiesFor,
  getMember,
  getOwnProfileForEditing,
  socialHref,
} from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account & profile',
  description: 'Your Ozikoro account: identity, privacy, languages and security.',
  robots: { index: false, follow: false },
  alternates: { canonical: 'https://ozikoro.com/account' },
};

/** The four sections the design names, in its order. */
const SECTIONS: Array<{ n: string; title: string; promise: string; body: string }> = [
  {
    n: '01',
    title: 'Identity',
    promise: 'Name, public biography and verified affiliations.',
    body:
      'Your display name, your public biography and your picture are edited above, and the addresses you ' +
      'publish elsewhere are entered there too. Verified affiliations are not collected yet — this archive ' +
      'will not print a credential it has not checked.',
  },
  {
    n: '02',
    title: 'Privacy',
    promise: 'Profile visibility and contact preferences.',
    body:
      'The visibility box above decides whether your profile is listed in the researchers directory, and it ' +
      'takes effect the moment you save. The address you signed up with is never shown. Contact preferences ' +
      'are not collected yet.',
  },
  {
    n: '03',
    title: 'Languages',
    promise: 'Reading, writing and translation languages.',
    body:
      'Which languages you read, write and translate is what routes work to you, and it is not collected ' +
      'yet. It will be asked for here rather than inferred.',
  },
  {
    n: '04',
    title: 'Security',
    promise: 'Sessions, sign-in methods and account recovery.',
    body:
      'Your password is changed below, and changing it signs out every other device that was signed in. ' +
      'If you have forgotten it instead, the sign-in page sends a recovery link that works once.',
  },
];

/** `IE` from `Idenze Ezeme` — the same monogram `/author/<slug>/` and `/researchers/` draw. */
function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentAccount();
  const requestedPath = (await headers()).get('x-pathname') ?? '/account/';

  if (!current) {
    redirect(
      `/signin?error=${encodeURIComponent('Sign in to see your account.')}` +
        `&next=${encodeURIComponent(requestedPath)}`
    );
  }

  const { account } = current;
  const db = await getDb();
  const [capabilities, member, profile] = await Promise.all([
    capabilitiesFor(db, account.id),
    getMember(db, account.id),
    getOwnProfileForEditing(db, account.id),
  ]);

  /*
   * What each social field currently holds, so the form pre-fills from the record rather than from anything
   * the browser sent. `profile.social` is already ordered by the network list, so this is a lookup rather
   * than a second ordering.
   */
  const socialValue = (field: string): string => {
    const network = SOCIAL_NETWORKS.find((n) => n.field === field);
    return network ? (profile.social.find((h) => h.network === network.key)?.username ?? '') : '';
  };

  const profileName = profile.displayName ?? account.displayName ?? account.email;

  return (
    <div className="wrap section">
      <p className="eyebrow">
        <Link href="/">Ozikoro workspace</Link>
      </p>
      <h1>Account &amp; profile</h1>
      <p className="lede">Control identity, affiliations, language, access and notifications.</p>

      <section className="section">
        <h2>Your record</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Email</th>
              <td>{account.email}</td>
            </tr>
            <tr>
              <th scope="row">Display name</th>
              <td>
                {account.displayName ?? <span className="unsourced">Not set</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">Role</th>
              <td>{account.role}</td>
            </tr>
            <tr>
              <th scope="row">Membership</th>
              <td>
                {member ? `${member.status}, since ${String(member.createdAt).slice(0, 10)}` : 'No member record'}
              </td>
            </tr>
            <tr>
              <th scope="row">Capabilities</th>
              <td>
                {capabilities.size > 0 ? (
                  <span className="small">{[...capabilities].sort().join(' · ')}</span>
                ) : (
                  <span className="unsourced">None</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Capabilities are resolved from the database each time this page loads, from the role above — never
          from anything your browser sends.
        </p>
      </section>

      {/*
        ── YOUR PUBLIC PROFILE: THE BIOGRAPHY, THE PICTURE AND THE HANDLES ──────────────────────────────

        THE OWNER'S REQUEST, AND THE THREE THINGS IT NAMES. *"people should be able to edit their profiles,
        especially writers to change their bio, or profile pictures and social media networks username."*
        This form is all three, for any signed-in account, and it is the write half of the feature — the read
        half is `/researchers/<id>/` and `/author/<slug>/`, and the note under the form says which.

        ⚠️ THE PICTURE GOES THROUGH THE ARCHIVE'S OWN MEDIA STORE, NOT A SECOND UPLOAD MECHANISM. The form
        posts multipart to `POST /api/account/profile`, and that route writes an `ozikoro_media` row, puts the
        bytes through `getStorage()`, names the key `ozikoro/<id>-<file>` and stores `/media/<key>` on
        `account.avatar_url` — the same row, the same driver, the same key shape and the same serving route
        the WordPress importer and the editor's media picker already use. **A Gravatar or any other external
        avatar host is refused by this site's own CSP**, which allows `img-src 'self' data: https://i.ytimg.com`
        and the advertisement origins and nothing else — an agent measured 22 Gravatar avatars being refused on
        `/researchers/`. Uploading here is both the simpler answer and the one that keeps the reader's picture
        in the archive. See `storePicture` in the route for the full list of orderings.

        ⚠️ AND NOTHING HERE ACCEPTS AN ACCOUNT ID. The account is the session's; the route takes the id from
        `getCurrentAccount()` and from no field of this form, so this page can only ever edit the profile of
        the person looking at it. There is no "current password" field for that reason — see `saveOwnProfile`
        for why the bar here is deliberately lower than the password form's below it.

        ⚠️ `encType` IS SPELLED `encType` AND MUST BE, because this is JSX: React writes the attribute the
        DOM needs from that prop, and the lowercase HTML spelling is a React warning rather than an upload.
      */}
      <section className="section" id="profile">
        <h2>Your public profile</h2>
        <p className="muted">
          This is what a reader sees beside your name. It is your own record: only you can change it, and the
          account comes from your session rather than from anything this form sends.
        </p>

        {params.saved ? (
          <div className="notice notice--success" role="status">
            <div>
              <p className="notice__body">{params.saved}</p>
            </div>
          </div>
        ) : null}

        {params.error ? (
          <div className="notice notice--error" role="alert">
            <div>
              <p className="notice__body">{params.error}</p>
            </div>
          </div>
        ) : null}

        <form method="post" action="/api/account/profile" encType="multipart/form-data">
          <input type="hidden" name="action" value="save" />

          <div className="field">
            <span className="small">Profile picture</span>
            <div className="row" style={{ alignItems: 'center', gap: 'var(--s-4)' }}>
              {profile.pictureUrl ? (
                /* The picture the archive itself serves, at its own address — never an external host. */
                <img
                  className="avatar"
                  src={profile.pictureUrl}
                  alt={`Profile picture of ${profileName}`}
                  width={96}
                  height={96}
                />
              ) : (
                <p className="avatar" aria-hidden="true">
                  {initials(profileName)}
                </p>
              )}
              <div>
                <label className="small" htmlFor="picture">
                  {profile.pictureUrl ? 'Replace it' : 'Add one'}
                </label>
                <input id="picture" name="picture" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" />
                <p className="wphelp">
                  JPEG, PNG, GIF, WebP or AVIF, up to 4 MB. It is stored in the archive and served from this
                  site, which is the only kind of picture this site&rsquo;s security policy will draw. An SVG is
                  refused: it is the one image format that can carry a script.
                </p>
              </div>
            </div>
          </div>

          <div className="field">
            <label className="small" htmlFor="displayName">
              Display name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              maxLength={120}
              defaultValue={profile.displayName ?? ''}
              placeholder={account.displayName ?? account.email}
              className="search-input"
            />
            <p className="wphelp">
              The name shown on your profile and beside your work. Empty keeps the name on your account.
            </p>
          </div>

          <div className="field">
            <label className="small" htmlFor="bio">
              Biography
            </label>
            <textarea id="bio" name="bio" rows={6} maxLength={5000} defaultValue={profile.bio ?? ''} />
            <p className="wphelp">
              Who you are and what you work on. It appears in full on your public profile page.
            </p>
          </div>

          <div className="field">
            <label className="small" htmlFor="website">
              Your own website
            </label>
            <input
              id="website"
              name="website"
              type="url"
              maxLength={300}
              defaultValue={profile.website ?? ''}
              placeholder="https://"
              className="search-input"
            />
          </div>

          {/*
            ── THE SOCIAL HANDLES, AND THE ONE THING THE FORM MUST SAY ABOUT THEM ────────────────────────

            ⚠️ **A USERNAME, NOT AN ADDRESS.** The owner asked for "social media networks username", and that
            is exactly what is collected: a bare handle. **The address is built from a constant host in
            `member-social.ts` and never from anything typed here**, so no value in this form can change where
            a link goes — `javascript:alert(1)`, a whole pasted URL and a stray quote are all refused, and the
            refusal says which field and why. The `prefix` printed before each box shows what the handle is
            becoming, so nobody has to guess whether to type the `@` or the host. Each box is labelled by the
            network-name text beside it rather than by a placeholder, which is what a screen reader needs.
          */}
          <fieldset className="field">
            <legend className="small">Where else you publish</legend>
            <p className="wphelp">
              Usernames only — not links, and not a whole address. Mastodon is not offered because its address
              carries a server name that would have to come from you, and this form deliberately builds every
              address from a host the archive controls.
            </p>
            {SOCIAL_NETWORKS.map((network) => (
              <div className="field" key={network.key}>
                <label className="small" htmlFor={network.field}>
                  {network.label} <span className="muted">{network.prefix}</span>
                </label>
                <input
                  id={network.field}
                  name={network.field}
                  type="text"
                  maxLength={65}
                  defaultValue={socialValue(network.field)}
                  placeholder="ozikoro"
                  className="search-input"
                />
              </div>
            ))}
          </fieldset>

          <div className="field">
            <label className="small" htmlFor="isPublic">
              <input id="isPublic" name="isPublic" type="checkbox" value="1" defaultChecked={profile.isPublic} />{' '}
              List my profile in the researchers directory
            </label>
            <p className="wphelp">
              Unchecking hides you from the directory. Your profile stays visible to you, so you can turn it
              back on.
            </p>
          </div>

          <button className="btn btn--primary" type="submit">
            Save my profile
          </button>
        </form>

        {profile.pictureUrl ? (
          /* Its own form, because removing a picture is a different act from saving a profile and neither
             should be able to happen by accident while doing the other. */
          <form method="post" action="/api/account/profile" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="remove-picture" />
            <button className="btn btn-quiet" type="submit">
              Remove my picture
            </button>
          </form>
        ) : null}

        {/*
          ── WHERE THIS APPEARS TO A READER, SAID PLAINLY, INCLUDING THE PART THAT DOES NOT YET ──────────

          The brief's rule, and the reason this paragraph exists rather than a link and a hope: *a field that
          writes and changes nothing is the fault the owner keeps finding.* So the page states the two places
          and, where the second one is not reachable yet, why.

          `/researchers/<account.id>/` renders for the owner as soon as a member row exists, which the first
          save creates — so the link is only drawn once it will work. A reader sees it only while the
          visibility box above is ticked, which is the same rule `/researchers/` applies.

          ⚠️ **THE BYLINE IS THE PART THAT IS NOT YET WIRED, AND IT IS NOT WIRED BECAUSE OF A MEASURED FACT
          RATHER THAN AN UNFINISHED JOB.** On the live database **zero of the sixteen bylines are linked to an
          account** — `ozikoro_contributor.account_id` is written only when an editor approves a claim, and no
          claim has been made. A biography here reaches `/author/<slug>/` the moment that claim is approved and
          not before, because the archive's own rule is that a matching name is not proof of identity: the
          alternative to review is that anybody can claim the authorship of 1,051 published records.
        */}
        <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
          {member ? (
            <>
              Your profile is at{' '}
              <Link href={`/researchers/${account.id}/`}>/researchers/{account.id}/</Link> — that is the page a
              reader meets you on, and it carries this biography, this picture and these handles.{' '}
            </>
          ) : (
            <>Saving this creates your public profile page. </>
          )}
          {profile.bylines.length > 0 ? (
            <>
              Your byline{profile.bylines.length === 1 ? '' : 's'} on the archive:{' '}
              {profile.bylines.map((b, i) => (
                <span key={b.slug}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/author/${b.slug}/`}>{b.name}</Link>
                </span>
              ))}
              . The same biography, picture and handles appear there too.
            </>
          ) : (
            <>
              You have no byline on the archive yet.{' '}
              <Link href="/claims/">Claim the byline your work was published under</Link> and an editor will
              check it — once it is approved, this profile appears on that byline&rsquo;s page as well. Until
              then the biography and picture below appear on your profile page only, and the byline pages still
              carry the biography the WordPress import brought across.
            </>
          )}
        </p>

        {profile.social.length > 0 ? (
          <p className="small muted">
            Showing as:{' '}
            {profile.social.map((handle, i) => {
              const href = socialHref(handle.network, handle.username);
              return (
                <span key={handle.network}>
                  {i > 0 ? ' · ' : ''}
                  {href ? (
                    <a href={href} rel="noopener noreferrer">
                      {handle.label} · {handle.username}
                    </a>
                  ) : (
                    /* An unrecognised handle is SHOWN and not linked — see `socialHref`. */
                    `${handle.label} · ${handle.username} (not a link)`
                  )}
                </span>
              );
            })}
          </p>
        ) : null}
      </section>

      {/*
        CHANGE YOUR OWN PASSWORD — THE OPERATION THE OWNER REPORTED AS MISSING.

        IT ASKS FOR THE CURRENT PASSWORD, WHICH IS NOT FRICTION FOR ITS OWN SAKE. This is a *change*, not a
        *reset*: the person is already signed in, so a form that accepted only a new password would turn any
        borrowed session — an unlocked machine, a copied cookie — into a permanent account takeover, because
        the real owner would be locked out by a password they never chose. `changeOwnPassword` refuses to write
        without the current one and this form has to supply it.

        THE SESSION SURVIVES. `writePassword` closes every session on the account except the token that made
        the change, so the person stays signed in here and every other device is signed out. The success
        message says exactly that, because "signed out everywhere" and "signed out everywhere except here" are
        different promises and the reader is entitled to the true one.
      */}
      <section className="section" id="password">
        <h2>Change your password</h2>
        <p className="muted">
          You are signed in, and this still asks for the password you have now. That is deliberate: a session
          left open on a shared machine must not be enough to lock you out of your own account.
        </p>

        {params.changed ? (
          <div className="notice notice--success" role="status">
            <div>
              <p className="notice__body">
                Your password is changed. Every other device that was signed in has been signed out; this one
                is still signed in.
              </p>
            </div>
          </div>
        ) : null}

        {params.error ? (
          <div className="notice notice--error" role="alert">
            <div>
              <p className="notice__body">{params.error}</p>
            </div>
          </div>
        ) : null}

        <form method="post" action="/api/auth/change-password">
          <div className="field">
            <label className="small" htmlFor="currentPassword">
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="search-input"
            />
          </div>

          <div className="field">
            <label className="small" htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
            />
            {/*
              The policy, stated in the same words the other two password forms state it. `MIN_PASSWORD_LENGTH`
              is imported rather than typed as `10`, so the sentence cannot disagree with the rule
              `assertPasswordAcceptable` actually enforces.
            */}
            <p className="wphelp">
              At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule — no symbols to remember, and
              a phrase is fine.
            </p>
          </div>

          <div className="field">
            <label className="small" htmlFor="confirmPassword">
              The same new password again
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
            />
          </div>

          <button className="btn btn--primary" type="submit">
            Change the password
          </button>
        </form>
      </section>

      <section className="section">
        <h2>What you can change</h2>
        <div className="grid">
          {SECTIONS.map((section) => (
            <div className="card" key={section.n}>
              <p className="eyebrow">{section.n}</p>
              <h3>{section.title}</h3>
              <p className="muted small">{section.promise}</p>
              <p className="small">{section.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Leaving</h2>
        <p className="muted">
          Signing out ends this session only. There is no self-service account deletion, because deleting an
          account that has contributed records is a decision with an editorial consequence and the archive has
          not settled how it handles it. An operator can close an account and the record of what it
          contributed stays.
        </p>
      </section>
    </div>
  );
}
