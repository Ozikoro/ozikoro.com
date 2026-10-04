/**
 * `/contact/` — the address the draft "Contact Us" page was going to occupy.
 *
 * THE THREE FACTS THIS ROUTE IS BUILT ON
 *
 * 1. **WordPress held page 3591 as a DRAFT.** It was never published at any address, so the owner's rule
 *    that "every record keeps the address it was published at" does not by itself put anything here. The
 *    address `/contact/` is the one the record would take if it were published — `legacy_url` — and three
 *    PUBLISHED `wpc9_nav_menu_item` rows pointed at it, so readers were being sent to it.
 * 2. **The archive's rule is that an imported record keeps the state its source held.** WordPress said
 *    draft; the row is `review`; `published_at` is NULL. This route does not change that and must not.
 * 3. **`body_html` holds the owner's own words verbatim**, including the Contact Form 7 shortcode,
 *    because stripping it would be editing the record. What is decided here is the DISPLAY, not the record.
 *
 * WHAT IS SERVED, AND WHY
 *
 * A page at `/contact/` that answers 200, carries the two addresses the OWNER wrote
 * (`contact@ozikoro.com` and `stories@ozikoro.com`, read out of the row rather than typed here), lists
 * the social accounts the body holds, and says plainly that the contact form is not part of this
 * platform. **The shortcode is not rendered as a form**: `<form>` was never in the body, so there is no
 * form markup to render, and the Contact Form 7 plugin does not exist here. Printing it as a working form
 * would be a fabrication, and printing the raw shortcode would be gibberish; it becomes the note below.
 *
 * WHY NOT LEAVE IT A 404
 *
 * That was the alternative and it is defensible on the address rule alone. It loses to three published
 * menu items and to the owner's own instruction that every write is retained and reachable. **How to undo
 * this is one edit, named so it is not a trap:** drop the `status` clause from the query below and the
 * route stops matching, which returns `/contact/` to a 404.
 *
 * WHY THE PROSE IS NOT TAKEN FROM THE DRAFT BODY
 *
 * Rendering the whole body would publish a draft in substance while calling it `review` in the database,
 * and the body's heading structure ("General Inquiries", "Article Submissions") is written as published
 * copy rather than as a note about a page that is not open. What is shown instead is a statement of the
 * ACTUAL state plus the record's own contact details. **Nothing is invented**: the addresses and the
 * social accounts are matched out of `body_html`; if the pattern finds nothing the page says so rather
 * than printing an empty list.
 */
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

/** The record's WordPress id. Named rather than looked up by slug, so a slug collision cannot serve the wrong row. */
const WP_PAGE_ID = 3591;

const MAIN_CSS = '/design/styles/main.css';
const SHOWCASE_CSS = '/design/styles/showcase.css';

interface ContactRow {
  id: number;
  slug: string;
  title: string;
  body_html: string | null;
  status: string;
  modified_at: Date | null;
  legacy_url: string | null;
}

/** Every `name@host` the record's own body holds. Nothing is composed and nothing is defaulted. */
function addressesIn(html: string): string[] {
  const found = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

/**
 * The external accounts the body links to, by their own host and the text beside them.
 *
 * The body writes some accounts as plain text (`@OziIkoro` for Instagram, X, TikTok) and two as links, so
 * this reads the anchors it has and reports the host it can actually verify. A plain-text handle is NOT
 * turned into a URL: `@OziIkoro` does not say which host it belongs to, and guessing one is inventing a link.
 */
function linksIn(html: string): { href: string; host: string }[] {
  const out: { href: string; host: string }[] = [];
  for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/gi)) {
    const href = m[1]!;
    try {
      const host = new URL(href).host.replace(/^www\./, '');
      if (!out.some((l) => l.href === href)) out.push({ href, host });
    } catch {
      // A URL the platform cannot parse is not reported as a link.
    }
  }
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, headline: string, inner: string, extraHead: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${extraHead}
<link rel="stylesheet" href="${MAIN_CSS}">
<link rel="stylesheet" href="${SHOWCASE_CSS}">
</head>
<body class="sx-reading-body"><main id="article"><article class="sx-book-reader">
<header class="sx-article-opening"><div class="sx-article-title">
<p class="eyebrow">Contact</p><h1>${escapeHtml(headline)}</h1>
</div></header>
<section class="sx-section"><div class="wrap">${inner}</div></section>
</article></main></body></html>`;
}

export async function GET(): Promise<Response> {
  const db = await getDb();

  /*
   * THE STATUS CLAUSE IS THE DECISION, AND IT IS DELIBERATELY NARROW: `review` and `draft` only. If the
   * owner publishes this page, `status` becomes `published`, this route stops matching, and `/contact/` is
   * served by `app/[slug]/route.ts` — the article route — with no change to the address.
   */
  const row = await db.one<ContactRow>(
    `select id, slug, title, body_html, status, modified_at, legacy_url
       from ozikoro_article
      where wp_post_id = $1 and is_page = true and status in ('draft', 'review')`,
    [WP_PAGE_ID]
  );

  if (!row) {
    /*
     * THE HONEST ABSENCE. This route exists because of one record; if that record is gone or has been
     * published, saying so at the address is better than a notice that claims a page is pending when it
     * is not. A reader gets the same 404 the archive gives for anything it does not hold.
     */
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const body = row.body_html ?? '';
  const addresses = addressesIn(body);
  const links = linksIn(body);

  const addressList = addresses.length > 0
    ? `<ul>${addresses.map((a) => `<li><a href="mailto:${escapeHtml(a)}">${escapeHtml(a)}</a></li>`).join('')}</ul>`
    : '<p class="muted">The record holds no email address.</p>';

  const linkList = links.length > 0
    ? `<ul>${links.map((l) => `<li><a href="${escapeHtml(l.href)}" rel="noopener">${escapeHtml(l.host)}</a></li>`).join('')}</ul>`
    : '<p class="muted">The record holds no external link.</p>';

  const inner = `
<p class="sx-notice">This page is not open yet. The record behind it is held in the archive as an
unpublished draft — it was never live on ozikoro.com — and it is shown here so that the address
readers were sent to answers rather than 404s. <strong>The contact form is not set up:</strong> the
draft used a WordPress plugin this platform does not have, and no form has been invented in its place.
The addresses below are the ones the record itself states.</p>
<h2>Email</h2>
${addressList}
<h2>Elsewhere</h2>
${linkList}
<p class="small muted">Record OZ-PAGE-${String(row.id).padStart(4, '0')} · held in the archive as
“${escapeHtml(row.title)}” · WordPress page ${WP_PAGE_ID} · state <code>${escapeHtml(row.status)}</code>${
    row.modified_at ? ` · last edited ${new Date(row.modified_at).toISOString().slice(0, 10)}` : ''
  }.</p>`;

  /*
   * THE CANONICAL IS THE ADDRESS THAT WILL HOLD THE PAGE WHEN IT IS PUBLISHED, and the robots directive is
   * `noindex` because an unpublished record must not be indexed. **A 200 that a search engine files as
   * published content would be the one outcome worse than the 404 this replaces.**
   */
  const canonical = `https://ozikoro.com${row.legacy_url ?? `/${row.slug}/`}`;
  const extraHead = `<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="description" content="Contact addresses held in the Ozikoro archive. The contact page is an unpublished draft.">`;

  return new Response(page('Contact — Ozikoro', row.title, inner, extraHead), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // No store: the row's state is the answer, and a published page must stop being served from this route.
      'cache-control': 'no-store',
    },
  });
}
