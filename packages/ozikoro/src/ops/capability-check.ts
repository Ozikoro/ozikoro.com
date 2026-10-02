/**
 * Is every capability the code requires actually held by somebody?
 *
 * THE BUG THIS EXISTS TO CATCH
 *
 * In round 12 the byline claim path was built, wired to a screen, and unusable. `manage_contributors`
 * was required by the decision endpoint and held by **no role at all** — not an editor, not an
 * administrator. An author could request a byline, an editor could see it waiting, and nobody could
 * decide it. It would have sat pending forever.
 *
 * It was found by exercising the path with a real account and being refused, then asking the role
 * table why. That is luck, not a process: the capability matrix lives only in SQL migrations and in
 * the database, so nothing connected "this string is required by code" to "this string is granted to
 * anyone".
 *
 * So this reads the capability names OUT OF THE SOURCE — the arguments to `requireCapability` and
 * `hasCapability`, and the destination states in `TRANSITION_CAPABILITY` — and checks each against the
 * grants. A capability required and held by nobody fails the run.
 *
 * The list is discovered, not remembered, for the same reason the residue check discovers its tables:
 * a thing that has to be remembered will eventually not be.
 *
 * Run with: node src/ops/capability-check.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, type Db } from '@ozituma/db/client';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SOURCE_DIRS = ['apps/ozikoro/app', 'apps/ozikoro/lib', 'packages/ozikoro/src'];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (
      /\.tsx?$/.test(entry.name) &&
      // Two naming conventions in this repository: `x.test.ts` and `test-x.ts`. Both are excluded,
      // and so is this file — its own doc comment contains an example call, and the first version
      // of this check dutifully reported the example as an ungranted capability.
      !entry.name.endsWith('.test.ts') &&
      !entry.name.startsWith('test-') &&
      entry.name !== 'capability-check.ts'
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every capability name the source requires, with where it was found. */
export async function requiredCapabilities(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const add = (capability: string, where: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(capability)) return;
    if (!found.has(capability)) found.set(capability, []);
    found.get(capability)!.push(where);
  };

  for (const dir of SOURCE_DIRS) {
    for (const file of await walk(join(REPO_ROOT, dir))) {
      const text = await readFile(file, 'utf8');
      const shown = file.slice(REPO_ROOT.length + 1);

      // requireCapability('x', …) and requireCapabilityOrRedirect('x', …)
      for (const m of text.matchAll(/requireCapability(?:OrRedirect)?\(\s*'([a-z0-9_]+)'/g)) add(m[1]!, shown);
      // hasCapability(accountId, 'x')
      for (const m of text.matchAll(/hasCapability\([^,]+,\s*'([a-z0-9_]+)'/g)) add(m[1]!, shown);
      // The destination-state capability table: `state: 'capability',`
      if (shown.endsWith('ozikoro/src/publications.ts')) {
        for (const m of text.matchAll(/^\s{2}[a-z_]+:\s*'([a-z0-9_]+)',/gm)) add(m[1]!, shown);
      }
    }
  }
  return found;
}

export async function ungrantedCapabilities(db: Db): Promise<{ capability: string; where: string[] }[]> {
  const required = await requiredCapabilities();
  const granted = new Set(
    (await db.rows<{ capability: string }>(`select distinct capability from ozikoro_role_capability`))
      .map((r) => String(r.capability))
  );
  return [...required.entries()]
    .filter(([capability]) => !granted.has(capability))
    .map(([capability, where]) => ({ capability, where }));
}

if (process.argv[1] && process.argv[1].endsWith('capability-check.ts')) {
  const db = await getDb();
  const required = await requiredCapabilities();
  const missing = await ungrantedCapabilities(db);
  await closeDb();

  console.log(`\n  ${required.size} capabilities required by the source.`);

  /*
   * THE GUARD (round 104).
   *
   * Like `check:residue` and `check:secrets`, this check's desired result is "nothing wrong found" — so a
   * broken extractor produces a permanent silent pass. With no names extracted, everything below is
   * trivially satisfied and it prints "0 capabilities required … Every one is held by at least one role"
   * and exits 0, on every input, forever.
   *
   * This is the check written because a capability held by nobody shipped once already (round 12), so its
   * silence is the last silence that should be trusted.
   */
  /*
   * THE SCOPE ASSERTION (round 181).
   *
   * The guard below catches an extractor that found NOTHING. It cannot catch one that found seven names
   * instead of eight, because every name it did find is granted and the output is a clean green line — short
   * by one, with nothing to say so.
   *
   * That is the failure a future module move would produce: `requireCapability` called from a directory
   * outside SOURCE_DIRS, silently unchecked. So the repository is asked rather than the scope — every call
   * site in apps/ and packages/ must fall inside the directories this check reads.
   *
   * Round 179 found the env-drift check's file list had gone stale after a module moved; this is that lesson
   * made mechanical instead of remembered.
   */
  const outside: string[] = [];
  for (const root of ['apps', 'packages']) {
    // TWO BUGS LIVED HERE, and the mutation test found both by refusing to pass.
    //
    // 1. The walk used a BARE relative path while the extraction above uses `join(REPO_ROOT, dir)`. Under
    //    `npm -w` the working directory is `packages/ozikoro`, so `walk('apps')` returned zero files and
    //    this loop had nothing to inspect: measured `cwd=…/packages/ozikoro apps=0`.
    // 2. Had it found any, `file.startsWith(dir + '/')` compared an ABSOLUTE path against a relative
    //    prefix, so every call site would have been reported as outside the scope — a false alarm instead
    //    of a silent pass.
    //
    // `walk` already restricts to .ts/.tsx and already excludes both test conventions and this file, so
    // there are no filters here. There WERE, and that was the third bug: a redundant `/test-/` was not
    // anchored, so it excluded `zztest-outside.ts` — the project's own fixture prefix collides with the
    // token `test-`, and the file written to prove the assertion bites was itself filtered out by it.
    //
    // **Round 169's lesson, a third time: the check was broken and said everything was fine.** Each bug
    // was found only by running the mutation and refusing to accept the exit code it produced.
    for (const file of await walk(join(REPO_ROOT, root))) {
      const text = await readFile(file, 'utf8');
      if (!/requireCapability\(|hasCapability\(/.test(text)) continue;
      const shown = file.slice(REPO_ROOT.length + 1);
      if (!SOURCE_DIRS.some((dir) => shown.startsWith(dir + '/'))) outside.push(shown);
    }
  }
  if (outside.length > 0) {
    console.error(
      '\n  CAPABILITY CALLS OUTSIDE THE SCANNED SCOPE — this check would not see these, and would\n' +
        '  report every capability it DID see as granted:\n'
    );
    for (const f of outside) console.error(`    ${f}`);
    console.error(
      `\n  Add the directory to SOURCE_DIRS in ${'packages/ozikoro/src/ops/capability-check.ts'}.\n`
    );
    process.exit(2);
  }

  if (required.size === 0) {
    console.error(
      '\n  EXTRACTED NO CAPABILITY NAMES — the source scan found nothing, which cannot be right: this\n' +
        '  codebase requires capabilities in dozens of places. Not a pass: a scan that found no names\n' +
        '  reports every capability granted on every input.\n'
    );
    process.exit(2);
  }

  if (missing.length === 0) {
    console.log('  Every one is held by at least one role.\n');
    process.exit(0);
  }

  console.error('\n  UNGRANTED CAPABILITIES — required by code, held by NOBODY.\n');
  for (const { capability, where } of missing) {
    console.error(`    ${capability}`);
    for (const w of [...new Set(where)].slice(0, 3)) console.error(`        required by ${w}`);
  }
  console.error(
    '\n  A capability held by no role is a feature no one can use — the round-12 bug, where the byline\n' +
      '  claim path could be started and never decided. Grant it in a migration.\n'
  );
  process.exit(1);
}
