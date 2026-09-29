/**
 * GET /api/v1/words/:id — one entry in full.
 *
 * `:id` accepts either the numeric id or the URL slug, so both
 * /api/v1/words/4127 and /api/v1/words/ulo resolve.
 */
import { NextResponse } from 'next/server';
import { API_ERROR_CODES } from '@ozituma/core';
import { getWord } from '@ozituma/db/repository';
import { ApiError, errorResponse, resolveLanguage, withApiAuth } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiAuth('words', async (request, ctx, routeParams) => {
  const { id } = await (routeParams as { params: Promise<{ id: string }> }).params;
  const url = new URL(request.url);
  const language = await resolveLanguage(ctx.db, url.searchParams.get('language'));

  const word = await getWord(ctx.db, decodeURIComponent(id), language);
  if (!word) {
    return errorResponse(
      new ApiError(
        API_ERROR_CODES.NOT_FOUND,
        `No entry exists for "${id}" in language "${language}".`
      )
    );
  }

  return NextResponse.json(word, {
    headers: {
      // Entries change rarely, so cache hard at the edge.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
});
