/**
 * The Classic Editor's toolbar and its two tabs, as data and as rules — with no JSX, so they can be tested.
 *
 * ── WHY THIS IS NOT INSIDE `editor.tsx` ─────────────────────────────────────────────────────────────
 *
 * The owner's fault report is *"every other thing like publish, select category, save, and even things
 * shown at the top when writing for adding images, selecting bold, etc."* — a toolbar whose buttons are
 * drawn but do not do anything. **A button that looks right and does nothing cannot be caught by looking
 * at the screen, and it cannot be caught by a test that imports a React component**: `node --test` here
 * runs plain `.ts`, so anything that lives in the `.tsx` file is out of reach of the suite.
 *
 * So the toolbar is a list of decisions rather than a list of `<button>` elements. Every entry **must**
 * say one of three things, and the type will not let it say nothing:
 *
 *   * `command`     — run this browser editing command, with this value, or after asking this question;
 *   * `wrap`        — put these two strings around the selection, for the commands no browser implements
 *                     (strikethrough, which must write `<s>` rather than `<strike>`, and code);
 *   * `unavailable` — drawn and disabled, with the reason in the reader's words.
 *
 * `editor.tsx` renders this list and nothing else, so the list and the screen cannot disagree.
 * `classic-editor.test.ts` checks each of those three promises, including that every `wrap` writes markup
 * `sanitiseArchiveHtml` actually keeps.
 */

/** Which of the two tabs is showing. One document, two ways of looking at it. */
export type EditorView = 'visual' | 'text';

/**
 * The document the form submits, which is the one belonging to the tab that is showing.
 *
 * WordPress submits one field whichever tab is up: `switchEditors` keeps `#content` and the hidden
 * textarea in step, and the form posts the textarea. The failure this function exists to make impossible
 * is the stale one — submitting the mirror while the reader is looking at the other tab, so Save writes
 * back the document they had before their last edit.
 */
export function documentToSubmit(view: EditorView, visualHtml: string, textHtml: string): string {
  return view === 'visual' ? visualHtml : textHtml;
}

/**
 * The tab that is showing after Visual or Text is clicked, and the document it must be given.
 *
 * **THE DOCUMENT COMES BACK UNCHANGED, AND THAT IS THE WHOLE RULE.** WordPress's `switchEditors` toggles
 * two views of one document; it does not convert, re-parse or re-serialise anything. A round trip through
 * the tabs therefore has to be lossless — which matters more here than in WordPress, because these bodies
 * hold WordPress HTML with `[caption]` shortcodes, entities like `&#038;` and `wp-content` image URLs, and
 * every one of those is something a re-serialiser rewrites.
 */
export function switchEditorView(next: EditorView, html: string): { view: EditorView; html: string } {
  return { view: next, html };
}

/** Every control carries a label, a tooltip, and — for the three letter controls — an icon class. */
interface ControlBase {
  id: string;
  label: string;
  title: string;
  /** `mce-ico-b`, `mce-ico-em` and `mce-ico-s` draw bold, italic and struck-through letters. */
  labelClass?: string;
}

/** A toolbar entry: a command, a wrap, a stated refusal, a save-time conversion, or the rule between groups. */
export type ToolbarControl =
  | (ControlBase & {
      kind: 'command';
      command: string;
      value?: string;
      /**
       * Set when the command cannot run without an address from the reader — WordPress's link button
       * opens a dialog for exactly this. The question lives here rather than in the component so that
       * "which control asks something" is one readable list.
       */
      prompt?: { message: string; initial: string };
    })
  | (ControlBase & { kind: 'wrap'; open: string; close: string })
  /**
   * The Read More button, which is the one control whose markup is **not** what it saves.
   *
   * WordPress's `wp_more` inserts a visible placeholder into the editing box and stores `<!--more-->`;
   * the conversion lives in `classic-editor-content.ts`, and this kind is the statement that the button
   * has one. It is a kind of its own rather than a `command` because `document.execCommand` has no
   * read-more command — naming one would be naming a command the browser ignores, which is the fault
   * `BROWSER_COMMANDS` exists to catch.
   */
  | (ControlBase & { kind: 'read-more' })
  /**
   * Remove link — the browser's command, but not delegated to blindly.
   *
   * `document.execCommand('unlink')` is a real command and returns true whenever a non-collapsed range
   * covers the link; **measured in Chrome, it returns false and leaves the anchor alone for a collapsed
   * selection**, which is where a writer's caret is when they click a link and reach for this button. So
   * the control is named as its own kind and `editor.tsx` widens the selection before running the command.
   * Naming it `command: 'unlink'` would have been a claim that the browser can do it from any caret, and
   * that claim is false.
   */
  | (ControlBase & { kind: 'unlink' })
  | (ControlBase & { kind: 'unavailable'; why: string })
  | { kind: 'separator'; id: string };

