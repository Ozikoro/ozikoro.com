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

