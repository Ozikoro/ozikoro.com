/*
 * html-anchor.ts — FINDING A PLACE IN A SERVED DOCUMENT WITHOUT `lastIndexOf`.
 *
 * ── WHY THIS FILE EXISTS, AND THE MEASUREMENT THAT ASKED FOR IT ─────────────────────────────────────
 *
 * The ad unit now goes INSIDE the reading matter, after the document's third paragraph, and the discussion
 * now goes immediately after `<section id="citation">`. **Neither of those places has a unique tag in the
 * document, which is the whole difficulty:**
 *
 *     `</p>`  appears 14 times in one published record, and thousands of times across the archive
 *     `</div>` appears 5 times inside a single `.prose`, and the box's own markup contends for it
 *     `</main>` is unique — and that uniqueness is exactly why the old anchor was the closing `</main>`
 *            and why the box sat at the foot of the page instead of after the citation
 *
 * **So a `lastIndexOf`-style anchor cannot express either position, and a `replace` would be worse:** a
 * `String.replace('</p>', unit)` is a replace of the FIRST match and `.replaceAll` would put a unit after
 * every paragraph in the archive. Both are the fault this module exists to make impossible.
 *
 * What is needed is an offset computed from the document's OWN STRUCTURE — *the third `<p>` that is a
 * direct child of the element whose class list contains `prose`* — and that is a one-pass scan with a tag
 * stack, which is what this file is.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────────────────────────────
 *
 * **It is not an HTML parser and it does not claim to be one.** It is a stack of tag NAMES over a served
 * document that this application itself generates, and its contract is stated rather than implied:
 *
 *   · an element that is not closed by the end of the document yields `closeEnd: null`, and a caller that
 *     wants a position gets `null` rather than a wrong offset; a direct child in the same state is returned
 *     with `closed: false`, which is the same refusal in the shape a filtered list needs;
 *   · `<script>` and `<style>` bodies are skipped whole, because their contents are not markup;
 *   · comments, `<!doctype …>` and `<?…?>` are skipped whole, because a tag-shaped string inside a comment
 *     is not an element — and the ad unit's own `<!-- Resp -->` label is exactly such a string;
 *   · an opening `<p>` or `<li>` whose parent is already an open `<p>`/`<li>` closes it first, which is
 *     HTML's own implied-end-tag rule and the one place a document this generator produces can be
 *     unbalanced.
 *
 * ⚠️ **EVERY CALLER MUST HOLD A FALLBACK.** Every function here returns `null` rather than guessing, and a
 * page that cannot find its anchor must serve a missing box — never a mangled one and never a 404. See
 * `withAdsenseUnit` and `insertDiscussionAfterCitation` for the chains that do that.
 */

/** Elements that never have a closing tag, so they never open a level on the stack. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/*
 * Tags whose parent-of-the-same-name is implicitly closed by their own opening tag. Only these two matter
 * for the documents this is used on: the archive's records carry long runs of `<p>`, and its lists are
 * `<ul><li>…</li></ul>`.
 */
const IMPLIED_CLOSE: ReadonlyMap<string, string> = new Map([['p', 'p'], ['li', 'li']]);

/** A tag, with attribute values allowed to contain `>`. Fresh per call: `lastIndex` is state. */
const tagRe = () => /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/** One element, located by byte offset in the document it was found in. */
export interface ElementBox {
  /** The tag name, lower-cased. */
  name: string;
  /** The byte offset of the `<` that opens the element. */
  start: number;
  /** The byte offset just after the `>` of the element's own end tag, or of a void/self-closing tag. */
  end: number;
  /**
   * Whether the document actually closed this element.
   *
   * ⚠️ **A CALLER THAT WANTS AN INSERTION POINT MUST CHECK THIS.** An element the document never closed is
   * recorded with `end` at the end of the document, and inserting there would put the box after the closing
   * `</html>` of a page that was already broken. `false` means "no offset", not "the end".
   */
  closed: boolean;
}

/** The attribute's value, or `null` when the attribute is not on the tag. */
function attributeValue(attributes: string, name: string): string | null {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes);
  if (!found) return null;
  return found[1] ?? found[2] ?? '';
}

/** The byte offset of the `<` that opens the first element whose class list contains `className`. */
export function findOpenTagByClass(html: string, className: string, from = 0): number | null {
  const re = tagRe();
  re.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const [, closing = '', rawName = '', attributes = '', selfClosing = ''] = match;
    if (closing === '/') continue;
    const name = rawName.toLowerCase();
    if (VOID_ELEMENTS.has(name) || selfClosing === '/') continue;
    const value = attributeValue(attributes, 'class');
    if (value === null) continue;
    if (value.split(/\s+/).includes(className)) return match.index;
  }
  return null;
}

