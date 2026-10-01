/**
 * Renderers for the sentence builder and the gap fill.
 *
 * Both follow the house pattern already used by `lesson-flow.tsx`: one dominant action, the Igbo in
 * the display face, feedback that names what was wrong rather than only that it was wrong.
 *
 * NO COLOUR-ONLY SIGNALS
 *
 * §12 of the spec and the accessibility rule in `AGENTS.md` both require it, and it is easy to get
 * wrong here because right/wrong is the whole interaction. So every state carries a WORD as well as
 * a colour — "Correct", "Not yet" — and the wrong-tile marker has an icon.
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/button';
import {
  firstWrongIndex,
  isSentenceCorrect,
  sameIgbo,
  shuffled,
  splitGap,
  type FillGapExercise,
  type SentenceBuilderExercise,
  type SentenceToken,
} from '@/lib/exercise-data';
import { cn } from '@/lib/utils';

/** The stage wrapper, so both exercises present identically in the lesson flow. */
function Stage({ title, instruction, children }: { title: string; instruction: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-bold uppercase text-muted-foreground">{title}</p>
      <h3 className="mt-1 font-display text-2xl font-semibold">{instruction}</h3>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function SentenceBuilder({
  exercise,
  onDone,
}: {
  exercise: SentenceBuilderExercise;
  onDone?: ((correct: boolean) => void) | undefined;
}) {
  // Distractors are shuffled in with the answer so their position carries no information.
  const bank = useMemo(
    () => shuffled([...exercise.answer, ...(exercise.distractors ?? [])], exercise.id),
    [exercise]
  );

  const [placed, setPlaced] = useState<SentenceToken[]>([]);
  const [checked, setChecked] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const remaining = useMemo(() => {
    // Counts, not identity: a sentence may legitimately repeat a word, and a set-based removal would
    // let the learner place it once and never again.
    const pool = [...bank];
    for (const token of placed) {
      const at = pool.findIndex((candidate) => candidate.text === token.text);
      if (at !== -1) pool.splice(at, 1);
    }
    return pool;
  }, [bank, placed]);

  const correct = isSentenceCorrect(placed, exercise.answer);
  const wrongAt = checked && !correct ? firstWrongIndex(placed, exercise.answer) : -1;

  return (
    <Stage title="Build the sentence" instruction={exercise.prompt}>
      {/* The learner's line. Empty slots show how much is left, so the length is not a surprise. */}
      <div className="flex min-h-16 flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-background p-3">
        {placed.length === 0 && <span className="text-sm text-muted-foreground">Tap the words below in order.</span>}
        {placed.map((token, index) => (
          <button
            key={`${token.text}-${index}`}
            onClick={() => {
              if (checked && correct) return;
              setPlaced((current) => current.filter((_, i) => i !== index));
              setChecked(false);
            }}
            className={cn(
              'rounded-md border px-3 py-2 text-sm font-bold transition',
              index === wrongAt ? 'border-destructive bg-destructive/10 text-destructive' : 'border-primary bg-secondary'
            )}
          >
            {token.text}
            {index === wrongAt && <span aria-label="wrong position"> ✕</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {remaining.map((token, index) => (
          <button
            key={`${token.text}-bank-${index}`}
            onClick={() => {
              setPlaced((current) => [...current, token]);
              setChecked(false);
            }}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold transition hover:-translate-y-0.5"
          >
            {token.text}
            {token.gloss && <span className="ml-2 text-xs font-normal text-muted-foreground">{token.gloss}</span>}
          </button>
        ))}
      </div>

      {checked && (
        <p className={cn('mt-4 text-sm font-bold', correct ? 'text-primary' : 'text-destructive')} role="status">
          {correct ? 'Correct.' : 'Not yet — the marked word is in the wrong place.'}
        </p>
      )}

      {/* §8 of the spec: show the answer only after a second miss, to encourage recall. */}
      {checked && !correct && attempts >= 2 && (
        <p className="mt-2 text-sm text-muted-foreground">
          The order is: <strong>{exercise.answer.map((t) => t.text).join(' ')}</strong>
        </p>
      )}

      {correct && exercise.note && <p className="mt-3 text-sm text-muted-foreground">{exercise.note}</p>}

      <div className="mt-5 flex gap-2">
        {!correct && (
          <Button
            disabled={placed.length !== exercise.answer.length}
            onClick={() => {
              setChecked(true);
              setAttempts((n) => n + 1);
              if (isSentenceCorrect(placed, exercise.answer)) onDone?.(true);
            }}
          >
            Check
          </Button>
        )}
        {correct && <Button onClick={() => onDone?.(true)}>Continue</Button>}
        <Button variant="ghost" onClick={() => { setPlaced([]); setChecked(false); }}>
          Clear
        </Button>
      </div>
    </Stage>
  );
}

export function FillTheGap({
  exercise,
  onDone,
}: {
  exercise: FillGapExercise;
  onDone?: ((correct: boolean) => void) | undefined;
}) {
  const parts = useMemo(() => splitGap(exercise.sentence), [exercise.sentence]);
  const options = useMemo(() => shuffled(exercise.options, exercise.id), [exercise]);

  const [choice, setChoice] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // A malformed exercise is a content bug, and drawing an empty gap would hide it.
  if (!parts) {
    return (
      <Stage title="Fill the gap" instruction="This exercise is malformed.">
        <p className="text-sm text-destructive">
          No gap marker (<code>___</code>) in this sentence. Reported to staff.
        </p>
      </Stage>
    );
  }

  const correct = choice !== null && sameIgbo(choice, exercise.answer);

  return (
    <Stage title="Fill the gap" instruction="Choose the missing word.">
      <p className="font-display text-2xl leading-relaxed">
        {parts.before}
        <span
          className={cn(
            'mx-1 inline-block min-w-24 border-b-2 px-2 text-center',
            checked ? (correct ? 'border-primary text-primary' : 'border-destructive text-destructive') : 'border-muted-foreground'
          )}
        >
          {choice ?? '\u00A0'}
        </span>
        {parts.after}
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => {
              setChoice(option);
              setChecked(false);
            }}
            className={cn(
              'min-h-12 rounded-md border px-4 text-left text-sm font-semibold transition',
              choice === option ? 'border-primary bg-secondary' : 'border-border bg-background hover:border-muted-foreground'
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {checked && (
        <p className={cn('mt-4 text-sm font-bold', correct ? 'text-primary' : 'text-destructive')} role="status">
          {correct ? 'Correct.' : 'Not yet.'}
        </p>
      )}

      {checked && !correct && attempts >= 2 && (
        <p className="mt-2 text-sm text-muted-foreground">
          The word is <strong>{exercise.answer}</strong>. {exercise.translation}
        </p>
      )}

      {correct && exercise.translation && (
        <p className="mt-3 text-sm text-muted-foreground">{exercise.translation}</p>
      )}

      <div className="mt-5 flex gap-2">
        {!correct && (
          <Button
            disabled={choice === null}
            onClick={() => {
              setChecked(true);
              setAttempts((n) => n + 1);
              if (choice !== null && sameIgbo(choice, exercise.answer)) onDone?.(true);
            }}
          >
            Check
          </Button>
        )}
        {correct && <Button onClick={() => onDone?.(true)}>Continue</Button>}
      </div>
    </Stage>
  );
}

/** Dispatch, so `lesson-flow` can render a heterogeneous list without knowing the shapes. */
export function LessonExerciseStage({
  exercise,
  onDone,
}: {
  exercise: SentenceBuilderExercise | FillGapExercise;
  onDone?: ((correct: boolean) => void) | undefined;
}) {
  if (exercise.kind === 'sentence-builder') return <SentenceBuilder exercise={exercise} onDone={onDone} />;
  return <FillTheGap exercise={exercise} onDone={onDone} />;
}
