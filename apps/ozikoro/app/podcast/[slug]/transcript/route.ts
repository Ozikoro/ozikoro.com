/**
 * ONE EPISODE'S TRANSCRIPT, AS A PAGE — `/podcast/<slug>/transcript/`.
 *
 * WHY THIS ADDRESS
 *
 * `/podcast/<slug>/transcript.txt` is the address the episode's transcript was published at, and the owner's
 * report is that a reader who follows a designed button to it lands on a raw text file. **The page therefore
 * sits directly under the address the file already occupies** — `/podcast/<slug>/transcript/` — so nothing is
 * invented, every link that meant "this episode's transcript" can be pointed at it with one segment changed,
 * and the pair reads the way the archive's own address rules expect: the directory is the reader's page, and
 * the `.txt` is the file.
 *
 * THE `.txt` IS NOT DELETED AND IS NOT REDIRECTED, AND THAT IS A DECISION
 *
 * The feed's own `<podcast:transcript url="…/transcript.txt" type="text/plain" />` is what Spotify reads, and
 * it is a claim about a FILE: a 301 to an HTML page would break the one consumer that field exists for. So
 * both addresses stay and they are a pair with two jobs — **the page is for readers, the `.txt` is for anything
 * that wants the raw text** — and the shared sentence that says what kind of text this is
 * (`episodeTranscriptHeader`) is what stops them from describing the same words two different ways.
 *
 * WHY A ROUTE HANDLER RATHER THAN A PAGE
 *
 * The same reason the article route gives: the design screens are complete HTML documents with their own
 * masthead, footer and stylesheets, and a Next page would render inside the application's layout and wrap the
 * design in chrome that is not the design. A route handler returns the design's own document, filled.
 *
 * THE GATE IS THE EPISODE'S, AND THE RECORD'S IS ADDED BESIDE IT
 *
 * `playableEpisodeSql('e')` is the same condition the article, the feed and the `.txt` compose: published AND
 * approved by a person. **AND THE RECORD MUST BE REACHABLE TOO** — `a.status = 'published' and not a.is_page` —
 * because the one outbound link this page cannot do without is the way back to the record, and a page whose
 * "The record" link answers 404 is the wrong-destination fault this whole change exists to remove. Measured:
 * the three episodes with transcripts all satisfy both, and `/listen/` could not have listed them otherwise.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  designScreenLinks,
  designScriptPaths,
  episodeTranscriptHeader,
  fillTranscript,
  playableEpisodeSql,
  seoHead,
  withSeoHead,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const SCREEN = join(process.cwd(), 'public', 'design', 'screens', 'article.html');

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.replace(/\/$/, '');
  const db = await getDb();

  const row = await db.one<{
    slug: string; title: string; transcript: string; narrator_kind: string | null;
    external_url: string | null; article_slug: string; published_at: Date | null;
  }>(
    `select e.slug, e.title, e.transcript, e.narrator_kind, e.external_url,
            a.slug as article_slug, e.published_at
       from ozikoro_episode e
       join ozikoro_article a on a.id = e.article_id
      where e.slug = $1 and ${playableEpisodeSql('e')}
        and a.status = 'published' and a.is_page = false`,
    [slug]
  );
  if (!row) return new Response('Not found', { status: 404 });

  const path = `/podcast/${row.slug}/transcript/`;
  const recordPath = `/${row.article_slug}/`;

  let html: string;
  try {
    html = fillTranscript(await readFile(SCREEN, 'utf8'), {
      title: row.title,
      recordPath,
      path,
      header: episodeTranscriptHeader(row),
      text: row.transcript,
    });
  } catch (error) {
    console.error('transcript fill failed:', error);
    return new Response('Not found', { status: 404 });
  }

  /*
   * THE DESIGN'S OWN SCRIPTS AND LINKS, AT THE ADDRESSES THIS ROUTE SERVES FROM.
   *
   * `article.html` loads `../reader.js` and `../mobile-nav.js` and its menu is written the design's way
   * (`home.html`, `archive-index.html`, `listen.html`). At `/podcast/<slug>/transcript/` every one of those
   * resolves one level shallower and 404s — a dead control with no trace in the markup — so the two rewrites
   * the article route calls are called here, and `designScreenLinks` is told this page's address so the frame's
   * own in-page anchors land here rather than at the site root.
   */
  html = designScriptPaths(html);
  html = designScreenLinks(html, path);

  /*
   * THE HEAD IS THE ARCHIVE'S OWN, NOT THE DESIGN'S WALKTHROUGH.
   *
   * Served untouched, the design's `<title>` is "Nwagu Aneke — Ozikoro article reader": a page about this
   * episode announcing itself as a record it is not. `kind: 'article'` is what this page is in schema terms —
   * one transcript, with a publisher and a date — and `noindex` is deliberately NOT set: this is the reader's
   * address for the words, and a search engine that cannot reach it sends the reader back to the file.
   */
  html = withSeoHead(
    html,
    seoHead(
      {
        path,
        title: `${row.title} — transcript`,
        description: 'The transcript of this episode, in the archive’s own words.',
        kind: 'article',
        published: row.published_at ? new Date(row.published_at).toISOString() : null,
        trail: [
          { name: 'Ozikoro', path: '/' },
          { name: 'Listen', path: '/listen/' },
          { name: row.title, path },
        ],
      },
      ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css']
    )
  );

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
