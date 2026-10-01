/**
 * What an administrator can do, in one place.
 *
 * The owner: "an admin should be able to edit, delete, add and edit any part of the
 * website from the admin. I believe if you check the cpanel access i gave you, you
 * could see the functions of admin from the wordpress framework used on ozikoro.com,
 * then be able to grasp the idea of what an admin can do and is."
 *
 * He is describing what WordPress's admin is: one screen from which every object on
 * the site — users, posts, pages, media, taxonomy — can be created, changed, hidden
 * or removed, without going through anybody. Ozituma had a dashboard that only counted
 * things, so the owner could see that 221 clans existed and not rename one of them.
 *
 * This is that missing half, and it is written with the same rule the rest of this
 * repository uses for anything destructive: say exactly what will be removed, remove
 * only that, and keep the reason.
 *
 * WHY SOME OF IT IS A SOFT ACTION
 *
 * Deleting a word, a name or a clan removes rows other things point at, and a reader
 * may arrive from a link somebody shared. So there are two operations and they are
 * named honestly: `hide` (unpublish — reversible, the page 404s to the public and the
 * row and its material stay) and `delete` (gone, with what it held reported back).
 * An administrator who wants something gone gets it gone; an administrator who wants
 * something out of sight does not have to destroy it to get there.
 */
import type { Db } from './client.ts';
import { assertPasswordAcceptable, hashPassword } from './accounts.ts';

