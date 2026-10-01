import { Head, Card } from '../ui';

export const dynamic = 'force-dynamic';

/*
 * Learn, and what "control it from here" honestly means.
 *
 * learn.ozituma.com is the same container and the same Next.js process as the dictionary, served
 * by host name — so there is no second server to administer and no separate database. What is NOT
 * here is a course editor: the courses live in their own tables and their own screens under the
 * learn host. Rather than put switches on this page that change nothing, it says what is true and
 * links to where the working is.
 */
export default async function Page() {
  return (
    <>
      <Head title="Learn">
        <a className="wpbtn" href="https://learn.ozituma.com" target="_blank" rel="noreferrer">
          Open learn.ozituma.com
        </a>
      </Head>

      <div className="wpgrid">
        <Card title="How it is served">
          <table className="wptable">
            <tbody>
              <tr><th>Subdomain</th><td>learn.ozituma.com</td></tr>
              <tr><th>Served by</th><td>The same container and process as this site</td></tr>
              <tr><th>Database</th><td>The same Postgres, its own tables</td></tr>
              <tr><th>Also reachable at</th><td>/learn on this domain</td></tr>
            </tbody>
          </table>
          <p className="wphelp" style={{ marginTop: '0.8rem' }}>
            Because it is one process, a change deployed here is deployed there. There is no second
            admin to visit and nothing to keep in step.
          </p>
        </Card>

        <Card title="What is not on this page">
          <p>
            Course content — lessons, exercises and their progress — is edited under the learn host
            itself, not here. The menu on the left of this screen has no Courses item because there
            is no course editor behind it, and a menu item that led to an empty screen would be
            worse than its absence.
          </p>
          <p className="wphelp">
            If a course editor is wanted inside this admin, it is a screen that reads the learn
            tables — worth doing, and not something to fake in the meantime.
          </p>
        </Card>

        <Card title="Shared with this site">
          <p>
            The site name, the colours, the navigation and the footer on this screen are the same
            settings <strong>Appearance</strong> writes, so anything changed there applies to the
            learn host too where it renders the same chrome.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <a href="/admin/appearance">Colours, footer and menu →</a>
          </p>
        </Card>
      </div>
    </>
  );
}
