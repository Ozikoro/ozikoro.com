/**
 * THE DICTIONARY LOOKUP, AND THE DISSECTION THE OWNER ASKED FOR.
 *
 * ---------------------------------------------------------------------------
 * WHAT A "RECORD" OF A WORD ACTUALLY IS IN OZITUMA — READ, NOT ASSUMED
 * ---------------------------------------------------------------------------
 *
 * The instruction is *"you go to ozituma.com ... and pull out the record."* **Before this module was
 * written, the migrations and the live cluster were read to find out what a record is**, because the answer
 * decides whether a lookup can ever be more than a spelling check. Ozituma holds FOUR different things and
 * they are not equivalent evidence:
 *
 *   audio.storage_key / audio.external_url   0004_audio.sql: "Pronunciation recordings. Bytes live in
 *                                            S3-compatible storage; this table holds metadata, provenance
 *                                            and moderation state." — a real speaker
 *   word.pronunciation                       0001_init.sql: `pronunciation text, -- IPA or a practical
 *                                            respelling`
 *   word.syllables                           0001_init.sql: `syllables text` — a syllabification
 *   word.headword / word_form / word_dialect  a spelling, and variant spellings of it
 *
 * **And the measurement, taken from the cluster before a line of this was written:**
 *
 *   word (published, ibo)                     8,728
 *   word.pronunciation NOT NULL                   0
 *   word.syllables IS NOT NULL                    0
 *   audio rows, any status                        0
 *   word_dialect rows                             0
 *   word_form rows                              453   — every one of them form_type 'variant'
 *
 * So the honest finding, and it is the most consequential one in this work: **ozituma holds the SPELLING of
 * 8,728 Igbo words and not one pronunciation of any kind.** The pipeline in the instruction assumes the
 * record is already there to be pulled; it is not there yet. No code can supply it — a pronunciation is
 * either recorded by a person or fabricated, and a fabricated one would be spoken aloud in the owner's own
 * cloned voice and sound authoritative. So this module reads the richer schema where it exists, returns
 * exactly what it found, and never upgrades a spelling into a pronunciation.
 *
 * The provenance is why `grade` is on every hit. A recording and a spelling are different answers and the
 * owner's pipeline must be able to tell them apart at every step.
 *
 * ---------------------------------------------------------------------------
 * THE OWNER'S OWN IDEA: DISSECTION
 * ---------------------------------------------------------------------------
 *
 *   "if it is not there, you can dissect the words to see if it can also be found in pieces"
 *
 * Igbo is agglutinative and compounds freely, so a long word is often several known ones. What the schema
 * offers for this, read before inventing anything:
 *
 *   `word_form`  models INFLECTION and DERIVATION — migration 0001 names its `form_type` categories:
 *                infinitive, imperative, simplePast, presentPassive, simplePresent, presentContinuous,
 *                future, plural, diminutive, agentive, variant. **It is not a table of constituents**, and in
 *                this data all 453 rows are `variant` (alternate spellings like `-chelụ` for `-chebe`).
 *                Counting on it to hold a segmentation would have been counting on a table that models
 *                something else.
 *   `syllables`  would be exactly the right thing and is empty on every row.
 *
 * So the segmentation is built from the HEADWORDS THEMSELVES — which is the only division the dictionary
 * actually supports — using longest-match first, so the largest known pieces win. `segment` is that
 * algorithm and `dissect` is the query behind it.
 *
 * **A composed pronunciation is marked as composed**, always, in `kind` and in `grade`. It is a lower grade
 * of evidence than a recording by construction: the parts are recorded, the whole is inferred, and a
 * listener cannot tell. The archive records provenance, and this is the provenance.
 */
import type { Db } from '@ozituma/db/client';
import { toSearchForm } from '@ozituma/core';
import {
  ENGLISH_COLLISIONS,
  IGBO_MORPHEMES,
  findIgboWords,
  type FindResult,
  type WordIndex,
} from './igbo-words.ts';

