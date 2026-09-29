/**
 * POST /api/v1/developers — self-service API key registration.
 *
 * Returns the plaintext key exactly once. It is stored only as a SHA-256 hash,
 * so it cannot be recovered afterwards — losing it means issuing a new one,
 * which is the correct trade for not being able to leak it.
 */
import { NextResponse } from 'next/server';
import { registerDeveloper } from '@ozituma/db/apikeys';
import { getDb } from '@ozituma/db/client';
import { API_ERROR_CODES } from '@ozituma/core';
import { ApiError, errorResponse } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  useCase?: unknown;
  keyName?: unknown;
}

/**
 * Per-IP throttle for the one unauthenticated write endpoint.
 * In-process, so it protects a single instance; put a shared limiter (Redis or
 * WAF rate rules) in front of it when running more than one container.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function throttle(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function asString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(API_ERROR_CODES.INVALID_PARAMETER, `"${field}" is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ApiError(API_ERROR_CODES.INVALID_PARAMETER, `"${field}" must be at most ${max} characters.`);
  }
  return trimmed;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);
  if (!throttle(ip)) {
    return errorResponse(
      new ApiError(
        API_ERROR_CODES.RATE_LIMITED,
        'Too many key requests from this address. Try again in 15 minutes.'
      ),
      { 'Retry-After': '900' }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse(new ApiError(API_ERROR_CODES.INVALID_PARAMETER, 'Expected a JSON body.'));
  }

  try {
    const name = asString(body.name, 'name');
    const email = asString(body.email, 'email');

    // Deliberately permissive but real: reject obviously malformed addresses
    // rather than trying to perfectly validate email with a regex.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(API_ERROR_CODES.INVALID_PARAMETER, '"email" does not look like an email address.');
    }

    const db = await getDb();
    const result = await registerDeveloper(db, {
      name,
      email: email.toLowerCase(),
      organization: typeof body.organization === 'string' ? body.organization.slice(0, 200) : null,
      useCase: typeof body.useCase === 'string' ? body.useCase.slice(0, 500) : null,
      keyName: typeof body.keyName === 'string' && body.keyName.trim() ? body.keyName.trim() : 'default',
    });

    return NextResponse.json(
      {
        developer: {
          id: result.developer.uuid,
          name: result.developer.name,
          email: result.developer.email,
          plan: result.developer.plan,
        },
        apiKey: result.apiKey,
        keyPrefix: result.keyPrefix,
        warning: 'Store this key now. It is hashed on our side and cannot be shown again.',
        usage: 'Send it as the X-API-Key header. See /docs for endpoints.',
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error('[api:developers]', error);
    return errorResponse(
      new ApiError(API_ERROR_CODES.INTERNAL, 'Could not create that developer account.')
    );
  }
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
