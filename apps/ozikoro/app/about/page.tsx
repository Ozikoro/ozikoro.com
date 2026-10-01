/**
 * About — the institution.
 *
 * The design draws a full institutional story for this screen (a hero, the founders, the partners,
 * the terms). Reproducing that faithfully is a later round's work, and inventing it here would be
 * worse than saying so.
 *
 * What this route does instead is serve the real thing: the About US page the owner wrote on the
 * previous Ozikoro site, carried across with its text intact. It exists now because without it
 * `/about` would fall through to the article route and render the institution page as though it
 * were a history of somewhere — with a "no sources attached" note under it, which would be exactly
 * the kind of category error the archive is supposed to avoid.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getArticleBySlug } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Ozikoro is the history and archive of Igbo and African peoples, published by Ozi Ikoro Limited. Its dictionary is Ozituma.',
  alternates: { canonical: 'https://ozikoro.com/about' },
};

export default async function AboutPage() {
  const db = await getDb();
  const page = await getArticleBySlug(db, 'about');

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The institution</p>
        <h1>{page?.title ?? 'About Ozikoro'}</h1>
        <p className="lede">
          Ozikoro is the parent of Ozituma, the Igbo dictionary, and of Ozituma Learn. It is
          published by Ozi Ikoro Limited.
        </p>
      </header>

      {page ? (
        <div className="prose section" dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
      ) : (
        <div className="empty section">
          <p className="eyebrow">Not yet written</p>
          <p>
            The institutional account has not been carried across. Write to{' '}
            <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a> in the meantime.
          </p>
        </div>
      )}

      <section className="section">
        <p className="eyebrow">The platform</p>
        <p>
          Ozikoro is one institution with three roles. The archive is here; the dictionary is{' '}
          <a href="https://ozituma.com">Ozituma</a>; the courses are{' '}
          <a href="https://learn.ozituma.com">Ozituma Learn</a>. One account works across them.
        </p>
        <p className="small">
          <Link href="/archive">Browse the archive</Link>
        </p>
      </section>

      <div className="partial-note section">
        <p className="eyebrow">On this page</p>
        <p>
          This is the account carried across from the previous Ozikoro site. The designed
          institutional page — the founders, the partners and the terms, as the design brief sets
          them out — is not built yet, and this page does not pretend to be it.
        </p>
      </div>
    </div>
  );
}
