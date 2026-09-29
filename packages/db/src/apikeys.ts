/**
 * Developer accounts, API keys and quota enforcement.
 *
 * WHAT THIS FIXES FROM THE REFERENCE IMPLEMENTATION
 *
 * 1. API keys are HASHED. igbo_api generates a plain uuid v4 and stores it in
 *    cleartext (`const generateApiKey = uuid`), so a database leak hands over
 *    every working credential. Here the key is shown exactly once at creation,
 *    and only a SHA-256 hash plus a short display prefix is persisted.
 *
 * 2. Quota limits are RESOLVED, not hardcoded. igbo_api advertises 500
 *    requests/day on its free tier and 2,500 on Team, but its usage middleware
 *    applies a flat 2,500 to everyone because it never reads the developer's
 *    plan. Here the limit comes from `plan_limit`, with per-endpoint overrides
 *    and a wildcard fallback, so pricing copy and enforcement cannot drift.
 *
 * 3. Failures map to correct status codes. The reference returns HTTP 400 for
 *    everything, including rate limiting, because its error handler defaults
 *    to 400 and only upgrades to 404 for messages matching /No .+ exist/.
 *    Here every error code has an explicit status (see @ozituma/core).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './client.ts';

const KEY_PREFIX = 'ozt_live_';
/** Hex characters of randomness after the prefix. */
const KEY_ENTROPY_CHARS = 40;
/** Characters of the key kept in the clear, for display in the dashboard. */
const DISPLAY_PREFIX_CHARS = KEY_PREFIX.length + 8;

export interface Developer {
  id: number;
  uuid: string;
  name: string;
  email: string;
  organization: string | null;
  plan: string;
  status: string;
}

export interface ApiKeyRecord {
  id: number;
  developerId: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  revokedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface AuthenticatedKey {
  developer: Developer;
  apiKey: ApiKeyRecord;
}

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  /** Remaining requests today, floored at zero. */
  remaining: number;
  plan: string;
  endpoint: string;
}

/** sha256 of the full key. Deterministic, so it can be indexed and looked up directly. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + randomBytes(KEY_ENTROPY_CHARS / 2).toString('hex');
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, DISPLAY_PREFIX_CHARS),
  };
}

/** Constant-time comparison, for anywhere a raw key is compared directly. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface RegisterDeveloperInput {
  name: string;
  email: string;
  organization?: string | null;
  useCase?: string | null;
  plan?: string;
  /** Name for the first key, e.g. "production". */
  keyName?: string;
}

export interface RegisterDeveloperResult {
  developer: Developer;
  /**
   * The only time the plaintext key is ever available. It is not recoverable.
   */
  apiKey: string;
  keyPrefix: string;
}

/**
 * Create a developer and their first API key. Idempotent on email: an existing
 * developer gets an additional key rather than a duplicate account.
 */
