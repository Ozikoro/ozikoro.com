-- A dialect recording belongs to a dialect SPELLING, not just to the word.
--
-- Reported from the site: /word/igbo/oru-3 shows the Ajalị spelling
-- "ihe ọmụmụ" beside a play button, and the button played the recording of
-- "ọrụ". The cause is that a recording was attached to the word with a dialect
-- LABEL, and the entry page then matched it to a spelling by dialect NAME:
--
--   const clip = word.audio.find((a) => a.dialect === form.name);
--
-- That is fine while a dialect has one spelling for a word and silently wrong as
-- soon as it has two. Ajalị has two, and both have their own recording in the
-- corpus, so the chip for "ihe ọmụmụ" got whichever Ajalị row came first —
-- `ọrụ`, the other spelling. The page said one word and played another.
--
-- The schema already had the right column for this. `audio.word_dialect_id`
-- exists beside `word_id` and `example_id`, with a check constraint requiring
-- exactly one of the three, and it was simply never written to — the importer
-- attached dialect recordings to the word and threw the spelling away.
--
-- The existing duplicate guard is partial on `word_id is not null`, so it does
-- not cover a row owned by a dialect spelling. These two indexes close that gap
-- and give the read path something to join on.
--
-- This migration adds the indexes only. The data fix is a backfill, because
-- which spelling a stored recording belongs to can only be recovered from the
-- corpus it came from — the storage key is a hash of the source path, and the
-- source path is the only thing that knows.

create unique index if not exists audio_no_duplicate_dialect_recording
  on audio (word_dialect_id, coalesce(storage_key, ''), coalesce(external_url, ''))
  where word_dialect_id is not null;

create index if not exists audio_published_word_dialect_idx
  on audio (word_dialect_id)
  where status = 'published';

comment on column audio.word_dialect_id is
  'The dialect spelling this recording is OF, when it is a dialect recording. '
  'Set instead of word_id, never as well as it — the check constraint requires '
  'exactly one owner. Attaching a dialect recording to the word alone loses '
  'which spelling was recorded, which is how a chip for one spelling ended up '
  'playing another spelling''s audio on /word/igbo/oru-3.';
