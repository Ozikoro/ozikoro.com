import type { Metadata } from 'next';
import { IBM_Plex_Sans, Libre_Baskerville } from 'next/font/google';
import { LearnFooter, LearnHeader } from '@/components/learn/learn-chrome';
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
 * The same two typefaces as the dictionary, so the two read as one family. §7 requires fonts be
 * tested for Igbo diacritics; both carry the dot-below vowels and the dotted ṅ, which is why the
 * vocabulary cards render correctly.
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
    <html lang="en" className={`${plexSans.variable} ${libreBaskerville.variable}`}>
      <body>
        <LearnHeader info={info} signedIn={session !== null} />
        <main>{children}</main>
        <LearnFooter info={info} />
      </body>
    </html>
  );
}
