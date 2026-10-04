import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { renderModeSwitcher } from '@ozikoro/platform';
import { switcherFor, workspaceViewer } from '@/lib/workspace-modes';
import './globals.css';

/**
 * The Ozikoro shell.
 *
 * THE DESIGN IS LINKED, NOT REWRITTEN
 *
 * The approved design is plain CSS with no build step, and the plan is explicit that it must be
 * preserved and connected rather than replaced. So the real routes link the design's own
 * stylesheets from `/design/styles/` and use its class names verbatim — `.wrap`, `.masthead`,
 * `.nav`, `.platform-bar`, `.prose`, `.provenance`, `.chip`. Nothing here re-implements a token
 * or re-invents a colour. If the design changes, the site changes with it, which is the property
 * that was asked for.
 *
 * `globals.css` holds only what the design does not cover: the administrator's shell, which the
 * design brief treats as a separate design, and a few layout resets needed by the app frame.
 *
 * THE PLATFORM BAR IS THE POINT
 *
 * The design's persistent dark bar names all three sites and marks which one you are on. It is
 * the visible expression of "one institution, three roles", and it is why the three share a
 * database and an account table: a reader arriving from the dictionary should not be able to tell
 * where one site ends and the next begins, and an academic citing the platform should be able to
 * cite it as one institution.
 */
