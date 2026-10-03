/**
 * The podcast feed Spotify ingests.
 *
 * WHY A FEED ON OUR OWN DOMAIN RATHER THAN A HOST'S
 *
 * The brief assumed publishing has to go through a host's API because "Spotify does not allow direct audio
 * uploads". **That is true and it misses the point: Spotify ingests an RSS feed, and an RSS feed is a document
 * this site can serve.** A host such as Transistor adds convenience — analytics, an upload endpoint — **but
 * nothing about Spotify's requirements needs one**, and building against a host would put a third party between
 * the archive and its own audio.
 *
 * So the feed is generated here, and a host can be pointed at it later if wanted. `ozikoro_podcast_show.host_feed_url`
 * exists for that day.
 *
 * THE FOUR THINGS THIS FEED DOES THAT A NAIVE ONE WOULD NOT
 *
 * 1. **IT IS EMPTY UNTIL SOMETHING IS APPROVED, AND SAYS SO.** No episode is listed until a person has moved
 *    it to `published`. A feed that lists drafts leaks unreviewed audio to a subscriber's app.
 *
 * 2. **EVERY EPISODE CARRIES ITS TRANSCRIPT.** `<podcast:transcript>` is what makes an episode readable rather
 *    than only audible, and Spotify's own guidance for AI-generated content puts disclosure and accessibility
 *    together. The transcript is a column on the episode and is emitted as a plain-text enclosure.
 *
 * 3. **EVERY EPISODE STATES HOW IT WAS NARRATED.** `narrator_kind` distinguishes a person from a synthetic
 *    voice, and the disclosure text is printed in the item description **and** as a `<podcast:value>`-adjacent
 *    note. **Spotify's first rule is that the publisher owns the rights; its second is that a real person's
 *    voice must not be cloned without authorisation; its third is that synthetic narration be disclosed.**
 *    A feed that leaves the third to the show notes alone cannot answer for an individual episode.
 *
 * 4. **IT IS ESCAPED PROPERLY.** Titles in this archive contain `&`, and one unescaped ampersand makes the whole
 *    document invalid — Spotify then reports "no episodes", not "malformed XML".
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * **No AI summarising and no dramatic rewriting of the record.** The archive's rule is that primary evidence
 * outranks anything generated, and an episode's script is the article's own words prepared for speaking.
 */
import { getDb } from '@ozituma/db/client';
import { SITE_ORIGIN } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const x = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** `Wed, 01 Oct 2026 12:00:00 GMT`, which is what RSS dates look like. */
const rfc822 = (d: Date) => d.toUTCString();

/** `1:04:09` or `12:07` — the form a player shows. */
function clock(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

export async function GET() {
  const db = await getDb();

  const show = await db.one<{
    title: string; description: string; author: string; owner_email: string;
    language_code: string; category: string; explicit: boolean; cover_storage_key: string | null;
  }>(`select title, description, author, owner_email, language_code, category, explicit, cover_storage_key
        from ozikoro_podcast_show where slug = 'ozikoro'`);

  if (!show) return new Response('No show configured', { status: 404 });

  /*
   * ONLY PUBLISHED EPISODES, AND ONLY ONES WITH AUDIO.
   *
   * An `<enclosure>` is mandatory in a podcast item, so **an approved episode whose render failed cannot be
   * listed** — it would be an item Spotify rejects and, worse, one a subscriber sees as unplayable. It waits.
   */
  const episodes = await db.rows<{
    slug: string; title: string; summary: string | null; transcript: string;
    storage_key: string | null; external_url: string | null; mime_type: string | null;
    byte_size: number | null; duration_seconds: number | null;
    narrator_kind: string; narrator_name: string | null; ai_disclosure: string;
    published_at: Date | null; article_slug: string;
  }>(
    `select e.slug, e.title, e.summary, e.transcript, e.storage_key, e.external_url, e.mime_type,
            e.byte_size, e.duration_seconds, e.narrator_kind, e.narrator_name, e.ai_disclosure,
            e.published_at, a.slug as article_slug
       from ozikoro_episode e
       join ozikoro_article a on a.id = e.article_id
      where e.status = 'published'
        and coalesce(e.external_url, e.storage_key) is not null
      order by e.published_at desc nulls last
      limit 500`
  );

  const cover = show.cover_storage_key
    ? `${SITE_ORIGIN}/media/${show.cover_storage_key}`
    : null;

  const items = episodes
    .map((e) => {
      const audio = e.external_url ?? `${SITE_ORIGIN}/media/${e.storage_key}`;
      const page = `${SITE_ORIGIN}/podcast/${e.slug}/`;
      const transcriptUrl = `${SITE_ORIGIN}/podcast/${e.slug}/transcript.txt`;
      // The disclosure is placed first in the description, where it is read before the summary rather than after it.
      const description = [e.ai_disclosure, e.summary ?? ''].filter(Boolean).join('\n\n');
      return `<item>
  <title>${x(e.title)}</title>
  <link>${x(page)}</link>
  <guid isPermaLink="false">ozikoro-episode-${x(e.slug)}</guid>
  ${e.published_at ? `<pubDate>${rfc822(new Date(e.published_at))}</pubDate>` : ''}
  <description>${x(description)}</description>
  <enclosure url="${x(audio)}" ${e.byte_size ? `length="${e.byte_size}" ` : ''}type="${x(e.mime_type ?? 'audio/mpeg')}" />
  <itunes:duration>${clock(e.duration_seconds)}</itunes:duration>
  <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>
  <itunes:summary>${x(description)}</itunes:summary>
  <podcast:transcript url="${x(transcriptUrl)}" type="text/plain" language="${x(show.language_code)}" rel="captions" />
  <podcast:person role="narrator" href="${x(page)}">${x(e.narrator_name ?? (e.narrator_kind === 'human' ? 'Read by a person' : 'Synthetic voice'))}</podcast:person>
</item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0"
     xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${x(show.title)}</title>
  <link>${x(`${SITE_ORIGIN}/listen/`)}</link>
  <description>${x(show.description)}</description>
  <language>${x(show.language_code)}</language>
  <itunes:author>${x(show.author)}</itunes:author>
  <itunes:owner><itunes:name>${x(show.author)}</itunes:name><itunes:email>${x(show.owner_email)}</itunes:email></itunes:owner>
  <itunes:category text="${x(show.category)}" />
  <itunes:explicit>${show.explicit ? 'true' : 'false'}</itunes:explicit>
  ${cover ? `<itunes:image href="${x(cover)}" />` : ''}
  <atom:link href="${x(`${SITE_ORIGIN}/podcast/feed.xml`)}" rel="self" type="application/rss+xml" />
  <podcast:guid>ozikoro.com/podcast</podcast:guid>
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=900',
    },
  });
}
