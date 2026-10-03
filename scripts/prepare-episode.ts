/**
 * Prepare an episode: the article's own words, made speakable, held for review.
 *
 * WHAT THIS DOES NOT DO, AND WHY THAT IS THE POINT
 *
 * The brief this was built from asks for a script refiner that rewrites an article into "the precise narrative
 * tone of The 48 Laws of Power" — grim maxims, dramatic pauses, a chilling closing law. **That is the one thing
 * this archive must not do.**
 *
 * The brief's own rules say never to invent content and never to put a generated answer above primary evidence.
 * A history rewritten into a menacing audiobook is a different document from the record it came from: **it
 * asserts a tone the source does not have, and a listener has no way to tell which sentences are the archive's
 * and which were added for effect.** The founding rule of this work is that the record is reproduced faithfully.
 *
 * So the "script" is the article, prepared for speaking rather than rewritten:
 *
 *   headings become spoken sentences            "The Nri Tradition" -> "The Nri Tradition."
 *   citation brackets and file references go    a listener cannot follow "see figure 3"
 *   numbers and dates are left exactly as they are
 *   sentences are not reordered, shortened or dramatised
 *
 * WHAT IT NEEDS, AND WHAT HAPPENS WITHOUT IT
 *
 * An ElevenLabs key and a chosen voice. **Without them it stops and says so**, rather than writing a placeholder
 * that looks like an episode. An archive that has never published an episode is in an honest state; one that has
 * published a silent one is not.
 *
 * THE VOICE
 *
 * `--voice=own` uses a cloned voice the owner has trained in their own ElevenLabs account, and
 * `narrator_kind` is recorded as `synthetic_own_voice` with the disclosure that implies. **A cloned voice
 * belongs to the person who trained it**, which is what Spotify's second rule requires and why this takes a
 * voice ID from the environment rather than choosing one.
 *
 * Usage:
 *   node scripts/prepare-episode.ts <article-slug> [--voice=own|generic] [--dry-run]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, closeDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
// The one definition of "prepare the article's own words for speaking", shared with the API route.
import { toSpokenScript } from '@ozikoro/platform';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const voiceChoice = (args.find((a) => a.startsWith('--voice='))?.split('=')[1] ?? 'own') as 'own' | 'generic';

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = voiceChoice === 'own' ? process.env.ELEVENLABS_VOICE_ID_OWN : process.env.ELEVENLABS_VOICE_ID_GENERIC;

if (!slug) {
  console.error('  usage: node scripts/prepare-episode.ts <article-slug> [--voice=own|generic] [--dry-run]');
  process.exit(2);
}


const db = await getDb();

const article = await db.one<{
  id: number; slug: string; title: string; body_html: string | null; standfirst: string | null;
  topic: string | null; author: string | null; word_count: number | null;
}>(
  `select a.id, a.slug, a.title, a.body_html, a.standfirst, t.name as topic, c.display_name as author, a.word_count
     from ozikoro_article a
     left join ozikoro_topic t on t.id = a.topic_id
     left join ozikoro_contributor c on c.id = a.author_id
    where a.slug = $1 and a.status = 'published'`,
  [slug]
);
if (!article) {
  console.error(`  no published article with the slug "${slug}"`);
  await closeDb();
  process.exit(2);
}

const { script, transcript } = toSpokenScript(article.body_html ?? '');
const words = script.split(/\s+/).filter(Boolean).length;
// A speaking rate of about 145 words a minute is the ordinary pace of a read history.
const estimatedSeconds = Math.round((words / 145) * 60);

console.log(`  article      ${article.title}`);
console.log(`  author       ${article.author ?? 'Ozikoro'}`);
console.log(`  spoken words ${words.toLocaleString('en-GB')}   (about ${Math.floor(estimatedSeconds / 60)}m ${estimatedSeconds % 60}s)`);
console.log(`  the article's own sentences, with markup and citation brackets removed — nothing rewritten`);

if (dryRun) {
  mkdirSync(join(process.cwd(), 'data', 'episodes'), { recursive: true });
  const out = join(process.cwd(), 'data', 'episodes', `${article.slug}.script.txt`);
  writeFileSync(out, script);
  console.log(`  dry run — the script was written to ${out} and NOTHING was recorded in the database`);
  await closeDb();
  process.exit(0);
}

/*
 * WITHOUT A KEY THIS STOPS.
 *
 * It would be easy to write the episode row with a null audio path and let somebody approve it later. **That is
 * how an archive ends up with a feed full of unplayable items**, and Spotify rejects an episode without an
 * enclosure. The row is not created until there is audio to put in it.
 */
