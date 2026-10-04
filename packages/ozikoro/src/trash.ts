/**
 * The trash: moving a record out of the archive's reach without destroying it, and the one act that does
 * destroy it.
 *
 * THE RULE THIS IMPLEMENTS
 *
 *   "an editor can approve every content, write any content, unpublish any content, and delete any content.
 *    the only thing an editor can not do is to delete trash, but can recover or do anything, except deleting
 *    trash. every content deleted will have to go to trash, unless permanently deleted from trash."
 *
 * So a delete is a MOVE. Three acts live here and they are not symmetric:
 *
 *   trash    reversible, available to anybody who may edit the record, and it destroys nothing
 *   restore  the exact inverse of trash — the record comes back as what it was
 *   purge    IRREVERSIBLE, and the only act in this archive guarded by a capability of its own
 *
 * WHY THE PURGE IS GUARDED BY A CAPABILITY NAMED FOR THE PROHIBITION
 *
 * `TRASH_PURGE_CAPABILITY` is `purge_trash` and only `admin` and `owner` hold it (migration 0055). A caller
 * asks "may this account purge?", never "is this account an editor?", and the difference is what happens when
 * somebody adds the next route: **a route that forgets to ask refuses nobody, so it fails CLOSED for the one
 * act that cannot be undone. A route that asked about a ROLE would fail open the day the roles changed.**
 * The check is also made HERE, inside the write, and not only at the route — "the rule lives in the write
 * path, not in the UI" is the archive's own doctrine and the reason `editorial.ts` holds its own validation.
 *
 * THE AUDIT ROW SURVIVES THE ACT IT RECORDS — CHECKED, NOT ASSUMED
 *
 * `ozikoro_audit.entity_id` is `bigint not null` with **no foreign key to anything**. Its only reference is
 * `actor_id references account(id) on delete set null`. So a purged record's audit rows are not cascaded away
 * with it: the trail outlives the thing it is about, which is the property that makes "who destroyed this"
 * answerable after the fact. **The purge writes its audit row BEFORE it deletes, deliberately** — written
 * first, the record of the act exists even if the delete cascades something unexpected, and a trail written
 * afterwards is a trail that a failure can erase.
 *
 * WHAT A PURGE TAKES WITH IT, WHICH IS WHY IT NEEDS A CONFIRMATION THAT NAMES THE ITEM
 *
 *   `ozikoro_article_revision.article_id`           ON DELETE CASCADE — every revision, including the
 *                                                   4,266 imported ones for that record
 *   `ozikoro_article_entity` / `_source` / `_label` / `_media`  ON DELETE CASCADE — its links
 *   `ozikoro_media_rights.media_id` (for a media purge)  checked in migration 0040
 *
 * **A purge of an article therefore destroys editorial history that no import can regenerate**, and the
 * caller must type the record's own reference (`OZ-H-0041`, `OZ-P-1234`) to do it. A confirmation that names
 * the item is the only kind that a person reads.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

/**
 * The one capability that gates the one irreversible act.
 *
 * Held by `admin` and `owner` (migration 0055) and by nobody else. Exported as a constant so every call site
 * names the same string and a typo is a compile error rather than a check that silently never passes.
 */
export const TRASH_PURGE_CAPABILITY = 'purge_trash';

/** One row of the bin, whichever table it came from. */
export interface TrashItem {
  /** `article` or `media` — the table it lives in, and what a purge would delete from. */
  kind: 'article' | 'media';
  id: number;
  reference: string;
  title: string;
  /** The state it was in when it was trashed, so a reader of the bin can see what recovery would restore. */
  wasStatus: string | null;
  deletedAt: string;
  deletedByEmail: string | null;
  /** A second line: the slug for an article, the media kind for a picture. */
  detail: string;
}

/** The archive's own reference for a record, so a purge confirmation and a screen agree on one string. */
export function articleReference(id: number): string {
  return `OZ-H-${String(id).padStart(4, '0')}`;
}

