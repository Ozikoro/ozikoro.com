/**
 * One archived revision, read.
 *
 * THE POINT OF THE WHOLE BACKFILL IS THIS PAGE. 4,266 WordPress revisions were imported because the
 * earlier wording of the histories existed nowhere else; a row in a table is not a record a person can
 * use, so the text is rendered here, from the database, in the state it was written.
 *
 * THE BODY GOES THROUGH THE ARCHIVE'S OWN SANITISER, which is the same function the published article
 * route uses (`sanitiseArchiveHtml`). A superseded revision is still WordPress HTML written by the
 * same people in the same editor, so it faces exactly the material the sanitiser exists for — and
 * **rendering it raw would make the admin the one place in this application where stored HTML is
 * trusted.** The text is not altered for display beyond that: no tidying, no rewriting.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getArticleFacets, getArticleRevision, sanitiseArchiveHtml } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head } from '@/app/admin/ui';

export const dynamic = 'force-dynamic';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ReadRevision({
  params,
}: {
  params: Promise<{ id: string; revisionId: string }>;
}) {
  const { id, revisionId } = await params;
  const articleId = Number.parseInt(id, 10);
  const revId = Number.parseInt(revisionId, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();
  if (!Number.isInteger(revId) || revId <= 0) notFound();

  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/${articleId}/revisions/${revId}`);

  const db = await getDb();
  const [facets, revision] = await Promise.all([
    getArticleFacets(db, articleId),
    // The article id is passed so a revision cannot be read through another record's address.
    getArticleRevision(db, revId, articleId),
  ]);
  if (!facets || !revision) notFound();

  /*
   * A NULL BODY IS AN ANSWER, NOT AN EMPTY PAGE. The importer refuses to store a body over its size
   * ceiling rather than truncating it, and a screen that printed nothing for that case would look like
   * a record with no text. It says which it is.
   */
  const body = revision.bodyHtml === null ? null : sanitiseArchiveHtml(revision.bodyHtml);

  return (
    <>
      <Head title={revision.title?.trim() || `Revision ${revision.wpRevisionId ?? revision.id}`}>
        <Link className="btn btn--sm" href={`/admin/archive/${articleId}/revisions`}>Back to the history</Link>
        <Link className="btn btn--sm" href={`/admin/archive/${articleId}`}>Back to the record</Link>
      </Head>

      <Card title="What this revision is">
        <p className="small muted">
          WordPress revision {revision.wpRevisionId ?? '—'} of post {revision.wpParentPostId ?? '—'} ·{' '}
          {revision.revisedAt ? new Date(revision.revisedAt).toISOString().slice(0, 19).replace('T', ' ') : 'undated'} ·{' '}
          {revision.author ?? 'no author recorded'} · {revision.wordCount} words · {bytes(revision.bodyBytes)}
        </p>
        {revision.carriesUniqueText ? (
          <p className="help">
            <strong>This revision carries text that appears in no other record in the archive.</strong> It is
            the version the round-341 measurement identified as the one holding this record&apos;s
            otherwise-lost wording.
          </p>
        ) : (
          <p className="help">
            This revision&apos;s text also appears elsewhere — in the record as it stands, or in another of its
            revisions. It is kept because every version is the record of what was written.
          </p>
        )}
      </Card>

      <Card title="The text, as it stood">
        {body === null ? (
          <p className="help">
            The body of this revision was not stored: it is larger than the importer&apos;s ceiling and a
            truncated body passed off as the text would be worse than none. Its size is recorded above.
          </p>
        ) : (
          // The archive's own sanitiser ran above; the styling is the admin's own reading column.
          <div className="revision-body" dangerouslySetInnerHTML={{ __html: body }} />
        )}
      </Card>
    </>
  );
}
