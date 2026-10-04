/**
 * One record, served through the design's reading page.
 *
 * WHY A ROUTE HANDLER RATHER THAN A PAGE
 *
 * The deliverable is a complete HTML document — its own masthead, its own footer, its own stylesheets — and a
 * Next page renders inside the application's layout, which would wrap the design in chrome that is not the
 * design. **A route handler can return the design's own document, filled.** That is the same reason the other
 * screens go through `design-screen`.
 *
 * WHAT IS PRESERVED FROM THE PAGE THIS REPLACES
 *
 *   - A category address that collides with the article's own is redirected to `/topics/<slug>/`
 *     (round 74 found 27 in-body links doing exactly this across 91 articles).
 *   - A slug that is neither an article nor a topic is a 404.
 *
 * WHAT THE DESIGN GETS
 *
 * The record's own title, topic, author, dates, **featured image**, body, and other records from the same
 * topic as related reading. **The image is the whole point:** 1,049 of the archive's 1,053 published records
 * carry one, and a reading page without it is not what ozikoro.com looked like.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, type Db } from '@ozituma/db/client';
import { fillArticle, mediaPath, mediaUrlResolver, rewriteBodyImages, seoHead, withSeoHead, designScriptPaths, designScreenLinks, can, withStoredDesignOverrides, playableEpisodeAudioSql, SITE_ORIGIN, type RealArticle } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

const SCREEN = join(process.cwd(), 'public', 'design', 'screens', 'article.html');

/**
 * THE FORM WORDPRESS STORES A SLUG IN WHEN THE TITLE IT CAME FROM HAS A NON-ASCII LETTER.
 *
 * `sanitize_title()` runs the title through `utf8_uri_encode()`, which writes every byte of every
 * non-ASCII character as a lowercase `%xx` — so the attachment-title page whose title contains `ǹ` was
 * published at `/entrance-to-an-igbo-compound-%c7%b9gwulu-onitsha-1903-1918-herbert-wimberley/` and the
 * **percent signs are part of the slug in the database**, not an encoding of it. `post_name` in the dump
 * holds them literally, and so does the record's `slug` and its `legacy_url`.
 *
 * **AND NEXT DECODES THE PATH BEFORE ROUTING.** `params.slug` therefore arrives as
 * `…-ǹgwulu-…`, which is not equal to the stored `…-%c7%b9gwulu-…`, so the record's own published
 * address answered **404 while the row, the body and the slug were all in the cluster**. Measured on the
 * served site before this: 1 of the 1,057 published WordPress addresses, and the only one that is a post.
 *
 * The round trip is exact because UTF-8 is: re-encoding the decoded slug reproduces the stored one byte
 * for byte. There is exactly one such slug among the 1,051 published records.
 */