export class AdminError extends Error {
  override readonly name = 'AdminError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

import type { AccountRole } from './accounts.ts';

// Re-exported so a caller working with this module does not have to reach into
// accounts.ts for the type of a value this module returns.
export type { AccountRole };

const ROLES: AccountRole[] = ['contributor', 'editor', 'admin', 'owner'];

export interface AdminAccountRow {
  id: number;
  email: string;
  displayName: string | null;
  role: AccountRole;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  contributions: number;
  /** The picture URL, or null. The interface draws initials when it is null. */
  avatarUrl: string | null;
}

/** Every account, with how much each has contributed, for the admin table. */
export async function listAccountsForAdmin(db: Db): Promise<AdminAccountRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select a.id, a.email, a.display_name, a.role, a.status, a.created_at, a.last_login_at, a.avatar_url,
            (select count(*) from suggestion s where s.submitted_by = a.id)::int as contributions
       from account a
      order by case a.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end,
               lower(a.email)`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.role) as AccountRole,
    status: String(row.status),
    createdAt: String(row.created_at),
    lastLoginAt: (row.last_login_at as string | null) ?? null,
    contributions: Number(row.contributions ?? 0),
    avatarUrl: (row.avatar_url as string | null) ?? null,
  }));
}

/**
 * Create an account for somebody.
 *
 * An administrator sets the first password and passes it on — which is what WordPress
 * does when it emails a reset link, minus the email, because this site cannot
 * guarantee a message arrives. The account's owner changes it from their own page the
 * moment they sign in, and the audit trail records that an administrator set it.
 */
export async function createAccountAsAdmin(
  db: Db,
  input: { email: string; password: string; role?: AccountRole; displayName?: string | null }
): Promise<{ id: number; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminError('invalid_email', 'That does not look like an email address.');
  }
  const role: AccountRole = ROLES.includes(input.role as AccountRole)
    ? (input.role as AccountRole)
    : 'contributor';
  assertPasswordAcceptable(input.password, email);

  const existing = await db.one<{ id: string }>(
    `select id from account where lower(email) = lower($1)`,
    [email]
  );
  if (existing) throw new AdminError('email_taken', 'An account with that email already exists.');

  const passwordHash = await hashPassword(input.password);
  const row = await db.one<{ id: string }>(
    `insert into account (email, display_name, password_hash, role)
     values ($1, $2, $3, $4) returning id`,
    [email, input.displayName?.trim() || null, passwordHash, role]
  );
  if (!row) throw new AdminError('internal', 'Could not create that account.');

  await db.query(
    `insert into password_change (account_id, changed_by, actor_id)
     values ($1, 'admin', null)`,
    [Number(row.id)]
  );
  return { id: Number(row.id), email };
}

/**
 * Change what an account may do, or whether it may sign in.
 *
 * Two refusals, both about not sawing off the branch: an administrator cannot demote
 * themselves out of the role that lets them undo it, and the owner cannot be demoted
 * by an administrator, because ownership is a fact about the project rather than a
 * permission inside it.
 */
export async function updateAccountAsAdmin(
  db: Db,
  input: {
    accountId: number;
    actorId: number;
    actorRole: AccountRole;
    role?: AccountRole;
    status?: 'active' | 'suspended';
  }
): Promise<AdminAccountRow> {
  const target = await db.one<Record<string, unknown>>(
    `select id, email, role from account where id = $1`,
    [input.accountId]
  );
  if (!target) throw new AdminError('no_account', 'That account no longer exists.');
  const targetRole = String(target.role) as AccountRole;

  if (input.role && !ROLES.includes(input.role)) {
    throw new AdminError('bad_role', 'That is not a role this site has.');
  }
  if (targetRole === 'owner' && input.actorRole !== 'owner') {
    throw new AdminError('owner_protected', 'The owner’s role is not an administrator’s to change.');
  }
  if (input.accountId === input.actorId && input.role && input.role !== targetRole) {
    throw new AdminError(
      'self_demotion',
      'You cannot change your own role — ask the owner, or another administrator.'
    );
  }
  if (input.accountId === input.actorId && input.status === 'suspended') {
    throw new AdminError('self_suspend', 'You cannot suspend your own account.');
  }

  await db.query(
    `update account
        set role = coalesce($2, role),
            status = coalesce($3, status),
            updated_at = now()
      where id = $1`,
    [input.accountId, input.role ?? null, input.status ?? null]
  );

  // Suspending must take effect now, not when a session happens to expire.
  if (input.status === 'suspended') {
    await db.query(
      `update auth_session set revoked_at = now() where account_id = $1 and revoked_at is null`,
      [input.accountId]
    );
  }

  const rows = await listAccountsForAdmin(db);
  const updated = rows.find((row) => row.id === input.accountId);
  if (!updated) throw new AdminError('internal', 'That account could not be read back.');
  return updated;
}

/** Delete an account outright. Its submissions and recordings survive, unattributed. */
export async function deleteAccountAsAdmin(
  db: Db,
  input: { accountId: number; actorId: number; actorRole: AccountRole }
): Promise<{ email: string }> {
  const target = await db.one<Record<string, unknown>>(
    `select id, email, role from account where id = $1`,
    [input.accountId]
  );
  if (!target) throw new AdminError('no_account', 'That account no longer exists.');
  if (input.accountId === input.actorId) {
    throw new AdminError('self_delete', 'You cannot delete your own account.');
  }
  if (String(target.role) === 'owner') {
    throw new AdminError('owner_protected', 'The owner’s account cannot be deleted.');
  }
  if (String(target.role) === 'admin' && input.actorRole !== 'owner') {
    throw new AdminError(
      'admin_protected',
      'Only the owner can delete another administrator. Suspend them instead.'
    );
  }

  await db.query(`delete from account where id = $1`, [input.accountId]);
  return { email: String(target.email) };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type ContentKind = 'word' | 'name' | 'clan' | 'proverb';

export interface ContentRow {
  kind: ContentKind;
  id: number;
  title: string;
  subtitle: string | null;
  status: string;
  url: string;
}

/**
 * Search every kind of entry from one box.
 *
 * This is the part that makes the admin a place to work rather than a place to look:
 * one query finds a word, a name, a clan or a proverb, and each result carries the URL
 * of its public page — which is where its edit form is, because every entry already has
 * one and an administrator's edits apply the moment they are submitted.
 */
export async function searchContent(
  db: Db,
  query: string,
  limit = 40
): Promise<ContentRow[]> {
  const pattern = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const out: ContentRow[] = [];

  const [words, names, clans, proverbs] = await Promise.all([
    db.rows<Record<string, unknown>>(
      // word carries language_code directly, and language is keyed by code — there is
      // no numeric language id on either table.
      `select w.id, w.headword, w.slug, w.status, w.language_code as language,
              (select d.text from definition d where d.word_id = w.id order by d.position limit 1) as gloss
         from word w
        where w.headword ilike $1 or w.exact_form ilike $1
        order by w.headword limit $2`,
      [pattern, limit]
    ),
    db.rows<Record<string, unknown>>(
      `select n.id, n.name, n.slug, n.status, n.meaning
         from person_name n
        where n.name ilike $1 or n.meaning ilike $1
        order by n.name limit $2`,
      [pattern, limit]
    ),
    db.rows<Record<string, unknown>>(
      `select c.id, c.name, c.slug, c.published, c.kind, t.name as division
         from clan c left join tribe t on t.id = c.tribe_id
        where c.name ilike $1
        order by c.name limit $2`,
      [pattern, limit]
    ),
    db.rows<Record<string, unknown>>(
      `select e.id, e.text, e.status, e.translation
         from example e
        where e.style = 'proverb' and e.text ilike $1
        order by e.text limit $2`,
      [pattern, limit]
    ),
  ]);

  for (const row of words) {
    out.push({
      kind: 'word',
      id: Number(row.id),
      title: String(row.headword),
      subtitle: (row.gloss as string | null) ?? null,
      status: String(row.status),
      url: `/word/${String(row.language)}/${String(row.slug)}`,
    });
  }
  for (const row of names) {
    out.push({
      kind: 'name',
      id: Number(row.id),
      title: String(row.name),
      subtitle: (row.meaning as string | null) ?? null,
      status: String(row.status),
      url: `/names/${String(row.slug)}`,
    });
  }
  for (const row of clans) {
    out.push({
      kind: 'clan',
      id: Number(row.id),
      title: String(row.name),
      subtitle: [row.division, row.kind].filter(Boolean).join(' · ') || null,
      status: row.published ? 'published' : 'hidden',
      url: `/clans/${String(row.slug)}`,
    });
  }
  for (const row of proverbs) {
    out.push({
      kind: 'proverb',
      id: Number(row.id),
      title: String(row.text).split('\n')[0]!.slice(0, 70),
      subtitle: (row.translation as string | null) ?? null,
      status: String(row.status),
      url: `/proverbs`,
    });
  }
  return out;
}

export interface DeleteReport {
  kind: ContentKind;
  title: string;
  /** What went with it, so the administrator is told rather than surprised. */
  removed: string[];
}

/**
 * Remove an entry, or take it out of sight.
 *
 * `hide` is the default the interface offers, because it is reversible and it is
 * almost always what is wanted; `delete` is here because the owner asked for an admin
 * that can delete, and an admin that cannot is not one.
 */
export async function removeContent(
  db: Db,
  input: { kind: ContentKind; id: number; mode: 'hide' | 'delete' }
): Promise<DeleteReport> {
  const { kind, id, mode } = input;

  if (kind === 'word') {
    const row = await db.one<{ headword: string; status: string }>(
      `select headword, status from word where id = $1`,
      [id]
    );
    if (!row) throw new AdminError('not_found', 'No entry with that id.');
    if (mode === 'hide') {
      await db.query(`update word set status = 'draft', updated_at = now() where id = $1`, [id]);
      return { kind, title: row.headword, removed: ['hidden from the dictionary'] };
    }
    const counts = await db.one<Record<string, unknown>>(
      `select (select count(*) from definition where word_id = $1)::int as definitions,
              (select count(*) from example_word where word_id = $1)::int as examples,
              (select count(*) from audio where word_id = $1)::int as audio`,
      [id]
    );
    await db.query(`delete from word where id = $1`, [id]);
    return {
      kind,
      title: row.headword,
      removed: [
        `${Number(counts?.definitions ?? 0)} meanings`,
        `${Number(counts?.examples ?? 0)} example links`,
        `${Number(counts?.audio ?? 0)} recordings left pointing at nothing`,
      ],
    };
  }

  if (kind === 'name') {
    const row = await db.one<{ name: string }>(`select name from person_name where id = $1`, [id]);
    if (!row) throw new AdminError('not_found', 'No name with that id.');
    if (mode === 'hide') {
      await db.query(`update person_name set status = 'draft' where id = $1`, [id]);
      return { kind, title: row.name, removed: ['hidden from the names list'] };
    }
    await db.query(`delete from person_name where id = $1`, [id]);
    return { kind, title: row.name, removed: ['the name and its origins'] };
  }

  if (kind === 'clan') {
    const row = await db.one<{ name: string }>(`select name from clan where id = $1`, [id]);
    if (!row) throw new AdminError('not_found', 'No clan with that id.');
    if (mode === 'hide') {
      await db.query(`update clan set published = false, updated_at = now() where id = $1`, [id]);
      return { kind, title: row.name, removed: ['hidden from the registry'] };
    }
    const towns = await db.one<{ n: number }>(
      `select count(*)::int as n from clan_town where clan_id = $1`,
      [id]
    );
    const children = await db.one<{ n: number }>(
      `select count(*)::int as n from clan where parent_id = $1`,
      [id]
    );
    await db.query(`delete from clan where id = $1`, [id]);
    return {
      kind,
      title: row.name,
      removed: [
        `${Number(towns?.n ?? 0)} towns`,
        `${Number(children?.n ?? 0)} entries that named it as their parent are now unparented`,
      ],
    };
  }

  const row = await db.one<{ text: string }>(`select text from example where id = $1`, [id]);
  if (!row) throw new AdminError('not_found', 'No proverb with that id.');
  if (mode === 'hide') {
    await db.query(`update example set status = 'draft' where id = $1`, [id]);
    return { kind, title: row.text.slice(0, 40), removed: ['hidden from the proverbs'] };
  }
  await db.query(`delete from example where id = $1`, [id]);
  return { kind, title: row.text.slice(0, 40), removed: ['the proverb and its English'] };
}

// ---------------------------------------------------------------------------
// Browsing every section
// ---------------------------------------------------------------------------

export type SectionKey = 'words' | 'names' | 'clans' | 'proverbs' | 'recordings' | 'submissions';

export interface SectionSummary {
  key: SectionKey;
  label: string;
  /** What the section holds. */
  total: number;
  /** The part of it a reader can see. */
  live: number;
  /** One line on what the section is, for the dashboard card. */
  note: string;
}

/**
 * Every section, counted.
 *
 * The owner: "on the admin, I should be able to see everything, including sections
 * emulating wordpress open source where i can see everything, edit and feel good about the
 * dashboard, like a real dashboard."
 *
 * A dashboard that only counts is a report. This is the index of what can be opened: each
 * section with how much is in it and how much of that is live, and each one leads to a list
 * where any entry can be opened, hidden or deleted.
 */
export async function listSections(db: Db): Promise<SectionSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select
       (select count(*) from word)::int as words,
       (select count(*) from word where status = 'published')::int as words_live,
       (select count(*) from person_name)::int as names,
       (select count(*) from person_name where status = 'published')::int as names_live,
       (select count(*) from clan)::int as clans,
       (select count(*) from clan where published)::int as clans_live,
       (select count(*) from example where style = 'proverb')::int as proverbs,
       (select count(*) from example where style = 'proverb' and status = 'published')::int as proverbs_live,
       (select count(*) from audio)::int as recordings,
       (select count(*) from audio where status = 'published')::int as recordings_live,
       (select count(*) from suggestion)::int as submissions,
       (select count(*) from suggestion where status = 'pending')::int as submissions_live`
  );
  const r = rows[0] ?? {};
  const num = (key: string) => Number(r[key] ?? 0);
  return [
    { key: 'words', label: 'Dictionary entries', total: num('words'), live: num('words_live'),
      note: 'Headwords with their meanings, examples and recordings.' },
    { key: 'names', label: 'Names', total: num('names'), live: num('names_live'),
      note: 'Personal names with their meanings, gender and varieties.' },
    { key: 'clans', label: 'Clans and towns', total: num('clans'), live: num('clans_live'),
      note: 'The registry: divisions, clans and the towns inside them.' },
    { key: 'proverbs', label: 'Proverbs', total: num('proverbs'), live: num('proverbs_live'),
      note: 'The proverbs and the English they carry, where a source printed one.' },
    { key: 'recordings', label: 'Recordings', total: num('recordings'), live: num('recordings_live'),
      note: 'Every clip, whether it is on a word, a name or a sentence.' },
    { key: 'submissions', label: 'Submissions', total: num('submissions'), live: num('submissions_live'),
      note: 'What people have sent in. The live count is what is still waiting.' },
  ];
}

