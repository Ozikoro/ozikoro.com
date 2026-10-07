/**
 * The Classic Editor's toolbar and its two tabs — the two things the owner named by hand.
 *
 * ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────────────────────────────
 *
 * *"this is a page … and it does not look like classic editor dashboard … and shows completely html editor,
 * not even an option to switch, and every other thing like publish, select category, save, and even things
 * shown at the top when writing for adding images, selecting bold, etc."*
 *
 * Two of those are testable without a browser and are tested here:
 *
 *   1. **Bold, and the rest of the toolbar.** `lib/classic-editor.ts` holds the toolbar as decisions rather
 *      than as buttons, so "is this control real" is a question about data. Every entry must name a command
 *      a browser implements, or the two strings it wraps the selection in, or the reason it is disabled —
 *      and the two wrapped tags are checked against `sanitiseArchiveHtml`, because a tag the sanitiser
 *      removes is a button that saves and changes nothing.
 *   2. **The Visual / Text switch.** `switchEditorView` must hand the document back byte for byte, and
 *      `documentToSubmit` must answer with the tab that is showing. Those are the two ways a tab switch
 *      loses work, and both are pure functions.
 *
 * The browser half — that a click on Bold actually bolds, in Chrome, against a real record — is run
 * separately over CDP; a unit test cannot click a button.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseArchiveHtml } from '@ozikoro/platform';
import {
  BROWSER_COMMANDS,
  EDITOR_WRAPS,
  TOOLBAR,
  TOOLBAR_ROW_1,
  TOOLBAR_ROW_2,
  documentToSubmit,
  switchEditorView,
  type ToolbarControl,
} from './classic-editor.ts';
import { READ_MORE_MARKER, documentForSaving } from './classic-editor-content.ts';

/**
 * Two real bodies, copied verbatim from the WordPress REST export this archive was migrated from
 * (`data/ozikoro-wp/cms/posts-publish.json`), chosen because they are what the round trip has to survive:
 * a `[caption]` shortcode, a `wp-content` image URL, inline `style` attributes, a `&nbsp;` entity, CRLF
 * line endings, and Igbo diacritics. Nothing here is written for the test.
 */
const RECORD_3075 = // "Ijele in Motion": one caption shortcode around one image, 272 bytes in the import.
  '[caption id="attachment_3076" align="alignnone" width="1119"]<img class="size-full wp-image-3076" ' +
  'src="https://ozikoro.com/wp-content/uploads/2025/01/IMG_4142.jpeg" alt="" width="1119" height="1537" /> ' +
  'Ijele in Motion, circa 1975.<br />Igbo Arts by Herbert Cole.[/caption]';

const RECORD_2782 = // a leading non-breaking space, then a caption; 325 bytes in the import.
  '&nbsp;\r\n\r\n[caption id="attachment_2783" align="alignnone" width="1014"]<img ' +
  'class="size-full wp-image-2783" src="https://ozikoro.com/wp-content/uploads/2024/12/IMG_3881.jpeg" ' +
  'alt="" width="1014" height="1024" /> A man who may possibly be from Isuochi (as the album was ' +
  'labelled). Photographed by G. I. Jones, 1930s.[/caption]';

const BODIES: { name: string; html: string }[] = [
  { name: 'record 3075 — a caption shortcode and an image', html: RECORD_3075 },
  { name: 'record 2782 — an entity, CRLF, and a caption', html: RECORD_2782 },
  { name: 'a body with the entity the archive stores', html: '<p>Ọ̀nịchạ &#038; Nsụka</p>' },
  { name: 'a body that is only an HTML comment', html: '<!-- wp:paragraph -->' },
  { name: 'an empty body', html: '' },
];

// ---------------------------------------------------------------------------
// The toolbar: every control is a command, a wrap, or a stated refusal
// ---------------------------------------------------------------------------

test('no toolbar control is drawn without a tooltip', () => {
  for (const control of TOOLBAR) {
    if (control.kind === 'separator') continue;
    assert.ok(control.title.trim().length > 0, `${control.id} has no title`);
    assert.ok(control.label.length > 0, `${control.id} has no label`);
  }
});

test('every command names an editing command a browser implements', () => {
  const commands = TOOLBAR.filter(
    (control): control is Extract<ToolbarControl, { kind: 'command' }> => control.kind === 'command'
  );
  assert.ok(commands.length >= 10, 'the toolbar should name the commands WordPress draws');
  for (const control of commands) {
    assert.ok(
      BROWSER_COMMANDS.has(control.command),
      `${control.id} runs document.execCommand(${control.command}), which would be ignored`
    );
  }
});