/**
 * A clean single-token headword: plain folded letters only, at least two of them.
 *
 * The predicate is here once because three queries depend on it agreeing. The dictionary's `search_form` is
 * fully folded — `toSearchForm` removes EVERY mark after NFD, so `ọ` becomes `o` — but `ŋ` survives it,
 * because `ŋ` is a letter and not a combining mark. Measured on the live cluster: 1,939 forms are pure
 * `a-z`, 1,953 are pure `a-zŋ`, and 4,164 rows are junk of some kind, including `'`, `(`, `1.` and entries
 * like `(agwa)ụnò) -ma`.
 *
 * **The junk matters.** Those rows are published headwords, so a lookup that matched any of them would find
 * a "word" in a parenthesis and pronounce it. The pattern is applied in SQL so the index is built from rows
 * that are words rather than from rows that are strings.
 */
const CLEAN_FORM_SQL = `search_form ~ '^[a-zŋ]+$' and length(search_form) >= 2`;

/**
 * The same cleanliness for a multi-word headword: plain folded letters AND single spaces.
 *
 * A SEPARATE PATTERN BECAUSE THE SPACE IS THE WHOLE DIFFERENCE, and getting this wrong is silent. The first
 * version of this file reused `CLEAN_FORM_SQL` for the phrase query as well — and `^[a-zŋ]+$` does not match
 * a space, so **every multi-word headword was filtered out and the phrase rule reported zero phrases while
 * appearing to work.** Measured: 1,988 clean multi-word entries exist and the index built from that query
 * held none of them. A finder that silently loses a whole evidence class is the failure this project keeps
 * recording, so the pattern is named rather than inlined.
 */
const CLEAN_PHRASE_SQL = `search_form ~ '^[a-zŋ ]+$' and length(search_form) >= 2 and position(' ' in search_form) > 0`;

export type DictionaryIndex = WordIndex & {
  /** The clean single-token folded forms, for a caller that wants to inspect the index itself. */
  forms: ReadonlySet<string>;
  /** Multi-word headwords, folded: `a malu afa ya`. Used by the phrase rule. */
  phrases: ReadonlyMap<string, string>;
  /** The longest single-token piece, so `segment` knows how far back to look. */
  maxPieceLength: number;
  counts: { forms: number; phrases: number; collisions: number };
};

/**
 * Read the dictionary into memory, once per run.
 *
 * **This is a query against ozituma's own data and never a list.** The owner's reason is in the instruction
 * itself — a hard-coded list "would be stale within a week" — and the practical effect is that a word an
 * editor adds to the dictionary tomorrow is found tomorrow without this file changing.
 *
 * It also reports its own counts, so a page can print what it looked at rather than asserting a coverage
 * figure: an index built from zero rows would otherwise answer "not found" for every word in the archive and
 * look exactly like an archive that needs 8,000 recordings.
 */
