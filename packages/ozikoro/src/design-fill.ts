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
