-- Ozikoro's members: who someone is on this site, and what they may do.
--
-- WHY THIS IS NOT `account.role`
--
-- The platform already has a role on the account: contributor, editor, admin, owner. It is shared
-- with the dictionary and it answers one question — may this person review other people's work on
-- Ozituma. It cannot answer Ozikoro's questions, because Ozikoro's are different and plural:
--
--   * The plan names ten roles (Reader, Student, Teacher, Researcher, Independent Researcher,
--     Community Knowledge Holder, Editor, Expert Reviewer, Moderator, Admin), and eight of them have
--     no meaning on a dictionary.
--   * They are not a ladder. A person is a researcher AND a teacher; an expert reviewer is often
--     also an editor. A single column cannot hold that, and widening the shared enum to ten values
--     would put "Community Knowledge Holder" in front of the dictionary's code, which would have to
--     learn to ignore it.
--
-- So the account stays the login — one person, one account, three sites — and membership is
-- Ozikoro's own record of what that person is here. A member row without roles is a Reader, which is
-- what every signed-in account is by default, and the plan lists Reader as a role with real
-- capabilities (bookmarks, follows, collections, reading history), so it is a role rather than an
-- absence.
--
-- WHY ROLES ARE ROWS AND NOT AN ARRAY COLUMN
--
-- Because a grant needs to be attributable and reversible. "Who made this person an editor, and
-- when" is the question an audit asks, and an array column cannot answer it. One row per grant also
-- makes revocation a delete rather than a rewrite of somebody's whole role set.

