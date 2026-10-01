/**
 * Guided lesson catalogue. Each lesson has three stages: word cards, a story
 * chat, then matching pairs, plus a culture note (spec F2/F9).
 * All learner-visible Igbo is PLACEHOLDER until approved curriculum is connected —
 * replace this file's data (or load it from the CMS) without touching screens.
 */
export type WordCard = { id: string; icon: string; igbo: string; meaning: string; note: string };
export type StoryTurn =
  | { speaker: "them"; name: string; avatar: string; line: string; meaning: string }
  | { speaker: "you"; prompt: string; options: readonly { text: string; meaning: string }[]; correct: number; why: string };

export type Lesson = {
  id: string;
  title: string;
  unit: string;
  scene: string;
  objective: string;
  cultureNote: string;
  cards: readonly WordCard[];
  story: readonly StoryTurn[];
  /**
   * §F5's sentence builder and gap fill, rendered after the matching stage.
   *
   * OPTIONAL, and deliberately so. Every lesson that exists today has no `exercises` and renders
   * exactly as before — the field is additive, so attaching real content to a lesson cannot break
   * the ones that do not have any yet. The stage order is fixed in `lesson-flow`, not here, because
   * the order is pedagogy rather than content.
   */
  exercises?: readonly import('./exercise-data').LessonExercise[];
};

export type Unit = { number: number; title: string; lessons: readonly Lesson[] };

type Seed = { icon: string; meaning: string; note: string };

function makeLesson(id: string, unit: string, title: string, scene: string, partner: { name: string; avatar: string }, seeds: readonly Seed[]): Lesson {
  const cards = seeds.map((s, i) => ({ id: `${id}-w${i + 1}`, icon: s.icon, igbo: `PLACEHOLDER ${s.meaning.toLowerCase()}`, meaning: `${s.meaning} (placeholder)`, note: s.note }));
  const story: StoryTurn[] = [];
  cards.forEach((c, i) => {
    if (i % 2 === 0) {
      story.push({ speaker: "them", ...partner, line: c.igbo, meaning: seeds[i]?.meaning ?? "" });
    } else {
      const wrong = cards.filter((x) => x.id !== c.id).slice(0, 2);
      const opts = [c, ...wrong].map((x) => ({ text: x.igbo, meaning: x.meaning.replace(" (placeholder)", "") }));
      const shift = i % 3;
      const rotated = opts.slice(shift).concat(opts.slice(0, shift));
      story.push({ speaker: "you", prompt: `Reply: “${seeds[i]?.meaning}”`, options: rotated, correct: (3 - shift) % 3, why: `The reply that fits here means “${seeds[i]?.meaning}”.` });
    }
  });
  return {
    id, unit, title, scene,
    objective: `Use ${cards.length} everyday phrases for ${title.toLowerCase()}.`,
    cultureNote: "PLACEHOLDER culture note — who says this, to whom, and in what setting. To be written and reviewed by a linguist.",
    cards, story,
  };
}

const neighbour = { name: "Neighbour", avatar: "👩🏾" };
const friend = { name: "Friend", avatar: "🧑🏾" };
const elder = { name: "Elder", avatar: "👴🏾" };
const trader = { name: "Trader", avatar: "👩🏾‍🦱" };

export const units: readonly Unit[] = [
  {
    number: 1, title: "First conversations", lessons: [
      makeLesson("welcome", "First conversations", "Welcome", "Saying hello for the first time", friend, [
        { icon: "👋", meaning: "Hello", note: "A general greeting." }, { icon: "🙂", meaning: "Welcome", note: "Said to someone arriving." },
        { icon: "🙏", meaning: "Thank you", note: "Polite reply." }, { icon: "✋", meaning: "Goodbye", note: "Closing a short visit." },
      ]),
      makeLesson("greetings", "First conversations", "Greetings", "Meeting a neighbour in the morning", neighbour, [
        { icon: "🌅", meaning: "Good morning", note: "Used when you first see someone in the day." }, { icon: "👍", meaning: "Good morning to you too", note: "Returning the greeting." },
        { icon: "🙂", meaning: "How are you?", note: "A friendly follow-up." }, { icon: "💪", meaning: "I am well", note: "A common reply." },
      ]),
      makeLesson("introducing", "First conversations", "Introducing yourself", "Meeting someone at a gathering", friend, [
        { icon: "🪪", meaning: "What is your name?", note: "Asking a peer." }, { icon: "🙋🏾", meaning: "My name is…", note: "Giving your name." },
        { icon: "🌍", meaning: "Where are you from?", note: "A common next question." }, { icon: "🏡", meaning: "I am from…", note: "Naming your town." },
      ]),
      makeLesson("polite", "First conversations", "Polite expressions", "Greeting an elder respectfully", elder, [
        { icon: "🙇🏾", meaning: "Greetings, sir", note: "Respectful register for elders." }, { icon: "🙏", meaning: "Please", note: "Softening a request." },
        { icon: "😔", meaning: "Sorry", note: "Apology or sympathy." }, { icon: "💚", meaning: "Thank you very much", note: "Strong thanks." },
      ]),
    ],
  },
  {
    number: 2, title: "People around me", lessons: [
      makeLesson("family", "People around me", "Family", "Visiting a friend's family", elder, [
        { icon: "👩🏾", meaning: "Mother", note: "" }, { icon: "👨🏾", meaning: "Father", note: "" },
        { icon: "👧🏾", meaning: "Sister", note: "" }, { icon: "👦🏾", meaning: "Brother", note: "" },
      ]),
      makeLesson("friends", "People around me", "Friends", "Catching up with a friend", friend, [
        { icon: "🤝", meaning: "My friend", note: "" }, { icon: "😄", meaning: "Long time!", note: "" },
        { icon: "📅", meaning: "See you tomorrow", note: "" }, { icon: "🎉", meaning: "Well done", note: "" },
      ]),
      makeLesson("market", "People around me", "At the market", "Buying tomatoes from a trader", trader, [
        { icon: "🍅", meaning: "How much is this?", note: "" }, { icon: "💰", meaning: "It is too expensive", note: "" },
        { icon: "🤏🏾", meaning: "Reduce it a little", note: "" }, { icon: "🛍️", meaning: "I will take it", note: "" },
      ]),
    ],
  },
];

export const allLessons: readonly Lesson[] = units.flatMap((u) => u.lessons);
export const findLesson = (id: string | null) => allLessons.find((l) => l.id === id) ?? null;

/** Progress rule: lessons unlock in order; the first incomplete lesson is current. */
export function lessonStatus(id: string, completed: readonly string[], lessons: readonly Lesson[] = allLessons): "done" | "current" | "open" | "locked" {
  if (completed.includes(id)) return "done";
  const firstOpen = lessons.find((l) => !completed.includes(l.id));
  if (firstOpen?.id === id) return "current";
  return "locked";
}
