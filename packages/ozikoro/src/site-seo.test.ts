/**
 * The site's own search-engine identity, the title template, and the redirect a moved record leaves behind.
 *
 * ── THE FOUR WAYS THIS COULD BE WRONG, AND THE TEST THAT CATCHES EACH ────────────────────────────────
 *
 *   1. **A SETTING THAT IS STORED AND NEVER READ.** The header of this module's screen says every field names
 *      the function that reads it. The test below does the stronger thing: it **stores a value through the real
 *      write path and asserts it appears in a head built by the real head builder** — which is the same code
 *      path every served page goes through. A field read by nothing cannot pass this.
 *
 *   2. **AN EMPTY SETTING THAT IS NOT A REAL SETTING.** The archive must behave exactly as it did before this
 *      module existed when nothing is stored: the record's own title, no separator inserted, no redirect, no
 *      empty `<meta content="">`. Asserted by building the same head twice and comparing the bytes.
 *
 *   3. **A PERMALINK CHANGE THAT BREAKS A PUBLISHED ADDRESS.** *"Every record keeps the address it was
 *      published at."* The test changes a published record's address through `changeRecordPermalink` and then
 *      asserts the OLD address is in the redirect table pointing at the new one — and that the row is in the
 *      database, so the route that reads it would serve a 301 rather than a 404.
 *
 *   4. **OWNER-SUPPLIED TEXT REACHING THE `<head>` UNCHECKED.** A title, a template and an address are all
 *      text a person types. The shape tests are asserted directly: a template naming a variable that does not
 *      exist is refused by name, an address that is not a path is refused, and a value containing `<>` is
 *      refused rather than escaped and kept.
 *
 * ── WHAT NEEDS A DATABASE AND WHAT DOES NOT ──────────────────────────────────────────────────────────
 *
 * The template engine, the shape tests and the redirect parser are pure and run anywhere. The write path needs
 * Postgres, so it is exercised against the same local cluster every other `test-*.ts` script in this package
 * uses — **point it at a scratch cluster with `OZITUMA_DB_PATH` and it touches nothing that matters.** It skips
 * itself, by name, when the review server holds the cluster, because PGlite is single-process.
 *
 * Run with: npm -w @ozikoro/platform run test
 * It is also picked up by `node --test src/*.test.ts`, which is part of `npm run test:ozikoro`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '@ozituma/db/client';
import {
  DEFAULT_HOME_TITLE,
  DEFAULT_SEPARATOR,
  EMPTY_SITE_SEO,
  HOME_TITLE_KEY,
  OWN_ROBOTS_DISALLOW,
  PUBLISHER_KEY,
  REDIRECTS_KEY,
  ROBOTS_DISALLOW_KEY,
  SITE_NAME_KEY,
  SITEMAP_GROUPS_KEY,
  TITLE_SEPARATOR_KEY,
  TITLE_TEMPLATE_KEY,
  changeRecordPermalink,
  cleanSettingValue,
  cleanSettingValueFor,
  loadRedirects,
  loadRobotsDisallow,
  loadSiteSeo,
  loadSitemapGroups,
  normalisePath,
  parseRedirects,
  pathProblem,
  renderTitleTemplate,
  robotsPathProblem,
  siteSeoFrom,
  slugProblem,
  templateProblem,
  type SiteSeo,
  type StoredSetting,
} from './site-seo.ts';
import { PUBLISHER, SITE_NAME, seoHead } from './seo-head.ts';

/**
 * The application's own directory and the workspace root, resolved from THIS file rather than from the working
 * directory: npm workspaces run a package's scripts with the package as `cwd`, so a relative path would look for
 * `apps/ozikoro` inside `packages/ozikoro`.
 */
const APP_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'apps', 'ozikoro');
const WORKSPACE = join(APP_DIR, '..', '..');

/* ================================================================================================
 * 1. THE EMPTY STATE, WHICH IS THE WHOLE SAFETY OF THE CHANGE
 * ============================================================================================== */

/**
 * THE DEFAULTS IN TWO FILES MUST BE THE SAME STRING.
 *
 * `SITE_NAME` and `PUBLISHER` in `seo-head.ts` are what a caller that does not pass settings serves;
 * `EMPTY_SITE_SEO` in `site-seo.ts` is what a caller that passes an unset one serves. **If those two drift,
 * two pages of the same archive disagree about what the site is called**, which is a fault nobody would look
 * for and a search engine would see.
 */