/** The reference for a media record. Mirrors `media.ts`'s `referenceFor`, which is not exported. */
function mediaReference(kind: string, id: number): string {
  const letter = kind === 'image' ? 'P' : kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'document' ? 'D' : 'X';
  return `OZ-${letter}-${String(id).padStart(4, '0')}`;
}

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
        event.entityType, event.entityId, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    /*
     * THE ONE PLACE AN AUDIT FAILURE IS NOT SWALLOWED.
     *
     * Every other module logs a failed audit row and carries on, on the reasoning that refusing a legitimate
     * edit because the trail table had a bad moment makes the trail the obstacle rather than the witness. That
     * reasoning does NOT hold for a purge: **a purge whose trail row was not written is an irreversible act
     * with no record of who did it**, and there is no later opportunity to write one. So this throws, and the
     * caller refuses the purge. See `purgeArticle` and `purgeMedia`, which call this BEFORE the delete.
     */
    throw new MemberError(
      'audit_failed',
      'Nothing was deleted. The archive could not record who was destroying this, and an irreversible act ' +
        'with no record of its author is worse than no act at all.'
    );
  }
}

/** The refusal a purge gets when the caller does not hold the one capability that permits it. */
function requirePurge(capabilities: Set<string>): void {
  if (!capabilities.has(TRASH_PURGE_CAPABILITY)) {
    throw new MemberError(
      'forbidden',
      'Destroying something for good needs the “purge trash” permission, which this account does not have. ' +
        'Everything else about a deleted record — reading it, restoring it, editing it — does not.'
    );
  }
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/**
 * Move an article to the trash.
 *
 * `status` becomes `trashed` and the state it came from is kept, which is what makes `restoreArticle` exact.
 * **Its relations are not touched**: `ozikoro_article_entity`, `_source`, `_label` and `_media` keep their
 * rows, so recovery puts the record back with everything that made it a record. They are not reachable while
 * it is trashed because every reader selects on the status, and that is the property the trash relies on —
 * see migration 0056 for why the status is the mechanism.
 */
export async function trashArticle(
  db: Db,
  input: { articleId: number; actorId: number; note?: string | null }
): Promise<{ reference: string; from: string }> {
  const before = await db.one<{ status: string; title: string; is_page: boolean; slug: string }>(
    `select status, title, is_page, slug from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!before) throw new MemberError('no_article', 'That record does not exist.');
  if (before.is_page) {
    throw new MemberError('is_page', 'That is a published page, not an archive record. Pages are not deleted here.');
  }
  if (before.status === 'trashed') {
    throw new MemberError('already_trashed', 'That record is already in the trash.');
  }

  await db.query(
    `update ozikoro_article
        set status = 'trashed', deleted_at = now(), deleted_by = $2, deleted_from_status = $3, updated_at = now()
      where id = $1`,
    [input.articleId, input.actorId, before.status]
  );

  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'trash_article',
    before: { status: before.status, deleted: false },
    after: { status: 'trashed', deleted: true, recoverable: true },
    actorId: input.actorId,
    note:
      `Moved “${before.title}” (${before.slug}) to the trash from ${before.status}. ` +
      'Nothing was destroyed and it can be restored to that state.' +
      (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { reference: articleReference(input.articleId), from: before.status };
}

/**
 * Bring an article back, as what it was.
 *
 * THE DECISION THE OWNER ASKED FOR: a published record recovered from the trash is PUBLISHED AGAIN, not sent
 * back to review. `deleted_from_status` is what it held when it was taken out of the archive, and restoring
 * anything else would make recovery a lossy operation — **an edit nobody made.** Its `published_at` is
 * untouched by the trash for the same reason, so a record that comes back comes back to the address, the
 * state and the date it had.
 */
export async function restoreArticle(
  db: Db,
  input: { articleId: number; actorId: number }
): Promise<{ reference: string; to: string }> {
  const before = await db.one<{ status: string; deleted_from_status: string | null; title: string }>(
    `select status, deleted_from_status, title from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!before) throw new MemberError('no_article', 'That record does not exist.');
  if (before.status !== 'trashed') {
    throw new MemberError('not_trashed', 'That record is not in the trash, so there is nothing to restore.');
  }

  // Falls back to `draft` only for a row trashed before this column existed, which cannot happen on a
  // database that has run migration 0056 — but a NULL must not become an invalid status.
  const to = before.deleted_from_status ?? 'draft';

  await db.query(
    `update ozikoro_article
        set status = $2, deleted_at = null, deleted_by = null, deleted_from_status = null, updated_at = now()
      where id = $1 and status = 'trashed'`,
    [input.articleId, to]
  );

  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'restore_article',
    before: { status: 'trashed', deleted: true },
    after: { status: to, deleted: false },
    actorId: input.actorId,
    note: `Restored “${before.title}” from the trash to ${to}, which is the state it was taken out of.`,
  });

  return { reference: articleReference(input.articleId), to };
}

