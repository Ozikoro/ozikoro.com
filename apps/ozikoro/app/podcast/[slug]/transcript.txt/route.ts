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
  const row = await db.one<{ transcript: string; title: string; slug: string; narrator_kind: string }>(
    `select transcript, title, slug, narrator_kind from ozikoro_episode
      where slug = $1 and status = 'published'`,
    [slug]
  );
  if (!row) return new Response('Not found', { status: 404 });

  /*
   * THE HEADER SAYS WHICH KIND OF TEXT THIS IS, BECAUSE FOR ONE KIND IT IS NOT A TRANSCRIPT.
   *
   * The line used to be unconditional: *"Transcript of the spoken record. The words are the article's own."*
   * **For a synthetic episode both halves are true and the second is what makes the first checkable** — the
   * words spoken were the article's, prepared by `toSpokenScript`, and the render was made from exactly this
   * text.
   *
   * **For the owner's own recording the first half is a claim nothing here can support.** The transcript on
   * the row was re-derived from the article body by `scripts/restore-episodes.ts`, and there is no transcriber
   * in this repository — so whether the recording says these words is unknown. Saying "transcript of the
   * spoken record" over an unchecked text would be a false statement about the record, which is the same fault
   * as labelling a human recording as AI-generated, and it is why the branch exists rather than one sentence
   * being chosen for both kinds.
   */
  const header = row.narrator_kind === 'human'
    ? 'The article’s own words, prepared for reading. The audio beside this text is the author’s own ' +
      'recording; this text is the article’s spoken form and has not been checked word for word against it.'
    : 'Transcript of the spoken record. The words are the article’s own.';

  // A plain-text header, so a reader arriving from the feed knows what they are holding.
  const body = [`${row.title}`, '', header, '', row.transcript, ''].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
}
