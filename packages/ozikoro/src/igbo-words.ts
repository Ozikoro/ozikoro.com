/**
 * WHICH WORDS IN AN ENGLISH ARTICLE ARE IGBO.
 *
 * THE OWNER'S INSTRUCTION
 *
 *   "any words that is Igbo, you go to ozituma.com ... and pull out the record, but if it is not there, you
 *    can dissect the words ... if it can't, then it can go ahead to inform the admin, and editors, to
 *    upload or record the words listed in the article ... as to not waste credits."
 *
 * Every step after this one costs something — an editor's time, a credit, or a mispronunciation in the
 * owner's own cloned voice. So this module's whole job is to be HONEST ABOUT WHAT IT KNOWS, and the design
 * follows from two failures measured on the real archive before a line of it was written.
 *
 * ---------------------------------------------------------------------------
 * FAILURE ONE: THE DICTIONARY, USED ALONE, CALLS ORDINARY ENGLISH IGBO.
 * ---------------------------------------------------------------------------
 *
 * The instruction says the dictionary is the signal, and it is the strongest one available. **But it is not
 * sufficient, and the measurement is not close.** On one real archive record about afa divination, the
 * folded forms that matched published Igbo headwords included:
 *
 *     token     times in the article    what it actually is there
 *     a                 23              the English article
 *     were               5              the English verb
 *     be                 1              the English verb
 *     m                  3              the English abbreviation
 *     afa               26              IGBO — correct
 *     igbo              19              IGBO — correct
 *     dibia              3              IGBO — correct
 *
 * **`a`, `be` and `were` are published Igbo headwords.** (So are 162 others: `cell`, `engine`, `chart`,
 * `atom` — English loanwords the Igbo API imported as entries.) A pipeline that trusted a dictionary hit
 * would pronounce "they were" with Igbo phonology and, worse, would open a queue entry asking a person to
 * record the word "were" in Igbo.
 *
 * So a dictionary hit is necessary and not sufficient, and the discriminator is English: a folded form that
 * is ALSO an ordinary English word is not enough on its own. The 165 such forms among the clean headwords
 * are listed in `ENGLISH_COLLISIONS` below, with how they were produced and how to reproduce them.
 *
 * ---------------------------------------------------------------------------
 * FAILURE TWO: THE ARCHIVE'S PROSE CARRIES ALMOST NO DIACRITICS.
 * ---------------------------------------------------------------------------
 *
 * The instruction says diacritics are a strong signal, and they are — a word carrying `ị ọ ụ ṅ` or a tone
 * mark is Igbo with near-certainty, because English prose does not write them. **But the same record that
 * supplied the table above contains ZERO of them in 6,738 characters.** Measured across the sentence, not
 * assumed: not one `ị`, not one tone mark.
 *
 * So diacritics are a precise signal that fires almost never, and the unaccented dictionary path above is
 * the one that does the work. A finder built on diacritics alone would find nothing in the archive it was
 * written for — which is exactly the kind of working-looking, useless instrument this project has had to
 * correct before.
 *
 * ---------------------------------------------------------------------------
 * THE DECISION RULE, AND WHY EACH LEVEL IS WHERE IT IS
 * ---------------------------------------------------------------------------
 *
 * Every token gets ONE evidence level, and the levels are ordered by how much a person would trust them:
 *
 *   diacritic          carries a letter or tone mark                    certain
 *   phrase             matches a multi-word dictionary headword         strong
 *   dictionary         a clean headword, and not an English word        strong
 *   compound           every piece is a known one, and >= 2 pieces      probable
 *   affix              a known Igbo morpheme plus a known stem          probable
 *   dictionary-english a headword that is ALSO an English word          AMBIGUOUS — not Igbo by default
 *   unknown            nothing matched                                  not Igbo
 *
 * `dictionary-english` is not a rejection. It is the honest answer to "is `were` the Igbo word or the
 * English one?", which this module cannot settle from the token alone — so it says so, returns the token in
 * a separate list, and lets a caller that has context decide. **The default is English, because the archive
 * is English prose and the base rate is overwhelmingly English.** A caller may flip that with
 * `includeAmbiguous`, and every ambiguous token is reported either way so the choice is visible.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * **It has no hard-coded list of Igbo words.** The dictionary is read live from `word` — see
 * `buildWordIndex` in `pronunciation.ts` — so a word added to ozituma tomorrow is found tomorrow, which is
 * the owner's own point about going to ozituma.com and pulling the record out. The ONE static list here is
 * `ENGLISH_COLLISIONS`, and it is a list of ENGLISH words, not of Igbo ones: it is the answer to "which of
 * the dictionary's spellings are also ordinary English", which is a fact about English and not about the
 * dictionary. `scripts/igbo-collisions.mjs` regenerates it by intersecting the dictionary with the system
 * word list; the header records the count and the date it was taken.
 *
 * **It does not guess.** A token it cannot place is `unknown` and is NOT returned as Igbo. A name like
 * `Nwedozie` therefore falls out, and the recall cost of that is measured and reported rather than hidden —
 * see the head of `test-pronunciation.ts` for the hand-checked figures.
 */
