/**
 * Media rights: the work queue for the 3,488 items nobody has checked.
 *
 * The page opens on the numbers rather than the form, because the numbers are the argument. "3,488
 * items with no rights recorded, used on N published article placements" is a legal exposure, and an
 * editor opening this screen should see it before they see a checkbox.
 *
 * The queue is ordered by published exposure — an image on twenty articles is twenty times the risk
 * of one on a single article and the same work to check — so the highest-exposure items get looked at
 * first rather than whichever has the lowest id.
 *
 * The form is deliberately blunt about the default: every permission starts unchecked, so an editor
 * who saves without thinking permits nothing rather than everything.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  PERMISSION_BASIS_LABEL,
  SUBJECT_CONSENT_LABEL,
  getMediaRights,
  getRightsProgress,
  listRightsQueue,
} from '@ozikoro/platform';
import { Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: 'unchecked', label: 'Not yet checked' },
  { value: 'checked', label: 'Checked' },
  { value: 'unpublishable', label: 'Checked, not publishable' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'all', label: 'Everything' },
];

export default async function RightsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; item?: string; q?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter ?? 'unchecked') as 'unchecked' | 'checked' | 'unpublishable' | 'restricted' | 'all';
  const search = params.q?.trim() || null;
  const selectedId = params.item ? Number.parseInt(params.item, 10) : null;

  const db = await getDb();
  const [progress, queue] = await Promise.all([
    getRightsProgress(db),
    listRightsQueue(db, { filter, search, limit: 25 }),
  ]);

  // The item being edited, if one is selected — otherwise the top of the queue, so the screen is
  // useful on arrival rather than asking for two clicks before anything can be done.
  const focusId = Number.isInteger(selectedId) && selectedId ? selectedId : queue[0]?.mediaId ?? null;
  const focus = focusId ? await getMediaRights(db, focusId) : null;
  const focusItem = queue.find((q) => q.mediaId === focusId)
    ?? (focusId ? (await listRightsQueue(db, { filter: 'all', search: null, limit: 1, offset: 0 })).find((q) => q.mediaId === focusId) : undefined);

  const pct = (n: number) => `${Math.round((n / Math.max(progress.media, 1)) * 100)}%`;

  return (
    <>
      <Head title="Media rights">
        <Link className="btn btn--sm" href="/admin">Overview</Link>
      </Head>

      <Notices saved={params.saved} error={params.error} />

      <Card title="Where the archive stands">
        <p className="small muted">
          Recorded on {progress.checked.toLocaleString('en-GB')} of {progress.media.toLocaleString('en-GB')} items
          ({pct(progress.checked)}). <strong>{progress.articlesUsingUnchecked.toLocaleString('en-GB')}</strong>{' '}
          published article placements still rest on an item with no rights recorded.
        </p>
        <table className="record">
          <tbody>
            <tr><th scope="row">Checked</th><td>{progress.checked.toLocaleString('en-GB')} ({pct(progress.checked)})</td></tr>
            <tr><th scope="row">Publishable</th><td>{progress.publishable.toLocaleString('en-GB')}</td></tr>
            <tr><th scope="row">Restricted</th><td>{progress.restricted.toLocaleString('en-GB')}</td></tr>
            <tr><th scope="row">Depicting a living person</th><td>{progress.livingSubjects.toLocaleString('en-GB')}</td></tr>
            <tr><th scope="row">Consent withdrawn</th><td>{progress.consentWithdrawn.toLocaleString('en-GB')}</td></tr>
            <tr><th scope="row">Open take-down requests</th><td>{progress.takedownOpen.toLocaleString('en-GB')}</td></tr>
          </tbody>
        </table>
        <p className="help">
          Nothing here is guessed. An item with no rights recorded says so on its own page, and an
          item nobody has checked permits nothing rather than everything.
        </p>
      </Card>

      <Card title="The queue">
        <form method="get" action="/admin/rights/" className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          <label className="visually-hidden" htmlFor="filter">Filter</label>
          <select id="filter" name="filter" defaultValue={filter}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="q">Search</label>
          <input id="q" name="q" type="search" defaultValue={search ?? ''} placeholder="Search titles" />
          <button className="btn btn--sm btn--primary" type="submit">Apply</button>
        </form>

        {queue.length === 0 ? (
          <p className="help" style={{ marginTop: '1rem' }}>
            Nothing matches. If you filtered to unchecked items, every item has been looked at.
          </p>
        ) : (
          <table className="record" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Used by</th>
                <th scope="col">State</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.mediaId}>
                  <td>
                    <span className="mono small">{item.reference}</span>
                    <div>{item.title}</div>
                    <div className="history__when">{item.kind}</div>
                  </td>
                  <td className="small">
                    {item.usedByArticles} {item.usedByArticles === 1 ? 'placement' : 'placements'}
                  </td>
                  <td className="small">
                    {item.restricted ? 'restricted' : item.checked ? (item.allowsPublication ? 'publishable' : 'not publishable') : 'not checked'}
                    {item.licence ? <div className="history__when">{item.licence}</div> : null}
                  </td>
                  <td>
                    <Link className="btn btn--sm" href={`/admin/rights/?filter=${filter}&item=${item.mediaId}`}>Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {focusId ? (
        <Card title={`Record rights${focusItem ? ` — ${focusItem.reference}` : ''}`}>
          {focusItem ? (
            <p className="small muted">
              {focusItem.title} · used on {focusItem.usedByArticles} published{' '}
              {focusItem.usedByArticles === 1 ? 'placement' : 'placements'}
            </p>
          ) : null}

          {focusItem ? (
            <p className="small">
              <Link href={`/documents/${focusItem.slug}/`}>Open the item to look at it</Link>
            </p>
          ) : null}

          <form method="post" action="/api/admin/rights" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="save-rights" />
            <input type="hidden" name="mediaId" value={focusId} />

            <div className="wpgrid">
              <div className="wpfield">
                <label htmlFor="holderName">Rights holder</label>
                <input id="holderName" name="holderName" type="text" defaultValue={focus?.holderName ?? ''} maxLength={200} placeholder="a person, a family, an institution" />
              </div>
              <div className="wpfield">
                <label htmlFor="holderContact">Holder contact</label>
                <input id="holderContact" name="holderContact" type="text" defaultValue={focus?.holderContact ?? ''} maxLength={200} />
              </div>
              <div className="wpfield">
                <label htmlFor="permissionBasis">How permission was established</label>
                <select id="permissionBasis" name="permissionBasis" defaultValue={focus?.permissionBasis ?? ''}>
                  <option value="">— not established —</option>
                  {Object.entries(PERMISSION_BASIS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <p className="wphelp">Required before publication can be permitted. &ldquo;Not established&rdquo; is a valid answer; silence is not.</p>
              </div>
              <div className="wpfield">
                <label htmlFor="permissionDate">Date permission was given</label>
                <input id="permissionDate" name="permissionDate" type="date" defaultValue={focus?.permissionDate ?? ''} />
              </div>
              <div className="wpfield">
                <label htmlFor="licence">Licence</label>
                <input id="licence" name="licence" type="text" defaultValue={focus?.licence ?? ''} maxLength={200} placeholder="e.g. CC BY 4.0" />
              </div>
              <div className="wpfield">
                <label htmlFor="licenceUrl">Licence link</label>
                <input id="licenceUrl" name="licenceUrl" type="text" defaultValue={focus?.licenceUrl ?? ''} maxLength={300} />
              </div>
              <div className="wpfield">
                <label htmlFor="subjectIsLiving">Does it depict a living person?</label>
                <select id="subjectIsLiving" name="subjectIsLiving" defaultValue={focus?.subjectIsLiving === null || focus?.subjectIsLiving === undefined ? '' : focus.subjectIsLiving ? 'yes' : 'no'}>
                  <option value="">— not recorded —</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
                <p className="wphelp">Copyright and privacy are different rights. A photograph out of copyright can still show somebody alive.</p>
              </div>
              <div className="wpfield">
                <label htmlFor="subjectConsent">Consent of the person shown</label>
                <select id="subjectConsent" name="subjectConsent" defaultValue={focus?.subjectConsent ?? ''}>
                  <option value="">— not recorded —</option>
                  {Object.entries(SUBJECT_CONSENT_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <p className="wphelp">Required when the answer above is Yes. &ldquo;Not yet sought&rdquo; is a valid answer.</p>
              </div>
            </div>

            <fieldset style={{ marginTop: 'var(--s-4)' }}>
              <legend className="small">What this permits</legend>
              <label className="small" style={{ display: 'block' }}>
                <input type="checkbox" name="allowsPublication" defaultChecked={focus?.allowsPublication ?? false} /> Publish it
              </label>
              <label className="small" style={{ display: 'block' }}>
                <input type="checkbox" name="allowsDerivative" defaultChecked={focus?.allowsDerivative ?? false} /> Adapt it — including reading it aloud as audio
              </label>
              <label className="small" style={{ display: 'block' }}>
                <input type="checkbox" name="allowsCommercial" defaultChecked={focus?.allowsCommercial ?? false} /> Use it commercially
              </label>
              <p className="wphelp">All three start unchecked. An unfinished record permits nothing.</p>
            </fieldset>

            <div className="wpfield" style={{ marginTop: 'var(--s-4)' }}>
              <label htmlFor="permissionNote">What was established, and how</label>
              <textarea id="permissionNote" name="permissionNote" rows={3} maxLength={1000} defaultValue={focus?.permissionNote ?? ''} />
            </div>

            {focus?.isChecked ? (
              <div className="notice notice--info" role="status" style={{ marginTop: 'var(--s-4)' }}>
                <div>
                  <p className="notice__title">Currently states</p>
                  <p className="notice__body">{focus.publicStatement}</p>
                </div>
              </div>
            ) : null}

            <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
              <button className="btn btn--primary" type="submit">Save the rights</button>
            </p>
          </form>

          <form method="post" action="/api/admin/rights" style={{ marginTop: 'var(--s-5)' }}>
            <input type="hidden" name="action" value={focus?.restricted ? 'lift' : 'restrict'} />
            <input type="hidden" name="mediaId" value={focusId} />
            <div className="wpfield">
              <label htmlFor="reason">{focus?.restricted ? 'Why the restriction is being lifted' : 'Why it is being restricted'}</label>
              <input id="reason" name="reason" type="text" required minLength={3} maxLength={500} />
              <p className="wphelp">
                Kept and shown. A restriction that can be applied or removed without a reason is not a restriction.
              </p>
            </div>
            <button className={focus?.restricted ? 'btn' : 'btn btn--danger'} type="submit">
              {focus?.restricted ? 'Lift the restriction' : 'Restrict this item'}
            </button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