function wordpressUriEncode(slug: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(slug)) {
    out += byte < 0x80 ? String.fromCharCode(byte) : `%${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** The record's own title, escaped before it is written into markup this route composes itself. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A PUBLISHED WORDPRESS PAGE, SERVED AT ITS OWN ADDRESS FROM ITS OWN ROW.
 *
 * A page is not a record: every archive query excludes `is_page = true` on purpose (migration 0036), so a
 * page that no design screen draws had no address at all. `/about/` and `/home/` answer because
 * `middleware.ts` rewrites them to the deliverable's own screens; `/authors/` and `/privacy-policy/` are
 * 301s to the directory and the notice that replaced them. **`/nze/` is neither** — its content is a
 * complete, self-contained HTML document that no screen draws and no other page holds — so it is served
 * here, which is what the owner's rule asks for: *"every record keeps the address it was published at."*
 *
 * WHAT IS RETURNED IS THE RECORD'S OWN BYTES. `body_html` is carried verbatim, exactly as WordPress
 * published it, because this is a published page and not a draft: the display does not withhold, rewrite
 * or paraphrase any of it. Two things are decided here rather than taken from the row:
 *
 *   * **A PAGE WITH NO CONTENT IS NOT A PAGE**, and it returns `null` so the address stays a 404.
 *     WordPress page 11024, "Construction", holds 0 bytes, 0 words, `_elementor_data` `[]` and
 *     `_elementor_css` `status: empty`. Inventing a notice for it would be inventing the page.
 *   * **AN `<h1>` IS ADDED ONLY IF THE BODY HAS NONE**, because the archive's accessibility rule is one
 *     `<h1>` per page. `/nze/`'s own document carries one, so it is used as it stands; a page written as
 *     plain prose would otherwise have no heading at all. That is a measurement of the body, not a guess
 *     about it.
 *
 * The head is the archive's own `seoHead(…, kind: 'page')`, so the canonical is the record's real
 * address and the JSON-LD is the same graph every other page carries. The body's images go through the
 * same `rewriteBodyImages` resolver the articles use, so a page cannot be the one place an old-site
 * address survives.
 *
 * **AND THE `<body>` CARRIES NO CLASS, WHICH IS A DECISION AND WAS MEASURED.** The archive's reading pages
 * wear `.sx-reading-body`, and `showcase.css` gives that class `background:#fff`. `/nze/`'s own document
 * sets `body { background: radial-gradient(…) }` — and a CLASS beats a TYPE selector whatever the document
 * order, so the archive's white would have painted over the record's own page and the browser probe read
 * `body background-image: none`. **WordPress served the record's gradient**, because a theme's body rule
 * and the record's are both `body` and the later one wins. So the class is dropped, the record's own
 * styling stands, and `main.css` still gives a page that has none of its own the site's typography.
 */
async function servePublishedPage(db: Db, slug: string): Promise<Response | null> {
  const page = await db.one<{
    id: number; slug: string; title: string; body_html: string | null; legacy_url: string | null;
    published_at: Date | null; modified_at: Date | null;
  }>(
    `select id, slug, title, body_html, legacy_url, published_at, modified_at
       from ozikoro_article
      where status = 'published' and is_page = true and (slug = $1 or slug = $2)`,
    [slug, wordpressUriEncode(slug)]
  );

  const body = page?.body_html ?? '';
  if (!page || body.trim() === '') return null;

  const resolveImage = await mediaUrlResolver(db);
  const content = rewriteBodyImages(body, resolveImage);
  const path = page.legacy_url ?? `/${page.slug}/`;
  const hasHeading = /<h1[\s>]/i.test(content);

  const document = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(page.title)}</title>
</head><body>
${
    hasHeading
      ? ''
      : `<main id="article"><article class="sx-book-reader"><header class="sx-article-opening"><div class="sx-article-title"><p class="eyebrow">Page</p><h1>${escapeText(page.title)}</h1></div></header></article></main>`
  }
${content}
</body></html>`;

  return new Response(
    withSeoHead(
      document,
      seoHead(
        {
          path,
          title: page.title,
          description: null,
          kind: 'page',
          published: page.published_at ? new Date(page.published_at).toISOString() : null,
          updated: page.modified_at ? new Date(page.modified_at).toISOString() : null,
          reference: `OZ-PAGE-${String(page.id).padStart(4, '0')}`,
          trail: [
            { name: 'Ozikoro', path: '/' },
            { name: page.title, path },
          ],
        },
        ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css']
      )
    ),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clean = slug.replace(/\/$/, '');

  const db = await getDb();

  // A category address is a topic, not an article. Same rule as the page this replaces.
  const topic = await db.one<{ slug: string }>(`select slug from ozikoro_topic where slug = $1`, [clean]);
  if (topic) {
    return new Response(null, { status: 307, headers: { location: `/topics/${topic.slug}/` } });
  }

  const row = await db.one<{
    id: number; title: string; body_html: string | null; topic: string | null; standfirst: string | null;
    author: string | null; published_at: Date | null; modified_at: Date | null;
    image: string | null; image_alt: string | null; image_credit: string | null;
    image_licence: string | null; rights_note: string | null;
  }>(
    `select a.id, a.title, a.body_html, a.standfirst, t.name as topic,
            c.display_name as author, a.published_at, a.modified_at,
            (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as image,
            (select m.alt_text from ozikoro_media m where m.id = a.featured_media_id) as image_alt,
            (select coalesce(m.credit, m.creator) from ozikoro_media m where m.id = a.featured_media_id) as image_credit,
            (select m.licence from ozikoro_media m where m.id = a.featured_media_id) as image_licence,
            (select m.rights_note from ozikoro_media m where m.id = a.featured_media_id) as rights_note
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
       left join ozikoro_contributor c on c.id = a.author_id
      where a.slug in ($1, $2) and a.status = 'published' and a.is_page = false`,
    [clean, wordpressUriEncode(clean)]
  );
  if (!row) {
    /*
     * NOT AN ARTICLE, SO IT MAY BE A PAGE. Every archive query excludes `is_page = true` on purpose, which
     * is why a page has no address unless a design screen or a redirect happens to answer for it. See
     * `servePublishedPage` for what a page is served as, and for why a page with no content stays a 404.
     */
    const page = await servePublishedPage(db, clean);
    if (page) return page;
    return new Response('Not found', { status: 404 });
  }

  const related = await db.rows<{ slug: string; title: string; topic: string | null; image: string | null }>(
    `select a.slug, a.title, t.name as topic,
            (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as image
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
      where a.status = 'published' and a.is_page = false and a.id <> $1
        and (t.id is not distinct from (select topic_id from ozikoro_article where id = $1))
      order by a.published_at desc nulls last limit 3`,
    [row.id]
  );

  /*
   * THE CAPTION STATES THE RIGHTS STATE, WHICH IS `unknown` FOR ALL 3,488 MEDIA ITEMS.
   *
   * Not a permission nobody granted, and not the design's "rights must be verified" — **the archive's own
   * recorded position.** A credit is shown where one exists.
   */
  const rights = row.image_licence
    ? `Licence ${row.image_licence}`
    : 'No licence recorded · reuse not granted';
  const caption = [row.image_credit, rights].filter(Boolean).join(' · ');

  /*
   * THE MEDIA MAP, BUILT ONCE FOR THIS REQUEST.
   *
   * `source_url` is the address the file had on WordPress and `storage_key` is where this archive keeps it,
   * so the two columns ARE the mapping. Resized variants (`-680x541`) are matched against the full-size
   * address with the suffix removed, because WordPress writes both and only the original was catalogued.
   *
   * **THE MATCHING RULE LIVES IN `mediaUrlResolver` AND NOT HERE ANY MORE.** The design-screen route needs
   * the same mapping for the 57 images the design screens still hot-link, and a second copy of the rule is
   * how one route quietly stops finding files the other still finds — this repository has recorded that
   * drift four times, most recently as four dead controls on every article.
   */
  const resolveImage = await mediaUrlResolver(db);

  /*
   * WHICH CLAN, TOWN OR PLACE THIS RECORD IS LINKED TO — §3.1, AND THE HEAD'S LARGEST GAP.
   *
   * `ozikoro_article_entity` has held these links all along and **the article head used none of them**: the
   * listing card printed a `Place` chip and the record it named offered no way to follow it. A reader could
   * see that *Ute-Okpu* is a place and could not open Ute-Okpu from the record.
   *
   * The role comes from the link rather than from the entity's kind, because one record can link to the same
   * name twice — `an-igbo-family-shrine-…` links to `Onicha` as a clan and again as a town — and the kind
   * alone cannot tell a reader which of the two is meant. See `RealArticle.entities` in `design-fill.ts`.
   */
  const entities = await db.rows<{ kind: string; slug: string; name: string; role: string }>(
    `select e.kind, e.slug, e.name, ae.role
       from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
      where ae.article_id = $1
      order by ae.role, e.name`,
    [row.id]
  );

  /*
   * THE TWO FACETS NO RECORD CAN FILL, COUNTED RATHER THAN ASSUMED.
   *
   * The head states that no period and no source type is recorded. **That sentence has to stop being true the
   * moment it is** — the day an editor dates a record or attaches a source — so the figures are read from the
   * same tables the filter rail reads rather than written down. `period_label` and `source_type` are null on
   * every published row today, and `ozikoro_article_source` is empty. Read from `ozikoro_article` by its own
   * name in the subqueries, because a table alias is not in scope inside a correlated subquery.
   */
  const totals = await db.one<{ published: number; with_period: number; with_source: number }>(
    `select
       (select count(*)::int from ozikoro_article where status = 'published' and is_page = false) as published,
       (select count(*)::int from ozikoro_article
         where status = 'published' and is_page = false
           and ((period_label is not null and period_label <> '') or period_start is not null)) as with_period,
       (select count(*)::int from ozikoro_article
         where status = 'published' and is_page = false
           and ((source_type is not null and source_type <> '')
                or exists (select 1 from ozikoro_article_source s where s.article_id = ozikoro_article.id))) as with_source`
  );

  const article: RealArticle = {
    title: row.title,
    topic: row.topic,
    author: row.author,
    published: row.published_at ? new Date(row.published_at).toISOString() : null,
    updated: row.modified_at ? new Date(row.modified_at).toISOString() : null,
    image: row.image ? mediaPath(row.image) : null,
    imageAlt: row.image_alt ?? row.title,
    caption,
    rights,
    body: row.body_html ?? '<p>This record has no written body yet.</p>',
    path: `/${clean}/`,
    // The frame's "Historical context" line. The archive's own summary, or a plain statement that it holds none.
    context: row.standfirst?.trim() ||
      'The archive holds this record without a separate summary. Its own words are above, and its sources, where it states them, are below.',
    reference: `OZ-H-${String(row.id).padStart(4, '0')}`,
    // EACH RELATED IMAGE GOES THROUGH `mediaPath` TOO. The row carries a `storage_key`, which is a disk path
    // — `ozikoro/11231-umunede-king.jpeg` — and a page needs `/media/…`. **The featured image was fixed and
    // this was missed, so three of the five images on an article 404'd** while the two above them worked.
    related: related.map((r) => ({
      title: r.title,
      href: `/${r.slug}/`,
      topic: r.topic,
      image: r.image ? mediaPath(r.image) : null,
    })),
    /*
     * WHAT THE RECORD BELONGS TO, AND WHAT THE ARCHIVE CANNOT SAY ABOUT IT. Orders: the entity links are
     * what the chips render, `archiveTotals` is what decides whether the period/source sentence appears —
     * and it appears only while the figure behind it is still zero, so recording one period retires the
     * sentence for every record at once rather than leaving 1,051 pages claiming a fact that stopped being
     * true. See `RealArticle` in `design-fill.ts`.
     */
    entities,
    archiveTotals: {
      published: Number(totals?.published ?? 0),
      withPeriod: Number(totals?.with_period ?? 0),
      withSource: Number(totals?.with_source ?? 0),
    },
    resolveImage,
  };

  let html: string;
  try {
    /*
     * THE SPOKEN RECORD, BUT ONLY ONCE A PERSON HAS APPROVED IT.
     *
     * **`playableEpisodeSql()` AND NOTHING ELSE.** It requires `status = 'published'` — an episode sitting in
     * `pending_review` is one nobody has listened to yet, and the whole point of the review step is that a
     * mistake is caught before a reader hears it — AND it requires `approved_at`/`approved_by`, because
     * `published` is a state and the approval is a separate fact on separate columns.
     *
     * **THAT SECOND HALF IS THE ONE THIS ROUTE WAS MISSING.** The query asked only for `published`, so a row
     * whose status had been set by anything other than `publishNarrationEpisode` served audio that nobody had
     * approved — the owner's rule broken by a write, not by this route. The condition now lives in
     * `@ozikoro/platform` and is composed by all three public surfaces, so the article cannot hold a gate the
     * feed leaks through.
     */
    const episode = await db.one<{
      slug: string; storage_key: string | null; external_url: string | null; external_service: string | null;
      external_direct_audio: boolean | null; duration_seconds: number | null;
      narrator_kind: string; narrator_name: string | null; ai_disclosure: string; transcript: string;
    }>(
      `select slug, storage_key, external_url, external_service, external_direct_audio, duration_seconds,
              narrator_kind, narrator_name, ai_disclosure, transcript
         from ozikoro_episode
        where article_id = $1 and ${playableEpisodeAudioSql()}
        order by published_at desc nulls last limit 1`,
      [row.id]
    );

    /*
     * WHETHER THIS PAGE CARRIES A PLAYER AT ALL, OR A LINK THAT LEAVES.
     *
     * A file — ours, or an external URL that answered with an audio content type — becomes
     * `<audio data-listen-audio>` and the listen script drives it. **A Spotify episode page is not an
     * `<audio src>`**: pointing one at it produces a button that is pressed and does nothing, which is the
     * dead-control fault this archive has recorded four times. So a page-shaped address becomes an anchor
     * that says where it goes, and the script is not loaded because there is nothing for it to play.
     */
    const directAudio = Boolean(episode) && (episode?.external_url ? episode.external_direct_audio === true : true);

    let filled = fillArticle(await readFile(SCREEN, 'utf8'), {
      ...article,
      episode: episode
        ? {
            url: episode.external_url ?? `/media/${episode.storage_key}`,
            directAudio,
            service: episode.external_service,
            seconds: episode.duration_seconds,
            narratorKind: episode.narrator_kind,
            narratorName: episode.narrator_name,
            disclosure: episode.ai_disclosure,
            transcript: episode.transcript,
          }
        : null,
    });
    /*
     * THE DESIGN'S OWN SCRIPTS, AT THE PATH THEY ARE ACTUALLY SERVED FROM — AND THE FAULT THIS FIXES.
     *
     * `article.html` loads its behaviour as `<script src="../reader.js">` and `<script src="../mobile-nav.js">`.
     * Those are correct RELATIVE to the deliverable's own address — `/design/screens/article.html` — and wrong
     * at every address this route serves, where the same link resolves one level shallower:
     *
     *     /how-tortoise-got-his-bumpy-shell/ + ../reader.js  ->  /reader.js   ->  404
     *
     * **`reader.js` is the article screen's share button, its copy-link button, its print button and its
     * browser read-aloud control.** Every one of them was a control with no handler, on every one of 1,051
     * records, while the page itself rendered perfectly — the exact shape of the market-day fault, where a
     * screen returned 200 with correct markup and its one dynamic value never arrived.
     *
     * `design-screen/[screen]/route.ts` already rewrites this for the screens it serves. The article route is
     * a different route and had no copy of it, which is why the fault survived that fix. **The rule lives in
     * `designScriptPaths` now, called from both routes, so there is no second copy to drift** — and
     * `design-paths.test.ts` asserts that both call it.
     */
    filled = designScriptPaths(filled);

    /*
     * AND THE DESIGN'S OWN RELATIVE LINKS, BY THE SAME ARGUMENT AND THE SAME FUNCTION.
     *
     * This route serves `screens/article.html`, whose menu is written the design's way — `home.html`,
     * `archive-index.html`, `listen.html`, `folklore-reader.html` — and those resolve one level too deep
     * at `/<slug>/`. `designScriptPaths` above was written for exactly this reason and this is its
     * sibling; **the two routes are the pair that made one implementation necessary**, and
     * `design-paths.test.ts` reads both files so a third cannot repeat the omission.
     *
     * IT IS TOLD THE RECORD'S ADDRESS, so the article's own in-page anchors — `#sources`, `#citation`,
     * `#related` — become addresses on this record rather than on the site root. The `<base href="/">` this
     * function writes would otherwise resolve `#sources` to `/#sources`: measured in Chrome on four screens,
     * and **the front page is not the record**. See `design-paths.ts` and the design-screen route.
     */
    filled = designScreenLinks(filled, `/${clean}/`);

    /*
     * THE SHARE CONTROL IS A LINK FIRST AND A BUTTON SECOND.
     *
     * The design draws Facebook and X as `<button data-share="…">`, and a button whose handler is in a script
     * is **a dead control wherever that script does not run** — with JavaScript disabled, or if `reader.js`
     * ever fails to load again. The address a share goes to is known here, at serve time, and does not depend
     * on any script: the record's own canonical address on `SITE_ORIGIN`.
     *
     * So the two share controls are served as anchors. **With JavaScript the anchor is never followed** —
     * `article-share.js` claims the click in the capture phase and opens the popup instead — and without it
     * the anchor is simply a working link. That order matters: **the control works if the script is missing,
     * rather than only working because the script is present.**
     *
     * `style="text-decoration:none"` is the one property the design's own `a{text-decoration:underline}` would
     * otherwise add to a round icon button. Every other declaration comes from the design's `.sx-icon-action`
     * class, which is unchanged — the element is swapped, the design is not.
     *
     * The replacement is anchored to the design's exact markup on purpose: **a page whose buttons have changed
     * shape keeps them as buttons** and is left to `article-share.js`, rather than having an anchor fitted
     * somewhere it was never designed to be.
     */
    const shareHref = (network: string): string => {
      const address = encodeURIComponent(`${SITE_ORIGIN}/${clean}/`);
      return network === 'facebook'
        ? `https://www.facebook.com/sharer/sharer.php?u=${address}`
        : `https://twitter.com/intent/tweet?url=${address}&amp;text=${encodeURIComponent(article.title)}`;
    };
    filled = filled.replace(
      /<button class="sx-icon-action" type="button" data-share="(facebook|x)"([^>]*)>([\s\S]*?)<\/button>/g,
      (_match, network: string, rest: string, inner: string) =>
        `<a class="sx-icon-action" data-share="${network}"${rest} href="${shareHref(network)}"`
        + ` target="_blank" rel="noopener noreferrer" style="text-decoration:none">${inner}</a>`
    );

    /*
     * THE HEAD IS REPLACED, NOT APPENDED TO.
     *
     * The design's article page carries the walkthrough's own `<title>` and description — **so every one of
     * 1,051 records was telling a search engine it was called "Nwagu Aneke", the example title**, with no
     * canonical, no Open Graph and no structured data beside it. Invisible in a browser; fatal in an index.
     */
    /*
     * THE PLAYER SCRIPT IS ADDED ONLY WHERE THERE IS SOMETHING TO PLAY.
     *
     * `audio-listen.js` hands the listen panel to the recorded audio instead of the browser's voice — **and it
     * does nothing at all on a page without `[data-listen-audio]`**. That is every page whose episode has not
     * been approved, AND every page whose audio is an external page rather than a file: a Spotify episode
     * address cannot be an `<audio src>`, so no element is written and the script would be dead weight. The
     * condition is `directAudio` rather than `episode` for exactly that reason.
     *
     * `article-share.js` IS UNCONDITIONAL, because the share control is: it does nothing on a page with no
     * `[data-share]`, and on a page that has one it is what turns a blocked popup into a visible outcome
     * instead of a click that appears to do nothing.
     */
    const extraScripts = ['<script src="/article-share.js" defer></script>'];
    if (directAudio) extraScripts.push('<script src="/audio-listen.js" defer></script>');
    filled = filled.replace('</body>', `${extraScripts.join('')}</body>`);

    /*
     * THE DOWNLOAD LINK, PUT INTO THE DESIGN'S OWN READING TOOLS.
     *
     * The publication at `/<slug>/pdf` has existed since the writer landed and **nothing on the site
     * pointed at it** — a reader had to know the address. The button is injected here rather than drawn
     * into `public/design/screens/article.html` because **the design is the approved handoff and is not
     * this work's to edit**; the sidebar was built to hold a list of reading tools, so one more is added
     * to that list and nothing is restructured.
     *
     * TWO THINGS ABOUT THE ADDRESS. It is a rooted path carrying the record's own slug, **not a bare
     * relative one copied from its neighbours**: every link the design wrote here is an in-page fragment
     * (`#listen`), and a bare `pdf` would resolve against whatever address the page happened to be served
     * at — `/ute-okpu-…` without the trailing slash would ask for `/pdf`. And the link is inserted only
     * when the design still holds the container it expects: **a page whose markup has moved on loses the
     * button rather than gaining a link somewhere it was never designed to be.**
     */
    const TOOLS = '<details><summary>Reading tools</summary><nav>';
    if (filled.includes(TOOLS)) {
      filled = filled.replace(TOOLS, `${TOOLS}<a class="btn btn-sm" href="/${clean}/pdf">Download PDF</a>`);
    }

    html = withSeoHead(
      filled,
      seoHead(
        {
          path: `/${clean}/`,
    // The frame's "Historical context" line. The archive's own summary, or a plain statement that it holds none.
          title: article.title,
          description: row.standfirst ?? null,
          kind: 'article',
          published: article.published,
          updated: article.updated,
          author: article.author,
          image: article.image ? `${'https://ozikoro.com'}${article.image}` : null,
          imageAlt: article.imageAlt,
          reference: `OZ-H-${String(row.id).padStart(4, '0')}`,
          trail: [
            { name: 'Ozikoro', path: '/' },
            { name: 'Histories', path: '/archive-index/' },
            { name: article.title, path: `/${clean}/` },
          ],
          topics: row.topic ? [row.topic] : [],
        },
        ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css']
      )
    );

    /*
     * THE OWNER'S EDITS REACH THE ARTICLES.
     *
     * `/design-theme.css` is linked above, so a COLOUR edit made through `/admin/design/` always reached an
     * article. A text, image, link or hide edit did not: this route never called the override layer, so the
     * row was written, the audit line was written, the page was re-rendered — and the heading was unchanged.
     * **The editor's own save path proved the opposite for the design screens and could not prove it here.**
     *
     * The rule is `withStoredDesignOverrides`, the same function `design-screen/[screen]/route.ts` calls, so
     * the two cannot drift. It runs after the fills and after the head, because an override applied before
     * them would be overwritten by the pass that rewrites a heading's words.
     *
     * THE SCREEN NAME IS `article`: the deliverable's file is `public/design/screens/article.html`, the screen
     * list at `/admin/design/` is discovered from those filenames, and an edit saved against the article is
     * keyed `article`. The article screen is the one screen with no route of its own in
     * `design-screen/[screen]/`, because its fill and this route are the same code path.
     *
     * `?oznooverride=1` is honoured here for the same reason it is honoured there: a saved edit is proved by
     * fetching the page without it, and that only works if both routes understand the switch.
     */
    const dbForOverrides = await getDb();
    let asDesign = false;
    const url = new URL(request.url);
    if (url.searchParams.has('oznooverride')) {
      const viewer = await getCurrentAccount().catch(() => null);
      asDesign = Boolean(viewer && (await can(dbForOverrides, viewer.account.id, 'manage_design')));
    }
    html = await withStoredDesignOverrides(dbForOverrides, html, 'article', { asDesign, label: 'article' });
  } catch (error) {
    console.error('article fill failed:', error);
    return new Response('Not found', { status: 404 });
  }

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