export async function buildDictionaryIndex(db: Db): Promise<DictionaryIndex> {
  const [rows, phraseRows] = await Promise.all([
    db.rows<{ headword: string; search_form: string }>(
      `select headword, search_form
         from word
        where language_code = 'ibo' and status = 'published' and ${CLEAN_FORM_SQL}`
    ),
    db.rows<{ headword: string; search_form: string }>(
      `select headword, search_form
         from word
        where language_code = 'ibo' and status = 'published' and ${CLEAN_PHRASE_SQL}`
    ),
  ]);

  const forms = new Set<string>();
  for (const row of rows) forms.add(row.search_form);

  /*
   * The multi-word headwords, folded. **These are handed to the finder as phrases, not as a token→phrase
   * lookup**, because a token that merely appears inside some headword is not evidence that the text says
   * that headword — see the note on `WordIndex.phrases` for the measured fault that distinction fixes.
   */
  const phrases = new Map<string, string>();
  for (const row of phraseRows) phrases.set(row.search_form, row.headword);

  /**
   * THE PIECES DISSECTION MAY USE.
   *
   * Two kinds, and the distinction is the whole reason dissection is safe:
   *
   *   - a clean headword of at least THREE characters that is not an ordinary English word. Three, because
   *     two-letter pieces turn any English word into a compound (`alan` -> `ala` + `n`) and a segmentation
   *     that rescues nothing but invents everything is worse than no segmentation.
   *   - an Igbo MORPHEME, which is allowed to be shorter and to collide with English because it is
   *     productive in names: `ụmụ` heads a large family of place names and `umu` alone is an English word
   *     (it is in Webster's), which is exactly why it has to be named here rather than inferred.
   */
  const pieces = new Set<string>();
  for (const form of forms) {
    if (form.length >= 3 && !ENGLISH_COLLISIONS.has(form)) pieces.add(form);
  }
  for (const morpheme of IGBO_MORPHEMES) pieces.add(morpheme);

  let maxPieceLength = 0;
  for (const piece of pieces) maxPieceLength = Math.max(maxPieceLength, piece.length);

  return {
    forms,
    /*
     * `phrases` APPEARS HERE ONCE, AND THE FIRST VERSION OF THIS FILE LISTED IT TWICE — which was a real
     * bug and not a style complaint. TypeScript reports a duplicate key as TS1117 and **JavaScript keeps the
     * LAST one silently**, so the object was built from whichever phrase map came second and nothing
     * anywhere said which. It also took the whole repository's typecheck down, because this file is inside
     * the shared `@ozikoro/platform` package that every app in the monorepo builds against.
     */
    phrases,
    maxPieceLength,
    counts: { forms: forms.size, phrases: phrases.size, collisions: ENGLISH_COLLISIONS.size },
    has: (folded) => forms.has(folded),
    isEnglishCollision: (folded) => ENGLISH_COLLISIONS.has(folded),

    /**
     * Longest-match segmentation, greedily from the left.
     *
     * Longest first because the owner's instruction says so — *"longest-match segmentation first, so the
     * largest known pieces win"* — and because the alternative produces `a` + `kwụ` + `kwọ` where the
     * dictionary holds `akwụkwọ`. The whole token must be consumed: a partial match is not a segmentation,
     * it is a coincidence, and allowing one would let `chicken` be `chi` + leftovers.
     *
     * Returns null rather than a single piece, because a word that IS one known piece is a dictionary hit
     * and not a compound — and mislabelling it would claim a composed pronunciation for a recorded word.
     */
    segment(folded) {
      /*
       * A HYPHEN IS A SEPARATOR, NOT A LETTER.
       *
       * Igbo compounds are written both ways — `Okwu-Ekpo` and `okwu ekpo` are the same construction — and
       * the dictionary holds single-token headwords with no hyphens inside them. **So leaving the hyphen in
       * the loop made every hyphenated compound unsegmentable**: the scan ran off the end of `okwu` and hit
       * a `-` that is in no piece set, returned null, and the word fell through to `unknown` and was never
       * queued. Measured on a real record: `Okwu-Ekpo` and `Onu-eke` were both lost this way.
       *
       * Both spellings are therefore tried, and the parts are the pieces when every part is one. When a part
       * is itself a compound the loop below handles it, which is why the split happens first and the scan
       * second rather than the other way round.
       */
      const hyphenated = folded.split('-').filter(Boolean);
      if (hyphenated.length > 1 && hyphenated.every((part) => part.length >= 2 && pieces.has(part))) {
        return hyphenated;
      }

      const out: string[] = [];
      let at = 0;
      while (at < folded.length) {
        let take = 0;
        const limit = Math.min(maxPieceLength, folded.length - at);
        for (let size = limit; size >= 2; size--) {
          const candidate = folded.slice(at, at + size);
          // The last piece may be any length; every earlier piece that is not a morpheme must be >= 3, which
          // the `pieces` set already enforces by construction.
          if (pieces.has(candidate)) {
            take = size;
            break;
          }
        }
        if (take === 0) return null;
        out.push(folded.slice(at, at + take));
        at += take;
      }
      return out.length >= 2 ? out : null;
    },
  };
}

