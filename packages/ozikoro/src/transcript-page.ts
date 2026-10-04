/**
 * THE TRANSCRIPT A READER READS: THE DESIGN'S OWN READING PAGE, WITH THE EPISODE'S OWN WORDS IN IT.
 *
 * ── THE FAULT THIS ANSWERS ────────────────────────────────────────────────────────────────────────
 *
 * `/listen/` draws `Read the transcript` as a `btn btn-ghost` — and a `btn` in this design's language is a
 * control that leads to a destination. It led to `/podcast/<slug>/transcript.txt`: **200, `text/plain`,
 * `X-Content-Type-Options: nosniff`, and 11,836 bytes of correct prose with no masthead, no nav, no footer, no
 * typography and no way back.** The content was right and the destination was the fault. The owner's words for
 * what he saw were "complete code", which is a fair description of a wall of monospace text that belongs to
 * nothing a reader recognises.
 *
 * **AND ROUND 351 CALLED THIS PAGE FINE.** It followed `/listen/`'s row destination — the article — read its
 * `h1`, and concluded "its row destination is the article, so the writing is one click away — not the same
 * fault". It never followed the transcript link. **A page's controls are not measured by measuring the page**,
 * and this file exists because that link now has somewhere designed to land.
 *
 * ── WHICH SCREEN DRAWS THIS, AND WHY IT IS THE ARTICLE'S ──────────────────────────────────────────
 *
 * **No design screen draws a transcript page.** The 52 screens under `public/design/screens/` hold no
 * `transcript.html`; `listen.html` mentions transcripts in its lede and its source note but draws no panel for
 * one; `oral-recordings.html` is a recording listing; `watch-video.html`'s transcript area is the *film*
 * screen's block and round 352 removed it from every film page precisely because no film has a transcript.
 *
 * **The design does answer the question, though, and its answer is the article reader.** `listen.html`'s own
 * featured card draws `<a class="btn btn-ghost" href="article.html">Read the transcript</a>` — the one control
 * in the deliverable that says exactly these words, pointing at the one screen the deliverable uses for long
 * prose. So this page is built on `public/design/screens/article.html`, which is the archive's worked example
 * for prose: `sanitiseArchiveHtml` into the design's own `.prose` class, inside the design's own reader
 * chrome. **Nothing is invented here; the frame, the classes and the links are the design's.**
 *
 * ── WHAT IS KEPT, AND WHAT COMES OFF ──────────────────────────────────────────────────────────────
 *
 * KEPT — every element that is the design's reading frame and true of this page:
 *
 *   * `header.sx-reader-header` (masthead + wordmark) and its `nav[aria-label="Reader navigation"]` — the
 *     design's own chrome, made absolute by `designScreenLinks`;
 *   * `main#article[data-reader] > article.sx-book-reader` and `header.sx-article-opening`, with the `h1` the
 *     record's own title;
 *   * the design's `<aside><details><summary><nav>` shape, filled with this page's own contents: the
 *     transcript, the record it belongs to, and `/listen/`;
 *   * `div.prose`, the design's own long-prose container, with its `#opening` paragraph and its `dropcap`
 *     class doing what the design drew them for;
 *   * `nav.sx-page-turn`, the design's own end-of-reading control, carrying the way back to the record and to
 *     the recordings library.
 *
 * REMOVED, EACH FOR A REASON THAT IS ABOUT THIS PAGE AND NOT ABOUT TIDINESS:
 *
 *   * `figure.sx-article-image` — the record's photograph, its credit line and its share/print utility. **The
 *     transcript page has no featured image**, and this is the same removal `fillArticle` already makes for a
 *     record that has none, so the rule is the article fill's rather than a new one;
 *   * `section.sx-listen-panel#listen` — the player. **This page does not build a second player**: the audio,
 *     its disclosure and its controls are on the record's own page, and a copy of `fillArticle`'s player logic
 *     here would be the second copy of a gate that this repository has paid for four times. The aside and the
 *     page-turn both lead to the record, which is where it plays;
 *   * `section.provenance#sources`, `section#citation` and `section.sx-related#related` — the record's
 *     references, its citation and its related reading. **They are the record's, at the record's address**, and
 *     repeating them here would give the archive two addresses for the same material — the fault
 *     `/listen.html` versus `/listen/` already recorded. The way back to them is the record link;
 *   * the design's invented chapter list and reading tools, replaced rather than removed: see the aside.
 *
 * The transcript's own words are the episode's `transcript` column and nothing else. **No speaker, timestamp,
 * language or heading is invented**, because a transcript is a timed, speaker-attributed record and this text
 * is the article's words prepared for speech — the sentence that says which of those a reader is holding is
 * `episodeTranscriptHeader` in `narration.ts`, written once and carried by both the file and the page.
 */