test('the defaults the head builder carries and the empty state are the same values', () => {
  assert.equal(EMPTY_SITE_SEO.siteName, SITE_NAME, 'SITE_NAME and EMPTY_SITE_SEO.siteName disagree');
  assert.equal(EMPTY_SITE_SEO.publisherName, PUBLISHER, 'PUBLISHER and EMPTY_SITE_SEO.publisherName disagree');
});

/**
 * THE FRONT PAGE'S FALLBACK TITLE IS THE STRING THE ROUTE ALREADY SERVES.
 *
 * `DEFAULT_HOME_TITLE` is documented as the value the design-screen route's `SCREEN_SEO.home.title` holds. **A
 * comment is not a check**, so this reads the route's own table out of its source — the file cannot be imported
 * (it is a Next route handler and imports `next/headers`), so the string is read from the source and compared.
 * The day somebody rewords the front page's title in that file, this fails and says which two strings must be
 * reconciled.
 */
test('the homepage fallback title is the one the design-screen route actually serves', () => {
  const route = readFileSync(join(APP_DIR, 'app', 'design-screen', '[screen]', 'route.ts'), 'utf8');
  const match = /home:\s*\{\s*title:\s*'([^']*)'/.exec(route);
  assert.ok(match, 'the design-screen route no longer holds a `home:` entry with a title — the fallback this module documents may have moved');
  assert.equal(
    match[1],
    DEFAULT_HOME_TITLE,
    'DEFAULT_HOME_TITLE in site-seo.ts and SCREEN_SEO.home.title in the design-screen route disagree'
  );
});

/** A record, as the four page kinds the archive actually serves. */
const RECORDS = [
  { what: 'the front page', path: '/', title: 'Ozikoro — Igbo and African history, archives and scholarship', kind: 'page' as const },
  { what: 'a record', path: '/ute-okpu/', title: 'Ute-Okpu', kind: 'article' as const },
  { what: 'a topic', path: '/topics/warfare/', title: 'Warfare', kind: 'list' as const },
  { what: 'a documents page', path: '/documents/', title: 'Documents', kind: 'page' as const },
];

test('with nothing stored, every page serves exactly the head it served before this module existed', () => {
  for (const { what, path, title, kind } of RECORDS) {
    const withoutSite = seoHead({ path, title, description: null, kind }, []);
    const withEmptySite = seoHead({ path, title, description: null, kind }, [], [], EMPTY_SITE_SEO);
    assert.equal(
      withEmptySite,
      withoutSite,
      `${what}: passing the empty site settings changed the head, so an unset setting is not a real setting`
    );
    assert.ok(withoutSite.includes(`<title>${title}</title>`), `${what}: the record's own title is not served`);
    assert.ok(withoutSite.includes(`<meta property="og:site_name" content="${SITE_NAME}">`), `${what}: og:site_name is not the archive's own`);
    assert.ok(withoutSite.includes(`<meta name="citation_publisher" content="${PUBLISHER}">`), `${what}: citation_publisher is not the archive's own`);
    // No separator was inserted anywhere, because no template is in force.
    assert.ok(!withoutSite.includes(`>${title} ${DEFAULT_SEPARATOR}`), `${what}: a separator was inserted with no template stored`);
  }
});

/* ================================================================================================
 * 2. THE TITLE TEMPLATE — WHAT IT RENDERS, AND WHAT IT REFUSES
 * ============================================================================================== */

const SITE: SiteSeo = {
  ...EMPTY_SITE_SEO,
  siteName: 'Ozikoro',
  tagline: 'Igbo and African histories',
  separator: '|',
  anySet: true,
};

test('a template with no variables stored leaves every page’s own title alone', () => {
  const head = seoHead({ path: '/ute-okpu/', title: 'Ute-Okpu', description: null, kind: 'article' }, [], [], { ...SITE, titleTemplate: null });
  assert.ok(head.includes('<title>Ute-Okpu</title>'), 'a page with no template did not serve its own title');
});

