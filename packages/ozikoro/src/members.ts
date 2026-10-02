/**
 * Who someone is on ozikoro.com, and what they may do.
 *
 * The plan lists ten roles and says plainly: "Enforce permissions server-side. Never rely on hidden
 * buttons as authorisation." So the whole of this module is written to answer one question —
 * *may this account do this thing* — and every caller that gates an action asks it here rather than
 * inspecting a role itself. A route that checked `roles.includes('editor')` inline would be a second
 * definition of what an editor is, and the two would drift.
 *
 * Roles are held as rows, so a person can be a researcher and a teacher at once, and every grant
 * records who made it. Capabilities come from the `ozikoro_role_capability` table, so the schema and
 * the server agree by construction rather than by care.
 */
import type { Db } from '@ozituma/db/client';

/** The plan's ten, in the order it lists them. */
export const OZIKORO_ROLES = [
  'reader',
  'student',
  'teacher',
  'researcher',
  'independent_researcher',
  'community_knowledge_holder',
  'editor',
  'expert_reviewer',
  'moderator',
  'admin',
] as const;

export type OzikoroRole = (typeof OZIKORO_ROLES)[number];

export function isOzikoroRole(value: string): value is OzikoroRole {
  return (OZIKORO_ROLES as readonly string[]).includes(value);
}

const ROLE_LABEL: Record<OzikoroRole, string> = {
  reader: 'Reader',
  student: 'Student',
  teacher: 'Teacher',
  researcher: 'Researcher',
  independent_researcher: 'Independent researcher',
  community_knowledge_holder: 'Community knowledge holder',
  editor: 'Editor',
  expert_reviewer: 'Expert reviewer',
  moderator: 'Moderator',
  admin: 'Administrator',
};

export function roleLabel(role: OzikoroRole): string {
  return ROLE_LABEL[role];
}

/**
 * What each role is for, in the plan's own terms.
 *
 * Kept beside the roles because the dashboards have to explain themselves: a reader arriving at a
 * page that says "you are a Community Knowledge Holder" should be able to find out what that means
 * without reading the build plan.
 */
