/**
 * Igbo name corpus importer — the owner's list and the web sources.
 *
 *   node packages/db/src/import/names-corpus.ts
 *
 * WHY THIS EXISTS ALONGSIDE names.ts
 *
 * `names.ts` imports a single 43-entry list posted by Nze (@nzemmili). The
 * owner's list here is that same corpus — Belụ̀ọ̀se, Kọ̀dì̀àna, Yagazie, Àkụ̀ànà,
 * Nwàndọ̀, Tàbànsi … — expanded to 669 entries and carrying the tone marks the
 * OCR of the original image could not. Where the two overlap, this importer's
 * row wins: it is the fuller and better-spelled version of the same material.
 * Names only the X list has are left alone.
 *
 * SOURCES AND PRECEDENCE
 *
 * Two kinds of input, merged by folded slug (`deriveForms().searchForm`):
 *
 *   owner/     the owner's own list, "Belụ̀ọ̀se / Belụ̀chì — If not for God."
 *   scraped/   JSON arrays from the sites the owner supplied
 *
 * The owner's list is authoritative: its spelling is the displayed name, and
 * its meaning is the meaning. A scraped site contributes a meaning only when
 * the owner's list has nothing for that name, and contributes variants and
 * extra sources on top. Nothing is inferred across sources — two names merge
 * only when their FOLDED forms are identical, so no relationship is invented.
 *
 * GENDER, FROM THE NAME'S OWN MORPHEMES
 *
 * Not from what a source calls the name. Sources label Chiamaka, Amarachi and
 * Chidinma "female" because girls are usually given them, which is a claim about
 * usage rather than about the name; the owner's correction was to drop that
 * basis entirely.
 *
 *   nwanyi (woman) -> female        nwoke (man)  -> male
 *   ada (daughter, as a prefix) -> female
 *   lolo (a titled woman) -> female
 *   ozo, eze, nze (the king, the titled man) -> male
 *
 * Otherwise unisex. `father` and `mother` are deliberately not signals, and
 * neither is a pronoun in the gloss: Afụ̀nwaèlòtànnà and Afụ̀nwaèlòtànne are
 * both unisex. See the pass below for why order matters where two meet.
 *
 * ORIGIN
 *
 * `person_name.origins` is where the name is BORNE, not where it was collected.
 * The owner rejected provenance in this column by name, so the values come from
 * the closed vocabulary in `@ozituma/core` and from the curated, evidenced lists
 * in `data/names/` — never from the source a row was scraped out of. Most names
 * carry no origin at all, and their entries show none.
 *
 * LICENCE
 *
 * The sites state no licence. They are imported with attribution recorded per
 * source — `source_id` on every row, and the source table behind it — on the
 * same basis as the X list: the owner has directed publication, the licence is
 * recorded as `unknown` rather than upgraded to something no site granted, and
 * the position is stated on /about#licensing. See docs/DATA-SOURCES.md.
 *
 * That record is deliberately NOT displayed on a name entry any more. The owner
 * asked for it off the page, and it was the wrong thing there anyway: it was
 * being rendered beside the meaning as though it were a fact about the name.
 * The licence obligation is satisfied by the record and by /about; what came off
 * is the per-entry presentation.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, genderFromName, slugify, type NameGenderBasis } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { loadCuratedNameData } from './name-regions.ts';
import { formatMs } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Gitignored source data; see docs/DATA-SOURCES.md. */
export const DEFAULT_NAMES_ROOT = resolve(HERE, '..', '..', '..', '..', 'data', 'sources', 'names');

/** Every source this importer can attribute to, keyed by the label in the data. */
const SOURCES: Record<
  string,
  { slug: string; name: string; url: string | null; attributionText: string }
> = {
  owner: {
    slug: 'owner-igbo-name-list',
    name: "The owner's list of Igbo names",
    url: null,
    attributionText:
      'A list of Igbo personal names with their meanings, contributed directly by the ' +
      'owner of Ozikoro and supplied with tone marks.',
  },
  'Adabekee': {
    slug: 'adabekee-igbo-names',
    name: 'Adabekee — Igbo names for your baby boy',
    url: 'https://adabekee.com/2021/05/21/igbo-names-for-your-baby-boy-and-their-meanings-no-chi-names/',
    attributionText: 'Igbo boys\u2019 names and meanings, collected by Adabekee.',
  },
  'Legit.ng': {
    slug: 'legit-ng-igbo-names',
    name: 'Legit.ng — Top Igbo names for boys and their meanings',
    url: 'https://www.legit.ng/ask-legit/guides/1176217-top-igbo-names-boys-meaning/',
    attributionText: 'Igbo names and their meanings, published by Legit.ng.',
  },
  'Maternity Nest': {
    slug: 'maternity-nest-igbo-names',
    name: 'Maternity Nest — Igbo names for boys',
    url: 'https://maternitynest.com/igbo-names-boys/',
    attributionText: 'Igbo boys\u2019 names and meanings, published by Maternity Nest.',
  },
  'Okwu ID': {
    slug: 'okwuid-igbo-names',
    name: 'Okwu ID — 43 unique Igbo names and their meanings',
    url: 'https://okwuid.com/2024/05/01/43-unique-igbo-names-and-their-meanings/',
    attributionText: 'Igbo names and their meanings, published by Okwu ID.',
  },
  'FunTimes Magazine': {
    slug: 'funtimes-igbo-names',
    name: 'FunTimes Magazine — Igbo names in the diaspora',
    url: 'https://funtimesmagazine.com/30-popular-igbo-names-in-the-diaspora-and-their-meanings/',
    attributionText: 'Igbo names and their meanings, published by FunTimes Magazine.',
  },
  'LinkedIn (Onyinye Favour Chibueze)': {
    slug: 'linkedin-igbo-names-chibueze',
    name: 'Onyinye Favour Chibueze — Igbo names and meaning, A\u2013Z',
    url: 'https://www.linkedin.com/pulse/igbo-names-meaning-a-zcomplied-onyinye-favour-chibueze-/',
    attributionText:
      'An A\u2013Z compilation of Igbo names and meanings by Onyinye Favour Chibueze, on LinkedIn.',
  },
  'umuigbo.com': {
    slug: 'umuigbo-igbo-names',
    name: 'Umu Igbo — Igbo names',
    url: 'https://www.umuigbo.com/igbo-names',
    attributionText: 'Igbo names and their meanings, published by Umu Igbo.',
  },
  'Wikipedia': {
    slug: 'wikipedia-igbo-given-names',
    name: 'Wikipedia — Igbo given names',
    url: 'https://en.wikipedia.org/wiki/Category:Igbo_given_names',
    attributionText:
      'Igbo given names and their meanings from Wikipedia articles, under CC BY-SA 4.0.',
  },
  'behindthename.com': {
    slug: 'behindthename-igbo',
    name: 'Behind the Name — Igbo names',
    url: 'https://www.behindthename.com/names/usage/igbo',
    attributionText: 'Igbo names and their meanings, published by Behind the Name.',
  },
  'Nairaland': {
    slug: 'nairaland-igbo-names',
    name: 'Nairaland — 60 Igbo names and their meaning',
    url: 'https://www.nairaland.com/4511715/60-igbo-names-meaning',
    attributionText:
      'Igbo names and their meanings from a Nairaland forum compilation. ' +
      'Read through a real browser: the site answers a plain HTTP client with a ' +
      'Cloudflare challenge, so the first scraping pass could not see it at all.',
  },
  'behindthename.com (origin)': {
    slug: 'behindthename-igbo-origin',
    name: 'Behind the Name — Igbo origin names',
    url: 'https://www.behindthename.com/names/origin/igbo',
    attributionText:
      'Igbo names and their meanings, published by Behind the Name.',
  },
  'behindthename.com (submitted)': {
    slug: 'behindthename-igbo-submitted',
    name: 'Behind the Name — submitted Igbo names',
    url: 'https://www.behindthename.com/submit/names/usage/igbo',
    attributionText:
      'Igbo names and meanings contributed by users of Behind the Name. The site ' +
      'states plainly that submitted entries are user-contributed and that the ' +
      'accuracy of their definitions cannot be guaranteed, so this source ranks ' +
      'last when several sources gloss the same name.',
  },
  'Nairaland (threads)': {
    slug: 'nairaland-thread-igbo-names',
    name: 'Nairaland — Igbo names threads',
    url: 'https://www.nairaland.com/2738702/igbos-let-us-interprete-some',
    attributionText:
      'Names and meanings from Nairaland forum threads on Igbo names, including ' +
      'one on interpreting uncommon names. Forum contributions, not a compiled ' +
      'list: entries were taken only where the thread gives a plain gloss, and ' +
      'the ones that read as jokes were left out.',
  },
  'Awajis': {
    slug: 'awajis-igbo-names',
    name: 'Awajis — Igbo names and meaning',
    url: 'https://awajis.com/igbo-names-meaning/',
    attributionText: 'Igbo names and their meanings, published by Awajis.',
  },
  'Isokovibe': {
    slug: 'isokovibe-igbo-names',
    name: 'Isokovibe — Igbo names for boys and girls',
    url: 'https://isokovibe.com.ng/blog/200-beautiful-igbo-names-for-boys-and-girls-with-meanings/',
    attributionText: 'Igbo names and their meanings, published by Isokovibe.',
  },
  'myigboname.com': {
    slug: 'myigboname-igbo-names',
    name: 'My Igbo Name — Igbo names by meaning',
    url: 'https://myigboname.com/',
    attributionText: 'Igbo names grouped by meaning, published by My Igbo Name.',
  },
};

