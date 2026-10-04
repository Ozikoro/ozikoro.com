import { getDb } from '@ozituma/db/client';
import { hostsSummary, dailyByHost, topPages, KNOWN_HOSTS } from '@ozituma/db/analytics';
import { readSettings } from '@ozituma/db/settings';
import { Head, Card, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const DAYS = 30;

/*
 * Analytics, for the site and the subdomain.
 *
 * The owner: "There should be page for analytics of both the main and subdomain outside the admin."
 *
 * "Outside the admin" is how this counts: the pages it measures are the ones a reader sees —
 * ozituma.com and its subdomain — and the admin is deliberately excluded, because counting the
 * people running the site alongside the people reading it would make every number on this page a
 * lie about the second group.
 *
 * WHAT THIS IS, said plainly on the page as well as here: a first-party count of pages, not of
 * people. No cookies, no identifiers, no fingerprinting. So it can say that a page was read 400
 * times and cannot say that 300 people read it — a person who reads it twice counts twice. Google
 * Analytics is wired in Settings for anyone who wants the fuller picture, and the two are not the
 * same measurement.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const [hosts, daily, pages, settings] = await Promise.all([
    hostsSummary(db, DAYS),
    dailyByHost(db, DAYS),
    topPages(db, DAYS, 25),
    readSettings(db),
  ]);

  const n = (value: number) => value.toLocaleString();
  const byHost = new Map(hosts.map((h) => [h.host, h]));
  // Every host shown, whether or not it has been read yet: an empty row is information.
  const allHosts = [...new Set([...KNOWN_HOSTS, ...hosts.map((h) => h.host)])];
  const totalMonth = hosts.reduce((sum, h) => sum + h.month, 0);
  const analyticsOn = Boolean(settings['code.googleAnalytics']);

  return (
    <>
      <Head title="Analytics">
        <span className="wpbadge">last {DAYS} days</span>
      </Head>
      <Notices saved={params.saved} error={params.error} />

      <Card title="Both addresses, side by side">
        <div className="wpsections">
          {allHosts.map((host) => {
            const h = byHost.get(host);
            return (
              <div className="wpsection" key={host} style={{ borderLeftColor: h ? undefined : '#c3c4c7' }}>
                <span className="wpsection-count">{n(h?.month ?? 0)}</span>
                <span className="wpsection-live">in {DAYS} days</span>
                <strong>{host}</strong>
                {h ? (
                  <span className="wphelp">
                    {n(h.today)} today · {n(h.week)} this week · {n(h.pages)} pages seen
                  </span>
                ) : (
                  <span className="wphelp">Nothing counted yet.</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="wphelp" style={{ marginTop: '0.8rem' }}>
          {n(totalMonth)} page views across every address in {DAYS} days.
        </p>
      </Card>

      <div className="wpgrid">
        <Card title="By day">
          {daily.length === 0 ? (
            <p className="wphelp">
              Nothing counted yet. Views begin from the moment this page started counting.
            </p>
          ) : (
            <table className="wptable">
              <thead>
                <tr><th>Day</th><th>Address</th><th style={{ textAlign: 'right' }}>Views</th></tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={`${d.day}-${d.host}`}>
                    <td>{d.day}</td>
                    <td className="wphelp">{d.host}</td>
                    <td style={{ textAlign: 'right' }}>{n(d.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Most read pages">
          {pages.length === 0 ? (
            <p className="wphelp">Nothing counted yet.</p>
          ) : (
            <table className="wptable">
              <thead>
                <tr><th>Page</th><th style={{ textAlign: 'right' }}>Views</th></tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={`${p.host}-${p.path}`}>
                    <td>
                      <a href={`https://${p.host}${p.path}`} target="_blank" rel="noreferrer">{p.path}</a>
                      <div className="wphelp" style={{ margin: 0 }}>{p.host}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{n(p.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="wpgrid">
        <Card title="What this counts">
          <p>
            Pages read, counted by this site: no cookies, no identifiers, nothing that follows a
            reader. It can say a page was read four hundred times; it cannot say three hundred people
            read it.
          </p>
          <p className="wphelp">
            The admin is not counted. A first-party counter that included the people running the
            site would overstate what the public is reading, which is the only thing this page is
            for.
          </p>
        </Card>

        <Card title="The fuller picture">
          <p>
            Google Analytics is a different and better measurement — people rather than pages,
            sources, devices, geography. {analyticsOn ? 'It is switched on for this site.' : 'It is not switched on yet.'}
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <a href="/admin/settings">{analyticsOn ? 'Change the code →' : 'Add the code in Settings →'}</a>
          </p>
          <p className="wphelp">
            The two are not added together anywhere. This page reports what this site counted; the
            other reports what Google counted.
          </p>
        </Card>
      </div>
    </>
  );
}
