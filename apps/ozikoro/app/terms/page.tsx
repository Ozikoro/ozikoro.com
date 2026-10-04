/**
 * `/terms` — what using this archive means, stated from the platform rather than drafted as a contract.
 *
 * ── THE SAME PROBLEM AS `/privacy`, AND THE SAME ANSWER ───────────────────────────────────────────────
 *
 * The design brief §3.6 requires terms. **The design draws no `terms.html`**, and the one screen that
 * mentions terms states that they do not exist yet:
 *
 *     about.html   "Binding terms must be supplied by Ozi Ikoro Limited."
 *
 * The repository holds none. `data/nzeora-wp/pages.json` holds twelve migrated pages and not one of them
 * is a terms document — the only legal page in the dump is Nzeora.com's privacy policy, which belongs to
 * a job blog and is not this platform's. **So no binding term is written here, and none is invented.**
 *
 * ── WHAT IS WRITTEN HERE ──────────────────────────────────────────────────────────────────────────────
 *
 * The rules that are already true of the platform and can be demonstrated from it: that a record carries
 * its own access and reuse terms, that every published record has a permanent address, that corrections
 * are logged rather than hidden, that contributed material is reviewed before it publishes, that a
 * takedown request is honoured, and that the material published here is not offered for reuse under a
 * blanket licence because there is no blanket licence to offer.
 *
 * That is a statement of how the archive behaves. **It is not a contract and this page says so**, in the
 * design's own words and in the place the design puts them. When Ozi Ikoro Limited supplies binding
 * terms, they replace the first section below; the doc comment on that section says which one goes.
 *
 * ── THE ADDRESS ───────────────────────────────────────────────────────────────────────────────────────
 *
 * A React route using the design's classes, like `/about`, `/privacy` and `/clans`. `public/design/` is
 * untouched. The address is new and the design does not draw it — recorded as a design decision rather
 * than taken quietly, because the alternative was a dead link in the footer of every page on the site.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'How Ozikoro behaves: each record carries its own access and reuse terms, every published record has a permanent address, corrections are logged, and binding terms of use have not yet been supplied by Ozi Ikoro Limited.',
  alternates: { canonical: 'https://ozikoro.com/terms' },
  robots: { index: true, follow: true },
};

const n = (value: number) => value.toLocaleString('en-GB');

export default async function TermsPage() {
  const db = await getDb();

  /*
   * THE FIGURES ARE READ, NOT REMEMBERED. A terms page that miscounts what the archive publishes is a
   * small lie in a place that is supposed to be about trust, and this archive's rule is that a number is
   * either measured or absent.
   */
  const counts = await db.one<{
    records: number; media: number; with_licence: number; no_licence: number; cc0: number; cc_by_sa: number;
  }>(`
    select
      (select count(*)::int from ozikoro_article where status = 'published' and is_page = false) as records,
      (select count(*)::int from ozikoro_media) as media,
      (select count(*)::int from ozikoro_media where licence is not null and licence <> '') as with_licence,
      (select count(*)::int from ozikoro_media where licence is null or licence = '') as no_licence,
      /*
       * THE TWO FREE LICENCES ARE COUNTED SEPARATELY AND THE PUBLIC-DOMAIN STATEMENT IS DERIVED.
       *
       * "Public domain (as stated by the record)" is the archive's own phrasing for a licence read out of
       * the record rather than granted by a licence deed, so it is the recorded total minus CC0 minus
       * CC BY-SA rather than a fourth number written down here. See "apps/ozikoro/app/privacy/page.tsx",
       * which reports the same three figures from the same table.
       */
      (select count(*)::int from ozikoro_media where licence = 'CC0 1.0 Universal (Public Domain Dedication)') as cc0,
      (select count(*)::int from ozikoro_media where licence = 'Creative Commons Attribution-ShareAlike (CC BY-SA)') as cc_by_sa
  `);

  const c = counts ?? { records: 0, media: 0, with_licence: 0, no_licence: 0, cc0: 0, cc_by_sa: 0 };
  /** The remainder of the recorded licences: those the record itself states as public domain. */
  const publicDomain = Math.max(c.with_licence - c.cc0 - c.cc_by_sa, 0);

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The institution</p>
          <h1>Terms</h1>
          <p className="lede">
            How this archive behaves towards the people who read it and the people whose histories it
            holds. Binding terms of use have not yet been supplied by Ozi Ikoro Limited, and this page does
            not invent them.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="prose">
          <div className="provenance section" aria-labelledby="terms-state">
            <p className="eyebrow">The state of these terms</p>
            <h2 id="terms-state">Binding terms have not been supplied.</h2>
            <p>
              Ozi Ikoro Limited publishes this archive and has not yet supplied binding terms of use. The
              design&rsquo;s own institution page says exactly that, and it stays true, so it stays. What
              follows is not a substitute: it is what applies <em>today</em>, and every one of these
              statements is a property of the platform that can be checked against it.
              <strong> When binding terms are supplied they replace this section</strong> rather than sitting
              beside it.
            </p>
          </div>

          <h2>What this archive is</h2>
          <p>
            Ozikoro is published by Ozi Ikoro Limited — an archive of Igbo and wider African histories,
            photographs, documents and recordings. It is one institution with three public tools:
            ozikoro.com holds the archive, <a href="https://ozituma.com/">ozituma.com</a> is the
            African-languages dictionary, and <Link href="/academy/">the Academy</Link> is where the
            language courses are being prepared. Its own page is <Link href="/about">About</Link>.
          </p>
          <p>
            The archive holds <strong>{n(c.records)} published records</strong> and{' '}
            <strong>{n(c.media)} media items</strong>. Reading it is free, and no part of it requires an
            account. An account is needed only to contribute, to keep a collection, or to work in the
            editorial back office.
          </p>

          <h2>Reuse: each record carries its own terms</h2>
          <p>
            <strong>There is no blanket licence over this archive, and this page cannot grant one.</strong>{' '}
            Each record displays its own access and reuse terms with the record, and those are the terms
            that apply to it. Where a record states a licence it is shown on the record; where the archive
            holds none, the record says so rather than implying a permission.
          </p>
          <ul>
            <li>
              Of {n(c.media)} media items, <strong>{n(c.with_licence)} carry a recorded licence</strong> —
              a licence read from the record itself, reproduced in the record&rsquo;s own words. The
              remaining <strong>{n(c.no_licence)}</strong> carry none, and reuse of those is{' '}
              <strong>not granted</strong> by this archive.
            </li>
            <li>
              A licence recorded here was read by a machine from what the record states, and{' '}
              <strong>it is not a rights determination by a person</strong>. The archive&rsquo;s rights
              register records who checked an item and when, and it records none as checked. Treat a
              recorded licence as the record&rsquo;s own claim about itself, which is what it is.
            </li>
            <li>
              <strong>Every one of those {n(c.with_licence)} rests on a licence the record itself stated</strong>{' '}
              — {n(publicDomain)} as public domain, {n(c.cc_by_sa)} as CC BY-SA and {n(c.cc0)} as CC0.{' '}
              <strong>None rests on written permission, on a contract, or on an institutional agreement</strong>,
              because the archive has recorded none of those three.
            </li>
            <li>
              <strong>Nothing on this site grants a right to reuse a photograph of a person</strong>, or a
              recording of a voice, whoever holds the copyright in it. The rights register carries a field for
              whether a living person is depicted and another for their consent, and{' '}
              <strong>every entry in it has both left unset</strong> — so the archive does not claim that
              nobody is depicted, and a licence read from a file cannot settle the question anyway.
            </li>
          </ul>

          <h2>Citing a record</h2>
          <p>
            Every published record has a permanent address that will not change, and is citable as one
            publisher: <strong>Ozi Ikoro Limited</strong>. The <Link href="/cite">citation guide</Link> gives
            the format for an article, a photograph, a recording and a publication, and the worked example
            there is generated from a real record rather than written by hand.
          </p>
          <p>
            A record&rsquo;s address is permanent even where its content is corrected. Corrections are
            logged rather than hidden, so a citation to a record remains a citation to the same record.
          </p>

          <h2>Contributing material</h2>
          <p>
            Material is offered through <Link href="/submit">Contribute</Link>. Three things are true of
            everything contributed, and they are the archive&rsquo;s editorial method rather than a term of
            service:
          </p>
          <ol>
            <li>
              <strong>You choose the access and reuse terms</strong>, and they are shown with the record.
              The archive does not take a licence you did not give.
            </li>
            <li>
              <strong>An editor reviews it before it publishes.</strong> Nothing a contributor submits
              appears on the site unreviewed; material lands in the editorial queue and a person decides.
            </li>
            <li>
              <strong>Nothing is invented to fill a gap.</strong> Where a record is incomplete, the page says
              what is missing. A record with no source looks incomplete on purpose, because it is.
            </li>
          </ol>
          <p>
            Imported corpus material is attributed to its source and stays unpublished unless its licence
            permits publication. The archive&rsquo;s sources and their terms are recorded in{' '}
            <code>docs/DATA-SOURCES.md</code> in the project repository.
          </p>

          <h2>Corrections and takedown</h2>
          <p>
            Anyone may propose a correction, whether or not they have an account, and a correction is
            reviewed and logged rather than applied silently. Where a correction changes a record, the record
            says that it was changed.
          </p>
          <p>
            <strong>
              If you are in a photograph or a recording on this site and you want it removed, write to
              <a href="mailto:archive@ozikoro.com"> archive@ozikoro.com</a>.
            </strong>{' '}
            The rights register holds a takedown field and a withdrawal state for exactly this. You do not
            have to give a reason and you do not have to be the copyright holder: the archive&rsquo;s
            position is that a person&rsquo;s own objection to their own image or voice outweighs a licence
            read by a machine.
          </p>

          <h2>What the archive does with your use of the site</h2>
          <p>
            Reading this site involves no tracking, no advertising and no analytics, and the only cookies it
            sets are the two it needs to work. What is stored about an account, what leaves the platform and
            to whom, and what has not yet been decided about retention and lawful basis are all set out in{' '}
            <Link href="/privacy">Privacy</Link>. This page does not repeat it, so the two cannot disagree.
          </p>

          <h2>What has not been supplied</h2>
          <p className="partial-note">
            The following belong to binding terms, and <strong>none of them exists yet</strong>. They are named
            rather than drafted, because drafting them here would produce a plausible contract that binds
            nobody:
          </p>
          <ul>
            <li><strong>The terms themselves</strong> — what a reader or contributor agrees to, and what the publisher warrants.</li>
            <li><strong>A governing law and jurisdiction.</strong></li>
            <li><strong>Limitation of liability, and any warranty</strong> about the accuracy of a record.</li>
            <li><strong>Any change process</strong> — how these terms would be varied and how a change would be announced.</li>
          </ul>

          <h2>Writing to us</h2>
          <p>
            Corrections, takedown requests and material offered to the archive:{' '}
            <a href="mailto:archive@ozikoro.com">archive@ozikoro.com</a>. Anything else:{' '}
            <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
          </p>
          <p className="small muted">
            The institution&rsquo;s own page is <Link href="/about">About</Link>, and what the platform holds
            about people is in <Link href="/privacy">Privacy</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
