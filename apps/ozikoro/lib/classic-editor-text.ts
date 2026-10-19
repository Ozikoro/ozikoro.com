/**
 * WordPress QuickTags, expressed as pure text edits.
 *
 * The Text tab is not the Visual toolbar drawn over a textarea. WordPress gives it a separate
 * QuickTags toolbar that writes markup at the textarea selection, and this module is that toolbar's
 * data and its editing rules. Keeping the insertion pure means the no-selection caret position,
 * open-tag stack, link/image prompts and selection clamping are testable without a browser.
 *
 * The defaults and the editing algorithm below are read from WordPress core's
 * `src/js/_enqueues/lib/quicktags.js`: a tag with an end tag opens on the first click and closes on the
 * second, a self-closing tag is inserted after a selection, and the close button unwinds every open
 * tag in last-in-first-out order.
 */
import { READ_MORE_TAG } from './classic-editor-content.ts';

export type QuickTagKind = 'wrap' | 'link' | 'image' | 'more' | 'close';

export interface QuickTagPrompt {
  message: string;
  initial: string;
  altMessage?: string;
  altInitial?: string;
}

export interface QuickTag {
  id: string;
  label: string;
  title: string;
  closeTitle?: string;
  kind: QuickTagKind;
  open?: string;
  close?: string;
  prompt?: QuickTagPrompt;
}

export interface QuickTagOptions {
  url?: string;
  alt?: string;
  /** The tags currently open, oldest first. WordPress calls this stack `ed.openTags`. */
  openTags?: readonly string[];
  /** WordPress stamps `del` and `ins` with the time its QuickTags script loaded. */
  datetime?: string;
}

export interface QuickTagResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  /** The new open-tag stack, oldest first. */
  openTags: string[];
}

const DATETIME_TOKEN = '{datetime}';

