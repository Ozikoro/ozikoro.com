-- New entries from contributors: a clan, a name, a proverb.
--
-- The owner: "Now, there should be an option for contributors to add new words, clans, names, or
-- proverbs."
--
-- A word was already there. The other three were not, and each of them is something a reader of this
-- site knows and the registry does not: the clan a family is from, the name a child was given, the
-- proverb a grandmother says. All three go in by the same road a word does — a suggestion row,
-- decided by an editor before it is published — so nothing an account types reaches a page without
-- somebody having looked at it.

alter table suggestion drop constraint if exists suggestion_kind_check;
alter table suggestion
  add constraint suggestion_kind_check
  check (kind in ('new_word', 'edit_word', 'new_definition', 'new_example',
                  'audio', 'correction', 'dialect', 'proverb_edit', 'word_edit',
                  'name_edit', 'clan_edit',
                  'new_clan', 'new_name', 'new_proverb'));

/*
 * The duplicate guard reads its subject out of the payload, and it only ever looked at `headword` —
 * the field a dictionary submission carries. A new clan, name or proverb has no `headword`, so the
 * expression folded to the empty string for all of them and two identical pending submissions were
 * both allowed through, which is the one thing this index exists to stop.
 *
 * The subject is named differently by kind, so it falls through the three names in order.
 */
drop index if exists suggestion_no_duplicate_pending;
create unique index suggestion_no_duplicate_pending
  on suggestion (
    coalesce(submitted_by, 0),
    kind,
    coalesce(language_code, ''),
    coalesce(target_word_id, 0),
    coalesce(payload ->> 'headword', payload ->> 'name', payload ->> 'text', '')
  )
  where status = 'pending';

comment on index suggestion_no_duplicate_pending is
  'One pending submission of the same kind per account, language, target and subject.';
