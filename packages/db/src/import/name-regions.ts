/**
 * The curated name knowledge: where names are borne, and the forms they take in
 * the neighbouring varieties.
 *
 * DATA, AND WHY IT LIVES IN THE REPOSITORY
 *
 * Both lists are OUR knowledge rather than a scraped corpus, so they sit in
 * `data/names/` and are tracked in git, unlike everything under
 * `data/sources/`. Two things depend on that:
 *
 *   1. The owner rejected provenance in `Origin` outright. The rule that replaced
 *      it — Origin is the part of Igboland whose people bear the name — is only
 *      as good as the evidence behind each row, so every entry carries the
 *      source it rests on and this loader refuses to return an unevidenced one.
 *
 *   2. Blank beats wrong. A name is listed only when something says the name is
 *      used in that place. Names used across all of Igboland, and names nobody
 *      has documented regionally, are simply absent — the entry then shows no
 *      Origin, which is the correct answer rather than a gap to be filled.
 *
 * This module is the schema and the gate. The files are the data:
 *
 *   data/names/origins.json         name -> Igbo region(s), with sources
 *   data/names/variety-forms.json   name -> its form in another variety
 *
 * MATCHING
 *
 * Both lists are keyed by the Standard Igbo name and matched by the importer on
 * the same folded key it deduplicates on, so tone marks and diacritics do not
 * stop `Ọ̀binna` in the corpus matching `Obinna` here. The key is derived from
 * the search form rather than from the raw name, and that is not a detail: see
 * `curatedKey` in names-corpus.ts for the bug that came from getting it wrong.
 *
 * VALIDATION
 *
 * Every problem is collected and reported together rather than thrown on the
 * first, because a data file of a thousand rows is edited in bulk and failing
 * one typo at a time is no way to find out that a column shifted.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgboRegion, isIgboVariety } from '@ozituma/core';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Tracked curated data, unlike the gitignored corpora beside it. */
export const DEFAULT_CURATED_NAMES_DIR = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'names'
);

/** A region a name is documented as being borne in. */
export interface CuratedOrigin {
  /** Standard Igbo spelling. */
  name: string;
  /** Region codes from IGBO_REGIONS. At least one; empty is not a claim. */
  origins: string[];
  /** Where this is documented. Required — an unevidenced entry is a guess. */
  evidence: string[];
  /** What the source actually says, when it is worth quoting. */
  note?: string;
}

/**
 * A form the same name takes in a neighbouring Igbo variety.
 *
 * Distinct from a spelling variant, and the owner raised the distinction
 * directly: *Wike* is not a misspelling of *Nwike*, it is how Ikwerre writes the
 * same name. Recorded one row per form-per-variety so the pair is queryable; the
 * entry page groups them back together for reading.
 */
export interface CuratedVarietyForm {
  /** The Standard Igbo name the form belongs to. */
  name: string;
  /** The variety's own spelling. */
  form: string;
  /** One of IGBO_VARIETIES. */
  variety: string;
  /**
   * How strong the evidence is.
   *
   *   stated — a source says outright that the two forms are the same name
   *   listed — a source gives both forms with the same meaning but does not
   *            say they correspond
   */
  confidence: 'stated' | 'listed';
  evidence: string[];
  note?: string;
}

export interface CuratedNameData {
  origins: CuratedOrigin[];
  varietyForms: CuratedVarietyForm[];
}

const CONFIDENCES = new Set(['stated', 'listed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string')) return null;
  return value as string[];
}

async function readJson(path: string, problems: string[]): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    problems.push(
      `${path}: ${error instanceof Error ? error.message : String(error)}. ` +
        `These files are tracked in the repository, so a missing one means the ` +
        `checkout is incomplete rather than that there is nothing to load.`
    );
    return null;
  }
}

/**
 * Load and validate both curated lists.
 *
 * Throws with every problem it found. There is nothing useful a caller can do
 * with a half-validated origin list, because an unchecked origin is a claim
 * nobody has verified.
 */