export const metadata: Metadata = {
  title: {
    default: 'Ozikoro — history, archive and research',
    template: '%s · Ozikoro',
  },
  description:
    'The history and archive of Igbo and African peoples: town and kingdom histories, colonial records, oral histories, migration records, and the sources behind them.',
  metadataBase: new URL('https://ozikoro.com'),
  openGraph: {
    siteName: 'Ozikoro',
    type: 'website',
    locale: 'en_NG',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1b1a17',
};

/** Paths that supply their own frame rather than the public one. */
function hasOwnChrome(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname.startsWith('/signin') || pathname.startsWith('/design');
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? '/';

  if (hasOwnChrome(pathname)) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  /*
   * THE MASTHEAD SAYS WHO IS HERE AND WHAT THEY MAY OPEN.
   *
   * The owner's report was *"i logged in as a user, and could not find way to switch to admin"*, and this
   * navigation was part of the reason: it carried seven public sections and **not one line about the person
   * reading it or the workspace they own**. A signed-in reader had no route from `/archive/`,
   * `/researchers/` or an article to their own dashboard at all.
   *
   * The switch is the same markup the design screens receive, rendered from the same allow-list, so the two
   * halves of the site cannot offer different workspaces. **It is inserted as HTML rather than rebuilt as
   * JSX on purpose**: a second rendering of the control is a second thing that can drift from the first,
   * and this one is entirely our own markup with every name and label escaped at the source.
   */
  const workspace = await workspaceViewer();
  const modeSwitch = renderModeSwitcher(switcherFor(workspace, null), 'nav');

  return (
    <html lang="en">
      <head>
        {/*
          The approved design's own stylesheets, served exactly as delivered. `tokens.css` is
          @import-ed by `main.css`; both are listed so the preload order is explicit.
        */}
        <link rel="stylesheet" href="/design/styles/main.css" />
        <link rel="stylesheet" href="/design/styles/showcase.css" />
        {/*
          THE DESIGN'S OWN ICON, SERVED RATHER THAN DRAWN.

          `/favicon.ico` answered 404 on every page of this site — the browser asks for it unprompted, so it
          was the one console 404 a reader could see, and no page linked it because none declared one.

          **The design ships a favicon and it had simply never been copied into `public/`.** It sits at
          `design/calm-comfort-construct/public/favicon.ico` — in the deliverable's PUBLIC ROOT, outside
          `design/`, which is why it was missed: every other design asset is under `public/design/`. The file
          at `apps/ozikoro/public/favicon.ico` is that file byte for byte, so nothing here is drawn or
          approximated. The apple-touch icon points at the same file, because there is one icon in the
          deliverable and inventing a second would be inventing artwork.

          `/apple-touch-icon.png` is the one format a platform requires and the ICO does not provide: the
          touch icon must be a PNG. **The design's ICO holds a single 256×256 PNG and nothing else** — one
          directory entry, no mask, no second size — so that embedded image is served at the touch-icon
          path, byte for byte, with no conversion and no re-drawing. The link below names the ICO for
          browsers that accept it and the PNG for the ones that do not.
        */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/*
          Accessibility corrections, linked LAST so the design's own tokens cannot override them.
          See the file for what it corrects, the measurement that found it, and why that value.
        */}
        <link rel="stylesheet" href="/a11y.css" />
        {/*
          The design specifies Noto Serif, Noto Sans and Noto Sans Mono because they carry the
          Igbo dotted vowels and tone marks in every weight and in italic. Loaded from Google
          Fonts as the design does; the design notes record the fallbacks (Charis SIL, Gentium
          Plus, then Georgia/system-ui) for a reader whose network blocks it.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Mono:wght@400;600&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>

        {/* The three sites, one institution. Marked `here` on this one. */}
        <div className="platform-bar">
          <div className="wrap">
            <ul>
              <li>
                <Link href="/" className="here" aria-current="page">
                  ozikoro.com — archive &amp; research
                </Link>
              </li>
              <li>
                <a href="https://ozituma.com">ozituma.com — dictionary</a>
              </li>
              <li>
                <Link href="/academy/">academy.ozikoro.com — academy</Link>
              </li>
            </ul>
            <span className="owner">Ozi Ikoro Limited</span>
          </div>
        </div>

        <header className="masthead">
          <div className="wrap">
            <Link className="wordmark" href="/">
              <b>Ozikoro</b>
              <span>History &amp; Archive</span>
            </Link>
            <nav className="nav" aria-label="Primary">
              <ul>
                <li>
                  <Link href="/archive">Histories</Link>
                </li>
                <li>
                  {/*
                      The clan register. The design's own masthead puts the place directory second — its
                      screens read "Histories · Towns · Watch · Explore · Calendars · About" — so the
                      register sits here, beside Histories, rather than at the end with the site pages.

                      The design draws no clan screen, so `public/design/screens/towns.html` is the screen
                      this section is built from; the label names the section for what it holds, because
                      64 of its 188 published entries are not clans.
                    */}
                  <Link href="/clans">Clans</Link>
                </li>
                <li>
                  <Link href="/folklore">Folklores</Link>
                </li>
                <li>
                  {/*
                      "Watch" pointed at /watch, which has never existed — so EVERY page on the
                      site carried a link to a 404 in its main navigation. The link checker found
                      it once it was allowed to walk more than 25 pages.

                      The archive already lists its 13 videos at /documents/?kind=video: the media
                      listing supports a kind filter and the documents page already reads it. So the
                      section exists and the navigation was simply pointing somewhere else.
                    */}
                    <Link href="/documents?kind=video">Watch</Link>
                </li>
                <li>
                  <Link href="/documents">Archive</Link>
                </li>
                <li>
                  <Link href="/researchers">Researchers</Link>
                </li>
                <li>
                  <Link href="/academy/">Academy</Link>
                </li>
                <li>
                  <Link href="/about">About</Link>
                </li>
                {/*
                  THE SWITCH, THEN THE ACCOUNT. The control opens the list of workspaces this account may
                  enter and marks the one it is in; the account link beside it is the one-click way to the
                  workspace itself. A reader with nothing elevated gets no control and only the account or
                  the way in — which is the state the site was in before, and the state the brief requires.
                */}
                {modeSwitch.length > 0 && (
                  <li className="nav-modes-item" dangerouslySetInnerHTML={{ __html: modeSwitch }} />
                )}
                <li className="nav-account">
                  {workspace.signedIn ? (
                    <Link href={workspace.primaryHref}>
                      {workspace.primaryHref.startsWith('/dashboard-reader') ? 'My account' : 'My workspace'}
                    </Link>
                  ) : (
                    <Link href="/signin">Sign in / Sign up</Link>
                  )}
                </li>
              </ul>
            </nav>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="site-foot">
          <div className="wrap">
            <p>
              <strong>Ozikoro</strong> — the history and archive of Igbo and African peoples. The
              dictionary is <a href="https://ozituma.com">Ozituma</a> and the academy is{' '}
              <Link href="/academy/">the Academy</Link>, which is being prepared.
            </p>
            <p className="small muted">
              Ozi Ikoro Limited. Write to <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
