/**
 * The site's own search-engine identity: its name, the separator, the title template, the homepage title, and
 * the redirects a changed address leaves behind.
 *
 * ── WHAT THE OWNER ASKED FOR, IN HIS WORDS ───────────────────────────────────────────────────────────
 *
 *   "on the search engines, you did not display every single thing that is shown on the yoast plugin. please
 *    do add them and everything must not show on same page. one should be able to change permalink, homepage
 *    title and name, and everything else the yoast plugin has"
 *
 * Three of those had nowhere to live:
 *
 *   * **the homepage title** — `/`'s `<title>` was the hard-coded home entry in the design-screen route's
 *     `SCREEN_SEO` table;
 *   * **the site name** — `SITE_NAME` was (and remains) a constant in `seo-head.ts`, read by the Open Graph
 *     `og:site_name` tag and the `WebSite` JSON-LD node;
 *   * **the permalink** — nothing exposed a record's address at all.
 *
 * ── WHERE THESE LIVE, AND WHY NO MIGRATION ───────────────────────────────────────────────────────────
 *
 * `site_setting` — the key/value table migration 0031 created "for the things an administrator changes
 * without a deploy" — under the prefix `seo.`. **This module adds no numbered migration**, for the reason
 * `seo-verification.ts` already gives for its own keys: a key/value table takes a new key by receiving a row,
 * and there is no schema to change. The keys are:
 *
 *   seo.site.name         the name a crawler is told the site is called
 *   seo.site.tagline      a one-line description of the site, used by `%%sitedesc%%`
 *   seo.titles.sep        the separator between a title and the site name
 *   seo.titles.template   the template every page's title is built from
 *   seo.titles.home       the front page's own title, which replaces the template on `/` alone
 *   seo.titles.homeDescription  the front page's own meta description
 *   seo.redirects         the redirect table: `{ "<from>": { "to": …, "kind": …, "at": …, "by": … } }`
 *
 * `seo.verify.<engine>` is the verification module's namespace and is deliberately disjoint from these: the
 * verification reader selects `seo.verify.%` and this one selects the exact keys it names, so neither can
 * walk into the other's rows.
 *
 * ── AN EMPTY SETTING IS A REAL SETTING, WHICH IS THE WHOLE SAFETY OF THIS FILE ───────────────────────
 *
 * Every reader here returns a value that makes the archive behave **exactly as it did before this module
 * existed**: no site name means `SITE_NAME`, no separator means none is inserted, no template means the
 * record's own title, no homepage title means the route's own hand-written one, no redirects means an empty
 * map. There is no path through `resolveTitle` or `renderTitleTemplate` that produces an empty `<title>`, and
 * `seoHead` skips a meta description rather than emitting `content=""`.
 *
 * ── THE SHAPE A TITLE TEMPLATE MAY TAKE, AND WHY IT IS AN ALLOW-LIST ─────────────────────────────────
 *
 * A template is owner-supplied text that reaches a `<title>` element. Two things answer that, and both are
 * needed: the VALUE is escaped where it is written (`seo-head.ts`'s `esc`), and the SHAPE is refused here —
 * a variable that is not in `TITLE_VARIABLES` is refused by name rather than left in the output, because
 * `%%shrubbery%%` rendered literally is a template that looks like it worked. **The list is exactly the
 * variables this archive can supply from a record it actually holds**, which is why there is no `%%focuskw%%`
 * (there is no keyphrase field to read) and no `%%page%%` (nothing here knows a page number of a paginated
 * archive — the lists are single-page). See `TITLE_VARIABLES`.
 *
 * ── THE CAPABILITY ───────────────────────────────────────────────────────────────────────────────────
 *
 * `manage_design`, the same capability `/admin/seo/`, `/admin/seo-records/` and `/admin/design/` already ask
 * for, and for the same reason written out in `apps/ozikoro/app/api/admin/seo/route.ts`: these are site-wide,
 * reader-visible settings, and migration 0055's rule already decided the site's own face is an editor's to
 * change. **The capability is asked in the write path here and not only at the route**, the same doctrine
 * `seo-records.ts` and `trash.ts` follow, so a script or a job added later is refused by the same rule.
 */
import type { Db } from '@ozituma/db/client';
import { requireCapability } from './members.ts';
/*
 * THE CHILD SITEMAPS, FROM THE FILE THAT ENUMERATES THEM. Imported rather than repeated: a second list here
 * would be a second answer to "what sections does this sitemap have", and the day a group is added to `seo.ts`
 * is the day a stored selection that names only the old ones would silently drop the new one.
 */
import { SITEMAP_GROUPS as KNOWN_SITEMAP_GROUPS } from './seo.ts';

/* ================================================================================================
 * 1. THE KEYS, AND THE PREFIX THEY SHARE
 * ============================================================================================== */

/** The prefix every key in this module carries. `seo.verify.` is the sibling namespace, not a child. */
export const SITE_SEO_PREFIX = 'seo.';

export const SITE_NAME_KEY = 'seo.site.name';
export const SITE_TAGLINE_KEY = 'seo.site.tagline';
export const TITLE_SEPARATOR_KEY = 'seo.titles.sep';
export const TITLE_TEMPLATE_KEY = 'seo.titles.template';
export const HOME_TITLE_KEY = 'seo.titles.home';
export const HOME_DESCRIPTION_KEY = 'seo.titles.homeDescription';
export const REDIRECTS_KEY = 'seo.redirects';
export const ROBOTS_DISALLOW_KEY = 'seo.tools.robots.disallow';
export const PUBLISHER_KEY = 'seo.schema.publisher';
export const SITEMAP_GROUPS_KEY = 'seo.tools.sitemap.groups';

/** The capability that writes any of them. */
export const SITE_SEO_CAPABILITY = 'manage_design';

/* ================================================================================================
 * 2. THE VALUES, AND WHAT EMPTY MEANS
 * ============================================================================================== */

/** The longest a site name, separator or tagline may be. Past it, the value is not that thing. */
export const SITE_NAME_MAX = 120;
export const TAGLINE_MAX = 320;
export const SEPARATOR_MAX = 12;
export const TITLE_MAX = 320;

/** The default separator, used only when a template names `%%sep%%` and no separator is stored. */
export const DEFAULT_SEPARATOR = '—';

/**
 * What the front page falls back to when the owner has written nothing.
 *
 * **This is the value the design-screen route already serves at `/`** — `SCREEN_SEO.home.title` — repeated
 * here so the empty state can be asserted against one string rather than two. The route remains the owner of
 * the front page's words; this is what "unset" means for it.
 */
export const DEFAULT_HOME_TITLE = 'Ozikoro — Igbo and African history, archives and scholarship';

