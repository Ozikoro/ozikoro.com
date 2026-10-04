/**
 * Revisions whose parent post this archive does not hold.
 *
 * WHY THIS SCREEN IS NOT OPTIONAL
 *
 * 74 of the 4,266 revisions belong to WordPress posts the archive deliberately did not import —
 * `nav_menu_item`, `elementor_library`, `attachment`. Their text is still the record of what was
 * written, so the backfill kept them with a NULL `article_id` rather than dropping them. **But a
 * revision with no article has no article page to be listed on**, so without this screen those 74
 * rows would be a table nobody could reach — which is precisely the fault the brief names: a backfill
 * that satisfies a count and nothing else.
 *
 * They are grouped by the WordPress post they are a revision of, because that is the only subject
 * they have here, and the revision itself is read through `/admin/archive/orphan-revisions/<parent>/<id>`
 * below.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listOrphanRevisionGroups, revisionArchiveTotals } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head } from '@/app/admin/ui';

export const dynamic = 'force-dynamic';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function OrphanRevisions() {
  await requireCapabilityOrRedirect('edit_entity', '/admin/archive/orphan-revisions');

  const db = await getDb();
  const [groups, totals] = await Promise.all([listOrphanRevisionGroups(db), revisionArchiveTotals(db)]);

  return (
    <>
      <Head title="Revisions of records the archive does not hold">
        <Link className="btn btn--sm" href="/admin/archive">Back to the queue</Link>
      </Head>

      <Card title="The revision archive, as a whole">
        <p className="help">
          <strong>{totals.revisions.toLocaleString()}</strong> revisions imported, holding{' '}
          <strong>{bytes(totals.bodyBytes)}</strong> of text, across <strong>{totals.records}</strong>{' '}
          records. <strong>{totals.carriers.toLocaleString()}</strong> carry a passage that appears in no
          other record in the archive. <strong>{totals.orphans}</strong> belong to a WordPress post the
          archive does not hold, and are listed here because nothing else can list them.
        </p>
      </Card>

      <Card title={`${groups.length} parents the archive does not hold`}>
        {groups.length === 0 ? (
          <p className="help">Every imported revision belongs to a record this archive holds.</p>
        ) : (
          <>
            <p className="help">
              These are revisions of WordPress posts that were not imported — menu items, library layouts
              and attachments. Their text is kept because it is the record of what was written; the parent
              is the only subject they have here.
            </p>
            <ul className="history">
              {groups.map((g) => (
                <li key={g.wpParentPostId}>
                  <div className="history__when">
                    WordPress post {g.wpParentPostId} · {g.revisions} revisions · {bytes(g.bodyBytes)}
                    {g.carryingUniqueText > 0 ? ` · ${g.carryingUniqueText} carrying unique text` : ''}
                  </div>
                  <p className="history__what">
                    <Link href={`/admin/archive/orphan-revisions/${g.wpParentPostId}`}>
                      {g.titles.length > 0 ? g.titles.join(' · ') : `Revisions of post ${g.wpParentPostId}`}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
