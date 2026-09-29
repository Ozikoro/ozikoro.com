-- ============================================================================
-- Ozituma — search infrastructure
-- ============================================================================
--
-- The reference implementation searches Igbo with a hand-built regex per
-- letter (diacriticCodes.ts), then re-ranks results in JavaScript with four
-- `stringSimilarity.compareTwoStrings` calls per document. That is O(n) over
-- the whole collection and cannot use an index, which is why it needed a Redis
-- cache in front of it and still needed a `strict` flag as a workaround.
--
-- Postgres does this natively and with indexes:
--
--   * exact_form / search_form are stored columns (see 0001), so a plain
--     btree lookup answers "is this a word?" without any regex.
--   * pg_trgm gives typo tolerance (the job `string-similarity` was doing in
--     JavaScript) as a GIN index.
--   * tsvector + GIN gives ranked full-text search over definitions, which is
--     the English -> Igbo direction.
--
-- We use the `simple` text-search configuration for African-language text:
-- stemming dictionaries do not exist for these languages, and applying a
-- language's stemmer to another language's words is worse than not stemming.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Full-text vectors
-- ---------------------------------------------------------------------------

-- Headwords: no stemming, but exact_form is indexed alongside the headword so
-- a tone-blind query still hits.
alter table word add column search_vector tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(headword, '') || ' ' || coalesce(exact_form, '')
    )
  ) stored;

-- Definitions are written in English today, so English stemming helps
-- ("running" should find "run"). If a definition language is added later this
-- column stays correct for English and we add per-language vectors then.
alter table definition add column search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(text, '') || ' ' || coalesce(label, ''))
  ) stored;

alter table example add column search_vector tsvector
  generated always as (
    to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(translation, ''))
  ) stored;

create index word_search_fts_idx       on word using gin (search_vector);
create index definition_search_fts_idx on definition using gin (search_vector);
create index example_search_fts_idx    on example using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Typo tolerance via trigrams, if the extension is available.
--
-- pg_trgm is a contrib module. Managed Postgres (RDS, Aurora, Cloud SQL) all
-- ship it, but a minimal container might not, and we must not make the whole
-- platform undeployable over an optional performance feature. So: try to
-- install it, and only build the trigram indexes if it actually landed. The
-- API feature-detects at runtime and degrades to prefix matching.
-- ----------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_trgm;
exception
  when others then
    raise notice 'pg_trgm unavailable (%). Fuzzy/typo-tolerant search will degrade to prefix matching.', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists word_search_trgm_idx
               on word using gin (search_form gin_trgm_ops)';
    execute 'create index if not exists word_exact_trgm_idx
               on word using gin (exact_form gin_trgm_ops)';
    execute 'create index if not exists definition_text_trgm_idx
               on definition using gin (text gin_trgm_ops)';
    execute 'create index if not exists word_dialect_search_trgm_idx
               on word_dialect using gin (search_form gin_trgm_ops)';
    raise notice 'pg_trgm installed: fuzzy search indexes created.';
  else
    raise notice 'pg_trgm not installed: skipped fuzzy search indexes.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fallback prefix index for the English -> Igbo direction.
-- ----------------------------------------------------------------------------

create index definition_text_prefix_idx on definition (text text_pattern_ops);
