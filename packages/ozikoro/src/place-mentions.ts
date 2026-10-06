/**
 * The records that NAME a place, and the words they name it with.
 *
 * ── THE FAULT THIS ANSWERS, IN THE OWNER'S OWN REPORT ──────────────────────────────────────────────
 *
 * `/town/ndizuogu/` told him *"The archive links no published history to Ndizuogu yet. Its neighbours'
 * histories are not shown here, because a link to another community is not a history of this one."*
 * **That sentence is right and it stays** — `getEntityBySlug` reads `ozikoro_article_entity`, and an
 * archive that answers "histories about this place" with a record about somewhere else has misled the
 * reader. What was missing was a SECOND, WEAKER, TRUE CLAIM underneath it: records whose own words name
 * the place. The owner then searched and found many, and the archive held every one of them already.
 *
 *     histories ABOUT a place    — catalogued under it. `ozikoro_article_entity`. Zero is a real state.
 *     records that MENTION it    — their own words name it. THIS MODULE. Also possibly zero.
 *
 * **⚠️ THE TWO ARE NEVER MERGED.** They are rendered as two lists under two headings, and this module
 * also returns the words each list was built from, because a mention is only defensible if the reader can
 * see which spelling was counted and which was refused.
 *
 * ── WHY A MENTION IS STILL EVIDENCE, AND WHERE IT IS NOT ────────────────────────────────────────────
 *
 * `entity-graph.ts` links an article to a place on its TITLE alone, and says why: a title match is
 * evidence the record is ABOUT the place; a body match is evidence the place was mentioned, which is a
 * far weaker claim. **A mention is not a history, and a record that lists a town in a bibliography is not
 * a record about the town.** So this module's output is shown as mentions and never promoted to links,
 * and its intro sentence says so on the page.
 *
 * A title mention is stronger than a body mention, and the two are told apart here (`PlaceMention.inTitle`)
 * for exactly that reason. A mention inside a citation is NOT told apart: a body that cites a work whose
 * title names the place does name the place in its own words, and no structural rule in this data
 * separates a citation from prose without inventing one. **So every body mention is reported as a body
 * mention and none of them is presented as anything more.**
 *
 * ── WHAT IS STRIPPED BEFORE MATCHING, AND WHY THAT IS NOT OPTIONAL ──────────────────────────────────
 *
 * Bodies are WordPress HTML — tags, attributes, shortcodes and entities. Matching against markup would
 * count `<a href="/entities/ndizuogu/">` as a mention, which is a link this archive wrote, not something
 * the record's author said. `recordText` therefore removes tags, HTML comments, shortcode syntax and
 * URLs, and decodes entities — `&#038;` is a live fault being repaired elsewhere in this repository, and a
 * matcher that read the raw column would be reading the fault. **The word boundary is then applied to
 * text, never to markup.**
 *
 * ── THE COST, WHICH IS WHY THIS IS NOT A PER-PAGE SCAN ──────────────────────────────────────────────
 *
 * 267 place pages × 1,052 published records is a scan of every body per page, which is not viable. The
 * candidate set here comes from the GIN index on `ozikoro_article.search_vector` (migration 0035), the
 * same index `archive.ts` searches with, so the database returns a handful of rows instead of a megabyte
 * of HTML. **No new table and no new index are added**, so there is no precomputation to go stale when a
 * record is edited — the answer is recomputed from the record itself on every request.
 *
 * ⚠️ AND THE SHAPE OF THE STATEMENT IS WHAT MAKES THE INDEX GET USED — MEASURED, NOT ASSUMED.
 * `explain (analyze)` on the archive's own 1,051 records, for the token `Arondizuogu`:
 *
 *     the full-text predicate in the same WHERE as `status`/`is_page`   74.1 ms, reads all 1,051 rows
 *     the full-text predicate alone in a MATERIALIZED cte, joined back    6.2 ms, 23 index entries
 *     no full-text predicate at all — the per-page body scan forbidden 1846.2 ms
 *
 * The reason is a partial index: `ozikoro_article_title_idx` is `btree (id) where status = 'published'
 * and is_page = false`, and when those two predicates appear beside the full-text one the planner can
 * satisfy them with a bitmap over that index — every published record — and then test the tsvector in the
 * heap. **Inside a materialized CTE the full-text predicate stands alone, that partial index cannot cover
 * it, and the GIN index answers it: 23 index entries, 12 rows, and the body is read for those twelve.**
 * The publish-state test then happens on the join, where it is an index lookup on twelve ids.
 *
 * ("Materialized" is not decoration: without it Postgres may inline the CTE and put the predicates back
 * together, and the plan regresses to the 74 ms shape. It is written for that reason and the measurement
 * above is how it was found.) The `strpos` line then narrows those twelve before any HTML reaches
 * JavaScript — it is a SUPERSET test, never the match, so it can only drop rows the word boundary would
 * drop too. See the note on it below.
 */
