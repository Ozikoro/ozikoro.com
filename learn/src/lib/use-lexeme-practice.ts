/**
 * Practice rounds built from the published dictionary.
 *
 * WHAT THIS REPLACES
 *
 * `practice-data.ts` is demonstration content: invented words with PLACEHOLDER meaning. Everything
 * a learner drills here now comes from `lexemes` where `status = 'published'` — the same Central
 * Igbo words the dictionary shows, with the meanings the dictionary gives them.
 *
 * WHY THIS IS NOT "GENERATING CONTENT"
 *
 * Nothing is written or translated here. A round is a PRESENTATION of two fields the dictionary
 * already holds — `headword` and `meaning` — in one of two directions:
 *
 *   meaning → type the Igbo   (production)
 *   Igbo    → choose the meaning (recognition)
 *
 * The distractors are other real entries' meanings, not invented ones. So every Igbo string a
 * learner sees is an approved dictionary headword, which is the rule that matters.
 *
 * WHY IT FALLS BACK
 *
 * If the database is unreachable the demo set is still used, because a practice screen that renders
 * nothing is worse than one that says it is showing a sample. The fallback is the CALLER's, so this
 * hook never silently substitutes invented words for real ones.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { ChoiceRound, PracticeRound, TypeRound } from '@/lib/practice-data';
// A VALUE import, separate from the type-only one above: `listenRound` is a factory, not a type.
import { listenRound, matchRound, orderRound, translateRound } from '@/lib/practice-data';

interface Lexeme {
  headword: string;
  meaning: string;
  audio_url: string | null;
  /**
   * The first attested example sentence and its translation, if the word has one.
   *
   * Fetched because a translate round must be built from a sentence the corpus CONTAINS. Composing
   * one would put the tutor's own "never invent language" rule at odds with the exercise engine, and
   * an exercise is not exempt from it.
   */
  example_ig: string | null;
  example_en: string | null;
}

/** Shuffle in place, Fisher-Yates. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Turn words into rounds.
 *
 * Half recognition, half production, alternating. Recognition first is deliberate: a learner meeting
 * `ịbụ` for the first time can choose its meaning, but cannot yet produce it — asking them to type a
 * word they have never seen is a test, not practice.
 */
