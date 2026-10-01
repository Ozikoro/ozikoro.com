import { getDb } from '@ozituma/db/client';
import { readSettings } from '@ozituma/db/settings';
import { MenuEditor } from '@/components/menu-editor';
import { Head, Card, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const linesToLinks = (links: { label: string; href: string }[]) =>
  links.map((l) => `${l.label} | ${l.href}`).join('\n');

/*
 * Appearance.
 *
 * Nothing here needs a deploy. The owner's ask was "Admin can also edit footer, change colours of
 * the website and practically everything... change the menu, arranging and customising certain
 * parts of the website should be possible". The one thing deliberately absent is the layout
 * itself — the pages are the design, and a colour picker cannot rearrange them.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const s = await readSettings(db);

  return (
    <>
      <Head title="Colours, footer and menu" />
      <Notices saved={params.saved} error={params.error} />

      <form method="post" action="/api/admin/site">
        <input type="hidden" name="action" value="save-appearance" />

        <div className="wpgrid">
          <Card title="Colours">
            <div className="wpfield">
              <label htmlFor="siteName">Site name</label>
              <input id="siteName" name="siteName" type="text" defaultValue={s['identity.siteName']} maxLength={60} />
            </div>
            <div className="wpfield">
              <label htmlFor="tagline">Tagline</label>
              <input id="tagline" name="tagline" type="text" defaultValue={s['identity.tagline']} maxLength={120} />
            </div>
            <div className="wpfield">
              <label htmlFor="logoUrl">Logo</label>
              <input
                id="logoUrl"
                name="logoUrl"
                type="text"
                defaultValue={s['identity.logoUrl']}
                placeholder="https://… — leave empty for the shipped mark"
                maxLength={500}
              />
              <p className="wphelp">
                A link to the logo that replaces the Ozituma mark in the header and the footer. Leave
                it empty to go back to the one the site ships with.
              </p>
            </div>
            <div className="wpfield">
              <label htmlFor="width">Content width</label>
              <input id="width" name="width" type="text" defaultValue={s['theme.width']} placeholder="72rem" maxLength={12} />
              <p className="wphelp">
                How wide the text column runs — <code>72rem</code>, <code>960px</code> or{' '}
                <code>90%</code>. Narrower is easier to read; wider fits more. This is the one part
                of the layout a setting can honestly change, because the pages themselves are the
                design.
              </p>
            </div>
            <div className="wpfield-inline">
              {([
                ['ink', 'Text', s['theme.ink']],
                ['paper', 'Page background', s['theme.paper']],
                ['header', 'Header', s['theme.header']],
                ['footer', 'Footer', s['theme.footer']],
                ['accent', 'Accent', s['theme.accent']],
                ['link', 'Links', s['theme.link']],
              ] as const).map(([field, label, value]) => (
                <div className="wpfield" key={field}>
                  <label htmlFor={field}>{label}</label>
                  <div className="wpswatch">
                    <input id={field} name={field} type="color" defaultValue={value} />
                    <span className="wphelp">{value}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="wphelp">
              Applied to the public site as CSS variables, so every page picks them up. The layout
              itself — where things sit on a page — is the design and is not a colour.
            </p>
          </Card>

          <Card title="Menu">
            <p className="wphelp" style={{ marginBottom: '0.7rem' }}>
              Drag the items into the order you want, or type them below instead — whichever you
              prefer. Nothing here changes until you press Save at the foot of the page.
            </p>
            <MenuEditor initial={s['nav.items'].map((i) => ({ label: i.label, href: i.href, emphasis: i.emphasis }))} />
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Type them instead</summary>
              <div className="wpfield" style={{ marginTop: '0.6rem' }}>
                <label htmlFor="menu">Navigation, one per line</label>
                <textarea id="menu" name="menu" rows={8} defaultValue={linesToLinks(s['nav.items'])} />
                <p className="wphelp">
                  As <code>Label | /href</code>. Used when the list above is left untouched.
                </p>
              </div>
            </details>
          </Card>

          <Card title="Footer">
            <div className="wpfield">
              <label htmlFor="footerAbout">About line</label>
              <textarea id="footerAbout" name="footerAbout" rows={3} defaultValue={s['footer.about']} />
            </div>
            <div className="wpfield">
              <label htmlFor="footerNote">Note</label>
              <input id="footerNote" name="footerNote" type="text" defaultValue={s['footer.note']} maxLength={160} />
              <p className="wphelp">Left of the copyright line. The year is added automatically.</p>
            </div>
            <div className="wpfield">
              <label htmlFor="footerLinks">Footer links</label>
              <textarea id="footerLinks" name="footerLinks" rows={6} defaultValue={linesToLinks(s['footer.links'])} />
              <p className="wphelp">One per line, as <code>Label | /href</code>.</p>
            </div>
          </Card>
        </div>

        <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
          <button className="wpbtn" type="submit">Save changes</button>
        </p>
      </form>
    </>
  );
}
