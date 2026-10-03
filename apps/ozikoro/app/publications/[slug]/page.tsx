/**
 * One published work.
 *
 * The design draws the publication page as a scholarly record: the metadata as a `table.record`, the
 * citations in a `cite-block`, and the review status carrying the same visual weight as the
 * provenance block does on an article. That is reproduced here, and the review sentence is generated
 * from the data rather than written into the template — a published work that never saw an expert
 * reviewer says so in words, and one that did says that instead.
 *
 * Every citation style is shown ready to copy. A citation is the thing a reader takes away, and
 * making them assemble it from the metadata would be the page failing at its main job.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { CITATION_STYLES, getPublicationBySlug, humanSize } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  journal_article: 'Journal article', conference_paper: 'Conference paper', chapter: 'Book chapter',
  book: 'Book', thesis: 'Thesis', dissertation: 'Dissertation', preprint: 'Preprint',
  working_paper: 'Working paper', report: 'Report', research_note: 'Research note',
  dataset: 'Dataset', review: 'Review', other: 'Work',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const work = await getPublicationBySlug(db, slug);
  if (!work) return { title: 'Not found' };
  return {
    title: work.title,
    description: work.abstract?.slice(0, 300) ?? `${KIND_LABEL[work.kind] ?? 'Work'} published in the Ozikoro research network.`,
    alternates: { canonical: `https://ozikoro.com${work.url}` },
  };
}

function authorLine(authors: { name: string; affiliation: string | null; orcid: string | null; isCorresponding: boolean }[]): string {
  return authors
    .map((a) => `${a.name}${a.affiliation ? ` (${a.affiliation})` : ''}${a.isCorresponding ? ' *' : ''}`)
    .join(' · ');
}

export default async function PublicationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const work = await getPublicationBySlug(db, slug);
  if (!work) notFound();

  /*
   * A work that is not published is not shown to the public. The author reaches their own through
   * their dashboard, and an editor through the review queue; this page is the public record.
   */
  if (work.status !== 'published' && work.status !== 'archived') notFound();
  if (!work.isPublic) notFound();

  const year = work.publishedAt ? new Date(work.publishedAt).getUTCFullYear() : null;
  const completedReviews = work.reviews.filter((r) => r.completedAt !== null);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': work.kind === 'thesis' || work.kind === 'dissertation' ? 'Thesis' : 'ScholarlyArticle',
    headline: work.title,
    ...(work.abstract ? { abstract: work.abstract } : {}),
    author: work.authors.map((a) => ({
      '@type': 'Person',
      name: a.name,
      ...(a.affiliation ? { affiliation: { '@type': 'Organization', name: a.affiliation } } : {}),
      ...(a.orcid ? { identifier: `https://orcid.org/${a.orcid}` } : {}),
    })),
    ...(work.publishedAt ? { datePublished: work.publishedAt } : {}),
    ...(work.doi ? { identifier: `https://doi.org/${work.doi}` } : {}),
    publisher: { '@type': 'Organization', name: 'Ozi Ikoro Limited' },
    url: `https://ozikoro.com${work.url}`,
    ...(work.licence ? { license: work.licence } : {}),
    isAccessibleForFree: true,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <article>
          <header>
            <p className="eyebrow">
              {KIND_LABEL[work.kind] ?? work.kind}
              {year ? ` · ${year}` : ''}
              {work.peerReviewed ? ' · Peer-reviewed' : ''}
            </p>
            <h1>{work.title}</h1>
            <p className="lede">{authorLine(work.authors)}</p>

            <div className="chips" style={{ marginTop: 'var(--s-4)' }}>
              {work.disciplines.map((d) => <span className="chip" key={d}>{d}</span>)}
              {work.doi ? <span className="chip mono">doi:{work.doi}</span> : null}
              {work.licence ? <span className="chip chip-source">{work.licence}</span> : null}
            </div>
          </header>

          {work.abstract ? (
            <section className="section">
              <p className="eyebrow">Abstract</p>
              <div className="prose"><p>{work.abstract}</p></div>
            </section>
          ) : null}

          {/*
            THE FILES, WITH THEIR SIZE AND TYPE SAID BEFORE THE CLICK.
            A reader deciding whether to download a 4 MB attachment wants to know it is a PDF first,
            which is why the size and the human type are printed beside the link rather than left for
            the browser to reveal. The route decides who may read the bytes; this only offers the
            address, and a work with no file says so instead of showing an empty list.
          */}
          <section className="section" aria-labelledby="files">
            <p className="eyebrow" id="files">Files</p>
            {work.files.length === 0 ? (
              <p className="help">
                No file is attached to this work. The record is complete without one — an abstract and
                its metadata are a deposit — and the author can attach a manuscript at any time.
              </p>
            ) : (
              <ul className="history">
                {work.files.map((f) => (
                  <li key={f.id}>
                    <p className="history__what">
                      <a href={`/publication-file/${f.id}`}>{f.filename}</a>
                    </p>
                    <p className="history__detail">
                      {f.role.replace(/_/g, ' ')} · {f.mimeType === 'application/pdf' ? 'PDF' : f.mimeType} ·{' '}
                      {humanSize(f.sizeBytes)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/*
            The review status, generated from the record rather than written into the template. This is
            the sentence the plan's rule protects, and it is a different sentence depending on what
            actually happened to the work.
          */}
          <section className="provenance section" aria-labelledby="review">
            <p className="eyebrow" id="review">Review status</p>
            <p>{work.reviewStatus}</p>
            {completedReviews.length > 0 ? (
              <ul className="small" style={{ marginTop: 'var(--s-3)' }}>
                {completedReviews.map((r) => (
                  <li key={r.id}>
                    {r.kind.replace(/_/g, ' ')} review completed
                    {r.recommendation ? ` — ${r.recommendation.replace(/_/g, ' ')}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
              The full history of this work&rsquo;s states is recorded: {(work.transitions.map((t) => t.to.replace(/_/g, ' ')).join(' → '))}.
            </p>
          </section>

          <table className="record section">
            <tbody>
              <tr><th scope="row">Type</th><td>{KIND_LABEL[work.kind] ?? work.kind}</td></tr>
              {work.journal ? <tr><th scope="row">Journal</th><td>{work.journal}{work.volume ? `, vol. ${work.volume}` : ''}{work.issue ? `, no. ${work.issue}` : ''}{work.pages ? `, pp. ${work.pages}` : ''}</td></tr> : null}
              {work.publisher ? <tr><th scope="row">Publisher</th><td>{work.publisher}</td></tr> : null}
              {work.authors.length > 0 ? (
                <tr>
                  <th scope="row">Authors</th>
                  <td>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {work.authors.map((a, i) => (
                        <li key={`${a.name}-${i}`}>
                          {a.name}
                          {a.affiliation ? ` · ${a.affiliation}` : ''}
                          {a.orcid ? <> · <a href={`https://orcid.org/${a.orcid}`} rel="noopener noreferrer">{a.orcid}</a></> : null}
                          {a.isCorresponding ? ' · corresponding author' : ''}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ) : null}
              {work.publishedAt ? <tr><th scope="row">Published</th><td>{new Date(work.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</td></tr> : null}
              <tr><th scope="row">Version</th><td>{work.currentVersion} of {work.currentVersion}</td></tr>
              {work.keywords.length > 0 ? <tr><th scope="row">Keywords</th><td>{work.keywords.join(', ')}</td></tr> : null}
              {work.doi ? <tr><th scope="row">DOI</th><td className="mono">{work.doi}</td></tr> : null}
            </tbody>
          </table>

          {work.versions.length > 1 ? (
            <section className="section">
              <p className="eyebrow">Versions</p>
              <p className="small muted">
                Every version is kept. A citation to an earlier one still resolves to what was
                published then.
              </p>
              <ul className="history">
                {work.versions.map((v) => (
                  <li key={v.version}>
                    <div className="history__when">Version {v.version} · {new Date(v.createdAt).toISOString().slice(0, 10)}</div>
                    <p className="history__what">{v.title}</p>
                    {v.changeNote ? <p className="history__detail">{v.changeNote}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="section" aria-labelledby="cite">
            <p className="eyebrow" id="cite">Cite this work</p>
            {CITATION_STYLES.map((style) => (
              <div key={style.value} style={{ marginBottom: 'var(--s-4)' }}>
                <p className="small muted">{style.label}</p>
                <div className="cite-block">{work.citations[style.value]}</div>
              </div>
            ))}
          </section>

          <section className="section">
            <p className="eyebrow">Permanent address</p>
            <p className="mono small">https://ozikoro.com{work.url}</p>
          </section>

          <p className="actions section">
            <Link className="btn" href="/publications">All research</Link>
          </p>
        </article>
      </div>
    </>
  );
}