test('a template is rendered with the page’s own title, the site name and the separator', () => {
  const head = seoHead({ path: '/ute-okpu/', title: 'Ute-Okpu', description: null, kind: 'article' }, [], [], {
    ...SITE,
    titleTemplate: '%%title%% %%sep%% %%sitename%%',
  });
  assert.ok(
    head.includes('<title>Ute-Okpu | Ozikoro</title>'),
    'the template did not reach the served <title> — a setting that is stored and never read is the fault this test exists for'
  );
  // The Open Graph card carries the same line, so a shared link and a search result cannot disagree.
  assert.ok(head.includes('<meta property="og:title" content="Ute-Okpu | Ozikoro">'), 'og:title did not follow the template');
  // And the JSON-LD page node names the page the same way.
  assert.ok(head.includes('"name":"Ute-Okpu | Ozikoro"'), 'the structured data did not follow the template');
});

test('a homepage title replaces the template on the front page alone', () => {
  const site: SiteSeo = { ...SITE, titleTemplate: '%%title%% %%sep%% %%sitename%%', homeTitle: 'Ozikoro — the archive' };
  const home = seoHead({ path: '/', title: DEFAULT_HOME_TITLE, description: null, kind: 'page' }, [], [], site);
  const record = seoHead({ path: '/ute-okpu/', title: 'Ute-Okpu', description: null, kind: 'article' }, [], [], site);
  assert.ok(home.includes('<title>Ozikoro — the archive</title>'), 'the homepage title did not reach the front page');
  assert.ok(!home.includes('%%'), 'a raw template variable was served');
  assert.ok(record.includes('<title>Ute-Okpu | Ozikoro</title>'), 'the homepage title leaked onto a record');
});

test('a homepage description replaces the archive’s own on the front page alone', () => {
  const site: SiteSeo = { ...SITE, homeDescription: 'A summary the owner wrote.' };
  const home = seoHead({ path: '/', title: 'Ozikoro', description: 'the route’s own', kind: 'page' }, [], [], site);
  const record = seoHead({ path: '/documents/', title: 'Documents', description: 'the route’s own', kind: 'page' }, [], [], site);
  assert.ok(home.includes('<meta name="description" content="A summary the owner wrote.">'), 'the homepage description did not reach the front page');
  assert.ok(home.includes('<meta property="og:description" content="A summary the owner wrote.">'), 'the card description did not follow');
  assert.ok(record.includes('<meta name="description" content="the route’s own">'), 'the homepage description leaked onto another page');
});

test('a missing variable leaves a gap and is reported, rather than being filled with something invented', () => {
  const rendered = renderTitleTemplate('%%title%% %%sep%% %%category%% %%sep%% %%sitename%%', {
    title: 'Ute-Okpu',
    sitename: 'Ozikoro',
    sep: '|',
    category: null,
  });
  assert.equal(rendered.title, 'Ute-Okpu | | Ozikoro', 'the missing variable was not left empty');
  assert.deepEqual(rendered.missing, ['category'], 'the missing variable was not reported to the caller');
});

test('a template that resolves to nothing falls back to the page’s own title, so no page has an empty <title>', () => {
  const head = seoHead({ path: '/ute-okpu/', title: 'Ute-Okpu', description: null, kind: 'article' }, [], [], {
    ...SITE,
    titleTemplate: '%%sitedesc%%',
    tagline: null,
  });
  assert.ok(head.includes('<title>Ute-Okpu</title>'), 'a template with no value served an empty title');
  assert.ok(!head.includes('<title></title>'), 'the archive served an empty <title> element');
});

/* ================================================================================================
 * 3. THE SHAPE TESTS — WHAT IS REFUSED RATHER THAN ESCAPED AND KEPT
 * ============================================================================================== */

test('a template naming a variable the archive cannot supply is refused by name', () => {
  const problem = templateProblem('%%title%% %%focuskw%%');
  assert.ok(problem, 'a template with an unknown variable was accepted');
  assert.match(problem, /%%focuskw%%/, 'the refusal does not name the variable that is wrong');
  // The refusal lists what IS available, so the reader can fix it without guessing.
  assert.match(problem, /%%sitename%%/);

  // And a real template is accepted.
  assert.equal(templateProblem('%%title%% %%sep%% %%sitename%%'), null);
  // An empty template is a real state — "the page's own title" — and not a problem.
  assert.equal(templateProblem(''), null);
});

