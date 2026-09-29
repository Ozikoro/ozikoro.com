-- The proverb collection, read as a list.
--
-- Proverbs are `example` rows with `style = 'proverb'` — that has been true since
-- the collection began, and the column documented it from the start. What was
-- missing was a way to read them as a collection instead of only as quotations
-- hanging under the words they contain, so `/proverbs` arrived and every one of
-- its queries filters on exactly this predicate.
--
-- Two of the three indexes on `example` are on `language_code`, `search_form` and
-- `source_id`; none of them helps a query that says "proverbs, published, in this
-- language, in id order", which is the whole of the section's access pattern.
-- `verify` also counts published proverbs on every run, so the count is on the
-- hot path too.
--
-- Partial, because the section never wants the other 26,000 examples, and the
-- covering columns mean the list does not visit the table for the text.

create index example_proverb_idx
  on example (language_code, id)
  include (text, translation)
  where style = 'proverb' and status = 'published';

comment on index example_proverb_idx is
  'Backs the /proverbs section: published proverbs for one language in id order, '
  'with the text and translation carried in the index.';
