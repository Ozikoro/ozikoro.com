import { AudioWaveform, Keyboard, Ear, MessagesSquare, Mountain, type LucideIcon } from "lucide-react";

export type PracticeOption = {
  icon: string;
  label: string;
};

export type ChoiceRound = {
  kind?: "choice";
  prompt: string;
  hint: string;
  options: readonly PracticeOption[];
  correct: number;
};

/** Typing round: the learner sees a meaning and types the Igbo word. */
export type TypeRound = {
  kind: "type";
  prompt: string;
  hint: string;
  meaning: string;
  answer: string;
  hasAudio?: boolean;
};

/*
 * NOTE — the engine has TWO round types, not six.
 *
 * `ChoiceRound` and `TypeRound` are what exists. The spec calls for six, and four more were drafted
 * here (listen, translate, order, match) and then REMOVED rather than left declared: a type with no
 * renderer compiles, appears in search results, and tells every later reader the feature exists when
 * it does not. The gap is real and is recorded in `docs/M0-findings-decisions-plan.md` instead, where
 * an unfinished item is supposed to live.
 */
/**
 * Listen round: hear the recording, then type the word.
 *
 * The ONLY round that trains the ear. Every other type shows the learner Igbo text, so a learner can
 * pass all of them while unable to understand a spoken word — which is the skill they actually came
 * for.
 *
 * It reuses the typing interaction deliberately: same input, same letter keys, same tone-mark rules.
 * The only difference is that the prompt is a recording instead of a written word, so there is no new
 * UI to learn and nothing about the answer-checking changes.
 *
 * A round is only generated for a word that HAS a recording. Asking a learner to identify a word they
 * cannot hear is not an exercise.
 */
export type ListenRound = {
  kind: "listen";
  prompt: string;
  hint: string;
  answer: string;
  /** The recording. A round is never generated without one. */
  audioUrl: string;
};

/**
 * Translate round: an Igbo PHRASE in, its meaning out.
 *
 * Distinct from `choice`, which shows a single word. This gives a full attested sentence and asks
 * what it means, so the learner has to hold more at once — the step between knowing words and
 * understanding a sentence.
 *
 * It reuses the choice interaction deliberately. The pedagogy differs, the answering does not, so
 * there is no second checking path to keep in step.
 *
 * A round is only generated from a sentence the corpus actually contains. Composing one would make
 * the tutor's own language rule apply to an exercise, and exercises are not exempt.
 */
export type TranslateRound = {
  kind: "translate";
  prompt: string;
  hint: string;
  /** The attested sentence, for the answer reveal. */
  source: string;
  options: readonly PracticeOption[];
  correct: number;
};

/**
 * Order round: arrange the words into a sentence.
 *
 * Built from an ATTESTED sentence in the corpus, not a composed one. That matters more here than in
 * any other round: word order is grammar, and a sentence the tutor made up would be the app teaching
 * a grammatical pattern nobody has verified. Every tile comes from a sentence the dictionary already
 * contains, and the answer IS that sentence.
 *
 * The shuffle is deterministic, and never coincidentally solved. A random order that happened to be
 * correct would let a learner press submit and pass without reading it.
 */
export type OrderRound = {
  kind: "order";
  prompt: string;
  hint: string;
  /** The corpus sentence in order. */
  answer: readonly string[];
  /** The same words, shuffled, never already in the right order. */
  tiles: readonly string[];
  meaning: string | null;
};

/**
 * Match round: pair each Igbo word with its meaning.
 *
 * The lesson player already has this as a stage; this brings it into free practice. Needs three
 * pairs minimum - two can be solved by elimination in one tap, which teaches nothing - and every
 * pair comes from a published entry, so both halves are meanings the dictionary gives.
 */
export type MatchRound = {
  kind: "match";
  prompt: string;
  hint: string;
  /** Igbo on the left, meaning on the right, in the same order. */
  pairs: readonly { ig: string; en: string }[];
};