test('every disabled control says why it is disabled, in the reader’s words', () => {
  const unavailable = TOOLBAR.filter(
    (control): control is Extract<ToolbarControl, { kind: 'unavailable' }> => control.kind === 'unavailable'
  );
  // The three alignment buttons — the controls this archive cannot honour. Insert Read More used to be
  // the fourth and is a working button now, so this count is the statement that it did not go back.
  assert.equal(unavailable.length, 3);
  for (const control of unavailable) {
    assert.ok(control.why.trim().length > 10, `${control.id} is disabled without a reason`);
  }
});

test('Insert Read More is a button that acts, and it sits where WordPress puts it', () => {
  /*
   * The owner's report, verbatim: *"the more button beside remove link is not working. please look into
   * the original classic editor files, find out what it does, and make sure it actually does that"*. Two
   * things are being held here: that the control beside `unlink` is the Read More button, and that it is
   * not one of the drawn-but-disabled kind any more.
   */
  const row = TOOLBAR_ROW_1.map((control) => control.id);
  assert.equal(row[row.indexOf('unlink') + 1], 'wp_more', 'the More button is not beside Remove link');
  const more = TOOLBAR_ROW_1.find((control) => control.id === 'wp_more');
  assert.ok(more, 'row one has no wp_more control');
  assert.equal(more.kind, 'read-more', 'the More button is still drawn as a control that says it cannot act');
  // WordPress registers the tooltip as exactly this string; the button wears the original's own words.
  assert.equal(more.title, 'Insert Read More tag');
});

test('Remove link is not a blind delegation to the browser', () => {
  /*
   * MEASURED IN CHROME, on a box holding one anchor: `document.execCommand('unlink')` returns **false** and
   * leaves the anchor in place for a collapsed selection inside the link, and returns true only once a
   * non-collapsed range covers it. A collapsed caret in a link is precisely where a writer is when they
   * click the link and reach for this button, so a control that delegates is a control that does nothing
   * there. It is a `kind` of its own so that cannot be changed back without failing here.
   */
  const unlink = TOOLBAR_ROW_1.find((control) => control.id === 'unlink');
  assert.ok(unlink, 'row one has no unlink control');
  assert.equal(unlink.kind, 'unlink', 'Remove link delegates to execCommand again, which does nothing for a caret in a link');
  assert.equal(unlink.title, 'Remove link');
  // The command it eventually runs is still one the browser implements, and the list still says so.
  assert.ok(BROWSER_COMMANDS.has('unlink'));
});

test('what the More button saves is a tag the sanitiser keeps', () => {
  /*
   * THE INTERLOCK, AND THE REASON THIS BUTTON WAS DISABLED FOR SO LONG.
   *
   * The old reason for disabling it was *"the archive removes every HTML comment, so `<!--more-->` would
   * not survive the save"*. That was true. So the test is not "the button inserts something" — it is that
   * the exact document the button causes to be posted comes back out of `sanitiseArchiveHtml` intact. If
   * the sanitiser ever stops keeping the tag, this fails rather than the button silently doing nothing.
   */
  const posted = documentForSaving(`<p>Before.</p>${READ_MORE_MARKER}<p>After.</p>`);
  assert.ok(posted.includes('<!--more-->'), 'the editor did not convert the marker to the tag');
  const stored = sanitiseArchiveHtml(posted);
  assert.ok(stored.includes('<!--more-->'), 'the sanitiser dropped the Read More tag, so the button is a no-op');
  assert.ok(stored.indexOf('Before') < stored.indexOf('<!--more-->'));
  assert.ok(stored.indexOf('<!--more-->') < stored.indexOf('After'));
  // And it is still the ONLY comment that survives, tested here rather than trusted.
  assert.ok(!sanitiseArchiveHtml('<p>a</p><!-- wp:paragraph --><p>b</p>').includes('wp:paragraph'));
});

test('the toolbar carries the controls the owner named, on the rows WordPress draws them', () => {
  const ids = (row: ToolbarControl[]) => row.map((control) => control.id);
  // Row one, which WordPress draws without the Toolbar Toggle (`mce_buttons`).
  for (const id of ['bold', 'italic', 'bullist', 'numlist', 'blockquote', 'link', 'unlink']) {
    assert.ok(ids(TOOLBAR_ROW_1).includes(id), `row one has no ${id} control`);
  }
  // Row two, the kitchen sink the Toolbar Toggle reveals (`mce_buttons_2`).
  for (const id of ['strikethrough', 'code', 'outdent', 'indent', 'undo', 'redo']) {
    assert.ok(ids(TOOLBAR_ROW_2).includes(id), `row two has no ${id} control`);
  }
});

