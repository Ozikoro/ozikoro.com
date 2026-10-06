/**
 * THE NAMED BACKERS — the one file the owner maintains by hand, and the rule for reading it.
 *
 * ── WHERE THE NAMES LIVE, AND WHY THERE RATHER THAN IN THIS PACKAGE ─────────────────────────────────
 *
 * `data/partners.json` at the repository root holds them. It is a plain JSON file the owner can open and add
 * one entry to, at the same level as the other `data/` files he already maintains, and **every field in it is
 * a field he can state himself**: a name, his own words for what the person is to Ozikoro, who stated it and
 * the date he stated it. This module reads that file; it does not hold a second copy of the names.
 *
 * The import is a static JSON import, so the values are bundled at build time. **That is the deliberate
 * choice over reading the file at request time**: the standalone server this site runs from has no
 * repository-root `data/` directory beside it, so a runtime `readFile` would not find the file on the host,
 * and a backer list that silently empties itself in production is the one failure mode worth trading a
 * rebuild for. A change to the file is therefore a change that ships with the next build, like every other
 * statement this site makes.
 *
 * ── WHAT IS IN THE FILE, AND WHAT IS NOT, AND WHY THAT IS THE POINT ─────────────────────────────────
 *
 * The owner's own words, verbatim, are recorded in the file's `source`, and they are TWO statements rather
 * than one:
 *
 *   *"please put 'Chigozie Aham' as an investor. he is our new investor who invested and got a share. he is
 *   our partner and funder"*
 *
 * and then, the same day, the correction that narrows it:
 *
 *   *"chigoziem aham is an partner, so remove the rest of the roles there"*
 *
 * **The second statement is the one in force, so the entry carries `partner` alone** — `investor` and
 * `funder` were his words and he took them back, and a role kept after he withdrew it would be this code
 * disagreeing with the owner about his own backer. **An amount, a percentage, a valuation, a date and a
 * company or title are NOT in this record, because he did not state any of them.**
 * `statedOn` is the date HE SAID IT — not an investment date, an agreement date or a payment date — and it is
 * named `statedOn` for that reason and labelled as such in every doc comment that touches it.
 *
 * **A rendering that wants a figure must not have one.** The page's existing stance — *"terms are agreed in
 * writing, and none has been agreed"* on the approach screens, and "not stated here rather than guessed at"
 * on the About page — is what the absence is rendered as. An absent field stays absent; it is never filled
 * with "undisclosed", "a substantial sum", "recently" or a placeholder.
 *
 * **Nothing here is drawn when the file holds nothing.** An empty `partners` array renders no heading, no
 * card and no sentence, so the pages stay exactly as honest as they were before a name was entered — see
 * `namedBackers`, which is the only door into the list.
 */
import partnersFile from '../../../data/partners.json' with { type: 'json' };

/**
 * The roles an entry may claim — the owner's own three words, and no others.
 *
 * **The vocabulary and the entry are two different things.** This list is what the owner has ever used for a
 * backer, so it is the widest set the code can stand behind; the entry in `data/partners.json` currently
 * claims `partner` alone, because that is what he last said. Narrowing the list to the roles in use would
 * make the next investor he names an unprintable entry, so the list stays as he has spoken it.
 *
 * A closed list rather than a free string because this vocabulary is read on a public page: an entry that
 * names a role the archive has no meaning for would be a title this code could not stand behind, and
 * `namedBackers` drops such an entry rather than printing it.
 */
export const BACKER_ROLES = ['investor', 'partner', 'funder'] as const;

export type BackerRole = (typeof BACKER_ROLES)[number];

/** One named backer, exactly as the owner stated them. */
export interface NamedBacker {
  /** `person` for an individual, `institution` for an organisation. */
  kind: 'person' | 'institution';
  /** The name as he gave it. There is no photograph, no biography and no title, because none was given. */
  name: string;
  /** His own words for what this person is to Ozikoro, filtered to the roles above. */
  roles: BackerRole[];
  /** Who stated this. The owner, by name. */
  statedBy: string;
  /**
   * ⚠️ THE DATE THE FACT WAS STATED, NOT A DATE ANYTHING HAPPENED.
   *
   * It is not an investment date, an agreement date or a payment date, and it must never be printed as one.
   * It exists so that a name can be traced to the statement that put it here; it is deliberately not
   * rendered on any page.
   */
  statedOn: string;
}

/** The owner's own words, kept beside the entries they are the source of. */
export const PARTNERS_SOURCE: string = typeof partnersFile.source === 'string' ? partnersFile.source : '';

/** What the file is, in the file's own words. */
export const PARTNERS_NOTE: string = typeof partnersFile.note === 'string' ? partnersFile.note : '';

/**
 * The backers the owner has stated, and **only** the entries this code can stand behind.
 *
 * An entry is dropped when its name is empty, when it claims no role from `BACKER_ROLES`, or when the
 * statement is not attributed — because each of those would put a name on a public page that the record does
 * not support. The array is empty when the file is empty, which is what leaves the pages unchanged.
 *
 * Validated once at module load rather than per render: the file is a static import and cannot change
 * between two renders in one process, and a public page is not the place to re-decide what a name means.
 */
export const namedBackers: readonly NamedBacker[] = ((): NamedBacker[] => {
  const raw = (partnersFile as { partners?: unknown }).partners;
  if (!Array.isArray(raw)) return [];
  const out: NamedBacker[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name.length === 0) continue;
    const roles = Array.isArray(row.roles)
      ? row.roles.filter((r): r is BackerRole => BACKER_ROLES.includes(r as BackerRole))
      : [];
    if (roles.length === 0) continue;
    const statedBy = typeof row.statedBy === 'string' ? row.statedBy.trim() : '';
    if (statedBy.length === 0) continue;
    out.push({
      kind: row.kind === 'institution' ? 'institution' : 'person',
      name,
      roles,
      statedBy,
      statedOn: typeof row.statedOn === 'string' ? row.statedOn.trim() : '',
    });
  }
  return out;
})();

/** Whether any backer is named at all — the gate every rendering goes through. */
export function anyBackersNamed(): boolean {
  return namedBackers.length > 0;
}
