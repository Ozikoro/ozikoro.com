/**
 * Derive what the archive CAN know about a media item's provenance, and record it — naming the derivation.
 *
 * THE PROBLEM, MEASURED RATHER THAN REPEATED
 *
 * 3,488 media records were migrated from WordPress. Measured on the live cluster: `licence` is NULL on all
 * 3,488, `creator` is NULL on all 3,488, `credit` is NULL on all 3,488, and `ozikoro_media_rights` holds 0
 * rows. The archive has said "not recorded" on every page, which is the right default and not a licence.
 *
 * **A licence cannot be invented, and this script does not invent one.** But "no licence" and "nothing is
 * derivable" are different claims, and only the first one had been measured. Two sources of derivable
 * provenance exist and neither had been read:
 *
 *   1. **The file's own embedded rights metadata.** WordPress stores the EXIF/IPTC `image_meta` array inside
 *      `_wp_attachment_metadata`, and that array carries `credit` and `copyright` — the values the
 *      photographer or the agency wrote into the file itself. The import dropped the whole array, because
 *      the REST export the import used (`wp/v2/media`) does not expose `media_details`. So the archive has
 *      been holding files whose own credit line it never read.
 *   2. **The archive's own caption and description text.** A caption that says "Photo credit: Wikimedia
 *      commons" is a credit statement the archive has been serving and not recording.
 *
 * WHAT IT WRITES, AND WHERE
 *
 *   ozikoro_media.credit       the credit, verbatim, from whichever source named it
 *   ozikoro_media.licence      ONLY where the value is a licence the file itself names
 *   ozikoro_media.rights_note  the derivation: which field, which value, and what was read from it
 *   ozikoro_media_rights       a row, ONLY where a real licence was found — because a licence is the one
 *                              thing here that answers the rights question rather than restating it
 *
 * **A credit is not a licence and this script never turns one into the other.** "© Ashmolean Museum,
 * University of Oxford" is a rights holder; it grants nothing. It is recorded as a credit and a rights note,
 * with `licence` left NULL, because the honest answer to "what may we do with this?" is still "not recorded".
 *
 * THE RIGHTS ROW IT WRITES IS NOT A HUMAN CHECK
 *
 * `ozikoro_media_rights.checked_at` is what the work queue filters on, and this script leaves it **NULL**.
 * A derived licence is not a rights determination: the file says it is CC0, nobody has stood behind that,
 * and the queue must still ask. `allows_publication`/`allows_derivative`/`allows_commercial` are read from
 * the licence's own terms — CC0 permits all three, CC BY-NC forbids the third — and the note names the
 * derivation so a later reader can disagree with it in one place.
 *
 * WHAT IT REFUSES
 *
 * * It will not overwrite a value a person has already set. Every write is guarded on the column being NULL.
 * * It will not write a device default as a credit. Measured: of the 144 non-empty EXIF credits, 74 are the
 *   literal string "User pc" or "Picasa", and others are "CANON", "Hp", "SAMSUNG", "hwp5", "Z01". Those are
 *   what a camera or a scanning PC writes when nobody filled the field in. **Recording "User pc" as the
 *   archive's credit would be worse than recording nothing**, because it would be believed. The rejected
 *   values are counted and printed, so the rejection is a measurement rather than a preference.
 * * It will not read a credit out of prose without an explicit marker. A loose pattern over 1.5 million
 *   characters of caption produces things like "his wife and children", which is a phrase and not a credit.
 *
 * Usage:
 *   node scripts/derive-media-rights.ts                 # derive and WRITE
 *   node scripts/derive-media-rights.ts --dry-run       # measure and print, write nothing
 *
 *   OZITUMA_DB_PATH=.data/scratch/pg node scripts/derive-media-rights.ts --dry-run
 */
import { readFileSync, existsSync } from 'node:fs';
import { getDb, closeDb } from '@ozituma/db/client';

/** The dump phpMyAdmin produced. **Not** `ozikoro_ozikoro.sql` — the file is `ozikbfpe_ozikoro.sql`. */
const DEFAULT_DUMP = 'data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.sql';

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : 'true';
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};
const n = (value: number): string => value.toLocaleString('en-GB');

