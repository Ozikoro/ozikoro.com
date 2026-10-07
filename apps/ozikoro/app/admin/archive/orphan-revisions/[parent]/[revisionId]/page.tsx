/**
 * One revision of a parent the archive does not hold, read.
 *
 * The sibling of `./[id]/revisions/[revisionId]/page.tsx` for the 74 revisions that have no article to
 * be opened from. Same sanitiser, same refusal to print a missing body as if it were empty text.
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getArticleRevision, mediaUrlResolver, rewriteBodyImages, sanitiseArchiveHtml } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head } from '@/app/admin/ui';

export const dynamic = 'force-dynamic';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ReadOrphanRevision({
  params,
}: {
  params: Promise<{ parent: string; revisionId: string }>;
}) {
  const { parent, revisionId } = await params;
  const parentPostId = Number.parseInt(parent, 10);
  const revId = Number.parseInt(revisionId, 10);
  if (!Number.isInteger(parentPostId) || parentPostId <= 0) notFound();
  if (!Number.isInteger(revId) || revId <= 0) notFound();

  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/orphan-revisions/${parentPostId}/${revId}`);

  const db = await getDb();
  // No article id: this record has none. The parent is checked below instead, so the address cannot be
  // used to read a revision that belongs to some other parent.
  const revision = await getArticleRevision(db, revId);
  if (!revision || revision.wpParentPostId !== parentPostId) notFound();

  const body = revision.bodyHtml === null
    ? null
    : sanitiseArchiveHtml(rewriteBodyImages(revision.bodyHtml, await mediaUrlResolver(db)));

  return (
    <>
      <Head title={revision.title?.trim() || `Revision ${revision.wpRevisionId ?? revision.id}`}>
        <a className="btn btn--sm" href={`/admin/archive/orphan-revisions/${parentPostId}`}>
          Back to the list
        </a>
      </Head>

      <Card title="What this revision is">
        <p className="small muted">
          WordPress revision {revision.wpRevisionId ?? '—'} of post {parentPostId} ·{' '}
          {revision.revisedAt ? new Date(revision.revisedAt).toISOString().slice(0, 19).replace('T', ' ') : 'undated'} ·{' '}
          {revision.author ?? 'no author recorded'} · {revision.wordCount} words · {bytes(revision.bodyBytes)}
        </p>
        {revision.carriesUniqueText ? (
          <p className="help">
            <strong>This revision carries text that appears in no other record in the archive.</strong>
          </p>
        ) : null}
      </Card>

      <Card title="The text, as it stood">
        {body === null ? (
          <p className="help">
            The body of this revision was not stored: it is larger than the importer&apos;s ceiling and a
            truncated body passed off as the text would be worse than none. Its size is recorded above.
          </p>
        ) : (
          <div className="revision-body" dangerouslySetInnerHTML={{ __html: body }} />
        )}
      </Card>
    </>
  );
}