import { toSearchForm } from '@ozituma/core';

/**
 * Marks that make a spelling Igbo on their own.
 *
 * Read from `@ozituma/core`'s own model rather than re-listed here: `LETTER_MARKS` are the marks that change
 * which LETTER a character is (`ọ ẹ ṣ ị ụ ṅ`), and `TONE_MARKS` encode tone or length. Both are Igbo signals
 * in English prose for the same reason — an English sentence does not carry them — and a second copy of the
 * ranges here would be a second thing to keep in step with the orthography module.
 */
export const IGBO_MARK = /[\u0323\u0307\u0331\u0300-\u030f\u00e0-\u00e5\u00e8-\u00eb\u00ec-\u00ef\u00f2-\u00f6\u00f9-\u00fc\u1ecb\u1ecd\u1ee5\u1e45\u1e47\u1e63]/i;

/** Whether a spelling carries a mark no English word has. */
export function hasIgboMark(token: string): boolean {
  return IGBO_MARK.test(token);
}

/**
 * The Igbo headwords that are also ordinary English words — the 165 forms that made the dictionary signal
 * unusable on its own.
 *
 * HOW THIS WAS PRODUCED, SO IT CAN BE PRODUCED AGAIN
 *
 *   node scripts/igbo-collisions.mjs          # prints the list and the counts
 *
 * It intersects the dictionary's published `ibo` headwords with the system word list
 * (`/usr/share/dict/words`, 234,456 entries on the machine this was taken from), keeping only clean
 * single-token forms of two characters or more. Taken 2026-10-03 against the cluster that holds 8,728
 * published Igbo words: **1,939 clean folded forms, of which 165 are also English.**
 *
 * WHY A STATIC LIST IS RIGHT HERE AND WRONG FOR THE DICTIONARY
 *
 * The owner's rule is that the dictionary lookup must query ozituma rather than a list, "a list would be
 * stale within a week" — and that is obeyed: `buildWordIndex` reads `word` on every run. **This list is a
 * fact about English, not about the dictionary.** It says which spellings are ambiguous, and English does
 * not add a new collision with an Igbo headword every week. The failure mode if it does go stale is
 * bounded and stated: a newly-added Igbo headword that happens to be an English word would be treated as
 * English until this is regenerated — a miss, never a fabricated pronunciation, which is the direction to
 * fail in.
 */
