import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { capabilitiesFor, dashboardModeHref, dashboardModesFor, GRANT_ACCESS_CAPABILITY } from '@ozikoro/platform';
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

  /*
   * ── THE SECTIONS, ONCE, AND DRAWN AT THE DESIGN'S OWN TWO SHAPES ─────────────────────────────────────
   *
   * The owner: *"i clicked on it to see the admin, and it was completely scattred. this is not exactly as it
   * was in the demo."* The demo is `public/design/screens/dashboard-admin.html`, and it puts these links in
   * **`aside.sx-dash-side` as a vertical `nav.sx-dash-nav`** — not in a horizontal row above the page.
   *
   * What was there instead was `nav.admin-nav` with `flex-wrap: wrap` in `globals.css` and fifteen items in
   * it: **measured at 1280 px it wrapped onto two rows, and the "Your workspaces" strip below it onto two
   * more** — four ragged rows of small links between the reader and the page, which is what a reader means
   * by scattered. The links themselves were all in the right place; the shape they were drawn in was not the
   * design's, and no link has been removed to change it.
   *
   * ⚠️ TWO PLACEMENTS FROM ONE LIST, BECAUSE THE DESIGN HIDES THE RAIL BELOW 60REM. `showcase.css:278` sets
   * `.sx-dash-side { display: none }` and `.sx-mobile-dashnav { display: flex }` at that width. **A rail that
   * is the only menu and is `display:none` on a phone is fifteen unreachable screens**, so the list is a
   * value and both placements read it — a second hand-written list is how a menu loses the screen added to
   * it three rounds later.
   */
  const sections: { href: string; label: string }[] = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/archive', label: 'Editorial queue' },
    { href: '/admin/entities', label: 'Knowledge graph' },
    { href: '/admin/reviews', label: 'Review queue' },
    { href: '/admin/audio', label: 'Audio review' },
    { href: '/admin/pronunciation', label: 'Pronunciations and credits' },
    { href: '/admin/media', label: 'Media register' },
    { href: '/admin/rights', label: 'Media rights' },
    { href: '/admin/claims', label: 'Claims' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/audit', label: 'Audit trail' },
    /*
     * THE TRASH SITS WITH THE QUEUES, NOT BESIDE SPOTIFY.
     *
     * Restoring a deleted record is an editor's work — the owner's rule is that an editor "can recover or do
     * anything" — so the screen is part of the editorial round rather than an owner's tool. **Only the destroy
     * button on it is not the editor's**, and that is a control the screen withholds rather than the screen
     * itself, which is why this link is not hidden from an editor.
     */
    { href: '/admin/trash', label: 'Trash' },
  ];

  /*
   * INSTITUTIONAL ACCESS IS THE ONE SECTION THE NAVIGATION HIDES FROM AN EDITOR.
   *
   * Every other entry here is offered to everyone the layout admits, because the page's own guard answers for
   * it and a hidden link is presentation rather than authorisation. This one is different: **only the `owner`
   * role holds `grant_institutional_access`** — the owner's own decision, and the reason is in
   * `docs/OZIKORO-REMAINING.md` — so the link is drawn only for an account that holds it. The page still
   * guards itself as its first statement, so hiding the link is not what protects it.
   */
  if (capabilities.has(GRANT_ACCESS_CAPABILITY)) {
    sections.push({ href: '/admin/access', label: 'Institutional access' });
  }

  /*
   * THE DESIGN EDITOR, THE SEARCH ENGINES, THEN SPOTIFY — THE THREE THAT CHANGE THE SITE RATHER THAN ITS
   * CONTENT, IN THE ORDER THE NAVIGATION HAS CARRIED THEM.
   *
   * `/admin/design/` is the only screen whose edits are visible to every reader rather than to the archive's
   * own queues. **Under the owner's current rule an editor may reach it too**: the rule is "everything except
   * purging the trash", and migration 0055 grants `manage_design` accordingly. An earlier and narrower
   * instruction would have made it admin-only; that instruction was withdrawn, and a parallel round that
   * decided otherwise is flagged in the round's report so the two agree.
   *
   * `/admin/seo/` is where the owner pastes the verification tokens Google, Bing and Yandex issue, and the
   * page itself is gated on `manage_design` — the same capability — so the link is drawn for everyone the
   * layout admits, exactly like "The design", because the page's own guard is what refuses a caller without
   * the capability; a hidden link is presentation, not authorisation.
   */
  sections.push(
    { href: '/admin/design', label: 'The design' },
    { href: '/admin/seo', label: 'Search engines' },
    { href: '/admin/spotify', label: 'Spotify' }
  );

  /*
   * WHICH SECTION IS OPEN, WHICH THE OLD BAR NEVER SAID. The design's rail marks its own entry with
   * `aria-current="page"` and `showcase.css` gives that state the gold title and the gold left rule, so a
   * reader can see where they are in fifteen screens. `x-pathname` is the path the reader actually asked for,
   * set by the middleware and already used above for the sign-in return address.
   */
  const here = requestedPath.replace(/\?.*$/, '').replace(/\/+$/, '') || '/admin';
  const isHere = (href: string) => href === here || (href !== '/admin' && here.startsWith(href));

  const railNav = (
    <nav className="sx-dash-nav" aria-label="Sections">
      {sections.map((section) => (
        <Link key={section.href} href={section.href} aria-current={isHere(section.href) ? 'page' : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {/*
        THE DESIGN'S OWN DASHBOARD GRID, WHICH IS `div.sx-dashboard`, AND ITS TWO CHILDREN.

        `showcase.css:276` draws it as `grid-template-columns: 16rem minmax(0, 1fr)` with a sticky full-height
        night rail — so the section list is beside the work rather than above it, which is the whole of the
        difference between the page the owner described as scattered and the page the design draws.
      */}
      <div className="sx-dashboard">
        <aside className="sx-dash-side">
          <Link className="sx-dash-brand" href="/">
            Ozikoro
          </Link>
          <p className="small" style={{ marginTop: 'var(--s-1)', color: 'var(--on-night-muted)' }}>
            Administration
          </p>
          {railNav}
          {/*
            THE WAY BACK TO THE WORKSPACES, BECAUSE A DOOR THAT ONLY OPENS INWARDS IS HALF A DOOR.

            The owner's words were *"and to admin mode anytime they want"*, and the other half of that is
            getting out again: the administration's navigation listed its sections and not one of them led to a
            dashboard. **A person who arrived from a workspace had no route back to one.**

            The list is the same allow-list the dashboards' own switch is built from — `dashboardModesFor` — so
            an editor is offered the editorial desk and the publishing workflow, a moderator the moderation
            queue, and the owner every workspace the archive draws. **It is not a second list that could
            disagree with the first**, and nothing here widens what anybody may do: every entry is a screen the
            account's own capabilities already open, and the screen refuses anyone whose capabilities do not.
          */}
          {workspaces.length > 0 && (
            <nav className="sx-dash-nav" aria-label="Your workspaces">
              <p className="small" style={{ margin: 'var(--s-5) 0 0', color: 'var(--on-night-muted)' }}>
                Your workspaces
              </p>
              {workspaces.map((mode) => (
                <Link key={mode.mode} href={dashboardModeHref(mode)}>
                  {mode.label}
                </Link>
              ))}
            </nav>
          )}
          {/* The design's rail ends with this, and so does this one. */}
          <nav className="sx-dash-nav" aria-label="Return">
            <Link href="/">Return to public site</Link>
          </nav>
        </aside>
        <main className="sx-dash-main" id="main">
          {/*
            THE SAME SECTIONS, FOR THE WIDTHS WHERE THE RAIL IS `display:none`. The design draws this
            scroller and `showcase.css` shows it below 60rem; above that it is hidden and the rail is shown, so
            exactly one of the two is ever on the screen.
          */}
          <nav className="sx-mobile-dashnav" aria-label="Sections">
            {sections.map((section) => (
              <Link key={section.href} href={section.href} aria-current={isHere(section.href) ? 'page' : undefined}>
                {section.label}
              </Link>
            ))}
          </nav>
          <header className="sx-dash-top">
            <div>
              <p className="eyebrow">Platform control</p>
              <strong>Administration</strong>
            </div>
            <div className="row">
              {/*
                THE NAME AND THE ROLE LIVE HERE, WHICH IS WHERE THEY ARE USEFUL.

                The owner's instruction removed them from the public masthead's control — *"'My Account' was
                enough"* — and he did not say the fact was worthless. This bar is inside the back office, it is
                read by the person it names and nobody else, and it is where the design puts the same
                information (`sx-dash-top`). `/workspace/` prints both as well, from the session, for the
                screens a member reads rather than works in.
              */}
              <span className="small muted">
                {label} · {ROLE_LABEL[account.role] ?? account.role}
              </span>
              <form method="post" action="/api/auth/signout">
                <button className="btn btn-sm" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </header>
          <div className="sx-dash-content">{children}</div>
        </main>
      </div>
    </>
  );
}
