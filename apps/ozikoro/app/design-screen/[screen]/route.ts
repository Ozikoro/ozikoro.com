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
import { fillArchiveIndex, type RealEntry } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const SCREEN_DIR = join(process.cwd(), 'public', 'design', 'screens');

/** Screens this route fills. Anything else is served untouched. */
const FILLED = new Set(['archive-index']);

async function realEntries(topicSlug: string | null, limit = 24): Promise<RealEntry[]> {
  const db = await getDb();
  const rows = await db.rows<{
    slug: string; title: string; standfirst: string | null;
    place: string | null; period: string | null; source: string | null; attached: number;
  }>(
    `select a.slug, a.title, a.standfirst,
            (select string_agg(e.name, ', ' order by e.name)
               from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
              where ae.article_id = a.id) as place,
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ screen: string }> }
) {
  const { screen } = await params;
  const name = screen.replace(/\.html$/, '');

  let html: string;
  try {
    html = await readFile(join(SCREEN_DIR, `${name}.html`), 'utf8');
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!FILLED.has(name)) {
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
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
  } catch (error) {
    // Degrade to the design rather than to an error page, and say so in the log.
    console.error(`design fill failed for ${name}:`, error);
  }

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
