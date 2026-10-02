/**
 * The archive as retrieval knowledge for the AI assistant (objective item 9).
 *
 * WHY THIS IS AN ADAPTER AND NOT A CONSTANT
 *
 * `packages/core/src/ai/retrieval.ts` already implements the whole pipeline — `selectKnowledge`,
 * `formatKnowledgeBlock` and `trustForGrounding` — and `apps/learn/app/api/learn/tutor/route.ts` is a
 * working caller. What the archive lacked was a `KnowledgeItem` source over its own records. This is it.
 *
 * THE ONE FIELD THE CALLER MUST SUPPLY
 *
 * Every field of `KnowledgeItem` maps from a recorded column except `languageCode`. Measured in round 183:
 * `ozikoro_article` has no lang, locale or script column, and there is no `ozikoro_*` language table. The
 * obvious fill is `'ibo'` — the archive is Igbo heritage content — and **the obvious fill is the one this
 * project may not take**: most of these 1,051 articles are written in English about Igbo subjects, so
 * `'ibo'` asserts the text is Igbo and `'eng'` asserts the opposite. Retrieval ranks and filters on
 * language, so the value decides what the assistant will answer from.
 *
 * So it is a **required parameter** rather than a default. The caller states what the archive's language is
 * and on what evidence; this module cannot silently assume one, and a test asserts that an empty value is
 * refused. **A defaulted field is an invented one.**
 *
 * The site's own reader-facing pages do not use this and are unaffected — see `apps/ozikoro/app/[slug]`.
 */
import type { KnowledgeItem } from '@ozituma/core';
import type { Db } from '@ozituma/db/client';

/**
 * How much of an article becomes retrieval text.
 *
 * Chosen to sit well inside `selectKnowledge`'s default character budget so several items can be selected
 * rather than one long item ending the loop. Six of these still fit, which is more than `DEFAULT_MAX_ITEMS`
 * usually needs.
 */
const EXCERPT_CHARACTERS = 600;

export interface ArchiveKnowledgeOptions {
  /** Cap on how many articles to load, newest first. */
  limit?: number;
}

/**
 * Strip the markup the article body is stored as, leaving text for the model.
 *
 * Deliberately crude: it removes tags and collapses whitespace rather than trying to render the HTML.
 * `apps/ozikoro` has a tested sanitiser for **display**; this is not that, and must not be mistaken for it
 * — nothing here is ever served to a browser.
 */
function plainText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A stable, readable identity for a retrieval item that came from an article. */
export function articleKnowledgeId(articleId: number): string {
  return `ozikoro-article-${articleId}`;
}

/**
 * Load published articles as retrieval items.
 *
 * `status` is pinned to `'published'` in the query rather than mapped afterwards, because
 * `KnowledgeItem` documents that only published material is retrievable — the filter belongs where the
 * rows are chosen, not where they are shaped.
 *
 * `source` is the article's own `canonical_url`, falling back to `legacy_url`. Both are recorded for every
 * row, which is what makes the citation honest: the assistant can name where a passage came from because
 * the archive already recorded it, and nothing here invents one.
 */
export async function archiveKnowledgeItems(
  db: Db,
  languageCode: string,
  options: ArchiveKnowledgeOptions = {}
): Promise<KnowledgeItem[]> {
  const code = languageCode.trim();
  if (!/^[a-z]{3}$/.test(code)) {
    throw new Error(
      `archiveKnowledgeItems needs an ISO 639-3 language code for the archive (got ${JSON.stringify(languageCode)}). ` +
        'The archive records no language per article, so this cannot be defaulted — see the note in this file.'
    );
  }

  const limit = Math.max(1, Math.min(options.limit ?? 1000, 5000));
  // `topic` is the article's most-used label — a recorded association, not a guess. It matters because
  // scoring ranks on topic as well as text: round 184's first measurement retrieved one item out of a
  // thousand, and this is what the ranking had least of.
  const rows = await db.rows(
    `select a.id, a.title, a.standfirst, a.body_html, a.canonical_url, a.legacy_url,
            (select l.name
               from ozikoro_article_label al
               join ozikoro_label l on l.id = al.label_id
              where al.article_id = a.id
              order by l.usage_count desc nulls last, l.name
              limit 1) as topic
       from ozikoro_article a
      where a.status = 'published' and a.is_page = false
      order by a.published_at desc nulls last, a.id
      limit $1`,
    [limit]
  );

  const items: KnowledgeItem[] = [];
  for (const row of rows) {
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const standfirst = typeof row.standfirst === 'string' ? row.standfirst.trim() : '';
    const body = plainText(typeof row.body_html === 'string' ? row.body_html : null);
    // BOUNDED, and this is not tidiness.
    //
    // `selectKnowledge` walks its scored items and STOPS as soon as one would exceed `maxCharacters`
    // (default 4000). A single whole article body is longer than that, so the first item broke the loop
    // and the caller got nothing: measured in round 185, "Tell me about Igbo clans" retrieved 0 items and
    // fell to `trust: "ai_assisted"` — an UNGROUNDED answer — while the pipeline was working correctly.
    //
    // Round 184 blamed the ranking and set `topic` to fix it. That helped nothing, because the cause was
    // the character budget and the fix was a bound. **A measurement that names the wrong cause produces a
    // confident, wrong improvement.**
    const text = [title, standfirst, body]
      .filter((part) => part.length > 0)
      .join('\n\n')
      .slice(0, EXCERPT_CHARACTERS);
    const source =
      (typeof row.canonical_url === 'string' && row.canonical_url.trim()) ||
      (typeof row.legacy_url === 'string' && row.legacy_url.trim()) ||
      '';

    // An item with no text or no source cannot be retrieved meaningfully and cannot be cited. Skipping is
    // the honest response; inventing either would be the failure this file exists to avoid.
    if (text.length === 0 || source.length === 0) continue;

    const topic = typeof row.topic === 'string' ? row.topic.trim() : '';

    items.push({
      id: articleKnowledgeId(Number(row.id)),
      kind: 'culture',
      languageCode: code,
      status: 'published',
      text,
      source,
      ...(topic.length > 0 ? { topic } : {}),
    });
  }
  return items;
}
