-- Whether a sense may be used as a practice answer.
--
-- The owner was quizzed on "àrụ ụkwụ" and shown "leprosy" as the answer. The
-- gloss came from the source corpus, the quiz inherited it, and there was nothing
-- in the schema that could say "this one has not been checked" — so the honest
-- state of a sense had nowhere to live.
--
-- Two states, and only two:
--
--   practice_ok = true    the gloss is right, or was corrected to something right
--   practice_ok = false   a check could not confirm it: the word is dialectal,
--                         damaged, or unfamiliar. It stays on the entry — the
--                         dictionary is not a quiz and an uncertain gloss is still
--                         information — but it is never offered as an ANSWER,
--                         because a wrong answer is worse than no question.
--
-- Corrections themselves are not stored here: they are applied to `definition.text`
-- from the curated file, so the dictionary and the quiz agree by construction
-- rather than by two tables staying in step.

alter table definition
  add column if not exists practice_ok boolean not null default true;

comment on column definition.practice_ok is
  'False when a verification pass could not confirm this gloss. The sense stays '
  'on the entry; it is excluded from the practice quiz, which must not ask a '
  'question whose answer may be wrong.';

-- The quiz's access pattern: clean, confirmed, published senses of Igbo words.
create index if not exists definition_practice_idx
  on definition (language_code, word_id)
  where practice_ok and language_code = 'eng';
