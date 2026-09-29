/**
 * GET /api/v1/languages — every language the platform serves, with an honest
 * count of how much content each one actually has.
 *
 * Publishing word counts per language matters for trust: Ozituma registers 17
 * languages but only Igbo is populated today, and an API that hides that would
 * have developers building on empty endpoints.
 */
import { NextResponse } from 'next/server';
import { listLanguages } from '@ozituma/db/repository';
import { PUBLIC_CACHE_SECONDS, withApiAuth } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiAuth('languages', async (_request, ctx) => {
  const languages = await listLanguages(ctx.db);
  return NextResponse.json(
    {
      data: languages,
      length: languages.length,
      note: 'Languages with wordCount 0 are registered and coming; their corpora are still being prepared.',
    },
    {
      headers: {
        'Cache-Control': `public, s-maxage=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=600`,
      },
    }
  );
});
