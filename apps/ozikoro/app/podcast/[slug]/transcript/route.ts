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
 *
 * ── AND THE PAGE NOW CARRIES THE RECORD'S OWN FURNITURE, NOT JUST ITS WORDS ───────────────────────────
 *
 * The owner, reporting the page this route served: *"please it should be exactly like the articles, with
 * images, voice record as it is in the article, and basically everything like normal history content."*
 * Measured on the two pages before this change, the transcript carried **0 `<img>`, 0 `<audio>` and none of
 * `sx-article-image`, `sx-listen-panel`, `sx-related-list`, `sx-article-utility` or `sx-article-entities`**,
 * while the article carried all six.
 *
 * **THE FIX IS NOT A BUILD, IT IS THE SAME SCREEN FILLED THE SAME WAY.** Both routes already read
 * `public/design/screens/article.html`; the difference was entirely in the fill, because the transcript's fill
 * removed the record's photograph, its player, its reading toolbar, its entity row and its related reading on
 * the argument that they belong to the record. **A transcript IS the record, in its spoken form** — so the
 * route now reads the record's own featured media, its own topic siblings and its own entity links, exactly as
 * `apps/ozikoro/app/[slug]/route.ts` reads them, and hands them to a `fillTranscript` that fills the article's
 * furniture by calling `fillArticle`. See `packages/ozikoro/src/transcript-page.ts` for what a transcript
 * legitimately keeps that an article does not.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  agreementRefusalDocument,
  designScreenLinks,
  designScriptPaths,
  episodeTranscriptHeader,
  fillTranscript,
  loadSeoVerification,
  mediaPath,
  playableEpisodeSql,
  seoHead,
  withSeoHead,
  withdrawnInstitutionalAccess,
} from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import { hasCapability } from '@/lib/access';

export const dynamic = 'force-dynamic';

