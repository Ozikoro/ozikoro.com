import { SITE_ORIGIN } from './seo.ts';

/**
 * The document head, generated for every page the archive serves.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The deliverable's screens are complete HTML documents with their own `<head>`, written for a design
 * walkthrough. **Served as the site, every one of them announced itself as the demo.** An article about
 * Ute-Okpu carried `<title>Nwagu Aneke — Ozikoro article reader</title>` — the example title from
 * `article.html` — with the example description beside it, **no canonical, no Open Graph, no structured data,
 * and no citation metadata at all.**
 *
 * That is invisible in a browser and fatal in a search engine: **every page in an archive of 1,051 histories
 * was telling Google it was the same demonstration page.**
 *
 * WHAT REPLACES IT
 *
 * The design's `<head>` is REPLACED wholesale, for the same reason its links are absolutised: **the served
 * document is not the walkthrough.** The stylesheet links and the font preconnects are re-declared here, so
 * nothing the design needs is lost.
 *
 * WHAT IS EMITTED, AND WHY EACH IS HERE
 *
 *   title, description, canonical, robots        the four things a crawler reads first
 *   Open Graph and Twitter cards                 what a shared link looks like
 *   JSON-LD, one @graph                          see below
 *   Highwire `citation_*`                        **Google Scholar reads these and nothing else.**
 *
 * THE CITATION META IS THE PART WORTH ARGUING FOR
 *
 * Yoast does not emit Highwire tags. **An archive whose register is "library and university press, never a
 * blog" is invisible to Scholar without them**, and the whole citation apparatus — permanent addresses,
 * authors, dates, reference numbers — exists to be cited. `<meta name="citation_title">` and its siblings are
 * twenty-year-old, undramatic, and the only route into the index that matters for this material.
 *
 * THE GRAPH
 *
 * One `@graph` rather than several script tags, so the nodes reference each other by `@id`:
 *
 *   Organization      Ozi Ikoro Limited, the publisher
 *   WebSite           with the SearchAction that makes a sitelinks searchbox possible
 *   WebPage/Article   the record itself, `isPartOf` the site and `publisher` the organization
 *   Person            the named author, when one is recorded
 *   ImageObject       the lead image, when the record has one
 *   BreadcrumbList    so a result can show the path rather than a bare URL
 *
 * **Nothing here is invented.** Every value comes from the record or is omitted.
 */

export const PUBLISHER = 'Ozi Ikoro Limited';
export const SITE_NAME = 'Ozikoro';

