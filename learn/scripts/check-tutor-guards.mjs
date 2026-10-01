/**
 * Fail if the tutor's guardrails are weakened.
 *
 * WHY THIS CHECK EXISTS
 *
 * The tutor's safety is structural, not a prompt: when retrieval finds nothing, the model call does
 * not happen. That is one `return` statement away from being an advisory prompt again, and the
 * change would look harmless in review — a small refactor that "simplifies the flow".
 *
 * Each assertion below corresponds to a guardrail named in the spec. If one is removed the build
 * fails rather than the guardrail silently disappearing.
 */
import { readFileSync } from "node:fs";

const SRC = "src/routes/api/tutor.ts";
const RETRIEVAL = "src/lib/tutor/retrieval.ts";
const VALIDATE = "src/lib/tutor/validate.ts";

const src = readFileSync(SRC, "utf8");
const checks = [];

// 1. No evidence -> no model call. The refusal must come BEFORE the binding is reached.
const refusalAt = src.indexOf('sufficiency(entries, question)');
const modelAt = src.indexOf("__env__");
checks.push([
  "the no-evidence refusal precedes the model call",
  refusalAt !== -1 && modelAt !== -1 && refusalAt < modelAt,
]);

// 2. The model is told it may not invent language.
checks.push(["the system prompt forbids inventing Igbo", /NEVER (write|invent)/.test(src)]);

// 3. Validation runs on the reply before it is returned.
checks.push(["the reply is validated against the evidence", /validate\(/.test(src)]);

// 4. Trust labels are emitted, and are not sourced from the model.
checks.push(["trust labels are returned", /trustLabel\(/.test(src)]);
checks.push(["the overall label is the weakest evidence", /order\.find\(/.test(src)]);

// 5. The retrieval layer keeps Central Igbo as the default.
const retrieval = readFileSync(RETRIEVAL, "utf8");
checks.push(["retrieval defaults to Central Igbo only", /is\("dialect",\s*null\)/.test(retrieval)]);

// 6. AI-written rows can never be labelled verified.
checks.push(["ai_generated blocks the verified label", /ai_generated.*needs_review|if \(row\.ai_generated\)/.test(retrieval.replace(/\n/g, " ")) || /row\.ai_generated/.test(retrieval)]);

// 7. A generated sentence is never called verified.
const validate = readFileSync(VALIDATE, "utf8");
checks.push(["generated language is never labelled verified", /corpus-words-only/.test(validate) && !/basis: "verified"/.test(validate)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n  ${failed} tutor guardrail(s) missing. The tutor must not ship without them.`);
  process.exit(1);
}
