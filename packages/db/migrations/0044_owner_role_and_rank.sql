-- 0044_owner_role_and_rank.sql
--
-- THE OWNER, AND THE RULE THAT STOPS AN ADMIN MAKING ONE.
--
-- WHY A ROLE ABOVE ADMIN EXISTS AT ALL
--
-- The archive's ten roles stop at `admin`, and `admin` holds `manage_roles`. **That means every administrator
-- can create another administrator, and no administrator can be removed by anyone but another administrator
-- of equal rank.** In an organisation with one proprietor and several staff that is the wrong shape: it makes
-- the staff collectively able to outvote the owner of the record.
--
-- So `owner` is added above `admin`, and roles are given a RANK. The rule is one line and it is the whole
-- point: **you may grant a role, and revoke a role, only if it ranks strictly below your own.** An admin can
-- appoint editors, moderators and researchers; an admin cannot appoint an admin and cannot touch the owner.
-- The owner can do both.
--
-- WHAT THIS DOES NOT DO
--
-- It does not make `owner` a superuser by fiat. The rank function decides who may grant what; **what an owner
-- may DO is still the capability set, and it is granted explicitly below** so that the dashboard a reader
-- sees, the API routes that check it and this table all agree. A rank that silently implied every capability
-- would be a second, differently-wrong definition of the same thing.

-- 1. The constraint must admit the new role, or the grant below cannot be written.
ALTER TABLE ozikoro_member_role DROP CONSTRAINT IF EXISTS ozikoro_member_role_role_check;
ALTER TABLE ozikoro_member_role ADD CONSTRAINT ozikoro_member_role_role_check
  CHECK (role = ANY (ARRAY[
    'reader', 'student', 'teacher', 'researcher', 'independent_researcher',
    'community_knowledge_holder', 'editor', 'expert_reviewer', 'moderator', 'admin', 'owner'
  ]));

-- 2. The rank. Higher may grant lower; equal may not grant equal.
CREATE OR REPLACE FUNCTION ozikoro_role_rank(r text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r
    WHEN 'owner'                     THEN 100
    WHEN 'admin'                     THEN 80
    WHEN 'moderator'                 THEN 60
    WHEN 'editor'                    THEN 55
    WHEN 'expert_reviewer'           THEN 50
    WHEN 'researcher'                THEN 40
    WHEN 'independent_researcher'    THEN 40
    WHEN 'community_knowledge_holder' THEN 40
    WHEN 'teacher'                   THEN 30
    WHEN 'student'                   THEN 20
    WHEN 'reader'                    THEN 10
    ELSE 0
  END;
$$;

-- 3. Whether one role may grant or revoke another. Strictly below, so an admin cannot mint an admin.
CREATE OR REPLACE FUNCTION ozikoro_role_may_grant(grantor text, target text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ozikoro_role_rank(grantor) > ozikoro_role_rank(target);
$$;

-- 4. The owner's capabilities, granted explicitly. Every capability the vocabulary has, because the owner is
--    the proprietor of the record — and stated as a list rather than as a wildcard so that adding a
--    capability to the vocabulary does NOT silently hand it to one person.
INSERT INTO ozikoro_role_capability (role, capability) VALUES
  ('owner', 'read'),
  ('owner', 'bookmark'),
  ('owner', 'collection'),
  ('owner', 'submit_work'),
  ('owner', 'contribute_media'),
  ('owner', 'contribute_oral_history'),
  ('owner', 'research_profile'),
  ('owner', 'review_queue'),
  ('owner', 'expert_review'),
  ('owner', 'review_reports'),
  ('owner', 'moderate'),
  ('owner', 'publish'),
  ('owner', 'manage_claim'),
  ('owner', 'manage_source'),
  ('owner', 'manage_media_rights'),
  ('owner', 'manage_contributors'),
  ('owner', 'manage_users'),
  ('owner', 'manage_roles'),
  ('owner', 'manage_ai_corpus'),
  ('owner', 'edit_entity'),
  ('owner', 'export_data'),
  ('owner', 'view_audit')
ON CONFLICT DO NOTHING;
