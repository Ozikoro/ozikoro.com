/**
 * POST /api/admin/site — the screens an administrator changes without a deploy.
 *
 * One endpoint rather than five, because every action here is "an administrator edited a panel
 * and pressed Save", and five files would be five places for the role check to drift. The role
 * check is the first thing that happens and nothing else runs without it.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { writeSetting, HOME_BLOCKS, type NavItem, type FooterLink } from '@ozituma/db/settings';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  return new NextResponse(null, { status: 303, headers: { Location: search ? `${path}?${search}` : path } });
}

/** "Label | /href" per line, which is how a person types a menu. */
function parseLinks(raw: string, limit: number, withEmphasis = false): (NavItem | FooterLink)[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('|'))
    .slice(0, limit)
    .map((line) => {
      const [label = '', ...rest] = line.split('|');
      const href = rest.join('|').trim();
      const item: NavItem = { label: label.trim().slice(0, 60), href: href.slice(0, 300) };
      if (withEmphasis && /#emphasis\b/i.test(href)) {
        item.href = href.replace(/#emphasis\b/i, '').trim();
        item.emphasis = true;
      }
      return item;
    })
    .filter((i) => i.label.length > 0 && i.href.length > 0);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) return back('/signin', { error: 'Sign in to reach the admin.' });
  const role = current.account.role;
  if (role !== 'admin' && role !== 'owner') {
    return NextResponse.json({ error: { code: 'forbidden', message: 'Administrators only.' } }, { status: 403 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const text = (name: string, max = 2000) => String(form.get(name) ?? '').trim().slice(0, max);
  const db = await getDb();
  const who = current.account.id;

  try {
    if (action === 'save-appearance') {
      const ink = text('ink', 7);
      const paper = text('paper', 7);
      const accent = text('accent', 7);
      const header = text('header', 7);
      const footer = text('footer', 7);
      const link = text('link', 7);
      for (const pair of [[ink, 'Text'], [paper, 'Background'], [accent, 'Accent'], [header, 'Header'], [footer, 'Footer'], [link, 'Links']] as const) {
        const [value, label] = pair;
        if (!HEX.test(value)) return back('/admin/appearance', { error: `${label} must be a hex colour like #1E1B16.` });
      }
      await writeSetting(db, 'identity.siteName', text('siteName', 60) || 'Ozituma', who);
      await writeSetting(db, 'identity.tagline', text('tagline', 120), who);
      /*
       * The logo, and the width of the content column.
       *
       * The width is checked against a shape rather than a list: rem, px and % are the three a
       * person reaches for, and a value that is none of them would break every page at once.
       */
      const logoUrl = text('logoUrl', 500);
      if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
        return back('/admin/appearance', { error: 'The logo must be a link starting with http:// or https://.' });
      }
      await writeSetting(db, 'identity.logoUrl', logoUrl, who);
      const width = text('width', 12) || '72rem';
      if (!/^\d+(\.\d+)?(rem|px|em|%)$/.test(width)) {
        return back('/admin/appearance', { error: 'The width must be like 72rem, 960px or 90%.' });
      }
      await writeSetting(db, 'theme.width', width, who);
      await writeSetting(db, 'theme.ink', ink, who);
      await writeSetting(db, 'theme.paper', paper, who);
      await writeSetting(db, 'theme.accent', accent, who);
      await writeSetting(db, 'theme.header', header, who);
      await writeSetting(db, 'theme.footer', footer, who);
      await writeSetting(db, 'theme.link', link, who);
      /*
       * The menu arrives from the drag-and-drop editor as JSON when it is used, and as the plain
       * "Label | /href" text when it is not. Both are accepted because the textarea is still there
       * for anyone who would rather type it.
       */
      const menuJson = text('menuItems', 8000);
      let menu: NavItem[] = [];
      if (menuJson) {
        try {
          const parsed: unknown = JSON.parse(menuJson);
          if (Array.isArray(parsed)) {
            menu = parsed
              .map((r) => {
                const row = r as { label?: unknown; href?: unknown; emphasis?: unknown };
                return {
                  label: String(row.label ?? '').trim().slice(0, 60),
                  href: String(row.href ?? '').trim().slice(0, 300),
                  ...(row.emphasis ? { emphasis: true } : {}),
                };
              })
              .filter((i) => i.label.length > 0 && i.href.length > 0)
              .slice(0, 12);
          }
        } catch {
          return back('/admin/appearance', { error: 'The menu could not be read.' });
        }
      } else {
        menu = parseLinks(text('menu', 4000), 12, true) as NavItem[];
      }
      if (menu.length === 0) return back('/admin/appearance', { error: 'The menu cannot be empty — a site with no navigation has no way in.' });
      await writeSetting(db, 'nav.items', menu, who);
      await writeSetting(db, 'footer.about', text('footerAbout', 400), who);
      await writeSetting(db, 'footer.note', text('footerNote', 160), who);
      await writeSetting(db, 'footer.links', parseLinks(text('footerLinks', 4000), 10), who);
      return back('/admin/appearance', { saved: 'The site picked the changes up on the next page load.' });
    }

    if (action === 'save-codes') {
      /*
       * The platform codes. Kept verbatim — a snippet is the platform's own business — except that
       * the two verification tokens and the measurement id are trimmed, because a trailing space
       * pasted from a web page is the most common reason a verification silently fails.
       */
      await writeSetting(db, 'code.googleAnalytics', text('googleAnalytics', 40), who);
      await writeSetting(db, 'code.googleVerification', text('googleVerification', 200), who);
      await writeSetting(db, 'code.bingVerification', text('bingVerification', 200), who);
      await writeSetting(db, 'code.customHead', text('customHead', 4000), who);
      return back('/admin/settings', { saved: 'The codes are in place. They appear on the next page load.' });
    }

    if (action === 'save-blocks') {
      /*
       * The front page's arrangement. Only ids the page knows how to draw are kept, so a
       * hand-edited field cannot put a name into the setting that nothing renders.
       */
      const raw = text('homeBlocks', 2000);
      let ids: string[] = [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) ids = parsed.map((v) => String(v));
      } catch {
        return back('/admin/layout', { error: 'The arrangement could not be read.' });
      }
      const known = new Set(HOME_BLOCKS.map((b) => b.id));
      const ordered = ids.filter((id) => known.has(id));
      if (ordered.length === 0) {
        return back('/admin/layout', { error: 'The front page cannot be empty — leave at least one block showing.' });
      }
      await writeSetting(db, 'home.blocks', ordered, who);
      return back('/admin/layout', { saved: 'The front page is now arranged in that order.' });
    }

    if (action === 'toggle-ads') {
      await writeSetting(db, 'ads.enabled', text('enabled', 1) === '1', who);
      return back('/admin/ads', { saved: 'Advertising is now ' + (text('enabled', 1) === '1' ? 'on.' : 'off.') });
    }

    if (action === 'add-ad') {
      const slot = text('slot', 20);
      const label = text('label', 80);
      const html = text('html', 4000);
      if (!['header', 'footer', 'article', 'sidebar'].includes(slot)) return back('/admin/ads', { error: 'That is not a slot the layout has room for.' });
      if (!label) return back('/admin/ads', { error: 'Give the advertisement a name so it can be found again.' });
      await db.query(
        `insert into site_ad (slot, label, html, active, position)
         values ($1, $2, $3, false, coalesce((select max(position) + 1 from site_ad where slot = $1), 0))`,
        [slot, label, html || null]
      );
      return back('/admin/ads', { saved: `Added to the ${slot} slot, switched off until you turn it on.` });
    }

    if (action === 'toggle-ad' || action === 'delete-ad') {
      const id = Number(text('id', 12));
      if (!Number.isInteger(id) || id <= 0) return back('/admin/ads', { error: 'That advertisement is not there.' });
      if (action === 'delete-ad') {
        await db.query(`delete from site_ad where id = $1`, [id]);
        return back('/admin/ads', { saved: 'Deleted.' });
      }
      await db.query(`update site_ad set active = not active, updated_at = now() where id = $1`, [id]);
      return back('/admin/ads', { saved: 'Switched.' });
    }

    return back('/admin', { error: 'That action is not one this screen offers.' });
  } catch (error) {
    console.error('[admin/site]', error);
    return back('/admin', { error: 'That could not be saved.' });
  }
}
