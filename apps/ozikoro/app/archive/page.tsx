/**
 * The archive index, with the design's filter rail.
 *
 * Filtering is a plain GET form, exactly as the design specifies: "Search and filtering are plain
 * `GET` forms that submit and reload, so results have bookmarkable, citable addresses." That is
 * not a limitation to work around. A filtered view of a historical archive is a citation, and a
 * citation needs a URL.
 *
 * THE RAIL IS COUNTED, NOT DRAWN FROM A CONSTANT
 *
 * The design draws fixed groups — five period bands, three source types. The archive holds 1,051
 * published records with **no period and no source type recorded on any of them**, because the
 * WordPress migration carried no such fields and the brief forbids inventing them. So every option
 * here is a `group by` over the records that actually exist (`getArchiveFacets`), and a group with
 * no rows is rendered as a sentence saying nothing is recorded yet rather than as an empty list or
 * an invented spread of counts. **The rail fills itself the moment an editor records the first
 * period** — which is the whole reason the counts are queried rather than written down.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  countArticles,
  getArchiveFacets,
  isEntityRoleFilter,
  listArticles,
  listTopics,
  type EntityRoleFilter,
} from '@ozikoro/platform';
import { ArticleEntry } from '../_components/article-entry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Histories',
  description:
    'The Ozikoro archive: town and kingdom histories, colonial records, oral histories and migration records, searchable and filterable by people, clan, place, period and source type.',
  alternates: { canonical: 'https://ozikoro.com/archive' },
};

const PAGE_SIZE = 24;

/** The rail's filter state, as it arrives in the URL. */
interface RailState {
  topic: string | null;
  q: string | null;
  place: string | null;
  ethnic: string | null;
  entity: string | null;
  role: EntityRoleFilter | null;
  period: string | null;
  source: string | null;
  completeness: 'sourced' | 'partial' | null;
  order: 'recent' | 'title';
}

/** Every rail parameter that is currently narrowing the listing, for the chips row. */
function activeKeys(state: RailState): string[] {
  const keys: string[] = [];
  if (state.topic) keys.push('topic');
  if (state.q) keys.push('q');
  if (state.place) keys.push('place');
  if (state.ethnic) keys.push('ethnic');
  if (state.entity) keys.push('entity');
  if (state.period) keys.push('period');
  if (state.source) keys.push('source');
  if (state.completeness) keys.push('completeness');
  return keys;
}

function href(state: Partial<RailState>, page = 1): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  if (page > 1) search.set('page', String(page));
  return `/archive${search.toString() ? `?${search}` : ''}`;
}

