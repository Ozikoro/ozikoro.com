/**
 * INSTITUTIONAL ACCESS — a second mark on a record, and the agreement that opens it.
 *
 * ── THE TWO CLAIMS, WHICH MUST NOT BE CONFUSED ────────────────────────────────────────────────────
 *
 * The archive already marks things. `ozikoro_media_rights.restricted` (migration 0040) means:
 *
 *   **"you may read this, and you may not reuse it."** Its own public sentence, in `rightsStatement`, is
 *   *"This item is restricted: <reason>. It is held for the record but is not available for reuse."*
 *
 * This module adds a different mark, on the record rather than on the item, and it means:
 *
 *   **"you may not read this at all without an agreement."**
 *
 * **The two share no column, no flag and no word on screen.** The new tier's column is
 * `ozikoro_article.access_tier`; its values are `open` and `by_agreement`; its reader-facing words are
 * "held by agreement"; and the refusal screen this module composes **does not contain the word
 * "restricted" at all** — so a reader who meets that word is always reading the reuse claim, on the media
 * surface that makes it, and never this one. `AGREEMENT_REFUSAL_WORDING` and the test beside this file
 * assert that rather than trusting it.
 *
 * ── WHO MAY DO WHAT, AND WHY THIS MODULE ASKS THE DATABASE ────────────────────────────────────────
 *
 * Two capabilities, both held by the `owner` role and by no other role (migration 0057):
 *
 *   `read_restricted`            may read a record at `access_tier = by_agreement`
 *   `grant_institutional_access` may make and withdraw the agreements, and may place a record under one
 *
 * The owner decided the grantor set himself — *"then let only the owner 'idenzeme@gmail.com' hold it"* —
 * and the capability follows the ROLE rather than the address, because a capability attached to one email
 * address is a capability that breaks the day the address changes. The guard this module applies is
 * therefore the archive's rule and not a special case: **it asks "does this account hold
 * grant_institutional_access?", never "is this account the proprietor?".**
 *
 * The check is made **in the write**, not only at the door, for the reason `trash.ts` states for
 * `purge_trash`: a script, a job or an endpoint added later is refused by the same rule. And it is asked of
 * `ozikoro_has_capability`, the database function, rather than of a set the caller hands in — a
 * capability check whose answer the caller supplies is not a check.
 *
 * ── WHAT A REVOCATION IS, AND WHAT THE PERSON WHO LOST ACCESS IS TOLD ─────────────────────────────
 *
 * A grant is a row with an actor and a date. **A revocation is its own audit row, not an edit that erases
 * the grant**: `revoked_at`, `revoked_by` and `revocation_reason` are stamped on the row so the grant
 * survives and "was this person ever allowed to read it" stays answerable, and a separate
 * `revoke_institutional_access` row joins it in `ozikoro_audit` — the same shape a purge uses, where the
 * audit row is written and the record is not merely overwritten.
 *
 * **And the person who lost access is told.** `agreementRefusal` takes `withdrawn`, and the refusal screen
 * prints it when the caller's own agreement is the one that was revoked. The decision is deliberate: a
 * reader who could read a record yesterday and cannot today will otherwise conclude the record has
 * vanished, and the archive's rule is that a partial state is a real state and is stated. The reason is
 * shown as it was recorded, and the revocation form says so before it is saved. The revoker is named by
 * ROLE — "the archive's proprietor" — not by address, so the screen does not mail one person by name.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';
import {
  clearExampleMaterial,
} from './design-fill.ts';
import { designScreenLinks, designScriptPaths } from './design-paths.ts';
import { seoHead, withSeoHead } from './seo-head.ts';
import type { SiteVerification } from './seo-verification.ts';
import { EMPTY_SITE_SEO, type SiteSeo } from './site-seo.ts';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export type AccessTier = 'open' | 'by_agreement';

export const ACCESS_TIERS: readonly AccessTier[] = ['open', 'by_agreement'];

/** The label the working screens use. Never the word "restricted". */
export const ACCESS_TIER_LABEL: Record<AccessTier, string> = {
  open: 'Open to read',
  by_agreement: 'Held by agreement',
};

/**
 * The claim each tier makes, in one sentence, written so the two cannot be mistaken for each other.
 *
 * The `by_agreement` sentence deliberately describes the OTHER claim rather than borrowing its word: a
 * reader comparing them is told that reuse is a separate question with its own answer, which is the fact
 * the two-mark design exists to keep visible.
 */