export const ENGLISH_COLLISIONS: ReadonlySet<string> = new Set([
  'aa', 'aba', 'abo', 'abu', 'ada', 'ado', 'aga', 'agha', 'aha', 'aka', 'akala', 'ako', 'aku', 'ala', 'alo',
  'ama', 'amala', 'amani', 'amara', 'ame', 'ami', 'ana', 'ani', 'apa', 'araba', 'aro', 'atom', 'awa', 'baa',
  'be', 'bed', 'bit', 'bu', 'cell', 'cham', 'chart', 'chi', 'chick', 'danda', 'dee', 'dere', 'desert', 'di',
  'dike', 'dobe', 'dollar', 'dum', 'edo', 'egbo', 'ego', 'eke', 'electric', 'eme', 'engine', 'english',
  'equate', 'ere', 'fa', 'fig', 'free', 'fu', 'ga', 'gas', 'gi', 'ha', 'hausa', 'hear', 'hu', 'iba', 'ice',
  'icho', 'ide', 'ido', 'ife', 'ike', 'imi', 'ino', 'iso', 'ita', 'itali', 'ito', 'ji', 'ju', 'ka', 'koso',
  'li', 'ma', 'map', 'mara', 'mere', 'mile', 'mix', 'mu', 'music', 'na', 'neese', 'nu', 'nye', 'obe', 'obi',
  'oda', 'odum', 'ofo', 'ohia', 'oka', 'ona', 'ora', 'ose', 'oto', 'oxygen', 'papa', 'pitch', 'pom',
  'populate', 'post', 'proverb', 'puku', 'quart', 'quotient', 'saa', 'sam', 'samba', 'search', 'set', 'si',
  'sisi', 'site', 'size', 'snow', 'so', 'song', 'square', 'suffix', 'sugar', 'susu', 'ta', 'tara', 'tie',
  'titi', 'top', 'triangle', 'tube', 'tutu', 'ubi', 'udi', 'udo', 'uke', 'ula', 'ule', 'ulu', 'ululu', 'ume',
  'umu', 'una', 'unit', 'ura', 'uru', 'uta', 'ute', 'utu', 'wee', 'were', 'wheel', 'woo', 'ya',
]);

/**
 * Morphemes that build Igbo names and compounds, used ONLY as a last resort after the dictionary has been
 * asked.
 *
 * This is the one place the module holds Igbo knowledge of its own, and it is deliberately tiny and
 * productive: `ụmụ` (children of) heads a large family of place and kindred names — Umuazu, Umuahia,
 * Umudike, Umuoji — and `ndị` (the people of) heads another. **These are what let a place name the
 * dictionary does not hold still be recognised as Igbo rather than silently read in English.**
 *
 * Every one is a real published headword in the dictionary as well — measured, not assumed: `umu`,
 * `ndi`, `nwa`, `ora`, `ala`, `eze`, `obi`, `nne`, `nna`, `oke`, `anya`, `aka`, `ukwu`, `mba`, `di`, `na`
 * all resolve in `word`. They are listed here by their FOLDED form so a comparison against an unaccented
 * archive token needs no second fold, and the affix rule below still requires the REMAINDER to be a known
 * headword — a prefix on its own proves nothing.
 */
export const IGBO_MORPHEMES: ReadonlySet<string> = new Set([
  'umu', 'ndi', 'nwa', 'ora', 'ala', 'eze', 'obi', 'nne', 'nna', 'oke', 'anya', 'aka', 'ukwu', 'mba',
  'isi', 'nta', 'ime', 'ilo', 'ite', 'agha', 'agu', 'oji', 'aku', 'ndu', 'ife', 'chi', 'uwa', 'di',
]);

/** Where a token's classification came from. Ordered weakest-to-strongest for sorting; see `EVIDENCE_STRENGTH`. */
export type IgboEvidence =
  | 'diacritic'
  | 'phrase'
  | 'dictionary'
  | 'compound'
  | 'affix'
  | 'dictionary-english'
  | 'unknown';

/** How much each level is worth, for choosing the best evidence a word carries across occurrences. */
export const EVIDENCE_STRENGTH: Record<IgboEvidence, number> = {
  diacritic: 6,
  phrase: 5,
  dictionary: 4,
  compound: 3,
  affix: 2,
  'dictionary-english': 1,
  unknown: 0,
};

