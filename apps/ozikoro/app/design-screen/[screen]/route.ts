/**
 * A design screen, served with the archive's real records in it.
 *
 * WHY A ROUTE RATHER THAN THE STATIC FILE
 *
 * The deliverable at `public/design/screens/` is the visual contract and **is never edited.** To show real
 * records inside it, the file is read as a TEMPLATE and its example regions are replaced at request time. This
 * route is that step.
 *
 * The middleware rewrites a reader's address (`/archive-index`) to this route, so the browser's URL, and
 * therefore the base the design's relative links resolve against, is unchanged. **The page a reader gets is the
 * design's own HTML with the archive's titles, summaries and places in it.**
 *
 * A SCREEN WITH NO FILL IS SERVED EXACTLY AS IT IS
 *
 * Only the screens listed in `FILLED` are transformed. Everything else — and every failure inside a fill — is
 * returned byte-for-byte from the file, so **a fault here degrades to the design rather than to a broken
 * page.**
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  imageNode,
  mediaPath,
  mediaUrlResolver,
  placeNode,
  rewriteBodyImages,
  seoHead,
  withSeoHead,
  fillMasthead,
  fillAbout,
  fillDashboardLinks,
  designScriptPaths,
  designScreenLinks,
  can,
  decodeDesignPreview,
  designInventory,
  withStoredDesignOverrides,
  DASHBOARD_MODE_COOKIE,
  DASHBOARD_MODE_MAX_AGE_SECONDS,
  dashboardModeForScreen,
  decideDashboardMode,
  decideRequestedMode,
  escapeHtml,
  fillModeSwitcher,
  DESIGN_THEME_HREF,
  LINKED_SCREENS,
  PLACE_NAMES_SQL,
  playableEpisodeAudioSql,
  mediaName,
  type DesignOverride,
} from '@ozikoro/platform';
import { sessionCookieOptions } from '@ozituma/db/accounts';
import { getCurrentAccount } from '@/lib/session';
import { switcherFor, workspaceViewer } from '@/lib/workspace-modes';
import {
  citationFor,
  fillAcademy, fillApproach, fillArchiveIndex, fillCareers, fillCite, fillCollections, fillCulturalCalendar,
  fillCulturalEvent, fillDashboard, fillDocuments, fillDonate, fillFolklore, fillFolkloreReader, fillHome,
  fillIgboCalendar, fillJourneys, fillLedger, fillListen, fillMarquee, fillMaterialCulture, fillPhotographs,
  fillProjectRecord, fillProjectsIndex, fillPublicationRecord, fillPublications, fillResearcherProfile,
  fillTopics, fillTowns, fillTown, fillWatch, fillWatchVideo,
  extractArchiveFilms,
  COLLECTION_CAMERA_SIGN,
  MARQUEE_PLACES,
  MARKET_DAY_ANCHOR,
  narratorPhrase,
  type DashboardWho, type RealAzEntry, type RealCollection, type RealDocument, type RealEntry, type RealFilm,
  type RealPhotograph, type RealStory, type RealTown, type RealTrack,
} from '@ozikoro/platform';
import { nowpaymentsConfigured } from '@/lib/nowpayments';

export const dynamic = 'force-dynamic';

const SCREEN_DIR = join(process.cwd(), 'public', 'design', 'screens');

/**
 * Does this screen carry an image on another origin at all?
 *
 * A CHEAP GATE IN FRONT OF A DATABASE QUERY, NOT A SECOND MATCHER.
 *
 * 52 screens are served through this route and most carry no absolute image once their fills have run. The
 * map that resolves them is a query over every media row, so it is built only for a screen that has a URL
 * for it to match — the same reasoning as the shelf count that is skipped for the screens that do not print
 * it. **A pattern that over-matches costs one query and changes no output; a pattern that under-matches would
 * put this fault straight back**, so it is written to catch `src` and `srcset` on both `img` and `source`.
 */
const CARRIES_ABSOLUTE_IMAGE = /<(?:img|source)\b[^>]*\b(?:src|srcset)="https?:\/\//i;

/** What each screen should be called, and described as, in a search result. */
const SCREEN_SEO: Record<string, { title: string; description: string; kind?: 'article' | 'page' | 'place' | 'list' | 'profile' }> = {
  home: { title: 'Ozikoro — Igbo and African history, archives and scholarship', description: 'Town and clan histories, archive photographs and documents, and the work of African researchers. Published by Ozi Ikoro Limited.', kind: 'page' },
  'archive-index': { title: 'Histories — the Ozikoro archive', description: 'Every history in the archive, filed by ethnic group, clan, place, period and source type. Cite any record by its permanent address.', kind: 'list' },
  topics: { title: 'Topics A–Z — Ozikoro', description: 'A flat index across the archive: categories, places and media, from Anthropology to Video.', kind: 'list' },
  towns: { title: 'Towns and clans — Ozikoro', description: 'The towns, clans and communities the archive holds records for, with their region and their connected histories.', kind: 'list' },
  photographs: { title: 'Photographs — Ozikoro', description: 'Historic photographs held in the archive, each shown with its source and its reuse terms.', kind: 'list' },
  documents: { title: 'Documents — Ozikoro', description: 'Downloadable documents held in the archive, with their provenance and rights recorded.', kind: 'list' },
  watch: { title: 'Watch — Ozikoro', description: 'Films and recordings from the archive, each credited to the article and publisher it came from.', kind: 'list' },
  listen: { title: 'Listen — Ozikoro', description: 'The listening library. Records are read aloud from their written form; no recording is claimed that does not exist.', kind: 'list' },
  folklore: { title: 'Folklores — Ozikoro', description: 'Stories, customs and memories kept as a library of oral tradition, given the same standing as written sources.', kind: 'list' },
  collections: { title: 'Collections — Ozikoro', description: 'Photographs, documents, recordings and material culture, with the size of each collection stated as it is.', kind: 'list' },
  about: { title: 'About Ozi Ikoro Limited', description: 'Who keeps the archive, how material is held, and who may read it.', kind: 'page' },
  cite: { title: 'How to cite Ozikoro', description: 'Ready-made citation formats by record type, with a permanent address for every history.', kind: 'page' },
  careers: { title: 'Careers — Ozikoro', description: 'Roles at Ozi Ikoro Limited and how the application journey works.', kind: 'page' },
  donate: { title: 'Donate — Ozikoro', description: 'Support the preservation of African histories and public access to them.', kind: 'page' },
  sponsors: { title: 'Sponsor a programme — Ozikoro', description: 'Partnership with institutions, sponsors and media.', kind: 'page' },
  investors: { title: 'Investors — Ozikoro', description: 'The infrastructure behind the archive and what investment supports.', kind: 'page' },
  academy: { title: 'Academy — Ozikoro', description: 'Learning the languages the archive is written in, with Ozituma Learn.', kind: 'page' },
  ledger: { title: 'Public ledger — Ozikoro', description: 'Donors, contributors, researchers, translators and volunteers, and where funds go.', kind: 'page' },
  projects: { title: 'Projects — Ozikoro', description: 'Programmes the archive has embarked on.', kind: 'list' },
  publications: { title: 'Publications — Ozikoro', description: 'Research papers, essays and reports, each stating whether it completed peer review.', kind: 'list' },
  igbo_calendar: { title: 'Igbo calendar — Ozikoro', description: 'The four-day market cycle, date lookup and month view.', kind: 'page' },
  'igbo-calendar': { title: 'Igbo calendar — Ozikoro', description: 'The four-day market cycle, date lookup and month view, with the anchor stated as a demonstration.', kind: 'page' },
  'cultural-calendar': { title: 'African cultural calendar — Ozikoro', description: 'Events by date, with organiser, place and verification status recorded per event.', kind: 'list' },
  journeys: { title: 'Journeys & Places — Ozikoro', description: 'Discovery by place and time across the archive.', kind: 'list' },
  'material-culture': { title: 'Material culture — Ozikoro', description: 'Objects, makers and communities held in the archive.', kind: 'list' },
  'oral-recordings': { title: 'Oral recordings — Ozikoro', description: 'Voices, consent and transcripts, given equal standing with written sources.', kind: 'list' },
  researchers: { title: 'Researchers — Ozikoro', description: 'The people who contribute to the archive, with no institution required.', kind: 'list' },
  'type-test': { title: 'Typography — Ozikoro', description: 'The type test: dotted vowels, tone marks, and the marked dotted vowels that usually break.', kind: 'page' },
  notfound: { title: 'This address does not resolve to an entry — Ozikoro', description: 'Either the entry has not been written yet, or the address has changed.', kind: 'page' },
};

/** Screens this route fills. Anything else is served untouched. */
const DASHBOARDS = [
  'dashboard-reader', 'dashboard-student', 'dashboard-teacher', 'dashboard-researcher',
  'dashboard-independent-researcher', 'dashboard-knowledge-holder', 'dashboard-editor',
  'dashboard-reviewer', 'dashboard-admin', 'dashboard-account', 'dashboard-moderation',
  'dashboard-review', 'dashboard-states', 'dashboard-workflow',
];

/** The screen name to the role it speaks for, and the label the design prints. */
const DASHBOARD_ROLE: Record<string, { role: string; label: string }> = {
  'dashboard-reader': { role: 'reader', label: 'Reader' },
  'dashboard-student': { role: 'student', label: 'Student' },
  'dashboard-teacher': { role: 'teacher', label: 'Teacher' },
  'dashboard-researcher': { role: 'researcher', label: 'Researcher' },
  'dashboard-independent-researcher': { role: 'independent_researcher', label: 'Independent researcher' },
  'dashboard-knowledge-holder': { role: 'community_knowledge_holder', label: 'Community knowledge holder' },
  'dashboard-editor': { role: 'editor', label: 'Editor' },
  'dashboard-reviewer': { role: 'expert_reviewer', label: 'Expert reviewer' },
  'dashboard-admin': { role: 'admin', label: 'Administrator' },
  'dashboard-account': { role: 'reader', label: 'Account & profile' },
  'dashboard-moderation': { role: 'moderator', label: 'Moderation queue' },
  'dashboard-review': { role: 'expert_reviewer', label: 'Evidence review' },
  'dashboard-states': { role: 'reader', label: 'Every state has a next step' },
  'dashboard-workflow': { role: 'editor', label: 'Publishing workflow' },
};

/**
 * THE DASHBOARDS' OWN TITLES AND DESCRIPTIONS.
 *
 * WHY THEY ARE NOT LEFT TO THE GENERIC FALLBACK
 *
 * Without these the fallback makes a title by replacing the dashes in the screen's filename, so a reader's
 * saved workspace announced itself in the browser tab as **`dashboard reader — Ozikoro`** — the design's own
 * filename, lower-cased, shown to a reader as though it named the page. The role's name is the right title
 * and it is already in `DASHBOARD_ROLE`; this table is where the two are written down together.
 *
 * `kind: 'page'` because these are places rather than lists of records, notwithstanding `DASHBOARD_ROLE.label`
 * calling two of them a queue.
 */
const DASHBOARD_SEO: Record<string, { title: string; description: string; kind?: 'page' }> = {
  'dashboard-reader': { title: 'Reader workspace — Ozikoro', description: 'Your saved histories, followed topics and reading, and what the archive holds for you.', kind: 'page' },
  'dashboard-student': { title: 'Student workspace — Ozikoro', description: 'Projects, publications, notes and submissions for a student of the archive.', kind: 'page' },
  'dashboard-teacher': { title: 'Teacher workspace — Ozikoro', description: 'Resources, courses and classes for teaching with the archive.', kind: 'page' },
  'dashboard-researcher': { title: 'Research workspace — Ozikoro', description: 'Publications, projects, datasets and fieldwork for a researcher of African history.', kind: 'page' },
  'dashboard-independent-researcher': { title: 'Independent research workspace — Ozikoro', description: 'Publications, projects, fieldwork and sources for a researcher working without an institution.', kind: 'page' },
  'dashboard-knowledge-holder': { title: 'Community archive workspace — Ozikoro', description: 'Oral traditions, media and submissions from a community knowledge holder.', kind: 'page' },
  'dashboard-editor': { title: 'Editorial desk — Ozikoro', description: 'The content queue, entity linking, verification and revisions for an editor of the archive.', kind: 'page' },
  'dashboard-reviewer': { title: 'Review workspace — Ozikoro', description: 'Assigned work, evidence review and decisions for an expert reviewer.', kind: 'page' },
  'dashboard-admin': { title: 'Administration workspace — Ozikoro', description: 'The archive’s queues, media rights and connections, and what is still to be built.', kind: 'page' },
  'dashboard-account': { title: 'Account & profile — Ozikoro', description: 'Your record: identity, privacy, languages and security.', kind: 'page' },
  'dashboard-moderation': { title: 'Moderation states — Ozikoro', description: 'How corrections, rights concerns and community requests are handled in the archive.', kind: 'page' },
  'dashboard-review': { title: 'Evidence review — Ozikoro', description: 'How a claim, its evidence and an alternative interpretation are weighed.', kind: 'page' },
  'dashboard-states': { title: 'Workspace states — Ozikoro', description: 'How the archive presents an error, a permission limit and a success.', kind: 'page' },
  'dashboard-workflow': { title: 'Publishing workflow — Ozikoro', description: 'How a work moves from draft to a durable public record.', kind: 'page' },
};

