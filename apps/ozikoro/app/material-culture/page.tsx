/**
 * Material culture — objects and their lives.
 *
 * AN HONEST EMPTY STATE, BECAUSE THE TABLE IS EMPTY
 *
 * The design's screen shows one sample card labelled "Sample record · source context required" with the
 * reference `OZ-OB-EXAMPLE`, and a notice that more verified records appear elsewhere. **The archive's object
 * table holds no rows at all** — measured: `ozikoro_object` is 0 — so this page draws no cards. The brief is
 * explicit that an accessioned-but-undescribed object and a collection with nothing in it are features rather
 * than gaps, and that inventing records to fill a screen is the one thing forbidden.
 *
 * WHAT AN OBJECT RECORD WILL CARRY, FROM THE DESIGN
 *
 * "Objects are described through makers, communities, uses, names and holding institutions." The schema for
 * that exists — `ozikoro_object`, `ozikoro_excavation`, `ozikoro_dating` and the rights tables are migrated —
 * and no record has been accessioned into it. **So the page states what it will hold and that it holds
 * nothing**, which is more use to a reader than a sample that looks like a record.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Material culture',
  description:
    'Objects from the archive, described through their makers, communities, uses, names and holding institutions. No object has been accessioned yet.',
  alternates: { canonical: 'https://ozikoro.com/material-culture' },
  openGraph: {
    title: 'Material culture — Ozikoro',
    description: 'Objects and their lives.',
    type: 'website',
  },
};

/** What the design says an object record carries. None of it exists yet, and the page says so. */
const FIELDS: Array<{ label: string; meaning: string }> = [
  { label: 'Maker', meaning: 'Who made it, where that is known and recorded.' },
  { label: 'Community', meaning: 'The community it belongs to or was documented with.' },
  { label: 'Use', meaning: 'What it is for, and by whom.' },
  { label: 'Name', meaning: 'The name it carries in the language it belongs to.' },
  { label: 'Holding institution', meaning: 'Where the object physically is, and its reference there.' },
  { label: 'Access and reuse', meaning: 'Whether it can be photographed, published or reused, and on what terms.' },
];

export default function MaterialCulturePage() {
  return (
    <>
      <section className="sx-collection-hero">
        <div className="wrap">
          <p className="eyebrow">Objects and their lives</p>
          <h1>Material culture</h1>
          <p className="lede">
            Objects are described through makers, communities, uses, names and holding institutions. The
            archive has not accessioned an object yet, so this collection is empty.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <nav className="sx-subnav" aria-label="Media collections">
          <Link href="/photographs">Photographs</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/listen">Oral recordings</Link>
          <Link href="/material-culture">Material culture</Link>
        </nav>

        <div className="empty section">
          <p className="eyebrow">Collection state</p>
          <h2>No object has been accessioned.</h2>
          <p>
            Nothing is described here yet, and nothing will be described by default. An object appears in
            this collection when its maker, community, use, name, holding institution and access terms are
            recorded together — a record with some of those fields and not others will show what is missing
            rather than being filled in.
          </p>
        </div>

        <section className="section">
          <h2>What an object record carries</h2>
          <table>
            <tbody>
              {FIELDS.map((field) => (
                <tr key={field.label}>
                  <th scope="row">{field.label}</th>
                  <td>{field.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Every one of these is a field the schema can hold and no record yet supplies.
          </p>
        </section>

        <article className="sx-record-placeholder">
          <div>
            <small>How objects arrive</small>
            <h2>More verified records appear here</h2>
            <p>
              Objects enter this collection through the archive&rsquo;s accessioning process, with rights and
              consent recorded before publication. No item has been invented for this page.
            </p>
            <p>
              <Link className="btn" href="/about">
                About Ozi Ikoro
              </Link>
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
