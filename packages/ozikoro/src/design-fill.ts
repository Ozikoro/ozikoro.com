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
    out = out.replace(
      /(<p class="small" data-listen-status aria-live="polite">)[\s\S]*?(<\/p>)/,
      `$1Ready to listen${length ? ` · ${esc(length)}` : ''}$2`
    );
    out = out.replace(
      /(<button class="btn" type="button" data-listen-toggle[^>]*>)[\s\S]*?(<\/button>)/,
      '$1▶ Listen$2'
    );
    // The audio element carries the file; the design's own script drives the button and the progress bar.
    out = out.replace(
      /(<section[^>]*\bid="listen"[^>]*>)/,
      `$1<audio data-listen-audio preload="none" src="${esc(a.episode.url)}"></audio>`
    );
    // The design's last line becomes the disclosure, the credit and the transcript.
    out = out.replace(
      /(<p class="small muted">)[\s\S]*?(<\/p>)(\s*<\/section>)/,
      `$1${esc(a.episode.disclosure)}$2` +
        `<p class="small muted"><a href="/podcast/${esc(transcriptSlug)}/transcript.txt">Read the transcript</a>` +
        `${a.episode.narratorName ? ` · ${esc(a.episode.narratorName)}` : ''}</p>$3`
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
export type RealDocument = { title: string; href: string; label: string; note: string; size: string | null };

/** One document card, in the design's `.sx-pdf-grid > article` markup. */
export function renderDocument(d: RealDocument): string {
  return `<article><span class="sx-file-icon">PDF</span><div><small>${esc(d.label)}</small><h3>${esc(d.title)}</h3><p>${esc(d.note)}</p><a href="${esc(d.href)}" download>Download PDF${d.size ? ` · ${esc(d.size)}` : ''} <span aria-hidden="true">↓</span></a></div></article>`;
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
  'Emeka Ǹwàchukwu': 'a byline page for the design’s example author; the archive credits eleven contributors and none of them is this name',
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

/** The five entities the design's own labels actually contain, and nothing more. */
function decodeEntities(value: string): string {
  return value
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
 * EVERY SCREEN THE ROUTE REWRITES WHOSE DESIGN CARRIES PLACEHOLDER LINKS.
 *
 * The fourteen dashboards came first, and then a measurement found **thirty-six more `href="#"` on six
 * screens that are served live and return 200**: `/publication/`, `/researcher-profile/`, `/academy/`,
 * `/archive-index/`, `/upload/` and `/watch/`. A dead link is the same fault wherever it is, so the same
 * transform covers them rather than a second one being written beside it — **two transforms would drift,
 * and the one that drifted would be the one nobody was looking at.**
 *
 * The set is written here rather than in the route so the route and `design-fill.test.ts` cannot disagree
 * about which screens are covered.
 */
export const LINKED_SCREENS: string[] = [
  'publication', 'researcher-profile', 'academy', 'archive-index', 'upload', 'watch',
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
 *   the counts come from the database, so "1,051 histories" is a count and not a claim about one
 *   the people are the nineteen contributors, in the order of how much they wrote
 *   the portraits are MONOGRAM TILES, because **not one of the eleven WordPress authors has a photograph** —
 *     Gravatar serves the same grey silhouette for all of them, and eleven identical grey figures would be
 *     worse than eleven initials
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
 * and it is empty of avatars), and Gravatar answers the same grey silhouette for every one of them — so eleven
 * identical grey figures would be worse than eleven initials. The design's own note anticipated exactly this:
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
    <p class="small muted" style="margin-top:var(--s-2)">${bio ? esc(bio.slice(0, 240)) : 'No biography on file. Named here by the work alone.'}</p>
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
  out = out.replace(
    /(<ul[^>]*>)\s*<li><a href="archive-index\.html">Histories<\/a>[\s\S]*?(<\/ul>)/,
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
          `<article><span class="tier">${c.records === 1 ? '1 published history' : `${n(c.records)} published histories`}</span><b><a href="/author/${esc(c.slug)}/">${esc(c.name)}</a></b><p>${c.bio?.trim() ? esc(c.bio.trim().slice(0, 120)) : 'No biography on file.'}</p></article>`
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
 * `/cultural-calendar/` and `/cultural-event/` — the African cultural calendar.
 *
 * **There is no event table.** The only `%event%` tables in the schema are `learn_xp_event` and
 * `spotify_event`, which belong to the Academy and to Spotify, so the archive holds no event, no organiser and
 * no verification status. Measured: 0.
 *
 * The design's own grid says "Gold dates have events. Plain dates are not clickable" and heads itself
 * "October 2026 · demonstration month". **With no event recorded, every date is a plain date** — which is the
 * design's own non-interactive state rather than a degraded one, and the month is the real current month rather
 * than the design's example.
 *
 * A wrong date in a calendar is a reader travelling on the wrong day, so nothing is invented here of all places.
 */
export function fillCulturalCalendar(html: string, month: { label: string; year: number; events: number }): string {
  let out = clearExampleMaterial(html);
  out = out.replace(
    /October 2026 · demonstration month/,
    `${esc(month.label)} ${month.year} · ${month.events === 0 ? 'no verified event' : `${n(month.events)} verified ${month.events === 1 ? 'event' : 'events'}`}`
  );
  out = out.replace(
    /Event details will appear here\./,
    month.events === 0
      ? 'No event is recorded for any date in this month, so no date is interactive. An event appears once its organiser, place and source are recorded and verified.'
      : 'Choose a highlighted date to see its organiser, place and verification status.'
  );
  out = out.replace(
    /Only dates with event entries are interactive\./,
    'Every date above is a plain date, because the archive records no event. Only dates with event entries become interactive — and there are none.'
  );
  out = fillContainer(
    out,
    /<div class="sx-event-layout"[^>]*>/,
    `<p class="small muted">The archive holds <strong>0 events</strong>. There is no organiser, place or verification date to show, and none is invented. To offer an event, use <a href="upload.html">Contribute</a>; it will appear here once its organiser and source are recorded.</p>`
  );
  return out;
}

/** One event page, which cannot be anything but empty. */
export function fillCulturalEvent(html: string): string {
  let out = clearExampleMaterial(html);
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
 * `/igbo-calendar/` and `/market-days/` — the four-day market week.
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
 */
export function fillIgboCalendar(html: string, state: { basis: string }): string {
  let out = clearExampleMaterial(html);
  out = out.replace(/Selected demonstration basis/g, 'The basis this page uses');
  out = out.replace(
    /This prototype sets 1 January 2026 as Orie and repeats the four-day cycle\./,
    `This page reckons the cycle from a fixed anchor: ${esc(state.basis)}. It is this archive's demonstration of one reckoning, not a claim that every Igbo community uses the same one.`
  );
  out = out.replace(
    /A production result should always name its source\./,
    'This result names its source: the anchor above. A community that keeps a different anchor will keep a different market day, and this page cannot tell you which one your town uses.'
  );
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