export async function loadCuratedNameData(
  dir: string = DEFAULT_CURATED_NAMES_DIR
): Promise<CuratedNameData> {
  const problems: string[] = [];

  const originsDoc = await readJson(join(dir, 'origins.json'), problems);
  const formsDoc = await readJson(join(dir, 'variety-forms.json'), problems);

  const origins: CuratedOrigin[] = [];
  const varietyForms: CuratedVarietyForm[] = [];

  const originRows = isRecord(originsDoc) ? originsDoc.names : undefined;
  if (!Array.isArray(originRows)) {
    problems.push('origins.json: "names" is missing or is not an array');
  } else {
    const seen = new Set<string>();
    originRows.forEach((raw, index) => {
      const where = `origins.json[${index}]`;
      if (!isRecord(raw)) {
        problems.push(`${where}: not an object`);
        return;
      }
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (name.length === 0) {
        problems.push(`${where}: no name`);
        return;
      }
      const listed = strings(raw.origins);
      if (!listed || listed.length === 0) {
        problems.push(`${where} (${name}): no origins — an empty list is not a claim`);
        return;
      }
      const evidence = strings(raw.evidence);
      if (!evidence || evidence.length === 0) {
        problems.push(
          `${where} (${name}): no evidence. Every origin is a claim about where ` +
            `people are named something, so it needs a source.`
        );
        return;
      }
      for (const region of listed) {
        if (!isIgboRegion(region)) {
          problems.push(
            `${where} (${name}): "${region}" is not an Igbo region (see ` +
              `packages/core/src/regions.ts). Origin is where a name is BORNE, ` +
              `never where it was collected.`
          );
        }
      }
      if (seen.has(name)) problems.push(`${where} (${name}): listed twice`);
      seen.add(name);

      origins.push({
        name,
        origins: [...new Set(listed)],
        evidence,
        ...(typeof raw.note === 'string' && raw.note.length > 0 ? { note: raw.note } : {}),
      });
    });
  }

  const formRows = isRecord(formsDoc) ? formsDoc.forms : undefined;
  if (!Array.isArray(formRows)) {
    problems.push('variety-forms.json: "forms" is missing or is not an array');
  } else {
    const seen = new Set<string>();
    formRows.forEach((raw, index) => {
      const where = `variety-forms.json[${index}]`;
      if (!isRecord(raw)) {
        problems.push(`${where}: not an object`);
        return;
      }
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const form = typeof raw.form === 'string' ? raw.form.trim() : '';
      const variety = typeof raw.variety === 'string' ? raw.variety.trim() : '';
      const confidence = raw.confidence;

      if (name.length === 0 || form.length === 0) {
        problems.push(`${where}: needs both a name and a form`);
        return;
      }
      if (!isIgboVariety(variety)) {
        problems.push(`${where} (${name}): "${variety}" is not a recorded variety`);
      }
      if (typeof confidence !== 'string' || !CONFIDENCES.has(confidence)) {
        problems.push(`${where} (${name}): confidence must be "stated" or "listed"`);
      }
      const evidence = strings(raw.evidence);
      if (!evidence || evidence.length === 0) {
        problems.push(`${where} (${name} / ${form}): no evidence`);
        return;
      }
      const key = `${name}\u0000${form}\u0000${variety}`;
      if (seen.has(key)) {
        problems.push(`${where} (${name}): ${form} in ${variety} is listed twice`);
      }
      seen.add(key);

      varietyForms.push({
        name,
        form,
        variety,
        confidence: confidence === 'listed' ? 'listed' : 'stated',
        evidence,
        ...(typeof raw.note === 'string' && raw.note.length > 0 ? { note: raw.note } : {}),
      });
    });
  }

  if (problems.length > 0) {
    throw new Error(
      `The curated name data in ${dir} is not usable:\n  - ${problems.join('\n  - ')}`
    );
  }

  return { origins, varietyForms };
}