const SCREEN = join(process.cwd(), 'public', 'design', 'screens', 'article.html');

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.replace(/\/$/, '');
  const db = await getDb();

  /*
   * ── THE EPISODE, AND THE RECORD'S OWN FURNITURE BESIDE IT ────────────────────────────────────────────
   *
   * A transcript is not a second record: it is THE SAME RECORD IN ITS SPOKEN FORM. So the page needs the
   * record's own photograph and its rights line, the record's own topic siblings as related reading, and the
   * clan, town or place the record is linked to — all of them exactly as the record's own page states them,
   * because a reader who follows a designed button to a transcript has not left the record.
   *
   * ⚠️ THE THREE QUERIES BELOW ARE THE ARTICLE ROUTE'S OWN, REPEATED. `apps/ozikoro/app/[slug]/route.ts`
   * builds the same `RealArticle` inline — its record select, its related select and its entity select are
   * character for character what is written here — because there is no shared loader for them yet. **That is a
   * second copy and it can drift**, which is the fault class this repository has recorded four times; the fix
   * is to lift the three into `archive.ts` as one loader both routes call, and it is named here rather than
   * left implicit so the next change cannot miss it. It was not done in this change because it means editing
   * the article route as well.
   *
   * The point of the repetition is that this page must show the SAME photograph, the SAME rights line, the
   * SAME related histories and the SAME entity chips as `/<slug>/` — `getRelatedArticles` in `archive.ts`
   * looks like the shared function for the second of those and is NOT: it matches the same topic OR an
   * overlapping label, and measured on this archive it returns a different three records for both folklore
   * episodes than the record page shows. A transcript whose "related reading" differed from the article's
   * would be the drift this page exists to remove.
   */
  const row = await db.one<{
    slug: string; title: string; transcript: string; narrator_kind: string | null; narrator_name: string | null;
    ai_disclosure: string; external_url: string | null; external_service: string | null;
    external_direct_audio: boolean | null; storage_key: string | null; duration_seconds: number | null;
    article_id: number; article_slug: string; record_published_at: Date | null; modified_at: Date | null;
    access_tier: string; image: string | null; image_alt: string | null; image_credit: string | null;
    image_licence: string | null;
  }>(
    `select e.slug, e.title, e.transcript, e.narrator_kind, e.narrator_name, e.ai_disclosure,
            e.external_url, e.external_service, e.external_direct_audio, e.storage_key, e.duration_seconds,
            a.id as article_id, a.slug as article_slug, a.access_tier, a.modified_at,
            a.published_at as record_published_at,
            (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as image,
            (select m.alt_text from ozikoro_media m where m.id = a.featured_media_id) as image_alt,
            (select coalesce(m.credit, m.creator) from ozikoro_media m where m.id = a.featured_media_id) as image_credit,
            (select m.licence from ozikoro_media m where m.id = a.featured_media_id) as image_licence
       from ozikoro_episode e
       join ozikoro_article a on a.id = e.article_id
      where e.slug = $1 and ${playableEpisodeSql('e')}
        and a.status = 'published' and a.is_page = false`,
    [slug]
  );
  if (!row) return new Response('Not found', { status: 404 });

  /*
   * ── THE RECORD'S SECOND MARK GATES ITS TRANSCRIPT TOO ─────────────────────────────────────────────
   *
   * A transcript is the record's own words — the same text the reading page serves — so a record held by
   * agreement whose transcript answered 200 would be the tier leaking through a second door. **This route
   * already composes one gate of the record's, its status and its approval; this adds the other.** The
   * refusal is the same screen the record's own address serves, composed by the one function both call.
   */
  if (row.access_tier === 'by_agreement') {
    const viewer = await getCurrentAccount().catch(() => null);
    const mayRead = viewer ? await hasCapability(viewer.account.id, 'read_restricted') : false;
    if (!mayRead) {
      const withdrawn = viewer ? await withdrawnInstitutionalAccess(db, viewer.account.id) : null;
      return new Response(
        agreementRefusalDocument(await readFile(SCREEN, 'utf8'), {
          path: `/podcast/${row.slug}/transcript/`,
          withdrawn,
          verification: await loadSeoVerification(db),
        }),
        { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
      );
    }
  }

  const path = `/podcast/${row.slug}/transcript/`;
  const recordPath = `/${row.article_slug}/`;

  const related = await db.rows<{ slug: string; title: string; topic: string | null; image: string | null }>(
    `select a.slug, a.title, t.name as topic,
            (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as image
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
      where a.status = 'published' and a.is_page = false and a.id <> $1
        and (t.id is not distinct from (select topic_id from ozikoro_article where id = $1))
      order by a.published_at desc nulls last limit 3`,
    [row.article_id]
  );

  const entities = await db.rows<{ kind: string; slug: string; name: string; role: string }>(
    `select e.kind, e.slug, e.name, ae.role
       from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
      where ae.article_id = $1
      order by ae.role, e.name`,
    [row.article_id]
  );

  /*
   * THE CAPTION STATES THE RIGHTS STATE, WHICH IS `unknown` FOR ALL 3,488 MEDIA ITEMS.
   *
   * Not a permission nobody granted, and not the design's "rights must be verified" — the archive's own
   * recorded position, composed the way the record's own page composes it so the two lines cannot differ.
   */
  const rights = row.image_licence
    ? `Licence ${row.image_licence}`
    : 'No licence recorded · reuse not granted';
  const caption = [row.image_credit, rights].filter(Boolean).join(' · ');

  /*
   * ── THE PLAYER, AND THE TWO STATES THAT ARE NOT A PLAYER ─────────────────────────────────────────────
   *
   * Three cases, and `fillArticle` already knows all three — this page only decides which of them it is in:
   *
   *   * **a file of ours** — `storage_key` — becomes `<audio data-listen-audio>` and `audio-listen.js` drives
   *     the panel. THIS IS THE OWNER'S "voice record as it is in the article", and it is the whole of what he
   *     asked for;
   *   * **an external URL that a fetch established serves audio** — `external_direct_audio` — is also a file
   *     this page can play, by the same test the article route applies;
   *   * **an external PAGE address** (a Spotify episode link) is not an `<audio src>`, so the panel says where
   *     the audio is held and the control is a link that opens it. `fillArticle` writes that; nothing here
   *     invents a fourth case.
   *
   * **AND AN EPISODE WITH NO AUDIO AT ALL GETS NO PANEL**, because `fillArticle` removes an inert player
   * rather than leaving a button that answers with silence. `playableEpisodeSql` — not
   * `playableEpisodeAudioSql` — is what gates this route, and that difference is deliberate: the transcript is
   * the record's words, and a reader must be able to read them even when there is nothing to hear.
   */
  const hasAudio = Boolean(row.external_url ?? row.storage_key);
  const directAudio = hasAudio && (row.external_url ? row.external_direct_audio === true : true);

  let html: string;
  try {
    html = fillTranscript(await readFile(SCREEN, 'utf8'), {
      title: row.title,
      recordPath,
      path,
      header: episodeTranscriptHeader(row),
      text: row.transcript,
      image: row.image ? mediaPath(row.image) : null,
      imageAlt: row.image_alt ?? row.title,
      caption,
      rights,
      /*
       * ── THE RECORD'S OWN DATES, NOT THE EPISODE'S, AND THIS WAS A MEASURED FAULT ─────────────────────
       *
       * The reading toolbar prints `<dt>Published</dt>`, and on an article that is the RECORD's publication
       * date. The first version of this page passed the episode's `published_at` instead — the timestamp of
       * the narration, which is when the text-to-speech was rendered and approved, not when the history was
       * published. Measured on the two pages side by side:
       *
       *     /igbo-folklore-…/                Published 3 November 2025     (the record)
       *     /podcast/…/transcript/           Published 3 October 2026      (the episode row)
       *
       * **One record cannot have two publication dates on two of its own pages**, and the transcript's is the
       * wrong fact: an operational timestamp presented as the date a history was published. So the toolbar —
       * and the head below it — take the record's dates, and the page carries exactly one publication date for
       * the same words. The episode's own timestamp still exists in `ozikoro_episode` for the pipeline; it is
       * simply not a fact about the record.
       */
      published: row.record_published_at ? new Date(row.record_published_at).toISOString() : null,
      updated: row.modified_at ? new Date(row.modified_at).toISOString() : null,
      reference: `OZ-H-${String(row.article_id).padStart(4, '0')}`,
      entities,
      /*
       * EACH RELATED IMAGE GOES THROUGH `mediaPath` TOO. The row carries a `storage_key`, which is a disk path
       * — `ozikoro/11231-umunede-king.jpeg` — and a page needs `/media/…`.
       */
      related: related.map((r) => ({
        title: r.title,
        href: `/${r.slug}/`,
        topic: r.topic,
        image: r.image ? mediaPath(r.image) : null,
      })),
      episode: hasAudio
        ? {
            url: row.external_url ?? `/media/${row.storage_key}`,
            directAudio,
            service: row.external_service,
            seconds: row.duration_seconds,
            narratorKind: row.narrator_kind ?? '',
            narratorName: row.narrator_name,
            disclosure: row.ai_disclosure,
            transcript: row.transcript,
          }
        : null,
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
   * ── THE TWO SCRIPTS THE RESTORED FURNITURE NEEDS, AND WHY THE PLAYER IS DEAD WITHOUT THEM ────────────
   *
   * The design's `reader.js` reads a page aloud with the browser's own voice. **`audio-listen.js` is what
   * hands the panel to the record's real recording instead** — it is the difference between the owner pressing
   * ▶ Listen and hearing his own narration and pressing it and hearing a robot read the text, which is the
   * fault that file was written for. It acts only where `[data-listen-audio]` exists, so it is added only when
   * there is a file to play; an external page-shaped address gets an anchor and no player, and the script
   * would find nothing.
   *
   * `article-share.js` is unconditional, as it is on the record's own page: the toolbar's share controls are
   * `reader.js`'s, and this file is what turns a blocked popup into a visible outcome instead of a click that
   * appears to have done nothing. It does nothing at all on a page with no `[data-share]`.
   *
   * **THE SAME TWO FILES, AND THE SAME CONDITION, AS `apps/ozikoro/app/[slug]/route.ts`.** The toolbar and the
   * player on this page are the article's own, so they need the article's own scripts; a page that restored
   * the markup and left the behaviour behind would be a page of controls that look right and do nothing, which
   * is the fault this archive has recorded four times.
   */
  const extraScripts = ['<script src="/article-share.js" defer></script>'];
  if (directAudio) extraScripts.push('<script src="/audio-listen.js" defer></script>');
  html = html.replace('</body>', `${extraScripts.join('')}</body>`);

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
        /*
         * AND THE SAME DATE THE TOOLBAR PRINTS, NOT THE EPISODE'S. See the note at the fill above: the page
         * carries the record's words, so it carries the record's publication date — and a `<meta>` that
         * disagreed with the visible `<dt>Published</dt>` beneath it would be the sentence and the thing
         * disagreeing, which is the fault class this archive records most often.
         */
        published: row.record_published_at ? new Date(row.record_published_at).toISOString() : null,
        trail: [
          { name: 'Ozikoro', path: '/' },
          { name: 'Listen', path: '/listen/' },
          { name: row.title, path },
        ],
      },
      ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css'],
      /*
       * A TRANSCRIPT IS A PAGE OF THIS SITE WITH ITS OWN ADDRESS AND ITS OWN canonical, so it carries the
       * owner's verification tokens like every other page. `seoHead` is the one head builder; this is the
       * third of its callers to hand the tokens over.
       */
      await loadSeoVerification(db)
    )
  );

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
