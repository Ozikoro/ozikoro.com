/**
 * Put the owner's own recording on the article it belongs to, and record what the file is.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * The owner gave the archive a recording of himself reading the Ute-Okpu history, and it was used only as a
 * measuring stick: round 312 measured it against the synthetic render and found the render a third too fast,
 * and round 313 measured the noise bed in the render and found his floor 47.25 dB below it. **Neither round
 * put his file on the article.** So the article went on playing a narration he had already told us twice was
 * wrong, and the one file that is right — his — sat in an attachment directory.
 *
 * His question is the task: *"i gave you an audio record on ute okpu, which was the last audio, so why is it
 * on the ute okpu article you imported?"*
 *
 * ── WHAT THIS SCRIPT IS NOT ─────────────────────────────────────────────────────────────────────
 *
 * **It renders nothing and spends nothing.** It imports no ElevenLabs client, calls no API and touches no
 * credential. The whole charge is on the other path (`apps/ozikoro/lib/render-episode.ts`), and this one must
 * never be able to reach it. The bytes it stores are the owner's, read from disk.
 *
 * ── THE KEY, AND WHY IT IS A NEW ONE ────────────────────────────────────────────────────────────
 *
 * The obvious move is to put his file at `ozikoro/episodes/<slug>.mp3`, the key the renderer uses — and it is
 * the wrong move, for two reasons that are both already written down in this repository:
 *
 *   1. **That key is not free.** The synthetic render is still there, and `ozikoro_episode_revision` row 1
 *      names it by that key with its byte size and duration. Overwriting the file would leave the revision
 *      history pointing at an object with different bytes — the history would describe the human recording as
 *      the machine's render.
 *   2. **`app/media/[...key]/route.ts` serves every key `Cache-Control: public, max-age=31536000, immutable`,
 *      and the comment beside it says a key names one file and the file never changes.** Writing different
 *      bytes to the canonical key makes that header a lie at exactly the address most likely to be cached.
 *
 * So the recording gets a key that says what it is, `ozikoro/episodes/<slug>.owner-recording.mp3`, and the
 * generated file is left exactly where it is. **Nothing is overwritten and nothing is lost**, which is a
 * better answer than preserving the old bytes somewhere else after destroying them in place.
 *
 * ── WHY THE KEY IS CHECKED AGAINST THE ROUTE RATHER THAN ASSUMED ─────────────────────────────────
 *
 * This project has already shipped a file that was on disk, correctly named, in the table, and served a 404:
 * `app/media/[...key]/route.ts` refuses any key that does not match its own pattern. **A script that writes a
 * key the route will not serve is indistinguishable from one that worked**, so the pattern is read out of the
 * route file and the key is tested against the route's own expression. There is no second copy to drift.
 *
 * ── WHAT IT RECORDS, AND WHY EACH FIELD CHANGES ─────────────────────────────────────────────────
 *
 * `generator`/`generator_model`  the row said `elevenlabs` / `eleven_multilingual_v2`, which is what made the
 *                                old file and not what made this one. **A recording of a person is a different
 *                                kind, and the archive already has the word for it** — `human_recording` is the
 *                                value `ozikoro_pronunciation.kind` uses for a person's voice.
 * `narrator_kind`                `synthetic_own_voice` is a lie about a human file; `human` is a value the
 *                                column already allows (migration 0045) and `feed.xml` already handles.
 * `narrator_name`                `Idenze Ezeme (synthetic)` names a machine. The person is `Idenze Ezeme`.
 * `ai_disclosure`                it told the reader the audio was generated from a clone. For this file that
 *                                is false, and a false disclosure is worse than none: the archive's whole
 *                                credibility is that its disclosures are true. It is replaced by what the file
 *                                is, and it asserts only what is known — it does not claim the recording says
 *                                the article's words, because nothing here can check that.
 * `duration_seconds`             was 636, a prediction from a word count at 145 wpm (round 312: the row
 *                                showed 10m 36s for a file that played 8m 22s). It is now **measured** from the
 *                                new file's own frames by `mp3DurationSeconds`, which the file agrees with to
 *                                the millisecond, and `duration_source: 'measured'` says which kind of number
 *                                it is.
 * `char_count`/`estimated_credits`
 *                                were 9844 / null — the cost of the synthetic render, and round 313 showed the
 *                                script behind it was re-derived at restore time rather than recorded at
 *                                render time. **This file cost no characters at all**, so the row carries 0.
 *                                The 9,844 that were really spent are not deleted: they are in the audit row's
 *                                `before` and in revision 1, which is where the render that spent them lives.
 * `voice_choice`                 was `own`, the name of a synthetic voice selection, which a human recording
 *                                does not have. NULL is the honest value and the column allows it.
 * `script`/`transcript`          **left alone, and not evidence of anything.** Round 313 established that
 *                                `scripts/restore-episodes.ts` re-derived them from the article body at restore
 *                                time, so they are the article's spoken words rather than a record of what was
 *                                said. They stay because the transcript is what a listener who cannot hear the
 *                                audio reads, and the columns are NOT NULL for that reason — but nothing here
 *                                asserts the recording matches them.
 *
 * **No `ozikoro_episode_revision` row is written.** That table holds *renders* — its own invariant test reads
 * "a revision holding the exact script that was rendered" — and this file was not rendered from a script.
 * Inserting one beside the re-derived script would repeat the claim this whole change is careful not to make.
 * The change is recorded in `ozikoro_audit`, which is the table for "who changed what, and from what to what".
 *
 * Usage:
 *   node scripts/adopt-episode-recording.ts --check          # report what it would do, write nothing
 *   node scripts/adopt-episode-recording.ts --apply
 *   node scripts/adopt-episode-recording.ts --check --file /path/to/recording.mp3 --expect-sha <sha256>
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, getDb, type Db } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { mp3DurationSeconds } from '@ozikoro/platform';

/** The owner's account: `idenzeme@gmail.com`, role `owner`. The actor of the change, recorded on the audit row. */
const ACTOR_ID = 199;

