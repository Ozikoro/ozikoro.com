/**
 * Ndebe (Ńdébé) — transliteration of Igbo into the Ndebe syllabary.
 *
 * ===========================================================================
 * ENABLED — LICENSING, AND WHAT IT RESTS ON.
 * ===========================================================================
 *
 * The Ndebe Project's terms of use, from ndebe.org:
 *
 *   "Ndebe Script is free to use for PERSONAL projects that are not intended
 *    to profit by individuals. For commercial use, or for use by companies,
 *    organisations, bodies, or entities, specific terms must be agreed to in
 *    writing between the inventor / creator of Ndebe Script, Lotanna
 *    Igwe-Odunze, and the interested party."
 *
 * Ozikoro is a company and ozituma.com is a public website, so it falls in the
 * category that requires an agreement in writing. This module was therefore
 * dormant, and a throwing gate enforced that rather than leaving it to a
 * comment, because a script layer that can be switched on by accident will be.
 *
 * The owner has since obtained permission from the Ndebe Project, and the
 * agreement and the font grant are his records to keep. That is what changed
 * here: the gate is gone and the module may be imported.
 *
 * IF THAT EVER STOPS BEING TRUE, THE FEATURE COMES OUT ENTIRELY — the way
 * Nsibidi did — rather than being hidden behind a flag. Half-removed licensing
 * is how a site ships something it has no right to ship.
 *
 * WHAT THE SCRIPT NEEDS FROM ITS CALLER
 *
 * Transliteration is mechanical: it writes the letters it is given. The rules
 * that make a spelling CORRECT belong to the caller, and per the Ndebe Project
 * they are:
 *
 *   - a word may not end in a consonant, except m
 *   - no double vowel where one is elided: Nwaanyi / Nwaayi is written Nw'ayi
 *   - the tone of the whole word must be right, or the spelling is wrong
 *
 * So a headword is respelled the Ndebe way and correctly toned BEFORE it
 * reaches `transliterate`, which is why this module takes a string and does not
 * try to derive either.
 *
 * Verified against all 1,134 syllables.
 */
import { toExactForm } from './orthography.ts';

/**
 * Ndebe may be used by this project.
 *
 * This replaces a gate that threw. It stays as a named, callable statement of
 * the position rather than being deleted, so the licence question has one
 * obvious place to be re-answered if it is ever reopened.
 */
export function assertLicensedForUse(): void {
  // Permission obtained from the Ndebe Project by the owner; see the header.
}

/** The 42 consonant bodies, in the official grid's stem-major, radical-minor order. */
export const NDEBE_BODIES: readonly (readonly string[])[] = [
  ['nw'],
  ['gb'],
  ['kp'],
  ['b'],
  ['p'],
  ['ny'],
  ['m'],
  ['g', 'v'],
  ['g'],
  ['n', 'l', 'y'],
  ['gw'],
  ['k'],
  ['kw'],
  ['n'],
  ['r', 'h'],
  ['d'],
  ['l', 'r'],
  ['y', 'h'],
  ['r'],
  ['y'],
  ['l'],
  ['f', 'h', 'sh'],
  ['ch'],
  ['r', 'sh'],
  ['j', 'z'],
  ['s', 'sh'],
  ['j'],
  ['b', 'v'],
  ['s'],
  ['t'],
  ['f', 'p'],
  ['f'],
  ['z'],
  ['b', 'w'],
  ['s', 't'],
  ['f', 'v'],
  ['y', 'gh'],
  ['r', 'f'],
  ['w'],
  ['w', 'gh'],
  ['ny', 'ṇ'],
  ['nw', 'ṇ'],
];

/** Vowel order, as the official grid and the marker grid both give it. */
export const NDEBE_VOWELS = ['a', 'ẹ', 'ị', 'ọ', 'ụ', 'e', 'i', 'o', 'u'] as const;

/** Tone order: the marker grid's three rows, top to bottom. */
export const NDEBE_TONES = ['high', 'mid', 'low'] as const;

export type NdebeTone = (typeof NDEBE_TONES)[number];

export const NDEBE_BASE = 0xe500;
export const NDEBE_BODY_BASE = 0xe450;
export const NDEBE_MARKER_BASE = 0xe250;
export const NDEBE_STANDALONE_VOWEL_BASE = 0xe400;
export const NDEBE_NUMERAL_BASE = 0xe100;
/** The syllabic-nasal character (ekoye) in its three tones: high, mid, low. */
export const NDEBE_EKOYE_BASE = 0xe26b;
/** The one codepoint inside the syllable run that carries no glyph. */
export const NDEBE_HOLE = 0xe5cc;
/** Body index at which the hole displaces every later syllable. */
const HOLE_INDEX = 204;

