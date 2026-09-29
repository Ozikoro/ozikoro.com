/**
 * Read layer: search, word detail, and reference lookups.
 *
 * SEARCH DESIGN
 *
 * The reference implementation searches Igbo by building a regex per letter
 * (its `diacriticCodes.ts`), running two unindexed Mongo aggregations, then
 * re-ranking in JavaScript with four `stringSimilarity.compareTwoStrings`
 * calls per document. That cannot use an index at any point, which is why it
 * needed a Redis cache in front and still shipped a `strict` flag as a
 * documented workaround.
 *
 * Ozituma instead stores two derived keys per headword (see orthography.ts)
 * and lets Postgres do the matching against indexes:
 *
 *   search_form = 'akwa'   exact, indexed (btree)          -> score 1000
 *   search_form LIKE 'akw%'  prefix, indexed (text_pattern_ops) -> 600
 *   word_form / word_dialect hits  alternate spellings      -> 800 / 700
 *   pg_trgm similarity       typo tolerance (GIN, when available)
 *   tsvector @@ tsquery      full-text fallback and definitions
 *
 * A single search runs BOTH directions and merges them, because that is what a
 * dictionary user actually wants: type "water" and get Igbo words, type "mmiri"
 * and get its English meanings — without choosing a mode.
 *
 * NOTE ON SCALE: the substring (`LIKE '%x%'`) fallback cannot use a btree
 * index. At the current corpus size (~8.8k headwords) that is a sub-millisecond
 * scan and the right trade for correctness. Beyond roughly a million rows, add
 * the pg_trgm GIN index in production (already created by migration 0002 where
 * the extension exists) and this path becomes indexed automatically.
 */
import type { Db } from './client.ts';
import { getStorage } from './storage.ts';

export interface WordSummary {
  id: number;
  language: string;
  headword: string;
  exactForm: string;
  slug: string;
  pronunciation: string | null;
  isCommon: boolean;
  isVerified: boolean;
  frequencyRank: number | null;
  /** Up to three glosses, for display in a result row. */
  glosses: string[];
  partOfSpeech: string | null;
  /** Why this row matched: 'headword' | 'variant' | 'dialect' | 'definition' | 'fuzzy'. */
  matchType: string;
  score: number;
}

