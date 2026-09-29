-- What a proverb needs beside its English rendering.
--
-- `example.translation` holds one English sentence and nothing else, which was
-- enough while the section was a list of Igbo-with-a-gloss. The proverbs design
-- reads a proverb the way an entry is read: a literal line, the meaning, the
-- wisdom behind it, and a theme. A theme is also what the section filters by.
--
-- Four columns, all nullable, because a source translation that came from a book
-- has none of them and must not be invented for it:
--
--   literal_translation      what the Igbo words say, kept as words
--   usage_note               when a speaker reaches for the proverb, and to what end
--   english_equivalent       the English proverb that carries the same point, when one exists
--   theme                    one of the eleven themes the section filters by
--   translation_confidence   high | medium | low — how settled the reading is
--
-- The confidence is recorded rather than used as a gate: a low-confidence
-- rendering is still published, because the alternative is a proverb with no
-- English at all, and its own text says so. The column exists so the number of
-- uncertain readings is visible instead of implied.

alter table example
  add column if not exists literal_translation    text,
  add column if not exists usage_note             text,
  add column if not exists english_equivalent     text,
  add column if not exists theme                  text,
  add column if not exists translation_confidence text;

alter table example
  drop constraint if exists example_translation_confidence_check;
alter table example
  add constraint example_translation_confidence_check
  check (translation_confidence is null or translation_confidence in ('high', 'medium', 'low'));

-- The section filters by theme, and the list is always "proverbs, published, in
-- this language, of this theme". Partial again, for the same reason as
-- example_proverb_idx: the other 26,000 examples never carry a theme.
create index if not exists example_proverb_theme_idx
  on example (language_code, theme, id)
  where style = 'proverb' and status = 'published';

comment on column example.literal_translation is
  'What the proverb''s words say, in English, as flatly as possible — not its meaning.';
comment on column example.usage_note is
  'When a speaker reaches for the proverb, and what it does in that situation.';
comment on column example.english_equivalent is
  'The English proverb or common saying that carries the same point, when one '
  'genuinely exists. Null for most proverbs: an invented twin is worse than none.';
comment on column example.theme is
  'One of the themes /proverbs filters by: Community, Character, Wisdom, '
  'Determination, Home, Gratitude, Memory, Life, Humility, Responsibility.';
comment on column example.translation_confidence is
  'How settled the English rendering is: high, medium or low. Low means the Igbo '
  'is corrupt or fragmentary, or the reading is a guess — the rendering says so itself.';
