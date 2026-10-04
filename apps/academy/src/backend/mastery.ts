/**
 * Mastery: the rule, on its own.
 *
 * Split out of `./academy.ts` deliberately. The rule is domain logic with no dependency on Postgres,
 * so keeping it beside the queries meant a test could not exercise it without importing a database
 * driver — which is the kind of coupling that ends with the most important rule in the product being
 * the least tested one.
 */

export interface ConceptRecord {
  attempts: number;
  correct: number;
  lastAnsweredAt: string;
}

/** The five states, in order. Mirrors `masteryLevels` in `src/data/academy.ts`. */
export const MASTERY_LEVELS = ["Not started", "Attempted", "Familiar", "Proficient", "Mastered"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

/**
 * Turn a record into one of the five states.
 *
 * The thresholds are a stated rule rather than a tuned one: any correct answer below half is
 * "Attempted" (they have met it), half is "Familiar", three quarters is "Proficient", and every
 * answer correct is "Mastered".
 *
 * A learner who has never answered the concept is "Not started", which is deliberately different
 * from having answered it badly — the previous UI could not express that distinction at all, because
 * every concept carried a hardcoded label in the seed data.
 */
export function masteryFromRecord(record: ConceptRecord | undefined): MasteryLevel {
  if (!record || record.attempts === 0) return "Not started";
  const ratio = record.correct / record.attempts;
  if (ratio >= 1) return "Mastered";
  if (ratio >= 0.75) return "Proficient";
  if (ratio >= 0.5) return "Familiar";
  return "Attempted";
}
