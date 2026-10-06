import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { capabilitiesFor, dashboardModeHref, dashboardModesFor, GRANT_ACCESS_CAPABILITY } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import { mayEnterBackOffice } from '@/lib/access';
import './studio.css';

/**
 * The Ozikoro administrator's area.
 *
 * ── THE DESIGN IS THE OWNER'S, AND IT ARRIVED AS A FILE ──────────────────────────────────────────
 *
 * On 2026-10-06 the owner sent `ozikoro-design-studio-dashboard.html` with one instruction:
 *
 *   *"replace the admin design we have with the one in this html, then make sure all the functions
 *   are working when done. copy the exact design here as it is far better than what you have as
 *   admin dashboard"*
 *
 * **What was here before was not wrong so much as a different design.** It was built on the design
 * deliverable's own dashboard classes — `sx-dashboard`, `sx-dash-side`, `sx-dash-nav`, `sx-dash-top`
 * from `showcase.css`, drawn to match `public/design/screens/dashboard-admin.html`. The owner's file
 * is a second, later design: its own night rail with a conic-gradient brand mark, its own warm
 * paper-and-gold palette, and its own top bar. So this file and `studio.css` replace the *shape*
 * while every function below stays exactly as it was.
 *
 * ⚠️ **NOT ONE SECTION, WORKSPACE, GUARD OR RETURN ADDRESS CHANGED.** The owner's rail lists
 * Overview · Posts · Pages · Editorial queue · Knowledge graph · Review queue · Audio review ·
 * Pronunciations & credits · Media register · Media rights · Claims · Users · Audit trail · Trash ·
 * Institutional access · The design · Search engines · Record search results · Spotify — which is
 * the same list this file already carried, in the same order. **The rail's content was right; the
 * drawing of it is what changed.**
 *
 * ⚠️ **AND `studio.css` IS SCOPED UNDER `.ozstudio` FOR A REASON THAT WAS MEASURED.** The owner's
 * stylesheet names 17 classes that the public archive also defines — `.card`, `.btn`, `.field`,
 * `.grid`, `.table`, `.badge`, `.tabs`, `.tab`, `.main`, `.page`, `.top`, `.nav`, `.mark`,
 * `.eyebrow`, `.notice`, `.toast`, `.token` — and it carries its own `--paper`, `--ink` and
 * `--accent` values, which differ from the design deliverable's. Unscoped it would have restyled
 * ozikoro.com's public screens. Every selector in that sheet is prefixed, every value is the
 * designer's, and the palette is scoped with it.
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

/**
 * The design's own glyph for each section, taken from the rail it draws.
 *
 * They are decorative and carry `aria-hidden`, so a screen reader reads the label and not the
 * character — `◈` announced as "diamond" beside the word "Overview" is noise, and the design
 * already puts the meaning in the text.
 */
const SECTION_ICON: Record<string, string> = {
  '/admin': '◈',
  '/admin/posts': '✎',
  '/admin/pages': '□',
  '/admin/archive': '≡',
  '/admin/entities': '⌘',
  '/admin/reviews': '✓',
  '/admin/audio': '◉',
  '/admin/pronunciation': '◌',
  '/admin/media': '▧',
  '/admin/rights': '▤',
  '/admin/claims': '◇',
  '/admin/users': '♙',
  '/admin/audit': '⌁',
  '/admin/trash': '⌫',
  '/admin/access': '▣',
  '/admin/design': '✦',
  '/admin/seo': '⌕',
  '/admin/seo-records': '↗',
  '/admin/spotify': '♫',
};

/** The design's workspace glyphs, in the order `dashboardModesFor` returns them. */
const WORKSPACE_ICON: Record<string, string> = {
  reader: '◉',
  editorial: '✎',
  review: '✓',
  moderation: '⚑',
  administration: '♙',
  research: '⌕',
  teaching: '▤',
  student: '◇',
};

/**
 * The account's initials, for the avatar the design draws in the top bar.
 *
 * ⚠️ **DERIVED FROM THE NAME, NEVER INVENTED.** A display name of "Idenze Ezeme" gives `IE`; an
 * account with no display name falls back to the email's first letter, and one with neither gives
 * a single `·` rather than a made-up pair. The design shows `IE` because its sample account is the
 * owner's; this computes whatever the signed-in account actually is.
 */