import { sanitiseArchiveHtml } from './content.ts';
import { clearExampleMaterial, esc, replaceContainer } from './design-fill.ts';

/** One episode's transcript, as the page that publishes it needs it. */
export type RealTranscript = {
  /** The episode's own title, which is the record's title as the spoken form states it. */
  title: string;
  /** The record's own address — where its audio, photograph, references and citation live. */
  recordPath: string;
  /** This transcript's own address, for the page's own metadata and links. */
  path: string;
  /** What kind of text this is, from `episodeTranscriptHeader`. Never written here. */
  header: string;
  /** The episode's own `transcript` column, exactly as the record holds it. */
  text: string;
};

/**
 * The transcript's text as the archive's own paragraphs.
 *
 * THE ONE TRANSFORMATION, AND WHY IT IS THIS ONE. The column holds plain text separated by blank lines; the
 * design's `.prose` wants elements. **A paragraph per blank-line-separated block is the only markup added, and
 * not one character inside a block is touched** — the blocks are escaped, never re-wrapped, never joined,
 * never trimmed of their internal spacing. That is what makes the first and last lines of this page's
 * transcript the same bytes as the first and last lines of the `.txt`, which is a claim this file's test
 * measures rather than asserts.
 *
 * ── THE ORDER, WHICH IS THE ARCHIVE'S OWN WITH ONE STEP IN FRONT OF IT ────────────────────────────
 *
 * `sanitiseArchiveHtml` runs the way it runs over a record's body on the article route, and `esc` runs first
 * because a `body_html` column does not need it and this one does: **the transcript column is plain text, and
 * plain text handed to a sanitiser is text a sanitiser may read as markup.** The measured case is a
 * quotation containing an angle bracket — passed through raw, the sanitiser sees an unknown tag, drops it, and
 * deletes the word inside it, which is a page that has edited the record to make it printable. Escaped first,
 * no such run can begin, and nothing is dropped.
 *
 * **AND THE ESCAPING SURVIVES THE SANITISER UNCHANGED**, which is why both can run: `escapeHtml` in
 * `content.ts` escapes an ampersand only when it does not already begin an entity, so the `&amp;` written here
 * is left exactly as it is rather than becoming `&amp;amp;`. Measured on the three transcripts this archive
 * holds, which carry no angle bracket and one ampersand between them; a transcript that carries more behaves
 * the same way.
 */
function transcriptProse(text: string): string {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+$/, ''))
    .filter((block) => block.trim() !== '');
  if (blocks.length === 0) return '';
  const safe = sanitiseArchiveHtml(blocks.map((block) => `<p>${esc(block)}</p>`).join('\n'));
  /*
   * THE DESIGN'S OWN OPENING TREATMENT, WRITTEN AFTER THE SANITISER BECAUSE IT CANNOT COME THROUGH IT.
   *
   * **The sanitiser drops `id`, `class` and `style` from every element on purpose** — that is what makes it a
   * sanitiser, and `content.ts` says so at the line. So the design's `dropcap` and the `#opening` anchor are
   * written onto the first paragraph afterwards, which is exactly how `fillArticleProse` writes them onto the
   * design's own frame on an article: the design's markup is never sanitised, only the record's words are.
   * Without this the drop cap the design drew for a record's opening paragraph would be missing from the only
   * page built entirely from one, and the aside's own contents link would point at the wrapper instead.
   */
  return safe.replace('<p>', '<p id="opening" class="dropcap">');
}

/**
 * Fill the design's reading page with one episode's transcript.
 *
 * Every pattern finds its element by what identifies it — an `id`, or the design's own class — rather than by
 * the example words inside it, because **this function has been told to expect a template and the template
 * ships with its own demonstration text.** A pattern anchored on "Read when video is difficult to load" or
 * "In this history" would match the design today and nothing the day the design's words change.
 */