const SLUG = 'ute-okpu-an-ika-igbo-clan-and-its-nri-roots';

/**
 * Where the owner's file is kept on this machine.
 *
 * `.data/` is ignored by `.gitignore`, which is deliberate: **his recording is his media, and this repository
 * must not carry it.** It was supplied as an attachment in the session that asked for this change, and it is
 * copied here to be stored in the archive's own media store — which is what serving it requires — and for no
 * other purpose. The digest below is what identifies it, so a different file cannot be adopted by accident.
 */
const OWNER_FILE = join(process.cwd(), '.data', 'owner-media', 'ute-okpu-owner-recording.mp3');

/** SHA-256 of `Ute Okpu 2.mp3` as supplied. Recorded in round 313 as the identity of the file that was measured. */
const OWNER_SHA256 = '78cefb7fe022b2d36d35c1fa8e3663ef7f84550d876228d1f1eff8208da08f9a';

/** The media route whose pattern decides whether a key is servable at all. */
const MEDIA_ROUTE = join(process.cwd(), 'apps', 'ozikoro', 'app', 'media', '[...key]', 'route.ts');

/** The key the renderer uses for a slug, and where the generated file stays. */
const CANONICAL_KEY = `ozikoro/episodes/${SLUG}.mp3`;

/** The key the owner's recording gets. One filename segment, which is all the route's episode pattern allows. */
const RECORDING_KEY = `ozikoro/episodes/${SLUG}.owner-recording.mp3`;

/**
 * The disclosure for a human recording, which replaces the AI one.
 *
 * It says who is speaking, that the file is his, and that it is not synthetic. **It does not say "the words
 * are the article's own"**, which the old text did and which nothing here can check: round 313 could not
 * transcribe the audio, so whether the recording says these words is unknown and is left unsaid.
 */
const HUMAN_DISCLOSURE =
  'Read by the author, Idenze Ezeme. This episode is his own recording, supplied by him for this article. ' +
  'It was not generated by AI: no text-to-speech was used and no voice was cloned.';

/** `human` is allowed by `ozikoro_episode_narrator_kind_check` (migration 0045) and handled by the feed. */
const NARRATOR_KIND = 'human';

/**
 * The word the archive uses for a person's voice.
 *
 * `ozikoro_pronunciation.kind` has held `human_recording` since migration 0050. Using the same word here means
 * one vocabulary for one fact rather than two names for it.
 */
const GENERATOR = 'human_recording';

interface EpisodeRow {
  id: number;
  slug: string;
  title: string;
  script: string;
  transcript: string;
  storage_key: string | null;
  external_url: string | null;
  byte_size: number | null;
  duration_seconds: number | null;
  status: string;
  generator: string | null;
  generator_model: string | null;
  narrator_kind: string;
  narrator_name: string | null;
  ai_disclosure: string;
  char_count: number | null;
  estimated_credits: number | null;
  voice_choice: string | null;
  voice_settings: unknown;
  approved_by: number | null;
  approved_at: string | null;
  published_at: string | null;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : null;
}