export interface SectionPage {
  key: SectionKey;
  label: string;
  rows: ContentRow[];
  total: number;
  page: number;
  pages: number;
}

const PAGE_SIZE = 50;

/**
 * One page of a section, newest first.
 *
 * Paged because these are thousands of rows: the words section alone is sixteen thousand,
 * and a dashboard that tries to draw all of them is a dashboard nobody can use. Fifty is
 * enough to work down a list and few enough to arrive quickly.
 */
export async function listSection(
  db: Db,
  key: SectionKey,
  page = 1
): Promise<SectionPage> {
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const label =
    (await listSections(db)).find((section) => section.key === key)?.label ?? key;

  if (key === 'words') {
    const [rows, count] = await Promise.all([
      db.rows<Record<string, unknown>>(
        `select w.id, w.headword, w.slug, w.status, w.language_code,
                (select d.text from definition d where d.word_id = w.id order by d.position limit 1) as gloss
           from word w order by w.created_at desc, w.id desc limit $1 offset $2`,
        [PAGE_SIZE, offset]
      ),
      db.one<{ n: number }>(`select count(*)::int as n from word`),
    ]);
    return {
      key, label, total: Number(count?.n ?? 0), page,
      pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
      rows: rows.map((row) => ({
        kind: 'word' as const, id: Number(row.id), title: String(row.headword),
        subtitle: (row.gloss as string | null) ?? null, status: String(row.status),
        url: `/word/${String(row.language_code)}/${String(row.slug)}`,
      })),
    };
  }

  if (key === 'names') {
    const [rows, count] = await Promise.all([
      db.rows<Record<string, unknown>>(
        `select id, name, slug, status, meaning from person_name
          order by created_at desc, id desc limit $1 offset $2`,
        [PAGE_SIZE, offset]
      ),
      db.one<{ n: number }>(`select count(*)::int as n from person_name`),
    ]);
    return {
      key, label, total: Number(count?.n ?? 0), page,
      pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
      rows: rows.map((row) => ({
        kind: 'name' as const, id: Number(row.id), title: String(row.name),
        subtitle: (row.meaning as string | null) ?? null, status: String(row.status),
        url: `/names/${String(row.slug)}`,
      })),
    };
  }

  if (key === 'clans') {
    const [rows, count] = await Promise.all([
      db.rows<Record<string, unknown>>(
        `select c.id, c.name, c.slug, c.published, c.kind, t.name as division,
                (select count(*) from clan_town ct where ct.clan_id = c.id)::int as towns
           from clan c left join tribe t on t.id = c.tribe_id
          order by c.name limit $1 offset $2`,
        [PAGE_SIZE, offset]
      ),
      db.one<{ n: number }>(`select count(*)::int as n from clan`),
    ]);
    return {
      key, label, total: Number(count?.n ?? 0), page,
      pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
      rows: rows.map((row) => ({
        kind: 'clan' as const, id: Number(row.id), title: String(row.name),
        subtitle: [row.division, row.kind, `${row.towns} towns`].filter(Boolean).join(' · '),
        status: row.published ? 'published' : 'hidden',
        url: `/clans/${String(row.slug)}`,
      })),
    };
  }

  if (key === 'proverbs') {
    const [rows, count] = await Promise.all([
      db.rows<Record<string, unknown>>(
        `select id, text, status, translation from example where style = 'proverb'
          order by created_at desc, id desc limit $1 offset $2`,
        [PAGE_SIZE, offset]
      ),
      db.one<{ n: number }>(`select count(*)::int as n from example where style = 'proverb'`),
    ]);
    return {
      key, label, total: Number(count?.n ?? 0), page,
      pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
      rows: rows.map((row) => ({
        kind: 'proverb' as const, id: Number(row.id),
        title: String(row.text).split('\n')[0]!.slice(0, 70),
        subtitle: (row.translation as string | null) ?? 'no English',
        status: String(row.status), url: '/proverbs',
      })),
    };
  }

  // Recordings and submissions are read-only here: a clip is not something to delete from a
  // list without hearing it, and a submission is decided in the review queue where the whole
  // of it can be read.
  if (key === 'recordings') {
    const [rows, count] = await Promise.all([
      db.rows<Record<string, unknown>>(
        `select a.id, a.status, a.speaker_name, a.created_at,
                w.headword, n.name as person_name
           from audio a
           left join word w on w.id = a.word_id
           left join person_name n on n.id = a.person_name_id
          order by a.created_at desc limit $1 offset $2`,
        [PAGE_SIZE, offset]
      ),
      db.one<{ n: number }>(`select count(*)::int as n from audio`),
    ]);
    return {
      key, label, total: Number(count?.n ?? 0), page,
      pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
      rows: rows.map((row) => ({
        kind: 'word' as const, id: Number(row.id),
        title: String(row.headword ?? row.person_name ?? 'a recording'),
        subtitle: [row.speaker_name, row.created_at].filter(Boolean).join(' · '),
        status: String(row.status), url: '/contribute',
      })),
    };
  }

  const [rows, count] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select s.id, s.kind, s.status, s.submitted_at, a.email
         from suggestion s left join account a on a.id = s.submitted_by
        order by s.submitted_at desc limit $1 offset $2`,
      [PAGE_SIZE, offset]
    ),
    db.one<{ n: number }>(`select count(*)::int as n from suggestion`),
  ]);
  return {
    key, label, total: Number(count?.n ?? 0), page,
    pages: Math.ceil(Number(count?.n ?? 0) / PAGE_SIZE),
    rows: rows.map((row) => ({
      kind: 'word' as const, id: Number(row.id), title: String(row.kind).replace(/_/g, ' '),
      subtitle: [(row.email as string | null) ?? 'anonymous contributor', row.submitted_at]
        .filter(Boolean).join(' · '),
      status: String(row.status), url: '/review',
    })),
  };
}


/**
 * Set or clear an account's picture.
 *
 * Only the account's owner or an administrator may change it, and the check is here rather than in
 * the route so it cannot be forgotten by a second caller.
 */
export async function setAccountAvatar(
  db: Db,
  input: { accountId: number; avatarUrl: string; actorId: number; actorRole: AccountRole }
): Promise<{ email: string }> {
  const row = await db.one<Record<string, unknown>>(
    `select id, email from account where id = $1`,
    [input.accountId]
  );
  if (!row) throw new AdminError('not_found', 'That account does not exist.');
  const isSelf = Number(row.id) === input.actorId;
  if (!isSelf && input.actorRole !== 'admin' && input.actorRole !== 'owner') {
    throw new AdminError('forbidden', 'You can only change your own picture.');
  }
  const url = input.avatarUrl.trim().slice(0, 500);
  if (url && !/^https?:\/\//i.test(url)) {
    throw new AdminError('bad_url', 'A picture URL must start with http:// or https://.');
  }
  await db.query(`update account set avatar_url = $2 where id = $1`, [input.accountId, url || null]);
  return { email: String(row.email) };
}
