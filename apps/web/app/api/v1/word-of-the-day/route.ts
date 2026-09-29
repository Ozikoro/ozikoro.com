/**
 * GET  /api/v1/word-of-the-day — deterministic daily word, same for everyone.
 * POST /api/v1/developers    — self-service API key registration.
 *
 * Registration is unauthenticated by necessity (you need a key to get a key),
 * which is exactly why it is metered by IP rather than left open. The reference
 * implementation puts a 20-per-15-minutes limiter on this route and, more
 * importantly, has no limiter at all on its data routes; here the data routes
 * are metered per key and registration is metered per IP.
 */
import { NextResponse } from 'next/server';
import { API_ERROR_CODES, requireLanguage } from '@ozituma/core';
import { getWord, wordOfTheDay, listLanguages } from '@ozituma/db/repository';
import { registerDeveloper } from '@ozituma/db/apikeys';
import { getDb } from '@ozituma/db/client';
import { ApiError, errorResponse, resolveLanguage, withApiAuth } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiAuth('words', async (request, ctx) => {
  const url = new URL(request.url);
  const language = await resolveLanguage(ctx.db, url.searchParams.get('language'));

  // Allow an explicit entry so clients can pin the day's word for tests.
  const explicitId = url.searchParams.get('id');
  const word = explicitId ? await getWord(ctx.db, Number(explicitId), language) : await wordOfTheDay(ctx.db, language);

  if (!word) {
    return errorResponse(
      new ApiError(API_ERROR_CODES.NOT_FOUND, `No word of the day available for "${language}" yet.`)
    );
  }

  return NextResponse.json(
    { date: new Date().toISOString().slice(0, 10), language, data: word },
    { headers: { 'Cache-Control': 'public, s-maxage=3600' } }
  );
});