/** The site identity, as the head builder and a screen both read it. */
export interface SiteSeo {
  /** The name a crawler is told the site is called. Falls back to `SITE_NAME`. */
  siteName: string;
  /** A one-line description of the site, for `%%sitedesc%%`. Null when nothing is stored. */
  tagline: string | null;
  /** The separator between a title and the site name. Never empty — `DEFAULT_SEPARATOR` when unset. */
  separator: string;
  /** The template every page's title is built from, or null when none is set (today's behaviour). */
  titleTemplate: string | null;
  /**
   * The publisher named in the `Organization` node of the JSON-LD graph.
   *
   * `PUBLISHER` in `seo-head.ts` — `Ozi Ikoro Limited` — is the default, and this is the setting that replaces
   * it. It is the one structured-data field worth exposing: the `Organization` node is emitted on every page
   * and a machine reads it as who publishes this archive.
   */
  publisherName: string;
  /** The front page's own title, or null when the route's own is served. */
  homeTitle: string | null;
  /** The front page's own meta description, or null when the route's own is served. */
  homeDescription: string | null;
  /** True when ANY of the above was stored, so a screen can say whether anything is in force. */
  anySet: boolean;
}

/** The empty state: what the archive serves when nothing has been written. */
export const EMPTY_SITE_SEO: SiteSeo = {
  siteName: 'Ozikoro',
  publisherName: 'Ozi Ikoro Limited',
  tagline: null,
  separator: DEFAULT_SEPARATOR,
  titleTemplate: null,
  homeTitle: null,
  homeDescription: null,
  anySet: false,
};

/* ================================================================================================
 * 3. THE TEMPLATE VARIABLES — THE ALLOW-LIST ITSELF
 * ============================================================================================== */

/**
 * Every variable a title template may name, and what each supplies.
 *
 * `%%title%%` IS THE ONE THAT ALWAYS WORKS. The rest are supplied only when the caller has them, and a
 * template naming a variable with no value renders it as the empty string **and is reported by
 * `renderTitleTemplate`**, so the screen can say "this template names `%%sitedesc%%` and no tagline is
 * stored, so that part will be blank" rather than serving a title with a gap in it that nobody can explain.
 */
export interface TitleVariables {
  /** The page's own title. Always present. */
  title: string;
  /** The site's name. Always present — `SITE_NAME` when nothing is stored. */
  sitename: string;
  /** The separator. Always present — `DEFAULT_SEPARATOR` when nothing is stored. */
  sep: string;
  /** The site's tagline, when one is stored. */
  sitedesc?: string | null;
  /** The primary topic or category name, when the page has one. */
  category?: string | null;
  /** The record's publication date, as `YYYY-MM-DD` (the format the page's own `datePublished` uses). */
  date?: string | null;
  /** The record's reference, e.g. `OZ-H-0001`. */
  reference?: string | null;
}

/** One variable, as the screen lists it. */
export interface TitleVariable {
  name: string;
  /** What it supplies, in the archive's words. */
  supplies: string;
  /** Whether a page can always supply it, or only some pages. */
  always: boolean;
}

/**
 * THE ALLOW-LIST. A template naming anything absent from it is refused rather than rendered.
 *
 * Each variable here has a real source in this archive, and each is named with it:
 *
 *   `%%title%%`     the record's own title, or the route's own title for a page — `SeoRecord.title`
 *   `%%sitename%%`  `SiteSeo.siteName`, which falls back to `SITE_NAME` in `seo-head.ts`
 *   `%%sep%%`       `SiteSeo.separator`
 *   `%%sitedesc%%`  `SiteSeo.tagline`
 *   `%%category%%`  the record's first topic — `SeoRecord.topics[0]`
 *   `%%date%%`      the record's publication date — `SeoRecord.published`
 *   `%%reference%%` the archive's own identifier — `SeoRecord.reference`
 *
 * **THERE IS DELIBERATELY NO `%%focuskw%%` AND NO `%%page%%`.** Yoast has both; this archive has no
 * keyphrase field for the first, and no paginated archive for the second. A variable offered on a screen and
 * rendered from nothing is the "stored and never read" fault with extra steps.
 */
export const TITLE_VARIABLES: readonly TitleVariable[] = [
  { name: 'title', supplies: 'the page’s or the record’s own title', always: true },
  { name: 'sitename', supplies: 'the site name — the field on the Titles &amp; meta screen', always: true },
  { name: 'sep', supplies: 'the separator', always: true },
  { name: 'sitedesc', supplies: 'the site tagline, when one is stored', always: false },
  { name: 'category', supplies: 'the record’s primary topic, when it has one', always: false },
  { name: 'date', supplies: 'the record’s publication date, as YYYY-MM-DD, when it has one', always: false },
  { name: 'reference', supplies: 'the archive’s own identifier, e.g. OZ-H-0001, when a record has one', always: false },
];

const VARIABLE_NAMES = new Set(TITLE_VARIABLES.map((variable) => variable.name));

/**
 * One template variable, as it is written: `%%name%%`.
 *
 * The name is matched case-insensitively because an owner who types `%%SiteName%%` has named the same
 * variable, and refusing it would be refusing a template for its capitalisation.
 */
const VARIABLE_PATTERN = /%%([A-Za-z_][A-Za-z0-9_]*)%%/g;

/**
 * A template with a variable that is not in the allow-list, named so the refusal can be read.
 *
 * **THIS IS THE TOKEN-VALIDATION RULE OF `seo-verification.ts` APPLIED TO A TEMPLATE**: refuse the shape that
 * cannot mean anything, and say which part of the input was wrong, rather than storing something that
 * renders as literal `%%focuskw%%` in a search result.
 */
export function templateProblem(template: string): string | null {
  const value = template.trim();
  if (value.length === 0) {
    // An empty template is a real state — "build the title from the record itself", which is today's
    // behaviour — so it is not a problem. The screen translates this into "nothing is set".
    return null;
  }
  if (value.length > TITLE_MAX) {
    return `That template is ${value.length} characters. A title template builds one line — under ${TITLE_MAX} — so this looks like more than a template was pasted.`;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return 'A title template is one line of text. That contains a control character — often a paste from a word processor — so it was not stored.';
  }
  if (/<|>/.test(value)) {
    return 'A title template is text, not markup: it cannot contain `<` or `>`. Everything the archive writes into a `<title>` is escaped, and a template that wanted to write a tag is not a template.';
  }
  /*
   * A DANGLING `%%` IS REFUSED, because it is almost always half of a variable and would be served as two
   * percent signs. The count of `%%` must be even and the pattern must account for every pair.
   */
  const pairs = (value.match(/%%/g) ?? []).length;
  if (pairs % 2 !== 0) {
    return 'That template has an unclosed `%%` — a variable is written as `%%name%%`, with both pairs of percent signs. Nothing was stored.';
  }
  const unknown = new Set<string>();
  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const name = (match[1] ?? '').toLowerCase() as string;
    if (!VARIABLE_NAMES.has(name)) unknown.add(match[1] ?? '');
  }
  if (unknown.size > 0) {
    const named = [...unknown].sort().map((name) => `%%${name}%%`).join(', ');
    return `${named} ${unknown.size === 1 ? 'is not a variable' : 'are not variables'} this archive can supply. The ones it can: ${TITLE_VARIABLES.map((variable) => `%%${variable.name}%%`).join(', ')}. Nothing was stored.`;
  }
  /*
   * THE PAIRS ABOVE ARE ACCOUNTED FOR INDIVIDUALLY. Two `%%` that do not form a variable — `%%%%`, or
   * `100%% %%title%%` — pass the even-count test and are still not a template this archive will store, so the
   * variable pattern is required to consume every pair.
   */
  const consumed = (value.match(VARIABLE_PATTERN) ?? []).reduce((total, match) => total + (match.match(/%%/g) ?? []).length, 0);
  if (consumed !== pairs) {
    return 'That template has a `%%` that is not part of a variable. A variable is written as `%%name%%`, and the text around it is ordinary text. Nothing was stored.';
  }
  return null;
}

