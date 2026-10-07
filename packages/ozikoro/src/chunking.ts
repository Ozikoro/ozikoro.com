/**
 * Splitting a script into pieces a text-to-speech engine will accept.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A COPY
 *
 * This logic was written once, inside `apps/ozikoro/lib/elevenlabs.ts`, for the ElevenLabs limit. The
 * self-hosted engine at `apps/media` needs the same thing with a smaller ceiling — and **the failure mode of
 * writing a second version is not a compile error, it is a seam in the audio.** A character-count cut breaks a
 * sentence in half; the two halves are then spoken as one sentence with a join through it, and by the time
 * anyone hears it there is no record of where the cut was, so it cannot be repaired. Only the full script is
 * kept for this reason, and chunks are derived rather than stored.
 *
 * So the one implementation is here, both engines call it, and each passes the ceiling its own provider
 * actually enforces. **Neither engine may re-implement a cut.**
 */

/**
 * THE CEILING ELEVENLABS ENFORCES, MEASURED RATHER THAN GUESSED.
 *
 * A 11,418-character script was refused with
 *
 *   {"code":"text_too_long","message":"Request text length (11418) exceeds the maximum text length of
 *    10000 characters. Please use Studio for long form TTS."}
 *
 * **And that is an ordinary article.** The folklore collection that produced it is fourteen minutes read
 * aloud, so a pipeline that only handles ten thousand characters covers the shortest third of this archive.
 *
 * The ceiling is set below the real limit on purpose: **a chunk is measured in characters and the API measures
 * something close to them, but not the same thing**, and a chunk a few characters over fails the whole render.
 */
export const ELEVENLABS_MAX_CHARS = 9_000;

/**
 * THE CEILING THE SELF-HOSTED ENGINE USES.
 *
 * Not a provider limit — there is no provider. It is a *patience* limit. A flow-matching model on this
 * machine's CPU renders at roughly real time, so a five-thousand-character chunk is several minutes of
 * synthesis during which a failure loses everything after it. Smaller pieces mean a failed piece costs less
 * and each one can report progress.
 *
 * It stays well above the length of an ordinary paragraph, so the paragraph-boundary rule below is still what
 * decides almost every cut.
 */
export const LOCAL_MAX_CHARS = 600;

/**
 * Split a script into pieces the engine will accept, **at paragraph boundaries and never mid-sentence**.
 *
 * Cutting at a character count would break a sentence in half, and the two halves would be spoken as one
 * sentence with a seam through it — **audible, and impossible to fix afterwards, because the audio is the only
 * record of where the cut was.** A paragraph break is where a reader would pause anyway.
 *
 * A single paragraph longer than the ceiling is split at the last sentence end before it, and only if a
 * sentence is itself too long is the cut made mid-sentence — **which is stated rather than silent.**
 */
export function chunkScript(script: string, max = ELEVENLABS_MAX_CHARS): string[] {
  const paras = script.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paras) {
    if (para.length > max) {
      push();
      // A single enormous paragraph: break it at sentence ends.
      const sentences = para.match(/[^.!?]+[.!?]+["\u2019\u201d)]?\s*/g) ?? [para];
      for (const sentence of sentences) {
        if ((current + sentence).length > max) push();
        if (sentence.length > max) {
          // Even one sentence is too long. This is logged by the caller as a seam.
          for (let i = 0; i < sentence.length; i += max) {
            push();
            chunks.push(sentence.slice(i, i + max).trim());
          }
        } else {
          current += sentence;
        }
      }
      push();
      continue;
    }
    if ((current + '\n\n' + para).length > max) push();
    current += (current ? '\n\n' : '') + para;
  }
  push();
  return chunks;
}

/** One piece of a script, with the position of its cut stated so a caller can record it. */
export type ScriptChunk = {
  index: number;
  total: number;
  text: string;
  characters: number;
  /**
   * True when this piece had to be cut inside a sentence, because the sentence alone exceeded the ceiling.
   * **A seam, stated rather than silent** — the caller records it and the render reports it.
   */
  midSentenceSeam: boolean;
};

/**
 * Chunk a script and describe each piece.
 *
 * The seam flag is the reason this exists on top of `chunkScript`: a render that quietly cut a sentence would
 * be indistinguishable from one that did not, and this archive's rule is that the record says what happened.
 */
export function planScript(script: string, max: number): ScriptChunk[] {
  const texts = chunkScript(script, max);
  return texts.map((text, index) => {
    // A piece is a mid-sentence seam when it neither ends a sentence nor a paragraph, and it is not the last
    // piece — the last piece may simply end without punctuation.
    const isLast = index === texts.length - 1;
    const endsCleanly = /[.!?\u2026][")'\u2019\u201d]?$/.test(text.trim());
    return {
      index,
      total: texts.length,
      text,
      characters: text.length,
      midSentenceSeam: !isLast && !endsCleanly,
    };
  });
}