/** The levels that count as Igbo under the default policy. */
export const IGBO_BY_DEFAULT: ReadonlySet<IgboEvidence> = new Set<IgboEvidence>([
  'diacritic', 'phrase', 'dictionary', 'compound', 'affix',
]);

export type TokenClass = {
  /** The token as it appeared. */
  token: string;
  /** Its folded key — the same fold the dictionary stores, so `Ọdịnana` and `odinana` are one word. */
  folded: string;
  evidence: IgboEvidence;
  /** The pieces a `compound` or `affix` was built from, so the segmentation is inspectable. */
  pieces?: string[];
  /** Whether the default policy counts this token as Igbo. */
  igbo: boolean;
};

/**
 * What the finder needs to know about the dictionary, as an interface rather than a query.
 *
 * **The finder takes no `Db` and issues no SQL.** That is what makes it testable against a hand-written
 * index with no cluster, and it is why the classification rule below can be checked by reading one file.
 * `buildWordIndex` in `pronunciation.ts` is the only thing that knows how to fill this from ozituma.
 */
export interface WordIndex {
  /** Whether a folded form is a clean published Igbo headword. */
  has(folded: string): boolean;
  /** Whether a folded form is a clean headword that is ALSO an ordinary English word. */
  isEnglishCollision(folded: string): boolean;
  /** The longest-match segmentation into known pieces, or null. Never returns a single whole piece. */
  segment(folded: string): string[] | null;
  /**
   * Every multi-word headword, folded: `a malu afa ya`.
   *
   * **The whole phrase, and not a lookup from one token to a phrase containing it.** That mapping was the
   * first version of this and it was wrong in a way that would have cost the owner real money: it made every
   * token that appears in ANY of 1,882 multi-word headwords Igbo, so `be`, `or`, `one`, `from` and `do`
   * classified as Igbo, went to the dictionary, were not found, and landed in the queue asking a person to
   * record the English word "from". Measured on one record: 5 of 12 Igbo words found were English.
   *
   * A phrase is evidence only when it is actually IN the text. `findIgboWords` checks that, once, in one
   * pass — see `occurringPhraseTokens`.
   */
  phrases: ReadonlyMap<string, string>;
}

/** The fallback index: it knows only what is in this file. Used by the tests and for a dry classification. */
export function emptyIndex(): WordIndex {
  return {
    has: () => false,
    isEnglishCollision: (folded) => ENGLISH_COLLISIONS.has(folded),
    segment: () => null,
    phrases: new Map(),
  };
}

/**
 * The tokens of every multi-word headword that ACTUALLY OCCURS in this text.
 *
 * One pass over the phrases, not one pass per token, and the boundaries are real word boundaries: the text
 * is folded with the same `toSearchForm` the dictionary stores, then every run of non-letters becomes a
 * space, so `a malu afa ya,` still contains `a malu afa ya`. **Requiring the phrase to be present is what
 * makes the evidence worth anything** — see the note on `WordIndex.phrases` for the version of this that
 * did not, and the five English words it put in the queue.
 */
export function occurringPhraseTokens(
  text: string,
  index: WordIndex
): { tokens: Set<string>; phrases: string[] } {
  const haystack = ` ${toSearchForm(text).replace(/[^a-zŋ0-9]+/g, ' ').trim()} `;
  const tokens = new Set<string>();
  const phrases: string[] = [];
  for (const [folded, headword] of index.phrases) {
    if (!haystack.includes(` ${folded} `)) continue;
    phrases.push(headword);
    for (const token of folded.split(' ')) if (token.length >= 2) tokens.add(token);
  }
  return { tokens, phrases };
}

/**
 * Split text into candidate words.
 *
 * **Hyphens and internal apostrophes are kept**, because they are part of the word in this orthography:
 * `n'isi` and `de-be` are headwords in the dictionary, and splitting on the hyphen would turn one entry into
 * two tokens that match nothing. Leading and trailing punctuation is stripped.
 *
 * Digits are allowed inside a token so `1152-2` stays one token rather than becoming `2`, which the
 * dictionary would otherwise match as a headword.
 */