export interface SearchResult {
  data: WordSummary[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  /** Which indexes and strategies this search actually used. */
  diagnostics: {
    driver: string;
    trigram: boolean;
    strategy: string;
  };
}

export interface SearchWordsParams {
  query: string;
  language?: string;
  page?: number;
  perPage?: number;
  /** Restrict to whole-headword matches (the reference's `strict` flag). */
  strict?: boolean;
  /** Filter by dialect code, e.g. 'ONI'. */
  dialect?: string;
  /** Filter by grammar category codes, e.g. ['NNC','AV']. */
  wordClasses?: string[];
  tags?: string[];
  commonOnly?: boolean;
}

export const DEFAULT_LANGUAGE = 'ibo';
export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;

function clampPagination(page?: number, perPage?: number): { page: number; perPage: number } {
  const p = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
  const raw = Number.isFinite(perPage) && (perPage as number) > 0 ? Math.floor(perPage as number) : DEFAULT_PER_PAGE;
  return { page: p, perPage: Math.min(raw, MAX_PER_PAGE) };
}

/** Escape LIKE metacharacters so a query containing % or _ is treated literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * The target-language search: match against headwords, alternate spellings and
 * dialect spellings, scoring exact > prefix > substring > fuzzy.
 *
 * Placeholders and the parameter array are built together. Building the SQL
 * with fixed numbers while passing a fixed-length parameter array is a bug
 * waiting to happen — Postgres rejects a bind that supplies more parameters
 * than the statement references, and every optional filter changes how many
 * placeholders exist.
 */
function buildWordSearchQuery(opts: {
  term: string;
  likeTerm: string;
  language: string;
  trigram: boolean;
  strict: boolean;
  dialect?: string | undefined;
  wordClasses?: string[] | undefined;
  tags?: string[] | undefined;
  commonOnly?: boolean | undefined;
}): { sql: string; params: unknown[] } {
  const params: unknown[] = [
    opts.term, // $1 — exact key
    `${opts.likeTerm}%`, // $2 — prefix
    `%${opts.likeTerm}%`, // $3 — substring
    opts.language, // $4
  ];

  const fuzzyScore = opts.trigram ? `, similarity(w.search_form, $1) * 300` : '';
  const fuzzyMatch = opts.trigram ? `or w.search_form % $1` : '';

  const filters: string[] = [];
  if (opts.dialect) {
    params.push(opts.dialect);
    filters.push(`exists (
      select 1 from word_dialect wd2
        join dialect dl on dl.id = wd2.dialect_id
       where wd2.word_id = w.id and dl.code = $${params.length})`);
  }
  if (opts.wordClasses && opts.wordClasses.length > 0) {
    params.push(opts.wordClasses);
    filters.push(`exists (
      select 1 from definition d2
        join part_of_speech p2 on p2.id = d2.part_of_speech_id
       where d2.word_id = w.id and p2.code = any($${params.length}::text[]))`);
  }
  if (opts.tags && opts.tags.length > 0) {
    params.push(opts.tags);
    filters.push(`exists (
      select 1 from word_tag wt
        join tag t on t.id = wt.tag_id
       where wt.word_id = w.id and t.slug = any($${params.length}::text[]))`);
  }
  if (opts.commonOnly) filters.push(`w.is_common`);

  const filterSql = filters.length > 0 ? `and ${filters.join(' and ')}` : '';

  // In strict mode only whole-headword matches count — the documented escape
  // hatch the reference implementation needed for exact lookups.
  const matchPredicate = opts.strict
    ? `w.search_form = $1`
    : `(w.search_form = $1
        or w.search_form like $2
        or w.search_form like $3
        or exists (select 1 from word_form f
                    where f.word_id = w.id and f.search_form like $3)
        or exists (select 1 from word_dialect wd
                    where wd.word_id = w.id and wd.search_form like $3)
        ${fuzzyMatch})`;

  const sql = `
    select
      w.id,
      w.language_code,
      w.headword,
      w.exact_form,
      w.slug,
      w.pronunciation,
      w.is_common,
      w.is_verified,
      w.frequency_rank,
      greatest(
        case when w.search_form = $1 then 1000 else 0 end,
        case when w.search_form like $2 then 600 else 0 end,
        case when w.search_form like $3 then 300 else 0 end,
        coalesce((select max(case
                    when f.search_form = $1 then 800
                    when f.search_form like $2 then 400
                    else 0 end)
                   from word_form f
                  where f.word_id = w.id and f.search_form like $3), 0),
        coalesce((select max(case
                    when wd.search_form = $1 then 700
                    when wd.search_form like $2 then 350
                    else 0 end)
                   from word_dialect wd
                  where wd.word_id = w.id and wd.search_form like $3), 0)
        ${fuzzyScore}
      ) as base_score,
      case
        when w.search_form = $1 then 'headword'
        when w.search_form like $2 then 'headword'
        when w.search_form like $3 then 'headword'
        when exists (select 1 from word_form f
                      where f.word_id = w.id and f.search_form like $3) then 'variant'
        when exists (select 1 from word_dialect wd
                      where wd.word_id = w.id and wd.search_form like $3) then 'dialect'
        else 'fuzzy'
      end as match_type
    from word w
    where w.language_code = $4
      and w.status = 'published'
      ${filterSql}
      and ${matchPredicate}
  `;

  return { sql, params };
}

export async function searchWords(db: Db, params: SearchWordsParams): Promise<SearchResult> {
  const { page, perPage } = clampPagination(params.page, params.perPage);
  const language = params.language ?? DEFAULT_LANGUAGE;
  const rawQuery = (params.query ?? '').trim();
  const trigram = await db.hasTrigram();

  // An empty query is a valid request — it means "browse". We return common
  // words rather than nothing, which is a friendlier default than the
  // reference implementation's behaviour of matching nothing when no keyword
  // is supplied by a non-privileged key.
  if (rawQuery.length === 0) {
    return browseWords(db, { language, page, perPage, commonOnly: params.commonOnly ?? true });
  }

  const { deriveForms, getLanguage } = await import('@ozituma/core');
  const derived = deriveForms(rawQuery, getLanguage(language));
  const term = derived.searchForm;
  const likeTerm = escapeLike(term);

  const { sql, params: wordParams } = buildWordSearchQuery({
    term,
    likeTerm,
    language,
    trigram,
    strict: params.strict ?? false,
    dialect: params.dialect,
    wordClasses: params.wordClasses,
    tags: params.tags,
    commonOnly: params.commonOnly,
  });

  // Definitions direction: ranked full-text over the English glosses.
  const definitionSql = `
    select
      w.id,
      w.language_code,
      w.headword,
      w.exact_form,
      w.slug,
      w.pronunciation,
      w.is_common,
      w.is_verified,
      w.frequency_rank,
      (100 + ts_rank(d.search_vector, plainto_tsquery('english', $1)) * 400)::numeric as base_score,
      'definition' as match_type
    from definition d
    join word w on w.id = d.word_id
    where w.language_code = $2
      and w.status = 'published'
      and d.language_code = 'eng'
      and d.search_vector @@ plainto_tsquery('english', $1)
  `;

  const [wordRows, definitionRows] = await Promise.all([
    db.rows<Record<string, unknown>>(sql, wordParams),
    db.rows<Record<string, unknown>>(definitionSql, [rawQuery, language]),
  ]);

  // Merge: a headword match beats a definition match for the same word.
  const merged = new Map<number, { row: Record<string, unknown>; score: number; matchType: string }>();

  for (const row of [...wordRows, ...definitionRows]) {
    const id = Number(row.id);
    const score = Number(row.base_score ?? 0);
    const matchType = String(row.match_type ?? 'headword');
    const existing = merged.get(id);
    if (!existing || score > existing.score) {
      merged.set(id, { row, score, matchType });
    }
  }

  // Common words and shorter headwords get a nudge, so "mmiri" outranks a
  // long compound that merely contains it.
  const ranked = [...merged.values()]
    .map((entry) => {
      const headword = String(entry.row.headword ?? '');
      let score = entry.score;
      if (entry.row.is_common) score += 150;
      score += Math.max(0, 30 - headword.length);
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score || String(a.row.headword).localeCompare(String(b.row.headword)));

  const total = ranked.length;
  const start = (page - 1) * perPage;
  const pageRows = ranked.slice(start, start + perPage);

  const data = await decorateSummaries(
    db,
    pageRows.map((entry) => ({ row: entry.row, matchType: entry.matchType, score: entry.score }))
  );

  return {
    data,
    total,
    page,
    perPage,
    hasMore: start + pageRows.length < total,
    diagnostics: { driver: db.driver, trigram, strategy: params.strict ? 'strict' : 'scored' },
  };
}

/** Browse mode: no query supplied, so show the most useful words. */
export async function browseWords(
  db: Db,
  params: { language: string; page: number; perPage: number; commonOnly?: boolean }
): Promise<SearchResult> {
  const { language, page, perPage } = params;
  const offset = (page - 1) * perPage;

  const rows = await db.rows<Record<string, unknown>>(
    `select w.id, w.language_code, w.headword, w.exact_form, w.slug, w.pronunciation,
            w.is_common, w.is_verified, w.frequency_rank,
            coalesce(w.frequency_rank, 999999) as sort_rank,
            'headword' as match_type,
            0 as base_score
       from word w
      where w.language_code = $1
        and w.status = 'published'
        and ($4 = false or w.is_common)
      order by sort_rank asc, w.headword asc
      limit $2 offset $3`,
    [language, perPage, offset, params.commonOnly ?? false]
  );

  const totalRow = await db.one<{ n: number }>(
    `select count(*)::int as n from word
      where language_code = $1 and status = 'published' and ($2 = false or is_common)`,
    [language, params.commonOnly ?? false]
  );

  const data = await decorateSummaries(
    db,
    rows.map((row) => ({ row, matchType: 'headword', score: 0 }))
  );

  return {
    data,
    total: Number(totalRow?.n ?? 0),
    page,
    perPage,
    hasMore: offset + rows.length < Number(totalRow?.n ?? 0),
    diagnostics: { driver: db.driver, trigram: await db.hasTrigram(), strategy: 'browse' },
  };
}

/**
 * Attach glosses and grammar to result rows in one extra query rather than
 * one per row, which is the N+1 the reference implementation's per-document
 * `$lookup` avoided only by aggregating the entire collection.
 */
async function decorateSummaries(
  db: Db,
  entries: { row: Record<string, unknown>; matchType: string; score: number }[]
): Promise<WordSummary[]> {
  if (entries.length === 0) return [];

  const ids = entries.map((e) => Number(e.row.id));
  const definitionRows = await db.rows<{
    word_id: string;
    text: string;
    position: number;
    pos_code: string | null;
    pos_name: string | null;
  }>(
    `select d.word_id, d.text, d.position, p.code as pos_code, p.name as pos_name
       from definition d
       left join part_of_speech p on p.id = d.part_of_speech_id
      where d.word_id = any($1::bigint[])
      order by d.word_id, d.position`,
    [ids]
  );

  const byWord = new Map<number, { glosses: string[]; pos: string | null }>();
  for (const row of definitionRows) {
    const wordId = Number(row.word_id);
    const bucket = byWord.get(wordId) ?? { glosses: [], pos: null };
    if (bucket.glosses.length < 3) bucket.glosses.push(row.text);
    const pos = classifiedPartOfSpeech(row.pos_code, row.pos_name);
    if (bucket.pos === null && pos) bucket.pos = pos.name;
    byWord.set(wordId, bucket);
  }

  return entries.map(({ row, matchType, score }) => {
    const id = Number(row.id);
    const bucket = byWord.get(id);
    return {
      id,
      language: String(row.language_code),
      headword: String(row.headword),
      exactForm: String(row.exact_form),
      slug: String(row.slug),
      pronunciation: (row.pronunciation as string | null) ?? null,
      isCommon: Boolean(row.is_common),
      isVerified: Boolean(row.is_verified),
      frequencyRank: row.frequency_rank === null ? null : Number(row.frequency_rank),
      glosses: bucket?.glosses ?? [],
      partOfSpeech: bucket?.pos ?? null,
      matchType,
      score: Math.round(score),
    };
  });
}

export interface WordDetail extends WordSummary {
  definitions: {
    text: string;
    label: string | null;
    position: number;
    partOfSpeech: { code: string; name: string } | null;
  }[];
  dialects: { code: string; name: string; spelling: string }[];
  forms: { formType: string; value: string }[];
  /**
   * The headword written in an alternative script — Ndebe, and whatever else
   * the table carries later.
   *
   * The table was left in place when Nsibidi was removed at the owner's
   * direction, on the reasoning that it is script-agnostic. This is the first
   * thing to write to it.
   */
  scripts: { code: string; value: string; note: string | null }[];
  examples: Array<{ id: number; text: string; translation: string | null }>;
  /**
   * Stored relations, in BOTH directions, because they do not mean the same
   * thing and a reader needs both.
   *
   * `direction` is from this entry's point of view: `out` means this entry lists
   * that word (a compound naming its root), `in` means that word lists this one
   * (the root, which is the entry a reader is most likely to be on). The corpus
   * only ever stores the compound-to-stem direction, so reading `out` alone — as
   * this did — left every root showing nothing at all: `nne` had thirteen
   * relations and its page said none.
   */
  related: {
    relationType: string;
    direction: 'in' | 'out';
    id: number;
    headword: string;
    slug: string;
  }[];
  audio: {
    url: string;
    dialect: string | null;
    /**
     * The dialect spelling this recording is OF, when it is a dialect
     * recording. This is what the entry page matches a chip on.
     */
    dialectSpelling: string | null;
    speaker: string | null;
    /**
     * True when this recording IS the headword's own pronunciation, false when
     * it belongs to a variety's spelling of the word.
     *
     * The distinction has to travel with the clip, because the two are not
     * interchangeable and array order is not a promise. /word/igbo/ike is the
     * case that proved it: that entry's own recording had been removed, the six
     * surviving clips all belonged to dialect spellings, and the page took the
     * first of them — Ọnịcha's recording of "ume" — and put it beside the
     * headword under "Voice recording". The page said "ike" and played "ume".
     */
    isHeadword: boolean;
  }[];
  attribution: {
    sourceName: string;
    sourceUrl: string | null;
    license: string;
    licenseUrl: string | null;
    citation: string | null;
  } | null;
}

/** Full detail for one entry, by numeric id or by slug. */
export async function getWord(
  db: Db,
  identifier: string | number,
  language: string = DEFAULT_LANGUAGE
): Promise<WordDetail | null> {
  const numeric = typeof identifier === 'number' ? identifier : Number(identifier);
  const byId = Number.isFinite(numeric) && String(numeric) === String(identifier);

  const row = await db.one<Record<string, unknown>>(
    `select w.*, s.name as source_name, s.url as source_url,
            s.license_code, s.license_url, s.citation
       from word w
       left join source s on s.id = w.source_id
      where w.language_code = $2
        and ${byId ? 'w.id = $1' : 'w.slug = $1'}
      limit 1`,
    [byId ? numeric : String(identifier), language]
  );

  if (!row) return null;
  const id = Number(row.id);

  const [definitions, dialects, forms, scripts, examples, related, audio] = await Promise.all([
    db.rows<{ text: string; label: string | null; position: number; code: string | null; name: string | null }>(
      `select d.text, d.label, d.position, p.code, p.name
         from definition d
         left join part_of_speech p on p.id = d.part_of_speech_id
        where d.word_id = $1 and d.language_code = 'eng'
        order by d.position`,
      [id]
    ),
    db.rows<{ code: string; name: string; spelling: string }>(
      `select dl.code, dl.name, wd.spelling
         from word_dialect wd
         join dialect dl on dl.id = wd.dialect_id
        where wd.word_id = $1
        order by dl.name`,
      [id]
    ),
    db.rows<{ form_type: string; value: string }>(
      `select ft.name as form_type, wf.value
         from word_form wf
         join form_type ft on ft.id = wf.form_type_id
        where wf.word_id = $1
        order by ft.sort_order, wf.value`,
      [id]
    ),
    db.rows<{ script_code: string; value: string; notes: string | null }>(
      `select script_code, value, notes
         from word_script
        where word_id = $1
        order by script_code`,
      [id]
    ),
    db.rows<{ id: string; text: string; translation: string | null }>(
      /*
       * The id travels with the sentence because the edit form has to name the row it is editing.
       * Without it an edit can only be matched by position, and the page shows two examples while an
       * entry may hold twenty — position-matching an edit to the first of two rewrote the first two
       * rows and dropped the links to the rest.
       */
      `select e.id, e.text, e.translation
         from example e
         join example_word ew on ew.example_id = e.id
        where ew.word_id = $1 and e.status = 'published'
        order by e.id
        limit 20`,
      [id]
    ),
    db.rows<{ relation_type: string; direction: string; id: string; headword: string; slug: string }>(
      /*
       * Both directions in one pass.
       *
       * `word_relation` stores a relation once, from the compound to its root:
       * "nne ukwu" -> "nne", relation_type 'stem'. Only the outgoing half used to
       * be read, so a page showed its roots but never its derivatives — and since
       * the interesting direction for a common word is the incoming one, the
       * entries a reader is most likely to open showed no related words at all.
       */
      `select r.relation_type, 'out' as direction, t.id, t.headword, t.slug
         from word_relation r
         join word t on t.id = r.to_word_id
        where r.from_word_id = $1
       union all
       select r.relation_type, 'in' as direction, s.id, s.headword, s.slug
         from word_relation r
         join word s on s.id = r.from_word_id
        where r.to_word_id = $1
       order by relation_type, direction, headword
       limit 80`,
      [id]
    ),
    db.rows<{
      url: string | null;
      storage_key: string | null;
      dialect: string | null;
      dialect_spelling: string | null;
      speaker_name: string | null;
      is_headword: boolean;
    }>(
      /*
       * Dialect recordings are reached through the SPELLING they are of, not
       * through the word they belong to.
       *
       * A dialect recording is owned by its `word_dialect` row, so `a.word_id`
       * is null for it and the old `where a.word_id = $1` did not find them at
       * all. The join is what brings them back, and `dialect_spelling` is what
       * lets the entry page put each one on the right chip. Matching by dialect
       * name instead — which is what it did — plays the wrong recording as soon
       * as a dialect has two spellings for a word, as Ajalị has for "ọrụ".
       *
       * `is_headword` is why the two kinds are labelled rather than merely
       * ordered. The page used to take the array's first element as the
       * headword's own recording, which is only true while a word owns one;
       * `order by a.created_at` does not distinguish the kinds at all, and on
       * /word/igbo/ike — an entry whose own recording had gone — it handed the
       * headword position to Ọnịcha's recording of "ume". Ordering headword
       * recordings first keeps the array readable; the flag is what the page
       * reads, so a word with no recording of its own shows none.
       */
      `select a.external_url as url, a.storage_key, dl.name as dialect,
              wd.spelling as dialect_spelling, a.speaker_name,
              (a.word_id is not null) as is_headword
         from audio a
         left join dialect dl on dl.id = a.dialect_id
         left join word_dialect wd on wd.id = a.word_dialect_id
        where (a.word_id = $1 or wd.word_id = $1) and a.status = 'published'
        order by (a.word_id is not null) desc, a.created_at, a.id`,
      [id]
    ),
  ]);

  const glosses = definitions.slice(0, 3).map((d) => d.text);

  return {
    id,
    language: String(row.language_code),
    headword: String(row.headword),
    exactForm: String(row.exact_form),
    slug: String(row.slug),
    pronunciation: (row.pronunciation as string | null) ?? null,
    isCommon: Boolean(row.is_common),
    isVerified: Boolean(row.is_verified),
    frequencyRank: row.frequency_rank === null ? null : Number(row.frequency_rank),
    glosses,
    // Null when the corpus never classified it, so the entry shows no label
    // rather than the word "Unclassified".
    partOfSpeech: classifiedPartOfSpeech(definitions[0]?.code, definitions[0]?.name)?.name ?? null,
    matchType: 'headword',
    score: 0,
    definitions: definitions.map((d) => ({
      text: d.text,
      label: d.label,
      position: Number(d.position),
      partOfSpeech: classifiedPartOfSpeech(d.code, d.name),
    })),
    dialects: dialects.map((d) => ({ code: d.code, name: d.name, spelling: d.spelling })),
    forms: forms.map((f) => ({ formType: f.form_type, value: f.value })),
    scripts: scripts.map((s) => ({
      code: s.script_code,
      value: s.value,
      note: s.notes,
    })),
    examples: examples.map((e) => ({
      id: Number(e.id),
      text: e.text,
      translation: e.translation,
    })),
    related: related.map((r) => ({
      relationType: r.relation_type,
      direction: r.direction === 'in' ? 'in' : 'out',
      id: Number(r.id),
      headword: r.headword,
      slug: r.slug,
    })),
    audio: audio
      .map((clip) => ({
        // An imported corpus gives a URL; an upload gives a storage key, which
        // must be turned into a URL by whichever driver holds the bytes (an S3
        // or CDN URL in production, /media/<key> locally).
        url: clip.url ?? (clip.storage_key ? getStorage().publicUrl(clip.storage_key) : null),
        dialect: clip.dialect,
        dialectSpelling: clip.dialect_spelling,
        speaker: clip.speaker_name,
        isHeadword: clip.is_headword,
      }))
      .filter(
        (
          clip
        ): clip is {
          url: string;
          dialect: string | null;
          dialectSpelling: string | null;
          speaker: string | null;
          isHeadword: boolean;
        } => clip.url !== null
      ),
    attribution: row.source_name
      ? {
          sourceName: String(row.source_name),
          sourceUrl: (row.source_url as string | null) ?? null,
          license: String(row.license_code),
          licenseUrl: (row.license_url as string | null) ?? null,
          citation: (row.citation as string | null) ?? null,
        }
      : null,
  };
}

export interface LanguageInfo {
  code: string;
  /** What the URL addresses this language by — see LanguageDefinition.urlSlug. */
  urlSlug: string;
  name: string;
  nativeName: string;
  tier: number;
  speakerCount: number | null;
  direction: string;
  wordCount: number;
  dialectCount: number;
}

export async function listLanguages(db: Db): Promise<LanguageInfo[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select l.code, l.url_slug, l.name, l.native_name, l.tier, l.speaker_count, l.direction,
            (select count(*)::int from word w
              where w.language_code = l.code and w.status = 'published') as word_count,
            (select count(*)::int from dialect d where d.language_code = l.code) as dialect_count
       from language l
      where l.is_active and l.code <> 'eng'
      order by l.tier asc, l.sort_order asc, l.name asc`
  );
  return rows.map((row) => ({
    code: String(row.code),
    urlSlug: String(row.url_slug),
    name: String(row.name),
    nativeName: String(row.native_name),
    tier: Number(row.tier),
    speakerCount: row.speaker_count === null ? null : Number(row.speaker_count),
    direction: String(row.direction),
    wordCount: Number(row.word_count),
    dialectCount: Number(row.dialect_count),
  }));
}

export async function getDictionaryStats(db: Db): Promise<{
  words: number;
  definitions: number;
  examples: number;
  dialects: number;
  languages: number;
  languagesWithContent: number;
  audio: number;
}> {
  const row = await db.one<Record<string, unknown>>(
    `select
       (select count(*)::int from word where status = 'published') as words,
       (select count(*)::int from definition) as definitions,
       (select count(*)::int from example where status = 'published') as examples,
       (select count(*)::int from dialect) as dialects,
       (select count(*)::int from language where code <> 'eng') as languages,
       (select count(distinct language_code)::int from word) as languages_with_content,
       (select count(*)::int from audio where status = 'published') as audio`
  );
  return {
    words: Number(row?.words ?? 0),
    definitions: Number(row?.definitions ?? 0),
    examples: Number(row?.examples ?? 0),
    dialects: Number(row?.dialects ?? 0),
    languages: Number(row?.languages ?? 0),
    languagesWithContent: Number(row?.languages_with_content ?? 0),
    audio: Number(row?.audio ?? 0),
  };
}

/**
 * Word of the day: deterministic from the date, so every visitor sees the same
 * word and it needs no scheduled job or cache.
 */
export async function wordOfTheDay(db: Db, language = DEFAULT_LANGUAGE): Promise<WordDetail | null> {
  const row = await db.one<{ id: string }>(
    `select w.id
       from word w
      where w.language_code = $1
        and w.status = 'published'
        and w.is_common
        and exists (select 1 from definition d where d.word_id = w.id)
      order by md5(w.id::text || current_date::text)
      limit 1`,
    [language]
  );
  if (!row) return null;
  return getWord(db, Number(row.id), language);
}

/* --- The name dictionary ------------------------------------------------ */

/*
 * Igbo personal names live in their own table — see 0007_person_names.sql for
 * why a name is not a word — so they get their own readers here rather than
 * being folded into the word queries.
 *
 * Search works the way the dictionary's does, and for the same reason: a name
 * is written with tone marks in its correct spelling and nobody types them, so
 * `adaeze` has to find `Adaeze`. The folded key is stored as search_form, and
 * the query is folded with the same orthography engine the words use.
 */

/**
 * The part of speech code that means "we do not know", and how to read it.
 *
 * `UNK` is a real seeded row — importers need something to point a definition at
 * when a corpus gives them no grammar class, and most of them fall back to it —
 * but it is the ABSENCE of a classification, not one of them. Rendering it put
 * "Unclassified" beside the headword as though it were a category the word
 * belongs to, and put the code `UNK` on every API response for 941 Igbo entries
 * and 6 Yoruba ones.
 *
 * So it is read as nothing here, at the boundary, in one place. The row stays in
 * the table, because the importers are right to use it and a definition still
 * needs a value; what changes is only what a reader and an API client are told.
 * This is the same rule as an unwritten Origin and a name with no documented
 * region: absence is shown as absence, never as a labelled empty value.
 */
export const UNCLASSIFIED_POS_CODE = 'UNK';

/** A part of speech as a reader should see it — or null when there is none. */
export function classifiedPartOfSpeech(
  code: string | null | undefined,
  name: string | null | undefined
): { code: string; name: string } | null {
  if (!code || !name) return null;
  if (code === UNCLASSIFIED_POS_CODE) return null;
  return { code, name };
}

export interface PersonNameSummary {
  id: number;
  name: string;
  slug: string;
  meaning: string | null;
  gender: string;
  variants: string[];
}

/** A form of the same name in a neighbouring Igbo variety, e.g. Wike / Ikwerre. */
export interface VarietyForm {
  form: string;
  variety: string;
}

export interface PersonNameDetail extends PersonNameSummary {
  language: string;
  /**
   * The Igbo regions whose people bear this name, from the closed vocabulary in
   * @ozituma/core. Empty is normal and correct: a name used across all of
   * Igboland has no origin and its entry shows none.
   *
   * This is emphatically NOT where the name was collected. The owner rejected
   * provenance here by name, and `isIgboRegion` is what stops it coming back.
   */
  origins: string[];
  varietyForms: VarietyForm[];
  /**
   * The name written in Ndebe, when it can be. Null for the 68 names the
   * syllabary cannot write — `ŋ` has no body, and a name spelling it gets no
   * value rather than an approximation.
   */
  ndebe: string | null;
  /**
   * Recordings of the name being said.
   *
   * The owner's case: a name is a word said aloud, and `/names/ada` and `/word/igbo/ada-2` are the
   * same word — so the recording made for the dictionary entry was copied here rather than asked
   * for twice. Same shape as a word's clips, so the same player and the same failure reporting are
   * used.
   */
  audio: Array<{ url: string; dialect: string | null; speaker: string | null; isHeadword: boolean }>;
}

export interface ListPersonNamesParams {
  language?: string;
  /** Free text, matched against the name, its folded form and its meaning. */
  query?: string;
  gender?: 'male' | 'female' | 'unisex';
  limit?: number;
  offset?: number;
}

export interface PersonNameList {
  data: PersonNameSummary[];
  total: number;
}

function mapPersonName(row: Record<string, unknown>): PersonNameSummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    meaning: (row.meaning as string | null) ?? null,
    gender: String(row.gender),
    variants: (row.variants as string[] | null) ?? [],
  };
}

export async function listPersonNames(
  db: Db,
  params: ListPersonNamesParams = {}
): Promise<PersonNameList> {
  const language = params.language ?? DEFAULT_LANGUAGE;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);

  const rawQuery = (params.query ?? '').trim();
  const clauses = [`n.language_code = $1`, `n.status = 'published'`];
  const values: unknown[] = [language];

  if (rawQuery.length > 0) {
    const { deriveForms, getLanguage } = await import('@ozituma/core');
    const derived = deriveForms(rawQuery, getLanguage(language));
    values.push(`%${escapeLike(derived.searchForm)}%`, `%${escapeLike(rawQuery)}%`);
    // A name, the folded spelling, the meaning, any of its short forms, the form
    // the name takes in a neighbouring variety — so searching "wike" finds
    // Nwike and "ovunda" finds Obinna — or the region it is borne in, so
    // "Nsukka" lists the names documented there.
    clauses.push(
      `(n.search_form like $2
        or n.name ilike $3
        or n.meaning ilike $3
        or exists (select 1 from unnest(n.variants) v where v ilike $3)
        or exists (select 1 from unnest(n.origins) o where o ilike $3)
        or exists (
             select 1 from jsonb_array_elements(n.variety_forms) f
              where f ->> 'form' ilike $3
           ))`
    );
  }

  if (params.gender) {
    values.push(params.gender);
    clauses.push(`n.gender = $${values.length}`);
  }

  const where = clauses.join(' and ');

  const countRow = await db.one<{ n: number }>(
    `select count(*)::int as n from person_name n where ${where}`,
    values
  );

  values.push(limit, offset);
  const rows = await db.rows<Record<string, unknown>>(
    `select n.id, n.name, n.slug, n.meaning, n.gender, n.variants
       from person_name n
      where ${where}
      order by n.name asc
      limit $${values.length - 1} offset $${values.length}`,
    values
  );

  return { data: rows.map(mapPersonName), total: Number(countRow?.n ?? 0) };
}

export async function getPersonName(
  db: Db,
  slug: string,
  language: string = DEFAULT_LANGUAGE
): Promise<PersonNameDetail | null> {
  /*
   * No join to `source`. The licence record still exists — every name keeps its
   * source_id and the integrity gate still requires it — but the owner's
   * correction was that a name entry must not present where the name was
   * collected as though it were a fact about the name. Reading the source here
   * only to not display it would invite it back.
   */
  const row = await db.one<Record<string, unknown>>(
    `select n.*,
            (select ps.value from person_name_script ps
              where ps.person_name_id = n.id and ps.script_code = 'Ndebe'
              limit 1) as ndebe
       from person_name n
      where n.language_code = $2 and n.slug = $1 and n.status = 'published'
      limit 1`,
    [slug, language]
  );
  if (!row) return null;

  const nameId = Number(row.id);
  const clips = (
    await db.rows<{ url: string | null; storage_key: string | null; dialect: string | null; speaker_name: string | null }>(
      `select a.external_url as url, a.storage_key, dl.name as dialect, a.speaker_name
         from audio a
         left join dialect dl on dl.id = a.dialect_id
        where a.person_name_id = $1 and a.status = 'published'
        order by a.created_at, a.id`,
      [nameId]
    )
  )
    .map((clip) => ({
      url: clip.url ?? (clip.storage_key ? getStorage().publicUrl(clip.storage_key) : null),
      dialect: clip.dialect,
      speaker: clip.speaker_name,
      // A name has no dialect spellings of its own yet, so every clip of it is the name's own.
      isHeadword: true,
    }))
    .filter((clip): clip is { url: string; dialect: string | null; speaker: string | null; isHeadword: boolean } => clip.url !== null);

  return {
    ...mapPersonName(row),
    language: String(row.language_code),
    origins: (row.origins as string[] | null) ?? [],
    varietyForms: normaliseVarietyForms(row.variety_forms),
    audio: clips,
    // The name in Ndebe, when it has one. Read from person_name_script rather
    // than transliterated on the page, so a correction has somewhere to live.
    ndebe: (row.ndebe as string | null) ?? null,
  };
}

/**
 * Cross-variety forms, defensively.
 *
 * The column is jsonb, so its shape is whatever a past importer wrote. An entry
 * page should render the good rows and ignore the damaged ones rather than
 * throwing; the integrity gate is what fails the build over them.
 */
function normaliseVarietyForms(value: unknown): VarietyForm[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const form = (entry as Record<string, unknown>).form;
    const variety = (entry as Record<string, unknown>).variety;
    if (typeof form !== 'string' || typeof variety !== 'string') return [];
    if (form.trim().length === 0 || variety.trim().length === 0) return [];
    return [{ form: form.trim(), variety: variety.trim() }];
  });
}

/*
 * ---------------------------------------------------------------------------
 * Proverbs — ìlù
 * ---------------------------------------------------------------------------
 *
 * Proverbs are `example` rows with `style = 'proverb'`, which is what the column
 * always documented and what the importer has been writing since the collection
 * began. They are read here as a collection of their own rather than only as
 * quotations under the words they contain.
 *
 * THE HONEST COUNT IS THE POINT
 *
 * Of 1,920 proverbs, 700 carry an English rendering and the rest do not. The
 * collection is presented with that distinction visible rather than smoothed
 * over: a proverb with no translation shows as Igbo with the gap named, because
 * a machine rendering presented as dictionary content is worse than an empty
 * field — a reader cannot tell the two apart.
 */

export interface ProverbRecord {
  id: number;
  text: string;
  translation: string | null;
  /**
   * What the words say, kept as words. Null where a source printed a translation
   * and said nothing about the literal line.
   */
  literal: string | null;
  /** The English proverb that carries the same point, when one exists. */
  equivalent: string | null;
  /** One of PROVERB_THEMES, or null where the reading has not been themed. */
  theme: string | null;
}

export interface ProverbDetail extends ProverbRecord {
  /** When a speaker reaches for it, and what it does then. */
  usage: string | null;
  /** high | medium | low — how settled the reading is. */
  confidence: string | null;
  /** The dictionary entries for the words this proverb contains. */
  words: { id: number; headword: string; slug: string }[];
}

export interface ListProverbsParams {
  language?: string;
  /** An Igbo word or an English word; both are searched. */
  query?: string;
  /** One of PROVERB_THEMES. */
  theme?: string;
  /** Only the proverbs whose English rendering is recorded. */
  translatedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ProverbList {
  data: ProverbRecord[];
  /** Matching the filters, so the pagination is right. */
  total: number;
  /** Of those, how many carry a translation. */
  translated: number;
}

/** One page of proverbs, newest id first — the order they were collected in. */
export async function listProverbs(
  db: Db,
  params: ListProverbsParams = {}
): Promise<ProverbList> {
  const language = params.language ?? DEFAULT_LANGUAGE;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);

  const clauses = [`e.language_code = $1`, `e.style = 'proverb'`, `e.status = 'published'`];
  const values: unknown[] = [language];

  const rawQuery = (params.query ?? '').trim();
  if (rawQuery.length > 0) {
    const { deriveForms, getLanguage } = await import('@ozituma/core');
    const derived = deriveForms(rawQuery, getLanguage(language));
    // Folded, so "ilu bu mmanu" finds "Ilu bụ mmanụ" — the same tone-blind
    // matching the dictionary search uses, for the same reason.
    values.push(`%${escapeLike(derived.searchForm)}%`, `%${escapeLike(rawQuery)}%`);
    clauses.push(`(e.search_form like $2 or e.text ilike $3 or e.translation ilike $3)`);
  }

  /*
   * "Has a meaning" means a meaning the section will actually show, so the filter and
   * the mapper have to agree: a low-confidence reading is cleared and suppressed, and a
   * count that included it would promise a proverb the list then renders without one.
   */
  if (params.translatedOnly) clauses.push(SETTLED_RENDERING_SQL);
  if (params.theme) {
    values.push(params.theme);
    clauses.push(`e.theme = $${values.length}`);
  }

  const where = clauses.join(' and ');

  const countRow = await db.one<{ n: number; t: number }>(
    `select count(*)::int as n,
            count(*) filter (where ${SETTLED_RENDERING_SQL})::int as t
       from example e
      where ${where}`,
    values
  );

  const rows = await db.rows<{
    id: string;
    text: string;
    translation: string | null;
    translation_confidence: string | null;
    literal_translation: string | null;
    english_equivalent: string | null;
    theme: string | null;
  }>(
    `select e.id, e.text, e.translation, e.translation_confidence, e.literal_translation,
            e.english_equivalent, e.theme
       from example e
      where ${where}
      order by e.id
      limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, limit, offset]
  );

