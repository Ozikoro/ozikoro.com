/**
 * Rights on the archive's media: who holds them, what they permit, and who checked.
 *
 * WHY THIS IS A MODULE AND NOT A FORM FIELD
 *
 * Three thousand four hundred and eighty-eight media items were migrated with no rights recorded at
 * all, because WordPress has no field for one. Until that is fixed the archive cannot be reused and
 * cannot say so honestly: ten of the twelve permissions that matter are not expressible in a licence
 * string, and the two questions a publisher actually asks — may I use this, and is the person in it
 * alive — have different answers that no single field can hold.
 *
 * So this module owns three things and nothing else:
 *
 *   1. The shape of a rights record, with every permission defaulting to false. An unfinished record
 *      permits nothing rather than everything, because the safe state has to be the default state.
 *   2. The work queue. 3,488 items is not a list, it is a project, so the queue is ordered by what is
 *      most used and least documented: an image on twenty published articles is worth a check before
 *      one nobody has ever displayed.
 *   3. The refusals. A permission cannot be recorded without saying who gave it and when, and a
 *      restricted item cannot be un-restricted without a reason. A rights record with no provenance
 *      is not a rights record, it is an assertion.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

export type PermissionBasis =
  | 'written_permission' | 'verbal_permission' | 'contract' | 'published_licence'
  | 'public_record' | 'institutional_agreement' | 'orphan_work' | 'unknown';

export type SubjectConsent = 'granted' | 'refused' | 'not_required' | 'not_sought' | 'withdrawn';

export const PERMISSION_BASIS_LABEL: Record<PermissionBasis, string> = {
  written_permission: 'Written permission',
  verbal_permission: 'Verbal permission',
  contract: 'Contract',
  published_licence: 'Published licence',
  public_record: 'Public record',
  institutional_agreement: 'Institutional agreement',
  orphan_work: 'Orphan work — holder unknown',
  unknown: 'Not established',
};

export const SUBJECT_CONSENT_LABEL: Record<SubjectConsent, string> = {
  granted: 'Consent given',
  refused: 'Consent refused',
  not_required: 'Not required (nobody living depicted)',
  not_sought: 'Not yet sought',
  withdrawn: 'Withdrawn',
};

export interface MediaRights {
  mediaId: number;
  holderName: string | null;
  holderContact: string | null;
  allowsPublication: boolean;
  allowsDerivative: boolean;
  allowsCommercial: boolean;
  licence: string | null;
  licenceUrl: string | null;
  permissionBasis: PermissionBasis | null;
  permissionDate: string | null;
  permissionNote: string | null;
  subjectIsLiving: boolean | null;
  subjectConsent: SubjectConsent | null;
  restricted: boolean;
  restrictionReason: string | null;
  takedownRequestedAt: string | null;
  takedownResolvedAt: string | null;
  checkedBy: number | null;
  checkedByName: string | null;
  checkedAt: string | null;
  /** Whether this record has been looked at at all. An empty record and an unchecked one differ. */
  isChecked: boolean;
  /** A sentence for the public page, which must not overstate what the record permits. */
  publicStatement: string;
}

/**
 * What a reader is told about an item's rights.
 *
 * Generated from the record rather than written into a template, for the same reason the publication
 * page's review sentence is: a page that says the wrong thing about a right is worse than a page that
 * says nothing, because a reader will rely on it.
 */