export const ACCESS_TIER_CLAIM: Record<AccessTier, string> = {
  open: 'Anyone may read this record. Whether it may be reused is a separate question, answered by its own rights record.',
  by_agreement:
    'This record cannot be read at all without an institutional access agreement. That is a different claim from an item the archive marks as unavailable for reuse, which may be read here and may not be republished.',
};

/** The capability a reader needs to read a record held by agreement. */
export const READ_BY_AGREEMENT_CAPABILITY = 'read_restricted';

/** The capability that makes, withdraws and applies the agreements. Held by `owner` alone. */
export const GRANT_ACCESS_CAPABILITY = 'grant_institutional_access';

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export interface InstitutionalAccessGrant {
  id: number;
  accountId: number;
  email: string;
  displayName: string | null;
  holder: string;
  instrument: string | null;
  terms: string;
  grantedById: number | null;
  grantedByEmail: string | null;
  grantedAt: string;
  revokedAt: string | null;
  revokedByEmail: string | null;
  revocationReason: string | null;
  active: boolean;
}

export interface InstitutionalAccessOverview {
  /** Agreements now in force. */
  live: number;
  /** Agreements that have been withdrawn, which are kept rather than deleted. */
  withdrawn: number;
  /** Records held by agreement, and how many of those are published and therefore reachable. */
  gated: number;
  gatedPublished: number;
  /** Published records in total, so "none of them" is a number rather than a silence. */
  published: number;
}

/**
 * Whether this account may read a record held by agreement.
 *
 * Asked of the database, so the answer cannot drift from the grants it describes. A signed-out caller
 * passes null and is refused without a query.
 */
export async function mayReadByAgreement(db: Db, accountId: number | null | undefined): Promise<boolean> {
  if (!accountId) return false;
  const row = await db.one<{ ok: boolean }>(
    `select ozikoro_has_capability($1, $2) as ok`,
    [accountId, READ_BY_AGREEMENT_CAPABILITY]
  );
  return Boolean(row?.ok);
}

/** The refusal a write gets when the caller is not the proprietor. */
async function requireGrantCapability(db: Db, actorId: number): Promise<void> {
  const row = await db.one<{ ok: boolean }>(
    `select ozikoro_has_capability($1, $2) as ok`,
    [actorId, GRANT_ACCESS_CAPABILITY]
  );
  if (!row?.ok) {
    throw new MemberError(
      'forbidden',
      'Making or withdrawing an institutional access agreement needs the “grant institutional access” ' +
        'permission, which the owner role holds and no other role does. This account does not have it.'
    );
  }
}

/**
 * Write one audit row.
 *
 * It throws where the archive's other modules log and carry on, and for the same reason `trash.ts` throws
 * on a failed purge audit: **a grant whose trail row was not written is a right nobody can account for.**
 * The grant and the revocation are both deliberate acts about who may read the record, so both refuse
 * rather than proceed unattributed.
 */
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
    throw new MemberError(
      'audit_failed',
      'Nothing was changed. The archive could not record who was opening or closing access to a record, ' +
        'and an access decision with no record of its author is worse than no decision at all.'
    );
  }
}

const GRANT_COLUMNS = `
  g.id, g.account_id, g.holder, g.instrument, g.terms,
  g.granted_by, g.granted_at, g.revoked_at, g.revocation_reason,
  a.email, a.display_name,
  r.email as granted_by_email, v.email as revoked_by_email`;

const GRANT_JOINS = `
  from ozikoro_institutional_access g
  join account a on a.id = g.account_id
  left join account r on r.id = g.granted_by
  left join account v on v.id = g.revoked_by`;

const GRANT_ORDER = `order by (g.revoked_at is null) desc, g.granted_at desc, g.id desc`;

