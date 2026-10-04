/**
 * THE PRONUNCIATION LAYER — why any of this matters.
 *
 * The owner's first narration mispronounced Igbo words, and he asked for it to be fixed at the source:
 * *"check ozituma.com automatically on how igbo words are pronounced to avoid it being pronounced
 * wrongly."* **A model not knowing Igbo is not an ElevenLabs problem or a local problem** — it is one
 * problem and it has one answer, so this module sits BELOW both engines and both of them call it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS BUILT FROM, AND WHAT IT DELIBERATELY DOES NOT RE-DERIVE
 * ---------------------------------------------------------------------------
 *
 * `packages/ozikoro/src/pronunciation.ts` already does the hard part, and it was measured against the live
 * dictionary before it was written. This module does not re-derive any of it; it **snapshots** it:
 *
 *   * `scripts/build-lexicon.ts` runs `buildDictionaryIndex(db)` once, with the cluster available, and
 *     writes the result to `apps/media/lexicon/igbo-lexicon.json`.
 *   * this module loads that file and rebuilds the same `WordIndex` from it, so the service can run the
 *     real finder — `findIgboWords` from `@ozikoro/platform` — **with no database at all.**
 *
 * That is what keeps this service stateless. The alternative, querying the dictionary per render, would
 * put a PGlite cluster (single-process, and the thing that has been corrupted seven times in one day) on
 * the path of every audio request.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THAT IS REBUILT RATHER THAN REUSED, AND HOW THAT IS PROVEN
 * ---------------------------------------------------------------------------
 *
 * `WordIndex.segment` is a closure created inside `buildDictionaryIndex`, so it cannot be serialised. Its
 * rule is transcribed below. **A transcription that drifts is exactly the kind of defect this repository
 * keeps recording**, so it is not left to trust: `build-lexicon.ts` rebuilds the index from the file it is
 * about to write and compares it against the live one, word by word, and refuses to write on any
 * disagreement. The proof runs at build time, against the real dictionary.
 *
 * ---------------------------------------------------------------------------
 * DIACRITICS ARE THE CONTENT
 * ---------------------------------------------------------------------------
 *
 * `ị ọ ụ ṅ` are different LETTERS from `i o u n`, not decoration, and a tone mark changes the word. Any
 * model, font or fallback that drops them is mispronouncing it — so this module's second job is to say
 * **exactly which marks will not survive**, per engine, before a render rather than after.
 *
 * The local model's vocabulary was checked character by character (see `apps/media/python/worker.py`):
 * the precomposed Igbo letters ARE present, and the COMBINING marks are NOT. So a word written as
 * `u` + U+0323 + U+0300 has no precomposed form for the grave and the grave is dropped. `stripPlan` below
 * reproduces that arithmetic in TypeScript so the service can state the cost up front.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pythonPaths } from './worker-client.ts';
import { ENGLISH_COLLISIONS, IGBO_MORPHEMES, findIgboWords, type FindResult, type WordIndex } from '@ozikoro/platform';
import { MediaError, type EngineName } from './errors.ts';

/** One dictionary headword, as snapshotted. Everything here was read from `word`. */
export type LexiconWord = {
  /** The folded key: `toSearchForm` removes every mark after NFD, so `ọ` becomes `o`. */
  folded: string;
  /** The published spelling, with its diacritics. **This is the thing that must not be folded away.** */
  headword: string;
  /** `word.pronunciation` — IPA or a practical respelling. Measured: NULL on every row in the dictionary. */
  respelling: string | null;
  /** `word.syllables`. Measured: NULL on every row. */
  syllables: string | null;
  dialectCode: string | null;
  wordId: number | null;
  /** A recording's URL. **Measured: zero. There is no audio in the dictionary to draw on.** */
  audioUrl: string | null;
};