/** WordPress's `_datetime`: UTC with a numerical zero offset, e.g. `2026-10-18T12:34:56+00:00`. */
export function wordpressDatetime(date = new Date()): string {
  const zeroise = (number: number) => String(number).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${zeroise(date.getUTCMonth() + 1)}-${zeroise(date.getUTCDate())}` +
    `T${zeroise(date.getUTCHours())}:${zeroise(date.getUTCMinutes())}:${zeroise(date.getUTCSeconds())}+00:00`
  );
}

/**
 * The default WordPress QuickTags, in their order.
 *
 * The visible labels and the tag strings are WordPress's own. `b-quote` inserts two newlines before the
 * quotation and two after it; lists close with two newlines; `more` carries the same pair.
 */
export const QUICKTAGS: QuickTag[] = [
  { id: 'b', label: 'b', title: 'Bold', closeTitle: 'Close Bold tag', kind: 'wrap', open: '<strong>', close: '</strong>' },
  { id: 'i', label: 'i', title: 'Italic', closeTitle: 'Close Italic tag', kind: 'wrap', open: '<em>', close: '</em>' },
  {
    id: 'link',
    label: 'link',
    title: 'Insert/edit link',
    closeTitle: 'Close link tag',
    kind: 'link',
    close: '</a>',
    prompt: { message: 'Enter the URL', initial: 'http://' },
  },
  {
    id: 'b-quote',
    label: 'b-quote',
    title: 'Blockquote',
    closeTitle: 'Close Blockquote tag',
    kind: 'wrap',
    open: '\n\n<blockquote>',
    close: '</blockquote>\n\n',
  },
  {
    id: 'del',
    label: 'del',
    title: 'Deleted text',
    closeTitle: 'Close Deleted text tag',
    kind: 'wrap',
    open: `<del datetime="${DATETIME_TOKEN}">`,
    close: '</del>',
  },
  {
    id: 'ins',
    label: 'ins',
    title: 'Inserted text',
    closeTitle: 'Close Inserted text tag',
    kind: 'wrap',
    open: `<ins datetime="${DATETIME_TOKEN}">`,
    close: '</ins>',
  },
  {
    id: 'img',
    label: 'img',
    title: 'Insert image',
    kind: 'image',
    prompt: {
      message: 'Enter the URL of the image',
      initial: 'http://',
      altMessage: 'Enter the description of the image',
      altInitial: '',
    },
  },
  {
    id: 'ul',
    label: 'ul',
    title: 'Unordered list',
    closeTitle: 'Close Unordered list tag',
    kind: 'wrap',
    open: '<ul>\n',
    close: '</ul>\n\n',
  },
  {
    id: 'ol',
    label: 'ol',
    title: 'Ordered list',
    closeTitle: 'Close Ordered list tag',
    kind: 'wrap',
    open: '<ol>\n',
    close: '</ol>\n\n',
  },
  {
    id: 'li',
    label: 'li',
    title: 'List item',
    closeTitle: 'Close List item tag',
    kind: 'wrap',
    open: '\t<li>',
    close: '</li>\n',
  },
  {
    id: 'code',
    label: 'code',
    title: 'Code',
    closeTitle: 'Close Code tag',
    kind: 'wrap',
    open: '<code>',
    close: '</code>',
  },
  { id: 'more', label: 'more', title: 'Insert Read More tag', kind: 'more' },
  { id: 'close', label: 'close', title: 'Close all open tags', kind: 'close' },
];

export function quickTagById(id: string): QuickTag | undefined {
  return QUICKTAGS.find((tag) => tag.id === id);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clampSelection(value: string, start: number, end: number): [number, number] {
  const safeStart = Math.max(0, Math.min(start, end, value.length));
  const safeEnd = Math.max(safeStart, Math.min(Math.max(start, end), value.length));
  return [safeStart, safeEnd];
}

function result(value: string, caret: number, openTags: string[]): QuickTagResult {
  return { value, selectionStart: caret, selectionEnd: caret, openTags };
}

function insert(value: string, at: number, text: string): string {
  return value.slice(0, at) + text + value.slice(at);
}

/**
 * Apply one QuickTag to a string and return the new text, selection and open-tag stack.
 *
 * The rules, all from `qt.TagButton.prototype.callback` and `qt._close`:
 *
 * - A selected range loses one trailing newline before it is wrapped.
 * - A range with an end tag is wrapped, and the stack is untouched.
 * - A collapsed range inserts only the opening tag, marks that tag open, and puts the caret after it.
 *   The next click on the same button inserts its closing tag and clears the mark.
 * - `img` and `more` have no end tag: they are inserted after a selection, or at the caret when there
 *   is no selection.
 * - `close` unwinds the open-tag stack from the end, inserting each closing tag at the caret.
 */
export function applyQuickTag(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tag: QuickTag,
  options: QuickTagOptions = {}
): QuickTagResult {
  const [start, rawEnd] = clampSelection(value, selectionStart, selectionEnd);
  const end = start < rawEnd && value.charAt(rawEnd - 1) === '\n' ? rawEnd - 1 : rawEnd;
  const selected = value.slice(start, end);
  const openTags = [...(options.openTags ?? [])];
  const datetime = options.datetime ?? wordpressDatetime();

  if (tag.kind === 'close') {
    let nextValue = value;
    let caret = end;
    while (openTags.length > 0) {
      const openId = openTags.pop();
      const openTag = openId ? quickTagById(openId) : undefined;
      if (!openTag?.close) continue;
      nextValue = insert(nextValue, caret, openTag.close);
      caret += openTag.close.length;
    }
    return result(nextValue, caret, openTags);
  }

  if (tag.kind === 'link') {
    const url = options.url ?? '';
    if (selected.length > 0) {
      if (url.length === 0) {
        return { value, selectionStart: start, selectionEnd: end, openTags };
      }
      const markup = `<a href="${escapeAttribute(url)}">${selected}</a>`;
      return result(value.slice(0, start) + markup + value.slice(end), end + markup.length, openTags);
    }

    const openIndex = openTags.indexOf('link');
    if (openIndex !== -1) {
      const close = tag.close ?? '</a>';
      openTags.splice(openIndex, 1);
      return result(insert(value, end, close), end + close.length, openTags);
    }

    if (url.length === 0) {
      return { value, selectionStart: start, selectionEnd: end, openTags };
    }
    const open = `<a href="${escapeAttribute(url)}">`;
    openTags.push('link');
    return result(insert(value, end, open), end + open.length, openTags);
  }

  if (tag.kind === 'image') {
    const url = options.url ?? '';
    if (url.length === 0) {
      return { value, selectionStart: start, selectionEnd: end, openTags };
    }
    const markup = `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(options.alt ?? '')}" />`;
    return result(insert(value, end, markup), end + markup.length, openTags);
  }

  if (tag.kind === 'more') {
    const markup = `${READ_MORE_TAG}\n\n`;
    return result(insert(value, end, markup), end + markup.length, openTags);
  }

  const open = (tag.open ?? '').split(DATETIME_TOKEN).join(datetime);
  const close = tag.close ?? '';
  if (selected.length > 0) {
    const markup = `${open}${selected}${close}`;
    return result(value.slice(0, start) + markup + value.slice(end), end + open.length + close.length, openTags);
  }

  const openIndex = openTags.indexOf(tag.id);
  if (openIndex !== -1) {
    openTags.splice(openIndex, 1);
    return result(insert(value, end, close), end + close.length, openTags);
  }

  if (close.length > 0) openTags.push(tag.id);
  return result(insert(value, end, open), end + open.length, openTags);
}
