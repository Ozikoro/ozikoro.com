/**
 * WHAT A PAGE SAYS WHERE IT CANNOT SHOW A PICTURE.
 *
 * ── THE FAULT, MEASURED ON THE SERVED PAGE ────────────────────────────────────────────────────────────
 *
 * A migrated body may name a file this archive does not hold. `rewriteBodyImages` deliberately returns such
 * an address **unchanged** — that is its whole safety property, because substituting something else would be
 * putting a different photograph on a history page — and the body is then sanitised and rendered.
 *
 * The result was that a reader was shown this, in the middle of a sentence about a photograph:
 *
 *     <img src="https://ozikoro.com/wp-content/uploads/2025/02/AGBEJI-…-photo.jpg" alt="…" style="max-width:100%;height:auto;">
 *
 * The site's own `img-src 'self' data: https://i.ytimg.com` refuses that address, so the element never loads:
 * **a broken frame, in a record whose entire purpose is to be a reliable account of something.** The address
 * is the only thing on the page that says a picture was meant, and it is the one thing a reader cannot read.
 *
 * ── AND WHY THE OBVIOUS FIX IS THE WRONG ONE ──────────────────────────────────────────────────────────
 *
 * Deleting the tag makes the page tidy and false: the surrounding sentence goes on referring to a picture
 * that is no longer mentioned anywhere, and nothing in the record accounts for the gap. `sanitiseArchiveHtml`
 * already does exactly that for an `<img>` with no `src` at all (`dropBrokenMedia`, `content.ts`), and that
 * deletion is silent.
 *
 * So the element is REPLACED BY A STATEMENT OF ITS OWN ABSENCE, in the voice the archive already uses for a
 * file it does not hold. `apps/ozikoro/app/documents/[slug]/page.tsx` draws an `.unsourced` block whose
 * eyebrow reads *"The archive does not hold this file"* and whose sentence ends *"so the archive cannot show
 * it and will not pretend to."* **This module is the same voice for a figure inside a body**, and it reuses
 * the same `.unsourced` class, so no stylesheet is touched.
 *
 * ── WHAT IT MAY AND MAY NOT CLAIM ────────────────────────────────────────────────────────────────────
 *
 * It says the archive does not hold the file and cannot show it from here. **It does NOT say the file is
 * gone.** That is knowable for the addresses this round searched, and it is not knowable in general: the
 * same rule runs over every body, and an address can be unheld here while still answering perfectly well on
 * somebody else's server. A plate that claimed "this file no longer exists" would be inventing a fact about
 * a third party's website. It names the file, keeps the address as the record of where the picture was
 * published, and prints the body's own recorded description beside it.
 *
 * ── WHAT COUNTS AS HELD ──────────────────────────────────────────────────────────────────────────────
 *
 * After `rewriteBodyImages`, a file the archive holds is served from `/media/…` on this origin. Everything
 * else is either inline (`data:`), or loaded from the one image host this site's Content Security Policy
 * admits (`i.ytimg.com` — a video thumbnail, which does load), or unheld. **The predicate is the policy**,
 * which is why it is written once, here, rather than guessed at in each caller.
 */

/**
 * A file this origin serves from its own media route.
 *
 * The absolute spelling is admitted as well as the path, because not every body reaches this function by way
 * of `rewriteBodyImages`: a body an editor wrote by hand may already carry
 * `https://ozikoro.com/media/ozikoro/…`, and plating that would be replacing a picture this site serves with
 * a notice saying it does not have it.
 */
const HELD = /^(?:https?:\/\/(?:www\.)?ozikoro\.com)?\/media\//i;

/** Bytes carried in the page itself. Nothing is fetched and nothing can 404. */
const INLINE = /^data:/i;

/**
 * The one off-site image host this site admits, named in `next.config.ts`'s `img-src`.
 *
 * `img-src 'self' data: https://i.ytimg.com` — so a YouTube thumbnail is a picture this site can actually
 * show, and plating it would be replacing a working photograph with a notice about a missing one.
 */
const POLICY_ADMITTED = /^(?:https?:)?\/\/(?:www\.)?i\.ytimg\.com\//i;