export type LexiconFile = {
  version: 1;
  generatedAt: string;
  /** What the dictionary held, counted rather than asserted. */
  source: {
    publishedIgboWords: number;
    cleanFoldedForms: number;
    cleanMultiWordHeadwords: number;
    englishCollisions: number;
    /** Both measured at zero, and recorded as zero so nobody goes looking. */
    respellings: number;
    recordings: number;
    syllables: number;
  };
  /** What the ARCHIVE needs, measured by the previous round. Repeated here so the service can report it. */
  archive: {
    distinctIgboWords: number;
    namedByDictionary: number;
    rescuedByDissection: number;
    unsayable: number;
    measuredOn: string;
  };
  /** Every clean folded single-token form, including the ones that are English collisions. */
  forms: string[];
  /** Every clean multi-word headword: `[folded, headword]`. */
  phrases: [string, string][];
  /** The headwords with their spellings, for the words the archive actually uses. */
  words: LexiconWord[];
  /** The dissection pieces: forms of length >= 3 that are not English, plus the named morphemes. */
  pieces: string[];
  /** Recorded so the rebuild below can be checked against the same set it was built from. */
  collisions: string[];
};

/** Where the snapshot lives. Overridable so a test can point at a fixture. */
export function lexiconPath(): string {
  return process.env.OZIKORO_MEDIA_LEXICON ?? join(import.meta.dirname, '..', 'lexicon', 'igbo-lexicon.json');
}

export function lexiconExists(): boolean {
  return existsSync(lexiconPath());
}

/**
 * Load the snapshot, or refuse with the command that makes one.
 *
 * **It refuses rather than degrading to an empty index.** An empty index classifies every Igbo word as
 * `unknown`, which means the pronunciation layer silently does nothing and the narration mispronounces
 * exactly as it did before — the original fault, reproduced, with a "pronunciation layer: enabled" line in
 * the log. A missing lexicon must stop the render or be stated, never be averaged over.
 */
