/**
 * Turning archived WordPress HTML into something safe to render in the approved design.
 *
 * TWO JOBS, AND THEY ARE NOT THE SAME JOB
 *
 * 1. SAFETY. The article bodies came from a WordPress installation and will, in time, come from
 *    contributors as well. The plan requires "XSS, injection and unsafe HTML protections", and
 *    the archive's whole purpose is to publish writing from other people. So the body is not
 *    trusted: it is parsed and rebuilt against an allowlist, and anything not on the list is
 *    discarded rather than escaped-and-kept.
 *
 * 2. FIDELITY. The same bodies were written in Elementor, which means 1,629 inline `style`
 *    attributes and 137 plugin classes measured across a 200-article sample. Left alone they
 *    fight the design system: a hard-coded `font-size:11px` beats the token, an inline colour
 *    beats the palette, and the result is the "generic blog" look the brief rejects. The design
 *    wants clean semantic HTML inside `.prose`, so that is what this produces.
 *
 * WHY NOT A LIBRARY
 *
 * A sanitising library would be the right answer if the input were arbitrary hostile HTML from
 * the open internet. It is not: it is the owner's own published archive, the sample shows zero
 * script tags, and adding a DOM dependency to a repository that has deliberately avoided one for
 * its styling would be its own kind of drift. What is here is a small allowlist parser with the
 * limits stated rather than hidden. If the archive ever accepts untrusted HTML directly, this
 * should be replaced with a maintained sanitiser, and that is the condition to watch for.
 */

/** Tags the design's `.prose` styles, plus the inline semantics prose actually needs. */
const ALLOWED_TAGS = new Set([
  'p','br','hr','strong','b','em','i','u','s','sub','sup','small','mark','abbr','cite','q','time',
  'h2','h3','h4','h5','h6',
  'ul','ol','li','dl','dt','dd',
  'blockquote','figure','figcaption','img','a','span','div',
  'table','thead','tbody','tfoot','tr','th','td','caption','colgroup','col',
  'audio','video','source','track',
]);

/** Tags that must never survive, whatever they contain. */
const DROPPED_WITH_CONTENT = new Set([
  'script','style','iframe','object','embed','applet','form','input','button','select','textarea',
  'option','meta','link','base','noscript','template','svg','math','canvas',
]);

