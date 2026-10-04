import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { capabilitiesFor, dashboardModeHref, dashboardModesFor } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import { mayEnterBackOffice } from '@/lib/access';

/**
 * The Ozikoro administrator's area.
 *
 * The guard is here rather than in each page, so a page added later cannot forget it: a layout
 * runs for everything beneath it. Signed out is sent to sign in, because that is something a
 * person can fix; signed in without the role is told plainly, because it is not.
 *
 * Every page below is `no-store` by way of the `X-Robots-Tag` and `Cache-Control` headers set in
 * `next.config.ts`, and this layout marks the whole area `noindex` as well.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozikoro administration',
  robots: { index: false, follow: false },
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  owner: 'Owner',
  editor: 'Editor',
  contributor: 'Contributor',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentAccount();
  /*
   * The return path is the page the reader ACTUALLY asked for, not a fixed one.
   *
   * Round 129 measured all four admin routes redirecting with `next=%2Fadmin%2Fspotify` — the last entry
   * in this layout's own nav, so it reads as a copy-paste. An editor who asked for `/admin/rights/` and
   * signed in was sent to `/admin/spotify/` instead: the guard was right and the destination was wrong.
   *
   * The middleware already sets `x-pathname` for exactly this, and the root layout reads it the same way.
   */
  const requestedPath = (await headers()).get('x-pathname') ?? '/admin/';
  if (!current) {
    redirect(
      `/signin?error=${encodeURIComponent('Sign in to reach the administration.')}` +
        `&next=${encodeURIComponent(requestedPath)}`
    );
  }

  const { account } = current;
  /*
   * Entry to the back office is a permission, not a role name. The dictionary's administrator holds
   * every capability (see `capabilitiesFor`), so they come in as before; an Ozikoro editor, expert
   * reviewer or moderator also comes in, because the editorial queue is theirs. What each screen
   * then shows is gated separately, so being allowed through this door does not grant the user table.
   *
   * `review_audio` is named here too, and it is the one that would otherwise lock out the person the
   * owner asked for. **An editor granted special access to the audio files holds exactly that
   * capability and no other** — no `edit_entity`, no `moderate`, no `expert_review` — so without this
   * line the audio review queue would be unreachable by the only account meant to work it, and the
   * queue would look deliberate while nobody could open it.
   */
  const db = await getDb();
  const capabilities = await capabilitiesFor(db, account.id);
  /*
   * THE RULE LIVES IN `mayEnterBackOffice`, WHICH EVERY ADMIN PAGE ALSO CALLS.
   *
   * It was written out here as five terms inline. **A page must ask the same question before it renders**,
   * because React renders a layout and its children concurrently and this layout's redirect therefore does
   * not keep a page's output out of the response body — so the test now exists twice by necessity, and a
   * second hand-written copy here is a drift waiting to open a door this function closes.
   */
  if (!mayEnterBackOffice(account.role, capabilities)) {
    return (
      <div className="admin-shell" style={{ maxWidth: '38rem', paddingTop: '3rem' }}>
        <header className="page-header">
          <div className="page-header__text">
            <p className="page-header__kicker">Administration</p>
            <h1 className="page-header__title">Not your door</h1>
            <p className="page-header__lede">
              This is the working area, and it opens for editors, expert reviewers, moderators, audio
              reviewers and administrators. You are signed in as {ROLE_LABEL[account.role] ?? account.role} with no
              Ozikoro role yet, so there is nothing here for you — an administrator can grant one.
            </p>
          </div>
        </header>
        <p className="actions">
          <Link className="btn" href="/">
            Back to Ozikoro
          </Link>
        </p>
      </div>
    );
  }

  const label = account.displayName ?? account.email;

  /*
   * THE WAY BACK TO THE WORKSPACES, BECAUSE A DOOR THAT ONLY OPENS INWARDS IS HALF A DOOR.
   *
   * The owner's words were *"and to admin mode anytime they want"*, and the other half of that is getting
   * out again: until now the administration's navigation listed twelve sections and not one of them led to
   * a dashboard. **A person who arrived from a workspace had no route back to one.**
   *
   * The list is the same allow-list the dashboards' own switch is built from — `dashboardModesFor` — so an
   * editor is offered the editorial desk and the publishing workflow, a moderator the moderation queue, and
   * the owner every workspace the archive draws. **It is not a second list that could disagree with the
   * first**, and nothing here widens what anybody may do: every entry is a screen the account's own
   * capabilities already open, and the screen refuses anyone whose capabilities do not.
   */
  const workspaces = dashboardModesFor({ platformRole: account.role, capabilities });

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="admin-bar">
        <div className="admin-bar__inner">
          <Link href="/admin">Ozikoro administration</Link>
          <span className="admin-bar__who">
            {label} · {ROLE_LABEL[account.role] ?? account.role}
          </span>
          <form method="post" action="/api/auth/signout">
            <button className="btn btn--sm" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
      <nav className="admin-nav" aria-label="Sections">
        <div className="admin-nav__inner">
          <Link href="/admin">Overview</Link>
          <Link href="/admin/archive">Editorial queue</Link>
          <Link href="/admin/entities">Knowledge graph</Link>
          <Link href="/admin/reviews">Review queue</Link>
          <Link href="/admin/audio">Audio review</Link>
          <Link href="/admin/pronunciation">Pronunciations and credits</Link>
          <Link href="/admin/media">Media register</Link>
          <Link href="/admin/rights">Media rights</Link>
          <Link href="/admin/claims">Claims</Link>
          <Link href="/admin/users">Users</Link>
          <Link href="/admin/audit">Audit trail</Link>
          {/*
            THE TRASH SITS WITH THE QUEUES, NOT BESIDE SPOTIFY.

            Restoring a deleted record is an editor's work — the owner's rule is that an editor "can recover or
            do anything" — so the screen is part of the editorial round rather than an owner's tool. **Only the
            destroy button on it is not the editor's**, and that is a control the screen withholds rather than
            the screen itself, which is why this link is not hidden from an editor.
          */}
          <Link href="/admin/trash">Trash</Link>
          {/*
            THE DESIGN EDITOR IS LAST BUT NOT LEAST.

            It is the only screen whose edits are visible to every reader rather than to the archive's own
            queues — so it sits beside Spotify, which is the other screen that changes the site rather than its
            content. **Under the owner's current rule an editor may reach it too**: the rule is "everything
            except purging the trash", and migration 0055 grants `manage_design` accordingly. An earlier and
            narrower instruction would have made it admin-only; that instruction was withdrawn, and a parallel
            round that decided otherwise is flagged in the round's report so the two agree.
          */}
          <Link href="/admin/design">The design</Link>
          <Link href="/admin/spotify">Spotify</Link>
        </div>
      </nav>
      {workspaces.length > 0 && (
        <nav className="admin-nav admin-workspaces" aria-label="Workspaces">
          <div className="admin-nav__inner">
            <span className="admin-workspaces__label">Your workspaces</span>
            {workspaces.map((mode) => (
              <Link key={mode.mode} href={dashboardModeHref(mode)}>
                {mode.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
      <main className="admin-shell" id="main">
        {children}
      </main>
    </>
  );
}
