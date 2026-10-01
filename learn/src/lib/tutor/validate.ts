/**
 * Language validation.
 *
 * WHAT THIS IS FOR
 *
 * The tutor generates the TEACHING. It must not generate the LANGUAGE. This layer is the check that
 * makes the distinction enforceable rather than a promise: before any target-language output is
 * presented to a learner, it is compared against what the corpus actually contains.
 *
 * NO GENERATED SENTENCE IS EVER CALLED VERIFIED
 *
 * This is the rule, and it is absolute. A sentence the model assembled may be perfectly good Igbo,
 * but "the corpus contains these words" is not "this sentence is correct Igbo", and only the first
 * is something Ozituma can evidence. So generated Igbo is labelled as generated, always, however
 * plausible it looks.
 *
 * WHAT IT CAN AND CANNOT CHECK
 *
 * It CAN check that every Igbo word in a sentence exists in the corpus, and it can say which are
 * missing. That is a real check and it catches the common failure — a model reaching for a word that
 * is not there.
 *
 * It CANNOT check grammar, agreement or tone. Nobody can, from this data: the corpus is a dictionary
 * of words and sentences, not a grammar. Saying a sentence is "grammatically correct" would be a
 * claim with no evidence behind it, which is exactly what this project refuses to do. So the layer
 * reports what it verified and is explicit about what it did not.
 */

import type { RetrievedEntry } from "./retrieval";

/** Igbo uses these letters; `q`, `x` and bare `c` do not occur outside the `ch` digraph. */
const IGBO_MARKS = /[ịọụẹṅ]|[\u0300-\u036f]/;

export interface ValidationResult {
  /** Tokens that carry Igbo diacritics and could be checked. */
  checked: string[];
  /** Those found in the corpus, by headword or inside a supplied example. */
  known: string[];
  /** Those NOT found. These are the invented ones. */
  unknown: string[];
  /** True when every Igbo token traced back to the corpus. */
  clean: boolean;
  /**
   * What a generated sentence may be called. Deliberately never `verified`.
   */
  basis: "corpus-words-only" | "contains-unverified-words" | "no-target-language";
}

/**
 * Build the set of Igbo strings the corpus supports.
 *
 * Headwords, tone-marked forms and the words inside every retrieved EXAMPLE. The examples matter:
 * they are the only place the corpus shows words in combination, so a sentence reusing their
 * vocabulary stays inside what is documented, while a sentence reaching beyond it does not.
 */
function supportedVocabulary(entries: readonly RetrievedEntry[]): Set<string> {
  const set = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    for (const token of s.toLowerCase().split(/\s+/)) {
      const w = token.replace(/[^\p{L}\p{M}]/gu, "");
      if (w) set.add(w);
    }
  };
  for (const e of entries) {
    add(e.headword);
    add(e.toneMarked);
    add(e.exampleIg);
  }
  return set;
}

/**
 * Validate target-language output against the retrieved evidence.
 *
 * Only tokens carrying an Igbo diacritic or dot-below vowel are treated as language claims. Flagging
 * every token would fill the result with English false positives and make the check useless — and an
 * unaccented word is ambiguous anyway, since `aka` and `aká` are different words written alike.
 */
export function validate(
  output: string,
  entries: readonly RetrievedEntry[]
): ValidationResult {
  const supported = supportedVocabulary(entries);

  const candidates = output
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{M}]/gu, ""))
    .filter((t) => t.length > 1 && IGBO_MARKS.test(t));

  const checked = [...new Set(candidates)];
  const known = checked.filter((t) => supported.has(t.toLowerCase()));
  const unknown = checked.filter((t) => !supported.has(t.toLowerCase()));

  return {
    checked,
    known,
    unknown,
    clean: unknown.length === 0,
    basis:
      checked.length === 0
        ? "no-target-language"
        : unknown.length === 0
          ? "corpus-words-only"
          : "contains-unverified-words",
  };
}

/** Remove unsupported tokens rather than showing them with a caveat — a caveat still teaches it. */
export function stripUnverified(output: string, unknown: readonly string[]): string {
  if (unknown.length === 0) return output;
  const bad = new Set(unknown.map((w) => w.toLowerCase()));
  return output
    .split(/\s+/)
    .map((t) => (bad.has(t.replace(/[^\p{L}\p{M}]/gu, "").toLowerCase()) ? "[unverified word removed]" : t))
    .join(" ");
}

/**
 * The label a piece of target-language output earns.
 *
 * THE DISTINCTION THAT MATTERS
 *
 * A word quoted from a verified entry is verified. A sentence the model BUILT from verified words is
 * not — the words are attested, the sentence is not. Collapsing those two into one tick would be the
 * single most misleading thing this feature could do, so they are labelled differently and the
 * second says plainly who assembled it.
 */
export function outputLabel(result: ValidationResult): string {
  switch (result.basis) {
    case "no-target-language":
      return "";
    case "corpus-words-only":
      return "✓ Every Igbo word above appears in the Ozituma corpus. Sentences assembled by the tutor are AI-generated teaching material, not verified language.";
    case "contains-unverified-words":
      return "⚠ Some Igbo words above are not in the Ozituma corpus and were removed. The tutor does not invent language.";
  }
}
