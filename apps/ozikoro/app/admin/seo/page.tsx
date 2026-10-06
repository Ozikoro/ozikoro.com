/**
 * `/admin/seo/` — the search-engine area's index: six sections, and the honest list of what is not here.
 *
 * ── WHY THE TOKEN FORM MOVED OFF THIS PAGE ───────────────────────────────────────────────────────────
 *
 * The owner's report has two halves. The first is that not everything Yoast shows was here; **the second is
 * *"everything must not show on same page"*.** This page was two cards and 336 lines — the per-engine token
 * rows and a paragraph of gaps — so a reader could not find the permalink, the homepage title or the site name
 * because they did not exist, and could not see the sitemap or the redirects because they were named in prose
 * at the bottom of a paste form.
 *
 * The tokens are now at `/admin/seo/verification/`, **unchanged** — same form, same endpoint, same gate, same
 * audit trail. What is here is the index: where each section is, and what it does or does not do.
 *
 * ── THE GAP LIST IS STILL HERE, AND IT IS STILL TRUE ─────────────────────────────────────────────────
 *
 * The old page's own list said, in its own words, *"Not built here, and named so nobody assumes it is"* — eight
 * items. **It is printed below, item by item, with what is now true of each**, because a screen that claimed
 * completeness while omitting half is the fault this whole round exists to prevent. Five of the eight are now
 * built and say where; three are not, and say why they are not rather than being quietly dropped.
 *
 * ── THE CAPABILITY ──────────────────────────────────────────────────────────────────────────────────
 *
 * `manage_design`, asked at every section screen as well as here. A screen that only lists where things are
 * would be harmless without it — **but the counts on it are read from the database and one of them counts
 * stored redirects**, so it is gated like its sections rather than leaking a count through an index.
 */
