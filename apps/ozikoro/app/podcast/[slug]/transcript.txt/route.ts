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
import {
  agreementRefusalText,
  episodeTranscriptHeader,
  playableEpisodeSql,
  withdrawnInstitutionalAccess,
} from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import { hasCapability } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const raw = (await params).slug;
  const slug = raw.replace(/\.txt$/i, '');
  const db = await getDb();
  /*
   * THE SAME CONDITION THE ARTICLE AND THE FEED USE.
   *
   * This route asked only for `status = 'published'`, which is a gate on publication rather than on approval:
   * a transcript is the whole spoken text, and serving it for a row whose status was set without an approval
   * record would expose exactly what the review step exists to hold back. **Measured before this change: the
   * `published_unapproved` row's transcript answered 200 where every other unapproved status answered 404.**
   */
  const row = await db.one<{
    transcript: string; title: string; slug: string; narrator_kind: string; external_url: string | null;
    access_tier: string | null;
  }>(
    `select e.transcript, e.title, e.slug, e.narrator_kind, e.external_url,
            (select a.access_tier from ozikoro_article a where a.id = e.article_id) as access_tier
       from ozikoro_episode e
      where e.slug = $1 and ${playableEpisodeSql('e')}`,
    [slug]
  );
  if (!row) return new Response('Not found', { status: 404 });

  /*
   * ── THE RECORD'S SECOND MARK GATES THE FILE TOO ───────────────────────────────────────────────────
   *
   * This address is a FILE rather than a page — the feed names it as the episode's transcript and a machine
   * reads it — so it answers in the same content type it always has, with the refusal as plain text rather
   * than as a document. **The words are composed from the one `agreementRefusal` the page also calls**, so
   * the file and the page cannot describe the same record two different ways.
   */
  if (row.access_tier === 'by_agreement') {
    const viewer = await getCurrentAccount().catch(() => null);
    const mayRead = viewer ? await hasCapability(viewer.account.id, 'read_restricted') : false;
    if (!mayRead) {
      const withdrawn = viewer ? await withdrawnInstitutionalAccess(db, viewer.account.id) : null;
      return new Response(
        agreementRefusalText({ path: `/podcast/${row.slug}/transcript.txt`, withdrawn }),
        { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }
      );
    }
  }

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
   *
   * **AND FOR AN EXTERNAL RECORDING NEITHER SENTENCE IS AVAILABLE.** An episode whose audio is held on Spotify
   * is one this archive did not make and cannot check: the text below is the article's, but whether the
   * recording says it has no answer here at all. So a third branch says exactly that rather than borrowing the
   * synthetic one's confidence.
   *
   * AND THE SENTENCES MOVED, BECAUSE A SECOND ADDRESS NOW SERVES THIS TEXT. `/podcast/<slug>/transcript/` is
   * the page a reader reads and it carries this same header under the title; the branches live in
   * `episodeTranscriptHeader` in `@ozikoro/platform`, which both addresses call, so the file and the page
   * cannot end up describing the same text two different ways. The words themselves are unchanged.
   */
  const header = episodeTranscriptHeader(row);

  // A plain-text header, so a reader arriving from the feed knows what they are holding.
  const body = [`${row.title}`, '', header, '', row.transcript, ''].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
}