  return {
    data: rows.map(toProverbRecord),
    total: Number(countRow?.n ?? 0),
    translated: Number(countRow?.t ?? 0),
  };
}

/**
 * The SQL form of the same rule, for the filters and counts that have to agree with it.
 *
 * Kept beside `settledRendering` deliberately: these two are one decision, and the
 * failure mode of letting them drift is a count that promises more than the list shows.
 */
const SETTLED_RENDERING_SQL = `(
  e.translation is not null
  and e.translation_confidence is distinct from 'low'
  and not starts_with(e.translation, '[uncertain]')
)`;

/**
 * A rendering the dictionary is prepared to publish, or null.
 *
 * The owner's instruction: a meaning that is not at least 90% certain is not published
 * at all — "remove them, instead of giving false information". A `low`-confidence
 * reading is one where the Igbo is corrupt or fragmentary, or the sense was a guess,
 * and `[uncertain]` is the marker the old pipeline put at the front of those texts.
 * Neither reaches a reader. The proverb is then shown in Igbo alone, which is what the
 * section already says for a proverb with no rendering recorded.
 *
 * This is belt and braces: every such row was cleared from the data, and this keeps one
 * from being published again by an import that does not know the rule. It is a function
 * rather than an inline check so that the list and the entry cannot drift apart.
 */