/**
 * HOW GOOD THE EVIDENCE IS, as a number a page can sort and a person can read.
 *
 *   1  an approved human recording, held by the archive itself
 *   2  a recording in the dictionary
 *   3  a phonetic respelling or IPA, written by a person
 *   4  a dialect spelling or a variant form — the word is IN the dictionary, its sound is not recorded
 *   5  composed from parts. **Lower than every real reference and higher than nothing.**
 *   6  not found at all
 */
export const GRADE_LABEL: Record<number, string> = {
  1: 'a recording held by the archive and approved',
  2: 'a recording in the dictionary',
  3: 'a written respelling',
  4: 'a dictionary spelling — no sound recorded',
  5: 'composed from recorded parts',
  6: 'not found',
};

export type PronunciationHit =
  | {
      found: true;
      /** The word as asked for. */
      word: string;
      folded: string;
      grade: 1 | 2 | 3 | 4 | 5;
      /** Where it came from, in words the owner can read. */
      source: string;
      /** The dictionary row, when the dictionary is where it came from. */
      wordId: number | null;
      headword: string | null;
      /** A recording's URL, when there is one. **The best possible reference for a TTS model.** */
      audioUrl: string | null;
      /** IPA or a practical respelling, when one is written down. */
      respelling: string | null;
      syllableBreakdown: string | null;
      dialectCode: string | null;
      /** The pieces, for a composed pronunciation. Null for everything else. */
      composedOf: string[] | null;
      /** True only for grade 5. A composed pronunciation is never presented as a recorded one. */
      composed: boolean;
    }
  | {
      found: false;
      word: string;
      folded: string;
      grade: 6;
      source: 'missing';
      /** Whether dissection was tried, and what it produced — so "not found" is never a bare answer. */
      dissection: { attempted: boolean; pieces: string[] | null; reason: string };
    };

/**
 * The two arms of `PronunciationHit`, named.
 *
 * A caller that has established which arm it holds should not have to re-narrow at every property access,
 * and a plan whose `words` list is a list of resolutions should say so in its type. **Extracting the arms is
 * what makes `plan.words[0].audioUrl` a fact rather than a type error** — see the note on
 * `ArticlePronunciationPlan.words`, where the absence of these two names meant the type under-described the
 * data and a correct test was reported as a broken one.
 */
export type FoundHit = Extract<PronunciationHit, { found: true }>;
export type MissingHit = Extract<PronunciationHit, { found: false }>;

/** The dictionary's own recording of a word, if any. Published only — a pending clip is not evidence yet. */
async function dictionaryAudio(db: Db, wordId: number): Promise<{ url: string; speaker: string | null } | null> {
  const row = await db.one<{ url: string; speaker_name: string | null }>(
    `select coalesce(a.external_url, a.storage_key) as url, a.speaker_name
       from audio a
      where a.word_id = $1 and a.status = 'published'
        and coalesce(a.external_url, a.storage_key) is not null
      order by a.approvals desc nulls last, a.id
      limit 1`,
    [wordId]
  );
  return row ? { url: row.url, speaker: row.speaker_name } : null;
}

/**
 * Find how the archive can say one word.
 *
 * THE ORDER IS THE POINT, and it is the archive's own rule that evidence is graded: a recording beats a
 * respelling, a respelling beats a spelling, and a spelling is not a sound at all. **Everything is a query
 * against the database this run** — nothing in this file knows an Igbo word.
 *
 * A word present only under ANOTHER DIALECT IS FOUND, not absent — the instruction says so explicitly, and
 * `word_dialect` is exactly where it would be. The dialect is named in the answer so an editor can see that
 * the recording they are about to make may already exist in another variety.
 */
