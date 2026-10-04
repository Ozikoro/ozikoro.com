/**
 * The knowledge graph's index — the record, searchable, filterable and paged.
 *
 * ── WHAT THIS PAGE WAS, AND WHY THE OWNER ASKED FOR IT TO BE REDESIGNED ─────────────────────────────
 *
 * The owner's words: *"on the records page … can you redesign it to look better, at least a nicer design?
 * also, remove that 'where this stands' or rewrite what was written there. dont display everything there.
 * there should be a page for you to search or select or click next to see more"*.
 *
 * Measured against the page he was looking at (`GET /entities/`, 96,512 bytes): one `h1`, **no `h2` at
 * all**, 100 card links on one page, and the boxed note headed "Where this stands" over a paragraph that
 * explained the build to the reader rather than telling them anything about the archive. Three faults, and
 * each is answered below by the design's own shapes rather than by a new one.
 *
 * ── THE DESIGN DRAWS NO ENTITY INDEX, AND THAT IS WHY THIS IS A BUILD AND NOT A REPAIR ─────────────
 *
 * Checked: `apps/ozikoro/public/design/screens/` holds 52 screens and none of them is an index of entities.
 * There is no delivered design to match, so there is no parity to preserve — and the rule that follows is
 * not "invent something" but "reuse what the design already draws". Two screens and one stylesheet supply
 * every element on this page:
 *
 *   * `towns.html` — the `sx-discovery-hero` with its eyebrow, `h1`, `lede` and `form.search` (a `sr-only`
 *     label, a `type="search"` field and a `btn btn-gold` button), the `sx-town-grid` of
 *     `<a><span><small><strong><em></span></a>` cards, and the closing `sx-source-note sx-light-note`. The
 *     register's index (`/clan-towns/`, which `/clans/` now redirects to) reproduces the same card for the
 *     same reason, and it is the nearest page to this one in the whole app — an index of named records from
 *     a table the reader can narrow — so the two are deliberately the same shape.
 *   * `archive-index.html` — the archive's own index, and the closest thing to what this page is. Its
 *     `.spread` count line ("24 entries · Igbo · Ụ̀mụ̀nrì …"), its `.chips` row and its pager are the count,
 *     the state and the paging used here.
 *   * `showcase.css`'s `.sx-filterbar` — the design system's light-ground filter bar, already serving
 *     `/clan-towns/` and `/projects`. It is where the kind select lives.
 *
 * NOTHING NEW WAS DRAWN. Every class on the page is defined in `main.css` or `showcase.css`, and no token,
 * colour or typeface was substituted. Two decisions had to be made because the design draws no shape for
 * them, and both are recorded where they are made: the pager's disabled direction (below the pager) and the
 * card's photograph (below the grid).
 *
 * ── "WHERE THIS STANDS" ─────────────────────────────────────────────────────────────────────────────
 *
 * The block is gone. Its first sentence was real — a count of entities, kinds and linked records — and it
 * is now the page's lede, in the hero, where a reader meets it before the listing instead of in a dashed box
 * after it. Its second sentence explained the software (a script that guessed a clan from prose "would be
 * inventing history"); the part of it that is a fact about the archive rather than about the build is in the
 * note under the grid, and the rest is deleted.
 *
 * **THE OLD BLOCK'S NUMBERS WERE ALSO BROKEN, MEASURED.** It read
 * `{linkedArticles} of the {linkedArticles === 0 ? '1,051' : ''} migrated records linked to one so far` — so
 * with no links it printed "0 of the 1,051" and with any links at all it printed "5 of the migrated records",
 * with no denominator at all. And the denominator it typed, 1,051, is exactly the count the brief forbids
 * typing. Both figures are now read from the database on every request, and `getEntityStats` was corrected
 * so the two sides of the fraction count the same articles — see its comment in `entities.ts`.
 *
 * ── WHY 18 TO A PAGE, AND WHY `?page=` ──────────────────────────────────────────────────────────────
 *
 * The card is a dark `sx-town-grid` tile rather than the one-line `.entry` list the archive index uses, so it
 * is taller and fewer of them fill a screen: the archive pages its list at 24, and the same number of tiles
 * would be a wall. The register now pages at 18 with `?page=` — `apps/ozikoro/app/clan-towns/page.tsx`,
 * `PAGE_SIZE = 18`, the archive index's pager markup and an inert `<span>` for an unavailable control — and
 * this page takes the same size and the same parameter deliberately, so two indexes of the same archive
 * cannot end up disagreeing about how many records a page holds. (The register's index was `/towns/` while
 * this was being written and moved to `/clan-towns/` during it; the size and the parameter did not change
 * with the move.)
 *
 * A page past the end is not an empty grid. It is the honest end state: a heading that says there is no such
 * page, the real number of records and pages, and a link to the first and last of them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  countEntities,
  entityKindLabel,
  getEntityFacets,
  getEntityStats,
  listEntities,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The record',
  description: 'Clans, towns, places, people and periods in the Ozikoro archive, linked to their records.',
  alternates: { canonical: 'https://ozikoro.com/entities' },
};

/** See the header: 18 tiles fill a screen, and the register at /clan-towns/ pages at the same size. */
const PAGE_SIZE = 18;