/**
 * Read the route's own episode pattern, so a key is tested against the thing that will serve it.
 *
 * The expression is taken from the source rather than re-typed here: **a second copy of a pattern is a copy
 * that drifts**, and the failure it drifts into is a 404 on a file that is present and correct.
 */
async function episodePattern(): Promise<RegExp> {
  const source = await readFile(MEDIA_ROUTE, 'utf8');
  const match = source.match(/const EPISODE_PATTERN = (\/[^\n]*?\/);/);
  if (!match?.[1]) {
    throw new Error(
      `could not read EPISODE_PATTERN from ${MEDIA_ROUTE}. The key cannot be checked against the route, ` +
        'and writing a key the route will not serve looks exactly like success.'
    );
  }
  const literal = match[1];
  return new RegExp(literal.slice(1, literal.lastIndexOf('/')));
}

/** The duration of an MP3 as the file itself states it, or null when it cannot be read as one. */
function measure(bytes: Uint8Array): number | null {
  return mp3DurationSeconds(bytes);
}

/** `665.966 s` or `NOT MEASURABLE`, for the console. */
function described(seconds: number | null): string {
  return seconds === null ? 'NOT MEASURABLE' : `${seconds.toFixed(3)} s`;
}

function printRow(label: string, row: EpisodeRow): void {
  console.log(`\n  ${label}`);
  const fields: [string, unknown][] = [
    ['storage_key', row.storage_key],
    ['mime_type', 'audio/mpeg'],
    ['byte_size', row.byte_size],
    ['duration_seconds', row.duration_seconds],
    ['generator', row.generator],
    ['generator_model', row.generator_model],
    ['narrator_kind', row.narrator_kind],
    ['narrator_name', row.narrator_name],
    ['ai_disclosure', row.ai_disclosure],
    ['char_count', row.char_count],
    ['estimated_credits', row.estimated_credits],
    ['voice_choice', row.voice_choice],
    ['voice_settings', JSON.stringify(row.voice_settings)],
    ['status', row.status],
    ['approved_by / approved_at', `${row.approved_by} / ${row.approved_at}`],
    ['published_at', row.published_at],
    ['script', `${row.script.length} characters (unchanged; re-derived from the article body at restore time, so not evidence of what was spoken)`],
  ];
  for (const [k, v] of fields) console.log(`    ${k.padEnd(26)} ${v === null ? 'NULL' : String(v)}`);
}

async function readEpisode(db: Db): Promise<EpisodeRow> {
  const row = await db.one<EpisodeRow>(
    `select id, slug, title, script, transcript, storage_key, external_url, byte_size, duration_seconds,
            status, generator, generator_model, narrator_kind, narrator_name, ai_disclosure,
            char_count, estimated_credits, voice_choice, voice_settings, approved_by, approved_at, published_at
       from ozikoro_episode where slug = $1`,
    [SLUG]
  );
  if (!row) throw new Error(`no ozikoro_episode row for ${SLUG} — nothing to re-point`);
  return row;
}

const apply = process.argv.includes('--apply');
const filePath = arg('file') ?? OWNER_FILE;
const expectedSha = arg('expect-sha') ?? OWNER_SHA256;
// `||` not `??`: an empty DATABASE_URL is "not configured", the same rule `createDb` uses.
const db = await getDb();