export function tokenizeForIgbo(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) ?? [];
}

/**
 * Strip the punctuation a token may still carry at its edges after tokenising.
 *
 * **The possessive is stripped deliberately, and it was a measured miss.** `Igbo’s`, `Eke’s` and `Ala’s` are
 * the same words as `Igbo`, `Eke` and `Ala`, but folding `Igbo’s` produces `igbo's`, which matches no
 * headword — so a finder that did not strip it reported the most frequent Igbo word in the archive as
 * `unknown` every time the article said "Igbo's". The apostrophe may be either character, because the
 * archive's own text uses the typographic one.
 */
function bare(token: string): string {
  return token
    .replace(/^[-'\u2019]+|[-'\u2019]+$/g, '')
    .replace(/['\u2019]s$/i, '');
}

/**
 * Classify one token.
 *
 * The order of the tests IS the rule, and it is ordered so the strongest evidence is found first and the
 * ambiguous case is never reached by a token that has something better.
 */
export function classifyToken(
  raw: string,
  index: WordIndex,
  occurring: ReadonlySet<string> = new Set()
): TokenClass {
  const token = bare(raw);
  const folded = toSearchForm(token);
  const base = { token, folded };

  // Nothing to look up. A single character is never narrated as an Igbo word, and the dictionary holds every
  // Igbo letter as a headword — `D`, `A`, `B`, `F`, `G`, `I`, `J`, `K`, `L`, `M`, `N`, `O`, `P`, `R` are all
  // rows — so length 1 is not merely useless, it is a guaranteed false positive.
  if (folded.length < 2) return { ...base, evidence: 'unknown', igbo: false };

  // 1. A mark English does not write. Certain.
  if (hasIgboMark(token)) return { ...base, evidence: 'diacritic', igbo: true };

  const known = index.has(folded);
  const collision = index.isEnglishCollision(folded);

  /*
   * 2. THE DICTIONARY, AND THE ENGLISH WORD IT MAY ALSO BE.
   *
   * This check comes BEFORE the phrase rule, and the order is the fix for a measured fault. `be` is an Igbo
   * headword AND the English verb, and it is also a token inside some multi-word headword — so a phrase rule
   * tried first claimed it as Igbo and the collision test never ran. **The strongest disqualifying evidence
   * has to be reached before the weakest qualifying evidence**, or the weak one wins by being asked first.
   */
  if (known && !collision) return { ...base, evidence: 'dictionary', igbo: true };
  if (collision) {
    // The honest answer to "the Igbo `were` or the English one?" — see the module header.
    return { ...base, evidence: 'dictionary-english', igbo: false };
  }

  // 3. A multi-word headword that is present in the text, and this token is part of it.
  if (occurring.has(folded)) return { ...base, evidence: 'phrase', igbo: true };

  // 4. DISSECTION: is every piece of it known? **This is the owner's own idea, applied to the token.**
  const pieces = index.segment(folded);
  if (pieces) return { ...base, evidence: 'compound', igbo: true, pieces };

  // 5. A productive morpheme plus a known stem. Reached only when the whole is not a headword, so a real
  //    entry is never overridden by a guess about how it is built.
  for (const morpheme of IGBO_MORPHEMES) {
    if (!folded.startsWith(morpheme)) continue;
    const rest = folded.slice(morpheme.length);
    if (rest.length >= 2 && index.has(rest)) {
      return { ...base, evidence: 'affix', igbo: true, pieces: [morpheme, rest] };
    }
  }

  return { ...base, evidence: 'unknown', igbo: false };
}

export type FoundWord = {
  /** The folded key — one entry per word however many spellings it appeared under. */
  folded: string;
  /** The most common spelling as the article wrote it, for display and for the queue row. */
  surface: string;
  evidence: IgboEvidence;
  pieces?: string[];
  /** How many times it occurs in the text. */
  count: number;
  /** Every distinct spelling seen, because `Ọdịnana` and `odinana` are one word and both must be shown. */
  spellings: string[];
};

export type FindResult = {
  /** The words the default policy calls Igbo, best evidence first, then by count. */
  igbo: FoundWord[];
  /** Igbo headwords that are also English words. Not counted as Igbo unless `includeAmbiguous`. */
  ambiguous: FoundWord[];
  /** Tokens that matched nothing. Counted so the recall cost is a number rather than a worry. */
  unknown: FoundWord[];
};

/**
 * Find every Igbo word in a piece of text.
 *
 * `includeAmbiguous` flips the one judgement this module cannot make from a token alone. It is off by
 * default and the ambiguous list is returned either way, so a caller that turns it on is doing so knowing
 * what it is accepting.
 */
export function findIgboWords(
  text: string,
  index: WordIndex,
  options: { includeAmbiguous?: boolean } = {}
): FindResult {
  const byFold = new Map<string, FoundWord>();
  const unknown = new Map<string, FoundWord>();
  // Computed once for the whole text, not once per token: with 1,882 phrases and a thousand tokens, asking
  // "does a phrase containing this token occur?" per token would be two million comparisons and the answer
  // would still be the loose one this replaced.
  const { tokens: occurring } = occurringPhraseTokens(text, index);

  for (const raw of tokenizeForIgbo(text)) {
    const classified = classifyToken(raw, index, occurring);
    if (classified.folded.length < 2) continue;

    if (classified.evidence === 'unknown') {
      const seen = unknown.get(classified.folded);
      if (seen) {
        seen.count += 1;
        if (!seen.spellings.includes(classified.token)) seen.spellings.push(classified.token);
      } else {
        unknown.set(classified.folded, {
          folded: classified.folded, surface: classified.token, evidence: 'unknown',
          count: 1, spellings: [classified.token],
        });
      }
      continue;
    }

    const seen = byFold.get(classified.folded);
    if (seen) {
      seen.count += 1;
      if (!seen.spellings.includes(classified.token)) seen.spellings.push(classified.token);
      // **The strongest evidence wins across occurrences.** A word that appears once accented and once bare is
      // Igbo, and recording only the first sighting would let an unaccented occurrence downgrade a certainty.
      if (EVIDENCE_STRENGTH[classified.evidence] > EVIDENCE_STRENGTH[seen.evidence]) {
        seen.evidence = classified.evidence;
        seen.surface = classified.token;
        if (classified.pieces) seen.pieces = classified.pieces;
      }
    } else {
      byFold.set(classified.folded, {
        folded: classified.folded, surface: classified.token, evidence: classified.evidence,
        ...(classified.pieces ? { pieces: classified.pieces } : {}),
        count: 1, spellings: [classified.token],
      });
    }
  }

  const rank = (a: FoundWord, b: FoundWord) =>
    b.count - a.count || EVIDENCE_STRENGTH[b.evidence] - EVIDENCE_STRENGTH[a.evidence] ||
    a.folded.localeCompare(b.folded);

  const found = [...byFold.values()].sort(rank);
  /*
   * THE AMBIGUOUS LIST IS RETURNED WHETHER OR NOT IT WAS ACCEPTED.
   *
   * The first version of this filtered it out when `includeAmbiguous` was false — so the caller that had NOT
   * opted in was the caller that most needed to see what it had declined, and the list came back empty while
   * the module doc promised it "either way". **An option that hides the decision it made is worse than no
   * option**, which is why the list is always built and only the `igbo` list depends on the flag.
   */
  const ambiguous = found.filter((w) => w.evidence === 'dictionary-english');
  const igbo = found.filter(
    (w) => w.evidence !== 'dictionary-english' ||
      // With `includeAmbiguous`, an ambiguous word joins the Igbo list but keeps its evidence, so nothing
      // downstream can present it as certain.
      Boolean(options.includeAmbiguous)
  );

  return { igbo, ambiguous, unknown: [...unknown.values()].sort(rank) };
}
