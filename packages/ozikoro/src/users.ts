/**
 * The user table: every account, and every byline the archive credits.
 *
 * WHY BOTH IN ONE SCREEN
 *
 * The question this screen exists to answer is "which of my writers has never signed in", and it cannot be
 * answered from either table alone. `account` knows who can log in; `ozikoro_contributor` knows who wrote
 * the 1,057 records, because the bylines came across from WordPress as attribution rows with no credential
 * attached — WordPress exposes no password hash, so there was nothing to migrate. **An account with no
 * byline and a byline with no account are different people-shaped gaps**, and until this module there was
 * no query anywhere that put them side by side.
 *
 * WHY IT DOES NOT CREATE ANYBODY
 *
 * There is deliberately no `createAccount` here. Minting an account means choosing a password or sending a
 * reset, and both are the account layer's job (`@ozituma/db/accounts`, `scripts/create-account.ts`), not a
 * table's. A user list that could also create users would be the one screen where a mis-click mails a
 * stranger a password. What this screen does instead is *show the gap*: a byline with no account is
 * reported as exactly that, and a person who wants to claim one has the claim path.
 *
 * WHY THE COUNTS ARE QUERIED AND NOT GUESSED
 *
 * Every number the page prints comes from a `count(*)` over the rows the page is about. The brief for this
 * archive is blunt that nothing may be invented — "no fabricated people, counts, emails or activity" — and
 * the cheapest way to obey that is for the page to have no numbers in it that a query did not produce.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

export interface UserAccountRow {
  id: number;
  uuid: string;
  email: string;
  /** The account's own name, then the Ozikoro profile's, then the local part of the address. */
  displayName: string;
  /** The dictionary's role on the account. Shown beside the archive roles so the two are never confused. */
  platformRole: string;
  /** The archive's roles, from `ozikoro_member_role`. Empty means Reader, which every account is. */
  roles: string[];
  status: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
}

export interface UserOverview {
  accounts: number;
  activeAccounts: number;
  suspendedAccounts: number;
  contributors: number;
  contributorsWithAccount: number;
  /** Bylines that were never linked to an account: the writers who have never signed in as themselves. */
  contributorsWithoutAccount: number;
  /** Articles attributed to a byline with no account, which is where the archive cannot answer its author. */
  articlesByUnlinkedBylines: number;
  articles: number;
  /** One row per WordPress role, so the page can state what the fifteen *were* and not only that they exist. */
  wpRoles: WpRoleCount[];
}

/**
 * How many bylines held one WordPress role, and how much they wrote between them.
 *
 * `role` is null for a byline whose WordPress role has not been read into this database. **That is a real
 * bucket and it is reported rather than dropped**: the counts of every bucket plus the nulls add up to
 * `contributors`, so the page can account for the whole table without inventing a role for anybody.
 */
export interface WpRoleCount {
  role: string | null;
  contributors: number;
  articles: number;
}

export interface ContributorRow {
  id: number;
  slug: string;
  displayName: string;
  articles: number;
  hasBio: boolean;
  accountId: number | null;
  accountEmail: string | null;
  /** The name on the account, when there is one, so a mismatch with the byline is visible. */
  accountName: string | null;
  claimStatus: string | null;
  /**
   * The role this person held on ozikoro.com — `administrator`, `editor`, `author`, `contributor` or
   * `subscriber`.
   *
   * ⚠️ **IT IS NOT AN ACCESS LEVEL AND MUST NEVER BE RENDERED AS ONE.** It records what the old site said
   * about the person; it grants no capability and creates no account. `accountId` is the only column on this
   * row that says anything about signing in, and for most bylines it is null.
   */
  wpRole: string | null;
}

/** The platform roles as the database spells them, most senior first. Ranked by `account.role`, not by hand. */
const PLATFORM_ROLE_ORDER = `case a.role
  when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 when 'content_editor' then 3
  when 'linguist' then 4 when 'native_reviewer' then 5 when 'learner' then 6 else 7 end`;

/*
 * The archive roles as an array, aggregated in SQL rather than by a second query per row.
 *
 * `order by` inside `array_agg` because Postgres otherwise returns them in whatever order it read them, and
 * a role list that shuffles between page loads reads as though something changed. `left join` so an account
 * with no membership row still appears — the account is the row the screen is about, and a member row is
 * something a person acquires on their first visit to a dashboard.
 */
const ARCHIVE_ROLES = `coalesce((
  select array_agg(r.role order by r.role)
    from ozikoro_member_role r where r.account_id = a.id
), '{}'::text[]) as roles`;

