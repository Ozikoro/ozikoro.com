/**
 * /admin/seo-records — the title and meta description an editor writes for ONE record.
 *
 * ── WHY THIS SCREEN EXISTS, AND WHY IT IS THE FIRST THING `/admin/seo/` SAYS IT HAS NOT GOT ──────
 *
 * `/admin/seo/` used to name its own gaps in a list, and the first of them was *"the per-record SEO title and
 * meta description editor (the archive writes its own title, description and canonical from the record
 * itself)"*. This screen is that item. **The list itself was not deleted — it is on the index, item by item,
 * with what is now true of each** — and five of its eight entries have since been built: this editor, the
 * permalink and redirect manager, the robots.txt and sitemap settings, the social card's defaults and the
 * structured-data publisher. The index prints which is which, and this screen is the one for a single record's
 * search result.
 *
 * ── WHAT IT SHOWS, AND WHY IT SHOWS THE RECORD'S OWN WORDS BESIDE THE OVERRIDE ───────────────────
 *
 * A form that said "SEO title: ____" would leave the editor to remember what the record currently serves.
 * **So every row prints the record's own title and standfirst, and what is stored marks itself** — an
 * overridden field says so, and a field left alone says so. The preview under the selected record is what a
 * search result will actually show, composed from the same fallback rule the head builder uses
 * (`resolveRecordSeo`), so it is the served answer rather than a description of it.
 *
 * ── WHAT IS DELIBERATELY NOT ON THIS SCREEN ─────────────────────────────────────────────────────
 *
 *   * **The canonical URL is not editable.** The archive's addresses are permanent by contract; a canonical
 *     is a claim about which address is the real one, and an editable one would be a way to declare the
 *     archive's own record a duplicate of somewhere else. It is built from the record and shown read-only.
 *   * **No social-preview image, no JSON-LD, no redirect, no robots.txt or sitemap.** All four now have a
 *     screen of their own under `/admin/seo/`, and **none of them is a title or a description** — a social card
 *     is built from this title and this description, and a redirect is a statement about an address rather than
 *     about a search result. The index says which sections do what.
 *   * **Drafts are not listed.** A draft's search result does not exist, so offering to write one would be
 *     offering to write something with no effect. See `listRecordSeo` — the scope is a statement about what
 *     can be reached, not a permission.
 *
 * ── THE CAPABILITY ──────────────────────────────────────────────────────────────────────────────
 *
 * `manage_design`, the same one `/admin/seo/` and `/admin/design/` ask for, and the reasoning is written in
 * `app/api/admin/seo/route.ts` and in migration 0058: it is the capability the owner's other site-wide,
 * reader-visible settings are gated on, and a `manage_seo` would be a name held by exactly the accounts this
 * one admits. The guard asks for the capability and never for a role, and the write path asks again in
 * `saveRecordSeo`, so this page is not what protects the table.
 */
