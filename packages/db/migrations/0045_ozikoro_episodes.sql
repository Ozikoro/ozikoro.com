-- 0045_ozikoro_episodes.sql
--
-- SPOKEN RECORDS: an article read aloud, reviewed, and published as a podcast episode.
--
-- WHY A SEPARATE TABLE FROM `audio`
--
-- `audio` is the DICTIONARY's table: it hangs off `word_id`, `dialect_id` and `example_id` because a clip
-- there is a pronunciation of a word. **An episode is a different object** — it is a whole record or a
-- chapter of one, it has a narrator, a transcript, a review state and a distribution state, and none of that
-- belongs on a pronunciation clip. Sharing one table would mean every column nullable for both uses.
--
-- THE TWO RULES THAT SHAPED THIS SCHEMA
--
-- 1. NOTHING IS PUBLISHED WITHOUT A PERSON SAYING SO. `status` moves from `draft` to `approved` only by an
--    explicit transition recorded in `ozikoro_episode_transition`, with an actor and a time. **A pipeline that
--    publishes on its own is a pipeline that can publish a mistake to Spotify, and Spotify's rules put the
--    responsibility for the content on the publisher.**
--
-- 2. THE TRANSCRIPT IS NOT OPTIONAL. Spotify's own guidance for AI-generated podcasting recommends
--    disclosure, and a transcript is how a listener who cannot hear it, or who wants to check a claim, reads
--    the same words. **An episode without its transcript is not ready**, and the column is not null for that
--    reason rather than by oversight.
--
-- WHAT IS DELIBERATELY ABSENT
--
--   no `voice_id`                the narrator is a person or a named synthetic voice, recorded in
--                                `narrator_kind` and `narrator_name`, so the record says WHICH it was
--   no automatic `published_at`  a timestamp is written when a human approves, not when a job finishes

CREATE TABLE ozikoro_episode (
  id                    bigserial PRIMARY KEY,
  uuid                  uuid NOT NULL DEFAULT gen_random_uuid(),
  article_id            bigint NOT NULL REFERENCES ozikoro_article(id) ON DELETE CASCADE,
  slug                  text NOT NULL UNIQUE,
  title                 text NOT NULL,
  -- The spoken script, as approved. Kept verbatim so a re-render is reproducible.
  script                text NOT NULL,
  -- The same words as text, for the feed's <podcast:transcript> and for a reader who cannot hear it.
  transcript            text NOT NULL,
  summary               text,
  language_code         text NOT NULL DEFAULT 'en',

  -- WHO IS SPEAKING, stated rather than implied.
  narrator_kind         text NOT NULL CHECK (narrator_kind IN ('human', 'synthetic_own_voice', 'synthetic_generic')),
  narrator_name         text,
  -- **The disclosure is a column, not a convention.** Spotify's guidance and the RSS spec both expect the
  -- listener to be told, and a value here is what the feed prints.
  ai_disclosure         text NOT NULL,

  -- WHERE THE AUDIO IS.
  storage_key           text,
  external_url          text,
  mime_type             text,
  byte_size             bigint,
  duration_seconds      integer,

  -- THE REVIEW STATE.
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'withdrawn', 'failed')),
  approved_by           bigint REFERENCES account(id),
  approved_at           timestamptz,
  published_at          timestamptz,

  -- THE GENERATION, recorded so a re-render can be reproduced or explained.
  generator             text,
  generator_model       text,
  voice_settings        jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ozikoro_episode_article_idx ON ozikoro_episode (article_id);
CREATE INDEX ozikoro_episode_status_idx ON ozikoro_episode (status, published_at DESC);

-- Every render, kept. A redo is a new revision rather than an overwrite, so a rejected take can be returned to.
CREATE TABLE ozikoro_episode_revision (
  id                    bigserial PRIMARY KEY,
  episode_id            bigint NOT NULL REFERENCES ozikoro_episode(id) ON DELETE CASCADE,
  revision_number       integer NOT NULL,
  script                text NOT NULL,
  storage_key           text,
  external_url          text,
  byte_size             bigint,
  duration_seconds      integer,
  generator_model       text,
  voice_settings        jsonb,
  created_by            bigint REFERENCES account(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, revision_number)
);

-- Every state change, with who made it. **This is the audit trail Spotify's own rules imply**: if a claim is
-- made about an episode, this is where the answer is.
CREATE TABLE ozikoro_episode_transition (
  id                    bigserial PRIMARY KEY,
  episode_id            bigint NOT NULL REFERENCES ozikoro_episode(id) ON DELETE CASCADE,
  from_status           text,
  to_status             text NOT NULL,
  actor_account_id      bigint REFERENCES account(id),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- The show itself, so the feed's channel-level metadata is data rather than a constant in code.
CREATE TABLE ozikoro_podcast_show (
  id                    bigserial PRIMARY KEY,
  slug                  text NOT NULL UNIQUE DEFAULT 'ozikoro',
  title                 text NOT NULL,
  description           text NOT NULL,
  author                text NOT NULL,
  owner_email           text NOT NULL,
  language_code         text NOT NULL DEFAULT 'en',
  category              text NOT NULL DEFAULT 'History',
  explicit              boolean NOT NULL DEFAULT false,
  cover_storage_key     text,
  -- **Set once the show is registered with a host.** Until then the feed is served from this site, which is
  -- what Spotify ingests either way — a host is a convenience, not a requirement.
  host_feed_url         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ozikoro_podcast_show (slug, title, description, author, owner_email, category)
VALUES (
  'ozikoro',
  'Ozikoro — Histories read aloud',
  'Histories of Igbo and African communities, read aloud from the records held in the Ozikoro archive. Every episode states whether it is narrated by a person or by a synthetic voice, and the written record is the source.',
  'Ozi Ikoro Limited',
  'hello@ozikoro.com',
  'History'
) ON CONFLICT (slug) DO NOTHING;