/** The result of building a title from a template. */
export interface RenderedTitle {
  /** The title to serve. Never an empty string. */
  title: string;
  /** Variables the template named that had no value, in the order they were met. */
  missing: string[];
}

/**
 * Build a title from a template.
 *
 * **A MISSING VARIABLE LEAVES AN EMPTY SPACE AND IS REPORTED, RATHER THAN BEING FILLED WITH SOMETHING.**
 * Inventing a value for `%%category%%` on a record with no topic would put a word in the archive's mouth;
 * substituting the site name would be worse. So the value goes, the whitespace around it collapses, and the
 * caller can decide — the screen prints which variables are missing, and `seoHead` uses the result anyway
 * because a title with one gap is still a title and a page with no title is not.
 *
 * A template with NO variables at all is returned as its own text. That is a real (if unusual) setting: an
 * owner who wants every page to carry one fixed string can have it, and `%%title%%` is how they say they
 * want the page's own.
 */
export function renderTitleTemplate(template: string, variables: TitleVariables): RenderedTitle {
  const missing: string[] = [];
  const rendered = template.replace(VARIABLE_PATTERN, (_whole, rawName: string) => {
    const name = rawName.toLowerCase();
    if (name === 'title') return variables.title;
    if (name === 'sitename') return variables.sitename;
    if (name === 'sep') return variables.sep;
    const supplied =
      name === 'sitedesc' ? variables.sitedesc
      : name === 'category' ? variables.category
      : name === 'date' ? variables.date
      : name === 'reference' ? variables.reference
      : null;
    const value = (supplied ?? '').trim();
    if (value.length === 0) {
      if (!missing.includes(name)) missing.push(name);
      return '';
    }
    return value;
  });

  /*
   * THE COLLAPSE IS WHAT MAKES A MISSING VARIABLE COME OUT AS NOTHING RATHER THAN AS A STRAY SEPARATOR.
   * `%%title%% %%sep%% %%sitename%%` with no site name would otherwise serve `Ute-Okpu —` with a trailing
   * dash. Runs of whitespace become one space, then the ends are trimmed.
   */
  const title = rendered.replace(/\s+/g, ' ').trim();
  return { title, missing };
}

/**
 * What the `<title>` should be for one page.
 *
 * THE ORDER IS THE WHOLE OF THE OWNER'S REQUEST, and each step is a real state:
 *
 *   1. **the front page, with a homepage title stored** — that title, and nothing else. This is the field he
 *      named first, and a template that overrode it would make the field he named do nothing on the page he
 *      named it for;
 *   2. **a template stored** — the template, rendered with this page's variables;
 *   3. **nothing stored** — the page's own title, which is today's behaviour to the character.
 *
 * An empty result at any step falls through to the page's own title, so no template can serve `<title></title>`.
 */
export function resolveTitle(input: {
  recordTitle: string;
  /** What the page is: the front page, or something else. */
  isHome: boolean;
  site: SiteSeo;
  variables?: Partial<Omit<TitleVariables, 'title' | 'sitename' | 'sep'>>;
}): RenderedTitle {
  const own = input.recordTitle.trim();
  const home = (input.site.homeTitle ?? '').trim();
  if (input.isHome && home.length > 0) return { title: home, missing: [] };
  if (input.site.titleTemplate) {
    const built = renderTitleTemplate(input.site.titleTemplate, {
      title: own,
      sitename: input.site.siteName,
      sep: input.site.separator,
      ...input.variables,
    });
    if (built.title.length > 0) return built;
  }
  return { title: own, missing: [] };
}

/* ================================================================================================
 * 4. THE READ PATH
 * ============================================================================================== */

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: Date | string | null;
  actor_id: number | string | null;
  actor_name: string | null;
}

/** One stored setting with who wrote it, for a screen that must show a value is real. */
export interface StoredSetting {
  key: string;
  value: unknown;
  updatedAt: string | null;
  actorId: number | null;
  actorName: string | null;
}

/**
 * The named rows, in one query, so a page's head costs one read rather than six.
 *
 * **A FAILURE HERE DEGRADES TO THE EMPTY STATE**, exactly as `loadSeoVerification` does and for the same
 * reason: a settings table that cannot be read for a moment must not cost every page of the archive its head,
 * and "nothing is set" is the state the archive served before this module existed.
 */
export async function loadSiteSeoSettings(db: Db): Promise<Map<string, StoredSetting>> {
  const keys = [
    SITE_NAME_KEY, SITE_TAGLINE_KEY, TITLE_SEPARATOR_KEY, TITLE_TEMPLATE_KEY,
    HOME_TITLE_KEY, HOME_DESCRIPTION_KEY, REDIRECTS_KEY,
    ROBOTS_DISALLOW_KEY, SITEMAP_GROUPS_KEY, PUBLISHER_KEY,
  ];
  const out = new Map<string, StoredSetting>();
  try {
    const rows = await db.rows<SettingRow>(
      `select s.key, s.value, s.updated_at, s.updated_by as actor_id,
              coalesce(m.display_name, a.email) as actor_name
         from site_setting s
         left join account a on a.id = s.updated_by
         left join ozikoro_member m on m.account_id = s.updated_by
        where s.key = any($1::text[])`,
      [keys]
    );
    for (const row of rows) {
      out.set(row.key, {
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        actorId: row.actor_id === null || row.actor_id === undefined ? null : Number(row.actor_id),
        actorName: row.actor_name,
      });
    }
  } catch (error) {
    console.error('[ozikoro/site-seo] could not read the site settings:', String(error).slice(0, 200));
  }
  return out;
}

/**
 * A stored string, trimmed, or null.
 *
 * The value column is `jsonb`, so a row written by hand could hold `{"v": "…"}` or a bare JSON string. Both
 * are accepted and anything else is treated as absent — the same tolerance `seo-verification.ts`'s
 * `jsonObject` shows, and for the same reason: a mangled row must not become a page's title.
 */
function storedString(setting: StoredSetting | undefined): string | null {
  if (!setting) return null;
  const value = setting.value;
  const raw =
    typeof value === 'string' ? value
    : value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>).value === 'string'
      ? ((value as Record<string, unknown>).value as string)
      : null;
  if (raw === null) return null;
  const trimmed = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The site identity for this request.
 *
 * **NOTHING STORED RETURNS `EMPTY_SITE_SEO`, WHICH IS TODAY'S BEHAVIOUR.** Every field of it is either the
 * constant the archive already had or null, and `seoHead` treats null as "do not do the new thing".
 */
