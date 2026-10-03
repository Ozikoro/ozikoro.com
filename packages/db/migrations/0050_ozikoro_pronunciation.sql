-- ============================================================================
-- 0050 — HOW THE ARCHIVE SAYS A WORD: the pronunciation reference, and the queue
--        of words it cannot say yet.
-- ============================================================================
--
-- THE OWNER'S INSTRUCTION, VERBATIM
--
--   "...any words that is Igbo, you go to ozituma.com which is a subsidiary of ozikoro.com and pull out
--    the record, but if it is not there, you can dissect the words to see if it can also be found in
--    pieces, but if it can't, then it can go ahead to inform the admin, and editors, to upload or record
--    the words listed in the article in the website, which now pushes it to elevenlabs, and approved
--    before it produces any record, as to not waste credits."
--
-- THE MEASUREMENT THIS SCHEMA IS BUILT ON, TAKEN BEFORE IT WAS WRITTEN
--
--   word (published, ibo)                        8,728
--   word.pronunciation NOT NULL                      0
--   word.syllables    NOT NULL                       0
--   audio rows (any status)                          0
--   word_dialect rows                                0
--   word_form rows                                 453   (all form_type 'variant')
--
-- **So the dictionary holds the SPELLING of 8,728 Igbo words and not one pronunciation of any kind.**
-- The owner's pipeline assumes ozituma already holds the record and that the lookup will find it. It
-- does not, and no migration can invent it: a pronunciation is either recorded by a person or it is
-- fabricated, and a fabricated one would be spoken aloud in the owner's own cloned voice and sound
-- authoritative. This schema therefore has to work in the world that exists — a spelling archive — and
-- say so rather than assuming the richer world the instruction describes.
--
-- WHY ONE TABLE AND NOT TWO
--
-- The queue and the reference are one object at two points in one life: **the same word, with the same
-- article occurrences, that has no recording and then has one.** Migration 0046 records this reasoning
-- for the narration proposal — "a separate proposal table would hold a second copy and two copies of one
-- fact drift" — and the argument is stronger here, because the queue's whole purpose is that a word moves
-- out of it. A word that leaves the queue would otherwise have to be copied between tables at the moment
-- its state changed, which is the one moment correctness matters most.
--
-- WHAT A "RECORD" OF A WORD ACTUALLY IS, IN THIS SCHEMA
--
-- The dictionary's own answer, read from 0001_init.sql rather than assumed, is four things and they are
-- not equivalent evidence:
--
--   audio.storage_key / external_url   a real speaker, on a file      the best evidence there is
--   word.pronunciation                 "IPA or a practical respelling"  second
--   word.syllables                     a syllabification               weak
--   word.headword                      a bare spelling                 nearly useless to a TTS model
--
-- None of the first three is populated. The reference this migration defines therefore records WHICH
-- KIND of evidence it is, because the pipeline's honesty depends on never presenting the fourth as the
-- second: `kind` is a column rather than a convention.
--
-- WHY THE OCCURRENCES ARE A CHILD TABLE AND THE COUNT IS NOT A COLUMN
--
-- The owner's requirement is that an editor can see "whether it is worth recording", and the evidence for
-- that is *which articles* a word appears in. A `times_seen` integer on the word row would be a second
-- copy of a fact the child rows already hold, and the archive's own record (0035 on `ozikoro_audit`,
-- 0046's proposal note) is that two copies of one fact drift. The count is a GROUP BY away and the
-- article list is the thing the editor actually reads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE WORD, AND HOW THE ARCHIVE CAN SAY IT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ozikoro_pronunciation (
  id                bigserial PRIMARY KEY,
  uuid              uuid NOT NULL DEFAULT gen_random_uuid(),

  -- The word as an article spells it, and the folded key every lookup uses.
  --
  -- TWO COLUMNS AND NOT ONE, for the reason `word.exact_form`/`search_form` exist: the archive's articles
  -- are unaccented almost everywhere, so `ọdịnana` in a body and `odinana` in a title are the same word
  -- and must be ONE row. `search_form` is produced by the dictionary's own `toSearchForm`, never by a
  -- second implementation — see `packages/ozikoro/src/igbo-words.ts`.
  word              text NOT NULL,
  search_form       text NOT NULL,
  language_code     text NOT NULL DEFAULT 'ibo' REFERENCES language(code),

  -- WHAT KIND OF EVIDENCE THIS IS. The distinction the whole pipeline rests on.
  --
  --   human_recording   a person's voice, uploaded here or in the dictionary
  --   respelling        a phonetic respelling or IPA written by a person
  --   composed          assembled from parts the dictionary DOES hold — see 0050's dissection note
  --   dictionary_audio  a recording that lives on the dictionary's own `audio` row
  --
  -- **`composed` is the one that must never be mistaken for the others.** It is a lower grade of evidence
  -- by construction: the parts are recorded, the whole is inferred, and a listener cannot tell. It is a
  -- permitted and useful fallback and it is labelled everywhere it is used.
  kind              text NOT NULL DEFAULT 'human_recording'
                    CHECK (kind IN ('human_recording', 'respelling', 'composed', 'dictionary_audio')),

  -- The dictionary row this resolves to, when there is one. Null for a word ozituma does not hold.
  word_id           bigint REFERENCES word(id) ON DELETE SET NULL,

  -- THE RECORDING. Same two shapes `audio` uses, and for the same reason: the gated corpora give URLs,
  -- an upload gives bytes, and a reader should not have to know which.
  storage_key       text,
  external_url      text,
  mime_type         text,
  byte_size         bigint,
  duration_ms       integer,
  -- A phonetic respelling or IPA, as the person who made it wrote it. **Free text on purpose**: the
  -- dictionary's own column is documented as "IPA or a practical respelling", so constraining this to one
  -- alphabet would reject half of what a contributor can legitimately offer.
  respelling        text,

  -- FOR A COMPOSED PRONUNCIATION: the pieces it was assembled from, and the dictionary rows they hit.
  --
  -- JSON rather than a child table. A segmentation is an explanation of one decision, read as a whole or
  -- not at all; nothing will ever query "every word containing the piece `-kwu`". A table would add a join
  -- to every read for a fact nobody joins on.
  composed_of       jsonb,

  -- PROVENANCE: who recorded it, when, and who is speaking. A recording whose speaker nobody can name is
  -- a rights problem waiting to happen — 0004_audio.sql says so about the dictionary's table, and the
  -- same is true here.
  recorded_by       bigint REFERENCES account(id) ON DELETE SET NULL,
  recorded_at       timestamptz,
  speaker_name      text,
  source_note       text,

  -- THE STATE THE OWNER NAMED, exactly: unrecorded -> recorded -> approved, or rejected.
  --
  --   unrecorded  the archive cannot say this word. **Narration is blocked on it.**
  --   recorded    a person recorded it or wrote a respelling. Not yet usable as evidence.
  --   approved    a person with the capability said so. This is what unblocks the render.
  --   rejected    a person judged that it is not an Igbo word. Out of the queue for good.
  --
  -- A `composed` row sits at `unrecorded` — nothing has been recorded — and is read as sayable anyway,
  -- which is a property of the KIND and not of the state. Conflating the two would make the four states
  -- mean something other than what the owner said they mean.
  status            text NOT NULL DEFAULT 'unrecorded'
                    CHECK (status IN ('unrecorded', 'recorded', 'approved', 'rejected')),

  -- WHO NOTICED IT, and when. The owner asked for this in as many words.
  noticed_by        bigint REFERENCES account(id) ON DELETE SET NULL,
  noticed_at        timestamptz NOT NULL DEFAULT now(),

  -- THE DECISIONS, each with its own actor.
  --
  -- Separate columns rather than one `decided_by`, because recording and approving are two different
  -- people's acts and collapsing them erases the difference between "somebody said this word" and
  -- "somebody checked that they said it right" — the distinction migration 0046 makes between
  -- `proposed_by` and `approved_by`.
  decided_by        bigint REFERENCES account(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decision_note     text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- ONE ROW PER WORD PER LANGUAGE, folded. Without this a second sweep re-inserts every word and the
  -- article list is silently split across two rows that each look complete.
  UNIQUE (language_code, search_form)
);

COMMENT ON TABLE ozikoro_pronunciation IS
  'How the archive says one Igbo word: the queue entry before anything is recorded, and the pronunciation '
  'reference after. One row per word per language, folded, so a sweep re-run cannot duplicate it.';

COMMENT ON COLUMN ozikoro_pronunciation.kind IS
  'The evidence class. `composed` means assembled from parts the dictionary holds and must never be '
  'presented as a recording — a listener cannot tell the difference, so the record has to.';

COMMENT ON COLUMN ozikoro_pronunciation.status IS
  'unrecorded -> recorded -> approved, or rejected as not an Igbo word. Only `approved` unblocks a render.';

-- The sweep and the queue both read "not yet approved" first, so index it with the fold key.
CREATE INDEX IF NOT EXISTS ozikoro_pronunciation_open_idx
  ON ozikoro_pronunciation (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ozikoro_pronunciation_search_idx
  ON ozikoro_pronunciation (language_code, search_form);
-- The dictionary row, so "which of my queue entries does ozituma already know?" is an index scan.
CREATE INDEX IF NOT EXISTS ozikoro_pronunciation_word_idx
  ON ozikoro_pronunciation (word_id) WHERE word_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. WHERE THE WORD OCCURS.
--
-- This is the column that decides whether a word is worth recording: one that appears in forty articles
-- is worth a person's time, one in a single draft is not. The owner asked for it explicitly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ozikoro_pronunciation_occurrence (
  id               bigserial PRIMARY KEY,
  pronunciation_id bigint NOT NULL REFERENCES ozikoro_pronunciation(id) ON DELETE CASCADE,
  article_id       bigint NOT NULL REFERENCES ozikoro_article(id) ON DELETE CASCADE,
  -- How many times the word appears in THIS article. Kept because "once" and "nineteen times" are
  -- different answers to "is it worth recording", and the sum across articles is the queue's ordering.
  times            integer NOT NULL DEFAULT 1 CHECK (times > 0),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  -- The spelling as this article wrote it, which may differ from the headword by tone marks or case.
  -- **Recorded rather than normalised away**, because the editor recording the word needs to see how it
  -- is actually written where it is used.
  surface          text,

  UNIQUE (pronunciation_id, article_id)
);

CREATE INDEX IF NOT EXISTS ozikoro_pronunciation_occurrence_article_idx
  ON ozikoro_pronunciation_occurrence (article_id);
CREATE INDEX IF NOT EXISTS ozikoro_pronunciation_occurrence_word_idx
  ON ozikoro_pronunciation_occurrence (pronunciation_id);

COMMENT ON TABLE ozikoro_pronunciation_occurrence IS
  'Which articles a queue word appears in, and how often in each. The evidence for whether it is worth a '
  'person''s time to record it.';

-- ---------------------------------------------------------------------------
-- 3. SAY WHETHER A WORD BLOCKS A RENDER, IN THE DATABASE.
--
-- WHY A FUNCTION AND NOT A CONDITION IN APPLICATION CODE
--
-- The rule is the owner's credit-control mechanism: "approved before it produces any record, as to not
-- waste credits." **A rule that decides whether money is spent must have exactly one implementation.**
-- Migration 0043 makes this argument for capabilities — resolution moved into SQL because a second copy in
-- TypeScript is a copy that drifts — and 0044 makes it for the rank ladder. This is the third instance of
-- the same pattern and it is written here for the same reason: the review page, the sweep, the render
-- guard and the test all need this answer, and four readings of "is it approved" is three too many.
--
-- A composed row does NOT block. It is a real, usable, clearly-labelled fallback, and blocking on it would
-- mean an article could not be narrated until every one of its compound words had a studio recording —
-- which would stop the archive rather than protect it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ozikoro_pronunciation_blocks(p_status text, p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status <> 'approved' AND p_kind <> 'composed'
$$;

COMMENT ON FUNCTION ozikoro_pronunciation_blocks(text, text) IS
  'Whether one pronunciation row blocks a narration render. The owner''s credit-control rule, in one place. '
  'A composed pronunciation is usable and does not block; everything that is neither approved nor composed '
  'does.';

-- ---------------------------------------------------------------------------
-- 4. WHAT A PROPOSAL KNEW, AND WHAT THE OWNER DECIDED ABOUT IT.
--
-- The owner's rule is that a word the archive cannot pronounce must block or FLAG the article's narration,
-- never silently render a guess. And if the owner approves narration despite gaps, "the archive's rule is
-- that the record says what happened" — so the decision is a column on the episode, with an actor and a
-- time, and not a log line.
--
-- `pronunciation_gaps` is what was known WHEN THE PROPOSAL WAS MADE: the words, and how many articles each
-- appears in. **The render re-checks live**, because a word recorded and approved after a proposal must
-- unblock it without the proposal being thrown away — so this column is a record of the finding, not the
-- gate itself. Two different questions: "what did we know" and "may we render now".
-- ---------------------------------------------------------------------------
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS pronunciation_gaps      jsonb;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS pronunciation_waived_by  bigint REFERENCES account(id);
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS pronunciation_waived_at  timestamptz;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS pronunciation_waiver_note text;

COMMENT ON COLUMN ozikoro_episode.pronunciation_gaps IS
  'The unpronounceable words found when this narration was proposed, with their article counts. A record of '
  'what was known at proposal time; the render gate re-reads the live queue.';

COMMENT ON COLUMN ozikoro_episode.pronunciation_waived_by IS
  'The account that authorised narration despite unresolved words. NULL means nobody has, and the render '
  'refuses. The owner''s instruction is that this decision is recorded rather than merely taken.';

-- The sweep looks for episodes with unresolved gaps, so index the non-null case only.
CREATE INDEX IF NOT EXISTS ozikoro_episode_gaps_idx
  ON ozikoro_episode (status) WHERE pronunciation_gaps IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. WHAT A RENDER ACTUALLY COST, AS A NUMBER RATHER THAN A SENTENCE.
--
-- THE DEFECT THIS CLOSES
--
-- `renderProposedNarration` already measures the real charge: it reads `character_count` from the
-- subscription endpoint before and after the render and takes the difference. **And then it writes that
-- number into `ozikoro_episode_transition.note` — as prose.** Measured:
--
--     "Estimated 6,738 credits; the account recorded a charge of 6,738
--      (12,345 → 19,083 characters)."
--
-- That is a good sentence and it is not data. Nothing can sum it, nothing can compare it across renders, and
-- the question the owner actually has to answer — *"is the estimate of one credit per character TRUE, or has
-- it never been checked?"* — cannot be answered from a note without reading every note by eye.
--
-- `CREDITS_PER_CHARACTER = 1` is an assumption in `narration.ts` and it is labelled as one there. **These
-- columns are what let it stop being an assumption**, because the before/after figures are stored as numbers
-- beside the estimate they were meant to check. Zero renders have been measured so far, so the honest answer
-- today is "unverified" — and that answer is now computable rather than remembered.
-- ---------------------------------------------------------------------------
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS measured_credits    integer;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS measured_used_before integer;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS measured_used_after  integer;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS measured_at          timestamptz;

COMMENT ON COLUMN ozikoro_episode.measured_credits IS
  'The charge the API actually reported for this render, as the change in character_count across it. NULL '
  'means the allowance could not be re-read, so only the estimate exists. This is what corrects '
  'CREDITS_PER_CHARACTER from a guess into a measurement.';

-- The planner asks "which renders were measured?" — an index on the non-null case answers it without a scan.
CREATE INDEX IF NOT EXISTS ozikoro_episode_measured_idx
  ON ozikoro_episode (measured_at DESC) WHERE measured_credits IS NOT NULL;