/**
 * Destroy an article for good. The only irreversible act in this archive.
 *
 * REFUSES UNLESS THE RECORD IS ALREADY IN THE TRASH. A purge that could reach a live record would be a delete
 * with extra steps, and the point of the bin is that nothing is destroyed without having been set aside first.
 * The caller must also name the record's own reference, which is the confirmation.
 */
export async function purgeArticle(
  db: Db,
  input: { articleId: number; actorId: number; capabilities: Set<string>; confirm: string }
): Promise<{ reference: string; destroyed: { revisions: number; entities: number; sources: number; labels: number; media: number } }> {
  requirePurge(input.capabilities);

  const before = await db.one<{ status: string; title: string; slug: string; deleted_at: Date | null; deleted_from_status: string | null }>(
    `select status, title, slug, deleted_at, deleted_from_status from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!before) throw new MemberError('no_article', 'That record does not exist.');

  const reference = articleReference(input.articleId);
  if (before.status !== 'trashed' || before.deleted_at === null) {
    throw new MemberError(
      'not_trashed',
      'Nothing was destroyed. A record must be moved to the trash before it can be destroyed, so that the ' +
        'decision to remove it and the decision to destroy it are two separate ones.'
    );
  }
  /*
   * THE CONFIRMATION. Compared after trimming and case-folding, because the point is that a person read the
   * reference and typed it — not that they matched a spelling. A confirmation that refuses on a stray space
   * teaches the operator to paste, and pasting is not reading.
   */
  if (input.confirm.trim().toLowerCase() !== reference.toLowerCase()) {
    throw new MemberError(
      'confirm_mismatch',
      `Nothing was destroyed. To destroy a record for good you must type its reference, ${reference}, in the box.`
    );
  }

  /*
   * WHAT IT WILL TAKE WITH IT, MEASURED BEFORE IT IS TAKEN.
   *
   * These counts are read first because after the delete there is nothing to count, and they go into the
   * audit row and into the notice. **A purge that says "destroyed" without saying what it destroyed is a
   * purge nobody can review.**
   */
  const losses = await db.one<Record<string, number>>(
    `select
       (select count(*)::int from ozikoro_article_revision where article_id = $1) as revisions,
       (select count(*)::int from ozikoro_article_entity   where article_id = $1) as entities,
       (select count(*)::int from ozikoro_article_source   where article_id = $1) as sources,
       (select count(*)::int from ozikoro_article_label    where article_id = $1) as labels,
       (select count(*)::int from ozikoro_article_media    where article_id = $1) as media`,
    [input.articleId]
  );
  const destroyed = {
    revisions: Number(losses?.revisions ?? 0),
    entities: Number(losses?.entities ?? 0),
    sources: Number(losses?.sources ?? 0),
    labels: Number(losses?.labels ?? 0),
    media: Number(losses?.media ?? 0),
  };

  /*
   * THE TRAIL FIRST. See the header: `ozikoro_audit` has no foreign key to its subject, so this row is not
   * cascaded away by the delete below — and writing it first means the record of the act exists even if the
   * delete fails half way.
   */
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'purge_article',
    before: {
      status: 'trashed',
      title: before.title,
      slug: before.slug,
      deletedFromStatus: before.deleted_from_status,
      deletedAt: before.deleted_at ? new Date(String(before.deleted_at)).toISOString() : null,
      reference,
    },
    after: { destroyed: true, irreversible: true, takenWithIt: destroyed },
    actorId: input.actorId,
    note:
      `PERMANENTLY deleted “${before.title}” (${before.slug}, ${reference}) from the trash. ` +
      `Destroyed with it: ${destroyed.revisions} revision(s), ${destroyed.entities} entity link(s), ` +
      `${destroyed.sources} source link(s), ${destroyed.labels} label link(s), ${destroyed.media} media placement(s). ` +
      'This cannot be undone. The audit rows about this record survive this act.',
  });

  // Guarded by `status = 'trashed'` as well as by the check above, so a status change racing this statement
  // cannot turn a purge into a delete of a live record.
  const result = await db.query(`delete from ozikoro_article where id = $1 and status = 'trashed'`, [input.articleId]);
  if (result.rowCount !== 1) {
    throw new MemberError('purge_raced', 'Nothing was destroyed: the record was no longer in the trash when the delete ran.');
  }

  return { reference, destroyed };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Move a media record to the trash. The FILE is not touched — this round has no object-delete path. */
export async function trashMedia(
  db: Db,
  input: { mediaId: number; actorId: number; note?: string | null }
): Promise<{ reference: string }> {
  const before = await db.one<{ kind: string; slug: string; title: string | null; caption: string | null; deleted_at: Date | null }>(
    `select kind, slug, title, caption, deleted_at from ozikoro_media where id = $1`,
    [input.mediaId]
  );
  if (!before) throw new MemberError('no_media', 'That record does not exist.');
  if (before.deleted_at !== null) throw new MemberError('already_trashed', 'That record is already in the trash.');

  await db.query(`update ozikoro_media set deleted_at = now(), deleted_by = $2, updated_at = now() where id = $1`, [
    input.mediaId, input.actorId,
  ]);

  const reference = mediaReference(String(before.kind), input.mediaId);
  await audit(db, {
    entityType: 'ozikoro_media',
    entityId: input.mediaId,
    action: 'trash_media',
    before: { deleted: false },
    after: { deleted: true, recoverable: true },
    actorId: input.actorId,
    note:
      `Moved ${reference} (${before.slug}) to the trash. The record is hidden from the archive; **the file ` +
      'itself is not deleted**, because this archive has no object-delete path, so a body that embeds it ' +
      'still resolves.' +
      (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { reference };
}

export async function restoreMedia(
  db: Db,
  input: { mediaId: number; actorId: number }
): Promise<{ reference: string }> {
  const before = await db.one<{ kind: string; slug: string; deleted_at: Date | null }>(
    `select kind, slug, deleted_at from ozikoro_media where id = $1`,
    [input.mediaId]
  );
  if (!before) throw new MemberError('no_media', 'That record does not exist.');
  if (before.deleted_at === null) {
    throw new MemberError('not_trashed', 'That record is not in the trash, so there is nothing to restore.');
  }

  await db.query(`update ozikoro_media set deleted_at = null, deleted_by = null, updated_at = now() where id = $1`, [input.mediaId]);

  const reference = mediaReference(String(before.kind), input.mediaId);
  await audit(db, {
    entityType: 'ozikoro_media',
    entityId: input.mediaId,
    action: 'restore_media',
    before: { deleted: true },
    after: { deleted: false },
    actorId: input.actorId,
    note: `Restored ${reference} (${before.slug}) from the trash. It is a catalogue record again and nothing about it was changed by the deletion.`,
  });

  return { reference };
}

/**
 * Destroy a media record for good.
 *
 * **THE FILE IS NOT DESTROYED AND THE NOTICE SAYS SO.** There is no object-delete path in this archive — that
 * is the same scope decision that keeps an upload control off the media form — so a purged record leaves its
 * object in the bucket, still served at `/media/<key>` to anyone who has the address. The parent round's
 * measurement makes that worse than it sounds: that host serves objects anonymously and the keys are
 * guessable. **A purge here deletes the catalogue entry, not the picture**, and saying otherwise would be the
 * archive claiming a deletion it did not perform. The `after` field of the audit row carries
 * `fileDestroyed: false` so the trail says it too.
 */
export async function purgeMedia(
  db: Db,
  input: { mediaId: number; actorId: number; capabilities: Set<string>; confirm: string }
): Promise<{ reference: string; fileDestroyed: false }> {
  requirePurge(input.capabilities);

  const before = await db.one<{ kind: string; slug: string; storage_key: string | null; deleted_at: Date | null }>(
    `select kind, slug, storage_key, deleted_at from ozikoro_media where id = $1`,
    [input.mediaId]
  );
  if (!before) throw new MemberError('no_media', 'That record does not exist.');

  const reference = mediaReference(String(before.kind), input.mediaId);
  if (before.deleted_at === null) {
    throw new MemberError(
      'not_trashed',
      'Nothing was destroyed. A record must be moved to the trash before it can be destroyed.'
    );
  }
  if (input.confirm.trim().toLowerCase() !== reference.toLowerCase()) {
    throw new MemberError(
      'confirm_mismatch',
      `Nothing was destroyed. To destroy a record for good you must type its reference, ${reference}, in the box.`
    );
  }

  await audit(db, {
    entityType: 'ozikoro_media',
    entityId: input.mediaId,
    action: 'purge_media',
    before: {
      slug: before.slug,
      storageKey: before.storage_key,
      deletedAt: before.deleted_at ? new Date(String(before.deleted_at)).toISOString() : null,
      reference,
    },
    after: { destroyed: true, irreversible: true, fileDestroyed: false },
    actorId: input.actorId,
    note:
      `PERMANENTLY deleted the catalogue record ${reference} (${before.slug}) from the trash. ` +
      'The FILE WAS NOT DESTROYED — this archive has no object-delete path — so the object remains in ' +
      `storage${before.storage_key ? ` at ${String(before.storage_key)}` : ''} and is still served to anyone ` +
      'who has the address. This cannot be undone.',
  });

  const result = await db.query(`delete from ozikoro_media where id = $1 and deleted_at is not null`, [input.mediaId]);
  if (result.rowCount !== 1) {
    throw new MemberError('purge_raced', 'Nothing was destroyed: the record was no longer in the trash when the delete ran.');
  }

  return { reference, fileDestroyed: false };
}

// ---------------------------------------------------------------------------
// Reading the bin
// ---------------------------------------------------------------------------

/**
 * Everything in the trash, newest-deleted first, with who deleted it and when.
 *
 * One list from two tables rather than two lists, because the question the screen answers is "what has been
 * deleted?", not "what tables do you have?". `wasStatus` is carried so a reader can see what recovery would
 * put back — **without it, "restore" is a button whose outcome is invisible until it is pressed.**
 */
export async function listTrash(db: Db, options: { limit?: number; offset?: number } = {}): Promise<TrashItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = await db.rows<Record<string, unknown>>(
    /*
     * TWO THINGS THE BIN MUST SHOW, AND THE FIRST ONE WAS WRONG.
     *
     * `wasStatus` is what recovery would restore, so for an article it is `deleted_from_status` — the state
     * the record was taken out of. The first version of this query selected `a.status`, which is `'trashed'`
     * BY DEFINITION for every row in the bin, so the column read "trashed" for every article and told a
     * reader nothing. **A column that can only ever hold one value is a column that is wrong**, and it was
     * found by asserting the value a person would expect rather than that the query ran.
     *
     * For media there is no status to restore, so `was_status` carries the KIND — which is the second thing a
     * bin row has to say about a picture and is what `mediaReference` below is derived from.
     */
    `select 'article' as kind, a.id, a.title, a.slug,
            a.deleted_from_status as was_status, a.deleted_at, acc.email as deleted_by_email
       from ozikoro_article a
       left join account acc on acc.id = a.deleted_by
      where a.status = 'trashed'
      union all
     select 'media' as kind, m.id,
            coalesce(nullif(trim(m.caption), ''), nullif(trim(m.title), ''), 'Untitled ' || m.kind) as title,
            m.slug, m.kind as was_status, m.deleted_at, acc.email as deleted_by_email
       from ozikoro_media m
       left join account acc on acc.id = m.deleted_by
      where m.deleted_at is not null
      order by deleted_at desc nulls last, id desc
      limit $1 offset $2`,
    [limit, offset]
  );

  return rows.map((r) => {
    const kind = String(r.kind) as 'article' | 'media';
    const id = Number(r.id);
    return {
      kind,
      id,
      reference: kind === 'article' ? articleReference(id) : mediaReference(String(r.was_status ?? 'other'), id),
      title: r.title ? String(r.title) : '(no title)',
      wasStatus: r.was_status ? String(r.was_status) : null,
      deletedAt: new Date(String(r.deleted_at)).toISOString(),
      deletedByEmail: r.deleted_by_email ? String(r.deleted_by_email) : null,
      detail: kind === 'article' ? `/${String(r.slug)}/` : `${String(r.was_status)} · ${String(r.slug)}`,
    };
  });
}

/** How much is in the bin, so the screen can state it rather than showing a page and implying it is all. */
export async function countTrash(db: Db): Promise<{ total: number; articles: number; media: number }> {
  const row = await db.one<Record<string, number>>(
    `select
       (select count(*)::int from ozikoro_article where status = 'trashed') as articles,
       (select count(*)::int from ozikoro_media where deleted_at is not null) as media`
  );
  const articles = Number(row?.articles ?? 0);
  const media = Number(row?.media ?? 0);
  return { total: articles + media, articles, media };
}