/** HTML-escape for an attribute value. */
function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Trim to a length a search result will show, without cutting mid-word. */
function clamp(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.]$/, '')}…`;
}

export type SeoRecord = {
  /** The clean path, e.g. `/ute-okpu-…/`. */
  path: string;
  title: string;
  description: string | null;
  /** `article`, `website`, `profile`, `place` — decides the @type and the og:type. */
  kind: 'article' | 'page' | 'place' | 'list' | 'profile';
  published?: string | null;
  updated?: string | null;
  author?: string | null;
  /** Absolute URL of the lead image. */
  image?: string | null;
  imageAlt?: string | null;
  /** The record's own reference, e.g. `OZ-H-0000`. */
  reference?: string | null;
  /** Breadcrumb, outermost first. The last item is the page itself. */
  trail?: { name: string; path: string }[];
  /** Topic names, which become `about` and the keywords. */
  topics?: string[];
  /** Suppress indexing — for a dashboard or a search page. */
  noindex?: boolean;
  /**
   * Further nodes for the graph, for a page that describes more than itself.
   *
   * `/towns` is a list of 188 places and `/photographs` is a collection of images with rights on each. **Those
   * are facts about the page's subject, not about the page**, and a second `seoHead` would be a second
   * definition of the site's own identity. So the graph takes extra nodes rather than the function taking
   * extra callers.
   */
  extraNodes?: Record<string, unknown>[];
};

const OG_TYPE: Record<SeoRecord['kind'], string> = {
  article: 'article',
  page: 'website',
  place: 'place',
  list: 'website',
  profile: 'profile',
};

const SCHEMA_TYPE: Record<SeoRecord['kind'], string> = {
  article: 'Article',
  page: 'WebPage',
  place: 'Place',
  list: 'CollectionPage',
  profile: 'ProfilePage',
};

/**
 * The owner's design overrides, as a stylesheet, LAST IN THE HEAD.
 *
 * WHY IT IS APPENDED HERE RATHER THAN PASSED IN BY EACH CALLER
 *
 * `@import url("../tokens.css")` sits at the top of `main.css`, so the design's custom properties are in the
 * cascade before anything else. An override of `--accent` wins only if it is declared after them, and "after"
 * here means **after every sheet the caller named** — so the theme sheet is appended to the list rather than
 * inserted into it, and a caller cannot accidentally put a sheet behind it.
 *
 * IT IS HERE RATHER THAN IN ONE ROUTE BECAUSE THE COLOURS ARE NOT ONE ROUTE'S. `design-screen` serves the
 * fifty-two design screens and `[slug]` serves every article from the same deliverable, and the owner's
 * expectation of "change the accent" is that the accent changes — not that it changes on the screens he
 * happened to be looking at while the 1,051 records keep the old palette. This function is where both routes'
 * heads are made, so both get it, and a third route added later gets it by using the same function.
 *
 * `/design-theme.css` answers `text/css` and is generated from the database at request time; when no token is
 * overridden it returns an empty ruleset, which costs one cached request and changes nothing.
 */
export const DESIGN_THEME_HREF = '/design-theme.css';

/**
 * The whole `<head>` for a record.
 *
 * `styles` is passed in rather than hard-coded so the caller decides which sheets the page needs — **the design
 * loads `main.css` and `showcase.css`, and a page that loaded them twice would be a rendering fault rather than
 * an SEO one.** The design-override sheet is appended rather than left to the caller, for the reason above.
 */
export function seoHead(record: SeoRecord, styles: string[]): string {
  const url = `${SITE_ORIGIN}${record.path}`;
  const title = clamp(record.title, 60);
  const description = clamp(
    record.description ?? `${record.title} — a record in the Ozikoro archive of Igbo and African histories.`,
    158
  );

  const nodes: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': `${SITE_ORIGIN}/#organization`,
      name: PUBLISHER,
      url: `${SITE_ORIGIN}/`,
      /*
       * The sites are one publisher, and saying so is what lets a search engine connect them.
       *
       * `learn.ozituma.com` WAS THE THIRD ENTRY AND IT IS DELETED RATHER THAN REPLACED. A `sameAs`
       * asserts that two addresses are the same entity, and it is read by machines that will fetch
       * both. `academy.ozikoro.com` has no record in its zone, so naming it here would assert a
       * relationship with a host that does not answer — the one thing this property cannot mean.
       * It goes back when the academy is live, in the change that brings it live.
       */
      sameAs: ['https://ozituma.com/'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  const page: Record<string, unknown> = {
    '@type': SCHEMA_TYPE[record.kind],
    '@id': `${url}#page`,
    url,
    name: title,
    description,
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    inLanguage: 'en',
  };
  if (record.published) page.datePublished = record.published;
  if (record.updated) page.dateModified = record.updated;
  if (record.topics?.length) {
    page.about = record.topics.map((t) => ({ '@type': 'Thing', name: t }));
  }
  if (record.reference) {
    // The archive's own identifier, on the record rather than in a comment.
    page.identifier = record.reference;
  }
  if (record.author) {
    page.author = { '@type': 'Person', name: record.author };
    nodes.push({ '@type': 'Person', '@id': `${url}#author`, name: record.author });
  }
  if (record.image) {
    page.image = { '@type': 'ImageObject', url: record.image, caption: record.imageAlt ?? title };
  }
  for (const extra of record.extraNodes ?? []) nodes.push(extra);
  nodes.push(page);

  const trail = record.trail ?? [];
  if (trail.length > 1) {
    nodes.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: trail.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.name,
        item: `${SITE_ORIGIN}${item.path}`,
      })),
    });
  }

  const og: string[] = [
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:locale" content="en">`,
    `<meta property="og:type" content="${OG_TYPE[record.kind]}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${record.image ? 'summary_large_image' : 'summary'}">`,
  ];
  if (record.image) {
    og.push(`<meta property="og:image" content="${esc(record.image)}">`);
    if (record.imageAlt) og.push(`<meta property="og:image:alt" content="${esc(record.imageAlt)}">`);
  }
  if (record.published) og.push(`<meta property="article:published_time" content="${esc(record.published)}">`);
  if (record.updated) og.push(`<meta property="article:modified_time" content="${esc(record.updated)}">`);
  if (record.author) og.push(`<meta property="article:author" content="${esc(record.author)}">`);
  for (const t of record.topics ?? []) og.push(`<meta property="article:tag" content="${esc(t)}">`);

  /*
   * THE HIGHWIRE TAGS, WHICH GOOGLE SCHOLAR READS AND NOTHING ELSE DOES.
   *
   * A record with an author, a date and a permanent address is citable material. **Without these it is a web
   * page; with them it is an indexed source.** They are emitted whenever the record has the corresponding
   * value and skipped when it does not, because a `citation_author` with nothing in it is worse than none.
   */
  const citation: string[] = [];
  if (record.title) citation.push(`<meta name="citation_title" content="${esc(record.title)}">`);
  if (record.author) citation.push(`<meta name="citation_author" content="${esc(record.author)}">`);
  if (record.published) {
    citation.push(`<meta name="citation_publication_date" content="${esc(record.published.slice(0, 10))}">`);
  }
  citation.push(`<meta name="citation_public_url" content="${esc(url)}">`);
  citation.push(`<meta name="citation_publisher" content="${esc(PUBLISHER)}">`);
  citation.push(`<meta name="citation_language" content="en">`);
  if (record.reference) citation.push(`<meta name="citation_technical_report_number" content="${esc(record.reference)}">`);

  const robots = record.noindex
    ? `<meta name="robots" content="noindex, follow">`
    : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`;

  /*
   * THE DESIGN'S OWN SHEETS, THEN THE OWNER'S OVERRIDES. `DESIGN_THEME_HREF` is appended and never inserted,
   * because a declaration only wins against the custom property it overrides by coming later in the cascade.
   */
  const sheets = [...styles, DESIGN_THEME_HREF]
    .map((href) => `<link rel="stylesheet" href="${esc(href)}">`)
    .join('\n');

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(record.title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${robots}
${og.join('\n')}
${citation.join('\n')}
${sheets}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Noto+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Noto+Sans+Mono:wght@400;600&display=swap">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })}</script>`;
}

