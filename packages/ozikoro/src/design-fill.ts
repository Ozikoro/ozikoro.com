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

/** Remove the example flag: true of the design, false of a page filled with real records. */
function dropExampleFlag(html: string): string {
  return html.replace(/\s*<p class="example-flag">[\s\S]*?<\/p>/, '');
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
  return out;
}

/** A real film: the YouTube id embedded in a published article, and that article as its source. */
export type RealFilm = { id: string; title: string; source: string; href: string };

/**
 * One video card, in the design's own markup — `button.sx-video-card` with its data attributes, its poster
 * frame from `i.ytimg.com`, and its title and source.
 *
 * **The design's card is a button rather than a link because it plays in place**, and that behaviour is the
 * design's. This reproduces the element exactly and changes only the id, the title and the source.
 */
export function renderFilmCard(f: RealFilm): string {
  const id = esc(f.id);
  const title = esc(f.title);
  const meta = esc(f.source);
  return `<button type="button" class="sx-video-card" data-video-id="${id}" data-video-title="${title}" data-video-meta="${meta}" aria-pressed="false"><span class="sx-video-thumb"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Thumbnail for ${title}"><span class="sx-video-play" aria-hidden="true">▶</span></span><span class="sx-video-meta">${meta} · Plays on this page</span><h3>${title}</h3><p>${meta}</p></button>`;
}

/**
 * Fill `watch.html`'s film grid with the films the archive actually holds.
 *
 * **Every film here is a YouTube video embedded in a published Ozikoro article.** 24 articles carry one, 23
 * with a readable id. Nothing is fetched from YouTube and nothing is invented: the title is the article's
 * title, the source is the article, and the poster frame is YouTube's own for that id. **The owner asked
 * whether any article had a video to use, and the answer is yes — so none were sourced from outside.**
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
  const inner = films.map(renderFilmCard).join('\n  ');
  out = out.slice(0, open) + '\n  ' + inner + '\n' + out.slice(i - 6);
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
 * Fill `home.html`'s "Fresh from the archive" list.
 *
 * The design's five entries link to `https://ozikoro.com/…`, which is the live WordPress site, and its credit
 * line says the story titles are taken from there. **This points them at the archive's own records instead**,
 * so a reader stays on the site being built rather than being sent to the one it will replace.
 */
export function fillHome(html: string, entries: { title: string; href: string; topic: string | null }[]): string {
  let out = dropExampleFlag(html);
  const rendered = entries.map((e, i) => renderHomeEntry(i + 1, e)).join('\n        ');
  out = replaceContainer(out, '<div class="sx-archive-index"', rendered);
  return out;
}

/** A photograph as the archive holds it. */
export type RealPhotograph = {
  id: number;
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

  return `<article>
          <img src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy">
          <div>
            <small>${esc(context)}</small>
            <h2>${esc(ph.title)}</h2>
            <p>Reference <code>OZ-M-${ph.id}</code> · ${esc(terms)}</p>
            <a href="/photographs">Open record <span aria-hidden="true">→</span></a>
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
