/**
 * The two rules that stand between the Classic Editor's content box and a body that is lost or overwritten.
 *
 * ── WHY THESE ARE HERE AND NOT IN `editor.tsx` ──────────────────────────────────────────────────────
 *
 * For the same reason the toolbar is in `classic-editor.ts`: `npm -w @ozikoro/site run test` runs
 * `node --test lib/*.test.ts` over plain TypeScript, so a rule that lives inside a `.tsx` file cannot be
 * exercised by the suite at all. **Both of the rules below were got wrong in the screen and were invisible
 * to every test that existed**, which is exactly the argument for them being plain functions.
 *
 * ── THE FAULT THEY ANSWER, MEASURED IN A BROWSER ─────────────────────────────────────────────────────
 *
 * `#content` is a `contentEditable` div. The screen used to render it with
 * `dangerouslySetInnerHTML={{ __html: piece?.bodyHtml ?? '' }}` and set state from its `onInput`. On a
 * **new** piece that string is empty, and React wrote the empty string back over the box on the re-render
 * the input handler caused:
 *
 *     open /admin/posts/new/ · focus #content · dispatch one `input` event (one keystroke, or a paste)
 *     before   102 characters
 *     after      0 characters          ← the same DOM node, emptied; a MutationObserver confirmed it
 *
 * The body field then posted `''`, the write path stored an empty body, and the screen said *"Draft
 * created"* over a record with nothing in it. **So the guard below is the second line of defence: the fix
 * in the component is that React no longer owns the box's contents at all, and this refuses the save if
 * anything ever empties it again.** A plausible success message over an empty record is the one outcome
 * this archive must not produce, and a rule about that belongs somewhere it can be tested.
 *
 * ── AND THE TWO TABS ARE ONE DOCUMENT ───────────────────────────────────────────────────────────────
 *
 * `visualBoxDocument` is what keeps them so. The Visual box is a different DOM element every time the tab
 * is shown, so it has to be handed the document on the way back — and the document it must be handed is
 * the one the reader was just editing in the Text tab, not the one the record was loaded with. Getting
 * that the wrong way round silently discards every Text-tab edit on the way back to Visual.
 */

/** Whether a submit must be refused because the content box lost the document that was typed into it. */
export function bodyLostBeforeSave(submittingHtml: string, mirrorHtml: string, visual: boolean): boolean {
  /*
   * THE CONDITION IS NARROW ON PURPOSE, AND THE NARROWNESS IS THE POINT.
   *
   * An empty body is a legitimate thing to save — WordPress saves an untitled, empty draft, and an editor
   * may well choose to clear a body and save it. So the refusal is not "the body is empty". It is the one
   * case that cannot be deliberate: **the box is showing and it is empty, while the last document React saw
   * written into it was not.** That is a box that has lost text, and the reader is told so instead of being
   * shown a confirmation over an empty record.
   *
   * The Text tab is exempt because it is a controlled textarea: what it shows IS the document, so an empty
   * one there is a decision rather than a loss.
   */
  if (!visual) return false;
  return submittingHtml.trim().length === 0 && mirrorHtml.trim().length > 0;
}

/**
 * The document the Visual box must be given when it appears.
 *
 * `pending` is set by the tab switch and holds the in-progress document; it is `null` when there was no tab
 * switch, which is the first load of a piece — and then the stored body is what belongs in the box.
 *
 * The document is returned **unchanged**. That is not incidental: these bodies hold WordPress HTML with
 * `[caption]` shortcodes, `&nbsp;` and numeric entities, and `wp-content` image addresses, and every one of
 * those is something a re-serialiser rewrites. The route from the record to the box writes the string it
 * was given or nothing at all.
 */
export function visualBoxDocument(pending: string | null, stored: string): string {
  return pending !== null ? pending : stored;
}