import { getDb } from '@ozituma/db/client';
import {
  loadRedirects,
  loadSeoVerification,
  loadSiteSeoSettings,
  siteSeoFrom,
  verificationTags,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';
import { SEO_SECTIONS, seoSectionHref } from './sections';

/* THE CAPABILITY THIS SCREEN IS GATED ON, as a literal so `check:capabilities` can read it out of this file. */
const CAPABILITY = 'manage_design';

export const dynamic = 'force-dynamic';

/**
 * THE EIGHT THINGS THE OLD SCREEN SAID IT DID NOT HAVE, EACH WITH WHAT IS TRUE OF IT NOW.
 *
 * **THIS IS THE LIST, UPDATED RATHER THAN DELETED.** The old text is quoted so a reader who saw the previous
 * version can find what they were reading; `where` says where the thing now lives, or `null` when it is still
 * not built — and `why` is then the reason rather than a promise.
 */
const FORMER_GAPS: { item: string; where: string | null; why: string }[] = [
  {
    item: 'the per-record SEO title and meta description editor',
    where: '/admin/seo-records/',
    why: 'Built, on its own screen, reached from here and from the back office. The record’s own title and standfirst are the default; an override replaces them in the head and not in the visible heading.',
  },
  {
    item: 'the social-preview editor for Open Graph and Twitter cards',
    where: '/admin/seo/social/',
    why: 'Built to the scale the archive can honestly offer: the front page’s own card and a preview of what each kind of page produces. A per-record card IMAGE is the record’s featured image, chosen where the record is edited.',
  },
  {
    item: 'the redirect manager (redirects live in code and in the middleware)',
    where: '/admin/seo/tools/',
    why: 'Built, in the database. The middleware still cannot read it — it runs in the edge runtime and PGlite needs `node:fs` — so the table is read in the routes that serve a page, which the Tools section states in the same words.',
  },
  {
    item: 'the `robots.txt` and `sitemap.xml` editors (both are generated)',
    where: '/admin/seo/tools/',
    why: 'Built, and deliberately bounded: the archive’s own six robots disallows cannot be removed from a screen, and the sitemap’s sections can be listed or withheld but never invented.',
  },
  {
    item: 'schema/structured-data controls (JSON-LD is generated per record kind)',
    where: '/admin/seo/schema/',
    why: 'The one control worth having is built — the publisher named in the `Organization` node — and the screen names what every kind of page declares itself to be. Re-typing a node is not offered, because an `Article` an owner could call a `Recipe` is a page lying to a machine.',
  },
  {
    item: 'the keyword and readability analysis',
    where: null,
    why: 'Not built, and it cannot be built honestly here: this archive has no keyphrase field, and a readability score is a measurement of a text in a language whose rules the archive has not encoded — the interface is English but every record is titled in a language this tooling would mis-score.',
  },
  {
    item: 'the internal-link suggestions',
    where: null,
    why: 'Not built. It would need the body text of all 1,057 records analysed per request, and the archive’s related-reading block already fills the slot it would fill — from the record’s own topic, which is a fact rather than a suggestion.',
  },
  {
    item: 'the content-type defaults',
    where: '/admin/seo/titles/',
    why: 'The title template and its variables are the one default that was missing and is now here. There is no post-type archive to configure: this archive serves records, pages and registers, not WordPress post types, and a screen offering a default per type would be a screen offering settings for a taxonomy that does not exist.',
  },
];

export default async function SeoIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { account } = await requireCapabilityOrRedirect(CAPABILITY, '/admin/seo/');
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const db = await getDb();
  const settings = await loadSiteSeoSettings(db);
  const site = siteSeoFrom(settings);
  const verification = await loadSeoVerification(db);
  const tags = verificationTags(verification);
  const redirects = await loadRedirects(db);
  const movedRecords = new Set(
    Object.values(redirects)
      .filter((entry) => entry.kind === 'permalink-change' && entry.articleId)
      .map((entry) => entry.articleId)
  ).size;

  return (
    <div className="admin-shell">
      <Head title="Search engines">
        <a className="btn btn-quiet" href="/" target="_blank" rel="noreferrer">
          Open the home page in a new tab
        </a>
      </Head>

      <Notices saved={one('saved')} error={one('error')} />

      <Card title="Where each part of the archive’s search presence is">
        <p>
          The things a search engine reads about this archive are in six places rather than on one page, so a
          setting you are looking for is a section you can name. <b>Nothing here is a preview of something
          else</b> — each section writes the value the served page reads, and where a setting cannot reach a
          page, the section says so in its own words.
        </p>
        <dl className="pairs">
          {SEO_SECTIONS.map((section) => (
            <div key={section.slug}>
              <dt>
                <a href={seoSectionHref(section.slug)}>{section.title}</a>
              </dt>
              <dd>
                {section.summary}{' '}
                {section.built ? (
                  <span className="small muted">Built.</span>
                ) : (
                  <span className="small muted">Not built here — see below.</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="What is in force right now">
        <AtAGlance
          rows={[
            ['Site name a crawler is told', site.anySet && site.siteName ? site.siteName : `${site.siteName} — the archive’s own default, nothing stored`],
            ['Homepage title', site.homeTitle ?? 'the archive’s own, nothing stored'],
            ['Title template', site.titleTemplate ?? 'none — every page serves its own title, as it always has'],
            ['Title separator', site.separator],
            ['Verification tags served', tags.length === 0 ? 'none — no engine has a token stored, and no empty tag is written' : `${tags.length}`],
            ['Redirects stored', Object.keys(redirects).length === 0 ? 'none — every address serves its own page' : `${Object.keys(redirects).length}, of which ${movedRecords} ${movedRecords === 1 ? 'is a record that was moved' : 'are records that were moved'}`],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>

      <Card title="The list this screen used to carry, and what is true of each item now">
        <p className="small muted">
          This page said, in its own words: <i>“Not built here, and named so nobody assumes it is.”</i> The
          list is kept rather than deleted, <b>because the fault it exists to prevent is a screen claiming
          completeness while omitting half</b> — and the half that is now built is named with the address that
          built it, so the claim can be checked by opening it.
        </p>
        <dl className="pairs">
          {FORMER_GAPS.map((gap) => (
            <div key={gap.item}>
              <dt>
                {gap.where ? <a href={gap.where}>{gap.item}</a> : gap.item}{' '}
                <span className="small muted">{gap.where ? 'built' : 'still not built'}</span>
              </dt>
              <dd className="small">{gap.why}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Changing any of this is an administrative act, and it is recorded" quiet>
        <p className="small muted">
          Every save and every clear in the six sections writes a row to the audit trail: who did it, when,
          which setting, and what it said before. <b>One value is deliberately kept out of that trail</b> — a
          site-verification token, which is a credential anybody holding <code>view audit</code> could use to
          claim to be this site. It stays on its own screen, behind the same permission that let you set it.
        </p>
      </Card>
    </div>
  );
}
