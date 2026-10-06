/**
 * /admin/seo/tools — robots.txt, the sitemap, and the redirect manager.
 *
 * ── THREE TOOLS, AND EACH HAS A BOUND THE SCREEN STATES RATHER THAN HIDES ─────────────────────────────
 *
 * **1. robots.txt is additive.** The archive excludes `/admin`, `/signin`, `/search`, `/design/` and `/api/`
 * because leaving each crawlable put either the demonstration content or a private surface into search results.
 * A screen that could remove one of those would be a screen that could publish the back office, so a path added
 * here is one more line in the served file and nothing here removes one of the archive's own. That is asserted
 * by a test: `apps/ozikoro/app/robots.txt/route.ts` writes `OWN_ROBOTS_DISALLOW`, and `site-seo.test.ts` proves
 * the list the screen prints and the list the file writes are the same list.
 *
 * **2. The sitemap's sections can be withheld, never invented.** The child sitemaps are enumerated in
 * `packages/ozikoro/src/seo.ts`. Selecting some of them narrows the index; the write path refuses a name that is
 * not one of them; and a section taken out of the index is still served at its own address, so a crawler that
 * already knows it is not sent a 404 by a settings change.
 *
 * **3. The redirect manager shows and writes the table — and states where it cannot be read.** The middleware
 * cannot read a database: it runs in Next's edge runtime, before routing and outside the Node process, and
 * PGlite needs `node:fs` and a WebAssembly build the edge runtime does not have. So the table is read in the
 * Node routes that serve a page — <code>app/[slug]/route.ts</code>, <code>app/design-screen/[screen]/route.ts</code>
 * — and the five redirects that must run before routing are constants in <code>middleware.ts</code> and are
 * named at the bottom of this screen so an owner can see the whole set rather than only the editable part.
 */
import { getDb } from '@ozituma/db/client';
import {
  MAX_LIST_ENTRIES,
  OWN_ROBOTS_DISALLOW,
  REDIRECTS_KEY,
  ROBOTS_DISALLOW_KEY,
  SITEMAP_GROUPS,
  SITEMAP_GROUPS_KEY,
  canonicalUrl,
  loadRedirects,
  loadSiteSeoSettings,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { Field, RedirectForm } from '../fields';
import { SeoNav } from '../nav';

const CAPABILITY = 'manage_design';
const HERE = '/admin/seo/tools/';

export const dynamic = 'force-dynamic';

/** One stored value as a string. */
function valueOf(settings: Map<string, { value: unknown }>, key: string): string {
  const setting = settings.get(key);
  if (!setting) return '';
  const value = setting.value;
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>).value === 'string') {
    return (value as Record<string, unknown>).value as string;
  }
  return '';
}

function when(value: string): string {
  // A redirect the archive's own write path recorded carries a real timestamp; one read from an empty or
  // hand-written row carries the epoch, which is shown as "—" rather than as 1 January 1970.
  if (!value || value.startsWith('1970-')) return 'an unrecorded date';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** A list setting as the one-entry-per-line text the textarea holds. */
function listText(settings: Map<string, { value: unknown }>, key: string): { text: string; count: number } {
  const setting = settings.get(key);
  if (!setting) return { text: '', count: 0 };
  let value: unknown = setting.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = [];
    }
  }
  if (!Array.isArray(value)) return { text: '', count: 0 };
  const entries = value.filter((entry): entry is string => typeof entry === 'string');
  return { text: entries.join('\n'), count: entries.length };
}

