import type { Metadata, Viewport } from 'next';
import { Fraunces, Nunito_Sans } from 'next/font/google';
import { LearnFooter, LearnHeader } from '@/components/learn/learn-chrome';
import { PwaRegister } from '@/components/learn/pwa-register';
import { learnHost } from '@/lib/learn-request';
import { getCurrentAccount } from '@/lib/session';
import './globals.css';

/**
 * The layout for learn.ozituma.com.
 *
 * ONE SITE, ONE CHROME. The dictionary app has to decide per request whether it is rendering the
 * dictionary or the courses, because it serves both hostnames. This app serves only the courses,
 * so there is no branch here — the header and footer are unconditionally Learn's, and the whole
 * class of bug where a learner on the subdomain is shown the dictionary's eleven-item navigation
 * cannot occur.
 *
 * THE TWO TYPEFACES THE DESIGN SPECIFIES.
 *
 * This replaced IBM Plex Sans and Libre Baskerville. Both were competent and both were wrong here:
 * the design sets Fraunces for display and Nunito Sans for body, and that difference is most of why
 * the app read as a reference tool rather than a place to learn. Fraunces is a soft, slightly wonky
 * serif with real presence at 4xl; Libre Baskerville is a book face that wants a printed page.
 *
 * On Igbo diacritics, which §7 requires be checked: Nunito Sans carries the dot-below vowels
 * (ị ọ ụ ẹ) and Fraunces carries them too, so no vocabulary word falls back to another font
 * mid-word. Both are variable, so the weights below cost one file each.
 */
const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito-sans',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-fraunces',
  display: 'swap',
});

/**
 * `theme_color` in the manifest colours the installed app's own chrome; this colours the browser UI
 * on an ordinary visit, which the manifest does not reach. Both are declared because they apply to
 * different things and only one is in play at a time.
 */
export const viewport: Viewport = {
  themeColor: '#1b1a2e',
  width: 'device-width',
  initialScale: 1,
  // Not capped. A learner may want to zoom in on a tone mark, and preventing that is an
  // accessibility failure — §13 asks for WCAG 2.2 AA.
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: 'Ozituma Learn — language courses',
    template: '%s · Ozituma Learn',
  },
  description:
    'Learn African languages from the first conversation. Beginner courses built on the Ozituma dictionary, starting with Igbo.',
  metadataBase: new URL(process.env.OZITUMA_LEARN_URL ?? 'https://learn.ozituma.com'),
  openGraph: { siteName: 'Ozituma Learn', type: 'website' },
};

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  // Still resolved per request, because the canonical origin and the outbound links to the
  // dictionary are configuration rather than constants.
  const info = await learnHost();
  // The session is read here rather than in the header component so the header stays a plain
  // presentational component with no database access of its own — which is what lets the one
  // chrome serve every page without each of them remembering to pass a session.
  const session = await getCurrentAccount();

  return (
    <html lang="en" className={`${nunitoSans.variable} ${fraunces.variable}`}>
      <body>
        <LearnHeader
          info={info}
          signedIn={session !== null}
          canReview={session?.canReviewLearn ?? false}
        />
        <main>{children}</main>
        <LearnFooter info={info} />
        {/*
          Registers the service worker and drains the offline queue. A client component because
          both are browser concerns; it renders nothing unless there is something to say.
        */}
        <PwaRegister signedIn={session !== null} />
      </body>
    </html>
  );
}
