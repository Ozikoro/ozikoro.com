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
    /*
     * ── THE BACK OFFICE IS A DESIGN SCREEN TOO, AND IT WAS THE ONE PLACE THE DESIGN WAS NOT LINKED ────
     *
     * The owner: *"i clicked on it to see the admin, and it was completely scattred. this is not exactly as
     * it was in the demo."* It was not, and this is half the reason.
     *
     * `public/design/screens/dashboard-admin.html` draws the administration as `div.sx-dashboard` — a
     * 16rem night rail beside a main column, a sticky `header.sx-dash-top`, a `section.sx-metrics` of four
     * figures and a `div.sx-work-grid` of two panels. Those are all rules in `showcase.css`.
     *
     * **Measured on the served page before this change: the only stylesheet on `/admin/` was the
     * application's own `globals.css`.** `main.css`, `showcase.css` and `a11y.css` were linked on the
     * public pages and on the fifty-two design screens, and not here — so `/admin/` could not have looked
     * like the design however its markup was written, and it did not. *A page whose classes come from a
     * stylesheet it does not load is a page laid out by the browser's defaults, which is exactly what
     * "scattered" describes.*
     *
     * The two conditions are the design's own, mounted by every other page of this site: link the
     * deliverable's stylesheets as delivered, and `a11y.css` last so its corrections are not overridden.
     *
     * ⚠️ NOT ON `/signin` OR `/design`* — those share this branch because they share its reason (a Next
     * layout cannot ask for the path, so the path arrives as a header), and neither is the administration.
     * `/design-screen/…` also starts with `/design` and returns its own whole document, so a head injected
     * here would be discarded anyway.
     */
    const backOffice = pathname.startsWith('/admin');

    return (
      <html lang="en">
        <head>
          {backOffice ? (
            <>
              <link rel="stylesheet" href="/design/styles/main.css" />
              <link rel="stylesheet" href="/design/styles/showcase.css" />
              <link rel="stylesheet" href="/a11y.css" />
              {/*
                The design's own faces, for the same reason the public pages load them: the type scale and
                the `--font-serif` headings are part of what the dashboard looks like, and the fallback
                stack renders the Igbo dotted vowels differently from Noto.
              */}
              <link rel="preconnect" href="https://fonts.googleapis.com" />
              <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
              <link
                rel="stylesheet"
                href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Mono:wght@400;600&display=swap"
              />
            </>
          ) : null}
        </head>
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

          ⚠️ **BUT THE DESIGN'S FAVICON IS NOT OZIKORO'S MARK, AND THIS FILE USED TO SERVE IT ANYWAY.**
          `design/calm-comfort-construct/public/favicon.ico` holds a single 256×256 PNG of the **Lovable**
          logo — the tool the design screens were drawn in — and the paragraph that used to sit here argued
          for copying it byte for byte, on the grounds that drawing a second icon *"would be inventing
          artwork"*. **The owner reported the result in his own words: "why is the favicon of the website
          showing the loveable logo instead of ozikoro.com logo?"** *A visitor's browser tab showed the
          build tool's brand rather than the archive's.*

          **AND THE PREMISE WAS FALSE. Nothing had to be invented, because Ozikoro's own mark already
          exists and the archive already serves it:** `/media/ozikoro/486-cropped-Ozi-Ikoro-Icon-Yellow-1.png`
          — the same gold sun the masthead draws, 512×512, 15,175 bytes, held in this repository at
          `data/media/ozikoro-wp/`. **The three files below are that image at the sizes a platform asks for,
          and nothing in them is drawn, recoloured or composed by this application.**

          *The ICO carries five PNG entries — 16, 32, 48, 64 and 256 — because one size is a compromise:
          a 16 px tab icon and a 256 px taskbar icon are different problems, and an ICO can answer both.
          `/favicon.png` is a 32×32 copy for browsers that prefer a PNG with an explicit type, and
          `/apple-touch-icon.png` is 180×180, which is what iOS asks for and what an ICO cannot provide.
          The PNG links come first so a modern browser takes the one it can size best; the ICO stays for
          the ones that ask for `/favicon.ico` unprompted, which no markup can prevent.*
        */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
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
                  THE SWITCH STANDS WHERE THE ACCOUNT ITEM STANDS, WHICH IS ONE ITEM AND NOT TWO.

                  It used to be added *beside* the account link, so a signed-in reader with an elevated
                  workspace got eight items where a signed-out one got seven — and the eighth was a
                  `details` whose summary named the person and the role and ran to several hundred pixels.
                  That is what wrapped the bar. The owner's instruction is the fix for both halves:
                  *"the thing was showing 'Signed in as Idenze Ezeme · Owner' when 'My Account' was enough."*

                  So the control is the account item now, its summary reads `My Account`, and the link to
                  the reader's own workspace is the first entry inside the panel it opens — the room the
                  signed-in bar takes is the room the signed-in bar took before the switch existed, and
                  nothing was removed to get there. **A plain reader, who sees no switch at all, keeps the
                  plain account link exactly as it was.**
                */}
                {modeSwitch.length > 0 ? (
                  <li className="nav-modes-item" dangerouslySetInnerHTML={{ __html: modeSwitch }} />
                ) : (
                  <li className="nav-account">
                    {workspace.signedIn ? (
                      <Link href={workspace.primaryHref}>
                        {workspace.primaryHref.startsWith('/dashboard-reader') ? 'My account' : 'My workspace'}
                      </Link>
                    ) : (
                      <Link href="/signin">Sign in / Sign up</Link>
                    )}
                  </li>
                )}
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
