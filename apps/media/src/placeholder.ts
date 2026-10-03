/**
 * PLACEHOLDER — REPLACE OR DELETE THIS FILE.
 *
 * WHY IT EXISTS, AND WHO SHOULD REMOVE IT
 *
 * `apps/media` is `@ozikoro/media`, the self-hosted text-to-speech service, and it is being built by another
 * agent. When this file was added, the package had a `tsconfig.json` whose `include` listed its `src`, `lib`
 * and `scripts` directories — and **there was no TypeScript file in any of the three**, so `tsc --noEmit`
 * failed with `TS18003: No inputs were found in config file`. The package's own `typecheck` script therefore
 * exited non-zero, and `npm run typecheck --workspaces` failed **for the entire repository**.
 *
 * That is worth stating precisely, because the failure mode is one this project keeps recording: **the
 * package was fine and everyone else was broken.** A per-package check passes while the repo-wide one fails,
 * and the person who caused it never sees it.
 *
 * This file is the smallest possible input: it declares nothing, imports nothing and exports nothing. It
 * exists so the project compiles and nothing else depends on it. The package's entry point is declared as a
 * server module, so **the owner of this package should replace this with the real one** — and this file can
 * then simply be deleted, because a project with real sources does not need a placeholder.
 *
 * A NOTE ON THE COMMENT ITSELF, WHICH COST A SECOND ATTEMPT. The first version of this header wrote the
 * directory globs out in full, and a glob containing a starred directory name contains the two characters
 * that CLOSE a block comment — so the comment ended in the middle of a sentence and the file became a syntax
 * error. **A doc comment that quotes a pattern can terminate itself**, which is the same class of fault the
 * repository's secrets check already records for a different pattern.
 */
export {};
