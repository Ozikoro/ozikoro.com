/**
 * The archive as retrieval knowledge for the AI assistant (objective item 9).
 *
 * WHY THIS IS AN ADAPTER AND NOT A CONSTANT
 *
 * `packages/core/src/ai/retrieval.ts` already implements the whole pipeline — `selectKnowledge`,
 * `formatKnowledgeBlock` and `trustForGrounding`.
 *
 * **IT ONCE HAD A WORKING CALLER AND NOW HAS NONE.** The tutor that drove this pipeline lived in the
 * courses app, and then in the TanStack Start app in `learn/`; both were deleted with
 * `learn.ozituma.com` on 2026-10-04. The pipeline and this source are kept because the Academy will
 * want them, but nothing in this repository calls them today — so a change here cannot be verified by
 * exercising a live route.
 *
 * What the archive lacked was a `KnowledgeItem` source over its own records. This is it.
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
import type { KnowledgeItem, RetrievalResult } from '@ozituma/core';
import { trustForGrounding } from '@ozituma/core';
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
        /*
         * A RECORD HELD BY AGREEMENT IS NOT ANSWERABLE FROM.
         *
         * access_tier = 'by_agreement' (migration 0057) means the record cannot be read at all without an
         * institutional access agreement. This function reads body_html and hands whole passages to
         * /api/ask, so a gated record left in the corpus would be the tier leaking through a door nobody
         * would think to look behind: the question endpoint would quote the very words the reading page
         * refuses. The predicate is here rather than at the endpoint because every caller of this function
         * feeds the same retrieval, and a gate written at one caller is a gate the next caller does not
         * inherit.
         *
         * This is the reading claim, not the media register's restricted column, which is about reuse and has
         * no bearing on whether a record may be quoted.
         */
        and a.access_tier = 'open'
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

/**
 * What the archive can honestly say about a question (objective item 9).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PROMPT
 *
 * The objective's constraint is *"never invent a record, a source, a rights statement, a citation or a
 * statistic."* For a generated answer, the moment that rule is either kept or broken is the moment the
 * archive decides **whether it has anything to answer from** — and that decision is mechanical, so it
 * belongs in code rather than in a system prompt that a model may or may not follow.
 *
 * `trustForGrounding` already distinguishes the two cases: `result.empty` means the retriever found nothing,
 * and anything a model produced then would come from its own knowledge rather than from this archive. So
 * the answer is **no**, and the reason is stated rather than left to a prompt.
 *
 * **Nothing here is voice.** The wording a reader sees is the page's business; this decides only whether
 * an answer may be given at all, and every path that says no says why.
 */
export type Answerability =
  | { canAnswer: true; trust: 'verified'; passages: number; characters: number }
  | { canAnswer: false; trust: 'ai_assisted'; reason: string };

export function answerabilityOf(result: RetrievalResult, terms: readonly string[] = []): Answerability {
  const trust = trustForGrounding(result);

  // RELEVANCE, WHICH `empty` DOES NOT TELL YOU (measured in round 191).
  //
  // `selectKnowledge` does not filter on relevance. It scores every item, sorts, and takes the top N — and
  // `scoreItem` gives every `culture` item +1 for its kind alone. So a question about quantum chromodynamics
  // retrieves four Igbo heritage articles, `result.empty` is false, and `trustForGrounding` calls it
  // "verified": **the archive would claim grounding for an answer that has nothing to do with the
  // question.** Asking for a term that appears in the text is the check `empty` cannot make.
  //
  // Matched case-insensitively against the stored text. `toSearchForm` is not exported and reimplementing
  // the scoring is how a second, differently-wrong definition gets written — so this asks the simplest
  // question that settles it: *does a passage contain a word the question used?*
  if (result.items.length > 0 && terms.length > 0) {
    /*
     * A PROPORTION OF THE QUESTION'S TERMS, NOT ONE OF THEM (measured in round 262).
     *
     * This asked whether ANY term appeared in ANY passage — `terms.some(...)` — and **one surviving common
     * word defeated the whole gate.** Measured with the stopword list fixed and this still in place:
     *
     *   "What is the capital of France?"  -> terms ["capital", "France"]
     *        "capital" appears in articles about capitals; grounded=True, passages=6, trust=verified.
     *   "Who won the 1994 World Cup?"     -> grounded=True, passages=6, trust=verified.
     *
     * **The archive claimed grounding for questions about France and the World Cup.** A single term is not
     * evidence that a passage answers a question; it is evidence that the word occurs somewhere in a
     * thousand articles.
     *
     * So the question must be answered by a passage that shares MOST of its terms. Half, rounded up, with a
     * floor of one so a single-term question still works. **A passage matching "capital" alone is not about
     * France; a passage matching both is at least about both.**
     */
    /*
     * A SHORT QUESTION MUST MATCH ALL OF ITS TERMS.
     *
     * The first version of this used `Math.ceil(terms.length / 2)` with a floor of one, and **for a two-term
     * question that is one** — which is exactly the `terms.some(...)` it was meant to replace. Measured with
     * it in place: "What is the capital of France?" still returned grounded=True with six passages, because
     * "capital" alone matched.
     *
     * **A question reduced to two words is asking about both of them.** "The capital of France" is not
     * answered by a passage that mentions a capital, and "the 1994 World Cup" is not answered by one that
     * mentions 1994. So one and two terms require all of them, and longer questions require a majority —
     * because a long question legitimately ranges over more words than any one passage will repeat.
     */
    const needed = terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
    const bestMatch = result.items.reduce((best, item) => {
      const haystack = item.text.toLowerCase();
      const hits = terms.filter((term) => term.length > 1 && haystack.includes(term.toLowerCase())).length;
      return Math.max(best, hits);
    }, 0);
    const overlap = bestMatch >= needed;
    if (!overlap) {
      return {
        canAnswer: false,
        trust: 'ai_assisted',
        reason:
          'Nothing in the archive matches the words of this question. The passages that came back share ' +
          'too little of it to be about the same subject — they were returned by position rather than by ' +
          'relevance — and an answer built on them would not be grounded in a record here.',
      };
    }
  }

  if (result.empty || trust !== 'verified') {
    return {
      canAnswer: false,
      trust: 'ai_assisted',
      // Named plainly, because this string is what an operator sees in a log and what a reader is told.
      reason:
        'The archive holds nothing that answers this. An answer produced now would come from the model ' +
        'rather than from a record here, and this archive does not do that.',
    };
  }

  return {
    canAnswer: true,
    trust: 'verified',
    passages: result.items.length,
    characters: result.items.reduce((total, item) => total + item.text.length, 0),
  };
}

/**
 * The passages an answer may be built from, each with the address it came from.
 *
 * **Every passage carries a source or it is not returned.** `archiveKnowledgeItems` already skips items with
 * no `source`, so this is belt-and-braces at the point where a citation would otherwise be printed as
 * nothing — and it is the same "re-assert on the way out" the retrieval module uses for its published gate.
 */
export function groundedPassages(result: RetrievalResult): Array<{ id: string; text: string; source: string }> {
  const passages: Array<{ id: string; text: string; source: string }> = [];
  for (const item of result.items) {
    const source = (item.source ?? '').trim();
    if (source.length === 0 || item.text.trim().length === 0) continue;
    passages.push({ id: item.id, text: item.text, source });
  }
  return passages;
}
