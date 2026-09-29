-- Editing a dictionary entry and a name, with a record of what they said before.
--
-- The owner's rule, extended from proverbs to the two things a reader is most likely to find
-- wrong: "on the name page, i need you to make it editable for contributors and users, just like
-- you made the proverbs page. also, the same in the dictionary section. editors should be able to
-- edit, and submit to admin for approval."
--
-- Same machinery as 0020: `suggestion` already is a proposed edit waiting for a decision. What is
-- added here is the record of the OLD text, because an entry edited in place loses what it used to
-- say, and a dictionary that cannot show its own previous wording cannot be argued with.
--
-- A word revision holds the meanings as one block of text rather than a diff of `definition` rows.
-- That is deliberate: the meanings are a numbered list a reader reads in order, and an edit is a
-- statement about the whole list ("these are the senses, in this order"), not about individual
-- rows. The block is recorded on both sides, so the previous list survives intact and an edit can
-- be reversed by hand.

alter table suggestion drop constraint if exists suggestion_kind_check;
alter table suggestion
  add constraint suggestion_kind_check
  check (kind in ('new_word', 'edit_word', 'new_definition', 'new_example',
                  'audio', 'correction', 'dialect', 'proverb_edit', 'word_edit', 'name_edit'));

create table word_revision (
  id                 bigserial primary key,
  word_id            bigint not null references word(id) on delete cascade,
  suggestion_id      bigint references suggestion(id) on delete set null,

  previous_headword  text not null,
  previous_meanings  text,

  headword           text not null,
  meanings           text,

  proposed_by        bigint references account(id) on delete set null,
  approved_by        bigint references account(id) on delete set null,
  approved_at        timestamptz not null default now()
);

create index word_revision_word_idx on word_revision (word_id, approved_at desc);

comment on table word_revision is
  'Every approved edit to a dictionary entry, with the headword and the whole meaning list it '
  'replaced. Written before the update, so nothing a source said is lost.';

create table name_revision (
  id                 bigserial primary key,
  person_name_id     bigint not null references person_name(id) on delete cascade,
  suggestion_id      bigint references suggestion(id) on delete set null,

  previous_name      text not null,
  previous_meaning   text,
  previous_gender    text,
  previous_variants  text[],

  name               text not null,
  meaning            text,
  gender             text,
  variants           text[],

  proposed_by        bigint references account(id) on delete set null,
  approved_by        bigint references account(id) on delete set null,
  approved_at        timestamptz not null default now()
);

create index name_revision_name_idx on name_revision (person_name_id, approved_at desc);

comment on table name_revision is
  'Every approved edit to a personal name — its spelling, meaning, gender and variants — with '
  'what it said before. The owner corrects names often, and each correction should be traceable.';
