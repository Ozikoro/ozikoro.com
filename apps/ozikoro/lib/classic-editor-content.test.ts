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
import {
  READ_MORE_MARKER,
  READ_MORE_TAG,
  bodyLostBeforeSave,
  documentForEditing,
  documentForSaving,
  visualBoxDocument,
} from './classic-editor-content.ts';

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

/* ---------------------------------------------------------------------------------------------------
 * 3. THE READ MORE TAG — THE MARKER THE BOX DRAWS IS NOT WHAT IS SAVED
 * -------------------------------------------------------------------------------------------------*/

test('the tag WordPress writes is the tag this conversion writes', () => {
  // Byte for byte, because the sanitiser's rule names this exact string and a stray space would make the
  // editor write a comment the archive then deletes — the button appearing to work and storing nothing.
  assert.equal(READ_MORE_TAG, '<!--more-->');
});

test('what the box draws is not the tag, and that is the point', () => {
  // A comment cannot be seen or clicked. The marker is an element, so a writer can see where the split is
  // and delete it in one gesture; `contenteditable="false"` is what makes it one object.
  assert.notEqual(READ_MORE_MARKER, READ_MORE_TAG);
  assert.ok(READ_MORE_MARKER.includes('data-wp-more="more"'));
  assert.ok(READ_MORE_MARKER.includes('contenteditable="false"'));
  // And it holds no text at all: a label here would be counted as a word and would be saved with the body.
  assert.equal(READ_MORE_MARKER.replace(/<[^>]*>/g, ''), '');
});

test('opening a record shows the tag as a marker, in the place it was written', () => {
  const stored = '<p>Before.</p><!--more--><p>After.</p>';
  const editing = documentForEditing(stored);
  assert.ok(editing.includes(READ_MORE_MARKER), 'the tag was not turned into a marker');
  assert.ok(!editing.includes(READ_MORE_TAG), 'the raw tag is still in the editing document');
  assert.ok(editing.indexOf('Before') < editing.indexOf('data-wp-more'));
  assert.ok(editing.indexOf('data-wp-more') < editing.indexOf('After'));
});

test('saving turns every marker back into the tag and nothing else', () => {
  const editing = `<p>Before.</p>${READ_MORE_MARKER}<p>After.</p>`;
  assert.equal(documentForSaving(editing), '<p>Before.</p><!--more--><p>After.</p>');
});

test('the tag survives a full round trip through the box', () => {
  // Open, save, open again — which is what a writer does, and what a record has to survive.
  const stored = '<p>One.</p><!--more--><p>Two.</p>';
  assert.equal(documentForSaving(documentForEditing(stored)), stored);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(documentForSaving(documentForEditing(stored)), stored, 'the round trip drifted');
  }
});

test('a record with no tag is handed over byte for byte', () => {
  /*
   * The rule this screen is built around: the box is given the document it was given, unchanged. A
   * conversion that rewrote anything else would be the re-serialiser this file exists to refuse.
   */
  const stored =
    '&nbsp;\r\n\r\n[caption id="attachment_2783" align="none"]<img src="https://ozikoro.com/wp-content/uploads/2024/12/IMG_3881.jpeg" alt="">' +
    ' A man who may possibly be from Isuochi.[/caption]\r\n<p>Ọ̀nịchạ &#038; Nsụka</p>';
  assert.equal(documentForEditing(stored), stored);
  assert.equal(documentForSaving(stored), stored);
});

test('a half-deleted marker still becomes the tag rather than a stray span', () => {
  /*
   * A leaked marker would be worse than a lost one: `<span>` is on the sanitiser's allowlist, so the
   * element would survive into the published record wrapped around the word the CSS draws — except the
   * word is not in the markup, so the reader would get an empty span in the middle of the prose. So a
   * marker whose closing tag has gone is still read as the tag.
   */
  assert.equal(documentForSaving('<p>a</p><span data-wp-more="more" contenteditable="false">'), '<p>a</p><!--more-->');
  // And a marker the browser re-serialised with its attributes in another order is still found.
  assert.equal(documentForSaving('<span contenteditable="false" class="wp-more-tag" data-wp-more="more"></span>'), READ_MORE_TAG);
});

test('the marker is invisible to the word count, which is why it carries no text', () => {
  // `wordCount` strips tags, so a marker with a label in it would add a word to a published record.
  const withMarker = `<p>three words here</p>${READ_MORE_MARKER}`;
  assert.equal(withMarker.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, 3);
});