function settledRendering(row: {
  translation: string | null;
  translation_confidence?: string | null;
}): string | null {
  const text = (row.translation ?? '').trim();
  if (text.length === 0) return null;
  if (text.toLowerCase().startsWith('[uncertain]')) return null;
  if ((row.translation_confidence ?? '').toLowerCase() === 'low') return null;
  return text;
}

/** One row of `example`, as the proverb section reads it. */
function toProverbRecord(row: {
  id: string;
  text: string;
  translation: string | null;
  translation_confidence?: string | null;
  literal_translation: string | null;
  english_equivalent: string | null;
  theme: string | null;
}): ProverbRecord {
  /*
   * The literal, the English equivalent and the theme stand or fall with the meaning.
   *
   * They were one reading of the proverb, produced together: a confident literal for a
   * line the reader was told is garbled is the same false information in another field,
   * and a theme assigned from a sense that could not be established is a claim about
   * what the proverb is about. No proverb in the data is in the position of having a
   * literal but no meaning, so nothing is lost by tying them together.
   */
  const translation = settledRendering(row);
  const settled = translation !== null;
  return {
    id: Number(row.id),
    text: row.text,
    translation,
    literal: settled ? (row.literal_translation ?? null) : null,
    equivalent: settled ? (row.english_equivalent ?? null) : null,
    theme: settled ? (row.theme ?? null) : null,
  };
}

