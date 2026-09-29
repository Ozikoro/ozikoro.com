/**
 * Where a name is borne, and in which variety of Igbo.
 *
 * This module exists because of a correction from the owner, and the correction
 * is worth restating so nobody undoes it: the `Origin` on a name entry is NOT
 * provenance. It is not which site the name was collected from, not which
 * compiler's list it appeared in, and not a citation. It is the part of Igboland
 * whose people bear that name — Nsukka, Mbaise, Ngwa, Ikwerre, Anioma.
 *
 * Two consequences follow, and both are rules rather than preferences:
 *
 *   1. An origin is a closed vocabulary. Anything not in `IGBO_REGIONS` cannot
 *      be stored as an origin, which is what makes "no source name ever leaks
 *      into Origin" a check the integrity gate can actually run rather than a
 *      thing reviewers have to notice.
 *   2. Blank beats wrong. A name used across all of Igboland, or one whose
 *      regional concentration nobody has documented, carries no origin at all.
 *      The entry then shows no Origin field. That is the correct outcome, not a
 *      gap to be filled with a guess.
 *
 * `IGBO_VARIETIES` is the parallel vocabulary for cross-variety forms — the
 * Ikwerre *Wike* beside the Igbo *Nwike*, the Ohaji *Ovunda* beside *Obinna*.
 * Those are forms of a name in a neighbouring variety rather than spellings of
 * it in the same language, so they are recorded and displayed separately from
 * the plain spelling variants.
 */

export interface IgboRegionDef {
  /** Canonical value stored in `person_name.origins`. */
  code: string;
  /** What the entry page prints. */
  display: string;
  /** The wider area, for grouping and for sanity-checking the table. */
  area: string;
}

/**
 * The Igbo areas a name can be attributed to.
 *
 * Deliberately a curated list rather than every administrative ward in the
 * South-East: these are the divisions that Igbo people themselves use to say
 * where a name is from, and a larger list would invite precision that the
 * evidence does not have. State-level entries are here on purpose — a source
 * that only establishes "this name is Anambra" should be recordable as Anambra
 * rather than being stretched to a town.
 *
 * THE NAMES ARE IGBO, NOT THE COLONIAL RENDERINGS
 *
 * The owner on 2026-09-27: "every single part written 'Onitsha' in terms of
 * dialects must be changed to 'Onicha' the original spelling. no anglicised
 * spelling is allowed here." Six codes were anglicised and are now the Igbo
 * forms the project's own dialect table already uses — Onicha, Oka, Nsuka,
 * Owere, Ugwuta, Ikwere — spelled without tone marks and without dotted vowels,
 * which is the house rule this file already followed for names.
 *
 * Sources are a different matter and are NOT rewritten: a paper titled "A
 * Morpho-Semantic Analysis on Onitsha Personal Igbo Names" is quoted as printed,
 * because a citation that has been corrected is a citation that has been
 * falsified. The Igbo form is for our own labels.
 */
