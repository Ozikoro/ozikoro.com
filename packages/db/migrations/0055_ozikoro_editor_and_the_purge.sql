-- An editor may do everything the archive does, except destroy something for good.
--
-- THE OWNER'S RULE, VERBATIM
--
--   "an editor can approve every content, write any content, unpublish any content, and delete any content.
--    the only thing an editor can not do is to delete trash, but can recover or do anything, except deleting
--    trash. every content deleted will have to go to trash, unless permanently deleted from trash."
--
-- THE SHAPE THIS RULE HAS TO TAKE, AND WHY IT IS THE OPPOSITE OF A LIST OF ALLOWANCES
--
-- Every earlier version of this table granted capabilities positively: `editor` held a named set, and a
-- screen an editor could not reach was one whose capability was absent. **That shape cannot express this
-- rule.** "Everything except one thing" written as a list of grants is a list that is wrong the moment a
-- migration adds a capability, because the new one is absent from `editor` by default and the editor silently
-- loses access to something the owner said was theirs.
--
-- So the rule is written the other way round, and it is written where 0043 put the authority — in the
-- database, asked by every guard:
--
--   1. ONE capability expresses the prohibition, and it is named for the PROHIBITION rather than for a role:
--      **`purge_trash`**. A route that destroys something asks "may this caller purge?" — not "is this caller
--      an administrator?" — and **that is the difference between a rule that a new route inherits and a rule
--      a new route has to remember.** A route added tomorrow that forgets to ask is a route that refuses
--      nobody, which fails closed for the one act that cannot be undone; the opposite shape, a route that
--      asks "is this an editor?", fails OPEN when it is forgotten.
--   2. `editor` is granted EVERY capability the vocabulary holds, whatever that turns out to be, minus
--      `purge_trash`. The grant below reads the vocabulary out of this table rather than restating it, so
--      **a capability added by a later migration is held by an editor without this file being edited** —
--      provided the later migration grants it to somebody, which is what makes it exist.
--   3. `admin` and `owner` hold `purge_trash`. They are otherwise untouched: both already hold everything.
--
-- THE ONE THING THAT CANNOT BE UNDONE IS THE ONE THING WITHHELD, AND THAT IS THE WHOLE DESIGN
--
-- Every other act in this archive is reversible. A published record can be unpublished; an edit leaves the
-- text it replaced in `ozikoro_article_revision`; a delete moves a record to the trash, from which "an
-- editor can recover or do anything". **A purge is the only act with no undo**, so it is the only act a
-- capability gates, and it is gated by a capability that means exactly that. The verb is in the name so that
-- a reviewer reading `requireCapability('purge_trash')` at a call site cannot mistake what it permits.
--
-- WHY A NEW CAPABILITY RATHER THAN AN EXISTING ONE
--
-- `manage_users`, `manage_roles`, `moderate`, `manage_design`, `view_audit`, `manage_ai_corpus` and
-- `export_data` all exist and all mean something else. Reusing the nearest of them — `manage_users` is the
-- closest in standing — would make the refusal message say *"that needs the manage users permission"* to
-- somebody trying to empty a bin, and it would silently re-purpose a grant the owner may hand out for a
-- different reason. **A prohibition deserves its own word**, and this is the one row in this migration that
-- grants a capability rather than revoking one.
--
-- WHAT THE EDITOR GAINS AS A RESULT, NAMED SO THE BLAST RADIUS IS NOT DISCOVERED LATER
--
-- Reading the table as it stands, `editor` is granted, in addition to what it already held:
--
--   manage_media_rights   record a permission for a photograph or a recording — the archive's own comment
--                         used to call this "a legal matter, not editorial". The owner has overruled that:
--                         an editor may approve any content, and a rights record is what permits an item to
--                         be published at all. **This is the widest single grant in this migration and it is
--                         named in the round's report for that reason.**
--   manage_users          open and read the account list, suspend an account.
--   manage_roles          grant an archive role. BOUNDED ELSEWHERE AND NOT HERE: `ozikoro_role_may_grant`
--                         (migration 0044) permits only a role strictly below the actor's own rank, so an
--                         editor cannot mint an administrator — and that rule is enforced by the database
--                         rather than by a screen, so this grant does not weaken it.
--   moderate, review_reports, view_audit, export_data, manage_ai_corpus, manage_design
--                         the moderation queue, the audit trail, a whole-archive export, the dictionary
--                         corpus, and the served design.
--
-- **`manage_design` IS THE ONE THAT MAKES TWO ROUNDS DISAGREE, AND IT IS FLAGGED RATHER THAN SETTLED QUIETLY.**
-- A parallel round was asked, under an earlier and narrower instruction, whether the Appearance editor
-- should be admin-only; it answered yes. The instruction this migration implements says an editor may write
-- any content and everything is theirs except the purge, so the Appearance editor is the editor's too. See
-- the round's report: the two rounds must not both be right, and this file states which rule it obeyed.
--
-- NOTHING IS REVOKED FROM ANYBODY HERE. The narrow rule (an editor edits and approves articles only) was
-- drafted, not applied — no migration in this tree ever removed `manage_contributors` from `editor`, and this
-- file does not either. `editor` keeps `manage_claim`, which `/admin/claims` and `/api/claims` gate the
-- authorship-claim decision on.

-- 1. The prohibition, as a capability of its own.
insert into ozikoro_role_capability (role, capability) values
  ('admin', 'purge_trash'),
  ('owner', 'purge_trash')
on conflict do nothing;

-- 2. The editor, granted everything the vocabulary holds EXCEPT the prohibition.
--
-- Read out of the table rather than restated, so a capability added by a later migration and granted to
-- somebody is granted to an editor here without this file changing. `purge_trash` is already in the table by
-- the time this runs, and is excluded by name — which is the single line that expresses the owner's rule.
insert into ozikoro_role_capability (role, capability)
select 'editor', v.capability
  from (select distinct capability from ozikoro_role_capability) v
 where v.capability <> 'purge_trash'
on conflict do nothing;

-- 3. `edit_entity` and `publish` are re-asserted so that a database which somehow lost either regains it.
--    The owner's rule is not two capabilities any more, but those two are the ones every article path asks
--    for and stating them costs one conflict-free insert.
insert into ozikoro_role_capability (role, capability) values
  ('editor', 'edit_entity'),
  ('editor', 'publish')
on conflict do nothing;

comment on table ozikoro_role_capability is
  'What each Ozikoro role may do. A table because the plan describes capabilities per role and a reviewer of '
  'this schema should be able to read them without opening the TypeScript. Since migration 0055 the rule is '
  'stated as ONE PROHIBITION rather than as a list of allowances: an editor holds every capability except '
  'purge_trash, and admin and owner hold that as well. A route that destroys something asks for purge_trash; '
  'it does not ask what role the caller has.';
