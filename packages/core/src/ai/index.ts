/**
 * The AI layer — gateway, prompts, retrieval, validation, limits and evaluation.
 *
 * Spec §8.1 and §8.2. Every module here is pure: no network, no database, no clock of its own, no
 * randomness. The provider adapter supplies the network, the caller supplies the data, and time is
 * passed in — which is what makes the guardrails testable, and what will make them auditable when
 * a linguist asks why the tutor refused a particular answer.
 *
 * The order of the pipeline, and where each part lives:
 *
 *   1. plan and rate limits     -> limits.ts      (refuse cheaply, before spending)
 *   2. retrieve published only  -> retrieval.ts   (§5.3, §8.1 retrieval-first)
 *   3. render a versioned prompt-> prompts.ts     (§8.2 prompt registry)
 *   4. call a provider          -> gateway.ts     (§8.2 LLM gateway)
 *   5. validate the output      -> validator.ts   (§8.1 validation layer)
 *   6. record what it cost      -> limits.ts      (§8.1 spend cap)
 *   7. measure it on the set    -> evaluation.ts  (§8.1, §8.3)
 *
 * Nothing in steps 1–7 can publish anything. §8.1: "Never auto-publish. AI can only create drafts."
 */
export * from './gateway.ts';
export * from './prompts.ts';
export * from './retrieval.ts';
export * from './validator.ts';
export * from './limits.ts';
export * from './evaluation.ts';
