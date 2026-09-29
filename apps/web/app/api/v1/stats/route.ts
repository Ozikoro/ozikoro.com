/**
 * GET /api/v1/stats — corpus size per language.
 */
import { NextResponse } from 'next/server';
import { getDictionaryStats } from '@ozituma/db/repository';
import { PUBLIC_CACHE_SECONDS, withApiAuth } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiAuth('stats', async (_request, ctx) => {
  const stats = await getDictionaryStats(ctx.db);
  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': `public, s-maxage=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=600`,
    },
  });
});