/** One proverb, with links to the entries for the words it contains. */
export async function getProverb(
  db: Db,
  id: number,
  language: string = DEFAULT_LANGUAGE
): Promise<ProverbDetail | null> {
  const row = await db.one<{
    id: string;
    text: string;
    translation: string | null;
    literal_translation: string | null;
    english_equivalent: string | null;
    theme: string | null;
    usage_note: string | null;
    translation_confidence: string | null;
  }>(
    `select e.id, e.text, e.translation, e.literal_translation, e.english_equivalent,
            e.theme, e.usage_note, e.translation_confidence
       from example e
      where e.id = $1 and e.language_code = $2 and e.style = 'proverb'
        and e.status = 'published'`,
    [id, language]
  );
  if (!row) return null;

  const words = await db.rows<{ id: string; headword: string; slug: string }>(
    `select w.id, w.headword, w.slug
       from example_word ew
       join word w on w.id = ew.word_id
      where ew.example_id = $1 and w.status = 'published'
      order by length(w.headword) desc, w.headword`,
    [id]
  );

  /*
   * The usage note is part of the same reading as the meaning, so it is shown only when
   * the meaning is. A note about when a speaker reaches for a proverb whose sense could
   * not be established is a guess about a guess.
   */
  const record = toProverbRecord(row);
  return {
    ...record,
    usage: record.translation === null ? null : (row.usage_note ?? null),
    confidence: row.translation_confidence ?? null,
    words: words.map((word) => ({
      id: Number(word.id),
      headword: word.headword,
      slug: word.slug,
    })),
  };
}

