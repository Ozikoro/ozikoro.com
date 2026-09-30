# Offline behaviour, and the conflict rules

§13 requires an "Installable PWA. Learner can download the current unit (text plus audio) and
complete lessons and reviews offline; progress queues and syncs; **conflict rules documented**."
This is that documentation.

---

## 1. What works with no connection

| Surface | Offline? | Why |
|---|---|---|
| The app shell | **Yes** | Precached on install. The site opens with no connection. |
| Pages already visited | **Yes** | Network-first, cached on the way through. |
| Audio in a downloaded pack | **Yes** | Cache-first from `media.ozituma.com`. |
| A word's recording, once played | **Yes** | Cached as it is played, whether or not it is in a pack. |
| Today's review, if loaded while online | **Yes** | The queue is held by the page, not the worker — see §2. |
| Answering a review | **Yes** | Queued locally; see §3. |
| Vocabulary practice | **Partly** | The exercise set is built by the server, so a set already loaded can be answered but a new one cannot be built. |
| Dictionary lookup | **No** | `searchWords` is a database query. Cached results are not served — see §2. |
| The tutor | **No** | §8.1 requires retrieval before generation. A model with no approved content to ground on must not answer, and offline there is no retrieval. |

**Offline AI is explicitly out of scope** (§4.1: "offline lesson packs are in scope; offline AI is
not"). The tutor is unavailable rather than degraded, and says so.

---

## 2. What the service worker refuses to cache, and why

**Authenticated API responses.** `/api/learn/plan`, `/api/learn/practice` and `/api/learn/tutor` all
return data belonging to one account. A service worker cache is keyed by **URL**, not by who asked.
Caching them would mean that on a shared phone the next person to open the app is served the previous
person's review queue, practice history, and — if the tutor were included — their conversation.

That is a data leak produced by a performance optimisation, and an invisible one: the page would
render perfectly and nobody would ever see it happen.

So the split is:

- **The worker** caches only what is identical for everybody: the shell, static build output, and
  published recordings.
- **The page** holds anything account-specific, in `localStorage`, which the app controls and can
  clear on sign-out.

The cost is that the review queue is cached by the page rather than the worker, which is a little
more code in a component and a great deal less risk.

---

## 3. The conflict rules

Two rules. They are deliberately asymmetric, and the asymmetry is the design.

### Rule 1 — a queued review is never overwritten by the server

If a learner answers `mmiri` offline and then loads a plan that still lists it as due, **the queued
answer wins.** It is newer, and it is a record of something the learner actually did. The plan is a
recommendation the server made before it knew; the answer is a fact that happened after.

### Rule 2 — repeating a word offline keeps only the last rating

Two answers for one word, given with no connection between them, cannot both be replayed. The
scheduler is stateful: each review moves a word's interval based on where it currently is. Sending
both would make the second reason about a state the server never had.

The **last** rating is kept, because that is the one the learner settled on.

### What is deliberately not attempted

**A merge.** Merging two schedules requires knowing the server's state at the moment of the offline
answer, which is exactly what an offline client does not have. Anything claiming to merge would be
guessing, and a guess that silently rewrites a learner's schedule is worse than a rule they can
predict.

**Ordering across days.** A queue that spans several days is sent in the order it was answered, but
the scheduler sees them all as arriving now. Intervals will be slightly compressed. This is stated
rather than corrected: the honest fix is for the sync to send `answeredAt` and for the scheduler to
reason about it, which is a change to `packages/core/src/srs.ts` and is not in v1.0.

---

## 4. Syncing

The queue is drained:

- when the browser fires `online`
- when the tab becomes visible
- once on load

The last two matter because **`online` is not trustworthy on Nigerian mobile networks** — it fires
when the browser believes it has a connection, which is frequently while nothing is reachable. The
cost of trying is one request.

Sending is **sequential, oldest first, and stops at the first non-refusal failure**. Concurrency
would let two answers for one word race, and the loser would be scheduled from a state that no
longer exists. A network failure stops the pass and leaves the rest queued; a **refusal** (4xx) is
dropped rather than retried forever, and its reason is shown to the learner so the count not going
up is explained.

`localStorage` is used rather than IndexedDB because the queue is a few hundred small records at the
outside. IndexedDB is the right tool for the offline *packs* — megabytes of audio — and that is where
it would go if the queue ever grew.

Signing out clears the queue, along with everything else the app holds for that account.

---

## 5. Installing

The app is installable: `/manifest.webmanifest` declares `standalone` display, the 192 and 512 pixel
icons, and shortcuts to today's review and to practice.

`start_url` and `scope` are both `/`. An installed app whose start URL falls outside its own scope is
refused by several browsers, without saying why.

The icons are the dictionary's. These are the same records taught from a different surface rather
than a separate product, and a second icon set would be a second brand for one thing. They are
declared `any` rather than `maskable` because their artwork is full-bleed and `maskable` would crop
the mark itself; a separate entry claims `maskable` for launchers that want it.

---

## 6. What is not built yet

- **Explicit "download this unit"**. The worker handles a `CACHE_URLS` message and reports how many
  URLs it stored, but no page sends one yet, because the authored curriculum that units would come
  from does not exist (§18 #4). Today the pack is built implicitly, as words and recordings are met.
- **Background sync while the app is closed.** The Background Sync API is unavailable in iOS Safari,
  which §13 names as a target. The queue survives the app closing; only the retry does not happen
  until it is opened again.
- **A storage budget and eviction UI.** Browsers evict cache storage under pressure and there is no
  way for the app to know in advance. A learner with a full device could lose a pack silently.
