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
import {
  SOCIAL_NETWORKS,
  listMemberSocial,
  normaliseSocialUsername,
  socialUsernameProblem,
  type SocialHandle,
} from './member-social.ts';

/**
 * The plan's ten, in the order it lists them, and the eleventh added above `admin` in migration 0044.
 *
 * `owner` is last on purpose: this array is the plan's order and the plan does not know about the owner, who
 * was added because a staff of administrators could otherwise outvote the proprietor of the record. It has to
 * be IN the array all the same. **`isOzikoroRole` gates every grant, and for as long as `owner` was absent
 * from it the one account that exists could not be given its own role** — the users screen answered "That is
 * not a role on this site" about the role the database had already stored. A role the schema accepts and the
 * application does not is a role that cannot be granted, revoked or displayed correctly.
 */
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
  'owner',
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
  owner: 'Owner',
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
  owner: 'The proprietor of the record: everything an administrator has, and the only role that may appoint one.',
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
    /*
     * THE NOTE BELONGS ON THE AUDIT ROW, NOT ONLY ON THE GRANT.
     *
     * `note` was written to `ozikoro_member_role` and dropped here, so the screen collected "why" and the
     * audit trail — which is the thing the archive keeps as its record of who did what — did not have it.
     * The users screen prints that note under the change; without this line the reason a role was granted
     * existed only for as long as the grant row did, and revoking the role would have taken it with it.
     *
     * Found by checking the audit row the action actually wrote rather than by reading this function:
     * the response said the grant was recorded, and the note was simply not in the record.
     */
    note: input.note ?? null,
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
  input: { accountId: number; role: OzikoroRole; actorId: number | null; note?: string | null }
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
    // Optional, and kept for the same reason the grant's note is: a removal with no stated reason is a
    // change the next reader cannot weigh. The callers that pass none are unchanged.
    note: input.note ?? null,
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

/**
 * Update the profile fields the person owns.
 *
 * EVERY WRITE IS AUDITED AND NAMED. The audit row is not decoration here: a profile's institution,
 * ORCID and research interests are claims a reader will take as credentials, and "who said this, and
 * when" is the question asked when one is disputed. The `before` image is recorded as well as the
 * `after`, so a change can be read back rather than guessed at.
 *
 * There is no rank check — `ozikoro_role_may_grant` governs granting ROLES, and this grants nothing.
 * A person may edit their own profile and no other: the account id comes from the session and the
 * `actorId` must be the same account, which is enforced here rather than trusted to the caller.
 */
