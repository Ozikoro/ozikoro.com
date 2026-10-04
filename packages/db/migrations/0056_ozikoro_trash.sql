-- The trash: where a delete goes, so that a delete is a move rather than a destruction.
--
-- THE OWNER'S RULE, VERBATIM
--
--   "an editor can approve every content, write any content, unpublish any content, and delete any content.
--    the only thing an editor can not do is to delete trash… every content deleted will have to go to trash,
--    unless permanently deleted from trash."
--
-- WHAT ALREADY EXISTED, MEASURED TABLE BY TABLE BEFORE ANYTHING WAS DESIGNED
--
--   `ozikoro_article`   HAS a status: `draft`, `review`, `published`, `archived` — and `archived` is NOT a
--                       bin. `/admin/archive` writes it through the review decision as "retired from the
--                       archive", `/[slug]/` serves a record only while it is `published`, and nothing has
--                       ever recorded WHO archived it or WHEN. Overloading `archived` as the trash would
--                       make a retired record and a deleted one indistinguishable, and a recovery could not
--                       tell which state to put a record back into.
--   `ozikoro_media`     has NO status at all. 3,488 rows, `kind` as the only discriminator.
--   `ozikoro_publication` HAS a status including `archived`. Its delete path is not built in this round and
--                       the trash does not cover it; said here so the gap is stated rather than implied.
--   `ozikoro_entity`, `ozikoro_source`, `ozikoro_label`, `ozikoro_topic`, `ozikoro_contributor`,
--   `ozikoro_claim`, `ozikoro_episode` — no status column, and NO CODE ANYWHERE DELETES A ROW FROM ANY OF
--                       THEM. There is no button, no route and no script. **A trash table for a thing that
--                       cannot be deleted would hold nothing**, so this migration does not build one; what it
--                       does instead is make the two tables that CAN be deleted record their deletion.
--   `deleted_at`, `trashed` and `purge` appeared NOWHERE in the 55 migrations before this one. The mechanism
--                       did not exist and is being built, not re-flagged.
--
-- TWO SHAPES, BECAUSE THE TWO TABLES ARE DIFFERENT SHAPES
--
-- 1. **ARTICLES USE THE STATUS, PLUS A RECORD OF WHERE THE RECORD CAME FROM.** `status` gains one value,
--    `trashed`, and the two questions a bin has to answer get their own columns: `deleted_at` and
--    `deleted_by`. `deleted_from_status` is the third and it is the one that makes recovery exact —
--    **a record recovered from the trash comes back as what it was, not as a default.**
--
--    WHY THE STATUS RATHER THAN A `deleted_at` FLAG, WHICH WOULD HAVE BEEN SIMPLER TO ADD:
--    **because every reader already filters on the status, and a flag they do not know about is a record in
--    the bin that a reader can still reach.** Measured: `/[slug]/` requires `status = 'published'`, the
--    sitemap and the archive index and every listing query select on the status, and `/admin/archive` orders
--    the editorial queue by it. Setting the status to a value no reader accepts puts a trashed record out of
--    reach everywhere at once, with no read path edited — **and a read path that is not edited is a read path
--    that cannot be forgotten.** The flag would have needed every one of those queries changed, and the one
--    that was missed would be a deleted history still answering.
-- 2. **MEDIA GET `deleted_at` AND `deleted_by` WITH NO STATUS,** because there is no status column to use.
--    Its read paths are all in one file (`packages/ozikoro/src/media.ts`), which is what makes the flag the
--    smaller change there and why the same shape is not forced onto both tables.
--
-- WHY `deleted_by` REFERENCES `account` AND IS `on delete set null`
--
-- "Who deleted this" is the first question asked about a deletion, so the actor is a real foreign key rather
-- than a name copied into a text column — a copied name is a name that stops matching the account it came
-- from, which is the same reasoning as the revision table's actor. `SET NULL` rather than `CASCADE`: deleting
-- a person's account must not delete the records they put in the bin, and `NULL` here is the honest answer —
-- "an account that no longer exists" — rather than a deletion with no author at all.

alter table ozikoro_article
  add column if not exists deleted_at         timestamptz,
  add column if not exists deleted_by         bigint references account(id) on delete set null,
  add column if not exists deleted_from_status text;

comment on column ozikoro_article.deleted_at is
  'When the record was moved to the trash, and NULL while it is live. Together with deleted_by this is what '
  'the trash screen lists: "who deleted this, and when".';
comment on column ozikoro_article.deleted_by is
  'The account that moved the record to the trash. NULL means the account has since been deleted, which is '
  'the honest answer rather than an anonymous deletion.';
comment on column ozikoro_article.deleted_from_status is
  'The status the record held before it was trashed, so recovery restores what it WAS rather than a default. '
  'A published record recovered from the trash is published again, because that is the state it was taken '
  'out of.';

-- The status gains one value. The constraint is dropped by its conventional name and re-added, inside the
-- migration runner's transaction, so a fresh database and an upgraded one end in the same shape.
alter table ozikoro_article drop constraint if exists ozikoro_article_status_check;
alter table ozikoro_article add constraint ozikoro_article_status_check
  check (status in ('draft', 'review', 'published', 'archived', 'trashed'));

-- The trash screen reads newest-deleted first, and only ever reads the trashed rows: a PARTIAL index, so it
-- costs nothing on the 1,057 live records it excludes.
create index if not exists ozikoro_article_trash_idx
  on ozikoro_article (deleted_at desc nulls last, id desc) where status = 'trashed';

alter table ozikoro_media
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by bigint references account(id) on delete set null;

comment on column ozikoro_media.deleted_at is
  'When the media record was moved to the trash, and NULL while it is live. The FILE is not touched by this '
  'and stays in object storage: this round has no object-delete path, so a trashed photograph is hidden from '
  'the catalogue while its file remains served at /media/<key>.';

create index if not exists ozikoro_media_trash_idx
  on ozikoro_media (deleted_at desc nulls last, id desc) where deleted_at is not null;