/**
 * Which source wins when two have a meaning for the same name. The owner's list
 * first, then the sites in the order the owner supplied them.
 */
const PRECEDENCE = [
  'owner',
  'myigboname.com',
  'umuigbo.com',
  'Nairaland',
  'Wikipedia',
  'behindthename.com',
  'behindthename.com (origin)',
  'Legit.ng',
  'Maternity Nest',
  'Okwu ID',
  'Adabekee',
  'FunTimes Magazine',
  'LinkedIn (Onyinye Favour Chibueze)',
  'behindthename.com (submitted)',
  'Nairaland (threads)',
  'Awajis',
  'Isokovibe',
];

interface Candidate {
  name: string;
  variants: string[];
  meaning: string | null;
  statedGender: string;
  sourceKey: string;
}

interface MergedName {
  display: string;
  searchForm: string;
  slug: string;
  meanings: string[];
  /**
   * Kept apart until the end. The owner's list is curated, so where it covers a
   * name its variants are the ones used; a scraper's variants are only reached
   * for names the owner's list does not have. Mixing them put Adaora under
   * Adaoha, which is a scraping mis-association rather than a variant.
   */
  ownerVariants: Set<string>;
  scrapedVariants: Set<string>;
  /**
   * Relationships a source states outright, e.g. "Variant of Jachike". Kept
   * apart from the scraped set because they are asserted rather than inferred,
   * so the guard that drops a variant which is itself a headword does not apply.
   */
  statedVariants: Set<string>;
  ownerCovered: boolean;
  /** Resolved from the two sets above, once every candidate has been merged. */
  variants: Set<string>;
  /** Set once, in the precedence pass below. */
  gender: string;
  /**
   * Which rule decided the gender. Recorded rather than discarded so the
   * integrity gate can check that every gendered name has a stated basis
   * instead of just trusting the importer.
   */
  genderBasis: NameGenderBasis;
  female: boolean;
  male: boolean;
  sources: Set<string>;
  /**
   * Where the name is borne, from the curated vocabulary. Empty is the normal
   * case and means unknown or pan-Igbo — the entry then shows no Origin.
   */
  origins: string[];
  /** The same name as the neighbouring varieties write it. */
  varietyForms: { form: string; variety: string }[];
}

/**
 * Trailing " —" left by a source splitting a name from its bracket, and the
 * trailing number behindthename.com appends to tell two names of the same
 * spelling apart ("Amara 1", "Amara 2"). The number is that site's index, not
 * part of the name, and carrying it in made six entries that were duplicates of
 * an entry already present. No Igbo name ends in a space and a digit, so the
 * strip is safe.
 */
function tidyName(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * An Igbo personal name is written as a single capitalised word.
 *
 * A source that gives "Eze ndi eze" or "Nkem ji aka" is giving the WORDS that
 * make up the name, so a reader can follow the meaning — the name itself is
 * Ezendieze, and Nkemjiaka. Every entry goes through here, so the display name,
 * the slug and the folded key all agree on that.
 *
 * Hyphens and apostrophes are left alone. Only the space is wrong.
 */
function oneWord(value: string): string {
  const squashed = value.replace(/\s+/g, '').trim();
  if (squashed.length === 0) return '';
  return squashed.charAt(0).toUpperCase() + squashed.slice(1);
}

/**
 * A name that arrived with its own alternates inside it.
 *
 * Some sources write "Chidimma / Chidinma" or "Chinualumogu - Chinua" in the
 * name column, which is two spellings of one name rather than one long one.
 * The first is the name; the rest are variants.
 */
function splitCompositeName(raw: string): { name: string; variants: string[] } {
  const parts = raw
    .split(/\s+\/\s*|\s+-\s+/)
    .map((p) => oneWord(p))
    .filter((p) => p.length > 0);
  const [first, ...rest] = parts;
  return { name: first ?? '', variants: rest };
}

/**
 * Variants a source states inside the gloss rather than in a variant column.
 *
 * "Jaachike — Variant of Jachike", "Chinonso — ... Also rendered as
 * Chinomso", "Chukwudebelu — ... A var. of Chidebelu". About eighty entries
 * carry a relationship like this in their text, and reading only the structured
 * variant column was throwing all of it away.
 *
 * This is the source asserting the relationship in prose, which is stronger
 * evidence than the heuristic that drops a "variant" that happens to be a
 * headword here — a scraper mis-associating a neighbouring column. So these
 * are kept even when the referenced spelling has an entry of its own.
 */
/** Words that are not names, capitalised or not, and must never become variants. */
const NOT_A_NAME = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'His', 'Her', 'Its', 'Their',
  'Name', 'Names', 'Same', 'Word', 'Words', 'Form', 'Forms', 'Two', 'One', 'Such',
  'Any', 'Common', 'Expression', 'Expressions', 'Sentence', 'Sentences',
]);

