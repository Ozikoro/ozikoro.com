/**
 * Filling the design's screens with the archive's real records, without editing the design.
 *
 * THE RULE THIS FILE OBEYS
 *
 * **Not one byte of `public/design/` changes.** The deliverable is the visual contract, and the way to keep it
 * is to treat each screen as a TEMPLATE whose example regions are replaced at request time. The HTML this file
 * returns is the design's own markup, character for character, with the contents of specific elements swapped.
 *
 * WHAT CAN AND CANNOT BE FILLED
 *
 * The design's example entries carry four chips: Place, Period, Source, Sources-attached. **The archive has
 * data for exactly one of those.** 188 towns exist as entities and 205 articles are linked to one; **no article
 * has a period and none has a source type** — the migration carried neither. So a real entry is rendered with
 * the chips the record can support and **none of the others**, rather than with a plausible spread of values.
 * An entry with one chip is what the archive actually holds; an entry with four would be an invention.
 *
 * THE EXAMPLE FLAG
 *
 * Every screen opens with `<p class="example-flag">Design mock — … example material.</p>`. **That statement is
 * true of the design and false of a page filled with real records**, so it is removed on the screens this file
 * fills. **That is not a design change: it is the removal of a sentence that would otherwise be a lie.** The
 * flag stays on every screen this file does not fill.
 */
import type { Db } from '@ozituma/db';
import { EXTERNAL_AUDIO_LABELS, isExternalAudioService } from './external-audio.ts';
import { designScreenLinks } from './design-paths.ts';
import { normaliseHeadingLevels, sanitiseArchiveHtml } from './content.ts';

/** An entry as the archive holds it. Every field except `title` may be absent, and then its chip is omitted. */
export type RealEntry = {
  title: string;
  href: string;
  summary: string | null;
  place: string | null;
  period: string | null;
  source: string | null;
  attached: number;
};

/**
 * A servable path for a stored media key.
 *
 * **A WordPress filename can contain spaces** — `11237-Igbo Folk Idioms in Caribbean Phrase.pdf` is real — and
 * an unencoded space truncates a URL at the space, so the file 404s. Each segment is encoded and the `/`
 * separators are kept, since a key like `ozikoro/1234-name.jpg` is a path, not a name.
 */
export function mediaPath(key: string): string {
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** HTML-escape, because a title can contain `&`, `<` and the Igbo characters. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One entry, in the design's own markup.
 *
 * The four chip spans and their classes are the design's (`chip-place`, `chip-period`, `chip-oral`). **A chip is
 * emitted only when the record supports it**, so the element list is the archive's state rather than the
 * design's example.
 */
export function renderEntry(e: RealEntry): string {
  const chips: string[] = [];
  if (e.place) chips.push(`<span class="chip chip-place"><span class="k">Place</span> ${esc(e.place)}</span>`);
  if (e.period) chips.push(`<span class="chip chip-period"><span class="k">Period</span> ${esc(e.period)}</span>`);
  if (e.source) chips.push(`<span class="chip chip-oral"><span class="k">Source</span> ${esc(e.source)}</span>`);
  if (e.attached > 0) {
    chips.push(`<span class="chip"><span class="k">Sources</span> ${e.attached} attached</span>`);
  }
  return `<article class="entry">
          <h3><a href="${esc(e.href)}">${esc(e.title)}</a></h3>
          <p>${esc(e.summary ?? '')}</p>
          ${chips.length ? `<div class="chips">\n            ${chips.join('\n            ')}\n          </div>` : ''}
        </article>`;
}

/** The design's entries container, which is replaced wholesale. */
const ENTRIES_WRAPPER = '      <div style="margin-top:var(--s-6)">';

/**
 * Remove the example flag: true of the design, false of a page filled with real records.
 *
 * The footer's year is corrected here too, so that **every filled screen** gets it rather than only the ones
 * that go through `clearExampleMaterial`. The deliverable hard-codes `© 2026 Ozi Ikoro Limited.` on all 52
 * screens because it was written in one year; a served page that keeps claiming it is the smallest and most
 * ordinary kind of false content on the site. One replace, applied to a string every fill already passes
 * through.
 */
function dropExampleFlag(html: string): string {
  return html
    .replace(/\s*<p class="example-flag">[\s\S]*?<\/p>/, '')
    .replace(/© 2026 Ozi Ikoro Limited\./g, `© ${new Date().getUTCFullYear()} Ozi Ikoro Limited.`);
}

/**
 * Fill `archive-index.html`.
 *
 * Two regions change: the rail's filter counts, which are the design's example figures, and the entries
 * container, which holds four invented histories. **Everything between them is untouched.**
 */
export function fillArchiveIndex(html: string, opts: {
  entries: RealEntry[];
  ethnic: { name: string; count: number }[];
  topics: { slug: string; name: string; count: number }[];
  total: number;
}): string {
  let out = dropExampleFlag(html);

  // --- the entries: the design's four example histories become the archive's real ones.
  const start = out.indexOf(ENTRIES_WRAPPER);
  if (start !== -1) {
    const open = out.indexOf('>', start) + 1;
    // Find this div's matching close by depth, so nested divs inside entries do not end it early.
    let depth = 1, i = open;
    while (i < out.length && depth > 0) {
      const nextOpen = out.indexOf('<div', i);
      const nextClose = out.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen + 4; }
      else { depth -= 1; i = nextClose + 6; }
    }
    const inner = opts.entries.map(renderEntry).join('\n        ');
    out = out.slice(0, open) + '\n        ' + inner + '\n      ' + out.slice(i - 6);
  }

  // --- the rail's counts, which the design gives as example figures.
  for (const t of opts.topics) {
    // `href="archive-index.html?topic=slug"` … `>Name <span>NN</span>`
    const re = new RegExp(
      `(href="archive-index\\.html\\?topic=${t.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]{0,120}?)<span[^>]*>\\d+</span>`
    );
    out = out.replace(re, `$1<span class="muted">${t.count}</span>`);
  }

  /*
   * --- THE COUNT ABOVE THE PAGINATION, WHICH WAS THE DESIGN'S OWN AND STAYED WRONG.
   *
   * The design prints `Showing 1–4 of 24` because it draws four example records. The fill replaces those
   * four with the archive's own, and **the sentence labelling them was left behind**: the served page read
   * "Showing 1–4 of 24" above twenty-four real histories, which is worse than a placeholder because it looks
   * like a measurement. `Previous` and `Next` beneath it have no paging behind them either, so they are
   * marked `Not built yet` by the link transform; this line is made to agree with them.
   *
   * The number of records shown is `entries.length`, not a figure from the design, and the total is the
   * archive's own count.
   */
  out = out.replace(
    /<span class="small muted">Showing \d+[–-]\d+ of \d+<\/span>/,
    `<span class="small muted">Showing the ${opts.entries.length} most recent of ` +
      `${opts.total.toLocaleString('en-GB')} records · paging is not built yet</span>`
  );
  return out;
}

/**
 * A real film: one YouTube id the archive's own published articles embed, with the facts its card can carry.
 *
 * WHAT EACH FIELD IS, AND WHERE IT COMES FROM — because a card is a claim with a record behind it, and every
 * value here is read from a record rather than fetched from YouTube:
 *
 *   * `id` — the 11-character id, exactly as it stands in the article body.
 *   * `title` — the film's title as the archive recorded it, or, where the archive recorded none, the title
 *     of the record that holds it.
 *   * `titleFrom` — which of those two `title` is.
 *   * `topic` — the holding record's topic, or `null` where the record has none.
 *   * `records` — how many published articles embed the film. One card per film, not per embedding.
 *   * `href` — the archive record the film is held in, which is the most recently published one.
 */
export type RealFilm = {
  id: string;
  title: string;
  titleFrom: 'film' | 'record';
  topic: string | null;
  records: number;
  href: string;
};

/**
 * HOW MANY CARDS ONE PAGE OF `/watch/` DRAWS.
 *
 * The owner's words: *"reduce the list that shows on the page to showing 15 videos, while the rest can be
 * seen when you click next"*. **15 is not an arbitrary shape for this grid**: `.sx-video-grid` is
 * `grid-template-columns: repeat(3, minmax(0,1fr))` (`styles/showcase.css:440`), so 15 is five whole rows of
 * three, with no half-row left at the foot of a page. The brief's own precedent for a page size is
 * `/archive/`'s `PAGE_SIZE = 24` (`apps/ozikoro/app/archive/page.tsx:41`); the size differs because the card
 * is a poster frame three-across rather than a stacked entry, and the owner named the number.
 */
export const WATCH_PAGE_SIZE = 15;

/**
 * THE FILMS ON `/watch/` THAT ARE MUSIC, AND WHY EACH ONE IS — one entry per film, keyed by its YouTube id.
 *
 * THE OWNER'S WORDS: *"on the watch, remove the musics."* This map IS the exclusion: `fillWatch` drops every
 * film whose id is here, and **nothing else changes** — no row is deleted, no card is re-titled, no genre is
 * printed on the page. **To put a film back, delete its line here.** That is the whole reversal, and it is
 * why the decision sits in the fill rather than in the database or in the design.
 *
 * WHAT EACH ONE IS, FROM THE RECORD THAT EMBEDS IT AND FROM THE FILM'S OWN TITLE — not from its name.
 * Every id below is embedded by a record whose subject is a piece of music, and the film's own recorded
 * title is the title of that piece:
 *
 *   * `8fD66TzRmEg` and `E-bbdBIH4Wg` — **two recordings by the Peacocks International Guitar Band**,
 *     embedded by the band's own biography, *"Peacocks International Guitar Band: Crafting the Sound of
 *     Nigerian Guitar-Band Highlife"* (topic Biography). The record's own words around the first are
 *     "guitar lines, steady highlife rhythms suitable for dancing"; its labels are `Highlife`,
 *     `Guitar-Band Highlife`, `Dance Music`, `Nigerian Popular Music`. The films' titles — "The Peacocks
 *     International Guitar Band - Feresirima" and "Eddie Quansa" — are the band-and-track form a record
 *     release is titled in. **These are the recordings, not films about the band.**
 *   * `Gk5jUcXeUHc` — *"Seun Rere (Live)"*, embedded by *"Christy Essien-Igbokwe: The Voice of Nigeria's
 *     Musical Golden Age"* (Biography). The record's labels are `Seun Rere`, `Lady of Songs`, `Music Icon`,
 *     `highlife music` — the film's own title is one of the record's own labels, which is the archive
 *     naming the song.
 *   * `NcBE2UH8WOc` — *"Time Na Money"*, embedded by *"Mike Okiri: The Pioneer of Pidgin in Music"*
 *     (Biography); labels `Pidgin Music`, `African music`, `Afrobeat`, `Highlife`.
 *   * `5a6tJhLpPa4` — *"Beautiful Woman"*, embedded by *"Cloud 7: A Deep Dive Into Funk Music From The
 *     East"* (Biography). The record writes *"With their breakout hit 'Beautiful Woman'"*, and `Beautiful
 *     Woman` is one of its own labels: the film is the hit the record is about.
 *   * `az6b5avH_Zc` — *"King Ja Ja - Sing Out Barbados"*, embedded by *"Bajan Folk Music About Jaja of
 *     Opobo"*. **This is the one case the archive's own taxonomy decides by itself**: that record is one of
 *     the six filed under the `Discography` topic, which exists for records of music and for nothing else.
 *
 * WHAT WAS *NOT* EXCLUDED, AND WHY — the boundary is drawn deliberately, because an archival film removed
 * for having "dance" in its title is worse than one music video left on the page:
 *
 *   * the five **dance and festival films** (`LL8YX0pXzdI` ILA OSO, `SHPEwGDOI7c` Ojeh & Arishi,
 *     `jOMjbchyNXg` Mmili Nkisi, `H2Ch-R3EZkA` Égwú Àmàlà, `la4vThM0MUo` Egwu Ogene, `NIR5CcOUoas` and
 *     `lAtHAK-5WZw` Nkwa Ụmụagboghọ, `lg_dSLOKywk` and `0g2hAF8NdOA` Ikpirikpi-ogu, `ekO2hKFsbEk`,
 *     `c9hMdWsZDJY` and `jVNIwrESgQ4` Egedege, `u4ZadZ5hyWs` and `_w9v21ndnm4` Atilogwu) — **left in.**
 *     Each is a filmed performance of a dance or a festival, held by a record filed under Cultural Heritage
 *     about that tradition, not a record release. **The archive's own labels cannot draw this line**:
 *     measured, six of those nine records are labelled with music — `the-egedege-dance-…` carries `Igbo
 *     Music`, `Drums`, `Ekwe`, `Ogene`; `egwu-ogene-…` carries `Ogene music`; `mmili-nkisi-…` and
 *     `ojeh-arishi-…` carry `traditional music`. A label rule would have removed the dances with the songs.
 *     So the line is drawn on what the film is, and where it is genuinely a performance that is both danced
 *     and played, **the film stays and is reported** — the owner can take one off in a second and cannot
 *     recover one deleted on a guess.
 *   * `bPXKduoup8I` — *"Cabildo Carabali Isuama in Santiago, Cuba"*, held by *"Carabalí Isuama: Preserving
 *     Igbo Heritage in Afro-Cuban Culture"* (Historical Studies; labels `cabildo`, `Abakuá society`,
 *     `Afro-Cuban culture` — no music label). **Ambiguous: a cabildo performance may be music and dance at
 *     once, and the record does not say which. Left in, and reported to the owner.**
 *   * everything else the archive embeds — oral history, Ńdébé, the Omu, the war-dance festival — is not a
 *     record release and is untouched.
 */
export const WATCH_MUSIC_FILMS: ReadonlyMap<string, string> = new Map([
  ['8fD66TzRmEg', 'a Peacocks International Guitar Band highlife recording, held by the band\'s own biography'],
  ['E-bbdBIH4Wg', 'a Peacocks International Guitar Band highlife recording, held by the band\'s own biography'],
  ['Gk5jUcXeUHc', 'Christy Essien-Igbokwe\'s "Seun Rere (Live)", named by the record\'s own label "Seun Rere"'],
  ['NcBE2UH8WOc', 'Mike Okiri\'s "Time Na Money", held by "The Pioneer of Pidgin in Music"'],
  ['5a6tJhLpPa4', 'Cloud 7\'s "Beautiful Woman", the record\'s own "breakout hit" and one of its labels'],
  ['az6b5avH_Zc', 'a Bajan folk song about Jaja of Opobo, held by one of the six records filed under Discography'],
]);

/**
 * One video card, in the design's own markup — `button.sx-video-card` with its data attributes, its poster
 * frame from `i.ytimg.com`, and its three text slots filled.
 *
 * **The design's card is a button rather than a link because it plays in place**, and that behaviour is the
 * design's. This reproduces the element exactly.
 *
 * THE THREE SLOTS, AND WHY THESE ARE THE HONEST VALUES FOR AN ARCHIVE FILM
 *
 * The design's card names a **category** in the small-caps line (it writes "Archive film", "Story film",
 * "Conversation"), a **title** in the `<h3>`, and a **publisher** in the `<p>`. The archive's record carries a
 * different set of facts, so each slot is filled with the fact it can carry:
 *
 *   * small-caps line — **the topic** the holding record is filed under (`Cultural Heritage`, `Biography`,
 *     `Ethnohistory`, …), or `Ozikoro archive film` where the record has no topic. A topic is what the
 *     design's line is for, and it is recorded rather than inferred.
 *   * `<h3>` — **the film's title**, which for most of these is the title the archive's own `<iframe>` carries
 *     in its `title` attribute ("Eddie Quansa", "Seun Rere (Live)", "Cabildo Carabali Isuama in Santiago,
 *     Cuba"). Where the archive recorded no title of its own — the embed is titled "YouTube video player", or
 *     has no title at all — the holding record's title is used, which is the only title the record carries.
 *     `titleFrom` records which of the two it was, so the distinction is never lost.
 *   * `<p>` — **the publisher is not recorded.** The archive's rule is that an unrecorded field is stated
 *     rather than filled, so the slot says so and then names what the archive does hold: how many records
 *     carry the film. Nothing here is fetched from YouTube.
 */
export function renderFilmCard(f: RealFilm): string {
  const id = esc(f.id);
  const title = esc(f.title);
  const category = f.topic ? esc(f.topic) : 'Ozikoro archive film';
  const held = f.records > 1 ? ` · held in ${f.records} records` : '';
  const meta = `${category}${held} · Plays on this page`;
  const provenance = f.records > 1
    ? `Held in ${f.records} Ozikoro archive records · publisher not recorded`
    : `Held in the Ozikoro archive · publisher not recorded`;
  /*
   * AND THE FILM'S OWN PAGE, AS AN ATTRIBUTE RATHER THAN AS A LINK.
   *
   * The card is a `<button>` — the design's own element, and `button.sx-video-card` is how it is laid out — so
   * a link cannot live inside it. The address travels on the card and `watch.js` is extended to put it on the
   * inline player's control when the film is opened. **Only the archive's cards carry it**: the design's six
   * cards are films the archive does not hold, `/watch-video/?v=<their id>` is a 404, and the extended script
   * hides the control for them rather than offering a page that does not exist.
   */
  return `<button type="button" class="sx-video-card" data-video-id="${id}" data-video-title="${title}" data-video-meta="${meta}" data-video-page="/watch-video/?v=${id}" aria-pressed="false"><span class="sx-video-thumb"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Thumbnail for ${title}"><span class="sx-video-play" aria-hidden="true">▶</span></span><span class="sx-video-meta">${category} · Plays on this page</span><h3>${title}</h3><p>${provenance}</p></button>`;
}

/**
 * The label WordPress's block editor writes when it has resolved an embed but has no title for it. A card
 * titled "YouTube video player" would be a card claiming a film is called that, so it is refused and the
 * holding record's title is used instead.
 */
const GENERIC_EMBED_TITLES = new Set(['youtube video player', 'video player', 'youtube']);

/**
 * Every film the archive's published articles embed, one entry per film.
 *
 * WHY THIS PARSES THE ARTICLE BODY AND NOT ONLY SQL — and what the SQL missed
 *
 * The archive's embeds are WordPress frames **with no `src`**: the address sits in `data-trx-lazyload-src` and
 * the film's own title sits in the `title` attribute beside it. A SQL `substring(a.body_html from
 * 'youtube…/embed/…')` does find the film — but **only the first one in each article**, because `substring`
 * without the `g` flag stops at its first match. Measured on the 19 published articles that embed one:
 * **25 embed frames carry 24 distinct ids**, and the first-match-only query produced **18**. Six films were
 * lost, silently, one per article that embeds more than one — `the-egedege-dance-a-traditional-dance-from-
 * unubi` alone embeds three, and `peacocks-international-guitar-band-…`, `nkwa-umuuagbogho-…`,
 * `the-ikpirikpi-ogu-war-dance-…` and `atilogwu-dance-…` each embed two.
 *
 * So the extraction is done here, over each record's own `body_html`, which is also the only way to reach the
 * embed's `title` attribute — the film's title as the archive holds it. Every value comes from a record.
 *
 * ORDER AND DE-DUPLICATION. `records` arrives newest-published first, so a film's first appearance is its most
 * recently published holding record and that is the one the card names. **One card per film**: the id
 * `jOMjbchyNXg` is embedded by two articles (`mmili-nkisi-day-…` and `nkisi-river-…`) and is one card that
 * says so, not two cards repeating it. `records` counts **articles**, so an article that embedded the same
 * film twice would still count once.
 *
 * A CITED LINK IS NOT A FILM, and the boundary is drawn deliberately. Six further addresses sit in these
 * bodies as prose — four reading "For a visual glimpse into the festival, you may watch the following video:
 * <address>", and three in a reference list ("Marre, J. (1985). Beats of the Heart: Konkombe. [Film].
 * Retrieved from <address>"). They are **not** extracted, for three reasons that are measurements rather than
 * preferences: the article page does not render a film at that point, so the archive holds an address and not
 * a film; one of the six, `7f81_erOkxM`, is **dead** — the thumbnail and the oEmbed both answer 404, so a card
 * for it would promise a film that does not exist; and a seventh, `kmux4aLXc1`, is **ten characters long**,
 * which is not a YouTube id at all, so the class contains malformed addresses as well as deleted ones. An
 * embedded film is on the page; a cited link is a reference.
 */
export function extractArchiveFilms(
  records: readonly { slug: string; title: string; topic: string | null; body_html: string | null }[]
): RealFilm[] {
  const byId = new Map<string, RealFilm>();
  const embed = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/i;
  const titleAttribute = /\btitle\s*=\s*"([^"]*)"/i;
  for (const record of records) {
    const seenInThisRecord = new Set<string>();
    for (const tag of (record.body_html ?? '').match(/<iframe\b[^>]*>/gi) ?? []) {
      const id = embed.exec(tag)?.[1];
      if (!id || seenInThisRecord.has(id)) continue;
      seenInThisRecord.add(id);
      const already = byId.get(id);
      if (already) {
        already.records += 1;
        continue;
      }
      const attribute = titleAttribute.exec(tag)?.[1];
      const recorded = attribute === undefined ? null : decodeEntities(attribute).trim();
      const ownTitle = recorded && !GENERIC_EMBED_TITLES.has(recorded.toLowerCase()) ? recorded : null;
      byId.set(id, {
        id,
        title: ownTitle ?? decodeEntities(record.title),
        titleFrom: ownTitle ? 'film' : 'record',
        topic: record.topic,
        records: 1,
        href: `/${record.slug}/`,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Fill `watch.html`'s film grid with the films the archive holds — **without removing the design's own**.
 *
 * WHY THIS APPENDS RATHER THAN REPLACES, WHICH IS THE FAULT IT FIXES
 *
 * The first version of this fill replaced the first grid's whole inner content with the archive's films. The
 * design's own first grid holds three cards, and two of them are the films the owner named in his own words:
 * **"[Re:]Entanglements Project — Faces | Voices"** and **"Unspoken Stories 1: Onyeso"**. Both were deleted
 * from the served page by the fill, and only the series grid's two survivors (`Unnamed Children`,
 * `Yainkain`) kept that project on `/watch/` at all. Measured on the served page before this change:
 * `Faces | Voices` — the one film the design gives a whole page at `/watch-video/` — was absent from the
 * index whose job is to list it.
 *
 * So the design's cards are kept and the archive's films are **added** after them, one card per film the page
 * does not already carry. The document is read for its own `data-video-id` values, so a film the design
 * already shows is not shown twice. **A document that already holds every film is returned unchanged**, so a
 * database that is down degrades to the design rather than to a page that has lost cards.
 *
 * TWO THINGS ADDED SINCE, AND NEITHER ONE UNPICKS THAT FIX
 *
 *   * **The music is not drawn.** `WATCH_MUSIC_FILMS` names six films the owner asked to be off the page and
 *     carries the reason for each; this function filters them out of the list it builds. The design's cards
 *     are read from the document and re-emitted, so the `[Re:]Entanglements` films survive by construction —
 *     and a page whose films are all music returns the design untouched, exactly as a page whose films are
 *     all already drawn does.
 *   * **The list is paged at `WATCH_PAGE_SIZE`,** with the page carried in `?page=`, and **a section whose
 *     cards are all on another page is not drawn on this page at all** — no heading, no empty grid and no note
 *     saying where its films went. The cards are distributed so that both of the design's own sections carry
 *     films on page 1, and an anchor the design's own markup points at is carried to the page that draws the
 *     section. **A heading with no cards under it is the fault this rule exists to remove**, and the owner
 *     found it by asking why "Unspoken Stories" was empty.
 */
export function fillWatch(html: string, films: RealFilm[], options: WatchFillOptions = {}): string {
  let out = dropExampleFlag(html);
  const grids = watchGrids(out);
  if (grids.length === 0) return out;

  /*
   * THE PAGE'S OWN CARDS, READ FROM THE PAGE.
   *
   * `watch.html` draws two grids: "Selected films" (`#new`, three cards) and the "Unspoken Stories"
   * collection (`#series`, three cards). The archive's films are added **after the first grid's own cards**,
   * which is the round-326 rule that stopped the fill deleting the owner's `[Re:]Entanglements` films. The
   * document is read for its own `data-video-id` values, so a film the design already shows is not shown
   * twice — and now against the whole document, because a film standing in both grids would be one film with
   * two cards.
   */
  const shown = new Set([...out.matchAll(/data-video-id="([^"]*)"/g)].map((m) => m[1]));
  const added = films.filter((f) => !shown.has(f.id) && !WATCH_MUSIC_FILMS.has(f.id));
  // The design's own page, with the design's own five unreachable controls taken off it. See the function.
  if (added.length === 0) return dropUnreachableFragments(out);

  /*
   * ONE ORDERED LIST OF EVERY CARD THE PAGE DRAWS, AND WHICH GRID EACH CARD BELONGS TO.
   *
   * **The design's cards and the archive's films are paged TOGETHER, as one list.** They are two sections of
   * one index, the owner asked for "the list that shows on the page" to be 15, and the page's own count of
   * its cards — "30 = the design's 6 + the archive's 24" — is the whole page, not one grid. Paging each grid
   * separately would repeat the second grid's three cards on every page of the first, so a film would stand
   * on page 1 and on page 2, and the number of cards across the pages would exceed the number of distinct
   * films.
   *
   * AND WHY THE DESIGN'S OWN SIX CARDS COME FIRST, AHEAD OF THE ARCHIVE'S EIGHTEEN.
   *
   * The archive's films are longer than a page, so **whichever section the sequence ends with is pushed
   * off page 1 entirely.** Ending with the second grid's three cards is exactly what made "Unspoken Stories"
   * a heading over an empty grid on page 1, with a note pointing at page 2 — the fault the owner reported.
   * The design's own six cards are the page's own selection, so they are drawn first, in the design's
   * document order: section 1's three, then section 2's three, then the archive's films appended to
   * section 1. **Both of the design's sections therefore carry cards on page 1** — twelve and three of the
   * fifteen — and page 2 carries section 1's remaining nine.
   *
   * **No film moves out of the section it belongs in.** The archive's films are still appended *after the
   * first grid's own cards*, which is round 326's rule that stopped the fill deleting the owner's
   * `[Re:]Entanglements` films, and they are still de-duplicated against the whole document's
   * `data-video-id` values.
   */
  const slots: { html: string; grid: number }[][] = grids.map((g, gi) =>
    watchCards(out.slice(g.open, g.close)).map((card) => ({ html: card, grid: gi })));
  const list = [...slots.flat(), ...added.map((f) => ({ html: renderFilmCard(f), grid: 0 }))];

  const totalPages = Math.max(1, Math.ceil(list.length / WATCH_PAGE_SIZE));
  const requested = Math.trunc(Number(options.page ?? 1));
  const page = Number.isFinite(requested) ? Math.max(1, requested) : 1;
  const beyond = Number.isFinite(requested) && requested > totalPages;
  const href = (p: number) => watchPageHref(options.query, p);

  /*
   * A SECTION WITH NO CARDS ON THIS PAGE IS NOT DRAWN ON THIS PAGE.
   *
   * A heading over an empty grid is the fault the owner found — *"why is the 'Unspoken Stories' now empty?"*
   * — and a sentence saying the films are on another page is still a section that reads as broken. So the
   * whole `<section>` goes: no heading, no empty grid, no note. **A film can stand on exactly one page**,
   * because the page size is fixed by the owner and a page's cards are a slice of one list, so a section
   * omitted here is drawn — heading and grid and films together — on the page that holds its cards.
   *
   * THE ANCHOR STILL RESOLVES, which is why removing the section is not the whole of it. The design's own
   * filter row links to `#new` and `#series`, and "Selected films" links to `#series` as well ("Browse
   * series ↓"), so a reader on a page without that section would click a link that goes nowhere. **Every
   * `href="#<id>"` whose section this page does not draw is rewritten to the page that DOES draw it**, with
   * the anchor kept on the end, so the link lands on the section itself. The address is built by the same
   * `href` helper the pager uses, so it is root-absolute for the same reason the pager is: this document's
   * head carries `<base href="/">` (`fillDashboardLinks`), against which a bare `?page=1` would resolve to
   * the front page.
   */
  let rebuilt = out;
  const omitted: { id: string; page: number }[] = [];
  // Backwards, so removing or filling one section cannot move an earlier section's offsets.
  for (let gi = grids.length - 1; gi >= 0; gi--) {
    const g = grids[gi]!;
    const mine = beyond ? [] : list.slice((page - 1) * WATCH_PAGE_SIZE, page * WATCH_PAGE_SIZE)
      .filter((s) => s.grid === gi).map((s) => s.html);
    if (mine.length === 0) {
      const open = rebuilt.lastIndexOf('<section', g.open);
      const close = open === -1 ? -1 : rebuilt.indexOf('</section>', g.close);
      if (open !== -1 && close !== -1) {
        const tag = rebuilt.slice(open, rebuilt.indexOf('>', open) + 1);
        const id = /\bid="([^"]*)"/.exec(tag)?.[1];
        // Where this section's films actually are. Derived from the list, never assumed to be page 2.
        const at = list.findIndex((s) => s.grid === gi);
        if (id !== undefined && at !== -1) {
          omitted.push({ id, page: Math.floor(at / WATCH_PAGE_SIZE) + 1 });
        }
        rebuilt = rebuilt.slice(0, open) + rebuilt.slice(close + '</section>'.length);
      }
      continue;
    }
    rebuilt = rebuilt.slice(0, g.open) + '\n  ' + mine.join('\n  ') + '\n' + rebuilt.slice(g.close);
  }

  /*
   * THE SECTION'S ADDRESS, CARRIED BY THE LINKS THAT POINTED AT ITS ANCHOR. `href="#series"` becomes
   * `href="/watch/?page=1#series"` — the page that draws the section, plus the anchor, so the browser
   * scrolls to it. `split`/`join` rather than a regular expression, because the id is read from the
   * document and must be matched literally.
   */
  for (const section of omitted) {
    const target = `${href(section.page)}#${section.id}`;
    rebuilt = rebuilt.split(`href="#${section.id}"`).join(`href="${esc(target)}"`);
  }

  /*
   * THE PAGER, IN THE DESIGN'S OWN MARKUP. `archive-index.html` draws one — `<nav class="row"
   * style="margin-top:var(--s-6);justify-content:space-between" aria-label="Pagination">` with the count on
   * the left and the two controls on the right — so that shape is reused rather than a second one invented.
   *
   * **BOTH CONTROLS ARE REAL LINKS AND NEITHER NEEDS SCRIPT.** `?page=2` is a plain GET: the middleware
   * carries the query to the fill route, the route reads it, and the page renders. `watch.js` builds the
   * inline player and has nothing to do with paging. An unavailable control is an inert `<span>` rather than
   * an `href="#"`, because a link that goes nowhere is the fault the owner found this morning — a 200 that
   * lands on the wrong thing.
   *
   * `btn-ghost` rather than the design pager's `btn-quiet`: `btn-quiet` is `color: var(--ink)` for the
   * light-page body it was drawn for, and this screen is `body.sx-watch-body` on `var(--night)`. `btn-ghost`
   * is the design's own night-body button — the watch page's "Open on YouTube" and "Close player".
   *
   * AND WHERE IT SITS: BETWEEN THE TWO SECTIONS, NOT AT THE FOOT OF THE PAGE.
   *
   * The owner's words: *"it is supposed to show under the main videos before unspoken stories own"*. So the
   * control is inserted **immediately after the first film section's `</section>`** — under the "Selected
   * films" grid and above the "Unspoken Stories" heading — rather than before `</main>`, which put it below
   * both sections and below the second section's films. On a page where the second section is not drawn
   * (page 2) the same rule puts it after the only section there, which is where it is still needed for
   * "Previous". On a page past the last there is no section left to stand under, so it falls back to the
   * end of `<main>`.
   *
   * **ONE CONTROL, NOT ONE PER SECTION.** The owner's sentence decides placement, and placement is all it
   * decides. Two independently paged sections over this index — 21 films and 3 — sharing the one `page`
   * parameter would draw 18 cards on page 1 and 6 on page 2 **and repeat the second section's three films
   * on the page of the first**, which is the double-count the flat list exists to prevent; giving the second
   * section its own parameter would break the published `?page=` contract and the 15-a-page count the owner
   * asked for. The second section holds three films, fewer than one page, so it has no page of its own to
   * control.
   */
  const pager = beyond
    ? `<div class="wrap"><p class="sx-source-note">There is no page ${page}: this index holds ${list.length} ` +
      `films in ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}. ` +
      // The links carry the colour of the note they stand in. The design's global `a { color: var(--link) }`
      // is drawn for a light page; inside `.sx-source-note` on `body.sx-watch-body` it measured 2.21:1
      // against the note's own background in headless Chrome, where the note's text measures 7.96:1. This is
      // the same `style="color:inherit"` the dashboard links use for the same reason.
      `<a href="${esc(href(1))}" style="color:inherit">Page 1</a>` +
      (totalPages > 1
        ? ` · <a href="${esc(href(totalPages))}" style="color:inherit">page ${totalPages}, the last</a>`
        : '') +
      `</p></div>`
    : totalPages > 1
      ? `<div class="wrap">${renderWatchPager(page, totalPages, list.length, href)}</div>`
      : '';
  if (pager !== '') {
    // The first film section left standing, as a range in `rebuilt`. `<section` alone would find the hero
    // and the inline player, so the class is matched.
    const first = rebuilt.indexOf('<section class="sx-watch-section"');
    const end = first === -1 ? -1 : rebuilt.indexOf('</section>', first);
    if (end === -1) {
      const closeMain = rebuilt.lastIndexOf('</main>');
      rebuilt = closeMain === -1
        ? rebuilt + pager
        : rebuilt.slice(0, closeMain) + pager + '\n' + rebuilt.slice(closeMain);
    } else {
      const after = end + '</section>'.length;
      rebuilt = rebuilt.slice(0, after) + '\n' + pager + rebuilt.slice(after);
    }
  }
  /*
   * THE WAY FROM A FILM THAT IS PLAYING TO THE FILM'S OWN PAGE.
   *
   * `/watch-video/` had no address a reader could reach from the grid: the cards are `<button>`s that play in
   * place by the design's own intent, and **the page a card's film deserves was one the grid never linked.**
   * A page nobody can reach is the same fault as a link that reaches nothing.
   *
   * The design's inline player already has an actions row — "Open on YouTube ↗" and "Close player" — and this
   * is one more control in it. **It is the only place on the page where the reader has already said which film
   * they mean**, which is why the address can be attached here and not to a card: `watch.js` is extended at
   * serve time (`extendWatchScript`, served from `/design-screen-assets/watch.js`) to point this link at
   * `/watch-video/?v=<id>` as it opens the film. **The design's own `watch.js` is not edited** — it is inside
   * `public/design/`, which is inviolable — and the mechanism is the one the market-days extension already
   * established for exactly this.
   *
   * WITHOUT JAVASCRIPT IT IS NOT SEEN AT ALL, because `#inline-player` is `hidden` until the script opens it.
   * That is why the default address is the page's own film rather than a dead `#`: the control is drawn only
   * where a player exists, and the one film it can honestly name before a card is chosen is the design's, whose
   * page is real.
   */
  rebuilt = rebuilt.replace(
    /(<div class="sx-inline-player-actions">)/,
    '$1<a class="btn btn-ghost" id="inline-player-page" href="/watch-video/" hidden>This Film’s Article</a>'
  );
  /*
   * AND LAST, THE FILTER ROW NAMES ONLY THE SECTIONS THIS PAGE DRAWS.
   *
   * It runs HERE, after the section that carries no cards on this page has been removed and its anchor moved
   * to the page that does hold it — so a later page keeps its working `/watch/?page=1#series` and loses only
   * the four names the deliverable never drew. See `dropUnreachableFragments`.
   */
  return dropUnreachableFragments(rebuilt);
}

/** What the fill needs to know about the request that asked for a page of `/watch/`. */
export type WatchFillOptions = {
  /** The `page` parameter, as it arrived. Anything that is not a page number in range is handled, not trusted. */
  page?: number;
  /** The request's own query string, so a pager link keeps every other parameter it was asked with. */
  query?: string;
};

/**
 * REMOVE EVERY IN-PAGE LINK WHOSE TARGET THIS DOCUMENT DOES NOT CARRY.
 *
 * **A nav item is not a section.** The owner's rule for this round, and the reason `/watch/`'s filter row is
 * the first caller: the design's own `watch.html` writes SEVEN controls —
 *
 *     New · Short histories · Oral traditions · Places & communities · Conversations · Series · A–Z
 *
 * — and draws exactly TWO sections for the first six of them to land on:
 *
 *     <section class="sx-watch-section" id="new">      "Selected films"
 *     <section class="sx-watch-section" id="series">   "Unspoken Stories"
 *
 * **`#short`, `#oral`, `#places` and `#conversations` name four sections the deliverable never drew**, in the
 * design or since. They are not "not yet built": there is no factory, gathering or interview section anywhere
 * in the file, and the page's own hero says the grid holds *"films, talks and remembered stories"*. So the
 * design intended five categories and drew two; the five names are aspirational, and a reader who pressed one
 * of the four got a page that did not move. `#series` is real but is **only on the page that draws it** —
 * `fillWatch` already carries that anchor to the page holding the section, which is why this pass runs after
 * that carry and cannot see it any more.
 *
 * It is deliberately a rule over the DOCUMENT rather than a list of four ids: a fourth section added to the
 * design, or a fifth name added to the row, is then handled without anyone remembering this function. **It is
 * also deliberately only about a bare `#fragment`** — `href="/watch/?page=1#series"` is a link to another page
 * that carries the section, which is a working control and not this pass's business.
 *
 * The caller decides where to run it: `fillWatch` runs it on BOTH of its exits, because the early return for
 * "every film is already drawn" is exactly the page a database that is down serves, and the design's markup
 * there carries the same five controls.
 */
export function dropUnreachableFragments(html: string): string {
  const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
  return html.replace(
    /<a\b[^>]*\bhref="#([^"]+)"[^>]*>[\s\S]*?<\/a>/g,
    (match: string, fragment: string) => (ids.has(fragment) ? match : '')
  );
}

/**
 * `watch.js`, with ONE line appended: the film's own page, pointed at the film that was just opened.
 *
 * WHY THIS EXISTS AND WHY IT IS AN EXTENSION RATHER THAN AN EDIT
 *
 * The card's click handler is the design's, and it plays the film in place — which is what the design drew.
 * What it did not do is tell a reader where the film's own page is, and `fillWatch` adds that control
 * (`#inline-player-page`) to the inline player's actions row. **Setting its address needs the id of the card
 * that was clicked, and that is known only inside `open(card)`** — so it has to be one line in the script.
 *
 * `public/design/watch.js` is inviolable, so the line is spliced at request time and served from
 * `/design-screen-assets/watch.js`, exactly as `extendMarketDaysScript` serves the extended calendar script.
 * The route refuses a name that is not in its map, so this cannot be reached with a name of the caller's
 * choosing.
 *
 * THE ANCHOR IS ASSERTED, AND A FILE THIS PASS DOES NOT RECOGNISE IS RETURNED UNCHANGED. The line it splices
 * after is the one that already writes the YouTube address, which is the same place in the same handler — and
 * if it is absent or appears twice, the script is served as the design wrote it. **That is the right failure
 * for this file**: the page keeps playing films, and the only thing missing is one link, where a throw from
 * here would take the whole inline player with it. `extendMarketDaysScript` records the same reasoning.
 *
 * IDEMPOTENT, because the route reads the file on every request: the marker is the id this function writes, and
 * a second pass finds it already there.
 */
export function extendWatchScript(script: string): string {
  const ANCHOR = 'externalEl.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);';
  const MARKER = 'inline-player-page';
  if (script.includes(MARKER)) return script;
  if (script.split(ANCHOR).length !== 2) return script;
  /*
   * THE GUARD IS NOT DECORATION. `getElementById` answers `null` on any page that loads this script without the
   * control — and a bare `.href` on `null` throws inside the click handler, which would leave the film unopened.
   * The link is a convenience; the player is the page.
   */
  const line =
    '\n    var pageEl = document.getElementById("' + MARKER + '");' +
    '\n    if (pageEl) {' +
    '\n      var pageHref = card.getAttribute("data-video-page");' +
    '\n      if (pageHref) { pageEl.href = pageHref; pageEl.hidden = false; }' +
    '\n      else { pageEl.hidden = true; }' +
    '\n    }';
  return script.replace(ANCHOR, () => `${ANCHOR}${line}`);
}

/**
 * Every `div.sx-video-grid` in a document, as the range of its inner content.
 *
 * The close is found by balanced depth — the existing rule — because the design's grids hold only cards
 * today and a card that grows a nested `div` tomorrow must not end the grid early.
 */
function watchGrids(html: string): { open: number; close: number }[] {
  const grids: { open: number; close: number }[] = [];
  const openTag = '<div class="sx-video-grid">';
  let from = 0;
  for (;;) {
    const start = html.indexOf(openTag, from);
    if (start === -1) break;
    const open = start + openTag.length;
    let depth = 1, i = open;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen + 4; }
      else { depth -= 1; i = nextClose + 6; }
    }
    grids.push({ open, close: i - 6 });
    from = i;
  }
  return grids;
}

/**
 * The film cards inside a grid, as whole `<button>` elements, in order.
 *
 * A `button` cannot contain a `button`, so the first `</button>` after a card's open tag is its own — no
 * depth counting is needed here, and the markup this returns is the design's, character for character.
 */
function watchCards(inner: string): string[] {
  const cards: string[] = [];
  const open = /<button\b[^>]*\bclass="[^"]*\bsx-video-card\b[^"]*"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(inner)) !== null) {
    const end = inner.indexOf('</button>', match.index);
    if (end === -1) break;
    cards.push(inner.slice(match.index, end + '</button>'.length));
    open.lastIndex = end;
  }
  return cards;
}

/**
 * The screen's own public address, and why every link the fill writes from here is written from the root.
 *
 * **THE SERVED PAGE'S `<head>` CARRIES `<base href="/">`**, inserted by `fillDashboardLinks` in this file, so
 * a relative `?page=2` does NOT resolve against `/watch/` — it resolves against the site root. Measured in a
 * real browser (headless Chrome, a mouse click on the served `<a>`, read back with the DevTools protocol):
 * with the bare `href="?page=2"` that this page used to serve, clicking `Next →` on `/watch/` landed on
 * **`http://…/?page=2`, the front page** — `h1` "The stories of our towns, clans and kingdoms", 15 film cards
 * before the click and **0** after it. **A 200 on the wrong page**, which is the fault the owner reported as
 * "the next page is not working".
 *
 * **No `curl` can see it.** The HTML is byte-identical either way; only a browser resolves a relative URL, so
 * a fetch of `/watch/?page=2` renders page 2 correctly while the link on the page goes to the front page. The
 * path is therefore written out. `/watch/` is also the screen's canonical address, which is what the route's
 * own generated `<link rel="canonical" href="https://ozikoro.com/watch/">` says.
 */
const WATCH_PATH = '/watch/';

/**
 * A pager link.
 *
 * The middleware carries the query string to the fill route, so `/watch/?page=2` is a plain GET that renders
 * server-side — the address is the page, a reader can link to page 2, and a refresh keeps them there.
 * **Every other parameter is kept**: the owner's design preview travels in the query string at the public
 * address, and a Next that silently dropped it would be a control that goes somewhere else.
 */
function watchPageHref(query: string | undefined, page: number): string {
  const params = new URLSearchParams(query ?? '');
  params.set('page', String(page));
  return `${WATCH_PATH}?${params.toString()}`;
}

/** The pager itself: where you are, how many there are, and the two real links. */
function renderWatchPager(
  page: number, totalPages: number, total: number, href: (page: number) => string
): string {
  const first = (page - 1) * WATCH_PAGE_SIZE + 1;
  const last = Math.min(page * WATCH_PAGE_SIZE, total);
  const prev = page > 1
    ? `<a class="btn btn-ghost btn-sm" href="${esc(href(page - 1))}" rel="prev">← Previous</a>`
    : '<span class="btn btn-ghost btn-sm" aria-disabled="true" style="opacity:.45">← Previous</span>';
  const next = page < totalPages
    ? `<a class="btn btn-ghost btn-sm" href="${esc(href(page + 1))}" rel="next">Next →</a>`
    : '<span class="btn btn-ghost btn-sm" aria-disabled="true" style="opacity:.45">Next →</span>';
  return `<nav class="row" style="margin-top:var(--s-6);justify-content:space-between" aria-label="Pagination">` +
    `<span class="small" style="color:var(--on-night-muted)">Showing films ${first}–${last} of ${total} · ` +
    `page ${page} of ${totalPages}</span><span class="row">${prev}${next}</span></nav>`;
}

/** Replace every occurrence of a container's inner content, matched by balanced depth. */
export function replaceContainer(html: string, openTag: string, inner: string): string {
  const start = html.indexOf(openTag);
  if (start === -1) return html;
  // `openTag` may be a PREFIX — `<div class="sx-listen-list` with further classes after it. The content must
  // begin after the opening tag's `>`, not after the prefix, or it is injected inside the tag itself.
  const gt = html.indexOf('>', start);
  if (gt === -1) return html;
  const open = gt + 1;
  const closing = `</${openTag.match(/^<(\w+)/)?.[1] ?? 'div'}>`;
  const tagName = openTag.match(/^<(\w+)/)?.[1] ?? 'div';
  let depth = 1, i = open;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${tagName}`, i);
    const nextClose = html.indexOf(`</${tagName}>`, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen + tagName.length + 1; }
    else { depth -= 1; i = nextClose + closing.length; }
  }
  return html.slice(0, open) + '\n        ' + inner + '\n      ' + html.slice(i - closing.length);
}

/** One home-page entry, in the design's `a.sx-archive-entry` markup. */
export function renderHomeEntry(index: number, e: { title: string; href: string; topic: string | null }): string {
  const n = String(index).padStart(2, '0');
  // The design puts the index first and the tag INSIDE entry-copy, before the title. Order matters here
  // because the stylesheet positions `.index` against the entry rather than flowing it.
  return `<a class="sx-archive-entry reveal" href="${esc(e.href)}">
          <span class="index" aria-hidden="true">${n}</span><span class="entry-copy">${e.topic ? `<span class="tag">${esc(e.topic)}</span>` : ''}<strong>${esc(e.title)}</strong></span><span class="more">Read history <span aria-hidden="true">→</span></span>
        </a>`;
}

/**
 * The rotating names on the front page, and the archive record each one actually reaches.
 *
 * WHAT THIS IS FOR
 *
 * `home.html` carries a marquee immediately under the hero: twelve town and clan names, written twice so the
 * loop has no seam. **Every one of the twenty-four was plain `<li>` text, so the front page had no link to
 * any town or clan at all.** The owner asked for the names to be clickable.
 *
 * WHY THE DESIGN'S TWELVE ARE KEPT, RATHER THAN REPLACED WITH THE REGISTER'S OWN
 *
 * The register holds 188 published entries and this list shows twelve, so the twelve are the designer's
 * examples. **They are kept because the owner asked for the names that rotate to be clickable, not for the
 * names to change** — and, measured against the register, they are far more real than "examples" implies.
 * Eleven of the twelve reach a published record; the mapping from a display name to that record is below,
 * entry by entry, because three of them are not the obvious slug and one of them reaches nothing at all.
 *
 * THE MAPPING IS NOT `slugify(name)`, AND THAT IS THE WHOLE POINT
 *
 * The archive folds a display name to a slug by `slugify` in `packages/db/src/import/clans.ts`
 * (NFKD, lowercase, every run of non-alphanumerics to `-`). **Applying that here would have produced two
 * wrong links and three 404s**, so each name is mapped to the record the register actually holds:
 *
 *   * `Ute-Okpu` → `ute-okpu`. The fold is right; the record's own name is `Ute Okpu`, with a space.
 *   * `Igbodo` → `igbodo-northern-ika`, NOT `igbodo`. **The register holds two published entries named
 *     Igbodo.** `igbodo` is a *section* in Enugu whose towns are Aku and Ukehe; `igbodo-northern-ika` is the
 *     Ika town in Delta, Ika North East. The other eleven names in this marquee are Ika and Anioma towns
 *     (Ute-Okpu, Umunede, Owa, Ogume, Amai, Akumazi, Abbi), so the Ika record is the one the design means.
 *   * `Oko` and `Okwe` → `oko-okwe`. The register records them as **one entry for two neighbouring
 *     communities**: "Oko and Okwe are two neighbouring Igbo communities of the western Niger in the Enuani
 *     country, each with its own account of itself." Two names therefore reach one page.
 *   * `Arondizuogu` → `ndizuogu`. **There is no `/town/arondizuogu/` — it 404s, because `getPlace` matches
 *     `clan.slug` only and `Arondizuogu` is an ALIAS of Ndizuogu, not its slug.** The record's own opening
 *     says "Ndizuogu — Arondizuogu, Ndi Izuogu, Izuogu na Iheme — is the largest of the Aro settlements
 *     outside Arochukwu", so the archive itself states the equivalence.
 *   * `Ubulu-Uku` → **nothing.** No published entry carries the name, as a name or as an alias, and
 *     `/town/ubulu-uku/` returns 404. **It is left as plain text rather than pointed at a guess**, which is
 *     the rule this file and the owner both hold to: a name with no record behind it must not become a link.
 *
 * WHY THE ROUTE STILL CHECKS THE SLUGS AGAINST THE DATABASE
 *
 * This map states the intent; it is not trusted as a fact. The route resolves every slug through
 * `clan … where published` — the same visibility rule `getPlace` applies — and **only emits a link for a
 * slug that came back published.** A record unpublished or renamed later leaves its name as plain text
 * rather than becoming a 404, which is the failure this whole task is exposed to.
 */
export const MARQUEE_PLACES: ReadonlyArray<{ label: string; slug: string; note: string }> = [
  { label: 'Ute-Okpu', slug: 'ute-okpu', note: 'the register writes the name "Ute Okpu"' },
  { label: 'Umunede', slug: 'umunede', note: 'the fold is the slug' },
  { label: 'Owa', slug: 'owa', note: 'the fold is the slug' },
  { label: 'Ogume', slug: 'ogume', note: 'the fold is the slug' },
  { label: 'Igbodo', slug: 'igbodo-northern-ika', note: 'the Ika town, not the Enugu section named igbodo' },
  { label: 'Amai', slug: 'amai', note: 'the fold is the slug' },
  { label: 'Akumazi', slug: 'akumazi', note: 'the fold is the slug' },
  { label: 'Abbi', slug: 'abbi', note: 'the fold is the slug' },
  { label: 'Oko', slug: 'oko-okwe', note: 'the register records Oko and Okwe as one entry' },
  { label: 'Okwe', slug: 'oko-okwe', note: 'the register records Oko and Okwe as one entry' },
  { label: 'Arondizuogu', slug: 'ndizuogu', note: 'Arondizuogu is an alias of Ndizuogu, not a slug' },
];

/** One resolved marquee link: the design's own display name, and the archive address behind it. */
export type MarqueeLink = { label: string; href: string };

/**
 * The design's marquee track, exactly as it stands in `home.html`.
 *
 * The track carries `aria-hidden="true"` and the list is written twice inside it, so one match proves the
 * screen is the one this fill was written for and gives the offset the rest of the transform works from.
 */
const MARQUEE_TRACK_OPEN = '<div class="sx-marquee-track" aria-hidden="true"><ul>';

/**
 * Make the rotating names links, so that the content is reachable ONCE and the loop still works.
 *
 * THE ACCESSIBILITY DECISION, AND WHY IT IS THIS ONE
 *
 * `aria-hidden="true"` sits on the track, and **a focusable link inside an `aria-hidden` region is a bug**:
 * a screen reader is told to ignore the region while the keyboard still tabs into it, so a reader tabs
 * through twenty-four stops that are announced as nothing. Of the three ways out:
 *
 *   (a) remove `aria-hidden` and name the list — **the twelve names are then announced twice**, because the
 *       list is duplicated for the loop;
 *   (b) **keep the duplicate half hidden and make the first half reachable and announced** — chosen here;
 *   (c) keep `aria-hidden` and make every link `tabindex="-1"` — clickable by mouse, unreachable by keyboard,
 *       which is worse than the plain text was.
 *
 * **(b) is done in the fill, and it needs no change to the design's markup structure.** The design has one
 * `<ul>` holding twenty-four `<li>`, and the stylesheet animates that `<ul>` by `translateX(-50%)` — the
 * seamlessness of the loop *is* the duplication, so the halves cannot be split into two lists without
 * breaking it. So the single list is kept and the elements are marked in place: the opening
 * `aria-hidden="true"` comes off the track, the `<ul>` gains an accessible name, each `<li>` in the
 * duplicate half is marked `aria-hidden="true"`, and the anchors inside that half are given
 * `tabindex="-1"` — **a `tabindex="-1"` link is still clickable but is out of the tab order, and an
 * `aria-hidden` element that contains a tab stop is exactly the fault being fixed.**
 *
 * The duplicate half is identified rather than assumed: it is only treated as a duplicate when the track
 * really does hold two identical halves. **A design that stopped duplicating its list would then hide
 * nothing**, rather than silently hiding half of the real links.
 *
 * THE COLOUR ON EACH LINK IS `inherit`, AND THAT IS NOT DECORATION
 *
 * The design's global rule is `a { color: var(--link) }`, and `--link` is `#0d5c45` — a dark green. The
 * marquee's band is `--emerald-deep`, `#062e22`. **That is a contrast ratio of about 1.85:1, well under the
 * 4.5:1 a name has to clear to be read at all**, so a bare anchor here would have turned the twelve names
 * almost invisible: worse than the plain text they replaced. The design's own statement about links on a
 * dark band is `.sx-dark a { color: var(--gold-bright) }`, so these anchors inherit the marquee's own
 * `--gold-bright` instead. The design's underline stays, and so does its 2px hover thickness, so the names
 * still look like links. **No rule is added to any stylesheet** — the attribute is on the served element.
 *
 * A MARQUEE WITH NO LINKS IS LEFT ALONE. If nothing resolved, this returns the design's markup byte-for-byte
 * with its `aria-hidden` intact, so a database that is down degrades to the design rather than to a page
 * that has lost a property it had.
 */
export function fillMarquee(html: string, links: readonly MarqueeLink[]): string {
  const start = html.indexOf(MARQUEE_TRACK_OPEN);
  if (start === -1) return html;
  const ulOpen = start + MARQUEE_TRACK_OPEN.length;
  const ulClose = html.indexOf('</ul>', ulOpen);
  if (ulClose === -1) return html;

  const items = [...html.slice(ulOpen, ulClose).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.trim());
  if (items.length === 0) return html;

  const href = new Map(links.map((l) => [l.label, l.href]));
  if (!items.some((name) => href.has(name))) return html;

  /*
   * The halves, and whether there really are two of them. `translateX(-50%)` in `@keyframes marquee` is what
   * makes the repeat the seam, so only an exact repeat is treated as the duplicate half.
   */
  const half = items.length / 2;
  const duplicated =
    Number.isInteger(half) && half > 0 &&
    items.slice(0, half).join('\u0000') === items.slice(half).join('\u0000');

  const rendered = items
    .map((name, index) => {
      const repeat = duplicated && index >= half;
      const target = href.get(name);
      const inner = target
        ? `<a href="${esc(target)}" style="color:inherit"${repeat ? ' tabindex="-1"' : ''}>${esc(name)}</a>`
        : esc(name);
      return `<li${repeat ? ' aria-hidden="true"' : ''}>${inner}</li>`;
    })
    .join('');

  const track = `<div class="sx-marquee-track"><ul aria-label="Communities in the archive">`;
  return html.slice(0, start) + track + rendered + '</ul>' + html.slice(ulClose + '</ul>'.length);
}

/**
 * Fill `home.html`'s "Fresh from the archive" list, and make the rotating names links.
 *
 * The design's five entries link to `https://ozikoro.com/…`, which is the live WordPress site, and its credit
 * line says the story titles are taken from there. **This points them at the archive's own records instead**,
 * so a reader stays on the site being built rather than being sent to the one it will replace.
 *
 * `marquee` is optional so that a caller with no resolved places — or a test of the entries alone — still
 * gets the list filled and the marquee left exactly as the design has it.
 */
export function fillHome(
  html: string,
  entries: { title: string; href: string; topic: string | null }[],
  marquee: readonly MarqueeLink[] = []
): string {
  let out = dropExampleFlag(html);
  const rendered = entries.map((e, i) => renderHomeEntry(i + 1, e)).join('\n        ');
  out = replaceContainer(out, '<div class="sx-archive-index"', rendered);
  if (marquee.length > 0) out = fillMarquee(out, marquee);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * THE FRONT PAGE'S SIX TOWN TILES, WHICH ALL WENT TO THE SAME PLACE
 * ---------------------------------------------------------------------------------------------- */

/**
 * The six towns the design's strip draws, and the register row each one means.
 *
 * ── THE FAULT, MEASURED ON THE SERVED FRONT PAGE ────────────────────────────────────────────────
 *
 * `home.html` writes its "Explore by town" strip as six cards, each `<a href="town.html">` — a
 * SIBLING FILENAME, which is correct in the deliverable and meaningless once the screen is served at
 * `/`. `designScreenLinks` resolves that filename to the address the site answers the screen at, and
 * the answer is `/town/`: **all six cards, naming six different towns, pointed at one address.** The
 * owner's report is that click, in his own words: *"inside /town/, why is the homepage showing that
 * when you click on igbodo, and then also show me links to other clans and towns, instead of showing
 * me articles relating to the igbodo?"*
 *
 * He clicked the tile labelled **Igbodo**, under its photograph of the obi of Igbodo, and landed on
 * `/town/` — the design's single-town screen, filled as the register, with its heading still reading
 * *"Histories about Igbodo"* over twenty-four OTHER towns. Every part of that page was the fault he
 * described, and none of it was in the design.
 *
 * ── WHY THE NAMES ARE RESOLVED RATHER THAN REPLACED ─────────────────────────────────────────────
 *
 * The tiles carry real Ozikoro material — six photographs the archive serves from its own media
 * origin, each with the design's own `alt` — and the design's own `<small>` region and `<em>` call to
 * action. Only the ADDRESS was wrong. So the names are kept and each one is resolved to the register
 * row it means, which is the arrangement `MARQUEE_PLACES` already uses one element over on the same
 * screen: **the design's names, and the archive's addresses behind them.**
 *
 * Two of the six are the traps that map already records, and they are copied here rather than
 * re-derived: the register holds TWO published entries called Igbodo — a section in Enugu (`igbodo`)
 * and the Ika town (`igbodo-northern-ika`) — and this tile's photograph is the obi of the IKA town,
 * so `igbodo-northern-ika` is the row it means; and the design draws Oko and Okwe as one card because
 * the register records them as one entry.
 *
 * The first label is the card's own `<strong>` text, exactly as the design writes it — `Oko & Okwe`,
 * with the ampersand. `fillHomeTowns` decodes `&amp;` before it compares.
 */
export const HOME_STRIP_PLACES: ReadonlyArray<{ label: string; slug: string; note: string }> = [
  { label: 'Igbodo', slug: 'igbodo-northern-ika', note: 'the Ika town, not the Enugu section named igbodo — and the photograph is its obi' },
  { label: 'Amai', slug: 'amai', note: 'the fold is the slug' },
  { label: 'Akumazi', slug: 'akumazi', note: 'the fold is the slug' },
  { label: 'Abbi', slug: 'abbi', note: 'the fold is the slug' },
  { label: 'Oko & Okwe', slug: 'oko-okwe', note: 'the register records Oko and Okwe as one entry, which is why the design draws them as one tile' },
  { label: 'Arondizuogu', slug: 'ndizuogu', note: 'Arondizuogu is an alias of Ndizuogu, not a slug' },
];

/** The strip's own container, as `home.html` writes it. */
const HOME_STRIP_OPEN = '<div class="sx-strip reveal">';

/**
 * Give each of the front page's town tiles its own address.
 *
 * ── WHAT IT DOES AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────
 *
 * It rewrites ONE attribute per card — the `<a>`'s `href` — and nothing else. The `<img>`, its `alt`,
 * the `<small>` region, the `<i>` rule, the `<strong>` name and the `<em>` call to action are the
 * design's and are left byte-for-byte as they were. **The design file is not read for writing and is
 * not edited**; this runs on the served copy, in memory, like every other fill here.
 *
 * The card is identified by its own `<strong>`, which is the name a reader sees, rather than by its
 * position — so a design that reorders or drops a tile cannot silently move a photograph onto the
 * wrong town.
 *
 * ── AN UNRESOLVED NAME GOES TO THE REGISTER, NOT BACK TO THE SINGLE-TOWN SCREEN ──────────────────
 *
 * If a name is not in `links` — the row was renamed or unpublished since `MARQUEE_PLACES` was
 * measured — the card is pointed at `/clan-towns/`, which is the register and lists every entry the
 * archive holds. **It is deliberately NOT left at `/town/`**, because that is the fault: a tile named
 * after one town must not open a page that is about the register while claiming to be about that
 * town.
 *
 * The tile is kept as a link rather than unwrapped because the design's own stylesheet draws it as
 * one — `.sx-strip a` carries the gradient, the hover and the absolutely positioned caption — so an
 * anchor stripped of its `href` renders as a box with its text in the wrong place. The marquee
 * unwraps instead because a bare name in a list of names loses nothing; a photograph does.
 */
export function fillHomeTowns(html: string, links: readonly MarqueeLink[]): string {
  const start = html.indexOf(HOME_STRIP_OPEN);
  if (start === -1) return html;
  const open = html.indexOf('>', start);
  if (open === -1) return html;
  const close = html.indexOf('</div>', open);
  if (close === -1) return html;

  const href = new Map(links.map((l) => [l.label, l.href]));
  if (href.size === 0) return html;

  const inner = html.slice(open + 1, close).replace(
    /<a\b([^>]*?)href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g,
    (whole, before: string, _was: string, after: string, body: string) => {
      const strong = /<strong>([\s\S]*?)<\/strong>/.exec(body);
      if (!strong) return whole;
      // The design writes `Oko &amp; Okwe`; the map's label is the name a reader sees.
      const name = strong[1]!.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
      const target = href.get(name) ?? '/clan-towns/';
      return `<a${before}href="${esc(target)}"${after}>${body}</a>`;
    }
  );
  return html.slice(0, open + 1) + inner + html.slice(close);
}

/** A photograph as the archive holds it. */
export type RealPhotograph = {
  id: number;
  /**
   * The media record's own slug, which is the address of its record page at `/documents/<slug>/`.
   *
   * WHY THIS FIELD EXISTS. The first version of this renderer wrote `<a href="/photographs">Open
   * record</a>` — a link that returns the reader to the page they are already on. **Every one of the
   * 3,462 photographs had a full record page carrying its provenance, its reuse terms, the collection
   * it came from and how to cite it, and not one of them was reachable from the gallery.** The screen
   * looked complete and offered nothing; the owner could look and could not read, cite or request.
   * Measured on the served page: zero anchors to `/documents/…`.
   */
  slug: string;
  title: string;
  alt: string;
  src: string;
  creator: string | null;
  credit: string | null;
  licence: string | null;
  captured: string | null;
};

/**
 * One photograph, in the design's own `<article>` markup.
 *
 * THE RIGHTS SENTENCE IS THE DESIGN'S OWN SLOT, FILLED HONESTLY
 *
 * The design writes `Sample record · source context required` in the `<small>` and `Access and reuse terms
 * appear here` in the `<p>`. **Those are slots, not decoration, and the archive has something true to put in
 * them: 3,488 media items carry a rights record whose basis is `unknown` and whose consent is `not_sought`,
 * and not one has a licence.** So the sentence states that rather than being replaced with a permission
 * nobody granted. **An image with no licence is shown with no licence stated.**
 */
export function renderPhotograph(ph: RealPhotograph): string {
  const parts: string[] = [];
  if (ph.creator) parts.push(`Photographer ${ph.creator}`);
  if (ph.captured) parts.push(ph.captured);
  if (ph.credit) parts.push(ph.credit);
  const context = parts.length ? parts.join(' · ') : 'Source context not recorded';

  const terms = ph.licence
    ? `Licence ${ph.licence}`
    : 'No licence recorded · reuse not granted';

  const record = `/documents/${ph.slug}/`;

  return `<article>
          <img src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy">
          <div>
            <small>${esc(context)}</small>
            <h2><a href="${esc(record)}">${esc(ph.title)}</a></h2>
            <p>Reference <code>OZ-M-${ph.id}</code> · ${esc(terms)}</p>
            <a href="${esc(record)}">Record, provenance and how to cite it <span aria-hidden="true">→</span></a>
          </div>
        </article>`;
}

/**
 * Fill `photographs.html`'s gallery.
 *
 * The design holds one example article and one placeholder that says no further item was invented for the
 * demonstration. **Both are replaced by real photographs from the archive**, each served from this site at
 * `/media/…` rather than hot-linked from the WordPress install the design's example points at.
 */
export function fillPhotographs(html: string, photographs: RealPhotograph[]): string {
  let out = dropExampleFlag(html);
  const rendered = photographs.map(renderPhotograph).join('\n        ');
  out = replaceContainer(out, '<div class="sx-record-gallery">', rendered);
  return out;
}

/** A story in the folklore index. */
export type RealStory = { title: string; href: string; topic: string | null; image: string | null; alt: string };

/** One story card, in the design's `a.sx-folk-story` markup. */
export function renderFolkStory(index: number, st: RealStory): string {
  const n = String(index).padStart(2, '0');
  const img = st.image
    ? `<img src="${esc(st.image)}" alt="${esc(st.alt)}" loading="lazy">`
    : '';
  return `<a class="sx-folk-story" href="${esc(st.href)}">${img}<span class="sx-folk-no">${n}</span><span><strong>${esc(st.title)}</strong><small>${esc(st.topic ?? 'Oral tradition')}</small><em>Read or listen <span aria-hidden="true">→</span></em></span></a>`;
}

/**
 * Fill `folklore.html`'s story grid.
 *
 * The archive holds 17 records filed under Folklores, so the grid is filled from those and **the count is the
 * archive's rather than the design's four examples.** The design's own note about oral tradition's standing is
 * left exactly where it is.
 */
export function fillFolklore(html: string, stories: RealStory[]): string {
  let out = dropExampleFlag(html);
  const rendered = stories.map((st, i) => renderFolkStory(i + 1, st)).join('\n          ');
  out = replaceContainer(out, '<div class="sx-folk-grid">', rendered);
  return out;
}

/**
 * A recording in the listen library, as the archive holds it.
 *
 * **EVERY FIELD IS A FACT OFF THE EPISODE ROW, OR IT IS ABSENT.** The owner's rule for this page is
 * *"every audio inside an article on this website must appear on listen"*, which makes the page a
 * DERIVATION of the records and not a selection from them — so there is nothing here for a person to
 * maintain, and nothing here that a record does not carry.
 *
 * THE FIVE ORIGINAL FIELDS are the design's own row slots (`sx-track-main`, `sx-track-len`). The optional
 * ones below were added when the page stopped being a list of written records and became a list of
 * recordings; each is optional so that a caller which knows only the design's five still compiles and still
 * draws an honest row.
 */
export type RealTrack = {
  title: string; href: string; series: string; image: string | null; length: string | null;
  /**
   * HOW THE WORDS ARE SPOKEN, in a phrase a reader can read — `Read by a person`, `Synthetic voice`. Built by
   * `narratorPhrase` from `ozikoro_episode.narrator_kind`, so the page cannot state a kind the record does
   * not carry. `null` says the record does not say, and the row says that instead of guessing.
   */
  narrator?: string | null;
  /** The raw `narrator_kind`, kept beside the phrase so the served row can be checked mechanically. */
  narratorKind?: string | null;
  /**
   * WHETHER THE RECORDING IS A FILE THIS PAGE CAN PLAY, which is not the same question as whether the record
   * has audio. An MP3 this archive holds, or an external address a check established serves `audio/*`, is
   * played in place; a Spotify episode PAGE is audio a reader can hear but not a file any `<audio>` can take,
   * and the page says so rather than offering a control that cannot answer.
   */
  playable?: boolean;
  /** The address of the recording — ours under `/media/…`, or the external one. */
  audioUrl?: string | null;
  /** The episode's own slug, for the transcript that sits beside the audio. */
  episode?: string | null;
  /** The service holding the audio when `playable` is false, so the page can name it. */
  externalService?: string | null;
  /** The recorded disclosure sentence — who is speaking and how. Never written here. */
  disclosure?: string | null;
};

/**
 * The narrator, in one phrase, from the kind the record stores.
 *
 * **A KIND THE RECORD DOES NOT CARRY IS NOT GUESSED.** `ozikoro_episode.narrator_kind` is a NOT NULL CHECK
 * over three values, so the fourth branch is for a caller that passed nothing — and it says the record does
 * not say, rather than defaulting to the commonest answer.
 */
export function narratorPhrase(kind: string | null | undefined, name: string | null | undefined): string {
  const base = kind === 'human'
    ? 'Read by a person'
    : kind === 'synthetic_own_voice'
      ? 'Synthetic voice, the author’s own'
      : kind === 'synthetic_generic'
        ? 'Synthetic voice'
        : 'Narrator not recorded';
  return name ? `${base} · ${name}` : base;
}

/** One track row, in the design's `a.sx-track` markup. */
export function renderTrack(index: number, t: RealTrack): string {
  const n = String(index).padStart(2, '0');
  const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : '';
  // The row's second line carries what the recording IS: the record's topic, and who is speaking. The
  // design's own shape is `Topic · Series`, so this is the same slot with the fact the archive holds.
  const series = t.narrator ? `${t.series} · ${t.narrator}` : t.series;
  const length = t.length ?? (t.playable === false ? 'Opens elsewhere' : 'Listen');
  // The design wraps each track in an `<li>` inside `<ol class="sx-tracklist">`, so the row and its wrapper
  // are emitted together. Dropping the `<li>` would leave the list's own counters with nothing to number.
  //
  // `data-playable` and `data-narrator-kind` are the two facts the brief asks this page to state, on the
  // element rather than only in prose, so a served page can be checked without reading its sentences.
  return `<li><a class="sx-track" href="${esc(t.href)}" data-playable="${t.playable === false ? 'no' : 'yes'}" data-narrator-kind="${esc(t.narratorKind ?? '')}"><span class="sx-track-no">${n}</span>${img}<span class="sx-track-main"><strong>${esc(t.title)}</strong><small>${esc(series)}</small></span><span class="sx-track-len">${esc(length)}</span><span class="sx-track-play" aria-hidden="true">▶</span></a></li>`;
}

/**
 * THE FEATURE CARD, FILLED FROM A REAL RECORDING — OR REMOVED.
 *
 * WHAT WAS WRONG WITH IT. The design's card is an example episode: *"The Ikoro: the drum that spoke for a
 * town"*, *"Sample episode—recording awaiting approval"*, a `<button>▶ Play episode</button>` with no handler
 * and no audio anywhere on the page, and a `Read the transcript` link to `article.html` — which, on a screen
 * with no `<base>` and no rewrite, resolved to `/listen/article.html` and answered **404**. So the owner's
 * report that the featured block "is not clickable and does nothing" was exactly right, and it was two faults
 * at once: a control with no handler, and a link with no destination.
 *
 * WHAT REPLACES IT, AND THE RESTRAINT THAT MATTERS. The card is filled from the newest recording this archive
 * can actually play, using **the design's own button and the same `<audio data-listen-audio>` element the
 * article pages use** — `audio-listen.js` claims that button in the capture phase and hands it the file. **No
 * second player is built here.** Where the recording is a page rather than a file (a Spotify episode), the
 * button becomes an anchor that says where it goes, exactly as the article's panel does, because a play
 * control over a file that cannot be fetched is a control that answers with nothing.
 *
 * With no recording at all the whole section is removed by the caller rather than filled: a "Featured episode"
 * heading over an invented episode is the plainest kind of lie, and the design's own screen has no empty state
 * for it to fall back to.
 */
function fillListenFeature(html: string, t: RealTrack): string {
  const service = t.externalService && isExternalAudioService(t.externalService)
    ? EXTERNAL_AUDIO_LABELS[t.externalService]
    : null;
  let out = html;
  out = out.replace(
    /(<span class="sx-listen-series">)[\s\S]*?(<\/span>)/,
    `$1${esc([t.series, t.narrator].filter(Boolean).join(' · '))}$2`
  );
  out = out.replace(/(<h2 id="feature-title">)[\s\S]*?(<\/h2>)/, `$1${esc(t.title)}$2`);
  // The description slot carries the episode's own recorded disclosure. It is the one sentence that says who
  // is speaking and how, it is required by the distribution rules, and it is never written by this fill.
  out = out.replace(
    /(<h2 id="feature-title">[\s\S]*?<\/h2>\s*<p>)[\s\S]*?(<\/p>)/,
    `$1${esc(t.disclosure ?? 'The record’s own words, read aloud.')}$2`
  );
  if (t.image) {
    out = out.replace(
      /(<div class="sx-listen-feature-card">\s*<img src=")[^"]*(" alt=")[^"]*(")/,
      `$1${esc(t.image)}$2${esc(t.title)}$3`
    );
  } else {
    // A card with no image loses the `<img>` rather than keeping the design's example photograph, which is a
    // picture of another record.
    out = out.replace(/(<div class="sx-listen-feature-card">\s*)<img[^>]*>/, '$1');
  }
  /*
   * THE TRANSCRIPT CONTROL LEADS TO THE TRANSCRIPT'S PAGE, NOT TO ITS FILE.
   *
   * **This is the fault the owner reported verbatim**: a `btn` is a control that leads to a destination in this
   * design's language, and this one led to `/podcast/<slug>/transcript.txt` — 200, `text/plain`, correct prose
   * and no masthead, no nav, no typography and no way back, which a non-technical reader described as
   * "complete code". **A 200 was measured here and the destination was never read**, which is why the address
   * changed rather than the file. `/podcast/<slug>/transcript/` is the design's reading page carrying the same
   * words, and the `.txt` keeps its own address for the feed and for anything that wants the raw text.
   */
  const transcript = t.episode
    ? `<a class="btn btn-ghost" href="/podcast/${esc(t.episode)}/transcript/">Read the transcript</a>`
    : '';
  const actions = t.playable && t.audioUrl
    ? `<audio data-listen-audio preload="none" src="${esc(t.audioUrl)}"></audio>`
      + '<button class="btn btn-gold" type="button" data-listen-toggle aria-pressed="false">▶ Play episode</button>'
      + transcript
    : `<a class="btn btn-gold" href="${esc(t.audioUrl ?? t.href)}"${service ? ' target="_blank" rel="noopener noreferrer"' : ''}>`
      + `Listen${service ? ` on ${esc(service)}` : ''} <span aria-hidden="true">↗</span></a>${transcript}`;
  /*
   * AND A LINE FOR THE PLAYER TO SPEAK THROUGH, WHICH THIS CARD DID NOT HAVE.
   *
   * `audio-listen.js` writes *"Playing · 4m 12s"*, *"Paused"* and — the one that matters — *"Could not play:
   * NotAllowedError"* into `[data-listen-status]`. **The design's feature card has no such element**, so on
   * this screen every one of those sentences was written to nothing: a refused autoplay or a missing file
   * would leave the button reading `▶ Play episode`, which is exactly what it looked like before anybody
   * pressed it. **A control that fails silently is a control that looks dead**, which is the fault this round
   * is fixing one level down — so the element is added, with the design's own `.small` class and the same
   * `aria-live="polite"` the article's panel uses. It exists only where there is a file to play: a card whose
   * recording is held elsewhere has no player and nothing to say.
   */
  const status = t.playable && t.audioUrl
    ? '<p class="small" data-listen-status aria-live="polite">Ready to listen</p>'
    : '';
  return out.replace(/(<div class="sx-listen-feature-actions">)[\s\S]*?(<\/div>)/, `$1${actions}$2${status}`);
}

/**
 * Fill `listen.html`: **the recordings the archive holds, and nothing else.**
 *
 * THE OWNER'S RULE, VERBATIM
 *
 *   "every audio inside an article on this website must appear on listen."
 *
 * So this page is a DERIVATION of the episode records, not a selection from them. `tracks` is one entry per
 * record whose article carries a player — the caller builds it from `playableEpisodeAudioSql()`, the same
 * fragment the article page composes, so a record listed here and a record that plays there are the same set
 * by construction rather than by agreement. **There is no list to maintain.** An approval, a publication or a
 * new file changes the page at the next request, and nothing here has to be told about it.
 *
 * WHAT IT REPLACED, AND WHY THE OLD BEHAVIOUR WAS WORSE THAN EMPTY. This function used to be handed the
 * twelve newest published records — records that mostly have no recording at all — and it drew each one as a
 * row whose length column read `Read`. **The page said a reader could hear twelve things and none of them
 * could be heard.** With three real episodes in the archive, the honest page is three rows.
 *
 * THE EMPTY STATE IS A REAL SCREEN. With nothing approved, the feature section is removed and the library's
 * example rows go with it, because the design's six rows claim durations ("Sample") and a play control. What
 * is left is the sentence that says so. **A page showing three real recordings is correct; a page showing
 * twelve records that have none is a lie**, and a page showing six the design invented is worse.
 *
 * THE FEATURE CARD IS THE FIRST ROW, NOT A SEPARATE FACT. `tracks` arrives newest-first, so the featured
 * episode is the newest recording and is also the first row of the library. Deriving both from one list is
 * what stops the card from advertising an episode the list below it does not contain.
 */
export function fillListen(html: string, tracks: RealTrack[]): string {
  let out = dropExampleFlag(html);

  const featured = tracks[0];
  if (featured) {
    out = fillListenFeature(out, featured);
  } else {
    // The design's example episode goes, heading and all. A "Featured episode" over an episode that does not
    // exist is the fault this page is being fixed for, in the other direction.
    out = out.replace(/\s*<section class="sx-listen-feature[\s\S]*?<\/section>/, '');
  }

  if (tracks.length > 0) {
    const rendered = tracks.map((t, i) => renderTrack(i + 1, t)).join('\n          ');
    // `<ol class="sx-tracklist">`, not a div — the container is the list the design numbers.
    out = replaceContainer(out, '<ol class="sx-tracklist"', rendered);
  } else {
    // The whole list goes, not its contents: an empty `<ol>` is still a numbered list with nothing in it.
    out = out.replace(/\s*<ol class="sx-tracklist"[\s\S]*?<\/ol>/, '');
  }

  /*
   * THE NOTE, WHICH IS A COUNT AND NOT A PROMISE. The design's sentence ends *"Sample titles shown for design
   * only—no recordings are published yet"*, which was true of the design and is false of the served page. It
   * is replaced by the archive's own count, so the sentence and the rows above it cannot disagree.
   */
  const note = tracks.length === 0
    ? 'No recording is published yet. A record appears here once an episode for it has been approved and '
      + 'published — the same condition the article itself uses before it shows a player.'
    : `${tracks.length} recording${tracks.length === 1 ? '' : 's'} approved and published. Every episode keeps `
      + 'its full transcript, source and speaker context beside the audio.';
  out = out.replace(/(<p class="sx-source-note">)[\s\S]*?(<\/p>)/, `$1${esc(note)}$2`);
  return out;
}


/** One A–Z entry: a category or a place. */
export type RealAzEntry = { name: string; href: string; kind: 'Category' | 'Place' };

/**
 * Fill `topics.html`'s A–Z index.
 *
 * The design's index mixes the two kinds — `<small>Category</small>` and `<small>Place</small>` — **and both
 * are real here: the archive's fourteen categories and its 188 towns.** The letters are regrouped from the
 * entries themselves, so a letter with nothing under it does not appear.
 */
export function fillTopics(html: string, entries: RealAzEntry[]): string {
  let out = dropExampleFlag(html);
  const byLetter = new Map<string, RealAzEntry[]>();
  for (const e of entries) {
    /*
     * THE LETTER COMES FROM THE FIRST CHARACTER A READER CAN SEE, NOT THE FIRST ONE STORED.
     *
     * One archive topic is stored as "U+2060 WORD JOINER + Religion and Spirituality". U+2060 is
     * Unicode category Cf — a format character, invisible in every renderer — and **String.trim()
     * removes whitespace only, so it survives**. Taking the first stored character therefore read
     * U+2060, which is not [A-Z], and filed a topic the reader looks for under R beneath `<h2>#</h2>`
     * in `id="num"` — a section whose own jump link the nav cannot offer, because `#num` is not a
     * letter. The page answered 200 and the topic was spelled correctly on screen; it was simply in
     * the wrong place, decided by a character nobody can see.
     *
     * So the leading run of format and control characters is stripped before the first character is
     * read. **This is a rule rather than a patch for one string**: a topic beginning with a
     * zero-width space (U+200B), a left-to-right mark (U+200E) or a byte-order mark (U+FEFF) is
     * filed under its first visible letter too. Whitespace is stripped as well, so the rule holds
     * even if trim() is ever removed. **Digits and symbols are deliberately NOT skipped** — an entry
     * genuinely beginning with a numeral belongs under `#`, and that behaviour is unchanged.
     */
    const first = (e.name.trim().replace(/^[\p{Cf}\p{Cc}\s]+/u, '')[0] ?? '#').toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter)!.push(e);
  }
  const blocks = [...byLetter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, list]) => {
      const items = list
        .map((e) => `<li><a href="${esc(e.href)}">${esc(e.name)}</a><small>${e.kind}</small></li>`)
        .join('');
      return `<section class="sx-az-letter" id="${letter === '#' ? 'num' : letter.toLowerCase()}"><h2>${esc(letter)}</h2><ul>${items}</ul></section>`;
    })
    .join('\n          ');

  // Replace the run of A–Z sections with the real one.
  const first = out.indexOf('<section class="sx-az-letter"');
  if (first === -1) return out;
  let end = first;
  let cursor = first;
  while (cursor !== -1) {
    const close = out.indexOf('</section>', cursor);
    if (close === -1) break;
    end = close + '</section>'.length;
    cursor = out.indexOf('<section class="sx-az-letter"', end);
  }
  out = out.slice(0, first) + blocks + out.slice(end);

  /*
   * ── AND THE LETTERS THAT JUMP TO THEM, WHICH IS THE HALF THAT WAS LEFT BEHIND ────────────────────
   *
   * The design draws two things that must agree: a run of `<section class="sx-az-letter" id="a">…` and a
   * `<nav class="sx-az-jump">` above it whose items are `<a href="#a">A</a>` for a letter the design had a
   * section for and `<span>B</span>` for one it did not. **The pass above replaces the SECTIONS and never
   * touched the NAV**, so the served page kept the design's own twelve anchors while the archive's own
   * letters took the sections' place.
   *
   * The two then disagreed by exactly the letters the archive's data does not produce. Measured on the
   * served page before this change: `/topics/#s` and `/topics/#t` were written on every `/topics/` view and
   * the page carried no `id="s"` and no `id="t"` — it carries `a b c d e f h i l m n` (and the `#` bucket as
   * `num`) `o p r u v`. **`#s` is the interesting one and it is a fill's fault rather than the design's:**
   * the design DID draw a section `s`, and the archive holds no topic or place beginning with S, so the
   * target went while the anchor stayed. `#t` was dead in the deliverable too — `topics.html` links it and
   * never drew `id="t"` — so removing it is the honest end, and inventing an S or a T to match a label is
   * the one thing this archive's rule forbids.
   *
   * So the nav is rebuilt from the SAME `byLetter` map the sections were built from, in the design's own
   * grammar: a letter with a section is an anchor, a letter without one is a `<span>`. **`#` is deliberately
   * not added**, because the design's jump row does not carry one and a nav item the design never drew is
   * not this pass's to invent. The page's own `num` section is still reachable by scrolling, exactly as it
   * is today.
   */
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const jump = letters
    .map((letter) => (byLetter.has(letter) ? `<a href="#${letter.toLowerCase()}">${letter}</a>` : `<span>${letter}</span>`))
    .join('');
  out = out.replace(
    /(<nav class="sx-az-jump" aria-label="Alphabet">)[\s\S]*?(<\/nav>)/,
    (_m, open: string, close: string) => `${open}${jump}${close}`
  );
  return out;
}

/** A town as the archive holds it. */
export type RealTown = { name: string; href: string; region: string | null; image: string | null; records: number };

/**
 * One town card, in the design's markup.
 *
 * **The design's card leads with a photograph; a town with none is drawn without one** rather than given a
 * stand-in, because the card's text carries the whole meaning and an unrelated picture would be worse than an
 * absent one. The `<small>` is the state the clan record gives, and the count is the archive's.
 */
export function renderTown(t: RealTown): string {
  const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : '';
  const where = t.region ?? 'Region not recorded';
  const records = t.records > 0 ? `${t.records} record${t.records === 1 ? '' : 's'}` : 'No records yet';
  return `<a href="${esc(t.href)}">${img}<span><small>${esc(where)}</small><strong>${esc(t.name)}</strong><em>${records} <span aria-hidden="true">→</span></em></span></a>`;
}

/** Fill `towns.html`'s grid with the archive's 188 published towns and clans. */
export function fillTowns(html: string, towns: RealTown[]): string {
  let out = dropExampleFlag(html);
  const rendered = towns.map(renderTown).join('\n          ');
  out = replaceContainer(out, '<div class="sx-town-grid"', rendered);
  return out;
}

/**
 * THE CAMERA THE PHOTOGRAPHS CARD CARRIES, DRAWN BY HAND BECAUSE NO FONT HERE HAS ONE.
 *
 * WHY THIS IS AN SVG AND NOT A CHARACTER LIKE THE OTHER THREE
 *
 * `≡`, `◉` and `◈` are typed characters, and **there is no camera character to type beside them**: Unicode has
 * no monochrome camera in the blocks a text font covers, and the one it does have — U+1F4F7 — is an EMOJI.
 * Measured in Chrome at this card's own `4rem` before this was written: the three typed signs are painted by
 * three different system fallbacks (`≡` by Symbol, `◉` by Hiragino Mincho ProN, `◈` by AppleMyungjo), all
 * monochrome and all taking the design's `--gold-bright`; **U+1F4F7 is painted by Apple Color Emoji, ignores
 * `color` entirely, and landed as a grey-and-steel photographic camera beside three gold line drawings.** On a
 * machine with no emoji font it is worse than that — a tofu box, which is the outcome the card was told to
 * avoid. So the sign is drawn.
 *
 * HOW IT SITS IN THE DESIGN'S OWN SLOT
 *
 * **No icon font is used or added.** There is none in this repository to draw from — `find apps/ozikoro/public
 * -name '*.woff*' -o -name '*.ttf' -o -name '*.otf'` returns nothing, and no stylesheet here declares
 * `@font-face` beyond the three Google families the design links. The markup goes inside the design's own
 * unchanged `<span class="sx-collection-glyph">`, so it inherits that rule's `display:grid; place-items:center`,
 * its emerald ground and its `font: 400 4rem`, and **no new rule is needed anywhere**: `width`/`height` are
 * `1em`, so the em IS the design's 4rem, and the stroke is `currentColor`, so the gold is the design's
 * `--gold-bright` token rather than a copy of its value.
 *
 * SIZE, MEASURED AGAINST THE OTHERS IN THE SAME BROWSER AT THE SAME `4rem`: the drawing fills 23.1 × 18.5 of
 * the 24-unit box, painting about **62 × 49 px** against **56.3 px** for `◉` and **52.5 px** for `◈`. A camera
 * is wider than it is tall, and the width is what makes it read as the same size rather than a smaller one.
 */
export const COLLECTION_CAMERA_SIGN =
  '<svg class="sx-collection-sign" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M3 6.6h4.4l1.7-3h5.8l1.7 3H21a1.8 1.8 0 0 1 1.8 1.8v10.4A1.8 1.8 0 0 1 21 20.6H3a1.8 1.8 0 0 1-1.8-1.8V8.4A1.8 1.8 0 0 1 3 6.6z"/><circle cx="12" cy="13.6" r="4.3"/><rect x="18.4" y="8.8" width="3.1" height="2.1" rx=".7"/></svg>';

/** One collection card. */
export type RealCollection = {
  label: string;
  name: string;
  href: string;
  cta: string;
  image: string | null;
  glyph: string | null;
  /**
   * A SIGN THAT HAS TO BE DRAWN RATHER THAN TYPED, AS MARKUP.
   *
   * `glyph` is a character and is escaped; **this is inserted as markup and must only ever be a constant from
   * this module** — `COLLECTION_CAMERA_SIGN` is the one that exists. A collection whose sign no font here can
   * draw sets this and leaves `image` null, which is how the Photographs card stopped being a photograph.
   */
  drawnGlyph?: string | null;
};

/** One collection card, in the design's `a` markup inside `.sx-collection-showcase`. */
export function renderCollection(c: RealCollection): string {
  /*
   * The design uses a photograph on some cards and a glyph on others, and a card that names a `drawnGlyph` takes
   * the glyph slot because that is the only slot that can hold a drawn sign. **The drawn sign wins over the
   * image deliberately and is not a fallback**: a card carrying one is a card whose collection is better named
   * by a sign than illustrated by one arbitrary record, and the caller leaves `image` null so the two cannot
   * disagree. The record keeps its own photograph wherever else it is shown.
   */
  const visual = c.drawnGlyph
    ? `<span class="sx-collection-glyph" aria-hidden="true">${c.drawnGlyph}</span>`
    : c.image
      ? `<img src="${esc(c.image)}" alt="" loading="lazy">`
      : `<span class="sx-collection-glyph" aria-hidden="true">${esc(c.glyph ?? '≡')}</span>`;
  return `<a href="${esc(c.href)}">${visual}<span><small>${esc(c.label)}</small><strong>${esc(c.name)}</strong><em>${esc(c.cta)} <span aria-hidden="true">→</span></em></span></a>`;
}

/** Fill `collections.html`'s showcase. */
export function fillCollections(html: string, collections: RealCollection[]): string {
  let out = dropExampleFlag(html);
  const rendered = collections.map(renderCollection).join('\n        ');
  out = replaceContainer(out, '<div class="sx-collection-showcase"', rendered);
  return out;
}

/** One article, as the reader page needs it. */
export type RealArticle = {
  title: string;
  topic: string | null;
  author: string | null;
  published: string | null;
  updated: string | null;
  image: string | null;
  imageAlt: string;
  caption: string | null;
  rights: string;
  body: string;
  /** The record's clean path, e.g. `/ute-okpu-…/`. Used for the citation. */
  path: string;
  /**
   * The reading frame's "Historical context" line.
   *
   * The design draws that heading and a paragraph under it. **The record's own summary is the honest thing to
   * put there**, and where the archive holds none the line says so rather than leaving the heading over
   * nothing.
   */
  context: string;
  /** The archive's own reference, e.g. `OZ-H-0001`. */
  reference: string;
  /**
   * THE CLAN, TOWN, PLACE OR PEOPLE THIS RECORD IS LINKED TO — §3.1's "a reader should be able to move from
   * an article to the clan, the town and the period it belongs to".
   *
   * **This was the largest gap in the archive and it was not a data problem.** `ozikoro_article_entity`
   * holds a link for every record whose title names a place, `/clans/<slug>/` and `/entities/<slug>/` both
   * answer, and the archive index has shown a `Place` chip since round 323 — **and the article head showed
   * none of it.** The reader could see the chip on the listing and had no way to follow it from the record
   * itself. 197 of 1,051 published records are linked; the other 854 say so.
   *
   * The shape is the design's own: `archive-index.html` draws `.chips > .chip.chip-place` with a
   * `<span class="k">Place</span>` label, and `main.css` styles `a.chip:hover`. So this fills a shape the
   * design drew — on another of its screens — rather than inventing markup. **Where the design drew no
   * shape at all the page states the absence instead**, which is what `archiveTotals` is for.
   */
  entities: RealArticleEntity[];
  /**
   * THE TWO FACETS NO RECORD IN THE ARCHIVE CAN FILL, SO THE ABSENCE CAN BE STATED RATHER THAN IMPLIED.
   *
   * Measured on 4 October 2026: **0 of 1,051 published records carry a period, and 0 carry a structured
   * source of their own** — `ozikoro_article.source_type`, `period_label` and `period_start` are null on
   * every row, and `ozikoro_article_source` is empty. `archive.ts` carries the same two facts on the filter
   * rail, which says *"No record in the archive has a period recorded yet"* and *"Of 1,051 published
   * entries, 0 carries a source of its own."*
   *
   * **The design draws no chip for an absence, and a page that showed nothing at all would read as a record
   * that has no place**, which is a different and false claim. So the record says which of the two it is —
   * the archive holds none of either — and the figure is read rather than remembered, so this sentence
   * stops being true the day somebody records a period or attaches a source.
   */
  archiveTotals: { published: number; withPeriod: number; withSource: number };
  related: { title: string; href: string; topic: string | null; image: string | null }[];
  /** Maps an original media URL to the file this archive serves. Absent means leave the URL alone. */
  resolveImage?: (url: string) => string | null;
  /**
   * THE PUBLISHED SPOKEN RECORD, IF ONE EXISTS.
   *
   * **Absent or null means the audio button does not appear at all.** The design's panel carries a `<button>`
   * and a speed control, and a button that plays nothing is worse than no button: it invites a click and
   * answers with silence.
   */
  episode?: {
    url: string;
    /**
     * WHETHER THE ADDRESS IS A FILE THIS PAGE CAN PLAY, OR A PAGE A READER IS SENT TO.
     *
     * `true` — our own MP3 on `/media/…`, or an external URL a fetch established is `audio/*`. The panel
     * gets `<audio data-listen-audio>` and the listen script drives it.
     *
     * `false` — an external page (a Spotify episode link). **It is NOT an `<audio src>`**: pointing one at it
     * gives a button that is pressed and does nothing, and the archive's rule is that the record says what
     * happened. So the button becomes an anchor that opens the service in a new tab, and the panel says so.
     */
    directAudio: boolean;
    /** The service holding the audio when `directAudio` is false and the audio is elsewhere. */
    service: string | null;
    seconds: number | null;
    narratorKind: string;
    narratorName: string | null;
    disclosure: string;
    transcript: string;
  } | null;
};

/**
 * A record's link to a clan, a town, a place or a people. See `RealArticle.entities`.
 *
 * The link's `role` and the entity's `kind` are separate facts and both are carried: `kind` is what the
 * entity is in the dictionary, `role` is what *this record's link to it* asserts. `igbodo-a-community-formed-
 * by-convergence` links to the clan `igbodo` and to the town `igbodo-northern-ika`, and their names are both
 * "Igbodo" — so a page that printed `kind` would label the same word twice and say nothing about which is
 * which.
 */
export type RealArticleEntity = {
  /** `clan`, `town`, `people`, `kingdom` — the entity's own kind in the dictionary. */
  kind: string;
  slug: string;
  name: string;
  /** `clan`, `town`, `ethnic_group`, `place` — what this record's link to the entity asserts. */
  role: string;
};

/**
 * Point the article's own images at this archive.
 *
 * WHY THIS IS THE PART THAT MATTERS
 *
 * A record's body carries its photographs inline — **2,871 of them across 1,027 articles** — and every one
 * pointed at `https://ozikoro.com/wp-content/uploads/…`, the live WordPress install. The archive holds those
 * same files; they are matched by `source_url` and served from `/media/`. **Without this the articles render
 * with broken images, which is the one thing the owner asked for: articles must have their images as they had
 * them on ozikoro.com.**
 *
 * `srcset` is rewritten too, because a `<img>` that has one is what the browser actually loads. **A URL with
 * no match is left exactly as it was** — a third of the misses are images that were never on ozikoro.com at
 * all, from Google or the BBC, and replacing those would be inventing a source.
 */
export function rewriteBodyImages(body: string, resolve: (url: string) => string | null): string {
  /*
   * A VIDEO IS NOT AN IMAGE, AND THREE OF ITS ADDRESSES WERE BEING MISSED.
   *
   * This function rewrote `<img src>` and `srcset` and nothing else. **A `<video>` is written by WordPress as
   * a `<video>` holding a `<source src>` and a fallback `<a href>`, and none of those three matched** — so the
   * record `omabe-nsukka-the-spirit-tradition-and-heritage-of-the-igbo-masquerade-festival` served two
   * videos pointing at `ozikoro.com/wp-content/uploads/2024/10/…mp4` while both files sat in the media
   * bucket with a row apiece. Seven published records carry a `<video>`; the other five happen to hold an
   * already-rewritten address.
   *
   * ⚠️ AND TWO SMALLER THINGS WERE ALSO WRONG ABOUT THE ADDRESS ITSELF, for images as well as video. The map
   * is keyed by the record's own `source_url`, which is absolute — `https://ozikoro.com/wp-content/…`. The
   * markup asks with a **relative** path, `/wp-content/…`, and the `<source>` carries a cache-buster,
   * `…mp4?_=2`. An exact-match lookup answers null for both, so the address survived untouched.
   *
   * So the lookup is normalised rather than the map: strip the query or fragment before asking, and ask again
   * with whatever the resolver did not already answer. **Nothing is rewritten unless a media row matched**,
   * which is what keeps this bounded — a link to another article cannot be touched, because no media row
   * carries that address. The query is put back when one was there, so a cache-buster still busts.
   */
  const fix = (url: string) => {
    const bare = url.replace(/[?#].*$/, '');
    const tail = url.slice(bare.length);
    /*
     * ⚠️ THE ADDRESS THE MARKUP QUOTES IS SITE-RELATIVE WHILE THE MAP IS ABSOLUTE, WHICH IS THE ROOT OF THIS.
     * `mediaUrlMap` is keyed by the record's own `source_url` — `https://ozikoro.com/wp-content/…` — and
     * WordPress wrote the video's `<source>` as `/wp-content/…`. An exact-match lookup answers null for every
     * one of them, so the address survived untouched however well the tags were matched. Asking both
     * spellings is the whole repair; the query string was a second, smaller miss on top of it.
     *
     * Tried in order, first answer wins: the address as written, then without its query or fragment, then
     * site-absolute when it is a path. The query is put back on whatever was found, so a cache-buster still
     * busts. And **nothing is rewritten unless a media row matched**, which is what keeps this bounded — a
     * link to another article cannot be touched, because no media row carries that address.
     */
    const tries: string[] = [url];
    if (bare !== url) tries.push(bare);
    if (bare.startsWith('/')) tries.push(`https://ozikoro.com${bare}`);
    for (const attempt of tries) {
      const found = resolve(attempt);
      if (found) return found + tail;
    }
    return url;
  };
  return body
    .replace(/(<img[^>]*?\ssrc=")([^"]+)(")/g, (_m, a, url, c) => a + fix(url) + c)
    // A video, its nested sources, and an audio element — the same `src` attribute, three more tags.
    .replace(/(<(?:video|source|audio)[^>]*?\ssrc=")([^"]+)(")/gi, (_m, a, url, c) => a + fix(url) + c)
    /*
     * AND THE FALLBACK ANCHOR, WHICH IS A LINK AND SO NEEDS A NARROWER NET. It is matched by extension
     * rather than by being inside a `<video>`, because a body's markup is not reliably nested — and an
     * extension test cannot reach an article link. A miss costs nothing: `fix` returns the address unchanged.
     */
    .replace(
      /(<a[^>]*?\shref=")([^"]+\.(?:mp4|m4v|webm|ogv|ogm|mov))(\?[^"]*)?(")/gi,
      (_m, a, url, q, c) => a + fix(url + (q ?? '')) + c
    )
    .replace(/(\ssrcset=")([^"]+)(")/g, (_m, a, set, c) =>
      a +
      set
        .split(',')
        .map((part: string) => {
          const trimmed = part.trim();
          const sp = trimmed.indexOf(' ');
          if (sp === -1) return fix(trimmed);
          return fix(trimmed.slice(0, sp)) + trimmed.slice(sp);
        })
        .join(', ') +
      c
    );
}

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;

/**
 * Fill `article.html` — the reading page, and the one screen where an article's own image belongs.
 *
 * WHAT IS REPLACED
 *
 *   `.sx-article-title .eyebrow`   the record's topic, with the state the archive actually holds
 *   `.sx-article-title h1`         the title
 *   `.sx-article-byline`           the named author, or the archive itself where none is recorded
 *   `figure.sx-article-image img`  the record's own featured image, served from `/media/`
 *   `figure.sx-article-image figcaption`  the rights state — **never a permission nobody granted**
 *   the `Published` / `Last updated` pairs  the record's real dates
 *   `.sx-page`                     the record's own body
 *   `.sx-related-list`             other records from the same topic
 *
 * **The design's figcaption says "Design placeholder from Ozikoro · final article image and rights must be
 * verified".** That sentence is true of the design and false of a real record, so it is replaced by the
 * archive's own state: the credit where one is recorded, and the licence state where none is.
 */
export function fillArticle(html: string, a: RealArticle): string {
  // The design's sibling links are relative and this page is not served from their directory.
  let out = absolutiseLinks(dropExampleFlag(html));

  /*
   * THE CHIPS THE DESIGN DRAWS, IN THE CHIP ROW IT DOES NOT — §3.1's largest gap.
   *
   * See `RealArticle.entities` for what this is and why it belongs here. Three details are load-bearing:
   *
   *   * THE ANCHOR IS THE DESIGN'S CLASS. `main.css` styles `a.chip:hover`, so a linked chip is drawn by the
   *     design's own stylesheet and not by anything added here.
   *   * THE LABEL IS THIS RECORD'S ROLE, not the entity's kind. `an-igbo-family-shrine-…` links to `Onicha`
   *     twice — once as a clan and once as a town — and `ozikoro_article_entity.role` is what tells the two
   *     apart. Printing the kind instead relabels one of them.
   *   * THE ADDRESS IS THE ONE THAT ANSWERS. `/entities/<slug>/` is the entity's own page for every kind;
   *     `/clans/<slug>/` is the register's page and only resolves for a clan. So every chip points at
   *     `/entities/`, which is the address the index's `Place` chip would land on too.
   */
  const chips = a.entities.length > 0
    ? `<div class="chips sx-article-entities">${a.entities
        .map((e) => {
          const role = /^[a-z_]+$/i.test(e.role) ? e.role : 'place';
          /*
           * SENTENCE CASE, BECAUSE THE DESIGN UPPERCASES THIS LABEL ITSELF.
           *
           * `.chip .k` is `text-transform: uppercase`, so the reader sees caps whatever is written here.
           * `ETHNIC GROUP` in the markup would be shouted twice and once on screen; this is the same thing
           * on screen and readable in the source.
           */
          const label = role
            .split('_')
            .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ');
          return `<a class="chip chip-${esc(role)}" href="/entities/${esc(e.slug)}/">` +
            `<span class="k">${esc(label)}</span> ${esc(e.name)}</a>`;
        })
        .join('')}</div>`
    : `<p class="small muted sx-article-entities">The archive holds no clan, town or place recorded for this entry. A link is made when the record's own title names one that the dictionary already holds, so a record that names none opens no register page.</p>`;

  /*
   * THE RECORD'S OWN LINKS, AND WHY THEY NOW SIT BELOW THE OPENING RATHER THAN INSIDE IT.
   *
   * They used to be injected after the byline, which put them INSIDE `div.sx-article-title`. The owner
   * saw the result and said so: *"the added clan did destroyed the design … position the clan well so it
   * will not have to be on the top, but below."* He is right, and the design says the same thing:
   * `article.html`'s `.sx-article-title` holds exactly three things — the eyebrow, the `h1` and the
   * byline — and `.sx-article-image` is its next sibling. A fourth child changes the measure the two
   * columns are cut to, which is why the title stopped occupying its space and ran to the left.
   *
   * So they go into the reading column, above the prose: the first thing a reader meets after the
   * opening. That is "below" by any reading of the instruction, and it is the column that already
   * carries the record's own apparatus — `sx-story-record`, the listen panel, the provenance.
   *
   * ⚠️ AND THE SENTENCE THAT USED TO TRAVEL WITH THEM IS GONE, ON HIS INSTRUCTION.
   *
   * It read: *"The archive records no period and no source type for this entry, or for any of its 1,051
   * published entries: 0 carry either. Dating and sourcing are editorial work, and this line disappears
   * when it is done rather than being approximated now."* He quoted it back by hand and said *"please
   * remove this words part."* It was a note to the archive's own editors sitting in a reader's view of an
   * article, and it was emitted on EVERY article, because no record in the archive carries a period or a
   * source type.
   *
   * ⚠️ THE FACT IT STATED IS STILL TRUE AND HAS NOT BEEN DELETED FROM THE PROJECT. `archiveTotals` still
   * measures it — and the archive's own filter rail still states the same two absences where a reader is
   * choosing how to search. What has stopped is repeating it beneath the byline of every history: a
   * reader who came to read one article does not need the corpus's data-quality position in the middle of
   * its opening.
   */
  if (chips) {
    /*
     * ⚠️ THE SELECTOR IS `<div class="sx-page">`, NOT `.sx-reading-columns` FOLLOWED BY IT.
     *
     * The first version of this used `/(<div class="sx-reading-columns">\s*<div class="sx-page">)/` and
     * inserted NOTHING — `out.replace` returns the string unchanged when the pattern does not match, so
     * the failure was silent and the record's own clan simply disappeared from the page. The design's
     * frame is `<div class="sx-reading-columns"><aside>…</aside><div class="sx-page">`: the ASIDE comes
     * between the two, so a pattern requiring them to be adjacent can never match.
     *
     * `sx-page` is the right target and is the design's own class. The chips land at its top, above the
     * listen panel and above the prose — the first thing a reader meets after the opening.
     *
     * `chips` already carries its own `<div class="chips sx-article-entities">` (or the fallback
     * paragraph), so it is inserted as it is; wrapping it again would nest the class twice.
     */
    out = out.replace(/(<div class="sx-page">)/, `$1${chips}`);
  }

  // The eyebrow: the record's topic and the archive's own description of its standing.
  out = out.replace(
    /(<div class="sx-article-title">\s*<p class="eyebrow">)[\s\S]*?(<\/p>)/,
    `$1${esc(a.topic ? `${a.topic} · Published history` : 'Published history')}$2`
  );
  // The title.
  out = out.replace(/(<div class="sx-article-title">[\s\S]*?<h1>)[\s\S]*?(<\/h1>)/, `$1${esc(a.title)}$2`);
  // The byline.
  out = out.replace(
    /(<p class="sx-article-byline">)[\s\S]*?(<\/p>)/,
    `$1By <strong>${esc(a.author ?? 'Ozikoro')}</strong>$2`
  );

  /*
   * THE LISTEN PANEL — THE AUDIO BUTTON APPEARS ONLY FOR AN APPROVED RECORD.
   *
   * The design's panel is a real player: a `<button data-listen-toggle>`, a speed `<select>` and a
   * `<progress>`. Filling none of it and leaving it on the page would offer a reader a button that plays
   * nothing. **Removing it is the honest state**, and it is what the design's own note anticipates —
   * *"Published audio would add narrator, rights, duration and a downloadable transcript."*
   *
   * When an episode HAS been approved, the panel says who is speaking and how, because that disclosure is
   * what Spotify's rules require and it belongs beside the play button rather than in a note elsewhere.
   */
  if (a.episode) {
    const mins = a.episode.seconds ? Math.floor(a.episode.seconds / 60) : null;
    const secs = a.episode.seconds ? a.episode.seconds % 60 : null;
    const length = mins !== null ? `${mins}m ${String(secs).padStart(2, '0')}s` : '';
    const transcriptSlug = a.path.replace(/^\//, '').replace(/\/$/, '');
    const service = a.episode.service && isExternalAudioService(a.episode.service)
      ? EXTERNAL_AUDIO_LABELS[a.episode.service]
      : null;

    if (a.episode.directAudio) {
      /*
       * THE FILE THE READER HEARS, PLAYED IN THE PAGE.
       *
       * The element carries the address; the design's own script drives the button and the progress bar, and
       * `audio-listen.js` is what hands the panel to it instead of the browser's voice.
       */
      out = out.replace(
        /(<p class="small" data-listen-status aria-live="polite">)[\s\S]*?(<\/p>)/,
        `$1Ready to listen${length ? ` · ${esc(length)}` : ''}$2`
      );
      out = out.replace(
        /(<button class="btn" type="button" data-listen-toggle[^>]*>)[\s\S]*?(<\/button>)/,
        '$1▶ Listen$2'
      );
      out = out.replace(
        /(<section[^>]*\bid="listen"[^>]*>)/,
        `$1<audio data-listen-audio preload="none" src="${esc(a.episode.url)}"></audio>`
      );
    } else {
      /*
       * THE AUDIO LIVES ELSEWHERE AND THE PAGE SAYS SO.
       *
       * **The button becomes an anchor, not a player.** A Spotify episode address is an HTML page: an
       * `<audio src>` pointing at it is a button that is pressed and answers with nothing, and the owner's
       * rule is that a Spotify link must not be presented as this archive's own recording. So the control is
       * a link with `target="_blank"`, the status line names the destination, and the two controls that
       * would have tuned a file that is not here — the speed select and the progress bar — are removed
       * rather than left as controls that do nothing.
       *
       * The transcript link stays: a reader sent to Spotify still has the words here, which is the whole
       * reason the transcript exists.
       */
      out = out.replace(
        /(<p class="small" data-listen-status aria-live="polite">)[\s\S]*?(<\/p>)/,
        `$1${service ? `Audio held on ${esc(service)} — it opens there` : 'Audio held elsewhere — it opens there'}` +
          `${length ? ` · ${esc(length)}` : ''}$2`
      );
      out = out.replace(
        /(<button class="btn" type="button" data-listen-toggle[^>]*>)[\s\S]*?(<\/button>)/,
        `<a class="btn" data-listen-external href="${esc(a.episode.url)}" target="_blank" rel="noopener noreferrer"` +
          ` style="text-decoration:none">${service ? `Listen on ${esc(service)} ↗` : 'Listen elsewhere ↗'}</a>`
      );
      out = out.replace(/<label>Speed[\s\S]*?<\/label>/, '');
      out = out.replace(/<progress[^>]*>[\s\S]*?<\/progress>/, '');
      /*
       * THE PANEL IS NO LONGER A READ-ALOUD CONTROL, AND THE ATTRIBUTE HAS TO SAY SO.
       *
       * Measured in a real browser: this sentence reached a reader as *"Browser narration is unavailable on
       * this device."* — because `design/reader.js` selects `[data-listen-status]`, finds no
       * `[data-listen-toggle]` (the button is an anchor now), and overwrites the status with its own message
       * about browser narration. **The panel was describing a mechanism it no longer offers, which is the same
       * fault as a dead control: the sentence and the thing disagree.**
       *
       * Renaming the attribute is the smallest serve-time change that keeps the design's own script out of a
       * panel it does not own. `reader.js` then finds no status element and no toggle, returns early, and binds
       * nothing — so the browser's voice cannot take over a page whose audio is a real recording held
       * elsewhere. The design file is not edited.
       */
      out = out.replace(/(<p class="small") data-listen-status( aria-live="polite">)/, '$1 data-listen-external-status$2');
    }

    /*
     * THE TRANSCRIPT LINK, TO THE TRANSCRIPT'S OWN PAGE.
     *
     * The owner's report was that a designed control led to a raw text file, so the reader's link is the page
     * that carries these words inside the design's reading layout — the same change, for the same reason, as
     * the listen screen's button above. **The `.txt` keeps its own address and is not deleted and not
     * redirected**: the feed's `<podcast:transcript>` is a claim about a file and Spotify reads it, so the page
     * is for readers and the file is for anything that wants the raw text.
     */
    out = out.replace(
      /(<p class="small muted">)[\s\S]*?(<\/p>)(\s*<\/section>)/,
      `$1${esc(a.episode.disclosure)}$2` +
        `<p class="small muted"><a href="/podcast/${esc(transcriptSlug)}/transcript/">Read the transcript</a>` +
        `${a.episode.narratorName ? ` · ${esc(a.episode.narratorName)}` : ''}` +
        `${!a.episode.directAudio && service ? ` · Audio held on ${esc(service)}, not by this archive` : ''}</p>$3`
    );
  } else {
    // **No approved episode, so no button.** The panel goes rather than sitting there inert.
    out = out.replace(/<section[^>]*\bid="listen"[^>]*>[\s\S]*?<\/section>/, '');
    /*
     * AND THE SIDEBAR'S OWN LINK TO IT GOES WITH THE PANEL, WHICH IS THE WHOLE OF THIS ROUND'S LARGEST FAULT.
     *
     * The design's reading page carries the panel (`<section class="sx-listen-panel" id="listen">`) **and** a
     * link to it in the left column — `<details><summary>Reading tools</summary>` … `<a href="#listen">Listen</a>`.
     * Served as an article, the panel is kept only when the record has an approved, playable episode; on every
     * other record the branch above removes it, because an inert player is not a state a reader should meet.
     * **The link was not removed with it**, so the page promised a section it had just deleted.
     *
     * MEASURED ON THE SERVED ARCHIVE, AND THAT IS WHY THE FIX IS CONDITIONAL RATHER THAN A DELETION:
     *
     *   `/how-tortoise-got-his-bumpy-shell/` — an approved episode — carries `id="listen"`, the
     *       `<audio data-listen-audio>` element and a working `#listen`; the link is right and stays.
     *   `/the-war-dance-festival-ila-oso-in-uzuakoli/` — no episode — carries no `id="listen"` anywhere and
     *       no player, so its `#listen` scrolled nowhere. 1,049 of 1,051 published records are this second
     *       case, which is why round 355's forty-page walk found 25 dead fragments and never one that worked.
     *
     * **The two travel together or neither does.** An empty `#listen` anchor left behind for the link to land
     * on would be inventing a section to satisfy a label — this archive's own rule forbids it — and removing
     * the link unconditionally would break the records where the panel really is on the page. **A nav item is
     * not a section.**
     */
    out = out.replace(/<a\b[^>]*\bhref="#listen"[^>]*>[\s\S]*?<\/a>/, '');
  }

  // The image, its alternative text, and the honest caption.
  if (a.image) {
    out = out.replace(
      /(<figure class="sx-article-image">\s*<img src=")[^"]*(" alt=")[^"]*(")/,
      `$1${esc(a.image)}$2${esc(a.imageAlt)}$3`
    );
    out = out.replace(/<figcaption>[\s\S]*?<\/figcaption>/, `<figcaption>${esc(a.caption ?? a.rights)}</figcaption>`);
  } else {
    // A record with no image carries no figure rather than an empty one.
    out = out.replace(/<figure class="sx-article-image">[\s\S]*?<\/figure>/, '');
  }

  // The dates the design prints.
  const pub = dateFmt(a.published);
  const upd = dateFmt(a.updated);
  if (pub) out = out.replace(/(<dt>Published<\/dt><dd>)[\s\S]*?(<\/dd>)/, `$1${esc(pub)}$2`);
  out = out.replace(/(<dt>Last updated<\/dt><dd>)[\s\S]*?(<\/dd>)/, `$1${esc(upd ?? pub ?? '—')}$2`);

  /*
   * THE BODY GOES INSIDE `.prose`, NOT INSTEAD OF `.sx-page`.
   *
   * `.sx-page` holds more than the text: **the design's own listen panel sits inside it, above a
   * `<div class="prose">` that carries the reading measure, the type scale and the drop cap.** The first
   * version replaced the whole container, which **deleted the listen panel and stripped the prose wrapper —
   * so the article rendered with the site's default paragraph styling instead of the design's.** That is
   * exactly what "the inside articles do not look like the demo" was.
   *
   * Only the prose block's contents are replaced now. The panel above it stays as the design drew it.
   */
  const resolved = a.resolveImage ? rewriteBodyImages(a.body, a.resolveImage) : a.body;
  /*
   * THE SANITISER, WHICH THIS PATH DID NOT RUN.
   *
   * The archive's rule is unambiguous and written in two migrations: `ozikoro_article.body_html` "is the
   * published HTML, kept verbatim … **it is sanitised when rendered, not when stored**" (0035), and the
   * revision table repeats it (0053). `getArticleBySlug` in `archive.ts` does run `prepareArchiveHtml`, which
   * is `rewriteBodyImages` → `sanitiseArchiveHtml` → `normaliseHeadingLevels` → `tidyWhitespace`.
   *
   * **The SERVED article page did not.** `apps/ozikoro/app/[slug]/route.ts` hands `row.body_html` to this
   * function and this function put it into the design's `.prose` block as it stood, after `rewriteBodyImages`
   * and `tidyBody` — neither of which removes a tag. So the read path's only guard was absent on the one
   * route a reader actually opens, and it was absent for the 1,051 imported bodies that have no other guard
   * at all. Measured by reading the path, not assumed: `rewriteBodyImages` rewrites `src`/`srcset` and
   * `tidyBody` rewrites `style` and `img` sizing, and neither touches `script`, `iframe` or an `on*`
   * attribute.
   *
   * IT GOES HERE, BETWEEN THE TWO, AND THE ORDER IS LOAD-BEARING. `sanitiseArchiveHtml` rewrites an internal
   * host to a relative path — `https://ozikoro.com/wp-content/…` becomes `/wp-content/…` — and
   * `rewriteBodyImages` resolves a body image by looking its `source_url` up in `ozikoro_media`. Sanitising
   * first would turn every archived image address into a relative one that the resolver cannot match, and
   * **1,049 of the archive's 1,053 published records carry an image in their text.** So the addresses are
   * resolved first, exactly as `prepareArchiveHtml` orders it, and then the markup is rebuilt against the
   * allowlist.
   *
   * The three jobs `prepareArchiveHtml` also does are deliberately NOT added here: `stripShortcodes`,
   * `normaliseHeadingLevels` and `tidyWhitespace` change how a record READS — moving headings, collapsing
   * paragraphs — and applying them to the served page would alter the outline of every record in the archive
   * in one go. That is a separate decision with its own measurement, and this change is the security one.
   */
  const safe = sanitiseArchiveHtml(resolved);
  // The featured image goes in the design's own figure; the body is tidied so it does not repeat it, and so
  // its WordPress widths do not run past the reading column.
  const body = tidyBody(safe, a.image);

  /*
   * ── AND THE RECORD'S OWN IN-PAGE TARGETS GET THE SAME ROOM ABOVE THEM AS THE FRAME'S ──────────────
   *
   * `body` now keeps the `name` attributes an archived body's own links point at (see the allowlist in
   * `content.ts`), so `[1]` in a record's text scrolls to its footnote and `[1]` at the foot scrolls back.
   * **A target that scrolls correctly can still be the one line the reader cannot see:** the browser puts a
   * fragment's target at the very top of the viewport, and `.sx-reader-header` is `position: sticky; top: 0`
   * — so the marker lands underneath it. That is round 352's measurement, and `fillArticleProse` already
   * answers it for the frame's own anchors with `scroll-margin-top`. **A record's footnote marker is the same
   * kind of target and gets the same offset.**
   *
   * MEASURED IN CHROME BEFORE THIS LINE EXISTED, with the `name` anchors restored by script: jumping to one
   * landed it at `top = 0` under a 53 px header, its whole 24 px box inside the covered band.
   *
   * It runs AFTER `tidyBody` and that is not incidental: `sanitiseArchiveHtml` drops `style` by design, so an
   * offset written before it would be removed with the Elementor `font-size` it is right to remove. This adds
   * one declaration to elements that are fragment targets and to nothing else.
   */
  const anchoredBody = body.replace(/<a\b([^>]*\bname="[^"]+"[^>]*)>/g, (whole: string, attrs: string) =>
    /\bstyle="/.test(attrs) ? whole : `<a${attrs} style="scroll-margin-top:6rem">`
  );

  /*
   * INTO THE DESIGN'S FRAME, NOT OVER IT.
   *
   * The article's words go into the slots the design drew — `#opening`, `#record`, `#context`, `#sources`,
   * `.cite-block` — and **every heading, id, class and section of the frame stays exactly where it is,
   * including the citation at the foot and the left-hand list the design wrote.**
   *
   * The previous version REPLACED the reading column: it rewrote "In this history" into the article's own
   * headings and moved the citation to the top. **Both were design decisions and neither was this work's to
   * make.** The frame wins; the record's words fit it.
   */
  const refs = extractReferences(anchoredBody);
  const rest = refs.length > 0
    ? anchoredBody.replace(/<h[2-4][^>]*>\s*(?:\d+\.\s*)?(?:references?|sources?|bibliography|works cited|further reading)[^<]*<\/h[2-4]>[\s\S]*$/i, '')
    : anchoredBody;
  /*
   * THE FIRST PARAGRAPH, WHICHEVER PARAGRAPH IT IS.
   *
   * `ndi-igbo-meet-the-igbo-people` opens with an `<h1>` holding its first question, so a match anchored at the
   * start found no paragraph and **left the drop cap empty** while the whole body fell into the section below.
   * The first paragraph anywhere becomes the lead; **everything before it is kept**, because a heading that
   * opened the record is part of the record.
   */
  /*
   * THE FIRST PARAGRAPH THAT HAS SOMETHING IN IT.
   *
   * WordPress writes `<p>&nbsp;</p>` as a spacer, and one of them sat at the top of this record — so the drop
   * cap was filled with a non-breaking space and read as **empty**, while the article's real opening paragraph
   * stayed in the section below. `ndi-igbo-meet-the-igbo-people` also opens with an `<h1>`, so a paragraph
   * anchored at the very start would have found nothing at all.
   *
   * **The lead is the first paragraph with text in it; everything before it is kept**, because a heading or a
   * spacer that opened the record is part of the record.
   */
  const paragraphs = [...rest.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  const chosen = paragraphs.find((m) => (m[1] ?? '').replace(/&nbsp;|\s|<[^>]+>/g, '').length > 40);
  const lead = chosen ? (chosen[1] ?? '') : '';
  const remainder = chosen ? rest.replace(chosen[0], '') : rest;

  out = fillArticleProse(out, {
    lead,
    rest: remainder,
    sources: refs,
    citation: `${a.author ?? 'Ozikoro'}. “${a.title}.” Ozikoro, ${(a.published ?? '').slice(0, 4) || 'n.d.'}. https://ozikoro.com${a.path}`,
  });

  // Related reading, from the same topic.
  if (a.related.length > 0) {
    /*
     * ⚠️ THE CARD'S `<span>` WRAPPER AND ITS `<em>` WERE BOTH MISSING, AND THE DESIGN'S OWN CSS LAYS THE
     * CARD OUT THROUGH THEM.
     *
     * `article.html` draws each related record as:
     *
     *     <a href="…"><img …><span><small>Historical Studies</small>
     *       <strong>Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots</strong>
     *       <em>Read history →</em></span></a>
     *
     * and this emitted `<a><img><small>…</small><strong>…</strong></a>` — **no `<span>`, no `<em>`.** The
     * owner reported the result as *"the design is faulty, and is not truly what the original design was"*,
     * which is exactly what it is: `.sx-related-list a` is a grid whose second track is the `<span>`, so
     * **without the wrapper the image, the category and the title are three siblings with nothing holding
     * them together**, and the card loses the shape the design gives it.
     *
     * ⚠️ AND THE `<em>` IS NOT DECORATION. Every other card in this design ends with one — `Read history →`,
     * `Read or listen →` — and it is the line that tells a reader the card is a way in rather than a caption.
     * *Its wording is the design's own and is emitted literally rather than composed, because it is furniture
     * rather than a fact about the record: the archive has nothing to say about what a reader will do next.*
     */
    const items = a.related
      .map(
        (r) =>
          `<a href="${esc(r.href)}">${r.image ? `<img src="${esc(r.image)}" alt="Archival image from Ozikoro">` : ''}<span><small>${esc(r.topic ?? 'From the archive')}</small><strong>${esc(r.title)}</strong><em>Read history →</em></span></a>`
      )
      .join('\n            ');
    out = replaceContainer(out, '<div class="sx-related-list"', items);
  }

  return out;
}

/** Who is looking at a dashboard, and what they may do. */
export type DashboardWho = {
  signedIn: boolean;
  name: string | null;
  /** The role this screen is for, as the archive names it. */
  roleLabel: string;
  /** Every role the account actually holds. */
  roles: string[];
  /** The capabilities those roles grant, in the archive's own vocabulary. */
  capabilities: string[];
  today: string;
};

/**
 * Fill a role dashboard.
 *
 * THE NUMBERS ON THE DESIGN ARE EXAMPLES AND A REAL MEMBER'S ARE ZERO
 *
 * `dashboard-reader.html` shows `Saved histories 12`, `Followed topics 6`, `Reading history 4`,
 * `Collections 2`, and three tasks labelled *"Example workspace item"*. **A member who joined a moment ago
 * has none of those, and a dashboard that opened with twelve saved histories would be inventing a reading
 * history for somebody who has not read anything.** So every count is real, the tasks become honest empty
 * states, and where the archive holds nothing the page says what would fill it.
 *
 * A VISITOR WHO IS NOT SIGNED IN GETS THE SAME PAGE, SAYING SO
 *
 * **This is the owner's point about "My Ozikoro": it must not open on a sign-in form.** So an anonymous
 * visitor sees the dashboard, told plainly that it is theirs to claim, with the two ways in. **The screen is
 * not hidden behind the door it describes.**
 */
export function fillDashboard(html: string, who: DashboardWho): string {
  let out = dropExampleFlag(html);

  // Who this workspace belongs to.
  out = out.replace(/(<header class="sx-dash-top">[\s\S]*?<strong>)[\s\S]*?(<\/strong>)/, `$1${esc(who.roleLabel)}$2`);

  // The date and the greeting.
  out = out.replace(/(<div class="sx-dash-title">\s*<div>\s*<p class="eyebrow">)[\s\S]*?(<\/p>)/, `$1${esc(who.today)}$2`);
  out = out.replace(
    /(<div class="sx-dash-title">[\s\S]*?<h1>)[\s\S]*?(<\/h1>)/,
    `$1${who.signedIn ? `Welcome back${who.name ? `, ${esc(who.name)}` : ''}` : 'Your workspace'}$2`
  );

  /*
   * THE METRICS BECOME REAL. All four are zero for every account in the archive, because the tables that
   * would hold a saved item or a followed topic have no rows. **Stated as zero rather than as the design's
   * example, and each carries what would fill it.**
   */
  const metrics: [string, string][] = [
    ['Saved histories', '0'],
    ['Followed topics', '0'],
    ['Reading history', '0'],
    ['Collections', '0'],
  ];
  out = replaceContainer(
    out,
    '<section class="sx-metrics"',
    metrics
      .map(([label, value]) => `<article class="sx-metric"><span class="small muted">${esc(label)}</span><b>${value}</b></article>`)
      .join('\n        ')
  );

  // The priority panel: an honest empty state, or the visitor's way in.
  const work = who.signedIn
    ? `<div class="sx-task"><span class="sx-status ">Ready</span><div><strong>Nothing is waiting for you</strong><p class="small muted">Saved records, followed topics and anything you submit will appear here.</p></div><small class="muted">Now</small></div>`
    : `<div class="sx-task"><span class="sx-status pending">Not signed in</span><div><strong>This workspace is yours to claim</strong><p class="small muted"><a href="/join">Join Ozikoro</a> to keep a collection and submit a history, or <a href="/signin">sign in</a> if you already have an account.</p></div><small class="muted">Now</small></div>`;
  out = replaceContainer(out, '<div class="sx-panel-body">', work);

  // "At a glance": what the account actually holds.
  const glance = who.signedIn
    ? `<p class="eyebrow">Roles held</p><p style="margin-top:var(--s-2)">${who.roles.length ? esc(who.roles.join(', ')) : 'Reader'}</p>
        <hr style="margin-block:var(--s-4);border:0;border-top:1px solid var(--rule)">
        <p class="eyebrow">What you may do</p><p style="margin-top:var(--s-2)" class="small">${who.capabilities.length ? esc(who.capabilities.join(', ')) : 'Read the archive.'}</p>`
    : `<p class="eyebrow">Profile status</p><p style="margin-top:var(--s-2)">No account yet</p>
        <hr style="margin-block:var(--s-4);border:0;border-top:1px solid var(--rule)">
        <p class="eyebrow">Next action</p><p style="margin-top:var(--s-2)"><a href="/join">Join Ozikoro</a></p>`;
  // The second `.sx-panel-body` is the "At a glance" aside. Found by position rather than by splitting, so a
  // panel body added to the design later does not silently take the wrong content.
  const firstBody = out.indexOf('<div class="sx-panel-body">');
  const secondBody = out.indexOf('<div class="sx-panel-body">', firstBody + 1);
  if (secondBody !== -1) {
    const open = secondBody + '<div class="sx-panel-body">'.length;
    const close = out.indexOf('</div>', open);
    if (close !== -1) out = out.slice(0, open) + glance + out.slice(close);
  }

  return out;
}

/** A downloadable document the archive actually holds as a file. */
export type RealDocument = {
  title: string;
  href: string;
  /**
   * The record page at `/documents/<slug>/`. The same fault the photograph gallery had: this card
   * offered only a download, so the provenance, the rights and the citation were unreachable from the
   * library. The record is the way in; the file is one of the things it offers.
   */
  recordHref: string;
  label: string;
  note: string;
  size: string | null;
};

/** One document card, in the design's `.sx-pdf-grid > article` markup. */
export function renderDocument(d: RealDocument): string {
  return `<article><span class="sx-file-icon">PDF</span><div><small>${esc(d.label)}</small><h3><a href="${esc(d.recordHref)}">${esc(d.title)}</a></h3><p>${esc(d.note)}</p><p><a href="${esc(d.recordHref)}">Record and citation</a> · <a href="${esc(d.href)}" download>Download PDF${d.size ? ` · ${esc(d.size)}` : ''} <span aria-hidden="true">↓</span></a></p></div></article>`;
}

/**
 * What `/documents/` says when it has no document it can name.
 *
 * `mediaName` names a record from the record's own text and falls back to `Untitled document — <file>`
 * when every field the record holds is the file's own name. **This library does not list the fallback**:
 * a heading gives a reader nothing to choose between — which is the owner's own request, *"please remove
 * the two document there written 'untitled document'."*
 *
 * ⚠️ THE RECORDS ARE NOT DELETED, AND NO NAME IS INVENTED FOR THEM. Each one keeps its page, its file,
 * its rights and its address, so the sentence says exactly that rather than implying the archive lost
 * them. Giving `capacity_building_for_traditional` a human title would be fabricating a name the archive
 * does not hold; `mediaName`'s comment records that the honest label is the one it produces. **They are
 * removed from the listing, not renamed.**
 *
 * The words live here, beside the grid they fill, so the page and the test read the same sentence and a
 * later edit cannot leave the test asserting copy nobody serves.
 */
export function renderNoNameableDocuments(): string {
  return `<div class="empty">
          <p>No document the archive can name is listed here yet. A record whose heading would read “Untitled document — …” is left out of this list, because a heading gives a reader nothing to choose between — but the file is still held by the archive, still downloadable, and still reachable at its own record address.</p>
        </div>`;
}

/**
 * Fill `documents.html`'s file grid.
 *
 * THE MIGRATION'S `document` KIND IS NOT ALL DOCUMENTS
 *
 * Twelve media records carry `kind = 'document'`. **Eight of them are `text/html` — saved web pages, not
 * files** — and the brief is explicit that a capture is not a publication. **Only the four real PDFs are
 * listed**, and the screen says so rather than presenting a saved page as a document a reader can download.
 *
 * The design's own examples are two *demonstration* PDFs, and the brief forbids converting those into
 * official records. They are replaced by files the archive genuinely holds.
 *
 * ⚠️ AND WHEN THE CALLER HAS NOTHING TO LIST, THE DEMONSTRATIONS GO TOO. This function used to be called
 * only when `docs` was non-empty, so a screen with no nameable real documents kept the design's invented
 * files. It now empties the grid in either case: with the real cards, or with the caller's `empty`
 * sentence. **An empty state is a real state**, and it is never the demonstration.
 */
export function fillDocuments(html: string, docs: RealDocument[], empty?: string): string {
  let out = dropExampleFlag(html);
  /*
   * ⚠️ AN EMPTY GRID IS A REAL STATE, AND IT IS NOT THE DESIGN'S DEMONSTRATION.
   *
   * `sx-pdf-grid` holds two demonstration PDFs and a locked card. Until now this function was called only
   * when there was something to put in it (`if (docs.length > 0)`), so a documents screen with **nothing
   * nameable to list** kept the design's invented files — `Ozikoro archive record guide`, `Collection
   * finding-aid pattern` — and presented them as the archive's holdings. That is the fault this repository
   * keeps recording: the demo is what a reader meets whenever the real content is absent.
   *
   * So the grid is emptied either way, and when there is nothing real to list it says so. The caller passes
   * the sentence, because the reason the list is empty is the caller's to state (`/documents/` builds its
   * from the rule that a library lists what it can name); the default says the plain thing.
   */
  const rendered = docs.length
    ? docs.map(renderDocument).join('\n        ')
    : empty ?? '<div class="empty"><p>No document is listed here yet. Nothing is presented in its place.</p></div>';
  out = replaceContainer(out, '<div class="sx-pdf-grid"', rendered);

  /*
   * ── ⚠️ AND THE RESEARCH SECTION, WHICH THIS FUNCTION NEVER TOUCHED ─────────────────────────────────
   *
   * `documents.html` holds demonstration content in TWO containers, and this replaced only the second:
   *
   *   #research   →  <div class="sx-publication-list">   ⚠️ LEFT ALONE since the screen was written
   *   #other-pdfs →  <div class="sx-pdf-grid">           replaced with the archive's real PDFs
   *
   * **So every PDF record the archive holds was listed correctly — beneath a fabricated publication.**
   * Measured on `/documents/`: the page linked four real files
   * (`/documents/igbo-folk-idioms-in-caribbean-phrase/` and three others) **and, above them,
   * `"Market week and ritual office: reading testimony against the administrative return"` attributed to
   * `"Chinwe Ị̀kẹ̀jìànị̀ and Emeka Ǹwàchukwu · 2026"`, beside a Download button pointing at
   * `../downloads/research-download-demonstration.pdf`.** None of that is in the database. It is the
   * design's placeholder, and the owner clicked it expecting a document and found none.
   *
   * ⚠️ **IT CANNOT BE FILLED FROM THE ARCHIVE, BECAUSE THE ARCHIVE HOLDS NOTHING TO FILL IT WITH:**
   * `ozikoro_publication` has **zero rows**. So the section says so. **A heading with a true sentence under
   * it beats a heading that vanishes and reappears the day a paper is deposited**, and it beats a
   * demonstration that reads as a real paper for as long as nobody checks.
   *
   * The words are the ones `apps/ozikoro/app/documents/page.tsx` already uses for its own empty state, so
   * the repository says this once rather than twice in two different ways.
   */
  out = replaceContainer(
    out,
    '<div class="sx-publication-list"',
    `<div class="empty">
          <p>No publication has been deposited yet. A paper appears here once it has been submitted, screened and published through the archive’s review, with its version history and its access terms recorded.</p>
          <p><a class="btn" href="/submit">Deposit a paper</a></p>
        </div>`
  );
  /*
   * AND THE COUNT BESIDE THE HEADING, WHICH READ `Sample publication states`.
   *
   * It is not a count at all — it is a label saying the row above is a demonstration — and with the
   * demonstration removed it says nothing a reader can use. `ozikoro_publication` is empty, so the honest
   * figure is zero; **the day a paper is deposited this line needs the real number, and it is written here
   * rather than in the route because the route does not reach this container.**
   */
  out = out.replace(
    /<span class="small muted">Sample publication states<\/span>/,
    '<span class="small muted">0 published</span>'
  );
  return out;
}

/**
 * Tidy an article's body so it reads inside the design's column.
 *
 * TWO FAULTS, BOTH FROM WORDPRESS, BOTH VISIBLE ON THE PAGE AND NOWHERE ELSE
 *
 * 1. THE FEATURED IMAGE APPEARED TWICE. WordPress writes the featured image into `figure.sx-article-image`
 *    AND, very often, again as the first thing in the body — the same file, twice, one above the other.
 *    **The reader sees a photograph, then the same photograph.** So a leading figure whose image is the
 *    featured image is dropped. **Only the leading one, and only on an exact file match**: a later appearance
 *    of the same photograph is a deliberate repetition in the prose and is left alone.
 *
 * 2. THE IMAGES OVERFLOWED THE COLUMN. WordPress writes `style="width: 719px"` on the figure and
 *    `width="719" height="480"` on the image, and **the design's own stylesheet sets `.prose figure { max-width:
 *    none; }` on purpose** — it does not police a body it did not write. So a 719-pixel figure sat inside a
 *    narrower reading column and ran past it.
 *
 *    **`max-width: 100%` and `height: auto` are applied to the element itself**, because the design is not to be
 *    edited and an inline style is the only place left that a body can carry. The `srcset` is kept, so the
 *    browser still chooses a sensible file for the width it has; only the fixed dimensions are removed.
 */
export function tidyBody(body: string, featuredImage: string | null): string {
  let out = body;

  /*
   * 1. THE FEATURED IMAGE IS NOT REPEATED IN THE BODY — ANYWHERE, NOT ONLY AT THE TOP.
   *
   * The first version removed only a LEADING figure. **On `ndi-igbo-meet-the-igbo-people` the same photograph
   * also appears at the END of the body**, so the reader still met the featured image twice — once as the
   * design's figure and once again below the text. **The owner's rule is that the same exact image must not
   * show twice, and a rule about a file cannot depend on where in the prose it was pasted.**
   *
   * So every `<figure>` whose image is the featured file is dropped, and a bare `<img>` of it is dropped too.
   * **A deliberate repetition is lost as a result**, which is the right trade: an archive repeating its own
   * lead photograph by accident is far more likely than one doing it on purpose.
   */
  if (featuredImage) {
    const escaped = featuredImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inFigure = new RegExp(`<figure[^>]*>(?:(?!</figure>)[\\s\\S])*?src="${escaped}"[\\s\\S]*?</figure>`, 'g');
    out = out.replace(inFigure, '');
    // A bare image of the same file, not wrapped in a figure.
    const bare = new RegExp(`<img[^>]*?src="${escaped}"[^>]*>`, 'g');
    out = out.replace(bare, '');
  }

  // 2. Responsive images, without touching the stylesheet.
  const FIT = 'max-width:100%;height:auto;';
  /*
   * A FIXED WIDTH IS REMOVED WHEREVER IT SITS, IN ANY STYLE ATTRIBUTE.
   *
   * The first version handled `style="width: 719px"` on a `<figure>` and then rewrote the `style` of every
   * element — **but the rewrite only dropped a declaration that was exactly `width: Npx` on its own, so three
   * survived inside multi-declaration styles.** The pattern below removes the width declaration wherever it
   * appears in a style string, and leaves the others alone.
   */
  out = out.replace(/style="([^"]*)"/g, (_whole: string, decls: string) => {
    const kept = decls
      .split(';')
      .map((d: string) => d.trim())
      .filter((d: string) => d && !/^width\s*:\s*\d+(\.\d+)?px$/i.test(d))
      .join('; ');
    return kept ? `style="${kept};"` : '';
  });
  /*
   * AND NOTHING IS ADDED TO ANY OTHER ELEMENT.
   *
   * The previous version appended `max-width:100%;height:auto` to EVERY element carrying a style attribute —
   * paragraphs and spans included — where it means nothing. **Image-sizing declarations belong on images**, and
   * the block below is where they go.
   */
  // The fixed attributes, which `height:auto` cannot override on their own.
  out = out.replace(/<img([^>]*)>/g, (_m: string, attrs: string) => {
    const cleaned = attrs
      .replace(/\swidth="\d+"/g, '')
      .replace(/\sheight="\d+"/g, '');
    return `<img${cleaned} style="${FIT}">`;
  });

  return out;
}

/**
 * Point the design's own relative links at absolute addresses.
 *
 * THE BUG THIS FIXES, WHICH WAS MINE
 *
 * The deliverable's screens link each other RELATIVELY — `archive-index.html`, `folklore.html`, `home.html` —
 * because every screen sits in one directory. **Served from that directory they resolve; served from an
 * article's address they do not.**
 *
 *     at /design/screens/article.html     archive-index.html -> /design/screens/archive-index.html
 *     at /ute-okpu-an-ika-igbo-clan-…/    archive-index.html -> /ute-okpu-…/archive-index.html   404
 *
 * **So the "← All histories" link at the foot of every article led to "This address does not resolve to an
 * entry", which is exactly what the owner reported.** Every other relative link on the page was broken the
 * same way — Folklores, Watch, Explore, Archive, My Ozikoro, About, the footer's four columns.
 *
 * THE DESIGN IS NOT EDITED. This runs on the SERVED output only; the file on disk keeps its relative links
 * and is still correct when opened from the deliverable's own directory — which is the property the handoff
 * needs.
 *
 * `home.html` becomes `/`, because that is where the home screen is served. A fragment and a query are kept,
 * so `about.html#contact` still lands on the contact section.
 */
export function absolutiseLinks(html: string): string {
  return html.replace(
    /href="(?!https?:|mailto:|tel:|#|\/)([A-Za-z0-9._-]+)\.html(#[^"]*)?(\?[^"]*)?"/g,
    (_m, name: string, hash?: string, query?: string) => {
      const path = name === 'home' || name === 'index' ? '/' : `/${name}`;
      return `href="${path}${hash ?? ''}${query ?? ''}"`;
    }
  );
}

/**
 * A table of contents built from the article's own headings, and the anchors to make it work.
 *
 * THE SIDEBAR POINTED AT NOTHING
 *
 * The design's article carries a fixed list in its left column:
 *
 *     In this history      Opening · Written record · Historical context · Sources
 *     Reading tools        Listen · View sources · Copy citation · Related reading
 *
 * **Every one of those anchors exists in the design's example body and none of them exists in a WordPress
 * body** — a real article's only ids are `attachment_1234` on its figures. **So the whole sidebar was inert:
 * a reader could click any of the eight links and nothing would move.**
 *
 * WHAT REPLACES IT
 *
 * A real article HAS sections — `ndi-igbo-meet-the-igbo-people` has "Who are the Igbo people?", "Cultural
 * Regions of Alaigbo", "Religious Beliefs of the Igbo People" and more. **They simply have no ids.** So each
 * heading is given one, derived from its own text, and the list is built from those headings in order.
 *
 * **The result is a table of contents that is a fact about the article rather than a template.** A record with
 * two sections lists two; one with none lists none and the summary is dropped rather than left opening onto an
 * empty list.
 *
 * THE NUMBERING IS DROPPED. WordPress writes "1. Who are the Igbo people?" and the list said exactly that.
 * **An ordered list is a `<nav>`, not prose**, so the digits that belong in the heading go with it and the
 * list supplies its own order.
 */

/** `Who are the Igbo people?` -> `who-are-the-igbo-people`. Unique, and stable for a given heading. */
function anchorFor(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/&[a-z]+;/g, ' ')
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section';
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

export type TocEntry = { id: string; text: string };









/**
 * Fill the design's reading frame with the article's own words, WITHOUT ALTERING THE FRAME.
 *
 * THE MISTAKE THIS CORRECTS
 *
 * The first version of this fill REPLACED the design's reading column. It rewrote the left-hand list — "In this
 * history: Opening, Written record, Historical context, Sources" — into the article's own headings, and it moved
 * the citation from the foot of the article to the top. **Both are design decisions, and the owner's rule is
 * that the design is not to be changed by this work.**
 *
 * **The correct move is the opposite one: the article's content fits the design's frame, not the other way
 * round.**
 *
 * THE FRAME, WHICH IS NOT TOUCHED
 *
 *     <div class="prose">
 *       <p id="opening" class="dropcap">…</p>
 *       <h2 id="record">The written record</h2>
 *       <p>…</p> <blockquote>…</blockquote>
 *       <h2 id="context">Historical context</h2>
 *       <p>…</p> <section class="sx-story-record">…</section>
 *       <h2>What remains uncertain</h2>
 *       <p>…</p>
 *       <section id="sources" class="provenance"><p class="eyebrow">Sources and references</p><ol>…</ol></section>
 *       <section id="citation"><p class="eyebrow">Cite this article</p><div class="cite-block">…</div></section>
 *     </div>
 *
 * **Every heading, every id, every class and every section above stays exactly where the design put it,
 * including the citation at the foot.** Only the TEXT inside them is replaced — which the owner permits, and
 * which is the whole point of filling a template.
 *
 * WHERE THE ARTICLE'S WORDS GO
 *
 *   #opening     the record's first paragraph, which is what a drop cap is for
 *   #record      everything else the record says
 *   #context     the record's own summary where the archive holds one, and otherwise an honest line
 *   #sources     the record's references, where it has any — 769 of them do
 *   .cite-block  the citation, generated from the record
 */
export function fillArticleProse(
  html: string,
  content: { lead: string; rest: string; sources: string[]; citation: string }
): string {
  /*
   * ONE PASS OVER THE FRAME, WITH PATTERNS THAT DO NOT ASSUME HOW THE DESIGN WRITES A TAG.
   *
   * This function has now been wrong three times for the same reason: **it matched an element by the exact
   * text it expected, and the element did not have that text.**
   *
   *   the design writes `<section class="provenance" id="sources">` — `class` first, `id` second
   *   and `<h2 id="record">` — `id` first
   *   and after the first pass added `style="scroll-margin-top:6rem"`, a pattern expecting
   *   `<h2 id="record" class="sr-only">` matched nothing at all — **so the design's example text stayed on the
   *   page and the record's own words went somewhere else.**
   *
   * Every pattern below therefore matches on the `id` alone, anywhere in the tag, with anything after it.
   * **A tag is found by what identifies it, not by how it happens to be spelled today.**
   */
  const TAG = (name: string, id: string) => new RegExp(`<${name}[^>]*\\bid="${id}"[^>]*>`);

  const recordOpen = TAG('h2', 'record');
  const contextOpen = TAG('h2', 'context');
  const sourcesOpen = TAG('section', 'sources');
  const citationOpen = TAG('section', 'citation');

  /*
   * THE SCROLL OFFSET, WHICH THE DESIGN'S STYLESHEET DOES NOT SET.
   *
   * `.sx-reader-header` is `position: sticky; top: 0` and a progress bar sits over it, and **the browser scrolls
   * a target to the very top of the viewport — which is where the header is.** Every link therefore landed a
   * few lines into its section. The owner saw it: *"when you click on opening, it takes you to three lines after
   * the first words."*
   *
   * `scroll-margin-top` is the property for this. **It goes on the elements rather than in the stylesheet
   * because the stylesheet is the design and is not edited**, and how much room an element needs above it when
   * scrolled to is the element's own business.
   */
  const OFFSET = ' style="scroll-margin-top:6rem"';
  /**
   * The OPENING TAG ONLY.
   *
   * This was called with a complete element — `<h2 …>The written record</h2>` — and appended the attribute
   * before the final `>`, **which is the closing tag's bracket**, producing `</h2 style="scroll-margin-top:6rem">`.
   * It takes an opening tag and returns one; anything else is a misuse.
   */
  const withOffset = (openTag: string) => (/\sstyle="/.test(openTag) ? openTag : openTag.replace(/>$/, `${OFFSET}>`));

  let out = html;

  /*
   * #context IS MOVED INTO THE RECORD.
   *
   * With the example paragraph removed it sat eighty characters above the sources, so "Historical context" and
   * "Sources" scrolled to the same place — and the owner reported exactly that: *"when one clicks on sources, it
   * seems to take them to the cite this article."*
   *
   * A record's context is where it stops opening and starts explaining: **its own first sub-heading.** The anchor
   * goes immediately before it, or directly after the lead when the record has no sub-heading — the earliest
   * point at which there is context to point at.
   */
  const contextHeading = withOffset('<h2 id="context" class="sr-only">') + 'Historical context</h2>';
  const firstHeading = /<h[23][^>]*>/.exec(content.rest);
  let restWithContext: string;
  if (firstHeading) {
    restWithContext = content.rest.slice(0, firstHeading.index) + contextHeading + content.rest.slice(firstHeading.index);
  } else {
    /*
     * NO SUB-HEADING, SO THE ANCHOR GOES WHERE THE RECORD STOPS OPENING AND STARTS EXPLAINING.
     *
     * Most of this archive was written as continuous paragraphs, so there is often no heading to hang the
     * anchor on. **Putting it at the end made "Historical context" scroll to the sources** — which is what the
     * owner saw. A few paragraphs in is the point at which a record has usually said what it is about and begun
     * to account for it, and it is a real, distinct place to land.
     */
    const paras = [...content.rest.matchAll(/<p[^>]*>/g)];
    const at = paras.length >= 4 ? (paras[2]?.index ?? 0) : (paras[1]?.index ?? 0);
    restWithContext = content.rest.slice(0, at) + contextHeading + content.rest.slice(at);
  }

  // #opening — the lead paragraph keeps the design's class and id.
  // `#opening` and `#record` are written here, so the offset is written with them rather than patched on after.
  out = out.replace(/(<p[^>]*\bid="opening"[^>]*>)[\s\S]*?(<\/p>)/, (_m, open: string) => `${withOffset(open)}${content.lead}</p>`);

  /*
   * EVERYTHING BETWEEN `#record` AND `#sources`, REPLACED IN ONE MOVE.
   *
   * That span holds the design's paragraph, its blockquote, its "Evidence note" section and the "What remains
   * uncertain" heading — **scaffolding a template needs and a history does not have.** The record's own words
   * take their place, and the `#context` anchor rides in front of the record's first sub-heading.
   */
  const recordToSources = new RegExp(`${recordOpen.source}[\\s\\S]*?${sourcesOpen.source}`);
  /*
   * THE `#sources` OPENING TAG IS RE-EMITTED, NOT DROPPED.
   *
   * The pattern is non-greedy and so ENDS at that tag — and the first version replaced the whole match without
   * putting it back, **which deleted the sources section's opening tag and left its list and heading parentless.**
   * A replacement that consumes a delimiter has to write the delimiter again.
   */
  out = out.replace(
    recordToSources,
    `${withOffset('<h2 id="record" class="sr-only">')}The written record</h2>${restWithContext}${withOffset(sourcesOpen.exec(out)?.[0] ?? '<section class="provenance" id="sources">')}`
  );

  /*
   * #sources — THE RECORD'S OWN REFERENCES, OR NOTHING AT ALL.
   *
   * 769 records state their sources; the rest do not. **A block saying "no source is recorded" is worse than no
   * block**, because it draws the eye to an absence a reader did not come for. When a record has none the
   * section is hidden and **an empty off-screen anchor is left in its place so the sidebar's two links still
   * resolve** — the alternative is a link that scrolls nowhere, which is the fault this pass began with.
   */
  if (content.sources.length > 0) {
    const items = content.sources.map((r) => `<li>${esc(r)}</li>`).join('');
    out = out.replace(/(<section[^>]*\bid="sources"[^>]*>[\s\S]*?<ol>)[\s\S]*?(<\/ol>)/, `$1${items}$2`);
    out = out.replace(sourcesOpen, (tag) => withOffset(tag));
  } else {
    out = out.replace(new RegExp(`${sourcesOpen.source}[\\s\\S]*?<\\/section>`), `<span id="sources" class="sr-only"${OFFSET}></span>`);
  }

  // The citation stays in the design's own block, at the foot, where it was written.
  out = out.replace(citationOpen, (tag) => withOffset(tag));
  // The design's own panels are sidebar targets too, so they take the offset as well — `#listen` is the first
  // link under "Reading tools" and landed under the header just like the rest.
  out = out.replace(/<(section|span)([^>]*\bid="listen"[^>]*)>/, (_m, tag: string, attrs: string) =>
    attrs.includes('scroll-margin') ? `<${tag}${attrs}>` : `<${tag}${attrs}${OFFSET}>`
  );
  // `#related` is the design's own section and is a sidebar target too, so it takes the offset as well.
  out = out.replace(/<section([^>]*\bid="related"[^>]*)>/, (_m, attrs: string) =>
    attrs.includes('scroll-margin') ? `<section${attrs}>` : `<section${attrs}${OFFSET}>`
  );
  out = out.replace(/(<div class="cite-block">)[\s\S]*?(<\/div>)/, `$1${esc(content.citation)}$2`);

  return out;
}



/**
 * The record's own references, pulled from its text.
 *
 * **769 of the archive's published records state their sources** — the founder's writing cites as a matter of
 * habit. They are written as a list under a heading that names them, and that is what is read here. **Nothing is
 * inferred and nothing is invented**: an ordered list under such a heading, or the sentences following one.
 */
export function extractReferences(body: string): string[] {
  /*
   * A SOURCES SECTION IS DETECTED WHEREVER A WRITER PUTS IT, NOT ONLY IN A HEADING.
   *
   * Measured on this archive: **495 of 1,051 published records name a sources or references section, and the
   * first version of this found 334 of them.** The 161 it missed all mention the section INLINE — as a plain
   * paragraph, or as a run of text that begins with the word — because **the archive's writers were writing
   * articles, not filling a form.** A rule that only reads `<h2>References</h2>` reads a convention that half
   * the archive does not follow.
   *
   * So the marker is looked for in four places, in order of how much they can be trusted:
   *
   *   1. a heading of any level that names the section
   *   2. a paragraph that is NOTHING BUT the name, with or without a colon — `<p>Sources</p>`
   *   3. a paragraph that OPENS with the name and a colon — `<p>Sources: Horton, J. A. B. …</p>`
   *   4. the name used inline, with the citations following it in the same paragraph
   *
   * **What comes after is collected the same way whatever found it**: a list if there is one, and otherwise the
   * sentences that follow, because a citation in this archive is as often a paragraph as a list item.
   */
  const NAME = '(?:\\d+\\.\\s*)?(?:references?|sources?|bibliography|works cited|further reading)';
  const markers: RegExp[] = [
    // 1. A heading that names it.
    new RegExp(`<h[1-6][^>]*>[^<]*?\\b${NAME}\\b[^<]*<\\/h[1-6]>`, 'i'),
    // 2. A paragraph that is only the name.
    new RegExp(`<p[^>]*>(?:<[^>]+>)*\\s*${NAME}\\s*:?\\s*(?:<[^>]+>)*<\\/p>`, 'i'),
    // 3. A paragraph that opens with the name and a colon.
    new RegExp(`<p[^>]*>(?:<[^>]+>)*\\s*${NAME}\\s*:`, 'i'),
    // 4. The name followed by a colon, inline.
    new RegExp(`\\b${NAME}\\b\\s*:`, 'i'),
  ];

  let at = -1;
  let matched = '';
  for (const re of markers) {
    const m = re.exec(body);
    if (m) { at = m.index + m[0].length; matched = m[0]; break; }
  }
  if (at === -1) return [];

  // The region from the marker to the end, or to the next heading — whichever comes first.
  const after = body.slice(at);
  const nextHeading = after.search(/<h[1-6][^>]*>/i);
  const region = nextHeading === -1 ? after : after.slice(0, nextHeading);

  /** One item, with its markup removed and its whitespace collapsed. */
  const clean = (v: string) => v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  // A list, if the section has one.
  const items = [...region.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => clean(m[1] ?? '')).filter(Boolean);
  if (items.length > 0) return items.slice(0, 60);

  // Otherwise the paragraphs — and the rest of the line the marker itself opened, when it had one.
  const inline = clean(matched.replace(/^<[^>]*>|<[^>]*>$/g, ''));
  const paras = [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => clean(m[1] ?? '')).filter(Boolean);
  const first = inline.includes(':') ? inline.slice(inline.indexOf(':') + 1).trim() : '';
  const all = [first, ...paras].filter((t) => t.length > 20);
  return all.slice(0, 60);
}


/**
 * THE MASTHEAD'S LAST ITEM, WHICH IS ABOUT THE READER RATHER THAN THE ARCHIVE.
 *
 * The design's menu ends with `My Ozikoro`, pointing at `dashboard-reader.html` — **a link that goes to a
 * dashboard whether or not anybody is signed in, and therefore lands a stranger on a page addressed to a
 * person they are not.** The owner asked for it to say what the reader can actually do, and to sit last,
 * after About:
 *
 *   signed in       My account        -> the dashboard
 *   not signed in   Sign in / Sign up -> the way in
 *
 * WHY THIS IS REWRITTEN AT SERVE TIME RATHER THAN EDITED INTO THE DESIGN
 *
 * The menu is in all 52 screens. **Editing it would mean editing the design**, which is the one thing that
 * must not happen to it — and the two states cannot both be stored in a static file anyway, because which
 * one is right depends on who is asking.
 */
export function fillMasthead(html: string, viewer: { signedIn: boolean }): string {
  /*
   * THE EXISTING ITEM IS REMOVED WHEREVER IT SITS, AND ONE ITEM IS ADDED AFTER ABOUT.
   *
   * Matching the anchor by its href rather than by its label, because the label differs between screens.
   * **A menu item that is moved by matching its text moves only on the screens whose text happens to match.**
   */
  let out = html.replace(/<li>\s*<a[^>]*href="[^"]*dashboard-reader[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/li>/gi, '');

  const item = viewer.signedIn
    ? '<li class="nav-account"><a href="/dashboard-reader">My account</a></li>'
    : '<li class="nav-account"><a href="/signin">Sign in / Sign up</a></li>';

  // After the About item, which is where the owner asked for it.
  out = out.replace(/(<li>\s*<a[^>]*href="[^"]*about[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/li>)/i, `$1${item}`);

  /*
   * THE ROLE SWITCH GOES, BECAUSE IT TELLS THE READER SOMETHING UNTRUE.
   *
   * Every dashboard in the design carries a `<details class="sx-role-switch">` offering nine workspaces — Reader,
   * Student, Teacher, Researcher, Independent Researcher, Community Knowledge Holder, Editor, Expert Reviewer,
   * Admin. **It is a walkthrough control: it exists so a reviewer of the design can see how each workspace
   * looks.** There is no product feature behind it and there was never meant to be.
   *
   * On the live site it stopped being harmless. Measured as the owner:
   *
   *     /dashboard-admin/            shows his name · the page calls itself Administrator
   *     /dashboard-reader/           shows his name · the page calls itself Reader
   *     /dashboard-knowledge-holder/ shows his name · the page calls itself Community knowledge holder
   *
   * **His name, on a workspace labelled with a role he does not hold.** A recorded role is a fact; a dropdown
   * that appears to change it is a demonstration. And for an administrator it implies something worse — that he
   * can look at a reader's workspace, which is their saved histories and their reading. **It only appears to
   * work because the page is showing his own data dressed as somebody else's.**
   *
   * So it is removed at serve time, and the design's own file is not edited. **The sidebar then says only what
   * the account may actually do, which is what a workspace is for.**
   */
  out = out.replace(/<details class="sx-role-switch">[\s\S]*?<\/details>/i, '');

  /*
   * IF ABOUT IS NOT IN THE MENU, THE ITEM GOES AT THE END RATHER THAN NOWHERE.
   *
   * A screen whose menu omits About would otherwise lose the way in entirely — and **a way in that exists on
   * fifty screens and not two is worse than one that is consistently last.**
   */
  if (!out.includes('nav-account')) {
    out = out.replace(/(<nav class="nav"[^>]*>[\s\S]*?<ul>)([\s\S]*?)(<\/ul>)/i, `$1$2${item}$3`);
  }
  return out;
}

/*
 * =====================================================================================
 * THE DASHBOARD NAVIGATION, MADE HONEST AT SERVE TIME
 * =====================================================================================
 *
 * WHAT WAS WRONG
 *
 * The handed-over dashboards are walkthroughs. Their sidebars, their "Open workspace" tiles and their
 * action buttons were drawn to show a reviewer how each workspace would look, so their destinations
 * were written as `href="#"` — placeholder syntax, not an address. Served as the live site they became
 * **156 dead links across fourteen screens**: the per-screen counts are in
 * `docs/dashboard-functions.md`, and `dashboard-admin` alone carried 25. A link that goes nowhere looks broken, and the owner's rule is that a link which appears
 * to work and does nothing is worse than one that plainly says it is not built.
 *
 * WHAT THIS DOES
 *
 *   a link with a real page behind it   becomes that page's address
 *   a link with nothing behind it       stops being a link, keeps its label and its design classes,
 *                                       and carries a visible "Not built yet"
 *
 * WHY THIS IS NOT A STUB PAGE PER FEATURE
 *
 * **A stub route per feature would be a promise dressed as a product** — fourteen screens of invented
 * addresses, each of which then has to be maintained, and each of which a reader would reasonably read
 * as "this exists but is empty". The honest statement is next to the label that made the promise.
 *
 * WHY IT IS A SERVE-TIME TRANSFORM AND NOT AN EDIT
 *
 * `public/design/` is the inviolable deliverable, verified byte-for-byte by `check:design-parity`. Every
 * change here is made to the template in memory, exactly as `fillMasthead` does it. **The design's own
 * file keeps its `href="#"` and stays the walkthrough it was written as.**
 */

/**
 * A label the design prints, and the page that genuinely answers it.
 *
 * A LABEL APPEARS ON SEVERAL SCREENS AND MEANS THE SAME THING ON EACH
 *
 * `Publications` is a sidebar item on the student, teacher, researcher and independent-researcher
 * workspaces and it is the same page every time, so the mapping is by label rather than by screen and
 * screen. **A per-screen map would be four copies of one fact, and the copies drift.**
 *
 * EVERY DESTINATION HERE WAS MEASURED WITH A SIGNED-IN SESSION BEFORE IT WAS WRITTEN DOWN. The addresses
 * that exist only behind the administration's gate are noted as such, because a link an editor cannot
 * follow reads as broken and is not.
 */
const DASHBOARD_LINK: Record<string, string> = {
  // --- the administration, all gated behind `getCurrentAccount` + an admin role.
  'System overview': '/admin/',
  // The editorial queue IS the queue of content waiting to be worked on: 1,051 migrated records, worst
  // documented first. It is the only screen in the back office that lists content, so it is what
  // "Content" promised.
  Content: '/admin/archive/',
  'Content queue': '/admin/archive/',
  Users: '/account/',
  // `Moderation` promises corrections, rights concerns and community requests. `/admin/claims` is the
  // authorship-claim queue and `/admin/reviews` is the editorial workflow queue; **neither is a
  // corrections desk**, and the one that comes closest to a moderation queue is the claims queue, whose
  // subject is a person and a decision about them. Chosen over `/admin/reviews` because a review here is
  // a publication workflow state, not a report about the archive.
  Moderation: '/admin/claims/',
  Sources: '/admin/rights/',
  // The editorial queue opens on the counts of what still has no source, no period, no clan: that is what
  // the archive actually measures, and it is the closest real answer to "Analytics".
  Analytics: '/admin/archive/',
  /*
   * `Research` AND `Entities` HAVE PUBLIC DESTINATIONS, NOT ADMINISTRATIVE ONES.
   *
   * There is no research-management screen and no entity browser in the back office — `/entities` exists
   * only as `/entities/<slug>`, with no index above it. **The public pages are real pages that answer the
   * same word, and a reader who follows one learns something true**, which is the test this pass applies.
   * They are also linked from the reader-facing dashboards, so the two roles arrive at the same place; the
   * difference between the roles is what they may DO there, and that is stated by the page rather than
   * simulated by the link.
   */
  Research: '/publications/',
  Entities: '/towns/',

  // --- the public archive, which is a real destination for several roles' promises.
  Publications: '/publications/',
  Projects: '/projects/',
  Collections: '/archive/',
  // The archive's own media surface, which is what a community knowledge holder means by "Media": the
  // photographs it actually holds, each with its rights state on the record.
  Media: '/photographs/',
  'Oral traditions': '/folklore/',
  'Evidence review': '/admin/reviews/',

  // --- the reader's own record.
  'Account settings': '/account/',
  'Return to public site': '/',
  Identity: '/account/',
  Privacy: '/account/',
  Languages: '/account/',
  Security: '/account/#security',

  /*
   * --- THE NON-DASHBOARD SCREENS, which the same transform now covers.
   *
   * Only labels that name a PAGE THE ARCHIVE ACTUALLY SERVES are listed. **Everything belonging to the
   * design's example record — an example publication's author, its PDF, its citation buttons, an example
   * researcher's topic chips — is deliberately absent**, because those controls act on a record that does
   * not exist and any address given to them would be a destination that lies. They become non-links with a
   * reason instead, which is the same treatment the dashboards' `Open →` received.
   */
  // The index of the people the archive credits, above the individual `/researchers/<slug>` profiles.
  Researchers: '/researchers/',
  // The register of the 188 published clans and their towns — what "All 62 clans" is asking for. The 62 is
  // the design's own demonstration figure and is left where the design put it: this pass makes links
  // honest, and rewriting the design's prose would be editing the design.
  'All 62 clans →': '/clans/',
  // `/account/` is the reader's own record and the page the design's four account cards already reach.
  'Complete your profile': '/account/',
  /*
   * THE ACADEMY'S COURSES ARE THIS ARCHIVE'S ACADEMY PAGE, NOT ANOTHER HOST.
   *
   * `academy.html` prints its course list's lead line directly above five placeholder course titles, each
   * a bare `href="#"`. The five used to be wired to `https://learn.ozituma.com/` and the note here
   * recorded, correctly at the time, that the page named that address and the address answered.
   *
   * **THE ADDRESS IS BEING RETIRED, AND THAT IS WHY THEY MOVED.** `learn.ozituma.com` is replaced by
   * `academy.ozikoro.com`, which has no record in its zone yet, so a course title wired to either of those
   * hosts would be a link to nothing. `/academy/` is this archive's own page about the academy and it
   * answers, and it is where the archive says the academy is being prepared.
   *
   * In the served page these five are not reached at all: `fillAcademy` replaces the whole `#courses`
   * grid, because the design's five courses are invented and the academy holds none to put in their
   * place. The destinations are still decided here, because `fillDashboardLinks` is a function with a
   * test of its own and a placeholder it does not answer is a placeholder it has left dead.
   */
  'Igbo from the beginning': '/academy/',
  'Reading and writing with tone marks': '/academy/',
  'The market week, title and kinship': '/academy/',
  'Recording and transcribing oral testimony': '/academy/',
  'Your name, your town, your clan': '/academy/',
};

/**
 * WHERE ONE LABEL MEANS SOMETHING DIFFERENT TO ONE ROLE.
 *
 * `Media` is an administrator's item and a community knowledge holder's item, and the two people mean
 * different things by it: **the administrator checks the rights of 3,488 items, the holder browses the
 * 3,437 photographs the archive holds.** The map above is keyed by label because that is right for the
 * thirty-odd labels that mean one thing everywhere; this table carries the exceptions, so the design's
 * `Media` reaches the rights register on `/dashboard-admin` and the photograph library everywhere else.
 *
 * WHY NOT A SECOND `Media` KEY IN THE MAP ABOVE
 *
 * **A duplicate key in an object literal is silently ignored** — the last one wins and no reader of the
 * source can see that two intentions were written into one slot. A separate table cannot overwrite
 * anything, and a test asserts the two tables do not disagree.
 */
const DASHBOARD_LINK_OVERRIDE: Record<string, Record<string, string>> = {
  /*
   * THE ADMINISTRATOR'S SIDEBAR NAMES TWO THINGS THE RIGHTS REGISTER USED TO ANSWER ALONE.
   *
   * `Media` and `Sources` both pointed at `/admin/rights/` because it was the only surface that listed media
   * items at all. There are now two screens with two jobs, and the labels separate cleanly: **`Media` is the
   * register — what the archive holds — and `Sources` is the permissions and provenance work.** Pointing
   * `Media` at the work queue made an administrator who wanted to look something up land on a to-do list.
   */
  'dashboard-admin': { Media: '/admin/media/', 'Audit logs': '/admin/audit/' },
};

/**
 * WHAT EACH UNBUILT LABEL IS WAITING FOR, in the words this work's report needs: **the table or the
 * route that would have to exist.** The strings are the labels the design prints, and an entry missing
 * from here still loses its dead link — it simply says "Not built yet" without saying what for, which is
 * why `design-fill.test.ts` asserts that every placeholder on the real screens is answered somewhere.
 */
export const DASHBOARD_UNBUILT_MAP: Record<string, string> = {
  'Saved histories': 'a saved-items table per account, and a route to list it',
  'Followed topics': 'a follow table per account and topic, and a route to list it',
  'Reading history': 'a read-events table per account, and a route to list it',
  'Supervisor & institution': 'fields on the member record, and a route to edit them',
  Notes: 'a private notes table per account, and a route to read and write it',
  Submissions: 'a submission queue joining an account to what it sent, and a route to list it',
  Learning: 'the academy’s course catalogue for this site; the Academy is its own application at academy.ozikoro.com, which is being prepared',
  Resources: 'a teaching-resources library, and a route to browse it',
  Courses: 'a course record owned by a teacher, and a route to list it',
  'Classes & projects': 'a class group joining a teacher to students, and a route to open one',
  Datasets: 'a dataset record with its own rights and a route to list them',
  Fieldwork: 'a field-notes record with a place and a date, and a route to list them',
  Questions: 'a research-question record and a route to list them',
  Groups: 'a working-group record with members, and a route to open one',
  Collaborators: 'a collaboration table joining two accounts, and a route to invite one',
  Citations: 'a citation-count or citation-export surface, and a route to serve it',
  Verification: 'a verification queue over claims a record makes, and a route to decide them',
  Collaborations: 'a collaboration table joining two accounts, and a route to invite one',
  'Community profile': 'a public profile page for a knowledge holder, and a route to edit it',
  'Review status': 'a view of where this account’s own submissions stand, and a route to serve it',
  'Entity linking': 'an entity-resolution tool over the archive’s place and person names',
  Revisions: 'a revision history table per record, and a route to compare two of them',
  Tasks: 'a task table assigned to an account, and a route to list it',
  'Assigned manuscripts': 'an assignment table joining a reviewer to a work, and a route to list it',
  Decisions: 'the reviewer-decision record and a route to read it back',
  'Reviewer profile': 'reviewer-specific fields on the member record, and a route to edit them',
  Settings: 'a platform-settings surface; the archive stores no configurable platform settings',
  // `Audit logs` HAS LEFT THIS TABLE. `/admin/audit/` was built and reads `ozikoro_audit` back, so the label
  // is wired in `DASHBOARD_LINK_OVERRIDE` for the administrator instead of being marked unbuilt here. **A
  // stale entry here would keep saying the feature is missing after it exists**, which is the same class of
  // untruth this whole table exists to prevent.
  Search: 'a site-wide search route; the archive has per-index filters but no single search page',
  'Primary action': 'the screen’s own next step, which the design does not name',
  'Open next task': 'a task queue for this workspace; the dashboard has no tasks to open',
  'View all': 'a list view of this panel’s contents',
  'Open →': 'the record named above it in the design’s example material',
  'Try again': 'an error the reader can actually retry',
  'Request access': 'a rights-request workflow, with a table and an approval route',
  'View version': 'a version record for the change that was saved',

  /*
   * --- THE NON-DASHBOARD SCREENS.
   *
   * Every one of these is a control on the design's OWN EXAMPLE RECORD — a sample publication, a sample
   * researcher, a sample upload — and **a control that acts on a record which does not exist has no
   * honest destination**: pointing it at a real index would promise this record's file, citation or
   * follow, and deliver somebody else's page. The reason says what would have to exist instead.
   */
  'Read full text (PDF, 1.4 MB)': 'a publication record with a stored full text; `ozikoro_publication` holds none',
  Download: 'a stored file on the publication record; the archive holds no publication files',
  APA: 'a citation generated from a publication record, which does not exist yet',
  MLA: 'a citation generated from a publication record, which does not exist yet',
  Chicago: 'a citation generated from a publication record, which does not exist yet',
  BibTeX: 'a citation generated from a publication record, which does not exist yet',
  RIS: 'a citation generated from a publication record, which does not exist yet',
  'By topic: oral historiography': 'a topic index for a publication; `ozikoro_topic` classifies articles, not publications',
  'By institution: UNN': 'an institution record and a route to list one; the archive holds no institutions',
  Follow: 'a follow table per account, and a route to list what it follows',
  'Request contact': 'a contact-request workflow with an inbox and a record of consent',
  'Cite this profile': 'a citation generated from a member profile; member profiles are not citable records yet',
  'All 7 publications': 'a publications list for one member; the archive’s own `/publications/` lists the whole repository',
  Previous: 'paging over the archive index; the route serves one page of records and no offset',
  Next: 'paging over the archive index; the route serves one page of records and no offset',
  Replace: 'an upload or replace endpoint for archive files; the archive has no write path for media',
  'Save as draft': 'an upload endpoint that stores a draft; the design’s upload form posts nowhere',
  /*
   * `Open on YouTube ↗` HAS LEFT THIS TABLE, AND IT MUST NOT COME BACK.
   *
   * The owner's report, verbatim: *"Open on YouTube is written, not built"*. The served `/watch/` carried
   * `<a aria-disabled="true" title="Not built yet — waiting on the inline player’s own film; the player is
   * opened by script and no film is playing">Open on YouTube ↗ <span class="small muted">— Not built
   * yet</span></a>` — a built control wearing the mark of an unbuilt one.
   *
   * **The reason was true of the page at load and false of every film the player opens.** The design's own
   * `watch.js` — inside the inviolable deliverable, and served extended from
   * `/design-screen-assets/watch.js` — already writes
   * `externalEl.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id)` inside `open(card)`, so
   * the control carries the film's real YouTube address from the moment a reader chooses a film. Measured
   * in headless Chrome by clicking each of the nine archive cards on `/watch/`: every one set
   * `#inline-player-external.href` to that card's own id, e.g. `…?v=LL8YX0pXzdI`.
   *
   * So the entry is removed and the transform leaves the design's anchor exactly as the design wrote it.
   * `#inline-player` is `hidden` until a film is chosen, so the bare `href="#"` the design carries is never
   * reachable: by the time the reader can click this label the script has given it a real address.
   * `design-fill.test.ts` asserts both halves — the label is in no unbuilt map, and no served watch screen
   * prints "Not built yet" beside it.
   */
  'Precolonial market systems': 'a topic record for this name; the archive’s fourteen topics do not include it',
  'Oral historiography': 'a topic record for this name; the archive’s fourteen topics do not include it',
  'Igbo ritual office': 'a topic record for this name; the archive’s fourteen topics do not include it',
  'Archives and repatriation': 'a topic record for this name; the archive’s fourteen topics do not include it',
  'Niger delta trade': 'a topic record for this name; the archive’s fourteen topics do not include it',
  // The count is not written here: the archive has gained and lost contributor records during this work, and a
  // number typed into a table of unbuilt links goes stale silently. The claim that matters is the second one.
  'Emeka Ǹwàchukwu': 'a byline page for the design’s example author; no contributor record in this archive carries that name',
};

/**
 * The prompt a module tile carries. It is the design's own phrase, and it is the marker that tells the
 * transform a tile is the design's walkthrough rather than a real destination.
 */
const TILE_PROMISE = 'Open workspace';

/**
 * Every `<a …>` in the markup whose `href` is the placeholder `#`, with its label and its attributes.
 *
 * WHY THIS IS A SCANNER AND NOT A REGULAR EXPRESSION
 *
 * The obvious pattern is `/<a([^>]*?)\shref="#">([\s\S]*?)<\/a>/g`, and it is wrong on two counts.
 *
 *   1. It does not match a link that carries ANY other attribute — `<a href="#" style="…">` — because the
 *      lazy group must consume at least one character and cannot give it back. **A design that adds a
 *      class to one link would silently stop having that link rewritten**, which is the same silent
 *      failure this whole transform exists to remove. (Measured on Node 26: the pattern matches
 *      `<a href="#">` and not `<a href="#" style="x">`.)
 *   2. It matches across element boundaries, so a link whose label contains markup swallows its
 *      neighbours and the second placeholder is never seen at all.
 *
 * A scan cannot do either: it finds the opening tag, finds that tag's own `>`, finds the matching close,
 * and gives the caller the text in between. **No backtracking, no attribute-order assumption, and one
 * link per link.**
 */
function placeholderAnchors(html: string): { start: number; end: number; attrs: string; inner: string }[] {
  const found: { start: number; end: number; attrs: string; inner: string }[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf('<a ', from);
    if (at === -1) return found;
    const openEnd = html.indexOf('>', at);
    if (openEnd === -1) return found;
    from = openEnd + 1;

    const attrs = html.slice(at + 2, openEnd);
    // Only the placeholder. A real `href` is some other pass's business.
    if (!/\shref="#"/.test(attrs)) continue;

    const close = html.slice(openEnd + 1).search(/<\/a\s*>/);
    if (close === -1) continue;
    found.push({
      start: at,
      end: openEnd + 1 + close + html.slice(openEnd + 1 + close).match(/<\/a\s*>/)![0].length,
      attrs,
      inner: html.slice(openEnd + 1, openEnd + 1 + close),
    });
  }
}

/**
 * A link with nothing behind it becomes a NON-LINK that says so.
 * IT KEEPS THE DESIGN'S CLASSES AND LOSES ITS `href`
 *
 * The design's `.sx-dash-nav a` rule is what makes a sidebar item look like one, so the element stays an
 * `<a>` — **an anchor without an `href` is not a link: it cannot be clicked, it cannot be focused, and it
 * announces itself as plain text.** It keeps every class it had, so the sidebar still looks like the
 * sidebar. The design's stylesheet is not touched, and neither is its HTML.
 *
 * WHY A MARKER AND NOT JUST THE ABSENCE OF A LINK
 *
 * A label with no destination looks identical to one that was forgotten. The marker is what makes the
 * page state the omission rather than merely exhibit it.
 */
function unbuiltAnchor(label: string, attrs: string): string {
  /*
   * THE ATTRIBUTES ARE REBUILT, NOT CONCATENATED.
   *
   * The scanner hands back everything between `<a` and `>`, which begins with a space. Interpolating that
   * straight into a template that already supplies one produced `<a  class="chip" …>` — **harmless to a
   * browser and still wrong**, because served markup that nobody would write by hand is markup nobody reads
   * carefully. The attribute text is trimmed once and the separating space is supplied here.
   */
  const cleanAttrs = attrs.replace(/\shref="#"/, '').trim();
  /*
   * THE LABEL IS LOOKED UP DECODED, AND PRINTED ENCODED.
   *
   * The design writes `Classes &amp; projects` and `Supervisor &amp; institution`, so the table's keys are
   * written with the ampersand as a reader sees it — **a key written to match the raw HTML would be wrong
   * the day the design escapes the same word differently, and right today by accident.** The decoded form
   * is what a person reads, so it is what identifies the label.
   */
  const why = DASHBOARD_UNBUILT_MAP[decodeEntities(label)];
  const title = why ? ` title="Not built yet — waiting on ${why}"` : ' title="Not built yet"';
  return (
    `<a${cleanAttrs ? ` ${cleanAttrs}` : ''} aria-disabled="true"${title}>${esc(label)} ` +
    `<span class="small muted">— Not built yet</span></a>`
  );
}

/**
 * The entities a record can carry, decoded before `esc` re-escapes the text for the page.
 *
 * THE NUMERIC FORMS ARE NOT DECORATION: the archive arrived from WordPress, and WordPress stores a title with
 * whatever entity its editor wrote. **Three published records carry `&#038;` in their own title**, and one of
 * them — `Ojeh &#038; Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture` — is an article that
 * embeds a film, so its title reaches a `/watch/` card. `esc` escapes `&` to `&amp;`, so an entity that is not
 * decoded first becomes `&amp;#038;` in the served markup and the reader sees the entity itself, printed.
 *
 * The original five were "the entities the design's own labels actually contain, and nothing more"; the
 * numeric branches are added because a **record** is not a label, and the record's own titles use them.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** The destination for a label on a screen, honouring a role's exception before the shared meaning. */
function destinationFor(screen: string, label: string): string | undefined {
  return DASHBOARD_LINK_OVERRIDE[screen]?.[label] ?? DASHBOARD_LINK[label];
}

/**
 * EVERY SCREEN WHOSE DESIGN LINKS THE ROUTE HAS TO RESOLVE.
 *
 * The fourteen dashboards came first, and then a measurement found **thirty-six more `href="#"` on six
 * screens that are served live and return 200**: `/publication/`, `/researcher-profile/`, `/academy/`,
 * `/archive-index/`, `/upload/` and `/watch/`. A dead link is the same fault wherever it is, so the same
 * transform covers them rather than a second one being written beside it — **two transforms would drift,
 * and the one that drifted would be the one nobody was looking at.**
 *
 * The criterion is the design's own links, not the `href="#"` alone: a screen whose menu is written as bare
 * sibling filenames needs the same rewrite even when it carries no placeholder at all (see the four added
 * below). So the set is "screens whose links the route resolves", and the placeholder count is one symptom
 * of that rather than the definition.
 *
 * The set is written here rather than in the route so the route and `design-fill.test.ts` cannot disagree
 * about which screens are covered.
 */
export const LINKED_SCREENS: string[] = [
  'publication', 'researcher-profile', 'academy', 'archive-index', 'upload', 'watch',
  /*
   * `listen` WAS MISSING, AND THE COST WAS EVERY LINK IN ITS HEADER.
   *
   * This screen is not a dashboard and carries no `href="#"`, so it was easy to leave out of the set — and
   * being out of the set meant it received neither the `<base href="/">` nor the absolute-link rewrite. Its
   * own menu is written the design's way (`home.html`, `archive-index.html`, `watch.html`, `collections.html`)
   * and resolves against the address it is SERVED from, so at `/listen/` **every one of those items answered
   * 404** — measured: `/listen/home.html`, `/listen/archive-index.html`, `/listen/watch.html` and
   * `/listen/collections.html` all 404, while the same items on `/watch/` (which IS in this set) resolve. The
   * featured card's `Read the transcript` link had the same fate. It is the "a control that returns 200 and
   * lands elsewhere" fault with the status that gives it away, and no fill could have fixed it: the links are
   * the design's and the rule to rewrite them is this one.
   */
  'listen',
  /*
   * AND THE FOUR WITH NO PLACEHOLDER LINK AT ALL, BECAUSE THE OTHER HALF OF THE SAME TRANSFORM IS THE ONE
   * THEY NEED.
   *
   * `home`, `documents`, `publications` and `404` carry **not one `href="#"` between them**, so the fault
   * that named this set walked past them. What they do carry is the menu written the design's way — a bare
   * sibling filename — and that resolves against whatever address the screen is *served* from:
   *
   *     at /                       archive-index.html -> /archive-index.html       200 (the design screen)
   *     at /documents/             archive-index.html -> /documents/archive-index.html   404
   *
   * Measured on the served pages: **`/documents/`, `/publications/` and `/404/` answered 200 with every
   * single menu item — and the whole footer — 404ing**, because the relative address resolved one level
   * too deep. `/` was the one screen where the relative addresses happened to work, so its fault was
   * invisible in a different way: its `researcher-profile.html` reached `/researcher-profile/`, one
   * stranger's profile, and answered 200.
   *
   * They are added to this set rather than given a second rule, because the transform that makes the
   * design's relative links absolute is already here and **two transforms would drift, with the one nobody
   * looked at drifting first.**
   */
  '404', 'documents', 'home', 'publications',
];

/**
 * Rewrite every placeholder link on one screen the route serves.
 *
 * `screen` is the design's screen name (`dashboard-reader`, `publication`), and it is used to pick a role's
 * exception and to report what could not be rewritten: a leftover is logged rather than silently turned
 * into a link to nowhere.
 *
 * THE NAME IS NARROWER THAN THE JOB, AND THAT IS DELIBERATE.
 *
 * It began with the dashboards and now serves every screen in `LINKED_SCREENS`. **The name is kept because
 * a rename would touch the route and the test for no behaviour at all, and the comment is where a reader
 * finds out what it actually covers** — a "ScreenLinks" name that silently stopped covering dashboards
 * would be the worse outcome.
 */
export function fillDashboardLinks(html: string, screen: string): string {
  let out = html;

  /*
   * 1. THE SIDEBARS.
   *
   * The sidebar's items are the only `<a>`s inside `.sx-dash-nav`, so they are matched from the opening
   * tag to the first `</nav>` rather than one at a time — **a page-wide search for `<a href="#">` would
   * also catch the design's in-page anchors and its example controls, and quietly rewrite them too.**
   */
  out = out.replace(
    /(<nav class="sx-dash-nav"[^>]*>)([\s\S]*?)(<\/nav>)/,
    (_all, open: string, body: string, close: string) =>
      open + body.replace(/<a href="#">([^<]*)<\/a>/g, (_a, label: string) => {
        const dest = destinationFor(screen, decodeEntities(label));
        return dest ? `<a href="${dest}">${label}</a>` : unbuiltAnchor(label, '');
      }) + close
  );

  /*
   * 2. THE "OPEN WORKSPACE" TILES.
   *
   * A tile is an `<a class="sx-state">` wrapping a number, a heading and the promise `Open workspace`.
   * A tile that leads nowhere **stops being a link**, and the promise line is replaced by the statement —
   * leaving "Open workspace" above "Not built yet" would keep the promise while denying it.
   */
  out = out.replace(
    /<a class="sx-state" href="#">([\s\S]*?)<\/a>/g,
    (_all, inner: string) => {
      const heading = inner.match(/<h3[^>]*>([^<]*)<\/h3>/);
      const label = decodeEntities(heading?.[1]?.trim() ?? '');
      const dest = destinationFor(screen, label);
      if (dest) return `<a class="sx-state" href="${dest}">${inner}</a>`;
      const body = inner.replace(
        new RegExp(`<p class="small muted">${TILE_PROMISE}</p>`),
        '<p class="small muted">Not built yet — nothing to open.</p>'
      );
      return `<div class="sx-state" aria-disabled="true">${body}</div>`;
    }
  );

  /*
   * 3. EVERY REMAINING PLACEHOLDER.
   *
   * The action buttons ("Search", "Open next task"), the panel links ("View all"), the account screen's
   * four "Open →" cards and the state screens' controls. They are found after 1 and 2, so what is left is
   * exactly the set that is not part of a navigation list. Replaced from the END so that every earlier
   * offset stays valid — **the first version replaced forwards and each replacement shifted the offsets
   * of every link after it.**
   */
  const remaining = placeholderAnchors(out);
  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const { start, end, attrs, inner } = remaining[i]!;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const dest = destinationFor(screen, decodeEntities(text));

    /*
     * ── A CONTROL THE PAGE'S OWN SCRIPT FILLS IS NOT A PLACEHOLDER ────────────────────────────────
     *
     * THE OWNER'S REPORT: *"Open on YouTube is written, not built."* The served `/watch/` carried
     * `<a aria-disabled="true" title="Not built yet — …">Open on YouTube ↗ <span class="small muted">— Not
     * built yet</span></a>` — and it had been that way because the label sat in `DASHBOARD_UNBUILT_MAP`.
     *
     * **REMOVING THE MAP ENTRY ALONE DID NOT FIX IT, and that is the trap this branch closes.** The map
     * supplies only the *reason*; this loop rewrites every `href="#"` it finds whether or not the label is
     * in the map — measured, the anchor came back `aria-disabled="true" title="Not built yet"` with the
     * reason gone and the fault intact.
     *
     * So the exclusion is by the control's own `id`, which is the thing the design's script looks up.
     * `watch.js` ends `open(card)` with
     * `externalEl.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id)`, so by the time this
     * anchor is reachable — `#inline-player` is `hidden` until a film is chosen — it carries the film's own
     * address. **The design's `href="#"` is left exactly as the design wrote it, and nothing is invented
     * for a film the archive does not hold**, because the script builds the address from the id the reader
     * clicked.
     */
    if (/\bid="inline-player-external"/.test(attrs)) continue;

    /*
     * A LINK WHOSE CONTENT IS AN IMAGE OR NESTED MARKUP WITH NO READABLE LABEL IS LEFT ALONE.
     *
     * There is no label to read and no destination to give it, and **rewriting a card whose content is an
     * image into a bare "Not built yet" would destroy the design's markup to say something it cannot say
     * anyway.** Any that remain are printed by the route, so a leftover is reported rather than hidden.
     */
    if (!text) continue;

    const otherAttrs = attrs.replace(/\shref="#"/, '').trim();
    const replacement = dest
      ? `<a${otherAttrs ? ` ${otherAttrs}` : ''} href="${dest}">${inner}</a>`
      : unbuiltAnchor(text, otherAttrs);
    out = out.slice(0, start) + replacement + out.slice(end);
  }

  /*
   * 4. THE DESIGN'S RELATIVE ADDRESSES, MADE ABSOLUTE.
   *
   * The rule itself lives in `designScreenLinks`, because it is not a dashboard rule: **every one of the
   * 52 screens writes its menu the design's way, and the fills write relative addresses of their own
   * after this point.** A second copy here is how the two halves would come to disagree, which is the
   * fault `design-paths.ts` exists to end, so this line delegates rather than implements. The route
   * calls the same function again once the fills have run, which is what reaches an address a fill
   * wrote — `/publication/` and `/researcher-profile/` both carried one.
   */
  out = designScreenLinks(out);

  return out;
}

/**
 * THE ABOUT PAGE, TOLD WITH THE ARCHIVE'S OWN NUMBERS AND ITS OWN PEOPLE.
 *
 * The design's About is a walkthrough: a mission in the abstract, three tools described, four editorial
 * principles, and **six invented people under a heading that says readers already meet them here**. Every
 * figure in it is a placeholder, and the people are not real.
 *
 * What replaces it is the same page with the same structure, filled with what the archive actually holds:
 *
 *   the counts come from the database, so the number of histories is a count and not a claim about one
 *   the people are every contributor the archive holds, in the order of how much of it they wrote
 *   the portraits are MONOGRAM TILES, because **not one WordPress author has ever uploaded a photograph** —
 *     Gravatar answers the same grey silhouette for every one of them, and that many identical grey figures
 *     would be worse than that many initials
 *   the principles say what this archive does, including where it has not done it yet
 *
 * **The design's own note already anticipated the portraits**: *"Monogram tiles hold each place until approved
 * portraits are supplied — no stock faces are used."*
 */
export type AboutData = {
  published: number;
  inReview: number;
  media: number;
  towns: number;
  sources: number;
  licences: number;
  /** Published records filed under Folklores. */
  folklores: number;
  /** Published records filed under Photographs. */
  photographs: number;
  /** Media records of kind `document`. */
  documents: number;

  /**
   * `avatarUrl` is a portrait **the author uploaded**, or null. It is never a Gravatar default: the
   * archive clears `d=mm` silhouettes rather than rendering a stock face for a person.
   */
  contributors: { slug: string; name: string; records: number; bio: string | null; avatarUrl: string | null }[];
};

/** `IE` from `Idenze Ezeme`. Two letters, or one if the name has one word. */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/** `1051` -> `1,051`. The archive counts in en-GB, as the rest of the site does. */
function n(value: number): string {
  return Number(value || 0).toLocaleString('en-GB');
}

/**
 * GIVE AN ELEMENT THE ID THAT THE DESIGN'S OWN LINKS ALREADY NAME.
 *
 * ── THE FAULT, MEASURED ─────────────────────────────────────────────────────────────────────────────
 *
 * Fourteen of the deliverable's screens link six fragments into `about.html`:
 *
 *     about.html#entrust   #privacy   #access   #partners   #licensing   #contact
 *
 * — the four footer columns ("Institutional access" under Research, "Partners" under Platform, and
 * "Privacy"/"Licensing & reuse"/"Entrusting material" under Terms) plus the front page's own door, *"Entrust
 * a community history — How material is held and who may read it."* **The deliverable's `about.html` carried
 * three ids: `main`, `faq` and `terms`** — so every one of those six links reached the right page and then
 * did nothing at all. The design's own fault, not a fill's: it drew the sections and forgot the ids.
 *
 * ── THE DECISION, WHICH IS THE WHOLE JUDGEMENT OF THIS PASS ─────────────────────────────────────────
 *
 * **The page DRAWS five of the six things those labels name, and it is the id that is missing — not the
 * section.** So the id is put on the element that is already there, found by its own words:
 *
 *     #entrust     "How a record earns its place" — how material is held and who may read it, which is
 *                  the sentence the front page's door promises and the section's own four principles
 *                  ("Community terms: Depositors define access and reuse") answer
 *     #privacy     <h2>Privacy</h2> at the foot, beside Terms and Licensing, where the design put it —
 *                  **and NOT the `<h3>Privacy</h3>` in the institution block, which is a summary of the
 *                  same state rather than the notice itself**
 *     #licensing   <h2>Licensing</h2>, the same block
 *     #partners    <h3>Partnerships</h3> — "Institutions, sponsors and media" — the enquiry route the
 *                  footer's own "Partners" item is for
 *     #contact     <h2>Talk to Ozi Ikoro Limited</h2>, the contact section
 *
 * The sixth, `#access` ("Institutional access", "Request access", "What the tier covers"), is **not on this
 * page under any id and is not on it at all**: the deliverable's `about.html` has no institutional-access
 * section, and neither has the served page — its only sentences about access are the FAQ's *"some research
 * publications are access-controlled by their authors and can be requested"* and Licensing's *"each record
 * displays its own access and reuse terms"*, which are statements about **records**, not a tier a reader can
 * hold. **Inventing a section to satisfy that label is the one thing this archive's rule forbids**, so the
 * link comes off the served screens instead — see `designScreenLinks` in `design-paths.ts`, which is where
 * the design's own addresses are resolved at serve time.
 *
 * ── WHY IT IS ANCHORED TO THE WORDS RATHER THAN TO A SELECTOR ───────────────────────────────────────
 *
 * A page whose markup has moved on **does not gain an anchor somewhere it was never designed to be**: the
 * pattern fails, the page is served as it is, and the link to it comes off with the `#access` one. That is
 * the same failure the article's `Download PDF` control takes, and for the same reason.
 *
 * It replaces only the FIRST match, which matters here because "Privacy" appears twice on the page.
 */
function anchorHeading(html: string, tag: string, label: string, id: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${tag}(?![^>]*\\bid=")([^>]*)>(\\s*${escaped}\\s*)</${tag}>`);
  const match = pattern.exec(html);
  if (!match) return html;
  return `${html.slice(0, match.index)}<${tag}${match[1]} id="${id}">${match[2]}</${tag}>`
    + html.slice(match.index + match[0].length);
}

/**
 * A filled `.sx-people` card: a real contributor, with their own portrait where the archive holds one.
 *
 * **THE COMMENT THAT USED TO STAND HERE WAS WRONG, AND IT WAS WRONG IN THE WAY THAT MATTERS: it asserted a
 * fact about the record that the record did not support.** It said *"Not one WordPress author has ever
 * uploaded a profile photograph (the migration holds the uploads table, and it is empty of avatars)"*. The
 * archive's own SQL dump holds the WordPress usermeta table, and in it **six of the ten people below carry a
 * `sabox-profile-image`** — the field the live site's author box reads. Every one of those six files was
 * already in this archive's media store. The loss was the same one the EXIF credits suffered: the REST
 * import read `avatar_urls` (Gravatar, which answers `d=mm` — one grey silhouette for everybody) and never
 * looked at the usermeta table, so the real portraits were in the building and not on the page.
 *
 * So a card shows `avatarUrl` when there is one, and a monogram when there is not. **`avatarUrl` is only
 * ever a portrait uploaded by the author**, because the backfill clears the Gravatar defaults rather than
 * keeping them: a silhouette is a stock face, and substituting one for a person is the thing this archive's
 * rule forbids. The monogram is not decoration standing in for a portrait — for the contributors who have
 * supplied none, it is the honest state.
 *
 * **THE CARD NO LONGER SPELLS THAT STATE OUT, AND THAT IS THE OWNER'S DECISION RATHER THAN AN OMISSION.** A
 * caption reading *"No portrait supplied"* used to sit over the monogram, and the owner read it on the page
 * and asked for the four words to go and for nothing else about the card to change: *"the profiles of authors
 * with no images supplied shouldnt show this written words 'No portrait supplied' on it. remove only that
 * written words."* The monogram beside the author's name states the same thing adequately for a reader, so
 * the caption is not replaced by a sentence — **an absence that has been read and accepted is not an absence
 * that has been guessed at.** The tile keeps the design's own `role="img"` and its accessible name
 * (`Monogram tile for <name>: no portrait has been supplied`), which is where the same fact still has to be
 * stated: the monogram itself is `aria-hidden`, so a screen reader has no other way to learn it.
 *
 * The record count is counted from the archive, and the link is the contributor's own byline page.
 */
function personCard(c: AboutData['contributors'][number]): string {
  const bio = c.bio?.trim();
  const portrait = c.avatarUrl?.trim();
  const tile = portrait
    ? `<img src="${esc(portrait)}" alt="Portrait of ${esc(c.name)}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
    : `<span aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;font-family:'Noto Serif',serif;font-size:3rem;color:#d8b25a;font-weight:700">${esc(monogram(c.name))}</span>`;
  return `<article class="sx-person">
  <div style="position:relative;aspect-ratio:1;overflow:hidden;background:#14261d;border:1px solid var(--rule)"${portrait ? '' : ` role="img" aria-label="Monogram tile for ${esc(c.name)}: no portrait has been supplied"`}>
    ${tile}
  </div>
  <div class="sx-person-copy">
    <p class="eyebrow">${c.records === 1 ? '1 published history' : `${n(c.records)} published histories`}</p>
    <h3><a href="/author/${esc(c.slug)}/">${esc(c.name)}</a></h3>
    <p class="small muted" style="margin-top:var(--s-2)">${bio ? esc(decodeEntities(bio.slice(0, 240))) : 'No biography has been supplied. Named here by the work alone.'}</p>
  </div>
</article>`;
}

/**
 * THE ABOUT PAGE, TOLD WITH THE ARCHIVE'S OWN NUMBERS AND ITS OWN PEOPLE.
 *
 * The design's About is a walkthrough: a mission in the abstract, three tools described, four editorial
 * principles, and **six invented people under a heading that says readers already meet them here**. Every
 * figure in it is a placeholder and the people are not real.
 *
 * What replaces it is the same page with the same structure, filled with what the archive actually holds:
 *
 *   the counts come from the database, so "1,051 histories" is a count rather than a claim about one
 *   the people are every contributor, in the order of how much of the archive they wrote
 *   a portrait is the author's own uploaded photograph where the archive holds one, and **a monogram
 *     where it does not** — six of the eleven have one, and the card that had none says so rather than
 *     borrowing a face
 *   what is published is listed with the number beside each kind, so the page cannot overstate its own shelf
 *   the principles keep their wording and gain the numbers that sit behind them — including **0 recorded
 *     licences** — rather than a second, invented set of facts
 *   the institution section is filled with what is known (the company, the three platforms, the record
 *     counts) and states plainly where terms, privacy and partner particulars have not been supplied,
 *     because **a partner reads this page before deciding to work with the archive** (brief §3.6)
 *
 * **Nothing here is typed into a file. Every figure is passed in, counted at render time by the route.**
 *
 * AND EVERY BLOCK IT INSERTS GOES INSIDE THE DESIGN'S OWN CONTAINER. **A fill that writes markup the design
 * never drew is writing markup the design never laid out**, so it must not assume the design's CSS will
 * place it: the principles paragraph below is wrapped in `.wrap` for exactly that reason, and the fault it
 * fixes — text hanging outside the content column, with no scrollbar to announce it — is documented there.
 */
export function fillAbout(html: string, d: AboutData): string {
  let out = clearExampleMaterial(html);

  const named = d.contributors.filter((c) => c.records > 0);

  /*
   * 1. THE PEOPLE. Built from the design's own card, and only from people who have published here.
   */
  const people = named.map(personCard).join('\n      ');
  if (people) out = replaceContainer(out, '<div class="sx-people"', people);

  /*
   * 2. THE NOTE ABOVE THEM, REWRITTEN FOR A READER RATHER THAN FOR THE BUILD.
   *
   * (Two earlier versions of this comment and this sentence stood here. The first said the note was being
   * changed to state two counts; the second stated them. Both were superseded by the paragraph below and the
   * paragraph it replaced was **false**, so the stale note is removed rather than left to mislead the next
   * reader of this file.)
   *
   * The design's own note reads *"Biographies below are as published on ozikoro.com. Monogram tiles hold
   * each place until approved portraits are supplied — no stock faces are used."*
   *
   * What replaced it counted biographies and then said **"Portraits are monogram tiles because no author
   * on ozikoro.com has uploaded one — no stock faces are used."** That is **false**: the WordPress
   * usermeta table holds a `sabox-profile-image` for six of the ten people below, every one of those files
   * is already in this archive's media store, and the cards now show them. The sentence was also the wrong
   * KIND of sentence — it told a reader how the site was built ("monogram tiles", "no stock faces") instead
   * of telling them anything about the people.
   *
   * The first half was doing real work: it says why the list is in this order, which a reader cannot
   * otherwise know. That stays. The counts of who has a biography go, because every card already says so in
   * its own words, and a number in a preamble that a card contradicts is worse than no number. What remains
   * is the one honest statement a reader does need — that each entry carries what its author supplied —
   * in the shortest form that is still true.
   */
  out = out.replace(
    /<p class="sx-notice"[^>]*>[\s\S]*?<\/p>/,
    `<p class="sx-notice" style="margin-bottom:var(--s-5)">The people who wrote what is here, in the order of how much of it they wrote. ` +
      `Biographies and portraits are shown where the author supplied them.</p>`
  );

  /*
   * 3. WHAT THE ARCHIVE PUBLISHES, COUNTED — the design's list is right about the kinds of thing and silent
   *    about how many of each there are, which is the one fact a reader on this page is looking for.
   */
  /*
   * THE PATTERN IS ANCHORED TO ITS OWN LIST, AND THAT IS NOT A DETAIL.
   *
   * It used to be `/(<ul[^>]*>)\s*<li><a href="archive-index\.html">Histories<\/a>[\s\S]*?(<\/ul>)/`, which
   * matches the FIRST `<ul>` in the document whose opening item links to `archive-index.html` — and that is
   * the MASTHEAD NAVIGATION, whose first item is also `Histories`. So the pass written to count what the
   * archive publishes replaced the site's menu with eight sentences of prose styled as navigation, on every
   * screen that runs it. The owner saw it and said the menu "looks scattered like it has bugs"; it was the
   * menu's links that were gone.
   *
   * The section's own list is the one the design gives an inline grid to, so that marker is now required
   * rather than assumed. **A bare `<ul>` is not an address: two lists can begin the same way, and the first
   * one is usually chrome.** This is the same fault as the single-segment screen edits that changed nothing
   * and the mutating function that was probed by calling it — a selector that describes a shape instead of
   * naming the thing.
   */
  out = out.replace(
    /(<ul style="margin-top:var\(--s-4\);display:grid;gap:\.5rem">)\s*<li><a href="archive-index\.html">Histories<\/a>[\s\S]*?(<\/ul>)/,
    `$1
              <li><strong>Histories</strong> — ${n(d.published)} published records, ${n(d.sources)} of them stating their sources.</li>
              <li><strong>Folklores &amp; myths</strong> — ${n(d.folklores)} published records.</li>
              <li><strong>Towns</strong> — ${n(d.towns)} towns, clans and communities in the register.</li>
              <li><strong>Photographs</strong> — ${n(d.photographs)} published photographic records, out of ${n(d.media)} media items held.</li>
              <li><strong>Documents</strong> — ${n(d.documents)} document records held as files.</li>
              <li><strong>Publications</strong> — 0 records. The research repository holds none yet.</li>
              <li><strong>Watch and Listen</strong> — films embedded in published records; no audio recording is held.</li>
              <li><strong>Igbo calendar and cultural calendar</strong> — the market week, and a calendar holding 0 verified events.</li>
            $2`
  );

  /*
   * 4. THE NUMBERS THE DESIGN DOES NOT HAVE AT ALL.
   *
   * A page about an archive should say how much it holds. **Every figure is counted at render time**, and the
   * uncomfortable ones are included rather than left out: 0 records held in review, and **0 recorded licences**
   * for every media item — the archive's largest open problem and the one a reader is least likely to guess.
   */
  const figures: [string, string][] = [
    [n(d.published), 'published histories'],
    [n(d.inReview), 'held in review'],
    [n(d.towns), 'towns and clans'],
    [n(d.media), 'images, films and documents'],
  ];
  /*
   * THE FIGURES GO INSIDE A `.wrap` TOO, FOR THE SAME REASON AS THE PARAGRAPH BELOW — and this one is the
   * same fault found a second time by measurement rather than by reading.
   *
   * `.sx-metrics` does not appear anywhere in the design's `about.html`; the fill introduces it. The design's
   * own rule for it is `display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s-4)` with **no outer
   * padding**, and every screen the design itself puts it on is an already-padded pane. Inserted bare as a
   * child of `<main>` it therefore became a full-bleed band: measured at 1440 px, `.sx-metrics` was
   * `{x:0, w:1440}` and its first figure's text began at 24 px, while the masthead wordmark, the image below
   * it and every other text block on the page begin at 136 px. **On a phone the numbers sat 8 px closer to the
   * edge than the rest of the page** (24 px inside a card against the design's 16 px column inset).
   *
   * The probe found it, not a reading of the CSS: `scripts/probe-overflow.mjs --url …/about/ --width 1440`
   * reports it as outside the content column, which is why the sweep is worth running over every screen and
   * not only the one the owner named.
   */
  const figureRow = `<div class="wrap"><div class="sx-metrics" style="margin:var(--s-6) 0">${figures
    .map(
      ([value, label]) =>
        `<article class="sx-metric"><b>${esc(value)}</b><span class="small muted">${esc(label)}</span></article>`
    )
    .join('')}</div></div>`;
  out = out.replace(/(<section class="wrap sx-mission">[\s\S]*?<\/section>)/, `$1${figureRow}`);

  /*
   * 5. SOURCES AND LICENCES, COUNTED, BESIDE THE PRINCIPLES THAT MAKE THE PROMISES.
   *
   * The design's editorial method is four principles with no numbers. **"Source in view" and "Community terms"
   * are claims, and this archive can say how far it meets them**: 293 published records state their sources,
   * and 0 media items carry a recorded licence. That number belongs on this page rather than in a reader's
   * later disappointment.
   */
  /*
   * THE PARAGRAPH GOES INSIDE A `.wrap`, AND THAT IS THE WHOLE FIX FOR THE LAYOUT FAULT.
   *
   * It used to be inserted bare, as the previous sibling of `<section class="sx-principles">` — and that
   * section is a direct child of `<main>`, so the paragraph became one too. **Every other thing on this
   * page is inside the design's `.wrap` column; this paragraph was not**, and `.wrap` is what supplies the
   * column: `width:100%; max-width:var(--container); margin-inline:auto; padding-inline:var(--s-5)`.
   *
   * So the owning reader saw it at x=0 on a 1440 px screen while the section below it began at x=136 — the
   * text hanging 136 px to the LEFT of the whole site — and on a 390 px phone it ran edge to edge with no
   * padding at all. Measured: the paragraph's box was `{x:0, w:475.9}` inside a 1440 px viewport whose
   * content column starts at 136. **It never produced a scrollbar**, because a block cannot be wider than
   * its containing block: the fault is that its containing block was the window rather than the column,
   * which is why a `scrollWidth` check reports this page as healthy and a reader does not.
   *
   * The design file is not the thing at fault and is not touched. The fill put its own content outside the
   * container the design gives every other block, so the fill puts it back inside one here. `max-width:64ch`
   * stays on the paragraph itself, so the measure is unchanged; `.wrap` only decides where the column is.
   */
  out = out.replace(
    /(<section class="sx-principles">)/,
    `<div class="wrap"><p class="small muted" style="max-width:64ch;margin-bottom:var(--s-5)">Of ${n(d.published)} published histories, ` +
      `${n(d.sources)} state their sources in the record. The archive holds <strong>${n(d.licences)} recorded licences</strong> ` +
      `for ${n(d.media)} media items: every one is held with its rights basis recorded as unknown and consent as not sought.</p></div>$1`
  );

  /*
   * 6. THE INSTITUTION — the brief's §3.6, and the reason this page is not a footer paragraph.
   *
   * It is placed after the principles and before "Ways to help Ozikoro grow", so the section a partner or a
   * funder reads arrives before the section that asks them for something.
   *
   * **Nothing has been supplied for the boxes that are empty, and the page says so in each one rather than
   * leaving a heading over nothing.** No registration number, no address, no partner, no funder and no policy
   * is invented: the archive holds none of them, and a plausible-looking company number would be the most
   * convincing piece of false content on the site.
   */
  const institution = `<section class="wrap section" id="institution">
        <div class="sx-head"><div><p class="eyebrow">The institution</p><h2>Ozi Ikoro Limited</h2></div><span class="gold-rule"></span></div>
        <p class="lede">Ozi Ikoro Limited is the company that publishes Ozikoro. It is one institution with three public tools, and this page is its record of what it holds and what it has not yet supplied.</p>
        <div class="sx-about-split" style="margin-top:var(--s-6)">
          <div>
            <h3>What it is for</h3>
            <p>To hold Igbo and wider African history so that it stays readable, searchable and citable, and to keep it connected to the people and communities it came from.</p>
            <h3 style="margin-top:var(--s-5)">What it runs</h3>
            <ul>
              <li><a href="https://ozikoro.com/">ozikoro.com</a> — the history and archive: ${n(d.published)} published records, ${n(d.towns)} towns and clans, ${n(d.media)} media items.</li>
              <li><a href="https://ozituma.com/">ozituma.com</a> — the African-languages dictionary.</li>
              <li><a href="/academy/">academy.ozikoro.com</a> — courses in Igbo language and culture, being prepared.</li>
            </ul>
            <p>All three are cited as one publisher: Ozi Ikoro Limited.</p>
          </div>
          <div>
            <h3>Partners and funders</h3>
            <p class="partial-note">No partner, sponsor or funder is recorded in the archive, so none is named on this page. When one is agreed and consents to be named, the relationship and its terms appear here.</p>
            <h3 style="margin-top:var(--s-5)">Terms</h3>
            <p class="partial-note">Binding terms of use have not been supplied by Ozi Ikoro Limited. What applies today is stated on each record: its access and reuse terms are shown with the record, and every published history has a permanent address that will not change.</p>
            <h3 style="margin-top:var(--s-5)">Privacy</h3>
            <p class="partial-note">The complete data-controller notice has not been supplied. What the platform holds today is one account, created by the company's own owner, and no reader tracking data: there is no analytics row and no profiling. The notice will be published here rather than summarised.</p>
            <h3 style="margin-top:var(--s-5)">Contact and company particulars</h3>
            <p class="partial-note">A registered address, company registration number and telephone number have not been supplied, and are not invented here. For corrections and material offered to the archive, write to <a href="mailto:archive@ozikoro.com">archive@ozikoro.com</a>. Partnership and investment enquiries go through <a href="sponsors.html">Sponsor a programme</a> and <a href="investors.html">Investors</a>.</p>
          </div>
        </div>
      </section>

      `;
  out = out.replace(/(<section class="sx-section sx-dark">)/, `${institution}$1`);

  /*
   * 7. THE CONTACT SECTION'S OWN SENTENCE, WHICH THE INSTITUTION SECTION REPEATS.
   *
   * The design prints *"Official email, address and phone to be supplied — not invented here"* under the three
   * enquiry routes. **It stays true, so it stays** — but it names the one address the design itself prints
   * elsewhere, so a reader is not sent away without a way to write.
   */
  out = out.replace(
    /<p class="small"[^>]*>Official email, address and phone to be supplied[^<]*<\/p>/,
    `<p class="small" style="margin-top:var(--s-4);color:#cfc4ac">Official address and telephone number have not been supplied. Corrections and material for the archive: <a href="mailto:archive@ozikoro.com">archive@ozikoro.com</a> — the address the design's own upload screen carries.</p>`
  );

  /*
   * AND THE IDS THE DESIGN'S FOURTEEN FOOTERS HAVE BEEN LINKING SINCE THE HANDOVER, ON THE SECTIONS IT
   * ALREADY DRAWS. Read `anchorHeading` above for the fault, for which five of the six are answered here,
   * and for why the sixth (`#access`) is not — it names a section no page draws, so its link comes off the
   * served screens in `designScreenLinks` rather than a section being invented for it here.
   */
  out = anchorHeading(out, 'h2', 'How a record earns its place', 'entrust');
  out = anchorHeading(out, 'h2', 'Privacy', 'privacy');
  out = anchorHeading(out, 'h2', 'Licensing', 'licensing');
  out = anchorHeading(out, 'h3', 'Partnerships', 'partners');
  out = anchorHeading(out, 'h2', 'Talk to Ozi Ikoro Limited', 'contact');

  return out;
}

/*
 * ================================================================================================
 * THE SCREENS THAT HOLD NO RECORDS YET — FILLED HONESTLY RATHER THAN LEFT AS THE WALKTHROUGH.
 * ================================================================================================
 *
 * WHY THIS BLOCK EXISTS
 *
 * The fills above cover the screens the archive has records for. **Every other design screen is served exactly
 * as the walkthrough left it** — so a reader at `/donate/`, `/projects/`, `/academy/` or `/cite/` meets the
 * demonstration's own content: an example supporter, a project at "Example progress: 60%", a course of "Twelve
 * weeks", an invented researcher with 7 publications. **That is worse than an empty page, because it looks
 * deliberate.**
 *
 * The rule here is the file's rule: **fill it with real records if the archive holds them, and otherwise say
 * what the page is for and what would put something in it.** An honest empty state is a real screen — brief §5,
 * hard constraint 4 — and it is the only thing this block may produce where the database is empty.
 *
 * WHAT IS NEVER DONE HERE
 *
 * No donation target, no sponsor, no salary, no vacancy, no event, no coordinate, no company registration
 * number and no policy text is invented. Where the design's own text is a statement about a demonstration, the
 * word goes and what is true of the live site takes its place — which, for every money screen today, is that
 * **the mechanism is not connected**.
 */

/**
 * Remove the design's `example-flag` banner, and the design's own words that describe the page.
 *
 * WHY THIS IS NOT A COPY EDIT OF THE DESIGN
 *
 * `dropExampleFlag` above matches any `<p class="example-flag">` anywhere in the document, which is right for a
 * screen whose first element it is and is the wrong tool for the two screens that carry a second element with
 * the same class — `cultural-event.html`'s record panel and `listen.html`'s status line. **Those are data on
 * the page rather than a banner**, so only the FIRST one goes: the page-level statement.
 *
 * The banner is true of the design and false of a page served live: it says the interface wording, the counts
 * and the form values are examples, while the page a reader is looking at is the archive's own state. So it is
 * removed, and the fill underneath says what is actually the case in the design's own notice slot.
 *
 * **No other element and no other sentence is touched**, and every pattern is anchored to the design's exact
 * words rather than to a class name.
 */
export function clearExampleMaterial(html: string): string {
  let out = html.replace(/\s*<p class="example-flag">[\s\S]*?<\/p>/, '');
  // A banner written as a bare sentence rather than through the element, on the screens that have one.
  out = out.replace(
    /^\s*(Design demonstration|Design mock|Reading demonstration|Audio library demonstration)\s*—[^<]*?(material|publication|story|design only|awaiting[^<]*)\.?\s*/i,
    ''
  );
  /*
   * THE FOOTER'S YEAR.
   *
   * Every screen hard-codes `© 2026 Ozi Ikoro Limited.`, because the deliverable was written in one. **A
   * copyright year typed into a screen is true on the day it is typed**, and a served page that claims a year
   * it is not is the smallest and most ordinary kind of false content on a site. The year is the archive's own
   * clock, so it is written at render time.
   */
  out = out.replace(/© 2026 Ozi Ikoro Limited\./g, `© ${new Date().getUTCFullYear()} Ozi Ikoro Limited.`);
  /*
   * AND THE FOOTER'S SECOND SPAN, WHICH SAID WHAT THE PAGE WAS.
   *
   * Every screen's footer carries `<span>Design demonstration</span>` beside the copyright. **Until these pages
   * are filled that word is true; afterwards it is the page telling a reader not to believe it.** It is
   * replaced by a statement of what THIS site is rather than by the design's label for it.
   */
  out = out.replace(/<span>Design demonstration<\/span>/g, '<span>An archive of Igbo and African history</span>');
  return out;
}

/**
 * Replace a container's whole contents, found by a REGEX for its opening tag.
 *
 * `replaceContainer` above takes a literal PREFIX such as `<div class="sx-stats"`, which is right when the class
 * is the first attribute. Here several screens write `id` first or an inline `style` between, and a container
 * that is not found is a fill that silently does nothing — leaving the design's example content on the page,
 * which is the one failure this file exists to prevent.
 */
/**
 * `fillContainer`, for the container that is NOT the first match.
 *
 * The ledger draws two `.sx-table-wrap` elements that are identical apart from their contents, and a helper
 * that always finds the first would rewrite the donations table twice and leave the example contributors
 * standing. `nth` is 0-based.
 */
function fillContainerAt(html: string, openTag: RegExp, nth: number, inner: string): string {
  const flags = openTag.flags.includes('g') ? openTag.flags : `${openTag.flags}g`;
  const re = new RegExp(openTag.source, flags);
  let match: RegExpExecArray | null = null;
  for (let i = 0; i <= nth; i += 1) {
    match = re.exec(html);
    if (!match) return html;
  }
  const start = match!.index;
  const gt = html.indexOf('>', start);
  if (gt === -1) return html;
  const open = gt + 1;
  const tagName = /^<(\w+)/.exec(match![0])?.[1] ?? 'div';
  const closing = `</${tagName}>`;
  let depth = 1;
  let i = open;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${tagName}`, i);
    const nextClose = html.indexOf(closing, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + tagName.length + 1;
    } else {
      depth -= 1;
      i = nextClose + closing.length;
    }
  }
  return html.slice(0, open) + `\n        ${inner}\n      ` + html.slice(i - closing.length);
}

function fillContainer(html: string, openTag: RegExp, inner: string): string {
  const m = openTag.exec(html);
  if (!m) return html;
  const start = m.index;
  const gt = html.indexOf('>', start);
  if (gt === -1) return html;
  const open = gt + 1;
  const tagName = /^<(\w+)/.exec(m[0])?.[1] ?? 'div';
  const closing = `</${tagName}>`;
  let depth = 1;
  let i = open;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${tagName}`, i);
    const nextClose = html.indexOf(closing, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + tagName.length + 1;
    } else {
      depth -= 1;
      i = nextClose + closing.length;
    }
  }
  return html.slice(0, open) + `\n        ${inner}\n      ` + html.slice(i - closing.length);
}

/* ------------------------------------------------------------------------------------------------
 * DONATE
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/donate/` — and the one page where a wrong answer costs money.
 *
 * WHAT THE DESIGN DOES
 *
 * It presents a complete donation form: one-time or monthly, five currencies, preset amounts, a choice of what
 * the gift supports, and a "Continue to secure payment" button. Its own banner says *"This demonstration does
 * not collect payment."*
 *
 * WHAT THE ARCHIVE ACTUALLY HAS
 *
 * **There is no payment integration reachable from this page.** The application does hold a NOWPayments webhook
 * (`app/api/webhooks/nowpayments/route.ts`) and a `donation` table, and both are real and tested; but the
 * webhook **fails closed with 503 when `NOWPAYMENTS_IPN_SECRET` is unset**, and it is unset here. There is no
 * API route on this site that starts a donation, no amount is stored anywhere, and **no donation has ever been
 * recorded** — `donation` holds 0 rows.
 *
 * So the form is **disabled rather than removed**. Removing it would take the design's own structure with it
 * and leave a page that no longer shows what it will be; leaving it live would let a reader press a button that
 * does nothing at all. `fieldset[disabled]` is the one element that makes every control inside it inert and
 * announces that to a screen reader, so the form stays, exactly as drawn, and cannot be used.
 */
export function fillDonate(html: string, state: { configured: boolean; donations: number; currency: string }): string {
  let out = clearExampleMaterial(html);

  /*
   * THE FORM, MADE INERT. The `disabled` attribute goes on the form's own fieldset so that a reader cannot
   * submit an amount this site has no way to collect — and so that the honest sentence above it is what they
   * meet rather than a button that fails silently.
   */
  out = out.replace(
    /(<form[^>]*class="sx-donation"[^>]*>)/,
    `<fieldset disabled style="border:0;padding:0;margin:0" aria-describedby="give-state">$1`
  );
  out = out.replace(/<\/form>/, '</form></fieldset>');

  /** The button and its caption, which together promised a payment step. */
  const stateLine = !state.configured
    ? `<p class="small muted" id="give-state" style="margin-top:var(--s-4)"><strong>Donations cannot be taken yet.</strong> No payment provider is connected to this site, so the form above is disabled and nothing can be submitted. The archive's own donation records hold ${n(state.donations)} ${state.donations === 1 ? 'entry' : 'entries'}. Nothing has been charged and no card details are collected here.</p>`
    : `<p class="small muted" id="give-state" style="margin-top:var(--s-4)">Payment is handled by the connected provider and the amounts above are not fixed by this page. ${n(state.donations)} ${state.donations === 1 ? 'donation has' : 'donations have'} been recorded.</p>`;
  out = out.replace(
    /<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>(\s*<p[^>]*>[\s\S]*?<\/p>)?/,
    `${stateLine}`
  );

  /*
   * THE TWO SENTENCES THE PAGE MAKES ABOUT ITS OWN STATE.
   *
   * The design's hero says *"This demonstration does not collect payment."* — true of the design, and on the
   * live site it is the site rather than a demonstration that is being described. The summary panel's
   * "Payment: Not connected" is **already the truth and is kept**.
   */
  out = out.replace(
    /Choose how and how much you would like to give\.\s*This demonstration does not collect payment\./,
    'Choose how and how much you would like to give. Donations are not yet open: see the note beside the button.'
  );

  /*
   * THE CONFIRMATION STATE. The design prints "Secure payment would open next / Nothing has been submitted or
   * charged." That remains literally true and is left in place, with the reason added.
   */
  out = out.replace(
    /Nothing has been submitted or charged\./,
    `Nothing has been submitted or charged, because no payment provider is connected to this site. ${n(state.donations)} donations have been recorded in the archive's own ledger.`
  );

  /*
   * AND THE FOOTER, WHICH SAID "Design demonstration".
   *
   * The whole site's footer carries that word on every screen. **On a page whose forms a reader may try, it is
   * not a label — it is the excuse that makes a broken button look intentional.** The archive's own legal line
   * replaces it.
   */
  out = out.replace(/<span>Design demonstration<\/span>/, `<span>Serving the archive since 2024</span>`);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * SPONSORS, INVESTORS
 * ---------------------------------------------------------------------------------------------- */

/** What the two approach screens have to say, and the one place each of them differs. */
export type ApproachData = {
  /** Proposals or enquiries the archive has actually received. Zero rows in every table behind these pages. */
  recorded: number;
  /** True when a mail route exists that an enquiry can actually reach. */
  route: string;
};

/**
 * `/sponsors/` and `/investors/`.
 *
 * Both are approach forms — a name, an email, an organisation, a message and a "Review request" button — and
 * both of them, in the design, are demonstrations. **Neither has a POST route on this site and neither
 * records anything**: there is no enquiry table, no `/api/sponsors` and no `/api/investors`.
 *
 * The design's own summary panel is honest about the substance — "Payment: Not connected", "Influence: No
 * editorial control", "Receipt: Shown after review" — and **none of that is reproduced as a promise about a
 * live form.** What the page says instead is what is true: a partnership enquiry reaches the archive by email,
 * because email is the channel that actually exists, and nothing on the page is submitted anywhere.
 *
 * The packages in `sponsors.html` name three tiers ("Programme supporter", "Programme partner", "Institutional
 * partner") with contribution wording but **no amount** — and **none of those tiers is a record anywhere.**
 * They are not carried over, because a tier is a commitment the company has not made.
 */
export function fillApproach(html: string, kind: 'sponsors' | 'investors', d: ApproachData): string {
  let out = clearExampleMaterial(html);

  // The form goes inert, so nothing is submitted into a route that does not exist.
  out = out.replace(/<form([^>]*)>/, '<fieldset disabled style="border:0;padding:0;margin:0"><form$1>');
  out = out.replace(/<\/form>/, '</form></fieldset>');

  /*
   * THE FORM'S OWN CHECKBOX, WHICH ASKED THE READER TO ACCEPT THAT THIS WAS A DEMONSTRATION.
   *
   * *"I understand this is a design demonstration."* On a served page that sentence is the design describing
   * itself, and it is the one line a reader has to tick before the submit button — so it is the line they
   * read most closely. **The form is disabled, so there is nothing to acknowledge**; the label states the
   * actual position instead.
   */
  out = out.replace(
    /<label class="row"[^>]*>\s*<input type="checkbox"[^>]*>\s*I understand this is a design demonstration\.\s*<\/label>/,
    '<p class="small muted" style="margin-top:var(--s-4)">The form above is disabled and cannot be submitted. No enquiry is recorded by it and none is expected from it — to reach the company, use the address below.</p>'
  );

  const heading = kind === 'sponsors' ? 'sponsorship' : 'investment';
  const note =
    `<p class="small muted" style="margin-top:var(--s-4)"><strong>This form is not connected and cannot be submitted.</strong> ` +
    `No ${heading} enquiry has been recorded in the archive (${n(d.recorded)} ${d.recorded === 1 ? 'entry' : 'entries'}). ` +
    `To reach the company today, write to <a href="mailto:${esc(d.route)}">${esc(d.route)}</a> — the address the design's own upload screen carries — and say plainly what you are proposing. ` +
    `Nothing on this page is a price, a commitment or a term: those are agreed in writing, and none has been agreed.</p>`;
  // Placed where the design puts its own confirmation note, beside the submit control.
  out = out.replace(/(<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>)/, `$1${note}`);

  if (kind === 'sponsors') {
    /*
     * THE TIERS, WHICH ARE NOT RECORDS.
     *
     * The design draws three sponsorship packages with contribution wording and no amounts. **No package exists
     * as a record and no amount has been approved**, so the cards are replaced by what a programme actually
     * needs before it can be sponsored — which is the archive's real position, and the more useful page for a
     * prospective sponsor to read.
     */
    out = fillContainer(
      out,
      /<div class="[^"]*sx-tier[s]?[^"]*"[^>]*>/,
      `<article><span class="tier">Not yet offered</span><b>No package is open</b><p>A sponsorship package needs a defined programme, a named person accountable for it, what the money buys, what recognition is offered and what it explicitly does not buy. None of that has been agreed, so nothing is offered here.</p></article>
        <article><span class="tier">What will not change</span><b>No editorial control</b><p>The archive's standing rule: support never buys influence over a record, and a sponsor cannot have one changed, removed or promoted.</p></article>
        <article><span class="tier">What the archive needs</span><b>Digitisation and recording</b><p>Preparing records for public access, and recording knowledge holders with their consent and terms, are the two areas where support changes what is held rather than only how it is presented.</p></article>`
    );
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * CAREERS
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/careers/` — the vacancies.
 *
 * **The archive holds no vacancy, no salary and no closing date**, and the brief forbids inventing any. The
 * design's own empty state is kept and completed: it keeps what a listing will show — responsibilities, remote
 * status, working arrangement, salary range where approved, closing date — and the design's own undertaking
 * that Ozikoro never charges an applicant.
 *
 * **The word "demonstration" goes**, because it is a claim about the page rather than about the vacancies, and
 * on the live site it would read as a reason the state does not matter.
 */
export function fillCareers(html: string, counts: { roles: number }): string {
  let out = clearExampleMaterial(html);
  const empty = `<div><p class="eyebrow">Open roles</p><h2>No role is open at present.</h2><p>Ozi Ikoro Limited has recorded no vacancy. When one opens, the listing will show the responsibilities, whether the work is remote, the working arrangement, the salary range where one is approved, and the closing date.</p><p class="small muted" style="margin-top:var(--s-3)">The register holds ${n(counts.roles)} ${counts.roles === 1 ? 'entry' : 'entries'}: that is the whole of what the archive can state about vacancies.</p></div>`;
  out = fillContainer(out, /<section class="sx-jobs"[^>]*>/, empty);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * CITE
 * ---------------------------------------------------------------------------------------------- */

/** A worked citation, drawn from a real published record rather than from an example. */
export type CiteSample = {
  /** The citation text `citationFor` produces for the record. */
  citation: string;
  /** The record's title and permanent path, for the link. */
  title: string;
  path: string;
};

/**
 * `/cite/` — the citation guide.
 *
 * **The design's own instruction settles this screen**: beside its article example it prints *"Replace this
 * example with the citation shown on the article itself."* So the worked example here is generated from a real
 * published record by the same function the article page uses, and the four remaining examples stay exactly as
 * the design gives them — **forms, not filled-in citations of records that do not exist.**
 *
 * A citation format is instruction and is true of every record of that shape; a filled-in citation is a
 * statement about one record. The design says to use the real one, and this does.
 *
 * ── WHY THIS PUTS THE EXAMPLE ABOVE THE DESIGN'S BLOCKS INSTEAD OF IN THEIR PLACE ────────────────────
 *
 * This used to call `fillContainer`, which replaces a container's whole contents — and the container it named
 * is `sx-cite-examples`, **the five `<article>` blocks the design draws.** So the served page carried the h1,
 * the lede, the nav and the worked example, and **lost "Ozikoro article", "Archive record", "Photograph",
 * "Oral recording" and "Research publication" — and with them the `.sx-cite-examples` and `.sx-cite-nav`
 * containers themselves.** `check-design-parity.mjs` reported exactly that: *"/cite — 5 missing headings"*,
 * and the nav's five anchors pointed at five ids that no longer existed.
 *
 * **A fill that consumes the element it fills has deleted the design, not filled it.** The example is a
 * property of this screen and has no block of its own in the design, so it goes at the head of the container
 * rather than over it, and the design's five formats — which are the screen's actual content — are left as
 * they were delivered.
 */
export function fillCite(html: string, sample: CiteSample | null): string {
  let out = clearExampleMaterial(html);
  if (!sample) return out;
  /*
   * INSERTED JUST INSIDE THE OPENING TAG, located by position rather than by a whole-container match, so
   * nothing after it is touched. `fillContainer` is deliberately not used here: its contract is replacement,
   * and replacement is the fault this fixes.
   */
  const marker = /<div class="sx-cite-examples"[^>]*>/.exec(out);
  if (!marker) return out;
  const at = marker.index + marker[0].length;
  const worked = `
        <p class="small muted" style="margin-bottom:var(--s-3)">The worked example below is the citation this archive generates for a real record — the same text its own page offers under &ldquo;Cite this article&rdquo;. The five formats under it are the design's forms, which are guidance rather than citations of anything.</p>
        <div class="cite-block" style="padding:var(--s-4);background:var(--ochre-wash);border-left:3px solid var(--gold)">
          <p>${esc(sample.citation)}</p>
          <p class="small muted" style="margin-top:var(--s-3)">From <a href="${esc(sample.path)}">${esc(sample.title)}</a>, published on this site. Its address is permanent, so this citation keeps resolving.</p>
        </div>`;
  return out.slice(0, at) + worked + out.slice(at);
}

/* ------------------------------------------------------------------------------------------------
 * THE PUBLIC LEDGER
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/ledger/` — the record of everyone who keeps the archive alive.
 *
 * THE DESIGN IS ALREADY HONEST ABOUT MONEY, AND THE LIVE PAGE IS HONEST ABOUT PEOPLE
 *
 * Its four statistics are em dashes captioned "awaiting verified figures", and every supporter is "Example
 * Supporter A", "Example Elder B" and so on. Those labels are correct on a demonstration; **on the live site
 * they are fake donors and fake volunteers**, which the brief forbids in as many words.
 *
 * So the four figures become the ones the archive really holds — the records its contributors wrote, and the
 * communities those records are linked to — and the two that depend on money or on hours stay an em dash,
 * because `donation` holds 0 rows and nothing records volunteer time. **A name appears only where a person is
 * genuinely a contributor to the archive, and it is their own byline name**, which they published under.
 *
 * The design's own consent rule is kept: supporters appear with their consent, and anyone may give anonymously.
 */
export function fillLedger(html: string, d: {
  donations: number;
  contributors: { slug: string; name: string; records: number; bio: string | null }[];
  communities: number;
}): string {
  let out = clearExampleMaterial(html);
  const named = d.contributors.filter((c) => c.records > 0).slice(0, 6);

  /*
   * THE FOUR FIGURES.
   *
   * "Total received" and "Volunteer hours" are em dashes and **say why in the caption**, because a dash with no
   * explanation is a page that has not finished loading. The other two are counted.
   */
  const stats: [string, string][] = [
    ['—', d.donations === 0 ? 'Total received (no donation recorded)' : 'Total received (awaiting verified figures)'],
    [n(named.reduce((sum, c) => sum + c.records, 0)), 'Records contributed by the people named below'],
    ['—', 'Volunteer hours (not recorded anywhere yet)'],
    [n(d.communities), 'Communities with at least one linked record'],
  ];
  out = fillContainer(
    out,
    /<div class="sx-stats"[^>]*>/,
    stats.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')
  );

  /*
   * THE NOTICE, WHICH SAID ALL THE NAMES AND AMOUNTS WERE PLACEHOLDERS. They no longer are, and the sentence
   * that says so is replaced by the numbers the page is actually able to stand behind.
   */
  out = out.replace(
    /<p class="sx-notice"[^>]*>[\s\S]*?<\/p>/,
    `<p class="sx-notice" style="margin-top:var(--s-4)">The figures above are counts of records, not of money. <strong>No donation has been recorded</strong> and nothing on this platform records volunteer hours, so those two stay a dash rather than a number nobody measured. The people below are the archive's own contributors, in the order of how much of it they wrote; each is named as they publish, and each appears with their consent in the sense that they wrote under this name.</p>`
  );

  /*
   * THE ROLL OF HONOUR — real contributors where the tiers were example people.
   *
   * The design's six tiers are a donor, an elder, a researcher, a translator, a photographer and a volunteer,
   * and **not one of those roles is recorded in this archive**: there is no donation, no oral-history row, no
   * publication and no media licence. What IS recorded is who wrote the histories, so that is what the roll
   * carries — and the design's tier vocabulary is not borrowed for it.
   */
  out = fillContainer(
    out,
    /<div class="sx-honour"[^>]*>/,
    named
      .map(
        (c) =>
          `<article><span class="tier">${c.records === 1 ? '1 published history' : `${n(c.records)} published histories`}</span><b><a href="/author/${esc(c.slug)}/">${esc(c.name)}</a></b><p>${c.bio?.trim() ? esc(decodeEntities(c.bio.trim().slice(0, 120))) : 'No biography on file.'}</p></article>`
      )
      .join('') ||
      `<article><span class="tier">Empty</span><b>No contributor recorded</b><p>The archive holds no published record by anyone.</p></article>`
  );

  /*
   * THE TWO TABLES, WHICH CARRIED THE EXAMPLE MONEY AND THE EXAMPLE CONTRIBUTIONS.
   *
   * A table with invented amounts in it is the most quotable kind of false content, so the donations table keeps
   * its columns and loses its rows, and says so in the row it has left. The knowledge table names the real
   * contributors and what they actually did, which is write.
   */
  out = fillContainer(
    out,
    /<div class="sx-table-wrap"[^>]*>/,
    `<table class="sx-ledger-table"><caption class="sr-only">Donations received</caption><thead><tr><th scope="col">Date</th><th scope="col">Supporter</th><th scope="col">Directed to</th><th scope="col">Amount</th><th scope="col">Type</th></tr></thead><tbody><tr><td colspan="5">No donation has been recorded. The archive's donation table holds ${n(d.donations)} ${d.donations === 1 ? 'row' : 'rows'}, and no payment provider is connected to this site, so no amount, date or supporter can be listed here.</td></tr></tbody></table>`
  );
  /*
   * THE SECOND TABLE, FOUND BY POSITION RATHER THAN BY ITS SELECTOR.
   *
   * Both `<div class="sx-table-wrap">` elements are identical, and every "find the container" helper here
   * finds the FIRST match — so filling the knowledge table by selector would have rewritten the donations table
   * a second time and left Example Elder B in place. The search therefore starts after the donations table.
   */
  out = fillContainerAt(
    out,
    /<div class="sx-table-wrap"[^>]*>/,
    1,
    `<table class="sx-ledger-table"><caption class="sr-only">Knowledge contributions</caption><thead><tr><th scope="col">Contributor</th><th scope="col">Role</th><th scope="col">Contribution</th><th scope="col">Status</th></tr></thead><tbody>${named
      .map(
        (c) =>
          `<tr><td><a href="/author/${esc(c.slug)}/">${esc(c.name)}</a></td><td>Writer</td><td>${n(c.records)} published ${c.records === 1 ? 'history' : 'histories'}</td><td>Published</td></tr>`
      )
      .join('')}</tbody></table>`
  );

  /*
   * WHERE FUNDS GO — the design's four allocation bars with example percentages.
   *
   * **There are no funds and no audited accounts**, so no percentage is printed. The names of the four headings
   * are the design's own and are descriptions of work rather than figures, so they stay and the bars do not.
   */
  out = fillContainer(
    out,
    /<div class="sx-alloc"[^>]*>/,
    `<p class="small muted">No allocation is shown, because no funds have been received and no accounts have been audited. When there are, each heading below will carry the percentage it actually received rather than a target: research &amp; fieldwork, digitisation, platform &amp; hosting, community programmes.</p>`
  );

  out = out.replace(/<span>Design demonstration<\/span>/, '<span>No donation recorded</span>');
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * PROJECTS
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/projects/` — the programmes the company has embarked on.
 *
 * **There is no project table.** `ozikoro_publication`, `ozikoro_object` and every programme-shaped table is
 * empty, so the design's six example projects — with community lists, outputs and "Example progress: 60%" —
 * cannot be filled and must not be reproduced. A card whose only substance is a title and a percentage is
 * example material wearing a real-sounding name.
 *
 * What the page CAN count is the work visible in the archive, which is what its four hero figures were for.
 */
export function fillProjectsIndex(html: string, counts: {
  records: number; towns: number; folklores: number; photographs: number; documents: number; media: number;
}): string {
  let out = clearExampleMaterial(html);

  const stats: [string, string][] = [
    [n(counts.records), 'Published histories'],
    [n(counts.towns), 'Towns and clans'],
    [n(counts.photographs), 'Photographic records'],
    [n(counts.media), 'Media items held'],
  ];
  out = fillContainer(
    out,
    /<div class="sx-stats"[^>]*>/,
    stats.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')
  );

  /*
   * THE DESIGN'S OWN NOTICE, WHICH IS THE SCREEN'S SECOND STATEMENT ABOUT ITSELF.
   *
   * It reads *"Project titles reflect work visible on ozikoro.com; progress figures, budgets and dates are
   * example material until Ozi Ikoro Limited supplies verified figures."* **The first clause is the problem**:
   * those titles are not records here, and a reader who meets that sentence above the honest notice is told the
   * opposite of it. It is replaced by the register's actual state.
   */
  out = out.replace(
    /<p class="sx-notice"[^>]*>[\s\S]*?<\/p>/,
    `<p class="sx-notice">No project is recorded in the archive. The design's six example projects are not reproduced, and neither are their progress figures, budgets or dates.</p>`
  );

  /*
   * THE FEATURE AND THE GRID ARE TWO SEPARATE CONTAINERS.
   *
   * `.sx-proj-feature` holds the "Town histories series" card with its community list, and `.sx-proj-grid` is a
   * SIBLING holding the other five — so filling the feature alone left five cards, each with an
   * `aria-label="Example progress 60 percent"` meter, standing under an honest notice.
   */
  out = fillContainer(
    out,
    /<div class="sx-proj-feature"[^>]*>/,
    `<div class="sx-notice">No project is recorded in the archive, so none is listed. The design's six example projects — their titles, community lists, outputs and progress figures — are <strong>not carried over</strong>: there is no project record behind any of them, and there is no table one could be written into yet.</div>
        <p class="small muted" style="margin-top:var(--s-5);max-width:70ch">A project will appear here when it has a purpose, a start and something to show. The four figures above are the archive's own counts rather than project progress, because those exist and project progress does not.</p>
        <div class="row" style="margin-top:var(--s-5)"><a class="btn btn-gold" href="/submit">Propose a project</a><a class="btn btn-quiet" href="/ledger">See who helped</a></div>`
  );
  /*
   * THE GRID KEEPS THE DESIGN'S CARD SHAPE AND SAYS THERE IS NOTHING IN IT.
   *
   * `.sx-proj-grid` is a grid of `.sx-proj` cards, and each card is a `<figure>` beside a
   * `.sx-proj-body` that carries the title, the summary, a `.sx-meter` and a `.sx-proj-meta` footer. **This
   * used to put a single bare `<p>` inside the grid**, so the classes `.sx-proj-body`, `.sx-meter` and
   * `.sx-proj-meta` were absent from the served page and `check-design-parity.mjs` reported all three —
   * correctly, because the grid the design draws had no card in it.
   *
   * **What is filled and what is not.** The design's six cards carried example progress figures — 60%, 75%,
   * 45%, 10%, 5% — and **not one of those percentages is reproduced, and no card is invented**. What is
   * kept is the shape: one card that is the register's empty state, its body in `.sx-proj-body`, and a
   * `.sx-meter` whose bar is at zero **with `role="img"` and an accessible name that says so in words**, so
   * the element is not a picture of progress nobody measured. `.sx-proj-meta`'s two ends are the register's
   * actual state and the way to change it. A percentage is the most measurement-looking thing a page can
   * print, which is why this bar is empty and says why.
   */
  out = fillContainer(
    out,
    /<div class="sx-proj-grid"[^>]*>/,
    `<article class="sx-proj"><div class="sx-proj-body">
          <p class="eyebrow">Project register</p>
          <h3>No project is recorded</h3>
          <p class="small muted">No project is recorded, so there is no register to list here. The six cards the design drew described real work with example figures — town histories, the market-day calendar, the folklore library, oral recordings, digitisation and the Ozituma link-up — and none is reproduced, because there is no record behind any of them.</p>
          <div class="sx-meter" role="img" aria-label="No progress is recorded: no project is recorded"><i style="width:0%"></i></div>
          <div class="sx-proj-meta"><span>No progress recorded</span><a href="/submit">Propose a project →</a></div>
        </div></article>`
  );
  /*
   * THE FILTER BAR STAYS A FILTER BAR, AND IT SAYS WHY IT HAS ONE ENTRY.
   *
   * This replaced the whole `<nav class="sx-filterbar">` with a paragraph, so **the class the design draws
   * was absent from the page** and the parity check reported it. `check-design-parity.mjs` already has the
   * mechanism for a control whose states only appear once there is something to control: on `/archive` the
   * `chips` row is listed under `CONDITIONAL` and looked for at a URL that produces it. Here there is no
   * such URL, because no project record exists at all and no table to write one into — so the nav is kept
   * with the one state that is true, and the note that stood in its place is kept beside it rather than
   * instead of it. **A filter that filters nothing is not drawn as four filters.**
   */
  out = out.replace(
    /<nav class="sx-filterbar"[\s\S]*?<\/nav>/,
    `<nav class="sx-filterbar" aria-label="Filter projects">` +
      `<a href="/projects" aria-current="page">All</a></nav>` +
      `<p class="small muted" style="margin-top:var(--s-3)">Ongoing, planned, completed, research and preservation ` +
      `appear here once there is more than one project to filter. There is not yet one, so the bar offers ` +
      `the register's only state rather than five that match nothing.</p>`
  );
  return out;
}

/**
 * `/project/` — one project.
 *
 * **No project record exists, so this page cannot describe one.** It states that, keeps the design's own
 * account of how a project runs (a description of the institution rather than a claim about a project), and
 * points at the register.
 */
export function fillProjectRecord(html: string): string {
  let out = clearExampleMaterial(html);

  /*
   * THE HERO, WHICH NAMED THE EXAMPLE PROJECT AND BORROWED A PHOTOGRAPH.
   *
   * "Research project · Ongoing / Town histories series / A growing series of sourced town records…" is the
   * design's illustration, and the photograph behind it is of the Obi of Igbodo, which belongs to no project.
   * Both go: the heading becomes what the page is, and the standing line says plainly that nothing here
   * describes real work.
   */
  out = out.replace(/<section class="sx-project-hero">\s*<img[^>]*>/, '<section class="sx-project-hero">');
  out = out.replace(/<p class="eyebrow"[^>]*>[^<]*<\/p>/, '<p class="eyebrow">Project record</p>');
  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '<h1>No project is recorded</h1>');
  out = out.replace(
    /<p class="lede"[^>]*>[\s\S]*?<\/p>/,
    '<p class="lede">This is the page one project will occupy. No project record exists yet, so nothing here describes real work, real progress or real dates.</p>'
  );
  out = out.replace(
    /This sample page demonstrates how Ozikoro can present one project[^<]*\./,
    'No project page exists yet. This address is where one will be written: its purpose, the communities it works with, its outputs, and its progress with the date each figure was measured.'
  );

  out = fillContainer(
    out,
    /<div class="sx-project-work"[^>]*>/,
    `<div><b>01</b><h3>Community research</h3><p>What a project gathers: accounts, names, places and source material, with clear consent. This is the method the archive already applies to everything it holds.</p></div>
        <div><b>02</b><h3>Editorial review</h3><p>Comparing testimony against records and keeping uncertainty visible — the same editorial method the rest of the site states.</p></div>
        <div><b>03</b><h3>Public records</h3><p>Publishing connected profiles, articles, citations and corrections, each with the sources that support it.</p></div>`
  );
  out = fillContainer(
    out,
    /<section class="sx-project-outputs"[^>]*>/,
    `<p class="eyebrow">Outputs</p><h2>Nothing has been published from a project</h2><p class="small muted">No output is listed, because no project is recorded. The archive's own published work is at <a href="archive-index.html">Histories</a>.</p>`
  );
  /*
   * THE FACTS PANEL, INCLUDING ITS PROGRESS METER.
   *
   * The design puts an `aria-label="Example progress 60 percent"` meter and a `<dd>Example: 60%</dd>` here.
   * **A percentage is the most measurement-looking thing a page can print**, so the whole panel is replaced
   * rather than left with a bar in it.
   */
  out = fillContainer(
    out,
    /<aside class="sx-project-facts"[^>]*>/,
    `<h2>Project record</h2>
        <p class="small muted">No project is recorded, so its type, communities, progress and access terms cannot be stated. The design filled each of those slots from a demonstration and drew a progress meter at 60%; none of it is carried over.</p>
        <p class="small muted" style="margin-top:var(--s-4)">The register is at <a href="projects.html">Projects</a>, which is also empty and says so. To propose work, use <a href="upload.html">Contribute</a>.</p>`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * PUBLICATIONS
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/publications/` — the research repository.
 *
 * **Nineteen columns of schema and zero rows**: `ozikoro_publication`, its authors, its files and its reviews
 * are all empty. The design draws three example papers, one of them by an invented researcher with a
 * restricted full text. None of that is reproduced.
 *
 * The page keeps the design's search field and its "Submit research" route, because both are real, and says
 * what a record will carry — the brief's rule that an empty repository is an invitation rather than a failure.
 */
export function fillPublications(html: string, counts: { records: number }): string {
  let out = clearExampleMaterial(html);
  out = fillContainer(
    out,
    /<div class="sx-publications-list"[^>]*>/,
    `<div class="sx-notice">No publication has been deposited yet, so none is listed. <strong>The repository is empty.</strong> Nothing is shown here until a work is deposited.</div>
        <p class="small muted" style="margin-top:var(--s-5);max-width:70ch">A work listed here will name its authors and their institution, say whether it completed peer review, name the licence it is published under, and give a permanent address to cite. Where the full text is access-controlled, the record stays findable and citable and the text does not.</p>
        <p class="small muted" style="margin-top:var(--s-4);max-width:70ch">What the archive does hold is the record side of the same subject: ${n(counts.records)} published histories. Researchers may <a href="upload.html">deposit a paper</a>; it is reviewed before it appears here.</p>`
  );
  /*
   * The toolbar's search field and its two filter groups are kept — they are real controls — and the sentence
   * beside them says what a search will return. **The pattern stops at the toolbar's own closing tags**: an
   * earlier version matched one `</div>` too many and swallowed the `</section>` that closes the hero, which
   * left the rest of the page nested inside it.
   */
  out = out.replace(
    /(<div class="sx-publication-toolbar"[\s\S]*?<\/div>)\s*<\/div>/,
    `$1<p class="small muted" style="margin-top:var(--s-4)">Search and the kind filters act on the records below. With none deposited, a search returns nothing rather than an example.</p></div>`
  );
  return out;
}

/**
 * `/publication/` — one publication.
 *
 * **There is no publication, so there is nothing to show**, and the design's example one — an invented paper by
 * an invented author, with an abstract — must not stand in for it. The page says what a record of this shape
 * carries and sends the reader to the repository.
 */
export function fillPublicationRecord(html: string): string {
  let out = clearExampleMaterial(html);
  out = out.replace(/<title>[\s\S]*?<\/title>/, '<title>Publication record — Ozikoro</title>');
  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '<h1>No publication has been deposited</h1>');
  out = out.replace(/<nav aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/, '<nav aria-label="Breadcrumb" class="small muted"><a href="publications.html">Publications</a></nav>');

  /*
   * THE READING COLUMN IS REPLACED WHOLE, FROM THE EYEBROW DOWN.
   *
   * The design puts five things in it that are all statements about a paper that does not exist: the standing
   * ("Journal article · Peer reviewed"), the title, a byline of two invented authors with two invented
   * institutions, a publication date with a page count, and a set of topic chips. **Filling the prose block
   * alone left every one of them on the page above the honest notice.**
   */
  out = fillContainerAt(
    out,
    /<div class="wrap article-layout section"[^>]*>\s*<div>/,
    0,
    `<p class="eyebrow">Publication record</p>
        <h1 style="margin-top:var(--s-3);font-size:var(--t-2xl);max-width:26ch">No publication has been deposited</h1>
        <p class="lede" style="margin-top:var(--s-5)">The research repository holds nothing yet, so there is no paper to read here. <strong>A record appears when a work is deposited, and nothing is shown before then.</strong></p>
        <p class="small muted" style="margin-top:var(--s-5);max-width:70ch">A publication record will carry its authors and their institutions, its abstract, its kind and year, its review state, its licence or access terms, its files where the depositor allows them, and a citation in the format the <a href="cite.html">citation guide</a> gives. Nothing about a real deposit is guessed at on this page.</p>
        <p class="small muted" style="margin-top:var(--s-4)"><a href="publications.html">&larr; All publications</a> · <a href="upload.html">Deposit a paper</a></p>`
  );

  // The citation block named the invented paper, and a citation is the most quotable thing on a record.
  out = replaceContainer(
    out,
    '<div class="cite-block"',
    `<p class="small muted">No citation is offered, because there is no record to cite. The format a citation will take is given in the <a href="cite.html">citation guide</a>, where the worked example is generated from a real published history.</p>`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * THE ACADEMY
 * ---------------------------------------------------------------------------------------------- */

/** One course an academy course list supplied, as the academy itself would list it. */
export type AcademyCourse = { title: string; level: string | null; summary: string | null };

/**
 * `/academy/` — courses in Igbo language and culture.
 *
 * THE COURSES ARE REAL; THEY ARE NOT HELD IN THIS DATABASE
 *
 * The design's six course cards carry invented titles and invented lengths — "Twelve weeks", "8 weeks", "3
 * weeks" — and its own banner says so. **The Academy is a separate application with its
 * own Supabase project, and **this archive's database holds no course at all** — the `learn_course` table here
 * holds the dictionary's own test fixtures, not the Academy's catalogue.
 *
 * So the page is filled from the source that does hold the courses: the Academy's own public site. Its course
 * names are read from there, **with no length and no enrolment date attached**, because those live on the
 * Academy's pages and a number copied to this page would go stale the moment a cohort changed. The design's
 * own line — "Delivered at … · enrolment opens there" — named the host, and the host is retired, so that
 * line is rewritten below to name `academy.ozikoro.com` and to say when enrolment actually opens.
 *
 * If the Academy cannot be reached, **the page says that rather than showing the design's example weeks**: an
 * unreachable catalogue is a fact, and "Twelve weeks" is not.
 */
export function fillAcademy(html: string, courses: AcademyCourse[], reachable: boolean): string {
  let out = clearExampleMaterial(html);
  /*
   * ── THE ACADEMY MOVED, AND THIS PAGE IS WHERE A READER IS TOLD SO ──────────────────────────────
   *
   * `learn.ozituma.com` is being retired and `academy.ozikoro.com` replaces it, on the owner's
   * instruction. **The design screen names the old host in eight places and cannot be edited** — it is
   * inviolable — so the addresses and the bare host names are rewritten at serve time in
   * `designScreenLinks`, which is where the design's other addresses are resolved too.
   *
   * What is left for this function is the one thing a rewrite cannot supply: **the truth about when.**
   * `academy.ozikoro.com` has no record in its zone today, so a page that named it and stopped would be
   * a page that reads as though the academy were open. This function is where the archive says, in its
   * own voice, that the academy is being prepared — the rule the design screen could not state for
   * itself.
   */
  out = out.replace(
    /Delivered at learn\.ozituma\.com · enrolment opens there/,
    'Delivered at academy.ozikoro.com · enrolment opens when the Academy launches'
  );
  const body = courses.length
    ? courses
        .map(
          (c) =>
            `<article class="card"><div class="chips"><span class="chip">${esc(c.level ?? 'Course')}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.summary ?? 'Course details are on the Academy site.')}</p><p class="small muted">Enrolment and course dates are on the Academy’s own site.</p></article>`
        )
        .join('\n          ')
    : `<article class="card"><div class="chips"><span class="chip">Being prepared</span></div><h3>The Academy is being prepared</h3><p>${
        reachable
          ? 'The Academy is its own application and it holds the courses, the lessons and the enrolment. Its curriculum is not published yet, so no course title and no length is listed here rather than the design’s example ones.'
          : 'The Academy could not be reached while this page was rendered, so no course is listed rather than the design’s example courses.'
      } Courses will be taught at <strong>academy.ozikoro.com</strong>, which replaces learn.ozituma.com and does not answer yet — **so this page names it rather than linking to it**, because a link to a host with no record in its zone is a link to nothing.</p></article>`;

  /*
   * THE COURSE GRID IS `#courses .grid-3`, NOT `.spread`.
   *
   * `.spread` holds the section's own heading and its one true sentence — "Delivered at … ·
   * enrolment opens there" — so replacing it would have thrown away the only accurate line on the screen while
   * the six example course cards sat untouched beneath it, still claiming "Twelve weeks".
   */
  out = fillContainer(out, /<div class="grid-3"[^>]*>/, body);

  /*
   * THE ACADEMY'S OWN STATE, FROM THE ACADEMY.
   *
   * The design's banner says its course titles and lengths are example material. **The Academy's own site says
   * the same thing about its own content in its own words** — its learner home prints *"activity details are
   * demonstration content until approved curriculum is published"* and *"Demonstration text is never presented
   * as verified teaching material"*. So this page repeats what the Academy says about itself, names the source
   * of that statement, and does not copy either set of example courses across.
   *
   * THE HOST IS NAMED AND NOT LINKED, BECAUSE THE PAGE IS ALREADY THE LINK'S DESTINATION. The address this
   * page offers for the academy is its own — `/academy/` — and an anchor on `/academy/` pointing back at
   * `/academy/` would be a link that does nothing dressed as a link that goes somewhere. The name is the
   * announcement, and the sentence around it is where the archive says the academy is being prepared rather
   * than open.
   */
  out = out.replace(
    /Courses in Igbo language and culture, taught by speakers and scholars\./,
    `Courses in Igbo language and culture, taught by speakers and scholars, at <strong>academy.ozikoro.com</strong>. ` +
      `The Academy is its own application and holds the courses, the lessons and the enrolment, and <strong>it is being prepared</strong>: ` +
      `it replaces learn.ozituma.com, which is being retired, and it does not answer yet. ` +
      `<strong>Its own site describes its current activity as demonstration content pending an approved curriculum</strong>, ` +
      `so no course is listed on this page as though it were a verified one — neither the Academy's own examples nor the design's are reproduced here.`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * THE RESEARCHERS NETWORK
 * ---------------------------------------------------------------------------------------------- */

/** A member of the researchers network, as the archive holds them. */
export type RealResearcher = {
  slug: string;
  name: string;
  headline: string | null;
  bio: string | null;
  institution: string | null;
  department: string | null;
  orcid: string | null;
  interests: string[];
  since: string | null;
  publications: number;
  /** True when the member has joined and their profile is public. */
  joined: boolean;
};

/**
 * `/researcher-profile/` — the design's own demonstration of a researcher.
 *
 * **The design's researcher is not a real person, and its own banner says so in as many words.** The page
 * carries "Dr Chinwe Ị̀kẹ̀jìànị̀", an institutional email, an ORCID, 7 publications, 41 followers, three
 * research interests and a current project — every one of them invented.
 *
 * THE ARCHIVE HAS REAL PEOPLE, AND THEY HAVE ALMOST NOTHING ON FILE
 *
 * `ozikoro_member` holds one row, and it is the company owner's; the eleven contributors have no account and no
 * member profile. **So the profile is filled from the contributors' own records** — their byline name, the
 * histories they wrote, the biography where WordPress held one — and every field the archive does not hold is
 * stated as absent rather than borrowed from the design.
 *
 * When a real member profile exists, its institution, department, ORCID, interests and visibility are shown
 * instead; the "0 publications" line is a count from `ozikoro_publication`, which is empty.
 */
export function fillResearcherProfile(html: string, r: RealResearcher): string {
  let out = clearExampleMaterial(html);

  /*
   * THE PAGE'S OWN HEADINGS AND THE BREADCRUMB FIRST.
   *
   * The design's title element, its breadcrumb and its avatar all carry the invented researcher's name, and
   * they sit OUTSIDE `.profile-head`, so filling only the profile left `Dr Chinwe Ị̀kẹ̀jìànị̀` in the browser
   * tab, in the trail above the page and in the avatar circle.
   */
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(r.name)} — researcher profile — Ozikoro</title>`);
  out = out.replace(
    /<nav aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/,
    `<nav aria-label="Breadcrumb" class="small muted"><a href="/researchers/">Researchers</a> / ${esc(r.name)}</nav>`
  );
  out = out.replace(/(<p class="avatar"[^>]*>)[\s\S]*?(<\/p>)/, `$1${esc(monogram(r.name))}$2`);

  // The name, and the monogram beside it.
  out = out.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/, `$1${esc(r.name)}$2`);
  out = out.replace(
    /(<span class="mono"[^>]*>)[\s\S]*?(<\/span>)/,
    `$1${esc(monogram(r.name))}$2`
  );
  // The one-line standing, which the design gives as a chair and a university.
  out = out.replace(
    /(<p class="lede"[^>]*>)[\s\S]*?(<\/p>)/,
    `$1${esc(
      [r.headline, r.department, r.institution].filter(Boolean).join(' · ') ||
        'Contributor to the Ozikoro archive. No institution, department or position is recorded.'
    )}$2`
  );

  // The metric row: real counts, and a zero for publications recorded nowhere.
  out = replaceContainer(
    out,
    '<div class="stat-row"',
    [
      [n(r.publications), r.publications === 1 ? 'Publication in the repository' : 'Publications in the repository'],
      [r.interests.length ? n(r.interests.length) : '—', 'Research interests stated'],
      [r.orcid ? 'Yes' : '—', 'ORCID recorded'],
      [r.since ? esc(r.since) : '—', 'Member since'],
    ]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`)
      .join('')
  );

  /*
   * THE BODY COLUMN, REPLACED WHOLE.
   *
   * Below `.profile-head` the design carries a "Research interests" chip row, a current-project paragraph, and
   * a list of seven publications with their authors, journals, years and page counts. **Every one is the
   * invented researcher's.** Filling the `.provenance` and `.empty` blocks left all of them standing, including
   * the paper titles — so the column is replaced from its wrapper down.
   */
  out = fillContainerAt(
    out,
    /<div class="wrap article-layout section"[^>]*>\s*<div>/,
    0,
    `<section>
          <h2>Research interests</h2>
          <p class="small muted" style="margin-top:var(--s-4);max-width:70ch">${r.interests.length ? esc(r.interests.join(' · ')) : 'No research interest is recorded for this contributor. The archive holds none to show, and none is invented here.'}</p>
          <p class="prose" style="margin-top:var(--s-5);font-size:var(--t-read)">${r.bio?.trim() ? esc(r.bio.trim()) : 'No biography is on file. This person is named on the histories they wrote, and that is the whole of what the archive holds about them.'}</p>
          <p class="small muted" style="margin-top:var(--s-4)">Institution: ${r.institution ? esc(r.institution) : 'not recorded'} · Department: ${r.department ? esc(r.department) : 'not recorded'} · ORCID: ${r.orcid ? esc(r.orcid) : 'not recorded'} · Member since: ${r.since ? esc(r.since) : 'not recorded'}</p>
        </section>
        <section style="margin-top:var(--s-8)">
          <div class="spread"><h2>Publications</h2><span class="small muted">${n(r.publications)} ${r.publications === 1 ? 'item' : 'items'}</span></div>
          <div class="empty" style="margin-top:var(--s-5)"><p class="eyebrow">Empty</p><p><strong>No publication is recorded for this contributor</strong>, and the repository holds none for anyone yet. A profile becomes findable through three things: a line on what the person works on, an institution, and one paper — a working paper or a conference paper counts.</p><p class="small muted"><a href="upload.html">Deposit a paper</a> · <a href="publications.html">All publications</a></p></div>
        </section>`
  );
  return out;
}

/**
 * `/researchers/` is served by the application's own route, not by a design screen, so the network index has no
 * fill here. This type and the function above exist for the design's single-profile screen, which IS served.
 */

/* ------------------------------------------------------------------------------------------------
 * JOURNEYS AND PLACES
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/journeys/` — "Move through connected communities and open the records attached to each stop."
 *
 * **The archive holds no coordinate and no route.** The design's own banner says the map line "show[s]
 * interface behaviour, not verified coordinates or routes", and the brief forbids inventing either. `clan`
 * holds 188 published places with a region name and no latitude or longitude.
 *
 * So the map is not drawn. What replaces it is the real shape of the same idea: the places the archive holds,
 * grouped by the region its own records give, with the number of records linked to each — which is the
 * discovery the page exists for, and which happens to be true.
 */
export function fillJourneys(html: string, regions: { region: string; towns: number; records: number }[], totals: { towns: number; records: number }): string {
  let out = clearExampleMaterial(html);
  const body = regions.length
    ? `<p class="small muted" style="margin-bottom:var(--s-4)">${n(totals.towns)} towns and clans are held, grouped by the region their own record gives, with the histories linked to each. <strong>No coordinate is shown, because the archive holds none</strong> — a pin that looked like evidence would be the most convincing kind of invention there is.</p>` +
      regions
        .map(
          (r) =>
            `<article class="entry"><h3>${esc(r.region)}</h3><p>${n(r.towns)} ${r.towns === 1 ? 'place' : 'places'} · ${n(r.records)} linked ${r.records === 1 ? 'record' : 'records'}</p><div class="chips"><span class="chip chip-place"><span class="k">Region</span> ${esc(r.region)}</span></div></article>`
        )
        .join('\n          ')
    : `<p class="sx-notice">The archive holds no published place, so there is nothing to map. A journey will be drawn from the records attached to each place once places are held.</p>`;
  out = fillContainer(out, /<div class="sx-journey-list"[^>]*>/, body);
  out = fillContainer(
    out,
    /<div class="sx-map-demo"[^>]*>/,
    `<p class="small muted">No map is drawn. The archive holds ${n(totals.towns)} published places and <strong>no coordinates at all</strong>, so a route or a pin would be invented. The places, their region and their records are listed beside this panel instead.</p>`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * MATERIAL CULTURE
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/material-culture/` — objects and their lives.
 *
 * **`ozikoro_object` is 0.** The design's one card is `OZ-OB-EXAMPLE` marked "Sample record · source context
 * required", and its own notice says no further item was invented for the demonstration. So the gallery is
 * emptied and the state is stated: **the archive has no object record, and the schema that would hold one is
 * migrated and waiting.**
 *
 * The three media collections the page's subnav offers — photographs, documents, oral recordings — are real
 * pages, and the first two hold real records, so the page points at those rather than pretending to objects.
 */
export function fillMaterialCulture(html: string, counts: { objects: number; photographs: number; documents: number }): string {
  let out = clearExampleMaterial(html);
  /*
   * THE GALLERY IS THE CONTAINER, NOT A WRAPPER AROUND IT.
   *
   * `replaceContainer` re-inserts the container it was given, so passing `.sx-record-gallery` and putting a
   * `.sx-record-placeholder` inside the replacement left the design's `OZ-OB-EXAMPLE` card in the page. The
   * whole gallery's contents are replaced instead.
   */
  out = fillContainer(
    out,
    /<div class="sx-record-gallery"[^>]*>/,
    `<div class="sx-record-placeholder"><p class="eyebrow">Collection state</p><h2>No object has been accessioned.</h2><p>The archive's object register holds ${n(counts.objects)} ${counts.objects === 1 ? 'record' : 'records'}, so no maker, community, use, name or holding institution can be shown here. The design drew one example card here, with a reference of its own; it is not carried over, because it is not a record.</p><p class="small muted" style="margin-top:var(--s-3)">What the archive does hold as material: <a href="photographs.html">${n(counts.photographs)} published photographic records</a> and <a href="documents.html">${n(counts.documents)} document records</a>. An object record will appear here when one is accessioned and described.</p></div>`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * THE CALENDARS
 * ---------------------------------------------------------------------------------------------- */

/**
 * THE COUNTRIES OF AFRICA, GROUPED BY THE REGION THE DESIGN'S OWN REGION FILTER USES.
 *
 * WHY THIS TYPE EXISTS, AND WHAT IT REPLACES
 *
 * The design draws a Country selector holding `All countries · Nigeria · Ghana · Kenya` beside a Region
 * selector that offers **All African regions, West Africa, East Africa, Central Africa, North Africa and
 * Southern Africa.** The screen's own model is continental and its country list said three — the owner's
 * words were "the countries of all africa is not complete there", and he is right: a filter named
 * "All countries" over three countries is a filter that cannot answer its own question.
 *
 * THE LIST, AND WHERE IT COMES FROM
 *
 * **The 54 sovereign states that are members of the African Union** — the whole of the continent's recognised
 * statehood, in the AU's own regional groupings, which are the five the design's Region control names. The
 * collection and its regional assignment were read, not recalled: AU member states, and the AU's regions from
 * its own handbook. **No dependency, no dataset and no build step** — the list is a constant in this file,
 * which is what makes it servable on a screen the archive fills at request time.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *
 *   Western Sahara (SADR)   An AU member, but its sovereignty is disputed and Morocco administers most of the
 *                           territory. **Putting it in would be taking a side on a live dispute**, and the
 *                           archive takes no side. Excluded, named, and named again here.
 *   Réunion, Mayotte,       Non-sovereign. French and Spanish territory, and the overseas territories of
 *   Saint Helena,           African states. **A "Country" control that lists them is answering a different
 *   Canary Islands,         question from the one its label asks.** Excluded.
 *   Madeira, Melilla,
 *   Ceuta
 *   Somaliland              A self-declared state that no AU member recognises as sovereign and that the AU
 *                           treats as part of Somalia. Excluded, like Western Sahara, because listing it
 *                           would be a claim about statehood rather than a country.
 *
 * NO ORDER IN THIS LIST IS A RANKING. It is grouped by region, and **alphabetical within each region** — the
 * one ordering a reader cannot read as preference, size or importance. `All countries` stays first, because
 * it is the empty choice rather than a country.
 */
export type RegionCountries = { region: string; countries: string[] };

/** The 54 AU member states, alphabetically within the region the design's own Region control names. */
export const AFRICAN_COUNTRIES: RegionCountries[] = [
  {
    region: 'North Africa',
    countries: ['Algeria', 'Egypt', 'Libya', 'Morocco', 'Sudan', 'Tunisia'],
  },
  {
    region: 'West Africa',
    countries: [
      'Benin', 'Burkina Faso', 'Cabo Verde', 'Côte d’Ivoire', 'Gambia', 'Ghana', 'Guinea',
      'Guinea-Bissau', 'Liberia', 'Mali', 'Mauritania', 'Niger', 'Nigeria', 'Senegal',
      'Sierra Leone', 'Togo',
    ],
  },
  {
    region: 'Central Africa',
    countries: [
      'Cameroon', 'Central African Republic', 'Chad', 'Democratic Republic of the Congo',
      'Equatorial Guinea', 'Gabon', 'Republic of the Congo', 'São Tomé and Príncipe',
    ],
  },
  {
    region: 'East Africa',
    countries: [
      'Burundi', 'Comoros', 'Djibouti', 'Eritrea', 'Ethiopia', 'Kenya', 'Madagascar', 'Malawi',
      'Mauritius', 'Mozambique', 'Rwanda', 'Seychelles', 'Somalia', 'South Sudan', 'Tanzania',
      'Uganda', 'Zambia', 'Zimbabwe',
    ],
  },
  {
    region: 'Southern Africa',
    countries: ['Angola', 'Botswana', 'Eswatini', 'Lesotho', 'Namibia', 'South Africa'],
  },
];

/** How many states `AFRICAN_COUNTRIES` holds. Derived, so a list edited by hand cannot disagree with its own total. */
export const AFRICAN_COUNTRY_COUNT = AFRICAN_COUNTRIES.reduce((total, r) => total + r.countries.length, 0);

/**
 * THE ONE MARKET-DAY ANCHOR IN THIS REPOSITORY, IN THE WORDS A READER READS.
 *
 * The arithmetic is the design's own: `apps/ozikoro/public/design/market-days.js` sets
 * `Date.UTC(2026, 0, 1)` to index 1 of `["Eke", "Orie", "Afọ", "Nkwọ"]` — **1 January 2026 is Orie** — and
 * repeats the four-day cycle from there. **Nothing here computes a second time**; this constant is only the
 * basis sentence, and it is exported so that `/igbo-calendar/`, `/market-days/` and the cultural calendar's
 * compact stamp all state the same anchor. A copied sentence is a second place to be wrong.
 *
 * It is a DEMONSTRATION, and the words say so: the anchor is this archive's, not a universal one, and a town
 * that keeps a different anchor keeps a different market day.
 */
export const MARKET_DAY_ANCHOR = '1 January 2026 taken as Orie, repeating the four-day cycle';

/**
 * The Country selector's options, in the design's own markup.
 *
 * `<optgroup>` is the correct element for a grouped `<select>` and it is not a change of substance: **the
 * groups are the same five regions the Region control beside it offers, so the two controls now describe one
 * continent rather than two different ones.**
 */
export function countryOptions(): string {
  const groups = AFRICAN_COUNTRIES.map(
    (r) =>
      `<optgroup label="${esc(r.region)}">` +
      r.countries.map((c) => `<option>${esc(c)}</option>`).join('') +
      `</optgroup>`
  ).join('');
  return `<option>All countries</option>${groups}`;
}

/**
 * The Country selector in place, found by the design's own `<span>Country</span>` label.
 *
 * **Anchored to the label rather than to "the second `<select>`"**, because a filter added to the design
 * would otherwise move the country list onto the wrong control — and a wrong list is worse than none, since
 * it looks like an answer.
 */
function fillCountryOptions(html: string): string {
  const pattern =
    /(<label>\s*<span>Country<\/span>\s*<select[^>]*>)[\s\S]*?(<\/select>\s*<\/label>)/;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, `$1${countryOptions()}$2`);
}

/**
 * `/cultural-calendar/` and `/cultural-event/` — the African cultural calendar.
 *
 * **There is no event table.** The only `%event%` tables in the schema are `learn_xp_event` and
 * `spotify_event`, which belong to the Academy and to Spotify, so the archive holds no event, no organiser and
 * no verification status. Measured: 0.
 *
 * A wrong date in a calendar is a reader travelling on the wrong day, so nothing is invented here of all places.
 *
 * ============================================================================================
 * THE FILL THAT DELETED THE SCREEN, AND WHAT IT DELETED
 * ============================================================================================
 *
 * The first version of this function ended with:
 *
 *     fillContainer(out, /<div class="sx-event-layout"[^>]*>/, '<p class="small muted">The archive holds 0 events…</p>')
 *
 * `fillContainer` replaces a container's WHOLE CONTENTS, matched by depth. `.sx-event-layout` is the container
 * **that holds the calendar grid AND the selected-date panel** — the whole interactive body of the screen. So
 * the fill that was written to say "the archive holds 0 events" also deleted:
 *
 *   `.sx-cultural-grid`     the month grid, its weekdays and its 28 day cells
 *   `.sx-event-day-panel`   the panel the design's own script fills, with `data-event-*` hooks the script
 *                           looks for and gives up on when they are absent
 *   the panel's three       "Read event story", "Submit an event", "Suggest a correction" — the screen's
 *   affordances             ACTUAL affordances, deleted with the demonstration event they sat beside
 *
 * **That is why four strings the design draws were missing from the served page while the served page's size
 * fell by 1,572 bytes.** It was not the banner removal: `clearExampleMaterial` takes the design's
 * `example-flag` paragraph and nothing else. The banner and the affordances went in the same pass because one
 * `fillContainer` call took a region rather than a value.
 *
 * WHAT REPLACES IT
 *
 * The container stays, the frame stays, and **only the contents that were the design's example become the
 * archive's real state**:
 *
 *   the grid        rebuilt as plain day cells for the real current month — blanks for the days before the
 *                   1st so the columns still line up under `Mon`–`Sun`, then one numbered cell per day. **No
 *                   `has-event`, no `data-event-*`, no `small` count**: with 0 events there is no date to
 *                   highlight and nothing to click, which is the design's own non-interactive state.
 *   the panel       keeps every `data-event-*` hook the script needs, and says in HTML — not only after the
 *                   script runs — that no event is recorded. A reader without JavaScript must not be shown
 *                   "Choose a highlighted date".
 *   the affordances "Read event story" stays a link and is pointed at `/cultural-event/`, which is a real
 *                   page that states there is no event. **"Submit an event" and "Suggest a correction" cannot
 *                   honestly work** — the archive has no submission route (`/submit/` is a signed-in
 *                   publication deposit that redirects an anonymous reader to sign in, and no account has
 *                   ever been created), so they are kept, made inert, and say so, exactly as `/donate/` and
 *                   `/sponsors/` keep an unbuilt form and disable it instead of deleting it.
 *   the note        "Only dates with event entries are interactive." is kept as the RULE and not replaced by a
 *                   statement about today, because it is the sentence that explains the calendar's whole
 *                   interaction model to a reader who arrives in a month that has events.
 *   the selector    the countries of Africa, all 54, grouped by the region the Region control beside it uses.
 */
export function fillCulturalCalendar(
  html: string,
  month: {
    label: string;
    year: number;
    /** The month as 1–12, so the grid is drawn for the month the page NAMES rather than for the wall clock. */
    monthIndex: number;
    events: number;
    /*
     * THERE WAS AN `anchor` HERE, AND IT IS GONE WITH THE SENTENCE IT WROTE.
     *
     * It existed only to state the market-day basis in the `sx-source-note` beside the stamp, and the owner
     * asked for that paragraph to be removed from this page. **A field nothing reads is a field that says the
     * page states its anchor when it does not**, which is why it is deleted rather than left in place; the
     * anchor itself is stated in full where the reckoning lives, on `/igbo-calendar/` and `/market-days/`.
     */
  }
): string {
  let out = clearExampleMaterial(html);

  /* ------------------------------------------------------------------ the month, stated honestly. */
  const monthLine = `${esc(month.label)} ${month.year} · ${month.events === 0 ? 'no verified event' : `${n(month.events)} verified ${month.events === 1 ? 'event' : 'events'}`}`;
  out = out.replace(/October 2026 · demonstration month/, monthLine);
  /* The panel's own `<time>`, which the design heads with the example month. Left alone it would tell a
     reader that the selected date is October 2026 while the grid above it draws this month. */
  out = out.replace(/(<aside class="sx-event-day-panel"[\s\S]*?<time>)[\s\S]*?(<\/time>)/, `$1${monthLine}$2`);

  /* ------------------------------------------------------------------ the grid: plain days, no event. */
  /*
   * THE GRID IS DRAWN FOR THE MONTH THE HEADING NAMES, WHICH IS WHY `monthIndex` IS PASSED RATHER THAN READ.
   *
   * The first version of this grid took the month from the wall clock while the heading took it from the
   * route's own argument. **They are the same value today and would drift the moment either changed** — a page
   * headed "October 2026" over a grid of November's days, where the 31st falls on a different weekday and a
   * reader planning around it is a day out. One argument now draws both.
   */
  const firstOfMonth = new Date(Date.UTC(month.year, month.monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(month.year, month.monthIndex, 0)).getUTCDate();
  // The design's week runs `Mon`…`Sun`, so the blank count is the weekday index with Monday as 0.
  const mondayIndex = (firstOfMonth.getUTCDay() + 6) % 7;
  const blanks = Array.from({ length: mondayIndex }, () => '<div class="sx-cultural-day is-empty" aria-hidden="true"></div>');
  /*
   * ================================================================================================
   * THE IGBO MARKET DAY ON EVERY DATE, AND WHY IT IS NOT COMPUTED HERE
   * ================================================================================================
   *
   * The owner asked for it in the page's own terms: *"the events by date calendar doesn't have the igbo
   * market days written on it."* The month grid is his "Events by date", every one of its cells is a plain
   * date, and what he wants on each of them is `Eke`, `Orie`, `Afọ` or `Nkwọ`.
   *
   * **That cycle is not stated twice in this repository.** `public/design/market-days.js` holds the one
   * reckoning — `["Eke","Orie","Afọ","Nkwọ"]`, anchored at `Date.UTC(2026, 0, 1)` with index 1, which is the
   * sentence `MARKET_DAY_ANCHOR` puts on the page — and `/igbo-calendar/` and `/market-days/` show it because
   * that script draws their cells. **A second reckoning in TypeScript would agree with it today and part from
   * it the first time either the anchor or the cycle changed**, and the two pages would then give one date two
   * different market days. So the fill states the MONTH and nothing else: each cell declares that it wants the
   * day, and the design's own `marketDay()` is what fills it.
   *
   * THE MARKER IS THE MONTH BECAUSE THE CELLS ARE THE MONTH, IN ORDER. Three blanks line the 1st up under the
   * `Mon`–`Sun` headings the design draws, so the cell's position IS its day number and no cell needs to carry
   * its own date — `Date.UTC(2026, 9, 0)` is the 1st of October, `Date.UTC(2026, 9, 70)` is its 31st, and both
   * fall out of the marker rather than out of any arithmetic here. **The marker is written on the grid by the
   * same `monthIndex` that draws the cells**, which is what keeps rule 3 true: the month the heading names, the
   * month the panel names and the month whose market days are stamped are one value read in three places.
   *
   * THE HOOK IS `data-market-day-cell`, AND IT IS NOT `data-market-day`. That shorter name is what the compact
   * stamp above the grid uses, and `market-days.js` sets every `[data-market-day]` to TODAY — a grid of
   * thirty-one cells all reading today's day is exactly the mismatch this avoids. `data-market-day-cell` is
   * read by the one extension in `extendMarketDaysScript`, and by nothing else.
   *
   * **AND NOTHING HERE CLAIMS AN EVENT.** The cell keeps its design class, gains the hook, and gains no
   * `has-event` — the CSS reads that class as "this day has an event" and the archive holds 0 events, which
   * the note below the grid still says in the page's own words.
   *
   * ================================================================================================
   * BUT EVERY DATE IS A CONTROL AGAIN, WHICH IS THE FAULT THIS PASS EXISTS TO REPAIR
   * ================================================================================================
   *
   * The owner reported it in his own terms: *"why is the events that is clickable not showing there anymore?
   * you added the market days, then removed the functions of the calendar. it is supposed to be showing, and
   * when clicked, you see the events, and the entire thing that was originally built there."*
   *
   * **He is right about the cause.** The round that added the market-day stamp also rebuilt this grid as
   * `<div class="sx-cultural-day"><span>4</span></div>` — a plain date with no control in it. Before that pass
   * the grid was the design's own markup, and the design's own markup is four `has-event` days each holding a
   * `<button type="button" data-event-date=…>` — **which is exactly what `cultural-calendar.js` binds to.**
   * `const buttons = [...document.querySelectorAll('[data-event-date]')]` finds nothing in a grid of `div`s,
   * `buttons.forEach(...)` therefore registers no listener at all, and `if (buttons[0]) selectDay(buttons[0])`
   * never runs. That is the whole of it: a script that finds nothing to bind to is silent, the page stays 200,
   * and the markup that replaced the control looks deliberate.
   *
   * **WHAT IS RESTORED IS THE CONTROL, NOT THE DEMONSTRATION.** The design's four example events — "Verified
   * event title appears here", "Community-submitted event", "2 events" — were never records and are not
   * coming back; the archive holds no event table and 0 events, and inventing one here of all places is what
   * this file forbids. So every date of the real month is a real button, and the data it carries is the truth
   * about that date: the date itself, and, in each of the four slots the design's script fills the panel from,
   * the statement that no event is recorded for it. Choose the 4th and the panel says so for the 4th; choose
   * the 19th and it says so for the 19th. **The control works and the content is empty, which is the state the
   * archive is actually in.**
   *
   * WHY `<button>` AND NOT A CLICK HANDLER ON THE CELL. A `div` with a listener cannot be reached by keyboard
   * and is not announced as a control, and the design's own event cells were buttons for that reason. The
   * button is the design's element in the design's position, so nothing about the interaction is new — only
   * what it says.
   *
   * AND `data-event-date` IS THE DESIGN'S OWN HOOK, not one invented here: it is the attribute the served
   * `cultural-calendar.js` queries for and the one it builds `?date=` from for the event page. Reusing it is
   * what makes the design's script run unmodified — **the deliverable is inviolable, so the served markup has
   * to meet it where it already is.**
   */
  const marketMonth = `${month.year}-${String(month.monthIndex).padStart(2, '0')}`;
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const date = `${marketMonth}-${String(day).padStart(2, '0')}`;
    const spoken = `${day} ${month.label} ${month.year}`;
    /*
     * THE FOUR DATA SLOTS ARE THE PANEL'S OWN, IN THE PANEL'S OWN ORDER OF USE. `data-title` becomes the
     * panel's heading, `data-status` its badge, `data-meta` its place line and `data-description` its body;
     * each is the honest sentence for THIS date rather than the month, because a date is what the reader
     * chose. **None of them says an event exists, and none of them is a placeholder.**
     */
    return `<div class="sx-cultural-day" data-market-day-cell><button type="button" data-event-date="${date}" data-title="No event is recorded for ${esc(spoken)}" data-status="No event recorded" data-meta="No organiser, place or verification date is recorded for ${esc(spoken)}" data-description="The archive holds no event for this date, and nothing has been invented to fill it. An event appears here once its organiser, place and source are recorded and verified." aria-pressed="false"><span>${day}</span></button></div>`;
  });
  /*
   * ================================================================================================
   * AND THE SMALL CORNER OF STYLE THAT KEEPS A PLAIN DATE FROM WEARING AN EVENT'S FACE
   * ================================================================================================
   *
   * **The design's own rule paints EVERY button inside a day cell `var(--gold-bright)`** —
   * `.sx-cultural-day button{…background:var(--gold-bright);color:var(--night)…}` — because in the design the
   * only button a day cell ever held was a day WITH an event. Now that every date is a control, the design's
   * rule would paint all thirty-one cells gold, and **gold is the page's own word for "this date has an
   * event"** — the intro sentence beside the grid says so. A grid of gold cells over a panel reading "no
   * event recorded" is a page contradicting itself in the first thing a reader sees.
   *
   * So the button keeps the design's geometry — its padding, its `display:flex`, its size, its full-width
   * fill — and takes the cream the plain cell already had, with the date and its market day in the same muted
   * token the design uses for a plain date's number. **What is left of the gold is the interaction state**:
   * hover, keyboard focus and the selected date all keep the design's emerald, because `.is-selected` and
   * `:focus-visible` are the design's own words for "this is the date you chose".
   *
   * THE SELECTORS ARE SCOPED TO THE FILL'S OWN MARKER, `.sx-cultural-day[data-market-day-cell]`, so a cell the
   * design draws with an event in it — none today, and the day the archive has one — is untouched and keeps
   * its gold. **They also have to be more specific than the design's own rules, and they are**: the design's
   * `.sx-cultural-day button` is one class and an element, this is a class, an attribute and an element. The
   * hover and selected rules are written out again here rather than left to the design's, because the design's
   * `.sx-cultural-day.is-selected button` is LESS specific than the base rule above and would otherwise lose
   * to it — a selected date that never changes colour is the fault that would have followed.
   *
   * THE TYPE SCALE IS THE DESIGN'S: the number drops from the event button's bold serif to the plain date's
   * own step, and the market day is `1em`-relative so a change to the design's base size moves both together.
   */
  const dayStyle = `<style>
      .sx-cultural-day[data-market-day-cell]{padding:0}
      .sx-cultural-day[data-market-day-cell] button{background:var(--paper-raised);color:var(--text);justify-content:flex-start;gap:.35em}
      .sx-cultural-day[data-market-day-cell] button>span{font:400 1rem/1.2 var(--font-serif);color:var(--text-muted)}
      .sx-cultural-day[data-market-day-cell] button>.sx-cal-market-day{font-size:.78em;font-weight:400;text-transform:none;line-height:1.2;color:var(--text-muted)}
      .sx-cultural-day[data-market-day-cell] button:hover,
      .sx-cultural-day[data-market-day-cell] button:focus-visible,
      .sx-cultural-day[data-market-day-cell].is-selected button{background:var(--emerald);color:var(--on-night)}
      .sx-cultural-day[data-market-day-cell] button:hover>span,
      .sx-cultural-day[data-market-day-cell] button:focus-visible>span,
      .sx-cultural-day[data-market-day-cell].is-selected button>span{color:var(--on-night)}
    </style>`;
  /*
   * THE GRID'S OWN `aria-label` IS RE-DATED TOO. The design writes `aria-label="October 2026 cultural events
   * calendar"`; left alone over another month it is an accessible name that contradicts the grid it names.
   */
  out = out.replace(/(<div class="sx-cultural-grid"[^>]*aria-label=")[^"]*(")/, `$1${esc(month.label)} ${month.year} cultural events calendar$2`);
  /*
   * THE MARKER GOES ON AFTER THE ARIA LABEL IS RE-DATED, SO THAT IT LANDS IN THE SAME TAG. It is read by the
   * market-day extension and by nothing else; a screen whose grid carried no marker is left unmarked rather
   * than guessed at, and the extension stamps nothing.
   */
  out = out.replace(
    /(<div class="sx-cultural-grid"[^>]*)(>)/,
    `$1 data-market-month="${marketMonth}"$2`
  );
  out = fillContainer(out, /<div class="sx-cultural-grid"[^>]*>/, [...blanks, ...days].join(''));
  /*
   * THE STYLE GOES IN AFTER THE CELLS, AND THAT ORDER IS THE WHOLE OF ITS PLACEMENT. `fillContainer` replaces
   * everything between the grid's opening tag and its close, so a block written into that container before the
   * call is deleted by it — and the rule then styles a page whose cells have no spacing, which is the state
   * this block exists to correct. Nearby, so the rule and the markup it is about are read together.
   */
  out = out.replace(/(<div class="sx-cultural-grid"[^>]*>)/, `$1${dayStyle}`);

  /* ------------------------------------------------------------------ the panel, filled in HTML. */
  /*
   * EVERY `data-event-*` HOOK STAYS. `cultural-calendar.js` looks for `data-event-title`, `data-event-status`,
   * `data-event-meta`, `data-event-description` and `data-event-story`, and returns early when any of the first
   * four is absent — **so deleting the panel would have left the script with nothing to find, and keeping the
   * hooks is what lets the same markup start working the day an event exists.**
   */
  if (month.events === 0) {
    /*
     * THE PANEL KEEPS THE DESIGN'S OWN HEADING AND SAYS THE ABSENCE IN THE TWO PLACES BUILT FOR IT.
     *
     * This rewrote the `<h2>` itself to "No event is recorded", which read honestly and **cost the page a
     * heading the design draws** — `check-design-parity.mjs` reported *"/cultural-calendar — missing h2
     * 'choose a highlighted date'"*. The heading is the panel's accessible name for a control a reader does
     * use — select a date — and the design puts the standing of the selected date in the badge and the
     * description, which is where an event's verification state lives too. So the heading stays as delivered
     * and the honest state is stated in the badge, the meta line and the description, all three of which the
     * design provides and the archive fills.
     */
    out = out.replace(
      /(<span class="sx-event-badge" data-event-status>)[\s\S]*?(<\/span>)/,
      '$1No date has an event$2'
    );
    out = out.replace(
      /(<p class="sx-event-meta" data-event-meta>)[\s\S]*?(<\/p>)/,
      '$1No organiser, place or verification date is recorded for any date this month$2'
    );
    out = out.replace(
      /(<p data-event-description>)[\s\S]*?(<\/p>)/,
      '$1The archive holds no event for any date this month. Choose a date above and this panel states what is recorded for it — which today is nothing, because no event has an organiser, a place and a source behind it. Nothing has been invented to fill the calendar.$2'
    );
  } else {
    out = out.replace(
      /(<p data-event-description>)[\s\S]*?(<\/p>)/,
      '$1Choose a highlighted date to see its organiser, place and verification status.$2'
    );
  }

  /* ------------------------------------------------------------------ the three affordances. */
  /*
   * "READ EVENT STORY" IS POINTED AT THE PAGE THAT ANSWERS IT, AND STAYS A LINK.
   *
   * `cultural-event.html` becomes `/cultural-event/`, which is served and states plainly that no event is
   * recorded. **The screen keeps its promise and the destination keeps its honesty.**
   *
   * ================================================================================================
   * AND IT HAS TO MATCH BOTH SPELLINGS, WHICH IS A FAULT THIS PASS FOUND RATHER THAN ANTICIPATED
   * ================================================================================================
   *
   * `designScreenLinks` is called on the raw design file near the top of the request, before any fill runs,
   * and its own last rule rewrites every sibling `…​.html` address to the address this site serves:
   * `href="upload.html"` becomes `href="/upload/"`, `href="cultural-event.html"` becomes
   * `href="/cultural-event/"`. **So by the time this function sees the panel, the `href="upload.html"` these
   * three patterns were written against is not there any more and none of them matched.**
   *
   * Measured on the served page before this was fixed: `Submit an event` and `Suggest a correction` were
   * ordinary `<a href="/upload/">` links — not inert, not announced as unavailable, and pointing at the
   * publication-deposit screen the design pointed them at — while the offline unit test, which calls this
   * fill on the raw design file with no link pass in front of it, **passed**. The test agreed with the code
   * and the page did not, which is the shape of fault this file records more than once.
   *
   * The patterns therefore accept either spelling, and the safe one is the one the route actually produces.
   * They are left order-independent rather than reordered so that this fill does not depend on being called
   * before or after the link pass — a dependency on call order is what broke it.
   */
  out = out.replace(
    /<a class="btn btn-gold" data-event-story href="(?:cultural-event\.html|\/cultural-event\/)">Read event story<\/a>/,
    '<a class="btn btn-gold" data-event-story href="/cultural-event/">Read event story</a>'
  );
  /*
   * "SUBMIT AN EVENT" AND "SUGGEST A CORRECTION" CANNOT HONESTLY WORK, SO THEY SAY SO.
   *
   * Neither has a route behind it: the design points both at `upload.html`, which is the publication-deposit
   * screen, and `/submit/` — the application's own submit route — **redirects an anonymous reader to sign in
   * and no account has ever been created.** Removing the two controls would take the design's structure with
   * it and leave a reader unable to see what the screen is for; leaving them as links would send them to a
   * page that cannot do what its label promised. So they are kept, made inert with `aria-disabled` and a
   * title saying why, **exactly as `/donate/` keeps its form and disables it rather than deleting it** — and
   * the note below them says the same thing in the page's own words, for the reader who does not hover.
   */
  out = out.replace(
    /<a class="btn" href="(?:upload\.html|\/upload\/)">Submit an event<\/a>/,
    '<a class="btn" aria-disabled="true" style="color:var(--on-night-muted);opacity:.8" title="Not built yet — no route on this site accepts an event submission">Submit an event</a>'
  );
  out = out.replace(
    /<a class="btn btn-quiet" href="(?:upload\.html|\/upload\/)">Suggest a correction<\/a>/,
    '<a class="btn btn-quiet" aria-disabled="true" style="color:var(--on-night-muted);opacity:.8" title="Not built yet — no route on this site accepts a correction">Suggest a correction</a>'
  );
  /*
   * THE COLOUR IS SET BECAUSE LOSING THE `href` TOOK THE CONTRAST WITH IT.
   *
   * `Suggest a correction` carries `btn btn-quiet`, and the panel's own rule colours a quiet button's text
   * with the page's DARK ink — legible over the gold or cream it was drawn on. On this panel the background is
   * dark green, and **measured in the browser the label rendered `rgb(29,26,22)` on a dark panel: a contrast
   * ratio of 1.13:1, which is text nobody can read.** It was invisible in the screenshot, which is how it was
   * found.
   *
   * `var(--on-night-muted)` is the design's own token for exactly this surface — the same colour its
   * `.sx-source-note` uses on the same panel — and it measures 6.7:1 against it. `opacity: .8` is what makes
   * the control read as unavailable rather than as an ordinary button; the label stays above the 4.5:1
   * minimum that way. **The design's stylesheet is not touched: this is an inline corner of the served page.**
   */
  /*
   * AND WHAT WOULD MAKE THEM WORK, IN THE PANEL RATHER THAN IN A TOOLTIP.
   *
   * A `title` is invisible to a touch reader, and this archive's audience is largely on a phone. **The two
   * controls keep their design classes and lose only their `href`, and the sentence beside them carries the
   * whole state**: no submission route exists, and a submission is a publication workflow rather than an
   * anonymous listing — which is what the archive's own `/submit/` screen is for, and it is gated.
   */
  if (month.events === 0) {
    out = out.replace(
      /(<div class="row"><a class="btn btn-gold" data-event-story[^>]*>Read event story<\/a><a class="btn" aria-disabled="true"[^>]*>Submit an event<\/a><a class="btn btn-quiet" aria-disabled="true"[^>]*>Suggest a correction<\/a>)<\/div>/,
      `$1</div><p class="small muted" style="margin-top:var(--s-3)">An event reaches this calendar only through an editor: it is submitted with its organiser, place, date and source, and published once that source has been checked. <strong>No submission route exists on this site yet</strong>, so the two controls beside &ldquo;Read event story&rdquo; do nothing and say so. Nothing here is a place to send a claim about a date.</p>`
    );
  }

  /* ------------------------------------------------------------------ the interaction rule, kept. */
  /*
   * THE SENTENCE THAT EXPLAINS THE SCREEN, AND WHAT IT HAS TO SAY NOW THAT EVERY DATE IS A CONTROL.
   *
   * The design's rule is *"Only dates with event entries are interactive."* — and the round that removed the
   * event buttons left the rule standing while making it TRUE of nothing, with a second sentence after it
   * ("every date above is a plain date") that described the deleted control as though it were the design's
   * intent. **The restored control makes the rule false**: every date above is interactive now, and a page
   * that says otherwise is the contradiction this whole pass exists to remove.
   *
   * So the rule becomes the rule the page actually keeps: every date can be chosen, and what the panel says
   * depends on whether an event is recorded for it. The second sentence states this month's answer, which is
   * that none has one — and the design's own closing clause about production events is left exactly where the
   * design wrote it, after both.
   */
  out = out.replace(
    /Only dates with event entries are interactive\./,
    month.events === 0
      ? 'Every date above can be chosen, and the panel says what the archive holds for the date you choose. No date in this month has an event recorded.'
      : 'Every date above can be chosen. A date with no event entry says so when you choose it.'
  );

  /* ------------------------------------------------------------------ the intro's own rule. */
  /*
   * THE SENTENCE ABOVE THE GRID, WHICH THE FILL HAD LEFT ALONE AND WHICH THE RESTORED CONTROL MAKES FALSE.
   *
   * The design writes *"Gold dates have events. Plain dates are not clickable."* — **and that was true of the
   * grid this fill drew in the round that removed the buttons.** With the buttons restored, the second half is
   * false in the other direction: every plain date is clickable, and a reader told otherwise will not try.
   * It is replaced rather than deleted, because the first half is the legend for the page's own colour and a
   * reader still needs it the day a month has an event in it.
   */
  out = out.replace(
    /<p>Gold dates have events\. Plain dates are not clickable\.<\/p>/,
    month.events === 0
      ? '<p>No date this month has an event. Every date can still be chosen, and the panel says what the archive holds for the date you choose.</p>'
      : '<p>Gold dates have events. Every date can be chosen; a date with no event says so.</p>'
  );

  /* ------------------------------------------------------------------ the country list. */
  out = fillCountryOptions(out);

  /* ------------------------------------------------------------------ today's market day, small. */
  /*
   * THE OWNER ASKED FOR THE IGBO MARKET DAY ON THE CALENDARS, AND SMALL.
   *
   * His words: *"can you add igbo market day on the calendars? i mean, make it smaller at the top, or anywhere
   * that will make it fit into the design of the event calendar"*. So it goes after the hero and before "Events
   * by date" — **context for the month rather than a competitor to it** — and it uses the design's own pieces:
   * `spread` for the baseline row, `sx-source-note` for the quiet note, and `small muted` for the type.
   *
   * ============================================================================================
   * THE RECKONING IS NOT COMPUTED HERE, AND THAT IS THE POINT
   * ============================================================================================
   *
   * `market-days.js` already computes it, and the two elements below carry the hooks it looks for:
   *
   *     document.querySelectorAll("[data-market-day]").forEach(el => el.textContent = marketDay(today));
   *     document.querySelectorAll("[data-modern-date]").forEach(el => el.textContent = fmt.format(today));
   *
   * **A second implementation in TypeScript would be a second reckoning of one cycle**, and two reckonings
   * drift — the page states its anchor in one place, so the number must come from the one place too.
   *
   * WHAT IS ADDED IS THE SCRIPT TAG, BECAUSE THE DESIGN'S CULTURAL CALENDAR DOES NOT LOAD IT. Measured:
   * `cultural-calendar.html` loads `../cultural-calendar.js` and `../mobile-nav.js` and **not**
   * `../market-days.js`, so without this line the two spans would render empty and a reader would see the
   * label and no day. The route rewrites a `src="../name.js"` to `/design/name.js`, the same pass that fixed
   * every other screen's scripts.
   *
   * WHAT IT SAYS, AND WHY THE FIRST VERSION OF THIS SENTENCE WAS WRONG
   *
   * A stamp reading "Nkwọ" over today's date reads as a fact about the reader's own town, and it is not one:
   * **a community that keeps a different anchor keeps a different market day.** That fact is true and it is
   * stated on the two pages that do the reckoning; what the owner objected to here was its SHAPE, in his own
   * words: *"why is this 'A demonstration
   * reckoning from a fixed anchor — 1 January 2026 taken as Orie, repeating the four-day cycle — not a claim
   * that every Igbo community uses the same one. The Igbo calendar states the basis in full.' there? fix."*
   *
   * **Every clause of that sentence is about the build rather than about the calendar.** "A demonstration
   * reckoning" is the archive describing its own prototype; "not a claim that…" is a disclaimer attached to
   * the page's own work; and "states the basis in full" is a remark about the contents of another page. A
   * reader who came to find out which day it is learns nothing from any of the three, and the same objection
   * was upheld against five sentences of this class on `/about/` an hour before this one was reported.
   *
   * ── AND THEN THE WHOLE NOTE GOES, ON THE OWNER'S INSTRUCTION ──────────────────────────────────────
   *
   * The sentence above was rewritten once and the owner objected to it a second time and to its presence
   * rather than its wording: *"why is this on the cultural calendar page? Please remove!"* — quoting
   * *"The four-day cycle is kept from different anchors … The Igbo calendar sets out the cycle and the sources
   * behind this account."* **So the paragraph is not written at all.** This is a cultural-events page; the
   * market-day stamp on it is a small aside, and the aside had grown a methodology note about a reckoning
   * this page does not otherwise use.
   *
   * **WHAT THAT COSTS, RECORDED RATHER THAN HIDDEN.** The note was the only place on `/cultural-calendar/`
   * that stated the anchor, and it carried the only link from here to `/igbo-calendar/`. So the stamp now
   * prints a market day over today's date with **nothing on the page saying which anchor reckons it** — and
   * the reckoning, and the fact that communities keep different ones, is stated where the reckoning is:
   * `/igbo-calendar/` and `/market-days/`. **Nothing was invented to replace the note**, and nothing was
   * quietly moved into another slot to keep the anchor on this page; that is the owner's instruction carried
   * out, and the absence is written here so the next person finds the reasoning rather than a gap.
   */
  const marketDay = `
      <aside class="wrap" style="margin-top:var(--s-6)">
        <div class="spread" style="gap:var(--s-3)">
          <p class="eyebrow" style="margin:0">Today&rsquo;s Igbo market day</p>
          <p style="margin:0"><strong data-market-day>Market day</strong><span class="small muted"> · <time data-modern-date>Today</time></span></p>
        </div>
      </aside>`;
  /*
   * INSERTED AFTER THE HERO, FOUND BY ITS OWN CLASS. A page without the hero is left alone rather than
   * guessed at, and the block is never inserted twice.
   *
   * THE TEST IS FOR THE HOOK AND NOT FOR THE FIRST TWELVE CHARACTERS OF IT, WHICH IS A FAULT THIS PASS MADE.
   * The guard used to be `!out.includes('data-market-day')`, and the month grid's own cells are
   * `data-market-day-cell` — **so the day the cells gained their hook, this stamp stopped being inserted at
   * all**, and the page lost the sentence that states the anchor. A prefix match on an attribute name is not a
   * test for that attribute, so this one requires the name to end where an attribute name ends, and it counts
   * the hook rather than asking whether the page mentions it.
   */
  const hookCount = (out.match(/[\s"']data-market-day(?![\w-])/g) ?? []).length;
  if (hookCount === 0) {
    out = out.replace(/(<\/section>\s*<section class="wrap section" id="calendar">)/, `$1${marketDay}`);
  }
  /*
   * AND THE SCRIPT THAT FILLS IT, AT THE ADDRESS THE SITE ACTUALLY SERVES IT FROM.
   *
   * **THE PATH IS ABSOLUTE, AND THAT IS THE WHOLE POINT OF THIS COMMENT.** The route rewrites
   * `src="../name.js"` to `/design/name.js` — but it does so **before** this fill runs, so a tag inserted
   * here keeps its relative form. With the design's `<head>` replaced by the SEO head there is no
   * `<base href="/">` either, so `../market-days.js` on a page served at `/cultural-calendar/` resolves to
   * `/market-days.js` and 404s. **The first version of this insertion did exactly that**, and the browser
   * check is what caught it: the stamp rendered "Market day · Today" — the placeholders — while every byte
   * of the markup and the script tag was present. The file lives at `/design/market-days.js`, and the site
   * serves it there, measured 200.
   *
   * **Inserted once**: a page that already loads `market-days.js` keeps its own tag.
   */
  if (!/src="[^"]*market-days\.js"/.test(out)) {
    out = out.replace(/(<script src="[^"]*cultural-calendar\.js" defer><\/script>)/, `<script src="/design/market-days.js" defer></script>$1`);
  }
  return out;
}

/** One event page, which cannot be anything but empty. */
export function fillCulturalEvent(html: string): string {
  let out = clearExampleMaterial(html);
  /*
   * THE HERO, WHICH CARRIED THE DESIGN'S EXAMPLE EVENT.
   *
   * The h1 reads "Verified event title appears here" and the standfirst reads "A clear introduction to the
   * event… will appear here after verification". Filling the reading column below left BOTH of them on the
   * page, above an honest notice — **which is worse than not filling it, because the page then contradicts
   * itself in the first line a reader reads.** The hero is replaced with the state itself.
   */
  out = out.replace(
    /(<section class="sx-event-story-hero">[\s\S]*?)<p class="eyebrow"[^>]*>[\s\S]*?<\/p>\s*<h1[^>]*>[\s\S]*?<\/h1>\s*<p class="lede"[^>]*>[\s\S]*?<\/p>/,
    '$1<p class="eyebrow">Cultural event</p><h1>No event is recorded</h1><p class="lede">The archive holds no event record, so there is no date, place, organiser or story to show here. Nothing has been invented to fill it.</p>'
  );
  /*
   * And the reading column's own opening line, which describes the page rather than an event.
   */
  out = out.replace(
    /<p>This page demonstrates how a calendar event can open into a full Ozikoro story[^<]*<\/p>/,
    '<p>An event story opens from the calendar: it names the organiser, the place and the source, gives the programme and its cultural context, states when it was verified, and offers a visible path for a community correction. None of that exists for any date yet.</p>'
  );
  out = fillContainer(
    out,
    /<div class="sx-event-reading"[^>]*>/,
    `<div class="sx-notice">No event is recorded in the archive, so this page has no event story to tell. The design drew one here with a title, a date, a place, an organiser and an &ldquo;example record&rdquo; label — <strong>none of it is carried over, because none of it is a record.</strong></div>
        <p class="small muted" style="margin-top:var(--s-5);max-width:70ch">An event story will name its organiser, place and source, give its programme and cultural context, state when it was verified, and offer a visible path for a community correction. The archive holds 0 events today.</p>
        <p class="small muted" style="margin-top:var(--s-4)"><a href="cultural-calendar.html">&larr; African Cultural Calendar</a></p>`
  );
  return out;
}

/**
 * Make each month of the year grid open and close.
 *
 * WHAT THE DESIGN DOES, AND WHAT WAS MISSING
 *
 * `renderYear()` builds twelve `<article>` cards into the element the design gives the year grid, one card per
 * Gregorian month, each holding a `<h3>` with the month's name and a `<div>` of day cells. The owner asked for
 * a full-year calendar *"which you can easily click and it will expand"*, and **the grid is already where a
 * year's worth of the cycle lives** — so rather than write a second year view, each card becomes a native
 * `<details>` element. That brings the expansion, the keyboard behaviour and the open and closed state with
 * it; none of the three needs script of its own.
 *
 * WHY THE BUILDER IS REPLACED RATHER THAN WRAPPED AFTERWARDS
 *
 * The obvious approach is to leave `renderYear()` alone and wrap its output in a second pass. `renderYear()` is
 * written as ONE LINE though, and five attempts to splice a call into that line all put it in the wrong place:
 * after the function's closing brace it runs before the grid exists, before the `for`'s brace it runs once per
 * month, and a miscounted brace does not parse at all. **Every one of those left the served page's markup
 * perfectly correct**, so only running the script or parsing it could tell — which the test now does.
 *
 * So the builder is reconstructed, exactly as the design wrote it — same anchor, same `Intl` format, same card,
 * same day span with `data-market` — with the card append wrapped. **The reckoning is untouched:** `marketDay`,
 * the anchor and the four-day cycle are the design's, and this function only changes what the card is made of.
 *
 * WHY IT IS IDEMPOTENT AND WHY IT REFUSES RATHER THAN GUESSES
 *
 * The route reads the design's file per request, so a second pass must not replace the builder again. And if
 * the builder is not where this extension expects it, the function throws rather than returning a script that
 * half works — the route catches that, serves the design's own script, and logs which screen it was.
 */
const YEAR_BUILDER = '  function renderYear(){if(!yearInput||!yearGrid)return;const year=Math.min(2100,Math.max(1900,Number(yearInput.value)||today.getFullYear()));yearInput.value=year;yearGrid.innerHTML="";for(let month=0;month<12;month++){const card=document.createElement("article"),name=new Intl.DateTimeFormat("en-NG",{month:"long"}).format(new Date(year,month,1)),count=new Date(year,month+1,0).getDate();card.innerHTML=`<h3>${name}</h3><div>${Array.from({length:count},(_,i)=>{const d=new Date(year,month,i+1);return `<span data-market="${marketDay(d)}"><b>${i+1}</b><small>${marketDay(d)}</small></span>`}).join("")}</div>`;yearGrid.appendChild(card)}}';

/**
 * The month grid on `/cultural-calendar/` carries the Igbo market day on every date, and this is the code that
 * puts it there — **beside the design's own reckoning rather than instead of it.**
 *
 * WHAT THE FILL WRITES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * `fillCulturalCalendar` emits one `<div class="sx-cultural-day" data-market-day-cell>` per day of the month and
 * one `data-market-month="YYYY-MM"` on the grid, and it computes **neither the cycle nor any day of it.** Every
 * string a reader sees — `Eke`, `Orie`, `Afọ`, `Nkwọ` — comes from `marketDay()` in
 * `public/design/market-days.js`: the same function, anchored at the same `Date.UTC(2026, 0, 1)` = `Orie`, that
 * `/igbo-calendar/` and `/market-days/` show. **The archive's rule is that a record states what happened, and
 * the way to keep two screens from contradicting each other is to compute one cycle once.**
 *
 * WHY THE MONTH IS READ FROM THE MARKER RATHER THAN FROM THE WALL CLOCK
 *
 * The page's heading and its grid are both drawn for the month `monthIndex` names, which is today's month — but
 * **"today" is a value that moves and the grid is the month the heading names**, and the failure this file has
 * already recorded once is exactly that pair drifting. So the cells' dates come from the marker the fill wrote,
 * which came from the same `monthIndex` that drew the cells: from the marker's own year and month,
 * `Date.UTC(y, m - 1, k)` walks day 1 to day `k`, for every `k`, and the marker is the only date on the page
 * that the stamp can disagree with.
 *
 * WHY IT IS PREPENDED TO THE SCRIPT RATHER THAN APPENDED
 *
 * The script's own three dispatches — the four-day month view, the date lookup and the year grid — all query
 * for elements that exist in the document before the script runs, and this one does the same: the fill's cells
 * are in the served HTML, so they are in the DOM at parse time, and `defer` runs the script after the document
 * is parsed. On `/igbo-calendar/` and `/market-days/` the selector matches nothing, because those grids are
 * built by `render()` and `renderYear()` after this line has already run — which is why their cells are stamped
 * by the builders and not by this.
 *
 * AND IT DOES NOT WRITE THE LABEL ITSELF, SO THE TYPE SCALE IS THE DESIGN'S. It appends a `<small class="muted">`
 * and lets the page's own stylesheet size and colour it; the date is the cell's `<span>`, and the label sits
 * under it as its context. **No `has-event` and no event claim of any kind**: a plain date does not become a
 * claim about an event, and the page still says the archive holds none.
 *
 * ── AND IT GOES INSIDE THE DATE'S BUTTON WHEN THERE IS ONE ───────────────────────────────────────
 *
 * The grid's cells hold a `<button>` now (see `fillCulturalCalendar`), so a label appended to the CELL would
 * land after a control that already fills the cell's whole height — a stray word under every date, and the
 * market day outside the thing a reader presses. The design's own event cell writes its label INSIDE its
 * button (`<button><span>4</span><small>2 events</small></button>`), so the label goes where the design puts
 * it, found by the button rather than assumed: **a cell with no button — `/igbo-calendar/`'s month view, or a
 * grid drawn by a future fill — takes the label itself, exactly as before.**
 *
 * ================================================================================================
 * THE CODE GOES INSIDE THE DESIGN'S OWN IIFE, ON THE LINE AFTER `marketDay` IS DECLARED
 * ================================================================================================
 *
 *
 * **The first version of this appended a second IIFE, in front of the design's** — and it could not see
 * `marketDay` at all, because that function is declared inside the design's closure and a sibling scope cannot
 * reach it. Measured: `ReferenceError: marketDay is not defined`, thrown on load, which would have left the
 * cells blank and **killed every handler the script registers after it** — the lookup form, the month arrows
 * and the year grid with it. So the marker is a line the design wrote, one line is spliced in after it, and the
 * result is a script that parses and runs, which the test now proves by running it rather than by reading it.
 */
const MARKET_CELL_MARKER = 'sx-cal-market-day';
/**
 * The design's own `marketDay` declaration, which is where the splice goes.
 *
 * **It is matched by its declaration rather than by a line number**, and the match is asserted to be unique
 * before anything is spliced: a file where the cycle is declared twice is a file this extension does not
 * understand, and refusing is better than stamping cells from whichever copy happened to come first.
 */
const MARKET_DAY_DECLARATION = '  const marketDay = date => { const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); const delta = Math.round((utc-anchor)/86400000); return days[((anchorIndex+delta)%4+4)%4]; };';
const MARKET_CELL_FILLER = [
  '  const marketCells = document.querySelector("[data-market-month]");',
  '  const marketMarker = marketCells && /^(\\d{4})-(\\d{2})$/.exec(marketCells.getAttribute("data-market-month"));',
  '  if (marketMarker) {',
  '    const marketDays = marketCells.querySelectorAll("[data-market-day-cell]");',
  '    for (let k = 1; k <= marketDays.length; k += 1) {',
  '      const marketDate = new Date(Number(marketMarker[1]), Number(marketMarker[2]) - 1, k);',
  '      const marketLabel = document.createElement("small");',
  `      marketLabel.className = "muted ${MARKET_CELL_MARKER}";`,
  '      marketLabel.textContent = marketDay(marketDate);',
  /* The date's own button when the cell holds one, so the day sits inside the control the reader presses. */
  '      const marketTarget = marketDays[k - 1].querySelector("button") || marketDays[k - 1];',
  '      marketTarget.appendChild(marketLabel);',
  '    }',
  '  }',
  '  /* The Igbo market day on every date the fill drew. */',
].join('\n');

const YEAR_BUILDER_REPLACEMENT = [
  '  function renderYear(){ if(!yearInput||!yearGrid) return;',
  '    const year = Math.min(2100, Math.max(1900, Number(yearInput.value) || today.getFullYear()));',
  '    yearInput.value = year;',
  '    yearGrid.innerHTML = "";',
  '    for (let month = 0; month < 12; month += 1) {',
  '      const card = document.createElement("article");',
  '      const name = new Intl.DateTimeFormat("en-NG", {month:"long"}).format(new Date(year, month, 1));',
  '      const count = new Date(year, month + 1, 0).getDate();',
  '      const days = Array.from({length: count}, (_, i) => {',
  '        const d = new Date(year, month, i + 1);',
  '        return `<span data-market="${marketDay(d)}"><b>${i + 1}</b><small>${marketDay(d)}</small></span>`;',
  '      }).join("");',
  /* The card's own two elements are built before they are moved, so nothing is read from an innerHTML. */
  '      card.innerHTML = `<h3>${name}</h3><div>${days}</div>`;',
  /*
   * THE MONTH, AS A NATIVE DISCLOSURE. Open, the card shows the month's day-by-day cycle; closed, it is the
   * month's name. **The summary is the month's own `<h3>`, moved rather than copied**, so the heading the
   * design drew is still a heading in the document outline and is still the thing a reader activates.
   */
  '      const panel = document.createElement("details");',
  '      panel.className = "sx-cal-year-card";',
  '      const head = document.createElement("summary");',
  '      head.innerHTML = card.querySelector("h3").innerHTML;',
  '      const body = document.createElement("div");',
  '      body.innerHTML = card.querySelector("div").innerHTML;',
  '      panel.appendChild(head);',
  '      panel.appendChild(body);',
  '      card.innerHTML = "";',
  '      card.appendChild(panel);',
  '      yearGrid.appendChild(card);',
  '    }',
  '  }',
].join('\n');

export function extendMarketDaysScript(script: string): string {
  /*
   * IDEMPOTENT, BECAUSE THE ROUTE READS THE FILE PER REQUEST. Without this the second request would replace the
   * readable builder with itself and the third would leave two copies of it. The marker is the call the
   * readable builder already has.
   */
  if (script.includes('sx-cal-year-card') || script.includes(MARKET_CELL_MARKER)) return script;
  /*
   * ================================================================================================
   * THE MARKET DAY THE FILL'S OWN CELLS ARE WAITING FOR
   * ================================================================================================
   *
   * `fillCulturalCalendar` draws `/cultural-calendar/`'s month grid as numbered cells that carry
   * `data-market-day-cell`, and one `data-market-month="YYYY-MM"` on the grid itself. **One line is spliced in
   * after the design's own `marketDay` declaration**, so the label it writes comes from the one function in
   * this repository that reckons the four-day cycle — not from a copy of it in TypeScript. On `/igbo-calendar/`
   * and `/market-days/` the selector matches nothing, because those grids are built by `render()` and
   * `renderYear()` later in this same script; their cells are stamped by the builders, as they always were.
   *
   * THE SPLICE IS CHECKED, AND A FILE WITHOUT THE DECLARATION IS SERVED UNCHANGED RATHER THAN HALF-EXTENDED.
   * The declaration is asserted to appear exactly once before it is used as an anchor, because a file that
   * declares the cycle twice is not a file this understands. **A missing anchor is not thrown on**: the caller
   * answers a throw with the design's own script, and that would take the year grid away from the two screens
   * that have one — so a file this pass cannot read is a file it leaves alone. **And it is left alone QUIETLY,
   * because `console.error` is the ROUTE's business and not this function's**: this file is a browser script,
   * where there is no `process` on a page that is not served by Node, and a bare reference to one is a
   * `ReferenceError` that kills every handler registered after it — the same class of fault as the sibling-scope
   * one above.
   */
  if (script.split(MARKET_DAY_DECLARATION).length === 2) {
    script = script.replace(MARKET_DAY_DECLARATION, () => `${MARKET_DAY_DECLARATION}\n${MARKET_CELL_FILLER}`);
  }
  /*
   * THE ANCHOR IS THE YEAR GRID BUILDER, FOUND BY ITS OWN DECLARATION RATHER THAN BY A LINE NUMBER.
   *
   * The pattern includes the two spaces and the `year` in `renderYear` so that it cannot match the four-day
   * month view's `function render(){` — **a prefix match would have replaced the wrong builder**, which is the
   * same class of fault as every other one this file records. Two builders exist on this screen and the day
   * grid is the one a reader would notice going missing.
   */
  if (!script.includes('data-year-grid')) return script;
  if (!script.includes(YEAR_BUILDER)) {
    throw new Error('market-days.js: the year grid builder was not found, so the months cannot be made expandable');
  }
  if (script.split(YEAR_BUILDER).length !== 2) {
    throw new Error('market-days.js: the year grid builder appears more than once, so the month wrapper cannot be placed safely');
  }
  /*
   * THE FOUR-DAY RECKONING IS COPY, NOT A SECOND IMPLEMENTATION. All twelve day cells are still produced by the
   * design's own `marketDay()`, and the calendar's anchor is still the design's two constants — this extension
   * does not know the cycle, it only changes the shape of the card the cycle is drawn into.
   */
  return script.replace(YEAR_BUILDER, () => YEAR_BUILDER_REPLACEMENT);
}

/**
 * `/igbo-calendar/` and `/market-days/` — the four-day market week, its stated anchor, and the design's own
 * thirteen-month section below it.
 *
 * THE ANCHOR IS ONE RECKONING AMONG SEVERAL, AND THE PAGE SAYS SO AS A FACT ABOUT THE CALENDAR
 *
 * The design's own note reads *"This prototype sets 1 January 2026 as Orie and repeats the four-day cycle. It
 * is not a claim that every Igbo community uses the same anchor."* **The qualification is right and the words
 * are wrong**: "this prototype" is the archive describing its own build, and "not a claim that…" is a
 * disclaimer attached to the page's own work rather than information about the calendar. The owner reported
 * exactly this class of sentence on `/cultural-calendar/` — *"why is this 'A demonstration reckoning from a
 * fixed anchor …' there? fix."* — and the same objection holds on this page, where the sentence is longer and
 * begins "This page reckons the cycle from a fixed anchor: … It is this archive's demonstration of one
 * reckoning, not a claim that every Igbo community uses the same one."
 *
 * **So the fact is kept and the build is taken out of it.** A community that keeps a different anchor keeps a
 * different market day, which is the thing a reader needs to know and the thing the design's own sentence was
 * trying to protect; the anchor this page uses is stated, because a market day without its anchor cannot be
 * read. What goes is "demonstration", "prototype" and the disclaimer's grammar.
 *
 * **And the conversion is kept exactly as the design computes it.** The one other change is to the words that
 * call the reader's own today's date an example: the date shown is the real date, and the market day is this
 * page's reckoning of it under the anchor it states, said before the answer rather than after it.
 *
 * ============================================================================================
 * AND THE ACCOUNT THAT SAT BELOW IT IS GONE, ON THE OWNER'S INSTRUCTION (round 366)
 * ============================================================================================
 *
 * Round 365 put a short account below the design: two headings, the four market days and the 28-day month,
 * the archive's own catalogued records named beside their claims, and the month names attributed to
 * Onwuejeogwu (1981) with the archive's inability to hold that book said in the same sentence. One sentence
 * of the design's own summary was removed here at the same time, because it was a note about this archive's
 * process rather than about the calendar.
 *
 * ⚠️ **THE OWNER THEN DELETED THE WHOLE OF IT, AND THIS FUNCTION NO LONGER ADDS ANYTHING.** *"i checked the
 * calendar again, and these things are still there, so delete these immediately"* — and he listed them: both
 * headings, the two paragraphs that named the five catalogued records, the paragraph attributing the month
 * names, the Nri statement, and the paragraph saying what the page does not do. Every one of those blocks
 * was inside one template literal, and they are gone from the served page while
 * `apps/ozikoro/public/design/` keeps its bytes.
 *
 * **THE MACHINERY WENT WITH THE WORDS.** Once the text was gone the section held nothing but its own
 * `<style>` block, and every rule in that block styled an element that no longer existed — the fault that
 * block's own comment had recorded in the other direction. So the empty `<section class="sx-cal-account">`,
 * its stylesheet, the `CALENDAR_MONTH_NAMES` table it was built from, the month-row builder and the
 * insertion guard all went in the same change. What a reader meets below the calendar now is the design's
 * own thirteen-month section and basis note, unchanged.
 *
 * THE ONE THING THIS FUNCTION STILL ADDS TO THE BASIS NOTE (round 364, kept and reworded) is the plain
 * statement that the account followed here is the Nri one. The owner asked for it in those words:
 * *"emphasize that the calendar is a product of nri, so we are following nri calendar days, even though some
 * igbo communities might differ."* **That sentence was never part of the removed account** — it lives in the
 * design's own "Community context matters" note rather than in the section the owner deleted, and the tests
 * assert it survives there.
 */
export function fillIgboCalendar(html: string, state: { basis: string } = { basis: MARKET_DAY_ANCHOR }): string {
  let out = clearExampleMaterial(html);
  out = out.replace(/Selected demonstration basis/g, 'The basis this page uses');
  /*
   * ── THE SUMMARY ENDS AT THE CALENDAR, AND THE TWO SENTENCES AFTER IT ARE ABOUT US ─────────────────
   *
   * The owner: *"go back and end exactly at that, and delete the rest."* **He is right, and the paragraph
   * proves it by reading.** `<p class="sx-cal-sources">` describes the calendar for four sentences and then
   * turns to address a maintainer: *"This summary is reference material drawn principally from Onwuejeogwu
   * (1981); the full source list is to be verified before publication."*
   *
   * ⚠️ **THAT IS A NOTE ABOUT THIS ARCHIVE'S OWN WORK, AND IT SAYS TWO THINGS A READER SHOULD NOT BE TOLD.**
   * It names a reference in a form that is not the archive's citation style, and it tells the reader that the
   * sources have *not* been checked — which is a statement about our process rather than about the Igbo
   * calendar. **The sentence before it ends the account: "…but it has not been easy."** So the paragraph ends
   * there.
   *
   * ⚠️ AND IT IS REMOVED HERE RATHER THAN IN THE DESIGN, WHICH IS INVIOLABLE. The sentence is in
   * `igbo-calendar.html` on disk; `apps/ozikoro/public/design/` is byte-identical to the upstream deliverable
   * and must stay so, and the serve-time rewrite is where every other design sentence this project has had to
   * change is changed. **The design keeps its bytes and the reader does not meet the note.**
   */
  out = out.replace(
    /\s*This summary is reference material drawn principally from Onwuejeogwu \(1981\); the full source list is to be verified before publication\./g,
    ''
  );
  /*
   * THE HERO'S OWN DESCRIPTION OF WHAT THE PAGE HOLDS.
   *
   * It read "Check today, look up another date, or follow Eke, Orie, Afọ and Nkwọ across a month or full
   * year." **That was the whole of the page when it was written and it is not the whole of it now** — the
   * design's own thirteen-month section sits below the calendar. A hero that leaves it out undersells the
   * page at the one point every reader reads.
   *
   * AND THE SECOND SENTENCE NAMES WHAT IS BELOW, WHICH IS THE HALF OF THIS THAT IS EASY TO MISS. It has
   * promised, in three rounds, "the system, the thirteen months, the festivals the account names, the naming
   * tradition, and where all of it comes from" and then "the thirteen months and their sources, and what this
   * archive can and cannot substantiate of the account behind them" — **and round 365 removed the claim table
   * the second of those offered, so both promises are now false.** A hero that points at a section that is
   * not there is worse than the underselling this line was added to fix. What is below is the Nri year and
   * its thirteen months, which the design draws, with the basis note above them saying they are the Nri
   * reckoning taken from the archive's own catalogued records — so that is what it says. **It still holds
   * after round 366 took the account's prose away, because the design's own section and the basis note are
   * the two things it points at.**
   */
  out = out.replace(
    /Check today, look up another date, or follow Eke, Orie\/Oye, Afọ\/Afor and Nkwọ\/Nkwor across a month or full year\./,
    'Check today, look up another date, or follow Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor across a month or full year. Below the calendar: the Nri year those days make up, its thirteen months, and the archive’s own records behind them.'
  );
  /*
   * ── THE FOURTH VARIANT: EKE'S OTHER NAME, ON THE OWNER'S INSTRUCTION (round 364) ─────────────────
   *
   * His words: *"also add that another word for 'eke' is 'eken' same way you added for others."* **The design
   * writes a variant for three of its four day cards and not for the fourth**, measured on `/igbo-calendar/`
   * before this round:
   *
   *     <article data-day-card="Eke"><span>01</span><h2>Eke</h2></article>                       ← no variant
   *     <article data-day-card="Orie"><span>02</span><h2>Orie <small>Oye</small></h2></article>
   *     <article data-day-card="Afọ"><span>03</span><h2>Afọ <small>Afor</small></h2></article>
   *     <article data-day-card="Nkwọ"><span>04</span><h2>Nkwọ <small>Nkwor</small></h2></article>
   *
   * So the card takes `<small>Eken</small>` in exactly the form the other three use, and the lede's list of
   * variant pairs — which the design itself writes as "Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor", in the
   * sentence a reader meets first — takes the pair beside the other three rather than leaving Eke the only
   * unpaired day there. **The design's own file is not edited**: `public/design/` is the source and this is a
   * serve-time rewrite of it. Both strings are asserted against the design in `design-fill.test.ts`, so a
   * design whose markup moves fails the suite instead of silently dropping the variant.
   *
   * WHERE THE NAME COMES FROM, SAID RATHER THAN ASSUMED. `Eken` appears nowhere in the design, nowhere in the
   * archive's five catalogued records that bear on this account, and nowhere in the article the page draws on —
   * checked rather than supposed. It is the owner's own statement about his archive, which is a source class
   * this archive already uses: `docs/DATA-SOURCES.md` §5 records his own list as the corpus for the name
   * material, "where the two overlap the owner's row wins". **So the variant goes up AND its provenance goes
   * into the claim row that lists the other three** (`CALENDAR_VERIFIED` below), because a name on a day card
   * that no row says who recorded is exactly the unattributed claim this page's check table exists to prevent.
   *
   * AND THE ONE PLACE IT IS DELIBERATELY NOT ADDED IS THE `<select>`. Its options are the four values a request
   * is matched against — the design's `marketDay()` and the server-side `?day=` comparison take exactly one
   * name each — so a variant there would be a choice that selects nothing rather than a second spelling. The
   * same reasoning leaves the `days` array in `public/design/market-days.js` alone: that array **is** the
   * reckoning, it is the design's, and it is not editable from here. The month grid and the upcoming lists the
   * script draws therefore keep the canonical four, which is what a heading's `<small>` is a gloss on rather
   * than a replacement for.
   */
  out = out.replace(
    /Eke, Orie\/Oye, Afọ\/Afor and Nkwọ\/Nkwor/g,
    'Eke/Eken, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor'
  );
  out = out.replace(
    /<article data-day-card="Eke"><span>01<\/span><h2>Eke<\/h2><\/article>/,
    '<article data-day-card="Eke"><span>01</span><h2>Eke <small>Eken</small></h2></article>'
  );
  out = out.replace(
    /*
     * BOTH OF THE DESIGN'S SENTENCES GO, AND THE SECOND ONE IS WHY THIS PATTERN IS NOT THE OLD ONE.
     *
     * The design writes two: *"This prototype sets 1 January 2026 as Orie and repeats the four-day cycle. It is
     * not a claim that every Igbo community uses the same anchor."* **The old pattern replaced only the first**,
     * so the served page carried the new sentence AND the design's leftover disclaimer right after it —
     * measured on `/igbo-calendar/`: "…not a claim that every Igbo community uses the same one. It is not a
     * claim that every Igbo community uses the same anchor." The same thing twice, the second time in the
     * design's own voice. The pattern now takes the pair, so the replacement is the whole of what a reader reads
     * there.
     *
     * ── AND THE NRI STATEMENT JOINS IT, ON THE OWNER'S INSTRUCTION (round 364) ───────────────────────
     *
     * His words: *"and emphasize that the calendar is a product of nri, so we are following nri calendar days,
     * even though some igbo communities might differ."* The material was already on the page, distributed
     * through the month table's caption, its column, every row, and the check table — and **his complaint was
     * that it is not said plainly where a reader meets the calendar.** The note under "Community context
     * matters" is where the design itself states the basis, so the plain statement goes there, in the same
     * breath as the qualification he asked for in the same sentence.
     *
     * BOTH HALVES OR NEITHER. The first half alone would claim the Nri account for all of Igboland; the second
     * alone would hide which account this page is following.
     *
     * ── AND BOTH HALVES WERE REWRITTEN WHEN THE TERTIARY SOURCE CAME OFF THE PAGE (round 365) ────────
     *
     * The second half used to be the article's own sentence, quoted: the calendar *"is neither universal nor
     * synchronized, so various groups will be at different stages of the week, or even year."* **A page cannot
     * quote a source it has removed**, and the owner's instruction was to remove everything about that source
     * — so the quotation is gone and the same fact is now the archive's own statement. It is not a loss: the
     * archive's own catalogued record *Iguaro: The Igbo Calendar, Culture, and Cosmology* states it in terms
     * this page can carry — the calendar varies across communities with their lunar observations and local
     * practice, while the four-day market week is shared — which is why the second half now reads as the
     * record's statement rather than as a quotation from elsewhere.
     *
     * THE FIRST HALF KEEPS ITS LIMIT. The month names are Onwuejeogwu (1981) and **the archive does not hold
     * that book and has not read it**, which the sentence on the Nri account below states in the same breath
     * as the names themselves. That is the one claim on this page whose source the archive cannot open, and it
     * is marked where it is made rather than in a table of outcomes.
     *
     * AND IT IS ON THIS SCREEN ONLY. `/market-days/` carries the same anchor paragraph from the replacement
     * below, and the owner named this note — the one headed "Community context matters" — which only
     * `/igbo-calendar/` has. The sibling's basis note still states the anchor and that communities differ.
     */
    /This prototype sets 1 January 2026 as Orie and repeats the four-day cycle\.\s*It is not a claim that every Igbo community uses the same anchor\.<\/p>/,
    `This page reckons the cycle from a fixed anchor: ${esc(state.basis)}. Communities do not all keep the same anchor, so a town that keeps another one keeps another market day.</p>
        <p><b>The account of the calendar followed here is the Nri one.</b> The four market days and the thirteen months below are the Nri reckoning, taken from the archive's own catalogued records. Other Igbo communities keep other reckonings, and those records say so themselves: the calendar varies across communities, and the four-day market week is the part they share.</p>`
  );
  /*
   * THE SAME ANCHOR, STATED ON THE OTHER SCREEN THAT LOADS THIS SCRIPT.
   *
   * `/market-days.html` is a SEPARATE, OLDER SCREEN with its own basis note: *"The supplied helper sets 1
   * January 2026 as Orie and repeats the four-day cycle. This is a design basis, not a claim that every Igbo
   * community uses the same anchor."* — and **"the supplied helper" is the design talking about its own file
   * rather than the page talking to a reader.** It states the same demonstration in different words, so it is
   * given the same attribution this fill already gives `/igbo-calendar/`, and both screens then state the
   * anchor in one form.
   *
   * Two sentences rather than one, because the two screens were written differently and **a replacement that
   * silently matches nothing is the fault this file keeps recording** — each string is read from the screen it
   * belongs to, and the test asserts that both are replaced.
   */
  out = out.replace(
    /The supplied helper sets 1 January 2026 as Orie and repeats the four-day cycle\. This is a design basis, not a claim that every Igbo community uses the same anchor\./,
    `This page reckons the cycle from a fixed anchor: ${esc(state.basis)}. Communities do not all keep the same anchor, so a town that keeps another one keeps another market day.`
  );
  /*
   * ── AND THE NOTE-TO-SELF COMES OFF BOTH SCREENS ──────────────────────────────────────────────────
   *
   * The design's last paragraph in `sx-basis-note` is addressed to a developer rather than to a reader:
   * *"Before production: verify the anchor, community basis, timezone, spellings and whether the day changes
   * at sundown. A production result should always name its source."* — and `/market-days/` carries the same
   * instruction minus its last sentence. **It reached readers**, and the fill had been rewording the second
   * half of it while leaving "Before production:" in place: the site was serving an instruction to its own
   * author with the author's checklist left intact beside it.
   *
   * SO THE WHOLE PARAGRAPH GOES, INSTRUCTION AND ALL, AND NOTHING REPLACES IT. Everything in it a reader can
   * use is already on the page: the paragraph immediately above states that this page reckons from a fixed
   * anchor and that communities do not all keep the same one, and the design's own thirteen-month section
   * below carries the year the basis note attributes to the archive's records. **The account's prose is no
   * longer there to attribute, and the note still may not be restored to carry the load.** What is left —
   * verify the timezone, verify the spellings, verify whether the day changes at sundown — is a list of work
   * this archive has not done, addressed to whoever does it next, and **a page must not carry instructions to
   * its own author.**
   *
   * THE TWO SPELLINGS ARE MATCHED WHERE THEY STAND rather than by one loose pattern, because the two screens
   * wrote the paragraph differently and **a replacement that silently matches nothing is the fault this file
   * keeps recording**. The test asserts that both are gone from the pages that carried them.
   */
  out = out.replace(
    /<p><b>Before production:<\/b> verify the anchor, community basis, timezone, spellings and whether the day changes at sundown\. A production result should always name its source\.<\/p>/,
    ''
  );
  out = out.replace(
    /<p><b>Before production:<\/b> verify the anchor, community basis, timezone and whether the day changes at sundown\.<\/p>/,
    ''
  );
  /*
   * THE SAME CLASS OF SENTENCE, FOUND ON THE SIBLING SCREEN WHILE LOOKING FOR THE FIRST ONE.
   *
   * `/market-days/` carries a second note after its month view: *"Market-day sequences can differ by
   * community. A production result should always name its verified calendar source."* **The first sentence is
   * for the reader and the second is for the build** — "a production result" is this archive talking about
   * its own deployment, exactly as "Before production:" was. So the second sentence goes and the first stays,
   * with the fact the second was protecting stated for a reader instead: this page does name its anchor, in
   * the basis note above, and a town that keeps another one keeps another market day.
   */
  out = out.replace(
    /<p>Market-day sequences can differ by community\. A production result should always name its verified calendar source\.<\/p>/,
    '<p>Market-day sequences can differ by community. This page states the anchor it reckons from above, and a town that keeps another anchor keeps another market day.</p>'
  );

  /*
   * THE FULL YEAR, WHICH THE OWNER ASKED TO BE CLICKABLE, AND THE ONE THING THE FILL MAKES TRUE RATHER THAN
   * LEAVES TO THE SCRIPT.
   *
   * The design already draws the year grid inside a `<details>`, so the control is native, keyboard-operable
   * and works without JavaScript — but **the grid inside it is built by `market-days.js`, so with JavaScript
   * off the element the owner asked to expand expands onto nothing.** The design's own quicklink lands on an
   * empty panel. So the twelve months of the year are written into the markup as well: each states how many
   * days it has and that every date in it falls on one of the four days under the anchor stated on the page.
   * That is the shape of a year, not a day-by-day cycle — **computing the cycle in TypeScript would be a
   * second reckoning of the one cycle this page already reckons once**, and two reckonings drift.
   *
   * The script replaces the container's contents when it runs, so a reader with JavaScript gets the full grid
   * and the per-month expansion, and a reader without it gets the year's shape and the anchor it is reckoned
   * from, which is more than an empty box and no less honest than the grid.
   */
  const yearCard = (name: string, days: number): string =>
    `            <article class="sx-cal-year-card"><h3>${esc(name)}</h3><p class="small muted">${days} days. Every date in this month falls on one of Eke, Orie, Afọ and Nkwọ under the anchor stated above. The day-by-day grid for each month is drawn by this page’s own script.</p></article>`;
  const yearNoScript =
    `        <noscript>
          <p class="small muted" style="margin-top:var(--s-4)">This page’s script is switched off, so the month-by-month grid cannot be drawn. What the year holds is still stated here, and the anchor it is reckoned from is stated above.</p>
          <div style="display:grid;gap:var(--s-3);margin-top:var(--s-3)">
${Array.from({ length: 12 }, (_, m) => yearCard(new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 1))), new Date(Date.UTC(2026, m + 1, 0)).getUTCDate())).join('\n')}
          </div>
        </noscript>`;
  out = out.replace(/(<div class="sx-year-controls">[\s\S]*?<\/div>)/, `$1\n${yearNoScript}`);

  /*
   * ── AND NOTHING IS ADDED BELOW THE DESIGN, BECAUSE THE ACCOUNT IS GONE (round 366) ────────────────
   *
   * This point in the function used to append a `<section class="sx-cal-account">` before the page's closing
   * `</main>`, anchored there because the design runs hero, day cards, lookup, month view, full-year grid and
   * its closing note before it closes `main` — and guarded, because this function runs on the design's own
   * file per request and an insertion that doubles on a second pass is the kind of fault that only shows up
   * in production.
   *
   * ⚠️ THE OWNER DELETED EVERY WORD OF THAT ACCOUNT, SO THE INSERTION WENT WITH IT. *"i checked the calendar
   * again, and these things are still there, so delete these immediately"* — both headings, the paragraphs
   * naming the archive's five catalogued records, the paragraph attributing the month names to Onwuejeogwu
   * (1981), the Nri statement and the paragraph saying what the page does not do. With the text gone the
   * section held nothing but a `<style>` block whose every rule styled an element that no longer existed, so
   * the section, the stylesheet, the month-name table and the builder that made the account all went in the
   * same change.
   *
   * **A GUARD WITH NOTHING TO GUARD IS NOT KEPT FOR SENTIMENT.** Everything this function still does — the
   * anchor rewrite, the Nri statement in the basis note, the hero lede, Eke's variant and the no-script year —
   * rewrites the design's own text in place, so none of it needs an insertion anchor or an idempotency check.
   * The design's page is returned with its own `</main>` intact.
   */
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * WATCH: ONE FILM'S PAGE
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/watch-video/` — one film's viewing page.
 *
 * The design's film is real: its banner says the embedded video and title come from the named public publisher,
 * and the page names it — the [Re:]Entanglements Project, on YouTube, "Faces | Voices". **Everything around the
 * film is the demonstration's**: the transcript area says the approved transcript has not been supplied, which
 * is the truth, and the related viewing list names three other films.
 *
 * ── WHAT A FILM THE ARCHIVE HOLDS GETS, ON THE OWNER'S INSTRUCTION (round 352) ─────────────────────
 *
 * The page is the film and its provenance, and the RECORD'S WRITING IS NOT ON IT. The owner's words: *"on the
 * watch, remove the article showing inside the page. if one wants to see the article, when you click on 'this
 * film's page', let it open, but not also the article. the main article is expected to continue being in the
 * original blog posts lists."* So the record keeps its own address, stays in `/archive/`, and this page is a
 * **doorway to it rather than a copy of it** — one address per record.
 *
 * That is the shape §3 of the owner's report asks for, and it is three changes on this page:
 *
 *   * **the description slot is the record's own words.** `sx-video-copy` carried the design's fixed interface
 *     sentence — *"A sourced viewing page keeps the film, its publisher, related records and text access
 *     together…"*, which the screen's own `example-flag` calls example material and which is the same sentence
 *     on all eighteen films. It now carries the record's own summary, or its own opening sentences, or an
 *     honest statement that it holds neither. See `filmDescription`.
 *   * **a third control, and a repointed one.** The design draws "Watch on YouTube ↗" and "Low-bandwidth
 *     reading" (at `#transcript`). The owner asked for a control for the main article: *"the way it has buttons
 *     for 'watch on youtube' and 'Low-bandwidth reading', should it have button for the main article"*. **The
 *     article is also the low-bandwidth reading of the film** — the design's own heading for the slot that
 *     control reaches was *"Read when video is difficult to load"* — so both point at the holding record, and
 *     neither points at an anchor this page no longer serves.
 *   * **the reading section is replaced by the design's own related block.** *"then remove from 'On this page'
 *     and the entire others below, and replace it with 'related videos'"*. The design already draws that block
 *     — `<div id="related-video">` with the eyebrow *"Related viewing"* — so it is kept and the archive's own
 *     neighbours fill it.
 *
 * ── AND THE DESIGN'S OWN PAGE, WHICH IS NOT THIS PAGE (Option B) ───────────────────────────────────
 *
 * `/watch-video/` with no `?v=` is the design's own film — the home screen links it — and **the archive holds
 * no record for that film**: `?v=E3UBv8pmLxE` answers 404. There is therefore nothing for "Low-bandwidth
 * reading" to point at, and removing the section would leave both that control and the design's own header
 * nav anchor dead. That is the one case §2 of the report allows Option B for, and the reading section is kept
 * there — which is also where the truthful transcript sentence still attaches, to a page that still offers a
 * reading view.
 *
 * ── AND THE SAME PAGE, FOR ANY FILM THE ARCHIVE HOLDS (round 338) ──────────────────────────────────
 *
 * Measured before this: `/watch-video/` had one address and one film. `/watch/` draws **24 archive films** and
 * every one of them, if a reader reached a viewing page for it at all, was shown the design's `Faces | Voices`
 * — the design's publisher, the design's YouTube id, the design's project-page link. **A card that names one
 * film and opens a page about another is the wrong-destination fault at 200**, which is the class this round
 * exists to close.
 *
 * So the page takes a film. `film` is one entry of the same `extractArchiveFilms` result `/watch/` is built
 * from, so the two surfaces cannot disagree about a title, a topic or a holding record, and `?v=<id>` is the
 * selector. **Nothing is fetched from YouTube**: every value written here comes from the record that embeds the
 * film — its id, the title the archive recorded, its topic, and the record itself.
 *
 * ── WHAT IS DELIBERATELY NOT CARRIED OVER, AND WHY IT IS THE WHOLE POINT ───────────────────────────
 *
 * The design's page says `Published by [Re:]Entanglements Project`, links the project's own page, and states
 * that the film comes from a named public publisher. **All three are true of the design's film and none of them
 * is recorded for an archive film**: the archive holds an embed in a record's body and nothing about who
 * published it. So the publisher line becomes `Publisher not recorded`, the project-page link becomes the
 * holding record, and the sentence that says Ozikoro does not present an external film as its own is kept —
 * because it is the one sentence in the block that is a policy rather than a fact about one video.
 */
export type RealFilmPage = RealFilm;

/**
 * The record a film is held in — its own short description, and its own writing only where there is none.
 *
 * WHAT THIS IS, AND WHY IT IS NOT A FIELD ON `RealFilm`. `RealFilm` is the facts a card carries: an id, a
 * title, a topic, a count and an address — enough for `/watch/` to draw twenty-four posters. The record's own
 * description and body are what one film's own page reads, and putting them on every card would carry every
 * embedding record's whole text into a list that shows none of it. So they are a separate argument, given only
 * by the one route that already holds the record's own row — and **no new query is written for them**, which
 * is why the type is built from a row the caller has already read rather than fetched here.
 */
export type RealFilmReading = {
  /**
   * THE RECORD'S OWN SHORT DESCRIPTION, WHERE IT HAS ONE — AND ONLY WHERE IT IS ONE.
   *
   * `ozikoro_article.standfirst`. It is the field the record's own article page already builds its
   * `<meta name="description">` from, and **it is preferred over the body because a field the archive chose
   * to describe the record with is better material than a paragraph this fill picked out.**
   *
   * IT IS MEASURED, AND IT IS NOT WHAT IT LOOKS LIKE. All thirteen holding records carry a `standfirst`, and
   * **all thirteen are truncated, tag-stripped windows of the body rather than authored summaries** — every one
   * ends in an ellipsis, and they glue the record's sub-headings into their sentences:
   *
   *   `…the festival is celebrated biennially, alternating with the IZA MBARA AMA…`
   *   `…life by the river. History of Égwú Àmàlà Égwú…`
   *
   * **So the field is used only when it is a complete description** — when every sentence in it ends in
   * punctuation — because putting a field that stops mid-clause in the description slot is putting a truncated
   * sentence in front of a reader, which is the one thing this slot must not carry. Where it is truncated the
   * record's own opening paragraph is read instead, which is the "else" branch of the same rule and gives the
   * same opening words in whole sentences.
   */
  summary?: string | null;
  /**
   * The record's own words, as published. Sanitised by this fill, never by the caller.
   *
   * NOTHING RENDERS IT. The body is not on this page; it is here so that a record whose summary is not a
   * description can still be described in its own sentences.
   */
  body: string;
  /** The record's title, for the description slot which may have to say whose record carries none. */
  title: string;
  /** The record's own address — the main article, and the low-bandwidth reading of the film. */
  href: string;
};
/**
 * The record's own short description, in whole sentences.
 *
 * WHY THIS IS NOT THE DESIGN'S SENTENCE. `watch-video.html`'s `sx-video-copy` reads *"A sourced viewing page
 * keeps the film, its publisher, related records and text access together. Ozikoro does not present an external
 * film as its own production."* **That is the design's fixed interface text — the screen's own `example-flag`
 * calls it example material — and it is about the platform rather than about any film.** So it describes no
 * record, and it is not what this slot is for.
 *
 * WHERE THE WORDS COME FROM, IN ORDER OF HONESTY:
 *
 *   1. `ozikoro_article.standfirst` — **but only when it is a complete description rather than a truncated
 *      excerpt**, which is a measured distinction and not a matter of taste. See `RealFilmReading.summary`:
 *      all thirteen holding records carry a `standfirst` and all thirteen are truncated windows of the body, so
 *      today **not one film page takes this branch** — and the first record that arrives with a real summary
 *      field gets it.
 *   2. Otherwise the record's first substantive paragraph, read through the archive's own sanitiser — the same
 *      one `prepareArchiveHtml` uses — so that an `<iframe>`, a `<script>` or a caption cannot put a word into
 *      the description that the record does not say.
 *   3. Otherwise NOTHING, and the caller writes the honest absence into the slot instead. **A plausible
 *      sentence written here would be the invention this archive refuses, and the design's boilerplate is not
 *      a substitute for it**: putting the demonstration's line back and calling it the record's would be worse
 *      than an empty slot, because it would read as the record's own words.
 *
 * WHOLE SENTENCES ONLY, WHICH IS THE ONE RULE BOTH BRANCHES OBEY. A description stopped mid-sentence can assert
 * something the record did not say, so `sentencesOf` returns only runs that end in punctuation and this takes
 * complete sentences from the front of one. **The body's own remainder is left off the page rather than shown
 * in part**, and the summary branch declines the field entirely where it is truncated rather than showing its
 * good half — the good half is the body's opening, which step 2 reads in full sentences anyway.
 */
function filmDescription(reading: RealFilmReading | null | undefined): string | null {
  if (!reading) return null;

  const summary = (reading.summary ?? '').replace(/\s+/g, ' ').trim();
  if (summary) {
    const field = sentencesOf(decodeEntities(summary));
    // A field that stops mid-sentence is a truncated excerpt, not a description.
    if (field.whole.length > 0 && !field.trailing) return field.whole.slice(0, 2).join(' ');
  }

  /*
   * THE BODY, THROUGH THE ARCHIVE'S OWN PIPELINE IN THE ARCHIVE'S OWN ORDER: sanitise, move the headings into
   * the page's outline, tidy. **The sanitiser is the load-bearing step and it is why this reads the body
   * rather than grepping it**: it drops `<iframe>` with its contents and strips `<script>`, so the film already
   * playing above cannot become a paragraph of the description and no script text can become the record's
   * words.
   *
   * THE MEDIA-ADDRESS REWRITE THAT USED TO GO FIRST IS NOT HERE, AND THAT IS DELIBERATE. It existed because
   * the record's whole body was rendered on this page, images and figures included, and the archive's media map
   * is keyed by the absolute `source_url` while the sanitiser turns such an address into a path — so the
   * rewrite had to happen before the sanitising or the photographs 404'd. **No photograph of the record is on
   * this page any more**: the body is read for its sentences, and an image address has no bearing on a
   * sentence. Keeping it would mean a media-map query per film page for a reader who never sees an image, and
   * the ordering itself still lives in `prepareArchiveHtml` for the article pages, where the images ARE
   * rendered. `tidyBody` is still given `null` as the featured image, for the same reason.
   */
  const words = tidyBody(normaliseHeadingLevels(sanitiseArchiveHtml(reading.body)), null);
  for (const paragraph of words.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    /*
     * THE RECORD'S OWN SPACING, WHICH MEANS THE INLINE TAGS COME OFF WITH NOTHING IN THEIR PLACE. WordPress's
     * editor splits text into `<span>` runs that carry their own spaces, so substituting a space for every tag
     * inserts one the record never had — measured without this, five of the eighteen pages read *"the ogene , a
     * metal bell"*, *"from Unubi , a town"* and *"in Nigeria , but"*. **A description that alters the record's
     * punctuation is not the record's own words**, which is the whole point of reading it here. `<br>` is the
     * one tag that really is a break, so it becomes the space it stands for.
     */
    const text = decodeEntities((paragraph[1] ?? '').replace(/<br\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    // A caption, a credit line or a stray unit is not a description, and forty characters is well below the
    // shortest opening paragraph this archive holds.
    if (text.length < 40) continue;
    const { whole } = sentencesOf(text);
    if (whole.length > 0) return whole.slice(0, 2).join(' ');
  }
  return null;
}

/**
 * The complete sentences in a run of the record's own text, and whether anything followed them.
 *
 * **`trailing` is the measurement that matters**, and it is why this returns an object rather than an array: a
 * run whose last complete sentence is followed by more text is a run that stops without punctuation — a
 * truncated excerpt in the `standfirst` case, and a paragraph that ends mid-thought in the body case. The two
 * callers treat that differently on purpose: the body takes the whole sentences and leaves the remainder off
 * the page, and the summary field is declined entirely, because a field that is not a description should not
 * be shown as half of one.
 *
 * The punctuation kept is the record's own, including a closing quote or bracket after the stop.
 */
function sentencesOf(text: string): { whole: string[]; trailing: boolean } {
  const sentence = /[^.!?]+[.!?]+["'”’)\]]*/g;
  const whole = [...text.matchAll(sentence)].map((m) => m[0].trim());
  return { whole, trailing: text.replace(sentence, '').trim().length > 0 };
}

/**
 * THE DESIGN'S OWN FILM PAGE, GIVEN THE SAME SHAPE AS A FILM THE ARCHIVE HOLDS — AND THE ONE THING IT CAN SAY.
 *
 * ── THE FAULT THIS ANSWERS (round 353) ────────────────────────────────────────────────────────────
 *
 * Round 352 restructured `/watch-video/?v=<id>` — the article came off, the reading section went, the design's
 * own related block took its place, and the description slot took the record's own words — and **deliberately
 * left `/watch-video/` with no `?v=` as an exception**, calling it "Option B": the design's own film is
 * `E3UBv8pmLxE`, the archive holds no record for it, so "Low-bandwidth reading" had nothing to point at and
 * removing the section would leave that control and the design's own header nav anchor pointing at a removed
 * id.
 *
 * **That reasoning is sound about the consequences and wrong about the page, because the owner opened the bare
 * address.** Served before this change, `/watch-video/` carried the transcript section he asked to have
 * removed, its "On this page" nav, its transcript statement, the design's boilerplate in the description slot,
 * two controls where his instruction had produced three, and a "Low-bandwidth reading" button pointing at
 * `#transcript`. Every one of his four instructions was carried out on all eighteen `?v=` pages and on none of
 * the one page he was looking at.
 *
 * ── WHAT IT DOES INSTEAD ──────────────────────────────────────────────────────────────────────────
 *
 * The shape is the one the `?v=` page has, and the one fact that differs is stated rather than papered over:
 * **the archive holds no record for the film this page shows.** So:
 *
 *   * `sx-video-copy` carries that fact, in the shape round 352 wrote for the case (`filmDescription` returns
 *     null and the caller states the absence) — and it does NOT get the design's fixed interface sentence back,
 *     which is the same sentence on all eighteen films and is not a description of any of them.
 *   * the reading section goes whole: the "On this page" nav, the "Transcript-first view" eyebrow, the "Read
 *     when video is difficult to load" heading, the transcript status line, `id="transcript"` and
 *     `id="transcript-copy"`. As on a `?v=` page, the design's own block inside the band survives and the band
 *     class (`sx-transcript`) is the design's.
 *   * the block is filled by the archive's own rule for related films — **other films under the same topic** —
 *     and this page has no topic, because it has no record. So the rule yields nothing, and the block says so
 *     instead of borrowing the design's three example films (`?v=NBj1CvaDgbM`, `?v=3NnklFf2rXA` and
 *     `?v=g1z_-5jqPG0` all answer 404) or naming three archive films the film is not related to. **The list is
 *     absent and the reason is on the page**, with the design's own word for `/watch/` — the address the
 *     screen's own breadcrumb gives that page — as the way to the films the archive does hold.
 *   * "Low-bandwidth reading" is kept and made inert, in the shape the archive uses elsewhere for a control
 *     whose label promises something the page cannot do: `aria-disabled`, no `href`, its reason in the
 *     `title`, and the reason also visible in the design's own `small muted` span. **Pointing it at `/watch/`
 *     was rejected because that is a wrong destination at 200** — the label promises this film's writing and
 *     `/watch/` is a grid of other films — and removing it was rejected because the archive's own precedent is
 *     to keep such a control and say why, not to make it disappear.
 *   * the design's own header nav, which the route has already made absolute to this page, is repointed from
 *     `#transcript` to the block that replaced the section — the same change, with the same label, that round
 *     352 made on the `?v=` page.
 *
 * ── WHAT IS DELIBERATELY LEFT ALONE ───────────────────────────────────────────────────────────────
 *
 * The design's own title, publisher, project-page link and `<h1>` are the design's statements about the film
 * **its own page** shows, and they are true of it: this is the one page that shows `Faces | Voices`, and its
 * publisher is named by the design's own banner. Removing them would delete the deliverable's own provenance
 * and the publisher's project page from the only page it belongs to, and pinning the archive's record-absence
 * into the publisher slot would be stating the archive's rule about a field this page never claimed to read
 * from a record. **The archive's absence is stated twice instead, in the two slots the owner's instruction
 * governs** — the description slot, and the third span of the facts line (the `?v=` page's "Held in one
 * Ozikoro archive record", here "Held in no Ozikoro archive record").
 */
function filmPageWithNoRecord(out: string): string {
  /*
   * THE DESCRIPTION SLOT. The design's sentence — *"A sourced viewing page keeps the film, its publisher,
   * related records and text access together. Ozikoro does not present an external film as its own
   * production."* — describes the platform and no record, and the screen's own `example-flag` calls it example
   * material. What replaces it is round 352's own absence sentence for a film with no readable record, written
   * for the bare page's case: the archive does not merely lack a readable record here, it holds none at all.
   */
  out = out.replace(
    /<p class="sx-video-copy">[\s\S]*?<\/p>/,
    `<p class="sx-video-copy">The archive holds no record for this film, so there is no description of it to `
      + `show here. None is written in its place.</p>`
  );
  /*
   * THE FACTS LINE, IN THE ONE SLOT THAT STATES THE HOLDING. A `?v=` page reads "Held in one Ozikoro archive
   * record"; this page's film is held in none, and a reader who scans only the facts line must not be left
   * thinking the publisher line above it came out of an archive record.
   */
  out = out.replace(
    /(<span>Platform: YouTube<\/span>)/,
    `$1<span>Held in no Ozikoro archive record</span>`
  );
  /*
   * THE READING CONTROL, INERT. `href="#transcript"` is exactly the address whose target this function removes,
   * so it must not survive; and it must not be silently repointed at a page that is not this film's writing
   * either. See the header for why this is the archive's `aria-disabled` shape and not a link.
   */
  out = out.replace(
    /<a class="btn btn-ghost" href="[^"]*#transcript">Low-bandwidth reading<\/a>/,
    `<a class="btn btn-ghost" aria-disabled="true" title="Not built yet — waiting on a record that holds this `
      + `film; the archive holds no record for the film this page shows">Low-bandwidth reading `
      + `<span class="small muted">— no archive record for this film</span></a>`
  );
  /*
   * THE READING SECTION GOES, AND THE DESIGN'S OWN BAND AND BLOCK STAY. The same replace round 352 wrote for a
   * `?v=` page, with the archive's own rule applied to a page that has no topic: no sibling to name, so the
   * block says why rather than naming anything. `id="related-video"` is the block's own address, and the header
   * nav is pointed at it below.
   */
  out = out.replace(
    /<section[^>]*\bid="transcript"[^>]*>[\s\S]*?<\/section>/,
    `<section class="sx-transcript"><div class="wrap">`
      + `<div class="sx-transcript-copy" id="related-video" style="scroll-margin-top:6rem">`
      + `<p class="eyebrow">Related viewing</p>`
      + `<h2 style="margin-top:.4rem">No related film can be named</h2>`
      + `<p style="margin-top:var(--s-3)">The archive holds no record for this film, so the film is filed `
      + `under no topic and no other film can be named beside it. This list is not filled from elsewhere. `
      + `The films the archive does hold are listed at <a href="/watch/">Watch</a>.</p>`
      + `</div></div></section>`
  );
  /*
   * AND NOTHING POINTS AT WHAT IS GONE. The design's own header nav carries a link to the removed section; it
   * now names the block that replaced it, in the design's own wording for that block — the label round 352
   * chose, and the pattern the design itself draws in the "On this page" nav. The match requires the closing
   * quote, so `#transcript-copy` cannot be caught by it; the reading control above is replaced before this, so
   * the only `#transcript` left for this to find is the header's.
   */
  out = out.replace(
    /(<a\b[^>]*\shref="[^"]*)#transcript(">)[^<]*(<\/a>)/g,
    (_m, before: string, close: string, end: string) => `${before}#related-video${close}Related viewing${end}`
  );
  // The film itself is a target too — the design's own skip link names it — and it lands the same way.
  out = out.replace(
    /<section([^>]*\bid="video"[^>]*)>/,
    (_m, attrs: string) => `<section${attrs} style="scroll-margin-top:6rem">`
  );
  return out;
}

export function fillWatchVideo(
  html: string,
  film?: RealFilmPage | null,
  related?: readonly RealFilmPage[] | null,
  reading?: RealFilmReading | null
): string {
  let out = clearExampleMaterial(html);
  /*
   * THE TRANSCRIPT AREA'S SENTENCES ARE NO LONGER REWRITTEN HERE, BECAUSE NO PAGE SERVES THE AREA (round 353).
   *
   * Round 351 replaced three of the design's transcript sentences with ones true of a film rather than of a
   * design. Round 352 removed the section on a film the archive holds, and left it standing on the design's own
   * page — so the replacements still had one page to show on. **This round removes the section on both pages**,
   * and the three replaces went with it: a replacement whose output no page can carry is code that reads as
   * live. The design's own screen is untouched and still holds all three sentences and the section; it is
   * removed at serve time from the design's own markup, which is where the reader would otherwise meet it.
   */
  if (!film) return filmPageWithNoRecord(out);

  /*
   * ══ THE RECORD'S OWN SHORT DESCRIPTION, IN THE RECORD'S OWN WORDS ═══════════════════════════════════
   *
   * The design fills `sx-video-copy` with a sentence about the platform — *"A sourced viewing page keeps the
   * film, its publisher, related records and text access together. Ozikoro does not present an external film
   * as its own production."* The owner read that slot and took it for *"short description from the article
   * itself"*. **It is not from the article; it is the design's fixed interface text, and it is the same
   * sentence on all eighteen films.** His intent survives his premise, and it is the right one: the slot
   * should carry a short description of the film, taken from the record that holds it.
   *
   * `filmDescription` reads it from the record, in the order of honesty described there. Where the record has
   * nothing usable the slot says so — **it does not get the design's boilerplate back**, because a line about
   * the platform put where a description belongs reads as the record's own words, which is the fault this
   * whole page is being fixed for.
   *
   * The film's provenance is not lost with it: *"Ozikoro does not present an external film as its own
   * production"* is a policy about reuse, so it moves into the source-record aside's "Rights and reuse" line,
   * where the archive keeps what it can and cannot say about using the film.
   */
  const description = filmDescription(reading);
  /*
   * The link the absence sentence names. It is built from the reading's own row values where the caller gave
   * them — that row is the record — and from the card's otherwise, which are the same two values by
   * construction: `film.href` and `film.title` come from the record's own slug and title in
   * `extractArchiveFilms`.
   */
  const holderLink = `<a href="${esc(reading?.href ?? film.href)}">${esc(reading?.title ?? film.title)}</a>`;
  const noDescription = reading
    ? `The record that holds this film, ${holderLink}, carries no summary and no opening paragraph of its `
      + `own, so there is no description of it to show here. None is written in its place.`
    : `The archive supplied no readable record for this film, so there is no description of it to show here. `
      + `None is written in its place.`;

  const id = esc(film.id);
  const title = esc(film.title);
  const topic = esc(film.topic ?? 'Ozikoro archive film');
  const held = film.records > 1 ? `Held in ${film.records} Ozikoro archive records` : 'Held in one Ozikoro archive record';

  /*
   * THE PLAYER. The design's `<iframe>` is the right instrument here — the film is a third-party embed, which
   * is exactly what the design assumed — so its `src` and its `title` are pointed at this film. `frame-src`
   * already names `youtube-nocookie.com` in `next.config.ts`; nothing in the policy changes.
   */
  out = out.replace(
    /(<iframe\b[^>]*\ssrc=")[^"]*(")/i,
    (_m, before: string, after: string) => `${before}https://www.youtube-nocookie.com/embed/${id}${after}`
  );
  out = out.replace(
    /(<iframe\b[^>]*\stitle=")[^"]*(")/i,
    (_m, before: string, after: string) => `${before}${title}${after}`
  );

  // The heading, the kicker line and the breadcrumb all name the film the reader asked for.
  out = out.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/, `$1${title}$2`);
  out = out.replace(/<p class="sx-video-kicker">[^<]*<\/p>/, `<p class="sx-video-kicker">${topic}</p>`);
  out = out.replace(
    /(<p class="sx-video-breadcrumbs">[\s\S]*?<\/a>\s*\/\s*)[^<]*(<\/p>)/,
    `$1${topic}$2`
  );

  /*
   * THE FACTS LINE. The design prints `Publisher: …`, `Platform: YouTube`, `Captions: check player`. The
   * publisher is not recorded anywhere for an archive film, so the slot says so rather than borrowing the
   * design's — an unrecorded field is stated in this archive, never filled with a plausible one.
   */
  out = out.replace(
    /<p class="sx-video-facts">[\s\S]*?<\/p>/,
    `<p class="sx-video-facts"><span>Publisher: not recorded</span><span>Platform: YouTube</span>`
      + `<span>${held}</span><span>Captions: check the player</span></p>`
  );

  /*
   * THE ACTION ROW, WHICH IS THE OWNER'S OWN LIST OF CONTROLS.
   *
   * The design draws two: the outward link to the film on YouTube, and "Low-bandwidth reading" — pointed at
   * `#transcript`, a section this page no longer serves. The owner asked for a third: *"the way it has buttons
   * for 'watch on youtube' and 'Low-bandwidth reading', should it have button for the main article, as the main
   * article is expected to continue being in the original blog posts lists."*
   *
   * SO BOTH INWARD CONTROLS POINT AT THE HOLDING RECORD, and that is not a duplicate by accident. **The record
   * IS the low-bandwidth reading of the film**: the design's own heading for the slot the old anchor reached
   * was *"Read when video is difficult to load"*, and the writing is what a reader who cannot load the film
   * came for. The third control is the same address under the name the owner gave it — now **"This Film's Article"**, which is what he asked for —
   * which is what makes the article reachable in one click from the film rather than only implied by the
   * aside's small link. **The class is the row's own: `btn btn-gold` is the design's, `btn btn-ghost` is the
   * design's, and nothing here invents one.**
   */
  out = out.replace(
    /<a class="btn btn-gold" href="[^"]*">[^<]*<\/a>/,
    `<a class="btn btn-gold" href="https://www.youtube.com/watch?v=${id}">Watch on YouTube ↗</a>`
  );
  out = out.replace(
    /<a class="btn btn-ghost" href="[^"]*">Low-bandwidth reading<\/a>/,
    `<a class="btn btn-ghost" href="${esc(film.href)}">Low-bandwidth reading</a>`
      + `<a class="btn btn-ghost" href="${esc(film.href)}">This Film’s Article</a>`
  );

  /*
   * THE DESCRIPTION SLOT. The record's own words, or an honest statement that the record holds none — never
   * the design's sentence about the platform, which is what was there. See `filmDescription`.
   */
  out = out.replace(
    /<p class="sx-video-copy">[\s\S]*?<\/p>/,
    `<p class="sx-video-copy">${description ? esc(description) : noDescription}</p>`
  );

  /*
   * THE SIDE PANEL. The design's whole `<aside>` is about its own film — the publisher, the publisher's terms
   * and a link to the publisher's project page — so it is replaced rather than patched, field by field. What
   * replaces it is the one source the archive actually has: the record that embeds the film.
   *
   * AND THE ONE POLICY SENTENCE FROM `sx-video-copy` THAT WAS NOT A DESCRIPTION OF ANY FILM COMES HERE. *"Ozikoro
   * does not present an external film as its own production"* is a statement about reuse, so it belongs in the
   * block that says what the archive can and cannot say about using the film — and the description slot must
   * not carry it, because a policy put beside a record's own words reads as part of the record.
   */
  out = out.replace(
    /<aside class="sx-video-side">[\s\S]*?<\/aside>/,
    `<aside class="sx-video-side"><h2>Source record</h2>`
      + `<p><b>Held in</b><br><a href="${esc(film.href)}">${title}</a></p>`
      + `<p><b>Rights and reuse</b><br>Not recorded. Follow the publisher’s terms on YouTube. `
      + `Ozikoro does not present an external film as its own production.</p>`
      + `<p><b>The film</b><br><a href="https://www.youtube.com/watch?v=${id}" rel="noopener noreferrer">Open it on YouTube ↗</a></p>`
      + `</aside>`
  );

  /*
   * THE READING SECTION GOES, AND THE DESIGN'S OWN RELATED BLOCK TAKES ITS PLACE.
   *
   * The owner's instruction: *"then remove from 'On this page' and the entire others below, and replace it with
   * 'related videos'"*. So the section's aside ("On this page"), its transcript-first copy and its transcript
   * status line all go, and what is left is the block the design already draws inside it — kept character for
   * character from the design's own markup, `<div id="related-video">` with its `<p class="eyebrow">Related
   * viewing</p>` and its `<h2>`, in the design's own copy panel so it still sits in the design's cream band.
   *
   * HIS WORD IS "VIDEOS" AND THE DESIGN'S EYEBROW IS "Related viewing". **The design's wording is used**, because
   * the design is where this page's labels come from and because the heading beneath it names the films
   * themselves — `More films under Cultural Heritage` — so the block says "videos" in the only place that can
   * say it without inventing a label.
   *
   * ── THE TRANSCRIPT STATEMENT WENT WITH THE SECTION IT DESCRIBED, AND THE ROOM FOR A TRANSCRIPT IS HERE ──
   *
   * The sentence this fill used to make true — *"The approved transcript has not been supplied for this film"* —
   * is gone from a film the archive holds, and that is the right outcome rather than a loss: **a page that stops
   * offering to be a reading view has nothing for a note about a missing reading to attach to.** Measured before
   * this change: the archive holds no transcript for any film — the eighteen films resolve to thirteen holding
   * records and all thirteen answer 404 at `/podcast/<record>/transcript.txt`, while three approved EPISODES do
   * serve real ones. So the page was saying "no transcript" about a slot that no longer existed.
   *
   * **AND THE PAGE HAS NOT FORECLOSED ONE.** Three things are left in place for it, and each is checkable:
   * the design screen still holds `<section id="transcript">` with `#transcript-copy`, untouched and inviolable;
   * this replace is the only thing that removes it at serve time, so serving a film with an approved transcript
   * is waiving one statement and nothing else; and the sentences above are already true of a film rather than of
   * the demonstration, so the section is ready to be served the moment there is something to serve in it. The
   * archive's one transcript address — `/podcast/<record>/transcript.txt` — is not deleted and is reachable in
   * one click from this page, because the record that owns it is what both inward controls open. **One address
   * per record, which is the owner's own rule, is what holds the transcript as well as the writing.**
   *
   * WHAT FILLS THE BLOCK IS UNCHANGED FROM ROUND 351: the archive's own definition of related, the one
   * `fillArticle` already uses for `.sx-related-list` — other films under the same topic, at most three because
   * the design draws three links, and an honest line where the topic holds no other film. **The design's own
   * three example films are not borrowed**: measured, `/watch-video/?v=NBj1CvaDgbM`, `…?v=3NnklFf2rXA` and
   * `…?v=g1z_-5jqPG0` all answer 404, so they are demonstration material and not this record's neighbours.
   *
   * `scroll-margin-top` IS SET ON THE BLOCK AND ON THE FILM ABOVE IT, for the reason the article page sets it:
   * `.sx-reader-header` is `position: sticky; top: 0`, and **the browser scrolls a target to the very top of the
   * viewport, which is where the header is.** Measured on the served page before this change, in Chrome: the
   * header is 69 px tall and every fragment jump landed its target at `y = 0`, i.e. underneath it — so the first
   * line of the section a reader had just asked for was the one line they could not see. This block carries the
   * design's own in-page address (`#related-video`), so it is a target whether or not this page draws a link to
   * it.
   */
  const topicName = film.topic;
  const siblings = topicName
    ? (related ?? []).filter((f) => f.id !== film.id && f.topic === topicName).slice(0, 3)
    : [];
  /*
   * ── THE RELATED BLOCK IS A LIST OF ROWS, ON THE OWNER'S INSTRUCTION (round 359) ──────────────────
   *
   * His words: *"i have a problem with the way you presented the related viewing. i expected to be smaller
   * with a thumbnail on the left, the title on the right type of thing, so redesign it and make it look
   * better"*. What stood here was one `<p>` of three links separated by middots — no thumbnail, no row and no
   * hierarchy — and the titles are long enough that it wrapped into a wall of text.
   *
   * THE ROW IS THE DESIGN'S OWN SHAPE FOR A RELATED ITEM, ONE STEP SMALLER. `showcase.css` already draws a
   * related entry as a grid with the image in one track and the words in the next: `.sx-related-list a` is
   * `grid-template-rows: 9rem 1fr`, and at `max-width: 60rem` the design turns that same entry into EXACTLY
   * the row asked for, `grid-template-columns: 8rem 1fr`. So the thumbnail width, the serif title and the
   * bronze small label all come from that block, and the image frame is the design's own `.sx-video-thumb`.
   * The rules live in `apps/ozikoro/public/watch-video.css`, which this screen links after the design's own
   * sheets — `public/design/` is inviolable and its card stays a tile.
   *
   * ── WHERE A ROW SENDS A READER, WHICH WAS A DECISION AND NOT A DEFAULT ────────────────────────────
   *
   * The block used to hand the reader to `youtube.com/watch?v=<id>` and leave the archive. **Every film that
   * can appear here is an archive film**: `siblings` is filtered out of the same `extractArchiveFilms` result
   * `/watch/` is drawn from and this page's own `?v=` was resolved against, so each one has a viewing page on
   * this origin. Measured this round: `/watch-video/?v=LL8YX0pXzdI`, `…?v=SHPEwGDOI7c` and `…?v=jOMjbchyNXg`
   * all answer 200 and their `<h1>` is the row's own title. So a row goes to `/watch-video/?v=<id>` and the
   * reader stays inside, where the page can say what the archive holds about the film. **The design's six
   * example films are not affected by this**: they are 404 at `/watch-video/?v=` and this block never named
   * them — the archive's own topic rule replaced them in round 351.
   *
   * ── AND THE META LINE CARRIES ONLY WHAT THE ARCHIVE KNOWS ─────────────────────────────────────────
   *
   * The design's card fills its small-caps slot with `Archive film · Plays on this page`, and the second half
   * of that is FALSE for a row: a row navigates rather than playing in place, so the claim is dropped rather
   * than copied. The topic is the block's own heading, so repeating it on every row would be noise. What is
   * left is the one fact the archive holds about each of these films that the block does not already say —
   * how many records carry it, from `f.records`, in the same sentence the facts line above uses. **No
   * publisher, no duration and no claim about playing anywhere are written, because the archive records none
   * of them.** The repetition of that sentence across rows is the design's own behaviour, not an oversight:
   * `renderFilmCard` prints one fixed meta line on every archive card.
   *
   * ── THE THUMBNAIL, AND WHAT A ROW SHOWS WHEN IT FAILS ─────────────────────────────────────────────
   *
   * `https://i.ytimg.com/vi/<id>/hqdefault.jpg` is the design's own convention — `renderFilmCard` above and
   * the design's `watch.html` both use it — and `next.config.ts` names `i.ytimg.com` in `img-src`. **But this
   * fill derives the address from an id rather than fetching it, so it cannot know whether the film is still
   * there — and the markup alone cannot carry that either.** So the `<img>` is given three things the design's
   * own card does not need, and each was decided from a measurement rather than from a guess:
   *
   *   * `alt=""`. The film's own title is the text immediately beside the poster, so the image is decorative
   *     and a failure must not print the title a second time as alt text.
   *   * **`onerror="this.remove()"`** — the fetch that cannot be made at all: a reader offline, a blocked host,
   *     a network that gives up. **Measured in Chrome, `alt=""` alone still leaves the browser's broken-image
   *     icon painted in the frame**, which is the fault this exists to remove; removing the element removes it.
   *   * **`onload="if(this.naturalWidth&lt;320)this.remove()"`** — YouTube's own answer to an id it no longer
   *     holds. **Measured: `hqdefault.jpg` for an unknown id answers 404 with a 120x90 grey placeholder JPEG,
   *     and Chrome PAINTS it**, so without this the row would show a grey rectangle where a film should be.
   *     Every poster the archive actually draws was measured at **480x360**, so 320 has a fourfold margin and
   *     a poster below it is not a poster.
   *
   * With the `<img>` gone, the design's own `--night-2` frame and its gold hairline remain — sized by
   * `.sx-video-thumb`'s `aspect-ratio: 16/9`, not by the image — and the label that frame carries behind the
   * image becomes the only thing painted: **a designed dark frame that says `No thumbnail`. Never a
   * broken-image icon, never a grey platform placeholder, never an empty hole.** See `watch-video.css`, where
   * the label is the `::after` of the same frame and the image is given the stacking position that covers it
   * while it is on screen.
   *
   * **THE HANDLER IS INLINE AND ADDS NO SCRIPT TAG.** This page loads `mobile-nav.js` and nothing else, and
   * `script-src 'self' 'unsafe-inline'` in `next.config.ts` admits an inline handler — the pattern this
   * repository already uses, and `scripts/verify-round-344.mjs` counts one as a wired control.
   */
  const heldBy = (count: number): string =>
    count > 1 ? `Held in ${count} Ozikoro archive records` : 'Held in one Ozikoro archive record';
  const relatedBody = siblings.length > 0
    ? siblings
        .map((f) =>
          `<a class="sx-video-row" href="/watch-video/?v=${esc(f.id)}">`
            + `<span class="sx-video-thumb">`
            + `<img src="https://i.ytimg.com/vi/${esc(f.id)}/hqdefault.jpg" alt="" width="128" height="72" loading="lazy" onerror="this.remove()" onload="if(this.naturalWidth&lt;320)this.remove()">`
            + `</span>`
            + `<span class="sx-video-row-copy">`
            + `<span class="sx-video-row-title">${esc(f.title)}</span>`
            + `<span class="sx-video-row-meta">${heldBy(f.records)}</span>`
            + `</span></a>`
        )
        .join('')
    : `<p style="margin-top:var(--s-3)">The archive holds no other film filed under this topic, so this list `
      + `is not filled from elsewhere.</p>`;
  out = out.replace(
    /<section[^>]*\bid="transcript"[^>]*>[\s\S]*?<\/section>/,
    `<section class="sx-transcript"><div class="wrap">`
      + `<div class="sx-transcript-copy" id="related-video" style="scroll-margin-top:6rem">`
      + `<p class="eyebrow">Related viewing</p>`
      + `<h2 style="margin-top:.4rem">${
          siblings.length > 0
            ? `More films under ${esc(topicName!)}`
            : topicName
              ? `No other film under ${esc(topicName)}`
              : 'Related viewing'
        }</h2>`
      + `${siblings.length > 0 ? `<div style="margin-top:var(--s-3)">${relatedBody}</div>` : relatedBody}`
      + `</div></div></section>`
  );
  // The film itself is a target too — the design's own skip link names it — and it lands the same way.
  out = out.replace(/<section([^>]*\bid="video"[^>]*)>/, (_m, attrs: string) => `<section${attrs} style="scroll-margin-top:6rem">`);

  /*
   * AND NOTHING POINTS AT WHAT IS NO LONGER THERE.
   *
   * The design's own header nav carries `<a href="#transcript">Transcript</a>`, which `designScreenLinks` has
   * already made absolute to this page by the time this fill runs. **Removing the section without this would
   * leave a control that looks pressable and does nothing** — the fault class this page was fixed for in round
   * 344 — so the anchor is pointed at the block that replaced the section, and it takes the design's own name
   * for that block. The match requires the closing quote, so `#transcript-copy` cannot be caught by it.
   *
   * THE LABEL IS `Related viewing` BECAUSE THAT IS THE DESIGN'S OWN NAME FOR WHAT IT NOW REACHES, and because
   * **the design never gives a nav item and the eyebrow it lands on the same shape of name**: its nav reads
   * `Transcript` and `Related viewing`, and its eyebrows read `Transcript-first view` and `Related viewing`. The
   * collision the owner reported came from round 351 renaming BOTH ends to `Reading view` — nav item and
   * eyebrow — which the design never did. Matching the nav item to the block it jumps to is the design's own
   * pattern, not a new one: the design draws exactly that pairing for this block in its "On this page" nav.
   *
   * This runs after the replacement, so the only `#transcript` left in the document is the header's.
   */
  out = out.replace(
    /(<a\b[^>]*\shref="[^"]*)#transcript(">)[^<]*(<\/a>)/g,
    (_m, before: string, close: string, end: string) => `${before}#related-video${close}Related viewing${end}`
  );

  // The document's own title and description, which are what a search result and a browser tab show.
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${title} — Watch — Ozikoro</title>`);
  out = out.replace(
    /(<meta name="description" content=")[^"]*(")/,
    `$1Watch ${title}, with the record that holds it and the archive’s related films.$2`
  );
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * THE FOLKLORE READER
 * ---------------------------------------------------------------------------------------------- */

/** One published story, as the reader page needs it. */
export type RealStoryPage = {
  title: string;
  topic: string | null;
  author: string | null;
  published: string | null;
  image: string | null;
  imageAlt: string;
  /** The record's own opening paragraph, or an honest line where the archive holds none. */
  lead: string;
  /** The rest of the record's prose. */
  body: string;
  /** The record's permanent path, for the citation. */
  path: string;
  reference: string;
  related: { title: string; href: string }[];
};

/**
 * `/folklore-reader/` — a story read like a chapter.
 *
 * The design's own banner is precise about what is real: *"the title and photograph are from live Ozikoro; the
 * sample text is not the published story."* **So the story is real and the words are not, which is the worst
 * combination** — a reader who came for a story gets a paragraph about the interface.
 *
 * This fills it with the published record's own first paragraph and the rest of its prose, on the same frame,
 * and **removes the listen panel**, because the archive holds no audio: a play button that answers with silence
 * is worse than no button, which is the rule the article fill already follows.
 */
export function fillFolkloreReader(html: string, s: RealStoryPage): string {
  let out = clearExampleMaterial(html);

  out = out.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/, `$1${esc(s.title)}$2`);
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(s.title)} — Ozikoro folklore reader</title>`);

  if (s.image) {
    out = out.replace(/(<img[^>]*\ssrc=")[^"]*(")/, `$1${esc(s.image)}$2`);
    out = out.replace(/(<img[^>]*\salt=")[^"]*(")/, `$1${esc(s.imageAlt)}$2`);
  }

  // The frame says whose story this is and where it comes from.
  out = fillContainer(
    out,
    /<div class="sx-folk-reader-meta"[^>]*>/,
    `<p class="eyebrow">${esc(s.topic ?? 'Folklores')} · published record <code>${esc(s.reference)}</code></p>
        <p class="small muted">${s.author ? `Written by <strong>${esc(s.author)}</strong>` : 'Author not recorded'}${s.published ? ` · published ${esc(s.published)}` : ''}. The words below are the record's own, as published on ozikoro.com.</p>`
  );

  /*
   * THE WORDS. Into the design's own reading column, with the story's own first paragraph in the opening slot
   * and the rest of it after — the same shape the article fill uses, because it is the same job.
   */
  out = fillContainer(
    out,
    /<div class="sx-reading-columns"[^>]*>/,
    `<div class="prose"><p class="dropcap">${s.lead}</p>${s.body}</div>`
  );

  /*
   * NO AUDIO BUTTON. The archive holds no recording — `audio` is 0 rows and every media record is an image,
   * a film or a document — so the panel the design drew would offer a player with nothing behind it. The
   * design's own note anticipates the filled state: "A published recording would include speaker, rights and
   * transcript details."
   */
  out = out.replace(/<section class="sx-listen-panel"[\s\S]*?<\/section>/, '');

  // The record's own provenance, where the design puts its source table.
  out = fillContainer(
    out,
    /<section class="sx-story-record"[^>]*>/,
    `<p class="eyebrow">Story record</p>
        <p class="small muted">Reference <code>${esc(s.reference)}</code> · permanent address <a href="${esc(s.path)}">${esc(s.path)}</a>. Source, teller, language, place, translation and usage permission are stated on the record itself, where the archive holds them, rather than generalised here.</p>`
  );

  // The page-turn nav: real neighbours from the same topic, or an honest line that there are none.
  out = replaceContainer(
    out,
    '<nav class="sx-page-turn"',
    s.related.length
      ? s.related
          .map((r) => `<a href="${esc(r.href)}">${esc(r.title)} <span aria-hidden="true">→</span></a>`)
          .join('\n        ')
      : `<p class="small muted">No other story from this topic is published yet.</p>`
  );

  return out;
}

/* ------------------------------------------------------------------------------------------------
 * A TOWN
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/town/` — the town archive.
 *
 * **The design's town is `Igbodo`, with three example articles and a heading that reads "Town archive
 * demonstration".** This archive holds 188 published towns and clans, and **197 of its 1,051 published
 * records are linked to a place**, so a town page has real material — but there is no way to know which town
 * a reader wanted at `/town/` itself, so the register is what this page carries.
 *
 * The three example histories are not carried over. What replaces them is the real thing the page is for: the
 * places the archive holds, each with the number of linked records, so a reader can choose one.
 *
 * ── THE SENTENCE THIS PAGE LEFT STANDING, AND WHY IT WAS THE FAULT THE OWNER REPORTED ───────────
 *
 * The hero, the lede and the `#records` section were all rewritten to say what this page is. **The heading
 * over the list was not**, so the served page read:
 *
 *     Histories about Igbodo
 *     Umunri · 16 linked records
 *     Mbanasato · 12 linked records
 *     Aro · 11 linked records
 *     … twenty-four of them
 *
 * The owner's report is that page, reached by clicking the front page's Igbodo tile, and it is worth quoting
 * because it names every part of the fault: *"why is the homepage showing that when you click on igbodo, and
 * then also show me links to other clans and towns, instead of showing me articles relating to the igbodo?"*
 * **The answer was a heading the fill had not reached, over a list drawn in the wrong shape.**
 *
 * ── AND THE LIST WAS IN THE WRONG SHAPE TOO ─────────────────────────────────────────────────────
 *
 * The design's `sx-town-articles` is a row of cards — `<a href><small>…</small><strong>…</strong>
 * <span>…</span></a>` — and `showcase.css` styles exactly that (`a` as a grid, `small` as the gold caps
 * line, `strong` as the serif name, `span` as the emerald call to action). The fill put
 * `<article class="entry"><h3><a>…</a></h3><p>…</p></article>` inside it instead, and `.sx-town-articles a`
 * is a DESCENDANT selector: every name inside every entry was drawn as a card row with its own padding and
 * its own rule, on top of `.entry`'s own border. So the list was also not the design's list.
 *
 * Both are fixed here. The cards are the design's markup, and the heading says what the list is.
 *
 * The section's own `id` is kept as `histories`, because the aside's on-this-page nav points at it and an
 * `id` is an address; only the words a reader sees change.
 */
export function fillTown(html: string, d: { towns: { name: string; href: string; region: string | null; records: number }[]; total: number }): string {
  let out = clearExampleMaterial(html);
  /*
   * THE HERO NAMED ONE EXAMPLE TOWN AND ONE EXAMPLE PHOTOGRAPH.
   *
   * "Town archive demonstration / Igbodo / A single place page gathers every related history…" is the design's
   * illustration, with a photograph borrowed from an unrelated article. This address is the REGISTER rather
   * than a town, so the hero says that, and no town's name or picture is borrowed for it.
   */
  out = out.replace(/<p class="eyebrow"[^>]*>[^<]*<\/p>/, '<p class="eyebrow">The town and clan register</p>');
  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '<h1>Towns and clans in the archive</h1>');
  out = out.replace(
    /<p class="lede"[^>]*>[\s\S]*?<\/p>/,
    `<p class="lede">The register holds ${n(d.total)} towns, clans and communities. Choose one to see every history, image and document connected to it — a single place page gathers them in one address instead of opening one article at a time.</p>`
  );
  // The borrowed hero photograph, which illustrates no town in particular, goes rather than standing in for one.
  out = out.replace(/<section class="sx-town-hero">\s*<img[^>]*>/, '<section class="sx-town-hero">');
  const list = d.towns.length
    ? d.towns
        .map(
          (t) =>
            `<a href="${esc(t.href)}"><small>${esc(t.region ?? 'Region not recorded')} · ${t.records > 0 ? `${n(t.records)} linked ${t.records === 1 ? 'record' : 'records'}` : 'No record linked yet'}</small><strong>${esc(t.name)}</strong><span>Open the place page <span aria-hidden="true">→</span></span></a>`
        )
        .join('\n          ')
    : `<p class="small muted">No town or clan is published in the register yet.</p>`;

  /*
   * THE HEADING WAS THE FAULT. It sat in the design's own `#histories` section and named the design's one
   * example town, over a list of the archive's places — see the note above the function.
   */
  out = fillContainer(
    out,
    /<section id="histories"[^>]*>/,
    `<div class="sx-head">
          <div>
            <p class="eyebrow">The register</p>
            <h2>Places in the register</h2>
          </div>
        </div>
        <div class="sx-town-articles">
          ${list}
        </div>`
  );
  // The aside's first entry names the same section, so it carries the same word rather than the old one.
  out = out.replace('<a href="#histories">Histories</a>', '<a href="#histories">Places</a>');
  out = fillContainer(
    out,
    /<section class="section"[^>]*id="records"[^>]*>/,
    `<p class="small muted">The register holds ${n(d.total)} towns and clans. Choose one above to see the histories, photographs and documents connected to it — a place with no linked record says so rather than being given an example one.</p>`
  );
  return out;
}