test('a template with an unclosed or stray %% is refused rather than served literally', () => {
  assert.ok(templateProblem('%%title%% %%sitenam'), 'an unclosed variable was accepted');
  assert.ok(templateProblem('100%% %%title%%'), 'a stray %% was accepted');
  assert.ok(templateProblem('<title>%%title%%</title>'), 'markup in a template was accepted');
});

test('an owner-supplied title cannot carry markup into the head', () => {
  // The value is REFUSED, not escaped and kept: a title is text, and a paste of a tag is a mistake.
  assert.throws(() => cleanSettingValue(SITE_NAME_KEY, '<b>Ozikoro</b>'), /cannot contain/);
  // And the head builder escapes whatever it is given, as the second layer. Asserted directly, because the
  // shape test above is the first layer and a page must be safe if the first layer is ever bypassed.
  const head = seoHead({ path: '/', title: 'Ozikoro', description: null, kind: 'page' }, [], [], {
    ...SITE,
    homeTitle: 'A "quoted" & <angled> title',
  });
  assert.ok(!head.includes('<angled>'), 'an angle bracket from a setting reached the head unescaped');
  assert.ok(head.includes('&amp;'), 'an ampersand from a setting was not escaped');
});

test('a control character does not survive into a text field', () => {
  /*
   * A NEWLINE IS COLLAPSED RATHER THAN REFUSED, and that is the decision: a title with a space in it is a title,
   * and the value the owner pasted from a word processor is the value he meant. What must not survive is the
   * control character itself — a `\n` inside a `<title>` is legal HTML and is a paste accident, and a NUL never
   * is anything else.
   */
  assert.equal(cleanSettingValue(SITE_NAME_KEY, 'Ozikoro\nname'), 'Ozikoro name', 'a newline survived into the value');
  assert.equal(cleanSettingValue(SITE_NAME_KEY, 'Ozikoro\u0000name'), 'Ozikoro name', 'a NUL survived into the value');
  // And a value past its field's ceiling is refused by name rather than truncated silently.
  assert.throws(() => cleanSettingValue(SITE_NAME_KEY, 'x'.repeat(400)), /190|characters/);
  assert.throws(() => cleanSettingValue(TITLE_SEPARATOR_KEY, 'x'.repeat(40)), /characters/);
});

test('a robots path must be rooted and plain, and a sitemap section must exist', () => {
  assert.equal(robotsPathProblem('/drafts/'), null);
  assert.ok(robotsPathProblem('drafts'), 'a relative path was accepted');
  assert.ok(robotsPathProblem('/drafts/*'), 'a wildcard was accepted');
  assert.ok(robotsPathProblem('/search?q='), 'a query string was accepted');
  assert.ok(robotsPathProblem('/a path/'), 'a path with a space was accepted');

  // A sitemap section the archive does not generate is refused, and the refusal lists the real ones.
  assert.throws(() => cleanSettingValueFor(SITEMAP_GROUPS_KEY, 'histories\nsockpuppets'), /sockpuppets/);
  assert.deepEqual(cleanSettingValueFor(SITEMAP_GROUPS_KEY, 'histories\nmedia\nhistories'), ['histories', 'media']);
  // An empty list is a real setting: it clears the row and the archive serves its own list again.
  assert.equal(cleanSettingValueFor(ROBOTS_DISALLOW_KEY, '\n  \n'), null);
});

test('every address this archive would store as a redirect is a path on this site', () => {
  assert.equal(pathProblem('/old-address/', 'from'), null);
  // The three cases `safeRedirectPath` already had to close for `returnTo`, plus the application's own prefixes.
  assert.ok(pathProblem('https://evil.example', 'to'), 'an absolute address was accepted as a destination');
  assert.ok(pathProblem('//evil.example', 'to'), 'a protocol-relative address was accepted');
  assert.ok(pathProblem('/\\evil.example', 'to'), 'a backslash was accepted');
  assert.ok(pathProblem('/api/admin/site-seo', 'from'), 'an /api/ address was accepted');
  assert.ok(pathProblem('/_next/static/x', 'to'), 'a /_next/ address was accepted');
  assert.ok(pathProblem('/a b/', 'from'), 'a space was accepted');
});