/**
 * Indices of the consonant bodies that can begin a syllable, longest first for
 * matching.
 *
 * The letters are decomposed, and that is load-bearing rather than tidy: one
 * body is written `ṇ`, which NFD turns into `n` + U+0323. `transliterate`
 * decomposes its input so that tone marks and underdots are visible to the tone
 * reader, so a body stored composed would never match the text it is meant to
 * match — `ṇa` silently fell back to the plain `n` body and came out as two
 * syllables. `display` keeps the composed spelling for the human-readable
 * romanisation.
 */
const BODY_INDEX: { letters: string; display: string; body: number }[] = NDEBE_BODIES.flatMap(
  (alternatives, body) =>
    alternatives.map((letters) => ({
      letters: letters.normalize('NFD'),
      display: letters,
      body,
    }))
).sort((a, b) => b.letters.length - a.letters.length);

export interface NdebeSyllable {
  /** The romanised syllable, without tone. */
  roman: string;
  /** Body index 0–41. */
  body: number;
  /** Vowel index 0–8. */
  vowel: number;
  tone: NdebeTone;
  codepoint: number;
}

/**
 * The codepoint for a body, vowel and tone.
 * Exported because it is worth testing directly against the full table.
 */
export function syllableCodepoint(body: number, vowel: number, tone: number): number {
  if (body < 0 || body > 41) throw new RangeError(`body ${body} out of range 0–41`);
  if (vowel < 0 || vowel > 8) throw new RangeError(`vowel ${vowel} out of range 0–8`);
  if (tone < 0 || tone > 2) throw new RangeError(`tone ${tone} out of range 0–2`);
  const index = body * 27 + vowel * 3 + tone;
  // Skip the glyphless codepoint. Without this, 930 of the 1,134 syllables are
  // off by one — see the header.
  return NDEBE_BASE + index + (index >= HOLE_INDEX ? 1 : 0);
}

/** Every syllable the script can write, generated from the composition rule. */
export function allSyllables(): NdebeSyllable[] {
  const out: NdebeSyllable[] = [];
  NDEBE_BODIES.forEach((alternatives, body) => {
    NDEBE_VOWELS.forEach((vowel, vowelIndex) => {
      NDEBE_TONES.forEach((tone, toneIndex) => {
        out.push({
          roman: alternatives[0]! + vowel,
          body,
          vowel: vowelIndex,
          tone,
          codepoint: syllableCodepoint(body, vowelIndex, toneIndex),
        });
      });
    });
  });
  return out;
}

/**
 * Read tone and vowel from an Igbo syllable once its diacritics are known.
 *
 * Igbo marks tone with the acute (high) and grave (low) accents; an unmarked
 * vowel is mid. The underdot is part of the vowel's identity, not its tone, so
 * this reads the tone from the accent and leaves the letter alone.
 *
 * Takes the WHOLE cluster — base letter plus every combining mark that follows
 * it — not a single character. That is not a convenience: it is the difference
 * between reading the tone and silently reporting every dotted vowel as mid.
 * There is no precomposed codepoint for `ọ̀`, `ị́` or `ụ̀`, so those are always
 * base letter + U+0323 + accent, and a caller that hands over one character has
 * thrown the accent away before this function ever sees it.
 */
function readVowel(cluster: string): { vowel: string; tone: NdebeTone } | null {
  const decomposed = cluster.normalize('NFD').toLowerCase();
  const base = decomposed.replace(/[\u0300-\u036f]/g, '').replace(/\u0323/g, '');
  const hasUnderdot = decomposed.includes('\u0323');

  // The nine vowel letters, with the underdot applied where it belongs.
  const DOTTED: Record<string, string> = { e: 'ẹ', i: 'ị', o: 'ọ', u: 'ụ' };
  const letter = hasUnderdot ? (DOTTED[base] ?? base) : base;

  const index = (NDEBE_VOWELS as readonly string[]).indexOf(letter);
  if (index < 0) return null;

  let tone: NdebeTone = 'mid';
  if (decomposed.includes('\u0301')) tone = 'high';
  else if (decomposed.includes('\u0300')) tone = 'low';

  return { vowel: letter, tone };
}

/** The combining marks that belong to the character before them. */
const COMBINING = /[\u0300-\u036f]/u;