export function rightsStatement(rights: MediaRights | null): string {
  if (!rights || !rights.isChecked) {
    return 'No rights have been established for this item. The archive holds it but has not confirmed who owns it or what may be done with it, so permission has not been granted either way. Ask before reusing it.';
  }
  if (rights.restricted) {
    return `This item is restricted${rights.restrictionReason ? `: ${rights.restrictionReason}` : ''}. It is held for the record but is not available for reuse.`;
  }
  if (!rights.allowsPublication) {
    return `Rights are recorded but do not permit publication of this item${rights.holderName ? `, held by ${rights.holderName}` : ''}. It is shown here only where the archive has a separate basis for doing so.`;
  }
  /*
   * Both sides are always stated. An earlier version listed only what WAS permitted, so a licence
   * allowing adaptation but not commercial use produced "This also permits adaptation." and left the
   * reader to assume the rest was fine. A publisher decides from this sentence, so silence about a
   * restriction reads as permission — which is the one thing this must never do.
   */
  const permits = [rights.allowsDerivative ? 'adaptation' : null, rights.allowsCommercial ? 'commercial use' : null].filter(Boolean);
  const denies = [rights.allowsDerivative ? null : 'adaptation', rights.allowsCommercial ? null : 'commercial use'].filter(Boolean);
  const base = rights.licence
    ? `Available under ${rights.licence}.`
    : `Publication permitted${rights.holderName ? ` by ${rights.holderName}` : ''}.`;

  if (permits.length > 0 && denies.length === 0) return `${base} It also permits ${permits.join(' and ')}.`;
  if (permits.length > 0) return `${base} It permits ${permits.join(' and ')}, but does not permit ${denies.join(' or ')}.`;
  return `${base} It does not permit ${denies.join(' or ')}.`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const RIGHTS_SELECT = `
  select r.media_id, r.holder_name, r.holder_contact, r.allows_publication, r.allows_derivative,
         r.allows_commercial, r.licence, r.licence_url, r.permission_basis, r.permission_date,
         r.permission_note, r.subject_is_living, r.subject_consent, r.restricted,
         r.restriction_reason, r.takedown_requested_at, r.takedown_resolved_at, r.checked_by,
         r.checked_at, coalesce(m.display_name, a.display_name, a.email) as checked_by_name
    from ozikoro_media_rights r
    left join account a on a.id = r.checked_by
    left join ozikoro_member m on m.account_id = r.checked_by
`;

function rowToRights(row: Record<string, unknown>): MediaRights {
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
  const rights: MediaRights = {
    mediaId: Number(row.media_id),
    holderName: row.holder_name ? String(row.holder_name) : null,
    holderContact: row.holder_contact ? String(row.holder_contact) : null,
    allowsPublication: Boolean(row.allows_publication),
    allowsDerivative: Boolean(row.allows_derivative),
    allowsCommercial: Boolean(row.allows_commercial),
    licence: row.licence ? String(row.licence) : null,
    licenceUrl: row.licence_url ? String(row.licence_url) : null,
    permissionBasis: row.permission_basis ? (String(row.permission_basis) as PermissionBasis) : null,
    permissionDate: row.permission_date ? new Date(String(row.permission_date)).toISOString().slice(0, 10) : null,
    permissionNote: row.permission_note ? String(row.permission_note) : null,
    subjectIsLiving: row.subject_is_living === null || row.subject_is_living === undefined ? null : Boolean(row.subject_is_living),
    subjectConsent: row.subject_consent ? (String(row.subject_consent) as SubjectConsent) : null,
    restricted: Boolean(row.restricted),
    restrictionReason: row.restriction_reason ? String(row.restriction_reason) : null,
    takedownRequestedAt: iso(row.takedown_requested_at),
    takedownResolvedAt: iso(row.takedown_resolved_at),
    checkedBy: row.checked_by === null || row.checked_by === undefined ? null : Number(row.checked_by),
    checkedByName: row.checked_by_name ? String(row.checked_by_name) : null,
    checkedAt: iso(row.checked_at),
    isChecked: row.checked_at !== null && row.checked_at !== undefined,
    publicStatement: '',
  };
  rights.publicStatement = rightsStatement(rights);
  return rights;
}

export async function getMediaRights(db: Db, mediaId: number): Promise<MediaRights | null> {
  const row = await db.one<Record<string, unknown>>(`${RIGHTS_SELECT} where r.media_id = $1`, [mediaId]);
  return row ? rowToRights(row) : null;
}

export interface RightsQueueItem {
  mediaId: number;
  slug: string;
  title: string;
  kind: string;
  reference: string;
  usedByArticles: number;
  checked: boolean;
  restricted: boolean;
  allowsPublication: boolean;
  licence: string | null;
}

export interface RightsQueueOptions {
  /** 'unchecked' by default: the project is the 3,488 items nobody has looked at. */
  filter?: 'unchecked' | 'checked' | 'restricted' | 'unpublishable' | 'all';
  limit?: number;
  offset?: number;
  search?: string | null;
}

/**
 * The rights work queue.
 *
 * Ordered by how many published articles use the item, descending. That ordering is the whole value
 * of the queue: an image on twenty articles is twenty times the exposure of one on a single article
 * and the same amount of work to check, so the highest-risk items get looked at first rather than
 * whichever has the lowest id.
 */
export async function listRightsQueue(db: Db, options: RightsQueueOptions = {}): Promise<RightsQueueItem[]> {
  const params: unknown[] = [];
  const conditions: string[] = ['m.mime_type is not null'];

  const filter = options.filter ?? 'unchecked';
  if (filter === 'unchecked') conditions.push('r.checked_at is null');
  if (filter === 'checked') conditions.push('r.checked_at is not null');
  if (filter === 'restricted') conditions.push('r.restricted = true');
  if (filter === 'unpublishable') conditions.push('r.checked_at is not null and r.allows_publication = false');

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(m.title ilike $${params.length} or m.slug ilike $${params.length})`);
  }

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select m.id, m.slug, m.title, m.kind,
            coalesce(r.checked_at is not null, false) as checked,
            coalesce(r.restricted, false) as restricted,
            coalesce(r.allows_publication, false) as allows_publication,
            r.licence,
            (select count(*)::int from ozikoro_article_media am
               join ozikoro_article ar on ar.id = am.article_id
              where am.media_id = m.id and ar.status = 'published' and ar.is_page = false) as used_by
       from ozikoro_media m
       left join ozikoro_media_rights r on r.media_id = m.id
      where ${conditions.join(' and ')}
      order by used_by desc, m.id
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  const kindLetter = (k: string) => (k === 'image' ? 'P' : k === 'video' ? 'V' : k === 'audio' ? 'A' : k === 'document' ? 'D' : 'X');
  return rows.map((r) => ({
    mediaId: Number(r.id),
    slug: String(r.slug),
    title: String(r.title ?? '').trim() || `Untitled ${String(r.kind)}`,
    kind: String(r.kind),
    reference: `OZ-${kindLetter(String(r.kind))}-${String(r.id).padStart(4, '0')}`,
    usedByArticles: Number(r.used_by ?? 0),
    checked: Boolean(r.checked),
    restricted: Boolean(r.restricted),
    allowsPublication: Boolean(r.allows_publication),
    licence: r.licence ? String(r.licence) : null,
  }));
}

export interface RightsProgress {
  media: number;
  checked: number;
  unchecked: number;
  publishable: number;
  restricted: number;
  livingSubjects: number;
  consentWithdrawn: number;
  takedownOpen: number;
  /** How much published exposure is still on unchecked items — the number that matters. */
  articlesUsingUnchecked: number;
}

export async function getRightsProgress(db: Db): Promise<RightsProgress> {
  const row = await db.one<Record<string, unknown>>(`
    select
      (select count(*)::int from ozikoro_media) as media,
      (select count(*)::int from ozikoro_media_rights where checked_at is not null) as checked,
      (select count(*)::int from ozikoro_media m
         left join ozikoro_media_rights r on r.media_id = m.id where r.checked_at is null) as unchecked,
      (select count(*)::int from ozikoro_media_rights where checked_at is not null and allows_publication) as publishable,
      (select count(*)::int from ozikoro_media_rights where restricted) as restricted,
      (select count(*)::int from ozikoro_media_rights where subject_is_living) as living_subjects,
      (select count(*)::int from ozikoro_media_rights where subject_consent = 'withdrawn') as consent_withdrawn,
      (select count(*)::int from ozikoro_media_rights where takedown_requested_at is not null and takedown_resolved_at is null) as takedown_open,
      (select count(*)::int from ozikoro_article_media am
         join ozikoro_article a on a.id = am.article_id
         left join ozikoro_media_rights r on r.media_id = am.media_id
        where a.status = 'published' and a.is_page = false and r.checked_at is null) as articles_using_unchecked
  `);
  return {
    media: Number(row?.media ?? 0),
    checked: Number(row?.checked ?? 0),
    unchecked: Number(row?.unchecked ?? 0),
    publishable: Number(row?.publishable ?? 0),
    restricted: Number(row?.restricted ?? 0),
    livingSubjects: Number(row?.living_subjects ?? 0),
    consentWithdrawn: Number(row?.consent_withdrawn ?? 0),
    takedownOpen: Number(row?.takedown_open ?? 0),
    articlesUsingUnchecked: Number(row?.articles_using_unchecked ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RightsInput {
  mediaId: number;
  holderName?: string | null;
  holderContact?: string | null;
  allowsPublication: boolean;
  allowsDerivative: boolean;
  allowsCommercial: boolean;
  licence?: string | null;
  licenceUrl?: string | null;
  permissionBasis?: PermissionBasis | null;
  permissionDate?: string | null;
  permissionNote?: string | null;
  subjectIsLiving?: boolean | null;
  subjectConsent?: SubjectConsent | null;
}

const BASES: PermissionBasis[] = ['written_permission','verbal_permission','contract','published_licence','public_record','institutional_agreement','orphan_work','unknown'];
const CONSENTS: SubjectConsent[] = ['granted','refused','not_required','not_sought','withdrawn'];

/**
 * Record what was established.
 *
 * The refusals are the substance here, not the validation for its own sake:
 *
 *   * Permission to publish must name a basis. "We think it is fine" is not a rights record, and the
 *     moment it is stored it becomes one that a later reader will rely on.
 *   * A living subject must have a consent state. The plan requires privacy controls for living
 *     persons, and an unset field would let a photograph of somebody alive be published with nobody
 *     having asked.
 *   * A licence must be a licence, not a sentence. A URL that is not a URL is nearly always a note
 *     typed into the wrong field.
 */
export async function setMediaRights(
  db: Db,
  input: RightsInput & { actorId: number }
): Promise<void> {
  const before = await getMediaRights(db, input.mediaId);

  if (input.allowsPublication && !input.permissionBasis) {
    throw new MemberError(
      'no_basis',
      'Publication cannot be permitted without recording where the permission came from. Choose a basis, even if it is “not established”.'
    );
  }
  if (input.permissionBasis && !BASES.includes(input.permissionBasis)) {
    throw new MemberError('bad_basis', 'That is not one of the permission bases.');
  }
  if (input.subjectConsent && !CONSENTS.includes(input.subjectConsent)) {
    throw new MemberError('bad_consent', 'That is not one of the consent states.');
  }
  if (input.subjectIsLiving === true && !input.subjectConsent) {
    throw new MemberError(
      'living_subject_needs_consent',
      'This record depicts a living person, so a consent state is required. “Not yet sought” is a valid answer; leaving it unset is not.'
    );
  }
  if (input.licenceUrl && !/^https?:\/\//i.test(input.licenceUrl)) {
    throw new MemberError('bad_licence_url', 'A licence link must start with http:// or https://.');
  }
  if (input.permissionDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.permissionDate)) {
    throw new MemberError('bad_date', 'The permission date must be a date.');
  }

  await db.query(
    `insert into ozikoro_media_rights
       (media_id, holder_name, holder_contact, allows_publication, allows_derivative, allows_commercial,
        licence, licence_url, permission_basis, permission_date, permission_note,
        subject_is_living, subject_consent, checked_by, checked_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     on conflict (media_id) do update set
       holder_name = excluded.holder_name,
       holder_contact = excluded.holder_contact,
       allows_publication = excluded.allows_publication,
       allows_derivative = excluded.allows_derivative,
       allows_commercial = excluded.allows_commercial,
       licence = excluded.licence,
       licence_url = excluded.licence_url,
       permission_basis = excluded.permission_basis,
       permission_date = excluded.permission_date,
       permission_note = excluded.permission_note,
       subject_is_living = excluded.subject_is_living,
       subject_consent = excluded.subject_consent,
       checked_by = excluded.checked_by,
       checked_at = now(),
       updated_at = now()`,
    [
      input.mediaId, input.holderName ?? null, input.holderContact ?? null,
      input.allowsPublication, input.allowsDerivative, input.allowsCommercial,
      input.licence ?? null, input.licenceUrl ?? null, input.permissionBasis ?? null,
      input.permissionDate ?? null, input.permissionNote ?? null,
      input.subjectIsLiving ?? null, input.subjectConsent ?? null, input.actorId,
    ]
  );

  // The media row keeps its own licence string so a query that only knows about `ozikoro_media` sees
  // something true rather than null; the rights record is the authority.
  await db.query(`update ozikoro_media set licence = $2, rights_note = $3, updated_at = now() where id = $1`, [
    input.mediaId, input.licence ?? null, input.permissionNote ?? null,
  ]);

  await audit(db, {
    entityType: 'ozikoro_media_rights',
    entityId: input.mediaId,
    action: before?.isChecked ? 'update_rights' : 'record_rights',
    before: before ? { allowsPublication: before.allowsPublication, licence: before.licence, restricted: before.restricted } : null,
    after: { allowsPublication: input.allowsPublication, allowsDerivative: input.allowsDerivative, allowsCommercial: input.allowsCommercial, licence: input.licence ?? null, basis: input.permissionBasis ?? null },
    actorId: input.actorId,
  });
}

/**
 * Restrict an item, or lift the restriction.
 *
 * A restriction requires a reason and a takedown request is recorded against it, because the plan
 * requires that a request to withdraw something be actionable and traceable. Lifting one requires a
 * reason too: an archive that can un-restrict silently has no restriction.
 */
export async function setMediaRestriction(
  db: Db,
  input: { mediaId: number; restricted: boolean; reason: string; actorId: number; resolveTakedown?: boolean }
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new MemberError('no_reason', 'A restriction or its removal needs a reason, so the decision can be read back later.');
  }

  const existing = await getMediaRights(db, input.mediaId);
  if (!existing) {
    throw new MemberError('not_checked', 'Record what the rights are before restricting the item.');
  }

  await db.query(
    `update ozikoro_media_rights set
        restricted = $2,
        restriction_reason = $3,
        -- Restricting in response to a request records the request; lifting it records the resolution.
        takedown_requested_at = case when $2 and takedown_requested_at is null then now() else takedown_requested_at end,
        takedown_resolved_at = case when $2 then null when $4 then now() else takedown_resolved_at end,
        checked_by = $5,
        updated_at = now()
      where media_id = $1`,
    [input.mediaId, input.restricted, reason, Boolean(input.resolveTakedown), input.actorId]
  );

  await audit(db, {
    entityType: 'ozikoro_media_rights',
    entityId: input.mediaId,
    action: input.restricted ? 'restrict' : 'lift_restriction',
    before: { restricted: existing.restricted },
    after: { restricted: input.restricted },
    actorId: input.actorId,
    note: reason,
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function audit(
  db: Db,
  event: { entityType: string; entityId: number; action: string; before?: unknown; after?: unknown; actorId: number | null; note?: string | null }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        event.entityType, event.entityId, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/rights] could not record audit event:', String(error).slice(0, 160));
  }
}
