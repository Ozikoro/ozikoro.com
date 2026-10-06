/**
 * The bulk dropdown's three actions, as a validated list rather than three string comparisons in a loop.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * The list table posts `action=bulk`, `ids=5206,5204` and `bulkAction=trash`. The route's handler read
 * `bulkAction` and compared it against three literals inside a loop, and **anything that matched none of
 * them fell through with `changed = 0` and was answered with a success notice** — *"0 moved to the trash."*
 * A message that reads as a completed action over a request that did nothing is the shape this archive has
 * had to remove twice already, so the value is validated first and the notice is built from the action that
 * actually ran.
 *
 * The three names and the three sentences are here rather than in the route because they are the contract
 * between the dropdown in `list-table.tsx` and the write path, and a route handler behind a session cookie
 * cannot be reached by `node --test`. The test next to this file holds the list and the sentences.
 *
 * **PUBLISHING IS NOT ONE OF THEM, ON PURPOSE.** WordPress's bulk list offers "Edit" and "Move to Trash";
 * publishing from a table — with no body on the screen and possibly no title — is the one act this archive
 * will not do from a checkbox, and `quickEditPiece` refuses the same transition for the same reason.
 * `restore` is offered because the trash's own link is the only other way back and doing it row by row
 * across a bin is not work.
 */

export const BULK_WRITES = ['trash', 'restore', 'draft'] as const;

export type BulkWrite = (typeof BULK_WRITES)[number];

/**
 * The bulk action a submitted value names, or `null` when it names none.
 *
 * `null` is what stops the loop below running zero times and then reporting a success.
 */
export function bulkWriteFor(value: string): BulkWrite | null {
  const wanted = value.trim();
  return (BULK_WRITES as readonly string[]).includes(wanted) ? (wanted as BulkWrite) : null;
}

/** The ids a bulk form named, in order, with anything that is not a positive integer dropped. */
export function bulkIdsFrom(value: string): number[] {
  return value
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * What the screen says afterwards.
 *
 * The count is always named, including zero — but zero is no longer reachable through a successful path,
 * because an action that names nothing is refused before this is called.
 */
export function bulkNotice(write: BulkWrite, changed: number): string {
  switch (write) {
    case 'restore':
      return `${changed} restored.`;
    case 'draft':
      return `${changed} returned to draft.`;
    case 'trash':
      return `${changed} moved to the trash.`;
  }
}