export const IGBO_REGIONS: readonly IgboRegionDef[] = [
  // Anambra State
  { code: 'Anambra', display: 'Anambra State', area: 'Anambra' },
  { code: 'Onicha', display: 'Onicha, Anambra State', area: 'Anambra' },
  { code: 'Nnewi', display: 'Nnewi, Anambra State', area: 'Anambra' },
  { code: 'Oka', display: 'Oka, Anambra State', area: 'Anambra' },
  { code: 'Idemili', display: 'Idemili, Anambra State', area: 'Anambra' },
  { code: 'Aguata', display: 'Aguata, Anambra State', area: 'Anambra' },
  { code: 'Ihiala', display: 'Ihiala, Anambra State', area: 'Anambra' },
  { code: 'Orumba', display: 'Orumba, Anambra State', area: 'Anambra' },

  // Enugu State
  { code: 'Enugu', display: 'Enugu State', area: 'Enugu' },
  { code: 'Nsuka', display: 'Nsuka, Enugu State', area: 'Enugu' },
  { code: 'Nkanu', display: 'Nkanu, Enugu State', area: 'Enugu' },
  { code: 'Awgu', display: 'Awgu, Enugu State', area: 'Enugu' },
  { code: 'Udi', display: 'Udi, Enugu State', area: 'Enugu' },
  { code: 'Oji River', display: 'Oji River, Enugu State', area: 'Enugu' },
  { code: 'Isi-Uzo', display: 'Isi-Uzo, Enugu State', area: 'Enugu' },

  // Ebonyi State
  { code: 'Ebonyi', display: 'Ebonyi State', area: 'Ebonyi' },
  { code: 'Abakaliki', display: 'Abakaliki, Ebonyi State', area: 'Ebonyi' },
  { code: 'Afikpo', display: 'Afikpo, Ebonyi State', area: 'Ebonyi' },
  { code: 'Ezza', display: 'Ezza, Ebonyi State', area: 'Ebonyi' },
  { code: 'Ikwo', display: 'Ikwo, Ebonyi State', area: 'Ebonyi' },
  { code: 'Izzi', display: 'Izzi, Ebonyi State', area: 'Ebonyi' },
  { code: 'Ohaozara', display: 'Ohaozara, Ebonyi State', area: 'Ebonyi' },
  { code: 'Ishielu', display: 'Ishielu, Ebonyi State', area: 'Ebonyi' },

  // Imo State
  { code: 'Imo', display: 'Imo State', area: 'Imo' },
  { code: 'Owere', display: 'Owere, Imo State', area: 'Imo' },
  { code: 'Mbaise', display: 'Mbaise, Imo State', area: 'Imo' },
  { code: 'Orlu', display: 'Orlu, Imo State', area: 'Imo' },
  { code: 'Okigwe', display: 'Okigwe, Imo State', area: 'Imo' },
  { code: 'Ohaji', display: 'Ohaji/Egbema, Imo State', area: 'Imo' },
  { code: 'Ugwuta', display: 'Ugwuta, Imo State', area: 'Imo' },
  { code: 'Ideato', display: 'Ideato, Imo State', area: 'Imo' },
  { code: 'Isu', display: 'Isu, Imo State', area: 'Imo' },

  // Abia State
  { code: 'Abia', display: 'Abia State', area: 'Abia' },
  { code: 'Ngwa', display: 'Ngwa, Abia State', area: 'Abia' },
  { code: 'Aro', display: 'Arochukwu, Abia State', area: 'Abia' },
  { code: 'Ohafia', display: 'Ohafia, Abia State', area: 'Abia' },
  { code: 'Abiriba', display: 'Abiriba, Abia State', area: 'Abia' },
  { code: 'Item', display: 'Item, Abia State', area: 'Abia' },
  { code: 'Isuikwuato', display: 'Isuikwuato, Abia State', area: 'Abia' },
  { code: 'Umuahia', display: 'Umuahia, Abia State', area: 'Abia' },
  { code: 'Ukwa', display: 'Ukwa, Abia State', area: 'Abia' },

  // Anioma — the Igbo of Delta State
  { code: 'Anioma', display: 'Anioma, Delta State', area: 'Anioma' },
  { code: 'Ika', display: 'Ika, Delta State', area: 'Anioma' },
  { code: 'Ukwuani', display: 'Ukwuani, Delta State', area: 'Anioma' },
  { code: 'Enuani', display: 'Enuani, Delta State', area: 'Anioma' },
  { code: 'Ndokwa', display: 'Ndokwa, Delta State', area: 'Anioma' },
  { code: 'Oshimili', display: 'Oshimili, Delta State', area: 'Anioma' },
  { code: 'Aniocha', display: 'Aniocha, Delta State', area: 'Anioma' },

  // Rivers State — the Igbo-family peoples of the north-east of the delta
  { code: 'Ikwere', display: 'Ikwere, Rivers State', area: 'Rivers' },
  { code: 'Etche', display: 'Etche, Rivers State', area: 'Rivers' },
  { code: 'Ogba', display: 'Ogba, Rivers State', area: 'Rivers' },
  { code: 'Ekpeye', display: 'Ekpeye, Rivers State', area: 'Rivers' },
  { code: 'Ndoni', display: 'Ndoni, Rivers State', area: 'Rivers' },
  { code: 'Ndoki', display: 'Ndoki, Abia and Rivers States', area: 'Rivers' },
];

const REGION_BY_CODE = new Map(IGBO_REGIONS.map((region) => [region.code, region]));

/**
 * Is this string a region we are allowed to attribute a name to?
 *
 * Case-sensitive on purpose: the vocabulary is data, and a near-miss such as
 * "nsukka" should fail the import loudly rather than being silently corrected
 * into a claim nobody made.
 */
export function isIgboRegion(value: string): boolean {
  return REGION_BY_CODE.has(value);
}

/**
 * What to print for a stored origin.
 *
 * Falls back to the stored value rather than throwing, so a row written before
 * the vocabulary changed still renders as something readable instead of taking
 * an entry page down. The integrity gate is where a stale value gets caught.
 */
export function regionDisplay(value: string): string {
  return REGION_BY_CODE.get(value)?.display ?? value;
}

/** Stored origins that are no longer in the vocabulary. */
export function unknownRegions(values: readonly string[]): string[] {
  return values.filter((value) => !isIgboRegion(value));
}

/**
 * The varieties a cross-variety form can be recorded in.
 *
 * These are the Igbo-family varieties that share names with Standard Igbo while
 * writing them differently — *Nwike* is Igbo, *Wike* is Ikwerre, and both say
 * the same thing. Kept apart from the region vocabulary because a form is
 * labelled by the variety that uses it, which is not always the area a name is
 * attributed to.
 */
export const IGBO_VARIETIES = [
  'Ikwerre',
  'Etche',
  'Ogba',
  'Egbema',
  'Ekpeye',
  'Ohaji',
  'Ndoki',
  'Ika',
  'Ukwuani',
  'Anioma',
] as const;

export type IgboVariety = (typeof IGBO_VARIETIES)[number];

const VARIETIES = new Set<string>(IGBO_VARIETIES);

export function isIgboVariety(value: string): boolean {
  return VARIETIES.has(value);
}
