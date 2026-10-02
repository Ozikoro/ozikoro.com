/**
 * Repair the bare storage keys the first importer wrote into article bodies.
 *
 * WHAT WENT WRONG
 *
 * The importer's map stored `ozikoro_media.storage_key` — a disk path like `ozikoro/11231-umunede-king.jpeg` —
 * where a page needs `/media/ozikoro/11231-umunede-king.jpeg`. **So the rewrite wrote a RELATIVE path into
 * every body**, which the browser resolved against the article's own address and 404'd.
 *
 * **The images were imported, written to disk, registered and served correctly, and the articles showed none
 * of them.** Every check on the files passed; only the rendered page was wrong.
 *
 * This rewrites `ozikoro/…` to `/media/ozikoro/…` **inside `src` and `srcset` attributes only**, so a body
 * that happens to contain the word elsewhere is untouched.
 */
import { getDb, closeDb } from '@ozituma/db/client';

const db = await getDb();

const articles = await db.rows<{ id: number; body_html: string }>(
  `select id, body_html from ozikoro_article
    where status = 'published' and is_page = false
      and (body_html like '%"ozikoro/%' or body_html like '% ozikoro/%')`
);
console.log(`  articles holding a bare storage key: ${articles.length}`);

let fixed = 0, attrs = 0;
for (const a of articles) {
  let body = a.body_html;
  const before = body;

  // `src="ozikoro/…"` -> `src="/media/ozikoro/…"`
  body = body.replace(/(\ssrc=")(ozikoro\/[^"]+)"/g, (_m, pre: string, key: string) => {
    attrs += 1;
    return `${pre}/media/${key}"`;
  });
  // Every URL inside a `srcset`, wherever it sits in the list.
  body = body.replace(/(\ssrcset=")([^"]+)"/g, (_m, pre: string, set: string) => {
    const next = set
      .split(',')
      .map((part: string) => {
        const trimmed = part.trim();
        const sp = trimmed.indexOf(' ');
        const url = sp === -1 ? trimmed : trimmed.slice(0, sp);
        const rest = sp === -1 ? '' : trimmed.slice(sp);
        if (url.startsWith('ozikoro/')) { attrs += 1; return `/media/${url}${rest}`; }
        return trimmed;
      })
      .join(', ');
    return `${pre}${next}"`;
  });

  if (body !== before) {
    await db.query(`update ozikoro_article set body_html = $1 where id = $2`, [body, a.id]);
    fixed += 1;
  }
}

console.log(`  attributes repaired    ${attrs}`);
console.log(`  articles updated       ${fixed}`);

const left = await db.one<{ n: number }>(
  `select count(*)::int n from ozikoro_article
    where status = 'published' and is_page = false
      and (body_html like '%"ozikoro/%' or body_html like '% ozikoro/%')`
);
console.log(`  still holding a bare key: ${left?.n ?? 0}`);
await closeDb();
