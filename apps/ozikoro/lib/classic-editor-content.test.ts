/**
 * The two rules that stop the Classic Editor losing a body — the measured fault, pinned here.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * The owner said the Classic Editor was broken and that saving did not work. Measured in Chrome over CDP
 * against a signed-in local server, the fault was sharper than that and worse:
 *
 *     /admin/posts/new/ · focus the content box · one keystroke, or one paste
 *     the box is emptied            (the same DOM node, emptied by a re-render)
 *     Save Draft posts bodyHtml=""  and the screen answers "Draft created"
 *
 * A success message over an empty record is the failure this archive must not produce, and the component
 * fix — React no longer owns the contenteditable's contents — cannot be tested by `node --test`, which runs
 * plain TypeScript and not JSX. So the two decisions are functions, and they are tested here: the refusal
 * that makes an empty-body save impossible, and the rule that keeps the Visual and Text tabs one document.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyLostBeforeSave, visualBoxDocument } from './classic-editor-content.ts';

/* ---------------------------------------------------------------------------------------------------
 * 1. THE SAVE THAT MUST BE REFUSED
 * -------------------------------------------------------------------------------------------------*/

test('a box emptied under a non-empty document refuses the save', () => {
  // The measured fault, exactly: the box is empty and the document React last saw typed was not.
  assert.equal(bodyLostBeforeSave('', '<p>The long drum at Nkwo.</p>', true), true);
  // Whitespace-only counts as empty, because a body of spaces is not the document either.
  assert.equal(bodyLostBeforeSave('   \n  ', '<p>something</p>', true), true);
});

test('a body of markup with no text is NOT refused, and that limit is stated', () => {
  /*
   * The guard reads the box's emptiness, not its word count, and this is where that stops: an image-only
   * body is a legitimate record and must save. The fault it was written for empties the box completely —
   * `innerHTML === ''`, measured — so a body that still holds a `<p></p>` or a `<figure>` is left alone
   * rather than second-guessed.
   */
  assert.equal(bodyLostBeforeSave('<p></p>', '<p>something</p>', true), false);
  assert.equal(bodyLostBeforeSave('<figure><img src="/media/a.jpg" alt=""></figure>', '<p>x</p>', true), false);
});

test('an empty body is allowed when nothing was typed into the box', () => {
  // WordPress saves an untitled, empty draft, and an editor may clear a body deliberately. The refusal is
  // only for the case that cannot be deliberate.
  assert.equal(bodyLostBeforeSave('', '', true), false);
  assert.equal(bodyLostBeforeSave('', '   ', true), false);
});

test('a body with anything in it is never refused', () => {
  assert.equal(bodyLostBeforeSave('<p>x</p>', '', true), false);
  assert.equal(bodyLostBeforeSave('<p>x</p>', '<p>y</p>', true), false);
});

test('the Text tab is exempt, because there the box IS the document', () => {
  // The Text tab is a controlled textarea: what it shows is the document, so an empty one is a decision.
  assert.equal(bodyLostBeforeSave('', '<p>typed earlier in the visual box</p>', false), false);
});

test('the guard does not depend on the stored body, only on what was typed', () => {
  // A piece whose stored body is enormous is not thereby protected: if nothing was typed, an empty save is
  // the reader's own act and is allowed through. This is the line between a guard and a nanny.
  assert.equal(bodyLostBeforeSave('', '', true), false);
});

/* ---------------------------------------------------------------------------------------------------
 * 2. THE TWO TABS ARE ONE DOCUMENT
 * -------------------------------------------------------------------------------------------------*/

test('coming back from the Text tab shows the document the reader was editing, not the stored one', () => {
  // The failure this rules out: the reader switches to Text, edits, switches back, and sees the body as it
  // was saved — every Text-tab edit silently gone.
  const pending = '<p>edited in the text tab</p>';
  const stored = '<p>as the record holds it</p>';
  assert.equal(visualBoxDocument(pending, stored), pending);
});

test('opening a record with no tab switch shows the stored body', () => {
  assert.equal(visualBoxDocument(null, '<p>stored</p>'), '<p>stored</p>');
  // A new piece is the same case with an empty body, which is what made the old prop wipe the box.
  assert.equal(visualBoxDocument(null, ''), '');
});

test('the document is handed over byte for byte, so nothing a record holds is rewritten', () => {
  /*
   * The real body of record 2135 on the local cluster: a recovered WordPress draft with `[caption]`
   * shortcodes, a non-breaking-space entity and `wp-content` image addresses. Every one of those is
   * something a re-serialiser rewrites — which is why the Visual box is given the string unchanged and why
   * a round trip through the tabs must not touch it.
   */
  const stored =
    '&nbsp;\n\n[caption id="attachment_10058" align="none" width="768"]' +
    '<img src="https://ozikoro.com/wp-content/uploads/2026/02/unnamed4.jpg" alt="" width="768" height="546">' +
    ' A historical documentation of various Igbo female hairstyles.[/caption]\n\n<p>Text with &#8220;curly quotes&#8221; and an ampersand &amp; in it.</p>';
  assert.equal(visualBoxDocument(null, stored), stored);
  assert.equal(visualBoxDocument(stored, ''), stored);
  // And the entity forms are not touched on the way through, either.
  assert.match(visualBoxDocument(null, stored), /&#8220;/);
  assert.match(visualBoxDocument(null, stored), /&amp;/);
  assert.equal((visualBoxDocument(null, stored).match(/&amp;amp;/g) ?? []).length, 0);
});
