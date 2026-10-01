-- A picture for an account.
--
-- The owner: "one should be able to add profile picture/avatar, or change it."
--
-- Stored as a URL rather than as bytes, deliberately. An uploaded file needs somewhere to live that
-- survives a deploy — the web container is replaced on every build, and only /app/data and
-- /app/packages are preserved — so an upload would vanish without object storage this project does
-- not have yet. A URL is honest about that: it points at a picture that stays where it is.
--
-- Empty means "no picture set", and the interface falls back to a generated one rather than to a
-- broken image, which is what WordPress does with its mystery-person avatar.

alter table account add column if not exists avatar_url text;

comment on column account.avatar_url is
  'A URL to the account picture. Empty means none is set and the interface draws initials instead.';