export const ROLE_PURPOSE: Record<OzikoroRole, string> = {
  reader: 'An account, bookmarks, follows, collections and reading history.',
  student: 'A profile, institution, research projects, publications, notes and submissions.',
  teacher: 'A profile, teaching resources, courses, sources and publications.',
  researcher: 'Research profile, publications, projects, datasets, fieldwork, questions and groups.',
  independent_researcher: 'A research profile and publishing, without needing a university.',
  community_knowledge_holder: 'Community and oral-history contributions, with consent and review.',
  editor: 'The editorial queue, source and evidence verification, entity management and publishing.',
  expert_reviewer: 'Assigned manuscript and evidence reviews.',
  moderator: 'Reports, moderation of users and content, and escalation.',
  admin: 'The whole system: users, data, configuration, audit and security.',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OzikoroMember {
  accountId: number;
  email: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  institution: string | null;
  department: string | null;
  orcid: string | null;
  website: string | null;
  researchInterests: string[];
  isPublic: boolean;
  status: 'active' | 'pending' | 'suspended';
  roles: OzikoroRole[];
  /** The dictionary's own role, shown alongside so the two are never confused. */
  platformRole: string;
  createdAt: string;
}

export class MemberError extends Error {
  override readonly name = 'MemberError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The member record for an account, or null if they have never been given one.
 *
 * Callers that need "what may this person do" should use `capabilitiesFor`, which treats a member
 * row that does not exist yet as a Reader rather than as nobody. Nobody signed in is a stranger;
 * somebody signed in is at least a reader.
 */
export async function getMember(db: Db, accountId: number): Promise<OzikoroMember | null> {
  const row = await db.one<Record<string, unknown>>(
    `select m.account_id, a.email, a.role as platform_role,
            coalesce(m.display_name, a.display_name, a.email) as display_name,
            m.headline, m.bio, m.institution, m.department, m.orcid, m.website,
            m.research_interests, m.is_public, m.status, m.created_at,
            coalesce(
              (select array_agg(r.role order by r.role) from ozikoro_member_role r where r.account_id = m.account_id),
              '{}'::text[]
            ) as roles
       from ozikoro_member m
       join account a on a.id = m.account_id
      where m.account_id = $1`,
    [accountId]
  );
  if (!row) return null;

  return {
    accountId: Number(row.account_id),
    email: String(row.email),
    displayName: String(row.display_name ?? ''),
    headline: row.headline ? String(row.headline) : null,
    bio: row.bio ? String(row.bio) : null,
    institution: row.institution ? String(row.institution) : null,
    department: row.department ? String(row.department) : null,
    orcid: row.orcid ? String(row.orcid) : null,
    website: row.website ? String(row.website) : null,
    researchInterests: Array.isArray(row.research_interests) ? row.research_interests.map(String) : [],
    isPublic: Boolean(row.is_public),
    status: String(row.status) as OzikoroMember['status'],
    roles: (Array.isArray(row.roles) ? row.roles.map(String) : []).filter(isOzikoroRole),
    platformRole: String(row.platform_role ?? 'contributor'),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/**
 * Create the membership row for an account that has none.
 *
 * Called on the first visit to a dashboard rather than on signup, because the dictionary and the
 * courses both create accounts and neither should have to know that Ozikoro has a members table.
 */
export async function ensureMember(db: Db, accountId: number): Promise<OzikoroMember> {
  await db.query(
    `insert into ozikoro_member (account_id) values ($1) on conflict (account_id) do nothing`,
    [accountId]
  );
  const member = await getMember(db, accountId);
  if (!member) throw new MemberError('no_account', 'That account does not exist.');
  return member;
}

/**
 * Everything an account may do, as a set of capability strings.
 *
 * Two sources, deliberately. The Ozikoro roles carry their own capabilities, and the platform role
 * is honoured too: the dictionary's `admin` and `owner` are the people who run the institution, and
 * requiring them to also be granted Ozikoro's admin role before they can open the editorial queue
 * would be a second lock on a door they already hold the key to.
 */
export async function capabilitiesFor(db: Db, accountId: number): Promise<Set<string>> {
  /*
   * THE DATABASE DECIDES, AND THE APPLICATION ASKS.
   *
   * This function used to hold the rule itself — a query joining ozikoro_role_capability to
   * ozikoro_member_role with an account-level admin branch. It was correct, and `capability-check` verified
   * that every call site named a capability some role holds. **But a static check looks for call sites, and a
   * missing call site is not one**: a route that queried the archive directly and never asked would pass it.
   *
   * The rule now lives in `ozikoro_capabilities`, a SECURITY DEFINER function in migration 0043, so Postgres
   * answers the question and any query can ask it. This wrapper exists to keep the call sites unchanged and
   * to give the set a stable shape; it deliberately contains no rule of its own, because a second copy is a
   * thing that can drift.
   *
   * `scripts/check-capability-fn.mjs` asserts the function and this wrapper agree for all twenty-one
   * combinations of platform role and archive role, so the migration from TypeScript to SQL was verified
   * rather than assumed.
   */
  const rows = await db.rows<{ capability: string }>(
    `select ozikoro_capabilities($1) as capability`,
    [accountId]
  );
  return new Set(rows.map((r) => r.capability));
}

/*
 * `can` and `requireCapability` follow, unchanged in shape. They go through `capabilitiesFor`, so they
 * inherit the database's answer without needing to know where it came from.
 */
export async function can(db: Db, accountId: number, capability: string): Promise<boolean> {
  const capabilities = await capabilitiesFor(db, accountId);
  return capabilities.has(capability);
}

/**
 * The capabilities, or a refusal.
 *
 * The one function every gated action calls. It returns the set rather than a boolean so the caller
 * does not have to ask twice, and it throws a named error so a route can turn it into the right
 * status without inspecting a string.
 */
export async function requireCapability(db: Db, accountId: number, capability: string): Promise<Set<string>> {
  const capabilities = await capabilitiesFor(db, accountId);
  if (!capabilities.has(capability)) {
    throw new MemberError('forbidden', `That action needs the “${capability.replace(/_/g, ' ')}” permission.`);
  }
  return capabilities;
}

// ---------------------------------------------------------------------------
// Granting
// ---------------------------------------------------------------------------

export async function grantRole(
  db: Db,
  input: { accountId: number; role: OzikoroRole; grantedBy: number | null; note?: string | null }
): Promise<void> {
  if (!isOzikoroRole(input.role)) throw new MemberError('unknown_role', 'That is not a role on this site.');
  await ensureMember(db, input.accountId);
  await db.query(
    `insert into ozikoro_member_role (account_id, role, granted_by, note)
     values ($1, $2, $3, $4) on conflict (account_id, role) do nothing`,
    [input.accountId, input.role, input.grantedBy, input.note ?? null]
  );
  await audit(db, {
    entityType: 'ozikoro_member',
    entityId: input.accountId,
    action: 'grant_role',
    after: { role: input.role },
    actorId: input.grantedBy,
  });
}

/**
 * Remove a role.
 *
 * The last administrator cannot be demoted. Without that rule a single mistake locks every
 * administrative action on the site, including the one that would undo it.
 */
export async function revokeRole(
  db: Db,
  input: { accountId: number; role: OzikoroRole; actorId: number | null }
): Promise<void> {
  const held = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_member_role where account_id = $1 and role = $2`,
    [input.accountId, input.role]
  );
  /*
   * Revoking a role somebody does not hold is a no-op, not an error and not an audit entry. The
   * first version of this wrote a `revoke_role` row for a role that was never granted, which made
   * the audit log assert something untrue — and an audit log that records changes that did not
   * happen is worse than none.
   */
  if (Number(held?.n ?? 0) === 0) return;

  if (input.role === 'admin') {
    /*
     * The guard has to count EFFECTIVE administrators, not granted ones. The dictionary's `admin`
     * and `owner` are administrators of the institution and hold Ozikoro's admin capabilities
     * without an Ozikoro role row (see `capabilitiesFor`), so counting only `ozikoro_member_role`
     * would happily strip the last real administrator and lock every administrative action on the
     * site, including the one that would undo it.
     */
    const effective = await db.one<{ n: number }>(`
      select count(distinct id)::int as n from (
        select account_id as id from ozikoro_member_role where role = 'admin'
        union
        select id from account where role in ('admin','owner')
      ) t
    `);
    if (Number(effective?.n ?? 0) <= 1) {
      throw new MemberError('last_admin', 'The last administrator cannot be demoted; grant it to somebody else first.');
    }
  }

  await db.query(`delete from ozikoro_member_role where account_id = $1 and role = $2`, [input.accountId, input.role]);
  await audit(db, {
    entityType: 'ozikoro_member',
    entityId: input.accountId,
    action: 'revoke_role',
    before: { role: input.role },
    actorId: input.actorId,
  });
}

export async function setMemberStatus(
  db: Db,
  input: { accountId: number; status: OzikoroMember['status']; actorId: number | null }
): Promise<void> {
  await ensureMember(db, input.accountId);
  const before = await db.one<{ status: string }>(`select status from ozikoro_member where account_id = $1`, [input.accountId]);
  await db.query(
    `update ozikoro_member set status = $1, updated_at = now() where account_id = $2`,
    [input.status, input.accountId]
  );
  await audit(db, {
    entityType: 'ozikoro_member',
    entityId: input.accountId,
    action: 'set_status',
    before: { status: before?.status ?? null },
    after: { status: input.status },
    actorId: input.actorId,
  });
}

/** Update the profile fields the person owns. */
export async function updateMemberProfile(
  db: Db,
  input: {
    accountId: number;
    displayName?: string | null;
    headline?: string | null;
    bio?: string | null;
    institution?: string | null;
    department?: string | null;
    orcid?: string | null;
    website?: string | null;
    researchInterests?: string[];
    isPublic?: boolean;
  }
): Promise<void> {
  await ensureMember(db, input.accountId);
  await db.query(
    `update ozikoro_member set
        display_name = coalesce($2, display_name),
        headline = $3,
        bio = $4,
        institution = $5,
        department = $6,
        orcid = $7,
        website = $8,
        research_interests = coalesce($9, research_interests),
        is_public = coalesce($10, is_public),
        updated_at = now()
      where account_id = $1`,
    [
      input.accountId,
      input.displayName ?? null,
      input.headline ?? null,
      input.bio ?? null,
      input.institution ?? null,
      input.department ?? null,
      input.orcid ?? null,
      input.website ?? null,
      input.researchInterests ?? null,
      input.isPublic ?? null,
    ]
  );
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listMembers(
  db: Db,
  options: { role?: OzikoroRole | null; search?: string | null; limit?: number } = {}
): Promise<OzikoroMember[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.role) {
    params.push(options.role);
    conditions.push(`exists (select 1 from ozikoro_member_role r where r.account_id = m.account_id and r.role = $${params.length})`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(coalesce(m.display_name, a.display_name, a.email) ilike $${params.length} or a.email ilike $${params.length})`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  params.push(Math.min(Math.max(options.limit ?? 50, 1), 200));

  const rows = await db.rows<{ account_id: string }>(
    `select m.account_id from ozikoro_member m join account a on a.id = m.account_id
      ${where} order by m.created_at desc limit $${params.length}`,
    params
  );

  const members: OzikoroMember[] = [];
  for (const row of rows) {
    const member = await getMember(db, Number(row.account_id));
    if (member) members.push(member);
  }
  return members;
}

// ---------------------------------------------------------------------------
// Claiming a migrated byline
// ---------------------------------------------------------------------------

export interface ContributorClaim {
  id: number;
  contributorId: number;
  contributorName: string;
  contributorSlug: string;
  articleCount: number;
  accountId: number;
  accountEmail: string;
  evidence: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  /** When it was decided, and by whom. Null while a claim is still waiting. */
  decidedAt: string | null;
  decidedBy: number | null;
  decisionNote: string | null;
}

/**
 * Ask to be recognised as the person behind a byline.
 *
 * Deliberately a request and not a self-service link. The archive is about specific people's work,
 * and a name is neither unique nor secret, so only a human can decide whether a claim is true.
 */
export async function requestContributorClaim(
  db: Db,
  input: { contributorId: number; accountId: number; evidence?: string | null }
): Promise<void> {
  const contributor = await db.one<{ id: string; account_id: string | null }>(
    `select id, account_id from ozikoro_contributor where id = $1`,
    [input.contributorId]
  );
  if (!contributor) throw new MemberError('no_contributor', 'That byline does not exist.');
  if (contributor.account_id !== null) {
    throw new MemberError('already_claimed', 'That byline has already been claimed.');
  }

  const existing = await db.one<{ status: string }>(
    `select status from ozikoro_contributor_claim where contributor_id = $1 and account_id = $2`,
    [input.contributorId, input.accountId]
  );
  if (existing?.status === 'pending') throw new MemberError('already_pending', 'That claim is already waiting for review.');
  if (existing?.status === 'approved') throw new MemberError('already_claimed', 'That byline has already been claimed.');

  await db.query(
    `insert into ozikoro_contributor_claim (contributor_id, account_id, evidence)
     values ($1, $2, $3)
     on conflict (contributor_id, account_id) do update
       set evidence = excluded.evidence, status = 'pending', decided_by = null, decided_at = null, decision_note = null`,
    [input.contributorId, input.accountId, input.evidence ?? null]
  );
}

export async function listContributorClaims(
  db: Db,
  options: { status?: 'pending' | 'approved' | 'rejected' | null; limit?: number } = {}
): Promise<ContributorClaim[]> {
  const params: unknown[] = [];
  let where = '';
  if (options.status) {
    params.push(options.status);
    where = `where c.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(options.limit ?? 50, 1), 200));

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.contributor_id, c.account_id, c.evidence, c.status, c.created_at,
            c.decided_at, c.decided_by, c.decision_note,
            k.display_name as contributor_name, k.slug as contributor_slug,
            a.email as account_email,
            (select count(*)::int from ozikoro_article ar where ar.author_id = c.contributor_id) as article_count
       from ozikoro_contributor_claim c
       join ozikoro_contributor k on k.id = c.contributor_id
       join account a on a.id = c.account_id
      ${where}
      order by c.created_at desc limit $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: Number(r.id),
    contributorId: Number(r.contributor_id),
    contributorName: String(r.contributor_name),
    contributorSlug: String(r.contributor_slug),
    articleCount: Number(r.article_count ?? 0),
    accountId: Number(r.account_id),
    accountEmail: String(r.account_email),
    evidence: r.evidence ? String(r.evidence) : null,
    status: String(r.status) as ContributorClaim['status'],
    createdAt: new Date(String(r.created_at)).toISOString(),
    decidedAt: r.decided_at === null || r.decided_at === undefined ? null : new Date(String(r.decided_at)).toISOString(),
    decidedBy: r.decided_by === null || r.decided_by === undefined ? null : Number(r.decided_by),
    decisionNote: r.decision_note ? String(r.decision_note) : null,
  }));
}

/**
 * Decide a claim.
 *
 * Approving links the byline to the account, which is the whole point: the 1,051 migrated records
 * then credit a person who can sign in and answer for them.
 */
export async function decideContributorClaim(
  db: Db,
  input: { claimId: number; approve: boolean; actorId: number | null; note?: string | null }
): Promise<void> {
  const claim = await db.one<{ contributor_id: string; account_id: string; status: string }>(
    `select contributor_id, account_id, status from ozikoro_contributor_claim where id = $1`,
    [input.claimId]
  );
  if (!claim) throw new MemberError('no_claim', 'That claim does not exist.');
  if (claim.status !== 'pending') throw new MemberError('already_decided', 'That claim has already been decided.');

  await db.query(
    `update ozikoro_contributor_claim
        set status = $2, decided_by = $3, decided_at = now(), decision_note = $4
      where id = $1 and status = 'pending'`,
    [input.claimId, input.approve ? 'approved' : 'rejected', input.actorId, input.note ?? null]
  );

  if (input.approve) {
    await db.query(`update ozikoro_contributor set account_id = $1 where id = $2 and account_id is null`, [
      Number(claim.account_id),
      Number(claim.contributor_id),
    ]);
  }

  await audit(db, {
    entityType: 'ozikoro_contributor_claim',
    entityId: input.claimId,
    action: input.approve ? 'approve_claim' : 'reject_claim',
    after: { contributorId: Number(claim.contributor_id), accountId: Number(claim.account_id) },
    actorId: input.actorId,
    note: input.note ?? null,
  });
}

/** The bylines an account can ask to own, for the claim screen. */
export async function listClaimableBylines(
  db: Db,
  accountId: number
): Promise<{ id: number; name: string; slug: string; articleCount: number; claimStatus: string | null }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select k.id, k.display_name as name, k.slug,
            (select count(*)::int from ozikoro_article ar where ar.author_id = k.id) as article_count,
            (select status from ozikoro_contributor_claim c where c.contributor_id = k.id and c.account_id = $1) as claim_status
       from ozikoro_contributor k
      where k.account_id is null
      order by article_count desc, k.display_name
      limit 100`,
    [accountId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    articleCount: Number(r.article_count ?? 0),
    claimStatus: r.claim_status ? String(r.claim_status) : null,
  }));
}

/** The account a byline belongs to, so an article can show its author as a person with a profile. */
export async function getContributorAccount(db: Db, contributorId: number): Promise<number | null> {
  const row = await db.one<{ account_id: string | null }>(
    `select account_id from ozikoro_contributor where id = $1`,
    [contributorId]
  );
  return row?.account_id === null || row?.account_id === undefined ? null : Number(row.account_id);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function audit(
  db: Db,
  event: {
    entityType: string;
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  // Recording history must never be the reason an action fails, for the same reason it must never
  // be the reason one succeeds silently: it is a record, not a gate.
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType,
        event.entityId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/members] could not record audit event:', String(error).slice(0, 160));
  }
}