export function loadLexicon(): LexiconFile {
  const path = lexiconPath();
  if (!existsSync(path)) {
    throw new MediaError({
      code: 'engine_unavailable',
      status: 503,
      message:
        `the Igbo lexicon has not been built on this host: ${path} does not exist. ` +
        `Run \`npm -w @ozikoro/media run lexicon\` with the dictionary available. Without it the ` +
        `pronunciation layer cannot tell an Igbo word from an English one, and narrating anyway is how ` +
        `the owner's first recording mispronounced the words.`,
      details: { expectedPath: path, hint: 'npm -w @ozikoro/media run lexicon' },
    });
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as LexiconFile;
  if (parsed.version !== 1) {
    throw new MediaError({
      code: 'internal',
      status: 500,
      message: `the Igbo lexicon at ${path} is version ${String(parsed.version)}, which this service cannot read`,
      details: { path, version: parsed.version, expected: 1 },
    });
  }
  return parsed;
}

/**
 * Rebuild the finder's index from the snapshot.
 *
 * The `segment` rule is transcribed from `buildDictionaryIndex` in `packages/ozikoro/src/pronunciation.ts`,
 * and `build-lexicon.ts` proves the two agree before it writes the file. The comments that matter are kept
 * with it, because each one is a measured fault rather than a preference.
 */
export function rebuildWordIndex(lexicon: LexiconFile): WordIndex {
  const forms = new Set(lexicon.forms);
  const phrases = new Map(lexicon.phrases);
  const pieces = new Set(lexicon.pieces);
  let maxPieceLength = 0;
  for (const piece of pieces) maxPieceLength = Math.max(maxPieceLength, piece.length);

  return {
    has: (folded) => forms.has(folded),
    isEnglishCollision: (folded) => ENGLISH_COLLISIONS.has(folded),
    phrases,
    /**
     * Longest-match segmentation, greedily from the left.
     *
     * Longest first so the largest known pieces win: `akwụkwọ` must not become `a` + `kwụ` + `kwọ`. The
     * whole token must be consumed — a partial match is a coincidence, not a segmentation, and allowing one
     * would let `chicken` be `chi` + leftovers.
     *
     * A hyphen is a separator, not a letter: `Okwu-Ekpo` and `okwu ekpo` are the same construction, and
     * leaving the hyphen in the scan made every hyphenated compound unsegmentable.
     */
    segment(folded: string) {
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
          if (pieces.has(folded.slice(at, at + size))) {
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
 * The pieces dissection may use, derived exactly as `buildDictionaryIndex` derives them.
 *
 * Three characters minimum and not an ordinary English word, because two-letter pieces turn any English
 * word into a compound (`alan` -> `ala` + `n`), and a segmentation that rescues nothing but invents
 * everything is worse than none. Morphemes are exempt because they are productive in names.
 */
export function piecesFromForms(forms: Iterable<string>): string[] {
  const pieces = new Set<string>();
  for (const form of forms) {
    if (form.length >= 3 && !ENGLISH_COLLISIONS.has(form)) pieces.add(form);
  }
  for (const morpheme of IGBO_MORPHEMES) pieces.add(morpheme);
  return [...pieces].sort();
}

// ---------------------------------------------------------------------------
// Diacritics: what will actually survive to the model
// ---------------------------------------------------------------------------

/**
 * The F5-TTS vocabulary, read from the checkpoint's own `vocab.txt`.
 *
 * Read rather than hard-coded, because the whole claim below is *"these characters are in the model's
 * vocabulary"* and a hard-coded list would keep asserting it after a different checkpoint was installed.
 * Absent vocabulary means the check reports `null` — **not `clean`**, because "I could not check" and
 * "there is nothing to worry about" are different answers.
 */
export function f5Vocab(): Set<string> | null {
  for (const path of f5VocabCandidates()) {
    if (!existsSync(path)) continue;
    try {
      /*
       * DISTINCT CHARACTERS, not lines.
       *
       * The worker builds its vocabulary with `set(text)` over `f5_tts/infer/examples/vocab.txt` — the set
       * of distinct CHARACTERS in that file. Measured: **1,221 of them**, and `ụ` U+1EE5 is present while
       * `Ọ` U+1ECC is not.
       *
       * The first version of this function read `.tools/models/F5TTS_Base/vocab.txt` and split it on
       * newlines, which is a *different file entirely* — that one is the model's token list, whose entries
       * include `a1`, `ai1` and multi-character pinyin syllables. Splitting it into "characters" found no
       * bare letter `a`, and the effect was a report claiming that `a`, `b`, `d`, `e` and the comma were all
       * characters the model could not represent. **A vocabulary check that reads the wrong file does not
       * fail — it produces confident nonsense**, which is worse than not checking.
       */
      return new Set(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Where the model's character vocabulary might be.
 *
 * Derived from the interpreter the service already uses rather than hard-coded, because the path carries
 * the Python version (`…/lib/python3.11/site-packages/…`) and a hard-coded one would silently stop matching
 * after an interpreter upgrade — and a missing vocabulary makes the diacritic check report `unchecked`,
 * which looks like caution rather than a broken path.
 */
function f5VocabCandidates(): string[] {
  const out: string[] = [];
  const override = process.env.OZIKORO_MEDIA_F5_VOCAB;
  if (override) out.push(override);

  const { python } = pythonPaths();
  // `<venv>/bin/python` -> `<venv>`
  const venv = join(python, '..', '..');
  try {
    for (const entry of readdirSync(join(venv, 'lib'))) {
      if (!entry.startsWith('python')) continue;
      out.push(join(venv, 'lib', entry, 'site-packages', 'f5_tts', 'infer', 'examples', 'vocab.txt'));
    }
  } catch {
    /* no venv/lib — fall through to null */
  }
  return out;
}

/** The combining marks the local worker removes when the composed character is not a known token. */
const REMOVABLE_MARKS = '\u0300\u0301\u0323';

/** `U+0323`, the form a report should name a mark by. */
function codepoint(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

export type StripPlan = {
  /** What would actually be sent. Identical to the input when nothing is lost. */
  text: string;
  /** Combining marks that would be removed, with the words they came from. */
  stripped: { mark: string; word: string; codepoint: string }[];
  /** Characters that are in neither the vocabulary nor the removable set. */
  outOfVocab: string[];
  /**
   * Capital marked letters folded to their lowercase form, because the checkpoint has no token for the
   * capital. Recorded because it is a change to the text the model is given.
   */
  caseFolded: string[];
  /** Whether this text can be spoken without losing a mark. */
  lossless: boolean;
  /** Null when the vocabulary could not be read. */
  checked: boolean;
};

/**
 * Reproduce the local model's text preparation, in TypeScript, so the service can state the cost of a
 * render **before** paying it.
 *
 * The arithmetic is transcribed from `prepare_text` in `python/worker.py`, which measured the vocabulary
 * character by character. `unicodedata.normalize("NFC", ...)` composes `i` + U+0323 into `ị`, which IS a
 * known token; it cannot compose `ụ̀` (u-dot-below + grave) because no such code point exists, so that
 * grave is removed and the tone is lost.
 *
 * **This function does not change what the model does — it predicts it.** If the two ever disagree the
 * worker is the authority, and the worker's own `stripped_marks` field comes back on the result. Having
 * both is the point: the prediction lets a caller decline, and the measurement lets an auditor check.
 */
export function stripPlanForLocal(text: string, vocab: Set<string> | null): StripPlan {
  if (vocab === null) {
    return { text, stripped: [], outOfVocab: [], caseFolded: [], lossless: true, checked: false };
  }

  const nfc = text.normalize('NFC');
  const stripped: StripPlan['stripped'] = [];
  const outOfVocab = new Set<string>();
  const caseFolded: string[] = [];
  const chars: string[] = [];

  // Word by word so a removed mark can be attributed to the word that carried it — "a tone was lost" is not
  // actionable; "the tone was lost in ụ̀gwụ̀" is.
  for (const word of nfc.split(/(\s+)/)) {
    if (!word || /^\s+$/.test(word)) {
      chars.push(word);
      continue;
    }
    const kept: string[] = [];
    for (const ch of word) {
      /*
       * STEP 1 — the composed character is a token the model knows, so keep it WHOLE.
       *
       * **This ordering is the fix for the defect that made the owner's first recording mispronounce his
       * own language.** Decomposing first turns `ụ` (U+1EE5, a known token) into `u` + U+0323, and U+0323
       * is not in the vocabulary — so the dot below was deleted and `bụ` was sent as `bu`. A dot below is
       * a different LETTER, not decoration, so that is a mispronunciation produced by the code rather than
       * by the model. The measurement is in `apps/media/python/worker.py`.
       */
      if (vocab.has(ch)) {
        kept.push(ch);
        continue;
      }

      /*
       * STEP 2 — the capital form is not a token but its lowercase is.
       *
       * Measured: the vocabulary holds `ị` U+1ECB and `ọ` U+1ECD but NOT `Ị` U+1ECA or `Ọ` U+1ECC. So a
       * sentence opening "Ọ dị mma" lost the dot on its first letter. Folding to lowercase keeps the LETTER
       * where the alternative keeps only its base, and case carries no phonetic weight in a reading. It is
       * recorded on the plan, because it is a change to the text the model was given.
       */
      const lower = ch.toLowerCase();
      if (lower !== ch && vocab.has(lower)) {
        kept.push(lower);
        caseFolded.push(ch);
        continue;
      }

      /*
       * STEP 3 — decompose this character alone, so a mark with no precomposed home is handled without
       * disturbing any character that had one. `ụ̀` has no single code point, so its grave can only be
       * dropped; plain `ụ` never reaches here.
       *
       * Anything still unknown is REMOVED rather than passed through, because F5-TTS's tokenizer is
       * `vocab_char_map.get(c, 0)` — an unknown character silently becomes token 0, a blank. Passing it
       * through would therefore look like it was sent while actually being deleted by the model, and the
       * service would report nothing.
       */
      const parts = [...ch.normalize('NFD')];
      if (parts.length === 1) {
        if (REMOVABLE_MARKS.includes(ch)) {
          stripped.push({ mark: ch, word, codepoint: codepoint(ch) });
        } else {
          outOfVocab.add(ch);
        }
        continue;
      }
      for (const sub of parts) {
        if (vocab.has(sub)) kept.push(sub);
        else if (REMOVABLE_MARKS.includes(sub)) stripped.push({ mark: sub, word, codepoint: codepoint(sub) });
        else outOfVocab.add(sub);
      }
    }
    chars.push(kept.join('').normalize('NFC'));
  }

  return {
    text: chars.join(''),
    stripped,
    outOfVocab: [...outOfVocab].sort(),
    caseFolded,
    lossless: stripped.length === 0 && outOfVocab.size === 0 && caseFolded.length === 0,
    checked: true,
  };
}

// ---------------------------------------------------------------------------
// The report the service returns
// ---------------------------------------------------------------------------

export type WordResolution = {
  /** The word as the article wrote it. */
  surface: string;
  folded: string;
  occurrences: number;
  /** 1..5 resolved, 6 not found. See `GRADE_LABEL` in `pronunciation.ts`. */
  grade: number;
  /** A sentence a person can read. */
  source: string;
  /** The published spelling with its diacritics — **what the model should be given.** */
  headword: string | null;
  respelling: string | null;
  syllables: string | null;
  /** The pieces, for a composed pronunciation. */
  composedOf: string[] | null;
  audioUrl: string | null;
};

export type PronunciationReport = {
  engine: EngineName;
  /** True when the lexicon was loaded and the finder ran. */
  enabled: boolean;
  found: FindResult;
  resolved: WordResolution[];
  /** Neither in the dictionary nor dissectable. **These block a render.** */
  unsayable: { surface: string; folded: string; occurrences: number; reason: string }[];
  /** Words the local model would have to lose a mark from, if that engine is used. */
  markLoss: { word: string; marks: string[] }[];
  /** Characters the chosen engine cannot represent, named. Empty when nothing is lost. */
  outOfVocab: string[];
  summary: {
    tokens: number;
    igboWords: number;
    resolvedByGrade: Record<number, number>;
    rescuableByDissection: number;
    unsayable: number;
    englishCollisionsDeclined: number;
    /** Whether the diacritic check ran at all. `false` means unchecked, not clean. */
    marksChecked: boolean;
    marksLost: number;
    /**
     * Capital marked letters folded to lowercase because the checkpoint has no token for the capital
     * (`Ọ` -> `ọ`). Zero for text that does not open a sentence on one.
     */
    caseFolded: number;
  };
};

/**
 * Resolve every Igbo word in a piece of text, for a named engine.
 *
 * The engine is a parameter because the ANSWER differs: the same article has marks that survive ElevenLabs
 * (which takes UTF-8 as sent) and do not survive the local model (whose vocabulary has no combining
 * grave). **Reporting one number for both would be the averaged answer that helps neither.**
 */
export function analyse(text: string, engine: EngineName, options: { includeAmbiguous?: boolean } = {}): PronunciationReport {
  const lexicon = loadLexicon();
  const index = rebuildWordIndex(lexicon);
  const byFold = new Map<string, LexiconWord>();
  for (const word of lexicon.words) {
    if (!byFold.has(word.folded)) byFold.set(word.folded, word);
  }

  const found = findIgboWords(text, index, { includeAmbiguous: options.includeAmbiguous });
  const resolved: WordResolution[] = [];
  const unsayable: PronunciationReport['unsayable'] = [];
  const resolvedByGrade: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const word of found.igbo) {
    const hit = byFold.get(word.folded);
    if (hit) {
      /*
       * GRADE 4 — a dictionary spelling, no sound recorded.
       *
       * This is the honest grade for almost the whole archive and the reason the report says "spellings
       * and respellings" rather than "pronunciations". The dictionary holds the SPELLING of 8,728 Igbo
       * words and not one recording, so a lookup can correct a model's letters but cannot hand it a
       * sound. Grades 1–3 are unreachable until somebody records the words, which no code can do.
       */
      resolvedByGrade[4] = (resolvedByGrade[4] ?? 0) + 1;
      resolved.push({
        surface: word.surface,
        folded: word.folded,
        occurrences: word.count,
        grade: 4,
        source: 'a dictionary spelling — no sound recorded',
        headword: hit.headword,
        respelling: hit.respelling,
        syllables: hit.syllables,
        composedOf: null,
        audioUrl: hit.audioUrl,
      });
      continue;
    }

    const pieces = index.segment(word.folded);
    if (pieces) {
      // GRADE 5 — composed from dictionary parts. Lower than every real reference, higher than nothing.
      resolvedByGrade[5] = (resolvedByGrade[5] ?? 0) + 1;
      resolved.push({
        surface: word.surface,
        folded: word.folded,
        occurrences: word.count,
        grade: 5,
        source: `composed from dictionary parts: ${pieces.join(' + ')}`,
        headword: null,
        respelling: null,
        syllables: null,
        composedOf: pieces,
        audioUrl: null,
      });
      continue;
    }

    // GRADE 6 — not found, and not dissectable. **This is what blocks a render.**
    resolvedByGrade[6] = (resolvedByGrade[6] ?? 0) + 1;
    unsayable.push({
      surface: word.surface,
      folded: word.folded,
      occurrences: word.count,
      reason: 'not a dictionary headword, and no segmentation of it into known pieces',
    });
  }

  // --- the diacritic check, per engine ---
  let markLoss: PronunciationReport['markLoss'] = [];
  let outOfVocab: string[] = [];
  let marksChecked = false;
  let caseFolded = 0;
  if (engine === 'local') {
    const plan = stripPlanForLocal(text, f5Vocab());
    marksChecked = plan.checked;
    caseFolded = plan.caseFolded.length;
    const byWord = new Map<string, string[]>();
    for (const s of plan.stripped) {
      const marks = byWord.get(s.word) ?? [];
      marks.push(s.codepoint);
      byWord.set(s.word, marks);
    }
    markLoss = [...byWord.entries()].map(([word, marks]) => ({ word, marks }));
    outOfVocab = plan.outOfVocab;
  } else {
    // ElevenLabs takes the text as sent. **That is not the same as "pronounces it correctly"** — it means
    // the marks reach the model. Whether the model then says them right is measured by listening, which
    // this service cannot do for the owner.
    const plan = stripPlanForLocal(text, null);
    marksChecked = false;
    markLoss = [];
    outOfVocab = plan.outOfVocab;
  }

  return {
    engine,
    enabled: true,
    found,
    resolved,
    unsayable,
    markLoss,
    outOfVocab,
    summary: {
      tokens: (text.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) ?? []).length,
      igboWords: found.igbo.length,
      resolvedByGrade,
      rescuableByDissection: resolvedByGrade[5] ?? 0,
      unsayable: unsayable.length,
      englishCollisionsDeclined: found.ambiguous.length,
      marksChecked,
      marksLost: markLoss.reduce((n, m) => n + m.marks.length, 0),
      caseFolded,
    },
  };
}

/**
 * The archive's measured coverage, so the service reports the real figure rather than re-measuring it or,
 * worse, implying something better.
 *
 * **Measured on the archive, and it is not flattering:** of 2,368 distinct Igbo words, the dictionary names
 * 1,289, dissection rescues 617, and **462 are genuinely unsayable** — the dictionary holds no sound for
 * any of them, and no amount of code can invent one. A pronunciation is either recorded by a person or
 * fabricated, and a fabricated one would be spoken in the owner's own cloned voice and sound authoritative.
 */
export function archiveCoverage(): LexiconFile['archive'] | null {
  try {
    return loadLexicon().archive;
  } catch {
    return null;
  }
}
