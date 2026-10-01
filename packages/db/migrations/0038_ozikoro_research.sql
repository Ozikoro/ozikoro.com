-- The research network: publications, their versions, and the review that decides whether a work
-- may call itself peer-reviewed.
--
-- WHY THIS IS NOT `ozikoro_article`
--
-- An article is a record the archive holds: a history of a clan, migrated from WordPress, written
-- by the institution or contributed to it. A publication is a work its author owns and submits,
-- with an abstract, authors and affiliations, a discipline, references and files. They share almost
-- nothing operationally — an article has no revisions, no reviewers and no versions to preserve,
-- and a publication has no series and no evidence stance. Rolling them together would give every
-- migrated history a submission state it can never be in.
--
-- THE ONE THING THAT MATTERS MOST HERE
--
-- The plan: "Never label a work peer-reviewed unless it completed the actual peer-review workflow."
-- That is a property of the data, not of a badge somebody remembers to leave off. So the workflow is
-- a table of transitions rather than a status column someone can set, and the `peer_reviewed` flag
-- is only ever written by the transition that ends expert review. A `status` column alone would make
-- the honest answer a matter of application discipline; this makes it a matter of what happened.

-- ---------------------------------------------------------------------------
-- The work
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_publication (
  id            bigserial primary key,
  slug          text not null unique,

  title         text not null,
  abstract      text,
  -- Free text rather than an enum: disciplines are a growing vocabulary and an enum would mean a
  -- migration per field.
  disciplines   text[] not null default '{}',
  keywords      text[] not null default '{}',
  language_code text references language(code) on delete set null,

  kind          text not null default 'journal_article' check (kind in (
                  'journal_article','conference_paper','chapter','book','thesis','dissertation',
                  'preprint','working_paper','report','research_note','dataset','review','other')),

  -- The submitting account. Kept even if the account closes, because a published work must not
  -- become unattributed because somebody deleted their profile.
  submitted_by  bigint references account(id) on delete set null,

  -- Workflow state. Every change to it goes through ozikoro_publication_transition.
  status        text not null default 'draft' check (status in (
                  'draft','submitted','editorial_screening','under_review','revision_required',
                  'expert_review','approved','published','archived')),

  /*
   * Written ONLY by the transition out of `expert_review`. Defaults false, and nothing else in this
   * schema sets it. A work that reached `published` by an editorial route that did not include expert
   * review is published and is not peer-reviewed, and the two are different facts.
   */
  peer_reviewed boolean not null default false,

  -- Identifiers, left as fields the author supplies. Deliberately not validated as DOIs: a DOI is
  -- issued by a registration agency, and a checksum here would be theatre.
  doi           text,
  external_url  text,
  publisher     text,
  journal       text,
  volume        text,
  issue         text,
  pages         text,

  published_at  timestamptz,
  submitted_at  timestamptz,

  -- Visibility, so private drafts and private research projects stay private as the plan requires.
  is_public     boolean not null default false,
  licence       text,
  rights_note   text,

  -- The current version pointer, set on every version write.
  current_version integer not null default 0,

  -- Search, generated so it cannot drift from what it indexes.
  search_vector tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(abstract, '')), 'B')
                ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ozikoro_publication_published_consistent
    check ((status = 'published') = (published_at is not null)),
  constraint ozikoro_publication_peer_review_consistent
    check (not peer_reviewed or status in ('published','archived'))
);

comment on table ozikoro_publication is
  'A work submitted to the research network, with its authors, files, versions and review history. '
  'Distinct from ozikoro_article, which is an archive record rather than an authored submission.';
comment on column ozikoro_publication.peer_reviewed is
  'True only when the work completed expert review. Set by the transition out of expert_review and '
  'by nothing else, so "peer-reviewed" is a record of what happened rather than a label applied.';

-- ---------------------------------------------------------------------------
-- Authors and affiliations
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_publication_author (
  id             bigserial primary key,
  publication_id bigint not null references ozikoro_publication(id) on delete cascade,
  -- Either a member of this platform, or an external co-author with no account. Both are normal:
  -- a paper's co-author may never have signed up here.
  account_id     bigint references account(id) on delete set null,
  name           text not null,
  affiliation    text,
  department     text,
  orcid          text,
  email          text,
  -- Authorship order is meaningful and disputed in equal measure, so it is explicit.
  position       integer not null default 0,
  is_corresponding boolean not null default false,
  created_at     timestamptz not null default now()
);