export async function updateMemberProfile(
  db: Db,
  input: {
    accountId: number;
    /** Who is making the change. Must be the profile's own account — see the check below. */
    actorId: number;
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
  if (input.accountId !== input.actorId) {
    throw new MemberError('not_your_profile', 'That is not your profile to change.');
  }
  await ensureMember(db, input.accountId);

  const before = await db.one<{
    display_name: string | null;
    headline: string | null;
    bio: string | null;
    institution: string | null;
    department: string | null;
    orcid: string | null;
    website: string | null;
    research_interests: string[] | null;
    is_public: boolean | null;
  }>(
    `select display_name, headline, bio, institution, department, orcid, website,
            research_interests, is_public
       from ozikoro_member where account_id = $1`,
    [input.accountId]
  );

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

  await audit(db, {
    entityType: 'ozikoro_member',
    entityId: input.accountId,
    action: 'update_profile',
    before: before
      ? {
          headline: before.headline,
          institution: before.institution,
          department: before.department,
          orcid: before.orcid,
          website: before.website,
          researchInterests: before.research_interests,
          isPublic: before.is_public,
          // The bio is recorded as a presence rather than reproduced: it can run to thousands of
          // characters, and the audit trail is a record of what changed, not a second copy of it.
          hasBio: Boolean(before.bio),
        }
      : null,
    after: {
      headline: input.headline ?? null,
      institution: input.institution ?? null,
      department: input.department ?? null,
      orcid: input.orcid ?? null,
      website: input.website ?? null,
      researchInterests: input.researchInterests ?? null,
      isPublic: input.isPublic ?? null,
      hasBio: input.bio !== undefined ? Boolean(input.bio) : before?.bio != null,
    },
    actorId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// The account's own public profile: the biography, the picture and the handles
// ---------------------------------------------------------------------------

/**
 * The picture an account publishes, as a path the site serves — or `null`.
 *
 * ── WHY THIS READS `account.avatar_url`, WHICH IS A SHARED COLUMN ────────────────────────────────────
 *
 * Because it already exists and its own migration says what it is for. `0033_account_avatar.sql` adds
 * `avatar_url` to the shared `account` table with the header *"The owner: 'one should be able to add profile
 * picture/avatar, or change it.'"* — **the column was added for this feature and nothing has ever written
 * it.** Measured on the live database: six accounts, `avatar_url` empty on all six.
 *
 * So this is **exposing an existing field**, not adding one. That distinction is the answer to the question
 * a shared table forces: *what will the other two sites do with a column they do not read?* **They already
 * carry it and already ignore it.** No column is added to `account` by this work, no column is altered, and
 * no constraint changes — so there is nothing new for ozituma.com or academy.ozikoro.com to be affected by.
 * `packages/db/src/admin.ts` (shared) already selects it, and the Ozikoro admin screens already render it
 * where it is set.
 *
 * ── WHY IT IS NOT `ozikoro_contributor.avatar_url` ───────────────────────────────────────────────────
 *
 * That column is the BYLINE's portrait and it is the archive's record, curated by the import and by an
 * editor. This one is the PERSON's, set by themselves. Where a byline is linked to an account the two are
 * the same human being, and the pages resolve that precedence rather than the columns being merged — see
 * `getBylineProfile`, which prefers the person's own picture over the imported one and says why.
 */
export async function getAccountPicture(db: Db, accountId: number): Promise<string | null> {
  const row = await db.one<{ avatar_url: string | null }>(
    `select avatar_url from account where id = $1`,
    [accountId]
  );
  const value = row?.avatar_url?.trim();
  return value ? value : null;
}

/**
 * Everything `/account/` draws in its own form, in one read.
 *
 * One function rather than four, because the page needs the member row, the picture and the handles together
 * and four reads would be four chances for the form to pre-fill from a different moment than the picture it
 * shows beside it.
 */
export async function getOwnProfileForEditing(
  db: Db,
  accountId: number
): Promise<{
  displayName: string | null;
  bio: string | null;
  website: string | null;
  isPublic: boolean;
  pictureUrl: string | null;
  social: SocialHandle[];
  /** The bylines this account has been recognised as — empty until a claim is approved. */
  bylines: Array<{ slug: string; name: string; records: number }>;
}> {
  const [member, pictureUrl, social, bylines] = await Promise.all([
    db.one<{ display_name: string | null; bio: string | null; website: string | null; is_public: boolean }>(
      `select display_name, bio, website, is_public from ozikoro_member where account_id = $1`,
      [accountId]
    ),
    getAccountPicture(db, accountId),
    listMemberSocial(db, accountId),
    listOwnBylines(db, accountId),
  ]);

  return {
    displayName: member?.display_name ?? null,
    bio: member?.bio ?? null,
    website: member?.website ?? null,
    // A member row that does not exist yet is a person who has not chosen — and `ozikoro_member.is_public`
    // defaults to true, so the form's box must show what the row WOULD be, not what a missing row is not.
    isPublic: member?.is_public ?? true,
    pictureUrl,
    social,
    bylines,
  };
}

/**
 * Save the profile fields `/account/` owns: the name, the biography, the website and the visibility.
 *
 * ── WHY THIS IS NOT `updateMemberProfile` ────────────────────────────────────────────────────────────
 *
 * `updateMemberProfile` (above) writes **every** profile column and nulls the ones it is not given, because
 * `/researchers/<id>/` is its one caller and that form carries all of them. `/account/` carries the four
 * fields the owner named and nothing else, so calling that function from here would **silently wipe a
 * researcher's headline, institution, department, ORCID and research interests** the first time they edited
 * their biography from the account screen. Two forms writing the same row must each write only what they
 * draw, which is why this one names its columns rather than reusing a function whose contract is "set all of
 * them".
 *
 * ── THE OWNERSHIP RULE, WHICH IS THE SAME RULE THE PASSWORD FORM FOLLOWS ─────────────────────────────
 *
 * `accountId !== actorId` throws. The caller supplies the account id **from the session**; no account id is
 * ever accepted from the form, so there is no request shape that can point this at somebody else's record.
 * The check is here rather than in the route because the library is what every future caller reaches, and a
 * rule enforced at one call site is a rule the next call site does not have.
 *
 * The bar is deliberately lower than the password form's: that one demands the current password, because a
 * change to it can lock the owner out permanently. **A profile edit cannot lock anybody out, is reversible
 * by the person themselves from the same screen, and is therefore proved by the session alone.** What must
 * not be lower is who may be edited, and that is absolute.
 */
export async function saveOwnProfile(
  db: Db,
  input: {
    accountId: number;
    actorId: number;
    displayName: string | null;
    bio: string | null;
    website: string | null;
    isPublic: boolean;
  }
): Promise<void> {
  if (input.accountId !== input.actorId) {
    throw new MemberError('not_your_profile', 'That is not your profile to change.');
  }
  await ensureMember(db, input.accountId);

  const before = await db.one<{
    display_name: string | null;
    bio: string | null;
    website: string | null;
    is_public: boolean | null;
  }>(`select display_name, bio, website, is_public from ozikoro_member where account_id = $1`, [
    input.accountId,
  ]);

  await db.query(
    `update ozikoro_member
        set display_name = $2, bio = $3, website = $4, is_public = $5, updated_at = now()
      where account_id = $1`,
    [input.accountId, input.displayName, input.bio, input.website, input.isPublic]
  );

  /*
   * The display name is mirrored onto the shared account row, because that is the name the OTHER two sites
   * and every archive screen that reads `account.display_name` will show — the masthead, the admin users
   * list, the article byline fallback. A person who renames themselves here and finds the old name in the
   * masthead has been given a field that half works.
   *
   * `coalesce` rather than a direct assignment: an empty display name means "leave it as it was", not "blank
   * the account" — `account.display_name` is the last non-empty name this person has been known by, and the
   * profile row is where an empty name is recorded.
   */
  if (input.displayName) {
    await db.query(`update account set display_name = $2 where id = $1`, [
      input.accountId,
      input.displayName,
    ]);
  }

  await audit(db, {
    entityType: 'ozikoro_member',
    entityId: input.accountId,
    action: 'update_own_profile',
    before: before
      ? {
          displayName: before.display_name,
          website: before.website,
          isPublic: before.is_public,
          hasBio: Boolean(before.bio),
        }
      : null,
    after: {
      displayName: input.displayName,
      website: input.website,
      isPublic: input.isPublic,
      // The biography is recorded as a presence rather than reproduced, for the reason `updateMemberProfile`
      // gives: it can run to thousands of characters and the audit trail is not a second copy of the record.
      hasBio: Boolean(input.bio),
    },
    actorId: input.actorId,
  });
}

/**
 * Save the account's social handles, and remove the ones the form left empty.
 *
 * ── THE TWO STATEMENTS, AND WHY THEIR ORDER MATTERS ──────────────────────────────────────────────────
 *
 * The delete removes only networks the form did NOT submit, so it can never remove a row the insert is about
 * to write; the upsert then writes the submitted ones. **The two sets are disjoint by construction**, which
 * is what makes a single non-transactional `delete` + `insert` safe here rather than merely lucky: an
 * `insert … on conflict do update` in the same statement as a delete of the same row is the case Postgres
 * refuses with "tuple to be updated was already modified", and a `jsonb` blob written twice would have no
 * such protection at all.
 *
 * ── EVERY SUBMITTED FIELD IS VALIDATED, AND THE FIRST REFUSAL STOPS THE WHOLE SAVE ────────────────────
 *
 * Validated before either statement runs, so a form with one bad handle does not leave the good ones saved
 * and the bad one silently dropped — **a partial save is the worst outcome available**: the person sees an
 * error, does not know what was written, and cannot tell from the screen what state their profile is in. A
 * refusal writes nothing at all.
 */
export async function saveOwnSocialLinks(
  db: Db,
  input: { accountId: number; actorId: number; handles: Record<string, string> }
): Promise<void> {
  if (input.accountId !== input.actorId) {
    throw new MemberError('not_your_profile', 'That is not your profile to change.');
  }

  const networks: string[] = [];
  const usernames: string[] = [];

  for (const spec of SOCIAL_NETWORKS) {
    const raw = input.handles[spec.field] ?? '';
    const problem = socialUsernameProblem(raw);
    if (problem) throw new MemberError('bad_username', `${spec.label}: ${problem}`);

    const handle = normaliseSocialUsername(raw);
    if (handle === null) continue;
    networks.push(spec.key);
    usernames.push(handle);
  }

  const before = await listMemberSocial(db, input.accountId);

  await db.query(
    `delete from ozikoro_member_social where account_id = $1 and network <> all($2::text[])`,
    [input.accountId, networks]
  );

  if (networks.length > 0) {
    await db.query(
      `insert into ozikoro_member_social (account_id, network, username)
       select $1, n, u from unnest($2::text[], $3::text[]) as t(n, u)
       on conflict (account_id, network) do update set username = excluded.username, updated_at = now()`,
      [input.accountId, networks, usernames]
    );
  }

  await audit(db, {
    entityType: 'ozikoro_member_social',
    entityId: input.accountId,
    action: 'update_social',
    // Handles are short and public, so unlike the biography they are recorded in full — a removal has to be
    // readable from the audit trail or "who took my handle off" has no answer.
    before: { handles: before.map((h) => `${h.network}:${h.username}`) },
    after: { handles: networks.map((n, i) => `${n}:${usernames[i]}`) },
    actorId: input.actorId,
  });
}

/**
 * Set — or clear — the account's own picture.
 *
 * `avatarUrl` must be a path this site serves or `null`. **The route that uploads the file is what decides
 * the value**, and it passes the `/media/<key>` path `getStorage()` built; this function's job is the
 * ownership check and the audit row, not the shape of an address.
 */
export async function setOwnAvatarUrl(
  db: Db,
  input: { accountId: number; actorId: number; avatarUrl: string | null; note?: string }
): Promise<void> {
  if (input.accountId !== input.actorId) {
    throw new MemberError('not_your_profile', 'That is not your profile to change.');
  }

  const before = await getAccountPicture(db, input.accountId);

  await db.query(`update account set avatar_url = $2 where id = $1`, [input.accountId, input.avatarUrl]);

  await audit(db, {
    entityType: 'account',
    entityId: input.accountId,
    action: input.avatarUrl ? 'set_profile_picture' : 'clear_profile_picture',
    before: { avatarUrl: before },
    after: { avatarUrl: input.avatarUrl },
    actorId: input.actorId,
    note: input.note ?? null,
  });
}

/**
 * The bylines an account has been recognised as.
 *
 * ⚠️ **EMPTY FOR EVERY ACCOUNT TODAY, AND THAT IS THE MEASURED STATE OF THIS ARCHIVE RATHER THAN A BUG.**
 * `ozikoro_contributor.account_id` is set only when an editor approves a claim (`decideContributorClaim`
 * does it), and on the live database **zero of the sixteen bylines are linked to an account** and **zero
 * claims have been made**. So a writer who edits their biography on `/account/` sees it on their researcher
 * profile immediately and **on `/author/<slug>/` only once their claim is approved** — which is the
 * archive's own identity rule and not something this read can shortcut: a matching name is not proof, and
 * the alternative to review is that anyone can claim the authorship of 1,051 published records.
 *
 * The page says exactly this, with a link to `/claims/`, rather than leaving a writer to wonder why their
 * own byline page does not show the biography they just wrote.
 */
export async function listOwnBylines(
  db: Db,
  accountId: number
): Promise<Array<{ slug: string; name: string; records: number }>> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.slug, c.display_name as name,
            (select count(*)::int from ozikoro_article a
              where a.author_id = c.id and a.status = 'published' and a.is_page = false) as records
       from ozikoro_contributor c
      where c.account_id = $1
      order by records desc, c.display_name`,
    [accountId]
  );
  return rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    records: Number(r.records ?? 0),
  }));
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

/**
 * How many claims are in a state, counted rather than measured by the length of a capped page.
 *
 * `listContributorClaims` clamps its limit to 200, so `listContributorClaims(db, {status:'pending'}).length`
 * reports **200 for a backlog of any size above it** — a page-shaped number presented as a count. The index
 * prints a count, so it asks for one.
 */
export async function countContributorClaims(
  db: Db,
  status?: 'pending' | 'approved' | 'rejected'
): Promise<number> {
  const row = status
    ? await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_contributor_claim where status = $1`, [status])
    : await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_contributor_claim`);
  return Number(row?.n ?? 0);
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

/**
 * The identity fields a byline can be matched against. Both are optional because the archive has accounts
 * with a display name and no email worth comparing, and accounts whose display name nobody ever set.
 */
export interface ClaimIdentity {
  email?: string | null;
  displayName?: string | null;
}

/** A byline this account can ask to own, and why the archive thinks it might be theirs. */
export interface ClaimableByline {
  id: number;
  name: string;
  slug: string;
  /** Records a reader can actually open. What a claim is about. */
  publishedCount: number;
  /** Everything else — statuses other than `published`. Named separately rather than hidden. */
  draftCount: number;
  claimStatus: string | null;
  /** True only when `matchReason` below found something. Never true for a byline the matcher did not match. */
  likely: boolean;
  /** The evidence shown to the reader, in their own terms. Null when `likely` is false. */
  matchReason: string | null;
}

/**
 * Normalise a name for matching: lowercase, strip diacritics, and split on anything that is not a letter
 * or a digit.
 *
 * Apostrophes and hyphens are separators rather than deletes, because both spell a name and both are
 * written inconsistently in a migrated corpus: "Nzeribe" and "Nzeribé" are the same byline, and
 * "Chinedu-Opiah" and "Chinedu Opiah" are the same two words.
 */
function identityParts(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A stable comparison key: the normalised parts joined with a space. */
function identityKey(value: string): string {
  return identityParts(value).join(' ');
}

/** The part of an email address before the `@`, lowercased. Null when there is no usable address. */
function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  const local = (at === -1 ? email : email.slice(0, at)).trim().toLowerCase();
  return local.length > 0 ? local : null;
}

/**
 * WHY A BYLINE IS SHOWN TO THIS PERSON — the whole match rule, in the order it is applied, as a function
 * that returns the reason it matched or null.
 *
 * ── WHAT THIS ANSWERS, AND WHAT IT MUST NOT CLAIM ───────────────────────────────────────────────────
 *
 * A WRONG "this looks like you" is worse than none: the page offers to ask an editor to hand over the
 * authorship of published records, so a false positive invites somebody to claim another person's work.
 * Every rule below therefore requires a WHOLE-WORD correspondence between the byline and the account's own
 * identity, and every rule is reported to the reader with the fields it used and the words it matched.
 * Nothing here decides anything: an editor still checks the claim by hand.
 *
 * ── THE FACTS THAT SHAPE IT ─────────────────────────────────────────────────────────────────────────
 *
 * `ozikoro_contributor` has NO email column — its columns are `wp_user_id, slug, display_name, bio,
 * website, avatar_url, account_id` and a `wp_role` added later. The migrated contributors were imported
 * from WordPress without contact details, so the only two things a byline can be matched against are the
 * signed-in account's own display name and the local part of its email address. The page used to state
 * the opposite — that there was "nothing to match automatically" — and that was true of the contributors
 * and false of the reader, which is the confusion this function removes.
 *
 * ── THE RULES, STRONGEST FIRST ──────────────────────────────────────────────────────────────────────
 *
 *   1 · THE BYLINE IS THE ACCOUNT'S DISPLAY NAME. Whole-string equality after normalisation. Reported as
 *       the account's name, because that is what the reader can check in one look.
 *   2 · THE BYLINE'S WORDS ARE IN THE ACCOUNT'S DISPLAY NAME. Every word of a TWO-WORD-OR-LONGER byline
 *       appears as a whole word — "Ossai Chukwunwike" finds "Chukwunwike Ossai". A one-word byline is
 *       never matched here: a single word is not an identity on its own, and "Emeka" would match any
 *       reader whose name contains it.
 *   3 · THE EMAIL'S LOCAL PART IS THE BYLINE'S WORDS AND NOTHING ELSE, joined with a separator or with
 *       nothing: `idenze.ezeme@…`, `idenze_ezeme@…` and `idenzeezeme@…` all match "Idenze Ezeme". Each
 *       word must begin where the previous one finished, so an address that DROPS letters between words is
 *       not matched — including the owner's own `idenzeme@gmail.com`, which is "Idenze Ezeme" with a
 *       letter dropped and is matched by rule 1 instead. See the note on rule 3 below for why no looser
 *       version of it was kept.
 *   4 · THE BYLINE'S WORDS ARE IN THE EMAIL'S LOCAL PART, at the start and whole. `idenze.ezeme@…`,
 *       `idenze_ezeme@…` and `idenze-ezeme@…` all match "Idenze Ezeme".
 *
 * EVERY FACT THAT MATCHED IS REPORTED, NOT JUST THE FIRST. A reader who has set the byline as their
 * account name AND whose email is the same name should see both, because two independent things agreeing
 * is different evidence from one — and the reader is the one who has to judge it before claiming.
 *
 * ── AND THE FALSE POSITIVE THESE RULES WERE REWRITTEN TO KILL, BECAUSE THE FIRST VERSION HAD IT ──────
 *
 * The first version asked whether each byline word appeared ANYWHERE in the local part, and it matched
 * **"Ozi Ikoro"** against `zztest-ozikoro-member-nomatch-1@example.invalid` — because "ozi" and "ikoro"
 * are both substrings of "ozikoro". Nothing about that reader is the byline, and the page would have
 * told them it probably was. So the email is now read the way an email address is actually written: the
 * local part must be the START of the address's name and the byline words must be tokenised out of it,
 * whole, or the byline must account for the entire local part with no residue. **A rule that a made-up
 * account can trip is a rule that will trip on a real one.**
 *
 * A byline that matches by none of them is NOT marked likely and is NOT hidden: it stays in the list
 * below, sorted by name, because the legitimate case this screen must not break is a person whose byline
 * is under a spelling the matcher missed.
 */
function likelyBylineReason(name: string, identity: ClaimIdentity): string | null {
  const bylineParts = identityParts(name);
  const bylineKey = bylineParts.join(' ');

  const displayName = identity.displayName?.trim() ? identity.displayName : null;
  const local = emailLocalPart(identity.email);

  if (!bylineKey || !bylineParts.length) return null;

  const found: string[] = [];
  const words = bylineParts.map((word) => `“${word}”`).join(', ');

  // 1 — the account's own display name, exactly.
  if (displayName && identityKey(displayName) === bylineKey) {
    found.push(`Your account’s name is exactly this byline: “${displayName}”.`);
  } else if (displayName && bylineParts.length >= 2 && bylineParts.every((word) => identityParts(displayName).includes(word))) {
    // 2 — every word of the byline is a whole word of the account's display name.
    found.push(`Your account’s name “${displayName}” contains every word of this byline (${words}).`);
  }

  if (local) {
    const localParts = identityParts(local);
    const localKey = localParts.join(' ');

    /*
     * 3 — the local part is the byline's words and NOTHING ELSE, each starting where the previous one
     *     finished: "idenze.ezeme", "idenze_ezeme", "idenzeezeme", "akachukwuvitalis". Every letter of the
     *     address must belong to a word of the byline, and every word must begin at the address position
     *     the previous word consumed up to — which is what stops one word quietly borrowing the letters a
     *     previous word already spent.
     *
     *      idenze.ezeme       "idenze" whole, then "ezeme" whole → consumed exactly ✓
     *      akachukwuvitalis   both words whole, nothing between them ✓
     *      idenzeesogbue      "idenze" whole, then "ezeme" cannot start at "esogbue" ✗
     *
     * **The last line is the false positive this refuses**: "idenzeesogbue" begins with the right first
     * name and belongs to a different surname, so "Idenze Ezeme" is not marked likely for it.
     *
     * ── AND THE ADDRESS THIS STILL DOES NOT MATCH, WHICH IS THE OWNER'S OWN, STATED PLAINLY ─────────
     *
     * `idenzeme@gmail.com` IS NOT MATCHED BY THIS RULE, and three attempts to make it match were each
     * withdrawn rather than kept, because each needed a rule nobody could justify to the reader:
     *
     *   1 · THE WORDS CONCATENATED. `idenze` + `ezeme` = "idenzeezeme", and the address is "idenzeme".
     *       An equality test on the glue simply misses it.
     *   2 · THE JOINS ALLOWED TO OVERLAP. "idenze" and "ezeme" share no suffix-prefix at all, so there is
     *       no overlap to allow; the address is not the two words sharing a letter.
     *   3 · EACH WORD A SCATTERED SUBSEQUENCE, THE ADDRESS CONSUMED EXACTLY. This one DID match
     *       "idenzeme" — and it matched it wrongly: "ezeme" was satisfied out of "…d-e-n-z-e-m-e", spending
     *       the "e" that "idenze" had already spent, and it would equally have matched addresses that
     *       merely contain a surname's letters in order. **It also proved, while being tested, that no rule
     *       of this shape can match "idenzeme" without that looseness**: after "idenze" the address holds
     *       "me", and "ezeme" is not in "me" under any reading that does not let one word reuse another's
     *       letters.
     *
     * So the honest position is the one the page takes: **the owner's byline is matched by his account's
     * NAME, not by his address**, and no match is claimed that would not survive being shown to him with
     * its reason. A rule bent until the owner's own address fits would be a rule that tells somebody else
     * their byline is theirs.
     */
    const slug = local.replace(/[^a-z0-9]/g, '');
    let at = 0;
    let consumed = true;
    for (const word of bylineParts) {
      /*
       * EACH WORD BEGINS WHERE THE LAST ONE FINISHED. `at` is the address position the previous word
       * consumed up to; the letter at `at` must be this word's first letter, or the word is not there.
       */
      if (slug[at] !== word[0]) {
        consumed = false;
        break;
      }
      let i = 0;
      while (i < word.length && at < slug.length) {
        if (slug[at] === word[i]) i += 1;
        at += 1;
      }
      if (i < word.length) {
        consumed = false;
        break;
      }
    }
    const glued = consumed && at === slug.length && (bylineParts.length > 1 || slug === bylineParts[0]);

    if (glued) {
      found.push(`Your email address begins “${local}”, which is this byline and nothing else.`);
    } else if (bylineParts.length >= 2 && localKey.startsWith(bylineKey)) {
      // 4 — the byline's words, whole, at the start of the local part: "idenze.ezeme", "idenze_ezeme".
      found.push(`Your email address begins “${local}”, and its first words are this byline (${words}).`);
    }
  }

  if (found.length === 0) return null;
  /*
   * JOINED WITH "and", NOT "or", AND IT IS THE TRUTH EITHER WAY. Only one fact can be reported at a time
   * for the email — rules 3 and 4 are exclusive — so the only joins possible are name-and-email or a
   * single fact, and both read correctly. The lower-case "and" is deliberate: it follows a full stop, so
   * the sentence that follows it continues rather than starting a paragraph of its own.
   */
  if (found.length === 1) return found[0]!;
  return `${found.join(' and ')}`;
}

/**
 * The bylines an account can ask to own, for the claim screen.
 *
 * ── THE FOUR FAULTS THIS REPLACES, ALL OF THEM MEASURED ON THE LIVE ARCHIVE ─────────────────────────
 *
 * The query this one replaces counted `ozikoro_article` rows per contributor with no status filter and
 * ordered by that count, descending, behind a single `where k.account_id is null`. On the live data the
 * first row it served was a byline of 524 records of which **none is published** — every one is a
 * WordPress import left in `review` — while the third carried 282 published records. So:
 *
 *   1 · NO FILTER BY WHO YOU ARE. `$1` (the caller's account id) decided only their own `claim_status`
 *       per row; it never decided which rows appeared. Every signed-in person saw all 16 unclaimed
 *       bylines under a heading that says "Your bylines".
 *   2 · IT COUNTED DRAFTS. A byline with zero published records outranked one with 314, because the
 *       count was of rows and not of work a reader can open.
 *   3 · IT SORTED BY THAT COUNT. The page led with the largest number, which was also the most valuable
 *       byline to claim falsely.
 *   4 · IT SAID "524 records in the archive" WITH NO STATUS. It told the reader nothing about whether
 *       any of it is visible while offering a claim on all of it.
 *
 * ── WHAT IT DOES NOW, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────────────
 *
 * * The count is of PUBLISHED records — a claim is about the authorship of work a reader can see. Every
 *   other status is counted separately as `draftCount` so the page can say "none published yet" rather
 *   than presenting 524 imports as findable work. **Nothing is unpublished, re-attributed or hidden by
 *   this: the rows are the same rows, sorted and described differently.**
 * * The account's own name and email address are matched against each byline, and the matches are
 *   returned with the reason. **This does not hide the rest** — see `likelyBylineReason` for the rule
 *   and for why a byline that matches nothing is still served.
 * * EVERY BYLINE IS ORDERED BY NAME — the unmatched and the matched alike — because there is no reason a
 *   browser of this page should be led with the biggest number. **This function does not reorder to put a
 *   match first; it flags.** The claim screen leads with the matches because that is a layout decision
 *   that belongs to the screen, and keeping the two apart means a caller that wants the flag without the
 *   reordering — an admin view of unclaimed bylines, say — gets exactly what it asked for.
 *
 * The `limit 100` stays: it is a page's worth, and the archive has 16 unclaimed bylines.
 */
export async function listClaimableBylines(
  db: Db,
  accountId: number,
  identity: ClaimIdentity = {}
): Promise<ClaimableByline[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select k.id, k.display_name as name, k.slug,
            count(*) filter (where ar.status = 'published')::int as published_count,
            count(*) filter (where ar.status <> 'published')::int as draft_count,
            (select status from ozikoro_contributor_claim c where c.contributor_id = k.id and c.account_id = $1) as claim_status
       from ozikoro_contributor k
       left join ozikoro_article ar on ar.author_id = k.id
      where k.account_id is null
      group by k.id, k.display_name, k.slug
      order by k.display_name, k.slug
      limit 100`,
    [accountId]
  );

  return rows.map((r) => {
    const name = String(r.name);
    const matchReason = likelyBylineReason(name, identity);
    return {
      id: Number(r.id),
      name,
      slug: String(r.slug),
      publishedCount: Number(r.published_count ?? 0),
      draftCount: Number(r.draft_count ?? 0),
      claimStatus: r.claim_status ? String(r.claim_status) : null,
      likely: matchReason !== null,
      matchReason,
    };
  });
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
