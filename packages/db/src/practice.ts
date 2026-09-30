/**
 * Practice question generation.
 *
 * The dictionary already contains everything a quiz needs: 12,467 headwords,
 * 14,984 definitions, 21,108 dialect spellings and 21,421 recordings. This
 * turns that data into questions.
 *
 * WHY DISTRACTOR QUALITY IS THE WHOLE PROBLEM
 *
 * A multiple-choice question is only worth asking if the wrong answers are
 * plausible. Picking four random definitions makes a quiz that a learner can
 * pass without knowing anything, because the wrong options are obviously
 * wrong — a 40-character English gloss next to three 3-letter ones is
 * answerable by shape alone.
 *
 * So distractors are chosen to match the answer on the axes a learner would
 * otherwise use as shortcuts:
 *
 *   - the same part of speech, so grammar cannot give it away
 *   - a similar definition length, so length cannot give it away
 *   - a similar headword length in listening mode, so spelling length cannot
 *   - never a word that shares a definition with the answer, since two valid
 *     answers is worse than an easy question
 *
 * For the dialect mode the distractors are dialects of the SAME language that
 * the word is not recorded in, which is the only genuinely hard version of that
 * question.
 *
 * ON TRUSTING THE CLIENT
 *
 * The answer id travels to the browser, so a determined learner can read it
 * before choosing. That is accepted here: this is a self-study tool with no
 * score, no leaderboard and no reward, so cheating only wastes the cheater's
 * time. When a leaderboard is added (see the roadmap), grading must move to the
 * server and the answer must stop being sent — noted in the roadmap rather than
 * silently left as a trap.
 */
import { requireLanguage } from '@ozituma/core';
import type { Db } from './client.ts';

/**
 * The modes.
 *
 * There was a third — `dialect`, which showed a dialect spelling and asked which dialect it
 * belonged to. The owner removed it: "On the practice part, I want you to not display any
 * other igbo dialect there that is not Central Igbo (Igbo Izugbe)." That mode was about
 * other dialects by definition, since a question with one answer cannot be about the
 * standard, so it went rather than being narrowed.
 */
export type PracticeMode = 'meaning' | 'listening';

export const PRACTICE_MODES: PracticeMode[] = ['meaning', 'listening'];

export const MODE_DESCRIPTIONS: Record<PracticeMode, string> = {
  meaning: 'See an Igbo word, choose its English meaning.',
  listening: 'Hear a recording, choose the word that was spoken.',
};

/**
 * Central Igbo only — Igbo Izugbe, the standard the dictionary is written in.
 *
 * A word is not tagged with a dialect; what a dialect row records is that some OTHER form of
 * this word is spelled that way in some other place. So the test for a standard headword is
 * that it is not itself recorded as a dialect spelling of a different entry: 1,098 published
 * words are, and they are the dialect forms. Everything in the dictionary that is not one of
 * those is the standard spelling, which is what a learner should be practising.
 *
 * Written once and used by every mode, so a mode cannot be added later that quietly offers a
 * dialect form beside a standard one.
 */
export const IZUGBE_ONLY_SQL = `not exists (
  select 1 from word_dialect wd
   where wd.word_id <> w.id and lower(wd.spelling) = lower(w.headword)
)`;

/** The same test, aliased, for queries that join the word table under another name. */
export function izugbeOnly(alias: string): string {
  return `not exists (
    select 1 from word_dialect wd
     where wd.word_id <> ${alias}.id and lower(wd.spelling) = lower(${alias}.headword)
  )`;
}

