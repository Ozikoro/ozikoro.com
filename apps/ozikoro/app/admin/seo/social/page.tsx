/**
 * /admin/seo/social — what a shared link looks like, and the one card the archive can honestly set.
 *
 * ── WHAT THE HEAD BUILDER ALREADY EMITS, WHICH THIS SCREEN SHOWS RATHER THAN INVENTING ───────────────
 *
 * Every page of the archive carries Open Graph and Twitter card tags, built by `seoHead` from the record
 * itself. **Nothing about those tags was editable, and the old `/admin/seo/` said so** — *"the social-preview
 * editor for Open Graph and Twitter cards (they are emitted, but not editable here)"*. What is editable now is
 * the front page's own card: its title and its description, which are the two fields the tags are built from.
 * Everything else in the card is a fact about the page and is not a field:
 *
 *   `og:title`       the same line as the page's `<title>` — the homepage title on `/`, the record's own
 *                    elsewhere, and an editor's override where one is stored
 *   `og:description` the same sentence as the meta description
 *   `og:url`         the canonical address of the page
 *   `og:type`        `website` for a page, `article` for a record, `profile` for a person, `place` for a place
 *   `twitter:card`   `summary_large_image` when the record has an image, `summary` when it does not
 *   `og:image`       the record's own featured image, when it has one
 *
 * ── WHY THERE IS NO PER-RECORD CARD IMAGE FIELD ──────────────────────────────────────────────────────
 *
 * A record's card image is its featured image, chosen where the record is edited. **A second field pointing at
 * a second image would be a way for a page to show one photograph and its shared link another** — which is the
 * kind of disagreement this archive has already paid for, and there is no setting here that can cause it.
 * `og:image:alt` comes from the media record's own alt text for the same reason.
 *
 * ── THE PREVIEW IS BUILT FROM THE REAL HEAD ──────────────────────────────────────────────────────────
 *
 * The card below is composed by calling `seoHead` — the same function every page's head goes through — with the
 * front page's record and the settings in force, and reading the Open Graph tags back out of its output. It is
 * not a drawing of a card; it is the tags, in the order they are served. Where the archive holds no image, the
 * card says so rather than showing a placeholder photograph.
 */