function rowToGrant(row: Record<string, unknown>): InstitutionalAccessGrant {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    email: String(row.email),
    displayName: row.display_name ? String(row.display_name) : null,
    holder: String(row.holder),
    instrument: row.instrument ? String(row.instrument) : null,
    terms: String(row.terms),
    grantedById: row.granted_by === null || row.granted_by === undefined ? null : Number(row.granted_by),
    grantedByEmail: row.granted_by_email ? String(row.granted_by_email) : null,
    grantedAt: new Date(String(row.granted_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    revokedByEmail: row.revoked_by_email ? String(row.revoked_by_email) : null,
    revocationReason: row.revocation_reason ? String(row.revocation_reason) : null,
    active: row.revoked_at === null || row.revoked_at === undefined,
  };
}

/**
 * Every agreement, live ones first.
 *
 * Withdrawn agreements are returned rather than hidden, because the question asked after an incident —
 * "was this account ever allowed to read it?" — is answered by exactly the rows a screen that listed only
 * the live ones would omit.
 */
export async function listInstitutionalAccess(
  db: Db,
  options: { limit?: number; offset?: number } = {}
): Promise<InstitutionalAccessGrant[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = await db.rows<Record<string, unknown>>(
    `select ${GRANT_COLUMNS} ${GRANT_JOINS} ${GRANT_ORDER} limit ${limit} offset ${offset}`
  );
  return rows.map(rowToGrant);
}

/** The live agreement for one account, or null. */
export async function activeInstitutionalAccess(
  db: Db,
  accountId: number
): Promise<InstitutionalAccessGrant | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${GRANT_COLUMNS} ${GRANT_JOINS} where g.account_id = $1 and g.revoked_at is null`,
    [accountId]
  );
  return row ? rowToGrant(row) : null;
}

/**
 * The most recent agreement that was WITHDRAWN for this account, so the refusal can say so.
 *
 * This is the deliberate half of the revocation question. It is read only for the account that is asking,
 * so a reader is never told about anybody else's access.
 */
export async function withdrawnInstitutionalAccess(
  db: Db,
  accountId: number
): Promise<{ revokedAt: string; reason: string } | null> {
  const row = await db.one<{ revoked_at: string; revocation_reason: string | null }>(
    `select revoked_at, revocation_reason
       from ozikoro_institutional_access
      where account_id = $1 and revoked_at is not null
      order by revoked_at desc, id desc limit 1`,
    [accountId]
  );
  if (!row) return null;
  return {
    revokedAt: new Date(String(row.revoked_at)).toISOString(),
    reason: row.revocation_reason ?? '',
  };
}

export interface GrantInput {
  /** Which account the agreement is for. One of these two is required. */
  accountId?: number | null;
  email?: string | null;
  /** The institution the agreement is with, as stated. Required. */
  holder: string;
  /** The instrument's own name or reference, where there is one. */
  instrument?: string | null;
  /** The terms. Required: an agreement with no terms is not terms. */
  terms: string;
  actorId: number;
}

/**
 * Make an agreement.
 *
 * WHAT IS REFUSED, AND WHY EACH REFUSAL EXISTS
 *
 *   * an account that does not exist — an agreement with nobody is not an agreement.
 *   * no institution named, or no terms — the two fields that make the row an instrument rather than a
 *     flag. `instrument` is optional because the archive's own media rights already accept a verbal
 *     permission (migration 0040), and forcing a document reference would refuse a real permission.
 *   * a live agreement already in force — a second one would make "what are the terms?" have two answers.
 *     The partial unique index enforces this as well; this states the refusal in words.
 */
export async function grantInstitutionalAccess(db: Db, input: GrantInput): Promise<InstitutionalAccessGrant> {
  await requireGrantCapability(db, input.actorId);

  const holder = input.holder.trim();
  const terms = input.terms.trim();
  const instrument = (input.instrument ?? '').trim() || null;
  if (holder.length < 2) {
    throw new MemberError('no_holder', 'Name the institution or party the agreement is made with.');
  }
  if (terms.length < 3) {
    throw new MemberError(
      'no_terms',
      'Record the terms of the agreement. An agreement with no terms recorded is an assertion, not an instrument.'
    );
  }

  const account = input.accountId
    ? await db.one<{ id: number; email: string }>(`select id, email from account where id = $1`, [input.accountId])
    : await db.one<{ id: number; email: string }>(`select id, email from account where lower(email) = lower($1)`, [
        String(input.email ?? '').trim(),
      ]);
  if (!account) {
    throw new MemberError(
      'no_account',
      'No account answers to that address, so there is nobody for the agreement to be made with.'
    );
  }

  const live = await activeInstitutionalAccess(db, account.id);
  if (live) {
    throw new MemberError(
      'already_granted',
      `An agreement for ${account.email} is already in force (made ${live.grantedAt.slice(0, 10)} with ` +
        `${live.holder}). Withdraw it first, so that "what are the terms?" has one answer.`
    );
  }

  const inserted = await db.one<{ id: number }>(
    `insert into ozikoro_institutional_access (account_id, holder, instrument, terms, granted_by)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [account.id, holder, instrument, terms, input.actorId]
  );
  if (!inserted) throw new MemberError('not_written', 'The agreement could not be recorded. Nothing was changed.');

  await audit(db, {
    entityType: 'ozikoro_institutional_access',
    entityId: Number(inserted.id),
    action: 'grant_institutional_access',
    before: { access: 'none' },
    after: {
      accountId: account.id,
      email: account.email,
      holder,
      instrument,
      terms,
    },
    actorId: input.actorId,
    note: `Access by agreement granted to ${account.email} — ${holder}.`,
  });

  const written = await db.one<Record<string, unknown>>(
    `select ${GRANT_COLUMNS} ${GRANT_JOINS} where g.id = $1`,
    [Number(inserted.id)]
  );
  if (!written) throw new MemberError('not_written', 'The agreement was recorded but could not be read back.');
  return rowToGrant(written);
}