/**
 * THE SCREENS THAT ARE FILLED WITH THE ARCHIVE'S OWN CONTENT.
 *
 * **A SCREEN ABSENT FROM THIS SET IS SERVED EXACTLY AS THE DESIGN HAS IT** — and the design's text is a
 * walkthrough's, so a screen left out of this list shows a reader example people and example numbers while
 * looking entirely deliberate.
 *
 * `about` was missing from it, so `fillAbout` was written, wired, typechecked, **and never called.** The page
 * rendered the design's four invented people and nothing said so.
 */
const FILLED = new Set([
  'archive-index', 'watch', 'home', 'photographs', 'folklore', 'listen', 'topics', 'towns', 'collections',
  'documents', 'about',
  /*
   * THE SCREENS THAT HOLD NO RECORD YET.
   *
   * **A screen absent from this set is served exactly as the design has it**, and the design's text is a
   * walkthrough's — so a screen left out shows a reader example donors, example projects, an invented
   * researcher and example courses while looking entirely deliberate. This list is the difference between a
   * page that says "0" and a page that says "Example Supporter A".
   *
   * Each one is filled with the archive's own counts where it has them and an honest empty state where it has
   * none. `donate`, `investors`, `sponsors` and `careers` take the money case in particular: **no amount, no
   * target, no sponsor, no salary and no vacancy is invented, and the page says which mechanism is absent.**
   */
  'academy', 'donate', 'investors', 'sponsors', 'careers', 'cite', 'ledger', 'projects', 'project',
  'publications', 'publication', 'researcher-profile', 'journeys', 'material-culture',
  'cultural-calendar', 'cultural-event', 'igbo-calendar', 'market-days', 'watch-video', 'folklore-reader',
  'town',
  ...DASHBOARDS,
]);

async function realEntries(topicSlug: string | null, limit = 24): Promise<RealEntry[]> {
  const db = await getDb();
  /*
   * THE PLACE IS THE CARD'S PLACE, FROM THE CARD'S OWN SQL.
   *
   * This query used to have its own copy: `string_agg(e.name, ', ' order by e.name)` over every
   * linked entity, with no `kind` and no `distinct`. It had already drifted from the card in two
   * ways — it chipped a record linked to a person or a people as a place, and it printed a name
   * twice when two entity rows reached the same place. `PLACE_NAMES_SQL` is the card's own
   * expression, so the design screen and `/archive/` cannot disagree about what a record's place is.
   */
  const rows = await db.rows<{
    slug: string; title: string; standfirst: string | null;
    place: string | null; period: string | null; source: string | null; attached: number;
  }>(
    `select a.slug, a.title, a.standfirst,
            ${PLACE_NAMES_SQL} as place,
            a.period_label as period,
            a.source_type  as source,
            (select count(*)::int from ozikoro_article_source s where s.article_id = a.id) as attached
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
      where a.status = 'published' and a.is_page = false
        and ($1::text is null or t.slug = $1)
      order by a.published_at desc nulls last, a.id desc
      limit $2`,
    [topicSlug, limit]
  );
  return rows.map((r) => ({
    title: r.title,
    href: `/${r.slug}/`,
    summary: r.standfirst,
    place: r.place,
    period: r.period,
    source: r.source,
    attached: Number(r.attached) || 0,
  }));
}

/**
 * Report any placeholder link the transform could not make honest.
 *
 * WHY A REPORT RATHER THAN A SILENT PASS
 *
 * The transform matches the design's markup, so a screen written differently keeps its `href="#"` and then
 * looks exactly like a screen that never had one. **A link that goes nowhere is the fault this work exists to
 * remove, so a leftover is printed rather than passed over.** It is a log line and not a thrown error: the page
 * is still served, because one dead link is better than no page.
 */
function reportLeftoverLinks(html: string, screen: string): void {
  const left = (html.match(/href="#"/g) ?? []).length;
  if (left > 0) console.error(`design-screen: ${screen} still carries ${left} href="#" after the link transform`);
}

/* ==============================================================================================
 * THE OVERRIDE LAYER — THE OWNER'S EDITS, APPLIED ON TOP OF THE DELIVERABLE
 * ============================================================================================
 *
 * `public/design/` is the approved artefact and is byte-compared against the handover copy, so it is read as a
 * template and never written to. The owner's edits live in `ozikoro_design_override` and land here.
 *
 * TWO STEPS, AND THEY RUN AT DIFFERENT POINTS ON PURPOSE.
 *
 *   THEME   the colour and type tokens, delivered as the `/design-theme.css` STYLESHEET that `seoHead` links.
 *           A declaration only beats the design's own by coming later in the cascade, so a stylesheet after
 *           `showcase.css` is what makes a colour change actually visible; it is also the one delivery both
 *           this route and the article route get, so an accent change is not confined to the screens.
 *
 *   ELEMENTS  text, images, links and visibility, applied HERE and AFTER THE FILLS.
 *
 * WHY AFTER THE FILLS IS THE WHOLE POINT
 *
 * Most of the words on these screens are written at serve time: `fillDonate` writes `/donate/`'s notice and
 * deletes its submit button, and `fillResearcherProfile` rewrites the profile's `h1` with the person's name.
 * **An override applied before them is an override the fill then overwrites** — the owner saves a heading,
 * the row is in the database, the log says nothing, and the page is unchanged. That is the failure this
 * ordering exists to prevent, and `design-override.test.ts` asserts it against the real fill.
 */

/** The theme stylesheet's own link, added where nothing else has put one. */
function withThemeLink(html: string): string {
  if (html.includes(DESIGN_THEME_HREF)) return html;
  const link = `<link rel="stylesheet" href="${DESIGN_THEME_HREF}">`;
  return html.includes('</head>') ? html.replace('</head>', `${link}\n</head>`) : `${link}\n${html}`;
}

/**
 * The preview's overrides, if this request carries one AND the reader may edit the design.
 *
 * A pending value is a value the owner is considering, so it is never stored; it is carried in the URL and
 * honoured only for an account holding `manage_design`. Anyone else gets the page as the stored overrides
 * leave it, which is why this returns an empty list rather than a refusal — a shared link shows the site, not
 * a warning.
 */
async function previewOverrides(url: URL, db: Awaited<ReturnType<typeof getDb>>): Promise<DesignOverride[]> {
  const raw = url.searchParams.get('ozpreview');
  if (!raw) return [];
  const pending = decodeDesignPreview(raw);
  if (pending.length === 0) return [];
  const viewer = await getCurrentAccount().catch(() => null);
  if (!viewer) return [];
  return (await can(db, viewer.account.id, 'manage_design')) ? pending : [];
}

/**
 * Load the overrides in force for this screen and hand them to the shared rule.
 *
 * THE APPLICATION RULE IS NOT HERE ANY MORE. Stored first, preview last, and never a 404 when a row cannot be
 * read is `withStoredDesignOverrides` in `@ozikoro/platform`, called by this route and by the article route.
 * It moved because this route applied the overrides and `[slug]/route.ts` did not, so an element edit reached
 * the design screens and silently did nothing on 1,051 articles — the same shape as the `reader.js` fault,
 * which was fixed by moving the shared rule and calling it from both.
 *
 * The account question — may this viewer see the page as the design leaves it — stays here, because accounts
 * are the app's and `@ozikoro/platform` has none.
 */
async function withDesignOverrides(html: string, name: string, url: URL): Promise<string> {
  const db = await getDb();
  /*
   * THE OFF SWITCH, AND WHY THE OWNER'S OWN SAVE PATH NEEDS ONE.
   *
   * A saved edit has to be PROVED, not assumed: the row can be written and the page can still be unchanged,
   * because the selector matched nothing once the fills had run. The only honest test is to render the page
   * with this edit applied and compare it with the same page without — and the page is already carrying the
   * stored edits by the time the save returns, so the comparison needs a way to ask for the page as the
   * design and the fills leave it. `?oznooverride=1` is that way, and it is honoured **only for an account
   * holding `manage_design`**: the public gets the site, not a viewer with the owner's edits removed.
   */
  let asDesign = false;
  if (url.searchParams.has('oznooverride')) {
    const viewer = await getCurrentAccount().catch(() => null);
    asDesign = Boolean(viewer && (await can(db, viewer.account.id, 'manage_design')));
  }
  return withStoredDesignOverrides(db, html, name, {
    preview: await previewOverrides(url, db),
    asDesign,
    label: 'design-screen',
  });
}

/**
 * The inventory of what may be edited on this screen, for `/admin/design/`.
 *
 * IT IS BUILT FROM THE SERVED PAGE AND NOT FROM THE FILE, which is the one decision that makes the editor
 * honest. `/donate/`'s notice does not exist in `donate.html` — `fillDonate` writes it — and the same fill
 * deletes the submit button, so an inventory of the FILE would offer a button that is not on the page and
 * would not offer the notice that is. **One list, of what is actually there.**
 *
 * It is gated on `manage_design` because it describes every place a page can be edited, which is a map of the
 * surface rather than a secret; but the map is not the public's.
 */
