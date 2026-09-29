-- Editing a proverb, with a record of what it said before.
--
-- The owner's rule: a signed-in contributor may propose a change to any proverb —
-- its Igbo text and its English — and nothing goes live until an editor approves
-- it. The submission itself needs no new table: `suggestion` already carries a
-- kind, a payload, a submitter, a status and a reviewer, which is exactly a
-- proposed edit waiting for a decision.
--
-- What it does need is a record of the OLD text. A proverb that is edited in place
-- loses the words a source printed, and a dictionary that cannot show what it used
-- to say cannot be argued with. So an applied edit writes a row here first: the
-- text before, the text after, who proposed it and who approved it.

alter table suggestion drop constraint if exists suggestion_kind_check;
alter table suggestion
  add constraint suggestion_kind_check
  check (kind in ('new_word', 'edit_word', 'new_definition', 'new_example',
                  'audio', 'correction', 'dialect', 'proverb_edit'));

create table proverb_revision (
  id                bigserial primary key,
  example_id        bigint not null references example(id) on delete cascade,
  suggestion_id     bigint references suggestion(id) on delete set null,

  -- What the proverb said before the edit went through.
  previous_text      text not null,
  previous_translation text,

  -- What it says now, so a revision row is readable on its own.
  text               text not null,
  translation        text,

  proposed_by        bigint references account(id) on delete set null,
  approved_by        bigint references account(id) on delete set null,
  approved_at        timestamptz not null default now()
);

create index proverb_revision_example_idx on proverb_revision (example_id, approved_at desc);

comment on table proverb_revision is
  'Every approved edit to a proverb, with the text it replaced. Written before the '
  'update, so the previous wording is never lost and an edit can be reversed by hand.';