export function buildRounds(words: readonly Lexeme[], count = 10): PracticeRound[] {
  const usable = words.filter((w) => w.headword.trim() && w.meaning.trim());
  if (usable.length < 4) return [];

  const pool = shuffle(usable).slice(0, Math.max(4, count));
  const rounds: PracticeRound[] = [];

  pool.forEach((word, index) => {
    /*
     * Every third round trains the EAR.
     *
     * Recognition and recall both show Igbo text, so a learner can pass a whole session
     * without ever understanding a spoken word - the skill they came for. A listen round is
     * inserted where the word has a recording, and skipped where it does not, because asking
     * someone to identify a word they cannot hear is not an exercise.
     *
     * `listenRound` owns that decision: it returns null for a silent word.
     */
    /*
     * A translate round on every fifth slot, when the pool holds enough translated
     * sentences to build real distractors. Wrong answers are other sentences' own
     * translations, never invented ones - a made-up distractor would teach a learner to
     * reject something that might be correct.
     */
    if (index % 5 === 4 && word.example_ig && word.example_en) {
      const distractors = shuffle(
        usable.filter((w) => w.example_en && w.example_en !== word.example_en).map((w) => w.example_en as string),
      ).slice(0, 3);
      /*
       * An order round on every seventh slot, from a sentence the corpus contains.
       *
       * Word order is grammar, so this must never be built from a composed sentence - a
       * made-up one would have the app teaching a pattern nobody has verified. `orderRound`
       * returns null for anything under three words, which are guessable.
       */
      if (index % 7 === 6 && word.example_ig) {
        /*
         * A match round on every eleventh slot.
         *
         * Built from the same published pool as everything else, so both halves are meanings the
         * dictionary gives. `matchRound` returns null below three pairs, because two can be
         * solved by elimination in a single tap.
         */
        if (index % 11 === 10) {
          const match = matchRound(pool);
          if (match) {
            rounds.push(match);
            return;
          }
        }

        const order = orderRound(word.example_ig, word.example_en);
        if (order) {
          rounds.push(order);
          return;
        }
      }

      const translate = translateRound(word.example_ig, word.example_en, distractors);
      if (translate) {
        rounds.push(translate);
        return;
      }
    }

    const listening = listenRound(word.headword, word.audio_url ?? null);
    if (index % 3 === 2 && listening) {
      rounds.push(listening);
      return;
    }

    if (index % 2 === 0) {
      // Recognition: the Igbo is shown, the learner picks the meaning.
      const distractors = shuffle(usable.filter((w) => w.headword !== word.headword))
        .slice(0, 3)
        .map((w) => w.meaning);

      const options = shuffle([word.meaning, ...distractors]).map((label) => ({
        icon: '',
        label: label.length > 90 ? `${label.slice(0, 87)}…` : label,
      }));

      const round: ChoiceRound = {
        kind: 'choice',
        prompt: word.headword,
        hint: 'Choose the meaning',
        options,
        correct: options.findIndex((o) => o.label.startsWith(word.meaning.slice(0, 40))),
      };
      // Only keep it if the correct option is findable — a round with `correct: -1` is unanswerable.
      if (round.correct >= 0) rounds.push(round);
    } else {
      // Production: the meaning is shown, the learner types the Igbo.
      const round: TypeRound = {
        kind: 'type',
        prompt: 'Type the Igbo',
        hint: 'Tone marks count',
        meaning: word.meaning.length > 90 ? `${word.meaning.slice(0, 87)}…` : word.meaning,
        answer: word.headword,
        hasAudio: Boolean(word.audio_url),
      };
      rounds.push(round);
    }
  });

  return rounds;
}

export interface LexemePractice {
  rounds: PracticeRound[];
  loading: boolean;
  /** True when the rounds came from the dictionary rather than the demo set. */
  fromDictionary: boolean;
}

/**
 * Fetch a random sample of published Central Igbo words.
 *
 * `order` cannot be random in PostgREST, so a random offset is used instead. It is not a perfect
 * uniform sample and does not need to be — the point is that a learner does not see the same ten
 * words in the same order every session.
 */
export async function fetchPracticeWords(limit = 24): Promise<Lexeme[]> {
  // The count first, so the random offset is inside the range rather than past the end.
  const head = await supabase
    .from('lexemes')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  const total = head.count ?? 0;
  if (total === 0) return [];

  const maxOffset = Math.max(0, total - limit);
  const offset = Math.floor(Math.random() * maxOffset);

  const { data, error } = await supabase
    .from('lexemes')
    .select('headword,meaning,audio_url,lexeme_examples(text_ig,text_en)')
    .eq('status', 'published')
    .order('headword')
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
return (data as unknown as Record<string, unknown>[]).map((row) => {
      const ex = ((row['lexeme_examples'] ?? []) as { text_ig: string; text_en: string | null }[]).find(
        (e) => e.text_ig && e.text_en,
      );
      return {
        headword: row['headword'] as string,
        meaning: row['meaning'] as string,
        audio_url: (row['audio_url'] ?? null) as string | null,
        example_ig: ex?.text_ig ?? null,
        example_en: ex?.text_en ?? null,
      } satisfies Lexeme;
    });
}

export function useLexemePractice(limit = 24): LexemePractice {
  const [rounds, setRounds] = useState<PracticeRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDictionary, setFromDictionary] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const words = await fetchPracticeWords(limit);
      if (cancelled) return;

      const built = buildRounds(words);
      if (built.length > 0) {
        setRounds(built);
        setFromDictionary(true);
      }
      // No `else`: an empty result leaves `rounds` as it was, and the caller decides whether to
      // fall back to the demo set. Substituting silently here is how invented words end up in
      // front of a learner without anybody noticing.
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { rounds, loading, fromDictionary };
}