async function inventoryResponse(html: string, url: URL): Promise<Response | null> {
  if (url.searchParams.get('ozinventory') === null) return null;
  try {
    const db = await getDb();
    const viewer = await getCurrentAccount().catch(() => null);
    if (!viewer || !(await can(db, viewer.account.id, 'manage_design'))) {
      return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
    }
    return Response.json(designInventory(html), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('design-screen: could not build the design inventory', error);
    return Response.json(
      { error: { code: 'inventory_unavailable', message: 'The inventory could not be built.' } },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}

/**
 * WHICH WORKSPACE THIS ADDRESS IS, AND WHETHER THIS ACCOUNT MAY OPEN IT.
 *
 * This is the whole gate, in four lines of decision and one shared function. `decideDashboardMode` holds the
 * rule — the `?mode=` value is looked up in the fourteen and then tested against the account's capabilities,
 * never passed through — so **the route does not own a second copy of "who may see what"**, and
 * `dashboard-modes.test.ts` asserts the rule without a server.
 *
 * TWO REFUSALS AND ONE REDIRECT, AND NO FOURTH ANSWER.
 *
 *   a workspace the account may not open, by address or by parameter   **403 with a sentence**
 *   a name that is not a workspace at all                              **403 with a sentence**
 *   a workspace it may open, named at another dashboard's address      **302 to the workspace's own address**
 *   anything else                                                      the page, unchanged
 *
 * **A SCREEN WITH NO MODE OF ITS OWN STILL HONOURS THE PARAMETER**, because a person can type one into any
 * address this route serves: `/about?mode=editor` is a shortcut to the editorial desk and
 * `/about?mode=admin` from a reader is refused for exactly the same reason it is refused on
 * `/dashboard-reader`. Serving a workspace the account may not open, or quietly serving a different one, are
 * the two faults this replaces — the design's own switch did the second for eleven days.
 */
function refuseWorkspace(sentence: string, viewer: Awaited<ReturnType<typeof workspaceViewer>>): Response {
  const link = (href: string, label: string) =>
    `<a class="btn btn-quiet btn-sm" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const ways = [
    link(viewer.primaryHref, viewer.signedIn ? 'Your own workspace' : 'The reader’s workspace'),
    viewer.signedIn ? '' : link('/signin', 'Sign in'),
    viewer.adminHref ? link(viewer.adminHref, 'The administration') : '',
    link('/', 'The public archive'),
  ]
    .filter(Boolean)
    .join(' ');

  /*
   * A REAL PAGE, WITH THE DESIGN'S OWN STYLESHEETS, RATHER THAN A BARE `Forbidden`.
   *
   * The brief's rule for this round is that a refused mode must say why — *"that address is not one your
   * account may open"* is honest and a silent serve of the wrong page is not. A response body of the single
   * word "Forbidden" would satisfy the status and tell the reader nothing, which is the fault this project
   * has already paid for four times today.
   */
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>That workspace is not open to this account — Ozikoro</title>' +
    '<link rel="stylesheet" href="/design/styles/main.css">' +
    '<link rel="stylesheet" href="/design/styles/showcase.css">' +
    '<link rel="stylesheet" href="/a11y.css">' +
    '</head><body><a class="skip" href="#main">Skip to content</a>' +
    '<main id="main" class="wrap sx-section" style="padding-block:3rem">' +
    '<p class="eyebrow">Ozikoro workspaces</p>' +
    '<h1>That workspace is not open to this account</h1>' +
    `<p class="lede" style="margin-top:var(--s-3)">${escapeHtml(sentence)}</p>` +
    `<p style="margin-top:var(--s-5);display:flex;gap:var(--s-3);flex-wrap:wrap">${ways}</p>` +
    '</main></body></html>';

  return new Response(html, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

/** A real HTTP redirect, so the parameter needs no JavaScript and the address ends up telling the truth. */
function moveToWorkspace(to: string): Response {
  return new Response(`This workspace is at ${to}`, {
    status: 302,
    headers: { location: to, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * WHERE THE CHOSEN WORKSPACE IS REMEMBERED, SO A LINK INSIDE A DASHBOARD DOES NOT RESET IT.
 *
 * The parameter alone would not do: the sidebar's own links go to `/account/`, `/admin/archive/` and `/`, and
 * a person who chose the editorial desk would be dropped back to the reader's the moment they followed one.
 *
 * `Secure` is taken from `sessionCookieOptions` — the one place in this application that decides whether a
 * cookie may travel without TLS — and the DOMAIN deliberately is not: the session may be shared with a parent
 * domain, and a workspace exists only on ozikoro.com. `HttpOnly` because no script ever reads it, and
 * `SameSite=Lax` because it is a preference rather than a credential. **It is re-validated on every read**,
 * so the cookie can only ever select among workspaces the account may already open.
 */
function rememberModeCookie(mode: string): string {
  const { secure } = sessionCookieOptions(DASHBOARD_MODE_MAX_AGE_SECONDS);
  return [
    `${DASHBOARD_MODE_COOKIE}=${encodeURIComponent(mode)}`,
    'Path=/',
    `Max-Age=${DASHBOARD_MODE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ screen: string }> }
) {
  const { screen } = await params;
  const name = screen.replace(/\.html$/, '');

  /*
   * ============================================================================================
   * THE IMAGES THE DESIGN AND ITS FILLS STILL POINT AT THE OLD WORDPRESS SITE.
   * ============================================================================================
   *
   * THE FAULT THIS FIXES IS NOT A BROKEN URL, AND THAT IS WHY IT SURVIVED EVERY CHECK MADE OF IT.
   *
   * The design screens carry **57 images whose `src` is `https://ozikoro.com/wp-content/uploads/…`**, the
   * live WordPress install. Every one of those URLs returns `200 image/webp` to `curl` and to `urllib`,
   * because the old site still serves them and neither tool enforces a content policy. **The browser does.**
   * The page's own `Content-Security-Policy` says `img-src 'self' data: https://i.ytimg.com`, the reader is on
   * `http://127.0.0.1:3110`, the image is on `https://ozikoro.com` — a different origin — so the browser
   * refuses to load it, the slot renders empty, and nothing about the response looks wrong. Measured in
   * headless Chrome: `naturalWidth === 0` with `complete === true`, which is the silent failure exactly.
   * **A fetch is not a render.**
   *
   * The archive already holds these files — that is what the migration was — and serves them from
   * `/media/…`. `mediaUrlResolver` is the same mapping the article route uses for its own 2,871 body images,
   * so **there is one matching rule in the codebase rather than a second one here.**
   *
   * IT RUNS TWICE, AND WHY THAT IS NOT REDUNDANT.
   *
   *   once on the design's own markup, before the `FILLED` branch — so a screen served untouched (the early
   *   return below) is covered, and so is every screen that is filled, because the design's markup surrounds
   *   the replaced regions;
   *
   *   once on the finished document — because **a fill can insert HTML that carries its own absolute URLs.**
   *   `folklore-reader` fills a reader with a story body, and that body arrived from WordPress with `srcset`
   *   candidates on `ozikoro.com`; measured before the second pass, two images on the page were still empty
   *   with five off-origin `srcset` candidates and four CSP violations. A single pass at the top cannot see
   *   markup that does not exist yet.
   *
   * The two passes cannot double-rewrite: a URL already turned into `/media/…` matches no `source_url`.
   *
   * A URL WITH NO MATCHING ROW IS LEFT EXACTLY AS IT WAS. **The addresses that do not match were never on
   * ozikoro.com — a BBC or a Google image quoted in an article — and substituting anything for those would
   * put a different photograph on a history page, which is worse than an empty box.** The archive's own
   * resolver returns `null` for them and `rewriteBodyImages` leaves them byte-for-byte.
   *
   * IT DEGRADES TO THE DESIGN. This is deliberately its own `try`: the block below catches a failure by
   * returning **404 for the whole screen**, and a database that is briefly unavailable must not turn every
   * design screen into "Not found". An unresolved image is the fault this is fixing; a 404 is a worse one.
   */
  let oldSiteImageResolver: ((url: string) => string | null) | null = null;
  const resolveOldSiteImages = async (document: string): Promise<string> => {
    if (!CARRIES_ABSOLUTE_IMAGE.test(document)) return document;
    try {
      oldSiteImageResolver ??= await mediaUrlResolver(await getDb());
      return rewriteBodyImages(document, oldSiteImageResolver);
    } catch (error) {
      console.error(`design-screen: could not resolve ${name}'s old-site image URLs`, error);
      return document;
    }
  };

  let html: string;
  /*
   * THE MODE COOKIE IS DECIDED INSIDE THE FIRST `try` AND WRITTEN ON THE RESPONSE THAT IS RETURNED FROM THE
   * BOTTOM OF THIS FUNCTION, so it has to outlive that block. It stays null for every screen that is not a
   * dashboard and for every viewer who is not signed in, which is the same condition the switch itself uses.
   */
  let modeCookie: string | null = null;
  try {
    html = await readFile(join(SCREEN_DIR, `${name}.html`), 'utf8');

    /*
     * EVERY SCREEN'S SCRIPTS, NOT ONLY THE DASHBOARDS'.
     *
     * The design's screens load their behaviour with sibling references — `../market-days.js` on the
     * calendar screens, `../reader.js` and `../mobile-nav.js` on the article screens. Served at
     * `/market-days/` those resolve against the served directory and ask for `/market-days.js`, which
     * does not exist; the file is at `/design/market-days.js`. **The result is a page whose HTML is
     * correct, whose status is 200, and whose one dynamic value never arrives** — the calendar sat on
     * the design's own placeholder, "Today — Loading date…", and looked like a page still loading.
     *
     * `fillDashboardLinks` rewrote these, but it runs only for the dashboards and the linked screens,
     * so the fix reached fourteen screens and missed the rest. It belongs here, where every screen
     * passes. The rule is deliberately narrow — a bare sibling filename with no path segment — because
     * that is the whole grammar the deliverable uses for its own scripts.
     *
     * IT LIVES IN `designScriptPaths` NOW, AND NOT HERE, WHICH IS THE POINT. This line was correct and the
     * ARTICLE screen — a different route serving the same deliverable — had no copy of it, so `reader.js`
     * 404'd on all 1,051 records and the share, copy-link, print and read-aloud controls were dead. **The
     * second route is the whole argument for one implementation**, and `design-paths.test.ts` asserts that
     * both routes call it so a third cannot repeat the omission.
     */
    html = designScriptPaths(html);

    /*
     * AND THE DESIGN'S OWN RELATIVE ADDRESSES, FOR EVERY SCREEN RATHER THAN FOR A LIST OF THEM.
     *
     * The menu of every screen is written the design's way — a bare sibling filename — so served at
     * `/<name>/` it resolves to `/<name>/<file>.html` and 404s. **Measured on 4 October 2026: 29 of the
     * 52 screens answered with 316 relative anchors between them**, and `fillDashboardLinks` reached
     * only the fourteen dashboards and the eleven screens in `LINKED_SCREENS`, which is why this sat
     * open on the rest. The rule is screen-independent, so it belongs where every screen passes — the
     * same argument `designScriptPaths` above already makes for its own line.
     *
     * IT IS CALLED AGAIN AFTER THE FILLS, and that second call is the one that matters here: the fills
     * write relative addresses of their own (`/publication/` carried `cite.html`), and a rewrite that
     * runs only before them walks past every one. See the note at the second call.
     */
    html = designScreenLinks(html);

    /*
     * THE MENU SAYS WHO THE READER IS, ON EVERY SCREEN.
     *
     * The design's last item is `My Ozikoro`, pointing at the reader dashboard — **a link that goes to a
     * dashboard whether or not anybody is signed in, and so lands a stranger on a page addressed to somebody
     * they are not.** It becomes `My account` for a signed-in reader and `Sign in / Sign up` for anybody else,
     * and it is moved to sit last, after About, as the owner asked.
     *
     * It runs here rather than inside a fill because the menu is on all 52 screens, and it runs at SERVE time
     * rather than in the design because **both states cannot be stored in one static file — which one is right
     * depends on who is asking.**
     */
    const workspace = await workspaceViewer();
    html = fillMasthead(html, { signedIn: workspace.signedIn });

    /*
     * ============================================================================================
     * WHICH WORKSPACE THIS IS, AND WHETHER THIS ACCOUNT MAY LOOK AT IT.
     * ============================================================================================
     *
     * The owner's report: *"on the dashboards, there should be an option for the admins, and as owner to view
     * any part of the profile… there should have a way for admins to enter other dashboard mode, and to admin
     * mode anytime they want"*. The design HAD a control for it, and a previous round removed it, because
     * served as the live site it showed the owner **his own name under the word Administrator, and under
     * Reader, and under Community knowledge holder** — workspaces labelled with roles he does not hold.
     *
     * WHAT REPLACES IT IS A VIEW, NOT AN IMPERSONATION. Nothing below touches the session, swaps an identity
     * or acts as anybody: the account is still whatever `getCurrentAccount()` says, the page is still filled
     * with that account's own roles and capabilities, and a mode changes only WHICH SCREEN IS DRAWN. See
     * `dashboard-modes.ts` for the allow-list, the reasons and the refusal sentences.
     *
     * ORDER MATTERS HERE, AND IT IS NOT COSMETIC.
     *
     *   1. `fillMasthead` removes the design's own `<details class="sx-role-switch">` and writes the
     *      masthead's account item. It must run first: its removal matches that exact class string, and the
     *      truthful switch carries `sx-role-switch sx-mode-switch` so the two cannot be confused.
     *   2. this gate runs before anything is filled, so a refused address costs a 403 rather than a whole
     *      page render.
     *   3. `fillModeSwitcher` puts the truthful control where the design's one was, re-points the account
     *      item and any `← Back to workspace` link at a workspace this viewer may actually open, and does
     *      nothing at all for an account with no elevated workspace.
     */
    const url = new URL(request.url);
    const screenMode = dashboardModeForScreen(name);
    const requested = url.searchParams.get('mode');

    if (screenMode || requested !== null) {
      const decision = screenMode
        ? decideDashboardMode({
            screenMode,
            requested,
            viewer: { platformRole: workspace.platformRole, capabilities: workspace.capabilities },
            identity: workspace.identity,
          })
        : decideRequestedMode({
            requested: requested as string,
            viewer: { platformRole: workspace.platformRole, capabilities: workspace.capabilities },
            identity: workspace.identity,
          });

      // A REFUSAL SAYS WHY, AND NEVER QUIETLY SERVES A DIFFERENT WORKSPACE.
      if (decision.kind === 'refuse') return refuseWorkspace(decision.sentence, workspace);
      // THE RIGHT WORKSPACE AT THE WRONG ADDRESS MOVES TO ITS OWN, WITH THE PARAMETER INTACT.
      if (decision.kind === 'redirect') return moveToWorkspace(decision.to);
    }

    html = fillModeSwitcher(html, {
      viewer: switcherFor(workspace, screenMode?.mode ?? null),
      primaryHref: workspace.primaryHref,
      allowedScreens: new Set(workspace.modes.map((mode) => mode.screen)),
    });

    // Remembered only for a dashboard that was actually served to a signed-in account — see the note where
    // the response is built, at the bottom of this function.
    if (workspace.signedIn && screenMode) modeCookie = rememberModeCookie(screenMode.mode);

    /*
     * THE DEAD LINKS GO, FILLED OR NOT.
     *
     * This runs for EVERY dashboard and BEFORE the fill, because **the placeholder links belong to the design
     * rather than to the fill.** Left inside the `FILLED` branch it would have skipped `dashboard-states` and
     * `dashboard-workflow` — the two dashboards this route deliberately serves untouched — so they would have
     * kept their dead links while every neighbouring screen lost its own.
     *
     * IT NOW COVERS SIX SCREENS THAT ARE NOT DASHBOARDS.
     *
     * `/publication/`, `/researcher-profile/`, `/academy/`, `/archive-index/`, `/upload/` and `/watch/` are
     * served live and returned 200 with **thirty-six `href="#"` between them** — the same fault on a screen
     * nobody had called a dashboard. The set lives in `LINKED_SCREENS` so this route and the test that reads
     * the real design files cannot disagree about which screens are covered. Running it here, outside the
     * `FILLED` branch, is also what gives `archive-index` and `watch` the `<base href="/">` and the absolute
     * nav links their sibling screens already had — **their own relative `about.html` links used to resolve
     * against `/archive-index/` and 404.**
     */
    if (DASHBOARDS.includes(name) || LINKED_SCREENS.includes(name)) {
      html = fillDashboardLinks(html, name);
      reportLeftoverLinks(html, name);
    }

    // THE FIRST PASS: the design's own markup, before any screen decides whether it is filled. See the note
    // on `resolveOldSiteImages` — a screen served untouched returns from the branch just below.
    html = await resolveOldSiteImages(html);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!FILLED.has(name)) {
    /*
     * A SCREEN WITH NO FILL STILL CARRIES THE OWNER'S EDITS. These screens never reach the generated head, so
     * the theme stylesheet is linked here; the element overrides are applied by the same helper the filled
     * screens use, which is what stops the two halves of the deliverable from behaving differently.
     */
    const url = new URL(request.url);
    const inventory = await inventoryResponse(html, url);
    if (inventory) return inventory;
    html = withThemeLink(html);
    html = await withDesignOverrides(html, name, url);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  /*
   * DECLARED OUTSIDE THE TRY, because the head is written after it — and a fill that throws must still leave a
   * page with its own title rather than falling back to the design's demonstration one.
   */
  let extraNodes: Record<string, unknown>[] = [];

  try {
    try {
      if (name === 'about') {
        /*
         * THE ABOUT PAGE, WITH THE ARCHIVE'S OWN NUMBERS.
         *
         * **Counted here rather than written into the design**, because a figure typed into a static file is true
         * on the day it is typed and quietly wrong afterwards. The uncomfortable counts are included: the records
         * held in review, and **0 recorded licences for 3,488 media items** — the archive's largest open problem,
         * and the one a reader is least likely to guess.
         */
        const db = await getDb();
        const counts = await db.one<{ published: number; review: number; media: number }>(
          `select
             (select count(*) from ozikoro_article where status='published' and is_page=false)::int published,
             (select count(*) from ozikoro_article where status='review')::int review,
             (select count(*) from ozikoro_media)::int media`
        );
        const people = await db.rows<{ slug: string; name: string; records: number; bio: string | null; avatarUrl: string | null }>(
          `select c.slug, c.display_name as name, count(a.id)::int as records, c.bio, c.avatar_url as "avatarUrl"
             from ozikoro_contributor c
             left join ozikoro_article a on a.author_id = c.id and a.status = 'published' and a.is_page = false
            group by c.id, c.slug, c.display_name, c.bio, c.avatar_url
            order by records desc, c.display_name`
        );
        const rights = await db.one<{ sources: number; licences: number }>(
          /*
           * THE COLUMN IS `licence`, NOT `licence_code`.
           *
           * `licence_code` failed with `column "licence_code" does not exist` — and **the catch serves the design
           * unfilled, so a wrong column name looks exactly like a page nobody has written a fill for.** That is
           * how this was found: an expected figure was missing from the output.
           */
          `select (select count(*) from ozikoro_article
                    where status='published' and body_html ~* '<h[1-6][^>]*>[^<]*(references|sources|bibliography)')::int sources,
                  (select count(*) from ozikoro_media_rights where licence is not null and licence <> '')::int licences`
        );
        /*
         * THE SHELF, COUNTED, so "what we publish" carries a number beside each kind.
         *
         * `towns` is the published clan register (188), **not the article count it was passed as before** — that
         * put "1,051 towns and clans" on the page, which is not a fact about anything. `documents` is every
         * media record of kind `document` (12, of which four are PDFs), because the count is of what is held
         * rather than of what is downloadable.
         */
        const shelf = await db.one<{ towns: number; folklores: number; photographs: number; documents: number }>(
          `select (select count(*) from clan where published = true)::int towns,
                  (select count(*) from ozikoro_article a join ozikoro_topic t on t.id = a.topic_id
                    where a.status='published' and a.is_page=false and t.slug='folklores')::int folklores,
                  (select count(*) from ozikoro_article a join ozikoro_topic t on t.id = a.topic_id
                    where a.status='published' and a.is_page=false and t.slug='photos')::int photographs,
                  (select count(*) from ozikoro_media where kind='document')::int documents`
        );
        html = fillAbout(html, {
          published: counts?.published ?? 0,
          inReview: counts?.review ?? 0,
          media: counts?.media ?? 0,
          towns: shelf?.towns ?? 0,
          sources: rights?.sources ?? 0,
          licences: rights?.licences ?? 0,
          folklores: shelf?.folklores ?? 0,
          photographs: shelf?.photographs ?? 0,
          documents: shelf?.documents ?? 0,
          contributors: people,
        });
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for about:`, error);
    }

    try {
      if (name === 'archive-index') {
        const url = new URL(request.url);
        const topic = url.searchParams.get('topic');
        const db = await getDb();
        const [entries, ethnic, topics, total] = await Promise.all([
          realEntries(topic),
          db.rows<{ ethnic_group: string; n: number }>(
            `select coalesce(ethnic_group, 'Unrecorded') ethnic_group, count(*)::int n
               from clan where published = true group by 1 order by n desc, 1 limit 6`
          ),
          db.rows<{ slug: string; name: string; n: number }>(
            `select t.slug, t.name, count(a.id)::int n from ozikoro_topic t
               left join ozikoro_article a on a.topic_id = t.id and a.status = 'published' and a.is_page = false
              group by t.slug, t.name order by n desc`
          ),
          db.one<{ n: number }>(
            `select count(*)::int n from ozikoro_article where status = 'published' and is_page = false`
          ),
        ]);
        html = fillArchiveIndex(html, {
          entries,
          ethnic: ethnic.map((e) => ({ name: e.ethnic_group, count: e.n })),
          topics: topics.map((t) => ({ slug: t.slug, name: t.name, count: t.n })),
          total: total?.n ?? 0,
        });
      }
      /*
       * FURTHER GRAPH NODES, FOR THE PAGES THAT DESCRIBE MORE THAN THEMSELVES.
       *
       * `/towns` is a list of 188 places and `/photographs` is a collection of images with a rights state on
       * each. **Those are facts about the page's subject rather than about the page**, so they go into the same
       * graph rather than into a second head.
       */
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for archive-index:`, error);
    }
    try {
      if (name === 'documents') {
        /*
         * ONLY THE FILES. Eight of the twelve records the migration called `document` are `text/html` — saved
         * web pages — and **a capture is not a document a reader can download.** Listing them would repeat the
         * fault this archive already recorded once: presenting web captures as documents.
         */
        const db = await getDb();
        const rows = await db.rows<{
          id: number; slug: string; title: string | null; caption: string | null; description: string | null;
          alt_text: string | null; storage_key: string; filesize_bytes: number | null;
        }>(
          `select id, slug, title, caption, description, alt_text, storage_key, filesize_bytes
             from ozikoro_media
            where kind = 'document' and mime_type = 'application/pdf' and storage_key is not null
            order by id`
        );
        const docs: RealDocument[] = rows.map((r) => ({
          /*
           * THE CARD IS NAMED THE WAY THE RECORD PAGE IS HEADED — one rule, in one place. The card used to
           * print `title`, which for these records is the uploaded file's own name: `/documents/` offered
           * "capacity_building_for_traditional" and "SAMTDO-7v1" as if they were titles. `mediaName` reads
           * the record's own caption and description first. See `packages/ozikoro/src/media.ts`.
           */
          title: mediaName({
            kind: 'document',
            slug: r.slug,
            storedTitle: r.title,
            caption: r.caption,
            description: r.description,
            altText: r.alt_text,
          }).name,
          /*
           * THE RECORD, FIRST. This grid used to offer a download and nothing else, so the page that
           * carries the provenance, the rights and the citation was unreachable from the library — the
           * same fault as the photograph gallery's "Open record" link that returned to the gallery.
           */
          recordHref: `/documents/${r.slug}/`,
          // THE KEY CAN CONTAIN SPACES. `storage_key` is derived from the WordPress filename, and a filename
          // like `11237-Igbo Folk Idioms in Caribbean Phrase.pdf` is stored verbatim. **An unencoded space
          // truncates the URL at the space**, so the link 404s on exactly the files whose names are most
          // descriptive. Each segment is encoded, and `/` between them is preserved.
          href: `/media/${r.storage_key.split('/').map(encodeURIComponent).join('/')}`,
          label: 'Held by the archive · PDF',
          note: 'Downloadable file held in the archive. Rights and reuse terms are recorded with the record.',
          size: r.filesize_bytes ? `${Math.max(1, Math.round(r.filesize_bytes / 1024))} KB` : null,
        }));
        if (docs.length > 0) html = fillDocuments(html, docs);
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for documents:`, error);
    }

    try {
      if (DASHBOARDS.includes(name)) {
        /*
         * A ROLE DASHBOARD, FILLED WITH WHAT THE ACCOUNT ACTUALLY HOLDS.
         *
         * **The design's metrics are examples — "Saved histories 12" — and a member who joined a minute ago has
         * none of them.** So every count is real, the work panel becomes an honest empty state, and the
         * capabilities shown are the ones the account's roles genuinely grant.
         *
         * **A visitor who is not signed in gets the page too**, told plainly that the workspace is theirs to
         * claim. That is the owner's point about "My Ozikoro": **it must not open on a sign-in form, because a
         * sign-in form is no use to somebody who has not joined.**
         */
        const current = await getCurrentAccount();
        const db = await getDb();
        let who: DashboardWho = {
          signedIn: false,
          name: null,
          roleLabel: DASHBOARD_ROLE[name]?.label ?? 'Reader',
          roles: [],
          capabilities: [],
          today: new Date().toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
          }),
        };
        if (current) {
          const account = current.account;
          const roles = await db.rows<{ role: string }>(
            `select role from ozikoro_member_role where account_id = $1 order by role`, [account.id]
          );
          const caps = await db.rows<{ capability: string }>(
            // A set-returning function's column is named after the FUNCTION, not after what it returns.
            // `select capability from ozikoro_capabilities($1)` failed with `column "capability" does not exist`
            // on every dashboard render — and the catch swallowed it, **so the page quietly fell back to the
            // design's example content and looked like it had never been filled at all.**
            `select ozikoro_capabilities as capability from ozikoro_capabilities($1) order by 1`, [account.id]
          );
          who = {
            ...who,
            signedIn: true,
            name: account.displayName ?? null,
            roles: roles.map((r) => r.role),
            capabilities: caps.map((c) => c.capability),
          };
        }
        html = fillDashboard(html, who);
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for dashboard:`, error);
    }

    try {
      if (name === 'towns') {
        /*
         * THE 188 PUBLISHED TOWNS AND CLANS.
         *
         * A town with no linked record says so in place of a count — **`No records yet` rather than `0 records`
         * or, worse, a number that flatters the page.** A photograph is used only where the record has one from
         * a linked article; the rest are drawn without an image rather than given a stand-in.
         */
        const db = await getDb();
        const rows = await db.rows<{ slug: string; name: string; region: string | null; n: number; img: string | null }>(
          `select c.slug, c.name, c.region,
                  (select count(*)::int from ozikoro_article_entity ae where ae.entity_id = e.id) as n,
                  (select m.storage_key
                     from ozikoro_article a
                     join ozikoro_media m on m.id = a.featured_media_id
                    where a.status = 'published' and a.is_page = false
                      and a.id in (select ae2.article_id from ozikoro_article_entity ae2 where ae2.entity_id = e.id)
                    limit 1) as img
             from clan c left join ozikoro_entity e on e.clan_id = c.id
            where c.published = true
            order by c.name`
        );
        const towns: RealTown[] = rows.map((r) => ({
          name: r.name, href: `/town/${r.slug}/`, region: r.region, image: r.img ? mediaPath(r.img) : null, records: Number(r.n) || 0,
        }));
        if (towns.length > 0) html = fillTowns(html, towns);
        // A Place per town. **No coordinates**: the archive holds none, and a pin that looks like evidence is
        // the most convincing kind of invented content there is.
        extraNodes = towns.map((t) =>
          placeNode({
            name: t.name,
            url: `https://ozikoro.com${t.href}`,
            region: t.region,
            description: t.records > 0 ? `${t.records} record(s) in the archive.` : 'No records yet.',
          })
        );
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for towns:`, error);
    }

    try {
      if (name === 'collections') {
        /*
         * THE FOUR COLLECTIONS, WITH THE ARCHIVE'S OWN SIZES.
         *
         * **The counts are what the archive holds**, and the oral-recordings card says plainly that it holds no
         * recording — 13 video records and no audio — rather than borrowing a number from another collection.
         */
        const db = await getDb();
        const counts = await db.one<{ images: number; videos: number; docs: number }>(
          `select count(*) filter (where kind = 'image')::int images,
                  count(*) filter (where kind = 'video')::int videos,
                  count(*) filter (where kind = 'document')::int docs
             from ozikoro_media`
        );
        /*
         * THE PHOTOGRAPHS CARD CARRIES A CAMERA, NOT A PHOTOGRAPH.
         *
         * WHY THE QUERY THAT CHOSE ONE IS GONE WITH THE IMAGE
         *
         * This card used to be illustrated by `select storage_key from ozikoro_media where kind = 'image' and
         * storage_key is not null order by id limit 1` — **the archive's OLDEST image record, which is a
         * photograph belonging to some article and not a picture of the collection at all.** The card for
         * 3,462 photographs was therefore illustrated by one arbitrary photograph while the other three cards
         * were illustrated by a sign saying what they hold, which is the inconsistency the owner reported.
         *
         * **Nothing was deleted and no media record was touched**: that photograph is still served on
         * `/photographs/` and in its own article, and this card simply stops borrowing it. The query goes with
         * it rather than staying behind, because a query whose result nothing reads is a round trip on every
         * request to this page.
         *
         * THE EARLIER FAULT ON THIS SAME SLOT, KEPT BECAUSE THE LESSON OUTLIVES THE IMAGE: the key is
         * `ozikoro/11234-ute-king.webp` — where the file sits on disk — and **as a `src` it was a RELATIVE
         * address**, so the browser asked `/collections/ozikoro/11234-ute-king.webp` and got a 404 with
         * `naturalWidth === 0`, `complete === true` and no CSP violation. Every other fill in this file goes
         * through `mediaPath` for that reason.
         */
        const collections: RealCollection[] = [
          { label: 'Visual archive', name: 'Photographs', href: '/photographs',
            cta: `${(counts?.images ?? 0).toLocaleString('en-GB')} image records`,
            image: null, glyph: null, drawnGlyph: COLLECTION_CAMERA_SIGN },
          { label: 'Written archive', name: 'Documents & maps', href: '/documents',
            cta: `${(counts?.docs ?? 0).toLocaleString('en-GB')} document records`, image: null, glyph: '≡' },
          { label: 'Recorded archive', name: 'Oral recordings', href: '/listen',
            cta: 'No recording held yet', image: null, glyph: '◉' },
          { label: 'Material archive', name: 'Material culture', href: '/material-culture',
            cta: `${(counts?.videos ?? 0).toLocaleString('en-GB')} video records`, image: null, glyph: '◈' },
        ];
        html = fillCollections(html, collections);
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for collections:`, error);
    }

    try {
      if (name === 'folklore') {
        // The 17 records the archive files under Folklores, with a photograph from the record where it has one.
        const db = await getDb();
        const rows = await db.rows<{ slug: string; title: string; topic: string | null; img: string | null }>(
          `select a.slug, a.title, t.name as topic,
                  (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as img
             from ozikoro_article a
             join ozikoro_topic t on t.id = a.topic_id
            where a.status = 'published' and a.is_page = false and t.slug = 'folklores'
            order by a.title limit 24`
        );
        if (rows.length > 0) {
          html = fillFolklore(html, rows.map((r) => ({
            title: r.title, href: `/${r.slug}/`, topic: r.topic, image: r.img ? mediaPath(r.img) : null, alt: r.title,
          })));
        }
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for folklore:`, error);
    }

    try {
      if (name === 'listen') {
        /*
         * THE RECORDINGS THE ARCHIVE HOLDS, DERIVED FROM THE EPISODE RECORDS.
         *
         * THE OWNER'S RULE: *"every audio inside an article on this website must appear on listen."* The list
         * is therefore not a selection anybody maintains — it is the set of records whose article carries a
         * player, asked of the database on every request.
         *
         * WHAT THIS REPLACED. The query here was `where a.status = 'published' … limit 12` — the twelve newest
         * published RECORDS, whether or not a recording existed for any of them — and every row said `Read`
         * beside a ▶ glyph. **The served page listed twelve things a reader could not hear, while the archive
         * held three episodes and the article pages played them.** A page that claims sound it does not have
         * is the plainest kind of invention, and it is what this round removes.
         *
         * THE JOIN, AND WHY IT IS BOTH CONDITIONS. A record appears here exactly when it appears on its own
         * article with a player, so the two surfaces cannot drift:
         *
         *   * the ARTICLE must be published and not a page — otherwise `/<slug>/` 404s and the card points at
         *     nothing, which is a card for a recording nobody can reach;
         *   * `playableEpisodeAudioSql('e')` is the article's own condition — the approval record AND an
         *     address to play — composed from the one fragment in `@ozikoro/platform` rather than written out
         *     here, because a second copy of a gate is the copy that drifts;
         *   * `limit 1` inside the lateral join is the article's own `order by published_at desc nulls last
         *     limit 1`, so a record with two approved episodes contributes the one card its article will play.
         *     Without that, a record could stand here twice and carry one player there.
         */
        const db = await getDb();
        const rows = await db.rows<{
          slug: string; title: string; topic: string | null; img: string | null;
          episode: string; duration_seconds: number | null; narrator_kind: string; narrator_name: string | null;
          ai_disclosure: string; storage_key: string | null; external_url: string | null;
          external_service: string | null; external_direct_audio: boolean | null;
        }>(
          `select a.slug, a.title, t.name as topic,
                  (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as img,
                  e.slug as episode, e.duration_seconds, e.narrator_kind, e.narrator_name, e.ai_disclosure,
                  e.storage_key, e.external_url, e.external_service, e.external_direct_audio
             from ozikoro_article a
             join lateral (
               select * from ozikoro_episode e
                where e.article_id = a.id and ${playableEpisodeAudioSql('e')}
                order by e.published_at desc nulls last limit 1
             ) e on true
             left join ozikoro_topic t on t.id = a.topic_id
            where a.status = 'published' and a.is_page = false
            order by e.published_at desc nulls last`
        );
        const tracks: RealTrack[] = rows.map((r) => {
          /*
           * WHETHER THIS RECORDING IS A FILE, WHICH DECIDES WHAT THE PAGE OFFERS. Ours under `/media/…`, or an
           * external address a save-time check established serves `audio/*`, plays in place. A Spotify episode
           * PAGE is audio a reader can hear and not an `<audio src>`, and the card says where it goes instead
           * of offering a control that cannot answer — the same distinction `/[slug]/` makes.
           */
          const directAudio = r.external_url ? r.external_direct_audio === true : true;
          const mins = r.duration_seconds ? Math.floor(r.duration_seconds / 60) : null;
          const secs = r.duration_seconds ? r.duration_seconds % 60 : null;
          return {
            title: r.title,
            href: `/${r.slug}/`,
            series: r.topic ?? 'The archive',
            image: r.img ? mediaPath(r.img) : null,
            // The length is the measured duration of the file, or the service that holds it. The design's
            // `Sample` claimed a recording this archive did not have; nothing here is claimed that is not
            // recorded.
            length: mins !== null ? `${mins}m ${String(secs).padStart(2, '0')}s` : null,
            narrator: narratorPhrase(r.narrator_kind, r.narrator_name),
            narratorKind: r.narrator_kind,
            playable: directAudio,
            audioUrl: directAudio
              ? (r.external_url ?? (r.storage_key ? `/media/${r.storage_key}` : null))
              : r.external_url,
            episode: r.episode,
            externalService: r.external_service,
            disclosure: r.ai_disclosure,
          };
        });
        /*
         * CALLED EVEN WHEN THE LIST IS EMPTY. A guard of `tracks.length > 0` would leave the design's six
         * example rows on the page — durations ("Sample") and play controls for recordings that do not
         * exist — which is the fault this round is removing, so the fill runs and it is the fill that
         * removes them.
         */
        html = fillListen(html, tracks);
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for listen:`, error);
    }

    try {
      if (name === 'topics') {
        // The archive's fourteen categories and its 188 towns, in the design's A–Z shape.
        const db = await getDb();
        const [cats, towns] = await Promise.all([
          db.rows<{ slug: string; name: string; n: number }>(
            `select t.slug, t.name, count(a.id)::int n from ozikoro_topic t
               left join ozikoro_article a on a.topic_id = t.id and a.status = 'published' and a.is_page = false
              group by t.slug, t.name order by t.name`
          ),
          db.rows<{ slug: string; name: string }>(
            `select slug, name from clan where published = true order by name`
          ),
        ]);
        const entries: RealAzEntry[] = [
          ...cats.map((c) => ({ name: c.name.trim(), href: `/archive-index?topic=${c.slug}`, kind: 'Category' as const })),
          ...towns.map((t) => ({ name: t.name, href: `/town/${t.slug}/`, kind: 'Place' as const })),
        ];
        if (entries.length > 0) html = fillTopics(html, entries);
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for topics:`, error);
    }

    try {
      if (name === 'photographs') {
        /*
         * THE PHOTOGRAPHS, SERVED FROM THIS ARCHIVE RATHER THAN HOT-LINKED.
         *
         * The design's example image points at `https://ozikoro.com/wp-content/uploads/…`, which is the live
         * WordPress install. These point at `/media/…` on this site, where the archive's own 3,437 files are
         * served, so the page does not depend on the system it is replacing.
         */
        const db = await getDb();
        const rows = await db.rows<{
          id: number; slug: string; title: string | null; alt_text: string | null; storage_key: string | null;
          caption: string | null; description: string | null;
          creator: string | null; credit: string | null; licence: string | null; captured_at: Date | null;
        }>(
          `select id, slug, title, alt_text, caption, description, storage_key, creator, credit, licence, captured_at
             from ozikoro_media
            where kind = 'image' and storage_key is not null
            order by id limit 24`
        );
        const photos: RealPhotograph[] = rows.filter((r) => r.storage_key).map((r) => {
          /*
           * THE CARD IS NAMED THE WAY THE RECORD PAGE IS HEADED, and the same fix applies here: the grid
           * was titled `ute king`, `owa`, `opta` — the uploaded files' own names — beside captions that
           * name the people in them. One rule, in one place. See `mediaName`.
           */
          const named = mediaName({
            kind: 'image',
            slug: r.slug,
            storedTitle: r.title,
            caption: r.caption,
            description: r.description,
            altText: r.alt_text,
          });
          return {
            id: r.id,
            // The record page's address. Without it the gallery rendered 24 photographs and no way into
            // any of their records — see the note on `RealPhotograph.slug`.
            slug: r.slug,
            title: named.name,
            // A file name in the `alt` attribute describes nothing; the record's own text does.
            alt: r.alt_text?.trim() || named.name,
            // `filter` does not narrow the property, and the guard above is what makes this safe.
            src: mediaPath(r.storage_key as string),
            creator: r.creator,
            credit: r.credit,
            licence: r.licence,
            captured: r.captured_at ? new Date(r.captured_at).toISOString().slice(0, 10) : null,
          };
        });
        if (photos.length > 0) html = fillPhotographs(html, photos);
        // An ImageObject per photograph. `licence` is null for every one of them, so `imageNode` emits a
        // `copyrightNotice` saying so rather than a `license` asserting a permission nobody granted.
        extraNodes = photos.map((ph) =>
          imageNode({
            // The record's own address, not the listing's: a search engine given the gallery's URL for
            // every image can only ever index one page for 3,462 records.
            url: `https://ozikoro.com/documents/${ph.slug}/`,
            contentUrl: `https://ozikoro.com${ph.src}`,
            caption: ph.title,
            creator: ph.creator,
            credit: ph.credit,
            licence: ph.licence,
          })
        );
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for photographs:`, error);
    }

    try {
      if (name === 'home') {
        // The five most recent published records, with their topic as the design's `<span class="tag">`.
        const db = await getDb();
        const rows = await db.rows<{ slug: string; title: string; topic: string | null }>(
          `select a.slug, a.title, t.name as topic
             from ozikoro_article a left join ozikoro_topic t on t.id = a.topic_id
            where a.status = 'published' and a.is_page = false
            order by a.published_at desc nulls last, a.id desc limit 5`
        );
        /*
         * THE ROTATING NAMES, RESOLVED BEFORE THEY ARE LINKED.
         *
         * `MARQUEE_PLACES` says which record each of the design's twelve names means and why; **this query is
         * what stops that map from being taken on trust.** Every slug it names is read back through
         * `clan … where published`, which is the same visibility rule `getPlace` applies to `/town/<slug>/`,
         * and **a link is emitted only for a slug that came back.** So a record renamed or unpublished later
         * leaves its name as plain text instead of becoming a 404, which is the one failure that would make
         * this worse than the text it replaced.
         *
         * The `slug` column is selected rather than assumed, so the address is built from the stored value
         * and a change of case in the database cannot produce a link that misses.
         */
        const marquee: { label: string; href: string }[] = [];
        const wanted = [...new Set(MARQUEE_PLACES.map((p) => p.slug))];
        const found = await db.rows<{ slug: string }>(
          `select slug from clan where published and lower(slug) = any($1::text[])`,
          [wanted.map((s) => s.toLowerCase())]
        );
        const stored = new Map(found.map((r) => [r.slug.toLowerCase(), r.slug]));
        for (const place of MARQUEE_PLACES) {
          const slug = stored.get(place.slug.toLowerCase());
          if (slug) marquee.push({ label: place.label, href: `/town/${slug}/` });
        }

        if (rows.length > 0) {
          html = fillHome(
            html,
            rows.map((r) => ({ title: r.title, href: `/${r.slug}/`, topic: r.topic })),
            marquee
          );
        } else if (marquee.length > 0) {
          // No articles to show, but the names still reach their records.
          html = fillMarquee(html, marquee);
        }
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for home:`, error);
    }

    try {
      if (name === 'watch') {
        /*
         * THE FILMS THE ARCHIVE ACTUALLY HOLDS.
         *
         * **`youtube.com/embed/`, and only that.** The first version of this query also matched `youtu.be/`
         * and `/watch?v=` anywhere in the body, and that is not the same claim: measured over the 25
         * published records that carry a YouTube address at all, **24 are real embeds and 6 are plain links
         * in body text** — a reference list entry, or a sentence reading "you may watch the following
         * video: <address>". A citation is not a film the archive holds and not a permission to embed one,
         * which is the policy this page states in its own source note.
         *
         * **And one of those six was a dead card.** `7f81_erOkxM` is cited by
         * `area-scatter-entertainer-musician-and-dibia-in-igbo-culture` as "Marre, J. (1985). Beats of the
         * Heart: Konkombe. [Film]. Retrieved from https://youtu.be/7f81_erOkxM". The upload was live in
         * April 2023 — the Wayback Machine's snapshot of that id has the title "Konkombe 4/6" and the
         * description "Nigerian Music documentary", so the citation named the film it said it did — and by
         * January 2026 the same snapshot reads "Video unavailable". It is deleted, not moved: no
         * single-character variant of the id answers, and the oEmbed and the thumbnail both 404. **The card
         * promised a film that no longer exists, and restricting the pattern to real embeds removes it for
         * the right reason rather than by naming the id**, which would go stale the next time a video went.
         * **Round 316 §8 had already recorded the same film as a content fault on the page**; the restriction
         * is what retires it, and the id is not named in any condition here.
         *
         * ── WHY THE ROWS CARRY `body_html` RATHER THAN A SQL EXTRACTED ID ─────────────────────────────
         *
         * `substring(a.body_html from 'youtube…/embed/…')` finds a film — **but only the first one in each
         * article**, because `substring` without the `g` flag stops at its first match. Measured: **19
         * published articles embed 25 frames carrying 24 distinct ids, and the first-match-only query
         * returned 18.** Six films were lost silently, one per article that embeds more than one — the
         * Egedege article alone embeds three. A SQL set-returning `regexp_matches(…, 'g')` would find them
         * all, but it cannot reach the embed's `title` attribute, which is where the archive recorded the
         * film's own name ("Eddie Quansa", "Seun Rere (Live)"). So the bodies are read and parsed by
         * `extractArchiveFilms`, which is where every rule and its evidence is written down.
         *
         * THE PUBLISHED-BODY MEASUREMENT, from the cluster: 19 records embed a film; 25 frames; 24 distinct
         * ids; **all 24 posters answer 200 at 480×360**. Nothing is fetched from YouTube at serve time — the
         * id is in the body, where the editor put it. The four sources searched and what each yielded are in
         * `extractArchiveFilms` and in `docs/OZIKORO-REMAINING.md` under this round.
         */
        const db = await getDb();
        const rows = await db.rows<{
          slug: string; title: string; topic: string | null; body_html: string | null;
        }>(
          `select a.slug, a.title, t.name as topic, a.body_html
             from ozikoro_article a
             left join ozikoro_topic t on t.id = a.topic_id
            where a.status = 'published' and a.is_page = false
              and a.body_html ~ 'youtube(?:-nocookie)?\\.com/embed/'
            order by a.published_at desc nulls last`
        );
        const films: RealFilm[] = extractArchiveFilms(rows);
        /*
         * THE PAGE, FROM THE ADDRESS. `?page=2` is the whole mechanism: the middleware carries the reader's
         * query string to this route (see `apps/ozikoro/middleware.ts`), this reads it, and `fillWatch`
         * renders that page of the list with real links to the pages either side — **no script is involved,
         * and `watch.js` never sees it.** The parameter is named `page` because that is the archive's own
         * name for it (`apps/ozikoro/app/archive/page.tsx:110`, `PAGE_SIZE` at line 41). A value that is not
         * a page number (`abc`) or is below the first (`0`, `-3`) falls back to page 1, which is exactly what
         * `/archive/` does; a page past the last is answered with the count and a link rather than with
         * another page's films.
         *
         * **AND THE LINKS THE FILL WRITES GO OUT FROM THE ROOT**, because the head this route generates
         * carries `<base href="/">` — a relative `?page=2` resolves against the site root there and lands on
         * `/?page=2`, the front page. Measured in headless Chrome: the first run of
         * `scripts/verify-round-330.mjs` clicked Next on `/watch/` and read `http://127.0.0.1:3110/?page=2`
         * with zero cards. `curl` cannot see it, because `curl` never resolves a relative URL.
         */
        const url = new URL(request.url);
        if (films.length > 0) {
          html = fillWatch(html, films, {
            page: Number(url.searchParams.get('page') ?? '1'),
            query: url.search,
          });
        }
      }
    } catch (error) {
      /*
       * ONE SCREEN IS ONE FAILURE. **A query that throws used to be caught by the single outer handler,
       * which served the WHOLE screen as the design drew it and printed nothing about which screen it
       * was.** A wrong column name then looked exactly like a page nobody had written a fill for — the fault
       * this file has already recorded once. Each screen is now its own boundary so the rest still fill.
       */
      console.error(`design fill failed for watch:`, error);
    }

    /*
     * ============================================================================================
     * THE SCREENS THE ARCHIVE HOLDS NO RECORDS FOR.
     * ============================================================================================
     *
     * Each of these was served exactly as the design drew it — example donors, example projects, an
     * invented researcher, example courses — because it was not in `FILLED`. **A page showing the
     * walkthrough's example content looks deliberate**, which is the whole reason this block exists.
     *
     * Every handler here follows the same rule: the archive's own counts where it has them, and an
     * honest statement of what is absent where it has none. Three of these queries are deliberately
     * cheap counts of empty tables, because "0" is the fact the page needs.
     */
    try {
      const db = await getDb();

      /*
       * THE SHELF IS COUNTED ONLY FOR THE SCREENS THAT PRINT IT.
       *
       * It is one query with eight scalar sub-selects, and `watch-video`, `cultural-event` and `igbo-calendar`
       * have no use for any of them. **A page that costs a count it does not show is a page that gets slower
       * on a phone for no reader-visible reason** — and half of this audience is on a phone on poor bandwidth,
       * which the brief puts in as many words.
       */
      const USES_SHELF = new Set(['projects', 'ledger', 'publications', 'material-culture', 'town']);
      const EMPTY_SHELF = {
        records: 0, towns: 0, folklores: 0, photographs: 0, documents: 0,
        media: 0, contributors: 0, donations: 0,
      };
      const shelf = !USES_SHELF.has(name) ? EMPTY_SHELF : await db.one<{
        records: number; towns: number; folklores: number; photographs: number;
        documents: number; media: number; contributors: number; donations: number;
      }>(
        `select
           (select count(*) from ozikoro_article where status='published' and is_page=false)::int records,
           (select count(*) from clan where published = true)::int towns,
           (select count(*) from ozikoro_article a join ozikoro_topic t on t.id=a.topic_id
             where a.status='published' and a.is_page=false and t.slug='folklores')::int folklores,
           (select count(*) from ozikoro_article a join ozikoro_topic t on t.id=a.topic_id
             where a.status='published' and a.is_page=false and t.slug='photos')::int photographs,
           (select count(*) from ozikoro_media where kind='document')::int documents,
           (select count(*) from ozikoro_media)::int media,
           (select count(*) from ozikoro_contributor)::int contributors,
           (select count(*) from donation)::int donations`
      );
      const S = {
        records: shelf?.records ?? 0, towns: shelf?.towns ?? 0, folklores: shelf?.folklores ?? 0,
        photographs: shelf?.photographs ?? 0, documents: shelf?.documents ?? 0, media: shelf?.media ?? 0,
        contributors: shelf?.contributors ?? 0, donations: shelf?.donations ?? 0,
      };

      /*
       * THE ARCHIVE'S OWN MAIL ROUTE.
       *
       * The one address the deliverable itself prints is `archive@ozikoro.com`, on its upload screen. It is
       * used here because it is the design's own and not an address invented for this work — **and because a
       * partnership page with no way to make contact is not a page a partner can act on.**
       */
      const MAIL = 'archive@ozikoro.com';

      if (name === 'academy') {
        /*
         * The Academy was `learn.ozituma.com`; **that host is being retired and `academy.ozikoro.com`
         * replaces it.** It is still a separate application with its own Supabase project, and it is NOT
         * queried from here: a render-time fetch to another host would put this page's availability in
         * another deployment's hands, and `academy.ozikoro.com` has no record in its zone to fetch from.
         *
         * So the page states what the archive can state: that the academy is being prepared. The
         * design screen's own eight mentions of the old host are rewritten at serve time by
         * `designScreenLinks`, which is the only place an inviolable screen can be changed.
         *
         * `reachable` is FALSE rather than the `true` this passed while the old host answered. It is
         * what selects the sentence, and the sentence it selects now — the academy's curriculum is not
         * published — is the true one.
         */
        html = fillAcademy(html, [], false);
      }

      if (name === 'donate') {
        /*
         * THE PAYMENT MECHANISM, REPORTED AS IT IS.
         *
         * The application holds a NOWPayments webhook and a `donation` table — both real, both tested — and
         * `nowpaymentsConfigured()` is false because `NOWPAYMENTS_IPN_SECRET` is unset. **There is no route on
         * this site that starts a donation at all.** So the form is disabled and the page says why, rather
         * than offering a button that does nothing.
         */
        html = fillDonate(html, {
          configured: nowpaymentsConfigured(),
          donations: S.donations,
          currency: 'NGN',
        });
      }

      if (name === 'sponsors' || name === 'investors') {
        html = fillApproach(html, name === 'sponsors' ? 'sponsors' : 'investors', {
          recorded: 0,
          route: MAIL,
        });
      }

      if (name === 'careers') {
        html = fillCareers(html, { roles: 0 });
      }

      if (name === 'ledger') {
        const people = await db.rows<{ slug: string; name: string; records: number; bio: string | null }>(
          `select c.slug, c.display_name as name, count(a.id)::int as records, c.bio
             from ozikoro_contributor c
             left join ozikoro_article a on a.author_id = c.id and a.status='published' and a.is_page=false
            group by c.id, c.slug, c.display_name, c.bio
            order by records desc, c.display_name`
        );
        // Communities that have at least one record linked — the one real figure the design's "communities
        // represented" slot can carry.
        const linked = await db.one<{ n: number }>(
          `select count(distinct e.clan_id)::int n
             from ozikoro_article_entity ae
             join ozikoro_entity e on e.id = ae.entity_id
             join ozikoro_article a on a.id = ae.article_id
            where e.clan_id is not null and a.status='published'`
        );
        html = fillLedger(html, {
          donations: S.donations,
          contributors: people,
          communities: linked?.n ?? 0,
        });
      }

      if (name === 'projects') {
        html = fillProjectsIndex(html, S);
      }

      if (name === 'project') {
        html = fillProjectRecord(html);
      }

      if (name === 'publications') {
        html = fillPublications(html, { records: S.records });
      }

      if (name === 'publication') {
        html = fillPublicationRecord(html);
      }

      if (name === 'cite') {
        /*
         * THE WORKED EXAMPLE IS A REAL RECORD'S CITATION.
         *
         * The design asks for exactly this in its own words — *"Replace this example with the citation shown on
         * the article itself"* — so the sample is built by the same `citationFor` the article route uses, from
         * the most recently published record that has an author.
         */
        const sample = await db.one<{ title: string; slug: string; author: string | null; published_at: Date | null }>(
          `select a.title, a.slug, c.display_name as author, a.published_at
             from ozikoro_article a left join ozikoro_contributor c on c.id = a.author_id
            where a.status='published' and a.is_page=false
            order by a.published_at desc nulls last, a.id desc limit 1`
        );
        html = fillCite(
          html,
          sample
            ? {
                citation: citationFor({
                  authorName: sample.author,
                  title: sample.title,
                  publishedAt: sample.published_at ? new Date(sample.published_at).toISOString() : null,
                  url: `https://ozikoro.com/${sample.slug}/`,
                }),
                title: sample.title,
                path: `/${sample.slug}/`,
              }
            : null
        );
      }

      if (name === 'researcher-profile') {
        /*
         * THE REAL PEOPLE NETWORK HAS ALMOST NOTHING ON FILE, AND THAT IS THE PAGE.
         *
         * `ozikoro_member` holds one row and it is the owner's; the eleven contributors have no account and no
         * member profile. So the profile shown is a contributor's own record — byline name, biography where
         * WordPress held one, and the histories they wrote — and **every field the archive does not hold is
         * stated as absent rather than borrowed from the design's invented researcher.**
         */
        const person = await db.one<{
          slug: string; name: string; bio: string | null; records: number;
          member_headline: string | null; institution: string | null; department: string | null;
          orcid: string | null; interests: string[] | null; member_since: Date | null; is_public: boolean | null;
          publications: number;
        }>(
          `select c.slug, c.display_name as name, c.bio,
                  count(a.id)::int as records,
                  m.headline as member_headline, m.institution, m.department, m.orcid,
                  m.research_interests as interests, m.created_at as member_since, m.is_public,
                  (select count(*) from ozikoro_publication p where p.submitted_by = c.id)::int publications
             from ozikoro_contributor c
             left join ozikoro_article a on a.author_id = c.id and a.status='published' and a.is_page=false
             left join ozikoro_member m on m.account_id = c.account_id
            group by c.id, c.slug, c.display_name, c.bio, m.headline, m.institution, m.department,
                     m.orcid, m.research_interests, m.created_at, m.is_public
            order by records desc, c.display_name limit 1`
        );
        html = fillResearcherProfile(html, {
          slug: person?.slug ?? '',
          name: person?.name ?? 'No contributor recorded',
          headline: person?.member_headline ?? null,
          bio: person?.bio ?? null,
          institution: person?.institution ?? null,
          department: person?.department ?? null,
          orcid: person?.orcid ?? null,
          interests: person?.interests ?? [],
          since: person?.member_since ? new Date(person.member_since).toISOString().slice(0, 10) : null,
          publications: person?.publications ?? 0,
          joined: Boolean(person?.is_public),
        });
      }

      if (name === 'journeys') {
        /*
         * THE PLACES, BY REGION — AND NO COORDINATE.
         *
         * `clan` holds 188 published places with a region name and **no latitude or longitude anywhere**, so the
         * design's map line is not drawn. What the page carries instead is the same discovery done with what the
         * archive actually has: region, how many places, how many linked records.
         */
        const regions = await db.rows<{ region: string; towns: number; records: number }>(
          `select coalesce(c.region, 'Region not recorded') as region,
                  count(distinct c.id)::int as towns,
                  count(distinct ae.article_id)::int as records
             from clan c
             left join ozikoro_entity e on e.clan_id = c.id
             left join ozikoro_article_entity ae on ae.entity_id = e.id
             left join ozikoro_article a on a.id = ae.article_id and a.status='published' and a.is_page=false
            where c.published = true
            group by 1 order by records desc, towns desc, region`
        );
        html = fillJourneys(html, regions, { towns: S.towns, records: S.records });
      }

      if (name === 'material-culture') {
        const objects = await db.one<{ n: number }>(`select count(*)::int n from ozikoro_object`);
        html = fillMaterialCulture(html, {
          objects: objects?.n ?? 0,
          photographs: S.photographs,
          documents: S.documents,
        });
      }

      if (name === 'cultural-calendar') {
        /*
         * THE MONTH ON THE PAGE IS THE MONTH IT IS, AND THE EVENT COUNT IS THE ARCHIVE'S.
         *
         * The design heads its grid "October 2026 · demonstration month". **There is no event table** — the only
         * `%event%` tables are `learn_xp_event` and `spotify_event` — so the count is 0 and every date is a
         * plain date, which is the design's own non-interactive state rather than a degraded one.
         *
         * `monthIndex` GOES WITH `label` AND `year`, AND IT IS NOT REDUNDANT.
         *
         * The fill draws the grid's day cells itself — the design's example grid holds four invented event
         * dates — and **the grid must be drawn for the month the heading names.** The first version took the
         * month from the wall clock while the heading took it from here: the same value today, and a page
         * headed "October 2026" over November's days the moment either changed.
         *
         * THE MARKET-DAY ANCHOR COMES FROM THE CONSTANT BELOW, WHICH THE IGBO CALENDAR ALSO USES.
         *
         * The owner asked for today's Igbo market day on this screen, and **the reckoning is the design's own
         * `market-days.js`, not a second implementation here.** What is passed is the basis sentence beside it,
         * and passing the same constant to both screens is what stops the two from ever stating different
         * anchors — the drift a copied string would eventually produce.
         */
        const now = new Date();
        html = fillCulturalCalendar(html, {
          label: now.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }),
          year: now.getUTCFullYear(),
          // `getUTCMonth()` is 0-based; the fill wants 1–12 because it does calendar arithmetic with it.
          monthIndex: now.getUTCMonth() + 1,
          events: 0,
          anchor: MARKET_DAY_ANCHOR,
        });
      }

      if (name === 'cultural-event') {
        html = fillCulturalEvent(html);
      }

      if (name === 'igbo-calendar' || name === 'market-days') {
        /*
         * THE ANCHOR, STATED. It is the design's own (`market-days.js` anchors 1 January 2026 at Orie) and the
         * page already calls it a demonstration; the fill makes the wording name it as this archive's reckoning
         * rather than a universal one, which the brief requires.
         */
        html = fillIgboCalendar(html, { basis: MARKET_DAY_ANCHOR });
      }

      if (name === 'watch-video') {
        /*
         * ONE FILM'S PAGE, FOR ANY FILM THE ARCHIVE HOLDS — `?v=<id>`, SELECTED FROM THE SAME LIST `/watch/`
         * IS BUILT FROM.
         *
         * The page had one film. `/watch/` draws 24, and the design's page says `Published by [Re:]Entanglements
         * Project` about `Faces | Voices` — **so every archive film's viewing page, if a reader reached one,
         * would have been about a different film, with a publisher the archive has no record of.** A card that
         * names one film and opens a page about another is the wrong-destination fault at 200.
         *
         * The list is `extractArchiveFilms` over the same published bodies `/watch/` reads, so the two surfaces
         * cannot disagree about a title, a topic or a holding record — a second query here is how they would
         * come to.
         *
         * AN UNKNOWN `?v=` IS A 404 RATHER THAN THE DESIGN'S FILM. Falling back to `Faces | Voices` would be
         * the exact fault this branch removes: a page that answers 200 to a request for one film and shows
         * another. Nothing links to an unknown id, so the 404 is only ever reached by a typo.
         *
         * WITHOUT `?v=` THE PAGE IS THE DESIGN'S OWN — the film it was drawn for, with the publisher sentence
         * that is true of that film. `/watch-video/` is linked from the home screen and must keep working.
         */
        const url = new URL(request.url);
        const requested = url.searchParams.get('v');
        if (requested) {
          const rows = await db.rows<{ slug: string; title: string; topic: string | null; body_html: string | null }>(
            `select a.slug, a.title, t.name as topic, a.body_html
               from ozikoro_article a
               left join ozikoro_topic t on t.id = a.topic_id
              where a.status = 'published' and a.is_page = false
                and a.body_html ~ 'youtube(?:-nocookie)?\\.com/embed/'
              order by a.published_at desc nulls last`
          );
          const film = extractArchiveFilms(rows).find((f) => f.id === requested);
          if (!film) return new Response('Not found', { status: 404 });
          html = fillWatchVideo(html, film);
        } else {
          html = fillWatchVideo(html);
        }
      }

      if (name === 'folklore-reader') {
        /*
         * A REAL STORY'S OWN WORDS, ON THE DESIGN'S READING FRAME.
         *
         * The design's banner says the title and photograph are from live Ozikoro and the sample text is not the
         * published story — **the worst combination, because a reader who came for a story is given a paragraph
         * about the interface.** The record's own first paragraph and the rest of its prose replace it, and the
         * listen panel goes, because the archive holds no audio.
         */
        const story = await db.one<{
          id: number; slug: string; title: string; topic: string | null; author: string | null;
          published_at: Date | null; body_html: string | null; image: string | null; image_alt: string | null;
        }>(
          `select a.id, a.slug, a.title, t.name as topic, c.display_name as author, a.published_at, a.body_html,
                  (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as image,
                  (select m.alt_text from ozikoro_media m where m.id = a.featured_media_id) as image_alt
             from ozikoro_article a
             join ozikoro_topic t on t.id = a.topic_id
             left join ozikoro_contributor c on c.id = a.author_id
            where a.status='published' and a.is_page=false and t.slug='folklores'
            order by a.title limit 1`
        );
        if (story) {
          const related = await db.rows<{ slug: string; title: string }>(
            `select a.slug, a.title from ozikoro_article a
               join ozikoro_topic t on t.id = a.topic_id
              where a.status='published' and a.is_page=false and t.slug='folklores' and a.id <> $1
              order by a.title limit 3`,
            [story.id]
          );
          const body = story.body_html ?? '';
          const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
          const chosen = paragraphs.find((m) => (m[1] ?? '').replace(/&nbsp;|\s|<[^>]+>/g, '').length > 40);
          html = fillFolkloreReader(html, {
            title: story.title,
            topic: story.topic,
            author: story.author,
            published: story.published_at
              ? new Date(story.published_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
                })
              : null,
            image: story.image ? mediaPath(story.image) : null,
            imageAlt: story.image_alt ?? story.title,
            lead: chosen ? (chosen[1] ?? '') : 'This record has no written body yet.',
            body: chosen ? body.replace(chosen[0], '') : '',
            path: `/${story.slug}/`,
            reference: `OZ-H-${String(story.id).padStart(4, '0')}`,
            related: related.map((r) => ({ title: r.title, href: `/${r.slug}/` })),
          });
        }
      }

      if (name === 'town') {
        /*
         * `/town/` IS THE REGISTER, NOT ONE TOWN.
         *
         * A single town has its own address (`/town/<slug>/`, served by the application's own route, which the
         * middleware does not intercept because it is two segments). This screen is the one-segment address, so
         * what it can honestly carry is the register and a way into each place.
         */
        const towns = await db.rows<{ slug: string; name: string; region: string | null; records: number }>(
          `select c.slug, c.name, c.region,
                  (select count(*)::int from ozikoro_article_entity ae
                     join ozikoro_article a on a.id = ae.article_id and a.status='published' and a.is_page=false
                    where ae.entity_id = e.id) as records
             from clan c left join ozikoro_entity e on e.clan_id = c.id
            where c.published = true
            order by records desc, c.name limit 24`
        );
        html = fillTown(html, {
          towns: towns.map((t) => ({ name: t.name, href: `/town/${t.slug}/`, region: t.region, records: Number(t.records) || 0 })),
          total: S.towns,
        });
      }
    } catch (error) {
      console.error('design fill failed for the record-less screens:', error);
    }

  } catch (error) {
    // Degrade to the design rather than to an error page, and say so in the log.
    console.error(`design fill failed for ${name}:`, error);
  }

  /*
   * THE ONE SCRIPT THE ARCHIVE EXTENDS IS POINTED AT THE EXTENDED COPY, AND IT RUNS HERE FOR A REASON.
   *
   * `market-days.js` draws the full-year grid, and the owner asked for those months to be clickable. The
   * extension cannot be written into the deliverable, so it is applied at request time by
   * `/design-screen-assets/[name]`, and the screens that load the script are pointed at that address.
   *
   * **THIS RAN EARLIER AND MISSED A SCREEN.** It sat beside the `../name.js` rewrite near the top, which is
   * where the DESIGN's own script tags are made absolute — but `/cultural-calendar/` does not have that tag in
   * its markup at all: **`fillCulturalCalendar` INSERTS it**, and the fill runs after this point. So the
   * cultural calendar kept `/design/market-days.js` while the two calendar screens took the extended copy, and
   * the served pages disagreed about which script they used with nothing in the markup to show it. Moving the
   * rewrite after the fills covers both, because by then a tag is a tag whether the design wrote it or a fill
   * did.
   *
   * **AND THE EXTENDED COPY IS NOW THE ONLY ONE THAT STAMPS THE MONTH GRID.** The three-way choice below is
   * not a list of the screens that HAVE a market day on them: `/cultural-calendar/` is the screen whose grid
   * the fill draws, and it takes the extended copy so that the cells the fill leaves empty carry `Eke`,
   * `Orie`, `Afọ` and `Nkwọ` — from the design's own `marketDay()`, which is the one place in this repository
   * that reckons the cycle. A screen served the unextended script would show numbered dates and no market day,
   * which is the fault this whole pass exists to remove.
   *
   * **AND IT IS CHECKED RATHER THAN ASSUMED.** A screen that ends up with a script tag this pass did not
   * rewrite would silently run the design's own version and its month expansion would be missing, so the
   * count is taken and the route logs when a screen that should have the script does not.
   */
  if (name === 'igbo-calendar' || name === 'market-days' || name === 'cultural-calendar') {
    const before = html;
    html = html.replace(/src="\/design\/market-days\.js"/g, 'src="/design-screen-assets/market-days.js"');
    const tags = (html.match(/market-days\.js/g) ?? []).length;
    if (before === html || tags !== 1) {
      console.error(`design-screen: ${name} did not take the extended market-days script (${tags} reference(s))`);
    }
  }

  /*
   * AND `/watch/` TAKES THE EXTENDED `watch.js`, FOR THE ONE LINE THAT NAMES THE FILM'S OWN PAGE.
   *
   * `fillWatch` adds `#inline-player-page` to the inline player's actions row, and the only place that knows
   * which film the reader chose is `open(card)` inside `watch.js` — so `extendWatchScript` splices one line in
   * and this points the page at the copy that has it. **The design's own file is untouched**; the mechanism is
   * the market-days one, which is the point of `/design-screen-assets/[name]` existing.
   *
   * IT IS CHECKED, like the market-days rewrite above: a page that quietly kept `/design/watch.js` would lose
   * the film's page link with nothing in the markup to say so.
   */
  if (name === 'watch') {
    const before = html;
    html = html.replace(/src="\/design\/watch\.js"/g, 'src="/design-screen-assets/watch.js"');
    if (before === html) {
      console.error('design-screen: /watch/ did not take the extended watch.js, so the film-page link will not follow the player');
    }
  }

  /*
   * THE DESIGN'S RELATIVE ADDRESSES, ONCE MORE, NOW THAT THE FILLS HAVE RUN.
   *
   * **THE FIRST CALL IS TOO EARLY TO SEE THE ADDRESSES A FILL WROTE.** It sits beside
   * `designScriptPaths` near the top of this function, and the fills run after it — so the design's own
   * menu was made absolute and the links the fills wrote were not. Measured on the served pages:
   * `/publication/` carried `cite.html`, `publications.html` and `upload.html`, and `/researcher-profile/`
   * carried two of them, every one resolving to `/publication/cite.html` and answering 404 while reading
   * as a working link in the source.
   *
   * This is the same fault and the same cure as the market-days script rewrite just above, and it is
   * written here rather than in each fill for the same reason: **by the time this runs, a link is a link
   * whether the design wrote it or a fill did.** The function is idempotent — the `<base>` is added only
   * when the document has none — so the earlier call is not undone and not repeated.
   *
   * ── AND IT IS THE ONLY CALL THAT IS TOLD WHERE THE PAGE IS, WHICH IS WHY IT IS THE ONLY ONE THAT CAN
   *    MAKE AN IN-PAGE ANCHOR POINT AT THIS PAGE (round 338) ─────────────────────────────────────────
   *
   * The `<base href="/">` this function writes decides what a fragment-only address means, and the answer
   * is the site root: `#library` on `/documents/` resolves to `/#library` — **the front page** — so every
   * skip link, every table of contents and every filter row on every screen stopped at `/` instead of
   * scrolling. Measured in Chrome, on `/watch/`, `/about/`, `/listen/` and `/documents/`.
   *
   * It is fixed by making the fragment absolute, which needs the address the page is actually served at —
   * path AND query, because `#series` on `/watch/?page=2` must stay on page 2 and not send the reader back
   * to page 1. `name` gives the path the middleware rewrites FROM (`/watch/`), which is the address a reader
   * has; the query is carried through the rewrite by the middleware and is on `request.url`.
   *
   * THE EARLIER CALL IS DELIBERATELY NOT TOLD, and that is load-bearing rather than tidy: `fillWatch` looks
   * for `href="#series"` in order to move an anchor to the page that really draws that section, and a first
   * pass that had already made it absolute would leave it pointing at whichever page the reader happened to
   * be on.
   */
  html = designScreenLinks(html, `${name === 'home' ? '/' : `/${name}/`}${new URL(request.url).search}`);

  /*
   * EVERY SCREEN GETS A REAL HEAD, NOT THE WALKTHROUGH'S.
   *
   * The deliverable's screens each carry the design's own `<title>` — "Nwagu Aneke", "Ozikoro article reader"
   * and so on — because they were written for a walkthrough. **Served as the site, all fifty-one announced
   * themselves as the same demonstration.** `SCREEN_SEO` gives each the title and description it should have,
   * and anything not listed falls back to a generic one rather than to the design's example.
   */
  const meta = SCREEN_SEO[name] ?? DASHBOARD_SEO[name] ?? {
    title: `${name.replace(/-/g, ' ')} — Ozikoro`,
    description: 'A page in the Ozikoro archive of Igbo and African histories, culture and scholarship.',
  };
  const trail = [
    { name: 'Ozikoro', path: '/' },
    ...(name === 'home'
      ? []
      : [
          {
            /*
             * THE BREADCRUMB NAMES THE WORKSPACE, NOT THE SCREEN.
             *
             * Built from the title it read "dashboard reader" — **the design's own filename, shown to a
             * reader as the name of a place.** For a dashboard the role's label is the name of the place,
             * and it is already in `DASHBOARD_ROLE`.
             */
            name: DASHBOARD_ROLE[name]?.label ?? meta.title.split(' — ')[0] ?? name,
            path: `/${name}/`,
          },
        ]),
  ];
  /*
   * THE INVENTORY IS TAKEN HERE — after the fills, before the generated head.
   *
   * After the fills, because the fills are what decide which elements exist. Before the head, because the head
   * this route writes is metadata rather than design, and an inventory that described it would offer the owner
   * the canonical link and the JSON-LD script as things to edit.
   */
  {
    const url = new URL(request.url);
    const inventory = await inventoryResponse(html, url);
    if (inventory) return inventory;
  }

  /*
   * THE PLAYER SCRIPT, ADDED ONLY WHERE THERE IS SOMETHING TO PLAY — AND IT WAS NOT LOADED HERE AT ALL.
   *
   * `/listen/` is a screen whose one interactive control was a play button, and **the screen loaded no player
   * script**: `listen.html` carries only `mobile-nav.js`, so the featured card's `<button>▶ Play episode</button>`
   * had no handler on any served copy and the owner's report — *"it is not clickable and does nothing"* — was
   * the literal truth. That is the same shape as the market-day stamp and the article's `reader.js`: a control
   * whose script was never in the document, on a page that answers 200 and looks finished.
   *
   * The condition is the presence of `[data-listen-audio]` rather than the screen's name, because that is the
   * element `audio-listen.js` itself looks for: it returns immediately without one, so loading it on a listen
   * page whose only recording is a Spotify page would be a request that can never do anything. **One player,
   * the same file the article uses, added where it has a file to drive.**
   */
  if (name === 'listen' && html.includes('data-listen-audio') && !html.includes('/audio-listen.js')) {
    html = html.replace('</body>', '<script src="/audio-listen.js" defer></script></body>');
  }

  html = withSeoHead(
    html,
    seoHead(
      {
        path: name === 'home' ? '/' : `/${name}/`,
        title: meta.title,
        description: meta.description,
        kind: meta.kind ?? 'page',
        image: null,
        trail,
        extraNodes,
        // A dashboard, a search page and the form behind the auth gate are not for indexing.
        noindex: name.startsWith('dashboard') || name === 'search' || name === 'upload' || name === 'signin',
      },
      ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css']
    )
  );

  // THE SECOND PASS: whatever the fills inserted. `folklore-reader`'s story body is the measured case — it
  // arrives from WordPress with `srcset` candidates on `ozikoro.com`, and it does not exist at the first pass.
  html = await resolveOldSiteImages(html);

  /*
   * AND THE OWNER'S EDITS GO ON LAST, AFTER THE HEAD AND AFTER EVERY FILL. `withSeoHead` replaces the whole
   * `<head>`, so an override injected before it would be discarded with the design's own head — and a fill
   * that rewrote the same heading would discard the rest. Nothing runs after this.
   */
  html = await withDesignOverrides(html, name, new URL(request.url));

  /*
   * THE CHOSEN WORKSPACE IS REMEMBERED HERE, AND ONLY FOR A DASHBOARD THAT WAS ACTUALLY SERVED.
   *
   * Set after every refusal and every redirect, so a cookie is never written for an address this account may
   * not open — and set on the dashboard's own response, which is what makes a link inside it (to `/account/`,
   * to `/admin/archive/`) return the reader to the workspace they were in rather than to the reader's.
   *
   * It is read back through `rememberedDashboardMode`, which validates it against the same allow-list the
   * parameter goes through, so this value can only ever select among workspaces the account may already open.
   */
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (modeCookie) headers.append('set-cookie', modeCookie);

  return new Response(html, { headers });
}
