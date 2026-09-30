import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { NavMenu } from '@/components/nav-menu';
import { getCurrentAccount } from '@/lib/session';
import { IBM_Plex_Sans, Libre_Baskerville } from 'next/font/google';
import './globals.css';

/*
 * The Ozikoro design system's two faces. Declared here rather than in CSS so
 * Next.js self-hosts them: no request to Google at runtime, no layout shift,
 * and the build stays deployable to an environment with no outbound access.
 *
 * Libre Baskerville carries headings; IBM Plex Sans carries everything else.
 * The CSS variables are read by --font-serif and --font-body in globals.css.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const libreBaskerville = Libre_Baskerville({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-libre-baskerville',
  display: 'swap',
});

/*
 * The brand kit's own files, served from /public.
 *
 * Everything the kit's head-snippet.html asks for, expressed as Next metadata so it is
 * emitted once and cannot drift from the files: the favicon set (including the maskable
 * icon Android needs and the pinned-tab mask for Safari), the web manifest, the 1200x630
 * sharing image, and the theme colour the kit names as Ink.
 *
 * The ICO comes first because a browser that understands nothing else still asks for
 * /favicon.ico, and the SVG is offered next because the kit ships a mark simplified for
 * 16 px. Order matters: the first entry a browser understands is the one it uses.
 */
export const metadata: Metadata = {
  title: {
    default: 'Ozituma — African language dictionary',
    template: '%s · Ozituma',
  },
  description:
    'The dictionary of Ozikoro: a multi-language dictionary of African languages with pronunciations, dialect variants and a free public API.',
  metadataBase: new URL(process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'),
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    other: [{ rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#C8792B' }],
  },
  openGraph: {
    siteName: 'Ozituma',
    type: 'website',
    images: [
      { url: '/og-image-1200x630.png', width: 1200, height: 630, alt: 'Ozituma' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image-1200x630.png'],
  },
};

/** The kit's Ink, which the browser paints its own chrome with. */
export const viewport: Viewport = { themeColor: '#1E1B16' };

/**
 * This application serves the dictionary at ozituma.com, and nothing else.
 *
 * It used to serve learn.ozituma.com as well, choosing its chrome from the Host header. The
 * courses now have their own app (`apps/learn`) and their own deployment, for the reasons §6.1
 * gives: a separate release cycle and a clean boundary, so that a change to the lesson player
 * cannot take the dictionary down and vice versa. The chrome no longer has to branch, which
 * removes a whole class of bug rather than managing it.
 *
 * `ozituma.com/learn` still works — it redirects to the subdomain, so the navigation link and any
 * shared link keep resolving.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * The account link lives in the application chrome rather than only where it happens to be
   * needed. The owner: "i need you to add login page to the menu so one can easily login". Until
   * now the only ways in were the footer, a link on the contribution and entry pages, and typing
   * the URL — which is not a way in. One slot reads "Sign in" when nobody is signed in and
   * "Account" when somebody is, so it is both the door and the way back to your own page.
   */
  const current = await getCurrentAccount();

  return (
    <html lang="en" className={`${plexSans.variable} ${libreBaskerville.variable}`}>
      <body>
        <header className="site-header">
          <div className="wrap">
            {/*
              The brand kit's horizontal lockup, which is the mark, the book and the
              ikoro with the wordmark beside them. It is drawn for light backgrounds,
              which is what the header is; the site's own text mark was three spans
              that said the same thing less well and could drift from the kit.

              The words are in the SVG as outlines, so there is nothing to load and
              nothing to go wrong — and the alt text is on the link, because the image
              is the link's only content.
            */}
            <Link href="/" className="brand" aria-label="Ozituma — the dictionary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="brand-logo"
                src="/ozituma-logo.svg"
                alt="Ozituma"
                width={721}
                height={250}
              />
              <span className="brand-label">The Dictionary</span>
            </Link>
            <NavMenu>
              {/*
                One entry for the API, and it is last.

                "API" and "Get a key" were two items pointing at two halves of one
                subject — the documentation and the way in — which made the
                navigation longer and made a reader choose between them before
                knowing the difference. The owner asked for one, at the end, with
                each page reaching the other from inside it. The docs page links to
                getting a key; the key page links back to the docs.
              */}
              <Link href="/">Dictionary</Link>
              <Link href="/names">Names</Link>
              <Link href="/clans">Clans</Link>
              <Link href="/languages">Languages</Link>
              <Link href="/practice">Practice</Link>
              <Link href="/learn">Learn</Link>
              <Link href="/proverbs">Proverbs</Link>
              <Link href="/contribute">Contribute</Link>
              <Link href="/ndebe">Ndebe</Link>
              <Link href="/donate" className="nav-donate">
                Support us
              </Link>
              <Link href="/about">About</Link>
              <Link href="/docs">API</Link>
            <Link href={current ? '/account' : '/signin'}>
              {current ? 'Account' : 'Sign in'}
            </Link>
            </NavMenu>
          </div>
        </header>

        <main>{children}</main>

        {/*
          One line.

          The owner: "can you at least minimise or fix it to be able to be in a straight one
          line, if possible remove some things, so there will be just one line. look at, you
          even had to add explore under the first row because of no space. It is too much."

          He is right about the cause as well as the symptom. The footer was five columns —
          the logo and a paragraph, "Use the data", "Support", "Ozikoro" and then "Explore",
          which existed only because the other four had taken the width. Almost everything in
          it was already in the header: Names, Languages, Practice, Ndebe, Contribute,
          Volunteer, Support us, About and API are all one click away at the top of every
          page. Repeating them at the bottom made the footer longer without making anything
          easier to find.

          So this is the small set that is NOT in the header and has to be reachable from
          somewhere: the legal pages, the documentation, the archive it belongs to, and how to
          write to it. The description paragraph is gone because the About page says it
          properly, and Explore is gone because the header is Explore.

          It is one row on a desktop. On a phone it wraps rather than scrolling sideways,
          which is the one thing a single line cannot be at 360 pixels.
        */}
        {/*
          One section, not five.

          The owner, after the first attempt: "You now hide the footer to be in one line,
          instead of just one section. I never told you to change the section or remove the
          ozikoro short description and the logo, neither did other pages that are not on the
          menu show. i need them back, just dont make it more than one section."

          He wanted it shorter, not emptier, and those are different things. What was wrong
          was five columns of navigation duplicating the header — "Use the data", "Support",
          "Ozikoro", and an "Explore" that existed only because the other four had taken the
          width. What belongs in a footer is what is NOT in the menu: the legal pages, the
          documentation, contact, and one line saying what this is and whose it is.

          So: one block. The mark, the sentence, the links, the year. It sits on one line on a
          desktop and wraps on a phone, and there is nothing else in it.
        */}
        <footer className="site-footer">
          <div className="wrap footer-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="footer-logo"
              src="/ozituma-logo-reversed.svg"
              alt="Ozituma"
              width={721}
              height={250}
            />
            <p className="footer-about">
              The dictionary of{' '}
              <a href="https://ozikoro.com" rel="noopener">
                Ozikoro
              </a>
              . Its history and archive sit at ozikoro.com; the words live here.
            </p>
            <nav className="footer-links" aria-label="Ozituma">
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/docs">API</Link>
              <Link href="/developers">Free key</Link>
              <a href="/api/health">Status</a>
              <a href="mailto:hello@ozikoro.com">Email</a>
            </nav>
            <p className="footer-note">© {new Date().getFullYear()} Ozikoro</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
