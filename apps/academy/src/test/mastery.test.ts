import { describe, expect, it } from "vitest";
import { MASTERY_LEVELS, masteryFromRecord, type ConceptRecord } from "@/backend/mastery";

/**
 * The mastery rule is the product's headline claim — "concept mastery updates reliably" is the
 * handoff brief's own acceptance criterion — and it is pure arithmetic, so there is no excuse for it
 * being the least tested thing in the codebase. It was previously buried in the database module,
 * where importing it pulled in a Postgres driver.
 */
function record(correct: number, attempts: number): ConceptRecord {
  return { correct, attempts, lastAnsweredAt: "2026-10-04T00:00:00Z" };
}

describe("masteryFromRecord", () => {
  it("reports concepts never answered as Not started, not as failure", () => {
    // The distinction the old hardcoded labels could not express: never met is not the same as met
    // and got wrong, and a learner who has answered nothing has earned no assessment either way.
    expect(masteryFromRecord(undefined)).toBe("Not started");
    expect(masteryFromRecord(record(0, 0))).toBe("Not started");
  });

  it("reports any correct answer below half as Attempted", () => {
    expect(masteryFromRecord(record(0, 4))).toBe("Attempted");
    expect(masteryFromRecord(record(1, 4))).toBe("Attempted");
  });

  it("reports half as Familiar", () => {
    expect(masteryFromRecord(record(2, 4))).toBe("Familiar");
    expect(masteryFromRecord(record(3, 6))).toBe("Familiar");
  });

  it("reports three quarters as Proficient", () => {
    expect(masteryFromRecord(record(3, 4))).toBe("Proficient");
  });

  it("reports every answer correct as Mastered", () => {
    expect(masteryFromRecord(record(4, 4))).toBe("Mastered");
    expect(masteryFromRecord(record(1, 1))).toBe("Mastered");
  });

  it("places a boundary value on the higher level, not the lower", () => {
    // Exactly 50% and exactly 75% are the values most likely to be got wrong by an off-by-one, and
    // the learner who reaches a threshold should be told they reached it.
    expect(masteryFromRecord(record(1, 2))).toBe("Familiar");
    expect(masteryFromRecord(record(6, 8))).toBe("Proficient");
  });

  it("only ever returns one of the five declared levels", () => {
    for (let attempts = 0; attempts <= 12; attempts += 1) {
      for (let correct = 0; correct <= attempts; correct += 1) {
        expect(MASTERY_LEVELS).toContain(masteryFromRecord(record(correct, attempts)));
      }
    }
  });
});