export type PracticeRound = ChoiceRound | TypeRound | ListenRound | TranslateRound | OrderRound | MatchRound;

/**
 * A listen round, from a word that HAS a recording.
 *
 * Returns `null` rather than a round without audio, so the caller must decide what to do about a
 * silent word instead of shipping an unanswerable question. `fromLexemes` filters those out below.
 */
export const listenRound = (answer: string, audioUrl: string | null): ListenRound | null =>
  audioUrl
    ? {
        kind: "listen",
        prompt: "Listen, then type the word you heard.",
        hint: "Play it as many times as you need. Tone marks count.",
        answer,
        audioUrl,
      }
    : null;

/**
 * A translate round from an attested sentence and its translation.
 *
 * `distractors` must be real translations from other sentences — an invented wrong answer would
 * teach a learner to reject something that may be correct.
 */
export const translateRound = (
  sentence: string,
  translation: string,
  distractors: readonly string[],
): TranslateRound | null => {
  if (!sentence.trim() || !translation.trim() || distractors.length < 3) return null;
  const options = [translation, ...distractors]
    .slice(0, 4)
    .map((label) => ({ icon: "", label: label.length > 90 ? `${label.slice(0, 87)}…` : label }));
  return {
    kind: "translate",
    prompt: sentence,
    hint: "What does this sentence mean?",
    source: sentence,
    options,
    correct: options.findIndex((o) => o.label.startsWith(translation.slice(0, 40))),
  };
};

/**
 * An order round from an attested sentence.
 *
 * Words are split on whitespace and the tiles rotated by one position — the cheapest shuffle that
 * GUARANTEES the result differs from the answer. A genuine random shuffle has to be checked and
 * retried, which is more code for a worse guarantee.
 *
 * Needs at least three words: a two-word sentence is guessable, and "which comes first" is not a
 * useful question about it.
 */
export const orderRound = (sentence: string, meaning: string | null): OrderRound | null => {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  return {
    kind: "order",
    prompt: "Put the words in order.",
    hint: "Tap the words in the order they belong. Tap one above to send it back.",
    answer: words,
    // Rotated, not randomly shuffled: guaranteed different from the answer, and stable across visits.
    tiles: [...words.slice(1), words[0] as string],
    meaning,
  };
};

/** A match round from published words. Returns null below three pairs. */
export const matchRound = (words: readonly { headword: string; meaning: string }[]): MatchRound | null => {
  const usable = words.filter((w) => w.headword.trim() && w.meaning.trim()).slice(0, 4);
  if (usable.length < 3) return null;
  return {
    kind: "match",
    prompt: "Match each word to its meaning.",
    hint: "Tap a word on the left, then its meaning on the right.",
    // Meanings are trimmed: some run to a full sentence and overflow a tile.
    pairs: usable.map((w) => ({ ig: w.headword, en: w.meaning.length > 80 ? w.meaning.slice(0, 77) + "…" : w.meaning })),
  };
};

const typeRound = (meaning: string, answer: string): TypeRound => ({
  kind: "type",
  prompt: "Type this in Igbo.",
  hint: "Tone marks count. Use the letter keys below for ị, ọ, ụ, ṅ and tones.",
  meaning,
  answer,
  hasAudio: true,
});

export type PracticeFocus = {
  id: string;
  name: string;
  detail: string;
  minutes: number;
  icon: LucideIcon;
  rounds: readonly PracticeRound[];
};

/**
 * Guided lesson set: opened from the current lesson on the learner's path.
 * All learner-visible Igbo is placeholder until approved curriculum is connected.
 */
