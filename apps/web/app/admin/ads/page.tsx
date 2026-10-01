import { getDb } from '@ozituma/db/client';
import { listAds, AD_SLOTS, readSettings } from '@ozituma/db/settings';
import { Head, Card, Notices } from '../ui';

export const dynamic = 'force-dynamic';

/*
 * Where an advertisement may show, and where it may not.
 *
 * The owner: "admin can even add where ads can show, and where it can't." So a slot with no
 * active row renders nothing at all, and the four slots are the four places the layout actually
 * has room for. A slot is a position on a page, not a network — the snippet is whatever the
 * administrator pastes in, so AdSense and a hand-written link are the same mechanism.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const [ads, settings] = await Promise.all([listAds(db), readSettings(db)]);

  return (
    <>
      <Head title="Ads" />
      <Notices saved={params.saved} error={params.error} />

      <Card title="Advertising">
        <form method="post" action="/api/admin/site" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="action" value="toggle-ads" />
          <input type="hidden" name="enabled" value={settings['ads.enabled'] ? '0' : '1'} />
          <span className={`wpbadge ${settings['ads.enabled'] ? 'wpbadge-on' : 'wpbadge-off'}`}>
            {settings['ads.enabled'] ? 'Advertising is on' : 'Advertising is off'}
          </span>
          <button className="wpbtn wpbtn-quiet" type="submit">
            {settings['ads.enabled'] ? 'Turn all advertising off' : 'Turn advertising on'}
          </button>
        </form>
        <p className="wphelp" style={{ marginTop: '0.6rem' }}>
          Off is the master switch: nothing renders anywhere, whatever the slots below say. On
          leaves each slot to its own switch.
        </p>
      </Card>

      {AD_SLOTS.map(({ slot, where }) => {
        const inSlot = ads.filter((a) => a.slot === slot);
        return (
          <Card key={slot} title={`${slot.charAt(0).toUpperCase()}${slot.slice(1)} — ${where}`}>
            {inSlot.length === 0 ? (
              <p className="wphelp">Nothing in this slot, so nothing shows there.</p>
            ) : (
              <table className="wptable">
                <thead><tr><th>Name</th><th>Status</th><th>Snippet</th><th /></tr></thead>
                <tbody>
                  {inSlot.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.label}</strong></td>
                      <td>
                        <span className={`wpbadge ${a.active ? 'wpbadge-on' : 'wpbadge-off'}`}>
                          {a.active ? 'showing' : 'off'}
                        </span>
                      </td>
                      <td className="wprow-actions">{(a.html ?? '').slice(0, 60) || '—'}</td>
                      <td className="wprow-actions" style={{ whiteSpace: 'nowrap' }}>
                        <form method="post" action="/api/admin/site" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="toggle-ad" />
                          <input type="hidden" name="id" value={a.id} />
                          <button className="wpbtn wpbtn-quiet wpbtn-mini" type="submit">
                            {a.active ? 'Turn off' : 'Turn on'}
                          </button>
                        </form>{' '}
                        <form method="post" action="/api/admin/site" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="delete-ad" />
                          <input type="hidden" name="id" value={a.id} />
                          <button className="wpbtn wpbtn-danger wpbtn-mini" type="submit">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form method="post" action="/api/admin/site" style={{ marginTop: '0.9rem', borderTop: '1px solid #f0f0f1', paddingTop: '0.9rem' }}>
              <input type="hidden" name="action" value="add-ad" />
              <input type="hidden" name="slot" value={slot} />
              <div className="wpfield-inline">
                <div className="wpfield">
                  <label htmlFor={`label-${slot}`}>Name</label>
                  <input id={`label-${slot}`} name="label" type="text" maxLength={80} placeholder="e.g. Sponsor — December" />
                </div>
              </div>
              <div className="wpfield">
                <label htmlFor={`html-${slot}`}>Snippet</label>
                <textarea id={`html-${slot}`} name="html" rows={3} placeholder="Paste the ad markup, or a link" />
              </div>
              <button className="wpbtn" type="submit">Add to this slot</button>
            </form>
          </Card>
        );
      })}
    </>
  );
}