/* ------------------------------------------------------------------------------------------------
 * PHP serialize(), byte-exact.
 *
 * `s:12:"..."` counts BYTES, not characters. A character-based reader mis-slices on the first `©` or
 * `ụ` and then reports every later key as absent — which would have read 3,505 metadata rows and
 * silently lost the 52 that carry a `©`. This reads a Buffer.
 * ---------------------------------------------------------------------------------------------- */
type PhpValue = string | number | boolean | null | PhpValue[] | { [key: string]: PhpValue };

function phpUnserialize(buf: Buffer, at = 0): [PhpValue, number] {
  const type = String.fromCharCode(buf[at]);
  if (type === 'N') return [null, at + 2];
  if (type === 'b') {
    const end = buf.indexOf(0x3b, at);
    return [buf.subarray(at + 2, end).toString('ascii') === '1', end + 1];
  }
  if (type === 'i' || type === 'd') {
    const end = buf.indexOf(0x3b, at);
    const raw = buf.subarray(at + 2, end).toString('ascii');
    return [type === 'i' ? Number.parseInt(raw, 10) : Number.parseFloat(raw), end + 1];
  }
  if (type === 's') {
    const colon = buf.indexOf(0x3a, at + 1);
    const quote = buf.indexOf(0x22, colon);
    const length = Number.parseInt(buf.subarray(colon + 1, quote).toString('ascii'), 10);
    const start = quote + 1;
    return [buf.subarray(start, start + length).toString('utf8'), start + length + 2];
  }
  if (type === 'a') {
    const colon = buf.indexOf(0x3a, at + 1);
    const brace = buf.indexOf(0x7b, colon);
    const count = Number.parseInt(buf.subarray(colon + 1, brace).toString('ascii'), 10);
    let cursor = brace + 1;
    const out: { [key: string]: PhpValue } = {};
    for (let i = 0; i < count; i += 1) {
      const [key, afterKey] = phpUnserialize(buf, cursor);
      const [value, afterValue] = phpUnserialize(buf, afterKey);
      out[String(key)] = value;
      cursor = afterValue;
    }
    return [out, cursor + 1];
  }
  throw new Error(`phpUnserialize: unknown type ${JSON.stringify(type)} at byte ${at}`);
}

/* ------------------------------------------------------------------------------------------------
 * Reading the dump.
 *
 * The dump is phpMyAdmin's: one `INSERT INTO \`wpc9_postmeta\` ... VALUES (...),(...);` per batch, with
 * `\'`, `\"` and `\\` escapes. Only one meta_key is wanted, so rather than build a general SQL parser
 * this scans for that tuple's exact shape — and then CHECKS ITS OWN COUNT against the number of
 * `_wp_attached_file` rows, which the manifest records as 3,583. A scan that silently loses rows is
 * the failure this whole file exists to avoid, so it refuses to write if the counts disagree.
 * ---------------------------------------------------------------------------------------------- */
function unescapeSqlString(raw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(raw.length);
  let written = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== 0x5c) {
      out[written] = raw[i];
      written += 1;
      continue;
    }
    i += 1;
    const escaped = raw[i];
    const map: Record<number, number> = { 0x30: 0x00, 0x62: 0x08, 0x6e: 0x0a, 0x72: 0x0d, 0x5a: 0x1a };
    out[written] = map[escaped] ?? escaped;
    written += 1;
  }
  return out.subarray(0, written);
}

interface AttachmentMeta {
  id: number;
  credit: string | null;
  copyright: string | null;
  /** Every other non-empty image_meta field, kept so the report can name what else is derivable. */
  others: Record<string, string>;
}