/** Attributes allowed per tag. `*` applies to every allowed tag. */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  '*': new Set(['title', 'lang', 'dir']),
  /*
   * `name` IS ON THIS LIST BECAUSE IT IS A FRAGMENT TARGET AND NOT DECORATION.
   *
   * The older WordPress footnotes plugin — which wrote this archive's one footnote record,
   * `/beyond-wrestling-sport-in-pre-colonial-west-africa/` — marks both ends of every footnote with a `name`
   * attribute on an `<a>` rather than an `id`: the body's marker is `<a href="#_ftn1" name="_ftnref1">[1]</a>`
   * and the note at the foot is `<a href="#_ftnref1" name="_ftn1">[1]</a>`. **So each anchor is the other's
   * destination, and the `name` IS the target.** The HTML standard's own "find a potential indicated element"
   * step still returns the first `<a>` whose `name` equals the fragment — obsolete markup, not dead markup,
   * and every browser follows it.
   *
   * MEASURED, BOTH HALVES, BEFORE THIS LINE WAS ADDED. The WordPress dump itself
   * (`data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.sql`) holds `href="#_ftn…"` 17 times and `name="_ftn…"` 17
   * times in that record's `post_content`, and **`id="_ftn…"` zero times** — so the destinations were never
   * ids and no importer lost them; this allowlist was dropping the attribute they actually use. On the served
   * page all 34 anchors survived as links and none of them had a target: a control that returns 200 and does
   * nothing, seventeen times, in both directions.
   *
   * SCOPE, COUNTED RATHER THAN ASSUMED: **one of the archive's 1,051 published records writes an in-page
   * fragment anywhere in its body**, and it is that one. The rule is written here rather than special-cased
   * for it because it is a rule about archived writing rather than about a record — a contributor pasting
   * footnotes into `/upload/` gets the same treatment without anyone remembering this.
   *
   * WHY `name` AND NOT `id`, WHICH IS THE ADJACENT DECISION. **955 of the 1,051 bodies carry an `id`** —
   * 5,198 occurrences, 4,995 distinct, almost all of them WordPress's `attachment_3363` figure ids — and
   * **not one body in the archive links to any of them.** Preserving them would put five thousand inert
   * attributes into the served documents to fix nothing. Worse, `id` is the one attribute on this page that
   * can COLLIDE: the design's own article frame gives `opening`, `record`, `context`, `sources`, `citation`,
   * `listen` and `related` to its own elements, the body is rendered inside that frame, and
   * `getElementById` returns the first match — so a body id of `sources` would silently move the sidebar's
   * own link. `name` on `<a>` is used by nothing the design draws and cannot shadow it.
   *
   * WHAT IT CANNOT DO, WHICH IS WHY IT IS SAFE TO ALLOW: a `name` attribute names a position in a document.
   * It runs no script, applies no styling and fetches nothing — the three things the rest of this allowlist
   * exists to refuse — and its value goes through `escapeAttribute` like every other attribute.
   */
  a: new Set(['href', 'rel', 'target', 'name']),
  img: new Set(['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding']),
  audio: new Set(['src', 'controls', 'preload']),
  video: new Set(['src', 'controls', 'poster', 'preload', 'width', 'height']),
  source: new Set(['src', 'type', 'srcset', 'sizes', 'media']),
  track: new Set(['src', 'kind', 'srclang', 'label', 'default']),
  time: new Set(['datetime']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  ol: new Set(['start', 'type']),
};

export interface SanitiseOptions {
  /** Internal article links are rewritten to this origin's own paths. */
  internalHosts?: string[];
  /** Rewrites a media URL before it is emitted. Used to point at our own media route. */
  rewriteMediaUrl?: (url: string) => string;
  /** Drops `img`/`figure` whose source cannot be resolved. */
  dropBrokenMedia?: boolean;
}

const DEFAULT_INTERNAL_HOSTS = ['ozikoro.com', 'www.ozikoro.com', 'ozituma.com', 'www.ozituma.com'];

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

interface RawTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: Record<string, string>;
  raw: string;
}

const TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(source)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = value;
  }
  return attributes;
}

/**
 * Escape text for HTML, without double-escaping an entity that is already one.
 *
 * The naive `&` -> `&amp;` turns an archived `&lt;` into `&amp;lt;`, which a browser then renders
 * as the literal characters "&lt;" — so a body that correctly encoded a less-than sign would
 * display the encoding instead of the sign. WordPress output is full of legitimate entities, so
 * the ampersand is escaped only when it does not already begin one.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, ' ');
}

/**
 * A URL safe to put in `href` or `src`.
 *
 * `javascript:` and `data:` are the two that matter. `data:` is refused except for images,
 * where it is a legitimate inline source but also a way to smuggle a large payload into a page —
 * so it is refused there too, on the grounds that the archive's media belongs in object storage
 * and an inline data URL in a historical document is far more likely to be residue than intent.
 */
function safeUrl(value: string, options: SanitiseOptions): string | null {
  const url = value.trim();
  if (url.length === 0) return null;

  // Control characters and embedded newlines are how a scheme gets hidden from a naive check.
  const flattened = url.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (/^javascript:/i.test(flattened)) return null;
  if (/^data:/i.test(flattened)) return null;
  if (/^vbscript:/i.test(flattened)) return null;

  const hosts = options.internalHosts ?? DEFAULT_INTERNAL_HOSTS;
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    if (hosts.includes(parsed.hostname.toLowerCase())) {
      // An internal link becomes a path on this site, so it keeps working after the move rather
      // than sending the reader back to the old WordPress address.
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return url;
    }
    return url.startsWith('/') || url.startsWith('#') ? url : null;
  } catch {
    // A relative path is fine; anything unparseable is not.
    return url.startsWith('/') || url.startsWith('#') ? url : null;
  }
}