/**
 * Replace a design document's `<head>` contents with the generated one.
 *
 * **The design's own `<head>` is discarded, not appended to.** Appending would leave the demonstration title in
 * place and add a second one after it, and a document with two `<title>` elements is a document whose title is
 * the first — which is the demo's.
 *
 * A `<base>` IS THE ONE THING KEPT, AND IT WAS BEING THROWN AWAY.
 *
 * `fillDashboardLinks` inserts `<base href="/">` so the design's own relative links (`home.html`,
 * `dashboard-account.html`) resolve against the site root rather than against the served directory. This
 * function then replaced the whole `<head>` and **deleted it** — so the mechanism was documented, asserted in
 * the report, and not actually present in any served page. Measured afterwards on the running site:
 * `/dashboard-reader/`, `/dashboard-admin/`, `/archive/` all carried `base=0`, and `/archive-index/` served
 * three links to `about.html#…` that resolved to `/archive-index/about.html#…` and 404'd.
 *
 * A `<base>` is not part of the head's *metadata* — it is a resolution rule for the rest of the document — so
 * it is carried across and the generated head is inserted after it.
 */
export function withSeoHead(html: string, head: string): string {
  const base = html.match(/<base\s[^>]*>/)?.[0] ?? '';
  return html.replace(
    /<head>[\s\S]*?<\/head>/,
    `<head>\n${base ? `${base}\n` : ''}${head}\n</head>`
  );
}

/**
 * A `Place` node for a town or clan in the archive.
 *
 * **NO COORDINATES ARE EMITTED, AND THAT IS THE POINT.** The archive holds 188 places, each with a name, a
 * region, an ethnic group and an origin summary. **It holds no latitude and no longitude for any of them** —
 * the clan records carry none, and inventing a pair would put a pin on a map that looks like evidence. **A
 * fabricated coordinate is the most convincing kind of invented content there is**, because it renders.
 *
 * `containedInPlace` is used where a region is recorded, because that is a real relationship from the data, and
 * a search engine can resolve a region name without a coordinate beside it.
 */
export function placeNode(place: {
  name: string;
  url: string;
  region?: string | null;
  ethnicGroup?: string | null;
  description?: string | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@type': 'Place',
    '@id': `${place.url}#place`,
    name: place.name,
    url: place.url,
  };
  if (place.region) {
    node.containedInPlace = { '@type': 'AdministrativeArea', name: place.region };
  }
  if (place.ethnicGroup) {
    node.additionalProperty = { '@type': 'PropertyValue', name: 'Ethnic group', value: place.ethnicGroup };
  }
  if (place.description) node.description = place.description;
  return node;
}

/**
 * An `ImageObject` node for a photograph, **carrying the rights state the archive actually recorded.**
 *
 * THE LICENCE FIELD IS THE POINT
 *
 * `license`, `creditText` and `creator` are how schema.org expresses an image's reuse terms. **For all 3,750
 * media records this archive holds, `licence` is null and the rights basis is `unknown`** — the migration
 * carried no rights fields and the register states that plainly.
 *
 * **So no `license` property is emitted at all.** Emitting one would assert a licence that does not exist, and
 * a search engine — or a person reading the structured data — would take it as permission. **The absence is the
 * accurate statement, and it is a statement rather than an omission because `copyrightNotice` says why.**
 */
export function imageNode(photo: {
  url: string;
  contentUrl: string;
  caption?: string | null;
  creator?: string | null;
  credit?: string | null;
  licence?: string | null;
  datePublished?: string | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@type': 'ImageObject',
    '@id': `${photo.url}#image`,
    url: photo.url,
    contentUrl: photo.contentUrl,
    representativeOfPage: true,
  };
  if (photo.caption) node.caption = photo.caption;
  if (photo.creator) node.creator = { '@type': 'Person', name: photo.creator };
  if (photo.credit) node.creditText = photo.credit;
  if (photo.datePublished) node.datePublished = photo.datePublished;
  // A licence is emitted ONLY when one is recorded. There are none in this archive, and saying so is the point.
  if (photo.licence) {
    node.license = photo.licence;
  } else {
    node.copyrightNotice = 'No licence recorded. Reuse not granted. Held by Ozi Ikoro Limited.';
  }
  return node;
}
