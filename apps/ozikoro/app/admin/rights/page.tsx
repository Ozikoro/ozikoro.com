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
import { requireCapabilityOrRedirect } from '@/lib/access';
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

  // The page's own guard, FIRST. The layout's guard does not stop this page rendering — see
  // `requireCapabilityOrRedirect` for the measurement (an anonymous request answered 307 with 40 KB of this
  // screen's item references in the body).
  await requireCapabilityOrRedirect('manage_media_rights', '/admin/rights');

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
        <p className="small muted">
          Separately from any of that: <strong>{progress.withCredit.toLocaleString('en-GB')}</strong> items now
          carry a credit line and <strong>{progress.withLicence.toLocaleString('en-GB')}</strong> name a licence.
          Both were read out of the records themselves — the file&rsquo;s embedded metadata and the items&rsquo;
          own captions — by <code>scripts/derive-media-rights.ts</code>. <strong>A credit is not a licence</strong>,
          which is why they are counted apart: a credit says where something came from and grants nothing.
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
          /*
           * THE BULK PASS.
           *
           * 3,488 items and one form per item is 3,488 sittings, which is how a rights work list stays a
           * list. The same values can be written to the ticked items, or to every item on this page, in one
           * action — and **each item still gets its own audit row and its own validation**, because the
           * route loops the single-item write rather than issuing one UPDATE. So a batch cannot store a
           * publication permission with no basis, and a later reader can still see every item's own before
           * and after.
           *
           * The two buttons are the whole of the selection UI in either direction: there is no script on
           * this page, and "apply to all N shown" is deliberately N and not "everything", because a queue
           * that is paged must not let one click write 3,488 rows.
           */
          <form method="post" action="/api/admin/rights" style={{ marginTop: '1rem' }}>
            <input type="hidden" name="action" value="save-rights-bulk" />
            <table className="record">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Include in this batch</span>
                  </th>
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
                      <input
                        type="checkbox"
                        name="mediaId"
                        value={item.mediaId}
                        aria-label={`Include ${item.reference} in this batch`}
                      />
                    </td>
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

            {/* The page's own ids, so the second button can write all N without any script. */}
            {queue.map((item) => (
              <input key={`page-${item.mediaId}`} type="hidden" name="pageMediaId" value={item.mediaId} />
            ))}

            <fieldset style={{ marginTop: 'var(--s-4)' }}>
              <legend className="small">What to record on the selected items</legend>
              <div className="wpgrid">
                <div className="wpfield">
                  <label htmlFor="bulkCredit">Credit</label>
                  <input id="bulkCredit" name="credit" type="text" maxLength={300} placeholder="left empty, this clears any credit on the selected items" />
                </div>
                <div className="wpfield">
                  <label htmlFor="bulkLicence">Licence</label>
                  <input id="bulkLicence" name="licence" type="text" maxLength={200} placeholder="e.g. CC BY-SA 4.0" />
                </div>
                <div className="wpfield">
                  <label htmlFor="bulkLicenceUrl">Licence link</label>
                  <input id="bulkLicenceUrl" name="licenceUrl" type="text" maxLength={300} placeholder="https://…" />
                </div>
                <div className="wpfield">
                  <label htmlFor="bulkHolder">Rights holder</label>
                  <input id="bulkHolder" name="holderName" type="text" maxLength={200} />
                </div>
                <div className="wpfield">
                  <label htmlFor="bulkBasis">How permission was established</label>
                  <select id="bulkBasis" name="permissionBasis" defaultValue="">
                    <option value="">— not established —</option>
                    {Object.entries(PERMISSION_BASIS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                  <p className="wphelp">
                    Required before publication can be permitted, on every item in the batch. An item that
                    cannot take the change is refused and named; the rest are written.
                  </p>
                </div>
                <div className="wpfield">
                  <label htmlFor="bulkNote">What was established, and how</label>
                  <textarea id="bulkNote" name="permissionNote" rows={2} maxLength={1000} />
                </div>
              </div>
              <div style={{ marginTop: 'var(--s-3)' }}>
                <label className="small" style={{ display: 'block' }}>
                  <input type="checkbox" name="allowsPublication" /> Publish it
                </label>
                <label className="small" style={{ display: 'block' }}>
                  <input type="checkbox" name="allowsDerivative" /> Adapt it — including reading it aloud as audio
                </label>
                <label className="small" style={{ display: 'block' }}>
                  <input type="checkbox" name="allowsCommercial" /> Use it commercially
                </label>
              </div>
            </fieldset>

            <p style={{ marginTop: 'var(--s-4)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" type="submit" name="scope" value="selected">
                Record this on the ticked items
              </button>
              <button className="btn" type="submit" name="scope" value="page">
                Record this on all {queue.length} shown
              </button>
            </p>
            <p className="help">
              Every item written gets its own entry in the audit trail, with the values it replaced. At most
              200 items are written in one action.
            </p>
          </form>
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
                <label htmlFor="credit">Credit</label>
                <input id="credit" name="credit" type="text" defaultValue={focus?.credit ?? ''} maxLength={300} placeholder="who the item is credited to" />
                <p className="wphelp">
                  The line shown against the item, e.g. &ldquo;Northcote Thomas Collection / Museum of
                  Archaeology and Anthropology, Cambridge&rdquo;. Where the record itself states one, it has
                  already been filled in from that statement; emptying this box clears it, and the previous
                  value is kept in the audit trail.
                </p>
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
