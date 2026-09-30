/**
 * /api/learn/practice — vocabulary practice drawn from the dictionary.
 *
 *   GET  ?limit=10&offset=0&audio=1[&verified=1]   -> { exercises, words, hasMore }
 *   POST { limit, offset, audio, verified, responses, record? }  -> graded result
 *
 * WHY THIS IS SEPARATE FROM /api/learn/exercise
 *
 * That route serves a LESSON, whose content is authored and lives in `learn_vocab`. This one serves
 * PRACTICE, whose content is the dictionary's own published words. Keeping them apart is the point:
 * a lesson cannot be published until a linguist has approved it, while practice over already-
 * published dictionary words needs no new approval at all.
 *
 * WHY THE LIST IS ADDRESSED RATHER THAN THE WORDS THEMSELVES
 *
 * The client sends back `offset`, `limit` and the filters instead of a list of word ids, and the
 * server re-runs the same query to grade. Two reasons, and the second is the important one:
 *
 *   1. It is smaller, and the query is indexed on the columns it sorts by.
 *   2. A client that sends its own word list is a client that chooses its own questions. Combined
 *      with a stored score, that is forgeable.
 *
 * The rebuild is exact because `getPracticeWords` orders deterministically — common first, then
 * frequency rank, then headword. Nothing about the ordering depends on the request.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import {
  buildPracticeSet,
  countPracticeWords,
  getPracticeWords,
  toPracticeClientSet,
} from '@ozituma/db/learn-practice';
import { gradeExerciseSet } from '@ozituma/db/learn-exercises';
import { recordReview } from '@ozituma/db/learn-srs';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
}

/** Bounds are enforced here, not in the client, so a hand-made request cannot ask for 10,000. */
const MIN_LIMIT = 4;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

interface Filters {
  limit: number;
  offset: number;
  requireAudio: boolean;
  verifiedOnly: boolean;
}

/**
 * Read the filters, clamping rather than rejecting.
 *
 * A bad `limit` is a client bug, not an attack, and falling back to a working session is kinder
 * than a 400 that leaves a learner staring at an error. Out-of-range values are clamped to the
 * nearest legal value, so `limit=9999` plays a full set instead of failing.
 */
function readFilters(source: { get(name: string): string | null | undefined }): Filters {
  const rawLimit = Number.parseInt(source.get('limit') ?? '', 10);
  const rawOffset = Number.parseInt(source.get('offset') ?? '', 10);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, MIN_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;
  // Never negative: a negative OFFSET is a SQL error, not an empty page.
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  const flag = (name: string) => {
    const value = source.get(name);
    return value === '1' || value === 'true';
  };

  return { limit, offset, requireAudio: flag('audio'), verifiedOnly: flag('verified') };
}

