/**
 * /admin/seo/titles — the homepage title and description, the site name, the separator, and the template.
 *
 * ── WHAT HE ASKED FOR, AND WHY THESE FIVE FIELDS ARE THE ANSWER ──────────────────────────────────────
 *
 *   "one should be able to change permalink, homepage title and name, and everything else the yoast plugin has"
 *
 * **The homepage title and the name are two of the three things he named**, and neither existed:
 *
 *   * `/`'s `<title>` was the hand-written `home` entry in the design-screen route's `SCREEN_SEO` table — a
 *     constant in a source file;
 *   * `SITE_NAME` was — and still is — a constant in `seo-head.ts`, read by the Open Graph `og:site_name` tag
 *     and the `WebSite` JSON-LD node.
 *
 * ── WHERE THE HOMEPAGE TITLE IS ACTUALLY READ, WHICH IS NOT WHERE A REACT PAGE'S WOULD BE ────────────
 *
 * `/` is not a React page. The middleware rewrites the root to `/design-screen/home`, a **route handler** that
 * serves the design's own HTML document, and `app/layout.tsx`'s head never applies to it — measured, `GET /`
 * and `GET /design-screen/home` are the same bytes and neither carries a `/_next/` reference. So the field on
 * this screen is read in `app/design-screen/[screen]/route.ts`, at the `seoHead` call, where `record.path` is
 * `'/'` for exactly this screen. **Nothing had to be edited in the inviolable deliverable and nothing had to
 * be moved: the route was already the one place the front page's head is built.**
 *
 * ── WHAT ELSE READS `SITE_NAME`, NAMED BEFORE IT IS REPLACED ────────────────────────────────────────
 *
 * The constant has two readers, both in `seo-head.ts`:
 *
 *   * `og:site_name` — the Open Graph site name, emitted on every page;
 *   * the `name` of the `WebSite` node in the JSON-LD `@graph`, which a search engine uses to label the site
 *     in results and in a sitelinks searchbox.
 *
 * **The constant is not deleted and is not edited.** It stays as the default, and a stored value is passed in
 * as `seoHead`'s fourth parameter and used in both places — so a route that does not pass it (the transcript
 * route and the institutional-access refusal are the two that are not ours to edit this round) serves the
 * archive's own name rather than an empty one. That is stated on this screen and in `seo-head.ts`.
 *
 * ── ESCAPING AND REFUSAL ────────────────────────────────────────────────────────────────────────────
 *
 * Every one of these values reaches a `<title>` element or a `<meta content="">`. They are escaped where they
 * are written (`seo-head.ts`'s `esc`), and they are shape-tested where they are stored: no control characters,
 * no angle brackets, and a ceiling per field past which the value is not that field. The template additionally
 * has its `%%variables%%` checked against an allow-list, because `%%shrubbery%%` rendered literally is a
 * template that looks like it worked. See `templateProblem` and `cleanSettingValue`.
 */
