import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { accountItemFor, FAVICON_LINKS, renderModeSwitcher, WORDMARK_MARK_SRC } from '@ozikoro/platform';
import { switcherFor, workspaceViewer } from '@/lib/workspace-modes';
import { isAdsenseReaderPath } from '@/lib/adsense';
import AdsenseUnit from './_components/adsense-unit';
import { AdsenseLoader } from './_components/adsense-loader';
import { AnalyticsTag } from './_components/analytics-tag';
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
  /*
   * THE ACCOUNT ITEM, WHICH AN ADMINISTRATOR'S MENU CARRIES INSTEAD OF THE SWITCH.
   *
   * `modeSwitch` is empty for an account that may administer the site — `renderModeSwitcher`'s own rule,
   * written out at `administersSite` in `dashboard-modes.ts` — so this branch is what such a person
   * actually sees. The address and the two words come from `accountItemFor` rather than from the
   * `primaryHref.startsWith('/dashboard-reader')` test that used to be written here, because that test
   * would have labelled an administrator's remembered workspace `My workspace` — the item the owner
   * asked to have removed — and **the wording and the destination of one link belong in one place.**
   */
  const accountControl = accountItemFor({
    signedIn: workspace.signedIn,
    platformRole: workspace.platformRole,
    primaryHref: workspace.primaryHref,
  });

  /*
   * ── WHETHER THIS PAGE CARRIES THE OWNER'S AD CODE, DECIDED HERE AND NOWHERE ELSE ────────────────────
   *
   * The owner: *"i did not see where to place the google adsense ads, so please add it yourself."* The
   * answer this shell gives is `isAdsenseReaderPath` — an allow-list of the React route families that are
   * the archive's reading and browsing surface: the clan register, the town records, the researchers'
   * directory, a byline, the entity and label records, and a project.
   *
   * ⚠️ **IT IS AN ALLOW-LIST BECAUSE THIS LAYOUT SERVES MORE THAN PUBLIC PAGES, AND THAT WAS MEASURED
   * RATHER THAN ASSUMED.** `/account/`, `/submit/`, `/library/`, `/workspace/`, `/reviews/` and `/claims/`
   * all answer **307 to `/signin`**, and `/contact/`, `/join/` and `/search/` answer 200 with a form. An ad
   * script emitted for every path that reaches this point would therefore have been emitted on the account
   * screen and the sign-in-gated surfaces — which the owner asked not to happen — and a deny-list would
   * acquire each new private route silently. The list cannot.
   *
   * **AND THE FIRST BRANCH ABOVE IS NEVER REACHED BY IT.** `/admin`, `/signin` and `/design` return before
   * this line, so the back office, the sign-in screen and the design editor cannot receive the loader even if
   * a name were later added to the allow-list by mistake.
   */
  const ads = isAdsenseReaderPath(pathname);

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
          THE SITE'S OWN ICON, LINKED AT THE ADDRESS THE BROWSER ASKS FOR ANYWAY.

          `/favicon.ico` answered 404 on every page of this site once — the browser asks for it unprompted,
          so it was the one console 404 a reader could see, and no page linked it because none declared one.
          The design ships an icon and it had simply never been copied into `public/`; it was copied byte for
          byte, and it turned out to be **the Lovable logo** — the tool the design screens were drawn in — so
          a visitor's tab showed the build tool's brand. The owner reported it in his own words: *"why is the
          favicon of the website showing the loveable logo instead of ozikoro.com logo?"* The archive's own
          mark already existed (`data/media/ozikoro-wp/486-cropped-Ozi-Ikoro-Icon-Yellow-1.png`, the same
          gold sun the masthead draws) and the files here were made from it. Nothing is drawn or recoloured
          by this application.

          ── AND IT IS NOW AN OWNER-EDITABLE SETTING, WHICH CHANGED WHERE IT IS READ ─────────────────────

          These links name `/favicon.ico`, and **that address is served by `app/favicon.ico/route.ts`** from
          a row in `site_setting` — so the icon is the owner's, set on `/admin/design/`, rather than three
          files baked into the image. The two static files that used to answer this path
          (`public/favicon.ico`, `public/favicon.png`) were removed in the same change, because **a file in
          `public/` is served before the router and would shadow the route silently** — a setting that saves
          and changes nothing is the fault this repository keeps paying for.

          THE TAGS STAY, AND THE REASON IS REACH RATHER THAN TIDINESS. **This layout does not run for the
          design screens or the articles** — measured, `GET /` is `public/design/screens/home.html` rewritten
          with zero `/_next/` references — so the route, not this layout, is what carries the icon to all
          1,104 of them: a browser asks for `/favicon.ico` by itself when a document declares no icon. These
          tags name the same address, so the React routes and the design pipeline cannot disagree about where
          the icon comes from. `/apple-touch-icon.png` stays a file: an iOS home-screen icon is a different
          picture at a different size, and this setting does not pretend to replace it.
        */}
        {FAVICON_LINKS.map((link) => (
          <link key={link.rel} rel={link.rel} href={link.href} sizes={link.sizes} />
        ))}
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
        {/*
          THE AD CODE'S LOADER, ONCE PER DOCUMENT, AND ONLY ON A PAGE THAT CARRIES A UNIT.

          It is the owner's own `<script async src="…adsbygoogle.js?client=ca-pub-…">`, written from the
          address in `@/lib/adsense` rather than typed again here. `async` is the snippet's, and it is why the
          unit below is written as an `adsbygoogle` queue push: the push registers the unit whether the loader
          has arrived or not, so a slow or refused loader costs the ad and not the page.

          ⚠️ **THIS IS THE ONLY PLACE THE LOADER IS WRITTEN FOR THE REACT ROUTES, AND IT IS NOT THE ONLY
          PLACE IT IS WRITTEN FOR THE SITE.** The design screens — which include `/`, `/archive/`,
          `/documents/` and `/photographs/` — and every record at `/<slug>/` are served as whole documents by
          their own routes and never reach this layout, so each of those writes the loader from the same
          constants. Three document producers, one address.
        */}
        {ads ? <AdsenseLoader /> : null}
        {/*
          ── THE OWNER'S GA4 TAG, AND WHY IT IS HERE RATHER THAN INSIDE THE `ads` CONDITION ABOVE ──────────

          The owner: *"i could not find the website analytics, like it was before. i need to be knowing how
          much views, where it came from, which link got it, and how much traffic and the country locations…"*
          He supplied the tag for `G-RKRGY9QCSH` himself, and it is written from `@/lib/analytics` so this file
          and the two string producers cannot disagree about the id or the address.

          ⚠️ **`ads` IS THE AD QUESTION AND THIS IS NOT IT.** `isAdsenseReaderPath` answers *"may a third party
          be paid to put a rectangle on this page?"* — it excludes the editor, the forms and the 404 for
          editorial reasons. **The analytics question is *"how many people came here, and from where?"* and its
          wrong answer on a page nobody wanted measured is one row too many, not a paid placement beside an
          appeal.** So the tag is rendered on **every path that reaches this shell**, and the pages that are
          still not measured are the ones closed by the branch above: `/admin/`, `/signin/` and `/design`.

          ⚠️ **THOSE THREE ARE EXCLUDED ON PURPOSE AND THE REASON IS THE OWNER'S OWN REPORT.** His question is
          about the archive's readers; his own administrative sessions are not readers, and a back-office page
          view counted as traffic would make the one number he asked for less true. `/signin/` is the same
          screen an administrator passes through to get there. **The cost of this exclusion is stated rather
          than hidden: page views on `/admin/` and `/signin/` are not collected, and if he wants them the tag
          goes in the `hasOwnChrome` branch above.** `/design-screen/…` is not an exclusion at all — it returns
          its own whole document and carries the tag from the screen route.

          ⚠️ AND IT FIRES IMMEDIATELY WITH NO CONSENT GATE. GA4 sets cookies on first visit; that is the
          owner's decision, stated in plain words in this round's report and in `@/lib/analytics`.
        */}
        <AnalyticsTag />
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
                {/*
                  THE ACADEMY IS A SEPARATE APPLICATION, SO ITS ADDRESS IS ABSOLUTE.
                  It used to be `<Link href="/academy/">` — this archive's own interim page — and the owner
                  retired that page: *"delete this page https://ozikoro.com/academy/ and move anyone that
                  clicks on the academy on the top menu to academy.ozikoro.com."* `middleware.ts` now answers
                  `/academy/` with a 301 to the host, so a same-site link would be a hop through a redirect.
                  Measured: `curl -sI https://academy.ozikoro.com/` → HTTP/2 200.
                */}
                <a href="https://academy.ozikoro.com/">academy.ozikoro.com — academy</a>
              </li>
            </ul>
            {/*
              THE PLATFORM BAR'S OWN SLOT, AND THE ONE PLACE THE COMPANY NAME WAS DRAWN AT THE TOP.

              `.platform-bar .owner` is the design's own element — `main.css:93` gives it small
              letterspaced caps — and the deliverable fills it with a short label rather than a
              proprietor: on `screens/type-test.html` it reads `Typeface proof`. This bar filled it with
              `Ozi Ikoro Limited`, which is **the string the owner pointed at when he said the company
              name should come off the top**: *"the Ozi Ikoro limited you do put on the top menu should be
              removed everywhere. ozikoro is enough."*

              It is a label in the top strip and not a legal notice — there is no ©, no notice and no
              terms in it, and the footer keeps `© ... Ozi Ikoro Limited.` exactly as he asked. So the
              label takes the brand he named and the slot keeps its job.

              ⚠️ THE CLASS AND THE SLOT STAY. `a11y.css` and `main.css` both place `.owner`, and removing
              the element would take the right-hand half of the top strip with it.
            */}
            <span className="owner">Ozikoro</span>
          </div>
        </div>

        <header className="masthead">
          <div className="wrap">
            <Link className="wordmark" href="/">
              {/*
                ⚠️ THE OWNER'S MARK, AND IT IS A CHANGE TO HIS OWN DESIGN RATHER THAN A FIX.

                An agent measured the logo question and put three options to him. He chose the second —
                **the mark on all 53 screens** — and the option he accepted said in as many words:
                *"Literal 'every single page', but 52 screens gain an image your design never gave them."*
                So he knowingly authorised it.

                IT IS THE SAME IMAGE `screens/home.html` DRAWS, at the same absolute address. The design
                draws this element as `<img>` then `<b>Ozikoro</b> <span>Archive</span>`, and the mark's
                34×34 round sizing is `showcase.css:20` (`.wordmark img`) — which this layout loads, so no
                value is repeated here. `alt=""` is the design's own: the name is beside it, in words.

                ⚠️ AND IT IS ABSOLUTE, `/media/…`. This one masthead is served at `/researchers/`,
                `/clans/`, `/documents/`, `/admin/` and every other application route, and a relative
                address would resolve at a different depth on each and 404 on most of them.

                `design-paths.ts` puts the same mark into the deliverable's own wordmark at serve time,
                under `WORDMARK_MARK_SRC`, which is why the address is imported rather than typed twice.
              */}
              <img src={WORDMARK_MARK_SRC} alt="" />
              <b>Ozikoro</b>
              {/*
                THE STRAP IS THE SECOND OF THE TWO WORDS THE OWNER CHOSE.

                Asked what the wordmark should be, he answered **"Ozikoro Archive"** — and every design screen
                that writes this header writes its strap the same way (`a.wordmark span`). `design-paths.ts`
                rewrites the deliverable's own copy of this element at serve time for exactly this reason, and
                this file is the one masthead the deliverable does not serve: **`/researchers/`, `/clans/`,
                `/documents/`, `/towns/`, `/attachments/` and every other application route draw THIS header**,
                so without this line the site would show two different wordmarks depending on which route
                answered — which is the disagreement the change exists to remove.
              */}
              <span>Archive</span>
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
                  <a href="https://academy.ozikoro.com/">Academy</a>
                </li>
                <li>
                  <Link href="/about">About</Link>
                </li>
                {/*
                  THE ACCOUNT CONTROL IS NOT IN THIS LIST, AND THAT IS THE WHOLE OF THIS FIX.

                  It used to be the eighth `<li>` in the `<ul>` above — `nav-account` when the reader had no
                  elevated workspace and `nav-modes-item` when they had one. The design's menu is SEVEN items,
                  and `main.css:101` lays them out as a wrapping flex row with a `--s-5` gap: seven fit and the
                  eighth wrapped to a second line, which is what the owner reported twice as the menu being
                  "scattered". At 40rem `showcase.css:658` makes the same `<ul>` a two-column grid and gives
                  **every `<li>` a bottom border**, so the account control was drawn as a menu item as well.

                  So it is a sibling of the `<nav>` now, inside `.masthead > .wrap` — which `main.css:97`
                  already sets to `display: flex; justify-content: space-between` for the `.wordmark` and the
                  `<nav>` — and it matches the shape `fillMasthead` writes for the fifty-two design screens.
                  `a11y.css` places it in that row and in the 40rem grid. **The seven items above are
                  untouched, and this element cannot move them.**

                  The owner's other instruction is kept: the wording is `My account`, and the panel's summary
                  no longer names him — *"the thing was showing 'Signed in as Idenze Ezeme · Owner' when 'My
                  Account' was enough."* The switch's own wording is `renderModeSwitcher`'s.
                */}
              </ul>
            </nav>
            <div className="masthead-account">
              {modeSwitch.length > 0 ? (
                <div className="nav-modes-item" dangerouslySetInnerHTML={{ __html: modeSwitch }} />
              ) : accountControl ? (
                <Link className="nav-account" href={accountControl.href}>
                  {accountControl.label}
                </Link>
              ) : (
                <Link className="nav-account" href="/signin">Sign in / Sign up</Link>
              )}
            </div>
          </div>
        </header>

        {/*
          ── THE UNIT, AT THE FOOT OF THE READING AREA AND NOWHERE ELSE ────────────────────────────────

          `{children}` is the whole page, so a unit printed after it is a block after the reading matter: it
          cannot land inside a paragraph, because nothing here inserts into prose. That is the placement the
          owner's `data-ad-format="auto"` asks for and it is the only placement this file makes — **it is not
          in the masthead, not between the rail and the article, and not in the footer**, because a paid
          rectangle beside the company notice is the one that reads as a banner rather than as a placement.

          ⚠️ **AND IT IS INSIDE `<main>` SO THAT IT IS NEVER INSIDE A FORM.** The React routes allowed here
          render their own content into this element; none of the six is a form page, and the browser check
          that proves the served unit is not inside a `<form>` or a `[contenteditable]` is recorded in the
          round's evidence rather than asserted here.
        */}
        <main id="main">
          {children}
          {ads ? <AdsenseUnit /> : null}
        </main>

        <footer className="site-foot">
          <div className="wrap">
            <p>
              <strong>Ozikoro</strong> — the history and archive of Igbo and African peoples. The
              dictionary is <a href="https://ozituma.com">Ozituma</a> and the academy is{' '}
              <a href="https://academy.ozikoro.com/">Ozikoro Academy</a>.
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