-- ---------------------------------------------------------------------------
-- People who are something on Ozikoro
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_member (
  id            bigserial primary key,
  -- The platform account. One membership per account, ever.
  account_id    bigint not null unique references account(id) on delete cascade,

  -- Profile. All optional, because the plan is explicit that a legitimate independent or community
  -- researcher must not be forced to claim a university.
  display_name  text,
  headline      text,
  bio           text,
  -- Institution is free text rather than a foreign key for now. Institutions are an entity kind in
  -- the knowledge graph and will be linked there once they exist; forcing a table before it has any
  -- rows would block every early signup on data entry.
  institution   text,
  department    text,
  -- ORCID iD, which the plan asks for "where available". Not validated here: an ORCID is an
  -- identifier the person owns, and a checksum is not a substitute for ORCID's own verification.
  orcid         text,
  website       text,
  research_interests text[] not null default '{}',

  -- Whether the person is findable. Research profiles default to public because being found is the
  -- stated purpose of the research network; the plan also requires that private drafts and private
  -- projects stay private, which is a property of those records rather than of the profile.
  is_public     boolean not null default true,

  -- Workflow state for applications that need review (an expert reviewer or a moderator should not
  -- be self-service). 'active' is the ordinary state.
  status        text not null default 'active' check (status in ('active','pending','suspended')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ozikoro_member is
  'What an account is on ozikoro.com: a profile and a set of roles. The account itself is shared '
  'with the dictionary and the courses; this table is Ozikoro''s own record and says nothing about '
  'the person''s standing on the other two sites.';

-- ---------------------------------------------------------------------------
-- One row per role granted
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_member_role (
  id          bigserial primary key,
  account_id  bigint not null references account(id) on delete cascade,
  role        text not null check (role in (
                -- The plan's ten, in the order it lists them.
                'reader','student','teacher','researcher','independent_researcher',
                'community_knowledge_holder','editor','expert_reviewer','moderator','admin')),
  granted_at  timestamptz not null default now(),
  -- Nullable because the first administrator is granted by the migration, not by a person.
  granted_by  bigint references account(id) on delete set null,
  note        text,
  unique (account_id, role)
);

comment on table ozikoro_member_role is
  'Roles granted to an account on ozikoro.com. Several per person by design: a researcher is often '
  'also a teacher, and an expert reviewer is often also an editor. The grant is its own row so that '
  '"who made this person an editor" has an answer.';

create index if not exists ozikoro_member_role_role_idx on ozikoro_member_role (role);
create index if not exists ozikoro_member_role_account_idx on ozikoro_member_role (account_id);

-- ---------------------------------------------------------------------------
-- Claiming an author's byline
-- ---------------------------------------------------------------------------
/*
 * The 11 authors migrated from WordPress are attribution rows with no accounts, and they cannot be
 * anything else: WordPress exposes no password hash through any endpoint, so there is no credential
 * to carry across. The alternative to a claim flow is that the real authors of 1,051 records can
 * never be signed in as themselves.
 *
 * So a claim is a request, and it is reviewed. Auto-approval on a name match would be indefensible:
 * names are neither unique nor secret, and this archive is about specific people's work.
 */
create table if not exists ozikoro_contributor_claim (
  id             bigserial primary key,
  contributor_id bigint not null references ozikoro_contributor(id) on delete cascade,
  account_id     bigint not null references account(id) on delete cascade,
  -- What the claimant says connects them to the byline. Free text, read by a human.
  evidence       text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by     bigint references account(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  -- One open claim per person per byline; a rejected claim can be made again later.
  unique (contributor_id, account_id)
);

comment on table ozikoro_contributor_claim is
  'A request by an account to be recognised as the person behind a migrated byline. Reviewed by a '
  'human, because a name match is not evidence of identity and this archive is about specific '
  'people''s work.';

create index if not exists ozikoro_claim_status_idx on ozikoro_contributor_claim (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Roles the plan gives capabilities to, resolved in one place
-- ---------------------------------------------------------------------------
/*
 * Which roles may do editorial work. Held here rather than in application code so the database can
 * be asked the same question the server asks, and so a drift between the two is visible as a query
 * rather than as a bug.
 */
create table if not exists ozikoro_role_capability (
  role       text not null,
  capability text not null,
  primary key (role, capability)
);

comment on table ozikoro_role_capability is
  'What each Ozikoro role may do. A table because the plan describes capabilities per role and a '
  'reviewer of this schema should be able to read them without opening the TypeScript.';

insert into ozikoro_role_capability (role, capability) values
  ('reader','read'),
  ('reader','bookmark'),
  ('reader','collection'),
  ('student','read'),
  ('student','bookmark'),
  ('student','collection'),
  ('student','submit_work'),
  ('teacher','read'),
  ('teacher','bookmark'),
  ('teacher','collection'),
  ('teacher','submit_work'),
  ('researcher','read'),
  ('researcher','bookmark'),
  ('researcher','collection'),
  ('researcher','submit_work'),
  ('researcher','research_profile'),
  ('independent_researcher','read'),
  ('independent_researcher','bookmark'),
  ('independent_researcher','collection'),
  ('independent_researcher','submit_work'),
  ('independent_researcher','research_profile'),
  ('community_knowledge_holder','read'),
  ('community_knowledge_holder','bookmark'),
  ('community_knowledge_holder','collection'),
  ('community_knowledge_holder','contribute_oral_history'),
  ('community_knowledge_holder','contribute_media'),
  ('editor','read'),
  ('editor','edit_entity'),
  ('editor','manage_source'),
  ('editor','manage_claim'),
  ('editor','publish'),
  ('editor','review_queue'),
  ('expert_reviewer','read'),
  ('expert_reviewer','expert_review'),
  ('moderator','read'),
  ('moderator','moderate'),
  ('moderator','review_reports'),
  ('admin','read'),
  ('admin','edit_entity'),
  ('admin','manage_source'),
  ('admin','manage_claim'),
  ('admin','publish'),
  ('admin','review_queue'),
  ('admin','moderate'),
  ('admin','review_reports'),
  ('admin','manage_users'),
  ('admin','manage_roles'),
  ('admin','manage_media_rights'),
  ('admin','manage_ai_corpus'),
  ('admin','view_audit'),
  ('admin','export_data')
on conflict do nothing;