/** Whether this address is one the page can actually load. */
export function figureIsLoadable(src: string): boolean {
  const url = src.trim();
  if (url === '') return false;
  if (HELD.test(url)) return true;
  if (INLINE.test(url)) return true;
  if (POLICY_ADMITTED.test(url)) return true;
  return false;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The file's own name, as the address spells it — the one part of an unheld address a reader can use. */
function fileNameOf(url: string): string {
  const bare = url.split(/[?#]/)[0] ?? url;
  const last = bare.split('/').filter(Boolean).pop() ?? bare;
  try {
    return decodeURIComponent(last);
  } catch {
    // A `%` that is not an escape is kept as written rather than dropped.
    return last;
  }
}

/** One attribute's value, from either quoting. */
function attribute(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!m) return null;
  return (m[2] ?? m[3] ?? '').trim();
}

/**
 * The statement that replaces one element.
 *
 * `img` is a picture; a `video` or an `audio` is a recording, and the notice says which. **The wording is the
 * documents page's own**, kept close enough that a reader meets one voice rather than two.
 */
function plateFor(tagName: string, address: string, alt: string | null): string {
  const picture = tagName === 'img';
  const what = picture ? 'image' : 'recording';
  const thing = picture ? 'picture' : 'recording';
  const name = address ? fileNameOf(address) : 'an unnamed file';
  const lines = [
    '<figure class="unsourced">',
    `<p class="eyebrow">The archive does not hold this ${what}</p>`,
    `<p>The record names a ${thing} — <span class="mono">${escapeHtml(name)}</span> — and this archive does ` +
      `not hold the file, so it cannot show it here and will not pretend to. It was published at ` +
      `<span class="mono">${escapeHtml(address || 'an address the record does not state')}</span>, which is ` +
      `kept because it is where the ${thing} stood.</p>`,
  ];
  if (alt && alt !== name) {
    lines.push(`<figcaption class="small muted">Recorded description: ${escapeHtml(alt)}</figcaption>`);
  }
  lines.push('</figure>');
  return lines.join('\n');
}

/**
 * Keep only the `srcset` entries this page can load.
 *
 * A `srcset` is what a browser actually chooses from, so one unheld entry among held ones is a picture that
 * 404s on a wide screen and loads on a narrow one — the same fault, arriving only for some readers. An entry
 * this page cannot load is dropped from the list; the `src` is untouched, so the element still has a picture.
 */
function holdOnlyLoadableSrcset(tag: string): string {
  return tag.replace(
    /(\s(?:data-)?srcset=)("([^"]*)"|'([^']*)')/gi,
    (whole: string, prefix: string, _q: string, dq?: string, sq?: string) => {
      const value = dq ?? sq ?? '';
      const kept = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .filter((part) => figureIsLoadable(part.split(/\s+/)[0] ?? ''));
      return kept.length === 0 ? '' : `${prefix}"${kept.join(', ')}"`;
    }
  );
}

/** Every address a `<video>`/`<audio>` block offers: its own `src`, and each `<source src>` inside it. */
function blockAddresses(block: string): string[] {
  const out: string[] = [];
  const own = attribute(block, 'src');
  if (own) out.push(own);
  for (const m of block.matchAll(/<source\b[^>]*>/gi)) {
    const src = attribute(m[0], 'src');
    if (src) out.push(src);
  }
  return out;
}

/**
 * Inside a kept `<video>`/`<audio>`, drop the address that cannot be played.
 *
 * Two places carry one: the element's own `src`, and each `<source src>` child. Leaving either is the same
 * fault one level down — the browser tries a dead address first and the recording fails for a reader who
 * would have been served perfectly well by the other entry.
 */
function holdOnlyLoadableSources(block: string): string {
  const withoutDeadChildren = block.replace(/<source\b[^>]*>/gi, (tag: string) => {
    const src = attribute(tag, 'src');
    return src && !figureIsLoadable(src) ? '' : tag;
  });
  return withoutDeadChildren.replace(/<(video|audio)\b[^>]*>/i, (opening: string) => {
    let kept = opening;
    for (const name of ['src', 'poster']) {
      const value = attribute(kept, name);
      if (value && !figureIsLoadable(value)) {
        kept = kept.replace(new RegExp(`\\s${name}=("[^"]*"|'[^']*')`, 'i'), '');
      }
    }
    return kept;
  });
}

/**
 * Replace every figure this page cannot load with a statement of what is missing.
 *
 * It runs AFTER `rewriteBodyImages` and AFTER `sanitiseArchiveHtml`, which is the only point at which the
 * question "does this archive hold this file?" has a definite answer: the rewriter has already pointed every
 * held address at `/media/…`, and the sanitiser has already thrown away the attributes that are not part of
 * the record. Running it earlier would plate files the rewriter was about to resolve.
 *
 * A `video`/`audio` is handled as a whole element rather than tag by tag: **its `<source>` children are its
 * addresses**, and replacing the opening tag alone would leave a stray `</video>` in the prose.
 */
export function nameUnheldFigures(body: string): string {
  let out = body;

  // 1. A recording, as one element. `[\s\S]*?` rather than `.` so a newline inside does not end the match.
  out = out.replace(/<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi, (block: string, name: string) => {
    const addresses = blockAddresses(block);
    if (addresses.some((a) => figureIsLoadable(a))) return holdOnlyLoadableSources(block);
    const alt = attribute(block, 'title') ?? attribute(block, 'aria-label');
    return plateFor(name.toLowerCase(), addresses[0] ?? '', alt);
  });

  // 2. A picture.
  out = out.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const src = attribute(tag, 'src') ?? '';
    if (figureIsLoadable(src)) return holdOnlyLoadableSrcset(tag);
    return plateFor('img', src, attribute(tag, 'alt'));
  });

  return out;
}