export async function lookupPronunciation(
  db: Db,
  word: string,
  index: DictionaryIndex
): Promise<PronunciationHit> {
  const folded = toSearchForm(word);

  /*
   * 1. THE ARCHIVE'S OWN APPROVED RECORDING.
   *
   * Consulted FIRST because it is the only evidence that was recorded for THIS pipeline and reviewed by a
   * person. An approved row outranks anything the dictionary holds, and a `recorded` (unapproved) row is
   * deliberately NOT used: the owner's rule is that nothing is used before it is approved, "as to not waste
   * credits", and using an unapproved clip would make the approval decorative.
   */
  const own = await db.one<{
    id: number; kind: string; storage_key: string | null; external_url: string | null;
    respelling: string | null; composed_of: unknown; word_id: number | null; speaker_name: string | null;
  }>(
    `select id, kind, storage_key, external_url, respelling, composed_of, word_id, speaker_name
       from ozikoro_pronunciation
      where language_code = 'ibo' and search_form = $1 and status = 'approved'
      order by case kind when 'human_recording' then 1 when 'dictionary_audio' then 1
                         when 'respelling' then 2 else 3 end, id
      limit 1`,
    [folded]
  );

  if (own) {
    const url = own.external_url ?? own.storage_key;
    const composed = own.kind === 'composed';
    const grade = composed ? 5 : url ? 1 : 3;
    return {
      found: true, word, folded, grade,
      source: composed
        ? 'composed by the archive from parts of the dictionary'
        : url
          ? 'an approved recording held by the archive'
          : 'an approved respelling held by the archive',
      wordId: own.word_id,
      headword: null,
      audioUrl: url,
      respelling: own.respelling,
      syllableBreakdown: null,
      dialectCode: null,
      composedOf: composed && Array.isArray(own.composed_of) ? (own.composed_of as string[]) : null,
      composed,
    };
  }

  /*
   * 2. THE DICTIONARY ROW ITSELF.
   *
   * `word.pronunciation` is documented as "IPA or a practical respelling" and is empty on every row today.
   * It is read anyway, in this order, so that the day an editor fills one in this module uses it with no
   * change — and so the reason a word is "not found" is never that nobody looked in the right column.
   *
   * The `exact_form` match as well as `search_form`: `exact_form` keeps letter-defining marks and drops tone,
   * so `ọdịnana` finds the row for `ọ̀dị̀nànà` while an unaccented `odinana` finds it through `search_form`.
   */
  const dictRow = await db.one<{
    id: number; headword: string; pronunciation: string | null; syllables: string | null; exact_form: string;
  }>(
    `select id, headword, pronunciation, syllables, exact_form
       from word
      where language_code = 'ibo' and status = 'published'
        and (search_form = $1 or exact_form = $1)
      order by (search_form = $1) desc, is_verified desc, frequency_rank nulls last
      limit 1`,
    [folded]
  );

  if (dictRow) {
    const audio = await dictionaryAudio(db, dictRow.id);
    if (audio) {
      return {
        found: true, word, folded, grade: 2,
        source: `a recording in the dictionary${audio.speaker ? `, spoken by ${audio.speaker}` : ''}`,
        wordId: dictRow.id, headword: dictRow.headword, audioUrl: audio.url,
        respelling: dictRow.pronunciation, syllableBreakdown: dictRow.syllables, dialectCode: null,
        composedOf: null, composed: false,
      };
    }
    if (dictRow.pronunciation) {
      return {
        found: true, word, folded, grade: 3,
        source: 'a respelling written in the dictionary',
        wordId: dictRow.id, headword: dictRow.headword, audioUrl: null,
        respelling: dictRow.pronunciation, syllableBreakdown: dictRow.syllables, dialectCode: null,
        composedOf: null, composed: false,
      };
    }
  }

  /*
   * 3. A SOUND FROM ANOTHER DIALECT — ASKED BEFORE THE WORD IS CALLED FOUND BUT SILENT.
   *
   * The instruction is explicit: *"The dictionary may hold the word in a different dialect, or only a
   * variant form ... Check them before declaring a word missing — a word present under another dialect is
   * found, not absent."*
   *
   * A dialect RESPLLING is better evidence than a bare headword, so it is asked here, before the
   * `dictRow` fallback below. A dialect SPELLING with no pronunciation is not better than anything, and it
   * is handled after — which is the ordering fix recorded under `4.` below.
   */
  const dialectRow = await db.one<{
    spelling: string; pronunciation: string | null; code: string; name: string; word_id: number; headword: string;
  }>(
    `select wd.spelling, wd.pronunciation, d.code, d.name, w.id as word_id, w.headword
       from word_dialect wd
       join dialect d on d.id = wd.dialect_id
       join word w on w.id = wd.word_id
      where w.status = 'published' and wd.search_form = $1
      order by wd.id
      limit 1`,
    [folded]
  );

  if (dialectRow?.pronunciation) {
    return {
      found: true, word, folded, grade: 3,
      source: `a respelling recorded for the ${dialectRow.name} dialect`,
      wordId: dialectRow.word_id, headword: dialectRow.headword,
      audioUrl: null, respelling: dialectRow.pronunciation,
      syllableBreakdown: dictRow?.syllables ?? null, dialectCode: dialectRow.code,
      composedOf: null, composed: false,
    };
  }

  /*
   * 4. THE WORD IS IN THE DICTIONARY AND CARRIES NO SOUND.
   *
   * **This return used to sit BELOW the dialect and variant queries, and that was a real fault: it made a
   * direct dictionary hit lose to a `word_form` row belonging to a DIFFERENT headword.** Measured on a real
   * record — the finder reported the word `Ibu` as "a variant form of «-tu ùbu»", which is a claim about
   * where the word came from that is simply untrue. `ibu` has its own row in `word`.
   *
   * **A wrong provenance is worse than no answer**, because an editor reads it and believes it. So a direct
   * hit is returned here, at grade 4, before anything that would attribute the word to another entry.
   *
   * It is FOUND, because the owner's question is "is it in ozituma" and the answer is yes — the spelling is.
   * What it is NOT is a sound, and `grade` says so, which is what stops a bare spelling being handed to a
   * TTS model as if it were a reference.
   */
  if (dictRow) {
    return {
      found: true, word, folded, grade: 4,
      source: 'a dictionary spelling — the entry carries no sound',
      wordId: dictRow.id, headword: dictRow.headword, audioUrl: null,
      respelling: null, syllableBreakdown: dictRow.syllables, dialectCode: null,
      composedOf: null, composed: false,
    };
  }

  /*
   * 5. A DIALECT SPELLING, OR A VARIANT FORM — the word is not a headword itself, but the dictionary holds
   * it under another entry. Reached only now, so neither can claim a provenance the direct row would beat.
   */
  if (dialectRow) {
    return {
      found: true, word, folded, grade: 4,
      source: `a spelling held for the ${dialectRow.name} dialect — no sound recorded`,
      wordId: dialectRow.word_id, headword: dialectRow.headword,
      audioUrl: null, respelling: null,
      syllableBreakdown: null, dialectCode: dialectRow.code,
      composedOf: null, composed: false,
    };
  }

  const formRow = await db.one<{ value: string; code: string; name: string; word_id: number; headword: string }>(
    `select wf.value, ft.code, ft.name, w.id as word_id, w.headword
       from word_form wf
       join form_type ft on ft.id = wf.form_type_id
       join word w on w.id = wf.word_id
      where w.status = 'published' and wf.search_form = $1
      order by wf.id
      limit 1`,
    [folded]
  );

  if (formRow) {
    return {
      found: true, word, folded, grade: 4,
      source: `a variant form of “${formRow.headword}” (${formRow.name}) — no sound recorded`,
      wordId: formRow.word_id, headword: formRow.headword, audioUrl: null,
      respelling: null, syllableBreakdown: null, dialectCode: null, composedOf: null, composed: false,
    };
  }

  // 6. NOT FOUND. Say what dissection tried, rather than answering with a bare no.
  const pieces = index.segment(folded);
  return {
    found: false, word, folded, grade: 6, source: 'missing',
    dissection: {
      attempted: true,
      pieces,
      reason: pieces
        ? `It splits into ${pieces.join(' + ')}, all of them dictionary words.`
        : 'It does not split into dictionary words.',
    },
  };
}

