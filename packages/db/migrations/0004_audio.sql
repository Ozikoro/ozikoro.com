-- ============================================================================
-- Ozituma — audio attribution and provenance
-- ============================================================================
--
-- The `audio` table has existed since 0001 but was never written to. This adds
-- the two things a real recording pipeline needs beyond storage metadata:
-- an accountable contributor, and provenance for imported corpora.
--
-- DESIGN NOTES
--
-- 1. RECORDINGS ARE ATTRIBUTED LIKE EVERYTHING ELSE.
--    A recording is somebody's voice, and it is licensed content like any other
--    entry. `contributor_account_id` records who submitted it, so a speaker can
--    be credited and can ask for their recording to be removed. A recording
--    whose speaker nobody can identify is a rights problem waiting to happen,
--    which is why the column is populated for every community recording.
--
-- 2. IMPORTED AUDIO AND RECORDED AUDIO ARE THE SAME THING.
--    The gated CC-BY-4.0 corpora give us URLs, not bytes, so `external_url`
--    stays. Uploaded recordings get a `storage_key`. Both live in one table, so
--    the API and the UI do not need to know which is which — `repository.ts`
--    resolves `coalesce(external_url, storage_key)` into a single `url`.
--
-- 3. A RECORDING IS REVIEWED BEFORE IT IS PUBLIC.
--    Audio submissions arrive through the same `suggestion` queue as words,
--    with kind = 'audio'. Only approval writes an `audio` row with
--    status = 'published'. Unreviewed recordings sit at 'pending_review' and
--    are invisible to the public API, because an unreviewed voice recording is
--    harder to take back than an unreviewed definition.
-- ============================================================================

-- Who submitted the recording. Null for imported corpora and for editorial
-- recordings made in-house.
alter table audio
  add column contributor_account_id bigint references account(id) on delete set null;

comment on column audio.contributor_account_id is
  'The account that submitted this recording. Credits the speaker and allows removal on request.';

-- Provenance note: where a recording came from, in the contributor's words.
-- Mirrors suggestion.review_note in spirit — it is the reviewer's/contributor's
-- account of the source, which is what an editor needs to judge it.
alter table audio add column provenance_note text;

-- The same recording must not be attached to the same word twice. Without this
-- a double-submitted form silently doubles every pronunciation.
create unique index audio_no_duplicate_recording
  on audio (word_id, coalesce(storage_key, ''), coalesce(external_url, ''))
  where word_id is not null;

-- The public read path filters on status, so index it with the owner.
create index audio_published_word_idx on audio (word_id)
  where status = 'published';

-- The review queue frequently asks "does this word have any audio yet?", which
-- drives the "add a pronunciation" prompt on entry pages.
create index audio_word_any_idx on audio (word_id);

-- Recording needs a dialect optionally; the existing FK handles attribution.
comment on table audio is
  'Pronunciation recordings. Bytes live in S3-compatible storage; this table holds metadata, provenance and moderation state.';
