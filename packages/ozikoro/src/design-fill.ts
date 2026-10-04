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
    : 'Held in the Ozikoro archive · publisher not recorded';
  return `<button type="button" class="sx-video-card" data-video-id="${id}" data-video-title="${title}" data-video-meta="${meta}" aria-pressed="false"><span class="sx-video-thumb"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Thumbnail for ${title}"><span class="sx-video-play" aria-hidden="true">▶</span></span><span class="sx-video-meta">${category} · Plays on this page</span><h3>${title}</h3><p>${provenance}</p></button>`;
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
 */
export function fillWatch(html: string, films: RealFilm[]): string {
  let out = dropExampleFlag(html);
  const openTag = '<div class="sx-video-grid">';
  const start = out.indexOf(openTag);
  if (start === -1) return out;
  const open = start + openTag.length;
  let depth = 1, i = open;
  while (i < out.length && depth > 0) {
    const nextOpen = out.indexOf('<div', i);
    const nextClose = out.indexOf('</div>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen + 4; }
    else { depth -= 1; i = nextClose + 6; }
  }
  // De-duplicated against the WHOLE document rather than this grid alone: the design's second grid is a film
  // list too, and a film standing in both places would be one film with two cards.
  const shown = new Set([...out.matchAll(/data-video-id="([^"]*)"/g)].map((m) => m[1]));
  const added = films.filter((f) => !shown.has(f.id));
  if (added.length === 0) return out;
  const close = i - 6;
  const inner = added.map(renderFilmCard).join('\n  ');
  out = out.slice(0, close) + '\n  ' + inner + '\n' + out.slice(close);
  return out;
}

/** Replace every occurrence of a container's inner content, matched by balanced depth. */
function replaceContainer(html: string, openTag: string, inner: string): string {
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

/** A recording in the listen library. */
export type RealTrack = { title: string; href: string; series: string; image: string | null; length: string | null };

/** One track row, in the design's `a.sx-track` markup. */
export function renderTrack(index: number, t: RealTrack): string {
  const n = String(index).padStart(2, '0');
  const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : '';
  // The design wraps each track in an `<li>` inside `<ol class="sx-tracklist">`, so the row and its wrapper
  // are emitted together. Dropping the `<li>` would leave the list's own counters with nothing to number.
  return `<li><a class="sx-track" href="${esc(t.href)}"><span class="sx-track-no">${n}</span>${img}<span class="sx-track-main"><strong>${esc(t.title)}</strong><small>${esc(t.series)}</small></span><span class="sx-track-len">${esc(t.length ?? 'Read')}</span><span class="sx-track-play" aria-hidden="true">▶</span></a></li>`;
}

/**
 * Fill `listen.html`'s track list.
 *
 * **A recording is not invented here.** The design's example rows claim a length ("Sample") and a play control.
 * The archive holds 13 video records and **no audio**, so nothing is presented as a recording: each row links
 * to the written record it belongs to, and the length column says `Read` rather than a duration nobody
 * measured. **The moment a real recording exists, this is the function that changes.**
 */
export function fillListen(html: string, tracks: RealTrack[]): string {
  let out = dropExampleFlag(html);
  const rendered = tracks.map((t, i) => renderTrack(i + 1, t)).join('\n          ');
  // `<ol class="sx-tracklist">`, not a div — the container is the list the design numbers.
  out = replaceContainer(out, '<ol class="sx-tracklist"', rendered);
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
    const first = (e.name.trim()[0] ?? '#').toUpperCase();
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
  return out.slice(0, first) + blocks + out.slice(end);
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

/** One collection card. */
export type RealCollection = { label: string; name: string; href: string; cta: string; image: string | null; glyph: string | null };

/** One collection card, in the design's `a` markup inside `.sx-collection-showcase`. */
export function renderCollection(c: RealCollection): string {
  // The design uses a photograph on some cards and a glyph on others; whichever the archive can supply.
  const visual = c.image
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
  const fix = (url: string) => resolve(url) ?? url;
  return body
    .replace(/(<img[^>]*?\ssrc=")([^"]+)(")/g, (_m, a, url, c) => a + fix(url) + c)
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

    // The design's last line becomes the disclosure, the credit and the transcript.
    out = out.replace(
      /(<p class="small muted">)[\s\S]*?(<\/p>)(\s*<\/section>)/,
      `$1${esc(a.episode.disclosure)}$2` +
        `<p class="small muted"><a href="/podcast/${esc(transcriptSlug)}/transcript.txt">Read the transcript</a>` +
        `${a.episode.narratorName ? ` · ${esc(a.episode.narratorName)}` : ''}` +
        `${!a.episode.directAudio && service ? ` · Audio held on ${esc(service)}, not by this archive` : ''}</p>$3`
    );
  } else {
    // **No approved episode, so no button.** The panel goes rather than sitting there inert.
    out = out.replace(/<section[^>]*\bid="listen"[^>]*>[\s\S]*?<\/section>/, '');
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
  // The featured image goes in the design's own figure; the body is tidied so it does not repeat it, and so
  // its WordPress widths do not run past the reading column.
  const body = tidyBody(resolved, a.image);

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
  const refs = extractReferences(body);
  const rest = refs.length > 0
    ? body.replace(/<h[2-4][^>]*>\s*(?:\d+\.\s*)?(?:references?|sources?|bibliography|works cited|further reading)[^<]*<\/h[2-4]>[\s\S]*$/i, '')
    : body;
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
    const items = a.related
      .map(
        (r) =>
          `<a href="${esc(r.href)}">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}<small>${esc(r.topic ?? 'From the archive')}</small><strong>${esc(r.title)}</strong></a>`
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
 */
export function fillDocuments(html: string, docs: RealDocument[]): string {
  let out = dropExampleFlag(html);
  const rendered = docs.map(renderDocument).join('\n        ');
  out = replaceContainer(out, '<div class="sx-pdf-grid"', rendered);
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
   * THE ACADEMY'S COURSES ARE DELIVERED ON ANOTHER HOST, AND THE SCREEN SAYS SO.
   *
   * `academy.html` prints "Delivered at learn.ozituma.com · enrolment opens there" directly above the
   * course list, and every course title is a placeholder `href="#"`. **The page itself names the address,
   * and it answers** — measured with curl before it was written down. This is not the dashboard's
   * `Learning` item, which promises a catalogue inside this site and is still `NOT BUILT`; it is the one
   * destination the academy screen states in its own words.
   */
  'Igbo from the beginning': 'https://learn.ozituma.com/',
  'Reading and writing with tone marks': 'https://learn.ozituma.com/',
  'The market week, title and kinship': 'https://learn.ozituma.com/',
  'Recording and transcribing oral testimony': 'https://learn.ozituma.com/',
  'Your name, your town, your clan': 'https://learn.ozituma.com/',
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
  Learning: 'the academy’s course catalogue for this site; learn.ozituma.com is a separate application',
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
  'Open on YouTube ↗': 'the inline player’s own film; the player is opened by script and no film is playing',
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
   * 4. THE DESIGN'S RELATIVE LINKS, MADE ABSOLUTE.
   *
   * Every dashboard writes its own links the way the walkthrough needs them — `dashboard-account.html`,
   * `home.html`, `../styles/main.css` — because in the deliverable they sit beside each other on disk.
   * Served at `/dashboard-reader` they resolve to `/dashboard-account.html`, which the middleware answers;
   * **served at `/dashboard-reader/`, with the trailing slash the site serves, the browser resolves them
   * against `/dashboard-reader/` instead and every one of them 404s.** Measured: 27 links to `home.html`
   * and 27 to `dashboard-account.html` across the fourteen screens, all dead at the second address.
   *
   * A `<base href="/">` is the one-line fix that is right for a screen whose every relative link is
   * relative to the site root, and the design's files are not touched to make it. These two rewrites cover
   * the links the sidebar and the top bar put beside them, and **both are relative-aware: the lookbehind
   * stops the second rule from shortening an address the first rule has already made absolute.**
   */
  out = out.replace(/<head>/, '<head><base href="/">');

  // `../styles/main.css` and `../screens/style.css` -> `/styles/main.css`. The deliverable's own assets,
  // and the middleware serves them from there.
  out = out.replace(/href="\.\.\/((?:styles|screens)\/[^"]+)"/g, 'href="/$1"');

  /*
   * THE SCRIPTS WERE THE HALF NOBODY REWROTE, AND THEY ARE THE WHOLE PAGE ON SOME SCREENS.
   *
   * Styles were rewritten and scripts were not, so with `<base href="/">` in the head a screen serving
   * `src="../market-days.js"` asked for `/market-days.js` and got a 404. **The page then sat on the
   * design's own placeholder — "Today — Loading date…" — forever, because nothing had been replaced.**
   * It reads as a page that is still loading rather than a page that is broken, which is why it
   * survived every check: the HTML is well-formed, the status is 200, and the only thing missing is
   * a number a script was going to put there.
   *
   * Measured across the deliverable: `../market-days.js` on about, academy, careers, cite, collections
   * and others; `../reader.js` and `../mobile-nav.js` on the article screens. Every one of them 404'd.
   * The files live at `/design/<name>.js` and the middleware serves them from there.
   *
   * The lookbehind-free pattern is deliberate: these are simple sibling references and the deliverable
   * writes no script with a path segment in it, so a bare filename is the whole grammar.
   */
  out = out.replace(/src="\.\.\/([^"/]+\.js)"/g, 'src="/design/$1"');

  /*
   * THE RELATIVE SCREEN LINKS BECOME THE ADDRESSES THE SITE ACTUALLY SERVES.
   *
   * Each of these is a design screen whose own page is not the page the link promised: the design's
   * `dashboard-account.html` IS the account screen, and its address on this site is `/account/`.
   * **`/dashboard-account/` also answers — it serves the design's screen — so a generic rewrite would
   * look as though it worked while sending every "Account settings" link on the site to a dashboard
   * instead of to the account.**
   */
  const screenLinks: Record<string, string> = {
    'home.html': '/',
    'dashboard-account.html': '/account/',
    'dashboard-states.html': '/dashboard-states/',
    // The design's own name for the archive index is not an address this site serves. `/archive-index/`
    // answers only because the middleware rewrites it to this route — **a link that reaches the design
    // screen rather than the archive**, and the archive's own page is one segment away.
    'archive-index.html': '/archive/',
    /*
     * `researcher-profile.html` IS ONE PERSON'S PAGE AND EVERY LABEL ON IT IS A DIRECTORY'S.
     *
     * The design's profile screen is a demonstration of a profile, and the person in it — "Dr Chinwe
     * Ị̀kẹ̀jìànị̀", with an invented institution, ORCID and seven papers — does not exist. `fillResearcherProfile`
     * serves that screen as **one real contributor**, which is right for a profile and wrong for a directory.
     *
     * Measured across the deliverable: **twenty anchors in nine screens name this file, and seventeen of them
     * say *Researchers*, *Researcher profiles* or *Researchers and publications*.** The directory's address is
     * `/researchers/`, it is served by the application's own route, and the design's own breadcrumb already
     * points there (`fillResearcherProfile` writes it). Without this entry the fallback below resolved all
     * seventeen to `/researcher-profile/` — **which answers 200 with one stranger's profile.** That is the
     * owner's report: "on the menu, the 'Researchers' is not working, it is dead link." It was not dead. It
     * reached the wrong page, and a 200 is what let it survive every check.
     *
     * The remaining three anchors name the design's example person: two bylines and a citation on the design's
     * one publication record. They resolve here with the rest, because **the archive holds no such person and
     * a link to the directory is honest where a link to a stranger is** — and on the screen they are written
     * on, `fillPublicationRecord` removes them outright: there is no publication to carry a byline or a
     * citation, and the page says so.
     */
    'researcher-profile.html': '/researchers/',
  };
  /*
   * THE SUFFIX IS CARRIED, AND THAT IS NOT A DETAIL.
   *
   * The design links to `about.html#terms` thirteen times, `upload.html#community-knowledge` three times and
   * `projects.html?status=ongoing` once. The earlier pattern required the closing quote straight after
   * `.html`, so **every one of those links kept its relative address** — and once the served page's head lost
   * its `<base>` (see `withSeoHead`), they resolved to `/archive-index/about.html#terms` and 404'd while
   * looking exactly like working links in the source.
   *
   * The fragment or query is preserved and appended to the resolved address, because `upload.html#community-knowledge`
   * promises a *section of the upload page* and dropping the fragment would land the reader at the top of it.
   */
  out = out.replace(
    /href="(?!\/|https?:|#|mailto:|tel:)([a-z0-9-]+\.html)((?:[?#][^"]*)?)"/g,
    (_m, file: string, suffix: string) =>
      `href="${screenLinks[file] ?? `/${file.replace(/\.html$/, '')}/`}${suffix}"`
  );

  /*
   * AN `aria-current="page"` THAT NAMES ANOTHER PAGE GOES.
   *
   * The rule above has just turned the nav's `Researchers` item into a link to `/researchers/` — **the
   * application's directory, which no design screen serves.** Three of the design's screens had marked that
   * item `aria-current="page"`: `publication.html`, `researcher-profile.html` and `upload.html`. The marker
   * was already untrue on the first two, which are a publication record and the deposit form, and it is
   * untrue on the third for the same reason the owner reported the link: `/researcher-profile/` is one
   * person's page, not the directory.
   *
   * `aria-current="page"` means *this link is the page you are on*. A screen reader announces it as the
   * current page, so a marker left on a link that leaves the page is a lie told only to the readers who
   * cannot see that the page did not change. It is removed rather than re-pointed or weakened: the design's
   * menu has no item for a profile, a record or the deposit form, so on those three screens **no item is
   * current, and the honest nav says nothing.**
   */
  out = out.replace(/<a href="\/researchers\/" aria-current="page">/g, '<a href="/researchers/">');

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

  contributors: { slug: string; name: string; records: number; bio: string | null }[];
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
 * A filled `.sx-people` card: a real contributor, a monogram rather than a face.
 *
 * **Not one WordPress author has ever uploaded a profile photograph** (the migration holds the uploads table,
 * and it is empty of avatars), and Gravatar answers the same grey silhouette for every one of them — so that
 * many identical grey figures would be worse than that many initials. The design's own note anticipated exactly this:
 * *"Monogram tiles hold each place until approved portraits are supplied — no stock faces are used."*
 *
 * The record count is counted from the archive, the link is the contributor's own byline page, and the design's
 * borrowed portrait image is dropped rather than tinting every card with the same photograph.
 */
function personCard(c: AboutData['contributors'][number]): string {
  const bio = c.bio?.trim();
  return `<article class="sx-person">
  <div style="position:relative;aspect-ratio:1;overflow:hidden;background:#14261d;border:1px solid var(--rule)" role="img" aria-label="Monogram tile for ${esc(c.name)}: no portrait has been supplied">
    <span aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;font-family:'Noto Serif',serif;font-size:3rem;color:#d8b25a;font-weight:700">${esc(monogram(c.name))}</span>
    <small style="position:absolute;bottom:.5rem;left:.6rem;color:#f6efe0;font-size:.7rem">No portrait supplied</small>
  </div>
  <div class="sx-person-copy">
    <p class="eyebrow">${c.records === 1 ? '1 published history' : `${n(c.records)} published histories`}</p>
    <h3><a href="/author/${esc(c.slug)}/">${esc(c.name)}</a></h3>
    <p class="small muted" style="margin-top:var(--s-2)">${bio ? esc(decodeEntities(bio.slice(0, 240))) : 'No biography on file. Named here by the work alone.'}</p>
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
 *   the portraits are MONOGRAM TILES, because no author on ozikoro.com has uploaded a photograph
 *   what is published is listed with the number beside each kind, so the page cannot overstate its own shelf
 *   the principles keep their wording and gain the numbers that sit behind them — including **0 recorded
 *     licences** — rather than a second, invented set of facts
 *   the institution section is filled with what is known (the company, the three platforms, the record
 *     counts) and states plainly where terms, privacy and partner particulars have not been supplied,
 *     because **a partner reads this page before deciding to work with the archive** (brief §3.6)
 *
 * **Nothing here is typed into a file. Every figure is passed in, counted at render time by the route.**
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
   * 2. THE NOTE ABOVE THEM, WHICH SAID SOMETHING THAT IS NOT TRUE OF THIS RUN.
   *
   * The design's reads *"Biographies below are as published on ozikoro.com. Monogram tiles hold each place
   * until approved portraits are supplied — no stock faces are used."* **The second sentence is right and the
   * first is not phrased as a count**: the archive holds a biography for some of these people and none for the
   * rest, so the note states both numbers and names no one as a "founder" or an "author" who has not been
   * recorded as one.
   */
  const withBio = named.filter((c) => c.bio?.trim()).length;
  out = out.replace(
    /<p class="sx-notice"[^>]*>[\s\S]*?<\/p>/,
    `<p class="sx-notice" style="margin-bottom:var(--s-5)">The people who wrote what is here, in the order of how much of it they wrote. ` +
      `${withBio === 1 ? 'One has' : `${withBio} have`} a biography on file; the other ${named.length - withBio === 1 ? 'one is' : `${named.length - withBio} are`} named by the work alone. ` +
      `Portraits are monogram tiles because <strong>no author on ozikoro.com has uploaded one</strong> — no stock faces are used.</p>`
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
              <li><strong>Publications</strong> — 0 records. The research repository is built and holds nothing yet.</li>
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
  const figureRow = `<div class="sx-metrics" style="margin:var(--s-6) 0">${figures
    .map(
      ([value, label]) =>
        `<article class="sx-metric"><b>${esc(value)}</b><span class="small muted">${esc(label)}</span></article>`
    )
    .join('')}</div>`;
  out = out.replace(/(<section class="wrap sx-mission">[\s\S]*?<\/section>)/, `$1${figureRow}`);

  /*
   * 5. SOURCES AND LICENCES, COUNTED, BESIDE THE PRINCIPLES THAT MAKE THE PROMISES.
   *
   * The design's editorial method is four principles with no numbers. **"Source in view" and "Community terms"
   * are claims, and this archive can say how far it meets them**: 293 published records state their sources,
   * and 0 media items carry a recorded licence. That number belongs on this page rather than in a reader's
   * later disappointment.
   */
  out = out.replace(
    /(<section class="sx-principles">)/,
    `<p class="small muted" style="max-width:64ch;margin-bottom:var(--s-5)">Of ${n(d.published)} published histories, ` +
      `${n(d.sources)} state their sources in the record. The archive holds <strong>${n(d.licences)} recorded licences</strong> ` +
      `for ${n(d.media)} media items: every one is held with its rights basis recorded as unknown and consent as not sought. ` +
      `That is printed here rather than left for a reader to find out later, because it is the archive's largest open problem.</p>$1`
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
              <li><a href="https://learn.ozituma.com/">learn.ozituma.com</a> — courses in Igbo language and culture.</li>
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
function clearExampleMaterial(html: string): string {
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
  const empty = `<div><p class="eyebrow">Open roles</p><h2>No role is open at present.</h2><p>Ozi Ikoro Limited has recorded no vacancy. When one opens, the listing will show the responsibilities, whether the work is remote, the working arrangement, the salary range where one is approved, and the closing date.</p><p class="small muted" style="margin-top:var(--s-3)">This is the archive's actual state rather than a placeholder waiting to be replaced: its register of roles holds ${n(counts.roles)} ${counts.roles === 1 ? 'entry' : 'entries'}.</p></div>`;
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
 */
export function fillCite(html: string, sample: CiteSample | null): string {
  let out = clearExampleMaterial(html);
  if (!sample) return out;
  out = fillContainer(
    out,
    /<div class="sx-cite-examples"[^>]*>/,
    `<p class="small muted" style="margin-bottom:var(--s-3)">The worked example below is the citation this archive generates for a real record — the same text its own page offers under &ldquo;Cite this article&rdquo;. The four formats below it are the design's forms, which are guidance rather than citations of anything.</p>
        <div class="cite-block" style="padding:var(--s-4);background:var(--ochre-wash);border-left:3px solid var(--gold)">
          <p>${esc(sample.citation)}</p>
          <p class="small muted" style="margin-top:var(--s-3)">From <a href="${esc(sample.path)}">${esc(sample.title)}</a>, published on this site. Its address is permanent, so this citation keeps resolving.</p>
        </div>`
  );
  return out;
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
  out = fillContainer(
    out,
    /<div class="sx-proj-grid"[^>]*>/,
    `<p class="small muted">No project is recorded, so there is no register to list here. The six cards the design drew described real work with example figures — town histories, the market-day calendar, the folklore library, oral recordings, digitisation and the Ozituma link-up — and none is reproduced, because there is no record behind any of them.</p>`
  );
  // The filter bar's four states, described rather than drawn as though each had a list behind it.
  out = out.replace(
    /<nav class="sx-filterbar"[\s\S]*?<\/nav>/,
    `<p class="small muted" style="margin-top:var(--s-4)">Filters appear here once there is more than one project to filter. There is not yet one.</p>`
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
    `<div class="sx-notice">No publication has been deposited yet, so none is listed. <strong>The repository is built and empty</strong>: its schema holds a title, an abstract, authors with affiliations, an institution, a kind, a licence, a peer-review flag and the files themselves, and no record has been written into it.</div>
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
        <p class="lede" style="margin-top:var(--s-5)">The research repository is built and holds nothing yet, so there is no paper to read here. The design drew an example one — an invented title, two invented authors and their universities, a 2026 date and a page count — and <strong>none of it is carried over, because none of it is a record.</strong></p>
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

/** One course the Academy really runs, as `learn.ozituma.com` lists it. */
export type AcademyCourse = { title: string; level: string | null; summary: string | null };

/**
 * `/academy/` — courses in Igbo language and culture.
 *
 * THE COURSES ARE REAL; THEY ARE NOT HELD IN THIS DATABASE
 *
 * The design's six course cards carry invented titles and invented lengths — "Twelve weeks", "8 weeks", "3
 * weeks" — and its own banner says so. **The Academy is `learn.ozituma.com`**, a separate application with its
 * own Supabase project, and **this archive's database holds no course at all** — the `learn_course` table here
 * holds the dictionary's own test fixtures, not the Academy's catalogue.
 *
 * So the page is filled from the source that does hold the courses: the Academy's own public site. Its course
 * names are read from there, **with no length and no enrolment date attached**, because those live on the
 * Academy's pages and a number copied to this page would go stale the moment a cohort changed. The design's
 * own link — "Delivered at learn.ozituma.com · enrolment opens there" — is the honest answer and is kept.
 *
 * If the Academy cannot be reached, **the page says that rather than showing the design's example weeks**: an
 * unreachable catalogue is a fact, and "Twelve weeks" is not.
 */
export function fillAcademy(html: string, courses: AcademyCourse[], reachable: boolean): string {
  let out = clearExampleMaterial(html);
  const body = courses.length
    ? courses
        .map(
          (c) =>
            `<article class="card"><div class="chips"><span class="chip">${esc(c.level ?? 'Course')}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.summary ?? 'Course details are on the Academy site.')}</p><p class="small muted">Enrolment, dates and length are shown on <a href="https://learn.ozituma.com/">learn.ozituma.com</a>.</p></article>`
        )
        .join('\n          ')
    : `<article class="card"><div class="chips"><span class="chip">Not listed here</span></div><h3>Courses are held at learn.ozituma.com</h3><p>${
        reachable
          ? 'The Academy is a separate application: it holds the courses, the lessons and the enrolment. Its own published curriculum is not accessible from this archive, so no course title or length is listed here rather than the design\u2019s example ones.'
          : 'The Academy could not be reached while this page was rendered, so no course is listed rather than the design\u2019s example courses.'
      } Enrolment and course dates are on the Academy\u2019s own pages.</p><p class="small muted"><a href="https://learn.ozituma.com/">Open the Academy</a></p></article>`;

  /*
   * THE COURSE GRID IS `#courses .grid-3`, NOT `.spread`.
   *
   * `.spread` holds the section's own heading and its one true sentence — "Delivered at learn.ozituma.com ·
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
   */
  out = out.replace(
    /Courses in Igbo language and culture, taught by speakers and scholars\./,
    `Courses in Igbo language and culture, taught by speakers and scholars, at <a href="https://learn.ozituma.com/">learn.ozituma.com</a>. ` +
      `The Academy is its own application and holds the courses, the lessons and the enrolment. ` +
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
    /**
     * The market-day reckoning this page states, in the same words `/igbo-calendar/` uses.
     *
     * **PASSED IN SO THAT THE TWO SCREENS CANNOT STATE DIFFERENT ANCHORS.** The cycle is computed by the
     * design's own `market-days.js` — this string is only the basis sentence beside it, and a second copy of
     * the wording here would be a second place to be wrong.
     */
    anchor: string;
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
   * `has-event`, no `data-event-*`, no `button` and no `href` — the CSS reads those as "this day has something"
   * and the archive holds 0 events, which the note below the grid still says in the page's own words.
   */
  const marketMonth = `${month.year}-${String(month.monthIndex).padStart(2, '0')}`;
  const days = Array.from(
    { length: daysInMonth },
    (_, i) => `<div class="sx-cultural-day" data-market-day-cell><span>${i + 1}</span></div>`
  );
  /*
   * ================================================================================================
   * AND THE SMALL CORNER OF STYLE THAT MAKES THE LABEL READ AS CONTEXT RATHER THAN AS GRAFFITI
   * ================================================================================================
   *
   * Measured in the browser before this existed: the date and its market day both sat hard against the cell's
   * left edge with nothing between them, because `.sx-cultural-day > span` is `display:block` and the cell's
   * own `padding:.65rem` is written for the BUTTON the design put inside an event date — a plain cell has no
   * padding of its own. **The design's stylesheet is not the place to fix that** (it is inviolable), so this
   * is a served-page style block, exactly as the inert controls' colour is an inline corner of the served page.
   *
   * IT TOUCHES NOTHING THAT HAS AN EVENT: the rule is scoped to `.sx-cultural-day[data-market-day-cell]`, the
   * marker the fill puts only on its plain dates, and the button inside an event date is untouched. **The type
   * scale is the design's own**: the date keeps the cell's inherited size, the market day is the page's `.small`
   * step below it, and `.muted` is the same token the design uses for secondary text. Both are set with
   * `font-size:inherit` on the number and `1em`-relative units on the label, so a change to the design's base
   * size moves both rather than leaving the pair out of step.
   */
  const dayStyle = `<style>
      .sx-cultural-day[data-market-day-cell]{padding:.65rem}
      .sx-cultural-day[data-market-day-cell]>span,
      .sx-cultural-day[data-market-day-cell]>.sx-cal-market-day{display:block;padding:0}
      .sx-cultural-day[data-market-day-cell]>.sx-cal-market-day{margin-top:.35em;font-size:.78em;line-height:1.2}
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
    out = out.replace(
      /(<h2 data-event-title>)[\s\S]*?(<\/h2>)/,
      '$1No event is recorded$2'
    );
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
      '$1The archive holds no event record, so no date is interactive and none can be selected. Nothing has been invented to fill the calendar, and an event appears only once its organiser, place and source are recorded and verified.$2'
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
   */
  out = out.replace(
    /<a class="btn btn-gold" data-event-story href="cultural-event\.html">Read event story<\/a>/,
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
    /<a class="btn" href="upload\.html">Submit an event<\/a>/,
    '<a class="btn" aria-disabled="true" style="color:var(--on-night-muted);opacity:.8" title="Not built yet — no route on this site accepts an event submission">Submit an event</a>'
  );
  out = out.replace(
    /<a class="btn btn-quiet" href="upload\.html">Suggest a correction<\/a>/,
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
   * THE SENTENCE THAT EXPLAINS THE SCREEN, AND THE ONE THING THE OLD FILL GOT RIGHT TO REWRITE.
   *
   * It is a RULE — "only dates with event entries are interactive" — and a rule is true in every month. The
   * old fill replaced it with a statement about today, which was honest and still worth having, so both are
   * kept: the rule first, then what it means for the month on screen.
   */
  out = out.replace(
    /Only dates with event entries are interactive\./,
    month.events === 0
      ? 'Only dates with event entries are interactive. No date in this month has an entry, so every date above is a plain date.'
      : 'Only dates with event entries are interactive.'
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
   * WHAT IT SAYS ABOUT ITSELF, IN ONE BREATH
   *
   * A stamp reading "Nkwọ" over today's date reads as a fact about the reader's own town, and it is not one:
   * **it is one archive's demonstration from a fixed anchor, and a community keeping a different anchor keeps
   * a different market day.** `fillIgboCalendar` already states that for `/igbo-calendar/`, and the sentence
   * is carried here rather than dropped for space — because the space is the reason not to drop it.
   */
  const marketDay = `
      <aside class="wrap" style="margin-top:var(--s-6)">
        <div class="spread" style="gap:var(--s-3)">
          <p class="eyebrow" style="margin:0">Today&rsquo;s Igbo market day</p>
          <p style="margin:0"><strong data-market-day>Market day</strong><span class="small muted"> · <time data-modern-date>Today</time></span></p>
        </div>
        <p class="sx-source-note small" style="margin-top:var(--s-3)">A demonstration reckoning from a fixed anchor — ${esc(month.anchor)} — not a claim that every Igbo community uses the same one. <a href="/igbo-calendar/">The Igbo calendar</a> states the basis in full.</p>
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

/*
 * ================================================================================================
 * THE CALENDAR ACCOUNT ON THE IGBO CALENDAR PAGE, AND WHERE IT CAME FROM
 * ================================================================================================
 *
 * WHY THIS IS DATA RATHER THAN PROSE IN A TEMPLATE
 *
 * The owner sent the full text of Wikipedia's "Igbo calendar" article and asked for it on this page:
 * *"you should also at the igbo calendar page itself and update more information there … find a way to put
 * these things below there."* **It is a tertiary source describing a real cultural system, and this archive
 * never presents a source's account as its own description.** So every claim below carries the reference the
 * article itself cites for it, and the tables are built from these constants rather than typed into markup —
 * a month whose Gregorian range and whose cited reference belong together is one value, not two places to
 * drift apart.
 *
 * WHAT THE `note` FIELD IS, AND WHY IT IS NOT DECORATION
 *
 * **`note` is the article's own description of the month, and it is edited for length only.** Where the
 * article's sentence is substantially longer the shortened form stays close to its wording on purpose: a
 * paraphrase of a tertiary source is a second layer of interpretation over it, and the page's provenance
 * statement is worth less if the reader cannot see whose words they are reading. The full text of each is at
 * the article, which the sources section links to.
 *
 * THE NRI PATTERN, WHICH KEEPS THIS MATERIAL FROM BECOMING "THE IGBO CALENDAR"
 *
 * The article's "Months and meanings" section opens by saying it describes **the Nri-Igbo calendar of the Nri
 * kingdom, "which may differ from other Igbo calendars in terms of naming, rituals, and ceremonies
 * surrounding the months."** That sentence is built into the data as `nri` rather than trusted to be carried
 * by the surrounding markup, and the table states the scope again in a caption, because a heading can be
 * scrolled past and a caption is read with the table.
 */
type CalendarMonth = {
  /**
   * The article's "Months and meanings" section, which the article says is the Nri-Igbo calendar of the Nri
   * kingdom. **The name and Gregorian range are the article's system table, which cites Onwuejeogwu (1981);
   * the meaning is Nri's.** Keeping the two apart is the difference between "the Igbo calendar has 13 months
   * called these" and "Nri calls its months these, and the names in the system table are Onwuejeogwu's".
   */
  nri: true;
  /** A one-line statement of where the meaning comes from, printed beside it. */
  src: string;
  name: string;
  dates: string;
  /** The article's own description of the month, shortened. */
  note: string;
};

const CALENDAR_MONTHS: CalendarMonth[] = [
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Mbụ',
    dates: 'February–March',
    note: 'The first month starts from the third week of February, making it the Igbo new year. The article records that the Nri-Igbo year corresponding to 2012 was initially slated to begin with the Ịgụ Arọ festival on 18 February, an Nkwọ day, and that in the event the festival was held in March.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Abụọ',
    dates: 'March–April',
    note: 'Dedicated to cleaning and farming.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ife Eke',
    dates: 'April–May',
    note: 'Described as the fasting period, usually known as “Ugani”, meaning “hunger period”. The article says all must fast in sacrificial harmony to the goddess Ani of the Earth, and that many communities host competitive wrestling events in this month.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Anọ',
    dates: 'May–June',
    note: 'When the planting of seed yams begins. The article adds that in many communities this is the month of the Ekeleke dance festival, which it describes as emphasising optimism through hardship.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Agwụ',
    dates: 'June–July',
    note: 'The article says Ịgọchi na mmanwụ, adult masquerades, come out in this month, and that Ọnwa Agwụ is the traditional start of the year. The Alusi Agwu, after whom the month is named, is venerated by the Dibia in this month.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ifejiọkụ',
    dates: 'July–August',
    note: 'Dedicated to the yam deity Ifejiọkụ and to Njoku Ji, with yam rituals performed for the New Yam Festival.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Alọm Chi',
    dates: 'August–early September',
    note: 'The harvesting of the yam. The article also describes it as a time of prayer and meditation for women, dedicated to reconnecting with the ancestors by breaking kola, and to venerating mothers and motherhood. The Alọm Chi is a shrine or memorial a woman builds in honour of her ancestors.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ilọ Mmụọ',
    dates: 'late September',
    note: 'A festival the article calls Önwa Asatọ, the Eighth Month, is held in this month.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ana',
    dates: 'October',
    note: 'Ana, or Ala, is the Igbo earth goddess, and the article says rituals for her commence in this month; the month is named after her.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Okike',
    dates: 'early November',
    note: 'The Okike ritual takes place in this month.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ajana',
    dates: 'late November',
    note: 'The Okike ritual also takes place in Ọnwa Ajana, according to the article.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ede Ajana',
    dates: 'late November–December',
    note: 'The article’s entry for this month is two words: ritual ends.',
  },
  {
    nri: true,
    src: 'Wikipedia, Months and meanings',
    name: 'Ọnwa Ụzọ Alụsị',
    dates: 'January–early February',
    note: 'The last month sees the offering to the Alusi.',
  },
];

/**
 * THE SOURCES, AS THEY STAND, WITH WHAT EACH IS CITED FOR.
 *
 * Every entry below is a reference the article itself cites, and each was read from the article's own
 * reference list rather than inferred from a citation marker — **a reference number mapped to the wrong work
 * is a false attribution, and it is the one fault this page cannot afford.** The first two are marked because
 * they matter most: Onwuejeogwu (1981) is the work the article names for the month names and their Gregorian
 * ranges, and Udeani (2007) is the one it names for the timekeepers and for birth-day naming.
 *
 * WHAT IS NOT CLAIMED
 *
 * **The archive holds none of these works.** They are not in `ozikoro_article`, `ozikoro_publication` or any
 * media record, so nothing here has been read at source by this archive — which is why the page says so
 * beside the claims rather than in a footnote. What a reader gets is a faithful description of what one
 * tertiary source says and who it says it after, which is the most this archive can honestly offer for a
 * system it holds no verified community calendar for.
 */
const CALENDAR_SOURCES: Array<{ key?: boolean; citation: string; cited: string }> = [
  {
    key: true,
    citation: 'Onwuejeogwu, M. Angulu (1981). <i>An Igbo civilization: Nri kingdom &amp; hegemony</i>. Ethnographica. ISBN 978-123-105-X.',
    cited: 'The work the article names for the thirteen month names, their Gregorian equivalents, and the intercalary day at the end of the year. Cited at references 2 and 13 of “Igbo calendar” (Wikipedia, revision 1370565297, 18 February 2026).',
  },
  {
    key: true,
    citation: 'Udeani, Chibueze C. (2007). <i>Inculturation as dialogue: Igbo culture and the message of Christ</i>. Rodopi, pp. 28–29. ISBN 978-90-420-2229-4.',
    cited: 'The article’s source for the priests or Dibia as the traditional timekeepers, and for naming children after the day of birth. Cited at reference 4, and again at reference 8 alongside the naming-practice reference.',
  },
  {
    citation: 'Isichei, Elizabeth Allo (1997). <i>A History of African Societies to 1870</i>. Cambridge University Press, p. 247. ISBN 0-521-45599-5.',
    cited: 'Cited at reference 5, alone, for the correspondence between the four days and the four cardinal points.',
  },
  {
    citation: '<i>Aṅụ Magazine</i>. Aṅụ Journal, no. 1, 1979, Cultural Division, Ministry of Education and Information, pp. 79 and 104. LCCN 88659506, ISSN 0331-1937.',
    cited: 'Cited at reference 6, alone, for the four days alternating in “major” and “minor” phases to give a longer eight-day cycle. A single citation with no page-level quotation is the whole of the support this page can report for that claim.',
  },
  {
    citation: 'Onuigbo, Sylvanus Nnamdi (2001). <i>The history of Ntuegbe Nese: A Five-town Clan</i>. Afro-Orbus Publishing Company. ISBN 9789783525368.',
    cited: 'Cited at reference 7 for the article’s most important sentence: that the calendar is “not something written down and followed … rather it is observed in the mind of the people.”',
  },
  {
    citation: 'Ụkaegbu, Jọn Ọfọegbu (1991). <i>Igbo Identity and Personality Vis-à-vis Igbo Cultural Symbols</i>. Universidad Pontificia de Salamanca, Facultad de Filosofia.',
    cited: 'Cited at reference 3 for the attempts to adjust the thirteen-month calendar to twelve, in line with the Gregorian calendar, and for the article’s statement that it has not been easy.',
  },
  {
    citation: 'Akubue, Godwin Boswell (2013). <i>Cow Without Tail, Book 1</i>. Dorrance Publishing. ISBN 9781434915399.',
    cited: 'Cited at reference 12 for the two festivals: Ịgụ Arọ, due around 18 February, and Emume Ọnwa-asatọ in the eighth month.',
  },
  {
    citation: 'Anizoba, Emmanuel Kaanene (2010). <i>Ngü Arö Öka: The Öka Lunar Calendar, 2010–2021</i>. Demercury Bright Printing &amp; Publishing.',
    cited: 'Cited at reference 13 for Imöka being celebrated on the 20th day of the second month.',
  },
  {
    citation: 'Aguwa, Jude C. U. (1995). <i>The Agwu deity in Igbo religion</i>. Fourth Dimension Publishing, p. 29. ISBN 978-156-399-0; and Hammer, Jill (2006). <i>The Jewish book of days: a companion for all seasons</i>. Jewish Publication Society, p. 224. ISBN 0-8276-0831-4.',
    cited: 'Cited jointly at reference 10 for Ọnwa Agwụ being the traditional start of the year.',
  },
  {
    citation: '“Day MASSOB Took Over Nri Kingdom”, <i>The Nigerian Voice</i>, 21 March 2012.',
    cited: 'Cited at reference 9 for the 2012 Ịgụ Arọ and for the article’s report of the 1,013th recorded year of the Nri calendar. A news report of one year’s festival, which is what the article uses it for.',
  },
  {
    citation: '“Izu Igbo Calendar”, izuigbocalendar.com. Retrieved 21 August 2026.',
    cited: 'Cited at reference 1 for the name Ọ̀gụ́àfọ̀ Ị̀gbò. A commercial calendar site, and the article’s only support for that name.',
  },
  {
    citation: '“Naming practice guide UK 2006”, March 2006.',
    cited: 'Cited at reference 8, with Udeani, for the naming practice. A guidance document rather than a study of Igbo naming; the article cites it for the practice as it stood in 2006.',
  },
  {
    citation: 'H.R.H. Silver Ibenye-Ugbala, <i>Igbo Calendar from A.D. 0001 to A.D. 8064: With a Comparative Examination of Gregorian and Other World Calendars</i>.',
    cited: 'The article’s own “General references” list holds this title and nothing further — no publisher, no date and no citation marker anywhere in the text. <strong>This page does not use it, and lists it only because the article carries it and a reader checking the article will meet it.</strong>',
  },
];

/** What the article states, and the article's own section it is stated in, so a claim can be found. */
const CALENDAR_CLAIM_SOURCE: Array<{ claim: string; where: string }> = [
  { claim: 'The names and the Gregorian ranges of the thirteen months', where: 'System — reference 2, Onwuejeogwu (1981)' },
  { claim: 'The intercalary day at the end of the year, in the last month', where: 'System — reference 2' },
  { claim: 'The priests or Dibia as the traditional timekeepers', where: 'System — reference 4, Udeani (2007)' },
  { claim: 'Afọ north, Nkwọ south, Eke east, Orie west', where: 'System — reference 5, Isichei (1997)' },
  { claim: 'Four days alternating in major and minor phases, giving an eight-day cycle', where: 'System — reference 6' },
  { claim: 'The calendar is neither universal nor synchronized', where: 'Lead and Use — reference 7' },
  { claim: '“Not something written down and followed … observed in the mind of the people”', where: 'Use — reference 7, quoted by the article' },
  { claim: 'Naming children after the day of birth: Mgbeke, Mgborie, and the male forms', where: 'Naming after dates — references 4 and 8' },
  { claim: 'The Nri-Igbo calendar of the Nri kingdom, which may differ from other Igbo calendars', where: 'Months and meanings — the article’s own framing' },
  { claim: 'The meaning and ritual of each of the thirteen months', where: 'Months and meanings — each month’s own subsection' },
  { claim: 'Ịgụ Arọ around 18 February, and Emume Ọnwa-asatọ in the eighth month', where: 'Festivals — reference 12' },
  { claim: 'Imöka on the 20th day of the second month', where: 'Festivals — reference 13' },
  { claim: 'The 1,013th recorded year of the Nri calendar, and the 2012 dates', where: 'Festivals and Ọnwa Mbụ — reference 9, a news report of one year' },
  { claim: 'That the day-spirits were fishmongers, created by Chineke to establish a social system', where: 'System — this sentence carries no reference in the article' },
];

/** The same claims, each with the outcome of putting it to the archive's own records. */
const CALENDAR_VERIFIED: Array<{ claim: string; state: boolean; note: string }> = [
  {
    claim: 'That the market week runs Eke, Orie, Afọ, Nkwọ, in that order, with local spellings',
    state: true,
    note: 'The design’s own screen and the archive’s own catalogued record <i>Symbolism of the Four Market Days in Igbo Culture</i> both state the four days and the variants Oye, Afor and Nkwor.',
  },
  {
    claim: 'That the four days are tied to the cardinal points, and that the four-day week is the base unit of the calendar',
    state: true,
    note: 'The archive’s own catalogued record <i>Traditional Igbo calendar and lunar/solar alignments</i> states Eke east, Orie west, Afọ north, Nkwọ south, and states that seven sets of four days (28 days) make one Igbo month.',
  },
  {
    claim: 'That a month is 28 days and a year is thirteen months',
    state: true,
    note: 'The same two archive records state both figures, and the arithmetic is exact: 13 × 28 = 364.',
  },
  {
    claim: 'That Ịgụ Arọ is an Nri year-counting festival tied to the year’s beginning',
    state: true,
    note: 'The archive’s own catalogued records include <i>Igu Aro: The Sacred Proclamation of the Igbo Lunar Year from Nri</i> and <i>Iguaro: The Igbo Calendar, Culture, and Cosmology</i>, which describe the festival as the Eze Nri’s proclamation of the year.',
  },
  {
    claim: 'That the month names are Onwuejeogwu’s, and that the meanings are the Nri kingdom’s',
    state: false,
    note: 'Onwuejeogwu (1981) is not held by this archive and has not been read here. The page reports what the article says the book says.',
  },
  {
    claim: 'The Gregorian equivalents of the thirteen months',
    state: false,
    note: 'Given as ranges against a solar year, and the article states no reckoning that turns a Gregorian day into an Igbo day, month or year. <strong>This page therefore prints no such conversion</strong>, and the market-day view above remains this archive’s own four-day demonstration.',
  },
  {
    claim: 'The rituals, shrines and festivals described under each of the thirteen months',
    state: false,
    note: 'None of this is in the archive. It is one tertiary source reporting the Nri-Igbo calendar, and the article’s own maintenance banner says the article needs more citations.',
  },
  {
    claim: 'The eight-day major and minor cycle',
    state: false,
    note: 'Carried by a single 1979 magazine reference with no quotation, and nothing in the archive supports or contradicts it.',
  },
  {
    claim: 'The date of Imöka, and Ịgụ Arọ as falling around 18 February',
    state: false,
    note: 'One citation each, and neither is checked here. The 18 February date is also reported for a single year, 2012, and a calendar that moves with the moon does not fix a festival to one Gregorian day.',
  },
  {
    claim: 'That the day-spirits were fishmongers created by Chineke to establish a social system',
    state: false,
    note: 'This is a tradition about origins, and the article gives it no reference at all. <strong>It is recorded here as the tradition it is, not as an event.</strong>',
  },
  {
    claim: 'The years of the Nri calendar — the article reports 2012 as its 1,013th year',
    state: false,
    note: 'The article reports this twice, from one news report of one year’s festival, and its own lead says the reckoning is not the same everywhere. The page does not repeat a year number as a fact.',
  },
];

/** Every festival the article names, so a reader can see them as a set rather than scattered in prose. */
const CALENDAR_FESTIVALS: Array<{ name: string; gregorian: string; what: string; src: string }> = [
  {
    name: 'Ịgụ Arọ',
    gregorian: 'around 18 February',
    what: 'The article calls this the Igbo new year festival and the year-counting festival of the Nri calendar: the planting season, when the king, the Eze Nri in the Nri area, tells the Igbo to go and sow their seed after the next rainfall.',
    src: 'Wikipedia, Festivals and Ọnwa Mbụ — references 9 and 12',
  },
  {
    name: 'Emume Ọnwa-asatọ',
    gregorian: 'the eighth month',
    what: 'The harvest festival, described in the article as one of the two major festivals of the calendar.',
    src: 'Wikipedia, Festivals — reference 12',
  },
  {
    name: 'Önwa Asatọ',
    gregorian: 'the month Ọnwa Ilọ Mmụọ',
    what: 'The article calls this the Eighth Month festival, held in the eighth month.',
    src: 'Wikipedia, Months and meanings, Ọnwa Ilọ Mmụọ — no reference of its own',
  },
  {
    name: 'Imöka',
    gregorian: 'the 20th day of the second month',
    what: 'Named in the article’s Festivals section, with that date and no further description.',
    src: 'Wikipedia, Festivals — reference 13',
  },
];

/**
 * Build the material that sits below the design's own content on `/igbo-calendar/`.
 *
 * Kept out of the fill itself so the fill reads as the few edits it makes to the design's markup, and so this
 * block — which is long, and is the part a reader of this file will want to check against the article — can
 * be found and read on its own.
 */
function igboCalendarAddendum(basis: string): string {
  const monthRows = CALENDAR_MONTHS.map((m, i) => {
    const n = i + 1;
    /*
     * THE ROW IS THE CONTROL AND THE PANEL IS THE NEXT ROW.
     *
     * A `<details>` element cannot be a `<tr>`, and putting the control in one cell would leave the Igbo name
     * — the thing a reader comes for — outside it. So the whole row carries the button, and the description
     * is the next row, spanning the table. The button carries `aria-expanded` and `aria-controls` and **both
     * states are written into the HTML rather than set by script, so the descriptions are readable with
     * JavaScript switched off**; a reader without it must not be shown thirteen rows that do nothing.
     */
    return `            <tr id="igbo-month-${n}" class="sx-cal-row">
              <th scope="row"><span class="sx-cal-no">${n}</span> <button type="button" class="sx-cal-month" data-igbo-month="${n}" aria-expanded="true" aria-controls="igbo-month-note-${n}">${esc(m.name)}</button></th>
              <td class="sx-cal-dates">${esc(m.dates)}</td>
              <td class="sx-cal-nri"><span class="sx-cal-tag">Nri-Igbo</span><br><span class="small muted">${m.src}</span></td>
            </tr>
            <tr id="igbo-month-note-${n}" class="sx-cal-note-row">
              <td colspan="3"><p>${esc(m.note)}</p></td>
            </tr>`;
  }).join('\n');

  const sources = CALENDAR_SOURCES.map(
    (s) => `          <dt>${s.key ? '<span class="sx-cal-tag">Named for the month names</span> ' : ''}${s.citation}</dt>
          <dd>${s.cited}</dd>`
  ).join('\n');

  const claimSource = CALENDAR_CLAIM_SOURCE.map(
    (c) => `            <tr><th scope="row">${c.claim}</th><td>${c.where}</td></tr>`
  ).join('\n');

  const verification = CALENDAR_VERIFIED.map((v) => {
    const label = v.state ? 'The archive can substantiate this' : 'Not verified here';
    return `            <tr>
              <th scope="row" class="${v.state ? 'sx-cal-yes' : 'sx-cal-no-state'}">${label}</th>
              <td><p>${v.claim}</p><p class="small muted">${v.note}</p></td>
            </tr>`;
  }).join('\n');

  const festivals = CALENDAR_FESTIVALS.map(
    /*
     * TWO COLUMNS, AND DELIBERATELY NOT FOUR. The Igbo names here run to two words with dotted vowels and tone
     * marks, and a four-column table at 390 px leaves each of them about nine characters wide — so the names
     * would wrap mid-word on the phone this page is read on most. A definition list keeps each name, its
     * Gregorian placement and its source on lines a phone can hold, and lets the description wrap underneath.
     */
    (f) => `          <dt>${esc(f.name)}<span class="small muted"> · ${esc(f.gregorian)}</span></dt>
          <dd><p>${esc(f.what)}</p><p class="small muted">${f.src}</p></dd>`
  ).join('\n');

  /*
   * THE MONTH-ROW TOGGLE.
   *
   * Written as a script rather than left out because **the buttons carry `aria-expanded`, and a control that
   * announces a state it does not have is worse than no control at all.** With the script absent the
   * descriptions are all open, which is the honest state for a page whose script did not load; the script then
   * closes them and makes each button work. So the fallback is "everything readable" rather than "nothing
   * works", which is the direction a progressive enhancement has to fail in.
   *
   * It is inline and namespaced by class, so it touches nothing the design's own scripts look for. Its own
   * element uses `type="button"`, so it cannot submit anything, and every listener is a click on a button —
   * **which makes it work from the keyboard for free, because a button is activated by Enter and Space.**
   */
  const monthToggle = `<script>
        (function () {
          var buttons = document.querySelectorAll(".sx-cal-account .sx-cal-month");
          Array.prototype.forEach.call(buttons, function (button) {
            var panel = document.getElementById(button.getAttribute("aria-controls"));
            if (!panel) return;
            button.setAttribute("aria-expanded", "false");
            panel.hidden = true;
            button.addEventListener("click", function () {
              var open = button.getAttribute("aria-expanded") === "true";
              button.setAttribute("aria-expanded", open ? "false" : "true");
              panel.hidden = open;
            });
          });
        })();
      </script>`;

  return `      <section class="wrap section sx-cal-account">
        <style>
          /* THE ONE PIECE OF CSS THIS PAGE ADDS, AND WHY IT IS HERE RATHER THAN IN THE DESIGN.
             Nothing under public/design/ may change, so a rule this block needs cannot be added to the
             design's stylesheet. Every value below is one of the design's own tokens, so this follows the
             design rather than departing from it. */
          .sx-cal-account h2 { margin-top: var(--s-7); }
          .sx-cal-account h2:first-of-type { margin-top: 0; }
          .sx-cal-account > p { max-width: 74ch; }
          .sx-cal-account .sx-table-wrap { margin-top: var(--s-4); }
          .sx-cal-account .sx-ledger-table caption { padding: var(--s-3) var(--s-4); text-align: left; color: var(--text-muted); font-size: var(--t-sm); }
          .sx-cal-account .sx-ledger-table td p + p { margin-top: var(--s-2); }
          .sx-cal-account .sx-cal-month { padding: 0; border: 0; background: none; color: var(--accent, #0d5c45); font: 600 var(--t-lg) var(--font-serif); text-align: left; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
          .sx-cal-account .sx-cal-month::after { content: " −"; color: var(--ochre, #8a5a2b); font-family: var(--font-sans); font-size: var(--t-base); }
          .sx-cal-account .sx-cal-month[aria-expanded="false"]::after { content: " +"; }
          .sx-cal-account .sx-cal-no { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--t-sm); }
          .sx-cal-account .sx-cal-dates { white-space: nowrap; }
          .sx-cal-account .sx-cal-tag { display: inline-block; padding: .1rem .45rem; border-radius: 999px; background: var(--accent-wash, #e2efe8); color: var(--accent, #0d5c45); font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: var(--ls-caps); }
          .sx-cal-account .sx-cal-note-row td { background: var(--paper-sunk); }
          .sx-cal-account .sx-cal-note-row[hidden] { display: none; }
          .sx-cal-account .sx-cal-yes { color: var(--accent, #0d5c45); }
          .sx-cal-account .sx-cal-no-state { color: var(--ochre, #8a5a2b); }
          .sx-cal-account .sx-ledger-table th[scope="row"] { vertical-align: top; }
          .sx-cal-account .sx-cal-account-key th[scope="row"], .sx-cal-account .sx-cal-account-key td { white-space: nowrap; }
          .sx-cal-account dl { margin-top: var(--s-4); max-width: 74ch; }
          .sx-cal-account dt { margin-top: var(--s-5); font-weight: 600; }
          .sx-cal-account dd { margin: var(--s-2) 0 0; color: var(--text-muted); }
          .sx-cal-account dd p + p { margin-top: var(--s-2); }
          .sx-cal-account .sx-cal-legend { margin-top: var(--s-4); padding: var(--s-3) var(--s-4); border-left: 3px solid var(--gold, #c9a84c); background: var(--ochre-wash, #f3e6d3); font-size: var(--t-sm); }
          .sx-cal-account .sx-cal-year-card { padding: var(--s-3) var(--s-4); border: 1px solid var(--rule-firm); background: var(--paper-raised); }
          .sx-cal-account .sx-cal-year-card > summary { cursor: pointer; font-family: var(--font-serif); font-size: var(--t-lg); font-weight: 600; }
          .sx-cal-account :is(a, button, summary):focus-visible { outline: 3px solid var(--focus, #1b4f8a); outline-offset: 2px; }
        </style>

        <p class="eyebrow">The Igbo calendar</p>
        <h2>The system</h2>
        <p>This part of the page sets out what one published account says about the Igbo calendar as a system: the shape of its week and its year, the names it gives to the days and the thirteen months, the festivals attached to them, and the naming tradition that follows the day of a child’s birth. It is a description of a system rather than a conversion, because it has to be.</p>
        <p><strong>Everything in this part of the page comes from Wikipedia’s <a href="https://en.wikipedia.org/wiki/Igbo_calendar">“Igbo calendar” article</a>, in the revision of 18 February 2026.</strong> It is not this archive’s own description, and it is not a community’s. Where the article attributes a claim to a named work, this page names that work; where it does not, this page says so. Each section below names its own source, and the works are gathered in full at the end.</p>
        <div class="sx-cal-legend">
          <p><strong>The article’s own caveat on itself.</strong> Its talk of citations is not empty. The article carries a maintenance banner reading <em>“This article needs more citations. Please help improve this article by adding citations to reliable sources. Unsourced material may be challenged and removed”</em>, dated June 2015.</p>
        </div>
        <p>The article describes the system in these words: <em>“The calendar has 13 months in a year (Afọ), 7 weeks in a month (Ọnwa), and 4 days of Igbo market days (Eke, Orie, Afọ, and Nkwọ) in a week (Izu) plus an extra day at the end of the year, in the last month. The name of these months was reported by Onwuejeogwu (1981).”</em></p>
        <p>Here is that structure in the article’s own terms. A week, <i>izu</i>, holds four days, <i>ubo chi</i>; seven weeks make a month, <i>ọnwa</i>; a month is 28 days; and a year, <i>afọ</i>, holds thirteen of them. In the last month an extra day is added, which is an intercalary day — a day put in outside the ordinary count so that a count of whole weeks can keep its place against the solar year. Thirteen months of 28 days come to 364 days, and the extra day brings the count to the 365 of a common solar year. The article names the traditional timekeepers of Igboland as the priests or <i>Dibia</i>, and gives Udeani (2007) for it.</p>
        <p><strong>What follows is the most useful sentence in the article, and it agrees with what this page already said above it.</strong> The article states: <em>“The calendar is neither universal nor synchronized, so various groups will be at different stages of the week, or even year.”</em> It goes on to say that the four-and-eight-day cycle nonetheless serves to synchronise market days between villages, and that substantial parts of Igboland — the Kingdom of Nri among them — do share the same year-start. It also records that some Igbo communities have tried to adjust the thirteen-month calendar to twelve months, in line with the Gregorian calendar, and that it has not been easy.</p>
        <p>That is the same position this page takes above. <strong>The reckoning above is one archive’s, from a fixed anchor; the article says the reckoning is not shared; and neither is a claim about what your own community keeps.</strong> A reader who takes either as universal has been misled, so both are said in plain words rather than left to be inferred.</p>

        <h2>The days of the week</h2>
        <p>The article says the four market days follow one another in this order, and that in various parts of Igboland each community has a market named after one of them — an Eke market, an Afọ market. The order is the sequence, not a set, and it is the sequence the reckoning above uses.</p>
        <div class="sx-table-wrap">
          <table class="sx-ledger-table">
            <caption>Eke, Orie, Afọ and Nkwọ, in the order the article gives them, and where the article places each.</caption>
            <thead><tr><th scope="col">No.</th><th scope="col">Day (ubo chi)</th><th scope="col">Where the article places it</th></tr></thead>
            <tbody>
              <tr><th scope="row">1</th><td>Eke</td><td>East. Isichei (1997) is cited for the cardinal correspondence.</td></tr>
              <tr><th scope="row">2</th><td>Orie, also Oye</td><td>West. The article’s form is Orie; the screen above already lists Oye beside it.</td></tr>
              <tr><th scope="row">3</th><td>Afọ, also Afor</td><td>North.</td></tr>
              <tr><th scope="row">4</th><td>Nkwọ, also Nkwor</td><td>South.</td></tr>
            </tbody>
          </table>
        </div>
        <p class="small muted">Reference 5, Isichei, <i>A History of African Societies to 1870</i> (1997), p. 247, is cited for the cardinal correspondence and for nothing else in the article. This page does not print the four directions in the day cards above, because those cards are the design’s and the correspondence is one source’s statement rather than a fact the archive holds.</p>
        <p>The article also says the four days <em>“come in alternate cycles of ‘major’ and ‘minor’, giving a longer eight day cycle”</em>, citing a 1979 issue of <i>Aṅụ Magazine</i>. <strong>This page does not draw an eight-day cycle, because one magazine reference with no quotation behind it is not enough to draw one with.</strong> The reckoning above stays on the four days the design and the archive’s own records both set out, and the claim is recorded here rather than acted on.</p>
        <p>One sentence in the article is a tradition about origins rather than a report of an event: that the day-spirits, whom it calls fishmongers, <em>“were created by Chineke (Faith and Destiny) in order to establish a social system throughout Igboland.”</em> <strong>It is set down here as the tradition it is.</strong> The article gives it no reference, the archive holds no support for it, and this page neither repeats it as settled nor rules on it.</p>

        <h2>The thirteen months</h2>
        <p>This is the centre of what the article adds. <strong>The names and the Gregorian ranges are the article’s system table, which attributes them to Onwuejeogwu (1981); the descriptions are the article’s “Months and meanings” section, which the article states is the Nri-Igbo calendar of the Nri kingdom.</strong> The two are kept apart in the table below because they carry different weight. <strong>What this page can say is that the article says Nri reckons the year in these thirteen months, and that Nri is not all of Igboland.</strong></p>
        <p><strong>The Gregorian column is a range and not a date.</strong> February–March for the first month describes roughly where in the solar year it falls; it is not a rule that turns a Gregorian day into an Igbo one. The reckoning above works the other way round: it takes a Gregorian date and gives the market day under one stated anchor. The article supplies nothing that would join the two, so this page prints no such conversion, and the market-day view above remains a demonstration of four-day reckoning rather than a converter for the thirteen months.</p>
        <p>Each month is a button. Press it, or press Enter on it, and the article’s description of that month opens in the row beneath. <strong>The descriptions are written into the page either way</strong>, so they are readable, findable and printable with JavaScript switched off.</p>
        <div class="sx-table-wrap">
          <table class="sx-ledger-table">
            <caption>Thirteen months (ọnwa). Names and Gregorian equivalents: Onwuejeogwu (1981), as reported by the article. Descriptions: the article’s Nri-Igbo section, which it says may differ from other Igbo calendars in naming, rituals and ceremonies. Every row is Nri’s.</caption>
            <thead><tr><th scope="col">No.</th><th scope="col">Month (ọnwa)</th><th scope="col">Gregorian equivalent</th><th scope="col">Whose calendar, and which source</th></tr></thead>
            <tbody>
${monthRows}
            </tbody>
          </table>
        </div>
        <p class="small muted">A note on the names: the article gives <i>Ọnwa Ilọ Mmụọ</i> for the eighth month, and the description it gives that month calls the festival held in it <i>Önwa Asatọ</i>, with the umlaut the article uses. Both spellings are the article’s and are left as the article has them.</p>

        <h2>Festivals named in this account</h2>
        <p>These are the festivals the article names, set out so a reader can see them as a set. <strong>They are the article’s, and the archive holds no event record for any of them.</strong> <a href="/cultural-calendar/">The cultural calendar</a> states that the archive holds no events, and nothing here changes that: no festival below has a date the archive can stand behind, a place, an organiser, or a record to look at.</p>
        <dl>
${festivals}
        </dl>
        <p class="small muted">Two annual dates in the article are worth reading with care. The 18 February given for Ịgụ Arọ is the date the article reports for 2012, alongside a note that in the event the festival was held in March — and the article’s own lead says the reckoning is not synchronised between groups. A festival reckoned from the moon does not sit on one Gregorian day, so this page prints the article’s date as the article’s rather than as a standing date.</p>

        <h2>Naming after dates</h2>
        <p>The article says newborn babies are sometimes named after the day they were born on, though it adds that this is no longer commonly used. It gives <i>Mgbeke</i> as a maiden born on the day of Eke, and <i>Mgborie</i> as a maiden born on the Orie day, and says that for males <i>Mgbo</i> is replaced by <i>Oko</i>, a male child, or <i>Nwa</i>, a child. Its example is Nwankwo Kanu, the footballer — <i>Nwa</i> and <i>Nkwọ</i>, a child born on the Nkwọ day.</p>
        <p>Udeani (2007), which the article cites for this, is cited for it twice: at reference 4 and again at reference 8 alongside a 2006 British naming-practice guide. <strong>This is one of the few claims on this page the archive can partly substantiate from its own shelves</strong>: it holds a record on the name Mgbeke, its origin and its use, and the check below records what that record and the archive’s other calendar records say.</p>

        <h2>What the archive can substantiate about this account</h2>
        <p>This archive’s first rule about a source is that it does not repeat one as settled. So each substantial claim the article makes was put to the archive’s own records, and the result is below. <strong>“The archive can substantiate this” means one or more of the archive’s own catalogued records states it independently of the article.</strong> It does not mean the claim is settled: a record can be wrong, and both records named here are secondary accounts rather than a community’s own.</p>
        <div class="sx-table-wrap">
          <table class="sx-ledger-table sx-cal-account-key">
            <caption>What the article claims, and what the archive holds for it.</caption>
            <thead><tr><th scope="col">Outcome</th><th scope="col">Claim, and what the archive holds</th></tr></thead>
            <tbody>
${verification}
            </tbody>
          </table>
        </div>
        <p class="small muted">Where the check was made, so that it can be repeated. The archive holds five catalogued records that bear directly on this account: <i>Traditional Igbo calendar and lunar/solar alignments</i>, <i>Iguaro: The Igbo Calendar, Culture, and Cosmology</i>, <i>Igu Aro: The Sacred Proclamation of the Igbo Lunar Year from Nri</i>, <i>Symbolism of the Four Market Days in Igbo Culture</i>, and <i>Mgbeke: Origin and Etymology and the Derogatory Reputation in Pop Culture</i>. <strong>The check was made against the archive’s own catalogued article data for these five by name, and not against a live query.</strong> Their own pages carry their own provenance, which is where a claim about them should be checked.</p>

        <h2>Sources and how to read them</h2>
        <p>The source for this account is a Wikipedia article, and this archive says that plainly rather than dressing it up. It is cited below in full so that a reader can go to it, check the revision, and judge it. The article is itself a tertiary source: it gathers what other works say. Its own reference list is what makes it usable, and that list is reproduced with a note on what each reference is used for.</p>
        <dl>
          <dt>Wikipedia contributors. “Igbo calendar.” <i>Wikipedia, The Free Encyclopedia.</i> Revision 1370565297, 18 February 2026.</dt>
          <dd>Read at <a href="https://en.wikipedia.org/wiki/Igbo_calendar">en.wikipedia.org/wiki/Igbo_calendar</a>. Every claim in this part of the page is taken from this revision. The article carries a “needs more citations” banner dated June 2015, which is reproduced above and is part of the assessment rather than a detail beside it.</dd>
        </dl>
        <h3>The works the article cites, and what each is cited for</h3>
        <p>These are the article’s own references, with what the article uses each for. A marked reference is one of the two the article relies on for the parts of this page a reader is most likely to want to check.</p>
        <dl>
${sources}
        </dl>
        <h3>Which claim rests on which reference</h3>
        <p>So that a reader can find a claim in the article rather than trusting this page’s summary of it, the section each claim comes from is given beside the reference the article attaches to it.</p>
        <div class="sx-table-wrap">
          <table class="sx-ledger-table sx-cal-account-key">
            <caption>Claim, and the article’s section and reference for it.</caption>
            <thead><tr><th scope="col">What the article states</th><th scope="col">Where, and on what</th></tr></thead>
            <tbody>
${claimSource}
            </tbody>
          </table>
        </div>
        <h3>What this page has not done</h3>
        <p>It has not converted a Gregorian date into an Igbo day, month or year. It has not drawn the eight-day cycle. It has not given any festival a date of its own. It has not repeated the article’s year count for the Nri calendar as a fact. It has not put any of this into the market-day reckoning above, which remains this archive’s demonstration from the fixed anchor stated at <i>${esc(basis)}</i>. And it has not created an event record: <strong>the archive holds no event for any of these festivals</strong>, and <a href="/cultural-calendar/">the cultural calendar</a> says the same of itself. Each of those is a thing the material could be made to say and the sources do not carry, which is why it is not said.</p>
        ${monthToggle}
      </section>`;
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
 * and lets the page's own stylesheet size and colour it; `.sx-cultural-day > span` is the date, and the label
 * sits under it as its context. **No `has-event`, no `data-event-*`, no `button`, no `href`: an inert date does
 * not become a claim about an event, and the page still says the archive holds none.
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
  '      marketDays[k - 1].appendChild(marketLabel);',
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
 * `/igbo-calendar/` and `/market-days/` — the four-day market week, and the account behind it.
 *
 * THE ANCHOR IS A DEMONSTRATION AND THE DESIGN ALREADY SAYS SO
 *
 * The design's own note is the honest one: *"This prototype sets 1 January 2026 as Orie and repeats the
 * four-day cycle. It is not a claim that every Igbo community uses the same anchor."* The brief adds that it
 * must never be presented as universal.
 *
 * **So the conversion is kept exactly as the design computes it, and the words around it are made to say what
 * it is.** The one change is to the words that call the reader's own today's date an example: the date shown is
 * the real date, and the market day is this archive's demonstration reckoning of it, labelled as such before
 * the answer rather than after it.
 *
 * ============================================================================================
 * AND THE ACCOUNT SITS BELOW IT, ATTRIBUTED, WHICH IS THE WHOLE OF THIS ROUND'S WORK
 * ============================================================================================
 *
 * The owner asked for more information on **this page rather than scattered across the site**: *"you should
 * also at the igbo calendar page itself and update more information there … find a way to put these things
 * below there."* The material he sent is Wikipedia's "Igbo calendar" article, and the difficulty is that this
 * archive never presents a source's account as its own.
 *
 * So the account is appended as one section below the design's own content, and nothing above it moves. Three
 * things make it honest rather than merely present:
 *
 *   1. **the source is named at the point of use.** Every claim's material carries the article's section and
 *      reference number, the works the article cites are listed with what each is cited for, and the revision
 *      is given so a reader can fetch the exact text;
 *   2. **the Nri account is marked as Nri's.** The months-and-meanings material is the Nri-Igbo calendar of the
 *      Nri kingdom by the article's own statement, and the table says so in its caption, its column and every
 *      row — presenting it as "the Igbo calendar" would be the universalising this page forbids;
 *   3. **what the archive cannot substantiate is said, not omitted.** The table in "What the archive can
 *      substantiate about this account" records each claim as substantiated or not, with the records behind
 *      it and, for the rest, the reason it cannot be. **"The archive can substantiate this" means one of the
 *      archive's own catalogued records states it independently of the article**, which is a weaker claim than
 *      proof and is worded that way.
 *
 * **And the sentence that matters most in the article is the one that agrees with this page.** It says the
 * calendar is *"neither universal nor synchronized, so various groups will be at different stages of the week,
 * or even year."* That is what the paragraph above the new material already said, so the two are set beside
 * each other as reinforcement rather than as a source correcting the page or the page correcting a source.
 */
export function fillIgboCalendar(html: string, state: { basis: string } = { basis: MARKET_DAY_ANCHOR }): string {
  let out = clearExampleMaterial(html);
  out = out.replace(/Selected demonstration basis/g, 'The basis this page uses');
  /*
   * THE HERO'S OWN DESCRIPTION OF WHAT THE PAGE HOLDS.
   *
   * It read "Check today, look up another date, or follow Eke, Orie, Afọ and Nkwọ across a month or full
   * year." **That was the whole of the page when it was written and it is not the whole of it now** — this
   * round adds the system, the thirteen months and their sources below. A hero that leaves them out is the
   * page underselling itself at the one point every reader reads.
   */
  out = out.replace(
    /Check today, look up another date, or follow Eke, Orie\/Oye, Afọ\/Afor and Nkwọ\/Nkwor across a month or full year\./,
    'Check today, look up another date, or follow Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor across a month or full year. Below the calendar, the system behind it: the thirteen months of the year, the festivals the account names, the naming tradition that follows the day of a child’s birth, and where all of it comes from.'
  );
  out = out.replace(
    /This prototype sets 1 January 2026 as Orie and repeats the four-day cycle\./,
    `This page reckons the cycle from a fixed anchor: ${esc(state.basis)}. It is this archive's demonstration of one reckoning, not a claim that every Igbo community uses the same one.`
  );
  out = out.replace(
    /A production result should always name its source\./,
    'This result names its source: the anchor above. A community that keeps a different anchor will keep a different market day, and this page cannot tell you which one your town uses.'
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
   * silently matches nothing is the fault this file keeps recording** — each string below is read from the
   * screen it belongs to, and the test asserts that both are replaced.
   */
  out = out.replace(
    /The supplied helper sets 1 January 2026 as Orie and repeats the four-day cycle\. This is a design basis, not a claim that every Igbo community uses the same anchor\./,
    `This page reckons the cycle from a fixed anchor: ${esc(state.basis)}. It is this archive's demonstration of one reckoning, not a claim that every Igbo community uses the same one.`
  );
  out = out.replace(
    /verify the anchor, community basis, timezone and whether the day changes at sundown\./,
    'verify the anchor, the community basis, the timezone, the spellings and whether the day changes at sundown. A community that keeps a different anchor will keep a different market day, and this page cannot tell you which one your town uses.'
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
   * THE NEW MATERIAL GOES BELOW EVERYTHING THE DESIGN DRAWS, AND THE ANCHOR IS THE PAGE'S OWN `</main>`.
   *
   * The design runs hero, day cards, lookup, month view, full-year grid, and its closing note, and then closes
   * `<main>`. The owner's instruction was *"find a way to put these things below there"*, so the block goes
   * between the design's last element and the end of `main` — after everything, above the footer, and inside
   * the region a screen reader treats as the page.
   *
   * THE FIRST TWO ATTEMPTS ANCHORED ON THE CLOSING NOTE AND BOTH PUT THE BLOCK IN THE WRONG PLACE. One
   * appended at the section's close, which is the note's position, so **the design's own closing statement
   * ended up BELOW the new material**; the other searched for the note by class and found the addendum's own
   * `<style>` block first, which put the page's content inside a CSS selector. Anchoring on `</main>` has
   * neither problem: it is the page's structural end, it appears once, and nothing this function adds contains
   * it.
   *
   * **AND IT IS GUARDED RATHER THAN MERELY FOUND.** If the marker is absent the page is returned unchanged
   * rather than having the block appended somewhere arbitrary, and if the block is already present it is not
   * added twice — because this function is called on the design's own file per request, and an insertion that
   * doubles on a second pass is the kind of fault that only shows up in production.
   */
  if (!out.includes('sx-cal-account') && out.includes('</main>')) {
    const at = out.indexOf('</main>');
    out = `${out.slice(0, at)}\n${igboCalendarAddendum(state.basis)}\n    ${out.slice(at)}`;
  }
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
 * The film's provenance sentence is kept because it is the design telling the truth about a real embed — Ozikoro
 * does not present an external film as its own production — and the two sentences that describe the interface
 * as example material go, because they are about the design rather than about the film.
 */
export function fillWatchVideo(html: string): string {
  let out = clearExampleMaterial(html);
  out = out.replace(
    /In the live platform, this area would carry the complete timed transcript, speaker names and language information—not invented text\./,
    'This area carries the complete timed transcript, speaker names and language information when the publisher supplies one. No transcript has been supplied for this film, and none is invented in its place.'
  );
  out = out.replace(
    /Transcript status: awaiting a publisher-approved transcript\./,
    'Transcript status: no publisher-approved transcript has been supplied.'
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
 * demonstration".** This archive holds 188 published towns and clans, and **170 article-to-place links**, so a
 * town page has real material — but there is no way to know which town a reader wanted at `/town/` itself, so
 * the register is what this page carries.
 *
 * The three example histories are not carried over. What replaces them is the real thing the page is for: the
 * places the archive holds, each with the number of linked records, so a reader can choose one.
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
            `<article class="entry"><h3><a href="${esc(t.href)}">${esc(t.name)}</a></h3><p class="small muted">${esc(t.region ?? 'Region not recorded')} · ${t.records > 0 ? `${n(t.records)} linked ${t.records === 1 ? 'record' : 'records'}` : 'No record linked yet'}</p></article>`
        )
        .join('\n          ')
    : `<p class="small muted">No town or clan is published in the register yet.</p>`;

  out = fillContainer(out, /<div class="sx-town-articles"[^>]*>/, list);
  out = fillContainer(
    out,
    /<section class="section"[^>]*id="records"[^>]*>/,
    `<p class="small muted">The register holds ${n(d.total)} towns and clans. Choose one above to see the histories, photographs and documents connected to it — a place with no linked record says so rather than being given an example one.</p>`
  );
  return out;
}