/**
 * Rebuild archived HTML against the allowlist.
 *
 * Anything not explicitly allowed is dropped. Unbalanced tags are tolerated rather than
 * "corrected": WordPress content is frequently unbalanced, and a sanitiser that guesses at
 * structure does more damage to a historical document than one that leaves it alone.
 */
export function sanitiseArchiveHtml(html: string, options: SanitiseOptions = {}): string {
  if (!html) return '';

  // Comments first: they can hide conditionals and are never wanted in the output.
  let source = html.replace(/<!--[\s\S]*?-->/g, '');
  // Drop dangerous elements with their entire contents.
  for (const tag of DROPPED_WITH_CONTENT) {
    source = source.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    source = source.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }

  const out: string[] = [];
  let lastIndex = 0;
  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_PATTERN.exec(source)) !== null) {
    out.push(escapeHtml(source.slice(lastIndex, match.index)));
    lastIndex = TAG_PATTERN.lastIndex;

    const tag = parseAttributesTag({ name: match[2]!.toLowerCase(), closing: match[1] === '/', selfClosing: match[4] === '/', attributeSource: match[3] ?? '' });

    if (!ALLOWED_TAGS.has(tag.name)) continue; // dropped, but its text content stays
    if (tag.closing) {
      out.push(`</${tag.name}>`);
      continue;
    }

    const allowed = ALLOWED_ATTRIBUTES[tag.name] ?? new Set<string>();
    const universal = ALLOWED_ATTRIBUTES['*']!;
    const attributes: string[] = [];

    for (const [name, value] of Object.entries(tag.attributes)) {
      if (name.startsWith('on')) continue;            // event handlers, whatever the tag
      if (name === 'style' || name === 'class' || name === 'id') continue; // see the header
      if (!allowed.has(name) && !universal.has(name)) continue;

      if (name === 'href' || name === 'src' || name === 'poster') {
        const safe = safeUrl(value, options);
        if (!safe) continue;
        attributes.push(`${name}="${escapeAttribute(safe)}"`);
        continue;
      }

      // `srcset` carries several URLs; each is checked.
      if (name === 'srcset') {
        const entries = value.split(',').map((part) => part.trim()).filter(Boolean)
          .map((part) => {
            const [url = '', descriptor = ''] = part.split(/\s+/, 2);
            const safe = safeUrl(url, options);
            return safe ? `${safe}${descriptor ? ` ${descriptor}` : ''}` : null;
          })
          .filter((entry): entry is string => entry !== null);
        if (entries.length > 0) attributes.push(`srcset="${escapeAttribute(entries.join(', '))}"`);
        continue;
      }

      if (name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan' || name === 'span' || name === 'start') {
        if (!/^\d{1,6}$/.test(value)) continue;
      }

      attributes.push(`${name}="${escapeAttribute(value)}"`);
    }

    // An image with no usable source is dropped rather than rendered as a broken plate. The
    // design draws its own deliberate empty plate for a record with no picture, and a broken
    // image icon is not that.
    const isImage = tag.name === 'img';
    if (isImage && !attributes.some((a) => a.startsWith('src='))) {
      if (options.dropBrokenMedia !== false) continue;
    }

    if (tag.name === 'a') {
      const href = attributes.find((a) => a.startsWith('href='));
      if (href && !attributes.some((a) => a.startsWith('rel='))) {
        // Off-site links get rel, which the design assumes and the plan requires.
        const isInternal = !/href="https?:\/\//i.test(href);
        if (!isInternal) attributes.push('rel="noopener noreferrer"');
      }
    }

    const rendered = attributes.length > 0 ? `<${tag.name} ${attributes.join(' ')}>` : `<${tag.name}>`;
    out.push(rendered);
  }

  out.push(escapeHtml(source.slice(lastIndex)));
  return out.join('').trim();
}