export class PracticeError extends Error {
  /** Set explicitly: without it every subclass reports its name as "Error". */
  override readonly name = 'PracticeError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const OPTION_COUNT = 4;

export interface PracticeOption {
  id: string;
  label: string;
  /** Present in listening mode so the option can be played before choosing. */
  audioUrl?: string | null;
}

export interface PracticeQuestion {
  mode: PracticeMode;
  language: string;
  /** What the learner is shown, before choosing. */
  prompt: string;
  /** A secondary line of context; empty for a bare headword. */
  promptSubtitle: string | null;
  /** A recording to play, for listening mode and whenever one exists. */
  promptAudioUrl: string | null;
  options: PracticeOption[];
  answerId: string;
  explanation: string | null;
}

/**
 * A "clean gloss" filter, applied identically to the answer AND the distractors.
 *
 * This was a real bug. The first version filtered the ANSWER for annotation
 * markers but not the distractors, so a question could offer "chimpanzee"
 * alongside "(fig.) individual" and "(-gu 1. count) used in". The answer was
 * identifiable by shape alone, without knowing any Igbo at all.
 *
 * The lesson generalises: when a filter like this matters, an asymmetry between
 * the answer and the distractors IS the giveaway. Hence one shared constant.
 *
 * Excluded shapes are the source corpus's editorial apparatus: cross-references
 * ("see e"), parenthetical labels ("(fig.)", "(compare ...)"), leading hyphens
 * marking verb stems, and numbered sub-senses ("1. count").
 */
const CLEAN_GLOSS_SQL = `
      d.text not like 'see %'
      and d.text not like '%(%'
      and d.text not like '%)%'
      and d.text !~ '[0-9]'
      and d.text !~ '^[-\u2013]'
      and d.text !~ '^='
      and d.text !~ '^"'
      -- Some glosses in the source corpus are actually example sentences
      -- ("Mkpi gbalu agba The he-goat is fully-grown"), which makes them
      -- identifiable at a glance. A capital letter anywhere after the first
      -- character is a reliable tell: a genuine gloss would have carried a
      -- bracket, and those are already excluded above.
      and substring(d.text from 2) !~ '[A-Z]'
      -- A gloss never starts with a capital.
      --
      -- The owner was shown "ada" with "salt" among the options and a recording
      -- of the wrong sense, and the deeper problem behind that report is what a
      -- learner was being offered as distractors at all. Measured on the live
      -- data: 232 glosses are proper nouns ("Asaba", "Christ", "Advent"), 142 are
      -- scientific names ("Cichlidae tenopoma kingsleyae", "Hemichromis
      -- fasciatus") and 164 are whole sentences ("The pot broke into two
      -- pieces"). Every one of those starts with a capital, and a real gloss in
      -- this corpus starts lower-case — "fall", "sunshine; heat of sun" — so this
      -- one line removes all three classes.
      and d.text ~ '^[a-z]'
      -- A pipe means the field holds Igbo AND its English ("Nwa mpe kà ọ bù | He
      -- is smallish"): two entries welded together by whichever import ran last.
      and d.text not like '%|%'
      -- Anything carrying Igbo diacritics is Igbo text sitting in the English
      -- column, so it cannot be an option for a learner reading English.
      and d.text !~ '[ịọụẹṅỊỌỤẸṄ]'
      -- A dialect sense is not a meaning of the Igbo word; it is what a different
      -- language's word means. Ẹkpẹyẹ's "aɗa = salt" is a correct entry for
      -- Ẹkpẹyẹ and a wrong answer for an Igbo learner, who reads aɗa as ada.
      and d.label is null
      -- A sense a verification pass could not confirm is not offered as an answer.
      and d.practice_ok
      and length(d.text) between 3 and 48
`;

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Resolve a storage-backed recording to a URL.
 * Local driver yields /media/<key>; S3 yields a bucket or CDN URL.
 */
async function audioUrlFor(storageKey: string | null, externalUrl: string | null): Promise<string | null> {
  if (externalUrl) return externalUrl;
  if (!storageKey) return null;
  const { getStorage } = await import('./storage.ts');
  return getStorage().publicUrl(storageKey);
}

// ---------------------------------------------------------------------------
// Meaning mode: Igbo word -> English definition
// ---------------------------------------------------------------------------

async function meaningQuestion(db: Db, language: string): Promise<PracticeQuestion | null> {
  // The answer must have a definition and, ideally, audio — a word you can also
  // hear teaches pronunciation for free.
  const answer = await db.one<{
    id: string;
    headword: string;
    gloss: string;
    pos_id: string | null;
    gloss_len: number;
    storage_key: string | null;
    external_url: string | null;
  }>(
    `select w.id, w.headword, d.text as gloss, d.part_of_speech_id as pos_id,
            length(d.text) as gloss_len,
            a.storage_key, a.external_url
       from word w
       join definition d on d.word_id = w.id and d.language_code = 'eng'
       left join audio a on a.word_id = w.id and a.status = 'published'
      where w.language_code = $1
        and w.status = 'published'
        -- The prompt has to be a word a learner would recognise. Headwords that
        -- begin with a hyphen are verb stems ("-bu"), and ones containing an
        -- equals sign or bracket are cross-references — both are dictionary
        -- apparatus, not entries someone can be quizzed on.
        and w.headword !~ '^[-\u2013=]'
        and w.headword not like '%(%'
        and w.headword not like '%=%'
        and length(w.headword) >= 3
        and ${CLEAN_GLOSS_SQL}
        -- Central Igbo only: a dialect form is not a word to test a learner on.
        and ${IZUGBE_ONLY_SQL}
      order by random()
      limit 1`,
    [language]
  );
  if (!answer) return null;

  // Distractors: same grammar category, comparable length, different word, and
  // not sharing a definition with the answer.
  const distractors = await db.rows<{ id: string; headword: string; gloss: string }>(
    `select distinct on (d.text) w.id, w.headword, d.text as gloss
       from word w
       join definition d on d.word_id = w.id and d.language_code = 'eng'
      where w.language_code = $1
        and w.status = 'published'
        and w.id <> $2
        and d.text <> $3
        and (d.part_of_speech_id = $4 or $4 is null)
        and abs(length(d.text) - $5) <= 12
        -- The SAME cleanliness filter as the answer, so the answer cannot be
        -- told apart from the distractors by its shape.
        and ${CLEAN_GLOSS_SQL}
        and not exists (
          select 1 from definition d2
           where d2.word_id = $2 and d2.text = d.text
        )
      order by d.text, random()
      limit $6`,
    [language, answer.id, answer.gloss, answer.pos_id, answer.gloss_len, OPTION_COUNT * 3]
  );

  if (distractors.length < OPTION_COUNT - 1) return null;

  const chosen = shuffled(distractors).slice(0, OPTION_COUNT - 1);
  const options: PracticeOption[] = shuffled([
    { id: String(answer.id), label: answer.gloss },
    ...chosen.map((d) => ({ id: String(d.id), label: d.gloss })),
  ]);

  return {
    mode: 'meaning',
    language,
    prompt: answer.headword,
    promptSubtitle: 'What does this mean?',
    promptAudioUrl: await audioUrlFor(answer.storage_key, answer.external_url),
    options,
    answerId: String(answer.id),
    explanation: null,
  };
}

// ---------------------------------------------------------------------------
// Listening mode: recording -> Igbo word
// ---------------------------------------------------------------------------

async function listeningQuestion(db: Db, language: string): Promise<PracticeQuestion | null> {
  const answer = await db.one<{
    id: string;
    headword: string;
    exact_form: string;
    storage_key: string | null;
    external_url: string | null;
    headword_len: number;
  }>(
    `select w.id, w.headword, w.exact_form, a.storage_key, a.external_url,
            length(w.headword) as headword_len
       from word w
       join audio a on a.word_id = w.id and a.status = 'published'
      where w.language_code = $1
        and w.status = 'published'
        -- Parentheses are load-bearing: without them this parses as
        -- (… AND storage_key IS NOT NULL) OR external_url IS NOT NULL, which
        -- would pull in audio rows belonging to other languages.
        and (a.storage_key is not null or a.external_url is not null)
      order by random()
      limit 1`,
    [language]
  );
  if (!answer) return null;

  const promptAudio = await audioUrlFor(answer.storage_key, answer.external_url);
  // Without playable audio this mode is impossible, so fail rather than show a
  // silent question.
  if (!promptAudio) return null;

  // Distractors matched on headword length, so the options cannot be told apart
  // by how long they are — the shape of a word is a real shortcut in Igbo,
  // where long headwords are usually compounds.
  const distractors = await db.rows<{ id: string; headword: string }>(
    `select w.id, w.headword from word w
      where w.language_code = $1
        and w.status = 'published'
        and w.id <> $2
        and abs(length(w.headword) - $3) <= 4
        and w.headword not like '% %'
        -- The same headword-quality rule the answer obeys: a verb stem, a
        -- cross-reference or a fragment of a table is dictionary apparatus, and
        -- offering one as an option asks the learner to choose between four
        -- things of which two are not words.
        and w.headword !~ '^[-\u2013=(]'
        and w.headword ~ '^[A-Za-z\u00c0-\u024f\u1e00-\u1eff]'
        and length(w.headword) between 3 and 24
        and exists (
          select 1 from definition d
           where d.word_id = w.id and d.language_code = 'eng'
        )
      order by random()
      limit $4`,
    [language, answer.id, answer.headword_len, OPTION_COUNT * 3]
  );

  if (distractors.length < OPTION_COUNT - 1) return null;

  const chosen = shuffled(distractors).slice(0, OPTION_COUNT - 1);
  const options: PracticeOption[] = shuffled([
    { id: String(answer.id), label: answer.headword },
    ...chosen.map((d) => ({ id: String(d.id), label: d.headword })),
  ]);

  return {
    mode: 'listening',
    language,
    prompt: '🔊',
    promptSubtitle: 'Which word is being spoken?',
    promptAudioUrl: promptAudio,
    options,
    answerId: String(answer.id),
    explanation: null,
  };
}

// ---------------------------------------------------------------------------

/**
 * Build one question. Returns null when the language does not yet have enough
 * content for that mode, which is a real possibility for the 16 registered
 * languages with no corpus — the caller should say so rather than show a
 * broken question.
 */
export async function generateQuestion(
  db: Db,
  options: { mode: PracticeMode; language: string }
): Promise<PracticeQuestion | null> {
  const language = options.language;
  try {
    requireLanguage(language);
  } catch {
    throw new PracticeError('invalid_language', `"${language}" is not a language we serve.`);
  }

  switch (options.mode) {
    case 'meaning':
      return meaningQuestion(db, language);
    case 'listening':
      return listeningQuestion(db, language);
    default:
      throw new PracticeError('invalid_mode', `Unknown practice mode "${options.mode}".`);
  }
}

/** How many questions each mode can realistically generate, for the UI. */
export async function practiceAvailability(
  db: Db,
  language: string
): Promise<Record<PracticeMode, number>> {
  const row = await db.one<{ meaning: string; listening: string }>(
    // Both counts carry the Izugbe test, so the buttons appear only when there is enough
    // standard Igbo to build a question from.
    `select
       (select count(*)::int from word w
          join definition d on d.word_id = w.id and d.language_code = 'eng'
         where w.language_code = $1 and w.status = 'published'
           and length(d.text) between 3 and 48
           and ${IZUGBE_ONLY_SQL}) as meaning,
       (select count(distinct w.id)::int from word w
          join audio a on a.word_id = w.id and a.status = 'published'
         where w.language_code = $1 and w.status = 'published'
           and ${IZUGBE_ONLY_SQL}) as listening`,
    [language]
  );

  return {
    meaning: Number(row?.meaning ?? 0),
    listening: Number(row?.listening ?? 0),
  };
}