try {
  const row = await readEpisode(db);
  const before = { ...row };

  console.log(`\n  Adopt the owner's recording${apply ? '' : '  (check only — nothing is written)'}`);
  console.log(`  Episode:  ${row.title}  (id ${row.id}, ${row.status})`);
  console.log(`  File:     ${filePath}`);

  /*
   * READ, IDENTIFY, MEASURE — before anything is written.
   *
   * The digest is checked first because it is what makes this file THE file the owner supplied. Measuring
   * second, because a duration that cannot be measured must stop the change rather than be replaced by the
   * estimate this whole correction exists to remove.
   */
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== expectedSha) {
    throw new Error(
      `the file at ${filePath} is not the recording this script adopts.\n` +
        `    expected sha256 ${expectedSha}\n    got      sha256 ${digest}\n` +
        '    Pass --expect-sha to adopt a different file deliberately; nothing was written.'
    );
  }

  const measured = measure(new Uint8Array(bytes));
  if (measured === null) {
    throw new Error(
      `${bytes.length} bytes at ${filePath} could not be read as MP3 frames, so its duration cannot be ` +
        'measured. Nothing was written: the column would have to hold a prediction, which is the fault ' +
        'this change removes.'
    );
  }
  const durationSeconds = Math.round(measured);

  /*
   * The key is tested against the route's own pattern. A key the route refuses is a 404 on a file that
   * exists, which is the one failure mode this project keeps rediscovering.
   */
  const pattern = await episodePattern();
  if (!pattern.test(RECORDING_KEY)) {
    throw new Error(
      `the key ${RECORDING_KEY} does not match the media route's episode pattern ${String(pattern)}. ` +
        'The route would answer 404 for a file that is present, so nothing was written.'
    );
  }

  /*
   * WHERE THE OLD FILE IS, MEASURED RATHER THAN TRUSTED.
   *
   * The row's own `duration_seconds` is not evidence about the old file — it is the prediction that was
   * wrong. The old bytes are read back through storage, which is also the only way to know the file is
   * still there and is what the revision history says it is.
   */
  const oldKey = row.storage_key;
  let old: { bytes: number; digest: string; seconds: number | null } | null = null;
  if (oldKey) {
    const object = await getStorage().get(oldKey);
    if (object) {
      const oldBytes = new Uint8Array(object.body);
      old = { bytes: oldBytes.length, digest: sha256(oldBytes), seconds: measure(oldBytes) };
    }
  }

  console.log(`\n  Measured, from the files themselves:`);
  console.log(`    owner's recording   ${bytes.length} bytes  ${described(measured)}`);
  console.log(`                        sha256 ${digest}`);
  if (old) {
    console.log(`    file in storage now ${old.bytes} bytes  ${described(old.seconds)}`);
    console.log(`                        at ${oldKey}`);
    console.log(`                        sha256 ${old.digest}`);
  } else {
    console.log(`    file in storage now NOT FOUND at ${oldKey ?? '(no key on the row)'}`);
  }

  printRow('THE ROW, BEFORE', before);

  const after: EpisodeRow = {
    ...row,
    storage_key: RECORDING_KEY,
    byte_size: bytes.length,
    duration_seconds: durationSeconds,
    generator: GENERATOR,
    generator_model: null,
    narrator_kind: NARRATOR_KIND,
    narrator_name: 'Idenze Ezeme',
    ai_disclosure: HUMAN_DISCLOSURE,
    char_count: 0,
    estimated_credits: 0,
    voice_choice: null,
    voice_settings: { duration_source: 'measured', kind: GENERATOR },
  };
  printRow('THE ROW, AFTER', after);

  const alreadyAdopted =
    row.storage_key === RECORDING_KEY && row.byte_size === bytes.length && row.narrator_kind === NARRATOR_KIND;

  if (!apply) {
    console.log(
      `\n  Plan${alreadyAdopted ? ' (ALREADY ADOPTED — a re-run would write nothing new)' : ''}:\n` +
        `    1. getStorage().put('${RECORDING_KEY}', <${bytes.length} bytes>, 'audio/mpeg')\n` +
        `    2. update ozikoro_episode set storage_key, byte_size, duration_seconds = ${durationSeconds},\n` +
        '         generator, generator_model, narrator_kind, narrator_name, ai_disclosure,\n' +
        '         char_count, estimated_credits, voice_choice, voice_settings\n' +
        '    3. insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)\n' +
        `    NOT overwritten: ${CANONICAL_KEY} — the generated file stays where revision 1 names it.\n` +
        '\n  Re-run with --apply to write this.\n'
    );
    await closeDb();
    process.exit(0);
  }

  if (alreadyAdopted) {
    console.log('\n  Already adopted — the row points at this file with this size and kind. Nothing written.\n');
    await closeDb();
    process.exit(0);
  }

  /*
   * INTO STORAGE, THROUGH THE SAME INTERFACE THE MEDIA ROUTE READS.
   *
   * **Not by copying a file into a directory.** A file placed at `data/media/ozikoro-wp/…` is on disk, named
   * correctly, and serves 404, because the route reads object storage. `getStorage()` is that interface, and
   * writing through it is what makes the bytes servable.
   */
  const stored = await getStorage().put(RECORDING_KEY, bytes, 'audio/mpeg');
  console.log(`\n  stored  ${stored.key}  ${stored.byteSize} bytes  ${stored.contentType}  →  ${stored.url}`);

  await db.query(
    `update ozikoro_episode
        set storage_key = $2, mime_type = 'audio/mpeg', byte_size = $3, duration_seconds = $4,
            generator = $5, generator_model = null, narrator_kind = $6, narrator_name = $7,
            ai_disclosure = $8, char_count = 0, estimated_credits = 0, voice_choice = null,
            voice_settings = $9, updated_at = now()
      where id = $1`,
    [
      row.id,
      RECORDING_KEY,
      bytes.length,
      durationSeconds,
      GENERATOR,
      NARRATOR_KIND,
      'Idenze Ezeme',
      HUMAN_DISCLOSURE,
      JSON.stringify({ duration_source: 'measured', kind: GENERATOR }),
    ]
  );

  /*
   * THE AUDIT ROW — the fact, with both files and both durations on it.
   *
   * "A 501-second synthetic narration replaced by a 666-second recording of the author" is the sentence, and
   * the JSON either side of it is what makes the sentence checkable. The old file's duration is the one read
   * from the file just now, not the 636 the column held: **the point of the row is that the column's number
   * was wrong**, so recording the column's number as though it were the file's would hide the very fault.
   */
  const auditBefore = {
    storage_key: before.storage_key,
    byte_size: before.byte_size,
    duration_seconds: before.duration_seconds,
    measured_duration_seconds: old?.seconds ?? null,
    sha256: old?.digest ?? null,
    generator: before.generator,
    generator_model: before.generator_model,
    narrator_kind: before.narrator_kind,
    narrator_name: before.narrator_name,
    ai_disclosure: before.ai_disclosure,
    char_count: before.char_count,
    estimated_credits: before.estimated_credits,
    voice_choice: before.voice_choice,
    voice_settings: before.voice_settings,
  };
  const auditAfter = {
    storage_key: RECORDING_KEY,
    byte_size: bytes.length,
    duration_seconds: durationSeconds,
    measured_duration_seconds: measured,
    sha256: digest,
    generator: GENERATOR,
    generator_model: null,
    narrator_kind: NARRATOR_KIND,
    narrator_name: 'Idenze Ezeme',
    ai_disclosure: HUMAN_DISCLOSURE,
    char_count: 0,
    estimated_credits: 0,
    voice_choice: null,
    voice_settings: { duration_source: 'measured', kind: GENERATOR },
  };
  const note =
    'The article played a synthetic narration; it now plays the owner\'s own recording. ' +
    `${old ? `The synthetic file is ${old.bytes} bytes and plays ${old.seconds?.toFixed(3) ?? '?'} s, ` +
      'measured from the file itself' : 'The previous file could not be read back from storage'} — the row ` +
    `held ${before.duration_seconds} s, which was a prediction at 145 words per minute rather than a ` +
    `measurement. The recording is ${bytes.length} bytes and plays ${measured.toFixed(3)} s, measured by ` +
    `mp3DurationSeconds; duration_seconds holds ${durationSeconds} and voice_settings.duration_source is ` +
    `"measured". generator, narrator_kind, narrator_name and ai_disclosure were changed because the file is ` +
    'a person and not a clone. char_count and estimated_credits are 0 because this file cost no ElevenLabs ' +
    `characters; the ${before.char_count ?? 0} characters the synthetic render cost are recorded in ` +
    'ozikoro_episode_revision revision 1 and in this row\'s "before". script and transcript were NOT changed: ' +
    'restore-episodes.ts re-derived them from the article body, so they are the article\'s spoken words and ' +
    'not a record of what the recording says. No revision row was written, because that table holds renders ' +
    `and this file was not rendered. The generated file was left in place at ${CANONICAL_KEY}.`;

  await db.query(
    `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
     values ('ozikoro_episode', $1, 'replace_audio', $2, $3, $4, $5)`,
    [row.id, JSON.stringify(auditBefore), JSON.stringify(auditAfter), ACTOR_ID, note]
  );

  const written = await db.one<EpisodeRow>(
    `select id, slug, title, script, transcript, storage_key, external_url, byte_size, duration_seconds,
            status, generator, generator_model, narrator_kind, narrator_name, ai_disclosure,
            char_count, estimated_credits, voice_choice, voice_settings, approved_by, approved_at, published_at
       from ozikoro_episode where id = $1`,
    [row.id]
  );
  printRow('THE ROW, AS WRITTEN', written ?? row);
  console.log('\n  The owner\'s recording is now the file the article serves.\n');
} finally {
  await closeDb();
}