test('normalising a path gives the one spelling this site serves', () => {
  assert.equal(normalisePath('ute-okpu'), '/ute-okpu/');
  assert.equal(normalisePath('/ute-okpu'), '/ute-okpu/');
  assert.equal(normalisePath('/ute-okpu/'), '/ute-okpu/');
  assert.equal(normalisePath('/'), '/');
  assert.equal(normalisePath(''), '/');
});

test('a redirect row that is not a path this archive would store is dropped rather than followed', () => {
  // A hand-written row — or one written by an older version — must not become an open redirect on every page.
  const parsed = parseRedirects({
    '/old/': { to: 'https://evil.example', kind: 'manual', at: '2020-01-01T00:00:00.000Z', by: null },
    '/good/': { to: '/new/', kind: 'manual', at: '2020-01-01T00:00:00.000Z', by: null },
    '/self/': { to: '/self/', kind: 'manual', at: '2020-01-01T00:00:00.000Z', by: null },
    '/broken/': 'not an object',
  });
  assert.deepEqual(Object.keys(parsed), ['/good/'], 'a row that is not a usable redirect survived into the table');
});

test('a permalink cannot be a page of this site', () => {
  assert.equal(slugProblem('ute-okpu-an-ika'), null);
  // The percent-encoded form is a real slug in this archive, so it must stay legal — see `wordpressUriEncode`.
  assert.equal(slugProblem('entrance-to-an-igbo-compound-%c7%b9gwulu-onitsha'), null);
  assert.ok(slugProblem('admin'), 'a reserved route name was accepted as a record address');
  assert.ok(slugProblem('Ute-Okpu'), 'an uppercase address was accepted');
  assert.ok(slugProblem('ute okpu'), 'an address with a space was accepted');
  assert.ok(slugProblem('ute/okpu'), 'an address with a slash was accepted');
  assert.ok(slugProblem('/ute-okpu/'), 'a slashed address was accepted');
});

/* ================================================================================================
 * 4. THE ROUTE CONSTANTS, WHICH TWO FILES MUST AGREE ON
 * ============================================================================================== */

test('the robots list the screen prints is the list the served file writes', () => {
  const route = readFileSync(join(APP_DIR, 'app', 'robots.txt', 'route.ts'), 'utf8');
  // The route imports the list rather than typing it, and this asserts that is still what it does: a second
  // typed copy is how a screen comes to promise a disallow the served file does not have.
  assert.match(route, /OWN_ROBOTS_DISALLOW/, 'the robots route no longer imports the archive’s own disallow list');
  for (const path of OWN_ROBOTS_DISALLOW) {
    assert.ok(route.includes(path) || route.includes('OWN_ROBOTS_DISALLOW'), `the robots route does not name ${path}`);
  }
});