function parseAttributesTag(input: { name: string; closing: boolean; selfClosing: boolean; attributeSource: string }): RawTag {
  return {
    name: input.name,
    closing: input.closing,
    selfClosing: input.selfClosing,
    attributes: parseAttributes(input.attributeSource),
    raw: '',
  };
}

// ---------------------------------------------------------------------------
// WordPress and Elementor noise
// ---------------------------------------------------------------------------

/**
 * Remove the residue a page builder leaves behind.
 *
 * Measured on the live archive: 17 plugin shortcodes across a 200-article sample. Rendered
 * literally they appear as `[vc_row]` in the middle of a history of a clan, which is exactly the
 * kind of thing that makes a reader stop trusting the page. A shortcode is a directive to a
 * plugin that no longer exists here, so it goes.
 */
export function stripShortcodes(html: string): string {
  return html
    .replace(/\[(\/?)vc_[^\]]*\]/gi, '')
    .replace(/\[(\/?)et_pb_[^\]]*\]/gi, '')
    .replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, '$1')
    .replace(/\[embed[^\]]*\]([\s\S]*?)\[\/embed\]/gi, '$1')
    .replace(/\[[a-z][a-z0-9_-]*\b[^\]]*\]/gi, '')
    .trim();
}

/** Collapse the empty paragraphs and stray breaks Elementor scatters through its output. */
function tidyWhitespace(html: string): string {
  return html
    .replace(/<p>\s*(?:&nbsp;|\u00a0)?\s*<\/p>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface PrepareOptions extends SanitiseOptions {
  /** The WordPress origin, used to recognise internal links and media. */
  origin?: string;
}

/**
 * The whole pipeline: strip the builder's residue, make internal links relative, sanitise, tidy.
 *
 * Order matters. Shortcodes are removed before sanitising because a shortcode's brackets survive
 * sanitising as text and would be escaped instead of deleted. Sanitising happens before tidying
 * so the whitespace pass sees the final structure.
 */
/**
 * Move a record's own headings into the site's outline.
 *
 * MEASURED, NOT ASSUMED
 *
 * Five of eight sampled article pages skipped a heading level, and the cause was the same every time:
 * the migrated WordPress content uses `<h4>` for its authored section headings, so a page runs
 * `h1` (the record's title) straight to `h4` (its first section). On a screen reader, or in a
 * document outline, that is a missing level — the reader is told there is structure above this
 * heading that does not exist.
 *
 * WHY THIS IS ADAPTIVE RATHER THAN A FIXED OFFSET
 *
 * The migrated records do not agree with each other. Some already start at `<h2>` and are correct;
 * others start at `<h4>`. A fixed shift would break the ones that were already right, so the offset
 * is computed per record: find the shallowest heading it actually uses, and move that to `h2` — the
 * level directly beneath the page's `h1`. Every other heading in the record moves by the same
 * amount, so the author's relative structure is preserved exactly.
 *
 * A record with no headings is returned untouched, and a record whose shallowest heading is already
 * `h2` is also returned untouched, which is the majority.
 *
 * Deliberately NOT applied to headings outside a record's body: the page's own h1 and the site's
 * section headings are ours, not the author's.
 */
export function normaliseHeadingLevels(html: string): string {
  if (!html) return html;

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  if (levels.length === 0) return html;

  /*
   * The shallowest heading the record uses becomes h2 — whatever it currently is.
   *
   * The first version of this returned early when the shallowest heading was h2 or deeper, on the
   * reasoning that only a heading ABOVE h2 was a problem. That was wrong, and a test caught it: a
   * record whose headings are all h4 still skips, because the page's own h1 is followed by h4 with
   * h2 and h3 missing. Depth in the source is not the question; the question is whether the content's
   * top level sits directly beneath the page title.
   *
   * An offset of zero for content already at h2, so the majority of records are untouched.
   */
  const shallowest = Math.min(...levels);
  const offset = 2 - shallowest;
  return html.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (_m, level: string, attrs: string, body: string) => {
    const next = Math.min(Math.max(Number(level) + offset, 2), 6);
    return `<h${next}${attrs}>${body}</h${next}>`;
  });
}

export function prepareArchiveHtml(html: string, options: PrepareOptions = {}): string {
  if (!html) return '';
  const origin = options.origin ?? 'https://ozikoro.com';

  let source = stripShortcodes(html);

  // Point media at wherever the caller says it now lives.
  if (options.rewriteMediaUrl) {
    source = source.replace(/(\ssrc=["'])([^"']+)(["'])/gi, (_m, before: string, url: string, after: string) => {
      return `${before}${options.rewriteMediaUrl!(url)}${after}`;
    });
  }

  const sanitised = sanitiseArchiveHtml(source, {
    internalHosts: options.internalHosts ?? DEFAULT_INTERNAL_HOSTS,
    ...(options.rewriteMediaUrl ? { rewriteMediaUrl: options.rewriteMediaUrl } : {}),
    ...(options.dropBrokenMedia !== undefined ? { dropBrokenMedia: options.dropBrokenMedia } : {}),
  });

  // The record's authored headings are moved into the site's outline. See the note on
  // `normaliseHeadingLevels` for why the offset is computed per record.
  return tidyWhitespace(normaliseHeadingLevels(sanitised));
}

/**
 * The first paragraph, for a standfirst or a search result.
 *
 * Falls back to the first sentence rather than returning nothing, because a record with no
 * summary should still show something a reader can recognise.
 */
export function summarise(html: string, maxLength = 220): string {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    /*
     * Decoded in the right order, and the order is the whole difficulty. `&amp;` must be decoded
     * LAST among the ampersand forms, or a double-encoded `&amp;#8217;` is turned into a bare
     * `&#8217;` that nothing then decodes. And `&amp;` decodes to an ampersand, not to a space —
     * getting that wrong silently deleted the conjunction from every summary that contained one.
     */
    .replace(/&amp;#8217;/g, '\u2019')
    .replace(/&amp;#8216;/g, '\u2018')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

/**
 * The words in a body, counting prose rather than markup.
 *
 * WHY THIS IS A FUNCTION OF ITS OWN RATHER THAN A LINE INSIDE `readingMinutes`
 *
 * `ozikoro_article.word_count` is a real column that the migration filled and that a page can print, so an
 * edit to a body has to maintain it. Two expressions for "how many words" — one inside the reading-time
 * calculation and one in the write path — is the drift this repository keeps naming: the number on the page
 * and the number stored would agree until one of them was corrected. `readingMinutes` calls this, so there
 * is one count.
 *
 * What it counts is text between tags, split on whitespace. It does not decode entities first, so `&amp;`
 * is one word either way; a body of pure markup counts zero rather than one, which is the honest answer for
 * a record that states nothing.
 */
export function wordCount(bodyHtml: string): number {
  return bodyHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

/**
 * Reading time, at 200 words a minute.
 *
 * Computed rather than taken from WordPress, whose own word count is a rough estimate over the
 * raw markup including the page builder's wrapper text.
 */
export function readingMinutes(bodyHtml: string): number {
  return Math.max(1, Math.round(wordCount(bodyHtml) / 200));
}

/** The citation the design's `.cite-block` shows, in Chicago-ish form. */
export function citationFor(input: {
  authorName: string | null;
  title: string;
  publishedAt: string | null;
  url: string;
}): string {
  const year = input.publishedAt ? new Date(input.publishedAt).getUTCFullYear() : null;
  const author = input.authorName ?? 'Ozikoro';
  return `${author}. “${input.title}.” Ozikoro${year ? `, ${year}` : ''}. ${input.url}`;
}