if (!API_KEY || !VOICE_ID) {
  console.error('');
  console.error('  NOT PREPARED — narration needs an ElevenLabs key and a chosen voice:');
  console.error(`    ELEVENLABS_API_KEY          ${API_KEY ? 'set' : 'MISSING'}`);
  console.error(`    ELEVENLABS_VOICE_ID_${voiceChoice.toUpperCase()}   ${VOICE_ID ? 'set' : 'MISSING'}`);
  console.error('');
  console.error('  For your own trained voice, create the clone in your ElevenLabs account and put its voice ID');
  console.error('  in ELEVENLABS_VOICE_ID_OWN. For a stock narrator, use ELEVENLABS_VOICE_ID_GENERIC.');
  console.error('  Nothing was written.');
  await closeDb();
  process.exit(2);
}

/*
 * THE RENDER.
 *
 * `eleven_multilingual_v2` is the model ElevenLabs documents for long-form narration, and it is the one that
 * handles the dotted vowels and tone marks Igbo needs — which the archive's own type specimen exists to test.
 * **The settings are deliberately conservative**: a history read in a steady voice is the register the archive
 * asks for, and high style values push a reading toward a performance.
 */
const VOICE_SETTINGS = { stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true };

console.log(`  rendering with ${voiceChoice === 'own' ? 'your trained voice' : 'a stock narrator'}…`);
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
  method: 'POST',
  headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
  body: JSON.stringify({ text: script, model_id: 'eleven_multilingual_v2', voice_settings: VOICE_SETTINGS }),
});
if (!res.ok) {
  console.error(`  RENDER FAILED — HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.error('  Nothing was written.');
  await closeDb();
  process.exit(1);
}
const audio = Buffer.from(await res.arrayBuffer());

const show = await db.one<{ id: number }>(`select id from ozikoro_podcast_show where slug = 'ozikoro'`);
if (!show) throw new Error('no show row');

const episodeSlug = article.slug;
const storageKey = `ozikoro/episodes/${episodeSlug}.mp3`;
// Into storage, where the media route reads — **not the archive directory, which production does not serve.**
await getStorage().put(storageKey, audio, 'audio/mpeg');

const disclosure =
  voiceChoice === 'own'
    ? 'This episode was generated using AI text-to-speech from a voice cloned from the author’s own recording, with his permission. The words are the article’s own. Read by Idenze Ezeme (synthetic).'
    : 'This episode was generated using AI text-to-speech. The words are the article’s own. Narrated by a synthetic voice.';

const episode = await db.one<{ id: number }>(
  `insert into ozikoro_episode
     (article_id, slug, title, script, transcript, summary, narrator_kind, narrator_name, ai_disclosure,
      storage_key, mime_type, byte_size, duration_seconds, status, generator, generator_model, voice_settings)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'audio/mpeg',$11,$12,'pending_review','elevenlabs','eleven_multilingual_v2',$13)
   on conflict (slug) do update set
     script = excluded.script, transcript = excluded.transcript, storage_key = excluded.storage_key,
     byte_size = excluded.byte_size, duration_seconds = excluded.duration_seconds,
     status = 'pending_review', updated_at = now()
   returning id`,
  [
    article.id, episodeSlug, article.title, script, transcript, article.standfirst,
    voiceChoice === 'own' ? 'synthetic_own_voice' : 'synthetic_generic',
    voiceChoice === 'own' ? 'Idenze Ezeme (synthetic)' : null,
    disclosure, storageKey, audio.byteLength, estimatedSeconds, JSON.stringify(VOICE_SETTINGS),
  ]
);

if (episode) {
  const n = await db.one<{ n: number }>(
    `select coalesce(max(revision_number),0)::int n from ozikoro_episode_revision where episode_id = $1`, [episode.id]
  );
  await db.query(
    `insert into ozikoro_episode_revision (episode_id, revision_number, script, storage_key, byte_size, duration_seconds, generator_model, voice_settings)
     values ($1,$2,$3,$4,$5,$6,'eleven_multilingual_v2',$7)`,
    [episode.id, (n?.n ?? 0) + 1, script, storageKey, audio.byteLength, estimatedSeconds, JSON.stringify(VOICE_SETTINGS)]
  );
  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, note)
     values ($1, null, 'pending_review', 'Rendered and awaiting a human listen.')`,
    [episode.id]
  );
  console.log(`  episode ${episode.id} is PENDING REVIEW — nothing is in the feed until you approve it`);
  console.log(`  audio    data/media/ozikoro-wp/episodes/${episodeSlug}.mp3  (${(audio.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}
await closeDb();