/** The two things that narrow the listing, as the address carries them. */
interface GraphQuery {
  q: string;
  kind: string;
}

/**
 * One address for one view of the record.
 *
 * It is built from the state rather than patched onto the current string, so a page turn keeps the search
 * and the kind and a filter change keeps the search — a filter that resets when you press Next is the
 * inert-control fault in a new coat. Page 1 carries no `page` parameter, so the unfiltered index is one
 * address rather than two, and a filtered view is bookmarkable and citable exactly as the design requires.
 */
function graphHref(state: GraphQuery, page = 1): string {
  const search = new URLSearchParams();
  if (state.q) search.set('q', state.q);
  if (state.kind) search.set('kind', state.kind);
  if (page > 1) search.set('page', String(page));
  const query = search.toString();
  return query ? `/entities?${query}` : '/entities';
}

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const db = await getDb();

  /*
   * The facets first, because what the graph files decides what the filter may be.
   *
   * A `kind` the graph does not hold — `?kind=bogus`, or an address left over from a word that changed — is
   * dropped rather than passed through, which is what `/clan-towns/` does with a kind the register does not
   * and what `/archive` does with a period no record carries: a filter that matches nothing would read as
   * "the graph does not have this" when the truth is "that is not one of the words it uses". Dropping it
   * falls back to the whole record, which is the honest answer to an address that asks for nothing.
   */
  const facets = await getEntityFacets(db);
  const wanted = (params.kind ?? '').trim();
  const kind = facets.kinds.some((k) => k.kind === wanted) ? wanted : '';
  const state: GraphQuery = { q, kind };
  const kindLabel = kind ? (facets.kinds.find((k) => k.kind === kind)?.label ?? entityKindLabel(kind)) : '';

  const [entities, total, stats] = await Promise.all([
    listEntities(db, { kind: kind || null, search: q || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countEntities(db, { kind: kind || null, search: q || null }),
    getEntityStats(db),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pastEnd = total > 0 && page > totalPages;
  const firstResult = (page - 1) * PAGE_SIZE + 1;
  const lastResult = firstResult + entities.length - 1;
  const filtered = Boolean(q || kind);

  return (
    <>
      {/*
        THE HERO IS `towns.html`'S, WITH THIS PAGE'S WORDS. The eyebrow, the `h1`, the `lede` and the search
        form are in the same places and the same classes as the register's; the lede is where the build note's
        real figures went, and the search is the design's own plain GET form so a filtered record is a
        citable address and the page works with JavaScript off.
      */}
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The knowledge graph</p>
          <h1>The record</h1>
          <p className="lede">
            The clans, towns, places, people and periods the archive knows about, each with the histories
            written about it. The graph holds {stats.entities.toLocaleString('en-GB')}{' '}
            {stats.entities === 1 ? 'record' : 'records'} across {stats.kinds.toLocaleString('en-GB')}{' '}
            {stats.kinds === 1 ? 'kind' : 'kinds'}, and{' '}
            {stats.linkedArticles.toLocaleString('en-GB')} of the archive&rsquo;s{' '}
            {stats.publishedArticles.toLocaleString('en-GB')} published histories are linked to one.
          </p>
          <form className="search" method="get" action="/entities" role="search">
            <label className="sr-only" htmlFor="q">
              Search the record
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Find a record — a name, a place, a period"
            />
            {/* The kind survives a new search, so searching inside a kind stays inside it. */}
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            <button className="btn btn-gold" type="submit">
              Find
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        {/*
          THE KIND SELECT IS THE DESIGN'S `sx-filterbar`, WHICH `/clan-towns/` AND `/projects` USE.
          It is not the register's `sx-reg-finder`: that control is a cascade of four steps and it is not in
          any of the 52 design screens, and the graph has one column to filter on, not four. A bar of the
          words the graph actually files is the select the owner asked for, and every option leads to records
          that exist because the list is a `group by` over the rows.
        */}
        <nav className="sx-filterbar" aria-label="Filter the record by what it is">
          <Link href={graphHref({ ...state, kind: '' })} aria-current={kind ? undefined : 'true'}>
            Everything
          </Link>
          {facets.kinds.map((k) => (
            <Link
              key={k.kind}
              href={graphHref({ ...state, kind: k.kind })}
              aria-current={kind === k.kind ? 'true' : undefined}
            >
              {k.label}
            </Link>
          ))}
        </nav>

        {/*
          THE COUNT LINE, IN THE DESIGN'S OWN `.spread`, ABOVE THE RESULTS — which is where
          `archive-index.html` draws it ("24 entries · Igbo · Ụ̀mụ̀nrì"). It is not printed when there is
          nothing to count, because "0 records" immediately above the block that explains why there are none
          is the page arguing with itself.
        */}
        {total === 0 ? null : (
          <div className="spread">
            <p className="small muted">
              <b>
                {total.toLocaleString('en-GB')} {total === 1 ? 'record' : 'records'}
              </b>
              {kindLabel ? ` · ${kindLabel}` : ''}
              {q ? ` · “${q}”` : ''} · page {page} of {totalPages}
            </p>
          </div>
        )}

        {pastEnd ? (
          /*
            A PAGE PAST THE END IS THIS, AND NOT AN EMPTY GRID. The heading says what the address asked for
            and the paragraph says what the record holds, so a reader who typed `?page=99` is told the truth
            rather than shown a grid with nothing in it — the same rule the archive's own index follows when
            a filter matches nothing. The links are to pages that exist.
          */
          <div className="empty section">
            <p className="eyebrow">Past the end of the record</p>
            <h2>There is no page {page.toLocaleString('en-GB')}.</h2>
            <p>
              {total === 1 ? 'One record matches' : `${total.toLocaleString('en-GB')} records match`}
              {kindLabel ? ` ${kindLabel}` : ''}
              {q ? ` “${q}”` : ''}, so the index ends at page {totalPages.toLocaleString('en-GB')}.
              Nothing is hidden — the page you asked for is beyond the last one.
            </p>
            <p className="row">
              <Link className="btn" href={graphHref(state, 1)}>
                Start at page 1
              </Link>
              {totalPages > 1 ? (
                <Link className="btn btn-quiet" href={graphHref(state, totalPages)}>
                  Go to page {totalPages.toLocaleString('en-GB')}
                </Link>
              ) : null}
            </p>
          </div>
        ) : entities.length === 0 ? (
          /*
            NOTHING MATCHED, AND WHY. A filter that matches nothing because the graph holds no such kind and
            a search that matches nothing because the reader's words are not in any record are different
            answers, and an empty grid says neither. The two cases are told apart here, and the total the
            search was applied over is stated in words.

            THE THIRD CASE IS A GRAPH WITH NOTHING IN IT, which is what a freshly migrated database looks
            like before the first record is filed. It cannot be reached on a populated archive, and the
            sentence above cannot be said of it either — "the graph holds 0 records and none of them
            matches" is the page talking nonsense at the one reader who most needs to be told why the
            shelves are empty. So it says that instead, and offers the archive rather than a filter that
            cannot help.
          */
          <div className="empty section">
            <p className="eyebrow">Nothing matches</p>
            <h2>
              {stats.entities === 0
                ? 'Nothing is in the graph yet.'
                : q
                  ? `No record matches “${q}”.`
                  : 'Nothing in the graph matches that.'}
            </h2>
            {stats.entities === 0 ? (
              <p>
                No clan, town, place, person or period has been filed yet. A record is made when an editor
                files one and attaches the histories written about it, and they appear here as that work is
                done.
              </p>
            ) : (
              <p>
                The graph holds {stats.entities.toLocaleString('en-GB')}{' '}
                {stats.entities === 1 ? 'record' : 'records'}
                {kindLabel ? ` filed as ${kindLabel.toLowerCase()}` : ''}, and none of them matches. A name
                may be spelled differently in the records — the survey printed some names the way an officer
                heard them, and the towns write them another way — or the record may not be filed yet.
              </p>
            )}
            <p className="row">
              <Link className="btn" href={stats.entities === 0 ? '/archive/' : '/entities'}>
                {stats.entities === 0 ? 'Browse the archive' : 'Show every record'}
              </Link>
            </p>
          </div>
        ) : (
          /*
            The design's grid draws no heading of its own; the section needs a name in the document outline,
            and `sr-only` is the design's own class for exactly that. The wrapper is `.section`, which is the
            app's own vertical rhythm and the way `/archive` spaces its card list.
          */
          <div className="section">
            <h2 className="sr-only">Records in the graph</h2>
            <div className="sx-town-grid">
              {entities.map((e) => (
                /*
                  THE DESIGN'S CARD, WORD FOR WORD EXCEPT THE PICTURE.

                  `towns.html` draws `<a href><img><span><small><strong><em></span></a>` and this is the same
                  anchor with the same four slots: the `<small>` is the kind (the design puts the region
                  there, and the kind is the one word that tells a reader what they are about to open), the
                  `<strong>` is the name, and the `<em>` is the design's call to action carrying the real
                  number of linked histories.

                  NO `<img>` IS DRAWN, DELIBERATELY, AND THIS IS THE ONE DECISION THE DESIGN DID NOT MAKE
                  FOR US. `ozikoro_entity` has no image column and no migration adds one; the only photograph
                  an entity could be given is the featured image of a published article linked to it through
                  `ozikoro_article_entity`. The register does exactly that on its own cards, and the round
                  that landed while this one was written checked all seven of its shared photographs against
                  the records that carry them and found that each record names the entry on the card — so for
                  a register of PLACES the join is defensible. **This is not a register of places.** The graph
                  files clans, towns, people and kingdoms today, and its `kind` column allows 45 values
                  including `period`, `language`, `person` and `deity`, so the same join would put a
                  photograph of a place on a record that is not a place at all, with nothing on the card to
                  say so. A photograph of one thing shown as another's is the one thing this project must not
                  do, and there is no rule here that draws only true ones — so the card is drawn exactly as
                  the register drew its cards before it had pictures: no `<img>`, no stand-in, and the words
                  carrying the whole meaning.
                */
                <Link key={e.slug} href={`/entities/${e.slug}/`}>
                  <span>
                    <small>{entityKindLabel(e.kind)}</small>
                    <strong>{e.name}</strong>
                    <em>
                      {e.articleCount === 0
                        ? 'Open the record →'
                        : `${e.articleCount.toLocaleString('en-GB')} linked ${
                            e.articleCount === 1 ? 'history' : 'histories'
                          } →`}
                    </em>
                  </span>
                </Link>
              ))}
            </div>

            {/*
              The note closes the grid, in the design's own `sx-source-note sx-light-note`. It states what the
              record holds and the one fact a reader needs in order to read a count of zero correctly: a
              record is attached to a history by a person, entry by entry. That is the half of the old block
              that was about the archive rather than about the software; the rest of it is deleted.
            */}
            <p className="sx-source-note sx-light-note">
              {filtered
                ? `${total.toLocaleString('en-GB')} of the graph's ${stats.entities.toLocaleString('en-GB')} records match. `
                : `All ${stats.entities.toLocaleString('en-GB')} records the graph holds. `}
              A record is attached to a history by an editor, entry by entry, so a record that shows no linked
              history yet is one no editor has reached — not one the archive has decided against.
            </p>

            {/*
              THE PAGER IS `archive-index.html`'S, WITH REAL ADDRESSES.

              The design draws `<nav class="row" … aria-label="Pagination">`, a "Showing 1–4 of 24" span and
              two `btn btn-quiet btn-sm` controls, the unavailable one carrying `aria-disabled="true"` on an
              anchor whose `href` is "#". **The one thing not copied is that anchor**: a disabled control that
              is still a link is a dead end dressed as a destination, so the unavailable direction is a
              `<span>` wearing the same classes, marked `aria-disabled` and carrying no `href` at all. It
              looks like the design's disabled button, it is not focusable, and it goes nowhere because there
              is nowhere for it to go.

              Both directions are always drawn, as the design draws them, so the row does not reflow as the
              reader turns pages. Every address carries the search and the kind, which is what makes a filter
              survive a page turn.
            */}
            <nav className="row section" style={{ justifyContent: 'space-between' }} aria-label="Pagination">
              <span className="small muted">
                Showing {firstResult.toLocaleString('en-GB')}–{lastResult.toLocaleString('en-GB')} of{' '}
                {total.toLocaleString('en-GB')}
              </span>
              <span className="row">
                {page > 1 ? (
                  <Link className="btn btn-quiet btn-sm" href={graphHref(state, page - 1)} rel="prev">
                    ← Previous
                  </Link>
                ) : (
                  <span className="btn btn-quiet btn-sm" aria-disabled="true">
                    ← Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link className="btn btn-quiet btn-sm" href={graphHref(state, page + 1)} rel="next">
                    Next →
                  </Link>
                ) : (
                  <span className="btn btn-quiet btn-sm" aria-disabled="true">
                    Next →
                  </span>
                )}
              </span>
            </nav>
          </div>
        )}
      </section>
    </>
  );
}