function readDump(path: string): {
  meta: AttachmentMeta[];
  metadataRows: number;
  attachedFileRows: number;
  unparsed: number;
  bytes: number;
} {
  const buf = readFileSync(path);
  const meta: AttachmentMeta[] = [];
  let attachedFileRows = 0;
  let metadataRows = 0;
  let unparsed = 0;

  /*
   * `(meta_id, post_id, 'meta_key', 'meta_value')` — phpMyAdmin writes a space after each comma, and the
   * key is the THIRD column with `post_id` second. The first version of this pattern assumed no spaces and
   * the key second, matched nothing, and the self-check below caught it: a scan that finds 0 of 3,582 rows
   * reports "nothing is derivable", which is exactly the wrong answer and exactly the kind that looks fine.
   */
  const metaRe = /\(\d+,\s*(\d+),\s*'_wp_attachment_metadata',\s*'((?:[^'\\]|\\.)*)'\)/g;
  const fileRe = /\(\d+,\s*\d+,\s*'_wp_attached_file',\s*'(?:[^'\\]|\\.)*'\)/g;

  for (const match of buf.toString('latin1').matchAll(metaRe)) {
    metadataRows += 1;
    // The latin1 round trip is byte-preserving; re-read the captured span from the Buffer so the
    // lengths PHP wrote still count the same bytes.
    const raw = Buffer.from(match[2], 'latin1');
    let decoded: PhpValue;
    try {
      [decoded] = phpUnserialize(unescapeSqlString(raw));
    } catch {
      // COUNTED, never swallowed: a value this parser cannot read would otherwise look like a file with
      // no rights metadata, which is the same reading as a file that genuinely has none.
      unparsed += 1;
      continue;
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      unparsed += 1;
      continue;
    }
    const imageMeta = (decoded as { [key: string]: PhpValue }).image_meta;
    // 27 attachments genuinely carry no `image_meta` array; that is a fact about the file, not a failure.
    if (typeof imageMeta !== 'object' || imageMeta === null || Array.isArray(imageMeta)) continue;

    const flat = imageMeta as { [key: string]: PhpValue };
    const text = (key: string): string | null => {
      const value = flat[key];
      if (typeof value !== 'string') return null;
      const trimmed = value.replace(/\s+/g, ' ').trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    const others: Record<string, string> = {};
    for (const [key, value] of Object.entries(flat)) {
      if (key === 'credit' || key === 'copyright' || key === 'keywords') continue;
      const asText = text(key);
      if (asText && !/^\d+$/.test(asText) && asText !== '0') others[key] = asText;
    }
    meta.push({ id: Number(match[1]), credit: text('credit'), copyright: text('copyright'), others });
  }

  for (const _ of buf.toString('latin1').matchAll(fileRe)) attachedFileRows += 1;

  return { meta, metadataRows, attachedFileRows, unparsed, bytes: buf.length };
}

/* ------------------------------------------------------------------------------------------------
 * What counts as a credit, and what does not.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Values that a device or a piece of software writes when nobody filled the field in. Each one is here
 * because it was OBSERVED in this library with a count, not because it seemed unlikely.
 */
const DEVICE_DEFAULTS = new Map<string, string>([
  ['user pc', 'the Windows account name a scanning PC writes into the Artist tag — 66 files carry it'],
  ['picasa', 'Picasa writes its own name into Artist when it re-saves a file'],
  ['artist-freed', 'a phone camera firmware default'],
  ['canon', 'the camera make, not a photographer'],
  ['hp', 'the scanner make, not a photographer'],
  ['samsung', 'the camera make, not a photographer'],
  ['hwp5', 'a Hangul word-processor export tag'],
  ['z01', 'a scanner firmware default'],
  ['unknown', 'not a name'],
  ['copyright not specified', 'a statement that there is no statement'],
  ['copyright,spreadtrum,2011', 'a phone chipset firmware default'],
]);

function creditProblem(value: string): string | null {
  const folded = value.toLowerCase().replace(/[.\s]+$/g, '');
  const known = DEVICE_DEFAULTS.get(folded);
  if (known) return known;
  if (!/[a-z]/i.test(value)) return 'no letters — punctuation or digits only';
  if (/^\?+$/.test(value)) return 'unreadable characters';
  if (value.length < 3) return 'too short to be a name';
  if (value.length > 200) return 'longer than a credit line';
  return null;
}

/**
 * A licence is a named grant. Anything that is not one of these is a rights statement, not a licence, and
 * is recorded as one — the archive must not answer "what may we do?" with "© Ashmolean Museum".
 */
interface LicenceMatch {
  licence: string;
  url: string | null;
  allowsDerivative: boolean;
  allowsCommercial: boolean;
  /** An obligation the three booleans cannot carry, named so it is not lost. */
  obligation: string | null;
}

