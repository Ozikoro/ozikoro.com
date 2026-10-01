/**
 * Real audio for lesson cards.
 *
 * THE PROBLEM
 *
 * The lesson's Listen button was labelled "Play placeholder audio" and had no handler — it did
 * nothing at all. The cards carry `igbo` and `meaning`, but a card has no link to the dictionary,
 * so there was nothing to play.
 *
 * WHY IT LOOKS UP BY HEADWORD
 *
 * The honest fix is for a card to carry the `lexeme_id` it came from. It does not: `cards` is a
 * `jsonb` column written when the lesson was generated, and changing its shape means a migration
 * and re-generating every lesson.
 *
 * Matching on `headword` is the pragmatic bridge — the curriculum was built from these exact rows,
 * so the match is exact, not fuzzy. The weakness is real and worth stating: if two entries shared a
 * headword, this would pick one. `lexemes` has no unique constraint on `headword`, so that is
 * possible. It is why the map is built from `lexemes` first and then narrowed — a wrong match shows
 * a word's own recording, never an invented one.
 *
 * WHAT IT PLAYS
 *
 * Preference order, because the word recording is the most useful thing to hear when looking at a
 * word:
 *
 *   1. the word's own recording (`lexemes.audio_url`) — 467 words have one
 *   2. otherwise the first recorded example sentence — 1,083 words have one of those
 *
 * One request per lesson, not one per card.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CardAudio = Record<string, string>;

export function useCardAudio(headwords: readonly string[]): { audio: CardAudio; loading: boolean } {
  const [audio, setAudio] = useState<CardAudio>({});
  const [loading, setLoading] = useState(false);

  /*
   * The dependency is the joined list, not the array.
   *
   * A parent re-render passes a new array with the same contents, and depending on the identity
   * would refetch on every render. Joining makes the dependency the CONTENT.
   */
  const key = headwords.join('\u001f');

  useEffect(() => {
    const words = key ? key.split('\u001f').filter(Boolean) : [];
    if (words.length === 0) {
      setAudio({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      // 1. Resolve the cards to lexeme rows.
      const { data: lexemes } = await supabase
        .from('lexemes')
        .select('id,headword,audio_url')
        .eq('status', 'published')
        .in('headword', words);

      if (cancelled) return;

      const rows = (lexemes ?? []) as { id: string; headword: string; audio_url: string | null }[];
      const next: CardAudio = {};

      // The word's own recording wins.
      const needingExample: string[] = [];
      for (const row of rows) {
        if (row.audio_url) next[row.headword] = row.audio_url;
        else needingExample.push(row.id);
      }

      // 2. For the rest, take one example sentence each.
      if (needingExample.length > 0) {
        const { data: examples } = await supabase
          .from('lexeme_examples')
          .select('lexeme_id,audio_url,position')
          .eq('status', 'published')
          .in('lexeme_id', needingExample)
          .order('position');

        if (cancelled) return;

        // First example per lexeme — the ordered scan means the first write wins.
        const byLexeme = new Map<string, string>();
        for (const example of (examples ?? []) as { lexeme_id: string; audio_url: string | null }[]) {
          if (example.audio_url && !byLexeme.has(example.lexeme_id)) {
            byLexeme.set(example.lexeme_id, example.audio_url);
          }
        }

        for (const row of rows) {
          const found = byLexeme.get(row.id);
          if (found) next[row.headword] = found;
        }
      }

      if (!cancelled) {
        setAudio(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { audio, loading };
}

/**
 * Play a URL, ignoring failure.
 *
 * Browsers block audio that is not tied to a user gesture, and a recording can 404. Neither should
 * throw into React's render — a missing recording is a small disappointment, not an error state.
 *
 * `null` is accepted alongside `undefined` because both mean the same thing here: a database column
 * with no recording in it reads back as null, and a caller should not have to convert one absence
 * into the other before asking for silence.
 */
export function playAudio(url: string | null | undefined): void {
  if (!url) return;
  void new Audio(url).play().catch(() => undefined);
}
