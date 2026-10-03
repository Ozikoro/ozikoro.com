/**
 * Speak a script, and hold the result for review.
 *
 * THIS ROUTE DOES NOT PUBLISH, AND THAT IS DELIBERATE
 *
 * The specification for this pipeline ends with generation. **Publication is a separate act by a person** —
 * `ozikoro_episode.status` moves to `published` through an explicit transition with an actor recorded, and the
 * feed lists nothing else. **Spotify's own rules put the responsibility for the content on the publisher**, and
 * an endpoint that rendered and published in one call would move that decision into a request.
 *
 * WHAT IT DOES
 *
 *   takes a published record's slug, prepares its own words for speaking, renders them in the chosen voice,
 *   writes the audio beside the other media, and records an episode in `pending_review` with its transcript,
 *   its narrator kind and its disclosure.
 *
 * THE NARRATOR IS RECORDED, NOT IMPLIED. `synthetic_own_voice` when the owner's clone is used and
 * `synthetic_generic` otherwise, with the disclosure that follows from each — **Spotify's third rule, and the
 * reason it is a column rather than a convention.**
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { apiKey, configured, genericVoiceId, ownVoiceId, speak } from '@/lib/elevenlabs';
import { getCurrentAccount } from '@/lib/session';
import { can, toSpokenScript } from '@ozikoro/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A ten-minute render does not fit a default timeout. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const current = await getCurrentAccount();
  if (!current) return NextResponse.json({ error: 'Not signed in.' }, { status: 403 });
  if (!(await can(await getDb(), current.account.id, 'publish'))) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }
  if (!apiKey() || !configured()) {
    return NextResponse.json(
      { error: 'Narration is not configured.', need: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID_OWN'] },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string; voice?: 'own' | 'generic' };
  const slug = body.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'A slug is required.' }, { status: 400 });

  const voiceChoice = body.voice === 'generic' ? 'generic' : 'own';
  const voiceId = voiceChoice === 'own' ? ownVoiceId() : genericVoiceId();
  if (!voiceId) {
    return NextResponse.json({ error: `No ${voiceChoice} voice is configured.` }, { status: 503 });
  }

  const db = await getDb();
  const article = await db.one<{ id: number; title: string; body_html: string | null; standfirst: string | null }>(
    `select id, title, body_html, standfirst from ozikoro_article
      where slug = $1 and status = 'published' and is_page = false`,
    [slug]
  );
  // **Only a published record can become an episode.** An ingested record is held as `review`, and putting
  // audio on Spotify for a record the archive has not itself published would be a redistribution it has not
  // stood behind as text.
  if (!article) return NextResponse.json({ error: 'No published record with that slug.' }, { status: 404 });

  const { script, transcript } = toSpokenScript(article.body_html ?? '');
  const words = script.split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.round((words / 145) * 60);

  let audio: Buffer;
  try {
    audio = await speak(script, voiceId, { stream: script.length > 5000 });
  } catch (error) {
    return NextResponse.json({ error: String(error).slice(0, 300) }, { status: 502 });
  }

  const storageKey = `ozikoro/episodes/${slug}.mp3`;
  const dir = join(process.cwd(), 'data', 'media', 'ozikoro-wp', 'episodes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.mp3`), audio);

  const disclosure =
    voiceChoice === 'own'
      ? 'This episode was generated using AI text-to-speech from a voice cloned from the author’s own recording, with his permission. The words are the article’s own.'
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
      article.id, slug, article.title, script, transcript, article.standfirst,
      voiceChoice === 'own' ? 'synthetic_own_voice' : 'synthetic_generic',
      voiceChoice === 'own' ? 'Idenze Ezeme (synthetic)' : null,
      disclosure, storageKey, audio.byteLength, estimatedSeconds,
      JSON.stringify({ stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true }),
    ]
  );

  if (episode) {
    const n = await db.one<{ n: number }>(
      `select coalesce(max(revision_number),0)::int n from ozikoro_episode_revision where episode_id = $1`,
      [episode.id]
    );
    await db.query(
      `insert into ozikoro_episode_revision (episode_id, revision_number, script, storage_key, byte_size, duration_seconds, generator_model, created_by)
       values ($1,$2,$3,$4,$5,$6,'eleven_multilingual_v2',$7)`,
      [episode.id, (n?.n ?? 0) + 1, script, storageKey, audio.byteLength, estimatedSeconds, current.account.id]
    );
    await db.query(
      `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note)
       values ($1, null, 'pending_review', $2, 'Rendered and awaiting a human listen.')`,
      [episode.id, current.account.id]
    );
  }

  return NextResponse.json({
    status: 'pending_review',
    episodeId: episode?.id ?? null,
    audio: `/media/${storageKey}`,
    seconds: estimatedSeconds,
    words,
    narrator: voiceChoice,
    published: false,
    note: 'Nothing is in the feed until this is approved.',
  });
}
