-- ============================================================================
-- Ozituma — example provenance must be unique
-- ============================================================================
--
-- The sentence importer derived `external_id` from a hash of the sentence text,
-- which is NOT unique in that corpus. 628 sentences appear twice — recorded
-- separately, with different audio and in 103 cases a different English
-- translation. They are legitimate distinct entries, so deduplicating would
-- throw away real recordings.
--
-- The bug that surfaced it: the importer read back sentence ids into a map
-- keyed by external_id. With duplicate ids, the map collapsed each pair to one
-- row, so the other row was inserted but never linked to any word — 652
-- orphaned examples, invisible from every entry page and reported by verify.ts
-- as a data-integrity failure attributed to the wrong cause.
--
-- The fix is for external_id to genuinely identify a row, which also makes the
-- importer's "already imported, skip it" check correct. Without a unique index
-- that check silently skips rows that were never written.
-- ============================================================================

-- Scoped to (language, source) because two corpora may legitimately reuse an
-- identifier scheme, and examples from different sources are different rows.
create unique index example_external_id_unique
  on example (language_code, source_id, external_id)
  where external_id is not null;

comment on index example_external_id_unique is
  'external_id must identify one row per source, so re-importing cannot duplicate or silently skip.';