test('the two wrapped tags are markup the archive actually keeps', () => {
  // Every wrap the toolbar performs, checked against the sanitiser rather than against a second list.
  for (const control of EDITOR_WRAPS) {
    const kept = sanitiseArchiveHtml(`<p>${control.open}text${control.close}</p>`);
    const tag = /^<([a-z0-9]+)/.exec(control.open)?.[1] ?? '';
    assert.ok(tag.length > 0, `${control.id} does not open a tag`);
    assert.ok(kept.includes(`<${tag}>`), `${control.id} writes <${tag}>, which the sanitiser removes`);
  }
});

test('strikethrough writes <s> rather than <strike>, which is the fault it was written against', () => {
  const strike = EDITOR_WRAPS.find((control) => control.id === 'strikethrough');
  assert.ok(strike, 'there is no strikethrough control');
  assert.equal(strike.open, '<s>');
  // And the reason it is spelled that way: `<strike>` really is dropped, so the button would do nothing.
  const dropped = sanitiseArchiveHtml('<p>a <strike>b</strike></p>');
  assert.ok(!dropped.includes('<strike'), 'the sanitiser now keeps <strike>; the wrap could be shortened');
  assert.ok(dropped.includes('b'), 'the sanitiser should drop the tag and keep the text');
});

test('the code control writes <code>, which the editor draws and the archive now keeps', () => {
  const code = EDITOR_WRAPS.find((control) => control.id === 'code');
  assert.ok(code, 'there is no code control');
  assert.equal(code.open, '<code>');
  assert.ok(sanitiseArchiveHtml('<p>a <code>b</code></p>').includes('<code>'));
});

test('the Format menu’s Preformatted entry is drawn only because the archive keeps <pre>', () => {
  // `editor.tsx` draws `<option value="PRE">Preformatted</option>`; this is the other half of that promise.
  assert.ok(sanitiseArchiveHtml('<pre>a</pre>').includes('<pre>'));
});

// ---------------------------------------------------------------------------
// Visual / Text
// ---------------------------------------------------------------------------

test('switching tabs hands the same document back, byte for byte', () => {
  for (const body of BODIES) {
    let state = switchEditorView('text', body.html);
    assert.equal(state.html, body.html, `${body.name}: Text lost or altered the document`);
    assert.equal(state.view, 'text');

    // Text -> Visual -> Text, and Visual -> Text -> Visual, on the same document.
    for (const next of ['visual', 'text', 'visual', 'visual', 'text'] as const) {
      const before = state.html;
      state = switchEditorView(next, state.html);
      assert.equal(state.view, next, `${body.name}: the view did not change to ${next}`);
      assert.equal(state.html, before, `${body.name}: switching to ${next} altered the document`);
    }
    assert.equal(state.html, body.html, `${body.name}: the round trip did not come back`);
  }
});

test('a real body survives the round trip character for character', () => {
  // The strongest form of the test above, on record 3075 exactly as the import holds it.
  const seen = switchEditorView('visual', switchEditorView('text', RECORD_3075).html).html;
  assert.equal(seen.length, RECORD_3075.length);
  for (let i = 0; i < RECORD_3075.length; i += 1) {
    assert.equal(seen[i], RECORD_3075[i], `character ${i} changed`);
  }
});

test('the form submits the tab that is showing, and never the other one', () => {
  const visualHtml = '<p>edited in Visual</p>';
  const textHtml = '<p>edited in Text</p>';
  assert.equal(documentToSubmit('visual', visualHtml, textHtml), visualHtml);
  assert.equal(documentToSubmit('text', visualHtml, textHtml), textHtml);
});

test('the submitted document is the one the showing tab holds — the stale-mirror fault', () => {
  /*
   * On this screen the two are different React states: the contenteditable is uncontrolled and its
   * `innerHTML` is read at submit time, while the Text tab edits `mirror`. Reading the wrong one writes
   * back the document the reader had before their last edit, which is invisible in a save that reports
   * success. So: whatever the reader last typed into the showing tab is what must be posted.
   */
  let mirror = RECORD_3075;
  let live = RECORD_3075;
  // The reader types in Visual: the DOM moves, the mirror does not.
  live = `${RECORD_3075}<p>a sentence added in Visual</p>`;
  assert.equal(documentToSubmit('visual', live, mirror), live);
  // Then switches to Text, where the mirror is the document and the DOM is gone.
  mirror = switchEditorView('text', live).html;
  assert.equal(documentToSubmit('text', live, mirror), mirror);
  assert.ok(mirror.includes('a sentence added in Visual'));
});
