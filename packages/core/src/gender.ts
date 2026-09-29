/**
 * How an Igbo personal name is gendered.
 *
 * This is the owner's rule, stated more than once and in the end explicitly, and
 * it lives here rather than inside the name importer because TWO things have to
 * agree on it: the importer that decides a name's gender, and the integrity gate
 * that checks the decision. When the rule lived only in the importer, the gate
 * had to re-state it in SQL, and the two could disagree without anyone noticing.
 *
 * THE RULE
 *
 *   nwanyi (woman)            -> female
 *   nwoke  (man)              -> male
 *   ada    (daughter), prefix -> female
 *   lolo   (a titled woman)   -> female
 *   ozo, eze, nze (the king, the titled man) -> male
 *   anything else             -> unisex
 *
 * and the owner's own word overrides any of it.
 *
 * WHY IT IS ABOUT MORPHEMES AND NOT SOURCES
 *
 * Sources label Chiamaka, Amarachi and Chidinma "female" because girls are
 * usually given them. That is a claim about usage, not about the name, and the
 * owner's correction was to drop it as a basis entirely. `father` and `mother`
 * are not signals either — Afụ̀nwaèlòtànnà and Afụ̀nwaèlòtànne are both unisex,
 * as are Akụnnịa ("father's wealth") and Akụnnẹ ("mother's wealth").
 *
 * ORDER MATTERS WHERE TWO MORPHEMES MEET
 *
 * Ezenwanyi carries eze (male) and nwanyi (female) and is female: naming the
 * woman is the more specific statement. So nwanyi is tested before nwoke, and
 * both are tested before the title morphemes.
 *
 * THE TWO EXCEPTIONS THE OWNER NAMED
 *
 * Asanze and Adanze contain "nze" and are not the title: both are women's names.
 * Adanze falls out of the rule on its own, because the ada prefix is tested
 * first. Asanze does not, and is the reason the owner's word has to be able to
 * overrule the rule rather than merely refine it.
 */

export type NameGender = 'unisex' | 'male' | 'female';

export type NameGenderBasis =
  | 'unisex'
  | 'ada'
  | 'nwanyi'
  | 'nwoke'
  | 'lolo'
  | 'title'
  /** The owner stated this name's gender, and it overrules everything above. */
  | 'owner';

export interface NameGenderDecision {
  gender: NameGender;
  basis: NameGenderBasis;
}

/**
 * Gender a name from its search form.
 *
 * Takes the FOLDED form — lowercased, tone marks and letter marks stripped by
 * `deriveForms().searchForm` — because that is the key the rest of the corpus
 * already matches on, so `Ǹzè`, `nze` and `Nze` cannot disagree here.
 */
export function genderFromName(searchForm: string): NameGenderDecision {
  const f = searchForm;

  if (f.includes('nwanyi')) return { gender: 'female', basis: 'nwanyi' };
  if (f.includes('nwoke')) return { gender: 'male', basis: 'nwoke' };
  if (f.startsWith('ada')) return { gender: 'female', basis: 'ada' };
  if (f.includes('lolo')) return { gender: 'female', basis: 'lolo' };
  // The titled man: ozo, eze, nze. Matched anywhere, because these are compounds
  // — Amandianaeze carries eze at the end.
  if (/ozo|eze|nze/.test(f)) return { gender: 'male', basis: 'title' };

  return { gender: 'unisex', basis: 'unisex' };
}

/** The bases a stored row may carry, as a set for validation. */
export const NAME_GENDER_BASES: readonly NameGenderBasis[] = [
  'unisex',
  'ada',
  'nwanyi',
  'nwoke',
  'lolo',
  'title',
  'owner',
];