comment on table ozikoro_publication_author is
  'One author of a work, in order. A co-author with no account here is a first-class case: most '
  'papers arriving from outside the platform will have them.';

create index if not exists ozikoro_pub_author_idx on ozikoro_publication_author (publication_id, position);
create index if not exists ozikoro_pub_author_account_idx on ozikoro_publication_author (account_id);

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------
/*
 * Every version is kept rather than the published manuscript being overwritten, because the plan
 * requires it and because the alternative is not a research repository. A reader citing version 2
 * must be able to read version 2 after the author revises it.
 */
create table if not exists ozikoro_publication_version (
  id             bigserial primary key,
  publication_id bigint not null references ozikoro_publication(id) on delete cascade,
  version        integer not null,
  title          text not null,
  abstract       text,
  -- The manuscript as it stood. Text for now so a version is readable without a file download;
  -- the uploaded file is separate and may be the same thing rendered.
  body_markdown  text,
  change_note    text,
  created_by     bigint references account(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (publication_id, version)
);

comment on table ozikoro_publication_version is
  'An immutable snapshot of a work at a point in time. Published versions are never overwritten, so '
  'a citation to an older version keeps resolving to what was actually published.';

create index if not exists ozikoro_pub_version_idx on ozikoro_publication_version (publication_id, version desc);

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_publication_file (
  id             bigserial primary key,
  publication_id bigint not null references ozikoro_publication(id) on delete cascade,
  version        integer,
  role           text not null default 'manuscript' check (role in ('manuscript','supplementary','dataset','figure','cover')),
  filename       text not null,
  mime_type      text not null,
  size_bytes     bigint not null,
  -- Where the bytes are. Object storage; this row is the record of them.
  storage_key    text not null,
  checksum       text,
  uploaded_by    bigint references account(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table ozikoro_publication_file is
  'A file belonging to a work: the manuscript or a supplement. The bytes live in object storage; '
  'this row carries the type, the size and the checksum that make it verifiable.';

create index if not exists ozikoro_pub_file_idx on ozikoro_publication_file (publication_id, role);

-- ---------------------------------------------------------------------------
-- The workflow, as transitions rather than a status somebody sets
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_publication_review (
  id             bigserial primary key,
  publication_id bigint not null references ozikoro_publication(id) on delete cascade,
  version        integer not null,
  reviewer_id    bigint references account(id) on delete set null,
  -- What kind of review was asked for, which is what makes `expert_review` mean something.
  kind           text not null default 'expert' check (kind in ('editorial','expert','statistical','community')),
  recommendation text check (recommendation is null or recommendation in (
                   'accept','minor_revision','major_revision','reject','abstain')),
  comments       text,
  -- Private comments are for the editor, not the author. Two columns because a review that says one
  -- thing to the author and another to the editor is normal and must not be conflated.
  private_comments text,
  assigned_at    timestamptz not null default now(),
  completed_at   timestamptz,
  constraint ozikoro_review_complete_has_recommendation
    check (completed_at is null or recommendation is not null)
);

comment on table ozikoro_publication_review is
  'A review assigned to a person. The presence of a completed expert review is what the transition '
  'out of expert_review checks before it may mark a work peer-reviewed.';

create index if not exists ozikoro_pub_review_idx on ozikoro_publication_review (publication_id, completed_at desc);
create index if not exists ozikoro_pub_review_reviewer_idx on ozikoro_publication_review (reviewer_id, completed_at nulls first);

create table if not exists ozikoro_publication_transition (
  id             bigserial primary key,
  publication_id bigint not null references ozikoro_publication(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  actor_id       bigint references account(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now()
);

comment on table ozikoro_publication_transition is
  'Every state change a work has been through, in order. This is the record that makes the status '
  'column checkable rather than merely set, and it is what a reader is shown when a work claims to '
  'have been reviewed.';

create index if not exists ozikoro_pub_transition_idx on ozikoro_publication_transition (publication_id, created_at);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists ozikoro_pub_search_idx  on ozikoro_publication using gin (search_vector);
create index if not exists ozikoro_pub_status_idx  on ozikoro_publication (status, published_at desc);
create index if not exists ozikoro_pub_public_idx  on ozikoro_publication (is_public, published_at desc) where status = 'published';
create index if not exists ozikoro_pub_discipline_idx on ozikoro_publication using gin (disciplines);
create index if not exists ozikoro_pub_keywords_idx on ozikoro_publication using gin (keywords);
