/**
 * How to cite Ozikoro — the citation guide.
 *
 * THE DESIGN'S OWN INSTRUCTION, FOLLOWED
 *
 * The screen carries a note beside its article example: **"Replace this example with the citation shown on
 * the article itself."** So the worked example on this page is not the design's placeholder — it is
 * `citationFor` run over a real published article, the same function the article page uses. Every other
 * example is the design's *form*, which is guidance rather than a claim about a record, and none of them is
 * presented as a citation of anything that exists.
 *
 * WHY THE FORMS ARE HONEST AND THE EXAMPLES WOULD NOT BE
 *
 * A citation format is instruction: "author, title, publisher, date, permanent URL" is true of every record
 * shape this archive holds. A filled-in example is a statement about a specific record, and inventing one
 * would be exactly what the brief forbids. So the five forms are given as forms, and the one worked example
 * is drawn from the archive.
 *
 * The permanent-URL instruction is real and load-bearing: every public route on this platform is stable, and
 * the archive's own redirect table exists so an address that moves still resolves.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { citationFor } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'How to cite Ozikoro',
  description:
    'Citation formats for Ozikoro articles, archive records, photographs, oral recordings and research publications, with a worked example from the archive.',
  alternates: { canonical: 'https://ozikoro.com/cite' },
  openGraph: {
    title: 'How to cite Ozikoro',
    description: 'Citation formats for everything the archive holds.',
    type: 'article',
  },
};

/** The five record kinds the design names, with its own instructions for each. */
const FORMS: Array<{ id: string; label: string; title: string; body: string }> = [
  {
    id: 'article',
    label: 'Article',
    title: 'Ozikoro article',
    body:
      'Author. “Article title.” Ozikoro, Ozi Ikoro Limited, published date, last updated date. ' +
      'Permanent URL.',
  },
  {
    id: 'record',
    label: 'Archive record',
    title: 'Archive record',
    body:
      'Creator or depositing community. “Record title.” Date. Ozikoro reference number, holding ' +
      'institution. Access terms. Permanent URL.',
  },
  {
    id: 'photograph',
    label: 'Photograph',
    title: 'Photograph',
    body:
      'Photographer, if known. “Image description.” Date, place. Collection or holder, Ozikoro ' +
      'reference number. Reuse terms.',
  },
  {
    id: 'audio',
    label: 'Audio',
    title: 'Oral recording',
    body:
      'Speaker. Interview by recorder, place, recording date. Ozikoro reference number. Timestamp ' +
      'if relevant. Consent and access terms.',
  },
  {
    id: 'publication',
    label: 'Publication',
    title: 'Research publication',
    body:
      'Use the publication’s authors, year, title, journal or collection, version, DOI or permanent ' +
      'Ozikoro URL.',
  },
];

export default async function CitePage() {
  // The worked example: a real article, cited by the same function the article itself uses.
  const db = await getDb();
  // No author is joined, and that is a finding rather than an omission: `ozikoro_article` has no
  // contributor column, so the archive does not record one article-to-author link to follow. `citationFor`
  // falls back to "Ozikoro" — the institution as author — which is the honest citation for a record whose
  // byline is not attached, and it is what the article page itself produces for these articles today.
  const row = await db.one<{ title: string; slug: string; published_at: string | null }>(
    `select title, slug, published_at
       from ozikoro_article
      where status = 'published' and is_page = false
      order by published_at desc nulls last, id
      limit 1`
  );

  const example = row
    ? citationFor({
        authorName: null,
        title: row.title,
        publishedAt: row.published_at,
        url: `https://ozikoro.com/${row.slug}/`,
      })
    : null;

  return (
    <>
      <section className="sx-cite-hero">
        <div className="wrap">
          <p className="eyebrow">For students, teachers and researchers</p>
          <h1>How to cite Ozikoro</h1>
          <p className="lede">
            Choose the kind of record you used. Keep its author or holder, title, version date,
            permanent link and access date together.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-cite-layout">
          <nav className="sx-cite-nav" aria-label="Record kinds">
            {FORMS.map((form) => (
              <a key={form.id} href={`#${form.id}`}>
                {form.label}
              </a>
            ))}
          </nav>

          <div className="sx-cite-examples">
            {FORMS.map((form) => (
              <article key={form.id} id={form.id}>
                <small>Example format</small>
                <h2>{form.title}</h2>
                <p>{form.body}</p>

                {form.id === 'article' && example ? (
                  <>
                    <p>
                      <i>
                        The article page states its own citation, generated from the record. A real
                        one, from the archive:
                      </i>
                    </p>
                    <code>{example}</code>
                    <p className="small muted">
                      <Link href={`/${row?.slug}/`}>Open that article</Link> to see the same citation
                      beside it.
                    </p>
                  </>
                ) : null}
              </article>
            ))}

            <p className="sx-source-note sx-light-note">
              The formats above are the archive&rsquo;s conventions. Worked examples for records,
              photographs, recordings and publications will be added from real material as those
              records are published — this page does not invent them in the meantime.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