/** Answer text for a response body, kept out of the GET path entirely. */
function asResponses(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!allowed(clientIp(request))) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const filters = readFilters(new URL(request.url).searchParams);
  const db = await getDb();

  // Counted first so the response can tell the learner honestly whether there is more, rather than
  // a "Next" button that leads to an empty set on the last page.
  const [counts, words] = await Promise.all([
    countPracticeWords(db, { requireAudio: filters.requireAudio, verifiedOnly: filters.verifiedOnly }),
    getPracticeWords(db, {
      limit: filters.limit + 1, // one extra, purely to answer "hasMore" without a second query
      offset: filters.offset,
      requireAudio: filters.requireAudio,
      verifiedOnly: filters.verifiedOnly,
    }),
  ]);

  const hasMore = words.length > filters.limit;
  const page = hasMore ? words.slice(0, filters.limit) : words;

  if (page.length < MIN_LIMIT) {
    return NextResponse.json(
      {
        error: {
          code: 'not_enough_content',
          message:
            filters.requireAudio
              ? 'Not enough words with recordings are left at this point. Try turning listening off, or start again from the beginning.'
              : 'There are no more words to practise here. Start again from the beginning.',
        },
      },
      { status: 409 }
    );
  }

  const set = buildPracticeSet(page);

  return NextResponse.json({
    ...toPracticeClientSet(set),
    // The words themselves, so the page can show what is being practised and link to each entry.
    words: page.map((word) => ({
      id: word.id,
      headword: word.headword,
      slug: word.slug,
      english: word.english,
      partOfSpeech: word.partOfSpeech,
      hasAudio: word.audioUrl !== null,
    })),
    offset: filters.offset,
    limit: filters.limit,
    nextOffset: filters.offset + page.length,
    hasMore,
    available: counts.total,
    availableWithAudio: counts.withAudio,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!allowed(clientIp(request))) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'The request body must be JSON.' } },
      { status: 400 }
    );
  }

  const responses = asResponses(body.responses);
  if (!responses) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'An object of responses is required.' } },
      { status: 400 }
    );
  }

  // Read from a Map so the same `readFilters` clamps both the GET and the POST. If these ever
  // disagreed, grading would rebuild a DIFFERENT set from the one the learner answered and mark
  // every answer against the wrong word.
  const params = new Map<string, string>();
  for (const key of ['limit', 'offset', 'audio', 'verified']) {
    const value = body[key];
    if (typeof value === 'string') params.set(key, value);
    else if (typeof value === 'number') params.set(key, String(value));
    else if (value === true) params.set(key, '1');
  }
  const filters = readFilters(params);

  const db = await getDb();
  const words = await getPracticeWords(db, {
    limit: filters.limit,
    offset: filters.offset,
    requireAudio: filters.requireAudio,
    verifiedOnly: filters.verifiedOnly,
  });

  // A fixed seed, because it moves option ORDER only, never which option is correct. Any seed
  // reproduces the same answer key — see the header of learn-exercises.ts.
  const set = buildPracticeSet(words);
  const result = gradeExerciseSet(set, responses);

  if (result.total === 0) {
    return NextResponse.json(
      { error: { code: 'not_enough_content', message: 'There is nothing to grade here.' } },
      { status: 409 }
    );
  }

  // ---------------------------------------------------------------------------
  // Feed the spaced-repetition schedule.
  //
  // This is what turns practice into study. Without it a learner can answer the same word correctly
  // eight times in one sitting and the platform has learned nothing about whether they will remember
  // it tomorrow — which is the only question a review schedule exists to answer.
  //
  // THE RATING COMES FROM CORRECTNESS, AND ONLY FROM THAT.
  //
  // `correct` -> good, `wrong` -> again. SM-2 has four ratings and this uses two, deliberately:
  // "hard" and "easy" are the learner's own judgement of their recall, and an exercise that grades a
  // typed answer cannot observe that. Inferring "easy" from a fast response would be inventing a
  // signal, and a wrong ease is worse than a coarse one — it silently retimes every future review.
  // Two honest values beat four fabricated ones.
  //
  // Signed-in only: the state table is keyed by account, and there is no anonymous deck to write to.
  // ---------------------------------------------------------------------------
  const account = await getCurrentAccount();
  let reviewsRecorded = 0;

  if (account) {
    const correctIds = result.items.filter((item) => item.correct).map((item) => item.id);
    const wrongIds = result.items.filter((item) => !item.correct).map((item) => item.id);

    for (const word of words) {
      const numericId = String(word.id);
      // Exercise ids are `${lessonId}-${answer.id}-${kind}`, so a word is matched by its position in
      // that string rather than by re-deriving which exercise it produced. If the id format ever
      // changes this stops matching, which fails toward "no review recorded" rather than toward
      // recording a review against the wrong word.
      const wasCorrect = correctIds.some((id) => id.includes(`-${numericId}-`));
      const wasWrong = wrongIds.some((id) => id.includes(`-${numericId}-`));
      if (!wasCorrect && !wasWrong) continue;

      try {
        await recordReview(db, {
          accountId: account.account.id,
          itemId: numericId,
          itemKind: 'lexeme',
          rating: wasCorrect ? 'good' : 'again',
        });
        reviewsRecorded += 1;
      } catch (error) {
        // One failed write must not lose the whole set's result. The learner's score is already
        // computed; the schedule is what suffers, and it suffers for one word.
        console.error('[practice] could not record a review', error);
      }
    }
  }

  return NextResponse.json({
    items: result.items,
    correct: result.correct,
    total: result.total,
    score: result.score,
    // Practice is not a LESSON result, so there is no best-score to attach — but when the learner is
    // signed in the reviews ARE durable, and saying so is the difference between "nothing was saved"
    // and "your schedule moved".
    recorded: account !== null && reviewsRecorded > 0,
    signedIn: account !== null,
    reviewsRecorded,
  });
}
