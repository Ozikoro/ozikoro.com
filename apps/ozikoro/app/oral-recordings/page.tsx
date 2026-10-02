/**
 * Oral recordings — which the design says have moved.
 *
 * THE DESIGN'S OWN SCREEN IS A NOTICE, NOT A GALLERY. `screens/oral-recordings.html` contains one sentence —
 * *"Oral recordings are now in Ozikoro Listen"* — and a link. Reproducing it as a record gallery would
 * contradict the handoff, so this route sends a reader to where the recordings are.
 *
 * **A permanent redirect rather than a page with a link**, because the design's own wording is that the
 * recordings *are now* there: a reader who arrives at the old address should reach the collection, not a page
 * telling them to click. `/listen` is the destination, and it is built in the next round.
 */
import { permanentRedirect } from 'next/navigation';

export default function OralRecordingsPage(): never {
  permanentRedirect('/listen');
}
