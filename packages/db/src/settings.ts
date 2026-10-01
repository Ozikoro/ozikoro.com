/**
 * The settings an administrator owns, and the defaults they fall back to.
 *
 * Everything here has a default that is exactly what the site did before this existed, so an
 * empty table means an unchanged site. That is deliberate: a settings screen that changes the
 * site the moment it is deployed is a settings screen nobody trusts.
 */
import type { Db } from './client.ts';

export interface NavItem {
  label: string;
  href: string;
  /** Shown at the right of the header with the donate treatment. */
  emphasis?: boolean;
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface SiteSettings {
  'identity.siteName': string;
  'identity.tagline': string;
  'theme.ink': string;
  'theme.paper': string;
  'theme.accent': string;
  'theme.header': string;
  'theme.footer': string;
  'theme.link': string;
  /** How wide the content column runs. The owner asked to control it. */
  'theme.width': string;
  /** The site mark. Empty keeps the shipped logo. */
  'identity.logoUrl': string;
  'nav.items': NavItem[];
  'footer.about': string;
  'footer.note': string;
  'footer.links': FooterLink[];
  'ads.enabled': boolean;
  /** The sections of the front page, in the order the admin dragged them. */
  'home.blocks': string[];
  /*
   * The codes that let other platforms see the site.
   *
   * The owner: "have a place to add google analytics code, google webmaster search code, and other
   * platforms code to appear on their search. it should all be in the settings".
   *
   * Kept as plain strings because each is pasted verbatim from the platform, and a validator that
   * second-guessed a snippet would be a validator that rejected a working one.
   */
  'code.googleAnalytics': string;
  'code.googleVerification': string;
  'code.bingVerification': string;
  'code.customHead': string;
}

export const SETTING_DEFAULTS: SiteSettings = {
  'identity.siteName': 'Ozituma',
  'identity.tagline': 'The Igbo dictionary',
  'theme.ink': '#1E1B16',
  'theme.paper': '#ffffff',
  'theme.accent': '#7a3b12',
  'theme.header': '#1E1B16',
  'theme.footer': '#1E1B16',
  'theme.link': '#7a3b12',
  'theme.width': '72rem',
  'identity.logoUrl': '',
  'nav.items': [
    { label: 'Dictionary', href: '/' },
    { label: 'Names', href: '/names' },
    { label: 'Clans', href: '/clans' },
    { label: 'Languages', href: '/languages' },
    { label: 'Learn', href: '/learn' },
    { label: 'Proverbs', href: '/proverbs' },
    { label: 'Contribute', href: '/contribute' },
    { label: 'Ndebe', href: '/ndebe' },
    { label: 'Support us', href: '/donate', emphasis: true },
    { label: 'About', href: '/about' },
    { label: 'API', href: '/docs' },
  ],
  'footer.about': 'The dictionary of Ozikoro. Its history and archive sit at ozikoro.com; the words live here.',
  'footer.note': '',
  'footer.links': [
    { label: 'About', href: '/about' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'API', href: '/docs' },
    { label: 'Free key', href: '/developers' },
    { label: 'Status', href: '/api/health' },
    { label: 'Email', href: 'mailto:hello@ozikoro.com' },
  ],
  'ads.enabled': false,
  'home.blocks': ['hero', 'wordOfTheDay', 'languages'],
  'code.googleAnalytics': '',
  'code.googleVerification': '',
  'code.bingVerification': '',
  'code.customHead': '',
};

/**
 * What the front page can be made of.
 *
 * Named here rather than in the page, so the arranger and the renderer cannot drift apart: a block
 * the admin can drag is a block the page knows how to draw.
 */
export const HOME_BLOCKS: { id: string; label: string; note: string }[] = [
  { id: 'hero', label: 'Hero and search', note: 'The headline, the search box and the site numbers.' },
  { id: 'wordOfTheDay', label: 'Word of the day', note: 'One entry, chosen for the day.' },
  { id: 'languages', label: 'Languages', note: 'Every language with its honest word count.' },
  { id: 'contribute', label: 'Add to the dictionary', note: 'The invitation and its two buttons.' },
];

export type SettingKey = keyof SiteSettings;

export async function readSettings(db: Db): Promise<SiteSettings> {
  const rows = await db.rows<{ key: string; value: unknown }>(`select key, value from site_setting`);
  const out = { ...SETTING_DEFAULTS } as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) out[row.key] = row.value;
  }
  return out as unknown as SiteSettings;
}

export async function readSetting<K extends SettingKey>(db: Db, key: K): Promise<SiteSettings[K]> {
  const all = await readSettings(db);
  return all[key];
}

export async function writeSetting(
  db: Db,
  key: SettingKey,
  value: unknown,
  accountId: number | null
): Promise<void> {
  await db.query(
    `insert into site_setting (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update set value = excluded.value, updated_at = now(),
                                     updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), accountId]
  );
}

export interface AdRow {
  id: number;
  slot: string;
  label: string;
  html: string | null;
  active: boolean;
  position: number;
}

export async function listAds(db: Db): Promise<AdRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, slot, label, html, active, position from site_ad order by slot, position, id`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slot: String(r.slot),
    label: String(r.label),
    html: (r.html as string | null) ?? null,
    active: Boolean(r.active),
    position: Number(r.position ?? 0),
  }));
}

/** The advertisement to render in a slot, or nothing. The first active one, by position. */
export async function activeAd(db: Db, slot: string): Promise<AdRow | null> {
  const rows = await listAds(db);
  return rows.find((a) => a.slot === slot && a.active && a.html) ?? null;
}

export const AD_SLOTS: { slot: string; where: string }[] = [
  { slot: 'header', where: 'Under the navigation, above the page' },
  { slot: 'article', where: 'Inside a word or clan entry, after the first section' },
  { slot: 'sidebar', where: 'Beside the content, on pages wide enough to have one' },
  { slot: 'footer', where: 'Above the footer' },
];