export default async function ArchivePage({
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

  const state: RailState = {
    topic: first('topic'),
    q: first('q'),
    place: first('place'),
    ethnic: first('ethnic'),
    entity: first('entity'),
    role: (() => {
      const raw = first('role');
      return raw && isEntityRoleFilter(raw) ? raw : null;
    })(),
    period: first('period'),
    source: first('source'),
    completeness: first('completeness') === 'sourced' ? 'sourced' : first('completeness') === 'partial' ? 'partial' : null,
    order: first('order') === 'title' ? 'title' : 'recent',
  };

  const page = Math.max(1, Number.parseInt(first('page') ?? '1', 10) || 1);

  const db = await getDb();
  const [topics, facets, articles, total] = await Promise.all([
    listTopics(db),
    getArchiveFacets(db),
    listArticles(db, {
      topicSlug: state.topic,
      search: state.q,
      place: state.place,
      ethnicGroup: state.ethnic,
      entitySlug: state.entity,
      period: state.period,
      sourceType: state.source,
      completeness: state.completeness,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      order: state.order,
    }),
    countArticles(db, {
      topicSlug: state.topic,
      search: state.q,
      place: state.place,
      ethnicGroup: state.ethnic,
      entitySlug: state.entity,
      period: state.period,
      sourceType: state.source,
      completeness: state.completeness,
    }),
  ]);

  const populated = topics.filter((t) => t.articleCount > 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeTopic = state.topic ? populated.find((t) => t.slug === state.topic) : null;

  /*
   * WHY A FILTER MATCHED NOTHING, SAID OUT LOUD.
   *
   * The brief's requirement is exact: "If a filter would return nothing because no record carries
   * that value, the interface must say so rather than showing an empty list with no explanation."
   * A filter that matches nothing because the archive has no such value and a filter that matches
   * nothing because the reader's words are not in the record are DIFFERENT ANSWERS, and an empty
   * grid says neither. So the reason is derived here, from what the rail counted, and printed.
   */
  const reason = ((): string | null => {
    if (total > 0) return null;
    if (state.place) return `No record in the archive names a place matching “${state.place}”. Nothing is hidden — the archive holds no such place yet.`;
    if (state.q) return `No record in the archive contains “${state.q}”. Nothing is hidden — the search found nothing.`;
    if (state.entity) return 'No published record is linked to that clan or town yet. Linking a record to a clan is editorial work, and the record page says so where it applies.';
    if (state.ethnic) return `No published record is linked to a clan in the ${state.ethnic} grouping yet. The grouping comes from the dictionary's own clan records, so a record appears here as soon as one is linked.`;
    if (state.period) return `No record carries the period “${state.period}”. That period is not in the archive at all — the filter is drawn from the records themselves, so this can only happen for an address typed by hand.`;
    if (state.source) return `No record carries that source type yet. Of ${facets.records.toLocaleString('en-GB')} published records, none has a source type recorded — sourcing is editorial work and nothing fills it in automatically.`;
    if (state.completeness === 'sourced') return `No record is fully sourced yet. Every one of the ${facets.records.toLocaleString('en-GB')} published records is waiting on an editor to record what it rests on.`;
    if (state.topic) return 'This series has no published records yet. That is a gap in the archive rather than a search that failed.';
    return 'The archive has no published records yet. That would mean the WordPress import has not run.';
  })();

  const active = activeKeys(state);

  return (
    <div className="wrap section">
      <header className="row">
        <div>
          <p className="eyebrow">The archive</p>
          <h1>{activeTopic ? activeTopic.name : 'Histories'}</h1>
          <p className="lede">
            {activeTopic?.description ??
              'Town and kingdom histories, colonial records, oral histories and migration records. Every record keeps the address it was published at.'}
          </p>
        </div>
      </header>

      {/*
        THE SEARCH BOX IS ABOVE THE RAIL, NOT INSIDE IT.
        The rail narrows by a value the archive already holds; the search box matches words in the
        record. They are different questions and the design draws them as different things, so the
        free-text field is its own GET form and the rail's Apply button only commits the rail.
      */}
      <form className="search section" method="get" action="/archive" role="search">
        <label className="sr-only" htmlFor="q">Search the archive</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={state.q ?? ''}
          placeholder="Search the archive — a title, a town, a person"
        />
        {state.topic ? <input type="hidden" name="topic" value={state.topic} /> : null}
        <button className="btn btn-ink" type="submit">Search</button>
      </form>

      <div className="sidebar-layout section">
        <aside className="rail" aria-label="Filter the archive">
          {/* The design puts a spread header above the rail: what it is, and a way to clear it. */}
          <div className="spread">
            <strong>Filters</strong>
            <Link className="small" href="/archive">Clear all</Link>
          </div>

          <form method="get" action="/archive">
            {/* The search box is its own form, so its value rides along rather than being lost. */}
            {state.q ? <input type="hidden" name="q" value={state.q} /> : null}

            <fieldset>
              <legend>Ethnic group</legend>
              {facets.ethnicGroups.length === 0 ? (
                <p className="small muted">
                  No record is linked to a clan yet, so no ethnic group can be shown. The grouping
                  is read from the clan record, and none has been linked.
                </p>
              ) : (
                <ul className="stack">
                  {facets.ethnicGroups.map((e) => (
                    <li key={e.value}>
                      <Link
                        href={href({ ...state, ethnic: e.value, entity: null })}
                        aria-current={state.ethnic === e.value ? 'true' : undefined}
                      >
                        {e.label} <span className="muted">{e.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <fieldset>
              <legend>Sub-group or clan</legend>
              {facets.clans.length === 0 ? (
                <p className="small muted">
                  No published record names a clan yet. The archive holds 188 towns and clans in the
                  dictionary; linking a history to one is editorial work.
                </p>
              ) : (
                <ul className="stack">
                  {facets.clans.map((c) => (
                    <li key={c.value}>
                      <Link
                        href={href({ ...state, entity: c.value, ethnic: null })}
                        aria-current={state.entity === c.value ? 'true' : undefined}
                      >
                        {c.label} <span className="muted">{c.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="small">
                <Link href="/towns">All towns and clans &rarr;</Link>
              </p>
            </fieldset>

            <fieldset>
              <legend>Town or place</legend>
              {/* The design's own placeholder, kept because it describes what the field matches. */}
              <label className="small">
                <input type="search" name="place" defaultValue={state.place ?? ''} placeholder="Town or place" />
              </label>
              <p className="small muted">
                Matches the towns, villages and named sites this record is linked to, and the towns
                inside its clan — the place names are searched where they are recorded, in the
                dictionary, rather than copied onto the record.
              </p>
            </fieldset>

            <fieldset>
              <legend>Time period</legend>
              {facets.periods.length === 0 ? (
                <p className="small muted">
                  No record in the archive has a period recorded yet. Dating is editorial work, and
                  this filter fills when it is done rather than being approximated now.
                </p>
              ) : (
                <ul className="stack">
                  {facets.periods.map((p) => (
                    <li key={p.value}>
                      <Link
                        href={href({ ...state, period: p.value, completeness: null })}
                        aria-current={state.period === p.value ? 'true' : undefined}
                      >
                        {p.label} <span className="muted">{p.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <fieldset>
              <legend>Source type</legend>
              {facets.sourceTypes.length === 0 ? (
                <p className="small muted">
                  No record has a source type recorded yet. Of {facets.records.toLocaleString('en-GB')}{' '}
                  published entries, {facets.withAnySource.toLocaleString('en-GB')} carries a source of its own.
                </p>
              ) : (
                <ul className="stack">
                  {facets.sourceTypes.map((s) => (
                    <li key={s.value}>
                      <Link
                        href={href({ ...state, source: s.value, completeness: null })}
                        aria-current={state.source === s.value ? 'true' : undefined}
                      >
                        {s.label} <span className="muted">{s.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <fieldset>
              <legend>Completeness</legend>
              <ul className="stack">
                <li>
                  <Link href={href({ ...state, completeness: null })} aria-current={!state.completeness ? 'true' : undefined}>
                    All entries <span className="muted">{facets.records.toLocaleString('en-GB')}</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href={href({ ...state, completeness: 'sourced' })}
                    aria-current={state.completeness === 'sourced' ? 'true' : undefined}
                  >
                    Fully sourced only <span className="muted">{facets.sourced.toLocaleString('en-GB')}</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href={href({ ...state, completeness: 'partial' })}
                    aria-current={state.completeness === 'partial' ? 'true' : undefined}
                  >
                    Partial &mdash; help needed <span className="muted">{facets.partial.toLocaleString('en-GB')}</span>
                  </Link>
                </li>
              </ul>
            </fieldset>

            <fieldset>
              <legend>Series</legend>
              <ul className="stack">
                {populated.map((topic) => (
                  <li key={topic.slug}>
                    <Link
                      href={href({ ...state, topic: topic.slug })}
                      aria-current={topic.slug === state.topic ? 'true' : undefined}
                    >
                      {topic.name} <span className="muted">{topic.articleCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Order</legend>
              <ul className="stack">
                <li>
                  <label className="small">
                    <input type="radio" name="order" value="recent" defaultChecked={state.order === 'recent'} /> Newest first
                  </label>
                </li>
                <li>
                  <label className="small">
                    <input type="radio" name="order" value="title" defaultChecked={state.order === 'title'} /> By title
                  </label>
                </li>
              </ul>
            </fieldset>

            <p style={{ marginTop: 'var(--s-5)' }}>
              <button className="btn btn-ink btn-sm" type="submit">
                Apply
              </button>
            </p>
          </form>
        </aside>

        <div>
          {/*
            THE ACTIVE FILTERS, AS THE DESIGN DRAWS THEM. Each chip removes only its own filter, and
            the rest of the rail's state survives the removal — a chip that cleared everything would
            lose work the reader had already done.
          */}
          {active.length > 0 ? (
            <div className="chips">
              {activeTopic ? (
                <Link className="chip" href={href({ ...state, topic: null })}>
                  {activeTopic.name} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.q ? (
                <Link className="chip" href={href({ ...state, q: null })}>
                  “{state.q}” <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.ethnic ? (
                <Link className="chip" href={href({ ...state, ethnic: null })}>
                  {state.ethnic} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.place ? (
                <Link className="chip" href={href({ ...state, place: null })}>
                  {state.place} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.entity ? (
                <Link className="chip" href={href({ ...state, entity: null })}>
                  {facets.clans.find((c) => c.value === state.entity)?.label ?? state.entity}{' '}
                  <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.period ? (
                <Link className="chip" href={href({ ...state, period: null })}>
                  {state.period} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.source ? (
                <Link className="chip" href={href({ ...state, source: null })}>
                  {facets.sourceTypes.find((s) => s.value === state.source)?.label ?? state.source}{' '}
                  <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {state.completeness ? (
                <Link className="chip" href={href({ ...state, completeness: null })}>
                  {state.completeness === 'sourced' ? 'Fully sourced' : 'Partial — help needed'}{' '}
                  <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
            </div>
          ) : null}

          {/*
            THE COUNT LINE IS NOT PRINTED WHEN THERE IS NOTHING TO COUNT.

            "0 records" immediately above the block that explains WHY there are none is the page
            arguing with itself, and the explanation is the more useful of the two sentences. The
            block below carries the total the filters were applied over, in words, where that helps.
          */}
          {articles.length === 0 ? null : (
            <p className="small muted">
              {total.toLocaleString('en-GB')} {total === 1 ? 'record' : 'records'}
              {activeTopic ? ` in ${activeTopic.name}` : ''}
              {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
            </p>
          )}

          {articles.length === 0 ? (
            <div className="empty section">
              <p className="eyebrow">{reason && active.length > 0 ? 'Nothing carries that yet' : 'Nothing here yet'}</p>
              <p>{reason}</p>
              {active.length > 0 ? (
                <p className="small">
                  <Link href="/archive">Clear the filters and see every record</Link>
                </p>
              ) : null}
            </div>
          ) : (
            /*
              * THE CARDS STACK, ONE PER ROW, BECAUSE THE DESIGN'S OWN CSS SAYS SO.
              *
              * This was `grid-4`, which flowed them four across. **`grid-4` is the design's FOOTER
              * class** — in `archive-index.html` it appears at the site footer and nowhere near the
              * records. The design puts its four example cards in a plain div and lets `.entry`
              * do the work, and `.entry` is written for a vertical stack:
              *
              *     .entry { padding-block: var(--s-5); border-bottom: 1px solid var(--rule); }
              *     .entry:first-child { padding-top: 0; }
              *     .entry p { max-width: var(--measure); }
              *
              * A `border-bottom` under every card and a `padding-top: 0` on the first is a list, not a
              * grid. Four across also broke the reading: `--measure` is a line-length limit, so a card
              * a quarter of the width truncated every paragraph mid-sentence, and the hairlines
              * between rows did not line up. The owner asked for the demo exactly.
              */
            <div className="section">
              {/* The heading level the design implies but does not draw — see
                  docs/OZIKORO-REMAINING.md. The stylesheets style headings by element, so
                  re-levelling the entries would change the approved design. */}
              <h2 className="visually-hidden">Records</h2>
              {articles.map((article) => (
                <ArticleEntry key={article.id} article={article} />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="row section" aria-label="Pagination">
              {page > 1 ? (
                <Link className="btn btn-sm" href={href(state, page - 1)} rel="prev">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="small muted">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link className="btn btn-sm" href={href(state, page + 1)} rel="next">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
