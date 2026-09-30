/**
 * /api/learn/lookup — search the dictionary from the learning app.
 *
 *   GET ?q=akwa&limit=20[&common=1][&strict=1]  -> { results, total, hasMore, query }
 *
 * WHY THIS IS A THIN WRAPPER, AND SHOULD BE
 *
 * `searchWords` in `packages/db/src/repository.ts` is the dictionary's own search: it derives folded
 * forms through `deriveForms`, uses the trigram index where it exists, ranks headword matches above
 * definition matches, and falls back to fuzzy matching. §6.2 says the courses share the dictionary's
 * lexicon, and the honest reading of that is sharing the SEARCH too — a second implementation would
 * rank differently, fold differently, and eventually disagree about what a query means.
 *
 * So this route clamps the parameters, resolves audio for the page of results, and returns. It adds
 * no ranking of its own.
 *
 * FOLDING IS THE POINT
 *
 * A learner on a phone keyboard cannot type ị, ọ, ụ, ṅ or a tone mark, and `ákwá` (egg) and `àkwà`
 * (bed) are different words whose folded forms are identical. `deriveForms('akwa').searchForm` is
 * `'akwa'`, and `search_form` is stored folded on every row, so a query without diacritics finds
 * both. `matchType` is passed through so the result can say WHY something matched — a learner who
 * typed `akwa` and is shown `ákwá` is better served by "matched a form of" than by silence.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { searchWords } from '@ozituma/db/repository';
import { getStorage } from '@ozituma/db/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 180;

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

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/** The language the courses teach. Search is Igbo-first, like everything else here (§3). */
const IGBO = 'ibo';

export async function GET(request: Request): Promise<NextResponse> {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many lookups. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);

  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const perPage = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const flag = (name: string) => {
    const value = url.searchParams.get(name);
    return value === '1' || value === 'true';
  };

  // An empty query is a valid request meaning "browse", which `searchWords` already honours by
  // returning common words. Passing it through rather than 400ing means a learner who submits an
  // empty box sees the most common words instead of an error.
  const db = await getDb();
  const result = await searchWords(db, {
    query,
    language: IGBO,
    perPage,
    // `commonOnly` is deliberately NOT forced on. The dictionary's browse default favours common
    // words, which is right for an empty query, but a learner who searches for a specific rare word
    // should find it — restricting every query to common words would hide exactly the entries they
    // went looking for.
    commonOnly: false,
    strict: flag('strict'),
  });

  // One query for the page's audio, rather than one per row. Only the headword's own recording is
  // taken: a dialect variant is a different word and belongs on the entry page, where it can be
  // labelled with the dialect it came from.
  const ids = result.data.map((word) => word.id);
  const audioById = new Map<number, string>();

  if (ids.length > 0) {
    let storage: { publicUrl(key: string): string } | null = null;
    try {
      storage = getStorage();
    } catch {
      // No media configuration: the list still works, it just cannot offer playback. Losing audio
      // should cost the learner the audio, not the whole lookup.
      storage = null;
    }

    if (storage) {
      const rows = await db.rows<{ word_id: number; external_url: string | null; storage_key: string | null }>(
        `select distinct on (a.word_id) a.word_id, a.external_url, a.storage_key
           from audio a
          where a.word_id = any($1::bigint[]) and a.status = 'published'
          order by a.word_id, a.created_at, a.id`,
        [ids]
      );
      for (const row of rows) {
        const resolved =
          row.external_url ?? (row.storage_key ? storage.publicUrl(row.storage_key) : null);
        if (resolved) audioById.set(Number(row.word_id), resolved);
      }
    }
  }

  return NextResponse.json({
    query,
    total: result.total,
    hasMore: result.hasMore,
    page: result.page,
    perPage: result.perPage,
    results: result.data.map((word) => ({
      id: word.id,
      headword: word.headword,
      slug: word.slug,
      // Up to three glosses, so a result row can show the sense that matched without a second call.
      glosses: word.glosses,
      partOfSpeech: word.partOfSpeech,
      isCommon: word.isCommon,
      isVerified: word.isVerified,
      // Why it matched. Shown for anything other than a direct headword hit, because a learner who
      // typed `akwa` and sees `ákwá` deserves to know it matched a folded form rather than being
      // left to wonder whether the search ignored what they typed.
      matchType: word.matchType,
      audioUrl: audioById.get(word.id) ?? null,
    })),
  });
}