import type { Db } from '@ozituma/db/client';
import { evidenceNames, nameOccurrence, type EvidenceNames } from './entity-graph.ts';

/* ------------------------------------------------------------------------------------------------
 * The record's own words, with the markup taken off
 * ---------------------------------------------------------------------------------------------- */

/** The named entities that actually occur in this archive's bodies, and the plain character each one is. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  '#8217': '’',
  '#8216': '‘',
  '#8220': '“',
  '#8221': '”',
  '#8230': '…',
  '#8211': '–',
  '#8212': '—',
  '#038': '&',
};

/**
 * A code point, or the reference as written when the number is not one.
 *
 * `String.fromCodePoint` throws on an out-of-range number, and a body containing `&#99999999;` must not
 * take the page down; leaving the reference as text is the honest fallback, because it is exactly what the
 * record holds.
 */
function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return '';
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/**
 * A record's body with the markup taken off, so the matcher reads what the record SAYS.
 *
 * The order matters and each step is here for a measured reason:
 *
 *   1. **HTML comments first** — `<!-- … -->` can contain anything, and the tag rule below would leave a
 *      comment's interior behind as if it were prose.
 *   2. **Tags, replaced by a space** — this is what `search_vector` does in migration 0035
 *      (`regexp_replace(body_html, '<[^>]+>', ' ', 'g')`), and the space is deliberate: `<em>a</em>b`
 *      becoming `ab` would weld two words into one that the record never wrote.
 *   3. **Shortcode syntax** — `[caption id="x"]A[/caption]` keeps its words and loses its attributes;
 *      `[gallery ids="1,2"]` disappears, ids and all, because an id is not a word the record wrote.
 *   4. **URLs** — a link is an address, not a sentence. A record that merely links to a page about the
 *      place has not named it; if it also names it in the prose, the prose is still there. **A bare host
 *      counts too**, and that second half was found by measurement rather than by reasoning: a record whose
 *      only occurrence of `Arochukwu` was the host `www.arochukwu.info` was matched by text and missed by
 *      the full-text index, which indexes that host as one lexeme. The two disagreed, and the index was
 *      right — a domain is an address.
 *   5. **Entities last** — decoding after the tags are gone cannot invent a tag.
 */