/**
 * Row one: the controls WordPress draws without the Toolbar Toggle, in WordPress's order.
 *
 * WordPress's `formatselect` is drawn by `editor.tsx` at the head of this row, because it is a `<select>`
 * and not a button; "Add Media" is not here because WordPress puts it in the strip above the toolbar
 * (`#wp-content-editor-tools`), which is where this screen puts it too.
 *
 * The three alignment buttons are drawn and disabled: the archive's sanitiser drops `style`, `class` and
 * `id` from every saved body, so each of them would be a control that returned a save and changed nothing.
 *
 * **The More button is NOT disabled any more, and the reason it was is worth keeping.** It carried the
 * reason *"this archive renders a record whole and removes every HTML comment, so `<!--more-->` would not
 * survive the save"* — and that was true. Two things were then measured and the second is what made the
 * button answerable: WordPress's own `wp_more` inserts `<!--more-->` and nothing else, and the sanitiser
 * is a thing this repository owns and could be told to keep that one string. So the tag is now kept,
 * `documentForSaving` writes it, and the button does what the original does instead of saying it cannot.
 * See `READ_MORE_TAG` in `packages/ozikoro/src/content.ts` for why keeping it is not a hole in the
 * comment rule.
 */
export const TOOLBAR_ROW_1: ToolbarControl[] = [
  { kind: 'command', id: 'bold', label: 'B', labelClass: 'mce-ico-b', title: 'Bold', command: 'bold' },
  { kind: 'command', id: 'italic', label: 'I', labelClass: 'mce-ico-em', title: 'Italic', command: 'italic' },
  { kind: 'separator', id: 'sep-1' },
  { kind: 'command', id: 'bullist', label: '• List', title: 'Bulleted list', command: 'insertUnorderedList' },
  { kind: 'command', id: 'numlist', label: '1. List', title: 'Numbered list', command: 'insertOrderedList' },
  {
    kind: 'command',
    id: 'blockquote',
    label: '❝',
    title: 'Blockquote',
    command: 'formatBlock',
    value: 'BLOCKQUOTE',
  },
  { kind: 'separator', id: 'sep-2' },
  {
    kind: 'unavailable',
    id: 'alignleft',
    label: '⇤',
    title: 'Align left — not offered',
    why: 'the archive drops every presentational attribute on save, so an alignment set here would not survive it',
  },
  {
    kind: 'unavailable',
    id: 'aligncenter',
    label: '↔',
    title: 'Align centre — not offered',
    why: 'the archive drops every presentational attribute on save, so an alignment set here would not survive it',
  },
  {
    kind: 'unavailable',
    id: 'alignright',
    label: '⇥',
    title: 'Align right — not offered',
    why: 'the archive drops every presentational attribute on save, so an alignment set here would not survive it',
  },
  { kind: 'separator', id: 'sep-3' },
  {
    kind: 'command',
    id: 'link',
    label: '🔗',
    title: 'Insert/edit link',
    command: 'createLink',
    prompt: { message: 'Enter the address this text should link to:', initial: 'https://' },
  },
  /*
   * REMOVE LINK, WHICH IS THE BUTTON THE OWNER NAMED AS THE LANDMARK FOR THE FAULT.
   *
   * *"the more button beside remove link is not working"* — so this is the button it is beside, and it was
   * measured rather than left as a delegation: Chrome's `execCommand('unlink')` does nothing for a
   * collapsed caret, which is where a writer's caret is when they click a link and reach for this. See the
   * note on the `unlink` kind.
   */
  { kind: 'unlink', id: 'unlink', label: '⛓︎̸', title: 'Remove link' },
  /*
   * THE MORE BUTTON, WITH WORDPRESS'S OWN TOOLTIP.
   *
   * `tooltip: 'Insert Read More tag'` is the string its plugin registers for `wp_more`, and it is used
   * here verbatim — the owner's report was *"the more button beside remove link is not working. please
   * look into the original classic editor files, find out what it does"*, and the honest answer starts
   * with the original's own words for it. It sits where WordPress puts it, immediately after `unlink`.
   */
  { kind: 'read-more', id: 'wp_more', label: 'More', title: 'Insert Read More tag' },
];

