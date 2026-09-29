/**
 * The themes a proverb is filed under.
 *
 * The proverbs section filters by exactly these, and the eleven names are the
 * design's own — they are what the filter row shows, in this order, with "All"
 * in front of them. They live here rather than in the proverbs data file because
 * three things have to agree about them: the section that renders the filter, the
 * importer that writes `example.theme`, and the pass that reads a proverb and
 * decides which one it belongs to. A twelfth theme added in any one of those
 * places and not the others is a filter chip that returns nothing.
 *
 * A theme is a reading of the proverb, not a fact about it: the same saying can
 * be about patience and about humility at once, and it is filed under the one a
 * reader is most likely to look for it by.
 */
export const PROVERB_THEMES = [
  'Community',
  'Character',
  'Wisdom',
  'Determination',
  'Home',
  'Gratitude',
  'Memory',
  'Life',
  'Humility',
  'Responsibility',
] as const;

export type ProverbTheme = (typeof PROVERB_THEMES)[number];

/** Narrows a string from a query string to a theme, or null. */
export function asProverbTheme(value: string | null | undefined): ProverbTheme | null {
  if (!value) return null;
  return (PROVERB_THEMES as readonly string[]).includes(value) ? (value as ProverbTheme) : null;
}
