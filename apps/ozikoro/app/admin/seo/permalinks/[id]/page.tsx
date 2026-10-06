/**
 * /admin/seo/permalinks/[id] — one record's address, and the form that changes it.
 *
 * ── WHAT THIS SCREEN IS FOR, IN ONE SENTENCE ─────────────────────────────────────────────────────────
 *
 * Changing the address a record is served at, **with the old address still resolving**, which is the archive's
 * own rule and the reason this is not simply an editable slug field next to a save button. The write is
 * `changeRecordPermalink` — see `packages/ozikoro/src/site-seo.ts` for why the redirect is written before the
 * slug moves — and this page is the form in front of it.
 *
 * ── WHY THE OLD ADDRESSES ARE PRINTED BEFORE THE FORM AND NOT AFTER IT ───────────────────────────────
 *
 * The owner is about to move an address that 1,057 records were published at the same shape of. **What he needs
 * to see first is what has happened before** — which addresses this record has already been moved away from,
 * and where each of them goes now — because moving it a second time retargets those as well, and a reader who
 * did not know that would expect the first redirect to still point where it did.
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { permalinkRecord, slugProblem } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../../ui';
import { SeoNav } from '../../nav';
import { SEO_ACTION } from '../../settings';

const CAPABILITY = 'manage_design';

export const dynamic = 'force-dynamic';

function when(value: string): string {
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function SeoPermalinkRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const here = `/admin/seo/permalinks/${id}/`;
  const { account } = await requireCapabilityOrRedirect(CAPABILITY, here);
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  const db = await getDb();
  const record = await permalinkRecord(db, articleId);
  if (!record) notFound();

  /* So the form can refuse the same things the write path refuses, before a round trip. */
  const proposed = one('slug');
  const proposedProblem = proposed ? slugProblem(proposed) : null;

  return (
    <div className="admin-shell">
      <Head title={`The address of “${record.title}”`}>
        <a className="btn btn-quiet" href="/admin/seo/permalinks/">
          Back to every record’s address
        </a>
      </Head>
      <SeoNav active="permalinks" />
      <Notices saved={one('saved')} error={one('error')} />

      <Card title="What it is served at now">
        <AtAGlance
          rows={[
            ['Record', record.title],
            ['Address', <code key="path">{record.path}</code>],
            ['Status', record.draft ? 'draft — this address has never been published' : 'published'],
            [
              'Old addresses still resolving',
              record.previous.length === 0 ? (
                'none — this record has never been moved'
              ) : (
                <span key="prev">
                  {record.previous.map((entry) => (
                    <code key={entry.from} style={{ display: 'block' }}>
                      {entry.from} → {entry.redirect.to} (added {when(entry.redirect.at)})
                    </code>
                  ))}
                </span>
              ),
            ],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
        <p className="small muted">
          The address is served from the record’s own slug, so it is also what the{' '}
          <code>&lt;link rel=&quot;canonical&quot;&gt;</code> and the sitemap entry say. Changing it changes all
          three; nothing else about the record moves.
        </p>
      </Card>

      <Card title="Change the address">
        <p>
          Type the new address as a slug — <b>lowercase letters, digits and hyphens</b>, the shape every address
          in this archive already has. The record moves, and{' '}
          {record.draft ? (
            <>
              <b>no redirect is stored, because a draft has never had a published address</b> for anything to
              have cited.
            </>
          ) : (
            <>
              <b>its old address is left answering a permanent redirect to the new one</b>, so every link,
              citation and search result that was ever published for it keeps working.
            </>
          )}
        </p>
        <form method="post" action={SEO_ACTION}>
          <input type="hidden" name="action" value="changePermalink" />
          <input type="hidden" name="articleId" value={record.id} />
          <input type="hidden" name="returnTo" value={here} />
          <label className="small" htmlFor="slug">
            The new address — the part between the slashes
          </label>
          <input
            id="slug"
            type="text"
            name="slug"
            defaultValue={proposed || record.slug}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '.9rem' }}
          />
          {proposedProblem ? (
            <p className="small" style={{ color: '#8a2c2c', margin: '.3rem 0 0' }}>
              {proposedProblem}
            </p>
          ) : null}
          <label className="small" htmlFor="note" style={{ display: 'block', marginTop: '.5rem' }}>
            Why it is moving, in your own words (optional — it is written into the audit trail)
          </label>
          <input id="note" type="text" name="note" style={{ width: '100%' }} />
          <div style={{ marginTop: '.5rem' }}>
            <button className="btn" type="submit">
              {record.draft ? 'Move the draft' : 'Move it, and redirect the old address'}
            </button>
          </div>
        </form>
        <p className="small muted" style={{ marginTop: '.6rem' }}>
          <b>What an address may not be.</b> It cannot be one another record already holds — two records cannot
          share one address — and it cannot be a page of this site: the first segment of every real route
          (<code>topics</code>, <code>documents</code>, <code>author</code>, <code>clans</code>,{' '}
          <code>admin</code> and the rest) is refused by name, because a record that took <code>/admin/</code>{' '}
          would take the back office’s address.
        </p>
      </Card>

      {record.previous.length > 0 ? (
        <Card title="What happens to the addresses it was moved away from before">
          <p className="small muted">
            Moving this record again <b>retargets every earlier address of it straight to the new one</b>. No
            address is ever left taking two hops to resolve, and none is left pointing at an address that no
            longer serves this record. That is done in the same write, and it is why this list is on the screen
            before the form rather than after it.
          </p>
          <ul className="small">
            {record.previous.map((entry) => (
              <li key={entry.from}>
                <code>{entry.from}</code> currently answers 301 to <code>{entry.redirect.to}</code>; after a move
                it will answer 301 to the new address directly.
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
