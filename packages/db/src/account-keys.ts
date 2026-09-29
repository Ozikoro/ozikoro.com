/**
 * API access, as the dashboard sees it.
 *
 * The owner's rule is that a key is obtained from the dashboard and nowhere else,
 * which needs three things this file provides: a developer row that belongs to an
 * account, the account's keys with their real state, and the usage that shows
 * whether a key is working.
 *
 * WHY ADOPTION RATHER THAN CREATION
 *
 * `developer` rows already exist for people who used the public form, and their
 * keys are in production. So the dashboard does not mint a second developer for
 * the same person: it looks for one already matching the account's email and
 * claims it. If none exists it creates one. Either way the account ends up with
 * exactly one developer, which the unique index on `account_id` enforces rather
 * than trusts.
 */
import type { Db } from './client.ts';
import type { Account } from './accounts.ts';
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRecord,
  type Developer,
} from './apikeys.ts';

export interface KeyWithUsage extends ApiKeyRecord {
  /** The endpoint counts this key contributed today, if any. */
  usedToday: number;
}

export interface AccountApiAccess {
  developer: Developer;
  keys: KeyWithUsage[];
  /** Today's per-endpoint usage for the whole developer. */
  usage: { endpoint: string; used: number; limit: number | null; remaining: number | null }[];
  /** The daily allowance of the developer's plan, for the copy on the page. */
  dailyLimit: number | null;
  docsPath: string;
}

const DOCS_PATH = '/docs';

/** The developer behind an account, adopting an unclaimed one by email. */
export async function developerForAccount(db: Db, account: Account): Promise<Developer> {
  const existing = await db.one<Record<string, unknown>>(
    `select id, uuid, name, email, organization, plan, status
       from developer where account_id = $1`,
    [account.id]
  );
  if (existing) return toDeveloper(existing);

  /*
   * Adoption. An unclaimed developer with the same email is this person: the
   * public form asked for an email and the account has one, and the alternative
   * is a second identity holding keys they cannot see.
   */
  const adoptable = await db.one<Record<string, unknown>>(
    `select id from developer
      where account_id is null and lower(email) = lower($1)
      order by created_at
      limit 1`,
    [account.email]
  );
  if (adoptable) {
    const claimed = await db.one<Record<string, unknown>>(
      `update developer set account_id = $1, updated_at = now()
        where id = $2 returning id, uuid, name, email, organization, plan, status`,
      [account.id, Number(adoptable.id)]
    );
    if (claimed) return toDeveloper(claimed);
  }

  const created = await db.one<Record<string, unknown>>(
    `insert into developer (name, email, account_id, plan)
     values ($1, $2, $3, 'free')
     on conflict (lower(email)) do update set account_id = coalesce(developer.account_id, excluded.account_id)
     returning id, uuid, name, email, organization, plan, status`,
    [account.displayName ?? account.email, account.email, account.id]
  );
  if (!created) throw new Error('Could not create a developer for this account.');
  return toDeveloper(created);
}

function toDeveloper(row: Record<string, unknown>): Developer {
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

/** Everything the dashboard shows about an account's API access. */
export async function accountApiAccess(db: Db, account: Account): Promise<AccountApiAccess> {
  const developer = await developerForAccount(db, account);
  const keys = await listApiKeys(db, developer.id);

  const usageRows = await db.rows<{ endpoint: string; count: number }>(
    `select endpoint, count from api_usage_daily
      where developer_id = $1 and day = current_date`,
    [developer.id]
  );
  const perKey = await db.rows<{ api_key_id: string; count: number }>(
    `select api_key_id, count from api_usage_daily
      where developer_id = $1 and day = current_date and api_key_id is not null`,
    [developer.id]
  );
  const keyUsage = new Map(perKey.map((row) => [Number(row.api_key_id), Number(row.count)]));

  const limits = await db.rows<{ endpoint: string; daily_limit: number }>(
    `select endpoint, daily_limit from plan_limit where plan = $1`,
    [developer.plan]
  );
  const wildcard = limits.find((l) => l.endpoint === '*')?.daily_limit ?? null;
  const byEndpoint = new Map(limits.map((l) => [l.endpoint, Number(l.daily_limit)]));

  const usage = usageRows.map((row) => {
    const limit = byEndpoint.get(row.endpoint) ?? wildcard;
    const used = Number(row.count);
    return {
      endpoint: row.endpoint,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  });

  return {
    developer,
    keys: keys.map((key) => ({ ...key, usedToday: keyUsage.get(key.id) ?? 0 })),
    usage,
    dailyLimit: wildcard,
    docsPath: DOCS_PATH,
  };
}

/**
 * Issue a key from the dashboard.
 *
 * The plaintext is returned once and never stored — the row keeps a hash and a
 * display prefix — so the page shows it exactly once and says so.
 */
export async function issueKeyForAccount(
  db: Db,
  account: Account,
  options: { name?: string; expiresInDays?: number | null } = {}
): Promise<{ apiKey: string; keyPrefix: string; developer: Developer }> {
  const developer = await developerForAccount(db, account);
  const name = (options.name ?? '').trim().slice(0, 60) || 'dashboard';
  const { key, hash, prefix } = generateApiKey();
  const days = options.expiresInDays ?? null;

  await db.query(
    `insert into api_key (developer_id, name, key_prefix, key_hash, scopes, expires_at, created_by_account)
     values ($1, $2, $3, $4, $5, case when $6::int is null then null else now() + ($6::int || ' days')::interval end, $7)`,
    [developer.id, name, prefix, hash, ['read'], days, account.id]
  );

  return { apiKey: key, keyPrefix: prefix, developer };
}

/** Revoke one of the account's keys. Refuses a key belonging to another account. */
export async function revokeKeyForAccount(
  db: Db,
  account: Account,
  keyId: number
): Promise<boolean> {
  const developer = await developerForAccount(db, account);
  return revokeApiKey(db, developer.id, keyId);
}