export function siteSeoFrom(settings: Map<string, StoredSetting>): SiteSeo {
  const name = storedString(settings.get(SITE_NAME_KEY));
  const publisher = storedString(settings.get(PUBLISHER_KEY));
  const tagline = storedString(settings.get(SITE_TAGLINE_KEY));
  const separator = storedString(settings.get(TITLE_SEPARATOR_KEY));
  const template = storedString(settings.get(TITLE_TEMPLATE_KEY));
  const homeTitle = storedString(settings.get(HOME_TITLE_KEY));
  const homeDescription = storedString(settings.get(HOME_DESCRIPTION_KEY));
  return {
    siteName: name ?? EMPTY_SITE_SEO.siteName,
    publisherName: publisher ?? EMPTY_SITE_SEO.publisherName,
    tagline,
    separator: separator ?? DEFAULT_SEPARATOR,
    titleTemplate: template,
    homeTitle,
    homeDescription,
    anySet: Boolean(name || tagline || separator || template || homeTitle || homeDescription || publisher),
  };
}

/** `siteSeoFrom(await loadSiteSeoSettings(db))`, for every caller that wants the whole thing. */
export async function loadSiteSeo(db: Db): Promise<SiteSeo> {
  return siteSeoFrom(await loadSiteSeoSettings(db));
}

/* ================================================================================================
 * 5. THE WRITE PATH — ONE ROW, ONE AUDIT LINE, AND THE SHAPE TESTED BEFORE IT IS WRITTEN
 * ============================================================================================== */

/** A refusal an owner can read, turned into a notice by the endpoint. */
export class SiteSeoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteSeoError';
  }
}

/** The setting keys this module will write, so a caller cannot invent one. */
export const WRITABLE_KEYS: readonly string[] = [
  SITE_NAME_KEY, SITE_TAGLINE_KEY, TITLE_SEPARATOR_KEY, TITLE_TEMPLATE_KEY,
  HOME_TITLE_KEY, HOME_DESCRIPTION_KEY, ROBOTS_DISALLOW_KEY, SITEMAP_GROUPS_KEY, PUBLISHER_KEY,
];

/** What each field is called in a refusal, so the message names the field the owner was looking at. */
const FIELD_LABELS: Record<string, string> = {
  [PUBLISHER_KEY]: 'publisher named in the structured data',
  [ROBOTS_DISALLOW_KEY]: 'robots.txt disallow list',
  [SITEMAP_GROUPS_KEY]: 'sitemap sections',
  [SITE_NAME_KEY]: 'site name',
  [SITE_TAGLINE_KEY]: 'tagline',
  [TITLE_SEPARATOR_KEY]: 'title separator',
  [TITLE_TEMPLATE_KEY]: 'title template',
  [HOME_TITLE_KEY]: 'homepage title',
  [HOME_DESCRIPTION_KEY]: 'homepage meta description',
};

const FIELD_LIMITS: Record<string, number> = {
  [SITE_NAME_KEY]: SITE_NAME_MAX,
  [SITE_TAGLINE_KEY]: TAGLINE_MAX,
  [TITLE_SEPARATOR_KEY]: SEPARATOR_MAX,
  [TITLE_TEMPLATE_KEY]: TITLE_MAX,
  [HOME_TITLE_KEY]: TITLE_MAX,
  [HOME_DESCRIPTION_KEY]: TITLE_MAX,
  [PUBLISHER_KEY]: SITE_NAME_MAX,
};

/**
 * THE TWO SETTINGS THAT ARE LISTS RATHER THAN LINES — `seo.tools.robots.disallow` and
 * `seo.tools.sitemap.groups`.
 *
 * Both are stored as JSON arrays, both are written from one textarea (one entry per line, which is how a
 * person writes a list), and both are **validated against a shape rather than against a list of allowed
 * words**: a robots path must be a rooted path with no wildcard this archive does not serve, and a sitemap
 * group must be one of `SITEMAP_GROUPS`.
 *
 * AN EMPTY LIST IS A REAL SETTING AND IT CLEARS THE ROW — same rule as everywhere else in this file. For
 * robots that means "the archive's own list, unchanged"; for the sitemap it means "every section, unchanged".
 */
export const MAX_LIST_ENTRIES = 60;
export const MAX_LIST_ENTRY_LENGTH = 200;

/** One entry per line, trimmed, blanks dropped. */
export function splitList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * A robots path, as `robots.txt` spells one.
 *
 * IT MUST BE ROOTED AND IT MUST NOT CARRY A WILDCARD OR A QUERY. `Disallow: admin` is a relative path that
 * crawlers resolve differently, `/design/*` needs a wildcard this archive's own robots file does not use
 * anywhere, and a URL with `?` in it is a query rather than a directory. Refusing all three is what makes the
 * value on the screen mean what the server writes.
 */
