import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { adminDashboard } from '@ozituma/db/dashboard';
import { listSections } from '@ozituma/db/admin';
import { readSettings, listAds } from '@ozituma/db/settings';
import { Head, Card } from './ui';

export const dynamic = 'force-dynamic';

/*
 * The dashboard, and the only place the counts live.
 *
 * The owner: "all these things that normally show in every page in the admin should not be, but at
 * least be in one page, like admin or which you think is better logically."
 *
 * They were on the accounts screen, which is not what an accounts screen is for, and that screen
 * was reached from several menu entries — so the same wall of numbers appeared wherever you went.
 * They belong here. A dashboard that every page repeats is not a dashboard; it is a header that
 * happens to be made of statistics.
 *
 * So: what the record holds, then the sections and how much is in each, then what needs a decision,
 * then how the site is configured. Everything else in the admin is a page you go to on purpose.
 */
export default async function Page() {
  const db = await getDb();
  const [data, settings, ads, sections] = await Promise.all([
    adminDashboard(db),
    readSettings(db),
    listAds(db),
    listSections(db),
  ]);

  const { dictionary, audio, accounts, queue } = data;
  const activeAds = ads.filter((a) => a.active).length;
  const n = (value: number) => value.toLocaleString();

  const figures: { label: string; value: number; note?: string }[] = [
    { label: 'words', value: dictionary.words, note: `${n(dictionary.publishedWords)} published` },
    { label: 'meanings', value: dictionary.definitions },
    { label: 'names', value: dictionary.names },
    { label: 'proverbs', value: dictionary.proverbs, note: `${n(dictionary.translatedProverbs)} with English` },
    {
      label: 'recordings',
      value: audio.total,
      note: `${n(audio.dialect)} dialect, ${n(audio.sentences)} on sentences`,
    },
    { label: 'relations between words', value: dictionary.relations },
    { label: 'varieties', value: dictionary.dialects },
    { label: 'accounts', value: accounts.total, note: `${n(accounts.signedInLast30)} signed in this month` },
  ];

  return (
    <>
      <Head title="Dashboard">
        <Link className="wpbtn" href="/contribute">Contributor dashboard</Link>
        <Link className="wpbtn wpbtn-quiet" href="/">Visit site</Link>
      </Head>

      <Card title="The record">
        <div className="wpfigures">
          {figures.map((figure) => (
            <div className="wpfigure" key={figure.label}>
              <b>{n(figure.value)}</b>
              <span>{figure.label}</span>
              {figure.note ? <em>{figure.note}</em> : null}
            </div>
          ))}
        </div>
        <p className="wphelp" style={{ marginTop: '0.8rem' }}>
          Every number is counted from the live tables, not estimated.
        </p>
      </Card>

      <Card title="Everything, by section">
        <p className="wphelp" style={{ marginBottom: '0.7rem' }}>
          Each count is live. Open one to work down the list — every entry there can be opened,
          hidden or deleted.
        </p>
        <div className="wpsections">
          {sections.map((section) => (
            <Link className="wpsection" href={`/admin/${section.key}`} key={section.key}>
              <span className="wpsection-count">{n(section.total)}</span>
              <span className="wpsection-live">
                {section.key === 'submissions' ? `${n(section.live)} waiting` : `${n(section.live)} live`}
              </span>
              <strong>{section.label}</strong>
              <span className="wphelp">{section.note}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="wpgrid">
        <Card title="Waiting on a decision">
          <table className="wptable">
            <tbody>
              <tr><th>Contributions pending</th><td style={{ textAlign: 'right' }}>{n(queue.pending ?? 0)}</td></tr>
              <tr><th>Recordings pending</th><td style={{ textAlign: 'right' }}>{n(audio.pending)}</td></tr>
              <tr><th>Editors</th><td style={{ textAlign: 'right' }}>{n(accounts.editors)}</td></tr>
              <tr><th>Advertisements live</th><td style={{ textAlign: 'right' }}>{n(activeAds)}</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.8rem', fontSize: 13 }}>
            <Link href="/review">Open the review queue →</Link>
          </p>
        </Card>

        <Card title="The site as it is configured">
          <table className="wptable">
            <tbody>
              <tr><th>Site name</th><td style={{ textAlign: 'right' }}>{settings['identity.siteName']}</td></tr>
              <tr><th>Menu items</th><td style={{ textAlign: 'right' }}>{n(settings['nav.items'].length)}</td></tr>
              <tr><th>Footer links</th><td style={{ textAlign: 'right' }}>{n(settings['footer.links'].length)}</td></tr>
              <tr><th>Ads</th><td style={{ textAlign: 'right' }}>{settings['ads.enabled'] ? 'on' : 'off'}</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.8rem', fontSize: 13 }}>
            <Link href="/admin/appearance">Colours, footer and menu</Link> ·{' '}
            <Link href="/admin/ads">Ads</Link> ·{' '}
            <Link href="/admin/layout">Page blocks</Link>
          </p>
        </Card>
      </div>

      <Card title="Languages">
        {data.languages.length === 0 ? (
          <p>No language has any published entries yet.</p>
        ) : (
          <table className="wptable">
            <thead>
              <tr>
                <th>Language</th>
                <th style={{ textAlign: 'right' }}>Published</th>
                <th style={{ textAlign: 'right' }}>Recordings</th>
              </tr>
            </thead>
            <tbody>
              {data.languages.slice(0, 8).map((l) => (
                <tr key={l.code}>
                  <td>{l.name} <span className="wpbadge">{l.code}</span></td>
                  <td style={{ textAlign: 'right' }}>{n(l.published)}</td>
                  <td style={{ textAlign: 'right' }}>{n(l.recordings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