export interface RevokeInput {
  id: number;
  /** Why access is being withdrawn. Shown to the person who loses it, and to nobody else. */
  reason: string;
  actorId: number;
}

/**
 * Withdraw an agreement.
 *
 * THE GRANT SURVIVES, AND THE WITHDRAWAL IS ITS OWN ROW. The three revocation columns are stamped on the
 * grant rather than the grant being deleted, and a `revoke_institutional_access` row is written to
 * `ozikoro_audit` beside it. So "who granted this, on what terms, who withdrew it, when and why" is
 * answerable in full, and the account's capability disappears the moment `revoked_at` is set because
 * `ozikoro_capabilities` reads the live rows only.
 *
 * The reason is required. It is also **shown to the person who lost access** — `agreementRefusal` prints
 * it — which the form that collects it says before the save.
 */
export async function revokeInstitutionalAccess(
  db: Db,
  input: RevokeInput
): Promise<InstitutionalAccessGrant> {
  await requireGrantCapability(db, input.actorId);

  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new MemberError(
      'no_reason',
      'A withdrawal needs a reason. It is recorded, and it is shown to the person whose access is withdrawn, ' +
        'so that they are told rather than left to think the record has vanished.'
    );
  }

  const before = await db.one<Record<string, unknown>>(
    `select ${GRANT_COLUMNS} ${GRANT_JOINS} where g.id = $1`,
    [input.id]
  );
  if (!before) throw new MemberError('no_grant', 'No agreement answers to that reference.');
  if (before.revoked_at !== null && before.revoked_at !== undefined) {
    throw new MemberError('not_live', 'That agreement has already been withdrawn, so nothing was changed.');
  }

  await db.query(
    `update ozikoro_institutional_access
        set revoked_at = now(), revoked_by = $2, revocation_reason = $3
      where id = $1 and revoked_at is null`,
    [input.id, input.actorId, reason]
  );

  await audit(db, {
    entityType: 'ozikoro_institutional_access',
    entityId: input.id,
    action: 'revoke_institutional_access',
    before: { access: 'by_agreement', terms: before.terms, holder: before.holder },
    after: { access: 'none', reason },
    actorId: input.actorId,
    note: `Access by agreement withdrawn from ${String(before.email)} — ${reason}`,
  });

  const after = await db.one<Record<string, unknown>>(
    `select ${GRANT_COLUMNS} ${GRANT_JOINS} where g.id = $1`,
    [input.id]
  );
  if (!after) throw new MemberError('not_written', 'The withdrawal was recorded but could not be read back.');
  return rowToGrant(after);
}

// ---------------------------------------------------------------------------
// The mark on the record
// ---------------------------------------------------------------------------

export interface SetAccessTierInput {
  articleId: number;
  tier: AccessTier;
  /** Why the record is in that tier. Required in both directions: an archive that can open a record silently
   *  has no closed records, which is the same rule `setMediaRestriction` states for a restriction. */
  reason: string;
  actorId: number;
}

/**
 * Place a record in a tier, or take it out.
 *
 * WHO MAY DO THIS, AND WHY IT IS NOT AN EDITORIAL ACT. Marking a record as unreadable without an agreement
 * changes who may read the archive's holdings, not what the record says — it is the same instrument the
 * grant is, so it needs the same capability. **`edit_entity` is deliberately not enough.** An editor
 * writing, approving, unpublishing or trashing a record is doing editorial work; a record that a reader
 * cannot open at all is an access decision, and it is the proprietor's.
 *
 * The audit row is written as `set_access_tier` BEFORE the update is read back, and a change to the tier it
 * is already in is refused rather than written, so the trail holds decisions and not keystrokes.
 */
