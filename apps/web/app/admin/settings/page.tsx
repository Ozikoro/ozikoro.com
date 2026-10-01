import { getDb } from '@ozituma/db/client';
import { readSettings } from '@ozituma/db/settings';
import { Head, Card, Notices } from '../ui';

export const dynamic = 'force-dynamic';

/*
 * Settings: the codes that let other platforms see the site.
 *
 * The owner: "have a place to add google analytics code, google webmaster search code, and other
 * platforms code to appear on their search. it should all be in the settings."
 *
 * Each platform asks for one of two kinds of thing, and they are not interchangeable:
 *
 *   * Analytics wants a MEASUREMENT ID, which the site puts into its own loader script. So the
 *     field takes the id — G-XXXXXXX — and not the whole snippet, because pasting the snippet and
 *     pasting the id are different jobs and mixing them produces a site that loads the tag twice.
 *   * Search Console and Bing want a VERIFICATION TOKEN, which goes into a meta tag. Same rule.
 *   * Anything else wants raw markup, which is what the last field is for.
 *
 * Nothing here is validated beyond being text: a snippet pasted from a platform is the platform's
 * own business, and a validator that second-guessed it would eventually reject a working one.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const s = await readSettings(db);

  const set = (key: string) => Boolean((s as unknown as Record<string, string>)[key]);

  return (
    <>
      <Head title="Settings" />
      <Notices saved={params.saved} error={params.error} />

      <form method="post" action="/api/admin/site">
        <input type="hidden" name="action" value="save-codes" />

        <div className="wpgrid">
          <Card title="Google Analytics">
            <div className="wpfield">
              <label htmlFor="googleAnalytics">Measurement ID</label>
              <input
                id="googleAnalytics"
                name="googleAnalytics"
                type="text"
                defaultValue={s['code.googleAnalytics']}
                placeholder="G-XXXXXXXXXX"
                maxLength={40}
              />
              <p className="wphelp">
                The ID alone, not the whole snippet — the site writes the loader itself, so pasting
                the snippet as well would load the tag twice. Leave empty to switch analytics off.
              </p>
            </div>
            <p className="wphelp">
              Status: {set('code.googleAnalytics') ? <span className="wpbadge wpbadge-on">on</span> : <span className="wpbadge wpbadge-off">off</span>}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
          </Card>

          <Card title="Search engines">
            <div className="wpfield">
              <label htmlFor="googleVerification">Google Search Console token</label>
              <input
                id="googleVerification"
                name="googleVerification"
                type="text"
                defaultValue={s['code.googleVerification']}
                placeholder="the content value from the meta tag"
                maxLength={200}
              />
              <p className="wphelp">
                Search Console offers an HTML tag; copy only the <code>content</code> value. The
                site adds the meta tag itself.
              </p>
            </div>
            <div className="wpfield">
              <label htmlFor="bingVerification">Bing Webmaster token</label>
              <input
                id="bingVerification"
                name="bingVerification"
                type="text"
                defaultValue={s['code.bingVerification']}
                placeholder="msvalidate.01 content value"
                maxLength={200}
              />
              <p className="wphelp">Same again: the token, not the tag.</p>
            </div>
          </Card>

          <Card title="Other platforms">
            <div className="wpfield">
              <label htmlFor="customHead">Markup for the head</label>
              <textarea
                id="customHead"
                name="customHead"
                rows={6}
                defaultValue={s['code.customHead']}
                placeholder="<meta ...> or <script>...</script>"
              />
              <p className="wphelp">
                Anything else a platform asks you to put in the head — a site verification for
                another engine, a chat widget, a pixel. It is written into the head of every page
                exactly as typed, so it is worth pasting carefully.
              </p>
            </div>
          </Card>
        </div>

        <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
          <button className="wpbtn" type="submit">Save</button>
        </p>
      </form>

      <Card title="What this does not do">
        <p>
          Turning a code on here does not put your traffic on this screen. This page hands the codes
          to the platform; the platform&rsquo;s own dashboard shows what it measured.{' '}
          <a href="/admin/analytics">The analytics page</a> reports what this site counts itself.
        </p>
      </Card>
    </>
  );
}
