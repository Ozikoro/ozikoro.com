/**
 * The research repository.
 *
 * What is listed is strictly what has been published and made public: a draft, a submission under
 * review and a work whose author has kept it private are all absent. That is not a filter on the
 * display, it is the query (`listPublished`), because a list that showed what it had fetched and hid
 * it in the markup would leak the moment somebody read the response.
 *
 * THE THREE AXES ARE THE BRIEF'S OWN
 *
 * "search and discovery by topic, author or institution — findability is the entire value." All three
 * are here as plain GET filters, so a filtered view of the repository is a URL somebody can cite —
 * which is the same reasoning the archive index carries, and the reason a researcher citing this
 * repository can point at the view they actually used.
 *
 * THE TOOLBAR OFFERS ONLY WHAT EXISTS. The kinds and institutions are counted from the published
 * works rather than written down, so the repository does not advertise a discipline, an institution
 * or a kind that nobody has published under.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  countPublished,
  listInstitutions,
  listPublished,
  listPublishedKinds,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Research',
  description: 'Published research from the Ozikoro network: papers, theses, reports and working papers, with their review status stated.',
  alternates: { canonical: 'https://ozikoro.com/publications' },
};

const PAGE_SIZE = 20;

const KIND_LABEL: Record<string, string> = {
  journal_article: 'Journal article',
  conference_paper: 'Conference paper',
  chapter: 'Chapter',
  book: 'Book',
  thesis: 'Thesis',
  dissertation: 'Dissertation',
  preprint: 'Preprint',
  working_paper: 'Working paper',
  report: 'Report',
  research_note: 'Research note',
  dataset: 'Dataset',
  review: 'Review',
  other: 'Other',
};

/** Names as a citation lists them, with an ampersand before the last of several. */
function authorLine(authors: { name: string }[]): string {
  const names = authors.map((a) => a.name);
  if (names.length === 0) return 'Anonymous';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string): string | null => {
    const value = params[key];
    const raw = Array.isArray(value) ? value[0] : value;
    const text = (raw ?? '').trim();
    return text.length > 0 ? text : null;
  };

  const query = first('q');
  const discipline = first('discipline');
  const kind = first('kind');
  const author = first('author');
  const institution = first('institution');
  const page = Math.max(1, Number.parseInt(first('page') ?? '1', 10) || 1);

  const filters = { search: query, discipline, kind, author, institution };

  const db = await getDb();
  const [works, total, kinds, institutions] = await Promise.all([
    listPublished(db, { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countPublished(db, filters),
    listPublishedKinds(db),
    listInstitutions(db, { limit: 24 }),
  ]);

  const disciplines = [...new Set(works.flatMap((w) => w.disciplines))].sort();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(query || discipline || kind || author || institution);

  const href = (extra: Record<string, string | null>, toPage = 1): string => {
    const search = new URLSearchParams();
    const merged = { q: query, discipline, kind, author, institution, ...extra };
    for (const [key, value] of Object.entries(merged)) {
      if (value) search.set(key, value);
    }
    if (toPage > 1) search.set('page', String(toPage));
    return `/publications${search.toString() ? `?${search}` : ''}`;
  };

  return (
    <>
    <section className="sx-publications-hero">
      <div className="wrap">
        <p className="eyebrow">Ozikoro research network</p>
        <h1>Publications</h1>
        <p className="lede">
          Research papers, essays and scholarly work with clear authorship, review status and access terms.
          Work published through Ozikoro by students, lecturers, independent researchers and community
          knowledge holders — and every entry states whether it completed peer review, and says so where it
          did not.
        </p>
        {/*
          THE SEARCH BOX MATCHES THE THREE THINGS THE BRIEF NAMES AT ONCE: a title, an abstract, an
          author's name and an author's institution. The narrower fields below it exist for when a
          reader knows which axis they mean.
        */}
        <form className="search" method="get" action="/publications" role="search">
          <label className="sr-only" htmlFor="q">Search publications</label>
          <input id="q" name="q" type="search" defaultValue={query ?? ''} placeholder="Search by title, abstract, author or institution" />
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {discipline ? <input type="hidden" name="discipline" value={discipline} /> : null}
          {institution ? <input type="hidden" name="institution" value={institution} /> : null}
          {author ? <input type="hidden" name="author" value={author} /> : null}
          <button className="btn btn-gold" type="submit">Search</button>
        </form>
      </div>
    </section>

    <section className="wrap section">

      <div className="sx-publication-toolbar">
        <nav aria-label="Publication views">
          <Link href="/publications" aria-current={!filtered ? 'page' : undefined}>All</Link>
          {kinds.map((k) => (
            <Link
              key={k.kind}
              href={href({ kind: k.kind })}
              aria-current={kind === k.kind ? 'page' : undefined}
            >
              {KIND_LABEL[k.kind] ?? k.kind.replace(/_/g, ' ')} ({k.works})
            </Link>
          ))}
        </nav>
        <Link className="btn btn-quiet" href="/submit">Submit research</Link>
      </div>

      {/*
        THE NARROWER AXES, WHICH ARE COUNTED FROM THE WORKS RATHER THAN WRITTEN DOWN.
        An institution appears only when a published work names it, and only then can it be filtered
        on — so the repository never offers a filter that matches nothing.
      */}
      <form method="get" action="/publications" className="row section" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: '12rem' }}>
          <label className="small" htmlFor="author">Author</label>
          <input id="author" name="author" type="search" defaultValue={author ?? ''} placeholder="A name, or part of one" />
        </div>
        <div className="field" style={{ minWidth: '12rem' }}>
          <label className="small" htmlFor="institution">Institution</label>
          <input id="institution" name="institution" type="search" defaultValue={institution ?? ''} placeholder="e.g. University of Nigeria" />
        </div>
        {query ? <input type="hidden" name="q" value={query} /> : null}
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {discipline ? <input type="hidden" name="discipline" value={discipline} /> : null}
        <button className="btn btn-quiet" type="submit">Find work</button>
        {filtered ? <Link className="btn btn-quiet" href="/publications">Clear</Link> : null}
      </form>

      {institutions.length > 0 ? (
        <div className="chips section">
          {institutions.map((i) => (
            <Link
              className="chip"
              key={i.institution}
              href={href({ institution: i.institution })}
              aria-current={institution === i.institution ? 'true' : undefined}
            >
              {i.institution} <span className="muted">{i.works}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {works.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">{filtered ? 'Nothing matches' : 'Nothing published yet'}</p>
          {filtered ? (
            <>
              <p>
                No published work matches that. The filters here are counted from the repository&rsquo;s
                own records, so a filter that matches nothing means nothing is published under it yet —
                not that the search failed.
              </p>
              <p className="small">
                <Link href="/publications">See every published work</Link>
              </p>
            </>
          ) : (
            <>
              <p>
                No research has been published here yet. The repository opens with its first accepted
                work rather than with a demonstration entry, because a research repository that lists
                work nobody wrote is worse than an empty one.
              </p>
              <p className="small">
                <Link href="/researchers">See the researchers</Link> who have joined.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="small muted section">
            {total.toLocaleString('en-GB')} {total === 1 ? 'work' : 'works'}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
          </p>
          <div className="stack-lg section">
            {works.map((work) => (
              <article className="entry" key={work.id}>
                <div>
                  <p className="eyebrow">
                    {KIND_LABEL[work.kind] ?? work.kind.replace(/_/g, ' ')}
                    {work.publishedAt ? ` · ${new Date(work.publishedAt).getUTCFullYear()}` : ''}
                  </p>
                  <h3><Link href={work.url}>{work.title}</Link></h3>
                  <p className="small muted">{authorLine(work.authors)}</p>
                  {work.abstract ? <p className="small">{work.abstract.slice(0, 300)}{work.abstract.length > 300 ? '…' : ''}</p> : null}
                  <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
                    {/*
                      The badge states what actually happened. A work that was published without expert
                      review gets the ochre chip, not a peer-reviewed one, and the wording matches the
                      sentence on its own page.
                    */}
                    {work.peerReviewed ? (
                      <span className="chip chip-source">Peer-reviewed</span>
                    ) : (
                      <span className="chip chip-period">Editorially reviewed only</span>
                    )}
                    {work.disciplines.slice(0, 3).map((d) => (
                      <span className="chip" key={d}>{d}</span>
                    ))}
                    {/* The institution is shown where it was recorded, because it is one of the three
                        ways the brief says a work is found. */}
                    {work.authors.find((a) => a.affiliation)?.affiliation ? (
                      <span className="chip">{work.authors.find((a) => a.affiliation)!.affiliation}</span>
                    ) : null}
                    {work.doi ? <span className="chip mono">doi:{work.doi}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 ? (
            <nav className="row section" aria-label="Pagination">
              {page > 1 ? (
                <Link className="btn btn-quiet" href={href({}, page - 1)} rel="prev">← Previous</Link>
              ) : <span />}
              <span className="small muted">{page} / {totalPages}</span>
              {page < totalPages ? (
                <Link className="btn btn-quiet" href={href({}, page + 1)} rel="next">Next →</Link>
              ) : <span />}
            </nav>
          ) : null}
        </>
      )}

        <p className="sx-source-note sx-light-note">
          Publication records shown here carry their own review status. Nothing is marked peer-reviewed
          unless that review actually took place, and a work that has not been through it says so.
        </p>
      </section>
    </>
  );
}