/** The byte offset of the `<` that opens the first element carrying this `id`. */
export function findOpenTagById(html: string, id: string, from = 0): number | null {
  const re = tagRe();
  re.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const [, closing = '', rawName = '', attributes = '', selfClosing = ''] = match;
    if (closing === '/') continue;
    if (VOID_ELEMENTS.has(rawName.toLowerCase()) || selfClosing === '/') continue;
    if (attributeValue(attributes, 'id') === id) return match.index;
  }
  return null;
}

/**
 * The offset just after the end tag of the first element carrying this `id`, or `null`.
 *
 * This is the whole of the "immediately after `Cite this article`" anchor: the discussion box is spliced at
 * the offset this returns. `null` — no such element, or the document never closed it — is a refusal, and the
 * caller falls back rather than guessing.
 */
export function elementEndAnchorById(html: string, id: string): number | null {
  const start = findOpenTagById(html, id);
  if (start === null) return null;
  return scanElement(html, start).closeEnd;
}

/**
 * `block` spliced in immediately after the end tag of the first element carrying this `id`.
 *
 * ⚠️ **`null` IS THE RETURN FOR "THE DOCUMENT HAS NO SUCH PLACE", AND IT IS NOT AN EMPTY STRING.** A caller
 * that cannot find its anchor must fall back to another one or serve the page without the block; returning
 * the document unchanged here would be indistinguishable from a successful insertion of nothing.
 */
export function insertAfterElementId(html: string, id: string, block: string): string | null {
  if (!block) return null;
  const at = elementEndAnchorById(html, id);
  if (at === null) return null;
  return `${html.slice(0, at)}${block}\n${html.slice(at)}`;
}

/**
 * The element opened at `openStart`, walked one tag at a time.
 *
 * `children` holds the element's DIRECT children, in document order, each with the offset just after its own
 * end tag. `closeEnd` is the offset just after the container's own end tag, or `null` when the document ends
 * with the element still open — which is the honest answer and the reason no caller may assume a position.
 */
export function scanElement(
  html: string,
  openStart: number
): { children: ElementBox[]; closeEnd: number | null } {
  const re = tagRe();
  re.lastIndex = openStart;
  const open = re.exec(html);
  if (!open || open.index !== openStart || open[1] === '/') return { children: [], closeEnd: null };

  const container = (open[2] ?? '').toLowerCase();
  const children: ElementBox[] = [];
  const stack: string[] = [];
  /** The index in `children` of the one direct child that is currently open. */
  let direct: number | null = null;
  let cursor = openStart + open[0].length;

  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt === -1) break;

    /* Not markup: skip it whole rather than reading a tag out of it. */
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      cursor = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      cursor = end === -1 ? html.length : end + 1;
      continue;
    }

    re.lastIndex = lt;
    const match = re.exec(html);
    /* A bare `<` in text is not a tag. */
    if (!match || match.index !== lt) {
      cursor = lt + 1;
      continue;
    }

    const [whole = '', slash = '', rawName = '', , selfClose = ''] = match;
    const closing = slash === '/';
    const name = rawName.toLowerCase();
    const start = match.index;
    const end = start + whole.length;

    /* A `<script>`/`<style>` body is not markup, whatever it contains. */
    if (name === 'script' || name === 'style') {
      const closer = new RegExp(`</${name}\\s*>`, 'ig');
      closer.lastIndex = end;
      const found = closer.exec(html);
      const bodyEnd = found ? found.index + found[0].length : html.length;
      if (!closing && stack.length === 0) {
        children.push({ name, start, end: bodyEnd, closed: found !== null });
      }
      cursor = bodyEnd;
      continue;
    }

    /* The one direct child that can be open: HTML does not allow the tags this walks to overlap. */
    const openChild = direct === null ? undefined : children[direct];

    if (closing) {
      if (stack.length === 0) {
        return { children, closeEnd: name === container ? end : null };
      }
      stack.pop();
      if (stack.length === 0 && openChild !== undefined) {
        openChild.end = end;
        openChild.closed = true;
        direct = null;
      }
      cursor = end;
      continue;
    }

    if (selfClose === '/' || VOID_ELEMENTS.has(name)) {
      if (stack.length === 0) children.push({ name, start, end, closed: true });
      cursor = end;
      continue;
    }

    /* HTML's implied end tag: `<p>a<p>b` is two paragraphs, not one nested in the other. */
    const implied = IMPLIED_CLOSE.get(name);
    if (implied !== undefined && stack[stack.length - 1] === implied) {
      stack.pop();
      if (stack.length === 0 && openChild !== undefined) {
        openChild.end = start;
        openChild.closed = true;
        direct = null;
      }
    }

    if (stack.length === 0) {
      direct = children.length;
      /* Provisional; replaced by the real end tag. A child the document never closes keeps `closed: false`. */
      children.push({ name, start, end: html.length, closed: false });
    }
    stack.push(name);
    cursor = end;
  }

  return { children, closeEnd: null };
}
