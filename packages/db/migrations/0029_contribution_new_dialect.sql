-- A contributor can add a dialect, and so the word, and so the voice.

alter table suggestion drop constraint if exists suggestion_kind_check;
alter table suggestion
  add constraint suggestion_kind_check
  check (kind in ('new_word', 'edit_word', 'new_definition', 'new_example',
                  'audio', 'correction', 'dialect', 'proverb_edit', 'word_edit',
                  'name_edit', 'clan_edit',
                  'new_clan', 'new_name', 'new_proverb', 'new_dialect'));

comment on constraint suggestion_kind_check on suggestion is
  'Every kind the review queue can act on. A kind is added here at the same time as its '
  'handler, so a submission can never be stored in a shape nothing can apply.';