import { getDb } from '@ozituma/db/client';
import {
  HOME_DESCRIPTION_KEY,
  HOME_TITLE_KEY,
  SITE_NAME_KEY,
  SITE_NAME_MAX,
  TAGLINE_MAX,
  TITLE_MAX,
  loadSeoVerification,
  loadSiteSeoSettings,
  seoHead,
  siteSeoFrom,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { Field } from '../fields';
import { SeoNav } from '../nav';

const CAPABILITY = 'manage_design';
const HERE = '/admin/seo/social/';

export const dynamic = 'force-dynamic';

/**
 * The front page's card, built by the real head builder.
 *
 * `/` is the record shown because it is the one address that needs no invented content to have a card, and
 * because the two fields this screen edits are the front page's. A record's card is checked by opening the
 * record; this screen says which fields the tags are built from rather than fabricating a sample record.
 */
function frontPageCard(
  site: ReturnType<typeof siteSeoFrom>,
  verification: Awaited<ReturnType<typeof loadSeoVerification>>
): { tag: string; value: string }[] {
  const head = seoHead(
    { path: '/', title: site.homeTitle ?? 'Ozikoro', description: null, kind: 'page' },
    [],
    verification,
    site
  );
  const wanted = [
    'og:site_name', 'og:locale', 'og:type', 'og:title', 'og:description', 'og:url',
    'og:image', 'og:image:alt', 'twitter:card',
  ];
  const out: { tag: string; value: string }[] = [];
  for (const name of wanted) {
    const match = new RegExp(`<meta (?:property|name)="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content="([^"]*)">`).exec(head);
    if (match) out.push({ tag: name, value: match[1]! });
  }
  return out;
}

/** One stored value, as the form's `defaultValue`. */
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

export default async function SeoSocialPage({
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
  const site = siteSeoFrom(settings);
  const card = frontPageCard(site, await loadSeoVerification(db));

  return (
    <div className="admin-shell">
      <Head title="Open Graph and Twitter cards" />
      <SeoNav active="social" />
      <Notices saved={one('saved')} error={one('error')} />

      <Card title="What the front page’s shared link says right now">
        <p>
          This is not a drawing of a card. <b>It is the tags, read back out of the archive’s own head builder</b>{' '}
          — <code>seoHead</code>, the one function every page’s <code>&lt;head&gt;</code> goes through — with the
          settings in force at this moment. Every other page of the archive gets the same treatment from its own
          record: the title line, the description, the canonical address, the type and the image are all facts
          about the page rather than fields invented here.
        </p>
        <pre className="small" style={{ padding: '.6rem', background: 'var(--paper-sunk, #f2ece0)', overflowX: 'auto' }}>
          <code>{card.map((entry) => `${entry.tag} = ${entry.value}`).join('\n')}</code>
        </pre>
        <p className="small muted">
          <b>There is no image on this card because the front page has none.</b> A record&rsquo;s card image is
          the record&rsquo;s own featured image, and a page with no image gets <code>twitter:card = summary</code>{' '}
          rather than a placeholder photograph the archive does not hold.
        </p>
      </Card>

      <Card title="The two fields the front page’s card is built from">
        <p className="small muted">
          Both are the same settings the <a href="/admin/seo/titles/">Titles &amp; meta</a> section writes — the
          front page has one title and one description, and <b>two screens writing them separately would be two
          answers to one question</b>. They are repeated here because this is where an owner comes to change a
          card, and a screen that sent him elsewhere without saying so would look like it could not do it.
        </p>
        <Field
          settingKey={HOME_TITLE_KEY}
          label="Front page title — what the card’s heading says"
          value={valueOf(settings, HOME_TITLE_KEY)}
          reads="packages/ozikoro/src/seo-head.ts — seoHead(), which writes og:title and the <title> from one resolved line"
          provedBy="/"
          unit={`${TITLE_MAX} characters`}
          stored={settings.get(HOME_TITLE_KEY) ?? null}
        />
        <Field
          settingKey={HOME_DESCRIPTION_KEY}
          label="Front page description — what the card says underneath"
          value={valueOf(settings, HOME_DESCRIPTION_KEY)}
          reads="packages/ozikoro/src/seo-head.ts — seoHead(), which writes og:description and the meta description from one resolved sentence"
          provedBy="/"
          multiline
          rows={3}
          unit={`${TITLE_MAX} characters`}
          stored={settings.get(HOME_DESCRIPTION_KEY) ?? null}
        />
      </Card>

      <Card title="What every kind of page produces">
        <AtAGlance
          rows={[
            ['A record', 'og:type = article · twitter:card = summary_large_image when the record has an image · og:image is the record’s featured image'],
            ['A page — the front page, About, Documents', 'og:type = website · twitter:card = summary unless an image is supplied'],
            ['A topic, a collection, an index', 'og:type = website · og:title is the list’s own title'],
            ['A researcher’s profile', 'og:type = profile · og:title is the byline’s name'],
            ['A town, clan or place', 'og:type = place · the structured data carries the region the archive recorded and no coordinates'],
            ['Every one of them', `og:site_name = ${site.anySet && settings.has(SITE_NAME_KEY) ? site.siteName : `${site.siteName} (the archive’s own constant)`} · og:locale = en · og:url = the page’s own canonical address`],
          ]}
        />
      </Card>

      <Card title="Not built here, and why">
        <p className="small muted">
          <b>A per-record social image field.</b> A record’s card image is its featured image and is chosen where
          the record is edited; a second field pointing at a second image would be a way for a page to show one
          photograph and its shared link another. Also absent: <b>a Facebook or X app-id field</b>, which would
          be a credential this archive does not hold and which nothing here reads — the tags above need no app
          id to render a card.
        </p>
        <AtAGlance
          rows={[
            ['Site name on the card', site.anySet && settings.has(SITE_NAME_KEY) ? site.siteName : site.siteName],
            ['Tagline (used by %%sitedesc%% only)', site.tagline ?? 'nothing stored'],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>

      <Card title="The site name is on every card, and it is set once" quiet>
        <p className="small muted">
          <code>og:site_name</code> is the same value on every page of the archive and it is set on the{' '}
          <a href="/admin/seo/titles/">Titles &amp; meta</a> section, up to {SITE_NAME_MAX} characters, with the
          tagline up to {TAGLINE_MAX}. It is not repeated as a field here, because two forms writing one value is
          how they come to disagree.
        </p>
      </Card>
    </div>
  );
}