function licenceIn(value: string): LicenceMatch | null {
  const lower = value.toLowerCase();
  if (lower.includes('publicdomain/zero/1.0') || lower.includes('cc0')) {
    return {
      licence: 'CC0 1.0 Universal (Public Domain Dedication)',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      allowsDerivative: true,
      allowsCommercial: true,
      obligation: 'none — CC0 is a dedication, not a licence',
    };
  }
  if (/creativecommons\.org\/licenses\/by\/4\.0/.test(lower) || /\bcc by 4\.0\b/.test(lower)) {
    return {
      licence: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      allowsDerivative: true,
      allowsCommercial: true,
      obligation: 'attribution',
    };
  }
  if (/creativecommons\.org\/licenses\/by-sa\//.test(lower) || /\bcc by-sa\b/.test(lower)) {
    return {
      licence: 'Creative Commons Attribution-ShareAlike (CC BY-SA)',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      allowsDerivative: true,
      allowsCommercial: true,
      obligation: 'attribution, and ShareAlike on any adaptation',
    };
  }
  if (/creativecommons\.org\/licenses\/by-nc/.test(lower) || /\bcc by-nc\b/.test(lower)) {
    return {
      licence: 'Creative Commons Attribution-NonCommercial (CC BY-NC)',
      url: 'https://creativecommons.org/licenses/by-nc/4.0/',
      allowsDerivative: true,
      allowsCommercial: false,
      obligation: 'attribution, and no commercial use',
    };
  }
  return null;
}

/**
 * A public-domain statement is a rights basis rather than a licence document, but it is stated by the
 * record, so it is recorded — with the words that stated it kept in the note.
 *
 * **The NEGATION is why this is not a one-line substring test.** A copyright field in this library reads
 * "Rights to be cleared for artworks not in public domain. No model release." A substring test records
 * that as a public-domain statement and turns a warning into a permission, which is the exact class of
 * error this file exists to avoid.
 */
