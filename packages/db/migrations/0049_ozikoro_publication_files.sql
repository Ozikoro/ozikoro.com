-- What a stored manuscript needs that the file table does not carry.
--
-- THE STATE THIS CORRECTS
--
-- `ozikoro_publication_file` was written in migration 0038 as the record of a manuscript: filename,
-- type, size, storage key. Nothing has ever been inserted into it, because the upload path was never
-- connected — `/submit` says so on the page rather than offering a control that discards the file.
-- Connecting it exposed two gaps, and both are additive here.
--
-- 1. A CHECKSUM.
--
-- The table has no column for one. A repository that states a file's size but not its digest cannot
-- say whether the file it serves today is the file it received, which is the question an archive is
-- asked when somebody disputes what was deposited. The digest is SHA-256, computed by the server from
-- the bytes it actually stored — never accepted from the client, because a supplied checksum proves
-- nothing about the bytes it arrived with.
--
-- 2. THE FILE'S OWN KIND, IN WORDS.
--
-- `role` says what part a file plays in a work (manuscript, supplement, figure). It does not say what
-- the file IS, and a reader deciding whether to download a 4 MB attachment wants to know it is a PDF
-- before they spend the bandwidth. The accepted-type list lives in the application because it decides
-- what may be uploaded; this column records what was accepted, so a page can label it without
-- re-deriving the answer from a MIME string.

alter table ozikoro_publication_file add column if not exists checksum text;

comment on column ozikoro_publication_file.checksum is
  'SHA-256 of the stored bytes, computed by the server at upload. Lets the archive prove the file it '
  'serves is the file it received, which size alone cannot.';

alter table ozikoro_publication_file add column if not exists type_label text;

comment on column ozikoro_publication_file.type_label is
  'What the file is, in words — "PDF", "Word document". Recorded when the file is accepted so a page '
  'can label it without re-deriving the answer from a MIME string.';

-- A work's files are listed on its own page, newest role first, and the download route looks a file
-- up by its own id. The first of those is the read that grows with the table.
create index if not exists ozikoro_pub_file_listing_idx
  on ozikoro_publication_file (publication_id, role, created_at);

-- Finding every version of a work's manuscript is a query an editor asks when a revision is disputed.
create index if not exists ozikoro_pub_file_version_idx
  on ozikoro_publication_file (publication_id, version) where version is not null;
