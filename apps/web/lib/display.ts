/**
 * How a headword is shown, as opposed to how it is stored.
 *
 * THE LEADING HYPHEN IS NOT PART OF THE WORD
 *
 * The vocabulary corpus marks a bound verb stem with a leading hyphen — `-ba`,
 * `-kwusi ike`, `-chi` — the way a grammar writes it, and 3,807 of our published
 * headwords carry one. A reader does not: they see `-kwusi ike` and ask the
 * obvious question, why is there a dash in front of the word.
 *
 * So the hyphen is stripped for display anywhere a person reads it, and kept in
 * the record. The reason it cannot simply be deleted from the data is that it is
 * load-bearing in three ways:
 *
 *   1. It separates different words. `-chi` is the verb, "block, close, fill";
 *      `chi` is the noun, the personal spirit. Strip both and the dictionary
 *      holds two entries with one headword and two unrelated meanings.
 *   2. The schema enforces one entry per headword per language, so 555 of the
 *      3,807 would collide — and on inspection the collisions are a mix of true
 *      duplicates (two sources imported the same verb twice, once with the
 *      marker) and genuinely different words like `-chi`/`chi`. Deciding which
 *      is which is deduplication work, not a text fix.
 *   3. It is the source's own notation. Deleting it loses the distinction and
 *      there is nothing to restore it from.
 *
 * The page shows `kwusi ike`, the URL is already `/word/igbo/kwusi-ike` because
 * slugs never carried the hyphen, and the record still knows the word is a stem.
 */

/** A headword as a reader should see it: without the corpus's stem marker. */
export function displayHeadword(headword: string): string {
  // Only the leading hyphen, and only when a word follows it: `-a/-e/-ọ/-o` keeps
  // its internal slashes, `-;kwakpọsị anya` loses the dash and the stray semicolon
  // is left where the source put it rather than tidied away out of sight.
  return headword.replace(/^-\s*/, '').trim();
}