/**
 * The owner's dissection, as a query result.
 *
 * **It reports a ratio rather than a verdict.** A word either 8,000 articles need or one draft mentions is
 * not the same request, so the caller gets the pieces and the dictionary rows behind them and decides.
 *
 * The pieces are looked up in the dictionary AGAIN here, one by one, so the answer carries the headword and
 * whether each piece has a sound — a segmentation into three spellings with no pronunciation is a composed
 * pronunciation of three silent pieces, and that distinction has to survive to the page.
 */
export type Dissection = {
  word: string;
  folded: string;
  pieces: string[];
  parts: { piece: string; headword: string | null; hasSound: boolean; grade: number }[];
  /** Every piece is a dictionary word. */
  complete: boolean;
  /** At least one piece carries a sound, so a composed pronunciation would rest on recorded parts. */
  anyPieceHasSound: boolean;
};

export async function dissect(db: Db, word: string, index: DictionaryIndex): Promise<Dissection | null> {
  const folded = toSearchForm(word);
  const pieces = index.segment(folded);
  if (!pieces) return null;

  const parts: Dissection['parts'] = [];
  for (const piece of pieces) {
    const hit = await lookupPronunciation(db, piece, index);
    parts.push({
      piece,
      headword: hit.found ? hit.headword : null,
      hasSound: hit.found && (hit.grade <= 3 || hit.composed),
      grade: hit.grade,
    });
  }

  return {
    word,
    folded,
    pieces,
    parts,
    /*
     * `complete` means every piece is a dictionary ENTRY of its own, which is the strongest form of the
     * claim. The first version of this read `parts.every((p) => p.headword !== null || p.grade <= 5)` — and
     * `grade <= 5` is true of every piece that is not missing, so the expression was a tautology that
     * reported "complete" for a segmentation built on a composed guess. **A flag that is always true is
     * worse than no flag**, because a page prints it.
     */
    complete: parts.every((p) => p.headword !== null),
    anyPieceHasSound: parts.some((p) => p.hasSound),
  };
}