export function recordText(html: string): string {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[[^[\]]*\]/g, ' ')
      .replace(/\bhttps?:\/\/\S+/gi, ' ')
      // A hostname with no scheme, which the browser-era WordPress bodies are full of.
      .replace(/\bwww\.[^\s<>"']+/gi, ' ')
      // Hex and decimal references, then the handful of named entities this archive actually writes.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
      .replace(/&([a-z]+|#\d+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
      // Collapse the runs the replacements leave, so a snippet reads as a sentence rather than as gaps.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/* ------------------------------------------------------------------------------------------------
 * Which of a place's names a record's own words carry
 * ---------------------------------------------------------------------------------------------- */

/** One record that names the place, and how it names it. */
export interface PlaceMention {
  slug: string;
  title: string;
  /** The tokens this record carries, in the order `evidenceNames` returned them. Never empty. */
  tokens: string[];
  /**
   * True when the record's TITLE carries one of the tokens.
   *
   * Stated rather than inferred on the page, because the two are different claims: a title match is
   * evidence the record is about the place, and a body-only match is a mention. See this file's header.
   */
  inTitle: boolean;
}

/**
 * Is this occurrence written as a NAME, or as the ordinary word the name also is?
 *
 * ── THE MEASUREMENT THAT MADE THIS A RULE ──────────────────────────────────────────────────────────
 *
 * The register's 231 name and alias tokens include words that are also ordinary Igbo or English: `Item`
 * is a town in Abia State and the English noun; `Ihe` is a clan's alias and the Igbo word for *thing*;
 * `Oke` is a town and the word for *rat* or *portion*. A word-boundary match cannot tell them apart.
 * Measured against all 1,051 published records, for the town `Item`: **23 records carry the word at a word
 * boundary and 18 of them write it in lower case — "a significant trade item", "each item carries
 * traditional symbols", "the first item offered to guests".** None of those records mentions Item.
 *
 * Across every one of the 188 published places the rule costs **67 of 1,787 matches, 3.7%**, and the places
 * it changes are exactly the ones this fault is about: `Item` 23 → 5, `Ihechiowa` 54 → 27 (its alias `Ihe`
 * is the Igbo word for *thing*), `Oke` 18 → 12, `Umu-Eri` 24 → 20.
 *
 * **The archive's own words decide the direction: "a wrong one is worse than a missing one"**
 * (`NAME_IS_NOT_EVIDENCE`, `entity-graph.ts`). A record that says *"each item carries traditional
 * symbols"* does not mention the town, and the page must not say it does. So a mention counts when the
 * occurrence is written with a capital — as the register writes the name, and as this archive's prose
 * writes a place — including an all-capitals occurrence. **This narrows the mention claim only.** The
 * title match that links a record to a place in the graph is untouched, and `titleNames` stays
 * case-insensitive for it.
 */
export function writtenAsName(surface: string): boolean {
  const first = [...surface].find((character) => /\p{L}/u.test(character));
  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Read one record and say which of the place's names it carries.
 *
 * `null` when it carries none — which is the answer for most records and for most places, and is why the
 * caller has an empty state rather than a blank grid.
 */
export function classifyMention(
  record: { title: string; text: string },
  tokens: readonly string[]
): { tokens: string[]; inTitle: boolean } | null {
  /** The names this text carries, in the order the register holds them, written as names. */
  const carried = (text: string): string[] =>
    tokens.filter((token) => {
      const found = nameOccurrence(text, token);
      return found !== null && writtenAsName(found.surface);
    });
  const inTitle = carried(record.title);
  const inText = carried(record.text);
  // The title's tokens first, then any the body carries and the title does not.
  const matched = [...inTitle, ...inText.filter((token) => !inTitle.includes(token))];
  if (matched.length === 0) return null;
  return { tokens: matched, inTitle: inTitle.length > 0 };
}

/** Everything the place page needs to render the mention list honestly, including its refusals. */
export interface PlaceMentions {
  /** What was read, for the page to print: the name first, then the aliases that survive the rules. */
  names: EvidenceNames;
  /** The records that name the place, title matches first as the stronger claim. Capped — see `total`. */
  mentions: PlaceMention[];
  /** How many records name the place in all. Greater than `mentions.length` only when the list is capped. */
  total: number;
}

/**
 * How many mentions one page lists.
 *
 * A cap rather than no cap because a place whose name is also an ordinary word can be named by a great
 * many records — the archive's own strongest case is `Umunri`, with 145 — and a page that renders all of
 * them is slow to build and unreadable. **`total` is returned beside the list and the page prints it
 * whenever it differs**, so a capped list says it is capped rather than reading as the whole of it: the
 * failure this repository keeps recording is a truncated list presented as a census.
 */
export const MENTION_LIMIT = 48;

/**
 * The records whose own words name this place — the second, weaker, true claim.
 *
 * `excludeSlugs` is the list the page has already shown as histories ABOUT the place. A record linked to
 * the place is not repeated as a record that mentions it; the page says so in words, because a reader who
 * cannot see why a record they found by searching is absent would reasonably think the search failed.
 *
 * `options.limit` raises the page's cap. It exists because the cap is a presentation decision — a
 * measurement or an export wants the whole set, and reading `mentions` alone cannot tell a capped answer
 * from a complete one. `total` is always the uncapped count.
 */
export async function listPlaceMentions(
  db: Db,
  place: { name: string; aliases: string[] | null },
  excludeSlugs: readonly string[] = [],
  options: { limit?: number } = {}
): Promise<PlaceMentions> {
  /*
   * `ownedNames` is only read when there are aliases to test against it. A place whose only name is its
   * own cannot be dropped by the ownership rule, so the query would be one round trip per page for an
   * answer that cannot change the result — and at 267 places that is 267 pointless reads.
   */
  const aliases = (place.aliases ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
  const ownedNames = aliases.length
    ? new Set(
        (
          await db.rows<{ name: string }>(
            `select name from ozikoro_entity where clan_id is not null`
          )
        ).map((r) => String(r.name).trim().toLowerCase())
      )
    : new Set<string>();

  const names = evidenceNames({ name: place.name, aliases }, ownedNames);

  /*
   * A MAP BY ARTICLE ID, so a record that carries two of the place's names is read and listed once.
   *
   * One query per token rather than one query with every token OR-ed together: each of these is a single
   * index lookup on `search_vector`, and the number of tokens is the place's name plus the aliases that
   * survive the rules — one for most of the register's 188 entries, and never more than six.
   */
  const candidates = new Map<number, { slug: string; title: string; body: string; publishedAt: string | null }>();

  for (const token of names.counted) {
    const parts = token.split(/[\s\u2010-\u2015_\-]+/).filter(Boolean);
    /*
     * ── WHY EVERY PART IS ASKED FOR AS A PREFIX, WHICH IS NOT AN OPTIMISATION ────────────────────
     *
     * `to_tsvector` is not a word-boundary engine, so a lexeme is not always a word. Measured on the
     * archive: the record *"funeral-rites-for-dead-young-people-in-igboland"* says **"In Nsukka/Igbo-Ukwu
     * areas"**, and the index holds that as the single lexeme `nsukka/igbo-ukwu`. The exact query
     * `plainto_tsquery('english', 'Nsukka')` therefore does NOT match it, while the word-boundary rule
     * does — **the candidate step was losing a real mention, and the cross-check against a full scan of
     * every body is what found it.** `to_tsquery('english', 'nsukka:*')` does match it (111 rows against
     * the exact form's 110), because a prefix asks about the head of a lexeme rather than the whole of it.
     *
     * The whole token is asked for as one AND of its parts' prefixes, so the separator between the parts
     * no longer matters: `Aro-Ndizuogu` and `Aro Ndizuogu` both satisfy `aro:* & ndizuogu:*` — which
     * replaces the earlier pair of as-written and space-separated forms, and reaches the `/` case they
     * could not. The rule applied to the record afterwards is still `entity-graph.ts`'s own boundary rule
     * (`nameOccurrence`), so a prefix match that is not a word-boundary match is discarded in JavaScript.
     *
     * **AND WHAT THIS STILL CANNOT REACH, SAID PLAINLY RATHER THAN LEFT TO BE DISCOVERED.** A tsquery
     * cannot ask about the tail of a lexeme. If a record writes a name at the END of a tokenizer-joined
     * compound — `Igbo/Nsukka` rather than `Nsukka/Igbo-Ukwu` — no prefix query finds it and the record
     * will not be listed. Nothing in the 1,051 records read for this change does that, and the cross-check
     * in the report is the evidence; it is a limit of the index, and a full scan of every body on every
     * page is the thing the brief forbids paying to avoid it.
     *
     * `to_tsquery` reads its input as a QUERY, so a name containing `&`, `|`, `!`, `(`, `)` or `:` would
     * be a syntax error and would take the page down. **Every one of the register's 231 name and alias
     * tokens is letters and digits only** (`Aro-Ndizuogu` splits on the dash into `Aro` and `Ndizuogu`),
     * so the prefix form is always constructible today; the check below falls back to `plainto_tsquery`,
     * which treats its input as text, for a name a later edit gives a punctuation mark to.
     */
    const safe = parts.length > 0 && parts.every((p) => /^[\p{L}\p{N}]+$/u.test(p));
    const params = safe ? [parts.map((p) => `${p}:*`).join(' & ')] : [token];
    // No table alias: this predicate is read inside the CTE below, where there is one table.
    const fts = safe
      ? `search_vector @@ to_tsquery('english', $1)`
      : `search_vector @@ plainto_tsquery('english', $1)`;

    /*
     * ⚠️ THE CANDIDATE SELECT IS A MATERIALIZED CTE, AND THAT IS WHAT MAKES THE INDEX GET USED.
     *
     * The full-text predicate stands ALONE inside it: `status` and `is_page` are tested on the join
     * outside. With those two beside the full-text predicate in one WHERE, the planner satisfies them
     * from the partial index `ozikoro_article_title_idx` — which covers every published record — and then
     * tests the tsvector in the heap. Measured on the archive's own records, for `Arondizuogu`:
     * 74.1 ms reading all 1,051 rows in that shape, 6.2 ms reading 12 in this one.
     *
     * ── AND NO `strpos` PREFILTER, WHICH WAS HERE FIRST AND HAD TO GO ─────────────────────────────
     *
     * The first version narrowed these candidates in SQL with
     * `strpos(lower(regexp_replace(body_html, '<[^>]+>', ' ', 'g')), lower(longestPart)) > 0`. It is a
     * correct superset test and it is the wrong thing to do, and the measurement says so: for the town
     * `Item` — whose name is also an ordinary English noun, so the index returns 136 candidates — the
     * prefilter costs **3,620 ms**, the same query with the tag-stripping removed costs 1,293 ms, and the
     * index alone costs **12.7 ms**. `regexp_replace` rewrites every candidate body, and the bodies that
     * survive are then re-read and stripped again in `recordText` below. The JavaScript rule is the
     * authority, so the SQL does the one thing only SQL can do — find the candidates with the index — and
     * nothing more. Measured across the ten slowest places: `igbuzo` 1,857 → 11 ms, `onicha` 1,588 →
     * 31 ms, `asaba` 2,627 → 100 ms.
     */
    const rows = await db.rows<{ id: number; slug: string; title: string; body_html: string; published_at: string | null }>(
      `with hit as materialized (
         select id from ozikoro_article where (${fts})
       )
       select a.id, a.slug, a.title, a.body_html, a.published_at
         from ozikoro_article a
         join hit on hit.id = a.id
        where a.status = 'published' and a.is_page = false`,
      params
    );

    for (const row of rows) {
      if (candidates.has(row.id)) continue;
      candidates.set(row.id, {
        slug: String(row.slug),
        title: String(row.title),
        body: String(row.body_html ?? ''),
        publishedAt: row.published_at == null ? null : String(row.published_at),
      });
    }
  }

  const excluded = new Set(excludeSlugs);
  const matched: { mention: PlaceMention; publishedAt: string | null; id: number }[] = [];

  for (const [id, row] of candidates) {
    if (excluded.has(row.slug)) continue;
    /*
     * THE AUTHORITY IS THE WORD BOUNDARY, APPLIED TO STRIPPED TEXT.
     *
     * `nameOccurrence` is `entity-graph.ts`'s own rule — `\p{L}`/`\p{N}` at the edges, a dash treated as a
     * word character — so this list and the graph's own links cannot disagree about what "names the place"
     * means, and `writtenAsName` adds the one thing the mention claim needs and a title does not: the
     * occurrence must be written as a name. The body is stripped by `recordText` first: no tag, attribute,
     * shortcode or entity is ever matched against.
     */
    const verdict = classifyMention({ title: row.title, text: recordText(row.body) }, names.counted);
    if (!verdict) continue;
    matched.push({
      id,
      publishedAt: row.publishedAt,
      mention: { slug: row.slug, title: row.title, tokens: verdict.tokens, inTitle: verdict.inTitle },
    });
  }

  /*
   * Title matches first — the stronger claim — then newest first, then by id so two records published in
   * the same second have a stable order run to run rather than whatever the map iterated.
   */
  matched.sort((a, b) => {
    if (a.mention.inTitle !== b.mention.inTitle) return a.mention.inTitle ? -1 : 1;
    const at = a.publishedAt ?? '';
    const bt = b.publishedAt ?? '';
    if (at !== bt) return at < bt ? 1 : -1;
    return b.id - a.id;
  });

  return {
    names,
    mentions: matched.slice(0, Math.max(options.limit ?? MENTION_LIMIT, 1)).map((m) => m.mention),
    total: matched.length,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The words the page says, kept here so the page and its test read the same sentences
 * ---------------------------------------------------------------------------------------------- */

/**
 * The sentence that stands where a place has no linked history. **Unchanged, word for word.**
 *
 * It is `town/[slug]/page.tsx`'s own sentence, moved here rather than rewritten so the test can assert the
 * bytes the page serves — the same arrangement `renderNoNameableDocuments` uses in `design-fill.ts`. What
 * the owner reported was NOT this sentence being wrong; it was this sentence standing ALONE. It still
 * stands, and the mention list is added beneath it rather than in place of it.
 */
export function noLinkedHistorySentence(name: string): string {
  return `The archive links no published history to ${name} yet. Its neighbours’ histories are not shown here, because a link to another community is not a history of this one.`;
}

/** The heading over the mention list. It says "mention", because that is the claim being made. */
export function mentionsHeading(name: string): string {
  return `Histories that mention ${name}`;
}

/**
 * What the mention list is, said before it is shown.
 *
 * Three things a reader needs and cannot get from the cards: that a mention is the record's own words
 * rather than a catalogue link, that a mention is not a history of the place, and — when the page above has
 * already shown some records — that those are not repeated here.
 */
export function mentionsIntroSentence(name: string, linkedCount: number): string {
  const base =
    `These are published records whose own words name ${name}. A mention is not a history of ${name}, ` +
    `which is why they are listed here rather than with the histories about it.`;
  return linkedCount > 0
    ? `${base} Records already listed above are not repeated.`
    : base;
}

/**
 * Which spellings were read, and which were refused — the footnote that makes the list checkable.
 *
 * `Izuogu` is refused for Ndizuogu, and this is where a reader learns that rather than being left to
 * wonder why a record they found by searching is absent. **The reason printed is the archive's own**,
 * recorded beside the refusal in `entity-graph.ts`; nothing is re-worded here.
 */
export function mentionsNamesSentence(names: EvidenceNames): string {
  const lines: string[] = [];
  if (names.counted.length > 0) {
    lines.push(
      `Read as: ${names.counted.join(', ')}. Counted where the name is written with a capital, ` +
        `because a lower-case occurrence of a name that is also an ordinary word is the word.`
    );
  }
  for (const r of names.refused) {
    lines.push(`“${r.token}” is not counted on its own — in this archive it is ${r.reason}.`);
  }
  for (const token of names.ownedByAnother) {
    lines.push(`“${token}” is not counted here — another entry in the register already bears that name.`);
  }
  for (const token of names.tooShort) {
    lines.push(`“${token}” is not counted — too short to be a name on its own.`);
  }
  return lines.join(' ');
}

/** What stands where no published record names the place: a real state, said plainly. */
export function noRecordNamesSentence(name: string): string {
  return `No published record in this archive names ${name} in its own words.`;
}

/**
 * The note that a capped list is capped.
 *
 * `null` when nothing was cut, so the page cannot print "showing 4 of 4" over a complete list.
 */
export function mentionsCapSentence(shown: number, total: number): string | null {
  return total > shown ? `Showing the ${shown} most recent of ${total} records that name it.` : null;
}
