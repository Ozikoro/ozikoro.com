/** The revisions of one WordPress parent post the archive does not hold. See the index for why. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { listOrphanRevisions } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
/*
 * THE ADMIN MODULE IS REACHED BY A ROOTED SPECIFIER, NOT BY COUNTING `..`.
 *
 * `next build` failed on this file with `Module not found: Can't resolve '../../../../../ui'`: five `..` from
 * `[parent]/` lands on `apps/ozikoro/app/ui`, and the module is `apps/ozikoro/app/admin/ui.tsx`. **Three
 * would have resolved**, and so does the rooted spelling used here — which is the better fix, because it
 * cannot drift the way a relative path does when a directory is renamed or a sibling is copied.
 *
 * **The depth was counted from the wrong directory, and the trap is that the sibling one level deeper,
 * `[parent]/[revisionId]/page.tsx`, carries a `..` string that looks the same and IS right** — it is one
 * directory deeper, so copying its line upward is what breaks. `tsc --noEmit` never reported it: the
 * specifier type-resolves through the base config's `paths`, and only webpack's own resolution refuses it.
 * **A relative import the type checker accepts and the bundler rejects is how a build fails with a clean
 * typecheck** — and it stops the whole build, so every route waits on it.
 *
 * Corrected by a parallel agent while this round was verifying its own work; the rooted form is its fix and
 * it is kept. Resolved against the filesystem rather than counted, for the record:
 *
 *     from [parent]/                  ../../../ui           -> app/admin/ui    present
 *                                     ../../../../ui        -> app/ui          missing
 *                                     ../../../../../ui     -> ui              missing   ← what was here
 *     from [parent]/[revisionId]/     ../../../../ui        -> app/admin/ui    present
 */
import { Card, Head } from '@/app/admin/ui';

export const dynamic = 'force-dynamic';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function OrphanRevisionList({ params }: { params: Promise<{ parent: string }> }) {
  const { parent } = await params;
  const parentPostId = Number.parseInt(parent, 10);
  if (!Number.isInteger(parentPostId) || parentPostId <= 0) notFound();

  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/orphan-revisions/${parentPostId}`);

  const db = await getDb();
  const revisions = await listOrphanRevisions(db, parentPostId);
  if (revisions.length === 0) notFound();

  return (
    <>
      <Head title={`Revisions of WordPress post ${parentPostId}`}>
        <Link className="btn btn--sm" href="/admin/archive/orphan-revisions">Back to the list</Link>
      </Head>

      <Card title={`${revisions.length} revisions of a parent the archive does not hold`}>
        <p className="help">
          These revisions belong to WordPress post {parentPostId}, which the archive deliberately did not
          import. The text is kept because it is the record of what was written.
        </p>
        <ul className="history">
          {revisions.map((r) => (
            <li key={r.id}>
              <div className="history__when">
                {r.revisedAt ? new Date(r.revisedAt).toISOString().slice(0, 19).replace('T', ' ') : 'undated'}
                {r.author ? ` · ${r.author}` : ''} · WordPress revision {r.wpRevisionId ?? '—'}
                {r.carriesUniqueText ? ' · carries text found nowhere else' : ''}
              </div>
              <p className="history__what">
                <Link href={`/admin/archive/orphan-revisions/${parentPostId}/${r.id}`}>
                  {r.title?.trim() || `${r.wordCount} words`}
                </Link>
              </p>
              <p className="history__detail">
                {r.wordCount} words · {bytes(r.bodyBytes)}
                {r.opening ? ` · “${r.opening.slice(0, 140)}…”` : ''}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
