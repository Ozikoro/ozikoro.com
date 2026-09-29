/**
 * GET /api/v1/openapi.json — the machine-readable contract.
 */
import { NextResponse } from 'next/server';
import { openApiDocument } from '@/lib/openapi';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(openApiDocument, {
    headers: { 'Cache-Control': 'public, s-maxage=86400' },
  });
}
