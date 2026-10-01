-- WordPress pages are not posts, and the first import conflated them.
--
-- The mistake, stated plainly because it is the kind that would otherwise be found later by a
-- reader: the extraction pulled `posts` and `pages` from the REST API and the importer wrote both
-- into `ozikoro_article`, on the reasoning that both carry a title, a slug and a body. They do —
-- and they are not the same kind of thing.
--
-- A post is an archive record: a history of a clan, a paper, a folktale. A page is part of the
-- site itself: About US, Privacy Policy, Authors, and two placeholders the WordPress build left
-- behind (Home, Construction). Rolling them together put "Privacy Policy" into the archive index
-- as though it were a history of somewhere, and — worse — created a real collision, because the
-- page slugged `about` occupied the root address the institution page needs.
--
-- So the distinction becomes a column. Pages stay in the table, because their content is real and
-- the About and Authors pages are the owner's own words, but every archive query filters them out.
--
-- Additive by necessity: 0035 is applied, and editing an applied migration is the thing this
-- repository's migration runner warns about by checksum. A correction is a new migration.

alter table ozikoro_article add column if not exists is_page boolean not null default false;

comment on column ozikoro_article.is_page is
  'True for a WordPress page (About US, Privacy Policy) rather than an archive record. Pages are '
  'site content, not histories, and are excluded from the archive index, search and sitemap.';

-- Partial index: the archive queries always filter pages out, so the useful index is the one that
-- does not carry them.
create index if not exists ozikoro_article_records_idx
  on ozikoro_article (status, published_at desc)
  where is_page = false;

create index if not exists ozikoro_article_pages_idx
  on ozikoro_article (slug)
  where is_page = true;
