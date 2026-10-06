/**
 * The sections of `/admin/seo/`, in the order the owner named them.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN A LIST PER SCREEN ───────────────────────────────────────────────
 *
 * The owner's report has two halves, and the second is *"everything must not show on same page"*. Six screens
 * now carry the same nav (see the `Tabs` primitive in `app/admin/ui.tsx`), and **a list typed into each of the
 * six is a list where the day one section is renamed is the day the nav on the page it names still says the
 * old word.** One array here, read by all of them.
 *
 * The order is not alphabetical: it is the order he named them in — the permalink, the homepage title and the
 * site name first — so the first two things on the index are the two he asked for by name.
 *
 * ── `built`, WHICH IS THE HONEST FIELD ──────────────────────────────────────────────────────────────
 *
 * The old `/admin/seo/` carried a paragraph of things it did not do, and the fault this brief exists to
 * prevent is a screen claiming completeness while omitting half. So every section states whether it does the
 * thing, and the index prints that state beside it — including for the sections that are deliberately not
 * built. `built: false` is a real value and the index says so in words.
 */

/** One section of the search-engine area: where it is, what it does, and whether it does it. */
export interface SeoSection {
  /** The path under `/admin/seo/`. */
  slug: string;
  /** The nav label. */
  label: string;
  /** The `<h1>` of its own screen. */
  title: string;
  /** One line, for the index and the nav's title attribute. */
  summary: string;
  /**
   * Whether the section does what it names.
   *
   * `false` is not a failure state — it is the archive declining to pretend, and the index draws it as
   * "not built here" with the reason in `notBuilt`.
   */
  built: boolean;
  /** What is deliberately absent and why, when `built` is false or when the section is partial. */
  notBuilt?: string;
}

/**
 * THE SECTIONS. The permalink and the site identity are first, because those are the two he named.
 */
export const SEO_SECTIONS: readonly SeoSection[] = [
  {
    slug: 'permalinks',
    label: 'Permalinks',
    title: 'Permalinks and addresses',
    summary: 'The address a record is served at, and changing it without breaking the old one.',
    built: true,
    notBuilt:
      'The address SHAPE — a pattern such as /%category%/%postname%/ — is not configurable, and that is a decision rather than an omission: every address this archive has ever published is `/‹slug›/`, 1,057 of them were cited at that shape, and a pattern setting would be a way to move all of them at once without redirects.',
  },
  {
    slug: 'titles',
    label: 'Titles & meta',
    title: 'Titles, the site name and the tagline',
    summary: 'The homepage title and description, the site name, the separator, and the template a page title is built from.',
    built: true,
    notBuilt:
      'The per-record title and description editor is built and lives on its own screen — “Record search results”, linked from the search-engine index — because it is one editor’s decision about one record rather than a site-wide default. There is no keyword or readability analysis: this archive has no keyphrase field to score against, and inventing one would be inventing the measurement.',
  },
  {
    slug: 'social',
    label: 'Social',
    title: 'Open Graph and Twitter cards',
    summary: 'What a shared link looks like, and the front page’s own card.',
    built: true,
    notBuilt:
      'Per-record social images are not settable here: a record’s card image is its featured image, which is chosen where the record is edited, and a second field pointing at a second image would be a way for a page to show one photograph and its card another.',
  },
  {
    slug: 'schema',
    label: 'Schema',
    title: 'Structured data',
    summary: 'The publisher named in the JSON-LD graph, and what each kind of page declares itself to be.',
    built: true,
    notBuilt:
      'The node types themselves are generated per record kind and are not editable: an `Article` that an owner could re-type as a `Recipe` is a page lying to a machine. The graph is built in `seo-head.ts`, and this screen names what it emits per kind rather than offering to change it.',
  },
  {
    slug: 'tools',
    label: 'Tools',
    title: 'robots.txt, the sitemap and redirects',
    summary: 'The crawler rules, which sitemap sections are listed, and every address that has been redirected.',
    built: true,
    notBuilt:
      'The archive’s own six robots.txt disallows and the sitemap’s address list are not editable — see the section for why each is a decision rather than a setting.',
  },
  {
    slug: 'verification',
    label: 'Verification',
    title: 'Search-engine verification',
    summary: 'The per-engine tokens: paste what Search Console, Bing and the rest gave you.',
    built: true,
  },
];

/** The nav links every section screen draws, and the index's own list. */
export function seoSectionHref(slug: string): string {
  return `/admin/seo/${slug}/`;
}
