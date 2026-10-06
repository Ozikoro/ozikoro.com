/**
 * THE TRANSCRIPT A READER READS: THE ARCHIVE'S READING PAGE, WITH THE EPISODE'S OWN WORDS IN IT.
 *
 * ── THE FAULT THIS ANSWERS, IN TWO ROUNDS ─────────────────────────────────────────────────────────
 *
 * **Round 352.** `/listen/` draws `Read the transcript` as a `btn btn-ghost` — and a `btn` in this design's
 * language is a control that leads to a destination. It led to `/podcast/<slug>/transcript.txt`: **200,
 * `text/plain`, `X-Content-Type-Options: nosniff`, and 11,836 bytes of correct prose with no masthead, no nav,
 * no footer, no typography and no way back.** The content was right and the destination was the fault. The
 * owner's words for what he saw were "complete code", which is a fair description of a wall of monospace text
 * that belongs to nothing a reader recognises.
 *
 * **Round 356, and the owner reporting again.** The page this file builds answered that — the words, inside
 * the design's reading frame — **and it was still not an article.** Measured against
 * `/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/`:
 *
 *     the transcript   17,797 B   <img> 0   <audio> 0   sx-article-image 0   sx-listen-panel 0
 *                                 sx-related-list 0   sx-article-utility 0   sx-article-entities 0
 *     the article      22,028 B   <img> 4   <audio> 1   all five of those classes present
 *
 * and the owner's words for it: *"please it should be exactly like the articles, with images, voice record as
 * it is in the article, and basically everything like normal history content."*
 *
 * **The first fix removed the article's own furniture and called it a decision.** The reasoning was that the
 * photograph, the player, the references, the citation and the related reading are *the record's*, at *the
 * record's address*, and that a second copy here would be two addresses for the same material. The first two
 * thirds of that reasoning is right and the conclusion does not follow from it: **a transcript is not a
 * different record — it is the same record, in its spoken form.** The record's own photograph is the
 * photograph of the thing this text is; the record's own approved recording is the audio *of these words*;
 * the entities and the related reading are facts about the same record. A reader who follows a designed
 * button to a transcript has not left the record, and a page that strips the record's furniture off does not
 * become more honest — it becomes a page with nothing on it. That is what the owner saw.
 *
 * ── WHAT THIS FUNCTION IS NOW: THE ARTICLE'S FILL, WITH THE TRANSCRIPT'S OWN WORDS ─────────────────
 *
 * `fillArticle` is the archive's one builder for this screen — the photograph in `figure.sx-article-image`,
 * the reading toolbar and the dates inside it, the player in `section.sx-listen-panel`, the entity chips in
 * `.sx-article-entities` and the related cards in `.sx-related-list`. **This page does not have a second
 * version of one of them.** `fillTranscript` calls `fillArticle` with the record's own furniture and then
 * changes exactly four things, each because a transcript is not an article:
 *
 *   1. **the eyebrow says `Transcript`** — the design's own slot for what the reader is holding;
 *   2. **the byline slot carries the header sentence** (`episodeTranscriptHeader`) rather than an author,
 *      because the one line that must be under the title on a transcript is what kind of text this is, and no
 *      authorship of it is claimed;
 *   3. **the prose is the transcript**, not the record's body — the whole of it, one paragraph per
 *      blank-line-separated block, with no heading inserted into a record of speech;
 *   4. **the panel's `Read the transcript` link is removed**, because on this page it is a link to this page.
 *
 * Everything else — the photograph and its rights line, the player and its disclosure, the share/print
 * toolbar, the published dates, the entity row, the related histories — arrives from `fillArticle` and is
 * therefore byte-identical in shape to the record's own page by construction rather than by imitation.
 *
 * ── WHAT IS STILL DELIBERATELY NOT HERE, AND WHY THE ARGUMENT SURVIVES WHERE IT DOES ───────────────
 *
 * `section.provenance#sources` and `section#citation` are the record's **references and its citation**, and
 * they do not come back with the rest. Two reasons, and both are about these two sections rather than about
 * furniture in general:
 *
 *   * there is nothing to put in them. The sources on a record are extracted from *its* prose
 *     (`extractReferences` reads the sentences under the record's own "Sources" heading), and a transcript
 *     column holds no such section. A sources block here would either be empty or would be the record's
 *     references presented as the transcript's.
 *   * the citation the design draws is *the record's* — `Author. "Title." Ozikoro, year. <record address>` —
 *     and this page's own address is different. Printing the record's citation on the transcript page is
 *     exactly the "two addresses for the same material" fault this file's first round was right about, and
 *     there is no citation builder for a transcript, so composing one here would be inventing it.
 *
 * **So the sidebar's four dead anchors stay dead-anchor-free**: the panel is rebuilt to hold the destinations
 * that exist on this page (`#transcript`, `#listen`, `#related`, the record and `/listen/`) and no other, and
 * `transcript-page.test.ts` reads every `href="#…"` on the served page and fails if one does not resolve.
 *
 * ── THE IMAGE AND THE AUDIO ARE THE RECORD'S OWN, AND NEITHER IS EVER SUBSTITUTED ─────────────────
 *
 * `RealTranscript.image` is the episode's own article's featured media and nothing else. **Where the record
 * has none, `fillArticle` removes `figure.sx-article-image`** — which is the same rule the record's own page
 * applies, and is a real empty state rather than a photograph borrowed from a different record. The audio is
 * the episode's own approved recording: `fillArticle` writes `<audio data-listen-audio>` only for a file, an
 * anchor that names the service for a page-shaped address, and removes the panel entirely when there is
 * nothing to play. This page adds no third case.
 *
 * ── THE EXCEPTION, STATED RATHER THAN HIDDEN ─────────────────────────────────────────────────────
 *
 * The panel keeps the design's heading, `Listen to this article`. The article page does not rewrite it either,
 * and rewording a heading the design wrote is not this work's to do; it is recorded here so the next reader of
 * this file knows it was seen and left.
 */