export async function setArticleAccessTier(db: Db, input: SetAccessTierInput): Promise<{ id: number; tier: AccessTier }> {
  await requireGrantCapability(db, input.actorId);

  if (!ACCESS_TIERS.includes(input.tier)) {
    throw new MemberError('bad_tier', `“${String(input.tier)}” is not one of the two tiers of reading.`);
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new MemberError(
      'no_reason',
      'A record is placed in a tier or taken out of one with a reason, so the decision can be read back later.'
    );
  }

  const row = await db.one<{ id: number; slug: string; access_tier: string; status: string }>(
    `select id, slug, access_tier, status from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!row) throw new MemberError('no_article', 'That record does not exist.');
  if (row.access_tier === input.tier) {
    throw new MemberError(
      'no_change',
      `“${row.slug}” is already ${ACCESS_TIER_LABEL[input.tier].toLowerCase()}, so nothing was recorded.`
    );
  }

  await db.query(`update ozikoro_article set access_tier = $2 where id = $1`, [input.articleId, input.tier]);

  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'set_access_tier',
    before: { access_tier: row.access_tier },
    after: { access_tier: input.tier },
    actorId: input.actorId,
    note: reason,
  });

  return { id: input.articleId, tier: input.tier };
}

/** What the working screen lists: which records are held by agreement, newest first. */
export async function listRecordsByAgreement(
  db: Db,
  options: { limit?: number } = {}
): Promise<{ id: number; slug: string; title: string; status: string; reference: string }[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db.rows<{ id: number; slug: string; title: string; status: string }>(
    `select id, slug, title, status from ozikoro_article
      where access_tier = 'by_agreement'
      order by id desc limit ${limit}`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    title: String(r.title),
    status: String(r.status),
    reference: `OZ-H-${String(r.id).padStart(4, '0')}`,
  }));
}

/** Agreements in force, agreements withdrawn, and the number of records actually held by agreement. */
export async function institutionalAccessOverview(db: Db): Promise<InstitutionalAccessOverview> {
  const grants = await db.one<{ live: number; withdrawn: number }>(
    `select count(*) filter (where revoked_at is null)::int as live,
            count(*) filter (where revoked_at is not null)::int as withdrawn
       from ozikoro_institutional_access`
  );
  const records = await db.one<{ gated: number; gated_published: number; published: number }>(
    `select count(*) filter (where access_tier = 'by_agreement')::int as gated,
            count(*) filter (where access_tier = 'by_agreement' and status = 'published' and not is_page)::int as gated_published,
            count(*) filter (where status = 'published' and not is_page)::int as published
       from ozikoro_article`
  );
  return {
    live: Number(grants?.live ?? 0),
    withdrawn: Number(grants?.withdrawn ?? 0),
    gated: Number(records?.gated ?? 0),
    gatedPublished: Number(records?.gated_published ?? 0),
    published: Number(records?.published ?? 0),
  };
}

// ---------------------------------------------------------------------------
// The refusal screen
// ---------------------------------------------------------------------------

/**
 * Every word the refusal says. Separated from the markup so the words can be asserted without a server.
 *
 * WHAT IT MUST NOT DO, AND DOES NOT
 *
 *   * It does not name the record. **Its title, topic, author and body are not printed** — the tier's claim
 *     is that the record cannot be read at all, and a refusal screen that printed the title would be
 *     reading part of it. The address the reader asked for is printed instead, so they know they arrived
 *     at the right place, escaped.
 *   * It does not invent a fee, a form, a committee, a turnaround or a person. The only contact route it
 *     gives is the one the archive already publishes on its own terms page, and it says which page that is.
 *   * It does not promise a tier that does not exist: there is no portal to log into, no request form and
 *     no queue, and the copy says so in as many words.
 *   * It does not use the word "restricted". That word is the other claim's.
 */
export interface AgreementRefusal {
  /** The screen's own heading. Never the record's title. */
  title: string;
  /** The address the reader asked for, unescaped; the markup escapes it. */
  path: string;
  lede: string;
  paragraphs: string[];
  ask: { heading: string; body: string; links: { label: string; href: string }[] };
  /** Present only when the caller's own agreement is the one that was withdrawn. */
  withdrawn: { heading: string; body: string } | null;
}

const REFUSAL_ASK_LINKS = [
  { label: 'archive@ozikoro.com', href: 'mailto:archive@ozikoro.com' },
  { label: 'hello@ozikoro.com', href: 'mailto:hello@ozikoro.com' },
  { label: 'The terms page, where both addresses are published', href: '/terms' },
];

export function agreementRefusal(input: {
  path: string;
  withdrawn?: { revokedAt: string; reason: string } | null;
}): AgreementRefusal {
  let withdrawn: AgreementRefusal['withdrawn'] = null;
  if (input.withdrawn) {
    const when = new Date(input.withdrawn.revokedAt);
    const day = Number.isNaN(when.getTime())
      ? input.withdrawn.revokedAt
      : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const reason = input.withdrawn.reason.trim();
    withdrawn = {
      heading: 'An agreement you held has been withdrawn',
      body:
        `An institutional access agreement for this account was withdrawn on ${day} by the archive's ` +
        `proprietor.${reason ? ` The reason recorded is: “${reason}”.` : ''} Until a new agreement is ` +
        `made, records held by agreement are closed to this account. They have not been removed from the ` +
        `archive.`,
    };
  }

  return {
    title: 'This record is held under an institutional access agreement.',
    path: input.path,
    lede: `The record at ${input.path} is in the archive, and reading it is not open.`,
    paragraphs: [
      'What is withheld is the reading of the record — its words, its images and its sources. This is not ' +
        'the same statement as an item the archive marks as unavailable for reuse: that mark says an item ' +
        'may be read here and may not be republished, and it is answered by that item’s own rights record. ' +
        'This one is about being able to read the record at all.',
      'An institutional access agreement is what opens it. The agreement is made with the archive’s ' +
        'proprietor, who is the only account the archive lets make one, and it is recorded against the ' +
        'account that will read the record — with the institution it is made with, the terms, and the date. ' +
        'It can also be withdrawn, and a withdrawal is recorded the same way rather than erasing the ' +
        'agreement.',
      'So that nobody is sent to a door that is not there: the archive has set no fee for this, publishes ' +
        'no form for it, and states no time within which a request is answered. What is written here is ' +
        'only what is true at the archive today.',
    ],
    ask: {
      heading: 'Asking for access',
      body:
        'The archive publishes its addresses on its own terms page: corrections and material offered to ' +
        'the archive go to archive@ozikoro.com, and anything else — which is what this is — to ' +
        'hello@ozikoro.com. Write and say which record you are asking about, quoting its address and its ' +
        'reference if you have one.',
      links: REFUSAL_ASK_LINKS,
    },
    withdrawn,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The same refusal as plain text, for the one address that is a file rather than a page.
 *
 * `/podcast/<slug>/transcript.txt` is read by machines — the feed names it as the episode's transcript — so
 * it cannot answer with a document. **The words are the same words**, composed from the one `agreementRefusal`
 * both renderers call: a second copy of the copy is how a page and a file end up telling a reader two
 * different things about the same record.
 */
export function agreementRefusalText(input: {
  path: string;
  withdrawn?: { revokedAt: string; reason: string } | null;
}): string {
  const copy = agreementRefusal(input);
  const lines = [
    'OZIKORO — HELD BY AGREEMENT',
    '',
    copy.title,
    copy.lede,
    '',
    ...copy.paragraphs.flatMap((text) => [text, '']),
  ];
  if (copy.withdrawn) lines.push(copy.withdrawn.heading, copy.withdrawn.body, '');
  lines.push(copy.ask.heading, copy.ask.body, '');
  for (const link of copy.ask.links) lines.push(`  ${link.label} — ${link.href}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * The refusal, as a complete document, inside the design's own reading frame.
 *
 * WHY THE DESIGN'S FRAME RATHER THAN THE DESIGN'S ARTICLE CONTENT. The design draws no screen for a record
 * that cannot be read — there are fifty-two screens and none of them is this one — so this is a screen the
 * archive writes for itself. It is served inside the frame the reader was already in (`article.html`'s own
 * masthead and stylesheets, and its `<main>` replaced), because a reader who followed a link to a record
 * should not be thrown into different chrome to be told they cannot read it. **Everything inside that
 * `<main>` is replaced, which is what makes the design's example article, its example byline and its
 * example related reading disappear rather than being left on screen under a refusal.**
 *
 * It is a 403 and a real screen, not a 404: the record exists, and the archive's rule is that a partial
 * state is a real state. The caller decides the status; this composes the body.
 *
 * `verification` IS OPTIONAL HERE AND IS PASSED BY THE ROUTES THAT HAVE A DATABASE. The document is served
 * under the record's own address, so a crawler that reaches it must read the same claim about the domain as
 * everywhere else — but this function is deliberately synchronous and pure, with no database, so the tokens
 * arrive as an argument like everything else it is told. Omitting them emits no verification tag, which is
 * the honest empty case rather than a wrong one.
 */
export function agreementRefusalDocument(
  designHtml: string,
  input: {
    path: string;
    withdrawn?: { revokedAt: string; reason: string } | null;
    verification?: readonly SiteVerification[];
    /**
     * The owner's own site identity, so a refusal says the site is called what the owner called it.
     *
     * A 403 is a page of this site and carries the same `og:site_name` and `WebSite` node every other page
     * does; without this it would name the archive's own constant while the record one address away named the
     * setting, which is a disagreement a crawler (and a reader) can see. Optional and defaulted, so every
     * caller that does not pass it serves exactly what it served before.
     */
    site?: SiteSeo;
  }
): string {
  const copy = agreementRefusal(input);
  const path = escapeHtml(copy.path);

  const paragraphs = copy.paragraphs
    .map((text, index) => (index === 0 ? `<p class="dropcap">${escapeHtml(text)}</p>` : `<p>${escapeHtml(text)}</p>`))
    .join('');

  const links = copy.ask.links
    .map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join('');

  const withdrawn = copy.withdrawn
    ? `<section class="provenance" id="withdrawn"><p class="eyebrow">${escapeHtml(copy.withdrawn.heading)}</p>` +
      `<p>${escapeHtml(copy.withdrawn.body)}</p></section>`
    : '';

  const main =
    `<main id="article" data-reader><article class="sx-book-reader">` +
    `<header class="sx-article-opening"><div class="sx-article-title">` +
    `<p class="eyebrow">Held by agreement · Institutional access</p>` +
    `<h1>${escapeHtml(copy.title)}</h1>` +
    `<p class="sx-article-byline">You asked for <strong>${path}</strong></p>` +
    `</div></header>` +
    `<div class="sx-page"><div class="prose">` +
    `<p class="lede">${escapeHtml(copy.lede)}</p>` +
    paragraphs +
    withdrawn +
    `<section class="provenance" id="asking"><p class="eyebrow">${escapeHtml(copy.ask.heading)}</p>` +
    `<p>${escapeHtml(copy.ask.body)}</p><ul>${links}</ul></section>` +
    `</div></div></article></main>`;

  /*
   * THE WHOLE `<main>` IS REPLACED, AND THE MATCH IS NON-GREEDY ON PURPOSE. `article.html` holds exactly one
   * `<main>` and it is the last element before the scripts, so the first `</main>` is the right one. If the
   * design ever grows a second, this stops matching and the fill throws rather than serving a refusal over
   * half a design — which is the failure mode a silent substitution would hide.
   */
  if (!/<main id="article"[\s\S]*?<\/main>/.test(designHtml)) {
    throw new Error('the refusal screen could not be composed: article.html no longer holds <main id="article">');
  }
  let html = designHtml.replace(/<main id="article"[\s\S]*?<\/main>/, main);

  // The design's own banner says the interface wording is example material, which is false of a served
  // refusal. Removing it is `clearExampleMaterial`, the same function every other fill uses.
  html = clearExampleMaterial(html);
  html = designScriptPaths(html);
  html = designScreenLinks(html, copy.path);

  return withSeoHead(
    html,
    seoHead(
      {
        path: copy.path,
        title: 'Held by agreement',
        description:
          'This record is held under an institutional access agreement and cannot be read without one. ' +
          'The archive names the route by which access can be asked for.',
        kind: 'page',
        // A refusal is not a page a search engine should offer as a result: it is the same address as the
        // record and it carries none of its content.
        noindex: true,
        trail: [
          { name: 'Ozikoro', path: '/' },
          { name: 'Held by agreement', path: copy.path },
        ],
      },
      ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css'],
      input.verification ?? [],
      input.site ?? EMPTY_SITE_SEO
    )
  );
}