/**
 * The neighbours of a proverb in collection order, so a reader can move through
 * the list without going back to the index every time. Ids are not guaranteed
 * contiguous, so these are lookups rather than arithmetic.
 */
export async function proverbNeighbours(
  db: Db,
  id: number,
  language: string = DEFAULT_LANGUAGE
): Promise<{ previous: ProverbRecord | null; next: ProverbRecord | null }> {
  const columns = `id, text, translation, literal_translation, english_equivalent, theme`;
  const [previous, next] = await Promise.all([
    db.one<Parameters<typeof toProverbRecord>[0]>(
      `select ${columns} from example
        where language_code = $1 and style = 'proverb' and status = 'published' and id < $2
        order by id desc limit 1`,
      [language, id]
    ),
    db.one<Parameters<typeof toProverbRecord>[0]>(
      `select ${columns} from example
        where language_code = $1 and style = 'proverb' and status = 'published' and id > $2
        order by id asc limit 1`,
      [language, id]
    ),
  ]);
  return {
    previous: previous ? toProverbRecord(previous) : null,
    next: next ? toProverbRecord(next) : null,
  };
}

/**
 * Other entries a reader might want next, when the stored relations are thin.
 *
 * The vocabulary corpus is uneven about relations: `word_relation` holds 8,064
 * rows for 33,905 words, so `nne ukwu` records that it is built on `nne` while
 * `mmiri ara`, `mmiri ozuzo`, `ụgbọ mmiri` and `ọdọ mmiri` record nothing at all.
 * Reading only stored relations therefore left the most ordinary words with an
 * empty Related words section, which is the one place a dictionary can afford
 * least to be empty.
 *
 * So this derives them, in two kinds, and both are honest about what they are:
 *
 *   1. CONTAINMENT — another headword that contains this one as a whole word.
 *      For Igbo this is nearly always the right answer: the language builds
 *      compounds and phrases by juxtaposition, and `mmiri` really is part of
 *      `mmiri ara`. Whole-word containment, never substrings, so `aka` does not
 *      claim `akara` and `nne` does not claim `nnekwu`.
 *   2. SHARED MEANING — the same approach the name dictionary already uses:
 *      words whose English definitions share a significant word with this one's.
 *      Loose by nature, which is why it is offered last and labelled as such.
 *
 * Stored relations are rendered first by the caller and win any collision, so
 * this only ever adds what the corpus does not already state.
 */