export async function registerDeveloper(
  db: Db,
  input: RegisterDeveloperInput
): Promise<RegisterDeveloperResult> {
  const plan = input.plan ?? 'free';

  const inserted = await db.one<Record<string, unknown>>(
    `insert into developer (name, email, organization, use_case, plan)
     values ($1, $2, $3, $4, $5)
     on conflict (lower(email)) do update set
       name         = excluded.name,
       organization = coalesce(excluded.organization, developer.organization),
       use_case     = coalesce(excluded.use_case, developer.use_case),
       updated_at   = now()
     returning id, uuid, name, email, organization, plan, status`,
    [input.name, input.email, input.organization ?? null, input.useCase ?? null, plan]
  );

  if (!inserted) throw new Error('Failed to create developer account');

  const developer = normaliseDeveloper(inserted);

  const { key, hash, prefix } = generateApiKey();
  const apiKeyRow = await db.one<{ id: string }>(
    `insert into api_key (developer_id, name, key_prefix, key_hash, scopes)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [developer.id, input.keyName ?? 'default', prefix, hash, ['read']]
  );

  if (!apiKeyRow) throw new Error('Failed to create API key');

  return {
    developer,
    apiKey: key,
    keyPrefix: prefix,
  };
}

function normaliseDeveloper(row: Record<string, unknown>): Developer {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    email: String(row.email),
    organization: (row.organization as string | null) ?? null,
    plan: String(row.plan),
    status: String(row.status),
  };
}

/**
 * Resolve an API key to its developer. Returns null for unknown, revoked,
 * expired, or suspended credentials — the caller decides the status code.
 */
export async function authenticateApiKey(db: Db, key: string): Promise<AuthenticatedKey | null> {
  if (!key || key.trim().length === 0) return null;

  const hash = hashApiKey(key.trim());

  const row = await db.one<Record<string, unknown>>(
    `select k.id                as key_id,
            k.developer_id,
            k.name              as key_name,
            k.key_prefix,
            k.scopes,
            k.revoked_at,
            k.expires_at,
            k.last_used_at,
            d.id                as dev_id,
            d.uuid              as dev_uuid,
            d.name              as dev_name,
            d.email             as dev_email,
            d.organization      as dev_organization,
            d.plan              as dev_plan,
            d.status            as dev_status
       from api_key k
       join developer d on d.id = k.developer_id
      where k.key_hash = $1`,
    [hash]
  );

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.dev_status !== 'active') return null;
  if (row.expires_at !== null && new Date(String(row.expires_at)).getTime() < Date.now()) return null;

  return {
    developer: normaliseDeveloper({
      id: row.dev_id,
      uuid: row.dev_uuid,
      name: row.dev_name,
      email: row.dev_email,
      organization: row.dev_organization,
      plan: row.dev_plan,
      status: row.dev_status,
    }),
    apiKey: {
      id: Number(row.key_id),
      developerId: Number(row.developer_id),
      name: String(row.key_name),
      keyPrefix: String(row.key_prefix),
      scopes: (row.scopes as string[]) ?? ['read'],
      revokedAt: (row.revoked_at as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
      lastUsedAt: (row.last_used_at as string | null) ?? null,
    },
  };
}

/** Record that a key was used. Best-effort; never blocks a response. */
export async function touchApiKey(db: Db, apiKeyId: number): Promise<void> {
  try {
    await db.query(`update api_key set last_used_at = now() where id = $1`, [apiKeyId]);
  } catch {
    // Usage timestamps are telemetry, not correctness.
  }
}

/**
 * Resolve the daily limit for a plan and endpoint.
 * A row for the exact endpoint wins; otherwise the '*' row applies.
 */
export async function resolveDailyLimit(
  db: Db,
  plan: string,
  endpoint: string
): Promise<number | null> {
  const row = await db.one<{ daily_limit: number }>(
    `select daily_limit from plan_limit
      where plan = $1 and endpoint in ($2, '*')
      order by case when endpoint = $2 then 0 else 1 end
      limit 1`,
    [plan, endpoint]
  );
  return row ? Number(row.daily_limit) : null;
}

/**
 * Count the request and decide whether it is within quota.
 *
 * The increment happens first, in a single atomic upsert, so concurrent
 * requests cannot both read a stale count and both be allowed. Over-limit
 * requests are still counted, which is deliberate: it keeps an abusive client
 * visible in the usage data instead of invisible.
 */
export async function consumeQuota(
  db: Db,
  params: { developerId: number; apiKeyId: number; plan: string; endpoint: string }
): Promise<QuotaDecision> {
  const limit = await resolveDailyLimit(db, params.plan, params.endpoint);

  // No limit row configured: fail closed rather than silently allowing
  // unlimited traffic through a misconfiguration.
  if (limit === null) {
    return {
      allowed: false,
      used: 0,
      limit: 0,
      remaining: 0,
      plan: params.plan,
      endpoint: params.endpoint,
    };
  }

  const row = await db.one<{ count: number }>(
    `insert into api_usage_daily (developer_id, api_key_id, day, endpoint, count)
     values ($1, $2, current_date, $3, 1)
     on conflict (developer_id, day, endpoint) do update set
       count = api_usage_daily.count + 1,
       api_key_id = coalesce(excluded.api_key_id, api_usage_daily.api_key_id)
     returning count`,
    [params.developerId, params.apiKeyId, params.endpoint]
  );

  const used = Number(row?.count ?? 1);
  return {
    allowed: used <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan: params.plan,
    endpoint: params.endpoint,
  };
}

export interface UsageSummary {
  endpoint: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** Today's usage per endpoint, for the developer dashboard. */
export async function getUsageSummary(
  db: Db,
  developerId: number,
  plan: string
): Promise<UsageSummary[]> {
  const rows = await db.rows<{ endpoint: string; count: number }>(
    `select endpoint, count from api_usage_daily
      where developer_id = $1 and day = current_date
      order by endpoint`,
    [developerId]
  );
  const limits = await db.rows<{ endpoint: string; daily_limit: number }>(
    `select endpoint, daily_limit from plan_limit where plan = $1`,
    [plan]
  );

  const wildcard = limits.find((l) => l.endpoint === '*')?.daily_limit ?? null;
  const byEndpoint = new Map(limits.map((l) => [l.endpoint, Number(l.daily_limit)]));

  return rows.map((row) => {
    const limit = byEndpoint.get(row.endpoint) ?? wildcard;
    const used = Number(row.count);
    return {
      endpoint: row.endpoint,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  });
}

/** Revoke a key. Owned by the developer, so a leaked key is a one-call fix. */
export async function revokeApiKey(
  db: Db,
  developerId: number,
  apiKeyId: number
): Promise<boolean> {
  const result = await db.query(
    `update api_key set revoked_at = now()
      where id = $1 and developer_id = $2 and revoked_at is null`,
    [apiKeyId, developerId]
  );
  return result.rowCount > 0;
}

/** Issue an additional key for an existing developer. */
export async function createAdditionalKey(
  db: Db,
  developerId: number,
  name: string
): Promise<{ apiKey: string; keyPrefix: string }> {
  const { key, hash, prefix } = generateApiKey();
  await db.query(
    `insert into api_key (developer_id, name, key_prefix, key_hash, scopes)
     values ($1, $2, $3, $4, $5)`,
    [developerId, name, prefix, hash, ['read']]
  );
  return { apiKey: key, keyPrefix: prefix };
}

/** List a developer's keys, with the secret safely absent. */
export async function listApiKeys(db: Db, developerId: number): Promise<ApiKeyRecord[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, developer_id, name, key_prefix, scopes, revoked_at, expires_at, last_used_at
       from api_key
      where developer_id = $1
      order by created_at desc`,
    [developerId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    developerId: Number(row.developer_id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    scopes: (row.scopes as string[]) ?? ['read'],
    revokedAt: (row.revoked_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
  }));
}