/**
 * Everything an article's narration needs to know about its Igbo words, in one pass.
 *
 * This is the function the planner, the queue and the render gate all call, so that "which words does this
 * record need" has ONE answer rather than one per surface.
 */
export type ArticlePronunciationPlan = {
  slug: string;
  title: string;
  articleId: number;
  /** The words the finder identified as Igbo. */
  found: FindResult;
  /**
   * One resolution per Igbo word, best-sourced first.
   *
   * **TYPED AS THE FOUND VARIANT, WHICH IS A CORRECTION AND NOT A CONVENIENCE.** This was originally
   * `PronunciationHit & { occurrences; spellings }` — the whole union, including the `found: false` arm —
   * so `plan.words[0].audioUrl` did not typecheck even though every element of the array is demonstrably a
   * found hit. **The type was under-describing the data, and the test that failed on it was right.** A list
   * of resolutions that resolved is not a list of hits-and-misses; saying so is what lets a caller read
   * `grade`, `audioUrl` and `composed` without a narrowing dance at every use.
   */
  words: (FoundHit & { occurrences: number; spellings: string[] })[];
  /** Words that are neither in the dictionary nor dissectable. **These block a render.** */
  missing: (MissingHit & { occurrences: number; spellings: string[] })[];
  /** Words dissectable from parts. Usable, and marked as composed. */
  composed: { word: string; folded: string; pieces: string[]; anyPieceHasSound: boolean }[];
  summary: {
    tokens: number;
    igbo: number;
    resolvedByGrade: Record<number, number>;
    missing: number;
    composed: number;
    ambiguous: number;
    unknown: number;
  };
};

