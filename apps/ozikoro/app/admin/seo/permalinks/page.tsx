/**
 * /admin/seo/permalinks — the address every record is served at, and how to change one.
 *
 * ── WHAT HE ASKED FOR, AND THE RULE THAT DECIDES HOW IT IS GIVEN ─────────────────────────────────────
 *
 *   "one should be able to change permalink"
 *
 * **⚠️ THIS ARCHIVE'S RULE IS THAT A RECORD KEEPS THE ADDRESS IT WAS PUBLISHED AT.** 1,057 WordPress posts were
 * imported at `https://ozikoro.com/<slug>/`, those addresses are cited in papers and indexed, and the archive
 * has burned rounds on exactly the failure where a published address stopped resolving. `/authors/` and
 * `/privacy-policy/` are still 301s for that reason, written as constants in `middleware.ts` because the
 * middleware cannot read a database.
 *
 * So a permalink edit here is **not a move**: it changes the record's slug — which is what the canonical, the
 * sitemap and every link this archive builds are derived from — and it stores a 301 from the old address to
 * the new one, in the same act. **A permalink editor that changed the address and left the old one to 404
 * would be worse than having none**, and the screen says so where the change is made.
 *
 * ── WHERE THE CHANGE IS ACTUALLY WRITTEN, AND WHERE THE OLD ADDRESS IS ACTUALLY SERVED ───────────────
 *
 * The write is `changeRecordPermalink` in `packages/ozikoro/src/site-seo.ts`: it writes the redirect FIRST and
 * moves the slug SECOND, so there is no instant in which the old address resolves to nothing. The read is at
 * the top of `apps/ozikoro/app/[slug]/route.ts`, **before the topic lookup, before the access-tier check and
 * before the record is read** — a redirect is a statement about an address, not about a page.
 *
 * ── A DRAFT'S ADDRESS SIMPLY MOVES, AND THE SCREEN SAYS SO ───────────────────────────────────────────
 *
 * A record that has never been published has no published address to keep: nothing cites it, nothing indexed
 * it, and a redirect from an address that never answered would be a redirect nobody asked for. So a draft
 * moves with no redirect stored, and the notice after the change says that rather than implying otherwise.
 */
import { getDb } from '@ozituma/db/client';
import { listPermalinks, normalisePath } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { SeoNav } from '../nav';

const CAPABILITY = 'manage_design';
const HERE = '/admin/seo/permalinks/';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('en-GB');

export default async function SeoPermalinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { account } = await requireCapabilityOrRedirect(CAPABILITY, HERE);
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const search = one('q');
  const page = Math.max(0, Number.parseInt(one('page'), 10) || 0);
  const limit = 50;

  const db = await getDb();
  const rows = await listPermalinks(db, { search, limit, offset: page * limit });

  /* Counted from the rows on this page, so the number is one a reader can check by counting them. */
  const withHistory = rows.filter((row) => row.previous.length > 0).length;
  const drafts = rows.filter((row) => row.draft).length;

  return (
    <div className="admin-shell">
      <Head title="Permalinks and addresses" />
      <SeoNav active="permalinks" />
      <Notices saved={one('saved')} error={one('error')} />

      <Card title="What an address is here, and why changing one is a redirect">
        <p>
          A record’s address is its slug — <code>/{'<slug>'}/</code> — and it is what the{' '}
          <code>&lt;link rel=&quot;canonical&quot;&gt;</code>, the sitemap and every link the archive builds for
          the record are made from. <b>This archive’s rule is that a record keeps the address it was published
          at</b>, so changing the address here does two things in one act: it moves the record, and it leaves a
          permanent redirect at the old address. Every published address for the record therefore keeps
          resolving, and this page shows each one that has.
        </p>
        <p className="small muted">
          <b>The address SHAPE is not editable.</b> A setting such as <code>/%category%/%postname%/</code> would
          be a way to move 1,057 published addresses at once, and the archive has already answered what happens
          then. Every address this archive has ever published is <code>/&lt;slug&gt;/</code>, and that is the
          shape it keeps.
        </p>
        <AtAGlance
          rows={[
            ['Records on this page', num(rows.length)],
            ['Of those, moved before', `${num(withHistory)} — each keeps every old address resolving`],
            ['Of those, drafts', `${num(drafts)} — a draft moves with no redirect, because it never had a published address`],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>

      <Card title="Find a record">
        <form method="get" action={HERE} style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Part of a title or an address"
            aria-label="Search records by title or address"
            style={{ flex: '1 1 20rem' }}
          />
          <button className="btn" type="submit">
            Find it
          </button>
          {search ? (
            <a className="btn btn-quiet" href={HERE}>
              Clear
            </a>
          ) : null}
        </form>
      </Card>

      <Card title={search ? `Records matching “${search}”` : 'The newest records'}>
        {rows.length === 0 ? (
          <p>
            <b>No record matched.</b> Nothing was changed; try part of the title or part of the address.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Address it is served at now</th>
                <th scope="col">Status</th>
                <th scope="col">Old addresses still resolving</th>
                <th scope="col">Change it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>
                    <code>{row.path}</code>
                  </td>
                  <td>
                    {row.draft ? <span className="small muted">draft — no address published yet</span> : 'published'}
                  </td>
                  <td>
                    {row.previous.length === 0 ? (
                      <span className="small muted">none</span>
                    ) : (
                      <span className="small">
                        {row.previous.map((entry) => (
                          <code key={entry.from} style={{ display: 'block' }}>
                            {entry.from} → {entry.redirect.to}
                          </code>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <a className="btn btn-quiet" href={`${HERE}${row.id}/`}>
                      Change the address
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <nav className="row" style={{ marginTop: '.6rem', gap: '.4rem' }} aria-label="Pagination">
          {page > 0 ? (
            <a className="btn btn-quiet" href={`${HERE}?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
              Newer records
            </a>
          ) : null}
          {rows.length === limit ? (
            <a className="btn btn-quiet" href={`${HERE}?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
              Older records
            </a>
          ) : null}
        </nav>
      </Card>

      <Card title="Addresses the archive redirects that are not records" quiet>
        <p className="small muted">
          The redirect table also holds addresses added by hand on the{' '}
          <a href="/admin/seo/tools/">Tools</a> section, and the constants the middleware carries —{' '}
          <code>/authors/</code> to <code>/researchers/</code>, <code>/privacy-policy/</code> to{' '}
          <code>/privacy/</code>, <code>/author/ozikoro/</code> to <code>/author/nze/</code>,{' '}
          <code>{normalisePath('/towns')}</code> and <code>{normalisePath('/clans')}</code> to{' '}
          <code>/clan-towns/</code>, and <code>/archive-index/</code> to <code>/archive/</code>.{' '}
          <b>Those five live in code and are not editable here</b>: each is a decision about an address the
          archive already published, they run before routing in the middleware where a database read is not
          possible, and a screen that could retarget one would be a screen that could break a cited address.
        </p>
      </Card>
    </div>
  );
}