function initialsOf(displayName: string | null, email: string): string {
  const source = (displayName ?? '').trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
    const joined = letters.join('').toUpperCase();
    if (joined) return joined;
  }
  const first = [...(email.trim() || '·')][0] ?? '·';
  return first.toUpperCase();
}

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
    /*
     * ⚠️ THE REFUSAL IS RENDERED INSIDE `.ozstudio`, SO IT WEARS THE STUDIO'S PALETTE TOO.
     *
     * A page that is half the new design and half the old one reads as broken, and this is the one
     * screen a person sees when they are already being told no.
     */
    return (
      <div className="ozstudio">
        <main className="main" style={{ marginLeft: 0, width: '100%', minWidth: 0 }}>
          <div className="page" style={{ maxWidth: '44rem' }}>
            <div className="card">
              <div className="card-body stack">
                <div>
                  <div className="eyebrow">Administration</div>
                  <h2 style={{ font: '600 34px var(--serif)', margin: '3px 0 0' }}>Not your door</h2>
                </div>
                <p className="hint">
                  This is the working area, and it opens for editors, expert reviewers, moderators,
                  audio reviewers and administrators. You are signed in as{' '}
                  {ROLE_LABEL[account.role] ?? account.role} with no Ozikoro role yet, so there is
                  nothing here for you — an administrator can grant one.
                </p>
                <div className="actions">
                  <a className="btn primary" href="/">
                    Back to Ozikoro
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const label = account.displayName ?? account.email;
  const roleLabel = ROLE_LABEL[account.role] ?? account.role;
  const initials = initialsOf(account.displayName, account.email);

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
   * ── THE SECTIONS, ONCE, AND DRAWN IN THE OWNER'S RAIL ────────────────────────────────────────────
   *
   * This list is the same one the owner's `ozikoro-design-studio-dashboard.html` draws, in the same
   * order — Overview, Posts, Pages, Editorial queue, Knowledge graph, Review queue, Audio review,
   * Pronunciations & credits, Media register, Media rights, Claims, Users, Audit trail, Trash,
   * Institutional access, The design, Search engines, Record search results, Spotify. **Nothing was
   * added to match the picture and nothing was removed from the real area**: an entry exists here
   * because a screen exists at that address, not because the mock-up drew it.
   */
  const sections: { href: string; label: string }[] = [
    { href: '/admin', label: 'Overview' },
    /*
     * POSTS AND PAGES, AS TWO SECTIONS RATHER THAN ONE SCREEN WITH A SWITCH.
     *
     * The owner's instruction was to build "add new posts and pages" and to reproduce WordPress's
     * editing surface, and WordPress's admin menu draws Posts and Pages as two menus with their own
     * submenus. The schema agrees with the screen: `ozikoro_article.is_page` is a column, every
     * archive query filters on it, and a page is site content where a post is a filed record. So the
     * rail carries them separately, and each section's own submenu — All Posts / Add New /
     * Categories / Tags, and All Pages / Add New — is drawn by `app/admin/classic-editor/screens.tsx`
     * on the screens themselves. **Both sections open with a working "Add New", which is the thing
     * the owner asked to be certain of.**
     */
    { href: '/admin/posts', label: 'Posts' },
    { href: '/admin/pages', label: 'Pages' },
    { href: '/admin/archive', label: 'Editorial queue' },
    { href: '/admin/entities', label: 'Knowledge graph' },
    { href: '/admin/reviews', label: 'Review queue' },
    { href: '/admin/audio', label: 'Audio review' },
    { href: '/admin/pronunciation', label: 'Pronunciations & credits' },
    { href: '/admin/media', label: 'Media register' },
    { href: '/admin/rights', label: 'Media rights' },
    { href: '/admin/claims', label: 'Claims' },
    /*
     * COMMENTS SITS WITH THE OTHER QUEUES, AND IT IS A SCREEN RATHER THAN A LINK TO ONE.
     *
     * This list's own rule is that *"an entry exists here because a screen exists at that address, not
     * because the mock-up drew it"*, and the owner's design draws no comment queue — **it draws no discussion
     * block anywhere, on any of its 52 screens.** The screen exists because he asked for comments that are
     * *"checked before they appear"*, and a check with no queue is half a feature.
     *
     * ⚠️ **WHY IT IS NOT `/admin/reviews`.** That screen is a review queue and looks like the right home.
     * It is gated on `edit_entity`, and a `moderator` — the one role the archive defines as *"Reports,
     * moderation of users and content, and escalation"* — holds `moderate`, `read` and `review_reports` and
     * **not** `edit_entity`. A comment queue inside it would be a queue the moderator cannot open. It is
     * gated on `moderate` instead, which is the vocabulary's own word for the act, and placed here so that a
     * person who reaches `/admin/` can find it.
     */
    { href: '/admin/comments', label: 'Comments' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/audit', label: 'Audit trail' },
    /*
     * THE TRASH SITS WITH THE QUEUES, NOT BESIDE SPOTIFY.
     *
     * Restoring a deleted record is an editor's work — the owner's rule is that an editor "can recover
     * or do anything" — so the screen is part of the editorial round rather than an owner's tool.
     * **Only the destroy button on it is not the editor's**, and that is a control the screen
     * withholds rather than the screen itself, which is why this link is not hidden from an editor.
     */
    { href: '/admin/trash', label: 'Trash' },
  ];

  /*
   * INSTITUTIONAL ACCESS IS THE ONE SECTION THE NAVIGATION HIDES FROM AN EDITOR.
   *
   * Every other entry here is offered to everyone the layout admits, because the page's own guard
   * answers for it and a hidden link is presentation rather than authorisation. This one is
   * different: **only the `owner` role holds `grant_institutional_access`** — the owner's own
   * decision, and the reason is in `docs/OZIKORO-REMAINING.md` — so the link is drawn only for an
   * account that holds it. The page still guards itself as its first statement, so hiding the link is
   * not what protects it.
   */
  if (capabilities.has(GRANT_ACCESS_CAPABILITY)) {
    sections.push({ href: '/admin/access', label: 'Institutional access' });
  }

  /*
   * THE DESIGN STUDIO, THE SEARCH ENGINES, THEN SPOTIFY — THE THREE THAT CHANGE THE SITE RATHER THAN
   * ITS CONTENT, IN THE ORDER THE NAVIGATION HAS CARRIED THEM.
   *
   * `/admin/design/` is the only screen whose edits are visible to every reader rather than to the
   * archive's own queues. **Under the owner's current rule an editor may reach it too**: the rule is
   * "everything except purging the trash", and migration 0055 grants `manage_design` accordingly.
   *
   * `/admin/seo/` IS AN AREA RATHER THAN A PAGE, AND THIS LINK STILL POINTS AT ITS INDEX. It began as
   * one screen where the owner pastes the verification tokens; the owner's report — *"everything must
   * not show on same page"* — split it into six. **The label and the address are unchanged on
   * purpose**: this rail is a way into the area, the index is where a reader chooses a section, and
   * moving the entry point would be a second change on top of the one that was asked for.
   *
   * ⚠️ **THE TWO ADDRESSES ARE A PREFIX PAIR, AND `isHere` BELOW IS WRITTEN FOR THAT.** `/admin/seo`
   * is a prefix of `/admin/seo-records`, so the old `here.startsWith(href)` lit "Search engines"
   * while the record editor was open. The comparison now requires a segment boundary.
   */
  sections.push(
    { href: '/admin/design', label: 'The design' },
    { href: '/admin/seo', label: 'Search engines' },
    { href: '/admin/seo-records', label: 'Record search results' },
    { href: '/admin/spotify', label: 'Spotify' }
  );

  /*
   * WHICH SECTION IS OPEN, WHICH THE OLD BAR NEVER SAID. The owner's rail marks its own entry with
   * `aria-current="page"`, and `studio.css` gives `.nav a.active` the gold title and the gold left
   * rule — the same two signals the mock-up draws. `x-pathname` is the path the reader actually asked
   * for, set by the middleware and already used above for the sign-in return address.
   */
  const here = requestedPath.replace(/\?.*$/, '').replace(/\/+$/, '') || '/admin';
  /*
   * `isHere` MARKS ONE ENTRY, AND THE SEGMENT BOUNDARY IS WHAT KEEPS IT TO ONE.
   *
   * It was `here.startsWith(href)`, which is right for a child (`/admin/archive/<id>` marks
   * `Editorial queue`) and wrong the moment one section's address is a PREFIX of another's —
   * `/admin/seo` is a prefix of `/admin/seo-records`, so opening the record editor lit "Search
   * engines" instead. The `+ '/'` term requires the match to end at a path boundary, so
   * `seo-records` no longer answers for `seo` while a genuine child still answers for its parent.
   */
  const isHere = (href: string) => href === here || (href !== '/admin' && here.startsWith(`${href}/`));

  /*
   * ── PLAIN `<a>` IN THE RAIL, ON PURPOSE, AND THIS IS THE ONE PLACE THE REASON IS WRITTEN DOWN ────
   *
   * The owner: *"i want every page one clicks on the dashboards to be loading fully, instead of doing
   * like it was cached already. full loading is better."* `next/link` swaps the page in place from a
   * React payload the App Router already holds, so the click appears instant and the screen is
   * assembled on the client. **These are screens that read what other screens wrote** — edit a
   * record, then open the audit trail; publish a draft, then open the archive list — so an in-place
   * swap can show the state from before the write, which is exactly how a working feature comes to
   * look broken. An ordinary `<a href>` asks the server for the document, the server renders it from
   * the database as it is at that moment, and **what is on the screen is what the server now holds.**
   *
   * ⚠️ **THE COST IS STATED RATHER THAN HIDDEN.** A full load re-fetches everything the layout
   * provides — this rail, the account's capabilities, the workspace list — on every click, so a
   * dashboard click is slower and hits the database more than it did. That is the trade the owner
   * asked for.
   *
   * ⚠️ **IT IS SCOPED TO THE BACK OFFICE, NOT TO THE SITE.** Every link under `app/admin/` was
   * converted, and **nothing under `app/` outside `admin/` was touched**, so the public archive — the
   * 1,000-plus records and the design's screens — keeps its client-side navigation and its speed.
   */
  return (
    <div className="ozstudio">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {/*
        THE DESIGN'S OWN TWO COLUMNS: A FIXED NIGHT RAIL AND THE WORK BESIDE IT.

        `.ozstudio .rail` is `position:fixed` at 16.25rem and `.ozstudio .main` is offset by the same
        260px, so the section list is beside the work rather than above it — which is the whole of the
        difference between a page whose menu wraps onto four ragged rows and the page the owner drew.
      */}
      <div className="app">
        <aside className="rail">
          {/*
            ⚠️ THE BRAND IS A LINK, AND IT WAS NOT — THE OWNER: *"the ozikoro logo and text on the top
            left in dashboard is not clickable, please fix"*.

            It was a plain `<div class="brand">`, copied from the mock-up, which is a static picture and
            has no reason to go anywhere. **On a real screen the mark in the top-left is the one control
            every reader already knows: it takes you home.** Every back-office screen in this archive
            had a logo-shaped thing that did nothing, on all 41 routes.

            `href="/admin/"` rather than `/` — the owner's own design puts the mark on the *administration*
            bar with "Administration" written under it, and WordPress's own logo goes to the dashboard
            rather than out to the public site. **The rail already carries "Return to public site" as its
            last entry**, so this is the inside-the-back-office door and that is the way out.
          */}
          <a className="brand" href="/admin/">
            {/* The design's conic-gradient sun; decorative, so it is hidden from assistive tech. */}
            <div className="mark" aria-hidden="true" />
            <div>
              <b>Ozikoro</b>
              <small>Administration</small>
            </div>
          </a>

          <div className="nav-title">Control centre</div>
          <nav className="nav" aria-label="Sections">
            {sections.map((section) => {
              const active = isHere(section.href);
              return (
                <a
                  key={section.href}
                  href={section.href}
                  className={active ? 'active' : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="ico" aria-hidden="true">
                    {SECTION_ICON[section.href] ?? '•'}
                  </span>
                  {section.label}
                </a>
              );
            })}
          </nav>

          {/*
            THE WAY BACK TO THE WORKSPACES, BECAUSE A DOOR THAT ONLY OPENS INWARDS IS HALF A DOOR.
            `workspaces` is `dashboardModesFor`, the same allow-list the dashboards' own switch is
            built from, so this list cannot disagree with that one.
          */}
          {workspaces.length > 0 && (
            <>
              <div className="nav-title">Your workspaces</div>
              <nav className="nav" aria-label="Your workspaces">
                {workspaces.map((mode) => (
                  <a key={mode.mode} href={dashboardModeHref(mode)}>
                    <span className="ico" aria-hidden="true">
                      {WORKSPACE_ICON[mode.mode] ?? '◉'}
                    </span>
                    {mode.label}
                  </a>
                ))}
              </nav>
            </>
          )}

          {/* The design's rail ends with this, and so does this one. */}
          <div className="rail-foot">
            <a href="/">← Return to public site</a>
          </div>
        </aside>

        <main className="main" id="main">
          <header className="top">
            <div>
              <div className="eyebrow">Platform control</div>
              <h1>Administration</h1>
            </div>
            <div className="account">
              {/*
                THE NAME AND THE ROLE LIVE HERE, WHICH IS WHERE THEY ARE USEFUL.

                The owner's instruction removed them from the public masthead's control — *"'My
                Account' was enough"* — and he did not say the fact was worthless. This bar is inside
                the back office, it is read by the person it names and nobody else, and the owner's
                own design puts both in it. `/workspace/` prints both as well, from the session.
              */}
              <div className="avatar">{initials}</div>
              <div style={{ textAlign: 'right' }}>
                <b style={{ fontSize: 12 }}>{label}</b>
                <div className="eyebrow">{roleLabel}</div>
              </div>
              <form method="post" action="/api/auth/signout">
                <button className="btn small" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </header>
          <div className="page">{children}</div>
        </main>
      </div>
    </div>
  );
}
