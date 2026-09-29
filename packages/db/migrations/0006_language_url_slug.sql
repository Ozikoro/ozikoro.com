-- A language's URL slug, separate from its ISO 639-3 code.
--
-- The code stays the canonical key: 34,007 word rows reference `language_code`,
-- the v1 API contract is frozen against it, and ISO 639-3 is what other systems
-- can join on. But an ISO code is not a language name, and some of them are
-- actively disliked — `ibo` is a colonial-era spelling of Igbo that the ISO
-- register inherited, and `bin` is the same situation for Edo.
--
-- So URLs address languages by a readable slug and the internal key is left
-- alone. `igbo`, `edo`, `yoruba`, `hausa`, never `ibo`, `bin`, `yor`, `hau`.
--
-- Existing codes keep working on the way in: `?language=ibo` and
-- `/word/ibo/ulo` still resolve, then redirect to the slug form, so nothing that
-- linked to the site on its first day breaks.

alter table language add column if not exists url_slug text;

update language set url_slug = code where url_slug is null;

create unique index if not exists language_url_slug_idx on language (url_slug);

alter table language alter column url_slug set not null;