import { sanitiseArchiveHtml } from './content.ts';
import { clearExampleMaterial, esc, fillArticle, replaceContainer, type RealArticle } from './design-fill.ts';

/**
 * One episode's transcript, as the page that publishes it needs it.
 *
 * THE TWO HALVES OF THIS TYPE, AND WHY THEY ARE BOTH HERE.
 *
 * The first five fields are the transcript's own — the words, what kind of text they are, and the two
 * addresses that identify the episode and the record it is the spoken form of. The rest are the RECORD's own
 * furniture, read from the record rather than from the episode, and they exist so that this page can be
 * filled by `fillArticle` without this module holding a second opinion about any of it.
 *
 * `image: null`, `related: []` and `episode: null` are all real states and all are handled by `fillArticle`,
 * not here: a record with no featured image carries no figure, a record with no related histories carries no
 * related section, and an episode with no approved recording carries no player.
 */
export type RealTranscript = {
  /** The episode's own title, which is the record's title as the spoken form states it. */
  title: string;
  /** The record's own address — where the record page lives. Also the transcript link's basis. */
  recordPath: string;
  /** This transcript's own address, for the page's own metadata and links. */
  path: string;
  /** What kind of text this is, from `episodeTranscriptHeader`. Never written here. */
  header: string;
  /** The episode's own `transcript` column, exactly as the record holds it. */
  text: string;
  /** The record's own featured photograph, served from `/media/`. `null` when it has none. */
  image: string | null;
  /** The record's own alternative text. */
  imageAlt: string;
  /** The record's own rights line for the photograph, exactly as its page states it. */
  caption: string | null;
  /** The rights state on its own, used when the record has no credit to put in front of it. */
  rights: string;
  /** The record's own publication and revision dates, as the reading toolbar prints them. */
  published: string | null;
  updated: string | null;
  /** The archive's own reference for the record, e.g. `OZ-H-0001`. */
  reference: string;
  /** The clan, town, place or people the record is linked to. */
  entities: RealArticle['entities'];
  /** Other histories from the record's own topic, by the record page's own rule. */
  related: RealArticle['related'];
  /** The episode's own approved recording, or `null` when there is nothing to play. */
  episode: RealArticle['episode'];
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
   * page built entirely from one, and the sidebar's own contents link would point at the wrapper instead.
   *
   * **THE SCROLL OFFSET COMES WITH IT, AND FOR THE SAME REASON.** `.sx-reader-header` is `position: sticky;
   * top: 0`, and `fillArticleProse` gives `#opening`, `#record`, `#context`, `#sources`, `#listen` and
   * `#related` a `scroll-margin-top` so a fragment's target is not put underneath the header. This paragraph
   * is the one that survives the prose replacement below, so it is the one that has to carry the offset —
   * the value is `fillArticleProse`'s own.
   */
  return safe.replace('<p>', '<p id="opening" class="dropcap" style="scroll-margin-top:6rem">');
}

/**
 * Fill the design's reading page with one episode's transcript and the record's own furniture.
 *
 * Every pattern finds its element by what identifies it — an `id`, or the design's own class — rather than by
 * the example words inside it, because **this function has been told to expect a template and the template
 * ships with its own demonstration text.** A pattern anchored on "Read when video is difficult to load" or
 * "In this history" would match the design today and nothing the day the design's words change.
 */