export default async function SeoToolsPage({
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

  const db = await getDb();
  const settings = await loadSiteSeoSettings(db);
  const redirects = await loadRedirects(db);
  const entries = Object.entries(redirects).sort((a, b) => a[0].localeCompare(b[0]));
  const robots = listText(settings, ROBOTS_DISALLOW_KEY);
  const groups = listText(settings, SITEMAP_GROUPS_KEY);

  return (
    <div className="admin-shell">
      <Head title="robots.txt, the sitemap and redirects">
        <a className="btn btn-quiet" href="/robots.txt" target="_blank" rel="noreferrer">
          Open the served robots.txt
        </a>
        <a className="btn btn-quiet" href="/sitemap.xml" target="_blank" rel="noreferrer">
          Open the served sitemap index
        </a>
      </Head>
      <SeoNav active="tools" />
      <Notices saved={one('saved')} error={one('error')} />

      <Card title="robots.txt — paths the crawlers are told to leave alone">
        <p>
          The archive already excludes{' '}
          {OWN_ROBOTS_DISALLOW.map((path, index) => (
            <span key={path}>
              {index > 0 ? ', ' : ''}
              <code>{path}</code>
            </span>
          ))}
          . <b>Those cannot be removed from a screen, and that is the point</b> — each is a private surface or the
          design deliverable, and a screen that could un-exclude one would be a screen that could publish the back
          office. Anything you add here is <b>one more line in the served file</b>, and clearing the list returns
          the file to exactly what the archive has always served.
        </p>
        <Field
          settingKey={ROBOTS_DISALLOW_KEY}
          label="Extra paths to disallow"
          hint="One per line, each beginning with a slash — e.g. /drafts/. Plain directories only: no wildcard, no query string."
          value={robots.text}
          placeholder="/a-directory/"
          reads="apps/ozikoro/app/robots.txt/route.ts — GET(), which appends these to the archive’s own list in the served file"
          provedBy="/robots.txt"
          multiline
          rows={5}
          unit={`${MAX_LIST_ENTRIES} entries`}
          stored={settings.get(ROBOTS_DISALLOW_KEY) ?? null}
        >
          <p className="small muted" style={{ margin: '.4rem 0 0' }}>
            {robots.count === 0
              ? 'Nothing is stored, so the served robots.txt is the archive’s own five lines plus its sitemap and host — unchanged.'
              : `${robots.count} ${robots.count === 1 ? 'path is' : 'paths are'} added, and the served robots.txt has them.`}
          </p>
        </Field>
      </Card>

      <Card title="The sitemap — which sections the index lists">
        <p>
          <code>/sitemap.xml</code> is an <b>index</b>, and it lists one child sitemap per kind of thing the
          archive holds. Empty means every section is listed, which is what the archive serves today. Selecting
          some here narrows the index; <b>every child sitemap keeps its own address either way</b>, so a section
          you stop listing is not a section a crawler that already knows it gets a 404 from.
        </p>
        <Field
          settingKey={SITEMAP_GROUPS_KEY}
          label="Sections to list in the index"
          hint={`One per line. The sections are: ${SITEMAP_GROUPS.join(', ')}.`}
          value={groups.text}
          placeholder={SITEMAP_GROUPS.join('\n')}
          reads="apps/ozikoro/app/sitemap.xml/route.ts — GET(), which filters SITEMAP_GROUPS by this selection"
          provedBy="/sitemap.xml"
          multiline
          rows={6}
          unit={`${MAX_LIST_ENTRIES} entries`}
          stored={settings.get(SITEMAP_GROUPS_KEY) ?? null}
        >
          <p className="small muted" style={{ margin: '.4rem 0 0' }}>
            {groups.count === 0
              ? 'Nothing is stored, so the index lists every section — unchanged.'
              : `${groups.count} of the ${SITEMAP_GROUPS.length} sections are listed.`}{' '}
            Each child is at{' '}
            {SITEMAP_GROUPS.slice(0, 3).map((group, index) => (
              <span key={group}>
                {index > 0 ? ', ' : ''}
                <a href={`/sitemap/${group}`} target="_blank" rel="noreferrer">{`/sitemap/${group}`}</a>
              </span>
            ))}
            {' '}and the rest.
          </p>
        </Field>
        <p className="small muted">
          <b>The addresses themselves are not editable</b>, and that is a decision: the sitemap is assembled by one
          function in <code>packages/ozikoro/src/seo.ts</code> that asks the database what is indexable, so a
          setting able to add an address would be a setting able to invite a crawler to a page that does not
          exist — the fault that file already records for a researcher’s profile and for two redirected registers.
        </p>
      </Card>

      <Card title={`Redirects — ${entries.length === 0 ? 'none stored' : `${entries.length} stored`}`}>
        <p>
          A redirect here is served with a <b>301</b>, so a search engine moves the address rather than keeping
          both. The table is held in the database under one key and <b>read in the Node routes that serve a
          page</b> — <code>app/[slug]/route.ts</code> first thing, before the record is read, and{' '}
          <code>app/design-screen/[screen]/route.ts</code> before the screen is built.
        </p>
        <p className="small muted">
          <b>Where it cannot be read.</b> <code>middleware.ts</code> runs in Next’s edge runtime, before routing
          and outside the Node process; PGlite needs <code>node:fs</code> and a WebAssembly build that runtime
          does not have, so a database read there would not be slow — it would not run. That is why the five
          middleware redirects below are constants, and why a stored redirect reaches a page through the routes
          rather than through the middleware.
        </p>
        {entries.length === 0 ? (
          <p>
            <b>Nothing is stored, so no address is redirected by this table</b> and every address serves its own
            page. A record that is moved from the <a href="/admin/seo/permalinks/">Permalinks</a> section writes
            its old address here automatically.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Goes to</th>
                <th scope="col">Why</th>
                <th scope="col">Set</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([from, entry]) => (
                <tr key={from}>
                  <td>
                    <code>{from}</code>
                  </td>
                  <td>
                    <code>{entry.to}</code>
                  </td>
                  <td className="small">
                    {entry.kind === 'permalink-change'
                      ? `a record was moved${entry.articleId ? ` (record ${entry.articleId})` : ''}`
                      : 'added by hand'}
                  </td>
                  <td className="small">{when(entry.at)}</td>
                  <td>
                    <RedirectForm from={from} add={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '.8rem' }}>
          <h3 style={{ margin: '0 0 .3rem' }}>Add one by hand</h3>
          <p className="small muted" style={{ margin: '0 0 .4rem' }}>
            Both addresses must begin with a slash. A path with a space, a backslash, a quote or an angle bracket
            is refused, and so is an address that would redirect to itself or inside itself — which would be a
            loop a reader never escapes.
          </p>
          <RedirectForm add />
        </div>
      </Card>

      <Card title="The redirects that live in code, which this screen cannot change" quiet>
        <p className="small muted">
          Each of these is a decision about an address the archive has already published, and each runs before
          routing — where a database read is not possible. <b>They are named here so that this screen shows the
          whole set rather than only the editable part.</b>
        </p>
        <dl className="pairs">
          <div style={{ display: 'contents' }}>
            <dt>
              <code>/authors/</code> → <code>/researchers/</code>
            </dt>
            <dd className="small">WordPress page 455 was the “Our Team” directory; all five of its bylines are on the archive’s researchers page, which holds more of them.</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>
              <code>/privacy-policy/</code> → <code>/privacy/</code>
            </dt>
            <dd className="small">Two notices in competition would be worse than either; the archive’s own is the one that is true of this site.</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>
              <code>/author/ozikoro/</code> → <code>/author/nze/</code>
            </dt>
            <dd className="small">The contributor <code>ozikoro</code> was merged into <code>nze</code> and its row deleted, so the address would 404 without this.</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>
              <code>/towns/</code>, <code>/clans/</code> → <code>/clan-towns/</code>
            </dt>
            <dd className="small">The owner renamed the register and there is one address for it; the query string is carried, so a filtered bookmark still lands filtered.</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt>
              <code>/archive-index/</code> → <code>/archive/</code>
            </dt>
            <dd className="small">One screen had two addresses serving two different implementations of it, which had drifted as far as the owner could see.</dd>
          </div>
        </dl>
        <p className="small muted">
          The middleware also 301s every <code>&lt;name&gt;.html</code> file name the design deliverable ships to
          the page that file draws, and every <code>&lt;screen&gt;/&lt;sibling&gt;.html</code> a served screen’s
          own relative links used to produce — the same rule, applied to the third and fourth spelling of an
          address that once worked.
        </p>
        <AtAGlance
          rows={[
            ['Robots paths added', robots.count === 0 ? 'none — the served file is the archive’s own' : `${robots.count}`],
            ['Sitemap sections listed', groups.count === 0 ? `all ${SITEMAP_GROUPS.length} — nothing stored` : `${groups.count} of ${SITEMAP_GROUPS.length}`],
            ['Redirects stored', `${entries.length}`],
            ['The sitemap index address', <a key="u" href={canonicalUrl('sitemap.xml')}>{canonicalUrl('sitemap.xml')}</a>],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>
    </div>
  );
}