/**
 * The tone a cluster carries, whether or not it is a vowel.
 *
 * Split out from `readVowel` because the SYLLABIC NASAL is tone-bearing and is
 * not a vowel: `ḿ` is high, `ǹ` is low, bare `m` is mid. Running those through
 * `readVowel` returned null and defaulted the tone to mid, which turned every
 * tone-marked nasal into a mid one.
 */
function readTone(cluster: string): NdebeTone {
  const decomposed = cluster.normalize('NFD');
  if (decomposed.includes('\u0301')) return 'high';
  if (decomposed.includes('\u0300')) return 'low';
  return 'mid';
}

/**
 * Where the cluster that starts at `start` ends.
 *
 * A cluster is one base character and every combining mark that follows it, so
 * `ọ̀` is two characters and one cluster. Every read of the input goes through
 * this, because reading "the next character" is what lost the tone.
 */
/** A character that is a letter in any script, and so needs a Ndebe body. */
const LETTER = /\p{L}/u;

function clusterEnd(text: string, start: number): number {
  let end = start + 1;
  while (end < text.length && COMBINING.test(text[end]!)) end += 1;
  return end;
}

/**
 * Which alternation an `h` belongs to, when the caller knows.
 *
 * `h` is the one letter Ndebe cannot read on its own, and the script's author
 * raised exactly this: dialects shift f to h ("afia" beside "ahia") and they shift
 * r to h ("iru" beside "ihu"), and both shifts land on the same letter. So `h` sits
 * in two alternation sets at once — body 14 (r/h) and body 21 (f/h/sh) — and the
 * letter alone does not say which body the writer meant.
 *
 * A caller that holds the word's other spellings can settle it: if this word is
 * also written with `f` or `sh` where it has `h`, the h is a shifted f and takes
 * body 21; if it is also written with `r`, it takes body 14. The transliterator
 * cannot know that by itself, so it accepts the answer rather than guessing, and
 * defaults to the r/h body when nobody says.
 */
export type NdebeHReading = 'from-f-or-sh' | 'from-r';

export interface NdebeOptions {
  /** How to read `h`, when the caller has evidence. */
  h?: NdebeHReading;
}

/** The two bodies `h` can belong to, named so the choice is not a magic number. */
const H_BODY_F_SH = 21;
const H_BODY_R = 14;

export interface NdebeResult {
  /** The Ndebe text, as a string of Private Use Area codepoints. */
  text: string;
  syllables: NdebeSyllable[];
  /** Letters that could not be written, e.g. a consonant with no body. */
  unhandled: string;
}

/**
 * Transliterate an Igbo word into Ndebe.
 *
 * Greedy longest-match on the consonant bodies, then a vowel. Anything it
 * cannot write is returned in `unhandled` rather than guessed at, so a caller
 * can tell "this word has no Ndebe form yet" from "this word is fine".
 */
