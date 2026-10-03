/**
 * The transcript of an episode, as plain text.
 *
 * WHY THIS IS PART OF THE FEATURE AND NOT A NICETY
 *
 * The feed links it as `<podcast:transcript>`, and Spotify reads that field. **But the reason it exists here
 * is that a transcript is the same words as the audio, and this archive's whole position is that the written
 * record is the thing everything else points back to.** An episode a listener can only hear, and cannot read
 * or check, is a weaker record than one they can.
 *
 * Only a PUBLISHED episode has one. A transcript of an episode nobody has approved would expose the spoken
 * text of an unreviewed render — which is the review gate's whole purpose.
 */
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const raw = (await params).slug;
  const slug = raw.replace(/\.txt$/i, '');
  const db = await getDb();
  const row = await db.one<{ transcript: string; title: string; slug: string }>(
    `select transcript, title, slug from ozikoro_episode where slug = $1 and status = 'published'`,
    [slug]
  );
  if (!row) return new Response('Not found', { status: 404 });

  // A plain-text header, so a reader arriving from the feed knows what they are holding.
  const body = [`${row.title}`, '', 'Transcript of the spoken record. The words are the article’s own.', '', row.transcript, ''].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
}
