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
import { fillArticle, mediaPath, type RealArticle } from '@ozikoro/platform';

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
    id: number; title: string; body_html: string | null; topic: string | null;
    author: string | null; published_at: Date | null; modified_at: Date | null;
    image: string | null; image_alt: string | null; image_credit: string | null;
    image_licence: string | null; rights_note: string | null;
  }>(
    `select a.id, a.title, a.body_html, t.name as topic,
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
   */
  const media = await db.rows<{ source_url: string; storage_key: string }>(
    `select source_url, storage_key from ozikoro_media
      where source_url is not null and storage_key is not null`
  );
  const exact = new Map<string, string>();
  const base = new Map<string, string>();
  for (const m of media) {
    exact.set(m.source_url, mediaPath(m.storage_key));
    base.set(m.source_url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, ''), mediaPath(m.storage_key));
  }
  const resolveImage = (url: string): string | null =>
    exact.get(url) ?? base.get(url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '')) ?? null;

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
    html = fillArticle(await readFile(SCREEN, 'utf8'), article);
  } catch (error) {
    console.error('article fill failed:', error);
    return new Response('Not found', { status: 404 });
  }

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