import { getDb } from '@ozituma/db/client';
import {
  RECORD_SEO_CAPABILITY,
  SEO_DESCRIPTION_ADVISED,
  SEO_FIELD_MAX,
  SEO_TITLE_ADVISED,
  descriptionAdvice,
  listRecordSeo,
  recordSeoStats,
  resolveRecordSeo,
  titleAdvice,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('en-GB');

/** The site's origin, as the canonical is built from it. One literal, so nothing here invents an address. */
const ORIGIN = 'https://ozikoro.com';

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The address a record is served at, as the route builds it. Shown read-only, never submitted. */
function addressOf(row: { slug: string }): string {
  return `${ORIGIN}/${row.slug.replace(/^\/+|\/+$/g, '')}/`;
}

export default async function RecordSeoPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; info?: string; q?: string; edit?: string; only?: string }>;
}) {
  const params = await searchParams;

  /*
   * The page's own guard, FIRST, for the reason every other admin page gives: React renders a layout and its
   * children concurrently, so `app/admin/layout.tsx`'s redirect does not keep this page's queries or markup
   * out of the body. An anonymous request for this address must render nothing.
   */
  await requireCapabilityOrRedirect(RECORD_SEO_CAPABILITY, '/admin/seo-records/');

  const db = await getDb();
  const search = (params.q ?? '').trim();
  const onlyOverridden = params.only === 'edited';
  const editId = Number.parseInt(params.edit ?? '', 10);

  const [rows, stats] = await Promise.all([
    listRecordSeo(db, { search, onlyOverridden, limit: 100 }),
    recordSeoStats(db),
  ]);

  const selected = Number.isInteger(editId) ? rows.find((r) => r.id === editId) ?? null : null;

  /* The same fallback the head builder uses, so the preview is the served answer and not a guess at it. */
  const preview = selected
    ? resolveRecordSeo({
        articleTitle: selected.title,
        standfirst: selected.standfirst,
        override: selected.override
          ? { title: selected.override.title, description: selected.override.description }
          : null,
      })
    : null;

  const qs = (extra: Record<string, string>) => {
    const search2 = new URLSearchParams();
    if (search) search2.set('q', search);
    if (onlyOverridden) search2.set('only', 'edited');
    for (const [k, v] of Object.entries(extra)) search2.set(k, v);
    const s = search2.toString();
    return `/admin/seo-records/${s ? `?${s}` : ''}`;
  };

  return (
    <div className="admin-overview">
      <Head title="Record search results">
        <a className="btn btn-sm" href="/admin/seo">
          Search engines
        </a>
      </Head>

      <Notices saved={params.saved} error={params.error} info={params.info} />

      <Card title="What this changes, and what it does not">
        <p>
          Every record in this archive writes its own <span className="mono">&lt;title&gt;</span> and meta
          description from the record itself: the title, and the summary above the body. That is still the
          default, and it is what a record with nothing written here serves. <b>What this screen adds is the
          ability to overrule it for one record</b> — a title longer than a result shows, a summary that reads
          badly in a snippet — and to take the overrule back.
        </p>
        <AtAGlance
          rows={[
            ['Published records', num(stats.records)],
            ['With a written title', num(stats.withTitle)],
            ['With a written description', num(stats.withDescription)],
            ['With any override', `${num(stats.withEither)} of ${num(stats.records)}`],
          ]}
        />
        <p className="small muted" style={{ marginTop: '.6rem' }}>
          <b>Not changed here, and named so nobody assumes it is:</b> the record&rsquo;s <b>address</b> — an
          editable canonical would be a way to declare a record a duplicate of somewhere else, and moving an
          address is a redirect rather than a title, so it is on{' '}
          <a href="/admin/seo/permalinks/">Permalinks</a>; and the <b>social card</b>, which is built from this
          title and this description and is previewed on{' '}
          <a href="/admin/seo/social/">Social</a>. The JSON-LD graph is on{' '}
          <a href="/admin/seo/schema/">Schema</a> and <span className="mono">robots.txt</span>, the sitemap and
          the redirect table are on <a href="/admin/seo/tools/">Tools</a>. <b>None of them is a title or a
          description</b>, which is why they are not fields on this page. A
          length over {SEO_TITLE_ADVISED} characters for a title or {SEO_DESCRIPTION_ADVISED} for a
          description is <b>advice rather than a refusal</b> — the search engine truncates it, so it is
          saved and you are told.
        </p>
      </Card>

      <Card title="Find a record">
        <form method="get" action="/admin/seo-records" className="row" style={{ gap: '.6rem', flexWrap: 'wrap' }}>
          <label className="small" htmlFor="q">
            Title or slug
          </label>
          <input id="q" name="q" type="search" defaultValue={search} placeholder="e.g. Ute-Okpu" style={{ minWidth: '16rem' }} />
          <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <input type="checkbox" name="only" value="edited" defaultChecked={onlyOverridden} />
            Only records with an override
          </label>
          <button className="btn btn--primary" type="submit">
            Search
          </button>
          {search || onlyOverridden ? (
            <a className="btn btn-quiet" href="/admin/seo-records">
              Clear
            </a>
          ) : null}
        </form>
        <p className="help">
          {search || onlyOverridden
            ? `${num(rows.length)} record${rows.length === 1 ? '' : 's'} shown, newest first.`
            : `The ${num(rows.length)} most recent published records. Search by title or slug to reach any of the ${num(stats.records)}.`}
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card title="No records match">
          <p className="help">
            {search
              ? `Nothing published matches “${search}”. The search reads the record’s title and its slug.`
              : onlyOverridden
                ? 'No record has an override yet, so there is nothing to list here. Untick the box to see the records.'
                : 'This archive has no published records yet, so there is nothing to write a search result for.'}
          </p>
        </Card>
      ) : (
        <Card title={`Records (${num(rows.length)})`}>
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">What it serves now</th>
                <th scope="col">Override</th>
                <th scope="col">Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const resolved = resolveRecordSeo({
                  articleTitle: row.title,
                  standfirst: row.standfirst,
                  override: row.override
                    ? { title: row.override.title, description: row.override.description }
                    : null,
                });
                const isSelected = selected?.id === row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <b>{row.title}</b>
                      <br />
                      <span className="mono small">{row.slug}</span>
                    </td>
                    <td>
                      <span className="small">
                        <b>Title:</b> {resolved.title}
                      </span>
                      <br />
                      <span className="small muted">
                        <b>Description:</b> {resolved.description ?? '— this record serves none —'}
                      </span>
                    </td>
                    <td className="small">
                      {row.override === null ? (
                        <span className="muted">none — the record&rsquo;s own words</span>
                      ) : (
                        <>
                          {resolved.titleOverridden ? 'title written' : 'title: record’s own'}
                          <br />
                          {resolved.descriptionOverridden ? 'description written' : 'description: record’s own'}
                          <br />
                          <span className="muted">
                            {when(row.override.updatedAt)}
                            {row.override.updatedBy ? ` · ${row.override.updatedBy}` : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <a
                        className={`btn btn-sm${isSelected ? ' btn--primary' : ''}`}
                        href={isSelected ? qs({}) : qs({ edit: String(row.id) })}
                      >
                        {isSelected ? 'Close' : 'Edit'}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {selected && preview ? (
        <Card title={`Edit — ${selected.title}`}>
          <p className="small muted">
            Served at <span className="mono">{addressOf(selected)}</span>, and it is this address a search
            engine indexes. The title and description below are what it will show.
          </p>

          <form method="post" action="/api/admin/seo-records" className="stack" style={{ marginTop: '.8rem' }}>
            <input type="hidden" name="action" value="save" />
            <input type="hidden" name="record" value={selected.id} />
            {/* Where a form caller is returned to. Relative only — `redirectTo` refuses anything else. */}
            <input type="hidden" name="returnTo" value={qs({ edit: String(selected.id) })} />

            <div className="group">
              <label htmlFor="seo_title">
                SEO title{' '}
                <span className="small muted">
                  ({(selected.override?.title ?? '').length} of about {SEO_TITLE_ADVISED}; blank serves the
                  record&rsquo;s own title)
                </span>
              </label>
              <input
                id="seo_title"
                name="seo_title"
                type="text"
                maxLength={SEO_FIELD_MAX}
                defaultValue={selected.override?.title ?? ''}
                placeholder={selected.title}
              />
              <p className="help">
                The record&rsquo;s own title is <b>{selected.title}</b>.
                {titleAdvice(selected.override?.title ?? '') ? ` ${titleAdvice(selected.override?.title ?? '')}` : ''}
              </p>
            </div>

            <div className="group">
              <label htmlFor="seo_description">
                Meta description{' '}
                <span className="small muted">
                  ({(selected.override?.description ?? '').length} of about {SEO_DESCRIPTION_ADVISED}; blank
                  serves the record&rsquo;s own summary)
                </span>
              </label>
              <textarea
                id="seo_description"
                name="seo_description"
                rows={3}
                maxLength={SEO_FIELD_MAX}
                defaultValue={selected.override?.description ?? ''}
                placeholder={selected.standfirst ?? ''}
              />
              <p className="help">
                {selected.standfirst
                  ? `The record’s own summary is: ${selected.standfirst}`
                  : 'This record has no summary of its own, so a blank field serves no description at all.'}
                {descriptionAdvice(selected.override?.description ?? '')
                  ? ` ${descriptionAdvice(selected.override?.description ?? '')}`
                  : ''}
              </p>
            </div>

            <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" type="submit">
                Save
              </button>
            </div>
          </form>

          {/*
            THE CLEAR IS ITS OWN FORM, AND THAT IS A SAFETY DECISION RATHER THAN A LAYOUT ONE.

            A clear that shared the save form would have to know whether the fields were meant to be blank or
            were simply untouched, and the answer would come from a submit button's name. **A second form
            cannot be submitted by pressing Enter in the title field**, so removing an override is always a
            deliberate click on a control that says what it does.
          */}
          <form
            method="post"
            action="/api/admin/seo-records"
            style={{ marginTop: '.5rem' }}
            aria-label="Remove this record's override"
          >
            <input type="hidden" name="action" value="clear" />
            <input type="hidden" name="record" value={selected.id} />
            <input type="hidden" name="returnTo" value={qs({ edit: String(selected.id) })} />
            <button className="btn btn-quiet" type="submit" disabled={selected.override === null}>
              Remove the override, and serve the record&rsquo;s own words
            </button>
            {selected.override === null ? (
              <span className="small muted"> — there is no override on this record to remove.</span>
            ) : null}
          </form>

          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--rule)', paddingTop: '.8rem' }}>
            <p className="small muted" style={{ margin: '0 0 .4rem' }}>
              What a search result will show. This is composed by the same function the page&rsquo;s head uses,
              so it is the served answer rather than a picture of one.
            </p>
            <div style={{ border: '1px solid var(--rule)', padding: '.7rem .8rem', borderRadius: '6px' }}>
              <p className="small" style={{ margin: 0, color: '#1a0dab', fontWeight: 600 }}>
                {preview.title}
              </p>
              <p className="small" style={{ margin: '.1rem 0', color: '#0d5c45' }}>
                {addressOf(selected)}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {preview.description ?? 'No description will be shown for this record.'}
              </p>
            </div>
            <p className="small muted" style={{ margin: '.5rem 0 0' }}>
              {preview.titleOverridden ? 'The title is written.' : 'The title is the record’s own.'}{' '}
              {preview.descriptionOverridden
                ? 'The description is written.'
                : selected.standfirst
                  ? 'The description is the record’s own summary.'
                  : 'This record serves no description.'}
            </p>
          </div>
        </Card>
      ) : null}

      <Card title="Changing a record's search result is recorded" quiet>
        <p className="small muted">
          Every save and every removal writes a row to the audit trail: who, when, the record, and both values
          before and after. <b>The opposite of the verification tokens, deliberately</b> — those are
          credentials and{' '}
          <a href="/admin/seo">Search engines</a> keeps their values out of the trail, while a title and
          a description are written to be read by anybody and are served to every crawler that asks. A trail
          that said &ldquo;the title was changed&rdquo; without saying what it was changed to could not answer
          the question the trail exists for.
        </p>
      </Card>
    </div>
  );
}