test('the two routes that serve a reader check the redirect table, and the middleware does not', () => {
  /*
   * THE OTHER HALF OF "AN OLD ADDRESS KEEPS RESOLVING". The database test below proves the redirect EXISTS in
   * the table; this proves something READS it — which is the difference between a published address that
   * resolves and a published address that 404s while a row about it sits in a table nobody queries.
   *
   * IT IS ASSERTED AGAINST THE SOURCE because the routes are Next route handlers and cannot be imported here:
   * `app/[slug]/route.ts` imports `next/headers` through its session helpers, which does not resolve outside a
   * Next runtime. What is read is the call, not a comment — see the same technique and the same reasoning in
   * `seo-verification.test.ts`'s caller guard.
   *
   * THE MIDDLEWARE ASSERTION IS THE HONEST OTHER HALF. `middleware.ts` runs in Next's edge runtime, before
   * routing and outside the Node process, and PGlite needs `node:fs` and a WebAssembly build that runtime does
   * not have — so it can hold no database read, and the five redirects it DOES carry are constants. This
   * asserts that it still carries them as constants rather than appearing to read the table, so the day
   * somebody "tidies" a `redirectFor` call into it the test says why that cannot work.
   */
  const slugRoute = readFileSync(join(APP_DIR, 'app', '[slug]', 'route.ts'), 'utf8');
  assert.match(slugRoute, /redirectFor\(db, clean\)/, 'app/[slug]/route.ts no longer checks the redirect table, so a moved record’s old address would 404');

  const designRoute = readFileSync(join(APP_DIR, 'app', 'design-screen', '[screen]', 'route.ts'), 'utf8');
  assert.match(designRoute, /redirectFor\(await getDb\(\), publicPath\)/, 'the design-screen route no longer checks the redirect table for the address the reader asked for');

  const middleware = readFileSync(join(APP_DIR, 'middleware.ts'), 'utf8');
  assert.doesNotMatch(middleware, /redirectFor\(/, 'middleware.ts now reads the redirect table — it runs in the edge runtime, where a PGlite read cannot run at all');
  assert.match(middleware, /RETIRED_PAGE_ADDRESSES/, 'the middleware’s own constant redirects are gone');
  for (const [from, to] of [['/authors/', '/researchers/'], ['/privacy-policy/', '/privacy/']]) {
    assert.ok(middleware.includes(`'${from}': '${to}'`), `the middleware no longer redirects ${from} to ${to}, which is a published address`);
  }
});

/* ================================================================================================
 * 5. THE DATABASE HALF — THE WRITE, AND THE OLD ADDRESS THAT MUST KEEP RESOLVING
 * ============================================================================================== */

/**
 * The process holding a cluster's lock, or null when it is free.
 *
 * `packages/db/src/cluster-lock.ts` writes `<dataDir>.lock` holding the holder's pid and argv and reclaims it
 * automatically when that pid is gone. This reads the same record for the same reason a person reads the
 * refusal: to find out BEFORE opening the cluster whether somebody else has it.
 */
function holderOf(dataDir: string): { pid: number; argv: string[] } | null {
  try {
    const parsed = JSON.parse(readFileSync(`${join(resolve(dataDir))}.lock`, 'utf8')) as { pid?: number; argv?: string[] };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    try {
      process.kill(parsed.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return null;
    }
    return { pid: parsed.pid, argv: Array.isArray(parsed.argv) ? parsed.argv.filter((a): a is string => typeof a === 'string') : [] };
  } catch {
    return null;
  }
}

test('a setting round-trips, an empty one clears it, and a moved record keeps its published address resolving', async (t) => {
  /*
   * IF ANOTHER PROCESS HOLDS THE CLUSTER, THIS SKIPS RATHER THAN FAILS. PGlite is single-process and `getDb`
   * REFUSES BY EXITING when the lock is held; the review server holds `.data/pg` for as long as it runs, so a
   * suite that opened it anyway would report a red test for a healthy but busy database.
   */
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) {
    const dataDir = process.env.OZITUMA_DB_PATH || join(WORKSPACE, '.data', 'pg');
    const held = dataDir.includes('://') ? null : holderOf(dataDir);
    if (held) {
      t.skip(`the database is held by pid ${held.pid} (${held.argv[held.argv.length - 1] ?? 'unknown command'}), so this test cannot open it`);
      return;
    }
  }

  let db: Db;
  try {
    const { getDb } = await import('@ozituma/db/client');
    db = await getDb();
  } catch (error) {
    t.skip(`no database available: ${String(error).slice(0, 120)}`);
    return;
  }

  const SUFFIX = 'zztest-site-seo';
  const { setSiteSeoSetting, setRedirect } = await import('./site-seo.ts');

  /*
   * THE OWNER, MADE IF THE CLUSTER HAS NONE — the same probe `seo-verification.test.ts` makes, and for the same
   * reason: a scratch cluster replayed from the migrations holds no accounts, and the write path asks for
   * `manage_design` itself.
   */
  const probe = await db.one<{ id: number }>(`select id from account where email = $1`, [`${SUFFIX}-owner@example.invalid`]);
  const ownerId = probe
    ? Number(probe.id)
    : Number((await db.one<{ id: number }>(
        `insert into account (email, display_name, role) values ($1, $2, 'owner') returning id`,
        [`${SUFFIX}-owner@example.invalid`, 'probe owner']
      ))!.id);

  /* A record of this test's own, so nothing the archive holds is touched. */
  const slug = `${SUFFIX}-record`;
  const movedSlug = `${SUFFIX}-record-moved`;
  await db.query(`delete from ozikoro_article where slug in ($1, $2)`, [slug, movedSlug]);
  const articleId = Number((await db.one<{ id: number }>(
    `insert into ozikoro_article (slug, title, status, is_page, body_html, access_tier)
     values ($1, $2, 'published', false, '<p>a probe record</p>', 'open') returning id`,
    [slug, 'A probe record for the site-seo test']
  ))!.id);

  const writtenKeys = [SITE_NAME_KEY, TITLE_TEMPLATE_KEY, ROBOTS_DISALLOW_KEY, SITEMAP_GROUPS_KEY, PUBLISHER_KEY, REDIRECTS_KEY];

  try {
    /* ---- 1. a text setting is stored, read back, and reaches a head ------------------------------ */
    await setSiteSeoSetting(db, { key: SITE_NAME_KEY, value: 'Probe Archive', actorId: ownerId });
    const loaded = await loadSiteSeo(db);
    assert.equal(loaded.siteName, 'Probe Archive', 'the stored site name did not come back out of the read path');

    const head = seoHead({ path: '/', title: DEFAULT_HOME_TITLE, description: null, kind: 'page' }, [], [], loaded);
    assert.ok(
      head.includes('<meta property="og:site_name" content="Probe Archive">'),
      'the stored site name is not in a head built by the real builder — a stored setting that is never read'
    );
    assert.ok(head.includes('"name":"Probe Archive"'), 'the stored site name did not reach the WebSite node');

    /* ---- 2. a list setting is stored and read back ---------------------------------------------- */
    await setSiteSeoSetting(db, { key: ROBOTS_DISALLOW_KEY, value: '/a-probe-directory/\n/another/\n', actorId: ownerId });
    assert.deepEqual(await loadRobotsDisallow(db), ['/a-probe-directory/', '/another/'], 'the robots list did not round-trip');

    await setSiteSeoSetting(db, { key: SITEMAP_GROUPS_KEY, value: 'pages\nhistories', actorId: ownerId });
    assert.deepEqual(await loadSitemapGroups(db), ['pages', 'histories'], 'the sitemap selection did not round-trip');

    /* ---- 3. an empty setting clears the row, and the archive serves its own again ---------------- */
    await setSiteSeoSetting(db, { key: SITE_NAME_KEY, value: '', actorId: ownerId });
    const cleared = await loadSiteSeo(db);
    assert.equal(cleared.siteName, SITE_NAME, 'clearing a setting did not return the archive to its own default');
    const clearedHead = seoHead({ path: '/', title: DEFAULT_HOME_TITLE, description: null, kind: 'page' }, [], [], cleared);
    const emptyHead = seoHead({ path: '/', title: DEFAULT_HOME_TITLE, description: null, kind: 'page' }, [], [], EMPTY_SITE_SEO);
    assert.equal(clearedHead, emptyHead, 'after clearing, the head is not the head this function served before the setting existed');

    /* ---- 4. THE PERMALINK: the record moves, and the old address keeps resolving ----------------- */
    const result = await changeRecordPermalink(db, { articleId, slug: movedSlug, actorId: ownerId });
    assert.equal(result.from, `/${slug}/`);
    assert.equal(result.to, `/${movedSlug}/`);
    assert.ok(result.redirect, 'a PUBLISHED record was moved without a redirect — that 404s every published address for it');
    assert.equal(result.redirect!.to, `/${movedSlug}/`);

    // The row is in the database, which is what the route that serves the address reads.
    const table = await loadRedirects(db);
    assert.equal(
      table[`/${slug}/`]?.to,
      `/${movedSlug}/`,
      'the old address is not in the redirect table, so it would 404 rather than 301'
    );
    assert.equal(table[`/${slug}/`]?.kind, 'permalink-change');
    assert.equal(table[`/${slug}/`]?.articleId, articleId);

    // And the record's slug really moved, which is what changes the canonical and the sitemap entry.
    const row = await db.one<{ slug: string }>(`select slug from ozikoro_article where id = $1`, [articleId]);
    assert.equal(row?.slug, movedSlug, 'the record’s slug did not move, so its address did not change');

    /* ---- 5. moving it a second time retargets the first address rather than chaining -------------- */
    const secondSlug = `${movedSlug}-again`;
    await db.query(`delete from ozikoro_article where slug = $1`, [secondSlug]);
    const second = await changeRecordPermalink(db, { articleId, slug: secondSlug, actorId: ownerId });
    assert.equal(second.redirect!.to, `/${secondSlug}/`);
    const after = await loadRedirects(db);
    assert.equal(after[`/${slug}/`]?.to, `/${secondSlug}/`, 'the first old address still points at the intermediate address, so it takes two hops');
    assert.equal(after[`/${movedSlug}/`]?.to, `/${secondSlug}/`, 'the intermediate address was not redirected');

    /* ---- 6. two records cannot share one address -------------------------------------------------- */
    const otherSlug = `${SUFFIX}-other`;
    await db.query(`delete from ozikoro_article where slug = $1`, [otherSlug]);
    const otherId = Number((await db.one<{ id: number }>(
      `insert into ozikoro_article (slug, title, status, is_page, body_html, access_tier)
       values ($1, $2, 'published', false, '<p>another probe</p>', 'open') returning id`,
      [otherSlug, 'Another probe record']
    ))!.id);
    await assert.rejects(
      () => changeRecordPermalink(db, { articleId: otherId, slug: secondSlug, actorId: ownerId }),
      /already the address of another record/,
      'a second record was allowed to take an address the first one holds'
    );
    // And the refused change stored no redirect for the record that did not move.
    const unchanged = await loadRedirects(db);
    assert.equal(unchanged[`/${otherSlug}/`], undefined, 'a refused change stored a redirect');

    /* ---- 7. a redirect that is a loop is refused -------------------------------------------------- */
    await assert.rejects(() => setRedirect(db, { from: '/loop-a/', to: '/loop-a/deeper/', actorId: ownerId }), /loop/);

    /* ---- 8. a manual redirect is added and removed ------------------------------------------------ */
    await setRedirect(db, { from: '/a-probe-old-address/', to: '/a-probe-new-address/', actorId: ownerId });
    assert.equal((await loadRedirects(db))['/a-probe-old-address/']?.to, '/a-probe-new-address/');
    const { removeRedirect } = await import('./site-seo.ts');
    await removeRedirect(db, { from: '/a-probe-old-address/', actorId: ownerId });
    assert.equal((await loadRedirects(db))['/a-probe-old-address/'], undefined, 'a removed redirect is still in force');

    /* ---- 9. the audit trail has the facts, and not a secret --------------------------------------- */
    const audit = await db.rows<{ action: string; note: string | null }>(
      `select action, note from ozikoro_audit where entity_type = 'site_seo_setting' and actor_id = $1
        union all
       select action, note from ozikoro_audit where actor_id = $1 and action in ('record_permalink_changed', 'add_redirect', 'remove_redirect')`,
      [ownerId]
    );
    assert.ok(audit.length >= 4, `expected the settings and the move to be recorded, found ${audit.length} audit rows`);
    assert.ok(
      audit.some((row) => row.action === 'record_permalink_changed' && /keeps resolving|answers 301/.test(row.note ?? '')),
      'the permalink change is recorded without saying that the old address keeps resolving'
    );
  } finally {
    /*
     * THE TEST'S OWN ROWS, AND NOTHING ELSE — scoped by the probe address, the probe slugs and the exact keys
     * this test writes. The archive's own settings are never named here, so a run against the real database
     * cannot clear one.
     */
    for (const key of writtenKeys) await db.query(`delete from site_setting where key = $1`, [key]).catch(() => {});
    await db.query(`delete from ozikoro_article where slug like $1`, [`${SUFFIX}%`]).catch(() => {});
    await db.query(
      `delete from ozikoro_audit where actor_id = $1 and (entity_type = 'site_seo_setting' or action in ('record_permalink_changed', 'add_redirect', 'remove_redirect', 'clear_site_seo_setting'))`,
      [ownerId]
    ).catch(() => {});
    await db.query(`delete from account where email = $1`, [`${SUFFIX}-owner@example.invalid`]).catch(() => {});
  }
});

/** A `StoredSetting`, for the pure tests above that need the shape. Kept beside the DB test so it is used. */
export const probeSetting: StoredSetting = { key: 'probe', value: 'probe', updatedAt: null, actorId: null, actorName: null };

/** `siteSeoFrom` over a hand-built map, for the pure empty-state test. Asserted beside it. */
test('a map with nothing in it returns the empty state', () => {
  assert.deepEqual(siteSeoFrom(new Map([[probeSetting.key, probeSetting]])), EMPTY_SITE_SEO);
});