function variantsStatedInMeaning(meaning: string): string[] {
  const found: string[] = [];
  /*
   * THE KEYWORDS MAY BE CAPITALISED; THE NAME MAY NOT BE ASSUMED TO BE.
   *
   * These patterns used to carry the `i` flag, which made the `[A-Z]` that is
   * meant to say "a name follows" match any letter at all. So "A contraction of
   * the expression ..." recorded the variant `the` on Alamoke, and "short form of
   * the following names" did the same on eighteen other entries — the owner
   * found `the` listed as a variant of /names/alamoke and asked, reasonably,
   * whether anything delivered here had been read before it was published.
   *
   * Dropping the flag is not the fix, and that is worth recording: the keywords
   * are usually sentence-initial ("Short form of Chiamaka"), so a case-sensitive
   * pattern lost 59 real variants — Chiamaka, Chibuzo, Nkachinyere and the rest —
   * while removing the junk. The flags have to differ between the keyword and the
   * capture, which in JavaScript means spelling the alternation out in both cases
   * (`[Ss]hort`) and leaving `[A-Z]` strict.
   *
   * Measured against the corpus: this drops exactly the five junk captures
   * (`the`, `names`, `such`, `any`, `common`) and loses no name.
   */
  const patterns = [
    /\b[Vv]ariant of\s+([A-Z][\w\u0300-\u036f'’-]{2,29})/g,
    /\b[Vv]ar\.? of\s+([A-Z][\w\u0300-\u036f'’-]{2,29})/g,
    /\b[Aa]lso\s+(?:[Rr]endered|[Ss]pelled|[Ww]ritten|[Cc]alled)\s+as\s+([A-Z][\w\u0300-\u036f'’-]{2,29})/g,
    /\b(?:[Ss]hort|[Ss]hortened|[Dd]iminutive)\s+(?:[Ff]orm\s+)?(?:of|for)\s+([A-Z][\w\u0300-\u036f'’-]{2,29})/g,
    /\b[Cc]ontraction of\s+([A-Z][\w\u0300-\u036f'’-]{2,29})/g,
  ];
  for (const re of patterns) {
    for (const m of meaning.matchAll(re)) {
      const raw = m[1];
      if (!raw) continue;
      const name = raw.replace(/[.,;:]$/, '').trim();
      // A capital is necessary and not sufficient: "Short form of The name" would
      // still capture `The`, so the English words these sentences are made of are
      // refused outright.
      if (name.length >= 3 && !NOT_A_NAME.has(name)) found.push(name);
    }
  }
  return found;
}

/**
 * The key two spellings of the same name share.
 *
 * Folded, then stripped of everything that is not a letter, so that the spacing
 * and punctuation a source happens to use do not create a second entry:
 * "Chukwudalu" and "Chukwu Dalu", "Nkemjiaka" and "Nkem ji aka",
 * "Okika di gboo" and "Òkìkà dị̀gboò" are each one name.
 */
export function dedupeKey(searchForm: string): string {
  /*
   * l and r alternate between Igbo dialects for the same name: Ezebili and
   * Ezebiri, Anuli and Anuri, Ebele and Ebere, Chidiebele and Chidiebere. They
   * were separate entries here purely because they arrive from different
   * sources, and the owner reads them as one name. Folding them collapses each
   * pair into one entry carrying the other as a variant.
   */
  return searchForm.replace(/[^a-z]/g, '').replace(/l/g, 'r');
}

/**
 * The same key for a name that has not been through `deriveForms` yet.
 *
 * This exists because keying the curated region list on the RAW lowercased name
 * is not the same operation, and the difference is a real bug rather than a
 * subtlety: `[^a-z]` deletes `ị` from "Enyinnịa" (giving "enyinna") while
 * `deriveForms` maps it to `i` (giving "enyinnia"). The two spellings of
 * Enyinnịa and Enyinna therefore folded together on the curated side and stayed
 * apart on the corpus side, and one Ikwerre form was attached to two unrelated
 * entries. Deriving the search form first puts both sides through exactly the
 * same normalisation the rest of the importer uses.
 */
function curatedKey(name: string): string {
  return dedupeKey(deriveForms(name).searchForm);
}

function tidyMeaning(value: string): string {
  return value
    // Wikipedia leaves citation markers in the text it renders; they are not
    // part of a gloss.
    .replace(/\[\d+\]/g, '')
    /*
     * A slash-delimited pronunciation that leaked into a gloss — myigboname.com
     * renders "Leopard /Ágụ̀/ Creation; the human person", and the fragment
     * between the slashes is a tone-marked pronunciation. It is detected by the
     * combining marks rather than by the slashes alone, because a slash is also
     * how several entries correctly pair alternatives: "Way maker/path maker"
     * and "heart/mind" must survive.
     */
    .replace(/\s*\/[^/\s]*[\u0300-\u036f][^/\s]*\/\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ') ')
    .trim()
    .replace(/[.\s]+$/, '');
}

/** One line of the owner's list: "Name / Variant — meaning." */
function parseOwnerLine(line: string): Omit<Candidate, 'sourceKey'> | null {
  let s = line.replace(/^\s*\d+\.\s*/, '').replace(/\*\*/g, '').trim();
  if (s.length === 0) return null;

  // The separator is the first dash-ish or colon that introduces the meaning.
  // Skipped if it comes before any name text, which would make the line a
  // continuation rather than an entry.
  let cut = -1;
  let width = 0;
  for (const candidate of [' — ', ' – ', ' - ', ': ']) {
    const at = s.indexOf(candidate);
    if (at > 0) {
      cut = at;
      width = candidate.length;
      break;
    }
  }

  const namePart = cut === -1 ? s : s.slice(0, cut);
  const meaning = cut === -1 ? null : tidyMeaning(s.slice(cut + width));

  // A slash in the owner's list separates alternates; a space separates the
  // words that make up one name.
  const listed = namePart
    .split('/')
    .map(tidyName)
    .filter((p) => p.length > 0);
  const split = listed.map((part) => splitCompositeName(part));
  const first = split[0];
  if (!first || !first.name) return null;

  const variants = [
    ...first.variants,
    ...split.slice(1).flatMap((x) => [x.name, ...x.variants]),
  ].filter((v) => v && v !== first.name);

  return {
    name: first.name,
    variants: [...new Set(variants)],
    meaning: meaning && meaning.length > 0 ? meaning : null,
    statedGender: 'unisex',
  };
}

/**
 * A file this importer should read.
 *
 * The `._` prefix is excluded because macOS writes an AppleDouble sidecar next
 * to every file it puts in a tar, and that sidecar carries the same extension:
 * `._owner-list-01.txt` is not a list, it is a resource fork, and reading it
 * fails with EACCES. Transferring this data as an archive is the normal thing
 * to do, so the importer has to tolerate it rather than the uploader having to
 * remember to strip them.
 */
function isDataFile(extension: string): (name: string) => boolean {
  return (name) => name.endsWith(`.${extension}`) && !name.startsWith('._');
}

async function readOwnerList(root: string): Promise<Candidate[]> {
  const dir = join(root, 'owner');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(isDataFile('txt')).sort();
  } catch {
    return [];
  }

  const out: Candidate[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      const parsed = parseOwnerLine(line);
      if (parsed) out.push({ ...parsed, sourceKey: 'owner' });
    }
  }
  return out;
}

/**
 * Corrections the owner has stated outright.
 *
 * The gender rule and the variant guards are inferences from a name's shape and
 * from what sources say. This is neither: it is the owner telling us that Asanze
 * is a woman's name, and that Ezendieze is also written Ezendeze. It outranks
 * everything, which is the point — an inference that the owner has corrected
 * should not be able to win.
 *
 * Four keys, applied in this order:
 *
 *   gender    name -> 'male' | 'female' | 'unisex', with the basis recorded as
 *             'owner' so the gate can see a statement rather than a guess
 *   variants  name -> the spellings the owner says are the same name
 *   meanings  name -> the meaning the owner states, REPLACING what the sources
 *             said. Added 2026-09-27: a name's meaning is a sentence the owner
 *             may state outright, and four spellings of one name had drifted
 *             into three different meanings across three sources.
 *   groups    spellings the owner reads as ONE name, merged into the first.
 *             This only merges spellings that fold together (`Adannia` and
 *             `Adannịa`, or the Anuli group, where l/r folding makes all five
 *             one key), because the merge works on the folded key. Spellings
 *             that fold apart — `Adannaya` against `Adanna` — cannot be merged
 *             here; they stay separate entries and are held together by
 *             `meanings` and `variants` instead.
 *
 * As with every other key, a correction that matches no row does nothing, so
 * the importer reports the ones that matched nothing rather than leaving a
 * ruling looking as though it were in force.
 */
/**
 * The key a correction is matched on.
 *
 * Two things this has to get right, and the original code got both wrong in a
 * way nothing noticed until a correction was written for a name that has tone
 * marks:
 *
 *   1. `dedupeKey` expects a SEARCH FORM, not a name. Correcting `Asanze` worked
 *      because it has no diacritics; correcting `Òkèìlòlò` did not, because the
 *      marks survived into the key and nothing in the corpus is spelled that way.
 *      `deriveForms` is the function that turns a name into a search form, so it
 *      is applied here rather than assumed.
 *   2. The name may be written with a space — `Òkè ìlòlò` as the owner's list has
 *      it — where the corpus holds `Òkèìlòlò`, because the importer joins spaced
 *      names up in a LATER pass than this one. Matching on the spaced form would
 *      make a correction depend on what a previous run happened to have joined.
 *
 * Spaces carry no meaning in a name here, so they are not part of the key.
 */
export function correctionKey(value: string): string {
  return dedupeKey(deriveForms(value).searchForm).replace(/\s+/g, '');
}

async function readCorrections(root: string): Promise<{
  gender: Record<string, string>;
  variants: Record<string, string[]>;
  meanings: Record<string, string>;
  groups: string[][];
  renames: Record<string, string>;
}> {
  try {
    const raw = JSON.parse(await readFile(join(root, 'owner', 'owner-corrections.json'), 'utf8'));
    return {
      gender: raw.gender ?? {},
      variants: raw.variants ?? {},
      meanings: raw.meanings ?? {},
      groups: raw.groups ?? [],
      renames: raw.renames ?? {},
    };
  } catch {
    return { gender: {}, variants: {}, meanings: {}, groups: [], renames: {} };
  }
}

async function readScraped(root: string): Promise<Candidate[]> {
  const dir = join(root, 'scraped');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(isDataFile('json')).sort();
  } catch {
    return [];
  }

  const out: Candidate[] = [];
  for (const file of files) {
    const rows = JSON.parse(await readFile(join(dir, file), 'utf8')) as Array<{
      name?: string;
      meaning?: string | null;
      variants?: string[];
      gender?: string;
      sourceName?: string;
    }>;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const cleaned = tidyName(String(row.name ?? ''));
      if (cleaned.length === 0) continue;
      const composite = splitCompositeName(cleaned);
      const name = composite.name;
      if (name.length === 0) continue;
      const sourceKey = String(row.sourceName ?? '').trim();
      // An unknown label has no attribution to carry, so it is skipped rather
      // than attributed to the wrong site.
      if (!SOURCES[sourceKey]) continue;

      const meaning = row.meaning ? tidyMeaning(String(row.meaning)) : '';
      const gender = String(row.gender ?? 'unisex').toLowerCase();

      out.push({
        name,
        variants: [
          ...new Set([
            ...composite.variants,
            ...(row.variants ?? []).map((v) => splitCompositeName(tidyName(v)).name),
          ]),
        ].filter((v) => v && v !== name),
        meaning: meaning.length > 0 ? meaning : null,
        statedGender: gender === 'male' || gender === 'female' ? gender : 'unisex',
        sourceKey,
      });
    }
  }
  return out;
}

export interface NameCorpusReport {
  candidates: number;
  ownerEntries: number;
  scrapedEntries: number;
  distinctNames: number;
  withVariants: number;
  byGender: Record<string, number>;
  bySource: Record<string, number>;
  durationMs: number;
}

export async function importNameCorpus(
  options: {
    root?: string;
    languageCode?: string;
    /** Where the curated origin and cross-variety lists live. */
    curatedDir?: string;
    log?: (m: string) => void;
  } = {}
): Promise<NameCorpusReport> {
  const started = Date.now();
  const root = options.root ?? DEFAULT_NAMES_ROOT;
  const languageCode = options.languageCode ?? 'ibo';
  const log = options.log ?? ((m: string) => console.log(m));

  const owner = await readOwnerList(root);
  const scraped = await readScraped(root);
  const candidates = [...owner, ...scraped];

  log(`  owner entries              ${owner.length}`);
  log(`  scraped entries            ${scraped.length}`);

  // ---- merge by folded slug ----
  const bySlug = new Map<string, MergedName>();
  let skippedNoMeaning = 0;

  for (const candidate of candidates) {
    if (!candidate.meaning) {
      // A name with no meaning anywhere is not yet an entry. Counted, not stored.
      skippedNoMeaning += 1;
      continue;
    }

    const forms = deriveForms(candidate.name);
    const slug = slugify(candidate.name).slice(0, 80);
    if (slug.length === 0) continue;

    let merged = bySlug.get(slug);
    if (!merged) {
      merged = {
        display: candidate.name,
        searchForm: forms.searchForm,
        slug,
        meanings: [],
        ownerVariants: new Set<string>(),
        scrapedVariants: new Set<string>(),
        statedVariants: new Set<string>(),
        ownerCovered: false,
        variants: new Set<string>(),
        gender: 'unisex',
        genderBasis: 'unisex',
        female: false,
        male: false,
        sources: new Set<string>(),
        origins: [],
        varietyForms: [],
      };
      bySlug.set(slug, merged);
    }

    // The owner's spelling is the displayed one; whoever arrives first among
    // the sites is the fallback.
    if (candidate.sourceKey === 'owner') {
      merged.ownerCovered = true;
      merged.display = candidate.name;
    } else if (merged.display === '' || !merged.ownerCovered) {
      merged.display = candidate.name;
    }

    const target = candidate.sourceKey === 'owner' ? merged.ownerVariants : merged.scrapedVariants;
    for (const variant of candidate.variants) {
      if (variant !== candidate.name) target.add(variant);
    }

    if (!merged.meanings.includes(candidate.meaning)) merged.meanings.push(candidate.meaning);
    for (const stated of variantsStatedInMeaning(candidate.meaning)) {
      if (stated !== candidate.name) merged.statedVariants.add(stated);
    }

    if (candidate.statedGender === 'female') merged.female = true;
    if (candidate.statedGender === 'male') merged.male = true;

    merged.sources.add(candidate.sourceKey);
  }

  /*
   * Collapse the spellings of one name into one entry.
   *
   * A name reaches this point under several slugs when sources disagree about
   * spacing or tone: Chukwudalu and "Chukwu Dalu", Nkemjiaka and "Nkem ji aka",
   * Okika di gboo and "Òkìkà dị̀gboò". Each pair was two entries for one name.
   *
   * The keeper is the owner's spelling where the owner's list covers the name,
   * because that spelling is curated and carries tone marks; failing that, the
   * spelling with the most tone marks, then the longer gloss, then the better
   * attested. Everything the other spelling carried — meanings, variants and
   * sources — is folded into the keeper, so nothing is lost by collapsing.
   */
  const marks = (value: string) => (value.match(/[\u0300-\u036f]/g) ?? []).length;
  const byKey = new Map<string, MergedName>();
  for (const row of bySlug.values()) {
    const key = dedupeKey(row.searchForm);
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    const score = (r: MergedName) =>
      (r.ownerCovered ? 1_000_000 : 0) +
      marks(r.display) * 1_000 +
      r.meanings.join(' ').length * 10 +
      r.sources.size;

    const keep = score(existing) >= score(row) ? existing : row;
    const drop = keep === existing ? row : existing;

    for (const meaning of drop.meanings) {
      if (!keep.meanings.includes(meaning)) keep.meanings.push(meaning);
    }
    for (const v of drop.ownerVariants) keep.ownerVariants.add(v);
    for (const v of drop.scrapedVariants) keep.scrapedVariants.add(v);
    for (const v of drop.statedVariants) keep.statedVariants.add(v);

    /*
     * The spelling that lost the collapse becomes a variant of the one that
     * survived. Without this the pair simply disappeared: Ezebili and Ezebiri
     * folded to one key, Ezebili won on the owner's spelling, and Ezebiri was
     * gone from the site entirely rather than showing as the dialect variant it
     * is.
     */
    if (drop.display !== keep.display) {
      keep.statedVariants.add(drop.display);
      for (const v of drop.ownerVariants) keep.statedVariants.add(v);
      for (const v of drop.scrapedVariants) keep.statedVariants.add(v);
    }
    for (const k of drop.sources) keep.sources.add(k);
    keep.ownerCovered = keep.ownerCovered || drop.ownerCovered;

    byKey.set(key, keep);
  }

  /*
   * One meaning per idea.
   *
   * Six sources phrase "King's daughter" six ways, and joining every one of them
   * produced "King's daughter; King's daughter (Princess); ..." on the page. A
   * meaning is dropped when it contains, or is contained by, one already kept:
   * the sources are saying the same thing at different lengths, and the first is
   * the one with the highest precedence. Two are kept at most, because a name
   * page is not a concordance.
   */
  const key = (m: string) => m.toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const row of byKey.values()) {
    const kept: string[] = [];
    for (const meaning of row.meanings) {
      const k = key(meaning);
      if (k.length === 0) continue;
      if (kept.some((other) => key(other).includes(k) || k.includes(key(other)))) continue;
      kept.push(meaning);
      if (kept.length === 2) break;
    }
    row.meanings = kept;
  }

  let rows = [...byKey.values()];

  // ---- gender, from the name's own morphemes ----
  /*
   * The rule lives in @ozituma/core as `genderFromName`, not here, because the
   * integrity gate has to apply the same rule and used to re-state it in SQL.
   * Two copies of a rule drift; this one cannot.
   *
   * What it decides, in its own words: nwanyi -> female, nwoke -> male, a name
   * beginning ada -> female, lolo -> female, ozo/eze/nze -> male, everything
   * else unisex — with the owner's word overruling any of it. Anything else
   * being unisex is why Akụnnịa, Amaogechukwu and the whole Am-/An-/Ch- run are
   * unisex, and why most of the corpus is.
   */
  for (const row of rows) {
    const decision = genderFromName(row.searchForm);
    row.gender = decision.gender;
    row.genderBasis = decision.basis;
  }

  const corrections = await readCorrections(root);

  /*
   * Spellings the owner reads as ONE name in different dialects are collapsed
   * here, before the other passes, so everything downstream sees a single entry.
   *
   * The l-to-r fold in dedupeKey already joins Anuli and Anuri. These groups go
   * further, because the set is wider than one consonant alternation: awuri and
   * anwuri carry a w that neither fold removes, and anwuli carries both. Only
   * the owner can say that Anuli, Anuri, Awuri, Anwuri and Anwuli are one name,
   * so it is stated rather than inferred.
   */
  const groupOf = new Map<string, MergedName>();
  const absorbing = new Map<string, string>();
  for (const group of corrections.groups) {
    const [head, ...members] = group;
    if (!head) continue;
    const headKey = dedupeKey(head.toLowerCase());
    const headRow = byKey.get(headKey);
    if (!headRow) continue;
    groupOf.set(headKey, headRow);
    /*
     * Every member is recorded as a variant of the head whether or not the
     * corpus holds an entry for it. Three of the five spellings the owner named
     * — Awuri, Anwuri, Anwuli — appear in no source at all, so a merge that only
     * absorbed existing rows would have recorded one variant of five and looked
     * like it had worked.
     */
    for (const member of members) {
      if (member !== head) headRow.statedVariants.add(member);
      absorbing.set(dedupeKey(member.toLowerCase()), headKey);
    }
  }
  for (const [memberKey, headKey] of absorbing) {
    const member = byKey.get(memberKey);
    const head = groupOf.get(headKey);
    if (!member || !head || member === head) continue;
    if (member.display !== head.display) head.statedVariants.add(member.display);
    if (member.display !== head.display) head.statedVariants.add(member.display);
    for (const v of member.ownerVariants) head.statedVariants.add(v);
    for (const v of member.scrapedVariants) head.statedVariants.add(v);
    for (const m of member.meanings) if (!head.meanings.includes(m)) head.meanings.push(m);
    for (const k of member.sources) head.sources.add(k);
    head.ownerCovered = head.ownerCovered || member.ownerCovered;
    byKey.delete(memberKey);
  }

  /*
   * Re-read the surviving set.
   *
   * `rows` was captured before the group merge above, and the merge removes
   * members from `byKey` — so any member that HAD survived to this point was
   * still sitting in the old array and would have been written as an entry of
   * its own, defeating the merge it had just been absorbed into. Nobody noticed
   * because the owner's Anuli group happened to be the only one, and three of
   * its five spellings appear in no source at all.
   *
   * Everything from here on — the corrections, the variant guards, the origins —
   * must see the merged set, so the array is refreshed rather than patched.
   */
  rows = [...byKey.values()];

  /*
   * Corrections are matched on the folded key, so "Asanze" finds the entry
   * however a source happened to spell it.
   *
   * This runs AFTER the morphology pass on purpose. Run before it, the
   * corrections were simply overwritten: "Asanze" contains nze, so the title
   * rule made it male again a few lines later and the owner's correction
   * vanished. An inference must not be able to overrule a stated fact.
   */
  let correctionsApplied = 0;
  let meaningsApplied = 0;
  let renamesApplied = 0;
  const matchedMeaningNames = new Set<string>();
  const matchedRenames = new Set<string>();
  for (const row of rows) {
    /*
     * Both sides go through dedupeKey. Folding only the correction side was a
     * real bug: "Elozonam" folds to "erozonam" because it contains an l, while
     * the row's key stayed "elozonam", so the correction for a name with an l in
     * it could never match. Asanze has no l, which is why only that one worked.
     */
    const key = correctionKey(row.searchForm);
    for (const [name, gender] of Object.entries(corrections.gender)) {
      const wanted = correctionKey(name);
      if (key === wanted && row.gender !== gender) {
        row.gender = gender;
        row.genderBasis = 'owner';
        correctionsApplied++;
      }
    }
    for (const [name, variants] of Object.entries(corrections.variants)) {
      if (key !== correctionKey(name)) continue;
      for (const v of variants) if (v !== row.display) row.statedVariants.add(v);
    }
    for (const [name, meaning] of Object.entries(corrections.meanings)) {
      if (key !== correctionKey(name)) continue;
      row.meanings = [meaning];
      meaningsApplied += 1;
      matchedMeaningNames.add(name);
    }
    /*
     * A rename corrects the ENTRY'S OWN spelling, not a relationship between
     * entries. "Ezeasor" was the headword and the owner says the name is
     * "Ezeaso": a source carried the anglicised form, so the entry was filed
     * under a spelling the name does not have. Setting the display name here,
     * before the script layer and the write, means the slug, the Ndebe value and
     * every page URL follow the corrected spelling rather than the old one.
     */
    for (const [from, to] of Object.entries(corrections.renames)) {
      if (key !== correctionKey(from)) continue;
      if (deriveForms(to).searchForm === row.searchForm) continue;
      row.display = to;
      row.searchForm = deriveForms(to).searchForm;
      row.slug = slugify(to).slice(0, 80);
      renamesApplied += 1;
      matchedRenames.add(from);
    }
  }
  if (renamesApplied > 0) log(`  owner renames applied             ${renamesApplied}`);
  const missedRenames = Object.keys(corrections.renames).filter(
    (name) => !matchedRenames.has(name)
  );
  if (missedRenames.length > 0) {
    log(`  ! renames matching no name        (${missedRenames.join(', ')})`);
  }
  if (correctionsApplied > 0) log(`  owner gender corrections applied  ${correctionsApplied}`);
  if (meaningsApplied > 0) log(`  owner meanings applied  ${meaningsApplied}`);

  /*
   * A meaning correction that matched nothing is reported loudly, not silently:
   * it is the owner's answer to something they read on a page, so if it matches
   * no row then either the spelling in the file is not the spelling in the
   * corpus, or the page they read is not built from this corpus. Either way the
   * ruling is doing nothing while looking as though it is in force.
   */
  const missedMeanings = Object.keys(corrections.meanings).filter(
    (name) => !matchedMeaningNames.has(name)
  );
  if (missedMeanings.length > 0) {
    log(`  ! meaning corrections matching no name  (${missedMeanings.join(', ')})`);
  }

  /*
   * Settle the variants.
   *
   * Where the owner's list covers a name, its variants are used as given. For a
   * scraper-only name the scraper's variants are all the evidence there is, but
   * one class of them is dropped: a "variant" that is itself a headword here
   * with a different meaning. Adaoha listing Adaora was that, and it is a
   * parsing slip on the source page, not a spelling variant.
   */
/**
 * Is this "variant" an English nickname rather than the name in another spelling?
 *
 * The owner, on finding `Chebby` listed under Achebe: "when adding name and its
 * variants, never you add anglicised names". He is right, and it is worth saying
 * why the sources carry them: a name's page on a baby-name site lists what people
 * CALL the bearer as well as how the name is written, so `Kelechi` arrives with
 * Kelly, KayKay, Kenny and KC beside it, and `Ozichukwu` with Ozzy.
 *
 * Those are not spellings of an Igbo name, they are English diminutives of it, and
 * this dictionary records the name. So they are dropped at the door rather than
 * cleaned up afterwards — the corpora are re-imported whenever a source is added,
 * and anything only removed in the database comes back.
 *
 * The marks are the ones that do not occur in Igbo spelling:
 *
 *   - q and x do not exist in the orthography, and c only ever appears in `ch`;
 *   - Igbo doubles m and n (mmiri, nne) and nothing else, so `bb`, `dd`, `ll`,
 *     `ss`, `zz` and the rest are English;
 *   - Igbo does not end a word in y;
 *   - and `ck`, `ph`, `wh` and the syllables `jay`, `cee`, `kay` are English.
 *
 * Deliberately NOT filtered: a final `-ie`, which the first version of this rule
 * treated as English and which cost real names — Madichie, Chiagozie, Anozie,
 * Chiemerie and Chukwuemerie are Igbo and end exactly that way.
 */
function anglicised(value: string): boolean {
  const v = value.toLowerCase();
  if (/[qx]/.test(v)) return true;
  if (/c(?!h)/.test(v)) return true;
  if (/ck|ph|wh/.test(v)) return true;
  if (/(bb|dd|ff|gg|kk|ll|pp|rr|ss|tt|vv|zz)/.test(v)) return true;
  if (/[^aeiou]y$/.test(v)) return true;
  if (/(jay|cee|kay)$/.test(v)) return true;
  return false;
}

  const headwords = new Set(rows.map((r) => r.slug));
  const droppedAnglicised: string[] = [];
  for (const row of rows) {
    const chosen = row.ownerCovered ? row.ownerVariants : row.scrapedVariants;
    const final = new Set<string>();
    for (const variant of chosen) {
      if (variant === row.display) continue;
      if (!row.ownerCovered && headwords.has(slugify(variant).slice(0, 80))) continue;
      final.add(variant);
    }
    // Stated relationships are added last and unconditionally: the source says
    // so, and this set is not subject to the headword guard above.
    for (const variant of row.statedVariants) {
      if (variant !== row.display) final.add(variant);
    }
    /*
     * And the anglicised ones go, from both sets. `Chebby` under Achebe was found
     * by the owner; there were 76 in total, including two that are not nicknames
     * at all but English words that leaked into a variant column from a gloss.
     */
    for (const variant of [...final]) {
      if (anglicised(variant)) {
        final.delete(variant);
        droppedAnglicised.push(`${row.display}: ${variant}`);
      }
    }
    row.variants = final;
  }

  if (droppedAnglicised.length > 0) {
    log(
      `  anglicised variants dropped ${droppedAnglicised.length}` +
        `  (e.g. ${droppedAnglicised.slice(0, 4).join(', ')})`
    );
  }

  /*
   * A renamed spelling has to be rewritten wherever it was listed as a variant,
   * or the old anglicised form survives as a link on other entries' pages — which
   * is where a reader would still meet it. Adunchezor was listed under Adinlofu
   * and Adinlofu under Adunchezor, and Echefu listed Adunchezor too; all three
   * become Adunchezo.
   *
   * This runs after the variants are settled because that is when the set is
   * final; running it earlier would leave the sets that feed it holding the old
   * spelling.
   */
  const renamePairs = Object.entries(corrections.renames)
    .filter(([from]) => matchedRenames.has(from))
    .map(([from, to]) => [from, to] as const);
  let referencesRewritten = 0;
  if (renamePairs.length > 0) {
    for (const row of rows) {
      for (const [from, to] of renamePairs) {
        if (row.variants.delete(from)) {
          if (to !== row.display) row.variants.add(to);
          referencesRewritten += 1;
        }
      }
    }
    if (referencesRewritten > 0) {
      log(`  references to renamed spellings  ${referencesRewritten}`);
    }
  }

  // ---- origin, and the forms the neighbouring varieties use ----
  /*
   * Both come from the curated, evidenced lists in `data/names/`, loaded through
   * the schema in `name-regions.ts`, which validates every value against the
   * closed vocabularies in @ozituma/core and THROWS rather than returning a
   * half-checked list.
   *
   * That validation is what enforces the owner's correction. A website or a
   * compiler's name reaching the origin column is the exact defect that was
   * reported, and a loud failure at import time is what makes it impossible
   * rather than merely discouraged. `verify` checks the same thing again from
   * the database side, because an importer is not the only thing that can write
   * a row.
   *
   * Matching goes through the importer's own folded key, so tone marks and
   * diacritics do not stop `Ọ̀binna` in the corpus matching `Obinna` in the file.
   */
  const curated = await loadCuratedNameData(options.curatedDir);

  const originsByKey = new Map<string, string[]>();
  for (const entry of curated.origins) {
    originsByKey.set(curatedKey(entry.name), [...entry.origins]);
  }

  const formsByKey = new Map<string, { form: string; variety: string }[]>();
  for (const entry of curated.varietyForms) {
    /*
     * A form that IS the name is not a form. Compared on the search form, which
     * ignores case, tone and letter-defining marks but — unlike `dedupeKey` —
     * does NOT fold l to r. Folding here was wrong: it made Okolo look like a
     * self-reference under Okoro, when the l/r alternation is precisely what
     * makes it the Anioma form rather than a duplicate.
     */
    if (deriveForms(entry.form).searchForm === deriveForms(entry.name).searchForm) {
      throw new Error(
        `name-regions: ${entry.name} lists itself as a ${entry.variety} form`
      );
    }
    const key = curatedKey(entry.name);
    formsByKey.set(key, [
      ...(formsByKey.get(key) ?? []),
      { form: entry.form, variety: entry.variety },
    ]);
  }

  let withOrigin = 0;
  let withVarietyForms = 0;
  const matchedOrigins = new Set<string>();
  const matchedForms = new Set<string>();

  for (const row of rows) {
    const key = dedupeKey(row.searchForm);

    const origins = originsByKey.get(key);
    if (origins) {
      row.origins = origins;
      matchedOrigins.add(key);
      withOrigin += 1;
    }

    const forms = formsByKey.get(key);
    if (forms) {
      row.varietyForms = forms;
      matchedForms.add(key);
      withVarietyForms += 1;
    }
  }

  log(`  names with a documented origin ${withOrigin}`);
  log(`  names with cross-variety forms ${withVarietyForms}`);

  /*
   * Curated entries that match nothing.
   *
   * This is a warning rather than a throw because both lists are allowed to run
   * ahead of the corpus, and deliberately do: the origin research covers the
   * anthroponym corpora of Afikpo, Nsukka, Ika and Etche, whose names come from
   * naming studies rather than from the baby-name pages this corpus was built
   * from. Hundreds of them are documented for a region and are simply not
   * entries here yet, so the list is a standing invite rather than a defect.
   *
   * It is capped, because "866 names did not match" printed in full is a wall of
   * text that hides the one line that matters.
   */
  const unmatched = [
    ...curated.origins.map((e) => e.name).filter((n) => !matchedOrigins.has(curatedKey(n))),
    ...curated.varietyForms.map((e) => e.name).filter((n) => !matchedForms.has(curatedKey(n))),
  ];
  const unmatchedNames = [...new Set(unmatched)];
  if (unmatchedNames.length > 0) {
    const shown = unmatchedNames.slice(0, 8).join(', ');
    log(
      `  curated but not yet in the corpus  ${unmatchedNames.length}` +
        `  (e.g. ${shown}${unmatchedNames.length > 8 ? ', …' : ''})`
    );
  }

  // ---- the sources ----
  const db = await getDb();
  const usedSources = new Set<string>();
  for (const row of rows) for (const key of row.sources) usedSources.add(key);

  const sourceIds = new Map<string, number>();
  for (const key of usedSources) {
    const spec = SOURCES[key];
    if (!spec) continue;
    const id = Number(
      (
        await db.one<{ id: string }>(
          `insert into source (slug, name, url, license_code, license_url,
                               attribution_text, citation, notes, retrieved_at)
           values ($1,$2,$3,'unknown',null,$4,null,$5, current_date)
           on conflict (slug) do update set
             name = excluded.name, url = excluded.url,
             attribution_text = excluded.attribution_text, notes = excluded.notes
           returning id`,
          [
            spec.slug,
            spec.name,
            spec.url,
            spec.attributionText,
            'No licence is stated on the source page. Imported with attribution at the ' +
              'owner\u2019s direction; the licence is recorded as unknown rather than asserted.',
          ]
        )
      )?.id
    );
    sourceIds.set(key, id);
  }

  // ---- write ----
  /*
   * Delete this importer's own rows for the language before writing, so the
   * result is exactly the corpus and nothing else. Upserting alone could not do
   * this: a row that the collapse above deliberately drops — a duplicate
   * spelling, or an "Amara 1" left by a tidier rule — would simply have stayed,
   * because nothing collided with it.
   *
   * Rows owned by the other name importer (the X list) are not in this set and
   * are not touched; the upsert decides those case by case.
   */
  const ourSourceIds = [...sourceIds.values()];
  if (ourSourceIds.length > 0) {
    const removed = await db.query(
      `delete from person_name where language_code = $1 and source_id = any($2::bigint[])`,
      [languageCode, ourSourceIds]
    );
    log(`  cleared this importer's own rows   ${removed.rowCount}`);
  }

  let written = 0;
  for (const row of rows) {
    // The meaning comes from the highest-precedence source that has one; any
    // further distinct meanings are kept after it, separated by a semicolon,
    // the same way names.ts merges a collision.
    const ordered = [...row.sources].sort(
      (a, b) => PRECEDENCE.indexOf(a) - PRECEDENCE.indexOf(b)
    );
    const primary = ordered[0] ?? 'owner';

    /*
     * No `notes`.
     *
     * This importer used to compose one — "Also attested in: Maternity Nest;
     * Okwu ID; …" — and the owner read it on the entry page and rejected it.
     * Which sites happened to list a name is not a fact about the name, and
     * presenting it beside the meaning invited a reader to treat it as one. The
     * column is gone from the schema; the licences still ride on `source_id`,
     * which is where provenance belongs.
     */
    const result = await db.query(
      /*
       * A full overwrite on slug collision, deliberately. The rows this can
       * collide with are the ones names.ts imported from the X list, and the
       * owner's list is that same corpus with the tone marks restored, so the
       * owner's row is the one that should survive. Names only the X list has
       * are not in this corpus and are never touched.
       *
       */
      `insert into person_name
         (language_code, name, search_form, slug, meaning, gender, gender_basis,
          variants, origins, variety_forms, source_id, external_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,null,'published')
       on conflict (language_code, slug) do update set
         name = excluded.name,
         search_form = excluded.search_form,
         meaning = excluded.meaning,
         gender = excluded.gender,
         gender_basis = excluded.gender_basis,
         status = 'published',
         source_id = excluded.source_id,
         -- Replaced, not unioned. Unioning made a re-run keep variants a
         -- corrected import had just dropped, so the importer was not
         -- idempotent: a bad variant survived every subsequent run.
         -- See the note in the MERGE above for how the set is chosen.
         variants = excluded.variants,
         -- Also replaced rather than merged. A curated origin that has been
         -- withdrawn must be able to leave, which a union could never express.
         origins = excluded.origins,
         variety_forms = excluded.variety_forms
       returning id`,
      [
        languageCode,
        row.display,
        row.searchForm,
        row.slug,
        row.meanings.join('; '),
        row.gender,
        row.genderBasis,
        [...row.variants],
        row.origins,
        JSON.stringify(row.varietyForms),
        sourceIds.get(primary) ?? null,
      ]
    );
    if (result.rowCount > 0) written += 1;
  }

  /*
   * Dedupe against rows this importer does not own.
   *
   * The collapse above only sees what this importer loaded. A row belonging to
   * the other name importer is invisible to it, and one duplicate survived
   * exactly that way: the X list's "Okika di gboo" beside this corpus's
   * "Òkìkà dị̀gboò", the same name spelled two ways.
   *
   * This runs AFTER the write, and it has to: it looks for foreign rows that
   * duplicate one of OURS, so ours have to exist first. Run before the insert
   * it matched nothing and silently did nothing.
   *
   * A foreign row with no counterpart here is left entirely alone.
   */
  if (ourSourceIds.length > 0) {
    const foreignDupes = await db.query(
      `delete from person_name p
        where p.language_code = $1
          and not (p.source_id = any($2::bigint[]))
          and exists (
            select 1 from person_name q
             where q.language_code = p.language_code
               and q.source_id = any($2::bigint[])
               and replace(regexp_replace(lower(q.search_form), '[^a-z]', '', 'g'), 'l', 'r')
                 = replace(regexp_replace(lower(p.search_form), '[^a-z]', '', 'g'), 'l', 'r')
          )`,
      [languageCode, ourSourceIds]
    );
    if (foreignDupes.rowCount > 0) {
      log(`  deleted duplicates owned by other sources  ${foreignDupes.rowCount}`);
    }

    /*
     * No name in the table may keep a space, including rows this importer does
     * not own. Two survived that way — the X list's "Osu uzo" and its
     * "Chinualumogu - Chinua" — because a spaced name is wrong wherever it came
     * from, and leaving them would show a reader two spellings of one name.
     *
     * Where the one-word form already exists, this row is the duplicate and
     * goes; otherwise it is corrected in place.
     */
    const spacedRows = await db.rows<{ id: string; name: string }>(
      `select id, name from person_name where language_code = $1 and name like '% %'`,
      [languageCode]
    );
    let joinedUp = 0;
    let droppedSpaced = 0;
    for (const row of spacedRows) {
      const squashed = oneWord(row.name);
      if (squashed.length === 0 || squashed === row.name) continue;
      const clash = await db.one<{ id: string }>(
        `select id from person_name where language_code = $1 and slug = $2 and id <> $3`,
        [languageCode, slugify(squashed).slice(0, 80), row.id]
      );
      if (clash) {
        await db.query(`delete from person_name where id = $1`, [row.id]);
        droppedSpaced++;
      } else {
        await db.query(
          `update person_name set name = $1, search_form = $2, slug = $3 where id = $4`,
          [squashed, deriveForms(squashed).searchForm, slugify(squashed).slice(0, 80), row.id]
        );
        joinedUp++;
      }
    }
    if (joinedUp > 0 || droppedSpaced > 0) {
      log(`  spaced names joined up / dropped  ${joinedUp} / ${droppedSpaced}`);
    }

    /*
     * The gender BASIS has to be right on rows this importer does not own.
     *
     * The rule is one rule for the whole table, held in @ozituma/core, and the
     * integrity gate checks every row against it. A row written by an older
     * importer carries a gender but no basis — `names.ts` writes neither
     * `gender_basis` nor anything to derive it from, so its rows would land on
     * the column's default and read as "gendered with no reason", failing the
     * gate for a reason that is not a defect.
     *
     * This does not overrule anyone: `genderFromName` is the same rule those
     * rows were written under, so this fills in the reason rather than changing
     * the answer. Where the two genuinely disagree the rule wins, because there
     * is no owner statement behind a foreign row — owner corrections apply to
     * rows this importer owns.
     */
    const foreignRows = await db.rows<{
      id: string;
      name: string;
      search_form: string;
      gender: string;
      gender_basis: string;
    }>(
      `select id, name, search_form, gender, gender_basis
         from person_name
        where language_code = $1 and (source_id is null or not (source_id = any($2::bigint[])))`,
      [languageCode, ourSourceIds]
    );

    let basisFilled = 0;
    let genderCorrected = 0;
    for (const row of foreignRows) {
      const expected = genderFromName(row.search_form);
      if (row.gender === expected.gender && row.gender_basis === expected.basis) continue;
      if (row.gender !== expected.gender) genderCorrected += 1;
      else basisFilled += 1;
      await db.query(
        `update person_name set gender = $1, gender_basis = $2 where id = $3`,
        [expected.gender, expected.basis, row.id]
      );
    }
    if (basisFilled > 0 || genderCorrected > 0) {
      log(`  reasons filled in / genders corrected  ${basisFilled} / ${genderCorrected}`);
    }
  }

  const byGender: Record<string, number> = {};
  for (const row of rows) byGender[row.gender] = (byGender[row.gender] ?? 0) + 1;

  const bySource: Record<string, number> = {};
  for (const key of usedSources) {
    const spec = SOURCES[key];
    if (spec) bySource[spec.slug] = rows.filter((r) => r.sources.has(key)).length;
  }

  log(`  merged into distinct names  ${rows.length}`);
  log(`  collapsed as duplicate spellings  ${bySlug.size - rows.length}`);
  log(`  skipped (no meaning)        ${skippedNoMeaning}`);
  log(`  with variants               ${rows.filter((r) => r.variants.size > 0).length}`);
  log(`  by gender                   ${JSON.stringify(byGender)}`);
  log(`  sources                     ${usedSources.size}`);

  return {
    candidates: candidates.length,
    ownerEntries: owner.length,
    scrapedEntries: scraped.length,
    distinctNames: rows.length,
    withVariants: rows.filter((r) => r.variants.size > 0).length,
    byGender,
    bySource,
    durationMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const report = await importNameCorpus();
  console.log();
  console.log(`  done in ${formatMs(report.durationMs)}`);
  await closeDb();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
