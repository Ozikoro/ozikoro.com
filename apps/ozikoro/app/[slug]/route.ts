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
import { getDb } from '@ozituma/db/client';
import { fillArticle, mediaPath, mediaUrlResolver, seoHead, withSeoHead, designScriptPaths, SITE_ORIGIN, type RealArticle } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const SCREEN = join(process.cwd(), 'public', 'design', 'screens', 'article.html');

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
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
      where a.slug = $1 and a.status = 'published' and a.is_page = false`,
    [clean]
  );
  if (!row) return new Response('Not found', { status: 404 });

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
    resolveImage,
  };

  let html: string;
  try {
    /*
     * THE SPOKEN RECORD, BUT ONLY ONCE A PERSON HAS APPROVED IT.
     *
     * **`status = 'published'` and nothing else.** An episode sitting in `pending_review` is one nobody has
     * listened to yet, and the whole point of the review step is that a mistake is caught before a reader
     * hears it. A `draft` or `failed` episode has no audio worth offering either.
     */
    const episode = await db.one<{
      slug: string; storage_key: string | null; external_url: string | null; duration_seconds: number | null;
      narrator_kind: string; narrator_name: string | null; ai_disclosure: string; transcript: string;
    }>(
      `select slug, storage_key, external_url, duration_seconds, narrator_kind, narrator_name, ai_disclosure, transcript
         from ozikoro_episode
        where article_id = $1 and status = 'published'
          and coalesce(external_url, storage_key) is not null
        order by published_at desc nulls last limit 1`,
      [row.id]
    );

    let filled = fillArticle(await readFile(SCREEN, 'utf8'), {
      ...article,
      episode: episode
        ? {
            url: episode.external_url ?? `/media/${episode.storage_key}`,
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
     * does nothing at all on a page without `[data-listen-audio]`**, which is every page whose episode has not
     * been approved. So the script tag is only written when an episode is present, and a page with no recording
     * is byte-for-byte the page it was before.
     *
     * `article-share.js` IS UNCONDITIONAL, because the share control is: it does nothing on a page with no
     * `[data-share]`, and on a page that has one it is what turns a blocked popup into a visible outcome
     * instead of a click that appears to do nothing.
     */
    const extraScripts = ['<script src="/article-share.js" defer></script>'];
    if (episode) extraScripts.push('<script src="/audio-listen.js" defer></script>');
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
  } catch (error) {
    console.error('article fill failed:', error);
    return new Response('Not found', { status: 404 });
  }

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