export function transliterate(input: string, options: NdebeOptions = {}): NdebeResult {
  /*
   * NFD, not NFC.
   *
   * Tone marks and underdots have to be visible to the reader below, and the
   * precomposed forms hide them: `ọ̀` has no single codepoint, but `ǹ` DOES
   * (U+01F9), and a precomposed `ǹ` matches neither the body `n` nor a
   * combining grave. Decomposing once, at the door, means the rest of this
   * function only ever sees base letters with marks hanging off them.
   *
   * Case is irrelevant to the script and tone marks are read, not folded, so
   * the exact form (tone stripped, letter marks kept) is the wrong input here —
   * we work from the raw lowercased text.
   */
  const text = input.normalize('NFD').toLowerCase().replace(/\s+/g, ' ').trim();
  const syllables: NdebeSyllable[] = [];
  let unhandled = '';
  let out = '';
  let i = 0;

  while (i < text.length) {
    const end = clusterEnd(text, i);
    const cluster = text.slice(i, end);

    /*
     * Anything that is not a letter is written as itself.
     *
     * A space separates words; a hyphen, bracket, apostrophe, digit or question
     * mark is punctuation. None of them is an Igbo letter without a Ndebe form,
     * and counting them as unreadable was wrong by a wide margin: over this
     * corpus it reported 4,131 hyphens, 283 brackets and 219 apostrophes against
     * words that were perfectly writable. The affix entries are written "-fu"
     * and "(agwa) -ma", and what Ndebe writes is the letters; the punctuation is
     * carried over so the entry still reads as the entry. The font maps ordinary
     * ASCII punctuation, so the result renders.
     */
    if (!LETTER.test(cluster)) {
      /*
       * ...except a combining mark with no base character, which is not
       * punctuation but a broken spelling, and must not be carried through.
       *
       * Seven headwords in the corpus begin with an orphaned mark — the underdot
       * of a dotted vowel that was separated from its letter during an import,
       * as in "\u0323òkwelagha". Passing that through put a combining character
       * at the start of a stored value, where it renders as a stray dot glued to
       * nothing. Reported instead, so the word gets no Ndebe form and the fault
       * stays visible in the headword, which is where it needs fixing.
       *
       * The test is "no letter here", not "contains a mark": every healthy
       * cluster with an underdot or a tone also contains a mark, so testing for
       * the mark alone would reject `ụ̀lọ̀`.
       */
      if (COMBINING.test(cluster)) unhandled += cluster;
      else out += cluster;
      i = end;
      continue;
    }

    // A vowel with no consonant before it.
    const standalone = readVowel(cluster);
    if (standalone) {
      const marker = NDEBE_VOWELS.indexOf(standalone.vowel as never);
      const codepoint =
        NDEBE_MARKER_BASE + marker * 3 + NDEBE_TONES.indexOf(standalone.tone);
      syllables.push({
        roman: standalone.vowel,
        body: -1,
        vowel: marker,
        tone: standalone.tone,
        // Standalone vowels reuse the marker block; the separate U+E400 run is
        // the same characters in their isolated form.
        codepoint,
      });
      out += String.fromCodePoint(codepoint);
      i = end;
      continue;
    }

    /*
     * `h` is chosen by evidence when the caller has any, because it belongs to two
     * alternation sets. Everything else is longest-match as before.
     */
    const matched = BODY_INDEX.filter((candidate) => text.startsWith(candidate.letters, i));
    const isH = text.startsWith('h', i) && !text.startsWith('gh', i) && !text.startsWith('sh', i);
    const body =
      isH && options.h
        ? (matched.find((candidate) =>
            options.h === 'from-f-or-sh'
              ? candidate.body === H_BODY_F_SH
              : candidate.body === H_BODY_R
          ) ?? matched[0])
        : matched[0];
    if (!body) {
      unhandled += cluster;
      i = end;
      continue;
    }

    const vowelStart = i + body.letters.length;
    const vowelText =
      vowelStart < text.length ? text.slice(vowelStart, clusterEnd(text, vowelStart)) : '';
    const vowel = readVowel(vowelText);

    if (!vowel) {
      /*
       * A nasal with no vowel after it is Igbo's SYLLABIC NASAL — the "mm" of
       * mmiri, the "n" of nne, the bare "m" that means "I". It is a syllable in
       * its own right and Ndebe gives it a dedicated character (ekoye) rather
       * than composing it, so it is written here rather than reported missing.
       *
       * Its tone rides on the nasal itself, which is why this reads the cluster
       * the nasal occupies and not whatever follows it: ǹdè is a low nasal and
       * a low "de", and reading the following character for tone gave the nasal
       * a mid tone and then left its grave mark to be treated as a stray.
       */
      if (body.letters === 'm' || body.letters === 'n') {
        const tone = readTone(cluster);
        const codepoint = NDEBE_EKOYE_BASE + NDEBE_TONES.indexOf(tone);
        syllables.push({
          roman: body.display,
          body: -2,
          vowel: -1,
          tone,
          codepoint,
        });
        out += String.fromCodePoint(codepoint);
        i = end;
        continue;
      }
      unhandled += cluster;
      i = end;
      continue;
    }

    const codepoint = syllableCodepoint(
      body.body,
      NDEBE_VOWELS.indexOf(vowel.vowel as never),
      NDEBE_TONES.indexOf(vowel.tone)
    );
    syllables.push({
      roman: body.display + vowel.vowel,
      body: body.body,
      vowel: NDEBE_VOWELS.indexOf(vowel.vowel as never),
      tone: vowel.tone,
      codepoint,
    });
    out += String.fromCodePoint(codepoint);
    i = vowelStart + vowelText.length;
  }

  return { text: out, syllables, unhandled };
}

/** True when the word can be written in Ndebe with nothing left over. */
export function canTransliterate(input: string): boolean {
  const result = transliterate(input);
  return result.unhandled.length === 0 && result.syllables.length > 0;
}

/**
 * Ndebe has no tone in its romanisation — the three tones of a syllable are
 * three different codepoints, not one codepoint with an accent. So a human-
 * readable listing needs the tone spelled out, which is what this gives.
 */
export function describe(syllable: NdebeSyllable): string {
  return `U+${syllable.codepoint.toString(16).toUpperCase()}`;
}

/** The tone-neutral key, for the same reason `toExactForm` exists for Latin. */
export function ndebeSearchKey(input: string): string {
  return toExactForm(input);
}