export function fillTranscript(html: string, t: RealTranscript): string {
  // The design's walkthrough banner, its footer year and its "Design demonstration" span, by the same rule the
  // other fills use. It is not exported for this page's sake; it is the one place those three replacements live.
  let out = clearExampleMaterial(html);

  // The eyebrow states what the reader is on, in the design's own slot for it.
  out = out.replace(/(<div class="sx-article-title">\s*<p class="eyebrow">)[\s\S]*?(<\/p>)/, '$1Transcript$2');
  out = out.replace(/(<div class="sx-article-title">[\s\S]*?<h1>)[\s\S]*?(<\/h1>)/, `$1${esc(t.title)}$2`);

  /*
   * THE BYLINE SLOT CARRIES THE HEADER SENTENCE RATHER THAN A BYLINE.
   *
   * `p.sx-article-byline` is the design's one line directly under the title, and on an article it is the author.
   * **On a transcript the one line that has to be there is what kind of text this is** — the sentence three
   * kinds of episode cannot share — and the transcript is of the record, whose own page carries the author. So
   * the slot is used for the thing the reader most needs under the title, and no authorship of this text is
   * implied by putting it there.
   */
  out = out.replace(/(<p class="sx-article-byline">)[\s\S]*?(<\/p>)/, `$1${esc(t.header)}$2`);

  // The record's photograph and its share/print utility: see the note at the top of the file.
  out = out.replace(/<figure class="sx-article-image">[\s\S]*?<\/figure>/, '');

  /*
   * THE DESIGN'S OWN ASIDE, WITH THIS PAGE'S OWN CONTENTS.
   *
   * The design drew two panels: `In this history`, a chapter list for an article, and `Reading tools`, whose
   * four links are `#listen`, `#sources`, `#citation` and `#related` — **four anchors this page no longer
   * carries**, since the player, the references, the citation and the related reading are the record's and
   * remain at the record's address. A link that scrolls nowhere is the fault round 338 recorded, so the list is
   * replaced rather than left.
   *
   * What replaces it is the same markup the design drew — `<aside><details><summary><nav>` — holding the three
   * destinations this page really has, and the transcript's own anchor so the panel's first link is the thing
   * the panel is named after. `#transcript` is an id written onto the design's own `.prose` wrapper below; the
   * empty-anchor problem cannot arise because the wrapper always exists.
   */
  const aside =
    '<details open><summary>This transcript</summary><nav>' +
    '<a href="#transcript">The whole transcript</a>' +
    `<a href="${esc(t.recordPath)}">The record and its audio</a>` +
    '<a href="/listen/">All recordings</a>' +
    '</nav></details>';
  out = replaceContainer(out, '<aside>', aside);

  // The design's `.prose`, filled with the episode's words. The id is what the aside's first link points at.
  out = out.replace('<div class="prose">', '<div class="prose" id="transcript" style="scroll-margin-top:6rem">');
  out = replaceContainer(out, '<div class="prose" id="transcript"', transcriptProse(t.text));

  // The record's references, its citation and its related reading: the record's, at the record's address.
  out = out.replace(/<section[^>]*\bclass="provenance"[^>]*\bid="sources"[^>]*>[\s\S]*?<\/section>/, '');
  out = out.replace(/<section[^>]*\bid="citation"[^>]*>[\s\S]*?<\/section>/, '');
  out = out.replace(/<section[^>]*\bclass="sx-related"[^>]*\bid="related"[^>]*>[\s\S]*?<\/section>/, '');
  // The player. See the note at the top of the file: this page points at it rather than copying it.
  out = out.replace(/<section[^>]*\bid="listen"[^>]*>[\s\S]*?<\/section>/, '');

  /*
   * THE DESIGN'S OWN END-OF-READING CONTROL, AND THE TWO WAYS OUT.
   *
   * `nav.sx-page-turn` is the reader frame's last element: on an article it is `All histories` / `End of
   * article` / `Explore folklore`. **It is the design's own place for exactly the pair of destinations this
   * page must carry** — the record it is the transcript of, and the recordings library it was reached from —
   * so the two links the brief requires are drawn here in the design's markup rather than in a new row.
   */
  const turn =
    `<a href="${esc(t.recordPath)}">← The record</a>` +
    '<span>End of transcript</span>' +
    '<a href="/listen/">All recordings →</a>';
  out = replaceContainer(out, '<nav class="sx-page-turn"', turn);

  return out;
}