export function fillTranscript(html: string, t: RealTranscript): string {
  /*
   * ── THE ARTICLE'S OWN FILL RUNS FIRST, AND IT IS THE WHOLE OF THE FURNITURE ────────────────────────
   *
   * See the note at the top of this file. The photograph, its caption and its share/print toolbar, the player
   * and its disclosure, the published dates, the entity chips and the related cards are all built by
   * `fillArticle` — one implementation, two pages.
   *
   * `clearExampleMaterial` runs in front of it for the same reason the other fills call it: it removes the
   * design's walkthrough banner, its "Design demonstration" footer span and its hard-coded copyright year, and
   * `fillArticle` only removes the `<p class="example-flag">` form of the first of those.
   *
   * ── THE THREE FIELDS THAT ARE PASSED EMPTY, MEASURED RATHER THAN ASSUMED ──────────────────────────
   *
   * `body` is empty because the prose block is replaced below with the transcript's own words: handing the
   * transcript to `fillArticle` would run the article's reference extraction and its lead-paragraph split over
   * a record of speech, and both answers would then be thrown away. `context`, `reference` and
   * `archiveTotals` are read by **no line of `fillArticle`** — verified by reading the function, whose whole
   * body uses neither name except in comments — so nothing that reaches a reader can come from them. They are
   * supplied because the type requires them, and `topic` is `null` because this page writes its own eyebrow.
   */
  let out = fillArticle(clearExampleMaterial(html), {
    title: t.title,
    topic: null,
    author: null,
    published: t.published,
    updated: t.updated,
    image: t.image,
    imageAlt: t.imageAlt,
    caption: t.caption,
    rights: t.rights,
    body: '',
    path: t.recordPath,
    context: '',
    reference: t.reference,
    entities: t.entities,
    archiveTotals: { published: 0, withPeriod: 0, withSource: 0 },
    related: t.related,
    episode: t.episode,
  });

  /*
   * 1. THE EYEBROW STATES WHAT THE READER IS ON, IN THE DESIGN'S OWN SLOT FOR IT.
   *
   * `fillArticle` has just written the record's topic there (`Folklores · Published history`). **On this page
   * the one thing the slot has to say is that these words are a transcript** — that is the distinction the
   * owner asked to keep, and it is not negotiable in either direction: the fault was the missing article
   * furniture, not the presence of the transcript's own label.
   */
  out = out.replace(/(<div class="sx-article-title">\s*<p class="eyebrow">)[\s\S]*?(<\/p>)/, '$1Transcript$2');

  /*
   * 2. THE BYLINE SLOT CARRIES THE HEADER SENTENCE RATHER THAN A BYLINE.
   *
   * `p.sx-article-byline` is the design's one line directly under the title, and on an article it is the
   * author. **On a transcript the one line that has to be there is what kind of text this is** — the sentence
   * three kinds of episode cannot share — and the transcript is of the record, whose own page carries the
   * author. So the slot is used for the thing the reader most needs under the title, and no authorship of this
   * text is implied by putting it there. `fillArticle` has just written `By <strong>Ozikoro</strong>` here.
   */
  out = out.replace(/(<p class="sx-article-byline">)[\s\S]*?(<\/p>)/, `$1${esc(t.header)}$2`);

  /*
   * 3. THE DESIGN'S `.prose`, FILLED WITH THE EPISODE'S OWN WORDS INSTEAD OF THE RECORD'S BODY.
   *
   * The `id` is what the sidebar's own first link points at. The container's *contents* are replaced and not
   * the container, so the design's `div.prose` — with the reading measure, the type scale and the drop cap —
   * stays exactly where the design put it.
   *
   * AND THIS IS WHERE THE RECORD'S REFERENCE AND CITATION SECTIONS GO, because they are inside this container
   * and the transcript has neither. See the note at the top of the file; the sidebar is rebuilt below so that
   * no link is left pointing at what this line removes.
   */
  out = out.replace('<div class="prose">', '<div class="prose" id="transcript" style="scroll-margin-top:6rem">');
  out = replaceContainer(out, '<div class="prose" id="transcript"', transcriptProse(t.text));

  /*
   * 4. THE PLAYER'S OWN `Read the transcript` LINK, WHICH ON THIS PAGE LEADS TO THIS PAGE.
   *
   * `fillArticle` writes it into the panel's last line for the article page, where it is the way in. Here the
   * reader is already there, so the anchor goes — and **the line that names the narrator stays**, because the
   * voice is a fact about the recording this page's words are the spoken form of. The paragraph is dropped
   * only when the anchor was the whole of it.
   *
   * THE ANCHOR IS MATCHED BY ITS ADDRESS AND NOT BY ITS WORDING, so the removal cannot depend on a sentence
   * `fillArticle` may one day reword — and the address is the one `fillArticle` composed from the record path,
   * which is `/podcast/<record>/transcript/` whichever the episode's own slug is.
   *
   * IT IS TWO MOVES RATHER THAN ONE, AND THAT IS DELIBERATE. A single pattern for "the paragraph holding this
   * anchor" can start at the *disclosure* paragraph above it — the engine only has to stretch its inner match
   * across `</p><p …>` to reach the lookahead — and the panel would then be rewritten from the wrong element.
   * Matching the anchor alone cannot do that, and the second move is anchored to the panel's own last
   * paragraph — `<p class="small muted">`, plain text, immediately before `</section>` — with a `[^<]*` inner
   * so it can only ever be the line the anchor left behind.
   */
  out = out.replace(/<a href="\/podcast\/[^"]*\/transcript\/">[^<]*<\/a>/, '');
  out = out.replace(
    /(<p class="small muted">)([^<]*)(<\/p>)(?=\s*<\/section>)/,
    (whole: string, open: string, inner: string, close: string) => {
      const line = inner.replace(/^\s*·\s*|\s*·\s*$/g, '').trim();
      return line ? `${open}${line}${close}` : '';
    }
  );

  /*
   * 5. THE DESIGN'S OWN ASIDE, WITH THIS PAGE'S OWN CONTENTS.
   *
   * The design drew two panels: `In this history`, a chapter list for an article, and `Reading tools`, whose
   * four links are `#listen`, `#sources`, `#citation` and `#related`. **`#record`, `#context`, `#sources` and
   * `#citation` are the record's and are not on this page** — a link that scrolls nowhere is the fault round
   * 338 recorded — so the list is rebuilt rather than left, in the design's own
   * `<aside><details><summary><nav>` shape.
   *
   * **The player and the related section ARE on this page now, so their links are kept rather than dropped**,
   * and each is emitted only when its target was really built: `fillArticle` removes the player when there is
   * nothing to play and this function removes the related section when the record has no related histories, so
   * a conditional link is the only kind that cannot dangle. `transcript-page.test.ts` reads every fragment on
   * the served page and fails if one does not resolve.
   */
  const record = esc(t.recordPath);
  const tools = [
    t.episode ? '<a href="#listen">Listen</a>' : '',
    t.related.length > 0 ? '<a href="#related">Related reading</a>' : '',
  ].filter(Boolean).join('');
  out = replaceContainer(
    out,
    '<aside>',
    '<details open><summary>This transcript</summary><nav>' +
      '<a href="#transcript">The whole transcript</a>' +
      `<a href="${record}">The record and its audio</a>` +
      '<a href="/listen/">All recordings</a>' +
      '</nav></details>' +
      (tools ? `<details><summary>Reading tools</summary><nav>${tools}</nav></details>` : '')
  );

  /*
   * 6. THE RELATED SECTION, WHEN THE RECORD HAS NO RELATED HISTORIES.
   *
   * `fillArticle` fills `.sx-related-list` from the record's own topic and **does nothing when there are none**
   * — which, on a template, leaves the design's three demonstration histories (Ute-Okpu, Udara, Umunede) on a
   * served page as though they were this record's neighbours. The archive's rule is that a provenance is never
   * invented, and a related card is a provenance of reading. So the section goes, exactly as this page removed
   * it before, and the sidebar's own link to it is not emitted above.
   */
  if (t.related.length === 0) {
    out = out.replace(/<section[^>]*\bclass="sx-related"[^>]*\bid="related"[^>]*>[\s\S]*?<\/section>/, '');
  }

  /*
   * 7. THE DESIGN'S OWN END-OF-READING CONTROL, AND THE TWO WAYS OUT.
   *
   * `nav.sx-page-turn` is the reader frame's last element: on an article it is `All histories` / `End of
   * article` / `Explore folklore`. **It is the design's own place for exactly the pair of destinations this
   * page must carry** — the record it is the transcript of, and the recordings library it was reached from —
   * so the two links the brief requires are drawn here in the design's markup rather than in a new row, and
   * `End of transcript` is the page saying what it is at the foot as well as at the head.
   */
  const turn =
    `<a href="${record}">← The record</a>` +
    '<span>End of transcript</span>' +
    '<a href="/listen/">All recordings →</a>';
  out = replaceContainer(out, '<nav class="sx-page-turn"', turn);

  return out;
}