function normaliseAccount(row: Record<string, unknown>): UserAccountRow {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    email: String(row.email),
    /*
     * The SQL already fell back `display_name → account.display_name → email`, so the only case left is an
     * empty string somebody saved as a name, which is not a name. The address's local part is then the most
     * honest thing to show.
     */
    displayName: String(row.display_name ?? '').trim() || String(row.email).split('@')[0] || String(row.email),
    platformRole: String(row.role),
    roles: (Array.isArray(row.roles) ? row.roles : []).map(String),
    status: String(row.status),
    emailVerified: Boolean(row.email_verified),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastLoginAt: row.last_login_at === null || row.last_login_at === undefined ? null : new Date(String(row.last_login_at)).toISOString(),
    passwordChangedAt:
      row.password_changed_at === null || row.password_changed_at === undefined
        ? null
        : new Date(String(row.password_changed_at)).toISOString(),
  };
}

/**
 * One page of accounts, and the total the page is a page of.
 *
 * The total is a second query rather than `count(*) over ()` because the search parameters are shared
 * between the two and an invisible window function is harder to check than a `where` clause that is visibly
 * the same in both.
 */
export async function listUserAccounts(
  db: Db,
  options: { search?: string | null; status?: string | null; limit?: number; offset?: number } = {}
): Promise<{ accounts: UserAccountRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(
      `(a.email ilike $${params.length} or coalesce(m.display_name, a.display_name) ilike $${params.length})`
    );
  }
  if (options.status && options.status !== 'all') {
    params.push(options.status);
    conditions.push(`a.status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const counted = await db.one<{ n: number }>(
    `select count(*)::int as n from account a left join ozikoro_member m on m.account_id = a.id ${where}`,
    params
  );

  const rows = await db.rows<Record<string, unknown>>(
    `select a.id, a.uuid, a.email, a.role, a.status, a.email_verified, a.created_at, a.last_login_at,
            a.password_changed_at,
            coalesce(nullif(m.display_name, ''), nullif(a.display_name, ''), a.email) as display_name,
            ${ARCHIVE_ROLES}
       from account a
       left join ozikoro_member m on m.account_id = a.id
       ${where}
      order by ${PLATFORM_ROLE_ORDER}, lower(a.email)
      limit ${limit} offset ${offset}`,
    params
  );

  return { accounts: rows.map(normaliseAccount), total: Number(counted?.n ?? 0) };
}

/** One account, or a named refusal — a route that proceeded on a missing id would write an audit row about nobody. */
export async function getUserAccount(db: Db, accountId: number): Promise<UserAccountRow> {
  const row = await db.one<Record<string, unknown>>(
    `select a.id, a.uuid, a.email, a.role, a.status, a.email_verified, a.created_at, a.last_login_at,
            a.password_changed_at,
            coalesce(nullif(m.display_name, ''), nullif(a.display_name, ''), a.email) as display_name,
            ${ARCHIVE_ROLES}
       from account a
       left join ozikoro_member m on m.account_id = a.id
      where a.id = $1`,
    [accountId]
  );
  if (!row) throw new MemberError('no_account', 'That account does not exist.');
  return normaliseAccount(row);
}

/** The Ozikoro profile behind an account, when there is one. Null is a real answer: nobody has to have one. */
export async function getMemberProfile(db: Db, accountId: number): Promise<{
  displayName: string | null;
  headline: string | null;
  institution: string | null;
  orcid: string | null;
  website: string | null;
  isPublic: boolean;
  status: string;
} | null> {
  const row = await db.one<Record<string, unknown>>(
    `select display_name, headline, institution, orcid, website, is_public, status
       from ozikoro_member where account_id = $1`,
    [accountId]
  );
  if (!row) return null;
  return {
    displayName: row.display_name ? String(row.display_name) : null,
    headline: row.headline ? String(row.headline) : null,
    institution: row.institution ? String(row.institution) : null,
    orcid: row.orcid ? String(row.orcid) : null,
    website: row.website ? String(row.website) : null,
    isPublic: Boolean(row.is_public),
    status: String(row.status),
  };
}

export interface GrantedArchiveRole {
  role: string;
  grantedAt: string;
  grantedByEmail: string | null;
  note: string | null;
}

/** An account's archive roles, with who granted each one and when — the question an audit asks. */
export async function getUserRoles(db: Db, accountId: number): Promise<GrantedArchiveRole[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.role, r.granted_at, r.note, g.email as granted_by_email
       from ozikoro_member_role r
       left join account g on g.id = r.granted_by
      where r.account_id = $1
      order by ozikoro_role_rank(r.role) desc, r.role`,
    [accountId]
  );
  return rows.map((row) => ({
    role: String(row.role),
    grantedAt: new Date(String(row.granted_at)).toISOString(),
    grantedByEmail: row.granted_by_email ? String(row.granted_by_email) : null,
    note: row.note ? String(row.note) : null,
  }));
}

