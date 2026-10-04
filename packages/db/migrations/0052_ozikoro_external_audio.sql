-- 0052_ozikoro_external_audio.sql
--
-- WHERE THE AUDIO LIVES, WHEN IT DOES NOT LIVE HERE.
--
-- THE OWNER'S INSTRUCTION, VERBATIM
--
--   "there should be an option to add spotify audio link, instead of my own generated link. all these are
--    options"
--
-- `ozikoro_episode.external_url` has existed since 0045 and carries the address; what it cannot carry is
-- **which service the address belongs to, or whether it is a file at all.** Those are two different facts
-- and both are needed:
--
--   * THE SERVICE is what the reader is told. "This episode is on Spotify" is a statement about the record;
--     a bare URL presented beside a Listen button reads as our own file at somebody else's address, which is
--     the one thing the owner's rule forbids — *do not present a Spotify embed as our own recording.*
--
--   * WHETHER IT IS A DIRECT FILE decides the FEED. An RSS `<enclosure>` must be a directly playable audio
--     resource; `https://open.spotify.com/episode/…` is an HTML page and is not one. A feed that points an
--     enclosure at it is a feed a podcast client rejects or shows as unplayable, and **the failure appears in
--     the subscriber's app, not in our logs.** So the answer is measured once, when the link is saved, and
--     recorded here rather than guessed at feed-render time (which would also mean a network call per feed
--     request).
--
-- WHY THE MEASUREMENT IS A COLUMN AND NOT A CONVENTION
--
-- The archive's own recorded position, from 0035 and from 0046's proposal note: **two copies of one fact
-- drift.** `external_direct_audio` is not a second copy of the URL — it is the result of asking the URL what
-- it serves, which is a fact about the address at a moment in time and cannot be recomputed from the row.
-- `external_checked_at` and `external_check_note` are stored beside it for the same reason a render stores
-- `measured_credits`: a check whose result is presented as a fact must carry when it was made and what it
-- actually found. **Spotify answers a bot and a reader differently, and a check is a record of one request.**
--
-- WHY THE PAIR IS CONSTRAINED
--
-- A URL with no service is exactly the "stored, served and invisible" shape this archive has recorded four
-- times: a value that reaches a page and never reaches a reader as a statement. The CHECK makes the pair
-- atomic, so a future caller cannot set one without the other.

-- ---------------------------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------------------------
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS external_service     text;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS external_direct_audio boolean;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS external_checked_at  timestamptz;
ALTER TABLE ozikoro_episode ADD COLUMN IF NOT EXISTS external_check_note  text;

-- ---------------------------------------------------------------------------
-- 2. A backfill of facts that were already true.
--
-- Any row already carrying an `external_url` predates the service column. Its service is NOT guessed: the
-- honest value is `other`, which is what "a URL whose service was never recorded" means. There are none in
-- this cluster today; the line exists so that the pair CHECK below cannot fail on a database where one is,
-- and so nobody is tempted to drop the constraint instead.
-- ---------------------------------------------------------------------------
UPDATE ozikoro_episode
   SET external_service = 'other'
 WHERE external_url IS NOT NULL
   AND external_service IS NULL;

-- ---------------------------------------------------------------------------
-- 3. The vocabulary, by the name the database actually uses.
--
-- 0046 recorded why the constraint is found in `pg_constraint` rather than guessed: a guessed name makes
-- `DROP CONSTRAINT IF EXISTS` a no-op and the `ADD` then fails, or two contradictory checks coexist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozikoro_episode_external_service_check') THEN
    ALTER TABLE ozikoro_episode ADD CONSTRAINT ozikoro_episode_external_service_check
      CHECK (external_service IS NULL OR external_service IN ('spotify', 'apple_podcasts', 'youtube', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ozikoro_episode_external_pair_check') THEN
    ALTER TABLE ozikoro_episode ADD CONSTRAINT ozikoro_episode_external_pair_check
      CHECK ((external_url IS NULL) = (external_service IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ozikoro_episode_external_idx
  ON ozikoro_episode (external_service)
  WHERE external_url IS NOT NULL;

COMMENT ON COLUMN ozikoro_episode.external_service IS
  'Which service holds the audio when it is not held here: spotify, apple_podcasts, youtube or other. Set '
  'and cleared with external_url, never apart from it.';
COMMENT ON COLUMN ozikoro_episode.external_direct_audio IS
  'Whether a fetch of external_url returned an audio content type. An RSS enclosure must be a directly '
  'playable resource, so a page — a Spotify episode link — is false here and is not used as one. NULL means '
  'it was never checked, which the feed treats as not directly playable.';
COMMENT ON COLUMN ozikoro_episode.external_check_note IS
  'What the check of external_url actually established, in the archive''s own words — including "could not '
  'be checked", because a timeout is not evidence that the address is wrong.';