import { getDb } from '@ozituma/db/client';
import {
  DEFAULT_HOME_TITLE,
  DEFAULT_SEPARATOR,
  HOME_DESCRIPTION_KEY,
  HOME_TITLE_KEY,
  SITE_NAME_KEY,
  SITE_NAME_MAX,
  SITE_TAGLINE_KEY,
  TAGLINE_MAX,
  TITLE_MAX,
  TITLE_SEPARATOR_KEY,
  TITLE_TEMPLATE_KEY,
  TITLE_VARIABLES,
  loadSiteSeoSettings,
  renderTitleTemplate,
  siteSeoFrom,
  splitList,
  templateProblem,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { Field } from '../fields';
import { SeoNav } from '../nav';

const CAPABILITY = 'manage_design';
const HERE = '/admin/seo/titles/';

export const dynamic = 'force-dynamic';

/**
 * A page title the template is demonstrated on.
 *
 * **A REAL RECORD FROM THIS ARCHIVE IS NOT USED, and that is deliberate: the owner's own words are not
 * invented into an example.** The title below is the archive's own front-page title, which is a string this
 * repository already serves — so the preview cannot put words in the archive's mouth, and it cannot go stale
 * the way a copy of a record's title would.
 */
const PREVIEW_TITLE = DEFAULT_HOME_TITLE;

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

export default async function SeoTitlesPage({
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

  /*
   * THE PREVIEW IS BUILT BY THE FUNCTION THE SERVED HEAD USES. `renderTitleTemplate` is what `seoHead` calls
   * through `resolveTitle`, so what is printed below is not a description of what the template will do — it is
   * the string, from the same code path, with the same separator and the same site name.
   */
  const template = valueOf(settings, TITLE_TEMPLATE_KEY);
  const preview = renderTitleTemplate(template, {
    title: PREVIEW_TITLE,
    sitename: site.siteName,
    sep: site.separator,
    sitedesc: site.tagline,
    category: 'Town histories',
    date: '2020-01-01',
    reference: 'OZ-H-0000',
  });
  const templateIssue = templateProblem(template);

  return (
    <div className="admin-shell">
      <Head title="Titles, the site name and the tagline" />
      <SeoNav active="titles" />
      <Notices saved={one('saved')} error={one('error')} info={one('info')} />

      <Card title="The front page">
        <p>
          <b>These two fields are the ones you named first.</b> The archive served the front page’s title and
          description from its own source code; nothing could change them without a deploy. They are read when
          the front page is built — <code>app/design-screen/[screen]/route.ts</code>, the route the root is
          rewritten to — and when nothing is stored below, the archive serves exactly what it served before this
          screen existed: <i>{DEFAULT_HOME_TITLE}</i>.
        </p>
        <Field
          settingKey={HOME_TITLE_KEY}
          label="Homepage title"
          hint="What the browser tab and a search result read for the front page. If you leave it empty the archive’s own title is served."
          value={valueOf(settings, HOME_TITLE_KEY)}
          placeholder={DEFAULT_HOME_TITLE}
          reads="packages/ozikoro/src/seo-head.ts — seoHead(), through resolveTitle(); the value is passed in from apps/ozikoro/app/design-screen/[screen]/route.ts"
          provedBy="/"
          unit={`${TITLE_MAX} characters`}
          stored={settings.get(HOME_TITLE_KEY) ?? null}
        />
        <Field
          settingKey={HOME_DESCRIPTION_KEY}
          label="Homepage meta description"
          hint="The sentence a search result shows under the front page’s title. Empty means the archive’s own description is served."
          value={valueOf(settings, HOME_DESCRIPTION_KEY)}
          reads="packages/ozikoro/src/seo-head.ts — seoHead(); read on the front page alone, because record.path is '/' for it"
          provedBy="/"
          multiline
          rows={3}
          unit={`${TITLE_MAX} characters`}
          stored={settings.get(HOME_DESCRIPTION_KEY) ?? null}
        />
      </Card>

      <Card title="The site’s own name and tagline">
        <p>
          <b>The site name is a constant in the archive’s source today</b> — <code>SITE_NAME</code> in{' '}
          <code>packages/ozikoro/src/seo-head.ts</code> — and it is read in exactly two places: the{' '}
          <code>og:site_name</code> tag every page carries, and the <code>name</code> of the{' '}
          <code>WebSite</code> node in the structured data, which is how a search engine labels the site in its
          results. <b>The constant is not deleted.</b> It becomes the default: a value stored here is used in
          both places, and a page that is not given it — two routes are not ours to edit this round — serves the
          constant rather than an empty name.
        </p>
        <Field
          settingKey={SITE_NAME_KEY}
          label="Site name"
          hint="How this site is named to a search engine and in a shared link."
          value={valueOf(settings, SITE_NAME_KEY)}
          placeholder={site.siteName}
          reads="packages/ozikoro/src/seo-head.ts — seoHead(); used for og:site_name and for the WebSite node’s name"
          provedBy="/"
          unit={`${SITE_NAME_MAX} characters`}
          stored={settings.get(SITE_NAME_KEY) ?? null}
        />
        <Field
          settingKey={SITE_TAGLINE_KEY}
          label="Tagline"
          hint="One line describing the archive. It supplies %%sitedesc%% where a template names it, and is otherwise unused."
          value={valueOf(settings, SITE_TAGLINE_KEY)}
          reads="packages/ozikoro/src/site-seo.ts — renderTitleTemplate(), as the value of %%sitedesc%%"
          multiline
          rows={2}
          unit={`${TAGLINE_MAX} characters`}
          stored={settings.get(SITE_TAGLINE_KEY) ?? null}
        />
      </Card>

      <Card title="The template a page’s title is built from">
        <p>
          Every page of the archive writes its own title from the record or the route. A template here changes
          the <b>shape</b> of that line without changing what the page says — <code>%%title%%</code> is the
          page’s own title, and the words around it are yours. <b>Empty means the archive does exactly what it
          has always done</b>: every page serves its own title and nothing is added to it.
        </p>
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', margin: '.5rem 0' }}>
          {TITLE_VARIABLES.map((variable) => (
            <code
              key={variable.name}
              title={`${variable.supplies}${variable.always ? ' — always available' : ' — only on pages that have it'}`}
              style={{ padding: '.1rem .35rem', border: '1px solid var(--rule)', borderRadius: '3px' }}
            >
              %%{variable.name}%%
            </code>
          ))}
        </div>
        <p className="small muted">
          <b>Every variable above is supplied from something this archive actually holds.</b>{' '}
          <code>%%title%%</code>, <code>%%sitename%%</code> and <code>%%sep%%</code> are always available; the
          rest are filled in only where the page has them, and the preview below names any the template asks
          for that this page does not have. <b>There is deliberately no <code>%%focuskw%%</code></b> — Yoast has
          one because WordPress has a keyphrase field, and this archive has none, so a variable here would be a
          variable with nothing behind it.
        </p>
        {templateIssue ? (
          <p className="small" style={{ color: '#8a2c2c' }}>
            <b>A template is stored that this screen would now refuse:</b> {templateIssue} The archive still
            serves it, because nothing removes a value behind its owner’s back — replacing it with a valid one
            will clear this.
          </p>
        ) : null}
        <Field
          settingKey={TITLE_TEMPLATE_KEY}
          label="Title template"
          hint="For example: %%title%% %%sep%% %%sitename%%"
          value={template}
          placeholder="%%title%% %%sep%% %%sitename%%"
          reads="packages/ozikoro/src/site-seo.ts — resolveTitle() → renderTitleTemplate(), called by seoHead() for every page"
          provedBy="/"
          multiline
          rows={2}
          unit={`${TITLE_MAX} characters`}
          stored={settings.get(TITLE_TEMPLATE_KEY) ?? null}
        >
          <p className="small" style={{ margin: '.5rem 0 .2rem' }}>
            <b>What a page’s title would be with this template</b>, built by the same function the served head
            uses, on the archive’s own front-page title as the example:
          </p>
          <pre className="small" style={{ margin: '0 0 .3rem', padding: '.5rem', background: 'var(--paper-sunk, #f2ece0)', overflowX: 'auto' }}>
            <code>{preview.title || '(nothing — an empty template leaves the page’s own title alone)'}</code>
          </pre>
          {preview.missing.length > 0 ? (
            <p className="small muted">
              <b>Note:</b> this template names {preview.missing.map((name) => `%%${name}%%`).join(', ')}, and the
              example page has no value for {preview.missing.length === 1 ? 'it' : 'them'} — so that part is
              empty rather than filled with something invented.
            </p>
          ) : null}
        </Field>
        <Field
          settingKey={TITLE_SEPARATOR_KEY}
          label="Title separator"
          hint="The character between the title and the site name, wherever a template names %%sep%%."
          value={valueOf(settings, TITLE_SEPARATOR_KEY)}
          placeholder={DEFAULT_SEPARATOR}
          reads="packages/ozikoro/src/site-seo.ts — renderTitleTemplate(), as the value of %%sep%%"
          multiline={false}
          stored={settings.get(TITLE_SEPARATOR_KEY) ?? null}
        />
        <p className="small muted">
          The separator is stored as you type it. When nothing is stored, <code>%%sep%%</code> renders as{' '}
          <code>{DEFAULT_SEPARATOR}</code> — which is what the archive’s own hand-written titles already use.
        </p>
      </Card>

      <Card title="What a record’s own title and description are, and where to change them">
        <p>
          <b>This screen is the site-wide default, not a per-record edit.</b> Every record writes its own title
          and description from the record itself, and one editor can overrule that for one record on{' '}
          <a href="/admin/seo-records/">Record search results</a>. The template above applies to the line the
          record’s title becomes; it does not touch the record’s words on the page.
        </p>
        <AtAGlance
          rows={[
            ['Site name in force', site.anySet && settings.has(SITE_NAME_KEY) ? site.siteName : `${site.siteName} (the archive’s own constant)`],
            ['Homepage title in force', site.homeTitle ?? `${DEFAULT_HOME_TITLE} (the archive’s own)`],
            ['Title template in force', site.titleTemplate ?? 'none — each page serves its own title'],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
        <p className="small muted">
          <b>One route does not yet pass the site name, and it is named rather than hidden:</b>{' '}
          <code>app/podcast/[slug]/transcript/route.ts</code>, which serves an episode’s transcript. It calls{' '}
          <code>seoHead</code> with its own title and description and its verification tokens, but not with the
          settings on this screen — so <b>that one page still says the archive’s own constant</b> while every
          other page says what you stored, and its title does not wear the template. The file is deliberately
          not edited in this round; extending it is one line at its head-builder call, and no other route needs
          one — the institutional-access refusal, which is a 403 held by agreement, now carries the settings too.
        </p>
      </Card>
    </div>
  );
}