/**
 * What an account may do, and where each capability comes from.
 *
 * The capability list is `ozikoro_capabilities`, the set-returning function added in migration 0043. **Its
 * column is named after the function, not `capability`** — a `select capability from ozikoro_capabilities($1)`
 * fails with "column capability does not exist" and took every dashboard down with it, which is why the alias
 * below is written out rather than left to the reader.
 *
 * The provenance comes from `ozikoro_role_capability` for a role the account actually holds. Capabilities the
 * function adds for reasons of its own — `read` for everyone, and admin's set for a platform admin with no
 * granted role — have no row to point at, and are reported as coming from the rule rather than from a role.
 * **That distinction is the point of the screen**: "this person may manage users because the platform role
 * says so" and "because somebody granted them the administrator role" are different facts, and only the
 * second one is a grant anybody can revoke here.
 */
export async function getCapabilityDetail(
  db: Db,
  accountId: number
): Promise<{ capability: string; from: string[]; implicit: boolean }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.capability as capability,
            coalesce(
              (select array_agg(rc.role order by ozikoro_role_rank(rc.role) desc, rc.role)
                 from ozikoro_role_capability rc
                where rc.capability = c.capability
                  and rc.role in (select r.role from ozikoro_member_role r where r.account_id = $1)),
              '{}'::text[]
            ) as from_roles
       from (select ozikoro_capabilities($1) as capability) c
      order by c.capability`,
    [accountId]
  );

  const account = await db.one<{ role: string }>(
    `select a.role::text as role from account a where a.id = $1`,
    [accountId]
  );

  return rows.map((row) => {
    const from = (Array.isArray(row.from_roles) ? row.from_roles : []).map(String);
    if (from.length > 0) return { capability: String(row.capability), from, implicit: false };
    /*
     * No granted role names this capability, so the rule did. Two rules can do that — the universal Reader
     * grant, and the platform administrator branch — and they are named differently because they are
     * revoked differently: one by changing the platform role, which this screen does not do, and the other
     * by nothing at all.
     */
    const viaPlatform = account && ['admin', 'owner'].includes(String(account.role));
    return {
      capability: String(row.capability),
      from: [viaPlatform ? `the platform role “${account?.role}”` : 'every signed-in Reader'],
      implicit: true,
    };
  });
}

export interface MemberAuditRow {
  action: string;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  createdAt: string;
}

/**
 * Every recorded change about one account.
 *
 * `entity_type = 'ozikoro_member'` is the convention `grantRole`, `revokeRole` and `setMemberStatus` in
 * `members.ts` already write, and the entity id they use is the ACCOUNT id — not the `ozikoro_member.id`
 * primary key, which is a different number and would silently show the wrong person's history if it were
 * used here. The left join keeps a row whose actor has since been deleted, because the record of what
 * happened must outlive the account that did it.
 */
export async function getAccountAudit(db: Db, accountId: number, limit = 50): Promise<MemberAuditRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select e.action, e.before, e.after, e.note, e.created_at, actor.email as actor_email
       from ozikoro_audit e
       left join account actor on actor.id = e.actor_id
      where e.entity_type = 'ozikoro_member' and e.entity_id = $1
      order by e.created_at desc, e.id desc
      limit $2`,
    [accountId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((row) => ({
    action: String(row.action),
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    before: row.before ?? null,
    after: row.after ?? null,
    note: row.note ? String(row.note) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

/**
 * Whether the account is the last way into the archive.
 *
 * Used to disable the suspend button rather than to hope nobody presses it. The count is of *effective*
 * administrators — an account-level admin or owner counts even with no granted role, because that is how the
 * first administrator exists — which is the same rule `revokeRole` applies before it would remove the last
 * administrator.
 */
export async function isLastAdministrator(db: Db, accountId: number): Promise<boolean> {
  const row = await db.one<{ n: number }>(`
    select count(distinct id)::int as n from (
      select account_id as id from ozikoro_member_role where role = 'admin'
      union
      select id from account where role in ('admin', 'owner')
    ) t
  `);
  if (Number(row?.n ?? 0) > 1) return false;

  const self = await db.one<{ n: number }>(
    `select count(*)::int as n from (
       select account_id as id from ozikoro_member_role where role = 'admin' and account_id = $1
       union
       select id from account where role in ('admin', 'owner') and id = $1
     ) t`,
    [accountId]
  );
  return Number(self?.n ?? 0) > 0;
}

/** One page of bylines, with the account each one is — or is not — linked to. */
export async function listContributors(
  db: Db,
  options: { search?: string | null; owner?: 'all' | 'linked' | 'unlinked'; limit?: number; offset?: number } = {}
): Promise<{ contributors: ContributorRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`k.display_name ilike $${params.length}`);
  }
  if (options.owner === 'linked') conditions.push(`k.account_id is not null`);
  if (options.owner === 'unlinked') conditions.push(`k.account_id is null`);
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const counted = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_contributor k ${where}`, params);

  const rows = await db.rows<Record<string, unknown>>(
    `select k.id, k.slug, k.display_name, k.bio, k.account_id, k.wp_role,
            coalesce(nullif(m.display_name, ''), a.display_name, a.email) as account_name,
            a.email as account_email,
            (select count(*)::int from ozikoro_article ar where ar.author_id = k.id) as articles,
            (select c.status from ozikoro_contributor_claim c
              where c.contributor_id = k.id and c.account_id = k.account_id
              order by c.created_at desc limit 1) as claim_status
       from ozikoro_contributor k
       left join account a on a.id = k.account_id
       left join ozikoro_member m on m.account_id = a.id
       ${where}
      order by articles desc, lower(k.display_name)
      limit ${limit} offset ${offset}`,
    params
  );

  return { contributors: rows.map(normaliseContributor), total: Number(counted?.n ?? 0) };
}

function normaliseContributor(row: Record<string, unknown>): ContributorRow {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    articles: Number(row.articles ?? 0),
    hasBio: row.bio !== null && row.bio !== undefined && String(row.bio).trim() !== '',
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    accountEmail: row.account_email ? String(row.account_email) : null,
    accountName: row.account_name ? String(row.account_name) : null,
    claimStatus: row.claim_status ? String(row.claim_status) : null,
    wpRole: row.wp_role === null || row.wp_role === undefined || String(row.wp_role).trim() === ''
      ? null
      : String(row.wp_role),
  };
}

/** The bylines already linked to one account, for that account's own page. */
export async function getAccountBylines(db: Db, accountId: number): Promise<ContributorRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select k.id, k.slug, k.display_name, k.bio, k.account_id, k.wp_role,
            a.display_name as account_name, a.email as account_email,
            (select count(*)::int from ozikoro_article ar where ar.author_id = k.id) as articles,
            null::text as claim_status
       from ozikoro_contributor k
       left join account a on a.id = k.account_id
      where k.account_id = $1
      order by lower(k.display_name)`,
    [accountId]
  );
  return rows.map(normaliseContributor);
}

/** The counts the overview prints. One query, so no number on the page can disagree with another. */
export async function getUserOverview(db: Db): Promise<UserOverview> {
  const row = await db.one<Record<string, unknown>>(`
    select
      (select count(*)::int from account) as accounts,
      (select count(*)::int from account where status = 'active') as active_accounts,
      (select count(*)::int from account where status = 'suspended') as suspended_accounts,
      (select count(*)::int from ozikoro_contributor) as contributors,
      (select count(*)::int from ozikoro_contributor where account_id is not null) as contributors_with_account,
      (select count(*)::int from ozikoro_contributor where account_id is null) as contributors_without_account,
      (select count(*)::int from ozikoro_article ar
        join ozikoro_contributor k on k.id = ar.author_id
       where k.account_id is null) as articles_by_unlinked_bylines,
      (select count(*)::int from ozikoro_article) as articles
  `);

  /*
   * THE ROLE BREAKDOWN, AS A SECOND QUERY RATHER THAN A WINDOW FUNCTION.
   *
   * It is grouped by `wp_role` and left-joined to the articles, so a byline that has written nothing is
   * counted as a contributor with zero records rather than dropped — **`inner join` here would have made a
   * byline with no published work disappear from the page that exists to list every byline.** `nulls last`
   * keeps "not recorded" at the bottom, where it reads as the gap it is rather than as the least senior role.
   */
  const roleRows = await db.rows<Record<string, unknown>>(`
    select k.wp_role as role,
           count(distinct k.id)::int as contributors,
           count(a.id)::int as articles
      from ozikoro_contributor k
      left join ozikoro_article a on a.author_id = k.id
     group by k.wp_role
     order by k.wp_role nulls last, k.wp_role
  `);

  return {
    accounts: Number(row?.accounts ?? 0),
    activeAccounts: Number(row?.active_accounts ?? 0),
    suspendedAccounts: Number(row?.suspended_accounts ?? 0),
    contributors: Number(row?.contributors ?? 0),
    contributorsWithAccount: Number(row?.contributors_with_account ?? 0),
    contributorsWithoutAccount: Number(row?.contributors_without_account ?? 0),
    articlesByUnlinkedBylines: Number(row?.articles_by_unlinked_bylines ?? 0),
    articles: Number(row?.articles ?? 0),
    wpRoles: roleRows.map((r) => ({
      role: r.role === null || r.role === undefined ? null : String(r.role),
      contributors: Number(r.contributors ?? 0),
      articles: Number(r.articles ?? 0),
    })),
  };
}
