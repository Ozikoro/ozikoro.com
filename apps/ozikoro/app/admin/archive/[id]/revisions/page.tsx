/**
 * A record's revision history — what it said before it said this.
 *
 * WHY THIS SCREEN EXISTS AT ALL
 *
 * The backfill imported 4,266 WordPress revisions into `ozikoro_article_revision`. **A table nobody
 * can read from the admin is a backfill that satisfies a count and nothing else**, which is the fault
 * the brief names, so the text has to be reachable by a person: this is the list, and
 * `./[revisionId]/page.tsx` is the reader.
 *
 * WHY THE LIST DOES NOT SHOW THE BODIES
 *
 * The versions are whole-document snapshots and the 4,266 of them hold 36.6 MiB, so selecting
 * `body_html` here would pull that much text to render a page of metadata — and the body is what a
 * reader opens ONE of at a time. Each row shows the size, the word count, the author and what the
 * revision opens with, which is enough to choose by.
 *
 * THE MARK IS THE MEASUREMENT, AND IT IS NOT A FILTER BY DEFAULT
 *
 * 525 rows carry block text that appears in no other record — the honest figure from the round-341
 * measurement, 1,225 KiB of distinct block text of which 442 KiB has not even its opening 80
 * characters anywhere in a surviving record. They are marked so an editor can find what would have
 * been lost, and **nothing was discarded on the strength of that mark**: every revision is stored and
 * every revision is listed. `?unique=1` narrows the list, it does not define it.
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { countArticleRevisions, getArticleFacets, listArticleRevisions } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head } from '@/app/admin/ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function RecordRevisions({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; unique?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/${articleId}/revisions`);

  const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
  const uniqueOnly = query.unique === '1';

  const db = await getDb();
  const facets = await getArticleFacets(db, articleId);
  if (!facets) notFound();

  const [totals, revisions] = await Promise.all([
    countArticleRevisions(db, articleId),
    listArticleRevisions(db, articleId, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, uniqueOnly }),
  ]);

  const pages = Math.max(Math.ceil((uniqueOnly ? totals.carryingUniqueText : totals.total) / PAGE_SIZE), 1);
  const link = (n: number) =>
    `/admin/archive/${articleId}/revisions?page=${n}${uniqueOnly ? '&unique=1' : ''}`;

  return (
    <>
      <Head title={`${facets.title} — revision history`}>
        <a className="btn btn--sm" href={`/admin/archive/${articleId}`}>Back to the record</a>
        <a className="btn btn--sm" href={`/${facets.slug}/`}>View the record</a>
      </Head>

      <Card title={`${totals.total} revisions, ${bytes(totals.bodyBytes)} of text`}>
        <p className="help">
          WordPress kept every version of this record as the editor worked, and the archive had no table
          for them until round 341 — so the earlier wording of the histories was being lost.{' '}
          <strong>{totals.carryingUniqueText}</strong> of these {totals.total} carry a passage that appears
          in no other record this archive holds. <strong>Nothing was discarded:</strong> all {totals.total}{' '}
          are here, and the mark only says which ones hold text that would otherwise be gone.
        </p>

        <p className="help">
          {uniqueOnly ? (
            <>
              Showing only the revisions carrying text found nowhere else.{' '}
              <a href={link(1).replace('&unique=1', '')}>Show every revision</a>.
            </>
          ) : (
            <>
              Showing every revision.{' '}
              <a href={`${link(1)}&unique=1`}>Show only the ones carrying unique text</a>.
            </>
          )}
        </p>

        {revisions.length === 0 ? (
          <p className="help">This record has no imported revision history.</p>
        ) : (
          <ul className="history">
            {revisions.map((r) => (
              <li key={r.id}>
                <div className="history__when">
                  {r.revisedAt ? new Date(r.revisedAt).toISOString().slice(0, 19).replace('T', ' ') : 'undated'}
                  {r.author ? ` · ${r.author}` : ''} · WordPress revision {r.wpRevisionId ?? '—'}
                  {r.carriesUniqueText ? ' · carries text found nowhere else' : ''}
                </div>
                <p className="history__what">
                  <a href={`/admin/archive/${articleId}/revisions/${r.id}`}>
                    {r.title?.trim() || `${r.wordCount} words`}
                  </a>
                </p>
                <p className="history__detail">
                  {r.wordCount} words · {bytes(r.bodyBytes)}
                  {r.opening ? ` · “${r.opening.slice(0, 140)}…”` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <p className="help">
            Page {page} of {pages}.{' '}
            {page > 1 ? <a href={link(page - 1)}>Previous</a> : null}
            {page > 1 && page < pages ? ' · ' : null}
            {page < pages ? <a href={link(page + 1)}>Next</a> : null}
          </p>
        ) : null}
      </Card>
    </>
  );
}