/**
 * Row two, which the Toolbar Toggle reveals — TinyMCE's `wp_adv`, which is WordPress's kitchen sink.
 *
 * WordPress's `mce_buttons_2` is `strikethrough, hr, forecolor, pastetext, removeformat, charmap, outdent,
 * indent, undo, redo, wp_help`, and the Format menu is drawn by `editor.tsx` at the head of this row rather
 * than described here, because it is a `<select>` and not a button. Its "Preformatted" entry writes `<pre>`,
 * which is the block-level spelling of the Code button and the reason `pre` sits on the sanitiser's
 * allowlist beside `code`.
 */
export const TOOLBAR_ROW_2: ToolbarControl[] = [
  {
    kind: 'wrap',
    id: 'strikethrough',
    label: 'S',
    labelClass: 'mce-ico-s',
    title: 'Strikethrough — writes <s>, because <strike> is not markup the archive keeps',
    open: '<s>',
    close: '</s>',
  },
  { kind: 'command', id: 'underline', label: 'U', labelClass: 'mce-ico-u', title: 'Underline', command: 'underline' },
  { kind: 'command', id: 'hr', label: '—', title: 'Horizontal line', command: 'insertHorizontalRule' },
  { kind: 'command', id: 'removeformat', label: '✕ Format', title: 'Clear formatting', command: 'removeFormat' },
  {
    kind: 'wrap',
    id: 'code',
    label: '</>',
    title: 'Code — wraps the selection in <code>',
    open: '<code>',
    close: '</code>',
  },
  { kind: 'separator', id: 'sep-4' },
  { kind: 'command', id: 'outdent', label: '⇤ Indent', title: 'Decrease indent', command: 'outdent' },
  { kind: 'command', id: 'indent', label: '⇥ Indent', title: 'Increase indent', command: 'indent' },
  { kind: 'separator', id: 'sep-5' },
  { kind: 'command', id: 'undo', label: '↶', title: 'Undo', command: 'undo' },
  { kind: 'command', id: 'redo', label: '↷', title: 'Redo', command: 'redo' },
];

/** Both rows, for the tests that read the toolbar as one thing. */
export const TOOLBAR: ToolbarControl[] = [...TOOLBAR_ROW_1, ...TOOLBAR_ROW_2];

/**
 * The editing commands a browser implements, as far as this toolbar uses them.
 *
 * It is written out rather than derived because the point of the list is to be checked against: a
 * `command` entry naming something not in here is a button whose click reaches `document.execCommand`, is
 * ignored, and leaves the document alone — the fault this whole screen exists to fix.
 *
 * `unlink` IS STILL USED EVEN THOUGH NO `command` ENTRY NAMES IT: the `unlink` kind's handler in
 * `editor.tsx` widens the selection to the anchor and then runs exactly this command. It stays on the list
 * because the list is about what the browser implements, and deleting it would turn a working control into
 * one the test suite would then flag if anyone wired it back up as a plain command.
 */
export const BROWSER_COMMANDS = new Set([
  'bold',
  'italic',
  'underline',
  'insertUnorderedList',
  'insertOrderedList',
  'formatBlock',
  'createLink',
  'unlink',
  'removeFormat',
  'insertHorizontalRule',
  'outdent',
  'indent',
  'undo',
  'redo',
]);

/**
 * The markup the editor's own controls write, for the test that holds them to the archive's allowlist.
 *
 * These are not a second allowlist: the sanitiser in `packages/ozikoro/src/content.ts` is the one that
 * decides what survives, and this is the editor's own statement of what it means to write. The test reads
 * both and fails if a `wrap` names a tag the sanitiser would remove — which is how `<strike>` was caught.
 */
export const EDITOR_WRAPS = TOOLBAR.filter(
  (control): control is ControlBase & { kind: 'wrap'; open: string; close: string } => control.kind === 'wrap'
);