export const lessonRounds: readonly PracticeRound[] = [
  {
    prompt: "Which scene matches what you hear?",
    hint: "Listen first, then choose a scene tile.",
    options: [
      { icon: "👋", label: "PLACEHOLDER greeting" },
      { icon: "🏃", label: "PLACEHOLDER movement" },
      { icon: "🍲", label: "PLACEHOLDER meal" },
      { icon: "🏠", label: "PLACEHOLDER home" },
    ],
    correct: 0,
  },
  {
    prompt: "Choose the response that belongs next.",
    hint: "One tile keeps the exchange going.",
    options: [
      { icon: "☀️", label: "PLACEHOLDER response A" },
      { icon: "🤝", label: "PLACEHOLDER response B" },
      { icon: "🌙", label: "PLACEHOLDER response C" },
      { icon: "🧭", label: "PLACEHOLDER response D" },
    ],
    correct: 1,
  },
  {
    prompt: "Find the sound used in this exchange.",
    hint: "Match the sound, not the picture.",
    options: [
      { icon: "🥁", label: "PLACEHOLDER sound A" },
      { icon: "🗣️", label: "PLACEHOLDER sound B" },
      { icon: "🎶", label: "PLACEHOLDER sound C" },
      { icon: "👂", label: "PLACEHOLDER sound D" },
    ],
    correct: 3,
  },
  typeRound("PLACEHOLDER meaning — a greeting", "PLACEHOLDER"),
];

/**
 * Free practise sets: opened from the Practise menu. Deliberately separate from
 * the lesson path — these are repeatable drills, not curriculum progress.
 */