function statesPublicDomain(value: string): boolean {
  for (const match of value.matchAll(/\bpublic\s+domain\b/gi)) {
    const at = match.index ?? 0;
    const before = value.slice(Math.max(0, at - 40), at).toLowerCase();
    if (/\b(?:not|no|never|outside|nor)\b[^.]*$/.test(before)) continue;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * A credit read out of the archive's own caption or description text.
 *
 * ONLY with an explicit marker. The marker forms below are every one observed in this corpus; a looser
 * pattern ("… by <Word>") produced "his wife and children" and "ed with other photos from the Niger",
 * and a wrong credit is worse than an absent one because a reader believes it.
 * ---------------------------------------------------------------------------------------------- */
const CREDIT_MARKER =
  /(?:photo|picture|image|photograph)?\s*credits?\s*[;:]\s*([^\n]{2,160})|(?:^|\s)sources?\s*[;:]\s*([^\n]{2,160})|courtesy\s+of\s+([^\n]{2,160})|(©\s*[^\n]{2,160})/gi;

function textCredit(...fields: (string | null)[]): { value: string; marker: string; field: string } | null {
  const names = ['caption', 'description', 'alt_text'];
  for (let i = 0; i < fields.length; i += 1) {
    const raw = (fields[i] ?? '').replace(/<[^>]+>/g, ' ');
    if (!raw.trim()) continue;
    CREDIT_MARKER.lastIndex = 0;
    for (const match of raw.matchAll(CREDIT_MARKER)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s;:,.–-]+/, '')
        .replace(/[\s;:,.)\]]+$/, '')
        .trim();
      if (value.length < 3) continue;
      if (creditProblem(value)) continue;
      return { value, marker: match[0].replace(/\s+/g, ' ').trim(), field: names[i] ?? `field${i}` };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------------------------------- */
interface MediaRow {
  id: number;
  wp_media_id: number | null;
  kind: string;
  title: string | null;
  alt_text: string | null;
  caption: string | null;
  description: string | null;
  source_url: string | null;
  creator: string | null;
  credit: string | null;
  licence: string | null;
  rights_note: string | null;
}

interface Derivation {
  mediaId: number;
  credit: string | null;
  licence: LicenceMatch | null;
  publicDomain: boolean;
  note: string;
}

async function main(): Promise<number> {
  const dry = flag('dry-run');
  const dumpPath = arg('dump') ?? DEFAULT_DUMP;

  say('Deriving media rights from what the records themselves carry.');
  say(`  cluster: ${process.env.OZITUMA_DB_PATH ?? '(default .data/pg)'}`);
  say(`  dump:    ${dumpPath}`);
  say(`  mode:    ${dry ? 'DRY RUN — nothing will be written' : 'WRITE'}`);
  say();

  if (!existsSync(dumpPath)) {
    say(`The WordPress dump is not at ${dumpPath}.`);
    say('It is the only source for the embedded credit and copyright, so there is nothing to derive');
    say('without it. Point --dump at it. Nothing was written.');
    return 1;
  }

  const { meta, metadataRows, attachedFileRows, unparsed, bytes } = readDump(dumpPath);
  say('The WordPress dump, read now:');
  say(`  bytes read                           ${n(bytes)}`);
  say(`  _wp_attached_file rows               ${n(attachedFileRows)}`);
  say(`  _wp_attachment_metadata rows matched ${n(metadataRows)}`);
  say(`    of those, unserialised             ${n(metadataRows - unparsed)}${unparsed > 0 ? `, UNREADABLE ${n(unparsed)}` : ''}`);
  say(`    of those, carrying an image_meta   ${n(meta.length)}`);
  say();

  if (attachedFileRows !== 3583 || metadataRows !== 3582 || unparsed !== 0) {
    say(`REFUSING TO WRITE: the dump scan does not match the recorded shape of this dump.`);
    say(`  expected 3,583 _wp_attached_file and 3,582 _wp_attachment_metadata rows, all readable;`);
    say(`  read     ${n(attachedFileRows)}, ${n(metadataRows)}, with ${n(unparsed)} unreadable.`);
    say('A scan that loses rows is the fault this check exists to catch. Fix the scan, not this check.');
    return 1;
  }

  const byId = new Map<number, AttachmentMeta>();
  for (const row of meta) byId.set(row.id, row);

  const nonEmptyCredit = meta.filter((m) => m.credit).length;
  const nonEmptyCopyright = meta.filter((m) => m.copyright).length;
  const rejected = new Map<string, { count: number; why: string }>();
  for (const m of meta) {
    if (!m.credit) continue;
    const why = creditProblem(m.credit);
    if (!why) continue;
    const seen = rejected.get(m.credit);
    if (seen) seen.count += 1;
    else rejected.set(m.credit, { count: 1, why });
  }
  const rejectedCount = [...rejected.values()].reduce((sum, r) => sum + r.count, 0);

  say('Embedded rights metadata (EXIF/IPTC, inside _wp_attachment_metadata.image_meta):');
  say(`  attachments with a non-empty credit      ${n(nonEmptyCredit)}`);
  say(`    of those, a device/software default    ${n(rejectedCount)}   ← NOT a credit, see below`);
  say(`    of those, a named holder               ${n(nonEmptyCredit - rejectedCount)}`);
  say(`  attachments with a non-empty copyright   ${n(nonEmptyCopyright)}`);
  const otherFields = new Map<string, number>();
  for (const m of meta) for (const key of Object.keys(m.others)) otherFields.set(key, (otherFields.get(key) ?? 0) + 1);
  say(`  every other non-empty image_meta field   ${
    [...otherFields.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}=${c}`).join('  ') || '(none)'
  }`);
  if (rejected.size > 0) {
    say('  the values rejected as device or software defaults, with the reason:');
    for (const [value, info] of [...rejected.entries()].sort((a, b) => b[1].count - a[1].count)) {
      say(`    ${String(info.count).padStart(3)}×  ${JSON.stringify(value)} — ${info.why}`);
    }
  }
  say();

  const db = await getDb();
  const media = await db.rows<MediaRow>(
    `select id, wp_media_id, kind, title, alt_text, caption, description, source_url,
            creator, credit, licence, rights_note
       from ozikoro_media
      order by id`
  );
  const alreadyHasRightsRow = new Set(
    (await db.rows<{ media_id: number }>(`select media_id from ozikoro_media_rights`)).map((r) => Number(r.media_id))
  );
  const mediaById = new Map(media.map((row) => [row.id, row]));
  say(`Media records in the archive: ${n(media.length)}`);
  say(`  with a wp_media_id                 ${n(media.filter((m) => m.wp_media_id !== null).length)}`);
  say(`  whose WP attachment carries a credit    ${n(media.filter((m) => m.wp_media_id && byId.get(m.wp_media_id)?.credit).length)}`);
  say(`  whose WP attachment carries a copyright ${n(media.filter((m) => m.wp_media_id && byId.get(m.wp_media_id)?.copyright).length)}`);
  say();

  const derivations: Derivation[] = [];
  /** Every licence found, with the row and the words that stated it — so the owner can audit each one. */
  const licenceFindings: { mediaId: number; slug: string; licence: string; stated: string }[] = [];
  let fromExifCredit = 0;
  let fromExifCopyright = 0;
  let fromText = 0;
  let licenceCount = 0;
  let publicDomainCount = 0;
  const textValues = new Map<string, number>();

  for (const m of media) {
    const attachment = m.wp_media_id ? byId.get(m.wp_media_id) : undefined;
    const exifCredit = attachment?.credit ?? null;
    const exifCopyright = attachment?.copyright ?? null;

    let credit: string | null = null;
    let licence: LicenceMatch | null = null;
    let publicDomain = false;
    const parts: string[] = [];

    // 1. The file's own credit line. Rejected device defaults fall through to the text.
    if (exifCredit && !creditProblem(exifCredit)) {
      credit = exifCredit;
      fromExifCredit += 1;
      parts.push(`credit “${exifCredit}” read from the file's own embedded metadata (image_meta.credit in _wp_attachment_metadata), which the import did not carry over`);
    } else if (exifCredit) {
      parts.push(`the file's embedded credit field holds ${JSON.stringify(exifCredit)}, which is a device or software default and not a credit, so it is not recorded as one`);
    }

    // 2. The file's own copyright field: a licence if it names one, a rights statement otherwise.
    if (exifCopyright) {
      const found = licenceIn(exifCopyright);
      if (found) {
        licence = found;
        licenceCount += 1;
        licenceFindings.push({ mediaId: m.id, slug: m.title ?? String(m.id), licence: found.licence, stated: `image_meta.copyright: ${JSON.stringify(exifCopyright)}` });
        parts.push(`licence ${found.licence} read from the file's own embedded copyright field (image_meta.copyright), which states ${JSON.stringify(exifCopyright)}`);
      } else if (statesPublicDomain(exifCopyright)) {
        publicDomain = true;
        publicDomainCount += 1;
        parts.push(`the file's own embedded copyright field states ${JSON.stringify(exifCopyright)}, which is a public-domain statement rather than a licence document`);
      } else {
        fromExifCopyright += 1;
        if (!credit) credit = exifCopyright;
        parts.push(`the file's own embedded copyright field holds ${JSON.stringify(exifCopyright)} — a rights statement, not a licence, so no licence is recorded`);
      }
    }

    // 3. The archive's own text, only with an explicit marker and only if the EXIF gave nothing.
    if (!credit && !licence) {
      const text = textCredit(m.caption, m.description, m.alt_text);
      if (text) {
        const found = licenceIn(text.value);
        if (found) {
          licence = found;
          licenceCount += 1;
          licenceFindings.push({ mediaId: m.id, slug: m.title ?? String(m.id), licence: found.licence, stated: `${text.field}: ${JSON.stringify(text.marker)}` });
          parts.push(`licence ${found.licence} stated in the item's own ${text.field} text (${JSON.stringify(text.marker)})`);
        } else if (statesPublicDomain(text.value)) {
          publicDomain = true;
          publicDomainCount += 1;
          parts.push(`the item's own ${text.field} text states ${JSON.stringify(text.marker)} — a public-domain statement, not a licence document`);
        } else {
          credit = text.value;
          fromText += 1;
          textValues.set(text.value, (textValues.get(text.value) ?? 0) + 1);
          parts.push(`credit “${text.value}” read from the item's own ${text.field} text, which says ${JSON.stringify(text.marker)}`);
        }
      }
    }

    if (!credit && !licence && !publicDomain) continue;

    const note = `${parts.join('; ')}. Derived from the WordPress record, not established by a person: nobody has confirmed this.`;
    derivations.push({ mediaId: m.id, credit, licence, publicDomain, note });
  }

  say('WHAT IS DERIVABLE, MEASURED\n');
  say(`  a credit from the file's own metadata        ${n(fromExifCredit)}`);
  say(`  a rights statement from that metadata        ${n(fromExifCopyright)}`);
  say(`  a credit from the archive's own caption text ${n(fromText)}`);
  say(`  a NAMED LICENCE                              ${n(licenceCount)}   ← the first licences this archive has recorded`);
  say(`  a public-domain statement (no licence doc)   ${n(publicDomainCount)}`);
  say(`  items with something derivable               ${n(derivations.length)} of ${n(media.length)}`);
  say(`  items with NOTHING derivable                 ${n(media.length - derivations.length)}`);
  say();
  if (licenceFindings.length > 0) {
    say('  EVERY LICENCE FOUND, with the words that state it — this is the whole list, not a sample:');
    for (const f of licenceFindings) {
      say(`    media ${f.mediaId}  ${f.licence}`);
      say(`      stated by ${f.stated.slice(0, 220)}`);
    }
    say();
  }
  if (textValues.size > 0) {
    say('  the credits read out of caption text, by value:');
    for (const [value, count] of [...textValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      say(`    ${String(count).padStart(4)}×  ${JSON.stringify(value)}`);
    }
    if (textValues.size > 40) say(`    … and ${n(textValues.size - 40)} further distinct values`);
    say();
  }

  if (dry) {
    say('DRY RUN: nothing was written.');
    await closeDb();
    return 0;
  }

  let wroteMedia = 0;
  let wroteRights = 0;
  let skipped = 0;
  for (const d of derivations) {
    /*
     * IDEMPOTENT, INCLUDING THE AUDIT TRAIL.
     *
     * The first version of this loop wrote unconditionally. The `coalesce` in the UPDATE protected the
     * media columns and `on conflict do nothing` protected the rights row — **and nothing protected the
     * audit**, so running the script three times during verification left **183 audit rows for 61 items**.
     * An audit trail that records three derivations where one happened is not a record of what happened, and
     * the fault was found by reading the rows back rather than by trusting the summary line. The guard is the
     * test that anything WOULD change: `rights_note is null` is the first-time test for a derivation, and a
     * rights row is only written where there is not one already.
     */
    const rightsRowExists = alreadyHasRightsRow.has(d.mediaId);
    const current = mediaById.get(d.mediaId);
    const licenceValue = d.licence?.licence ?? (d.publicDomain ? 'Public domain (as stated by the record)' : null);
    const mediaNeedsWrite = current !== undefined && (
      (d.credit !== null && current.credit === null) ||
      (licenceValue !== null && current.licence === null) ||
      current.rights_note === null
    );
    if (!mediaNeedsWrite && (rightsRowExists || (!d.licence && !d.publicDomain))) {
      skipped += 1;
      continue;
    }
    // Never overwrite what a person has already set.
    await db.query(
      `update ozikoro_media
          set credit = coalesce(credit, $2),
              licence = coalesce(licence, $3),
              rights_note = coalesce(rights_note, $4),
              updated_at = now()
        where id = $1`,
      [d.mediaId, d.credit, licenceValue, d.note]
    );
    wroteMedia += 1;

    /*
     * A rights ROW only where a licence or a public-domain statement was found — the two cases that answer
     * "what may we do with this?" rather than restating who it came from. `checked_at` stays NULL: this is
     * a derivation, and the work queue must still ask a person.
     */
    if (!d.licence && !d.publicDomain) continue;

    // Counted on the INSERT, not on the attempt: `on conflict do nothing` means a re-run inserts nothing,
    // and a summary that counted attempts would report writes that did not happen.
    if (!rightsRowExists) {
      await db.query(
        `insert into ozikoro_media_rights
         (media_id, allows_publication, allows_derivative, allows_commercial, restricted,
          licence, licence_url, permission_basis, permission_note)
         values ($1, true, $2, $3, false, $4, $5, 'published_licence', $6)
         on conflict (media_id) do nothing`,
        [
          d.mediaId,
          d.licence ? d.licence.allowsDerivative : true,
          d.licence ? d.licence.allowsCommercial : true,
          licenceValue ?? 'Public domain (as stated by the record)',
          d.licence?.url ?? null,
          `${d.note} The permissions above are read from that licence's own terms${d.licence?.obligation ? `, whose condition is ${d.licence.obligation}` : ''}; they are not a human determination, and checked_at is deliberately left null.`,
        ]
      );
      wroteRights += 1;
    }

    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_media_rights', $1, 'derive_rights', null, $2::jsonb, null, $3)`,
      [
        d.mediaId,
        JSON.stringify({
          credit: d.credit,
          licence: d.licence?.licence ?? (d.publicDomain ? 'Public domain (as stated by the record)' : null),
          licenceUrl: d.licence?.url ?? null,
          basis: 'published_licence',
          derived: true,
          checked: false,
        }),
        d.note,
      ]
    );
  }

  /*
   * THE READ-BACK COUNTS FOUR DIFFERENT THINGS, AND AN EARLIER VERSION OF IT CONFLATED TWO OF THEM.
   *
   * It printed "items with a credit" and then called `media - credit` "the items that still carry nothing".
   * Measured after the first real run: 893 credits, but 954 items with a rights note — because **61 items
   * carry a licence or a public-domain statement and no credit at all.** So `media - credit` was 2,595 while
   * the number with nothing derivable is 2,534, and the wrong one was 61 too high. **A summary line that
   * measures something other than what it says is the same fault this file exists to avoid**, so the four
   * buckets are now counted separately and `nothing at all` is the complement of the union, not of one part.
   */
  const after = await db.one<{
    media: number; credit: number; licence_doc: number; public_domain: number; licence_any: number;
    notes: number; rights: number; checked: number;
  }>(
    `select (select count(*)::int from ozikoro_media) media,
            (select count(*)::int from ozikoro_media where credit is not null) credit,
            (select count(*)::int from ozikoro_media where licence is not null and licence not like 'Public domain%') licence_doc,
            (select count(*)::int from ozikoro_media where licence like 'Public domain%') public_domain,
            (select count(*)::int from ozikoro_media where licence is not null) licence_any,
            (select count(*)::int from ozikoro_media where rights_note is not null) notes,
            (select count(*)::int from ozikoro_media_rights) rights,
            (select count(*)::int from ozikoro_media_rights where checked_at is not null) checked`
  );

  const anything = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_media where credit is not null or licence is not null or rights_note is not null`
  );

  say(`Read back from the cluster (this run wrote ${n(wroteMedia)} media rows and ${n(wroteRights)} rights rows, and skipped ${n(skipped)} already recorded):`);
  say(`  ozikoro_media with a credit              ${n(after?.credit ?? 0)} of ${n(after?.media ?? 0)}`);
  say(`  ozikoro_media with a LICENCE DOCUMENT    ${n(after?.licence_doc ?? 0)}   ← CC0 and CC BY-SA, read from the record`);
  say(`  ozikoro_media stating public domain      ${n(after?.public_domain ?? 0)}   ← a statement, not a licence document`);
  say(`  ozikoro_media with a rights note         ${n(after?.notes ?? 0)}`);
  say(`  ozikoro_media with ANYTHING derivable    ${n(anything?.n ?? 0)}`);
  say(`  ozikoro_media with NOTHING derivable     ${n((after?.media ?? 0) - (anything?.n ?? 0))}   ← the queue`);
  say(`  ozikoro_media_rights rows                ${n(after?.rights ?? 0)}, of which a PERSON has checked ${n(after?.checked ?? 0)}`);
  say();
  say('  The last line is the one to read twice: every rights row this script writes has checked_at NULL,');
  say('  so the work queue still asks about all of them. A derived licence is not a rights determination.');
  await closeDb();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`\nderive-media-rights failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
