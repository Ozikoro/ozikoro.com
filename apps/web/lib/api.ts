/**
 * The public API's request pipeline: authentication, quota enforcement,
 * consistent errors, and response headers.
 *
 * Every public route goes through `withApiAuth`, so no endpoint can forget to
 * meter usage or to set the correct status code. That is a deliberate contrast
 * with the reference implementation, where the usage middleware existed but
 * plan gating was never wired up, and where every error — including rate
 * limiting — returned HTTP 400.
 */
import { NextResponse } from 'next/server';
import {
  API_ERROR_CODES,
  ERROR_STATUS,
  languageCodeFromSlug,
  type ApiErrorCode,
} from '@ozituma/core';
import { getDb, type Db } from '@ozituma/db/client';
import { authenticateApiKey, consumeQuota, type Developer } from '@ozituma/db/apikeys';

export const API_VERSION = 'v1';
/** Public API responses are cacheable and identical for all callers. */
export const PUBLIC_CACHE_SECONDS = 300;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: ApiError, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    { status: ERROR_STATUS[error.code], headers: extraHeaders }
  );
}

export interface ApiContext {
  db: Db;
  developer: Developer;
  apiKeyId: number;
  /** Requests used today for this endpoint, after counting this one. */
  used: number;
  limit: number;
  remaining: number;
}

/** Standard headers so clients can self-throttle without guessing. */
function quotaHeaders(ctx: { limit: number; remaining: number; used: number }): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(ctx.limit),
    'X-RateLimit-Remaining': String(ctx.remaining),
    'X-RateLimit-Used': String(ctx.used),
  };
}

/** Read the API key from the header the docs promise. */
export function readApiKey(request: Request): string | null {
  const direct = request.headers.get('x-api-key');
  if (direct && direct.trim().length > 0) return direct.trim();

  // Accept a bearer token too, so `Authorization: Bearer <key>` works — many
  // HTTP clients and SDK generators default to it.
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) return token;
  }
  return null;
}

/**
 * Wrap a public API handler with authentication and quota accounting.
 * `endpoint` is the metering key and must match a `plan_limit.endpoint` row
 * (or fall back to that plan's `*` row).
 */
export function withApiAuth(
  endpoint: string,
  handler: (request: Request, ctx: ApiContext, routeParams: unknown) => Promise<NextResponse>
) {
  return async (request: Request, routeParams?: unknown): Promise<NextResponse> => {
    const db = await getDb();
    const rawKey = readApiKey(request);

    if (!rawKey) {
      return errorResponse(
        new ApiError(
          API_ERROR_CODES.MISSING_API_KEY,
          'No API key supplied. Send your key in the X-API-Key header. Get a free key at /developers.'
        )
      );
    }

    const authenticated = await authenticateApiKey(db, rawKey);
    if (!authenticated) {
      return errorResponse(
        new ApiError(
          API_ERROR_CODES.INVALID_API_KEY,
          'That API key is not valid, has been revoked, or has expired.'
        )
      );
    }

    const quota = await consumeQuota(db, {
      developerId: authenticated.developer.id,
      apiKeyId: authenticated.apiKey.id,
      plan: authenticated.developer.plan,
      endpoint,
    });

    const headers = quotaHeaders(quota);

    if (!quota.allowed) {
      headers['Retry-After'] = secondsUntilTomorrowUtc();
      return errorResponse(
        new ApiError(
          API_ERROR_CODES.QUOTA_EXCEEDED,
          `Daily quota exceeded for the "${quota.plan}" plan on the "${endpoint}" endpoint: ` +
            `${quota.used} of ${quota.limit} requests used today. ` +
            `Quota resets at 00:00 UTC. Upgrade your plan at /developers for a higher limit.`,
          { plan: quota.plan, endpoint, used: quota.used, limit: quota.limit }
        ),
        headers
      );
    }

    try {
      const response = await handler(
        request,
        {
          db,
          developer: authenticated.developer,
          apiKeyId: authenticated.apiKey.id,
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
        },
        routeParams
      );

      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, headers);
      // Never leak a stack trace or a SQL error to a public caller.
      console.error(`[api:${endpoint}]`, error);
      return errorResponse(
        new ApiError(API_ERROR_CODES.INTERNAL, 'Something went wrong handling that request.'),
        headers
      );
    }
  };
}

function secondsUntilTomorrowUtc(): string {
  const now = new Date();
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return String(Math.max(1, Math.ceil((tomorrow - now.getTime()) / 1000)));
}

/**
 * Paginated JSON response. `Content-Range` carries the total row count, the
 * same convention the Igbo API uses, so existing clients can migrate by
 * changing a base URL.
 */
export function paginatedResponse(
  body: { data: unknown[]; total: number; page: number; perPage: number; hasMore: boolean; diagnostics?: unknown },
  options: { cacheSeconds?: number } = {}
): NextResponse {
  const start = body.data.length === 0 ? 0 : (body.page - 1) * body.perPage;
  const end = start + Math.max(0, body.data.length - 1);

  return NextResponse.json(body, {
    headers: {
      'Content-Range': `items ${start}-${end}/${body.total}`,
      'Cache-Control': `public, s-maxage=${options.cacheSeconds ?? PUBLIC_CACHE_SECONDS}, stale-while-revalidate=600`,
    },
  });
}

/** Parse and validate an integer query parameter. */
export function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ApiError(API_ERROR_CODES.INVALID_PARAMETER, `"${name}" must be a whole number.`);
  }
  if (value < min || value > max) {
    throw new ApiError(
      API_ERROR_CODES.INVALID_PARAMETER,
      `"${name}" must be between ${min} and ${max}.`
    );
  }
  return value;
}

/** Parse a repeatable or comma-separated list parameter. */
export function listParam(params: URLSearchParams, name: string): string[] | undefined {
  const values = params.getAll(name).flatMap((v) => v.split(','));
  const cleaned = values.map((v) => v.trim()).filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function boolParam(params: URLSearchParams, name: string): boolean {
  const raw = params.get(name);
  return raw === 'true' || raw === '1' || raw === '';
}

/** Resolve and validate a language code, so callers get a clear 400. */
export async function resolveLanguage(db: Db, code: string | null, fallback = 'ibo'): Promise<string> {
  if (!code) return fallback;
  // Accept the URL slug as well as the ISO code, so `?language=igbo` works and
  // links made before the slugs existed keep resolving.
  const needle = languageCodeFromSlug(code) ?? code.trim().toLowerCase();
  const row = await db.one<{ code: string }>(
    `select code from language where (code = $1 or url_slug = $1) and is_active`,
    [needle]
  );
  if (!row) {
    const available = await db.rows<{ code: string }>(
      `select code from language where is_active and code <> 'eng' order by sort_order`
    );
    throw new ApiError(
      API_ERROR_CODES.UNSUPPORTED_LANGUAGE,
      `Unsupported language "${code}". Available: ${available.map((a) => a.code).join(', ')}.`,
      { requested: code, available: available.map((a) => a.code) }
    );
  }
  return row.code;
}