export const practiceFocuses: readonly PracticeFocus[] = [
  {
    id: "type",
    name: "Type it",
    detail: "See a meaning, type the Igbo word with its tone marks.",
    minutes: 3,
    icon: Keyboard,
    rounds: [
      typeRound("PLACEHOLDER meaning A", "PLACEHOLDER"),
      typeRound("PLACEHOLDER meaning B", "PLACEHOLDER"),
      typeRound("PLACEHOLDER meaning C", "PLACEHOLDER"),
    ],
  },
  {
    id: "ear",
    name: "Ear training",
    detail: "Hold a short line in memory and pick it out again.",
    minutes: 3,
    icon: Ear,
    rounds: [
      {
        prompt: "How many sounds did you hear?",
        hint: "Play the sample as many times as you need.",
        options: [
          { icon: "1️⃣", label: "PLACEHOLDER one" },
          { icon: "2️⃣", label: "PLACEHOLDER two" },
          { icon: "3️⃣", label: "PLACEHOLDER three" },
          { icon: "4️⃣", label: "PLACEHOLDER four" },
        ],
        correct: 1,
      },
      {
        prompt: "Which sample is the same one again?",
        hint: "Same line, different order.",
        options: [
          { icon: "🔁", label: "PLACEHOLDER repeat A" },
          { icon: "🔀", label: "PLACEHOLDER other A" },
          { icon: "🔈", label: "PLACEHOLDER other B" },
          { icon: "🎧", label: "PLACEHOLDER other C" },
        ],
        correct: 0,
      },
      {
        prompt: "Where did the line rise?",
        hint: "Rising, falling, or flat.",
        options: [
          { icon: "📈", label: "PLACEHOLDER rise" },
          { icon: "📉", label: "PLACEHOLDER fall" },
          { icon: "➖", label: "PLACEHOLDER flat" },
          { icon: "❓", label: "PLACEHOLDER unsure" },
        ],
        correct: 0,
      },
    ],
  },
  {
    id: "scenes",
    name: "Scene matching",
    detail: "Link a line to the moment it actually belongs to.",
    minutes: 4,
    icon: Mountain,
    rounds: [
      {
        prompt: "Which place fits what you hear?",
        hint: "Picture the surroundings.",
        options: [
          { icon: "🏠", label: "PLACEHOLDER home" },
          { icon: "🛒", label: "PLACEHOLDER market" },
          { icon: "🚌", label: "PLACEHOLDER travel" },
          { icon: "⛪", label: "PLACEHOLDER gathering" },
        ],
        correct: 1,
      },
      {
        prompt: "Who is speaking here?",
        hint: "Think about who answers whom.",
        options: [
          { icon: "🧑‍🤝‍🧑", label: "PLACEHOLDER friends" },
          { icon: "👩‍👧", label: "PLACEHOLDER family" },
          { icon: "🧑‍💼", label: "PLACEHOLDER stranger" },
          { icon: "🧒", label: "PLACEHOLDER child" },
        ],
        correct: 0,
      },
      {
        prompt: "What is happening right now?",
        hint: "Arriving, leaving, or asking.",
        options: [
          { icon: "🚪", label: "PLACEHOLDER arriving" },
          { icon: "👋", label: "PLACEHOLDER leaving" },
          { icon: "❔", label: "PLACEHOLDER asking" },
          { icon: "🙏", label: "PLACEHOLDER thanking" },
        ],
        correct: 2,
      },
    ],
  },
  {
    id: "responses",
    name: "Reply fast",
    detail: "Hear a line, then reach for the answer that fits.",
    minutes: 3,
    icon: MessagesSquare,
    rounds: [
      {
        prompt: "Which reply keeps the talk going?",
        hint: "Answer the line you heard.",
        options: [
          { icon: "✅", label: "PLACEHOLDER yes" },
          { icon: "🚫", label: "PLACEHOLDER no" },
          { icon: "🤔", label: "PLACEHOLDER maybe" },
          { icon: "🔇", label: "PLACEHOLDER silence" },
        ],
        correct: 0,
      },
      {
        prompt: "Someone greeted you. What comes back?",
        hint: "Greeting for greeting.",
        options: [
          { icon: "👋", label: "PLACEHOLDER greeting back" },
          { icon: "🍽️", label: "PLACEHOLDER offer" },
          { icon: "🕒", label: "PLACEHOLDER time" },
          { icon: "🛏️", label: "PLACEHOLDER rest" },
        ],
        correct: 0,
      },
      {
        prompt: "Which reply is too blunt here?",
        hint: "Notice the politeness.",
        options: [
          { icon: "🫖", label: "PLACEHOLDER polite A" },
          { icon: "🫗", label: "PLACEHOLDER polite B" },
          { icon: "⚡", label: "PLACEHOLDER blunt" },
          { icon: "🌼", label: "PLACEHOLDER polite C" },
        ],
        correct: 2,
      },
    ],
  },
  {
    id: "sounds",
    name: "Sound sorting",
    detail: "Sort the tricky Igbo sounds you keep meeting.",
    minutes: 4,
    icon: AudioWaveform,
    rounds: [
      {
        prompt: "Which tile carries this sound?",
        hint: "Listen for the shape in the mouth.",
        options: [
          { icon: "🌀", label: "PLACEHOLDER sound set A" },
          { icon: "🧊", label: "PLACEHOLDER sound set B" },
          { icon: "🔔", label: "PLACEHOLDER sound set C" },
          { icon: "🪘", label: "PLACEHOLDER sound set D" },
        ],
        correct: 3,
      },
      {
        prompt: "Which pair shares one sound?",
        hint: "Two lines, one shared sound.",
        options: [
          { icon: "🅰️", label: "PLACEHOLDER pair A" },
          { icon: "🅱️", label: "PLACEHOLDER pair B" },
          { icon: "🅾️", label: "PLACEHOLDER pair C" },
          { icon: "🆎", label: "PLACEHOLDER pair D" },
        ],
        correct: 1,
      },
      {
        prompt: "Which one does not belong?",
        hint: "Three share a sound, one does not.",
        options: [
          { icon: "🟢", label: "PLACEHOLDER member A" },
          { icon: "🟢", label: "PLACEHOLDER member B" },
          { icon: "🔴", label: "PLACEHOLDER outsider" },
          { icon: "🟢", label: "PLACEHOLDER member C" },
        ],
        correct: 2,
      },
    ],
  },
];

/** One activity pulled from every focus, for a mixed run. */
export const mixedRounds: readonly PracticeRound[] = practiceFocuses
  .map((focus) => focus.rounds[0])
  .filter((round): round is PracticeRound => round !== undefined);
