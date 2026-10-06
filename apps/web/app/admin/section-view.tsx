import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listSection, listSections, type SectionKey } from '@ozituma/db/admin';
import { Head, Card, Notices } from './ui';

/*
 * One section of the record, on its own page.
 *
 * The owner: "on the admin, names, proverbs, clans and towns, dictionary are all to have separate
 * pages."
 *
 * Until now they were six anchors on one screen with one of them open, which meant the dictionary
 * and the proverbs shared a page and an address. Each is its own page now, with its own address, so
 * it can be linked to, bookmarked and returned to, and so the menu has somewhere real to point.
 *
 * The readonly sections (recordings, submissions) are rendered here too but say plainly where they
 * are acted on, rather than offering buttons that would be wrong on this screen.
 */
export async function SectionView({
  section,
  page = 1,
  saved,
  error,
}: {
  section: SectionKey;
  page?: number;
  saved?: string;
  error?: string;
}) {
  const db = await getDb();
  const [sections, listing] = await Promise.all([
    listSections(db),
    listSection(db, section, page),
  ]);
  const meta = sections.find((s) => s.key === section);
  if (!listing || !meta) {
    return (
      <>
        <Head title="Not a section" />
        <Card>
          <p>There is no section called &ldquo;{section}&rdquo;.</p>
        </Card>
      </>
    );
  }

  const readonly = section === 'recordings' || section === 'submissions';

  /*
   * Whether the public page this row links to actually exists.
   *
   * The clan registry lists hidden clans as well as published ones — the count in the heading says
   * so — but `/clans/[slug]` looks the clan up with `and c.published`, so "Open" on a hidden clan was
   * a link to a 404. Six clans on this database are hidden and every one of them was affected.
   *
   * Scoped to clans deliberately: the word, name and proverb pages resolve whatever the entry's
   * status, so a draft there has a real page and must keep its link.
   */
  const publiclyReachable = (row: { status: string }) =>
    section === 'clans' ? row.status === 'published' : true;

  return (
    <>
      <Head title={meta.label}>
        {/* The count is the point of the heading: what the section holds, and how much is live. */}
        <span className="wpbadge">{meta.total.toLocaleString()} in all</span>
        <span className={`wpbadge ${meta.live > 0 ? 'wpbadge-on' : ''}`}>
          {section === 'submissions'
            ? `${meta.live.toLocaleString()} waiting`
            : `${meta.live.toLocaleString()} live`}
        </span>
      </Head>
      <Notices saved={saved} error={error} />

      <Card title={meta.note}>
        {listing.rows.length === 0 ? (
          <p className="wphelp">Nothing here yet.</p>
        ) : (
          <>
            <table className="wptable">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>State</th>
                  <th>Open</th>
                  <th>{readonly ? 'Where it is acted on' : 'Hide or delete'}</th>
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>
                      <strong>{row.title}</strong>
                      {row.subtitle ? (
                        <div className="wphelp" style={{ margin: 0 }}>{row.subtitle}</div>
                      ) : null}
                    </td>
                    <td className="wphelp">{row.status}</td>
                    <td>
                      {publiclyReachable(row) ? (
                        <Link className="wpbtn wpbtn-quiet wpbtn-mini" href={row.url}>Open</Link>
                      ) : (
                        <span className="wphelp">not public</span>
                      )}
                    </td>
                    <td>
                      {readonly ? (
                        <span className="wphelp">
                          {section === 'recordings' ? 'listen on the entry' : 'decide in review'}
                        </span>
                      ) : (
                        <form action="/api/admin/accounts" method="post" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <input type="hidden" name="action" value="content.remove" />
                          <input type="hidden" name="back" value={`/admin/${section}${listing.page > 1 ? `?page=${listing.page}` : ''}`} />
                          <input type="hidden" name="kind" value={row.kind} />
                          <input type="hidden" name="id" value={row.id} />
                          <button className="wpbtn wpbtn-quiet wpbtn-mini" type="submit" name="mode" value="hide">Hide</button>
                          <button className="wpbtn wpbtn-danger wpbtn-mini" type="submit" name="mode" value="delete">Delete</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listing.pages > 1 ? (
              <p style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', alignItems: 'center' }}>
                {listing.page > 1 ? (
                  <Link className="wpbtn wpbtn-quiet" href={`/admin/${section}?page=${listing.page - 1}`}>← Previous</Link>
                ) : null}
                <span className="wphelp">Page {listing.page} of {listing.pages}</span>
                {listing.page < listing.pages ? (
                  <Link className="wpbtn wpbtn-quiet" href={`/admin/${section}?page=${listing.page + 1}`}>Next →</Link>
                ) : null}
              </p>
            ) : null}
          </>
        )}
      </Card>

      {readonly ? (
        <Card title="Why there is no Delete here">
          <p>
            {section === 'recordings'
              ? 'A recording is removed from the entry it belongs to, where you can hear it beside the word it is meant to say. Deleting it from a list would be deleting it without listening.'
              : 'A submission is decided in the review queue, where the whole of it can be read before it is accepted or refused.'}
          </p>
        </Card>
      ) : null}
    </>
  );
}
