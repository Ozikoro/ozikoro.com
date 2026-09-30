/**
 * Reviews answered with no connection, held until there is one.
 *
 * WHY THIS IS IN THE PAGE AND NOT IN THE SERVICE WORKER
 *
 * A service worker cache is keyed by URL. The review queue, the practice sets and everything else
 * here belong to ONE account, so caching them in the worker would serve the previous learner's data
 * to the next person on a shared phone — a leak produced by a performance feature, and an invisible
 * one because the page would render perfectly. See the note at the top of `public/sw.js`.
 *
 * So the queue lives in `localStorage`, which the app controls and can clear on sign-out, and the
 * worker handles only content that is identical for everybody.
 *
 * WHY localStorage AND NOT IndexedDB
 *
 * The queue is a short list of small records — a few hundred at the outside, each a word id and a
 * rating. IndexedDB would be the right tool for the offline PACKS, which are megabytes of audio;
 * for this it would be an async wrapper around something that fits in a few kilobytes. If the queue
 * ever needs to hold more, that is the point at which to move it.
 *
 * CONFLICT RULES, STATED
 *
 * Two rules, and they are deliberately asymmetric:
 *
 *   1. A QUEUED REVIEW IS NEVER OVERWRITTEN BY THE SERVER. If a learner reviews `mmiri` offline and
 *      the app then loads a plan that still says it is due, the queued answer wins — it is newer,
 *      and it is the thing the learner actually did. The plan is a suggestion; the answer is a fact.
 *
 *   2. REPEATING THE SAME WORD OFFLINE KEEPS ONLY THE LAST RATING. Two answers for one word, made
 *      with no connection between them, cannot be ordered the way the scheduler needs — it expects
 *      to see the state it produced. Sending both would make the second review reason about a state
 *      the server never had. The last one is what the learner settled on.
 *
 * What is NOT attempted is a merge. Merging two schedules requires the server's state at the time,
 * which is exactly what an offline client does not have; anything that claimed to merge would be
 * guessing.
 */

const QUEUE_KEY = 'ozituma.learn.offline-reviews.v1';

export interface QueuedReview {
  itemId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  /** When the learner answered, so the sync can tell the server how stale it is. */
  answeredAt: number;
  /** Milliseconds they took, if the runner measured it. §F5 asks for it. */
  elapsedMs?: number;
  /** The local day it was answered on, in the learner's zone — §F7's day, not the server's. */
  localDay: string;
}

/** Whether this browser will hold anything at all. Private mode throws on write, not on read. */
export function queueAvailable(): boolean {
  try {
    const probe = '__ozituma_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readQueue(): QueuedReview[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Validated on read rather than trusted: this is storage a learner can edit, and a malformed
    // entry would otherwise reach the API and be rejected there with a confusing message.
    return parsed.filter(
      (entry): entry is QueuedReview =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as QueuedReview).itemId === 'string' &&
        ['again', 'hard', 'good', 'easy'].includes((entry as QueuedReview).rating) &&
        typeof (entry as QueuedReview).answeredAt === 'number'
    );
  } catch {
    return [];
  }
}

function writeQueue(entries: QueuedReview[]): void {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or refused. The review is lost, which is a real cost — but throwing here would
    // take down the answer the learner is in the middle of giving, which is worse.
  }
}

/**
 * Add a review, replacing any earlier answer for the same word.
 *
 * Rule 2 above: two offline answers for one word cannot both be replayed, because the scheduler
 * expects to reason about the state it produced. The last one is what the learner settled on.
 */
export function enqueueReview(review: QueuedReview): number {
  const queue = readQueue().filter((entry) => entry.itemId !== review.itemId);
  queue.push(review);
  writeQueue(queue);
  return queue.length;
}

export function clearQueue(): void {
  try {
    window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Nothing to do. A queue that cannot be cleared is a problem for the next sync, not this call.
  }
}

export interface SyncResult {
  sent: number;
  failed: number;
  remaining: number;
  /** Refusals the API gave, so the UI can say something more useful than "some failed". */
  reasons: string[];
}

/**
 * Send everything queued, oldest first.
 *
 * ONE AT A TIME, AND STOP ON THE FIRST FAILURE THAT IS NOT A REFUSAL.
 *
 * These are reviews against a spaced-repetition schedule, and the scheduler is stateful: each one
 * moves a word's interval based on where it currently is. Sending them concurrently would let two
 * answers for the same word race, and the loser would be scheduled from a state that no longer
 * exists. Sequentially, the order the learner gave them is the order they are applied in.
 *
 * A network failure stops the pass and leaves the rest queued — there is nothing to gain from
 * hammering a connection that has already gone. A REFUSAL (4xx) is different: it means the server
 * will never accept that entry, so it is dropped rather than retried forever, and the reason is
 * surfaced so the learner is not left wondering why their count did not go up.
 */
export async function syncQueue(): Promise<SyncResult> {
  const queue = readQueue();
  if (queue.length === 0) return { sent: 0, failed: 0, remaining: 0, reasons: [] };

  const remaining: QueuedReview[] = [];
  const reasons: string[] = [];
  let sent = 0;
  let failed = 0;
  let stopped = false;

  for (const entry of queue) {
    if (stopped) {
      remaining.push(entry);
      continue;
    }

    try {
      const response = await fetch('/api/learn/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: entry.itemId,
          rating: entry.rating,
          elapsedMs: entry.elapsedMs,
        }),
      });

      if (response.ok) {
        sent += 1;
        continue;
      }

      if (response.status >= 500) {
        // The server is unwell. Keep it and try later.
        failed += 1;
        remaining.push(entry);
        stopped = true;
        continue;
      }

      // A 4xx will not improve by trying again. Dropped, with the reason kept.
      failed += 1;
      try {
        const body = await response.json();
        const message = body?.error?.message;
        if (typeof message === 'string') reasons.push(message);
      } catch {
        reasons.push(`The server refused a review (${response.status}).`);
      }
    } catch {
      // Offline again. Stop and keep the remainder.
      failed += 1;
      remaining.push(entry);
      stopped = true;
    }
  }

  writeQueue(remaining);
  return { sent, failed, remaining: remaining.length, reasons };
}

/** The learner's local day, so a queued review carries §F7's day rather than the server's. */
export function localDayString(now: number = Date.now()): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
