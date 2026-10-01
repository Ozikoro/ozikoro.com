-- Grant `manage_contributors`, which no role held.
--
-- THE DEFECT
--
-- Verified against the rebuilt database rather than assumed:
--
--     select role from ozikoro_role_capability where capability = 'manage_contributors';
--     -> no rows
--
-- The capability was in the vocabulary and on no role. The claim path is therefore unusable end to
-- end: an author can request a byline, an editor sees it waiting, and NOBODY — not an editor, not an
-- administrator — can decide it. The work sits pending forever.
--
-- This was found by exercising the path with a real `admin` account and being refused, then asking
-- the role table why instead of assuming the test had granted the wrong role. It had granted `admin`,
-- and `admin` genuinely did not carry it.
--
-- WHY THESE TWO ROLES
--
-- An authorship claim is a statement about who wrote a published record, so the capability belongs to
-- the people who answer for the archive's accuracy:
--
--   * `editor` — curates the archive, holds `review_queue` and the publication rights, and is the
--     person actually working through the migrated records.
--   * `admin`  — oversees the whole platform and must never be locked out of a decision.
--
-- Deliberately NOT granted to `moderator` (whose remit is conduct, not attribution),
-- `expert_reviewer` (who judges a work's merit, not its authorship), or any contributor role. A
-- byline is not a self-service field, which is the whole reason the claim is a request.

insert into ozikoro_role_capability (role, capability)
values ('editor', 'manage_contributors'), ('admin', 'manage_contributors')
on conflict do nothing;

comment on table ozikoro_role_capability is
  'Which capabilities each role holds. Every capability in the vocabulary must be held by at least '
  'one role: a capability granted to nobody is a feature that cannot be used by anyone, which is how '
  'manage_contributors was found.';
