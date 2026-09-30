/**
 * Tests for the offline review queue.
 *
 * Run with: npm -w @ozituma/learn run test:offline
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 * Two rules from `docs/learn/OFFLINE.md`, which are the only decisions in this module that could
 * silently corrupt a learner's schedule:
 *
 *   1. REPEATING A WORD KEEPS ONLY THE LAST RATING. Two answers for one word, given offline, cannot
 *      both be replayed — the scheduler is stateful and the second would reason about a state the
 *      server never had.
 *   2. A REFUSAL IS DROPPED, A NETWORK FAILURE IS KEPT. Retrying a 4xx forever means a queue that
 *      never drains; dropping a timeout means losing the learner's work.
 *
 * And the storage contract: a browser that refuses `localStorage` (private mode) must degrade to
 * "answers are not kept" rather than throw in the middle of a review.
 *
 * `window` and `fetch` are shimmed, because the module is written for the browser. Nothing is mocked
 * that the module does not itself call.
 */
import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// A minimal localStorage, so the module can be exercised outside a browser.
// ---------------------------------------------------------------------------
class MemoryStorage {
  private store = new Map<string, string>();
  refused = false;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.refused) throw new DOMException('QuotaExceededError');
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

const {
  clearQueue,
  enqueueReview,
  localDayString,
  queueAvailable,
  readQueue,
  syncQueue,
} = await import('./offline-queue.ts');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A fetch that answers however the test wants. */
function serve(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// 1. The queue itself
// ---------------------------------------------------------------------------
clearQueue();
check('an empty queue reads as empty', readQueue().length === 0);
check('storage is reported as working', queueAvailable() === true);

enqueueReview({ itemId: '4563', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
check('one review is queued', readQueue().length === 1);

// RULE 1: the same word again replaces, rather than adding.
enqueueReview({ itemId: '4563', rating: 'again', answeredAt: Date.now(), localDay: '2026-09-30' });
const afterRepeat = readQueue();
check('repeating a word keeps ONE entry, not two', afterRepeat.length === 1, `${afterRepeat.length} entries`);
check('and the LAST rating is the one kept', afterRepeat[0]?.rating === 'again', afterRepeat[0]?.rating);

// A different word is a different entry.
enqueueReview({ itemId: '9999', rating: 'hard', answeredAt: Date.now(), localDay: '2026-09-30' });
check('a different word is queued separately', readQueue().length === 2);

// ---------------------------------------------------------------------------
// 2. Validation on read — this is storage a learner can edit
// ---------------------------------------------------------------------------
storage.setItem('ozituma.learn.offline-reviews.v1', 'not json at all');
check('corrupt storage reads as empty rather than throwing', readQueue().length === 0);

storage.setItem(
  'ozituma.learn.offline-reviews.v1',
  JSON.stringify([
    { itemId: '1', rating: 'good', answeredAt: 1 },
    { itemId: '2', rating: 'not-a-rating', answeredAt: 1 },
    { itemId: 3, rating: 'good', answeredAt: 1 },
    { rating: 'good', answeredAt: 1 },
  ])
);
const filtered = readQueue();
check('a malformed entry is dropped on read', filtered.length === 1, `${filtered.length} survived`);
check('and the valid one is kept', filtered[0]?.itemId === '1');

// ---------------------------------------------------------------------------
// 3. Sync: refusals are dropped, network failures are kept
// ---------------------------------------------------------------------------
clearQueue();
enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
enqueueReview({ itemId: '222', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });

serve(() => jsonResponse({ ok: true, to: 'review' }));
const allGood = await syncQueue();
check('a successful sync sends everything', allGood.sent === 2, `sent ${allGood.sent}`);
check('and leaves nothing queued', allGood.remaining === 0);

clearQueue();
enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
enqueueReview({ itemId: '222', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });

// The server refuses the first one. It will never accept it, so it should be dropped and the
// second should still be attempted.
serve((_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (body.itemId === '111') {
    return jsonResponse({ error: { message: 'That word is not available to review.' } }, 404);
  }
  return jsonResponse({ ok: true });
});
const refused = await syncQueue();
check('a refused review is not retried forever', refused.remaining === 0, `${refused.remaining} left`);
check('and its reason is surfaced', refused.reasons.length === 1, refused.reasons.join(' | '));
check('the reason is the server’s own words', (refused.reasons[0] ?? '').includes('not available'));
check('the other review still went', refused.sent === 1, `sent ${refused.sent}`);

clearQueue();
enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
enqueueReview({ itemId: '222', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });

// A network failure keeps the remainder AND stops the pass — there is nothing to gain from
// hammering a connection that has already gone.
let attempts = 0;
serve(() => {
  attempts += 1;
  throw new TypeError('Failed to fetch');
});
const offline = await syncQueue();
check('a network failure leaves the queue intact', offline.remaining === 2, `${offline.remaining} left`);
check('and stops rather than retrying every entry', attempts === 1, `${attempts} attempts`);

// A 5xx is the server being unwell, which is different from a refusal.
clearQueue();
enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
serve(() => jsonResponse({ error: { message: 'boom' } }, 500));
const serverDown = await syncQueue();
check('a 500 keeps the review for later', serverDown.remaining === 1, `${serverDown.remaining} left`);

// ---------------------------------------------------------------------------
// 4. Signing out clears it
// ---------------------------------------------------------------------------
clearQueue();
enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
check('there is something to clear', readQueue().length === 1);
clearQueue();
check('signing out clears the queue', readQueue().length === 0);
check('and nothing is left in storage', storage.keys().length === 0);

// ---------------------------------------------------------------------------
// 5. A browser that refuses storage degrades rather than throws
// ---------------------------------------------------------------------------
storage.refused = true;
check('refused storage is reported, not thrown', queueAvailable() === false);
let threw = false;
try {
  enqueueReview({ itemId: '111', rating: 'good', answeredAt: Date.now(), localDay: '2026-09-30' });
} catch {
  threw = true;
}
check('enqueueing into refused storage does not throw mid-review', threw === false);
storage.refused = false;

// ---------------------------------------------------------------------------
// 6. §F7's local day
// ---------------------------------------------------------------------------
const day = localDayString(Date.UTC(2026, 8, 30, 12, 0, 0));
check('the local day is a YYYY-MM-DD string', /^\d{4}-\d{2}-\d{2}$/.test(day), day);
check('and it uses the LOCAL date, not UTC ISO', !day.includes('T'));

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
