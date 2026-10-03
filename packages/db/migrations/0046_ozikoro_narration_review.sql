-- 0046_ozikoro_narration_review.sql
--
-- THE PROPOSAL: the spoken script and its cost, decided before a single credit is spent.
--
-- THE DEFECT THIS CLOSES
--
-- Migration 0045 gave the archive a review state. `pending_review` exists, nothing reaches the feed without a
-- person moving an episode to `published`, and that gate is real. **But it is a gate on PUBLICATION, and the
-- owner's rule is a gate on SPENDING.** The render is the expensive act: `speak` sends the whole article to
-- ElevenLabs and is billed per character. A pipeline that renders first and asks afterwards has ALREADY spent
-- the credits the rule was written to protect, and an episode the owner then declines has bought nothing at
-- all. **So the approval has to come before `speak`, which means before `pending_review` even exists.**
--
-- Hence `proposed`: an episode that holds a script, a character count and a cost, with NO audio and NO charge.
-- A human reads it and decides.
--
--   proposed        the script is ready and costed; a credit has not been spent
--   declined        a person refused it; the sweep must not ask again
--   corrections     a rendered take was rejected and the script fixed; it must be rendered again
--
-- WHY STATUSES AND NOT A SECOND TABLE
--
-- A proposal and an episode are one object at two points in one life: the same article, the same script, the
-- same proposed voice — one row that grows its audio when it is approved. **A separate proposal table would
-- hold a second copy of `script`, and two copies of one fact drift.** It would also make every question about
-- an article's narration a union of two tables. The status column already carries the review state; a
-- proposal is simply what that state is before a render.
--
-- THE COST IS STORED, NOT RECOMPUTED
--
-- `char_count` and `estimated_credits` are columns rather than arithmetic performed while rendering a page,
-- because **the approval is a decision about a number**, and a number recalculated in a template is a number
-- nobody has a record of having approved. The stored estimate is the character count at the rate the
-- multilingual model bills (one credit per character); the real charge is confirmed afterwards against the
-- API's own allowance, and both appear in `ozikoro_episode_transition`.

-- ---------------------------------------------------------------------------
-- 1. The status vocabulary.
--
-- THE CONSTRAINT IS DROPPED BY THE NAME THE DATABASE ACTUALLY USES.
--
-- `ozikoro_episode_status_check` was read from `pg_constraint` rather than guessed from the column name. **A
-- guessed name makes `DROP CONSTRAINT` a no-op under `IF EXISTS`, and the `ADD` then fails with "constraint
-- already exists" — or worse, on a database where it did not exist, two contradictory checks coexist and the
-- narrower one silently wins.** The old definition listed draft, pending_review, approved, published,
-- withdrawn and failed; the three new states are the whole point of this migration.
-- ---------------------------------------------------------------------------
ALTER TABLE ozikoro_episode DROP CONSTRAINT IF EXISTS ozikoro_episode_status_check;
ALTER TABLE ozikoro_episode ADD CONSTRAINT ozikoro_episode_status_check
  CHECK (status = ANY (ARRAY[
    'draft', 'proposed', 'pending_review', 'corrections', 'approved', 'published', 'withdrawn', 'failed',
    'declined'
  ]));

-- ---------------------------------------------------------------------------
-- 2. What a proposal records about itself.
--
-- `proposed_by` and `proposed_at` are separate from `approved_by`/`approved_at` because they are two different
-- people's decisions: the sweep proposes with no account at all, and the approval is a named human spending
-- money. **Collapsing them into one pair would erase the difference between "a machine suggested this" and
-- "a person authorised the charge".**
-- ---------------------------------------------------------------------------
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS char_count        integer;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS estimated_credits integer;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS voice_choice      text;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS proposed_by       bigint REFERENCES account(id);
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS proposed_at       timestamptz;
-- The decision on the proposal (declined, or the note attached to a correction).
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS decided_by        bigint REFERENCES account(id);
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS decided_at        timestamptz;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS decision_note     text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ozikoro_episode_voice_choice_check'
  ) THEN
    ALTER TABLE ozikoro_episode ADD CONSTRAINT ozikoro_episode_voice_choice_check
      CHECK (voice_choice IS NULL OR voice_choice IN ('own', 'generic'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The sweep reads published articles with no episode, newest first.
--
-- The existing `ozikoro_episode_status_idx` is (status, published_at DESC); the sweep's question is the
-- inverse — "which articles have NO episode row at all" — so the anti-join wants the article side keyed.
-- `ozikoro_episode_article_idx` already covers that, and this adds the pair the review queue lists by.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ozikoro_episode_review_idx ON ozikoro_episode (status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 4. A backfill of facts that were already true.
--
-- The five episodes that exist were rendered before these columns did. Their script is on the row, so its
-- length is not an estimate — it is the character count, and it is what the render will have been billed for.
-- `voice_choice` is read from `narrator_kind`, which was recorded at render time. **Nothing is invented here:
-- every value is derived from a column that already held it**, and the alternative is a review screen showing
-- a blank cost for a charge that really was made.
--
-- `proposed_by`/`proposed_at` deliberately stay NULL: those renders predate the proposal step and no account
-- proposed them, and a fabricated proposer would be worse than an empty one.
-- ---------------------------------------------------------------------------
UPDATE ozikoro_episode
   SET char_count        = COALESCE(char_count, length(script)),
       estimated_credits = COALESCE(estimated_credits, length(script)),
       voice_choice      = COALESCE(
                             voice_choice,
                             CASE narrator_kind
                               WHEN 'synthetic_own_voice' THEN 'own'
                               WHEN 'synthetic_generic'   THEN 'generic'
                               ELSE NULL
                             END
                           )
 WHERE char_count IS NULL
    OR estimated_credits IS NULL
    OR voice_choice IS NULL;

-- ---------------------------------------------------------------------------
-- 5. THE CAPABILITY AN EDITOR IS GRANTED.
--
-- The owner's requirement is "an editor granted special access to the audio files" — access to audio review
-- AND NOTHING WIDER. The vocabulary was checked before a new entry was written:
--
--   manage_ai_corpus  exists, and is held by admin and owner only. It is about TRAINING voices (it gates
--                     /api/voice/pvc-initiate), and granting it to an editor would hand them the corpus and
--                     the voice-training spend. That is wider than audio review, so it is the wrong reuse.
--   review_queue      is the editorial queue for article facets, not for a rendered take.
--   expert_review     is a judgement about a work's merit, not about whether a recording may go out.
--   publish           is the right gate for the ARTICLE side of the archive, and an editor already holds it;
--                     it does not describe listening to a take.
--
-- So `review_audio` is a new capability, and it is deliberately narrow: it opens the audio review queue, the
-- raw download and the publish-a-rendered-episode act, and it opens nothing else.
--
-- WHO GETS IT
--
--   editor  the person doing the work the owner described
--   admin   must never be locked out of a decision (0042's lesson: a capability on no role is a feature
--           nobody can use, and one an admin lacks is a decision nobody can make)
--   owner   the proprietor of the record
--
-- Deliberately NOT granted to moderator (conduct, not recordings), expert_reviewer (merit, not audio),
-- researcher or any contributor role. Audio narration is not self-service.
-- ---------------------------------------------------------------------------
INSERT INTO ozikoro_role_capability (role, capability) VALUES
  ('editor', 'review_audio'),
  ('admin',  'review_audio'),
  ('owner',  'review_audio')
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN ozikoro_episode.estimated_credits IS
  'The cost shown to the approver before the render: the character count at one credit per character. The '
  'real charge is confirmed against the ElevenLabs allowance afterwards and recorded in the transition note.';