export function robotsPathProblem(path: string): string | null {
  const value = path.trim();
  if (value.length === 0) return null;
  if (!value.startsWith('/')) {
    return `“${value}” does not begin with a slash. A robots.txt path is rooted — \`/admin\`, not \`admin\` — because a bare word is resolved differently by different crawlers.`;
  }
  if (value.includes('*') || value.includes('?') || value.includes('$')) {
    return `“${value}” contains a wildcard or a query. This archive's robots.txt lists plain directories, so a pattern would be stored and not matched.`;
  }
  if (/\s/.test(value)) {
    return `“${value}” contains a space, so it is not a path.`;
  }
  if (value.length > MAX_LIST_ENTRY_LENGTH) {
    return `“${value.slice(0, 40)}…” is ${value.length} characters, longer than any path this archive disallows.`;
  }
  if (/[<>"']/.test(value)) {
    return `“${value.slice(0, 40)}” contains a character an address cannot carry.`;
  }
  return null;
}

/** Validate one list for its key, or refuse it by name. Returns the cleaned entries, or null when empty. */
function cleanListValue(key: string, raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  const entries = splitList(raw);
  if (entries.length === 0) return null;
  if (entries.length > MAX_LIST_ENTRIES) {
    throw new SiteSeoError(
      `That is ${entries.length} entries. The most this archive stores for one of these lists is ${MAX_LIST_ENTRIES}. Nothing was saved.`
    );
  }
  if (key === ROBOTS_DISALLOW_KEY) {
    for (const entry of entries) {
      const problem = robotsPathProblem(entry);
      if (problem) throw new SiteSeoError(problem);
    }
  }
  if (key === SITEMAP_GROUPS_KEY) {
    const known: readonly string[] = KNOWN_SITEMAP_GROUPS;
    for (const entry of entries) {
      if (!known.includes(entry)) {
        throw new SiteSeoError(
          `“${entry}” is not a section this sitemap has. The sections are: ${KNOWN_SITEMAP_GROUPS.join(', ')}. One per line. Nothing was saved.`
        );
      }
    }
  }
  // Deduplicated, so a doubled line does not write the same entry twice.
  return [...new Set(entries)];
}

/**
 * Clean one value, or refuse it by name.
 *
 * THE TWO REFUSALS THAT MATTER, and each is the shape rather than the escaping:
 *
 *   * a control character — a newline is legal in a `<title>` and is a paste accident, and a NUL never is;
 *   * a value past its field's ceiling, which is the length past which it is not that field at all.
 *
 * `<` and `>` are refused for the title fields and NOT escaped-and-kept, because a title is text: an owner
 * who pastes `<b>Ozikoro</b>` into a title field meant to paste something else, and `seoHead` escaping it
 * would serve the tag's own letters to a search result with no way to tell that is not what was wanted. The
 * verification-token rule, exactly.
 */
export function cleanSettingValue(key: string, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const label = FIELD_LABELS[key] ?? 'value';
  const value = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (value.length === 0) return null;
  const limit = FIELD_LIMITS[key] ?? TAGLINE_MAX;
  if (value.length > limit) {
    throw new SiteSeoError(
      `That ${label} is ${value.length} characters. The longest this archive stores for it is ${limit}, because past that it is not a ${label} — it is a paste of something else. Nothing was saved.`
    );
  }
  if (key !== SITE_TAGLINE_KEY && key !== HOME_DESCRIPTION_KEY && /<|>/.test(value)) {
    return (() => {
      throw new SiteSeoError(`A ${label} is text, not markup, so it cannot contain \`<\` or \`>\`. Nothing was saved.`);
    })();
  }
  if (key === TITLE_TEMPLATE_KEY) {
    const problem = templateProblem(value);
    if (problem) throw new SiteSeoError(problem);
  }
  return value;
}

/**
 * The dispatcher the write path uses: a list for the two list keys, a line for everything else.
 *
 * **ONE ENTRY POINT, SO A CALLER CANNOT PICK THE WRONG VALIDATOR.** `setSiteSeoSetting` calls this and not the
 * two cleaners, which is why the tools keys cannot be written as a paragraph and a title cannot be written as
 * an array.
 */
export function cleanSettingValueFor(key: string, raw: string | null | undefined): string | string[] | null {
  if (key === ROBOTS_DISALLOW_KEY || key === SITEMAP_GROUPS_KEY) return cleanListValue(key, raw);
  return cleanSettingValue(key, raw);
}

/**
 * Store one setting, or clear it by writing null.
 *
 * **A CLEAR IS A DELETE, NOT AN EMPTY ROW** — the same act as never having set it, which is what makes "clear
 * this" and "the archive behaved like this before" the same state. `seo-verification.ts` reached the same
 * decision for a token, and the reason is identical: a row holding an empty string is a second state that
 * every reader would have to know about.
 */
export async function setSiteSeoSetting(
  db: Db,
  input: { key: string; value: string | null | undefined; actorId: number | null; note?: string | null }
): Promise<{ stored: StoredSetting | null; cleared: boolean }> {
  if (input.actorId !== null) await requireCapability(db, input.actorId, SITE_SEO_CAPABILITY);
  if (!WRITABLE_KEYS.includes(input.key)) {
    throw new SiteSeoError('That is not a setting this screen writes. Reload the page and use one of its fields.');
  }

  const before = (await loadSiteSeoSettings(db)).get(input.key) ?? null;
  const value = cleanSettingValueFor(input.key, input.value);

  if (value === null) {
    if (!before) return { stored: null, cleared: false };
    await db.query(`delete from site_setting where key = $1`, [input.key]);
    await audit(db, {
      action: 'clear_site_seo_setting',
      key: input.key,
      before: before.value,
      after: { removed: true },
      actorId: input.actorId,
      note: `Cleared the ${FIELD_LABELS[input.key] ?? input.key}. The archive serves its own default for it again.`,
    });
    return { stored: null, cleared: true };
  }

  await db.query(
    `insert into site_setting (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update
        set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [input.key, JSON.stringify(value), input.actorId]
  );

  await audit(db, {
    action: before ? 'update_site_seo_setting' : 'set_site_seo_setting',
    key: input.key,
    before: before?.value,
    after: value,
    actorId: input.actorId,
    note: input.note ?? `Set the ${FIELD_LABELS[input.key] ?? input.key}.`,
  });

  const stored = (await loadSiteSeoSettings(db)).get(input.key) ?? null;
  return { stored, cleared: false };
}

/**
 * The audit row, written like every other module's: **a failure to write it never fails the change.**
 *
 * `entity_id` is `bigint not null` and `site_setting` has a TEXT primary key and no numeric id, so the actor's
 * own id stands in for a subject that has no number — the same decision, for the same reason, that
 * `seo-verification.ts`'s `audit` records beside its own insert.
 */
async function audit(
  db: Db,
  event: {
    action: string;
    key: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('site_seo_setting', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.actorId ?? 0,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? event.key,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/site-seo] could not record the audit event:', String(error).slice(0, 160));
  }
}

/* ================================================================================================
 * 6. THE REDIRECTS — WHAT A CHANGED ADDRESS LEAVES BEHIND
 * ============================================================================================== */

/**
 * One stored redirect, in the shape the whole map is kept under `seo.redirects`.
 *
 * It is a MAP under one key rather than a row per redirect for one measured reason: **the reader is on the
 * request path.** `loadSiteSeoSettings` already asks for this key once per page, and a map answers "is this
 * address redirected?" with one JSON parse and no second query. A row per redirect would be a second query on
 * every page of the archive to answer a question whose answer is almost always "no".
 */
export interface StoredRedirect {
  /** Where the address goes. Always a rooted path, always with a trailing slash. */
  to: string;
  /** Why it exists, in the owner's or the archive's own words. */
  kind: 'permalink-change' | 'manual';
  /** When it was written, ISO. */
  at: string;
  /** Who wrote it, or null for one the archive itself recorded. */
  by: string | null;
  /** The record the address belonged to, when it belonged to one. */
  articleId?: number | null;
}

/**
 * The shape of a path this archive will store as a redirect.
 *
 * **THE REFUSALS ARE THE POINT AND EACH ONE HAS A REASON:**
 *
 *   * it must begin with exactly one `/` — this is a path on this site, not an address somewhere else;
 *     `//evil.example` is protocol-relative and absolute despite the leading slash, which is the case
 *     `safeRedirectPath` in `redirects.ts` already had to close for `returnTo`;
 *   * no scheme and no host — `https://evil.example` is an open redirect, and a redirect table is the one
 *     place it would be invisible in a browser;
 *   * no backslash, because some browsers normalise it to a forward slash;
 *   * no whitespace, control characters, angle brackets or quotes — all of them are either a paste accident
 *     or an attempt, and a path needs none of them;
 *   * no `/api/` and no `/_next/`, because redirecting those breaks the application rather than a page.
 */
export function pathProblem(path: string, what: 'from' | 'to'): string | null {
  const value = (path ?? '').trim();
  const label = what === 'from' ? 'address to redirect from' : 'address to redirect to';
  if (value.length === 0) return `There is no ${label}.`;
  if (!value.startsWith('/')) return `The ${label} must begin with a slash — it is a path on this site, not an address somewhere else.`;
  if (value.startsWith('//')) return `The ${label} begins with two slashes, which a browser reads as another site's address. Use one.`;
  if (value.includes('\\')) return `The ${label} contains a backslash, which some browsers treat as a slash. Nothing was stored.`;
  if (/\s/.test(value)) return `The ${label} contains a space. An address this archive serves has none — a slug uses hyphens.`;
  if (/[\u0000-\u001f\u007f"<>]/.test(value)) return `The ${label} contains a character an address cannot carry. Nothing was stored.`;
  if (value.length > 300) return `The ${label} is ${value.length} characters, which is longer than any address this archive serves.`;
  if (value.startsWith('/api/') || value.startsWith('/_next/')) return `The ${label} is under ${value.startsWith('/api/') ? '/api/' : '/_next/'}, which is the application rather than a page. Those are never redirected.`;
  return null;
}

/**
 * Normalise a path the way this site serves it: **exactly one leading slash and exactly one trailing slash.**
 *
 * `trailingSlash: true` is what the router serves, so `/ute-okpu` and `/ute-okpu/` are one address with two
 * spellings and the map must hold one key. A path that is already `/` stays `/`.
 */
export function normalisePath(path: string): string {
  const trimmed = (path ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/** The redirect map, as stored. An absent or unreadable row is an empty map — today's behaviour. */
export async function loadRedirects(db: Db): Promise<Record<string, StoredRedirect>> {
  const settings = await loadSiteSeoSettings(db);
  return parseRedirects(settings.get(REDIRECTS_KEY)?.value);
}

/**
 * The stored map, or `{}`.
 *
 * **A MALFORMED ENTRY IS SKIPPED, NOT SERVED.** A redirect whose `to` is not a path this archive would have
 * stored is dropped rather than followed, because a row written by hand — or by an older version of this
 * module — must not become an open redirect that no screen shows.
 */
export function parseRedirects(value: unknown): Record<string, StoredRedirect> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, StoredRedirect> = {};
  for (const [from, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const to = typeof record.to === 'string' ? record.to : '';
    if (pathProblem(from, 'from') || pathProblem(to, 'to')) continue;
    if (normalisePath(from) === normalisePath(to)) continue;
    out[normalisePath(from)] = {
      to: normalisePath(to),
      kind: record.kind === 'permalink-change' ? 'permalink-change' : 'manual',
      at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
      by: typeof record.by === 'string' ? record.by : null,
      articleId: typeof record.articleId === 'number' ? record.articleId : null,
    };
  }
  return out;
}

/** Add or replace one redirect. The map is written whole, because it is read whole. */
export async function setRedirect(
  db: Db,
  input: { from: string; to: string; actorId: number | null; kind?: StoredRedirect['kind']; articleId?: number | null; note?: string | null }
): Promise<{ redirect: StoredRedirect; replaced: StoredRedirect | null }> {
  if (input.actorId !== null) await requireCapability(db, input.actorId, SITE_SEO_CAPABILITY);

  const fromProblem = pathProblem(input.from, 'from');
  if (fromProblem) throw new SiteSeoError(fromProblem);
  const toProblem = pathProblem(input.to, 'to');
  if (toProblem) throw new SiteSeoError(toProblem);

  const from = normalisePath(input.from);
  const to = normalisePath(input.to);
  if (from === to) {
    throw new SiteSeoError('That is the same address it already had, so there is nothing to redirect.');
  }
  if (to.startsWith(`${from}`) && from !== '/') {
    /*
     * A REDIRECT THAT POINTS UNDER ITSELF IS AN INFINITE LOOP, and a browser that follows one is a reader who
     * never reaches a page. `/a/` → `/a/b/` is exactly the shape a typo produces.
     */
    throw new SiteSeoError(`That would send ${from} to an address inside itself (${to}), which is a loop. Nothing was stored.`);
  }

  const existing = await loadRedirects(db);
  if (existing[from]?.kind === 'permalink-change' && input.kind !== 'permalink-change') {
    /*
     * A RECORD'S OLD ADDRESS IS NOT OURS TO RETARGET. See `changeRecordPermalink`: the redirect is what keeps a
     * published address resolving, and an address that silently started pointing somewhere else by hand would
     * break the rule the archive keeps. It has to be removed deliberately first.
     */
    throw new SiteSeoError(
      `${from} is an address a record was moved away from, and its redirect is what keeps it working. Remove that redirect first if you mean to change where it goes.`
    );
  }

  const previous = existing[from] ?? null;
  const next: StoredRedirect = {
    to,
    kind: input.kind ?? 'manual',
    at: new Date().toISOString(),
    by: input.actorId === null ? null : String(input.actorId),
    articleId: input.articleId ?? previous?.articleId ?? null,
  };
  existing[from] = next;
  await writeRedirects(db, existing);

  await audit(db, {
    action: previous ? 'update_redirect' : 'add_redirect',
    key: REDIRECTS_KEY,
    before: previous,
    after: next,
    actorId: input.actorId,
    note: input.note ?? `Redirect ${from} → ${to}.`,
  });

  return { redirect: next, replaced: previous };
}

/** Remove one redirect, so the address stops resolving to somewhere else. */
export async function removeRedirect(
  db: Db,
  input: { from: string; actorId: number | null; note?: string | null }
): Promise<{ removed: StoredRedirect | null }> {
  if (input.actorId !== null) await requireCapability(db, input.actorId, SITE_SEO_CAPABILITY);
  const from = normalisePath(input.from);
  const existing = await loadRedirects(db);
  const removed = existing[from] ?? null;
  if (!removed) return { removed: null };
  delete existing[from];
  await writeRedirects(db, existing);
  await audit(db, {
    action: 'remove_redirect',
    key: REDIRECTS_KEY,
    before: removed,
    after: { removed: true },
    actorId: input.actorId,
    note: input.note ?? `Removed the redirect from ${from}; it no longer resolves anywhere else.`,
  });
  return { removed };
}

/**
 * Write the map.
 *
 * **AN EMPTY MAP DELETES THE ROW**, which is the same "an empty setting is a real setting" rule as everywhere
 * else in this file: the state after removing the last redirect is the state before any existed.
 */
async function writeRedirects(db: Db, redirects: Record<string, StoredRedirect>): Promise<void> {
  const keys = Object.keys(redirects);
  if (keys.length === 0) {
    await db.query(`delete from site_setting where key = $1`, [REDIRECTS_KEY]);
    return;
  }
  const ordered: Record<string, StoredRedirect> = {};
  for (const key of keys.sort()) ordered[key] = redirects[key]!;
  await db.query(
    `insert into site_setting (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), null)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [REDIRECTS_KEY, JSON.stringify(ordered)]
  );
}

/**
 * EVERY INBOUND ADDRESS THAT HAS EVER KEPT WORKING, FOR A READER ON THE REQUEST PATH.
 *
 * Returns "where this goes", or null. **THE CALLER MUST 301 AND NOT SERVE THE DESTINATION AT THE OLD ADDRESS**
 * — a redirected address that answers 200 is two addresses for one page, which is the fault `middleware.ts`
 * already records for `/listen.html`.
 */
export async function redirectFor(db: Db, path: string): Promise<StoredRedirect | null> {
  const redirects = await loadRedirects(db);
  return redirects[normalisePath(path)] ?? null;
}

/* ================================================================================================
 * 7. CHANGING ONE RECORD'S PERMALINK — WHICH IS A REDIRECT, NOT A MOVE
 * ============================================================================================== */

/** The prefixes a record's address may not collide with: a real route's first segment. */
export const RESERVED_FIRST_SEGMENTS: readonly string[] = [
  'topics', 'labels', 'documents', 'author', 'researchers', 'publications', 'entities', 'media',
  'archive', 'folklore', 'search', 'about', 'claims', 'reviews', 'admin', 'attachment', 'design',
  'api', 'clan-towns', 'clans', 'town', 'project', 'sitemap', 'design-screen', 'podcast', 'account',
  'signin', 'join', 'submit', 'contact', 'terms', 'privacy', 'ledger', 'watch', 'listen', 'photographs',
  'publication-file', 'workspace', 'forgot', 'reset', '_next', 'styles',
];

/**
 * A slug, as this archive stores one.
 *
 * The rule is the one WordPress's own `sanitize_title` produces and the importer preserved, **including the
 * percent-encoded form**: one published record's slug is
 * `entrance-to-an-igbo-compound-%c7%b9gwulu-onitsha-1903-1918-herbert-wimberley`, where the percent signs are
 * literally in the column. So `%` is allowed and everything else is the conservative set — which is also what
 * makes a slug safe to write into a canonical URL and a redirect key.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9._~%-]*$/;

/** What is wrong with a proposed slug, or null when it is usable. */
export function slugProblem(slug: string): string | null {
  const value = (slug ?? '').trim();
  if (value.length === 0) return 'There is no new address. A record’s address is its slug.';
  if (value.length > 200) return `That address is ${value.length} characters, which is longer than this archive stores for a slug.`;
  if (!SLUG_PATTERN.test(value)) {
    return 'An address is lowercase letters, digits and hyphens — and the round brackets, percent signs, dots, tildes and underscores WordPress’s own slug rules produce. It cannot contain a space, a slash, a quote or a capital letter.';
  }
  if (RESERVED_FIRST_SEGMENTS.includes(value)) {
    return `“${value}” is a page of this site rather than a record, so a record cannot take that address. Choose another.`;
  }
  return null;
}

/** The record a permalink change is about, as the screen draws it. */
export interface PermalinkRecord {
  id: number;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  /** The address as it is served now, which is the canonical and the sitemap entry. */
  path: string;
  /** True when the address has never been published, so changing it breaks nothing. */
  draft: boolean;
  /** Every address this record has been moved away from, newest first. */
  previous: { from: string; redirect: StoredRedirect }[];
}

/** One record's address and history. Returns null when the id is not a record. */
export async function permalinkRecord(db: Db, articleId: number): Promise<PermalinkRecord | null> {
  const row = await db.one<{ id: number; slug: string; title: string; status: string; published_at: string | null }>(
    `select id, slug, title, status::text as status, published_at::text as published_at
       from ozikoro_article where id = $1`,
    [articleId]
  );
  if (!row) return null;
  const redirects = await loadRedirects(db);
  const path = `/${row.slug}/`;
  const previous = Object.entries(redirects)
    .filter(([, entry]) => entry.articleId === Number(row.id) && normalisePath(entry.to) === normalisePath(path))
    .map(([from, redirect]) => ({ from, redirect }))
    .sort((a, b) => b.redirect.at.localeCompare(a.redirect.at));
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    path,
    draft: row.status !== 'published',
    previous,
  };
}

/**
 * Change one record's address, **and keep the address it was published at resolving.**
 *
 * ── THIS IS THE WHOLE DECISION, AND IT IS THE ARCHIVE'S OWN RULE ─────────────────────────────────────
 *
 *   *"Every record keeps the address it was published at."*
 *
 * So a permalink edit is **not** a move. It is two writes that happen together: the record's `slug` becomes
 * the new one — which is what changes the `<link rel="canonical">`, the sitemap entry and every link this
 * archive builds for the record, because all of them are built from the slug — **and a 301 from the old
 * address to the new one is stored**, which is what keeps a cited, shared, indexed address resolving.
 *
 * A PERMALINK EDITOR THAT CHANGED THE SLUG AND NOTHING ELSE WOULD 404 EVERY PUBLISHED ADDRESS, which is worse
 * than having none, and this archive has burned rounds on exactly that.
 *
 * ── A DRAFT'S ADDRESS CAN SIMPLY MOVE, AND SAYS SO ──────────────────────────────────────────────────
 *
 * A record that has never been published has no published address to keep: nothing cites it, nothing indexed
 * it, and a redirect from an address that never answered would be a redirect nobody asked for. The write
 * still records the change in the audit trail; it stores no redirect, and the returned `redirect` is null.
 *
 * ── WHAT REFUSES ────────────────────────────────────────────────────────────────────────────────────
 *
 *   * a slug another record already holds — a second write to one address is two pages at one URL;
 *   * a slug that is a page of this site — `slugProblem` names the reserved first segments, and it is the
 *     same list `middleware.ts` carries for the attachment fallback;
 *   * a change to the address it already has.
 *
 * The redirect is written FIRST and the slug SECOND, deliberately: if the second write throws, an address
 * that still serves its record has one harmless extra redirect; the other order would leave an address that
 * 404s. **Order is the difference between a no-op and an outage here.**
 */
export async function changeRecordPermalink(
  db: Db,
  input: { articleId: number; slug: string; actorId: number | null; note?: string | null }
): Promise<{
  changed: boolean;
  from: string;
  to: string;
  redirect: StoredRedirect | null;
  title: string;
}> {
  if (input.actorId !== null) await requireCapability(db, input.actorId, SITE_SEO_CAPABILITY);

  const record = await db.one<{ id: number; slug: string; title: string; status: string }>(
    `select id, slug, title, status::text as status from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!record) throw new SiteSeoError('That record does not exist, so no address was changed.');

  const problem = slugProblem(input.slug);
  if (problem) throw new SiteSeoError(problem);
  const next = normalisePath(input.slug).replace(/^\//, '').replace(/\/$/, '');

  const from = `/${record.slug}/`;
  const to = `/${next}/`;
  if (normalisePath(from) === normalisePath(to)) {
    throw new SiteSeoError(`That record is already at ${to}, so there is nothing to change.`);
  }

  const taken = await db.one<{ id: number }>(
    `select id from ozikoro_article where slug = $1 and id <> $2`,
    [next, input.articleId]
  );
  if (taken) {
    throw new SiteSeoError(
      `“${next}” is already the address of another record in this archive. Two records cannot share one address, so nothing was changed — choose another.`
    );
  }

  const previously = await loadRedirects(db);
  const chain = previously[normalisePath(from)] ?? null;
  const wasPublished = record.status === 'published';

  /*
   * A DRAFT MOVES WITHOUT A REDIRECT, AND THAT IS THE RULE RATHER THAN A SHORTCUT: see the header. The
   * address it is moved away from never answered a request.
   */
  if (!wasPublished) {
    await db.query(`update ozikoro_article set slug = $2, modified_at = now() where id = $1`, [input.articleId, next]);
    await audit(db, {
      action: 'record_permalink_changed',
      key: `ozikoro_article:${input.articleId}`,
      before: { slug: record.slug, path: from, published: false },
      after: { slug: next, path: to, published: false, redirect: null },
      actorId: input.actorId,
      note: input.note ?? `Moved the draft “${record.title}” from ${from} to ${to}. It was never published, so no redirect was needed and none was stored.`,
    });
    return { changed: true, from, to, redirect: null, title: record.title };
  }

  let redirect: StoredRedirect | null = null;
  if (chain && chain.kind === 'permalink-change') {
    /*
     * THE RECORD IS BEING MOVED A SECOND TIME. The redirect that was keeping its FIRST address working must be
     * pointed at the new one — otherwise `/a/` → `/b/` → 404 — and this is the one place a chain is collapsed.
     * It is done by rewriting the existing entry, not by adding a second hop, so no address takes two redirects
     * to resolve.
     */
    const merged: Record<string, StoredRedirect> = { ...previously };
    merged[normalisePath(from)] = { ...chain, to, at: new Date().toISOString(), by: input.actorId === null ? null : String(input.actorId) };
    await writeRedirects(db, merged);
    redirect = merged[normalisePath(from)]!;
  } else {
    const written = await setRedirect(db, {
      from,
      to,
      actorId: input.actorId,
      kind: 'permalink-change',
      articleId: input.articleId,
      note: `The record “${record.title}” moved from ${from} to ${to}. The old address keeps resolving.`,
    });
    redirect = written.redirect;
  }

  /*
   * AN EARLIER ADDRESS OF THE SAME RECORD IS RETARGETED TOO, WHICH IS WHAT STOPS A CHAIN FORMING. If `/a/` was
   * redirected to `/b/` and the record now moves to `/c/`, `/a/` must go to `/c/` directly rather than through
   * `/b/` — and `/b/` is the address being redirected by the branch above.
   */
  const earlier = Object.entries(previously).filter(
    ([key, entry]) => entry.articleId === input.articleId && entry.kind === 'permalink-change' && key !== normalisePath(from)
  );
  if (earlier.length > 0) {
    const merged = await loadRedirects(db);
    for (const [key] of earlier) {
      const entry = merged[key];
      if (entry) merged[key] = { ...entry, to, at: new Date().toISOString() };
    }
    await writeRedirects(db, merged);
  }

  await db.query(`update ozikoro_article set slug = $2, modified_at = now() where id = $1`, [input.articleId, next]);

  await audit(db, {
    action: 'record_permalink_changed',
    key: `ozikoro_article:${input.articleId}`,
    before: { slug: record.slug, path: from, published: true },
    after: { slug: next, path: to, published: true, redirect: redirect?.to ?? null },
    actorId: input.actorId,
    note:
      input.note ??
      `Moved the record “${record.title}” from ${from} to ${to}. ${from} now answers 301 to ${to}, so every address ever published for this record still resolves.`,
  });

  return { changed: true, from, to, redirect, title: record.title };
}

/**
 * The published records whose address can be changed, newest first.
 *
 * **A DRAFT IS LISTED TOO AND IS LABELLED.** A record's address is changeable before it is published — that is
 * the cheap moment to fix a bad slug — and the screen says which rows are drafts so the owner can see that a
 * change there stores no redirect because there is nothing to keep resolving.
 */
export async function listPermalinks(
  db: Db,
  options: { search?: string; onlyPublished?: boolean; limit?: number; offset?: number } = {}
): Promise<PermalinkRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: unknown[] = [`%${(options.search ?? '').trim()}%`, limit, offset];
  const conditions = [
    `a.is_page = false`,
    `(a.title ilike $1 or a.slug ilike $1)`,
  ];
  if (options.onlyPublished) conditions.push(`a.status = 'published'`);
  const rows = await db.rows<{ id: number; slug: string; title: string; status: string; published_at: string | null }>(
    `select a.id, a.slug, a.title, a.status::text as status, a.published_at::text as published_at
       from ozikoro_article a
      where ${conditions.join(' and ')}
      order by a.id desc
      limit $2 offset $3`,
    params
  );
  const redirects = await loadRedirects(db);
  return rows.map((row) => {
    const path = `/${row.slug}/`;
    return {
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
      status: row.status,
      publishedAt: row.published_at,
      path,
      draft: row.status !== 'published',
      previous: Object.entries(redirects)
        .filter(([, entry]) => entry.articleId === Number(row.id))
        .map(([from, redirect]) => ({ from, redirect }))
        .sort((a, b) => b.redirect.at.localeCompare(a.redirect.at)),
    };
  });
}

/* ================================================================================================
 * 8. THE TWO TOOL LISTS, AS THE ROUTES THAT SERVE THEM READ THEM
 * ============================================================================================== */

/** A list setting, or `[]`. Anything that is not an array of strings is treated as absent. */
function storedList(setting: StoredSetting | undefined): string[] {
  if (!setting) return [];
  let value: unknown = setting.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}

/**
 * THE PATHS THIS ARCHIVE EXCLUDES FROM CRAWLING FOR ITS OWN REASONS.
 *
 * **NOT EDITABLE FROM ANY SCREEN, AND THAT IS THE DECISION.** Each one is here because leaving it crawlable put
 * either the demonstration content or a private surface into search results: `/design/` is the approved
 * reference and is not the site, `/admin` is the back office, `/signin` and `/search` are forms and result
 * pages, and `/api/` is the application. A setting that could remove one of them would be a setting that could
 * publish the back office, so `seo.tools.robots.disallow` is ADDITIVE — it can say "and also this path", never
 * "not that one". `apps/ozikoro/app/robots.txt/route.ts` writes this list into the served file, and
 * `site-seo.test.ts` asserts the two are the same list.
 */
export const OWN_ROBOTS_DISALLOW: readonly string[] = ['/admin', '/signin', '/search', '/design/', '/api/'];

/** A stored array setting, written by `setSiteSeoSetting` for the two keys that hold lists. */
export async function loadListSetting(db: Db, key: string): Promise<{ entries: string[]; setting: StoredSetting | null }> {
  const settings = await loadSiteSeoSettings(db);
  return { entries: storedList(settings.get(key)), setting: settings.get(key) ?? null };
}

/**
 * THE ROBOTS.TXT PATHS THE OWNER HAS ADDED, ON TOP OF THE ARCHIVE'S OWN.
 *
 * **ADDITIVE, AND THAT IS THE DECISION.** `app/robots.ts` carries six disallows — `/admin`, `/signin`,
 * `/search`, `/design/`, `/api/` — and each exists because leaving it crawlable put the demonstration
 * content or a private surface into search results. A setting that REPLACED the list would let a screen
 * un-disallow `/admin` by being empty, which is the one outcome this must not have. So an empty setting is
 * the archive's own list unchanged, and a stored entry is one more path.
 */
export async function loadRobotsDisallow(db: Db): Promise<string[]> {
  const { entries } = await loadListSetting(db, ROBOTS_DISALLOW_KEY);
  return entries.filter((entry) => robotsPathProblem(entry) === null);
}

/**
 * WHICH SITEMAP SECTIONS THE INDEX LISTS. Empty means all of them — today's behaviour.
 *
 * The selection can only ever NARROW what `listIndexableUrls` returns: a name not in `SITEMAP_GROUPS` is
 * ignored here and refused at the write path, so nothing on a screen can invite a crawler to a section this
 * archive does not generate.
 */
export async function loadSitemapGroups(db: Db): Promise<string[]> {
  const { entries } = await loadListSetting(db, SITEMAP_GROUPS_KEY);
  const known = entries.filter((entry) => (KNOWN_SITEMAP_GROUPS as readonly string[]).includes(entry));
  return known.length > 0 ? known : [];
}
