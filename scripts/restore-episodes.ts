/**
 * Restore the three spoken records whose rows were lost in a database restore.
 *
 * WHY THIS IS A ROW AND NOT A RE-RENDER
 *
 * The audio was never lost. The MP3s sit in `.data/media/ozikoro/episodes/`, which a database restore
 * does not touch, and each one is the owner's own cloned voice reading an article's own words. The
 * database row that pointed at the file is what disappeared. So this puts the pointer back. **It does
 * not call the ElevenLabs API, and nothing is re-rendered or re-billed.**
 *
 * WHY THE FILE GOES THROUGH STORAGE RATHER THAN THE DIRECTORY
 *
 * An earlier attempt wrote the MP3 into `data/media/ozikoro-wp/` and the episode then served a 404:
 * the media route reads object storage, not that directory. So the bytes are read from disk and put
 * into storage under the key the route expects — `ozikoro/episodes/<slug>.mp3`, which is the second,
 * narrower pattern in `app/media/[...key]/route.ts`.
 *
 * WHAT IS PRESERVED, AND WHAT IS NOT
 *
 * The words are the article's own, produced by the archive's own `toSpokenScript`, which removes only
 * what cannot be heard. Nothing is rewritten.
 *
 * The episode's original publication moment is not recoverable from a restored database, and inventing
 * one would be inventing history. **The audio file's own mtime is used instead** — it is the real moment
 * the recording was written, it is verifiable with `stat`, and it is the honest anchor for when the
 * audio came into existence. That choice is recorded in each transition note so a later reader can see
 * it rather than assume the timestamp was recovered.
 *
 * Usage:
 *   node scripts/restore-episodes.ts --check   # report what it would do, change nothing
 *   node scripts/restore-episodes.ts --apply
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import {
  narrationDisclosure,
  narratorKindFor,
  recordNarrationRevision,
  toSpokenScript,
  type NarrationVoice,
} from '@ozikoro/platform';

/** The account that approved the narration. The owner's account, which is the only one that exists. */
const APPROVED_BY = 199;

const EPISODES = [
  {
    slug: 'ute-okpu-an-ika-igbo-clan-and-its-nri-roots',
    durationSeconds: 636,
  },
  {
    slug: 'how-tortoise-got-his-bumpy-shell',
    durationSeconds: 254,
  },
  {
    slug: 'igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage',
    durationSeconds: 848,
  },
];

const MEDIA_DIR = join(process.cwd(), '.data', 'media', 'ozikoro', 'episodes');

interface RestoredEpisode {
  slug: string;
  title: string;
  bytes: number;
  durationSeconds: number;
  scriptChars: number;
  publishedAt: string;
}