export interface RelatedWord {
  id: number;
  headword: string;
  slug: string;
  via: 'compound' | 'meaning';
}

/**
 * English words too common to mean anything about a definition. "used", "form"
 * and "kind" appear in hundreds of glosses and would relate half the dictionary
 * to the other half; the name dictionary escapes this because a name's meaning
 * has fewest of these words in it.
 */
const GLOSS_STOPWORDS = new Set([
  'also', 'another', 'called', 'form', 'from', 'have', 'into', 'kind', 'made',
  'make', 'more', 'much', 'person', 'same', 'that', 'their', 'them', 'this',
  'used', 'very', 'when', 'where', 'which', 'with', 'without', 'word', 'your',
]);

/** The significant English words in a definition, for matching meanings. */
export function glossTokens(definitions: string[]): string[] {
  const tokens = new Set<string>();
  for (const definition of definitions) {
    for (const token of definition.toLowerCase().split(/[^a-z']+/)) {
      const clean = token.replace(/^'+|'+$/g, '');
      if (clean.length > 3 && !GLOSS_STOPWORDS.has(clean)) tokens.add(clean);
    }
  }
  return [...tokens];
}

export async function relatedWords(
  db: Db,
  word: { id: number; language: string; headword: string },
  definitions: string[],
  limit = 12
): Promise<RelatedWord[]> {
  const found: RelatedWord[] = [];
  const seen = new Set<number>([word.id]);

  // Compounds first: a word that contains this one is a stronger statement than
  // a word that shares an adjective with it.
  const compounds = await db.rows<{ id: string; headword: string; slug: string }>(
    `select w.id, w.headword, w.slug
       from word w
      where w.language_code = $1
        and w.status = 'published'
        and w.id <> $2
        and $3 = any (string_to_array(w.headword, ' '))
      order by length(w.headword), w.headword
      limit $4`,
    [word.language, word.id, word.headword, limit]
  );
  for (const row of compounds) {
    const id = Number(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({ id, headword: row.headword, slug: row.slug, via: 'compound' });
  }

  const tokens = glossTokens(definitions);
  if (found.length < limit && tokens.length > 0) {
    /*
     * Whole words, allowing a plural. `ilike '%token%'` was the obvious thing and
     * it is wrong in a way a reader would notice immediately: "liquid" matched
     * "be liQUIDated", and the entry for `mmiri` offered a word for going out of
     * business. Word boundaries fix that and still accept "liquids"; `glossTokens`
     * only ever produces `[a-z']+`, so nothing here needs regex escaping.
     */
    const shared = await db.rows<{ id: string; headword: string; slug: string }>(
      `select w.id, w.headword, w.slug
         from word w
         join definition d on d.word_id = w.id and d.language_code = 'eng'
         join unnest($3::text[]) as t(token) on d.text ~* ('\\m' || t.token || 's?\\M')
        where w.language_code = $1
          and w.status = 'published'
          and w.id <> $2
        group by w.id, w.headword, w.slug
        order by count(distinct t.token) desc, w.headword
        limit $4`,
      [word.language, word.id, tokens, limit]
    );
    for (const row of shared) {
      const id = Number(row.id);
      if (seen.has(id) || found.length >= limit) continue;
      seen.add(id);
      found.push({ id, headword: row.headword, slug: row.slug, via: 'meaning' });
    }
  }

  return found;
}

/**
 * Other names that share a word with this one.
 *
 * The name dictionary's whole claim is that a name is a sentence, so the way
 * to read one is through the words in it: Akunna and Akunne are father's and
 * mother's wealth, and a reader who arrived at one wants the other. Matching
 * on a shared meaning word is crude but honest — it finds real relatives and
 * claims no etymology it cannot show.
 */
export async function relatedPersonNames(
  db: Db,
  name: { id: number; meaning: string | null; language: string },
  limit = 6
): Promise<PersonNameSummary[]> {
  const words = (name.meaning ?? '')
    .toLowerCase()
    .split(/[^a-z'']+/)
    .filter((w) => w.length > 3);

  if (words.length === 0) return [];

  const rows = await db.rows<Record<string, unknown>>(
    `select n.id, n.name, n.slug, n.meaning, n.gender, n.variants
       from person_name n
      where n.language_code = $1
        and n.status = 'published'
        and n.id <> $2
        and n.meaning is not null
        and exists (
          select 1 from unnest($3::text[]) w
           where n.meaning ilike '%' || w || '%'
        )
      order by n.name asc
      limit $4`,
    [name.language, name.id, words, limit]
  );

  return rows.map(mapPersonName);
}

/** Published names for a language — the count the languages table shows. */
export async function countPersonNames(
  db: Db,
  language: string = DEFAULT_LANGUAGE
): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from person_name
      where language_code = $1 and status = 'published'`,
    [language]
  );
  return Number(row?.n ?? 0);
}