/**
 * Plan the narration of one article: find its Igbo words, look each one up, dissect what is missing.
 *
 * **It writes nothing.** The queue is written by `missing-words.ts` from this plan, deliberately separately,
 * so that reading an article's cost and committing a queue are different acts.
 */
export async function planArticlePronunciation(
  db: Db,
  input: { slug: string; index?: DictionaryIndex; includeAmbiguous?: boolean }
): Promise<ArticlePronunciationPlan> {
  const index = input.index ?? (await buildDictionaryIndex(db));

  const article = await db.one<{ id: number; slug: string; title: string; body_html: string | null }>(
    `select id, slug, title, body_html from ozikoro_article
      where slug = $1 and status = 'published' and is_page = false`,
    [input.slug]
  );
  if (!article) {
    throw new Error(`No published record has the slug “${input.slug}”.`);
  }

  // The body is read as the article's own words — the same transform the narration uses, so the words found
  // here are exactly the words that will be spoken. **A finder run over the raw HTML would tokenise tag
  // names and attribute values**, and `class`, `src` and `href` are all short enough to match something.
  const { toSpokenScript } = await import('./spoken.ts');
  const { script } = toSpokenScript(article.body_html ?? '');

  const found = findIgboWords(script, index, { includeAmbiguous: input.includeAmbiguous });

  const words: ArticlePronunciationPlan['words'] = [];
  const missing: ArticlePronunciationPlan['missing'] = [];
  const composed: ArticlePronunciationPlan['composed'] = [];
  const resolvedByGrade: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const word of found.igbo) {
    const hit = await lookupPronunciation(db, word.surface, index);
    resolvedByGrade[hit.grade] = (resolvedByGrade[hit.grade] ?? 0) + 1;

    if (hit.found) {
      words.push({ ...hit, occurrences: word.count, spellings: word.spellings });
      continue;
    }

    /*
     * NOT IN THE DICTIONARY. The owner's next step is dissection, and dissection has three outcomes rather
     * than two:
     *
     *   - it splits and at least one piece carries a sound  -> a composed pronunciation that will be USED,
     *     marked as composed, and offered to an editor to improve
     *   - it splits but no piece carries a sound            -> still sayable from parts, still marked
     *   - it does not split                                 -> onto the queue that blocks the render
     *
     * The second case is why `anyPieceHasSound` exists rather than a simple yes/no: a composed pronunciation
     * of three silent spellings is a weaker thing than one built on a real recording, and the page has to be
     * able to say which it is offering.
     */
    const pieces = hit.dissection.pieces;
    if (pieces) {
      const detail = await dissect(db, word.surface, index);
      composed.push({
        word: word.surface,
        folded: word.folded,
        pieces,
        anyPieceHasSound: detail?.anyPieceHasSound ?? false,
      });
      resolvedByGrade[5] = (resolvedByGrade[5] ?? 0) + 1;
      // The composed hit is a real answer at grade 5, so it joins `words` as well as `composed` — nothing
      // downstream should have to know that a grade-5 word also appears in a second list.
      words.push({
        found: true, word: word.surface, folded: word.folded, grade: 5,
        source: 'composed from dictionary parts',
        wordId: null, headword: null, audioUrl: null, respelling: null,
        syllableBreakdown: null, dialectCode: null, composedOf: pieces, composed: true,
        occurrences: word.count, spellings: word.spellings,
      });
      continue;
    }

    missing.push({ ...hit, occurrences: word.count, spellings: word.spellings });
  }

  return {
    slug: article.slug,
    title: article.title,
    articleId: article.id,
    found,
    words: words.sort((a, b) => a.grade - b.grade || b.occurrences - a.occurrences),
    missing: missing.sort((a, b) => b.occurrences - a.occurrences),
    composed,
    summary: {
      tokens: (script.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) ?? []).length,
      igbo: found.igbo.length,
      resolvedByGrade,
      missing: missing.length,
      composed: composed.length,
      ambiguous: found.ambiguous.length,
      unknown: found.unknown.length,
    },
  };
}