async function restoreEpisode(db: Db, slug: string, durationSeconds: number, apply: boolean): Promise<RestoredEpisode | null> {
  const article = await db.one<{ id: number; title: string; standfirst: string | null; body_html: string }>(
    `select id, title, standfirst, body_html from ozikoro_article
      where slug = $1 and status = 'published'`,
    [slug]
  );
  if (!article) {
    console.error(`  ${slug}: NO PUBLISHED ARTICLE — skipped rather than pointed at nothing`);
    return null;
  }

  const file = join(MEDIA_DIR, `${slug}.mp3`);
  const info = await stat(file);
  const bytes = info.size;
  // The file's own mtime is the only real timestamp available for when this audio was made.
  const publishedAt = info.mtime.toISOString();

  // The article's own words, prepared for speaking. Never rewritten.
  const { script, transcript } = toSpokenScript(article.body_html);
  if (script.replace(/\s+/g, '').length === 0) {
    console.error(`  ${slug}: NO SPOKEN WORDS in the article — skipped`);
    return null;
  }

  const storageKey = `ozikoro/episodes/${slug}.mp3`;
  const voice: NarrationVoice = 'own';

  if (!apply) {
    console.log(
      `  ${slug}\n` +
        `    article ${article.id}  ${article.title}\n` +
        `    file    ${file}\n` +
        `    ${bytes} bytes  ${durationSeconds}s  script ${script.length} chars\n` +
        `    key     ${storageKey}`
    );
    return { slug, title: article.title, bytes, durationSeconds, scriptChars: script.length, publishedAt };
  }

  // The bytes are put into storage, which is what the media route serves from.
  const body = await readFile(file);
  await getStorage().put(storageKey, body, 'audio/mpeg');

  const episode = await db.one<{ id: number }>(
    `insert into ozikoro_episode
       (article_id, slug, title, script, transcript, summary, language_code,
        narrator_kind, narrator_name, ai_disclosure,
        storage_key, external_url, mime_type, byte_size, duration_seconds,
        status, approved_by, approved_at, published_at,
        char_count, voice_choice, generator, generator_model, voice_settings,
        created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,'en',
             $7,$8,$9,
             $10,null,'audio/mpeg',$11,$12,
             'published',$13,$14,$14,
             $15,'own','elevenlabs','eleven_multilingual_v2',$16,
             $14,$14)
     on conflict (slug) do update set
       article_id = excluded.article_id, title = excluded.title, script = excluded.script,
       transcript = excluded.transcript, summary = excluded.summary,
       narrator_kind = excluded.narrator_kind, narrator_name = excluded.narrator_name,
       ai_disclosure = excluded.ai_disclosure, storage_key = excluded.storage_key,
       mime_type = excluded.mime_type, byte_size = excluded.byte_size,
       duration_seconds = excluded.duration_seconds, status = 'published',
       approved_by = excluded.approved_by, approved_at = excluded.approved_at,
       published_at = excluded.published_at, char_count = excluded.char_count,
       voice_choice = 'own', updated_at = excluded.updated_at
     returning id`,
    [
      article.id, slug, article.title, script, transcript, article.standfirst,
      narratorKindFor(voice), 'Idenze Ezeme (synthetic)', narrationDisclosure(voice),
      storageKey, bytes, durationSeconds, APPROVED_BY, publishedAt, script.length,
      JSON.stringify({ stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true }),
    ]
  );
  if (!episode) throw new Error(`episode row for ${slug} was not written`);
  const episodeId = Number(episode.id);

  /*
   * The revision history is rebuilt with the episode, and cleared first.
   *
   * A restore is a rebuild, not an append: without the delete a second run would either duplicate the
   * revision or trip the (episode_id, revision_number) unique constraint, and neither is a history.
   */
  await db.query(`delete from ozikoro_episode_revision where episode_id = $1`, [episodeId]);
  await recordNarrationRevision(db, episodeId, script, {
    storageKey,
    byteSize: bytes,
    durationSeconds,
    generatorModel: 'eleven_multilingual_v2',
    voiceSettings: { stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
    createdBy: APPROVED_BY,
  });

  await db.query(`delete from ozikoro_episode_transition where episode_id = $1`, [episodeId]);
  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note, created_at)
     values ($1, null, 'published', $2, $3, $4)`,
    [
      episodeId,
      APPROVED_BY,
      'Restored after the database restore lost the episode row. The audio was never lost: it is the ' +
        `file ${storageKey} on disk, ${bytes} bytes, put back into storage. NOT re-rendered and no API ` +
        'credit was spent. The original publication moment was not recoverable, so the audio file\'s own ' +
        `mtime (${publishedAt}) is used as the anchor rather than a timestamp being invented.`,
      publishedAt,
    ]
  );

  return { slug, title: article.title, bytes, durationSeconds, scriptChars: script.length, publishedAt };
}

const apply = process.argv.includes('--apply');
const db = await getDb();
console.log(`\n  Restore spoken records${apply ? '' : ' (check only, nothing is written)'}`);
console.log(`  Audio directory: ${MEDIA_DIR}\n`);

for (const e of EPISODES) {
  await restoreEpisode(db, e.slug, e.durationSeconds, apply);
}

if (apply) {
  const rows = await db.rows<{ slug: string; status: string; byte_size: string; duration_seconds: number; revisions: string }>(
    `select e.slug, e.status, e.byte_size, e.duration_seconds,
            (select count(*) from ozikoro_episode_revision r where r.episode_id = e.id) as revisions
       from ozikoro_episode e order by e.slug`
  );
  console.log('\n  Episodes now in the database:');
  for (const r of rows) {
    console.log(`    ${r.slug}  ${r.status}  ${r.byte_size} bytes  ${r.duration_seconds}s  ${r.revisions} revision(s)`);
  }
} else {
  console.log('\n  Re-run with --apply to write these rows.\n');
}
await closeDb();
